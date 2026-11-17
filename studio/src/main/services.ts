import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type Stage = 'script' | 'native';
export type ExternalOperation = 'author' | 'review' | 'correct' | 'recheck' | 'media-review';
export type NativeCommand = 'doctor' | 'probe' | 'captions' | 'validate' | 'preview' | 'approve' | 'render';
export interface ProjectSummary { id: string; root: string; title: string; style: string; updatedAt: string; projectFile: string }
export interface StudioState {
  schema: 'mode-b-studio-state-v1'; project: ProjectSummary; brief: { topic: string; language: string; ratio: '9:16'; targetDuration?: number; audience?: string; purpose?: string };
  external: Partial<Record<Stage, { revision: number; artifact: unknown; importedAt: string }>>;
  tasks?: Partial<Record<Stage, { id: string; revision: number; inputSha256: string; sourceFingerprint?: string; promptSha256?: string; promptPath: string; status: 'FROZEN' | 'IMPORTED' | 'STALE'; createdAt: string; scope?: string; assetBaseline?: Array<{path:string;sha256:string}>; mediaBaseline?: Array<{path:string;sha256:string;rights:string;kind:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}> }>>;
  scriptCandidate?: { sections: Array<{ id: string; text: string }>; text: string; sha256: string; revision: number; importedAt: string; taskId:string; authoring?: Record<string, unknown> };
  approvedScript?: { sections: Array<{ id: string; text: string }>; text: string; sha256: string; revision: number; approvedAt: string; approvedBy?:'OWNER'|'AUTO'; approvalNote?:string; authoring?: Record<string, unknown> };
  lifecycle?: { tasks:Record<string,{id:string;stage:Stage;operation:ExternalOperation;revision:number;inputSha256:string;artifactSha256:string;promptPath:string;promptSha256:string;status:'FROZEN'|'IMPORTED'|'STALE';createdAt:string;editableIds?:string[];editablePaths?:string[];targetIds?:string[];findingIds?:string[];sourceReviewTaskId?:string;evidenceSha256?:string;originalTaskSha256?:string;sourceContextSha256?:string;authorityFingerprint?:string;mediaTransferAttested?:boolean;mediaKind?:'preview'|'film'|'voice'|'captions';mediaSha256s?:string[];mediaDuration?:number;mediaBaseline?:StudioState['media']}>; artifacts:Record<string,{taskId:string;stage:Stage;operation:ExternalOperation;artifactSha256:string;value:unknown;status:string;createdAt:string}> };
  voice?: { path: string; sha256: string; receipt?: unknown; generatedAt: string; duration?: number; stale?: boolean; profileId?: string; profileVersion?: number; referenceBinding?: string; origin?: 'NANO_GENERATED' | 'NANO_LONGFORM' | 'IMPORTED_WAV' };
  alignment?: { path: string; captionsPath: string; audioSha256: string; scriptSha256?: string; wordsSha256?: string; cuesSha256?: string; generatedAt: string; origin?: 'ELEVENLABS' | 'IMPORTED_WORDS'; words?: Array<{word:string;start:number;end:number;loss?:number}>; characters?: unknown; loss?: number; captionReview?: { revision:number; path:string; sha256:string; sourceSha256:string; note:string; approvedAt:string }; captionDraft?: { path:string; sha256:string; sourceSha256:string; boundaries:number[] } };
  approval?: { note: string; previewSha256: string; approvedAt: string };
  preview?: { path: string; sha256: string; reportPath: string; reportSha256: string; sourceFingerprint?: string; verifiedAt: string; reviewedAt?: string };
  render?: { path: string; sha256: string; reportPath: string; reportSha256: string; sourceFingerprint?: string; verifiedAt: string };
  nano?: { endpoint: string; profileId?: string };
  imports?: string[];
  media?: Array<{ path:string; sha256:string; kind:'image'|'sfx'|'ambience'; shotId?:string; layerId?:string; track?:'sfx'|'dialogue'|'ambience'|'music'; trackIndex?:number; rights:string; importedAt:string }>;
  nativeReadiness?: { sampleReady:boolean; fullReady:boolean; previewSeconds:number; checkedSeconds?:number; validationSha256?:string; sourceFingerprint?:string; missingOutsideScope?:string[]; reviewedDraft:boolean; verifiedAt:string };
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
  state.lifecycle ??= { tasks:{}, artifacts:{} };
  return state;
};
export const writeState = (root: string, state: StudioState) => atomicJson(statePath(assertLocalRoot(root)), state);
export const projectId = (root: string) => sha(fs.realpathSync(root).toLowerCase()).slice(0, 24);
// Update only the original native voice path after a WAV was accepted. Preserve
// B4 narrator identity, lead, tail, trim_start and all other native fields.
export function bindAcceptedNarration(root: string, relative: string) {
  const file=path.join(assertLocalRoot(root),'project.json');
  const project=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
  const voice=project.voice as Record<string,unknown>|undefined;
  if(!voice||typeof voice!=='object'||Array.isArray(voice))throw new Error('Native manifest voice is missing.');
  if(voice.path===relative)return;
  resolveProjectFile(root,relative);
  atomicJson(file,{...project,voice:{...voice,path:relative}});
}

