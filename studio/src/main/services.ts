import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type Stage = 'script' | 'native';
export type NativeCommand = 'doctor' | 'probe' | 'captions' | 'validate' | 'preview' | 'approve' | 'render';
export interface ProjectSummary { id: string; root: string; title: string; style: string; updatedAt: string; projectFile: string }
export interface StudioState {
  schema: 'mode-b-studio-state-v1'; project: ProjectSummary; brief: { topic: string; language: string; ratio: '9:16'; targetDuration?: number; audience?: string; purpose?: string };
  external: Partial<Record<Stage, { revision: number; artifact: unknown; importedAt: string }>>;
  tasks?: Partial<Record<Stage, { id: string; revision: number; inputSha256: string; sourceFingerprint?: string; promptSha256?: string; promptPath: string; status: 'FROZEN' | 'IMPORTED' | 'STALE'; createdAt: string; scope?: string; assetBaseline?: Array<{path:string;sha256:string}>; mediaBaseline?: Array<{path:string;sha256:string;rights:string;kind:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}> }>>;
  approvedScript?: { sections: Array<{ id: string; text: string }>; text: string; sha256: string; revision: number; approvedAt: string; authoring?: Record<string, unknown> };
  voice?: { path: string; sha256: string; receipt?: unknown; generatedAt: string; duration?: number; stale?: boolean; profileId?: string; profileVersion?: number; referenceBinding?: string; origin?: 'NANO_GENERATED' | 'NANO_LONGFORM' | 'IMPORTED_WAV' };
  alignment?: { path: string; captionsPath: string; audioSha256: string; scriptSha256?: string; wordsSha256?: string; cuesSha256?: string; generatedAt: string; origin?: 'ELEVENLABS' | 'IMPORTED_WORDS'; words?: Array<{word:string;start:number;end:number;loss?:number}>; characters?: unknown; loss?: number; captionReview?: { revision:number; path:string; sha256:string; sourceSha256:string; note:string; approvedAt:string }; captionDraft?: { path:string; sha256:string; sourceSha256:string; boundaries:number[] } };
  approval?: { note: string; previewSha256: string; approvedAt: string };
  preview?: { path: string; sha256: string; reportPath: string; reportSha256: string; sourceFingerprint?: string; verifiedAt: string; reviewedAt?: string };
  render?: { path: string; sha256: string; reportPath: string; reportSha256: string; verifiedAt: string };
  nano?: { endpoint: string; profileId?: string };
  imports?: string[];
  media?: Array<{ path:string; sha256:string; kind:'image'|'sfx'|'ambience'; shotId?:string; layerId?:string; track?:'sfx'|'dialogue'|'ambience'|'music'; trackIndex?:number; rights:string; importedAt:string }>;
  nativeReadiness?: { sampleReady:boolean; fullReady:boolean; previewSeconds:number; checkedSeconds?:number; validationSha256?:string; missingOutsideScope?:string[]; reviewedDraft:boolean; verifiedAt:string };
  longform?: { jobId:string; manifestPath:string; outputPath:string; status:'READY'|'RUNNING'|'UNCERTAIN'|'PASS'|'FAILED'; sourceSha256:string; profileId:string; profileVersion?:number; resume:boolean; updatedAt:string; detail?:string };
}

