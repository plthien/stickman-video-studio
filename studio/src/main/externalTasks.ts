import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, nativeSkillRoot, readState, resolveProjectFile, runProcess, safeImportedFile, sha, strictJson, writeState, type Stage, type StudioState } from './services.js';
import { approvedCaptionCues, nativeVoiceTiming } from './captionReview.js';
import { rejectNativeUnsafePaths, validateAuthoring } from './sourceCitations.js';
import { compileAuthority } from './externalAuthority.js';

export function externalOutputFilename(
  stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review',
  revision:number,taskId:string,mediaKind?:'preview'|'film'|'voice'|'captions'
):string{
  const shortId=taskId.replace(/-/g,'').slice(0,8).toLowerCase();
  if(!Number.isInteger(revision)||revision<1||!/^[a-f0-9]{8}$/.test(shortId))
    throw new Error('A frozen positive task revision and UUID-derived short ID are required for JSON file delivery.');
  if(operation==='media-review'&&!mediaKind)throw new Error('Media Review JSON filename requires the frozen media kind.');
  const kind=operation==='media-review'?'_'+mediaKind:'';
  return 'mode_b_'+stage+'_'+operation.replace(/-/g,'_')+kind+'_r'+revision+'_'+shortId+'.json';
}
export function externalJsonFileDelivery(
  stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review',
  revision:number,taskId:string,mediaKind?:'preview'|'film'|'voice'|'captions'
):string{
  const filename=externalOutputFilename(stage,operation,revision,taskId,mediaKind);
  return [
    '## JSON FILE DELIVERY — REQUIRED',
    'Create exactly one real, downloadable UTF-8 .json file using the required filename: '+filename+'.',
    'The file must contain the COMPLETE final frozen response envelope as one valid JSON object.',
    'Preserve the frozen project_id, task_id, revision, input_sha256 and stage, plus operation where applicable. Do not alter or add envelope fields.',
    'Inside the file, do not include Markdown fences, explanations, review summaries, comments or surrounding text.',
    'Do not substitute an inline JSON code block for the requested file when file-generation capability is available.',
    'Make the JSON file available as an actual attachment/download artifact.',
    'If this environment cannot create or attach a real file, state that limitation explicitly; never claim creation or fabricate a download link or file path.',
    'This output instruction does not authorize local Studio/Core CLI commands, inspection of unavailable local files/media, paid provider calls or claims of performed audiovisual checks.'
  ].join('\n')+'\n';
}

