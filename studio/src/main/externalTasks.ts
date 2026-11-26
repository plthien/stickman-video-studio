import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertB4NarratorBinding, atomicJson, nativeSkillRoot, readState, resolveProjectFile, runProcess, safeImportedFile, sha, strictJson, writeState, type Stage, type StudioState } from './services.js';
import { approvedCaptionCues, nativeVoiceTiming } from './captionReview.js';
import { rejectNativeUnsafePaths, validateAuthoring } from './sourceCitations.js';
import { compileAuthority,nativeAnimationDirection,nativeReferenceInventory,nativeReferenceInstructions } from './externalAuthority.js';
import {imageRequirementFingerprintSources,imageRequirementsForTarget} from './imageRequirements.js';
import {assetOutputForTarget,verifyArtwork,verifyRatio} from './assetPreparation.js';
import {inspectNativePlan,nativePlanPreflight} from './nativePlanPreflight.js';
import {structuredSoundCues,assertAudioReceipt,type AudioPreparationReceipt} from './soundRequirements.js';
import {readApprovedNativeIdentity,validateNativeBindingPayload} from './identity/nativeBinding.js';
import {currentDraftIdentityReceipt,publishNativeIdentityReceipt,assertPublishedIdentityCurrent,readNativeIdentityReceipt} from './identity/finalGate.js';
import {createContinuityResolver} from './identity/continuityGraph.js';
import {verifyReferenceFile,type IdentityDecoder} from './identity/referencePublication.js';
import {contentHash} from './identity/contracts.js';
import {readGlabsJob} from './glabs.js';
import {verifyOwnerImageApproval} from './identity/ownerMediaAuthority.js';
import type {OwnerImageApproval} from './identity/ownerMediaAuthority.js';

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
    assertB4NarratorBinding(state.project.style,state.voice,manifest.voice);
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
function nativePromptProjection(context:ReturnType<typeof projectContext>,root:string,
  appPath:string){
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
  for(const row of source.media_ledger??[]){
    if(!row.rights?.trim()||typeof row.path!=='string'||!fs.existsSync(resolveProjectFile(root,row.path))||
      sha(fs.readFileSync(resolveProjectFile(root,row.path)))!==row.sha256)
      throw new Error('NATIVE_AUTHOR_REGISTERED_MEDIA_STALE: source or rights are not verified.');
  }
  const {assets:unusedAssets,media_ledger:unusedLedger,...common}=source;
  void unusedAssets;void unusedLedger;
  const approvedIdentity=readState(root).identityPolicy==='v1'?
    readApprovedNativeIdentity(root,appPath):null;
  return {...common,
    ...(approvedIdentity?{
      upstream_character_authority:{
        ...approvedIdentity,
        // Reviewed structured creative records are transported intact; no prose inference.
        characters:approvedIdentity.characters
      }
    }:{}),
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
  const identity=stage==='native'&&state.identityPolicy==='v1'?
    readApprovedNativeIdentity(root,appPath).snapshotSha:null;
  return sha(JSON.stringify({ stage, creative, authority, ...(identity?{identity}:{}) }));
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
    'Return exactly one JSON object matching the frozen identity envelope. Keep schema, project_id, task_id, revision, input_sha256 and stage unchanged. The JSON payload below is a CONTENT-FREE STRUCTURAL SHELL, deliberately invalid as a completed Script because sections is empty. Preserve the frozen outer identity exactly; replace the empty sections with original, project-specific spoken narration and populate authoring only with supported decisions. NEVER return this shell, empty sections, placeholder narration or invented creative examples as the final result.',
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
  if (!rebuild && prior?.status === 'FROZEN' && prior.inputSha256 === inputSha256 && fs.existsSync(resolveProjectFile(root, prior.promptPath))) {
    // A frozen prompt is byte-immutable. Native source-exact authority blocks can
    // contain CRLF: readUtf8() normalizes them and changes the exported prompt.
    const promptBytes=fs.readFileSync(resolveProjectFile(root, prior.promptPath));
    if(sha(promptBytes)!==prior.promptSha256)
      throw new Error('FROZEN_TASK_PROMPT_TAMPERED: explicitly Rebuild the current frozen task.');
    return {...prior,prompt:promptBytes.toString('utf8')};
  }
  if(!rebuild&&prior?.status==='FROZEN')
    throw new Error('FROZEN_TASK_REBUILD_REQUIRED: explicitly Rebuild the current frozen task.');
  if(prior){
    state.externalTaskArchive??=[];
    state.externalTaskArchive.push({stage,operation:'author',task:{...prior,status:prior.status==='IMPORTED'?'IMPORTED':'STALE'}});
    prior.status='STALE';
  }
  if(stage==='native'&&state.identityPolicy==='v1'&&state.alignment?.captionReview?.mode==='AUTO')
    throw Error('CAPTION_AI_OR_OWNER_REVIEW_REQUIRED: historical automatic grouping is not authority for new Native authoring.');
  const revision = (prior?.revision ?? 0) + 1; const id = randomUUID();
  const response = stage === 'script'
    ? { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { schema: 'mode-b-script-v1', sections: [], authoring: {} } }
    : { schema: 'mode-b-external-result-v1', project_id: state.project.id, task_id: id, revision, input_sha256: inputSha256, stage, payload: { manifest: {...(context as {native_manifest:Record<string,unknown>}).native_manifest,shots:[],captions:(context as {alignment:{approved_caption_cues:unknown}}).alignment.approved_caption_cues,voice:(context as {native_manifest:Record<string,unknown>}).native_manifest.voice}, shot_ledger: [], sound_script: [], asset_needs: [] } };
  const prompt = stage==='native'?`# ORIGINAL MODE B MANUAL CHATGPT HANDOFF — VISUAL / SHOT / SOUND / NATIVE MANIFEST\n\nThis is a manual transport boundary in the original Mode B workflow. Do not invent a parallel engine. Do not call tools, return Markdown, executable code or local absolute paths. Public HTTP(S) research citation URLs are permitted ONLY inside script payload.authoring.source_references as inert metadata; never use remote URLs as native assets or executable paths. Return exactly one JSON object matching the frozen envelope below.\n\n## NATIVE AUTHOR MISSION — VISUAL DIRECTION, NOT NARRATION TRANSCRIPTION
- Read the COMPLETE approved script and the exact source-extracted Mode B authority below. Preserve established world, character identities, causal events and visual priorities.
- Design a chronological sequence of meaningful Native Shots grounded in real ordered word start/end times and the accepted WAV duration; the accepted WAV, not the brief's aspirational duration, governs timing.
- Each Shot must tell the viewer something through a visibly readable action/state and a meaningful change, not simply restate a narration sentence. Use actual B1–B4 supported layer types, keyframes/motion and compositions from the supplied source authority; never invent renderer capabilities.
- Build deliberate camera/composition, object contacts, motion feasibility, continuity of identity, geography, pose, prop and screen direction across adjacent and NON-adjacent Shots.
- Preserve native voice settings and the EXACT current approved caption cue array. Caption boundaries need not coincide with Shot boundaries. No fixed shot count, duration or one-Shot-per-caption rule.
- Every manifest.shots[] entry MUST have a unique explicit stable id (for example sh_001); match that exact id in shot_ledger and sound_script target IDs. Studio cannot Review/Correct or map Shot/Layer media without explicit Shot IDs. Do not use implicit array indices as Shot IDs.
- In shot_ledger explain each real shot_id's meaning, visible state, important delta, composition, continuity, motion and constraints using the existing auxiliary ledger format; do not place unsupported extra metadata in manifest.shots.
- In sound_script place only justified real SFX/ambience intentions tied to actual targets/events; distinguish proposed sounds from existing assets. Each actual manifest audio entry MUST have exactly one structured sidecar cue using the contract cue_id, track (sfx|ambience|dialogue|music|audio_cuts), track_index, source_kind (file|procedural|cut), source_requirement, optional preparation (preserve|pcm16), optional reuse {path,sha256}. Track/index must point to the actual manifest entry; timeline coordinates come from that entry. For music use index 0. Include precise role/line, material, timing and perspective in source_requirement; no new fields in original manifest audio tracks. Use reuse only for exact previously registered rights-cleared local source bytes; no invented hashes. Original procedural SFX and audio cuts need no external file.
- For EVERY generated image, declare a real manifest.shots[] image layer with an immutable id and safe missing project-relative path. The corresponding asset_needs must name the SAME real Shot ID, layer ID and expected path using the accepted auxiliary format. Describe actual content, orientation and continuity references. Never claim the image exists or fabricate an asset SHA.
- If upstream_character_authority is present (F24), EVERY managed Native image target MUST have exactly ONE STRUCTURED asset_needs row with shot_id, layer_id, expected_path, content, REQUIRED asset_kind (background|character|pose|prop|object|other), character_ids (explicit array). For asset_kind character or pose, character_ids MUST be nonempty and contain only canonical character IDs; background/character-free object may use []. Omitting asset_kind is never a valid fallback. Declare optional typed continuity_source {shot_id,layer_id,relation} only for a real earlier managed image. Core @b1/ built-ins are not paid-image targets. Only use canonical char_id values supplied by upstream_character_authority. Do NOT invent characters, omit a target, add identity fields to manifest/project.json, or use legacy string asset_needs for F24 targets. Review exact owner-approved canonical source and identity lineage SHA.
- For exact reuse of an earlier approved image, declare reuse_approved {shot_id,layer_id, optional sha256 only if known}, together with matching continuity_source (same_setup or match_composition). Source and destination must have identical cast, asset_kind, orientation and output requirements. The owner authorizes the actual source SHA after approval. Never fabricate a hash or reuse similar but different artwork.
- Cross-check complete story coverage, temporal order, shot/layer ids, motion feasibility, character/object continuity and every G-Labs-compatible frozen image target. Only actual imported assets with rights and matching SHA may be described as present.
- Return ONE COMPLETE Native candidate with manifest, shot_ledger, sound_script and asset_needs. Do not return Review/Correct/Recheck verdicts, a published project, fake CLI validation, media observations or a rendered film.

${nativeAnimationDirection(state.project.style)}

${nativeReferenceInstructions(nativeReferenceInventory(appPath,state.project.style))}

## ACTUAL AUTHORING SOURCE (COMPACT PROJECTION v1; SOURCE EVIDENCE UNCHANGED)
${JSON.stringify(nativePromptProjection(context,root,appPath), null, 2)}

## REQUIRED RESPONSE ENVELOPE\n${JSON.stringify(response, null, 2)}\n\nThe RESPONSE ENVELOPE is a structural starting point, NOT a valid finished film. Fill every required shot, ledger and actual field with project-specific verified data; no placeholder values, invented media, or fabricated timing. The outer identity fields must be returned byte-for-value. For native authoring, payload.manifest is the original B1–B4 project.json v1 and must contain no Studio/task metadata. Ground every shot in the approved script and actual word/caption timing. List missing media honestly; never fabricate an existing asset path.\n\n## AUTHORITATIVE INSTALLED MODE B SOURCES (SOURCE-EXACT VERIFIED STAGE EXTRACTIONS)\n${sources.map(item => `\n--- BEGIN ${item.relative} [full SHA256 ${item.sha256}; extraction SHA256 ${item.extractionSha256}; revision ${item.extractionRevision}; sections ${item.headings.join(' | ') || 'complete original'}] ---\n${item.text}\n--- END ${item.relative} ---`).join('\n')}\n`:'';
  const corePrompt=stage==='script'?scriptAuthorPrompt(context,response,sources):prompt.replace('Do not call tools, return Markdown, executable code or local absolute paths.','Do not claim or use local CLI, local media, paid providers, or file inspection without actual access. Return no Markdown, executable code, secrets, or local absolute paths. Public research is permitted when demanded and evidence is cited.');
  const finalPrompt=corePrompt+'\n'+externalJsonFileDelivery(stage,'author',revision,id);
  const relative = `.studio/external/tasks/${stage}-${revision}-${id}.md`; const target = resolveProjectFile(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, finalPrompt, { encoding: 'utf8', flag: 'wx' });
  state.tasks ??= {}; state.tasks[stage] = { id, revision, inputSha256, sourceFingerprint: inputSha256, ...(stage==='native'?{assetBaseline:assetSnapshot(root),mediaBaseline:mediaSnapshot(state),...(state.identityPolicy==='v1'?{soundContract:'structured-v1' as const}:{})}:{}), promptSha256: sha(finalPrompt), promptPath: relative, status: 'FROZEN', createdAt: new Date().toISOString() }; writeState(root, state); return { ...state.tasks[stage], prompt:finalPrompt };
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
/** Studio-managed images are exact paid/imported media. Native Core @b1/
 * assets are built-ins and remain renderable, but require no G-Labs approval. */
export function isManagedNativeImagePath(path:unknown):path is string{
  return typeof path==='string'&&!path.startsWith('@b1/');
}
function nativeRefs(manifest:Record<string,unknown>):MissingNativeReference[]{
  const refs:MissingNativeReference[]=[];
  const seenImageIds=new Set<string>();
  const shots=manifest.shots as Array<Record<string,unknown>>;
  const visit=(layers:unknown[],shot:Record<string,unknown>,index:number,parentFrom=0)=>{
    for(const layerValue of layers){
      const layer=layerValue as Record<string,unknown>;
      if(layer?.type==='image'&&typeof layer.id==='string'&&layer.id){
        const identity=index+':'+layer.id;
        if(seenImageIds.has(identity))
          throw Error('NATIVE_DUPLICATE_IMAGE_LAYER_ID');
        seenImageIds.add(identity);
      }
      if(layer?.type==='image'&&isManagedNativeImagePath(layer.path)){
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
/** Exact layer identities only. No renderer metadata is added to project.json. */
export function nativeImageTargetsFromManifest(manifest:Record<string,unknown>){
  return nativeRefs(manifest).filter(ref=>ref.kind==='image').map(ref=>{
    if(!ref.shotId||!ref.layerId||typeof ref.shotIndex!=='number')
      throw Error('NATIVE_IMAGE_TARGET_IDENTITY_REQUIRED');
    return{key:ref.key,shotId:ref.shotId,layerId:ref.layerId,path:ref.path,
      shotIndex:ref.shotIndex};
  });
}
export function validateManifest(state: StudioState, root: string,
  payload: Record<string, unknown>,appPath?:string) {
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
  assertB4NarratorBinding(state.project.style,state.voice,manifest.voice);
  const timing=nativeVoiceTiming(root,state), candidateVoice=manifest.voice as Record<string,unknown>;
  const candidateLead=candidateVoice.lead??0,candidateTail=candidateVoice.tail??0,candidateTrim=candidateVoice.trim_start??0;
  if(candidateLead!==timing.lead||candidateTail!==timing.tail||candidateTrim!==timing.trimStart)throw new Error('Native voice timing must match the currently reviewed lead/tail/trim_start configuration.');
  const duration=timing.timelineDuration;let captionEnd=0;
  for(const item of manifest.captions as unknown[]){const cue=item as Record<string,unknown>,start=Number(cue.start),end=Number(cue.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<captionEnd||end<=start||end>duration+.05||typeof cue.text!=='string'||!cue.text.trim())throw new Error('Native captions must be finite, monotone and within accepted narration.');captionEnd=end}
  let shotEnd=0;for(const item of manifest.shots as unknown[]){const shot=item as Record<string,unknown>,start=Number(shot.start),end=Number(shot.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<shotEnd||end<=start||end>duration+.05)throw new Error('Native shots must be finite, non-overlapping and within accepted narration.');shotEnd=end}
  // The original Native renderer accepts a stable Shot ID; Studio requires it
  // for Review/Correct target inventory and exact Shot/Layer media binding.
  // Reject invalid Author artifacts HERE, rather than after staging a draft.
  const shotIds=(manifest.shots as Array<{id?:unknown}>).map(shot=>shot?.id);
  if(shotIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))||
    new Set(shotIds).size!==shotIds.length)
    throw new Error('NATIVE_SHOT_IDS_REQUIRED: each manifest Shot needs a unique stable id before Native Review or media mapping.');
  // Structural identity check only: preserve the existing freeform asset_needs
  // format, but entries that explicitly name Shot+Layer must refer to a REAL
  // Native image target with the SAME stated expected path (when supplied).
  const imageTargets=nativeRefs(manifest).filter(item=>item.kind==='image');
  for(const value of payload.asset_needs as unknown[]){
    if(!value||typeof value!=='object'||Array.isArray(value))continue;
    const row=value as Record<string,unknown>;
    const shotId=row.shot_id??row.shotId,layerId=row.layer_id??row.layerId;
    if(typeof shotId!=='string'||typeof layerId!=='string')continue;
    const existing=imageTargets.filter(item=>item.shotId===shotId&&item.layerId===layerId);
    if(existing.length!==1)throw new Error('NATIVE_ASSET_NEED_TARGET_INVALID: referenced Shot/image layer does not exist.');
    const expected=row.path??row.expected_path??row.asset_path;
    if(expected!==undefined&&(typeof expected!=='string'||expected!==existing[0].path))
      throw new Error('NATIVE_ASSET_NEED_PATH_MISMATCH: expected asset path differs from actual image layer.');
  }
  if(state.identityPolicy==='v1'){
    if(!appPath)throw Error('IDENTITY_NATIVE_APP_PATH_REQUIRED');
    validateNativeBindingPayload(root,appPath,manifest,payload.asset_needs as unknown[]);
  }
  structuredSoundCues(manifest,payload.sound_script as unknown[],state.tasks?.native?.soundContract==='structured-v1');
  return {manifest,shotLedger:payload.shot_ledger??[],soundScript:payload.sound_script??[],assetNeeds:payload.asset_needs??[],missing:collectMissing(root,state,manifest)};
}
interface PendingImport {
  schema:'mode-b-pending-import-v2';token:string;projectId:string;stage:Stage;
  taskId:string;revision:number;inputSha256:string;responseSha256:string;responsePath:string;
  payloadSha256:string;payload:Record<string,unknown>;before:unknown;
  references:MissingNativeReference[];fulfillments:Record<string,{relative:string;sha256:string;rights:string;kind:'image'|'sfx'}>;
  createdAt:string;
  draftHistory?:NativeDraftRevision[];
  publishedCorrection?:{correctTaskId:string;baselineSha256:string;receiptSha:string};
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
    if(pending.draftHistory.length){
      const author=strictJson(readUtf8(frozenResponse)) as {payload?:Record<string,unknown>};
      const p=author.payload;
      const first=pending.draftHistory[0];
      if(pending.publishedCorrection){
        const origin=pending.publishedCorrection,reply=author as {task_id?:string;operation?:string;payload?:Record<string,unknown>};
        const corrected=p?.artifact as Record<string,unknown>|undefined;
        if(!corrected||reply.operation!=='correct'||reply.task_id!==origin.correctTaskId||
          first.correctTaskId!==origin.correctTaskId||p?.artifact_sha256!==origin.baselineSha256||
          first.previousSha256!==origin.baselineSha256||
          first.artifactSha256!==sha(JSON.stringify({manifest:corrected.manifest,shot_ledger:corrected.shot_ledger,
            sound_script:corrected.sound_script,asset_needs:corrected.asset_needs})))
          throw Error('NATIVE_PUBLISHED_CORRECTION_LINEAGE_INVALID');
      }else if(!p||first.previousSha256!==sha(JSON.stringify({
        manifest:p.manifest,shot_ledger:p.shot_ledger,sound_script:p.sound_script,asset_needs:p.asset_needs
      })))throw new Error('NATIVE_DRAFT_AUTHOR_LINEAGE_INVALID');
    }
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
        (stored as {correctTaskId?:string}).correctTaskId!==item.correctTaskId||
        (stored as {reviewTaskId?:string}).reviewTaskId!==item.reviewTaskId||
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
  if(pending.publishedCorrection&&(readNativeIdentityReceipt(root)?.receiptSha!==pending.publishedCorrection.receiptSha||
    sha(JSON.stringify(publishedNativeCreativeArtifact(root,state)))!==pending.publishedCorrection.baselineSha256))
    throw Error('NATIVE_PUBLISHED_CORRECTION_BASELINE_STALE');
  const artifact=nativeDraftValue(pending);
  return{context:'DRAFT' as const,token:pending.token,authorTaskId:pending.taskId,
    revision:1+(pending.draftHistory?.length??0),artifact,sha256:sha(JSON.stringify(artifact)),
    history:pending.draftHistory??[],...(pending.publishedCorrection?{publishedCorrectionTaskId:pending.publishedCorrection.correctTaskId}:{})};
}
export async function inspectCurrentNativePlan(appPath:string,root:string){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft||state.identityPolicy!=='v1')return null;
  const report=await inspectNativePlan(appPath,root,draft.artifact.manifest,nativeVoiceTiming(root,state).timelineDuration,draft.sha256);
  const latest=readNativeDraft(root);if(!latest||latest.sha256!==draft.sha256||latest.token!==draft.token||nativeVoiceTiming(root,readState(root)).timelineDuration!==nativeVoiceTiming(root,state).timelineDuration)throw Error('NATIVE_PLAN_STALE_DURING_VALIDATION');
  return report;
}
export async function requireCurrentNativePlan(appPath:string,root:string){
  const report=await inspectCurrentNativePlan(appPath,root);
  if(report&&report.plan!=='PASS')throw Error('NATIVE_PLAN_'+report.plan+' ['+report.candidateSha+']: '+report.error);
  return report;
}
/** Creative authority is a confirmed independent review, not a structural validator.
 * Bind the verdict to the complete current artifact and original Author task. */
export function requireReviewedNativeDraft(state:StudioState,draft:NonNullable<ReturnType<typeof readNativeDraft>>,identityEvidenceSha:string){
  const rows=Object.values(state.lifecycle?.artifacts??{}).filter(row=>
    row.stage==='native'&&(row.operation==='review'||row.operation==='recheck')&&
    row.artifactContext==='DRAFT'&&row.draftToken===draft.token&&row.draftAuthorTaskId===draft.authorTaskId&&
    (!draft.publishedCorrectionTaskId||(row.draftRevision===draft.revision&&row.sourceCorrectTaskId===draft.history.at(-1)?.correctTaskId))&&
    (row.value as {artifact_sha256?:string})?.artifact_sha256===draft.sha256)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.taskId.localeCompare(a.taskId));
  const latest=rows[0];
  const result=latest?.value as {artifact_sha256?:string;status?:string;findings?:unknown[];coverage?:{target_ids?:string[];modalities?:string[]}}|undefined;
  const manifest=draft.artifact.manifest as {shots?:Array<{id:string}>};
  const targets=(manifest.shots??[]).map(shot=>shot.id);
  if(!latest||latest.identityEvidenceSha!==identityEvidenceSha||latest.status!=='REVIEWED_NO_FINDINGS'||result?.status!=='REVIEWED_NO_FINDINGS'||
    latest.artifactSha256!==sha(JSON.stringify(result))||
    !Array.isArray(result.findings)||result.findings.some(f=>(f as {status?:string})?.status!=='resolved')||
    !Array.isArray(result.coverage?.target_ids)||result.coverage.target_ids.length!==targets.length||
    new Set(result.coverage.target_ids).size!==targets.length||
    targets.some(id=>!result.coverage!.target_ids!.includes(id))||
    !result.coverage.modalities?.includes('manifest')||
    (draft.history.length>0&&latest.operation!=='recheck'))
    throw Error('NATIVE_CREATIVE_REVIEW_REQUIRED: confirm a clean Review or Recheck for the exact current Native draft.');
  return latest.artifactSha256;
}
/** Fingerprint only the target's effective visual instructions and global
 * visual dependencies, never the entire draft or unrelated Shot revisions. */
function imageTargetIdentity(
  state:StudioState,authorTaskId:string,token:string,draftRevision:number,
  artifact:{manifest:unknown;shot_ledger:unknown;asset_needs:unknown},targetKey:string
){
  const manifest=artifact.manifest as Record<string,unknown>;
  const reference=nativeRefs(manifest).find(item=>item.kind==='image'&&item.key===targetKey);
  if(!reference||!reference.shotId||!reference.layerId||reference.shotIndex===undefined)
    throw new Error('GLABS_TARGET_NOT_FROZEN');
  const shot=(manifest.shots as Array<Record<string,unknown>>)[reference.shotIndex];
  if(!shot||shot.id!==reference.shotId)throw new Error('GLABS_TARGET_SHOT_IDENTITY_INVALID');
  // Scope documented freeform legacy rows by explicit Shot/Layer/path. Editing
  // another legacy asset_need must never invalidate this image's job.
  const aux=(rows:unknown)=>Array.isArray(rows)?rows.filter(value=>{
    let row:Record<string,unknown>;
    if(typeof value==='string'){
      const pick=(key:string)=>new RegExp('(?:^|\\|)\\s*'+key+'=([^|]+)').exec(value)?.[1]?.trim();
      row={shot_id:pick('shot_id'),layer_id:pick('layer_id'),
        expected_path:pick('expected_path')??pick('asset_path')??pick('path')};
    }else if(value&&typeof value==='object'&&!Array.isArray(value))row=value as Record<string,unknown>;
    else return true;
    const shotId=row.shot_id??row.shotId??row.target_shot_id??row.targetShotId;
    const layerId=row.layer_id??row.layerId??row.target_layer_id??row.targetLayerId;
    const expectedPath=row.path??row.expected_path??row.asset_path;
    if(typeof shotId==='string'&&shotId!==reference.shotId)return false;
    if(typeof layerId==='string'&&layerId!==reference.layerId)return false;
    if(typeof expectedPath==='string'&&expectedPath!==reference.path)return false;
    return true; // Truly unscoped instruction can affect every image.
  }):[];
  const findLayer=(layers:unknown[]):Record<string,unknown>|null=>{
    for(const value of layers){
      if(!value||typeof value!=='object'||Array.isArray(value))continue;
      const row=value as Record<string,unknown>;
      if(row.type==='image'&&row.id===reference.layerId&&row.path===reference.path)return row;
      if(Array.isArray(row.children)){const found=findLayer(row.children);if(found)return found;}
    }
    return null;
  };
  const targetLayer=findLayer(Array.isArray(shot.layers)?shot.layers:[]);
  if(!targetLayer)throw new Error('GLABS_TARGET_LAYER_IDENTITY_INVALID');
  const {layers:_otherLayers,...shotContext}=shot;
  void _otherLayers; // Other layers are not this target's creative instructions.
  const fingerprint=sha(JSON.stringify({
    project_id:state.project.id,author_task_id:authorTaskId,
    author_task_revision:state.tasks?.native?.revision,draft_token:token,
    style:manifest.style,width:manifest.width,height:manifest.height,fps:manifest.fps,
    opening:reference.shotIndex===0?manifest.opening??null:null,
    shot_index:reference.shotIndex,shot_id:reference.shotId,
    layer_id:reference.layerId,expected_path:reference.path,
    shot_context:shotContext,target_layer:targetLayer,
    shot_ledger:aux(artifact.shot_ledger),
    asset_needs:imageRequirementFingerprintSources(Array.isArray(artifact.asset_needs)?artifact.asset_needs:[],
      {shotId:reference.shotId,layerId:reference.layerId,path:reference.path})
  }));
  return {fingerprint,authorTaskId,draftRevision,targetKey,
    shotId:reference.shotId,layerId:reference.layerId,path:reference.path};
}
/** Compute target identity from a snapshot already verified by readNativeDraft.
 * Avoid rereading the full project and Native DRAFT once per image target. */
export function nativeImageTargetIdentityFromSnapshot(
  state:StudioState,draft:NonNullable<ReturnType<typeof readNativeDraft>>,targetKey:string
){
  return imageTargetIdentity(state,draft.authorTaskId,draft.token,draft.revision,draft.artifact,targetKey);
}
/** Current project-owned draft identity, including immutable Author provenance. */
export function nativeImageTargetIdentity(root:string,targetKey:string){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)throw new Error('GLABS_NATIVE_DRAFT_REQUIRED');
  return nativeImageTargetIdentityFromSnapshot(state,draft,targetKey);
}
/** Publish an immutable corrected draft revision without touching original Author
 * response, published project.json or unrelated accepted media. */
export function publishNativeDraftCorrection(appPath:string,root:string,originalSha256:string,
  corrected:Record<string,unknown>,proof:{correctTaskId:string;reviewTaskId:string;
    editableIds:string[];editablePaths:string[];findingIds:string[]}){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)throw new Error('NATIVE_DRAFT_REQUIRED');
  const normalized=validateManifest(state,root,corrected,appPath);
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
  const nextRefs=pending.publishedCorrection?nativeRefs(normalized.manifest):normalized.missing;
  if(pending.token!==draft.token)throw new Error('NATIVE_DRAFT_TOKEN_CHANGED');
  const kept=Object.fromEntries(Object.entries(pending.fulfillments).filter(([key,binding])=>{
    const previous=pending.references.find(ref=>ref.key===key);
    const next=nextRefs.find(ref=>ref.key===key);
    if(!previous||!next||JSON.stringify(previous)!==JSON.stringify(next))return false;
    if(previous.kind==='image'){
      // Even unchanged IDs/paths cannot reuse a paid image when its creative
      // Shot, relevant ledger or image requirement changed in the new draft.
      const oldIdentity=imageTargetIdentity(state,draft.authorTaskId,draft.token,
        draft.revision,nativeDraftValue(pending),key);
      const newIdentity=imageTargetIdentity(state,draft.authorTaskId,draft.token,
        draft.revision+1,newArtifact,key);
      if(oldIdentity.fingerprint!==newIdentity.fingerprint)return false;
    }else{
      const oldCue=structuredSoundCues(draft.artifact.manifest,draft.artifact.sound_script as unknown[]).find(c=>c.key===key);
      const newCue=structuredSoundCues(normalized.manifest,normalized.soundScript as unknown[]).find(c=>c.key===key);
      if(JSON.stringify(oldCue??null)!==JSON.stringify(newCue??null))return false;
    }
    const saved=state.media?.find(row=>row.path===binding.relative&&row.kind===binding.kind&&
      row.sha256===binding.sha256&&row.rights===binding.rights);
    const file=resolveProjectFile(root,binding.relative);
    return Boolean(saved&&fs.existsSync(file)&&sha(fs.readFileSync(file))===binding.sha256);
  }));
  if(pending.publishedCorrection)pruneUnfulfilledContinuity(root,appPath,newArtifact,kept);
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
    references:nextRefs,fulfillments:kept,
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
/** Published project.json contains fulfilled media paths; creative asset_needs
 * retains the authored expected paths. Reverse ONLY this explicit mapping
 * for a v1 Published Review/Correct, never modify the renderer's file. */
export function publishedNativeCreativeArtifact(root:string,state:StudioState){
  const native=state.external.native;
  if(!native)throw Error('NATIVE_PUBLISHED_BASELINE_REQUIRED');
  const bytes=fs.readFileSync(resolveProjectFile(root,'project.json'));
  const manifest=strictJson(bytes.toString('utf8')) as Record<string,unknown>;
  const existing=native.artifact as {shotLedger?:unknown[];soundScript?:unknown[];assetNeeds?:unknown[]};
  const asset_needs=existing.assetNeeds??[];
  const receipt=readNativeIdentityReceipt(root);
  if(!receipt||receipt.nativeProjectSha!==sha(bytes))throw Error('IDENTITY_PUBLISHED_NATIVE_SOURCE_STALE');
  for(const ref of nativeRefs(manifest).filter(row=>row.kind==='image')){
    const need=asset_needs.find(value=>{
      const row=value as {shot_id?:string;layer_id?:string}|null;
      return row!=null&&row.shot_id===ref.shotId&&row.layer_id===ref.layerId;
    }) as {expected_path?:string}|undefined;
    if(typeof need?.expected_path!=='string')throw Error('NATIVE_PUBLISHED_ASSET_NEED_MISSING');
    const bound=receipt.rows.find(row=>row.targetKey===ref.key);
    if(bound?(bound.imagePath!==ref.path||bound.shotId!==ref.shotId||bound.layerId!==ref.layerId):
      ref.path!==need.expected_path)throw Error('NATIVE_PUBLISHED_MAPPING_STALE');
    exactNativeTarget(manifest,ref).path=need.expected_path;
  }
  return{manifest,shot_ledger:existing.shotLedger??[],sound_script:existing.soundScript??[],asset_needs};
}
function pruneUnfulfilledContinuity(root:string,appPath:string,artifact:{manifest:Record<string,unknown>;asset_needs:unknown},
  kept:PendingImport['fulfillments']){
  const plans=validateNativeBindingPayload(root,appPath,artifact.manifest,artifact.asset_needs as unknown[]).plans;
  const byLayer=new Map(plans.map(plan=>[plan.shotId+'/'+plan.layerId,plan.targetKey]));
  for(const plan of plans){
    const source=plan.continuitySource;
    if(source&&!kept[byLayer.get(source.shot_id+'/'+source.layer_id)??''])delete kept[plan.targetKey];
  }
}
/** Reopen the original Author provenance for an explicitly confirmed Published
 * Correct. Existing image approvals retain their immutable token and fingerprint.
 * The actual lifecycle Correct response is the frozen response, not a synthetic
 * AI Author reply. The last-good publication remains untouched until Confirm. */
export function stagePublishedNativeCorrection(appPath:string,root:string,
  corrected:Record<string,unknown>,proof:{correctTaskId:string;reviewTaskId:string;
    editableIds:string[];editablePaths:string[];findingIds:string[];baselineSha256:string;responseSha256:string}){
  const state=readState(root);
  if(state.identityPolicy!=='v1')throw Error('NATIVE_PUBLISHED_CORRECTION_POLICY_REQUIRED');
  if(fs.existsSync(pendingPath(root))){
    const active=readPending(root);
    if(active.publishedCorrection?.correctTaskId===proof.correctTaskId){
      const task=state.tasks?.native;
      if(!task||task.id!==active.taskId||active.responseSha256!==proof.responseSha256||
        active.publishedCorrection.baselineSha256!==proof.baselineSha256||
        readNativeIdentityReceipt(root)?.receiptSha!==active.publishedCorrection.receiptSha)
        throw Error('NATIVE_PUBLISHED_CORRECTION_RECOVERY_REQUIRED');
      if(task.status==='IMPORTED'){
        task.status='FROZEN';task.sourceFingerprint=sourceFingerprint(appPath,root,'native');
        task.assetBaseline=assetSnapshot(root);task.mediaBaseline=mediaSnapshot(state);writeState(root,state);
      }
      return readNativeDraft(root)!;
    }
    throw Error('NATIVE_PUBLISHED_CORRECTION_DRAFT_CONFLICT: resolve the existing draft first.');
  }
  const author=state.tasks?.native;
  if(!author||author.status!=='IMPORTED')throw Error('NATIVE_PUBLISHED_AUTHOR_REQUIRED');
  const receipt=assertPublishedIdentityCurrent(root,appPath,'SAMPLE')!;
  const baseline=publishedNativeCreativeArtifact(root,state);
  if(sha(JSON.stringify(baseline))!==proof.baselineSha256)throw Error('NATIVE_PUBLISHED_CORRECTION_BASELINE_STALE');
  const normalized=validateManifest(state,root,corrected,appPath);
  const artifact={manifest:normalized.manifest,shot_ledger:normalized.shotLedger,
    sound_script:normalized.soundScript,asset_needs:normalized.assetNeeds};
  const verified=validateNativeBindingPayload(root,appPath,artifact.manifest,artifact.asset_needs as unknown[]);
  const oldPlans=validateNativeBindingPayload(root,appPath,baseline.manifest,baseline.asset_needs).plans;
  const oldRefs=nativeRefs(baseline.manifest),refs=nativeRefs(artifact.manifest);
  const originalApprovals=receipt.rows.map(row=>{
    if(row.sourceJobId){
      const job=readGlabsJob(root,row.sourceJobId);
      return{row,token:job.token,authorTaskId:job.authorTaskId,creative:job.targetCreativeSha256,
        previous:job.identityPreviousSourceSha??null,rights:job.approved!.rights};
    }
    const owner=verifyOwnerImageApproval(state,{approvalId:row.ownerApprovalId,targetKey:row.targetKey,
      shotId:row.shotId,layerId:row.layerId,imagePath:row.imagePath,imageSha:row.imageSha,
      targetBindingSha:row.targetBindingSha,previousDependencySha:row.previousDependencySha});
    if(!owner)throw Error('NATIVE_PUBLISHED_OWNER_APPROVAL_MISSING');
    const media=state.media?.find(item=>item.ownerImageApproval?.approvalId===owner.approvalId);
    if(!media)throw Error('NATIVE_PUBLISHED_OWNER_MEDIA_MISSING');
    return{row,token:owner.draftToken,authorTaskId:owner.authorTaskId,creative:owner.targetCreativeSha,
      previous:owner.previousDependencySha,rights:media.rights};
  });
  const token=originalApprovals[0]?.token??randomUUID();
  if(originalApprovals.some(item=>item.token!==token||item.authorTaskId!==author.id))
    throw Error('NATIVE_PUBLISHED_AUTHOR_LINEAGE_MISMATCH');
  const kept:PendingImport['fulfillments']={};
  for(const item of originalApprovals){
    const {row}=item,key=row.targetKey;
    const before=oldRefs.find(ref=>ref.key===key),after=refs.find(ref=>ref.key===key);
    const priorPlan=oldPlans.find(plan=>plan.targetKey===key),plan=verified.plans.find(plan=>plan.targetKey===key);
    if(!before||!after||!priorPlan||!plan||JSON.stringify(before)!==JSON.stringify(after)||
      priorPlan.targetBindingSha!==row.targetBindingSha||plan.targetBindingSha!==row.targetBindingSha||
      item.previous!==row.previousDependencySha)continue;
    const oldIdentity=imageTargetIdentity(state,author.id,token,1,baseline,key);
    const newIdentity=imageTargetIdentity(state,author.id,token,2,artifact,key);
    if(oldIdentity.fingerprint!==item.creative||newIdentity.fingerprint!==item.creative||
      !verifiedMedia(root,state,after,row.imagePath,item.rights))continue;
    kept[key]={relative:row.imagePath,sha256:row.imageSha,rights:item.rights,kind:'image'};
  }
  // Previously fulfilled audio is already present at its exact licensed path.
  pruneUnfulfilledContinuity(root,appPath,artifact,kept);
  const responsePath='.studio/external/lifecycle/results/'+proof.correctTaskId+'.json';
  if(sha(fs.readFileSync(resolveProjectFile(root,responsePath)))!==proof.responseSha256)
    throw Error('NATIVE_PUBLISHED_CORRECTION_RESPONSE_STALE');
  const artifactSha256=sha(JSON.stringify(artifact));
  const recordPath='.studio/external/draft-revisions/native-'+randomUUID()+'.json';
  const revisionRecord={schema:'mode-b-native-draft-revision-v1' as const,revision:2,authorTaskId:author.id,
    previousSha256:proof.baselineSha256,artifactSha256,correctTaskId:proof.correctTaskId,
    reviewTaskId:proof.reviewTaskId,authorizedEditableIds:proof.editableIds,
    authorizedEditablePaths:proof.editablePaths,authorizedFindingIds:proof.findingIds};
  const recordFile=resolveProjectFile(root,recordPath);
  fs.mkdirSync(path.dirname(recordFile),{recursive:true});
  fs.writeFileSync(recordFile,JSON.stringify({...revisionRecord,artifact},null,2)+'\n',{flag:'wx'});
  const pending:PendingImport={schema:'mode-b-pending-import-v2',token,projectId:state.project.id,stage:'native',
    taskId:author.id,revision:author.revision,inputSha256:author.inputSha256,responsePath,
    responseSha256:proof.responseSha256,payload:normalized,payloadSha256:sha(JSON.stringify(normalized)),
    before:baseline.manifest,references:refs,fulfillments:kept,createdAt:new Date().toISOString(),
    publishedCorrection:{correctTaskId:proof.correctTaskId,baselineSha256:proof.baselineSha256,receiptSha:receipt.receiptSha},
    draftHistory:[{...revisionRecord,recordPath,recordSha256:sha(fs.readFileSync(recordFile))}]};
  // Persist the pending record first. If state writing is interrupted, the
  // identical Confirm Correct can resume this exact original author/token.
  atomicJson(pendingPath(root),pending);
  author.status='FROZEN';author.sourceFingerprint=sourceFingerprint(appPath,root,'native');
  author.assetBaseline=assetSnapshot(root);author.mediaBaseline=mediaSnapshot(state);
  writeState(root,state);
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
    if(original.kind==='sfx'){
      const cue=structuredSoundCues(value.manifest,Array.isArray(value.soundScript)?value.soundScript:[]).find(c=>c.key===key);
      const registered=state.media?.find(row=>row.kind==='sfx'&&row.path===binding.relative&&row.sha256===binding.sha256&&row.rights===binding.rights&&row.track===original.track&&row.trackIndex===original.trackIndex);
      if(cue||registered?.audioReceipt)assertAudioReceipt(root,state.project.id,pending.token,key,binding.relative,binding.sha256,binding.rights,cue,registered?.audioReceipt);
    }
    const target=exactNativeTarget(manifest,original);
    if(target.path!==original.path)throw new Error('Frozen native target path was changed without authorization.');
    target.path=binding.relative;
  }
  const missing=collectMissing(root,state,manifest);
  // A published correction may still have the old approved file at the same
  // path. Only the exact retained/new fulfillment authorizes a managed image.
  if(pending.publishedCorrection)for(const ref of pending.references)
    if(ref.kind==='image'&&!pending.fulfillments[ref.key]&&!missing.some(row=>row.key===ref.key))missing.push(ref);
  return {manifest,missing,shotLedger:value.shotLedger,soundScript:value.soundScript,assetNeeds:value.assetNeeds};
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
  if(stage==='native'&&fs.existsSync(pendingPath(root))){
    const prior=readPending(root);
    if(prior.taskId===task.id&&prior.publishedCorrection)throw Error('NATIVE_PUBLISHED_CORRECTION_DRAFT_ACTIVE: explicitly Rebuild Author to replace it.');
  }
  const envelope=validateEnvelope(state,stage,strictJson(text));
  const payload=stage==='script'?validateScript(envelope.payload):validateManifest(state,root,envelope.payload,appPath);
  const responseSha256=sha(text);
  if(fs.existsSync(pendingPath(root))){
    const prior=readPending(root);
    if(prior.projectId===state.project.id&&prior.taskId===task.id&&prior.revision===task.revision&&prior.stage===stage&&prior.responseSha256===responseSha256)return pendingResult(root,prior);
  }
  if(stage==='native'&&fs.existsSync(pendingPath(root))){const prior=readPending(root);if(prior.taskId!==task.id){const bytes=fs.readFileSync(pendingPath(root)),archive=resolveProjectFile(root,'.studio/external/recovery/pending-'+sha(bytes)+'.json');fs.mkdirSync(path.dirname(archive),{recursive:true});if(!fs.existsSync(archive))fs.writeFileSync(archive,bytes,{flag:'wx'});if(sha(fs.readFileSync(archive))!==sha(bytes))throw Error('NATIVE_PENDING_ARCHIVE_SHA_MISMATCH');}}
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
/** Frozen Native gallery inventory (NOT the shrinking missing-target queue).
 * Exact key/Shot/Layer/path derive from the validated Native DRAFT manifest.
 * The pending projection supplies committed fulfillment paths separately.
 */
export function getNativeImageGallery(_appPath:string,root:string){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)return{token:null,shots:[],targets:[]};
  // Gallery is a READ ONLY inventory: the caller already validates the
  // current Native draft. Do not re-run collectMissing()/verifiedMedia(), which
  // synchronously rehash all bound image files (potentially 200+ large PNGs).
  // Strict on-disk SHA/rights checks remain in pendingMedia and approval/bind.
  const pending=readPending(root);
  if(pending.stage!=='native'||pending.projectId!==state.project.id||
    pending.token!==draft.token||pending.taskId!==draft.authorTaskId)
    throw new Error('NATIVE_GALLERY_DRAFT_TOKEN_MISMATCH');
  const original=draft.artifact.manifest as Record<string,unknown>;
  const originalShots=Array.isArray(original.shots)?original.shots as Array<Record<string,unknown>>:[];
  const frozenRefs=nativeRefs(original).filter(ref=>ref.kind==='image');
  const targets:Array<{key:string;shotId:string;layerId:string;path:string;
    boundPath:string;boundSha256?:string;creativeFingerprint?:string;
    fulfilled:boolean;managed:boolean}>=[];
  const shots=originalShots.map((shot,index)=>{
    const shotId=String(shot.id??'');
    const available:typeof targets=[];
    const visit=(layers:unknown[])=>{
      for(const node of layers){
        if(!node||typeof node!=='object'||Array.isArray(node))continue;
        const layer=node as Record<string,unknown>,layerId=String(layer.id??'');
        if(layer.type==='image'&&isManagedNativeImagePath(layer.path)&&shotId&&layerId){
          const key='image:'+index+':'+layerId;
          const ref=frozenRefs.find(row=>row.key===key&&row.shotId===shotId&&row.path===layer.path);
          const binding=ref?pending.fulfillments[key]:undefined;
          let creativeFingerprint:string|undefined;
          if(ref){
            try{
              creativeFingerprint=imageTargetIdentity(state,draft.authorTaskId,
                draft.token,draft.revision,draft.artifact,key).fingerprint;
            }catch{/* A candidate without verified creative identity cannot be approved. */}
          }
          // Exact committed journal and media metadata must agree before the
          // gallery describes a Layer as fulfilled. This is not a replacement
          // for bytewise SHA validation when a binding is actually used.
          const fulfilled=Boolean(ref&&binding&&binding.kind==='image'&&
            state.media?.some(row=>row.kind==='image'&&row.path===binding.relative&&
              row.sha256===binding.sha256&&row.rights===binding.rights&&
              row.shotId===shotId&&row.layerId===layerId));
          available.push({key,shotId,layerId,path:layer.path,
            boundPath:fulfilled?binding!.relative:layer.path,
            ...(fulfilled?{boundSha256:binding!.sha256}:{}),
            ...(creativeFingerprint?{creativeFingerprint}:{}),
            fulfilled,managed:Boolean(ref)});
        }
        if(Array.isArray(layer.children))visit(layer.children);
      }
    };
    visit(Array.isArray(shot.layers)?shot.layers:[]);
    targets.push(...available);
    return{id:shotId,index,imageCount:available.length};
  });
  if(new Set(targets.map(target=>target.key)).size!==targets.length)
    throw new Error('NATIVE_GALLERY_DUPLICATE_TARGET');
  return{token:draft.token,shots,targets};
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
export function fulfillMedia(appPath:string,root:string,token:string,key:string,relative:string,rights:string,hooks:{afterPending?:()=>void;afterState?:()=>void;ownerReviewed?:true;providerApproval?:true;decode?:IdentityDecoder;audioReceipt?:AudioPreparationReceipt}={}){
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
  if(ref.kind==='image'){
    const rows=(pending.payload as {assetNeeds:unknown[]}).assetNeeds??[];
    const target={shotId:ref.shotId??'',layerId:ref.layerId??'',path:ref.path};
    const reuse=imageRequirementsForTarget(rows,target).effective.find(row=>Boolean((row.source as {reuse_approved?:unknown}|null)?.reuse_approved));
    if(reuse){
      const source=createContinuityResolver(appPath,root).resolve(key);
      if(!source||source.path!==relative||source.sha256!==hash||hooks.ownerReviewed!==true||hooks.providerApproval===true)throw Error('ASSET_REUSE_EXACT_APPROVED_SOURCE_REQUIRED');
    }
    const output=assetOutputForTarget(rows,target);
    const ratios=[...new Set(imageRequirementsForTarget(rows,target).effective.map(row=>row.orientation).filter(v=>['1:1','3:4','4:3','9:16','16:9'].includes(v)))];
    if(ratios.length>1)throw Error('ASSET_ORIENTATION_CONFLICT');
    if(output||ratios.length){
      const decoded=hooks.decode?.(fs.readFileSync(resolveProjectFile(root,relative)));
      if(!decoded)throw Error('ASSET_OUTPUT_DECODE_REQUIRED');
      if(ratios[0])verifyRatio(decoded,ratios[0]);
      if(output)verifyArtwork(decoded,output);
    }
  }
  if(ref.kind==='sfx'){
    const rows=structuredSoundCues((pending.payload as {manifest:Record<string,unknown>}).manifest,(pending.payload as {soundScript:unknown[]}).soundScript??[]);
    const cue=rows.find(row=>row.key===key);
    if(cue||hooks.audioReceipt)assertAudioReceipt(root,state.project.id,pending.token,key,relative,hash,rights.trim(),cue,hooks.audioReceipt);
  }
  const binding={relative,sha256:hash,rights:rights.trim(),kind:ref.kind};
  const previous=pending.fulfillments[key];
  if(previous){if(JSON.stringify(previous)!==JSON.stringify(binding))throw new Error('A frozen target cannot be silently remapped; rebuild/review the task.');return pendingResult(root,pending);}
  if(state.identityPolicy==='v1'&&ref.kind==='image'&&hooks.ownerReviewed!==true&&hooks.providerApproval!==true)
    throw Error('OWNER_IMAGE_EXPLICIT_APPROVAL_REQUIRED');
  let ownerImageApproval:OwnerImageApproval|undefined;
  if(state.identityPolicy==='v1'&&ref.kind==='image'&&hooks.ownerReviewed===true){
    const draft=readNativeDraft(root,state)!;
    const resolver=createContinuityResolver(appPath,root),plan=resolver.getBinding(key);
    const reviewSha=requireReviewedNativeDraft(state,draft,plan.upstreamSnapshotSha);
    const verified=verifyReferenceFile(root,relative,hash),decoded=hooks.decode?.(verified.bytes);
    if(!decoded||!Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
      decoded.width<1||decoded.height<1||!Buffer.isBuffer(decoded.png)||decoded.png.length<24)
      throw Error('OWNER_IMAGE_DECODE_REQUIRED');
    const body:Omit<OwnerImageApproval,'approvalSha'>={
      schema:'owner-native-image-approval-v1',approvalId:randomUUID(),projectId:state.project.id,
      draftToken:draft.token,authorTaskId:draft.authorTaskId,targetKey:key,shotId:plan.shotId,layerId:plan.layerId,
      imagePath:relative,imageSha:hash,rightsSha:contentHash(rights.trim()),
      targetCreativeSha:nativeImageTargetIdentityFromSnapshot(state,draft,key).fingerprint,
      targetBindingSha:plan.targetBindingSha,previousDependencySha:resolver.resolve(key)?.dependencySha??null,
      reviewSha,approvedAt:new Date().toISOString()};
    ownerImageApproval={...body,approvalSha:contentHash(body)};
  }
  const mapped={...original,...(ref.kind==='image'?{shotId:ref.shotId,layerId:ref.layerId}:{track:ref.track,trackIndex:ref.trackIndex}),
    ...(ownerImageApproval?{ownerImageApproval}:{}),...(hooks.audioReceipt?{audioReceipt:hooks.audioReceipt}:{})};
  const pendingBefore=structuredClone(pending);state.media=[...(state.media??[]).filter(item=>!(item.path===relative&&item.shotId===ref.shotId&&item.layerId===ref.layerId&&item.track===ref.track&&item.trackIndex===ref.trackIndex)||
    Boolean(pending.publishedCorrection&&item.ownerImageApproval&&item.ownerImageApproval.approvalId!==ownerImageApproval?.approvalId)),mapped];
  pending.fulfillments[key]=binding;
  atomicJson(fulfillmentTxnPath(root),{schema:'media-fulfillment-transaction-v2',pendingBefore,key,binding,ownedMapping:mapped,createdAt:new Date().toISOString()});
  try{atomicJson(pendingPath(root),pending);hooks.afterPending?.();writeState(root,state);hooks.afterState?.();fs.unlinkSync(fulfillmentTxnPath(root));return pendingResult(root,pending)}catch(error){atomicJson(pendingPath(root),pendingBefore);const rollback=readState(root);rollback.media=withoutOwnedMapping(rollback.media,mapped);writeState(root,rollback);if(fs.existsSync(fulfillmentTxnPath(root)))fs.unlinkSync(fulfillmentTxnPath(root));throw error}
}
type Validator=(exe:string,args:string[],options:{cwd:string})=>Promise<{code:number;stdout:string;stderr:string}>;
export interface ConfirmOptions { previewSeconds?:number; allowSampleDraft?:boolean; fullProduction?:true; validator?:Validator }
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
  if(state.identityPolicy==='v1'){
    const draft=readNativeDraft(root,state)!;
    await nativePlanPreflight(appPath,root,draft.artifact.manifest,nativeVoiceTiming(root,state).timelineDuration,draft.sha256);
    const latest=readPending(root);
    if(latest.token!==pending.token||latest.payloadSha256!==pending.payloadSha256||JSON.stringify(latest.fulfillments)!==JSON.stringify(pending.fulfillments))throw Error('NATIVE_PLAN_STALE_DURING_VALIDATION');
  }
  const resolved=resolvePendingCandidate(root,state,pending);
  if(options.fullProduction&&resolved.missing.length)throw Error('FULL_PRODUCTION_MEDIA_REQUIRED: '+resolved.missing.map(ref=>ref.key).join(', '));
  const missingInside=resolved.missing.filter(ref=>ref.scopeStart<seconds);
  if(missingInside.length)throw new Error('Missing media inside the selected sample: '+missingInside.map(item=>item.key).join(', '));
  const identitySampleReceipt=state.identityPolicy==='v1'?
    currentDraftIdentityReceipt(root,appPath,seconds):null;
  const identityFullReceipt=state.identityPolicy==='v1'&&
    !resolved.missing.some(ref=>ref.kind==='image')?
    currentDraftIdentityReceipt(root,appPath):null;
  const identityReceiptFile=state.identityPolicy==='v1'?
    resolveProjectFile(root,'.studio/identity/native-publication-v1.json'):null;
  const beforeIdentityReceiptBytes=identityReceiptFile&&fs.existsSync(identityReceiptFile)?
    fs.readFileSync(identityReceiptFile):null;
  let writtenIdentityReceiptSha:string|null=null;
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
      else if(options.fullProduction)throw Error('FULL_PRODUCTION_VALIDATION_FAILED: '+(result.stderr.trim()||result.stdout.trim()||'Original full validator failed.'));
    }
    if(!full&&!options.allowSampleDraft)throw new Error('Only SAMPLE_READY. Explicitly approve incomplete draft promotion; full-film is not ready.');
    const identityReceipt=full?identityFullReceipt:identitySampleReceipt;
    if(state.identityPolicy==='v1'&&!identityReceipt)
      throw Error('IDENTITY_FULL_NATIVE_MEDIA_UNVERIFIED');
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
    if(identityReceipt&&JSON.stringify(currentDraftIdentityReceipt(root,appPath,
      identityReceipt.scope==='SAMPLE'?seconds:undefined))!==
      JSON.stringify(identityReceipt))
      throw new Error('IDENTITY_NATIVE_DRAFT_LINEAGE_CHANGED_DURING_CLI');
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
    fresh.nativeReadiness=readiness;fresh.preview=undefined;fresh.approval=undefined;fresh.render=undefined;fresh.tasks!.native!.status='IMPORTED';
    // A Published Correct is already journaled under its own lifecycle task.
    // Keep the original Author response identity instead of relabeling Correct JSON.
    if(!pending.publishedCorrection){fresh.tasks!.native!.confirmedResponseSha256=pending.responseSha256;fresh.tasks!.native!.confirmedResponsePath=pending.responsePath;}
    committedState=fresh;writeState(root,fresh);stateCommitted=true;
    if(identityReceipt){
      const published=publishNativeIdentityReceipt(root,appPath,
        identityReceipt,sha(fs.readFileSync(current)));
      writtenIdentityReceiptSha=published.receiptSha;
    }
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
    // The Studio-only receipt is part of this Native Confirm transaction.
    // Restore prior exact bytes only if our committed receipt is still the
    // current one and the manifest/state rollback has not conflicted with
    // any newer independent change. Never overwrite a newer receipt.
    if(writtenIdentityReceiptSha&&identityReceiptFile){
      const currentReceipt=fs.existsSync(identityReceiptFile)?
        strictJson(fs.readFileSync(identityReceiptFile,'utf8')) as Record<string,unknown>:null;
      if(currentReceipt?.receiptSha!==writtenIdentityReceiptSha)conflict=true;
      else if(!conflict){
        if(beforeIdentityReceiptBytes){
          const restored=identityReceiptFile+'.'+randomUUID()+'.restore';
          fs.writeFileSync(restored,beforeIdentityReceiptBytes,{flag:'wx'});
          fs.renameSync(restored,identityReceiptFile);
        }else fs.unlinkSync(identityReceiptFile);
      }
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
export function activateScriptCandidate(root:string,state:StudioState,source:'AUTHOR_IMPORT'|'RECHECK',ownerAuthorized=false):boolean {
  if(state.identityPolicy==='v1'&&!ownerAuthorized)return false;
  const candidate=state.scriptCandidate;
  if(!candidate||sha(candidate.text)!==candidate.sha256||
    candidate.sections.map(row=>row.text).join('\n\n')!==candidate.text)
    throw new Error('No current verified Script candidate is available.');
  if(source==='AUTHOR_IMPORT'&&state.tasks?.script?.id!==candidate.taskId)
    throw new Error('STALE: Script Author task no longer owns this candidate.');
  if(source==='RECHECK'&&!scriptCorrectionRechecked(state))
    throw new Error('RECHECK_REQUIRED: corrected Script must pass a current independent Recheck.');
  if(state.approvedScript?.sha256===candidate.sha256&&(!ownerAuthorized||state.approvedScript.revision===candidate.revision)&&
    JSON.stringify(state.approvedScript.authoring??null)===JSON.stringify(candidate.authoring??null))return false;
  const changed=state.approvedScript?.sha256!==candidate.sha256;
  const creativeChanged=JSON.stringify(state.approvedScript?.authoring??null)!==JSON.stringify(candidate.authoring??null);
  const approved:NonNullable<StudioState['approvedScript']>={
    sections:candidate.sections,text:candidate.text,sha256:candidate.sha256,revision:candidate.revision,
    approvedAt:new Date().toISOString(),approvedBy:ownerAuthorized?'OWNER':'AUTO',
    approvalNote:ownerAuthorized?'Owner explicitly approved the exact Script candidate.':source==='AUTHOR_IMPORT'?'Auto-activated after confirmed Script Author import.':'Auto-activated after passed Script Recheck.',
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

export function approveCurrentScript(root:string,input:{sha256:string;revision:number;taskId:string;ownerAuthorized:true}){
 const state=readState(root),candidate=state.scriptCandidate;
 if(input.ownerAuthorized!==true||!candidate||candidate.sha256!==input.sha256||candidate.revision!==input.revision||candidate.taskId!==input.taskId)throw Error('SCRIPT_APPROVAL_STALE');
 const corrected=state.lifecycle?.tasks['script:correct']?.id===candidate.taskId;
 if(!corrected&&state.tasks?.script?.status!=='IMPORTED')throw Error('SCRIPT_IMPORT_REQUIRED');
 if(state.identityPolicy==='v1'){
   const op=corrected?'recheck':'review',candidateSha=sha(JSON.stringify(candidate));
   const report=Object.values(state.lifecycle?.artifacts??{}).filter(x=>x.stage==='script'&&x.operation===op&&(x.value as {artifact_sha256?:string}).artifact_sha256===candidateSha).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
   if(!report||report.status!=='REVIEWED_NO_FINDINGS'||report.artifactSha256!==sha(JSON.stringify(report.value)))throw Error('SCRIPT_INDEPENDENT_REVIEW_REQUIRED');
 }
 if(activateScriptCandidate(root,state,corrected?'RECHECK':'AUTHOR_IMPORT',true))writeState(root,state);
 return state;
}