const MAX_JSON = 4 * 1024 * 1024;
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const atomicJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, file);
};
export const inside = (parent: string, child: string) => child === parent || child.startsWith(`${parent}${path.sep}`);
export const assertLocalRoot = (candidate: string, mustExist = true) => {
  if (!path.isAbsolute(candidate) || candidate.startsWith('\\\\')) throw new Error('A local absolute path is required.');
  const resolved = path.resolve(candidate);
  if (mustExist) {
    const real = fs.realpathSync(resolved);
    if (real.toLowerCase() !== resolved.toLowerCase() || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(real).isDirectory()) throw new Error('Project root must be a real non-junction directory.');
    return real;
  }
  const parent = fs.realpathSync(path.dirname(resolved));
  if (parent.toLowerCase() !== path.resolve(path.dirname(resolved)).toLowerCase() || !inside(parent, resolved)) throw new Error('Project path escapes or traverses a linked parent.');
  return resolved;
};
const noExecutable = (file: string) => {
  if (/\.(?:exe|com|bat|cmd|ps1|msi|scr|js|mjs|cjs|vbs)$/i.test(file)) throw new Error('Executable files are not accepted.');
};
const statePath = (root: string) => path.join(root, '.studio', 'state.json');
export const readState = (root: string): StudioState => {
  const state = JSON.parse(fs.readFileSync(statePath(assertLocalRoot(root)), 'utf8')) as StudioState;
  state.tasks ??= {}; state.nano ??= { endpoint: 'http://127.0.0.1:3901' }; state.imports ??= []; state.media ??= [];
  return state;
};
export const writeState = (root: string, state: StudioState) => atomicJson(statePath(assertLocalRoot(root)), state);
export const projectId = (root: string) => sha(fs.realpathSync(root).toLowerCase()).slice(0, 24);
export function projectSnapshot(root: string) {
  const state=readState(root),manifest=strictJson(fs.readFileSync(path.join(assertLocalRoot(root),'project.json'),'utf8')) as Record<string,unknown>;
  const captions=Array.isArray(manifest.captions)?manifest.captions as Array<Record<string,unknown>>:[];
  const shots=Array.isArray(manifest.shots)?manifest.shots.map((item,index)=>{const shot=item as Record<string,unknown>,start=Number(shot.start),end=Number(shot.end);const cue=captions.find(value=>Number(value.start)<end&&Number(value.end)>start);return{id:String(shot.id||`SHOT-${String(index+1).padStart(2,'0')}`),title:String(shot.title||`Native shot ${index+1}`),duration:Math.max(0,end-start),start,end,caption:String(cue?.text||''),status:'Native manifest',color:'#79dfc6',layers:Array.isArray(shot.layers)?shot.layers:[]}}):[];
  const duration=shots.reduce((max,item)=>Math.max(max,item.end),0),clip=(label:string,start:number,end:number)=>({label,start,duration:Math.max(0,end-start)});
  const tracks={Scenes:shots.map(item=>clip(item.id,item.start,item.end)),Layers:shots.flatMap(item=>item.layers.map((layer,index)=>clip(String((layer as Record<string,unknown>).id||`${item.id}-layer-${index+1}`),item.start,item.end))),Captions:captions.map((cue,index)=>clip(String(cue.text||`Caption ${index+1}`),Number(cue.start),Number(cue.end))),Narration:state.voice?[clip(state.voice.origin||'Accepted narration',0,state.voice.duration??duration)]:[],SFX:(Array.isArray(manifest.sfx)?manifest.sfx as Array<Record<string,unknown>>:[]).map((value,index)=>clip(String(value.id||value.kind||`SFX ${index+1}`),Number(value.time),Number(value.time)+Number(value.duration||.25))),Ambience:(Array.isArray(manifest.ambience)?manifest.ambience as Array<Record<string,unknown>>:[]).map((value,index)=>clip(String(value.id||value.path||`Ambience ${index+1}`),Number(value.start),Number(value.end)))};
  return{...state,manifest,projection:{shots,duration,tracks,demo:false},job:reconcileJobSafe(root)};
}
function reconcileJobSafe(root:string){const file=path.join(root,'.studio','jobs','latest.json');if(!fs.existsSync(file))return null;try{return strictJson(fs.readFileSync(file,'utf8'))}catch{return{status:'UNKNOWN'}}}