const exactKeys = (object: Record<string, unknown>, allowed: string[]) => { const extra = Object.keys(object).filter(key => !allowed.includes(key)); if (extra.length) throw new Error(`Unknown field: ${extra[0]}`); };
const readUtf8 = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const readJsonValue = (file: string) => (strictJson(`{"value":${readUtf8(file)}}`) as { value: unknown }).value;
const projectContext = (state: StudioState, root: string, stage:Stage) => {
  const manifest = strictJson(readUtf8(path.join(root, 'project.json'))) as Record<string, unknown>;
  const assets = fs.existsSync(path.join(root, 'assets')) ? fs.readdirSync(path.join(root, 'assets'), { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => String(item.parentPath ? path.relative(root, path.join(item.parentPath, item.name)) : item.name).replaceAll('\\', '/')).sort() : [];
  let words:unknown=null,captionCues:unknown=null,approvedCues:unknown=null;
  if(stage==='native'){
    if(!state.approvedScript||sha(state.approvedScript.text)!==state.approvedScript.sha256)throw new Error('Native task BLOCKED: current approved script evidence is missing or corrupt.');
    if(!state.voice||state.voice.stale)throw new Error('Native task BLOCKED: current accepted narration is missing or stale.');
    const audio=fs.readFileSync(resolveProjectFile(root,state.voice.path));if(sha(audio)!==state.voice.sha256)throw new Error('Native task BLOCKED: accepted narration bytes changed.');
    if(!state.alignment)throw new Error('Native task BLOCKED: real word alignment is missing.');
    words=readJsonValue(resolveProjectFile(root,state.alignment.path));captionCues=readJsonValue(resolveProjectFile(root,state.alignment.captionsPath));
    approvedCues=approvedCaptionCues(root);
  }
  const common={project_id:state.project.id,title:state.project.title,topic:state.brief.topic,audience:state.brief.audience??'',purpose:state.brief.purpose??'',language:state.brief.language,ratio:state.brief.ratio,target_duration_seconds:state.brief.targetDuration??null,style:state.project.style};
  if(stage==='script')return{...common,approved_script:state.approvedScript??null};
  return { ...common, approved_script: state.approvedScript ?? null, voice: state.voice ? { path: state.voice.path, sha256: state.voice.sha256, duration: state.voice.duration, stale: state.voice.stale, origin: state.voice.origin, profile_id: state.voice.profileId, profile_version: state.voice.profileVersion } : null, alignment: state.alignment ? { provenance: state.alignment.origin, audio_sha256: state.alignment.audioSha256, script_sha256: state.alignment.scriptSha256, words_sha256: state.alignment.wordsSha256, cues_sha256: state.alignment.cuesSha256, words, caption_cues: captionCues, approved_caption_cues: approvedCues, caption_review: state.alignment.captionReview ?? null } : null, media_ledger: state.media ?? [], assets, native_manifest: manifest };
};
/** Native prompt projection v1: keep sourceFingerprint() on full frozen evidence.
 * This is an output-size change only; never rewrite the accepted alignment file. */
function nativePromptProjection(context:ReturnType<typeof projectContext>){
  const source=context as unknown as Record<string,unknown> & {
    alignment?:{words?:unknown;caption_cues?:unknown;approved_caption_cues?:unknown;
      provenance?:unknown;words_sha256?:unknown;cues_sha256?:unknown;
      audio_sha256?:unknown;script_sha256?:unknown};
    native_manifest?:Record<string,unknown>;
    media_ledger?:Array<{path:string;sha256:string;rights:string;kind:string}>;
  };
  const raw=source.alignment?.words;
  const ordered=raw&&typeof raw==='object'&&!Array.isArray(raw)?
    (raw as {words?:unknown}).words:null;
  if(!Array.isArray(ordered)||!ordered.length||
    ordered.some(row=>!row||typeof row.word!=='string'||typeof row.start!=='number'||typeof row.end!=='number'))
    throw new Error('NATIVE_AUTHOR_WORD_PROJECTION_INVALID: source word evidence is missing.');
  const words=ordered.map(row=>({word:row.word as string,start:row.start as number,end:row.end as number}));
  const {assets:unusedAssets,media_ledger:unusedLedger,...common}=source;
  void unusedAssets;void unusedLedger;
  return {...common,
    prompt_projection_version:'native-author-word-only-v1',
    alignment:{
      provenance:source.alignment?.provenance,
      audio_sha256:source.alignment?.audio_sha256,script_sha256:source.alignment?.script_sha256,
      words_sha256:source.alignment?.words_sha256,cues_sha256:source.alignment?.cues_sha256,
      ordered_words:words,approved_caption_cues:source.alignment?.approved_caption_cues
    },
    media_ledger:(source.media_ledger??[]).map(row=>({path:row.path,sha256:row.sha256,
      rights:row.rights,kind:row.kind})),
    native_manifest:source.native_manifest
  };
}
const sourceBundle=(appPath:string,style:string,stage:Stage)=>{
  const authority=compileAuthority(appPath,style,stage,'author');
  return authority.sources.map(source=>({
    relative:source.path,sha256:source.sha256,extractionSha256:source.extractionSha256,
    extractionRevision:source.extractionRevision,headings:source.headings,locations:source.locations??[],text:source.text
  }));
};
export function sourceFingerprint(appPath: string, root: string, stage: Stage) {
  const state = readState(root), context = projectContext(state, root, stage), authority=compileAuthority(appPath,state.project.style,stage,'author');
  // New unassigned media files never change creative authority. Existing assets are
  // separately snapshotted with their exact bytes at freeze and checked at both gates.
  const creative = Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'assets' && key !== 'media_ledger'));
  return sha(JSON.stringify({ stage, creative, authority }));
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
  if(stage==='script')return task;
  if(!task.assetBaseline||!task.mediaBaseline)throw new Error('REBUILD_REQUIRED: old task lacks verifiable frozen media inventory.');
  const currentMedia=mediaSnapshot(state);
  for(const row of task.mediaBaseline)if(!currentMedia.some(item=>JSON.stringify(item)===JSON.stringify(row)))throw new Error('frozen task registered media changed; rebuild required.');
  for(const item of task.assetBaseline){
    const target=resolveProjectFile(root,item.path);
    if(!fs.existsSync(target)||sha(fs.readFileSync(target))!==item.sha256)throw new Error('frozen task existing asset bytes changed; rebuild required.');
  }
  return task;
}
function scriptAuthorPrompt(
  context:ReturnType<typeof projectContext>,
  response:Record<string,unknown>,
  sources:ReturnType<typeof sourceBundle>
){
  const duration=context.target_duration_seconds;
  const durationText=typeof duration==='number'&&duration>0?
    'Aim for the requested '+duration+' seconds of natural spoken narration, including meaningful pauses. No approved WPM target is provided in this task: do not invent an authoritative speaking rate or force a word count. The accepted WAV later determines actual duration.':
    'No target duration was supplied. Choose a natural structure suited to this brief without inventing a precise length or speech rate; actual duration is measured from the accepted WAV later.';
  const provenance=sources.map(item=>
    '- '+item.relative+' | source SHA256 '+item.sha256+' | extraction SHA256 '+item.extractionSha256+
    ' | revision '+item.extractionRevision+' | exact locations '+item.locations.join(', ')).join('\n');
  const authority=sources.map(item=>
    '### '+item.relative+'\n'+item.text).join('\n\n');
  return [
    '# MODE B — EXTERNAL CHATGPT | SCRIPT AUTHOR',
    '## 1. Mission and deliverable',
    'Write the complete original spoken narration and establish the creative decisions needed to produce a strong, coherent story-led Mode B video. This is SCRIPT AUTHORING only, not the production/runtime stage. Return one importable JSON object, no Markdown or commentary.',
    '## 2. Actual project brief',
    JSON.stringify(context,null,2),
    'Empty audience/purpose fields are open creative choices, not missing mandatory inputs. Preserve explicit choices and approved narration if supplied. For fictional or speculative premises, distinguish story-world assumptions from factual claims where needed.',
    '## 3. Narrative and creative responsibilities',
    '- Establish a compelling premise and concrete opening hook tied to this topic/audience; unfold causal events or explanatory progression, develop escalation, and earn a satisfying ending without forcing a universal number of beats, roles or sections.',
    '- Keep character identity, world constraints, motivation, recurring locations/props, relationships, transformations and continuity consistent. Explain applicable decisions in authoring; use empty arrays only when genuinely inapplicable.',
    '- Write sections[].text as natural spoken narration, not directions to actors, camera, editors, sound engineers, CLI or image generators. Section text must read coherently when joined in order with two newline characters.',
    '- Plan visual communicability within the selected B style: what the audience must understand, relevant dramatic actions, objects and contrast. Do not deliver a shot ledger, frame plan, rendered asset, native manifest or exact timestamps.',
    '- Record concrete voice/emotion/sound intentions for later production; never claim generated audio, acquired media, observed footage, actual captions or completed checks.',
    '- '+durationText,
    '## 4. Applicable original Mode B authority (literal sourced creative requirements)',
    'The requirements below are exact selected original source blocks and complete sentence spans, not summaries. Their source files are NOT available to you outside this task; apply the text actually supplied below. Production/verification details mentioned incidentally remain responsibilities of later Studio/Native stages, not actions to perform here.',
    'Source traceability (source hashes, exact original line or line/column locations and extraction revision):',
    provenance,
    authority,
    '## 5. Exact JSON output contract',
    'Return exactly one JSON object matching the frozen identity envelope. Keep schema, project_id, task_id, revision, input_sha256 and stage unchanged. The JSON payload below is a fictional kite-story FORMAT EXAMPLE, not narration or creative direction for the requested project. Preserve the frozen outer identity exactly; replace every example section, sentence and authoring choice with original, brief-specific work. Never copy the kite example into your final answer.',
    JSON.stringify(response,null,2),
    'Required payload: schema="mode-b-script-v1"; sections is a non-empty ordered array of {id,text}; authoring is a JSON object. Each id must be unique, 1–80 characters of A–Z/a–z/0–9/_/-, with no spaces. Each text must contain only meaningful narration intended to be spoken. The approved narration text is the ordered sections[].text values joined with two newline characters.',
    'authoring contains production-relevant creative choices, never spoken narration. creative_direction, characters, continuity, style_decisions, voice_intentions and sound_intentions are suggested descriptive fields, not an additional mandatory nested schema. Include concrete details where relevant; do not fabricate characters, citations or irrelevant structure. source_references, if used, must be actual trustworthy inert citations in the existing accepted format, not media paths or instructions.',
    '## 6. Delivery checks',
    'Check full narration coherence, causal progression, hook/payoff, style fit, distinct creative decisions, stable identity/continuity, and honest treatment of factual versus speculative claims. No copied example text, structural placeholders, fake media, unverified claims, word timestamps, WAV lengths, provider execution, Native shots, CLI output or final-film QA. Do not silently rewrite already approved narration; any mismatch is resolved through owner review and the later voice workflow.'
  ].join('\n\n')+'\n';
}

