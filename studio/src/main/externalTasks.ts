import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, nativeSkillRoot, readState, resolveProjectFile, runProcess, safeImportedFile, sha, strictJson, writeState, type Stage, type StudioState } from './services.js';
import { approvedCaptionCues } from './captionReview.js';
import { rejectNativeUnsafePaths, validateAuthoring } from './sourceCitations.js';

const STYLE: Record<string, string> = { B1: 'b1-minimal-handdrawn.md', B2: 'b2-colorful-handdrawn.md', B3: 'b3-television.md', B4: 'b4-survival-storytelling.md' };
const COMMON = ['SKILL.md', 'references/autopilot.md', 'references/autopilot-runtime.md', 'references/autopilot-production-qa.md', 'references/autopilot-sound-system.md'];
const exactKeys = (object: Record<string, unknown>, allowed: string[]) => { const extra = Object.keys(object).filter(key => !allowed.includes(key)); if (extra.length) throw new Error(`Unknown field: ${extra[0]}`); };
const readUtf8 = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const readJsonValue = (file: string) => (strictJson(`{"value":${readUtf8(file)}}`) as { value: unknown }).value;
const projectContext = (state: StudioState, root: string) => {
  const manifest = strictJson(readUtf8(path.join(root, 'project.json'))) as Record<string, unknown>;
  const assets = fs.existsSync(path.join(root, 'assets')) ? fs.readdirSync(path.join(root, 'assets'), { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => String(item.parentPath ? path.relative(root, path.join(item.parentPath, item.name)) : item.name).replaceAll('\\', '/')).sort() : [];
  const words = state.alignment ? readJsonValue(resolveProjectFile(root, state.alignment.path)) : null;
  const captionCues = state.alignment ? readJsonValue(resolveProjectFile(root, state.alignment.captionsPath)) : null;
  let approvedCues: unknown = null; try { approvedCues = approvedCaptionCues(root); } catch { /* Unreviewed captions must not masquerade as approved. */ }
  return { project_id: state.project.id, title: state.project.title, topic: state.brief.topic, audience: state.brief.audience ?? '', purpose: state.brief.purpose ?? '', language: state.brief.language, ratio: state.brief.ratio, target_duration_seconds: state.brief.targetDuration ?? null, style: state.project.style, approved_script: state.approvedScript ?? null, voice: state.voice ? { path: state.voice.path, sha256: state.voice.sha256, duration: state.voice.duration, stale: state.voice.stale, origin: state.voice.origin, profile_id: state.voice.profileId, profile_version: state.voice.profileVersion } : null, alignment: state.alignment ? { provenance: state.alignment.origin, audio_sha256: state.alignment.audioSha256, script_sha256: state.alignment.scriptSha256, words_sha256: state.alignment.wordsSha256, cues_sha256: state.alignment.cuesSha256, words, caption_cues: captionCues, approved_caption_cues: approvedCues, caption_review: state.alignment.captionReview ?? null } : null, media_ledger: state.media ?? [], assets, native_manifest: manifest };
};
const sourceBundle = (appPath: string, style: string) => {
  const { root } = nativeSkillRoot(appPath); const files = [...COMMON, `references/${STYLE[style]}`];
  if (style === 'B4') files.push('references/b4-opening-direction.md', 'references/b4-audio-direction.md');
  return files.map(relative => { const text = readUtf8(path.join(root, relative)); return { relative, sha256: sha(text), text }; });
};
export function sourceFingerprint(appPath: string, root: string, stage: Stage) {
  const state = readState(root), context = projectContext(state, root), sources = sourceBundle(appPath, state.project.style);
  // New unassigned media files never change creative authority. Existing assets are
  // separately snapshotted with their exact bytes at freeze and checked at both gates.
  const creative = Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'assets' && key !== 'media_ledger'));
  return sha(JSON.stringify({ stage, creative, sources: sources.map(item => [item.relative, item.sha256]) }));
}
const mediaSnapshot = (state: StudioState) => (state.media ?? []).map(row => ({
  path: row.path, sha256: row.sha256, rights: row.rights, kind: row.kind,
  ...(row.shotId ? {shotId:row.shotId} : {}), ...(row.layerId ? {layerId:row.layerId} : {}),
  ...(row.track ? {track:row.track} : {}), ...(row.trackIndex !== undefined ? {trackIndex:row.trackIndex} : {})
}));
const assetSnapshot = (root:string) => {
  const base=path.join(root,'assets');if(!fs.existsSync(base))return [] as Array<{path:string;sha256:string}>;
  return fs.readdirSync(base,{recursive:true,withFileTypes:true}).filter(item=>item.isFile()).map(item=>{
    const relative=path.relative(root,path.join(item.parentPath,item.name)).replaceAll('\\','/');
    return {path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative)))};
  }).sort((a,b)=>a.path.localeCompare(b.path));
};
function assertFrozenSource(appPath:string,root:string,stage:Stage,state:StudioState){
  const task=state.tasks?.[stage];
  if(!task||task.status!=='FROZEN')throw new Error('No current frozen task exists.');
  if(!task.sourceFingerprint||sourceFingerprint(appPath,root,stage)!==task.sourceFingerprint)throw new Error('frozen task creative source is stale; rebuild it before import.');
  if(!task.assetBaseline||!task.mediaBaseline)throw new Error('REBUILD_REQUIRED: old task lacks verifiable frozen media inventory.');
  const currentMedia=mediaSnapshot(state);
  for(const row of task.mediaBaseline)if(!currentMedia.some(item=>JSON.stringify(item)===JSON.stringify(row)))throw new Error('frozen task registered media changed; rebuild required.');
  for(const item of task.assetBaseline){
    const target=resolveProjectFile(root,item.path);
    if(!fs.existsSync(target)||sha(fs.readFileSync(target))!==item.sha256)throw new Error('frozen task existing asset bytes changed; rebuild required.');
  }
  return task;
}
export function freezeTask(appPath: string, root: string, stage: Stage, rebuild = false) {
  const state = readState(root); const context = projectContext(state, root); const sources = sourceBundle(appPath, state.project.style);
  if (stage === 'native' && (!state.approvedScript || !state.voice || state.voice.stale || !state.alignment)) throw new Error('Approved script, current verified narration and real word alignment are required before native authoring.');
  const inputSha256 = sourceFingerprint(appPath, root, stage); const prior = state.tasks?.[stage];
  if (!rebuild && prior && prior.inputSha256 === inputSha256 && fs.existsSync(resolveProjectFile(root, prior.promptPath))) return { ...prior, prompt: readUtf8(resolveProjectFile(root, prior.promptPath)) };
  if (prior) prior.status = 'STALE'; const revision = (prior?.revision ?? 0) + 1; const id = randomUUID();
  const response = stage === 'script'
    ? { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { schema: 'mode-b-script-v1', sections: [{ id: 'section-01', text: 'Exact approved wording' }], authoring: { creative_direction: {}, characters: [], style_decisions: {}, source_references: [], voice_intentions: {}, sound_intentions: {} } } }
    : { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { manifest: { version: 1, style: state.project.style, width: 1080, height: 1920, fps: 30, voice: { path: state.voice?.path }, captions: [], shots: [], sfx: [] }, shot_ledger: [], sound_script: [], asset_needs: [] } };
  const prompt = `# ORIGINAL MODE B MANUAL CHATGPT HANDOFF — ${stage === 'script' ? 'SCRIPT & CREATIVE DIRECTION' : 'VISUAL / SHOT / SOUND / NATIVE MANIFEST'}\n\nThis is a manual transport boundary in the original Mode B workflow. Do not invent a parallel engine. Do not call tools, return Markdown, executable code, URLs, or local absolute paths. Return exactly one JSON object matching the frozen envelope below.\n\n## ACTUAL PROJECT CONTEXT\n${JSON.stringify(context, null, 2)}\n\n## REQUIRED RESPONSE ENVELOPE\n${JSON.stringify(response, null, 2)}\n\nThe outer identity fields must be returned byte-for-value. For native authoring, payload.manifest is the original B1–B4 project.json v1 and must contain no Studio/task metadata. Ground every shot in the approved script and actual word/caption timing. List missing media honestly; never fabricate an existing asset path.\n\n## AUTHORITATIVE INSTALLED MODE B SOURCES\n${sources.map(item => `\n--- BEGIN ${item.relative} [sha256 ${item.sha256}] ---\n${item.text}\n--- END ${item.relative} ---`).join('\n')}\n`;
  const relative = `.studio/external/tasks/${stage}-${revision}-${id}.md`; const target = resolveProjectFile(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, prompt, { encoding: 'utf8', flag: 'wx' });
  state.tasks ??= {}; state.tasks[stage] = { id, revision, inputSha256, sourceFingerprint: inputSha256, assetBaseline: assetSnapshot(root), mediaBaseline: mediaSnapshot(state), promptSha256: sha(prompt), promptPath: relative, status: 'FROZEN', createdAt: new Date().toISOString() }; writeState(root, state); return { ...state.tasks[stage], prompt };
}