export function strictJson(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON) throw new Error('JSON exceeds the 4 MiB limit.');
  if (!text.trim()) throw new Error('JSON is empty.');
  const stack: Array<{ type: 'object'; keys: Set<string>; expectingKey: boolean } | { type: 'array' }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      const start = i; let escaped = false; i += 1;
      for (; i < text.length; i += 1) { const q = text[i]; if (escaped) escaped = false; else if (q === '\\') escaped = true; else if (q === '"') break; }
      if (i >= text.length) throw new Error('Unterminated JSON string.');
      const current = stack.at(-1); let next = i + 1; while (/\s/.test(text[next] ?? '')) next += 1;
      if (current?.type === 'object' && current.expectingKey && text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Forbidden object key: ${key}`);
        if (current.keys.has(key)) throw new Error(`Duplicate object key: ${key}`); current.keys.add(key); current.expectingKey = false;
      }
      continue;
    }
    if (c === '{') { stack.push({ type: 'object', keys: new Set(), expectingKey: true }); if (stack.length > 64) throw new Error('JSON nesting exceeds 64 levels.'); }
    else if (c === '[') { stack.push({ type: 'array' }); if (stack.length > 64) throw new Error('JSON nesting exceeds 64 levels.'); }
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const current = stack.at(-1); if (current?.type === 'object') current.expectingKey = true; }
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The root must be a JSON object.');
  return value;
}

export function nativeSkillRoot(appPath: string) {
  const configured = process.env.MODE_B_SKILL_ROOT;
  const root = path.resolve(configured || appPath, configured ? '.' : '../skills/directing-stickman-videos');
  const cli = path.join(root, 'scripts', 'autopilot.mjs'); if (!fs.existsSync(cli)) throw new Error('Original Mode B CLI was not found.'); return { root, cli };
}
export async function runProcess(exe: string, args: string[], options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal }) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(exe, args, { cwd: options.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; const cap = 8 * 1024 * 1024;
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-cap);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk as Buffer); }); child.stderr.on('data', chunk => { stderr = append(stderr, chunk as Buffer); });
    let settled=false,timedOut=false;const killTree=()=>{if(!child.pid)return;if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()}};
    const stop=()=>killTree();options.signal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>{timedOut=true;killTree()},options.timeout??10*60_000);
    child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error)});child.once('close',code=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',stop);if(options.signal?.aborted)reject(new Error('Native command cancelled.'));else if(timedOut)reject(new Error('Native command timed out.'));else resolve({code:code??-1,stdout,stderr})});
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
export function assertMediaRelative(relative: string) {
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('Invalid media path.');
  if (!/^(?:assets\/(?:images|sfx)|output)\/[\p{L}\p{N}_.@+ -]+\.(?:png|jpe?g|webp|wav|mp3|m4a|aac|ogg|flac|mp4|webm|srt|vtt)$/iu.test(normalized)) throw new Error('Path is not an allowlisted project media file.');
  return normalized;
}
export const fileFetchUrl = (root: string, relative: string) => pathToFileURL(resolveProjectFile(root, relative)).toString();
export function inspectWav(file: string) {
  const data = fs.readFileSync(file); if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Nano output is not WAV.');
  const channels = data.readUInt16LE(22), rate = data.readUInt32LE(24), bits = data.readUInt16LE(34), format = data.readUInt16LE(20);
  if (format !== 1 || channels !== 1 || rate !== 24000 || bits !== 16) throw new Error('Expected WAV 24 kHz mono PCM16.');
  return { channels, sampleRate: rate, bits, sha256: sha(data), bytes: data.length };
}
export function safeImportedFile(root: string, source: string, kind: 'image' | 'sfx') {
  const projectRoot = assertLocalRoot(root); const real = fs.realpathSync(source); noExecutable(real);
  const allowed = kind === 'image' ? /\.(?:png|jpe?g)$/i : /\.(?:wav|mp3|m4a|aac|ogg|flac)$/i; if (!allowed.test(real) || !fs.statSync(real).isFile() || fs.statSync(real).size > 512 * 1024 * 1024) throw new Error(`Unsupported ${kind} file.`);
  const head=fs.readFileSync(real).subarray(0,12);if(kind==='image'&&!((head[0]===0x89&&head.toString('ascii',1,4)==='PNG')||(head[0]===0xff&&head[1]===0xd8&&head[2]===0xff)))throw new Error('Image extension does not match PNG/JPEG bytes.');if(kind==='sfx'&&!['RIFF','ID3','fLaC','OggS'].includes(head.toString('ascii',0,4))&&!(head[0]===0xff&&(head[1]&0xe0)===0xe0))throw new Error('Audio extension does not match supported audio bytes.');
  const dir = path.join(projectRoot, 'assets', kind === 'image' ? 'images' : 'sfx'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${sha(fs.readFileSync(real)).slice(0, 12)}-${path.basename(real)}`); if (!fs.existsSync(target)) fs.copyFileSync(real, target); return path.relative(projectRoot, target).replaceAll('\\', '/');
}