export function freezeTask(appPath: string, root: string, stage: Stage, rebuild = false) {
  const state = readState(root); const context = projectContext(state, root, stage); const sources = sourceBundle(appPath, state.project.style,stage);
  const inputSha256 = sourceFingerprint(appPath, root, stage); const prior = state.tasks?.[stage];
  if (!rebuild && prior?.status === 'FROZEN' && prior.inputSha256 === inputSha256 && fs.existsSync(resolveProjectFile(root, prior.promptPath))) return { ...prior, prompt: readUtf8(resolveProjectFile(root, prior.promptPath)) };
  if(!rebuild&&prior?.status==='FROZEN')
    throw new Error('FROZEN_TASK_REBUILD_REQUIRED: explicitly Rebuild the current frozen task.');
  if(prior){
    state.externalTaskArchive??=[];
    state.externalTaskArchive.push({stage,operation:'author',task:{...prior,status:prior.status==='IMPORTED'?'IMPORTED':'STALE'}});
    prior.status='STALE';
  }
  const revision = (prior?.revision ?? 0) + 1; const id = randomUUID();
  const response = stage === 'script'
    ? { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { schema: 'mode-b-script-v1', sections: [{id:'opening',text:'At sunrise, a red kite escaped into the wind.'},{id:'resolution',text:'By evening, the kite returned carrying a small ribbon.'}], authoring: {creative_direction:{premise:'A lost kite becomes a small adventure.'},characters:[{id:'child',description:'One child follows the kite through the same town.'}],continuity:{rules:['The kite stays red throughout the story.']},style_decisions:{visual_intent:'Make the flight and return causally readable.'},voice_intentions:{tone:'Curious and warm.'},sound_intentions:{intent:'Wind rises with the kite, then settles.'},source_references:[]} } }
    : { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { manifest: {...(context as {native_manifest:Record<string,unknown>}).native_manifest,shots:[],captions:(context as {alignment:{approved_caption_cues:unknown}}).alignment.approved_caption_cues,voice:(context as {native_manifest:Record<string,unknown>}).native_manifest.voice}, shot_ledger: [], sound_script: [], asset_needs: [] } };
  const prompt = stage==='native'?`# ORIGINAL MODE B MANUAL CHATGPT HANDOFF — VISUAL / SHOT / SOUND / NATIVE MANIFEST\n\nThis is a manual transport boundary in the original Mode B workflow. Do not invent a parallel engine. Do not call tools, return Markdown, executable code or local absolute paths. Public HTTP(S) research citation URLs are permitted ONLY inside script payload.authoring.source_references as inert metadata; never use remote URLs as native assets or executable paths. Return exactly one JSON object matching the frozen envelope below.\n\n## NATIVE AUTHOR MISSION — VISUAL DIRECTION, NOT NARRATION TRANSCRIPTION
- Read the COMPLETE approved script and the exact source-extracted Mode B authority below. Preserve established world, character identities, causal events and visual priorities.
- Design a chronological sequence of meaningful Native Shots grounded in real ordered word start/end times and the accepted WAV duration; the accepted WAV, not the brief's aspirational duration, governs timing.
- Each Shot must tell the viewer something through a visibly readable action/state and a meaningful change, not simply restate a narration sentence. Use actual B1–B4 supported layer types, keyframes/motion and compositions from the supplied source authority; never invent renderer capabilities.
- Build deliberate camera/composition, object contacts, motion feasibility, continuity of identity, geography, pose, prop and screen direction across adjacent and NON-adjacent Shots.
- Preserve native voice settings and the EXACT current approved caption cue array. Caption boundaries need not coincide with Shot boundaries. No fixed shot count, duration or one-Shot-per-caption rule.
- In shot_ledger explain each real shot_id's meaning, visible state, important delta, composition, continuity, motion and constraints using the existing auxiliary ledger format; do not place unsupported extra metadata in manifest.shots.
- In sound_script place only justified real SFX/ambience intentions tied to actual targets/events; distinguish proposed sounds from existing assets.
- For EVERY generated image, declare a real manifest.shots[] image layer with an immutable id and safe missing project-relative path. The corresponding asset_needs must name the SAME real Shot ID, layer ID and expected path using the accepted auxiliary format. Describe actual content, orientation and continuity references. Never claim the image exists or fabricate an asset SHA.
- Cross-check complete story coverage, temporal order, shot/layer ids, motion feasibility, character/object continuity and every G-Labs-compatible frozen image target. Only actual imported assets with rights and matching SHA may be described as present.
- Return ONE COMPLETE Native candidate with manifest, shot_ledger, sound_script and asset_needs. Do not return Review/Correct/Recheck verdicts, a published project, fake CLI validation, media observations or a rendered film.

## ACTUAL AUTHORING SOURCE (COMPACT PROJECTION v1; SOURCE EVIDENCE UNCHANGED)
${JSON.stringify(nativePromptProjection(context), null, 2)}

## REQUIRED RESPONSE ENVELOPE\n${JSON.stringify(response, null, 2)}\n\nThe RESPONSE ENVELOPE is a structural starting point, NOT a valid finished film. Fill every required shot, ledger and actual field with project-specific verified data; no placeholder values, invented media, or fabricated timing. The outer identity fields must be returned byte-for-value. For native authoring, payload.manifest is the original B1–B4 project.json v1 and must contain no Studio/task metadata. Ground every shot in the approved script and actual word/caption timing. List missing media honestly; never fabricate an existing asset path.\n\n## AUTHORITATIVE INSTALLED MODE B SOURCES (SOURCE-EXACT VERIFIED STAGE EXTRACTIONS)\n${sources.map(item => `\n--- BEGIN ${item.relative} [full SHA256 ${item.sha256}; extraction SHA256 ${item.extractionSha256}; revision ${item.extractionRevision}; sections ${item.headings.join(' | ') || 'complete original'}] ---\n${item.text}\n--- END ${item.relative} ---`).join('\n')}\n`:'';
  const corePrompt=stage==='script'?scriptAuthorPrompt(context,response,sources):prompt.replace('Do not call tools, return Markdown, executable code or local absolute paths.','Do not claim or use local CLI, local media, paid providers, or file inspection without actual access. Return no Markdown, executable code, secrets, or local absolute paths. Public research is permitted when demanded and evidence is cited.');
  const finalPrompt=corePrompt+'\n'+externalJsonFileDelivery(stage,'author',revision,id);
  const relative = `.studio/external/tasks/${stage}-${revision}-${id}.md`; const target = resolveProjectFile(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, finalPrompt, { encoding: 'utf8', flag: 'wx' });
  state.tasks ??= {}; state.tasks[stage] = { id, revision, inputSha256, sourceFingerprint: inputSha256, ...(stage==='native'?{assetBaseline:assetSnapshot(root),mediaBaseline:mediaSnapshot(state)}:{}), promptSha256: sha(finalPrompt), promptPath: relative, status: 'FROZEN', createdAt: new Date().toISOString() }; writeState(root, state); return { ...state.tasks[stage], prompt:finalPrompt };
}

