import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type Stage = 'script' | 'storyboard' | 'captions';
export type NativeCommand = 'doctor' | 'probe' | 'captions' | 'validate' | 'preview' | 'approve' | 'render';
export interface ProjectSummary { id: string; root: string; title: string; style: string; updatedAt: string; projectFile: string }
export interface StudioState {
  schema: 'mode-b-studio-state-v1'; project: ProjectSummary; brief: { topic: string; language: string; ratio: '9:16' };
  external: Partial<Record<Stage, { revision: number; artifact: unknown; importedAt: string }>>;
  voice?: { path: string; sha256: string; receipt?: unknown; generatedAt: string };
  alignment?: { path: string; captionsPath: string; audioSha256: string; generatedAt: string };
  approval?: { note: string; previewSha256: string; approvedAt: string };
}

const MAX_JSON = 4 * 1024 * 1024;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const atomicJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, file);
};
const inside = (parent: string, child: string) => child === parent || child.startsWith(`${parent}${path.sep}`);
const assertLocalRoot = (candidate: string, mustExist = true) => {
  if (!path.isAbsolute(candidate) || candidate.startsWith('\\\\')) throw new Error('A local absolute path is required.');
  const resolved = path.resolve(candidate);
  if (mustExist) {
    const real = fs.realpathSync(resolved);
    if (fs.lstatSync(real).isSymbolicLink() || !fs.statSync(real).isDirectory()) throw new Error('Project root must be a real directory.');
    return real;
  }
  const parent = fs.realpathSync(path.dirname(resolved));
  if (!inside(parent, resolved)) throw new Error('Project path escapes its parent.');
  return resolved;
};
const noExecutable = (file: string) => {
  if (/\.(?:exe|com|bat|cmd|ps1|msi|scr|js|mjs|cjs|vbs)$/i.test(file)) throw new Error('Executable files are not accepted.');
};
const statePath = (root: string) => path.join(root, '.studio', 'state.json');
export const readState = (root: string): StudioState => JSON.parse(fs.readFileSync(statePath(assertLocalRoot(root)), 'utf8')) as StudioState;
export const writeState = (root: string, state: StudioState) => atomicJson(statePath(assertLocalRoot(root)), state);
export const projectId = (root: string) => sha(fs.realpathSync(root).toLowerCase()).slice(0, 24);

