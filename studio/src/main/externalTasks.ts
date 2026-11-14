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
  const prompt = `# ORIGINAL MODE B MANUAL CHATGPT HANDOFF — ${stage === 'script' ? 'SCRIPT & CREATIVE DIRECTION' : 'VISUAL / SHOT / SOUND / NATIVE MANIFEST'}\n\nThis is a manual transport boundary in the original Mode B workflow. Do not invent a parallel engine. Do not call tools, return Markdown, executable code or local absolute paths. Public HTTP(S) research citation URLs are permitted ONLY inside script payload.authoring.source_references as inert metadata; never use remote URLs as native assets or executable paths. Return exactly one JSON object matching the frozen envelope below.\n\n## ACTUAL PROJECT CONTEXT\n${JSON.stringify(context, null, 2)}\n\n## REQUIRED RESPONSE ENVELOPE\n${JSON.stringify(response, null, 2)}\n\nThe outer identity fields must be returned byte-for-value. For native authoring, payload.manifest is the original B1–B4 project.json v1 and must contain no Studio/task metadata. Ground every shot in the approved script and actual word/caption timing. List missing media honestly; never fabricate an existing asset path.\n\n## AUTHORITATIVE INSTALLED MODE B SOURCES\n${sources.map(item => `\n--- BEGIN ${item.relative} [sha256 ${item.sha256}] ---\n${item.text}\n--- END ${item.relative} ---`).join('\n')}\n`;
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
  key:string; kind:'image'|'sfx'; path:string; shotId?:string; shotIndex?:number; layerId?:string;
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
  const visit=(layers:unknown[],shot:Record<string,unknown>,index:number,parentFrom=0)=>{
    for(const layerValue of layers){
      const layer=layerValue as Record<string,unknown>;
      if(layer?.type==='image'&&typeof layer.path==='string'&&!layer.path.startsWith('@b1/')){
        const shotId=typeof shot.id==='string'?shot.id:undefined,layerId=typeof layer.id==='string'?layer.id:undefined;
        refs.push({key:'image:'+index+':'+String(layerId??''),kind:'image',path:layer.path,shotId,shotIndex:index,layerId,scopeStart:Number(shot.start)+Math.max(parentFrom,Number(layer.from??0))});
      }
      if(Array.isArray(layer?.children))visit(layer.children,shot,index,Math.max(parentFrom,Number(layer.from??0)));
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
    const shot=(manifest.shots as Array<Record<string,unknown>>)[ref.shotIndex??-1];
    if(!shot||shot.id!==ref.shotId||!ref.shotId||!ref.layerId||!Array.isArray(shot.layers))throw new Error('Mapping requires an existing explicit shot and image layer ID.');
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
interface PendingImport {
  schema:'mode-b-pending-import-v2';token:string;projectId:string;stage:Stage;
  taskId:string;revision:number;inputSha256:string;responseSha256:string;responsePath:string;
  payloadSha256:string;payload:Record<string,unknown>;before:unknown;
  references:MissingNativeReference[];fulfillments:Record<string,{relative:string;sha256:string;rights:string;kind:'image'|'sfx'}>;
  createdAt:string;
}
const pendingPath=(root:string)=>path.join(root,'.studio','external','pending.json');
const readPending=(root:string):PendingImport=>{
  const file=pendingPath(root);if(!fs.existsSync(file))throw new Error('No staged import exists.');
  const pending=strictJson(readUtf8(file)) as unknown as PendingImport;
  if(pending.schema!=='mode-b-pending-import-v2'||!pending.projectId||!pending.payloadSha256||!pending.responsePath||!Array.isArray(pending.references)||!pending.fulfillments)throw new Error('REBUILD_REQUIRED: pending record has no verifiable source/asset bindings.');
  const frozenResponse=resolveProjectFile(root,pending.responsePath);
  if(!fs.existsSync(frozenResponse)||sha(fs.readFileSync(frozenResponse))!==pending.responseSha256)throw new Error('Frozen ChatGPT response bytes are missing or modified.');
  if(pending.payloadSha256!==sha(JSON.stringify(pending.payload)))throw new Error('Pending imported payload was modified.');
  return pending;
};
const pendingResult=(root:string,pending:PendingImport)=>{
  const state=readState(root);
  if(pending.stage==='script')return{token:pending.token,stage:pending.stage,before:pending.before,after:pending.payload,changes:1,status:'STAGED',missing:[]};
  const resolved=resolvePendingCandidate(root,state,pending);
  return{token:pending.token,stage:pending.stage,before:pending.before,after:resolved.manifest,changes:1,status:resolved.missing.length?'WAITING_FOR_MEDIA':'STAGED',missing:resolved.missing,fulfillments:pending.fulfillments};
};
function resolvePendingCandidate(root:string,state:StudioState,pending:PendingImport){
  const value=pending.payload as {manifest:Record<string,unknown>;shotLedger:unknown;soundScript:unknown;assetNeeds:unknown;missing:MissingNativeReference[]};
  const manifest=JSON.parse(JSON.stringify(value.manifest)) as Record<string,unknown>;
  for(const [key,binding] of Object.entries(pending.fulfillments)){
    const original=pending.references.find(ref=>ref.key===key);
    if(!original)throw new Error('Media fulfillment has no frozen missing-native target.');
    if(!verifiedMedia(root,state,original,binding.relative,binding.rights)||!fs.existsSync(resolveProjectFile(root,binding.relative))||sha(fs.readFileSync(resolveProjectFile(root,binding.relative)))!==binding.sha256||binding.kind!==original.kind)throw new Error('Approved media binding/file/hash/rights is stale.');
    const target=exactNativeTarget(manifest,original);
    if(target.path!==original.path)throw new Error('Frozen native target path was changed without authorization.');
    target.path=binding.relative;
  }
  return {manifest,missing:collectMissing(root,state,manifest),shotLedger:value.shotLedger,soundScript:value.soundScript,assetNeeds:value.assetNeeds};
}
function assertTaskCurrent(appPath:string,root:string,stage:Stage,state:StudioState){
  try{return assertFrozenSource(appPath,root,stage,state)}catch(error){
    const task=state.tasks?.[stage];
    if(task&&task.status==='FROZEN'&&!String((error as Error).message).startsWith('No current')){task.status='STALE';writeState(root,state);}
    throw error;
  }
}
export function stageImport(appPath: string, root: string, stage: Stage, text: string) {
  const state=readState(root),task=assertTaskCurrent(appPath,root,stage,state);
  const envelope=validateEnvelope(state,stage,strictJson(text));
  const payload=stage==='script'?validateScript(envelope.payload):validateManifest(state,root,envelope.payload);
  const responseSha256=sha(text);
  if(fs.existsSync(pendingPath(root))){
    try{
      const prior=readPending(root);
      if(prior.projectId===state.project.id&&prior.taskId===task.id&&prior.revision===task.revision&&prior.stage===stage&&prior.responseSha256===responseSha256)return pendingResult(root,prior);
    }catch{ /* Nonmatching/corrupted pending must never be reused. */ }
  }
  const responsePath='.studio/external/responses/'+stage+'-'+task.id+'-'+task.revision+'-'+responseSha256+'.json';
  const responseFile=resolveProjectFile(root,responsePath);fs.mkdirSync(path.dirname(responseFile),{recursive:true});
  if(fs.existsSync(responseFile)){if(sha(fs.readFileSync(responseFile))!==responseSha256)throw new Error('Original frozen response file changed.');}
  else fs.writeFileSync(responseFile,text,{encoding:'utf8',flag:'wx'});
  const pending:PendingImport={schema:'mode-b-pending-import-v2',token:randomUUID(),projectId:state.project.id,stage,taskId:task.id,
    revision:task.revision,inputSha256:task.inputSha256,responseSha256,responsePath,payloadSha256:sha(JSON.stringify(payload)),payload,
    before:stage==='script'?state.approvedScript??null:strictJson(readUtf8(path.join(root,'project.json'))),
    references:stage==='native'?(payload as ReturnType<typeof validateManifest>).missing:[],fulfillments:{},createdAt:new Date().toISOString()};
  atomicJson(pendingPath(root),pending);
  return pendingResult(root,pending);
}
export function getPendingMedia(appPath:string,root:string) {
  const pending=readPending(root);if(pending.stage!=='native')throw new Error('No pending native media request.');
  const state=readState(root);if(pending.projectId!==state.project.id||pending.taskId!==assertTaskCurrent(appPath,root,'native',state).id)throw new Error('Pending native media task is stale.');
  return pendingResult(root,pending);
}
export function importMediaFile(root:string,source:string,kind:'image'|'sfx',rights:string) {
  if(!['image','sfx'].includes(kind)||typeof rights!=='string'||!rights.trim())throw new Error('Media kind and owner rights are required.');
  const relative=safeImportedFile(root,source,kind),target=resolveProjectFile(root,relative),hash=sha(fs.readFileSync(target)),state=readState(root);
  state.imports=[...new Set([...(state.imports??[]),relative])];
  const existing=state.media?.find(item=>item.path===relative&&item.sha256===hash&&item.kind===kind&&!item.shotId&&!item.track);
  const entry=existing??{path:relative,sha256:hash,kind,rights:rights.trim(),importedAt:new Date().toISOString()};
  if(!existing)state.media=[...(state.media??[]),entry];
  // File import alone never claims native mapping and never corrupts a frozen task.
  writeState(root,state);return{...entry,status:'IMPORTED_UNASSIGNED'};
}
export function fulfillMedia(appPath:string,root:string,token:string,key:string,relative:string,rights:string){
  const pending=readPending(root),state=readState(root);
  if(pending.stage!=='native'||pending.projectId!==state.project.id||pending.token!==token)throw new Error('Project/pending token mismatch.');
  if(pending.taskId!==assertTaskCurrent(appPath,root,'native',state).id||pending.revision!==state.tasks?.native?.revision)throw new Error('Frozen task binding mismatch.');
  const ref=pending.references.find(item=>item.key===key);
  if(!ref)throw new Error('Only an exact frozen missing native reference may be fulfilled.');
  exactNativeTarget((pending.payload as {manifest:Record<string,unknown>}).manifest,ref);
  if(typeof rights!=='string'||!rights.trim()||!state.imports?.includes(relative)||!mediaRelative(root,relative,ref.kind))throw new Error('Owner-imported, rights-cleared local asset required.');
  const hash=sha(fs.readFileSync(resolveProjectFile(root,relative)));
  const original=state.media?.find(item=>item.path===relative&&item.sha256===hash&&item.kind===ref.kind&&item.rights===rights.trim());
  if(!original)throw new Error('Imported file SHA, rights or media kind mismatch.');
  const binding={relative,sha256:hash,rights:rights.trim(),kind:ref.kind};
  const previous=pending.fulfillments[key];
  if(previous){if(JSON.stringify(previous)!==JSON.stringify(binding))throw new Error('A frozen target cannot be silently remapped; rebuild/review the task.');return pendingResult(root,pending);}
  const mapped={...original,...(ref.kind==='image'?{shotId:ref.shotId,layerId:ref.layerId}:{track:ref.track,trackIndex:ref.trackIndex})};
  state.media=[...(state.media??[]).filter(item=>!(item.path===relative&&item.shotId===ref.shotId&&item.layerId===ref.layerId&&item.track===ref.track&&item.trackIndex===ref.trackIndex)),mapped];
  pending.fulfillments[key]=binding;
  atomicJson(pendingPath(root),pending);
  writeState(root,state);
  return pendingResult(root,pending);
}
type Validator=(exe:string,args:string[],options:{cwd:string})=>Promise<{code:number;stdout:string;stderr:string}>;
export interface ConfirmOptions { previewSeconds?:number; allowSampleDraft?:boolean; validator?:Validator }
const checkedSeconds=(result:{code:number;stdout:string;stderr:string},label:string)=>{
  if(result.code!==0)throw new Error(result.stderr.trim()||result.stdout.trim()||'Original native '+label+' validator failed.');
  let proof:Record<string,unknown>;
  try{proof=JSON.parse(result.stdout.trim()) as Record<string,unknown>}catch{throw new Error('Original native '+label+' validator produced no verifiable result.');}
  if(proof.valid!==true||typeof proof.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(proof.fingerprint)||!Number.isFinite(proof.checked_seconds))throw new Error('Invalid original native '+label+' validation proof.');
  return {fingerprint:proof.fingerprint,checkedSeconds:Number(proof.checked_seconds)};
};
const validateSeconds=(value:number|undefined)=>{
  if(value===undefined)return 20;
  if(typeof value!=='number'||!Number.isFinite(value)||value<1||value>60)throw new Error('Owner sample preview length must be 1..60 seconds.');
  return value;
};
async function confirmImportOnce(appPath: string, root: string, token: string, options: ConfirmOptions={}) {
  const pending=readPending(root);if(pending.token!==token)throw new Error('Import confirmation token mismatch.');
  const state=readState(root),stage=pending.stage,task=assertTaskCurrent(appPath,root,stage,state);
  if(state.project.id!==pending.projectId||task.id!==pending.taskId||task.revision!==pending.revision||task.inputSha256!==pending.inputSha256)throw new Error('Frozen task/project identity mismatch.');
  const revision=(state.external[stage]?.revision??0)+1;
  if(stage==='script'){
    const script=pending.payload as {sections:Array<{id:string;text:string}>;authoring:Record<string,unknown>};
    const approvedText=script.sections.map(item=>item.text).join('\n\n'),changed=state.approvedScript?.sha256!==sha(approvedText),creativeChanged=JSON.stringify(state.approvedScript?.authoring??null)!==JSON.stringify(script.authoring);
    state.approvedScript={sections:script.sections,text:approvedText,sha256:sha(approvedText),revision,approvedAt:new Date().toISOString(),authoring:script.authoring};
    if(changed){if(state.voice)state.voice.stale=true;state.alignment=undefined;}
    if(changed||creativeChanged){if(state.tasks?.native)state.tasks.native.status='STALE';state.nativeReadiness=undefined;state.preview=undefined;state.approval=undefined;state.render=undefined;}
    state.external.script={revision,artifact:pending.payload,importedAt:new Date().toISOString()};
    task.status='IMPORTED';
    const revisionFile=path.join(root,'.studio','revisions','script-'+revision+'.json');
    atomicJson(revisionFile,pending.payload);
    writeState(root,state);
    fs.unlinkSync(pendingPath(root));return state;
  }
  const seconds=validateSeconds(options.previewSeconds);
  const resolved=resolvePendingCandidate(root,state,pending);
  const missingInside=resolved.missing.filter(ref=>ref.scopeStart<seconds);
  if(missingInside.length)throw new Error('Missing media inside the selected sample: '+missingInside.map(item=>item.key).join(', '));
  // The unmodified original native CLI decides whether the candidate is valid.
  const candidate=path.join(root,'.project-candidate-'+randomUUID()+'.json');
  const current=path.join(root,'project.json'),beforeBytes=fs.readFileSync(current),stateFile=path.join(root,'.studio','state.json'),beforeStateBytes=fs.readFileSync(stateFile),runner=options.validator??runProcess;
  let promoted=false;let tmp='';
  atomicJson(candidate,resolved.manifest);
  try{
    const {cli}=nativeSkillRoot(appPath),cwd=path.dirname(cli);
    const sample=checkedSeconds(await runner(process.execPath,[cli,'validate',candidate,'--seconds',String(seconds)],{cwd}),'scoped sample');
    let full:ReturnType<typeof checkedSeconds>|null=null;
    if(!resolved.missing.length){
      const result=await runner(process.execPath,[cli,'validate',candidate],{cwd});
      if(result.code===0)full=checkedSeconds(result,'full-film');
    }
    if(!full&&!options.allowSampleDraft)throw new Error('Only SAMPLE_READY. Explicitly approve incomplete draft promotion; full-film is not ready.');
    // CLI validation is async: do not promote a frozen candidate whose project,
    // approved script, WAV, words, caption revision or approved media changed
    // while the native process was running.
    const fresh=readState(root);
    assertFrozenSource(appPath,root,'native',fresh);
    if(fresh.project.id!==pending.projectId||fresh.tasks?.native?.id!==pending.taskId||fresh.tasks.native.revision!==pending.revision)throw new Error('Native task was replaced during validation.');
    const diskPending=readPending(root);
    if(diskPending.token!==pending.token||diskPending.payloadSha256!==pending.payloadSha256||JSON.stringify(diskPending.fulfillments)!==JSON.stringify(pending.fulfillments))throw new Error('Native candidate fulfillment changed during validation.');
    const again=resolvePendingCandidate(root,fresh,diskPending);
    if(JSON.stringify(again.manifest)!==JSON.stringify(resolved.manifest)||JSON.stringify(again.missing)!==JSON.stringify(resolved.missing))throw new Error('Native candidate or missing-media ledger changed during validation.');
    if(!fs.readFileSync(current).equals(beforeBytes))throw new Error('Last-good native manifest changed during validation; staged confirmation is stale.');
    const readiness={sampleReady:true,fullReady:Boolean(full),previewSeconds:seconds,checkedSeconds:sample.checkedSeconds,
      validationSha256:sample.fingerprint,missingOutsideScope:resolved.missing.map(item=>item.key),
      reviewedDraft:!full&&options.allowSampleDraft===true,verifiedAt:new Date().toISOString()};
    const backup=path.join(root,'.studio','revisions','project-before-'+revision+'.json');
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(current,backup);
    tmp=current+'.'+randomUUID()+'.tmp';fs.copyFileSync(candidate,tmp);fs.renameSync(tmp,current);promoted=true;
    state.external.native={revision,artifact:{...resolved,missing:resolved.missing},importedAt:new Date().toISOString()};
    state.nativeReadiness=readiness;state.preview=undefined;state.approval=undefined;state.render=undefined;task.status='IMPORTED';
    writeState(root,state);
    atomicJson(path.join(root,'.studio','revisions','native-'+revision+'.json'),resolved.manifest);
    atomicJson(path.join(root,'.studio','revisions','native-authoring-'+revision+'.json'),{shot_ledger:resolved.shotLedger,sound_script:resolved.soundScript,asset_needs:resolved.assetNeeds,fulfillments:pending.fulfillments,missing:resolved.missing});
    fs.unlinkSync(pendingPath(root));return state;
  }catch(error){
    if(promoted){
      const restore=current+'.'+randomUUID()+'.restore';fs.writeFileSync(restore,beforeBytes);fs.renameSync(restore,current);
      const stateRestore=stateFile+'.'+randomUUID()+'.restore';fs.writeFileSync(stateRestore,beforeStateBytes);fs.renameSync(stateRestore,stateFile);
    }
    throw error;
  }finally{
    if(fs.existsSync(candidate))fs.unlinkSync(candidate);
    if(tmp&&fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
}

const activeConfirmations=new Set<string>();
/** Serialized, per-project confirmation. An interrupted run preserves the frozen pending journal. */
export async function confirmImport(appPath:string,root:string,token:string,options:ConfirmOptions={}) {
  const key=path.resolve(root);
  if(activeConfirmations.has(key))throw new Error('Another project import is already being confirmed; retry after it completes.');
  activeConfirmations.add(key);
  try{return await confirmImportOnce(appPath,root,token,options);}
  finally{activeConfirmations.delete(key);}
}