interface Envelope { schema: string; project_id: string; task_id: string; revision: number; input_sha256: string; stage: Stage; payload: Record<string, unknown> }
function validateEnvelope(state: StudioState, stage: Stage, value: unknown): Envelope {
  const object = value as Record<string, unknown>; exactKeys(object, ['schema','project_id','task_id','revision','input_sha256','stage','payload']); const task = state.tasks?.[stage];
  if (!task || task.status !== 'FROZEN') throw new Error('No current frozen task exists.');
  if (object.schema !== 'mode-b-external-result-v1' || object.project_id !== state.project.id || object.task_id !== task.id || object.revision !== task.revision || object.input_sha256 !== task.inputSha256 || object.stage !== stage) throw new Error('Project/task/revision/input binding mismatch.');
  if (!object.payload || typeof object.payload !== 'object' || Array.isArray(object.payload)) throw new Error('Invalid payload.'); return object as unknown as Envelope;
}
export function validateScript(payload: Record<string, unknown>) { exactKeys(payload, ['schema','sections','authoring']); if (payload.schema !== 'mode-b-script-v1' || !Array.isArray(payload.sections) || !payload.sections.length || !payload.authoring || typeof payload.authoring !== 'object' || Array.isArray(payload.authoring)) throw new Error('Invalid script payload.'); const ids = new Set<string>(),retiredPlaceholder=['exact','approved','wording'].join(' '); const sections = payload.sections.map(item => { const value = item as Record<string, unknown>; exactKeys(value, ['id','text']); if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id) || typeof value.text !== 'string' || !value.text.trim() || value.text.trim().replace(/[.!]$/,'').toLowerCase()===retiredPlaceholder || value.text.includes('REQUIRED_')) throw new Error('Invalid, duplicate or structural-placeholder script section.'); ids.add(value.id); return { id: value.id, text: value.text.trim() }; }); return { schema: 'mode-b-script-v1', sections, authoring: validateAuthoring(payload.authoring) }; }
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
export function validateManifest(state: StudioState, root: string, payload: Record<string, unknown>) {
  exactKeys(payload, ['manifest','shot_ledger','sound_script','asset_needs']);
  for(const field of ['shot_ledger','sound_script','asset_needs'])if(!Array.isArray(payload[field]))throw new Error('Native correction must include a complete '+field+' array.');
  const manifest = payload.manifest as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Native manifest missing.');
  const allowed = ['version','style','width','height','fps','voice','captions','shots','sfx','music','grid','captionSize','captionFont','font','television','ambience','dialogue','audio_cuts','opening','opening_audio_override','motion_ledger','caption_override'];
  exactKeys(manifest, allowed);rejectNativeUnsafePaths(manifest);
  rejectNativeUnsafePaths({shot_ledger:payload.shot_ledger,sound_script:payload.sound_script,asset_needs:payload.asset_needs});
  if(manifest.version!==1||manifest.style!==state.project.style||!['B1','B2','B3','B4'].includes(String(manifest.style)))throw new Error('Native version/style mismatch.');
  if(!Array.isArray(manifest.shots)||!manifest.shots.length||!Array.isArray(manifest.captions)||!manifest.voice||typeof manifest.voice!=='object')throw new Error('Native voice/captions/shots are required.');
  if(!state.voice||state.voice.stale||(manifest.voice as Record<string,unknown>).path!==state.voice.path||!fs.existsSync(resolveProjectFile(root,state.voice.path))||sha(fs.readFileSync(resolveProjectFile(root,state.voice.path)))!==state.voice.sha256)throw new Error('Manifest voice does not bind actual current accepted WAV bytes.');
  const approved=approvedCaptionCues(root);
  if(JSON.stringify(manifest.captions)!==JSON.stringify(approved))throw new Error('Native captions must exactly match the current approved word-grounded revision (AUTO_VERIFIED or USER_APPROVED); rebuild after regroup.');
  const timing=nativeVoiceTiming(root,state), candidateVoice=manifest.voice as Record<string,unknown>;
  const candidateLead=candidateVoice.lead??0,candidateTail=candidateVoice.tail??0,candidateTrim=candidateVoice.trim_start??0;
  if(candidateLead!==timing.lead||candidateTail!==timing.tail||candidateTrim!==timing.trimStart)throw new Error('Native voice timing must match the currently reviewed lead/tail/trim_start configuration.');
  const duration=timing.timelineDuration;let captionEnd=0;
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
  draftHistory?:NativeDraftRevision[];
}
interface NativeDraftRevision {
  schema:'mode-b-native-draft-revision-v1';
  revision:number;authorTaskId:string;previousSha256:string;artifactSha256:string;
  correctTaskId:string;reviewTaskId:string;authorizedEditableIds:string[];
  authorizedEditablePaths:string[];authorizedFindingIds:string[];
  recordPath:string;recordSha256:string;
}
const nativeDraftValue=(pending:PendingImport)=>({
  manifest:(pending.payload as {manifest:unknown}).manifest,
  shot_ledger:(pending.payload as {shotLedger:unknown}).shotLedger,
  sound_script:(pending.payload as {soundScript:unknown}).soundScript,
  asset_needs:(pending.payload as {assetNeeds:unknown}).assetNeeds
});
const pendingPath=(root:string)=>path.join(root,'.studio','external','pending.json');
const fulfillmentTxnPath=(root:string)=>path.join(root,'.studio','external','fulfillment-transaction.json');
type MediaRow=NonNullable<StudioState['media']>[number];
const withoutOwnedMapping=(rows:StudioState['media'],owned:MediaRow)=>rows?.filter(row=>JSON.stringify(row)!==JSON.stringify(owned))??[];
function recoverFulfillment(root:string){const file=fulfillmentTxnPath(root);if(!fs.existsSync(file))return false;const txn=strictJson(readUtf8(file))as{schema?:string;pendingBefore?:PendingImport;key?:string;binding?:{relative:string;sha256:string;rights:string;kind:'image'|'sfx'};ownedMapping?:MediaRow};const pending=txn.pendingBefore,key=txn.key,binding=txn.binding,owned=txn.ownedMapping,ref=pending?.references.find(item=>item.key===key);if(txn.schema!=='media-fulfillment-transaction-v2'||!pending||pending.schema!=='mode-b-pending-import-v2'||!key||!binding||!owned||!ref||pending.fulfillments[key]||owned.path!==binding.relative||owned.sha256!==binding.sha256||owned.rights!==binding.rights||owned.kind!==binding.kind)throw new Error('RECOVERY_REQUIRED: media fulfillment journal is corrupt; rebuild/review the frozen task.');exactNativeTarget((pending.payload as {manifest:Record<string,unknown>}).manifest,ref);const asset=resolveProjectFile(root,binding.relative);if(!fs.existsSync(asset)||sha(fs.readFileSync(asset))!==binding.sha256)throw new Error('BLOCKED: recovery asset SHA no longer matches the approved binding.');const state=readState(root);atomicJson(pendingPath(root),pending);state.media=withoutOwnedMapping(state.media,owned);writeState(root,state);fs.unlinkSync(file);return true}
const readPending=(root:string):PendingImport=>{
  if(recoverFulfillment(root))throw new Error('RECOVERY_REQUIRED: interrupted media fulfillment was safely rolled back; review and retry the exact binding.');
  const file=pendingPath(root);if(!fs.existsSync(file))throw new Error('No staged import exists.');
  const pending=strictJson(readUtf8(file)) as unknown as PendingImport;
  if(pending.schema!=='mode-b-pending-import-v2'||!pending.projectId||!pending.payloadSha256||!pending.responsePath||!Array.isArray(pending.references)||!pending.fulfillments)throw new Error('REBUILD_REQUIRED: pending record has no verifiable source/asset bindings.');
  const frozenResponse=resolveProjectFile(root,pending.responsePath);
  if(!fs.existsSync(frozenResponse)||sha(fs.readFileSync(frozenResponse))!==pending.responseSha256)throw new Error('Frozen ChatGPT response bytes are missing or modified.');
  if(pending.payloadSha256!==sha(JSON.stringify(pending.payload)))throw new Error('Pending imported payload was modified.');
  if(pending.stage==='native'&&pending.draftHistory){
    if(!Array.isArray(pending.draftHistory))throw new Error('NATIVE_DRAFT_HISTORY_INVALID');
    let previous:string|undefined;
    for(const [index,item] of pending.draftHistory.entries()){
      if(!item||item.schema!=='mode-b-native-draft-revision-v1'||item.revision!==index+2||
        item.authorTaskId!==pending.taskId||!/^\.studio\/external\/draft-revisions\/native-[a-f0-9-]+\.json$/.test(item.recordPath))
        throw new Error('NATIVE_DRAFT_HISTORY_INVALID');
      const file=resolveProjectFile(root,item.recordPath);
      if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==item.recordSha256)
        throw new Error('NATIVE_DRAFT_REVISION_TAMPERED');
      const stored=strictJson(readUtf8(file)) as {schema?:string;revision?:number;
        artifactSha256?:string;previousSha256?:string;artifact?:unknown};
      if(stored.schema!==item.schema||stored.revision!==item.revision||
        stored.artifactSha256!==item.artifactSha256||stored.previousSha256!==item.previousSha256||
        sha(JSON.stringify(stored.artifact))!==item.artifactSha256||
        (previous!==undefined&&item.previousSha256!==previous))
        throw new Error('NATIVE_DRAFT_REVISION_IDENTITY_INVALID');
      previous=item.artifactSha256;
    }
    if(previous&&sha(JSON.stringify(nativeDraftValue(pending)))!==previous)
      throw new Error('NATIVE_DRAFT_CURRENT_REVISION_MISMATCH');
  }
  return pending;
};
/** Read the immutable current Native Author draft; never fall back to project.json. */
export function readNativeDraft(root:string,state=readState(root)){
  if(!fs.existsSync(pendingPath(root)))return null;
  const pending=readPending(root);
  if(pending.stage!=='native')return null;
  const author=state.tasks?.native;
  if(pending.projectId!==state.project.id||!author||author.status!=='FROZEN'||
    author.id!==pending.taskId||author.revision!==pending.revision||author.inputSha256!==pending.inputSha256)
    throw new Error('NATIVE_DRAFT_STALE_AUTHOR_TASK');
  const artifact=nativeDraftValue(pending);
  return{context:'DRAFT' as const,token:pending.token,authorTaskId:pending.taskId,
    revision:1+(pending.draftHistory?.length??0),artifact,sha256:sha(JSON.stringify(artifact)),
    history:pending.draftHistory??[]};
}
/** Publish an immutable corrected draft revision without touching original Author
 * response, published project.json or unrelated accepted media. */
