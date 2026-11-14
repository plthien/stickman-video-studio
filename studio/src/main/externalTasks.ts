import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, nativeSkillRoot, readState, resolveProjectFile, runProcess, sha, strictJson, writeState, type Stage, type StudioState } from './services.js';

const STYLE: Record<string, string> = { B1: 'b1-minimal-handdrawn.md', B2: 'b2-colorful-handdrawn.md', B3: 'b3-television.md', B4: 'b4-survival-storytelling.md' };
const COMMON = ['SKILL.md', 'references/autopilot.md', 'references/autopilot-runtime.md', 'references/autopilot-production-qa.md', 'references/autopilot-sound-system.md'];
const exactKeys = (object: Record<string, unknown>, allowed: string[]) => { const extra = Object.keys(object).filter(key => !allowed.includes(key)); if (extra.length) throw new Error(`Unknown field: ${extra[0]}`); };
const readUtf8 = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const projectContext = (state: StudioState, root: string) => {
  const manifest = strictJson(readUtf8(path.join(root, 'project.json'))) as Record<string, unknown>;
  const assets = fs.existsSync(path.join(root, 'assets')) ? fs.readdirSync(path.join(root, 'assets'), { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => String(item.parentPath ? path.relative(root, path.join(item.parentPath, item.name)) : item.name).replaceAll('\\', '/')).sort() : [];
  return { project_id: state.project.id, title: state.project.title, topic: state.brief.topic, audience: state.brief.audience ?? '', purpose: state.brief.purpose ?? '', language: state.brief.language, ratio: state.brief.ratio, target_duration_seconds: state.brief.targetDuration ?? null, style: state.project.style, approved_script: state.approvedScript ?? null, voice: state.voice ? { path: state.voice.path, sha256: state.voice.sha256, duration: state.voice.duration, stale: state.voice.stale } : null, alignment: state.alignment ?? null, assets, native_manifest: manifest };
};
const sourceBundle = (appPath: string, style: string) => {
  const { root } = nativeSkillRoot(appPath); const files = [...COMMON, `references/${STYLE[style]}`];
  if (style === 'B4') files.push('references/b4-opening-direction.md', 'references/b4-audio-direction.md');
  return files.map(relative => { const text = readUtf8(path.join(root, relative)); return { relative, sha256: sha(text), text }; });
};
export function freezeTask(appPath: string, root: string, stage: Stage, rebuild = false) {
  const state = readState(root); const context = projectContext(state, root); const sources = sourceBundle(appPath, state.project.style);
  if (stage === 'native' && (!state.approvedScript || !state.voice || state.voice.stale || !state.alignment)) throw new Error('Approved script, current verified narration and real word alignment are required before native authoring.');
  const inputSha256 = sha(JSON.stringify({ context, sources: sources.map(item => [item.relative, item.sha256]), stage })); const prior = state.tasks?.[stage];
  if (!rebuild && prior && prior.inputSha256 === inputSha256 && fs.existsSync(resolveProjectFile(root, prior.promptPath))) return { ...prior, prompt: readUtf8(resolveProjectFile(root, prior.promptPath)) };
  if (prior) prior.status = 'STALE'; const revision = (prior?.revision ?? 0) + 1; const id = randomUUID();
  const response = stage === 'script'
    ? { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { schema: 'mode-b-script-v1', sections: [{ id: 'section-01', text: 'Exact approved wording' }] } }
    : { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { manifest: { version: 1, style: state.project.style, width: 1080, height: 1920, fps: 30, voice: { path: state.voice?.path }, captions: [], shots: [], sfx: [] } } };
  const prompt = `# ORIGINAL MODE B MANUAL CHATGPT HANDOFF — ${stage === 'script' ? 'SCRIPT & CREATIVE DIRECTION' : 'VISUAL / SHOT / SOUND / NATIVE MANIFEST'}\n\nThis is a manual transport boundary in the original Mode B workflow. Do not invent a parallel engine. Do not call tools, return Markdown, executable code, URLs, or local absolute paths. Return exactly one JSON object matching the frozen envelope below.\n\n## ACTUAL PROJECT CONTEXT\n${JSON.stringify(context, null, 2)}\n\n## REQUIRED RESPONSE ENVELOPE\n${JSON.stringify(response, null, 2)}\n\nThe outer identity fields must be returned byte-for-value. For native authoring, payload.manifest is the original B1–B4 project.json v1 and must contain no Studio/task metadata. Ground every shot in the approved script and actual word/caption timing. List missing media honestly; never fabricate an existing asset path.\n\n## AUTHORITATIVE INSTALLED MODE B SOURCES\n${sources.map(item => `\n--- BEGIN ${item.relative} [sha256 ${item.sha256}] ---\n${item.text}\n--- END ${item.relative} ---`).join('\n')}\n`;
  const relative = `.studio/external/tasks/${stage}-${revision}-${id}.md`; const target = resolveProjectFile(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, prompt, { encoding: 'utf8', flag: 'wx' });
  state.tasks ??= {}; state.tasks[stage] = { id, revision, inputSha256, promptPath: relative, status: 'FROZEN', createdAt: new Date().toISOString() }; writeState(root, state); return { ...state.tasks[stage], prompt };
}

interface Envelope { schema: string; project_id: string; task_id: string; revision: number; input_sha256: string; stage: Stage; payload: Record<string, unknown> }
function validateEnvelope(state: StudioState, stage: Stage, value: unknown): Envelope {
  const object = value as Record<string, unknown>; exactKeys(object, ['schema','project_id','task_id','revision','input_sha256','stage','payload']); const task = state.tasks?.[stage];
  if (!task || task.status !== 'FROZEN') throw new Error('No current frozen task exists.');
  if (object.schema !== 'mode-b-external-result-v1' || object.project_id !== state.project.id || object.task_id !== task.id || object.revision !== task.revision || object.input_sha256 !== task.inputSha256 || object.stage !== stage) throw new Error('Project/task/revision/input binding mismatch.');
  if (!object.payload || typeof object.payload !== 'object' || Array.isArray(object.payload)) throw new Error('Invalid payload.'); return object as unknown as Envelope;
}
function validateScript(payload: Record<string, unknown>) { exactKeys(payload, ['schema','sections']); if (payload.schema !== 'mode-b-script-v1' || !Array.isArray(payload.sections) || !payload.sections.length) throw new Error('Invalid script payload.'); const ids = new Set<string>(); const sections = payload.sections.map(item => { const value = item as Record<string, unknown>; exactKeys(value, ['id','text']); if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id) || typeof value.text !== 'string' || !value.text.trim()) throw new Error('Invalid or duplicate script section.'); ids.add(value.id); return { id: value.id, text: value.text.trim() }; }); return { schema: 'mode-b-script-v1', sections }; }
function validateManifest(state: StudioState, root: string, payload: Record<string, unknown>) {
  exactKeys(payload, ['manifest']); const manifest = payload.manifest as Record<string, unknown>; if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Native manifest missing.');
  const allowed = ['version','style','width','height','fps','voice','captions','shots','sfx','music','grid','captionSize','captionFont','font','television','ambience','dialogue','audio_cuts','opening','opening_audio_override','motion_ledger']; exactKeys(manifest, allowed);
  if (manifest.version !== 1 || manifest.style !== state.project.style || !['B1','B2','B3','B4'].includes(String(manifest.style))) throw new Error('Native version/style mismatch.');
  if (!Array.isArray(manifest.shots) || !manifest.shots.length || !Array.isArray(manifest.captions) || !manifest.voice || typeof manifest.voice !== 'object') throw new Error('Native voice/captions/shots are required.');
  const voicePath = (manifest.voice as Record<string, unknown>).path; if (!state.voice || voicePath !== state.voice.path) throw new Error('Manifest must bind the current verified narration path.');
  const missing: string[] = []; const visit = (value: unknown) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(visit); const item = value as Record<string, unknown>; if (item.type === 'image' && typeof item.path === 'string' && !String(item.path).startsWith('@b1/')) { try { if (!fs.existsSync(resolveProjectFile(root, item.path))) missing.push(item.path); } catch { missing.push(String(item.path)); } } Object.values(item).forEach(visit); }; visit(manifest.shots);
  return { manifest, missing: [...new Set(missing)] };
}
export function stageImport(root: string, stage: Stage, text: string) {
  const state = readState(root); const envelope = validateEnvelope(state, stage, strictJson(text)); const payload = stage === 'script' ? validateScript(envelope.payload) : validateManifest(state, root, envelope.payload);
  const pending = { schema: 'mode-b-pending-import-v1', token: randomUUID(), stage, taskId: envelope.task_id, revision: envelope.revision, inputSha256: envelope.input_sha256, payload, before: stage === 'script' ? state.approvedScript ?? null : strictJson(readUtf8(path.join(root, 'project.json'))), createdAt: new Date().toISOString() };
  atomicJson(path.join(root, '.studio', 'external', 'pending.json'), pending); return { token: pending.token, stage, before: pending.before, after: payload, changes: JSON.stringify(pending.before) === JSON.stringify(payload) ? 0 : 1, status: stage === 'native' && (payload as {missing:string[]}).missing.length ? 'WAITING_FOR_MEDIA' : 'STAGED' };
}
export async function confirmImport(appPath: string, root: string, token: string) {
  const file = path.join(root, '.studio', 'external', 'pending.json'); if (!fs.existsSync(file)) throw new Error('No staged import exists.'); const pending = strictJson(readUtf8(file)) as Record<string, unknown>; if (pending.token !== token) throw new Error('Import confirmation token mismatch.');
  const state = readState(root); const stage = pending.stage as Stage; const task = state.tasks?.[stage]; if (!task || task.id !== pending.taskId || task.revision !== pending.revision || task.status !== 'FROZEN') throw new Error('Staged import is stale or replayed.');
  const revision = (state.external[stage]?.revision ?? 0) + 1; atomicJson(path.join(root, '.studio', 'revisions', `${stage}-${revision}.json`), pending.payload);
  if (stage === 'script') { const script = pending.payload as {sections:Array<{id:string;text:string}>}; const text = script.sections.map(item => item.text).join('\n\n'); const changed = state.approvedScript?.sha256 !== sha(text); state.approvedScript = { sections: script.sections, text, sha256: sha(text), revision, approvedAt: new Date().toISOString() }; if (changed) { if (state.voice) state.voice.stale = true; state.alignment = undefined; state.preview = undefined; state.approval = undefined; state.render = undefined; } }
  else { const value = pending.payload as {manifest:Record<string,unknown>;missing:string[]}; if(value.missing.length)throw new Error(`Native import still references missing media: ${value.missing.join(', ')}`);const candidate = path.join(root, `.project-candidate-${revision}.json`); atomicJson(candidate, value.manifest); try{const { cli } = nativeSkillRoot(appPath); const result = await runProcess(process.execPath, [cli, 'validate', candidate], { cwd: path.dirname(cli) }); if (result.code !== 0) throw new Error(result.stderr || 'Original native validation rejected the candidate.'); const current = path.join(root, 'project.json'); fs.copyFileSync(current, path.join(root, '.studio', 'revisions', `project-before-${revision}.json`)); const temp = `${current}.${process.pid}.tmp`; fs.copyFileSync(candidate, temp); fs.renameSync(temp, current);}finally{if(fs.existsSync(candidate))fs.unlinkSync(candidate)} state.preview = undefined; state.approval = undefined; state.render = undefined; }
  state.external[stage] = { revision, artifact: pending.payload, importedAt: new Date().toISOString() }; task.status = 'IMPORTED'; fs.unlinkSync(file); writeState(root, state); return state;
}