export function strictJson(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON) throw new Error('JSON exceeds the 4 MiB limit.');
  if (!text.trim()) throw new Error('JSON is empty.');
  const stack: Array<Set<string> | null> = []; let inString = false; let escaped = false; let token = ''; let expectingKey = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) { token += c; escaped = false; continue; }
      if (c === '\\') { token += c; escaped = true; continue; }
      if (c === '"') {
        inString = false;
        if (expectingKey) {
          let key: string;
          try { key = JSON.parse(`"${token}"`) as string; } catch { throw new Error('Invalid JSON string.'); }
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Forbidden object key: ${key}`);
          const keys = stack.at(-1); if (!keys) throw new Error('Invalid object key.');
          if (keys.has(key)) throw new Error(`Duplicate object key: ${key}`); keys.add(key); expectingKey = false;
        }
        token = ''; continue;
      }
      token += c; continue;
    }
    if (c === '"') { inString = true; token = ''; continue; }
    if (c === '{') { stack.push(new Set()); expectingKey = true; if (stack.length > 64) throw new Error('JSON nesting exceeds 64 levels.'); }
    else if (c === '[') { stack.push(null); if (stack.length > 64) throw new Error('JSON nesting exceeds 64 levels.'); }
    else if (c === '}' || c === ']') { stack.pop(); expectingKey = false; }
    else if (c === ',' && stack.at(-1) instanceof Set) expectingKey = true;
    else if (c === ':' && stack.at(-1) instanceof Set) expectingKey = false;
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The root must be a JSON object.');
  return value;
}

const stageContracts: Record<Stage, string> = {
  script: 'Return {"schema":"mode-b-script-v1","sections":[{"id":"...","text":"..."}]}. Keep every supplied fact and section ID.',
  storyboard: 'Return {"schema":"mode-b-storyboard-v1","shots":[{"id":"...","start":0,"end":1,"layers":[]}]}. Use only native B1-B4 manifest fields.',
  captions: 'Return {"schema":"mode-b-captions-v1","cues":[{"start":0,"end":1,"text":"..."}]}. One semantic line per cue.'
};
export function externalPrompt(state: StudioState, stage: Stage) {
  const source = state.external.script?.artifact ?? { title: state.project.title, topic: state.brief.topic, language: state.brief.language };
  return `# MODE B EXTERNAL CHATGPT — ${stage.toUpperCase()}\n\nManual transport only. Do not return Markdown or executable code. Return exactly one UTF-8 JSON object.\n\nProject ID: ${state.project.id}\nStyle contract: ${state.project.style}\nOutput ratio: ${state.brief.ratio}\n\n## Source material\n${JSON.stringify(source, null, 2)}\n\n## Frozen output contract\n${stageContracts[stage]}\n`;
}
const validateStage = (stage: Stage, artifact: unknown) => {
  const object = artifact as Record<string, unknown>; const expected = `mode-b-${stage}-v1`;
  if (object.schema !== expected) throw new Error(`Expected schema ${expected}.`);
  const key = stage === 'script' ? 'sections' : stage === 'storyboard' ? 'shots' : 'cues';
  if (!Array.isArray(object[key]) || !(object[key] as unknown[]).length) throw new Error(`${key} must be a non-empty array.`);
  return object;
};
const pending = new Map<string, { root: string; stage: Stage; artifact: unknown; before: unknown; created: number }>();
export function stageExternalImport(root: string, stage: Stage, text: string) {
  const state = readState(root); const artifact = validateStage(stage, strictJson(text)); const before = state.external[stage]?.artifact ?? null;
  const token = randomUUID(); pending.set(token, { root: state.project.root, stage, artifact, before, created: Date.now() });
  return { token, stage, before, after: artifact, changes: JSON.stringify(before) === JSON.stringify(artifact) ? 0 : 1 };
}
export function confirmExternalImport(token: string) {
  const item = pending.get(token); if (!item || Date.now() - item.created > 10 * 60_000) throw new Error('Import confirmation expired.');
  const state = readState(item.root); const previous = state.external[item.stage];
  const revision = (previous?.revision ?? 0) + 1; const dir = path.join(item.root, '.studio', 'external');
  if (previous) atomicJson(path.join(item.root, '.studio', 'revisions', `${item.stage}-${previous.revision}.json`), previous);
  atomicJson(path.join(dir, `${item.stage}.json`), item.artifact);
  state.external[item.stage] = { revision, artifact: item.artifact, importedAt: new Date().toISOString() }; state.project.updatedAt = new Date().toISOString(); writeState(item.root, state); pending.delete(token);
  return state;
}

export function nativeSkillRoot(appPath: string) {
  const configured = process.env.MODE_B_SKILL_ROOT;
  const root = path.resolve(configured || appPath, configured ? '.' : '../skills/directing-stickman-videos');
  const cli = path.join(root, 'scripts', 'autopilot.mjs'); if (!fs.existsSync(cli)) throw new Error('Original Mode B CLI was not found.'); return { root, cli };
}
export async function runProcess(exe: string, args: string[], options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv }) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(exe, args, { cwd: options.cwd, shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; const cap = 8 * 1024 * 1024;
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-cap);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk as Buffer); }); child.stderr.on('data', chunk => { stderr = append(stderr, chunk as Buffer); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native command timed out.')); }, options.timeout ?? 10 * 60_000);
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
export async function runNative(appPath: string, root: string, command: NativeCommand, input: { seconds?: number; note?: string; replace?: boolean; file?: string } = {}) {
  const { cli } = nativeSkillRoot(appPath); const projectRoot = assertLocalRoot(root); const project = path.join(projectRoot, 'project.json');
  const args = [cli, command];
  if (command === 'doctor') { /* no project argument */ }
  else if (command === 'probe') { const file = resolveProjectFile(projectRoot, input.file || 'output/preview.mp4'); args.push(file); }
  else if (command === 'captions') throw new Error('Use the dedicated caption alignment operation.');
  else { args.push(project); if (input.seconds !== undefined && ['validate', 'preview'].includes(command)) args.push('--seconds', String(input.seconds)); if (command === 'approve') args.push('--note', input.note || ''); if (input.replace && ['preview', 'render'].includes(command)) args.push('--replace'); }
  const result = await runProcess(process.execPath, args, { cwd: path.dirname(cli) });
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Native ${command} failed.`); return result;
}
export function resolveProjectFile(root: string, relative: string) {
  const projectRoot = assertLocalRoot(root); if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('A project-relative path is required.');
  const target = path.resolve(projectRoot, relative); if (!inside(projectRoot, target)) throw new Error('Path escapes the project.'); noExecutable(target);
  if (fs.existsSync(target)) { const real = fs.realpathSync(target); if (!inside(projectRoot, real) || fs.lstatSync(target).isSymbolicLink()) throw new Error('Symlink/junction media is not accepted.'); return real; }
  return target;
}
export const mediaUrl = (root: string, relative: string) => `studio-media://${projectId(assertLocalRoot(root))}/${encodeURIComponent(relative.replaceAll('\\', '/'))}`;
export const fileFetchUrl = (root: string, relative: string) => pathToFileURL(resolveProjectFile(root, relative)).toString();
export function inspectWav(file: string) {
  const data = fs.readFileSync(file); if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Nano output is not WAV.');
  const channels = data.readUInt16LE(22), rate = data.readUInt32LE(24), bits = data.readUInt16LE(34), format = data.readUInt16LE(20);
  if (format !== 1 || channels !== 1 || rate !== 24000 || bits !== 16) throw new Error('Expected WAV 24 kHz mono PCM16.');
  return { channels, sampleRate: rate, bits, sha256: sha(data), bytes: data.length };
}
export function safeImportedFile(root: string, source: string, kind: 'image' | 'sfx') {
  const projectRoot = assertLocalRoot(root); const real = fs.realpathSync(source); noExecutable(real);
  const allowed = kind === 'image' ? /\.(?:png|jpe?g)$/i : /\.(?:wav|mp3|m4a|aac|ogg|flac)$/i; if (!allowed.test(real) || !fs.statSync(real).isFile()) throw new Error(`Unsupported ${kind} file.`);
  const dir = path.join(projectRoot, 'assets', kind === 'image' ? 'images' : 'sfx'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${sha(fs.readFileSync(real)).slice(0, 12)}-${path.basename(real)}`); if (!fs.existsSync(target)) fs.copyFileSync(real, target); return path.relative(projectRoot, target).replaceAll('\\', '/');
}