export function publishNativeDraftCorrection(appPath:string,root:string,originalSha256:string,
  corrected:Record<string,unknown>,proof:{correctTaskId:string;reviewTaskId:string;
    editableIds:string[];editablePaths:string[];findingIds:string[]}){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)throw new Error('NATIVE_DRAFT_REQUIRED');
  const normalized=validateManifest(state,root,corrected);
  const newArtifact={manifest:normalized.manifest,shot_ledger:normalized.shotLedger,
    sound_script:normalized.soundScript,asset_needs:normalized.assetNeeds};
  const newSha256=sha(JSON.stringify(newArtifact));
  const existing=draft.history.find(item=>item.correctTaskId===proof.correctTaskId);
  if(existing){
    if(existing.previousSha256!==originalSha256||existing.artifactSha256!==newSha256)
      throw new Error('NATIVE_DRAFT_CORRECTION_REPLAY_CONFLICT');
    return draft;
  }
  if(draft.sha256!==originalSha256)throw new Error('NATIVE_DRAFT_STALE_CORRECTION');
  assertTaskCurrent(appPath,root,'native',state);
  const pending=readPending(root);
  if(pending.token!==draft.token)throw new Error('NATIVE_DRAFT_TOKEN_CHANGED');
  const kept=Object.fromEntries(Object.entries(pending.fulfillments).filter(([key,binding])=>{
    const previous=pending.references.find(ref=>ref.key===key);
    const next=normalized.missing.find(ref=>ref.key===key);
    if(!previous||!next||JSON.stringify(previous)!==JSON.stringify(next))return false;
    const saved=state.media?.find(row=>row.path===binding.relative&&row.kind===binding.kind&&
      row.sha256===binding.sha256&&row.rights===binding.rights);
    const file=resolveProjectFile(root,binding.relative);
    return Boolean(saved&&fs.existsSync(file)&&sha(fs.readFileSync(file))===binding.sha256);
  }));
  const recordPath='.studio/external/draft-revisions/native-'+randomUUID()+'.json';
  const record={schema:'mode-b-native-draft-revision-v1' as const,
    revision:draft.revision+1,authorTaskId:draft.authorTaskId,previousSha256:originalSha256,
    artifactSha256:newSha256,correctTaskId:proof.correctTaskId,reviewTaskId:proof.reviewTaskId,
    authorizedEditableIds:proof.editableIds,authorizedEditablePaths:proof.editablePaths,
    authorizedFindingIds:proof.findingIds,artifact:newArtifact};
  const target=resolveProjectFile(root,recordPath);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  const updated:PendingImport={...pending,
    payload:{...normalized},payloadSha256:sha(JSON.stringify(normalized)),
    references:normalized.missing,fulfillments:kept,
    draftHistory:[...(pending.draftHistory??[]),{
      schema:'mode-b-native-draft-revision-v1',revision:record.revision,
      authorTaskId:record.authorTaskId,previousSha256:record.previousSha256,
      artifactSha256:record.artifactSha256,correctTaskId:proof.correctTaskId,
      reviewTaskId:proof.reviewTaskId,authorizedEditableIds:proof.editableIds,
      authorizedEditablePaths:proof.editablePaths,authorizedFindingIds:proof.findingIds,
      recordPath,recordSha256:sha(fs.readFileSync(target))
    }]};
  atomicJson(pendingPath(root),updated);
  return readNativeDraft(root)!;
}
const pendingResult=(root:string,pending:PendingImport)=>{
  const state=readState(root);
  if(pending.stage==='script')return{token:pending.token,stage:pending.stage,before:pending.before,after:pending.payload,changes:1,status:'STAGED',missing:[]};
  const resolved=resolvePendingCandidate(root,state,pending);
  return{token:pending.token,stage:pending.stage,before:pending.before,after:resolved.manifest,changes:1,status:resolved.missing.length?'WAITING_FOR_MEDIA':'STAGED',missing:resolved.missing,fulfillments:pending.fulfillments,shotLedger:(pending.payload as {shotLedger?:unknown[]}).shotLedger??[],assetNeeds:(pending.payload as {assetNeeds?:unknown[]}).assetNeeds??[]};
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
    const prior=readPending(root);
    if(prior.projectId===state.project.id&&prior.taskId===task.id&&prior.revision===task.revision&&prior.stage===stage&&prior.responseSha256===responseSha256)return pendingResult(root,prior);
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
  if(!fs.existsSync(pendingPath(root)))return null;
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
export function fulfillMedia(appPath:string,root:string,token:string,key:string,relative:string,rights:string,hooks:{afterPending?:()=>void;afterState?:()=>void}={}){
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
  const pendingBefore=structuredClone(pending);state.media=[...(state.media??[]).filter(item=>!(item.path===relative&&item.shotId===ref.shotId&&item.layerId===ref.layerId&&item.track===ref.track&&item.trackIndex===ref.trackIndex)),mapped];
  pending.fulfillments[key]=binding;
  atomicJson(fulfillmentTxnPath(root),{schema:'media-fulfillment-transaction-v2',pendingBefore,key,binding,ownedMapping:mapped,createdAt:new Date().toISOString()});
  try{atomicJson(pendingPath(root),pending);hooks.afterPending?.();writeState(root,state);hooks.afterState?.();fs.unlinkSync(fulfillmentTxnPath(root));return pendingResult(root,pending)}catch(error){atomicJson(pendingPath(root),pendingBefore);const rollback=readState(root);rollback.media=withoutOwnedMapping(rollback.media,mapped);writeState(root,rollback);if(fs.existsSync(fulfillmentTxnPath(root)))fs.unlinkSync(fulfillmentTxnPath(root));throw error}
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
    const candidateText=script.sections.map(item=>item.text).join('\n\n');
    state.scriptCandidate={sections:script.sections,text:candidateText,sha256:sha(candidateText),revision,importedAt:new Date().toISOString(),taskId:task.id,authoring:script.authoring};
    state.external.script={revision,artifact:pending.payload,importedAt:new Date().toISOString()};
    task.status='IMPORTED';task.confirmedResponseSha256=pending.responseSha256;task.confirmedResponsePath=pending.responsePath;
    activateScriptCandidate(root,state,'AUTHOR_IMPORT');
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
  const current=path.join(root,'project.json'),beforeBytes=fs.readFileSync(current),runner=options.validator??runProcess;
  let promoted=false;let stateCommitted=false;let tmp='';let committedState:StudioState|undefined;
  let externalNativeBefore:StudioState['external']['native'];let ownedBefore:Pick<StudioState,'nativeReadiness'|'preview'|'approval'|'render'>|undefined;
  let oldTaskStatus:'FROZEN'|'IMPORTED'|'STALE'|undefined;
  let oldConfirmedResponseSha:string|undefined,oldConfirmedResponsePath:string|undefined;
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
    assertTaskCurrent(appPath,root,'native',fresh);
    if(fresh.project.id!==pending.projectId||fresh.tasks?.native?.id!==pending.taskId||fresh.tasks.native.revision!==pending.revision)throw new Error('Native task was replaced during validation.');
    const diskPending=readPending(root);
    if(diskPending.token!==pending.token||diskPending.payloadSha256!==pending.payloadSha256||JSON.stringify(diskPending.fulfillments)!==JSON.stringify(pending.fulfillments))throw new Error('Native candidate fulfillment changed during validation.');
    const again=resolvePendingCandidate(root,fresh,diskPending);
    if(JSON.stringify(again.manifest)!==JSON.stringify(resolved.manifest)||JSON.stringify(again.missing)!==JSON.stringify(resolved.missing))throw new Error('Native candidate or missing-media ledger changed during validation.');
    if(!fs.readFileSync(current).equals(beforeBytes))throw new Error('Last-good native manifest changed during validation; staged confirmation is stale.');
    const readiness:NonNullable<StudioState['nativeReadiness']>={sampleReady:true,fullReady:Boolean(full),previewSeconds:seconds,checkedSeconds:sample.checkedSeconds,
      validationSha256:sample.fingerprint,missingOutsideScope:resolved.missing.map(item=>item.key),
      reviewedDraft:!full&&options.allowSampleDraft===true,verifiedAt:new Date().toISOString()};
    const backup=path.join(root,'.studio','revisions','project-before-'+revision+'.json');
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(current,backup);
    tmp=current+'.'+randomUUID()+'.tmp';fs.copyFileSync(candidate,tmp);fs.renameSync(tmp,current);promoted=true;
    readiness.sourceFingerprint=sha(fs.readFileSync(current));
    // Apply only native-confirmation-owned fields to the freshly re-read state.
    // Unassigned imports and any other independent state written while the CLI
    // was running remain intact.
    externalNativeBefore=fresh.external.native?structuredClone(fresh.external.native):undefined;
    ownedBefore={nativeReadiness:fresh.nativeReadiness,preview:fresh.preview,approval:fresh.approval,render:fresh.render};
    oldTaskStatus=fresh.tasks!.native!.status;
    oldConfirmedResponseSha=fresh.tasks!.native!.confirmedResponseSha256;
    oldConfirmedResponsePath=fresh.tasks!.native!.confirmedResponsePath;
    fresh.external.native={revision,artifact:{...again,missing:again.missing},importedAt:new Date().toISOString()};
    fresh.nativeReadiness=readiness;fresh.preview=undefined;fresh.approval=undefined;fresh.render=undefined;fresh.tasks!.native!.status='IMPORTED';fresh.tasks!.native!.confirmedResponseSha256=pending.responseSha256;fresh.tasks!.native!.confirmedResponsePath=pending.responsePath;
    committedState=fresh;writeState(root,fresh);stateCommitted=true;
    atomicJson(path.join(root,'.studio','revisions','native-'+revision+'.json'),again.manifest);
    atomicJson(path.join(root,'.studio','revisions','native-authoring-'+revision+'.json'),{shot_ledger:again.shotLedger,sound_script:again.soundScript,asset_needs:again.assetNeeds,fulfillments:diskPending.fulfillments,missing:again.missing});
    fs.unlinkSync(pendingPath(root));return fresh;
  }catch(error){
    let conflict=false;
    if(promoted){
      // Never restore an old manifest over an independent, newer filesystem change.
      const promotedBytes=fs.readFileSync(candidate),currentBytes=fs.readFileSync(current);
      if(currentBytes.equals(promotedBytes)){
        const restore=current+'.'+randomUUID()+'.restore';
        fs.writeFileSync(restore,beforeBytes);fs.renameSync(restore,current);
      }else conflict=true;
    }
    if(stateCommitted&&committedState&&ownedBefore){
      const rollback=readState(root),ownedRevision=committedState.external.native?.revision;
      if(rollback.external.native?.revision===ownedRevision&&
        JSON.stringify(rollback.preview)===JSON.stringify(committedState.preview)&&
        JSON.stringify(rollback.approval)===JSON.stringify(committedState.approval)){
        rollback.external.native=externalNativeBefore;rollback.nativeReadiness=ownedBefore.nativeReadiness;
        rollback.preview=ownedBefore.preview;rollback.approval=ownedBefore.approval;rollback.render=ownedBefore.render;
        if(rollback.tasks?.native&&rollback.tasks.native.id===committedState.tasks?.native?.id&&oldTaskStatus){
          rollback.tasks.native.status=oldTaskStatus;
          rollback.tasks.native.confirmedResponseSha256=oldConfirmedResponseSha;
          rollback.tasks.native.confirmedResponsePath=oldConfirmedResponsePath;
        }
        writeState(root,rollback);
      }else conflict=true;
    }
    if(conflict)throw new Error('RECOVERY_REQUIRED: newer independent changes prevented unsafe native rollback; original error: '+String(error));
    throw error;
  }finally{
    if(fs.existsSync(candidate))fs.unlinkSync(candidate);
    if(tmp&&fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
}

/** Publish only verified Script candidates. This replaces the removed owner-click approval.
 * Author imports activate immediately; scoped corrections activate after a matching
 * independently imported clean Recheck. No production source is inferred from a draft.
 */
export function scriptCorrectionRechecked(state:StudioState):boolean {
  const candidate=state.scriptCandidate,correct=state.lifecycle?.tasks['script:correct'];
  if(!candidate||correct?.id!==candidate.taskId)return false;
  const hash=sha(JSON.stringify(candidate));
  return Object.values(state.lifecycle?.artifacts??{}).some(item=>{
    if(item.stage!=='script'||item.operation!=='recheck')return false;
    const value=item.value as {artifact_sha256?:string;status?:string;findings?:Array<{status?:string}>};
    return value.artifact_sha256===hash&&value.status==='REVIEWED_NO_FINDINGS'&&
      (!value.findings||value.findings.every(f=>f.status==='resolved'));
  });
}
export function activateScriptCandidate(root:string,state:StudioState,source:'AUTHOR_IMPORT'|'RECHECK'):boolean {
  const candidate=state.scriptCandidate;
  if(!candidate||sha(candidate.text)!==candidate.sha256||
    candidate.sections.map(row=>row.text).join('\n\n')!==candidate.text)
    throw new Error('No current verified Script candidate is available.');
  if(source==='AUTHOR_IMPORT'&&state.tasks?.script?.id!==candidate.taskId)
    throw new Error('STALE: Script Author task no longer owns this candidate.');
  if(source==='RECHECK'&&!scriptCorrectionRechecked(state))
    throw new Error('RECHECK_REQUIRED: corrected Script must pass a current independent Recheck.');
  if(state.approvedScript?.sha256===candidate.sha256&&
    JSON.stringify(state.approvedScript.authoring??null)===JSON.stringify(candidate.authoring??null))return false;
  const changed=state.approvedScript?.sha256!==candidate.sha256;
  const creativeChanged=JSON.stringify(state.approvedScript?.authoring??null)!==JSON.stringify(candidate.authoring??null);
  const approved:NonNullable<StudioState['approvedScript']>={
    sections:candidate.sections,text:candidate.text,sha256:candidate.sha256,revision:candidate.revision,
    approvedAt:new Date().toISOString(),approvedBy:'AUTO',
    approvalNote:source==='AUTHOR_IMPORT'?'Auto-activated after confirmed Script Author import.':'Auto-activated after passed Script Recheck.',
    authoring:candidate.authoring
  };
  // Write the exact revision before publishing it into active project state.
  atomicJson(path.join(root,'.studio','revisions','script-approved-'+candidate.revision+'.json'),approved);
  state.approvedScript=approved;
  if(changed){if(state.voice)state.voice.stale=true;state.alignment=undefined;}
  if(changed||creativeChanged){
    if(state.tasks?.native)state.tasks.native.status='STALE';
    state.nativeReadiness=undefined;state.preview=undefined;state.approval=undefined;state.render=undefined;
  }
  return true;
}
/** Upgrade previously imported, unapproved candidates after removal of manual approval.
 * A corrected candidate remains pending until a hash-bound clean Recheck exists.
 * Idempotent: already activated content does not rewrite timestamps or accepted media.
 */
export function reconcileScriptActivation(root:string):StudioState {
  const state=readState(root),candidate=state.scriptCandidate;
  if(!candidate)return state;
  if(state.approvedScript?.sha256===candidate.sha256&&
    JSON.stringify(state.approvedScript.authoring??null)===JSON.stringify(candidate.authoring??null))return state;
  if(state.lifecycle?.tasks['script:correct']?.id===candidate.taskId){
    if(!scriptCorrectionRechecked(state))return state;
    if(activateScriptCandidate(root,state,'RECHECK'))writeState(root,state);
  }else if(state.tasks?.script?.id===candidate.taskId&&state.tasks.script.status==='IMPORTED'){
    if(activateScriptCandidate(root,state,'AUTHOR_IMPORT'))writeState(root,state);
  }
  return state;
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