export function inspectWavBuffer(data:Buffer){if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw new Error('Accepted audio is not WAV.');let offset=12,format=0,channels=0,rate=0,bits=0,dataBytes=-1;while(offset+8<=data.length){const id=data.toString('ascii',offset,offset+4),size=data.readUInt32LE(offset+4),start=offset+8;if(start+size>data.length)throw new Error('Truncated WAV chunk.');if(id==='fmt '){if(size<16)throw new Error('Invalid WAV fmt chunk.');format=data.readUInt16LE(start);channels=data.readUInt16LE(start+2);rate=data.readUInt32LE(start+4);bits=data.readUInt16LE(start+14)}if(id==='data')dataBytes=size;offset=start+size+(size%2)}if(offset!==data.length||format!==1||channels!==1||rate!==24000||bits!==16||dataBytes<2)throw new Error('Expected complete WAV 24 kHz mono PCM16.');const frames=dataBytes/2;if(!Number.isInteger(frames))throw new Error('Invalid WAV frame count.');return{channels,sampleRate:rate,bits,frames,duration:frames/rate,sha256:sha(data),bytes:data.length}}

export interface NarrationAcceptance {
  wav:Buffer;expectedScriptSha256:string;
  voice:Omit<NonNullable<StudioState['voice']>,'path'|'sha256'|'duration'|'generatedAt'|'stale'>;
  nano?:StudioState['nano'];longform?:StudioState['longform'];
  hooks?:{afterWav?:()=>void;afterManifest?:()=>void;afterState?:()=>void};
}
const restoreExact=(file:string,bytes:Buffer)=>{const temporary=file+'.'+randomUUID()+'.restore';fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,file)};
/** One rollback-safe publication boundary shared by short, long-form and imported narration. */
export function acceptNarration(root:string,input:NarrationAcceptance){
  const projectRoot=assertLocalRoot(root),projectFile=path.join(projectRoot,'project.json'),stateFile=statePath(projectRoot),target=resolveProjectFile(projectRoot,'assets/audio/narration.wav');
  const projectBytes=fs.readFileSync(projectFile),stateBytes=fs.readFileSync(stateFile),hadWav=fs.existsSync(target),wavBytes=hadWav?fs.readFileSync(target):null;
  const current=readState(projectRoot),info=inspectWavBuffer(input.wav);
  if(!current.approvedScript||current.approvedScript.sha256!==input.expectedScriptSha256||sha(current.approvedScript.text)!==current.approvedScript.sha256)throw new Error('Approved script changed before narration publication.');
  const project=strictJson(projectBytes.toString('utf8')) as Record<string,unknown>,voice=project.voice as Record<string,unknown>|undefined;
  if(!voice||typeof voice!=='object'||Array.isArray(voice))throw new Error('Native manifest voice is missing.');
  const staged=path.join(path.dirname(target),`.narration-${randomUUID()}.wav`),backup=path.join(path.dirname(target),`.narration-${randomUUID()}.bak`);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(staged,input.wav,{flag:'wx'});inspectWavBuffer(fs.readFileSync(staged));
  const next:StudioState=structuredClone(current);next.voice={path:'assets/audio/narration.wav',sha256:info.sha256,duration:info.duration,generatedAt:new Date().toISOString(),...input.voice,stale:false};
  if(input.nano)next.nano=input.nano;if(input.longform)next.longform=input.longform;next.alignment=undefined;if(next.tasks)next.tasks.native=undefined;next.nativeReadiness=undefined;next.preview=undefined;next.approval=undefined;next.render=undefined;
  let movedPrior=false,wavCommitted=false,manifestCommitted=false,stateCommitted=false;
  try{
    if(hadWav){fs.renameSync(target,backup);movedPrior=true}fs.renameSync(staged,target);wavCommitted=true;input.hooks?.afterWav?.();
    atomicJson(projectFile,{...project,voice:{...voice,path:'assets/audio/narration.wav'}});manifestCommitted=true;input.hooks?.afterManifest?.();
    writeState(projectRoot,next);stateCommitted=true;input.hooks?.afterState?.();
    if(movedPrior&&fs.existsSync(backup))fs.unlinkSync(backup);return next.voice;
  }catch(error){
    if(stateCommitted||!fs.existsSync(stateFile)||!fs.readFileSync(stateFile).equals(stateBytes))restoreExact(stateFile,stateBytes);
    if(manifestCommitted||!fs.existsSync(projectFile)||!fs.readFileSync(projectFile).equals(projectBytes))restoreExact(projectFile,projectBytes);
    if(wavCommitted){if(fs.existsSync(target))fs.unlinkSync(target);if(movedPrior&&fs.existsSync(backup))fs.renameSync(backup,target);else if(wavBytes)restoreExact(target,wavBytes)}
    throw error;
  }finally{if(fs.existsSync(staged))fs.unlinkSync(staged);if(fs.existsSync(backup)){if(!fs.existsSync(target)&&wavBytes)fs.renameSync(backup,target);else fs.unlinkSync(backup)}}
}

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
/** Electron's executable is not a Node CLI unless the subprocess opts into RunAsNode. */
export function subprocessEnvironment(exe: string, provided: NodeJS.ProcessEnv = process.env, hostExecutable = process.execPath, electronHost = Boolean((process.versions as NodeJS.ProcessVersions & {electron?:string}).electron)): NodeJS.ProcessEnv {
  const environment = { ...provided };
  if (electronHost && path.resolve(exe) === path.resolve(hostExecutable)) environment.ELECTRON_RUN_AS_NODE = '1';
  return environment;
}
export async function runProcess(exe: string, args: string[], options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal }) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(exe, args, { cwd: options.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', env: subprocessEnvironment(exe, options.env ?? process.env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; const cap = 8 * 1024 * 1024;
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-cap);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk as Buffer); }); child.stderr.on('data', chunk => { stderr = append(stderr, chunk as Buffer); });
    let settled=false,timedOut=false;const killTree=()=>{if(!child.pid)return;if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()}};
    const stop=()=>killTree();options.signal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>{timedOut=true;killTree()},options.timeout??10*60_000);
    child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error)});child.once('close',code=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',stop);if(options.signal?.aborted)reject(new Error('Native command cancelled.'));else if(timedOut)reject(new Error(`Native ${String(args[1] ?? args[0] ?? 'command')} timed out after ${options.timeout ?? 10*60_000} ms; stdout=${stdout.slice(-400) || '(empty)'}; stderr=${stderr.slice(-800) || '(empty)'}`));else resolve({code:code??-1,stdout,stderr})});
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
  // Inspect every existing ancestor, not only the final leaf: linked asset
  // directories/junctions must not cause imports or native reads to escape.
  let cursor=target;
  while(inside(projectRoot,cursor)&&cursor!==projectRoot){
    if(fs.existsSync(cursor)){
      const real=fs.realpathSync(cursor);
      if(fs.lstatSync(cursor).isSymbolicLink()||real.toLowerCase()!==cursor.toLowerCase())throw new Error('Symlink/junction media ancestor is not accepted.');
      if(!inside(projectRoot,real))throw new Error('Media escapes its project.');
    }
    cursor=path.dirname(cursor);
  }
  if(fs.existsSync(target))return fs.realpathSync(target);
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
  const projectRoot = assertLocalRoot(root); const real = fs.realpathSync(source);
  if(fs.lstatSync(source).isSymbolicLink()||real.toLowerCase()!==path.resolve(source).toLowerCase())throw new Error('Imported source cannot use a symlink or junction.');
  noExecutable(real);
  const allowed = kind === 'image' ? /\.(?:png|jpe?g)$/i : /\.(?:wav|mp3|m4a|aac|ogg|flac)$/i; if (!allowed.test(real) || !fs.statSync(real).isFile() || fs.statSync(real).size > 512 * 1024 * 1024) throw new Error(`Unsupported ${kind} file.`);
  const head=fs.readFileSync(real).subarray(0,12);if(kind==='image'&&!((head[0]===0x89&&head.toString('ascii',1,4)==='PNG')||(head[0]===0xff&&head[1]===0xd8&&head[2]===0xff)))throw new Error('Image extension does not match PNG/JPEG bytes.');if(kind==='sfx'&&!['RIFF','ID3','fLaC','OggS'].includes(head.toString('ascii',0,4))&&!(head[0]===0xff&&(head[1]&0xe0)===0xe0))throw new Error('Audio extension does not match supported audio bytes.');
  const dir = path.join(projectRoot, 'assets', kind === 'image' ? 'images' : 'sfx');
  resolveProjectFile(projectRoot,path.relative(projectRoot,dir));
  fs.mkdirSync(dir,{recursive:true});
  resolveProjectFile(projectRoot,path.relative(projectRoot,dir));
  const inputHash=sha(fs.readFileSync(real)),target=path.join(dir,inputHash.slice(0,12)+'-'+path.basename(real));
  resolveProjectFile(projectRoot,path.relative(projectRoot,target));
  if(fs.existsSync(target)){
    if(sha(fs.readFileSync(target))!==inputHash)throw new Error('Content-addressed asset filename collision or modified existing import.');
  }else fs.copyFileSync(real,target);
  if(sha(fs.readFileSync(target))!==inputHash)throw new Error('Imported asset changed while copying.');
  return path.relative(projectRoot,target).replaceAll('\\','/');
}