interface Envelope { schema: string; project_id: string; task_id: string; revision: number; input_sha256: string; stage: Stage; payload: Record<string, unknown> }
function validateEnvelope(state: StudioState, stage: Stage, value: unknown): Envelope {
  const object = value as Record<string, unknown>; exactKeys(object, ['schema','project_id','task_id','revision','input_sha256','stage','payload']); const task = state.tasks?.[stage];
  if (!task || task.status !== 'FROZEN') throw new Error('No current frozen task exists.');
  if (object.schema !== 'mode-b-external-result-v1' || object.project_id !== state.project.id || object.task_id !== task.id || object.revision !== task.revision || object.input_sha256 !== task.inputSha256 || object.stage !== stage) throw new Error('Project/task/revision/input binding mismatch.');
  if (!object.payload || typeof object.payload !== 'object' || Array.isArray(object.payload)) throw new Error('Invalid payload.'); return object as unknown as Envelope;
}
function validateScript(payload: Record<string, unknown>) { exactKeys(payload, ['schema','sections','authoring']); if (payload.schema !== 'mode-b-script-v1' || !Array.isArray(payload.sections) || !payload.sections.length || !payload.authoring || typeof payload.authoring !== 'object' || Array.isArray(payload.authoring)) throw new Error('Invalid script payload.'); const ids = new Set<string>(); const sections = payload.sections.map(item => { const value = item as Record<string, unknown>; exactKeys(value, ['id','text']); if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id) || typeof value.text !== 'string' || !value.text.trim()) throw new Error('Invalid or duplicate script section.'); ids.add(value.id); return { id: value.id, text: value.text.trim() }; }); return { schema: 'mode-b-script-v1', sections, authoring: validateAuthoring(payload.authoring) }; }
export interface MissingNativeReference {
  key:string; kind:'image'|'sfx'; path:string; shotId?:string; layerId?:string;
  track?:'sfx'|'dialogue'|'ambience'|'music'; trackIndex?:number; scopeStart:number;
}
const mediaRelative=(root:string,relative:string,kind:'image'|'sfx')=>{
  rejectNativeUnsafePaths({path:relative});
  const target=resolveProjectFile(root,relative);
  if(!relative.startsWith(kind==='image'?'assets/images/':'assets/sfx/'))return false;
  if(!fs.existsSync(target)||!fs.statSync(target).isFile())return false;
  const header=fs.readFileSync(target).subarray(0,12);
  return kind==='image'
    ? /\.(png|jpe?g)$/i.test(relative) && ((header[0]===0x89&&header.toString('ascii',1,4)==='PNG')||(header[0]===0xff&&header[1]===0xd8&&header[2]===0xff))
    : /\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(relative) && (['RIFF','ID3','fLaC','OggS'].includes(header.toString('ascii',0,4))||(header[0]===0xff&&(header[1]&0xe0)===0xe0));
};
function nativeRefs(manifest:Record<string,unknown>):MissingNativeReference[]{
  const refs:MissingNativeReference[]=[];
  const shots=manifest.shots as Array<Record<string,unknown>>;
  const visit=(layers:unknown[],shot:Record<string,unknown>,index:number)=>{
    for(const layerValue of layers){
      const layer=layerValue as Record<string,unknown>;
      if(layer?.type==='image'&&typeof layer.path==='string'&&!layer.path.startsWith('@b1/')){
        const shotId=typeof shot.id==='string'?shot.id:undefined,layerId=typeof layer.id==='string'?layer.id:undefined;
        refs.push({key:'image:'+index+':'+String(layerId??''),kind:'image',path:layer.path,shotId,layerId,scopeStart:Number(shot.start)+Number(layer.from??0)});
      }
      if(Array.isArray(layer?.children))visit(layer.children,shot,index);
    }
  };
  shots.forEach((shot,index)=>{if(Array.isArray(shot.layers))visit(shot.layers,shot,index)});
  for(const track of ['sfx','dialogue','ambience'] as const){
    const items=Array.isArray(manifest[track])?manifest[track] as Array<Record<string,unknown>>:[];
    items.forEach((item,index)=>{
      if(track==='sfx'&&item.kind!=='file')return;
      if(typeof item.path==='string')refs.push({key:'audio:'+track+':'+index,kind:'sfx',path:item.path,track,trackIndex:index,scopeStart:Number(track==='ambience'?item.start:item.time)});
    });
  }
  const music=manifest.music as Record<string,unknown>|undefined;
  if(music&&typeof music.path==='string')refs.push({key:'audio:music:0',kind:'sfx',path:music.path,track:'music',trackIndex:0,scopeStart:0});
  if(new Set(refs.map(item=>item.key)).size!==refs.length)throw new Error('Native shot/layer IDs must be unique for explicit media mapping.');
  return refs;
}
function exactNativeTarget(manifest:Record<string,unknown>,ref:MissingNativeReference):Record<string,unknown>{
  if(ref.kind==='image'){
    const shot=(manifest.shots as Array<Record<string,unknown>>).find(item=>item.id===ref.shotId);
    if(!shot||!ref.shotId||!ref.layerId||!Array.isArray(shot.layers))throw new Error('Mapping requires an existing explicit shot and image layer ID.');
    const matches:Record<string,unknown>[]=[];
    const walk=(layers:unknown[])=>{for(const value of layers){const node=value as Record<string,unknown>;if(node.id===ref.layerId)matches.push(node);if(Array.isArray(node.children))walk(node.children)}};
    walk(shot.layers);
    if(matches.length!==1||matches[0].type!=='image')throw new Error('Missing, duplicate or nonimage native mapping layer.');
    return matches[0];
  }
  if(!ref.track||ref.trackIndex===undefined)throw new Error('Audio mapping requires exact track/index.');
  const track=ref.track==='music'?[manifest.music]:(manifest[ref.track] as unknown[]);
  const target=Array.isArray(track)?track[ref.trackIndex] as Record<string,unknown>|undefined:undefined;
  if(!target||(ref.track==='sfx'&&target.kind!=='file'))throw new Error('Mapping must target original kind=file SFX or a legal audio track.');
  return target;
}
function verifiedMedia(root:string,state:StudioState,ref:MissingNativeReference,relative:string,rights?:string){
  if(!mediaRelative(root,relative,ref.kind))return false;
  const bytes=fs.readFileSync(resolveProjectFile(root,relative)),hash=sha(bytes);
  return (state.media??[]).some(row=>row.path===relative&&row.kind===ref.kind&&row.sha256===hash&&Boolean(row.rights.trim())&&(!rights||row.rights===rights)&&
    (ref.kind==='image'?row.shotId===ref.shotId&&row.layerId===ref.layerId:row.track===ref.track&&row.trackIndex===ref.trackIndex));
}
function collectMissing(root:string,state:StudioState,manifest:Record<string,unknown>){
  return nativeRefs(manifest).filter(ref=>!verifiedMedia(root,state,ref,ref.path));
}
function validateManifest(state: StudioState, root: string, payload: Record<string, unknown>) {
  exactKeys(payload, ['manifest','shot_ledger','sound_script','asset_needs']);
  const manifest = payload.manifest as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Native manifest missing.');
  const allowed = ['version','style','width','height','fps','voice','captions','shots','sfx','music','grid','captionSize','captionFont','font','television','ambience','dialogue','audio_cuts','opening','opening_audio_override','motion_ledger','caption_override'];
  exactKeys(manifest, allowed);rejectNativeUnsafePaths(manifest);
  rejectNativeUnsafePaths({shot_ledger:payload.shot_ledger,sound_script:payload.sound_script,asset_needs:payload.asset_needs});
  if(manifest.version!==1||manifest.style!==state.project.style||!['B1','B2','B3','B4'].includes(String(manifest.style)))throw new Error('Native version/style mismatch.');
  if(!Array.isArray(manifest.shots)||!manifest.shots.length||!Array.isArray(manifest.captions)||!manifest.voice||typeof manifest.voice!=='object')throw new Error('Native voice/captions/shots are required.');
  if(!state.voice||state.voice.stale||(manifest.voice as Record<string,unknown>).path!==state.voice.path||!fs.existsSync(resolveProjectFile(root,state.voice.path))||sha(fs.readFileSync(resolveProjectFile(root,state.voice.path)))!==state.voice.sha256)throw new Error('Manifest voice does not bind actual current accepted WAV bytes.');
  const approved=approvedCaptionCues(root);
  if(JSON.stringify(manifest.captions)!==JSON.stringify(approved))throw new Error('Native captions must exactly match current owner-approved word-grounded revision; rebuild task after approved regroup.');
  const duration=state.voice.duration??0;let captionEnd=0;
  for(const item of manifest.captions as unknown[]){const cue=item as Record<string,unknown>,start=Number(cue.start),end=Number(cue.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<captionEnd||end<=start||end>duration+.05||typeof cue.text!=='string'||!cue.text.trim())throw new Error('Native captions must be finite, monotone and within accepted narration.');captionEnd=end}
  let shotEnd=0;for(const item of manifest.shots as unknown[]){const shot=item as Record<string,unknown>,start=Number(shot.start),end=Number(shot.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<shotEnd||end<=start||end>duration+.05)throw new Error('Native shots must be finite, non-overlapping and within accepted narration.');shotEnd=end}
  return {manifest,shotLedger:payload.shot_ledger??[],soundScript:payload.sound_script??[],assetNeeds:payload.asset_needs??[],missing:collectMissing(root,state,manifest)};
}
export function stageImport(appPath: string, root: string, stage: Stage, text: string) {
  const state = readState(root), task = state.tasks?.[stage]; if (!task || sourceFingerprint(appPath, root, stage) !== task.sourceFingerprint) { if (task) { task.status = 'STALE'; writeState(root, state); } throw new Error('frozen task source is stale; rebuild it before import.'); } const envelope = validateEnvelope(state, stage, strictJson(text)); const payload = stage === 'script' ? validateScript(envelope.payload) : validateManifest(state, root, envelope.payload);
  const pending = { schema: 'mode-b-pending-import-v1', token: randomUUID(), stage, taskId: envelope.task_id, revision: envelope.revision, inputSha256: envelope.input_sha256, payload, before: stage === 'script' ? state.approvedScript ?? null : strictJson(readUtf8(path.join(root, 'project.json'))), createdAt: new Date().toISOString() };
  atomicJson(path.join(root, '.studio', 'external', 'pending.json'), pending); return { token: pending.token, stage, before: pending.before, after: payload, changes: JSON.stringify(pending.before) === JSON.stringify(payload) ? 0 : 1, status: stage === 'native' && (payload as {missing:string[]}).missing.length ? 'WAITING_FOR_MEDIA' : 'STAGED' };
}
export async function confirmImport(appPath: string, root: string, token: string) {
  const file = path.join(root, '.studio', 'external', 'pending.json'); if (!fs.existsSync(file)) throw new Error('No staged import exists.'); const pending = strictJson(readUtf8(file)) as Record<string, unknown>; if (pending.token !== token) throw new Error('Import confirmation token mismatch.');
  const state = readState(root); const stage = pending.stage as Stage; const task = state.tasks?.[stage]; if (!task || task.id !== pending.taskId || task.revision !== pending.revision || task.status !== 'FROZEN' || sourceFingerprint(appPath, root, stage) !== task.sourceFingerprint) { if (task) { task.status='STALE'; writeState(root,state); } throw new Error('frozen task import is stale or replayed.'); }
  const revision = (state.external[stage]?.revision ?? 0) + 1; atomicJson(path.join(root, '.studio', 'revisions', `${stage}-${revision}.json`), pending.payload);
  if (stage === 'script') { const script = pending.payload as {sections:Array<{id:string;text:string}>;authoring:Record<string,unknown>}; const text = script.sections.map(item => item.text).join('\n\n'); const changed = state.approvedScript?.sha256 !== sha(text); state.approvedScript = { sections: script.sections, text, sha256: sha(text), revision, approvedAt: new Date().toISOString(), authoring: script.authoring }; if (changed) { if (state.voice) state.voice.stale = true; state.alignment = undefined; state.preview = undefined; state.approval = undefined; state.render = undefined; } }
  else { const value = pending.payload as {manifest:Record<string,unknown>;shotLedger:unknown;soundScript:unknown;assetNeeds:unknown;missing:string[]}; if(value.missing.length)throw new Error(`Native import still references missing media: ${value.missing.join(', ')}`);const candidate = path.join(root, `.project-candidate-${revision}.json`); atomicJson(candidate, value.manifest); try{const { cli } = nativeSkillRoot(appPath); const result = await runProcess(process.execPath, [cli, 'validate', candidate], { cwd: path.dirname(cli) }); if (result.code !== 0) throw new Error(result.stderr || 'Original native validation rejected the candidate.'); const current = path.join(root, 'project.json'); fs.copyFileSync(current, path.join(root, '.studio', 'revisions', `project-before-${revision}.json`)); const temp = `${current}.${process.pid}.tmp`; fs.copyFileSync(candidate, temp); fs.renameSync(temp, current); atomicJson(path.join(root,'.studio','revisions',`native-authoring-${revision}.json`),{shot_ledger:value.shotLedger,sound_script:value.soundScript,asset_needs:value.assetNeeds});}finally{if(fs.existsSync(candidate))fs.unlinkSync(candidate)} state.preview = undefined; state.approval = undefined; state.render = undefined; }
  state.external[stage] = { revision, artifact: pending.payload, importedAt: new Date().toISOString() }; task.status = 'IMPORTED'; fs.unlinkSync(file); writeState(root, state); return state;
}
