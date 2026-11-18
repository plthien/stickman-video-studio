import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,inspectWavBuffer,readState,resolveProjectFile,sha,strictJson,writeState,type ExternalOperation,type Stage,type StudioState} from './services.js';
import {compileAuthority} from './externalAuthority.js';
import {getCaptionReview,nativeVoiceTiming} from './captionReview.js';
import {alignmentText} from './alignment.js';
import {invalidateGlabsJobsAfterNativeCorrection} from './glabs.js';
import {rejectNativeUnsafePaths,validateAuthoring} from './sourceCitations.js';
import {activateScriptCandidate,scriptCorrectionRechecked,freezeTask,sourceFingerprint,stageImport,confirmImport,validateScript,validateManifest,externalJsonFileDelivery,readNativeDraft,publishNativeDraftCorrection,type ConfirmOptions} from './externalTasks.js';

type Scope={targetIds?:string[];editableIds?:string[];editablePaths?:string[];findingIds?:string[];targetContext?:'DRAFT'|'PUBLISHED';media?:'preview'|'film'|'voice'|'captions';transferAcknowledged?:boolean};
/** Active execution boundary; persisted Media Review types remain readable for legacy projects. */
function requireActiveLifecycleOperation(operation:Exclude<ExternalOperation,'author'>):void{
  if(operation==='media-review')throw new Error('MEDIA_REVIEW_DISABLED: legacy history is read-only.');
}
type Artifact={value:unknown;sha256:string;id:string;context?:'DRAFT'|'PUBLISHED';draftRevision?:number;draftToken?:string;authorTaskId?:string};
const exact=(value:Record<string,unknown>,keys:string[])=>{const extra=Object.keys(value).filter(key=>!keys.includes(key));if(extra.length)throw new Error(`Unknown field: ${extra[0]}`)};
const lifecycleDir=(root:string)=>resolveProjectFile(root,'.studio/external/lifecycle');
const resultPath=(root:string,id:string)=>path.join(lifecycleDir(root),'results',id+'.json');
const pendingPath=(root:string)=>path.join(lifecycleDir(root),'pending.json');
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);

/** Source-exact, read-only Native lifecycle evidence. No character-level timing. */
function nativeLifecycleEvidence(root:string,state:StudioState){
  const script=state.approvedScript,voice=state.voice,alignment=state.alignment;
  if(!script||sha(script.text)!==script.sha256||!Array.isArray(script.sections)||
    script.sections.map(row=>row.text).join('\n\n')!==script.text)
    throw new Error('NATIVE_LIFECYCLE_APPROVED_NARRATION_INVALID');
  if(!voice||voice.stale||typeof voice.duration!=='number'||!Number.isFinite(voice.duration)||voice.duration<=0)
    throw new Error('NATIVE_LIFECYCLE_ACCEPTED_WAV_INVALID');
  const wavBytes=fs.readFileSync(resolveProjectFile(root,voice.path));
  const wav=inspectWavBuffer(wavBytes);
  if(wav.sha256!==voice.sha256||Math.abs(wav.duration-voice.duration)>.02)
    throw new Error('NATIVE_LIFECYCLE_ACCEPTED_WAV_INVALID');
  if(!alignment||alignment.audioSha256!==voice.sha256||
    alignment.scriptSha256!==sha(alignmentText(script.text))||!alignment.wordsSha256)
    throw new Error('NATIVE_LIFECYCLE_ALIGNMENT_STALE');
  const duration=voice.duration;
  const bytes=fs.readFileSync(resolveProjectFile(root,alignment.path));
  if(sha(bytes)!==alignment.wordsSha256)throw new Error('NATIVE_LIFECYCLE_WORDS_SHA_MISMATCH');
  const raw=strictJson(bytes.toString('utf8')) as {words?:Array<{word:string;start:number;end:number}>};
  if(!Array.isArray(raw.words)||!raw.words.length)throw new Error('NATIVE_LIFECYCLE_WORDS_MISSING');
  let end=0;
  const words=raw.words.map((row,index)=>{
    if(!row||typeof row.word!=='string'||!row.word.trim()||
      typeof row.start!=='number'||typeof row.end!=='number'||
      !Number.isFinite(row.start)||!Number.isFinite(row.end)||
      row.start<end||row.end<=row.start||row.end>duration+.05)
      throw new Error('NATIVE_LIFECYCLE_WORD_TIMING_INVALID: '+index);
    end=row.end;
    return{word:row.word,start:row.start,end:row.end};
  });
  const captions=getCaptionReview(root);
  if(!['VERIFIED','AUTO_VERIFIED'].includes(captions.status)||!captions.approved)
    throw new Error('NATIVE_LIFECYCLE_APPROVED_CAPTIONS_REQUIRED');
  const timing=nativeVoiceTiming(root,state);
  return{
    approved_narration:{sections:script.sections,authoring:script.authoring??null,
      revision:script.revision,sha256:script.sha256},
    accepted_wav:{path:voice.path,sha256:voice.sha256,duration_seconds:voice.duration},
    verified_word_alignment:{source_sha256:alignment.wordsSha256,ordered_words:words},
    approved_caption_cues:captions.approved.cues,
    voice_timeline:{lead:timing.lead,tail:timing.tail,trim_start:timing.trimStart,
      timeline_duration_seconds:timing.timelineDuration},
    source_fingerprints:{script_sha256:script.sha256,audio_sha256:alignment.audioSha256,
      alignment_words_sha256:alignment.wordsSha256,caption_source_sha256:captions.sourceSha256}
    // The Author task fingerprint is lifecycle bookkeeping, not narration
    // evidence. Native published correction may re-freeze Author on retry;
    // binding it here would falsely stale unchanged WAV/words/captions.
  };
}

function artifactFor(root:string,state:StudioState,stage:Stage,operation:ExternalOperation,
  requested?:'DRAFT'|'PUBLISHED'):Artifact{
  if(stage==='script'){
    const value=state.scriptCandidate??state.approvedScript;if(!value)throw new Error('REVIEW_REQUIRED: no Script candidate or approved Script exists.');
    return{value,sha256:sha(JSON.stringify(value)),id:`script-${value.revision}`};
  }
  const draft=readNativeDraft(root,state),published=Boolean(state.external.native);
  if(draft&&published&&!requested)
    throw new Error('NATIVE_TARGET_SELECTION_REQUIRED: explicitly choose DRAFT or PUBLISHED before reviewing.');
  const context=requested??(draft?'DRAFT':'PUBLISHED');
  if(context==='DRAFT'){
    if(!draft)throw new Error('NATIVE_DRAFT_REQUIRED: no current staged Author candidate.');
    return{value:draft.artifact,sha256:draft.sha256,
      id:'native-draft-'+draft.authorTaskId+'-r'+draft.revision+'-'+operation,
      context,draftRevision:draft.revision,draftToken:draft.token,authorTaskId:draft.authorTaskId};
  }
  const file=path.join(root,'project.json');
  if(!state.external.native||!fs.existsSync(file))
    throw new Error('REVIEW_REQUIRED: no imported Published Native artifact exists.');
  const manifest=strictJson(fs.readFileSync(file,'utf8'));
  const existing=state.external.native.artifact as Record<string,unknown>|undefined;
  const value={manifest,shot_ledger:existing?.shotLedger??[],
    sound_script:existing?.soundScript??[],asset_needs:existing?.assetNeeds??[]};
  return{value,sha256:sha(JSON.stringify(value)),id:'native-'+state.external.native.revision+'-'+operation,
    context:'PUBLISHED'};
}
/** Derive an exact correction scope from the latest CONFIRMED review of the
 * CURRENT artifact. Never authorize edits based on old, unrelated review data.
 * The suggested scope is informational; frozen Correct tasks still lock it.
 */
export function suggestedCorrectScope(
  root:string,state:StudioState,stage:Stage,targetContext?:'DRAFT'|'PUBLISHED',
  selectedFindingIds?:string[]
){
  const empty={editableIds:[] as string[],editablePaths:[] as string[],findingIds:[] as string[],
    reviewTaskId:null as string|null,
    findingScopes:{} as Record<string,{editableIds:string[];editablePaths:string[]}>};
  const selected=selectedFindingIds===undefined?undefined:selectedFindingIds;
  if(selected!==undefined&&(!Array.isArray(selected)||new Set(selected).size!==selected.length||
    selected.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))))
    throw new Error('CORRECT_FINDING_SCOPE_INVALID: selected finding IDs must be unique and valid.');
  let current:Artifact;
  try{current=artifactFor(root,state,stage,'correct',
    targetContext??(stage==='native'&&readNativeDraft(root,state)?'DRAFT':undefined));}
  catch(error){
    if(selected?.length)throw new Error('CORRECT_FINDING_SCOPE_INVALID: current artifact cannot be verified.',{cause:error});
    return empty;
  }
  // Only the most recent confirmed Review/Recheck for the exact artifact and
  // DRAFT/PUBLISHED lineage may authorize inferred corrections.
  const reports=Object.values(state.lifecycle?.artifacts??{})
    .filter(item=>item.stage===stage&&(item.operation==='review'||item.operation==='recheck')&&
      (item.value as {artifact_sha256?:string})?.artifact_sha256===current.sha256&&
      (current.context!=='DRAFT'||(item.draftAuthorTaskId===current.authorTaskId&&item.draftToken===current.draftToken))&&
      (stage!=='native'||item.artifactContext===current.context||
        (current.context==='PUBLISHED'&&!item.artifactContext)))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.taskId.localeCompare(a.taskId));
  const latest=reports[0];
  if(!latest||latest.status!=='REVIEWED_WITH_FINDINGS'){
    if(selected?.length)throw new Error('CORRECT_FINDING_SCOPE_INVALID: selected finding is not unresolved in the current confirmed Review/Recheck.');
    return empty;
  }
  const findings=(latest.value as {findings?:Array<{id:string;status:string;target_ids:string[]}>}).findings??[];
  const unresolved=findings.filter(item=>(item.status==='open'||item.status==='uncertain')&&
    /^[A-Za-z0-9_-]{1,80}$/.test(item.id)&&Array.isArray(item.target_ids));
  const unresolvedIds=unresolved.map(item=>item.id);
  if(selected?.some(id=>!unresolvedIds.includes(id)))
    throw new Error('CORRECT_FINDING_SCOPE_INVALID: selected finding is not unresolved in the current confirmed Review/Recheck.');
  const findingIds=selected??unresolvedIds;
  const findingScopes:Record<string,{editableIds:string[];editablePaths:string[]}>={};
  for(const finding of unresolved){
    const withEvidence=finding as typeof finding & {evidence?:{detail?:string};requirement?:string};
    const evidence=[withEvidence.evidence?.detail,withEvidence.requirement].filter(Boolean).join(' ');
    const paths=stage==='native'?
      [...new Set(evidence.match(/\/(?:shot_ledger|sound_script|asset_needs)\/(?:0|[1-9]\d*)(?:\/[A-Za-z0-9_~\/-]+)+/g)??[])]:[];
    const inferredPaths:string[]=[];
    if(paths.length===1){
      const pointer=paths[0],parts=pointer.slice(1).split('/'),
        collection=(current.value as Record<string,unknown>)[parts[0]];
      if(Array.isArray(collection)){
        const row=collection[Number(parts[1])] as Record<string,unknown>|undefined;
        if(row&&typeof row==='object'&&!Array.isArray(row)){
          const owner=row.shot_id??row.shotId??row.target_id??row.targetId;
          if(typeof owner==='string'&&finding.target_ids.includes(owner)){
            try{checkEditablePaths(stage,current.value,[pointer]);inferredPaths.push(pointer);}
            catch{/* No exact pointer authority: fail closed on inferred auxiliary edits. */}
          }
        }
      }
    }
    // A concrete auxiliary-only finding never grants an entire Shot. A mixed
    // finding may grant both scopes ONLY if it explicitly references a Shot
    // field in the current manifest as well as an existing auxiliary pointer.
    const shotPaths=stage==='native'?
      [...new Set(evidence.match(/\/manifest\/shots\/(?:0|[1-9]\d*)\/(?:[A-Za-z0-9_~\/-]+)/g)??[])]:[];
    const shots=stage==='native'?
      ((current.value as {manifest:{shots?:Array<{id:string}>}}).manifest.shots??[]):[];
    const explicitShotEvidence=shotPaths.some(pointer=>{
      const index=Number(pointer.split('/')[3]),target=shots[index];
      if(!target||!finding.target_ids.includes(target.id))return false;
      try{checkEditablePaths(stage,current.value,[pointer]);return true;}
      catch{return false;}
    });
    const auxiliaryOnly=paths.length>0&&!explicitShotEvidence;
    findingScopes[finding.id]={
      editableIds:auxiliaryOnly?[]:[...new Set(finding.target_ids)],
      editablePaths:inferredPaths
    };
  }
  return{
    editableIds:[...new Set(findingIds.flatMap(id=>findingScopes[id]?.editableIds??[]))],
    editablePaths:[...new Set(findingIds.flatMap(id=>findingScopes[id]?.editablePaths??[]))],
    findingIds,reviewTaskId:latest.taskId,findingScopes
  };
}

function correctionLineage(state:StudioState,stage:Stage,current:Artifact):Lineage{
  const correct=state.lifecycle?.tasks[stage+':correct'];
  if(stage==='native'&&((correct?.artifactContext??'PUBLISHED')!==current.context||
    (current.context==='DRAFT'&&(correct?.draftAuthorTaskId!==current.authorTaskId||correct?.draftToken!==current.draftToken))))
    throw new Error('RECHECK_LINEAGE_REQUIRED: Native correction belongs to another draft/author lineage.');
  if(!correct||correct.status!=='IMPORTED')throw new Error('RECHECK_LINEAGE_REQUIRED: a confirmed current Correct task is required.');
  const record=state.lifecycle?.artifacts[correct.id];
  const payload=record?.value as {schema?:string;artifact_sha256?:string;finding_ids?:string[];artifact?:unknown}|undefined;
  if(!record||record.operation!=='correct'||record.stage!==stage||payload?.schema!=='mode-b-correction-v1'||
    payload.artifact_sha256!==correct.artifactSha256||!Array.isArray(payload.finding_ids))
    throw new Error('RECHECK_LINEAGE_REQUIRED: confirmed Correct payload does not match its frozen baseline.');
  if(stage==='script'){
    const candidate=state.scriptCandidate;
    if(!candidate||candidate.taskId!==correct.id||
      canonical({schema:'mode-b-script-v1',sections:candidate.sections,authoring:candidate.authoring})!==canonical(payload.artifact))
      throw new Error('RECHECK_LINEAGE_REQUIRED: current Script is not the exact confirmed correction.');
  }else if(canonical(payload.artifact)!==canonical(current.value)){
    throw new Error('RECHECK_LINEAGE_REQUIRED: current Native artifact differs from the published correction.');
  }
  const sources=Object.values(state.lifecycle?.artifacts??{}).filter(row=>row.stage===stage&&
    (row.operation==='review'||row.operation==='recheck')&&row.createdAt<=correct.createdAt&&
    (row.value as {artifact_sha256?:string})?.artifact_sha256===correct.artifactSha256&&
    (current.context!=='DRAFT'||(row.draftAuthorTaskId===current.authorTaskId&&row.draftToken===current.draftToken))&&
    (stage!=='native'||row.artifactContext===correct.artifactContext||
      (correct.artifactContext==='PUBLISHED'&&!row.artifactContext)))
    .filter(row=>{
      const items=(row.value as {findings?:Array<{id:string;status:string}>}).findings??[];
      return payload.finding_ids!.every(id=>items.some(f=>f.id===id&&(f.status==='open'||f.status==='uncertain')));
    });
  const source=correct.sourceReviewTaskId?
    sources.find(row=>row.taskId===correct.sourceReviewTaskId):
    sources.length===1?sources[0]:undefined;
  if(!source)throw new Error('RECHECK_LINEAGE_REQUIRED: correction has no unambiguous linked confirmed Review/Recheck supporting its findings.');
  const ids=[...new Set(payload.finding_ids)];
  if(ids.length!==payload.finding_ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw new Error('RECHECK_LINEAGE_REQUIRED: correction finding identity is invalid.');
  return {correctTaskId:correct.id,reviewTaskId:source.taskId,findingIds:ids,
    prior:[{taskId:source.taskId,operation:source.operation,value:source.value},
      {taskId:correct.id,operation:'correct',
        value:{schema:payload.schema,artifact_sha256:payload.artifact_sha256,
          finding_ids:payload.finding_ids}}]};
}
/** Restrict optional JSON-pointer edits to existing, specific data. */
function checkEditablePaths(stage:Stage,artifact:unknown,paths:string[]){
  const structural=stage==='script'?
    new Set(['/sections','/authoring','/schema']):
    new Set(['/manifest','/manifest/shots','/shot_ledger','/sound_script','/asset_needs','/schema']);
  const forbidden=new Set(['/manifest/voice','/manifest/captions']);
  for(const pointer of paths){
    if(typeof pointer!=='string'||!/^\/[A-Za-z0-9_~\/-]+$/.test(pointer)||pointer.endsWith('/')||
      structural.has(pointer)||forbidden.has(pointer))throw new Error('INVALID_EDITABLE_PATH: whole-root/collection or immutable field is not an authorized edit: '+pointer);
    const parts=pointer.slice(1).split('/').map(segment=>segment.replace(/~1/g,'/').replace(/~0/g,'~'));
    if(parts.some(segment=>!segment||segment==='__proto__'||segment==='prototype'||segment==='constructor'))
      throw new Error('INVALID_EDITABLE_PATH: unsafe pointer segment: '+pointer);
    if(stage==='script'){
      if(parts[0]==='sections'){
        if(parts.length!==3||!/^(0|[1-9]\d*)$/.test(parts[1])||parts[2]!=='text')
          throw new Error('INVALID_EDITABLE_PATH: Script section edits require an existing /sections/<index>/text.');
      }else if(parts[0]==='authoring'){
        if(parts.length<2)throw new Error('INVALID_EDITABLE_PATH: Script authoring requires a concrete existing field.');
      }else throw new Error('INVALID_EDITABLE_PATH: Script can edit only concrete sections or authoring fields.');
    }else if(parts[0]==='manifest'&&
      (parts[1]==='voice'||parts[1]==='captions'||(parts[1]==='shots'&&parts.length<4)))
      throw new Error('INVALID_EDITABLE_PATH: immutable timing or broad shot tree.');
    let node:unknown=artifact;
    for(let i=0;i<parts.length;i++){
      const segment=parts[i];
      if(!node||typeof node!=='object')
        throw new Error('INVALID_EDITABLE_PATH: pointer does not exist in current artifact: '+pointer);
      // A single explicit append index is allowed on Native auxiliary ledgers.
      // This does not authorize replacement of a whole collection.
      const append=stage==='native'&&i===parts.length-1&&i===1&&
        ['shot_ledger','sound_script','asset_needs'].includes(parts[0])&&
        Array.isArray(node)&&segment===String(node.length);
      if(append)break;
      if(!Object.prototype.hasOwnProperty.call(node,segment))
        throw new Error('INVALID_EDITABLE_PATH: pointer does not exist in current artifact: '+pointer);
      node=(node as Record<string,unknown>)[segment];
    }
  }
}

function evidence(root:string,state:StudioState,scope:Scope){
  const selected=scope.media;if(!selected)return{status:'NOT_VERIFIED',modalities:[],ranges:[],files:[]};
  const row=selected==='preview'?state.preview:selected==='film'?state.render:undefined;
  if((selected==='preview'||selected==='film')&&!row)throw new Error(`NOT_VERIFIED: verified ${selected} media does not exist.`);
  if(row){
    const file=resolveProjectFile(root,row.path),bytes=fs.readFileSync(file);
    if(sha(bytes)!==row.sha256)throw new Error('BLOCKED: registered review media bytes changed.');
    const reportFile=resolveProjectFile(root,row.reportPath);
    if(!row.reportSha256||!fs.existsSync(reportFile)||sha(fs.readFileSync(reportFile))!==row.reportSha256)
      throw new Error('NOT_VERIFIED: native QA report for encoded media is missing or changed.');
    const report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>;
    const observedDuration=typeof report.duration==='number'&&Number.isFinite(report.duration)&&report.duration>0?report.duration:null;
    const sampleDuration=selected==='preview'?state.nativeReadiness?.checkedSeconds??state.nativeReadiness?.previewSeconds:null;
    const end=selected==='preview'&&typeof sampleDuration==='number'&&Number.isFinite(sampleDuration)&&sampleDuration>0?
      (observedDuration!==null?Math.min(observedDuration,sampleDuration):sampleDuration):
      observedDuration??null;
    return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[{start:0,end}],
      duration_source:observedDuration!==null?'REGISTERED_NATIVE_QA_REPORT':sampleDuration!==null?'ORIGINAL_SAMPLE_VALIDATION':'NOT_VERIFIED',
      files:[{path:row.path,sha256:row.sha256,reportPath:row.reportPath,reportSha256:row.reportSha256}]};
  }
  if(selected==='voice'){
    if(!state.voice||state.voice.stale)throw new Error('NOT_VERIFIED: current voice evidence is unavailable.');
    const file=resolveProjectFile(root,state.voice.path);
    if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==state.voice.sha256)
      throw new Error('BLOCKED: accepted voice WAV bytes changed.');
    return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[{start:0,end:state.voice.duration??null}],files:[{path:state.voice.path,sha256:state.voice.sha256}]};
  }
  const captions=state.alignment?.captionReview;
  if(!captions)throw new Error('NOT_VERIFIED: owner-reviewed captions are unavailable.');
  const file=resolveProjectFile(root,captions.path);
  if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==captions.sha256)
    throw new Error('BLOCKED: approved caption-review evidence changed.');
  return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[],
    files:[{path:captions.path,sha256:captions.sha256}]};
}

function lifecycleSourceContext(state:StudioState,stage:Stage,operation:ExternalOperation){
  return sha(JSON.stringify({
    projectId:state.project.id,style:state.project.style,brief:state.brief,
    approvedScript:state.approvedScript??null,
    scriptCandidate:stage==='script'?state.scriptCandidate??null:null,
    voice:stage==='native'?state.voice??null:null,
    alignment:stage==='native'?state.alignment??null:null,
    reviewMedia:operation==='media-review'?{preview:state.preview??null,render:state.render??null}:null
  }));
}
const authorityIdentity=(authority:ReturnType<typeof compileAuthority>)=>
  sha(JSON.stringify(authority.sources.map(source=>[source.path,source.sha256,source.extractionSha256,source.extractionRevision])));
function assertLifecycleFresh(appPath:string,root:string,state:StudioState,task:NonNullable<StudioState['lifecycle']>['tasks'][string],journalResume=false){
  if(!task.sourceContextSha256||task.sourceContextSha256!==lifecycleSourceContext(state,task.stage,task.operation))
    throw new Error('STALE: lifecycle brief, approved creative source or voice/alignment was changed.');
  const authority=compileAuthority(appPath,state.project.style,task.stage,task.operation);
  if(!task.authorityFingerprint||task.authorityFingerprint!==authorityIdentity(authority))
    throw new Error('REBUILD_REQUIRED: installed Mode B creative authority changed.');
  if(task.stage==='native'&&task.evidenceSha256&&
    sha(JSON.stringify(nativeLifecycleEvidence(root,state)))!==task.evidenceSha256)
    throw new Error('STALE: Native approved narration, word or caption evidence changed.');
  for(const item of task.mediaBaseline??[]){
    const live=(state.media??[]).find(row=>JSON.stringify(row)===JSON.stringify(item));
    if(!live)throw new Error('STALE: accepted media ledger entry changed or was removed.');
    const file=resolveProjectFile(root,item.path);
    if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==item.sha256)
      throw new Error('STALE: accepted media bytes changed outside an authorized correction.');
  }
  const source=state.tasks?.[task.stage];
  if(task.stage==='native'&&task.artifactContext==='DRAFT'){
    if(!source?.sourceFingerprint||sourceFingerprint(appPath,root,'native')!==source.sourceFingerprint)
      throw new Error('NATIVE_DRAFT_AUTHOR_SOURCE_STALE: approved creative/voice/alignment changed.');
    const draft=readNativeDraft(root,state);
    const retry=task.operation==='correct'&&draft?.history.some(item=>
      item.correctTaskId===task.id&&item.previousSha256===task.artifactSha256);
    if(!draft||draft.token!==task.draftToken||draft.authorTaskId!==task.draftAuthorTaskId||
      (draft.revision!==task.draftRevision&&!retry))
      throw new Error('NATIVE_DRAFT_REVISION_STALE: rebuild the exact current draft task.');
  }
  if(!journalResume&&(!source||!task.originalTaskSha256||source.promptSha256!==task.originalTaskSha256))
    throw new Error('REBUILD_REQUIRED: original frozen author task changed.');
  const file=resolveProjectFile(root,task.promptPath);
  if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==task.promptSha256)
    throw new Error('REBUILD_REQUIRED: lifecycle task prompt changed.');
}
function attestLocalTransfer(root:string,kind:'preview'|'film'|'voice'|'captions',files:Array<{path:string;sha256:string}>){
  const base=resolveProjectFile(root,'.studio/external/review-packs');
  if(!fs.existsSync(base))throw new Error('MEDIA_PACK_REQUIRED: export an actual media package before manual transfer attestation.');
  const folders=fs.readdirSync(base,{withFileTypes:true}).filter(item=>item.isDirectory()&&item.name.startsWith(kind+'-'));
  for(const folder of folders){
    const directory=path.join(base,folder.name),file=path.join(directory,'review-package.json');
    if(!fs.existsSync(file))continue;
    let pack:Record<string,unknown>;
    try{pack=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;}catch{continue;}
    if(pack.kind!==kind||pack.schema!=='mode-b-review-pack-v2')continue;
    const items=pack.attachments as Array<{sha256:string;path:string}>|undefined;
    if(!Array.isArray(items)||!files.every(item=>items.some(ref=>ref.sha256===item.sha256)))continue;
    let valid=true;
    for(const item of items){
      if(typeof item.path!=='string'||!item.path.startsWith('media/')||path.posix.normalize(item.path)!==item.path||item.path.split('/').includes('..')||
        typeof item.sha256!=='string'||!(/^[a-f0-9]{64}$/.test(item.sha256))){valid=false;break;}
      const physical=path.join(directory,item.path);
      if(!fs.existsSync(physical)||sha(fs.readFileSync(physical))!==item.sha256){valid=false;break;}
    }
    if(valid)return folder.name;
  }
  throw new Error('MEDIA_PACK_REQUIRED: no current exported package matches exact preview/audio SHA-256 bytes.');
}
/** Read an existing reservation without creating or replacing its identity. */
export function readFrozenExternalTask(appPath:string,root:string,stage:Stage,operation:ExternalOperation){
  const state=readState(root);
  const task=operation==='author'?state.tasks?.[stage]:state.lifecycle?.tasks[stage+':'+operation];
  if(!task||task.status!=='FROZEN')return null;
  const target=resolveProjectFile(root,task.promptPath);
  if(!fs.existsSync(target)||sha(fs.readFileSync(target))!==task.promptSha256)
    throw new Error('REBUILD_REQUIRED: saved frozen task prompt is missing or modified.');
  if(operation==='author'&&(!state.tasks?.[stage]?.sourceFingerprint||
    sourceFingerprint(appPath,root,stage)!==state.tasks[stage]!.sourceFingerprint))
    throw new Error('STALE: saved author task has a changed creative source; explicitly rebuild it.');
  if(operation!=='author'){
    const life=task as NonNullable<StudioState['lifecycle']>['tasks'][string];
    assertLifecycleFresh(appPath,root,state,life);
    if(artifactFor(root,state,stage,operation,stage==='native'?(life.artifactContext??'PUBLISHED'):undefined).sha256!==life.artifactSha256)
      throw new Error('STALE: saved lifecycle task targets an older creative artifact.');
  }
  return {...task,prompt:fs.readFileSync(target,'utf8')};
}
/** Text-only independent review: the original Author appendix is the one full
 * copy of normative creative authority; provenance outside it is hash-only. */
function scriptReviewPrompt(
  state:StudioState,artifact:Artifact,originalTask:string,
  authority:ReturnType<typeof compileAuthority>,
  relevantPrior:Array<{taskId:string;operation:ExternalOperation;value:unknown}>,
  targetIds:string[],envelope:Record<string,unknown>,fileDelivery:string
):string{
  const current=artifact.value as {sections:Array<{id:string;text:string}>;authoring:unknown};
  const brief={
    project_id:state.project.id,topic:state.brief.topic,language:state.brief.language,
    target_duration_seconds:state.brief.targetDuration??null,style:state.project.style,
    ratio:state.brief.ratio,
    audience:state.brief.audience??'',purpose:state.brief.purpose??''
  };
  const target={id:artifact.id,sha256:artifact.sha256,sections:current.sections,authoring:current.authoring};
  // Frozen identity is complete, but this is intentionally NOT a review result.
  // The reviewer must supply status, coverage and findings after evaluation.
  const identity={
    schema:envelope.schema,project_id:envelope.project_id,task_id:envelope.task_id,
    revision:envelope.revision,input_sha256:envelope.input_sha256,
    stage:envelope.stage,operation:envelope.operation,
    payload:{schema:'mode-b-review-v1',artifact_sha256:artifact.sha256}
  };
  const trace=authority.sources.map(source=>
    '- '+source.path+' | original SHA256 '+source.sha256+
    ' | extraction SHA256 '+source.extractionSha256+
    ' | revision '+source.extractionRevision+
    ' | source locations '+(source.locations??[]).join(', ')).join('\n');
  const duration=state.brief.targetDuration;
  return [
    '# MODE B EXTERNAL SCRIPT REVIEW',
    '## A — REVIEW MISSION',
    'Independently evaluate the COMPLETE current Script artifact against the frozen project brief, selected original Mode B creative authority and approved creative requirements. Identify concrete narrative and creative problems supported by the supplied sections and authoring JSON. Do not rewrite narration, produce corrections or pretend to inspect unprovided audio/video.',
    'This is an independent review, not a new Author task or an owner-approval gate. Cover each requested section and compare distant sections for contradictions. Do not invent findings to meet a quota.',
    '## B — CURRENT PROJECT BRIEF',
    JSON.stringify(brief,null,2),
    'This brief is for review context, not a second copy of the narration or authoring JSON.',
    '## C — IMMUTABLE REVIEW TARGET',
    'This is the artifact being reviewed. Do not replace it with an earlier approved Script.',
    JSON.stringify(target,null,2),
    'Target id/sha256 are review-binding identities; do not modify this artifact or invent another candidate.',
    '## D — REVIEW CRITERIA AND AUTHORITY',
    'Evaluate all twelve dimensions across the supplied narration and authoring content. These are review responsibilities, NOT new JSON schema fields:',
    'CR-01 Hook — immediate clarity, relevance, stakes and curiosity.',
    'CR-02 Narrative structure — setup, progression, escalation and payoff.',
    'CR-03 Causality — every important result follows established story rules.',
    'CR-04 World rules — fictional assumptions are coherent and consistently applied.',
    'CR-05 Characters — identity, motivation, behavior and emotional progression.',
    'CR-06 Continuity — recurring props, clothing, geography and state changes, including across non-adjacent sections.',
    'CR-07 Narration — natural spoken '+state.brief.language+', clarity, rhythm and unnecessary repetition.',
    'CR-08 Duration — spoken pacing plausible for '+(typeof duration==='number'&&duration>0?duration+' seconds':'the requested creative target')+'; do not assert a verified WAV runtime, WPM, pauses or timestamps.',
    'CR-09 B-style fit — whether important story events are visually communicable within selected '+state.project.style+' style, with actual acting/contact feasibility.',
    'CR-10 Authoring consistency — sections agree with creative_direction, characters, continuity and other supplied creative choices.',
    'CR-11 Visual storytelling — important story logic can be shown, not merely asserted in text.',
    'CR-12 Voice and sound intent — creative intentions fit the established story events, not generic production presets.',
    'The following deterministic source locations and hashes identify applicable ORIGINAL creative authority. Its full exact text is in Appendix H (the frozen Author task), not duplicated here:',
    trace,
    'Textual sections and authoring JSON are evidence for narrative, causal, continuity and style-feasibility findings. Neither source hashes nor local asset paths establish actual media inspection. Do not request Native ledgers, actual word timing, MP4 rendering, audio mixing, local CLI execution or asset acquisition.',
    '## E — PRIOR FINDINGS',
    JSON.stringify(relevantPrior,null,2),
    'For a first review, [] means no prior findings; never fabricate earlier review results.',
    '## F — REVIEW COVERAGE',
    'Review every requested section individually and check cross-section logic; a supported issue can target multiple real section IDs. No artificial minimum number of findings.',
    'Exact target section IDs: '+JSON.stringify(targetIds),
    'For this text-only review use coverage.modalities=["script"], coverage.ranges=[], coverage.media_sha256s=[]. Set coverage.target_ids to every actually reviewed requested section ID. Do not fabricate audiovisual times, media SHA or inspected modalities.',
    '## G — RESPONSE CONTRACT',
    'Frozen identity (immutable fields, NOT a complete review result):',
    JSON.stringify(identity,null,2),
    'Review payload field contract (no preset outcome):',
    'payload.schema: mode-b-review-v1 (use the real frozen value above).',
    'payload.artifact_sha256: use the exact immutable target SHA256 from the frozen identity above.',
    'payload.status: select exactly one of REVIEWED_WITH_FINDINGS, REVIEWED_NO_FINDINGS, INSUFFICIENT_EVIDENCE, NOT_VERIFIED after independent evaluation. This is a required string field, not a preselected conclusion.',
    'payload.coverage: an object with exactly target_ids, modalities, ranges, media_sha256s. For full text-only Script review, use this exact coverage structure with the requested frozen section IDs (do not invent targets):',
    JSON.stringify({target_ids:targetIds,modalities:['script'],ranges:[],media_sha256s:[]},null,2),
    'payload.findings: an array of real, evidence-supported findings; use [] only if the actual review warrants no findings. Do not create a finding to satisfy a quota.',
    'The Review response has no preset outcome. Independently evaluate every requested section and the complete authoring JSON before choosing payload.status and constructing payload.findings. Do not infer REVIEWED_NO_FINDINGS merely because an example contains an empty findings array. Return a complete valid JSON envelope using the frozen identity and the actual review conclusions.',
    'Assemble exactly one complete JSON object using the immutable frozen identity and all required review payload fields. Do not submit the identity-only reference as the result. Keep all frozen IDs and hashes unchanged, without adding filename metadata or extra schema fields.',
    'Select status ONLY after evaluating actual textual coverage:',
    'REVIEWED_WITH_FINDINGS — complete requested text coverage and at least one supported unresolved finding.',
    'REVIEWED_NO_FINDINGS — complete requested text coverage and zero supported unresolved findings. REVIEWED_NO_FINDINGS is NOT a default.',
    'INSUFFICIENT_EVIDENCE — necessary textual evidence is missing/unusable for the requested assessment; missing WAV/MP4 alone does NOT cause this status.',
    'NOT_VERIFIED — a specific requested verification cannot be established from the supplied evidence. Do not claim to know actual WAV duration, word timestamps, spoken performance quality, rendered frames, executed motion or final sound mix.',
    'Finding field contract (no sample finding and no placeholder target IDs):',
    'id — unique finding ID (1–80 characters, ASCII letters, digits, underscore or hyphen).',
    'severity — critical | major | minor.',
    'status — open | resolved | uncertain.',
    'target_ids — non-empty array containing ONLY real section IDs listed in REVIEW COVERAGE; for a cross-section finding list each supported real target ID.',
    'requirement — non-empty specific creative requirement violated by this finding.',
    'evidence — object with kind and detail; kind is manifest | inferred | unverified | observed. Use manifest for direct Script/authoring JSON evidence; inferred only with explicit reasoning. Never use observed to claim audio/video inspection in text-only Script Review.',
    'evidence.detail — non-empty concrete evidence drawn from the supplied Script and authoring JSON. Do not supply source_sha256 or time_range without actual supporting evidence.',
    'recommendation — concrete repair guidance for the referenced sections, preserving unrelated approved content and avoiding unnecessary new story events.',
    'Never fabricate a finding, copy a format illustration, add missing media evidence, or insert unverified section IDs.',
    'Return ONLY review findings and evidence coverage; do not rewrite sections, change authoring or produce a correction artifact.',
    fileDelivery,
    '## H — ORIGINAL FROZEN AUTHOR TASK (IMMUTABLE REFERENCE APPENDIX)',
    'Original frozen Author task SHA256: '+sha(originalTask),
    'This appendix defines the FROZEN AUTHORING REQUIREMENTS, NOT a new Author task. Do not follow its instruction to generate another Script. Its fictional/example JSON is NOT this Review response contract. Ignore any Author JSON filename or file-delivery instructions inside the appendix; the Review filename and response contract in Section G take precedence. The current immutable target in Section C is the ONLY Script candidate to evaluate. Do not change these appendix bytes or claim the example narration is the review target.',
    originalTask
  ].join('\n\n')+'\n';
}


/** A distinct executable mission per lifecycle operation. The original Author
 * task is evidence of original rules, never an instruction to author again.
 * Identity and field contract are separated so no review verdict is prefilled.
 */
function dedicatedLifecyclePrompt(
  state:StudioState,stage:Stage,operation:Exclude<ExternalOperation,'author'>,
  artifact:Artifact,originalTask:string,authority:ReturnType<typeof compileAuthority>,
  prior:Array<{taskId:string;operation:ExternalOperation;value:unknown}>,
  targetIds:string[],findingIds:string[],editableIds:string[],editablePaths:string[],
  evidencePack:unknown,mediaKind:Scope['media'],lineage:Lineage|null,
  envelope:Record<string,unknown>,fileDelivery:string,nativeSourceEvidence?:unknown
):string{
  const current=artifact.value;
  const payload=envelope.payload as {schema:string;artifact_sha256:string};
  const identity={schema:envelope.schema,project_id:envelope.project_id,task_id:envelope.task_id,
    revision:envelope.revision,input_sha256:envelope.input_sha256,stage,operation,
    payload:{schema:payload.schema,artifact_sha256:artifact.sha256}};
  const brief={project_id:state.project.id,topic:state.brief.topic,language:state.brief.language,
    style:state.project.style,ratio:state.brief.ratio,
    target_duration_seconds:state.brief.targetDuration??null,
    audience:state.brief.audience??'',purpose:state.brief.purpose??''};
  const sourceTrace=authority.sources.map(source=>'- '+source.path+
    ' | source SHA256 '+source.sha256+' | extraction SHA256 '+source.extractionSha256+
    ' | revision '+source.extractionRevision+
    (source.locations?.length?' | locations '+source.locations.join(', '):'')).join('\n');
  const kindInstructions:Record<'voice'|'captions'|'preview'|'film',string[]>={
    voice:[
      'VOICE MEDIA REVIEW — assess actual transferred WAV only if genuinely listened to: spoken text fidelity, missing/repeated words, diction, natural pauses, expressive delivery, perceived pacing, clipping/noise.',
      'Reading Script text or having a WAV path/SHA does not prove audibility, performance, real duration or voice quality.'
    ],
    captions:[
      'CAPTIONS MEDIA REVIEW — assess actual approved caption text/word-alignment files: wording, sequence, coverage and semantic one-line B-style grouping.',
      'Check caption timing only against real supplied timing data; verify audible synchronization only if the actual WAV was transferred and listened to. Claim rendered legibility only if actual frames were viewed.'
    ],
    preview:[
      'PREVIEW MEDIA REVIEW — examine only the actually supplied preview sample and its frozen interval, not the entire film. Consider hook, acting/contact, transitions, visual continuity, meaningful motion, and captions.',
      'Review voice/SFX only if corresponding audio was genuinely listened to. Frozen target IDs include ONLY shots intersecting the verified preview interval. Never infer motion from contact sheets alone.'
    ],
    film:[
      'FILM MEDIA REVIEW — review full actual film for across-shot narrative pacing, scene continuity, acting, compositing, captions, sound/voice and render defects ONLY where the media was actually watched/heard.',
      'A full-film registered file or media pack alone proves no external observation. If only a sample was transferred, do not claim full-film coverage or unseen shots.'
    ]
  };
  const missions=stage==='script'?{
    review:['SCRIPT REVIEW — independently assess complete current narration and authoring creative quality; do not write a new Script.'],
    correct:[
      'SCRIPT CORRECT — repair the supported unresolved findings through a COMPLETE corrected mode-b-script-v1 artifact. This is not a fresh Author task.',
      'For section-level locks change ONLY sections[i].text for explicitly editable existing section IDs; retain every section ID/order and every locked section byte-for-byte. Preserve the whole authoring tree unless a specific existing authoring path was explicitly authorized.',
      'The intended repair must materially address the described problem, not reproduce the unchanged artifact. Never modify other sections or invent media, word timings or CLI results. The result stays a candidate pending independent Recheck.'
    ],
    recheck:[
      'SCRIPT RECHECK — TEXT EVIDENCE AND ACTIVATION GATE. Independently inspect the CURRENT corrected candidate and all requested sections against the original confirmed Review findings.',
      'For EACH required frozen finding ID provide its own finding with a supported status resolved, open or uncertain; account for possible new causal or continuity regressions. Missing WAV/MP4 does not automatically mean INSUFFICIENT_EVIDENCE.',
      'Choose REVIEWED_NO_FINDINGS only if all frozen findings are demonstrably resolved, full requested textual coverage is complete and no newly supported unresolved finding exists. Do not rewrite Script or trigger approval yourself.'
    ],
    'media-review':kindInstructions[mediaKind as 'voice'|'captions'|'preview'|'film']
  }[operation]:{
    review:[
      'NATIVE REVIEW — INDEPENDENT CREATIVE & STRUCTURAL AUDIT of EVERY requested real Shot and the ENTIRE shot_ledger, sound_script, asset_needs against all source-exact applicable B1–B4 requirements. Use staged DRAFT evidence before paid generation when selected.',
      'Assess approved narrative event coverage, causal progression, visually meaningful changes (not literal narration rewording), composition, silhouettes, visible actions, positions, contacts and important state changes for every Shot.',
      'Assess feasible motion with documented Mode B layers/keyframes, timing and pacing against actual words/pauses, without enforcing one Shot per caption; assess readable typography and selected B style.',
      'Assess character identity/clothes/poses, locations, props, geography, screen direction and physics across adjacent AND NON-ADJACENT Shots; consider continuing world and story constraints.',
      'Assess every image layer versus real shot_id/layer_id/safe expected path in asset_needs, generated-image feasibility and continuity references. Differentiate proposed missing assets from actually verified local media.',
      'Assess sound_script SFX/ambience tied to genuine events, rather than generic sound beds; check manifest structural feasibility, reference and timing consistency without claiming native CLI validation.',
      'TEXT-ONLY COVERAGE: use coverage.modalities=["manifest"], ranges=[], media_sha256s=[]; findings target ONLY real frozen shot IDs, with precise violated requirement, manifest/ledger evidence and actionable recommendation. No minimum finding quota; REVIEWED_NO_FINDINGS is never a preset.',
      'DO NOT claim actual image viewing, rendered motion, listened audio, caption synchronization or original CLI PASS from local paths and SHA alone. Return review findings, NOT a corrected manifest.'
    ],
    correct:[
      'NATIVE CORRECT — repair confirmed unresolved creative and technical findings using the SMALLEST effective scoped changes; return ONE COMPLETE corrected artifact (manifest, shot_ledger, sound_script, asset_needs).',
      'Read exact CURRENT artifact and linked Review evidence, original requirements, frozen editable Shot IDs and exact JSON-pointer paths; preserve locked Shots/IDs/order, narration, voice timing, approved captions and existing rights/media.',
      'An auxiliary-only finding can be fixed using an explicitly authorized narrow existing shot_ledger, sound_script or asset_needs field/path without changing an unrelated Shot. Do NOT infer authority over an entire collection from vague review prose.',
      'Maintain distant and adjacent cross-shot continuity. Changed image target/path must stay consistent with asset_needs; prior fulfillment must not be silently repointed.',
      'No Shot insertion/removal/reorder in ordinary Correct; request an explicit structural reissue if needed. Report insufficient authorized scope rather than change locked content. No invented CLI, image/audio or preview evidence.',
      'Return the entire corrected artifact; NEVER a partial patch, new unscoped storyboard or new Author response.'
    ],
    recheck:[
      'NATIVE RECHECK — independently verify EXACT CURRENT corrected Native artifact against confirmed Review/Correct lineage and source authority; do not rewrite the artifact.',
      'For EACH original required finding ID, compare the original requirement/evidence/recommendation with current corrected Shot/Layer/ledger and report resolved/open/uncertain with NEW concrete current-artifact evidence; never copy the prior verdict.',
      'Inspect all requested Shots, locked adjacent AND distant Shots, all relevant shot_ledger/sound_script/asset_needs and new creative, motion, continuity, target-reference and timing regressions.',
      'REVIEWED_NO_FINDINGS requires every historical finding resolved, complete current textual requested coverage and no new unresolved finding; findings[] may include RESOLVED historical entries. REVIEWED_WITH_FINDINGS means at least one supported open/uncertain issue. Use INSUFFICIENT_EVIDENCE/NOT_VERIFIED where appropriate.',
      'For text-only recheck use manifest modality, never picture/motion/sound observation without actual transferred evidence. No claims of original CLI PASS or rendered film.'
    ],
    'media-review':kindInstructions[mediaKind as 'voice'|'captions'|'preview'|'film']
  }[operation];
  const statusContract=[
    'payload.status is REQUIRED and NOT PRESELECTED. Choose independently after reviewing actual evidence:',
    'REVIEWED_WITH_FINDINGS: all requested available evidence covered, one or more supported unresolved findings.',
    'REVIEWED_NO_FINDINGS: complete requested evidenced coverage, no unresolved findings; NOT a default.',
    'INSUFFICIENT_EVIDENCE: evidence necessary for the specified review is missing or unusable.',
    'NOT_VERIFIED: a requested verification cannot be established from supplied evidence.',
    'payload.coverage has exactly target_ids,modalities,ranges,media_sha256s. target_ids must be actual reviewed IDs within the frozen inventory. Use script/manifest for inspectable text only; do not claim picture, motion or sound observation without actual media examination.',
    'For each finding include exactly id, severity (critical|major|minor), status (open|resolved|uncertain), target_ids (real IDs), requirement, evidence (kind, detail and supported optional SHA/time range), recommendation.',
    'Allowed evidence.kind: manifest|inferred|unverified|observed. observed claims require genuine inspection of supplied media, source_sha256 tied to attested primary media and real supported in-range time/target. Never fabricate observations.',
    'Use [] for findings only when that is the truthful outcome. Never invent a finding to meet a quota.',
    'Construct ONE COMPLETE mode-b-lifecycle-result-v1 JSON object with the exact frozen identity and the required payload fields. The identity reference below is NOT a completed result.'
  ];
  const correctionContract=[
    'payload.schema: mode-b-correction-v1; payload.artifact_sha256: exact frozen target SHA.',
    'payload.finding_ids: exact required frozen IDs, in listed order.',
    'payload.editable_ids: exact listed authorized IDs, in listed order.',
    'payload.editable_paths: exact listed authorized pointers, in listed order.',
    'payload.artifact: one COMPLETE corrected current artifact with schema and all required nested fields. Do not use an unchanged artifact as an example answer or omit locked fields.',
    'No payload.status, payload.coverage or payload.findings fields are permitted for Correct.',
    ...(stage==='script'&&operation==='correct'?[
      `SCRIPT CORRECT — EXACT ARTIFACT CONTRACT

payload.artifact must be a COMPLETE mode-b-script-v1 object
containing EXACTLY these three top-level fields:

1. schema
   Must equal "mode-b-script-v1".

2. sections
   Complete ordered array of all original sections.
   Each section must contain EXACTLY:
   - id: unchanged existing section ID
   - text: spoken narration

   Preserve all section IDs and their original order.
   Modify text ONLY for explicitly authorized editable section IDs.
   Preserve every locked section text exactly.

3. authoring
   Complete authoring object from the current target.
   Preserve it unchanged unless a specific authoring field path
   has been explicitly authorized.

Do NOT copy Script candidate metadata into payload.artifact:
- text
- sha256
- revision
- importedAt
- taskId
- approvedAt
- approvedBy
- approvalNote

These fields may exist in the immutable target context,
but they are NOT fields of mode-b-script-v1.

Return the complete corrected artifact, not a partial patch.`
    ]:[])
  ];
  const kind=operation==='media-review'?(mediaKind??'UNKNOWN'):null;
  return [
    '# MODE B EXTERNAL '+stage.toUpperCase()+' '+operation.toUpperCase()+(kind?' — '+kind.toUpperCase():''),
    '## A — OPERATION-SPECIFIC MISSION',...missions,
    '## B — PROJECT BRIEF',JSON.stringify(brief,null,2),
    ...(stage==='native'?['## B2 — NATIVE SOURCE EVIDENCE (VERIFIED, READ-ONLY)',
      'Complete approved narration and real word-level timestamps. No character timings, second Author appendix or false media playback claims.',
      JSON.stringify(nativeSourceEvidence,null,2)]:[]),
    '## C — ONE IMMUTABLE CURRENT TARGET',
    stage==='native'?'Native context: '+artifact.context+'; draft revision '+(artifact.draftRevision??'not applicable')+'; original Author '+(artifact.authorTaskId??'published original')+'. DRAFT is NOT published to project.json; PUBLISHED is the confirmed manifest. Never switch targets silently.':'Only this artifact is current. Do not replace it with an earlier approved Script, a previous Native manifest or the Author appendix.',
    JSON.stringify({id:artifact.id,sha256:artifact.sha256,value:current},null,2),
    '## D — EXACT SCOPE AND CORRECTION LINEAGE',
    JSON.stringify({target_ids:targetIds,editable_ids:editableIds,editable_paths:editablePaths,
      finding_ids:findingIds,correction_lineage:lineage?{
        correct_task_id:lineage.correctTaskId,source_review_task_id:lineage.reviewTaskId}:null},null,2),
    'Confirmed applicable prior evidence (exclude unrelated media reviews, old artifacts and stage history):',
    JSON.stringify(prior,null,2),
    '## E — ORIGINAL MODE B CREATIVE AUTHORITY',
    stage==='native'?'The exact applicable original Mode B source extracts are included ONCE below. Original Author task SHA and frozen identity are preserved; do not duplicate its output instructions or large timing appendix.':'The original frozen Author appendix below contains the full applicable requirements. Its instructions to produce a new Author response are NOT executable for this task. SHA/provenance outside the appendix is informational; no extra independent rules are invented here.',
    sourceTrace,
    ...(stage==='native'?authority.sources.map(source=>'### ORIGINAL SOURCE '+source.path+' | SHA256 '+source.sha256+' | extraction '+source.extractionSha256+'\n'+source.text):[]),
    ...(stage==='script'&&operation==='media-review'?[
      'SCRIPT MEDIA REVIEW — ADDITIONAL ORIGINAL SOURCE-EXACT EVIDENCE RULES (not contained in the focused Script Author appendix).',
      ...authority.sources.map(source=>
        'BEGIN SOURCE '+source.path+' | original SHA256 '+source.sha256+
        ' | extraction SHA256 '+source.extractionSha256+'\n'+source.text+'\nEND SOURCE '+source.path)
    ]:[]),
    '## F — EVIDENCE AND REVIEW COVERAGE',
    operation==='media-review'?
      'The local package and its SHA prove local bytes, NOT transfer or actual inspection. transferAcknowledged is only the owner declaration of manual transfer. Report observations only for files actually provided AND examined in this conversation. Auxiliary contact sheets are stills, not motion evidence. Use time bounds only when verified from transferred media.':
      'The supplied current Script/Native artifact is inspectable textual/manifest evidence. Do not claim actual video, voice, motion, caption playback, media QA or CLI execution without real external evidence.',
    JSON.stringify(evidencePack,null,2),
    'Frozen eligible target IDs: '+JSON.stringify(targetIds),
    '## G — RESPONSE CONTRACT — NO PRESET OUTCOME',
    'FROZEN IDENTITY (reference only, incomplete response):',
    JSON.stringify(identity,null,2),
    ...(operation==='correct'?correctionContract:statusContract),
    ...(operation==='recheck'?[
      'Required exact finding IDs: '+JSON.stringify(findingIds),
      'Every required finding ID must appear with supported resolved/open/uncertain status. A clean recheck requires all required findings resolved and all requested current targets covered.'
    ]:[]),
    ...(stage==='script'&&operation==='recheck'?[
      `SCRIPT RECHECK — TEXT COVERAGE CONTRACT

For a complete text-only Script Recheck:

payload.coverage.target_ids:
- Include every frozen target ID actually reviewed.
- A reviewed status requires complete frozen target coverage.
- Preserve real target IDs; do not invent or duplicate IDs.

payload.coverage.modalities: ["script"]
payload.coverage.ranges: []
payload.coverage.media_sha256s: []

The empty modalities array in ACTUAL EVIDENCE TRANSFER STATUS
is not the Script review coverage.

The supplied Script and authoring constitute inspectable
textual evidence. Missing WAV/MP4 does not automatically make
a text-only Script Recheck INSUFFICIENT_EVIDENCE.

Do not claim verified audio, motion, frames, captions or
actual spoken duration without genuinely supplied media.`,
      `SCRIPT RECHECK — REQUIRED HISTORICAL FINDINGS

Every required finding ID from the frozen correction lineage
MUST appear exactly once in payload.findings.

For each required finding, independently determine:
- resolved
- open
- uncertain

REVIEWED_NO_FINDINGS means there are no unresolved findings.
It does NOT require payload.findings to be empty.

When required finding IDs are non-empty,
payload.findings: [] is invalid.

A clean Script Recheck requires:
- Every required historical finding is resolved.
- Complete requested Script text coverage.
- No newly supported unresolved finding.

Never preset resolved status or REVIEWED_NO_FINDINGS.
Choose the result only after actual independent evaluation.`,
      `SCRIPT RECHECK — CURRENT CANDIDATE EVIDENCE

Evaluate the exact CURRENT corrected Script candidate,
not the previous Review artifact or the original Author Script.

For every required historical finding:

1. Read the original requirement, evidence and recommendation.
2. Inspect the relevant current sections and authoring.
3. Determine whether the original defect remains.
4. Support the current finding status using concrete evidence
   from the CURRENT corrected candidate.
5. Explain why the finding is resolved, open or uncertain.

Do not copy the previous Review conclusion or evidence
as if it were a fresh Recheck observation.

Review the complete requested Script for regressions
introduced by the correction, including:
- narration coherence
- causal progression
- continuity
- story structure
- creative direction
- selected style fit

Report newly supported problems using valid distinct finding IDs.

Do not invent defects, media observations or verification results.
Do not modify the Script during Recheck.`
    ]:[]),
    '## JSON FILE DELIVERY — REQUIRED',fileDelivery.replace(/^## JSON FILE DELIVERY — REQUIRED\n/,''),
    ...(stage==='native'?['## H — ORIGINAL FROZEN AUTHOR IDENTITY (NO DUPLICATE AUTHOR PROMPT)',
      'Original Author task SHA256: '+sha(originalTask),
      'Its immutable source bytes remain in project-owned frozen history. All original source-exact Mode B requirements are in Section E. Follow only the current operation-specific output contract.']:
      ['## H — ORIGINAL FROZEN AUTHOR TASK — IMMUTABLE REFERENCE APPENDIX',
      'Original Author task SHA256: '+sha(originalTask),
      'This appendix is a normative reference, NOT a new Author mission, result example, current target or response contract. Ignore any older JSON filename/output instruction inside it; Section G and the current JSON file delivery govern this task.',
      originalTask])
  ].join('\n\n')+'\n';
}

export function freezeLifecycleTask(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,scope:Scope={},rebuild=false){
  requireActiveLifecycleOperation(operation);
  if(!['review','correct','recheck'].includes(operation))throw new Error('Unsupported lifecycle operation.');
  if(operation==='media-review'&&!(stage==='script'&&(scope.media==='voice'||scope.media==='captions')||
    stage==='native'&&(scope.media==='preview'||scope.media==='film')))
    throw new Error('INVALID_MEDIA_KIND: Script only supports voice/captions; Native only supports preview/film.');
  const state=readState(root),artifact=artifactFor(root,state,stage,operation,scope.targetContext),authority=compileAuthority(appPath,state.project.style,stage,operation);
  const ownerTask=state.tasks?.[stage];
  if(stage==='native'&&artifact.context==='DRAFT'&&
    (!ownerTask?.sourceFingerprint||sourceFingerprint(appPath,root,'native')!==ownerTask.sourceFingerprint))
    throw new Error('NATIVE_DRAFT_AUTHOR_SOURCE_STALE: rebuild Author after the current input changed.');
  if(!ownerTask||!fs.existsSync(resolveProjectFile(root,ownerTask.promptPath)))
    throw new Error('REBUILD_REQUIRED: original frozen author task is unavailable for independent review/correction.');
  const originalTask=fs.readFileSync(resolveProjectFile(root,ownerTask.promptPath),'utf8');
  if(ownerTask.promptSha256!==sha(originalTask))throw new Error('REBUILD_REQUIRED: original frozen author task was modified.');
  const evidencePack=operation==='media-review'?evidence(root,state,scope):{status:'NOT_APPLICABLE',modalities:[],ranges:[],files:[]};
  let mediaTransferAttested=false,mediaSha256s:string[]=[],mediaDuration:number|undefined;
  if(operation==='media-review'){
    const listed=evidencePack.files as Array<{path:string;sha256:string}>;
    mediaSha256s=listed.map(file=>file.sha256);
    const duration=(evidencePack.ranges as Array<{start:number;end?:number|null}>)[0]?.end;
    if(typeof duration==='number'&&Number.isFinite(duration)&&duration>0)mediaDuration=duration;
    if(scope.transferAcknowledged===true){
      if(!scope.media)throw new Error('Missing explicit media kind for transfer attestation.');
      attestLocalTransfer(root,scope.media,listed);
      mediaTransferAttested=true;
      evidencePack.status='OWNER_ATTESTED_FILE_TRANSFER_NOT_VERIFIED_BY_STUDIO';
    }else evidencePack.status='AVAILABLE_LOCALLY_NOT_TRANSFERRED';
  }
  const suggested=operation==='correct'?
    suggestedCorrectScope(root,state,stage,artifact.context,scope.findingIds):null;
  const editablePaths=[...new Set(scope.editablePaths??suggested?.editablePaths??[])];
  // Owner-provided empty arrays are explicit authorizations, never auto-filled.
  // A verified auxiliary path does not suppress independent selected-Shot rights.
  const editableIds=[...new Set(scope.editableIds??suggested?.editableIds??[])];
  if(operation==='correct'&&!editableIds.length&&!editablePaths.length)
    throw new Error('Correct requires unresolved findings from a confirmed current-artifact Review or an explicit editable section/shot scope.');
  if(editableIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))throw new Error('Invalid editable ID.');
  if(editablePaths.some(p=>typeof p!=='string'||!/^\/(?:manifest\/)?[A-Za-z0-9_~-]+(?:\/[A-Za-z0-9_~-]+)*$/.test(p)||p==='/'||p==='/manifest'))
    throw new Error('Invalid or overly broad editable field path.');
  const sectionRows=stage==='script'?(artifact.value as {sections:Array<{id:string}>}).sections:
    ((artifact.value as {manifest:{shots?:Array<{id:string}>}}).manifest.shots??[]);
  const allTargetIds=sectionRows.map(item=>item.id);
  if(new Set(allTargetIds).size!==allTargetIds.length||allTargetIds.some(id=>typeof id!=='string'))
    throw new Error('Invalid native/script object inventory.');
  const requested=scope.targetIds??[];
  if(!Array.isArray(requested)||new Set(requested).size!==requested.length||
    requested.some(id=>typeof id!=='string'||!allTargetIds.includes(id)))
    throw new Error('Review target scope contains fabricated or duplicate entity IDs.');
  if(operation==='media-review'&&stage==='native'&&scope.media==='preview'&&
    (typeof mediaDuration!=='number'||!Number.isFinite(mediaDuration)||mediaDuration<=0))
    throw new Error('MEDIA_COVERAGE_INVALID: partial Preview requires a verified sample duration.');
  if(operation==='media-review'&&stage==='native'&&scope.media==='film'){
    if(!state.nativeReadiness?.fullReady)
      throw new Error('MEDIA_COVERAGE_INVALID: Film requires current FULL_READY native publication.');
    const shots=(artifact.value as {manifest:{shots:Array<{end:number}>}}).manifest.shots??[];
    const timelineEnd=shots.length?shots[shots.length-1].end:0;
    if(typeof mediaDuration!=='number'||!Number.isFinite(mediaDuration)||
      !Number.isFinite(timelineEnd)||timelineEnd<=0||mediaDuration+0.06<timelineEnd)
      throw new Error('MEDIA_COVERAGE_INVALID: Film requires registered complete duration covering all Native shots.');
  }
  const nativeRange=operation==='media-review'&&stage==='native'&&scope.media==='preview'?mediaDuration:undefined;
  const eligibleIds=typeof nativeRange==='number'?
    (artifact.value as {manifest:{shots:Array<{id:string;start:number;end:number}>}}).manifest.shots
      .filter(shot=>typeof shot.start==='number'&&Number.isFinite(shot.start)&&
        typeof shot.end==='number'&&Number.isFinite(shot.end)&&shot.start<nativeRange&&shot.end>0)
      .map(shot=>shot.id):allTargetIds;
  if(operation==='media-review'&&scope.media==='preview'&&!eligibleIds.length)
    throw new Error('MEDIA_COVERAGE_INVALID: preview contains no verified intersecting shots.');
  if(operation==='media-review'&&scope.media==='preview'&&requested.some(id=>!eligibleIds.includes(id)))
    throw new Error('MEDIA_COVERAGE_INVALID: out-of-sample shot cannot enter Preview review.');
  const targetIds=requested.length?requested:eligibleIds;
  if(operation==='correct')checkEditablePaths(stage,artifact.value,editablePaths);
  if(editableIds.some(id=>!allTargetIds.includes(id)))throw new Error('Editable target does not exist in frozen artifact.');
  const lineage=operation==='recheck'?correctionLineage(state,stage,artifact):null;
  const sources=Object.values(state.lifecycle?.artifacts??{});
  const reviewSource=operation==='correct'&&suggested?.reviewTaskId?
    sources.find(item=>item.taskId===suggested.reviewTaskId&&item.stage===stage&&
      (artifact.context!=='DRAFT'||(item.draftAuthorTaskId===artifact.authorTaskId&&item.draftToken===artifact.draftToken))&&
      (stage!=='native'||item.artifactContext===artifact.context||
        (artifact.context==='PUBLISHED'&&!item.artifactContext))&&
      (item.operation==='review'||item.operation==='recheck')&&
      (item.value as {artifact_sha256?:string}).artifact_sha256===artifact.sha256):undefined;
  if(operation==='correct'&&artifact.context==='DRAFT'&&!reviewSource)
    throw new Error('NATIVE_DRAFT_REVIEW_REQUIRED: confirm a Review of the exact current draft before Correct.');
  const relevantPrior=lineage?.prior??(reviewSource?
    [{taskId:reviewSource.taskId,operation:reviewSource.operation,value:reviewSource.value}]:
    operation==='review'?sources.filter(item=>item.stage===stage&&item.operation==='review'&&
      (artifact.context!=='DRAFT'||(item.draftAuthorTaskId===artifact.authorTaskId&&item.draftToken===artifact.draftToken))&&
      (stage!=='native'||item.artifactContext===artifact.context||
        (artifact.context==='PUBLISHED'&&!item.artifactContext))&&
      (item.value as {artifact_sha256?:string}).artifact_sha256===artifact.sha256)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,1)
      .map(item=>({taskId:item.taskId,operation:item.operation,value:item.value})):[]);
  const findingIds=operation==='recheck'?lineage!.findingIds:
    operation==='correct'?(suggested?.findingIds??[]):[];
  if(new Set(findingIds).size!==findingIds.length||findingIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw new Error('Invalid finding scope.');
  if(operation==='correct'&&findingIds.some(id=>!suggested?.findingIds.includes(id)))
    throw new Error('CORRECT_FINDING_SCOPE_INVALID: finding ID is not unresolved in the confirmed current-artifact Review.');
  if(operation==='recheck'&&scope.findingIds?.length&&
    (scope.findingIds.length!==findingIds.length||scope.findingIds.some(id=>!findingIds.includes(id))))
    throw new Error('RECHECK_LINEAGE_REQUIRED: requested findings must match the exact current correction.');
  const key=stage+':'+operation,prior=state.lifecycle?.tasks[key];
  const snapshot={projectId:state.project.id,stage,operation,artifactSha256:artifact.sha256,authorityHashes:authority.sources.map(item=>[item.path,item.sha256,item.extractionSha256]),
    originalTaskSha256:sha(originalTask),artifactContext:artifact.context??null,draftToken:artifact.draftToken??null,draftRevision:artifact.draftRevision??null,
    evidencePack,mediaTransferAttested,mediaSha256s,mediaDuration,editableIds,editablePaths,findingIds,targetIds,relevantPrior,
    correctionLineage:lineage?{correctTaskId:lineage.correctTaskId,reviewTaskId:lineage.reviewTaskId}:null};
  const sourceContextSha256=lifecycleSourceContext(state,stage,operation),authorityFingerprint=authorityIdentity(authority);
  const nativeSourceEvidence=stage==='native'?nativeLifecycleEvidence(root,state):undefined;
  const evidenceSha256=nativeSourceEvidence?sha(JSON.stringify(nativeSourceEvidence)):undefined;
  const inputSha256=sha(JSON.stringify({...snapshot,sourceContextSha256,authorityFingerprint,evidenceSha256}));
  if(!rebuild&&prior?.status==='FROZEN'&&prior.inputSha256===inputSha256&&fs.existsSync(resolveProjectFile(root,prior.promptPath)))
    return{...prior,prompt:fs.readFileSync(resolveProjectFile(root,prior.promptPath),'utf8')};
  if(!rebuild&&prior?.status==='FROZEN')
    throw new Error('FROZEN_TASK_REBUILD_REQUIRED: explicitly Rebuild the current frozen task.');
  if(prior){
    state.externalTaskArchive??=[];
    state.externalTaskArchive.push({stage,operation,task:{...prior,status:prior.status==='IMPORTED'?'IMPORTED':'STALE'}});
    prior.status='STALE';
  }
  const id=randomUUID(),revision=(prior?.revision??0)+1;
  const contract=operation==='correct'?
    {schema:'mode-b-correction-v1',artifact_sha256:artifact.sha256,finding_ids:findingIds,
      editable_ids:editableIds,editable_paths:editablePaths}:
    {schema:'mode-b-review-v1',artifact_sha256:artifact.sha256};
  const envelope={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:id,revision,input_sha256:inputSha256,stage,operation,payload:contract};
  const fileDelivery=externalJsonFileDelivery(stage,operation,revision,id,scope.media);
  const prompt=stage==='script'&&operation==='review'?
    scriptReviewPrompt(state,artifact,originalTask,authority,relevantPrior,targetIds,envelope,fileDelivery):
    dedicatedLifecyclePrompt(state,stage,operation,artifact,originalTask,authority,relevantPrior,
      targetIds,findingIds,editableIds,editablePaths,evidencePack,scope.media,lineage,envelope,fileDelivery,nativeSourceEvidence);
  const relative='.studio/external/lifecycle/tasks/'+stage+'-'+operation+'-'+revision+'-'+id+'.md',target=resolveProjectFile(root,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,prompt,{encoding:'utf8',flag:'wx'});
  state.lifecycle??={tasks:{},artifacts:{}};
  state.lifecycle.tasks[key]={id,stage,operation,revision,inputSha256,artifactSha256:artifact.sha256,
    artifactContext:artifact.context,draftToken:artifact.draftToken,draftAuthorTaskId:artifact.authorTaskId,draftRevision:artifact.draftRevision,promptPath:relative,promptSha256:sha(prompt),status:'FROZEN',createdAt:new Date().toISOString(),editableIds,editablePaths,targetIds,findingIds,sourceReviewTaskId:operation==='correct'?reviewSource?.taskId:undefined,originalTaskSha256:sha(originalTask),sourceContextSha256,authorityFingerprint,evidenceSha256,mediaTransferAttested,mediaKind:scope.media,mediaSha256s,mediaDuration,mediaBaseline:structuredClone(state.media??[])};
  writeState(root,state);
  return{...state.lifecycle.tasks[key],prompt};
}

export function validateLocks(stage:Stage,before:unknown,after:unknown,editable:string[],editablePaths:string[]){
  const parent=stage==='script'?'/sections':'/manifest/shots';
  const oldRows=stage==='script'?((before as {sections:Array<{id:string}>}).sections):
    ((before as {manifest:{shots:Array<{id:string}>}}).manifest.shots);
  const newRows=stage==='script'?((after as {sections:Array<{id:string}>}).sections):
    ((after as {manifest:{shots:Array<{id:string}>}}).manifest.shots);
  if(!Array.isArray(oldRows)||!Array.isArray(newRows)||oldRows.length!==newRows.length)
    throw new Error('Correction cannot add/remove shots or sections without an explicit structural reissue.');
  for(let i=0;i<oldRows.length;i++){
    if(oldRows[i].id!==newRows[i].id)throw new Error('Correction changed the locked entity identity or ordering.');
  }
  if(stage==='native'){
    const left=(before as {manifest:Record<string,unknown>}).manifest,right=(after as {manifest:Record<string,unknown>}).manifest;
    for(const key of ['voice','captions']){
      if(canonical(left[key])!==canonical(right[key]))throw new Error('Approved narration and word/caption timing are immutable in Native correction: '+key);
    }
  }
  function authorized(pointer:string):boolean{
    if(editablePaths.some(path=>pointer===path||pointer.startsWith(path+'/')))return true;
    for(let i=0;i<oldRows.length;i++){
      const rowPath=parent+'/'+i;
      if(editable.includes(oldRows[i].id)&&pointer.startsWith(rowPath+'/')&&pointer!==rowPath+'/id')return true;
    }
    return false;
  }
  function compare(left:unknown,right:unknown,pointer:string){
    if(canonical(left)===canonical(right))return;
    if(authorized(pointer))return;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))
      throw new Error('Locked native/creative field changed: '+(pointer||'/'));
    if(Array.isArray(left)&&Array.isArray(right)){
      if(left.length!==right.length){
        const aux=stage==='native'&&['/shot_ledger','/sound_script','/asset_needs'].includes(pointer);
        const addition=aux&&right.length>left.length&&
          right.slice(left.length).every((_,offset)=>editablePaths.includes(pointer+'/'+(left.length+offset)));
        if(!addition)throw new Error('Locked array size changed: '+pointer);
      }
      for(let i=0;i<left.length;i++)compare(left[i],right[i],pointer+'/'+i);
      return;
    }
    const l=left as Record<string,unknown>,r=right as Record<string,unknown>;
    for(const key of new Set([...Object.keys(l),...Object.keys(r)]))
      compare(l[key],r[key],pointer+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
  }
  compare(before,after,'');
}
function validateReview(payload:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string],operation:ExternalOperation){
  exact(payload,['schema','artifact_sha256','status','coverage','findings']);
  if(payload.schema!=='mode-b-review-v1'||payload.artifact_sha256!==task.artifactSha256||
    !['REVIEWED_WITH_FINDINGS','REVIEWED_NO_FINDINGS','INSUFFICIENT_EVIDENCE','NOT_VERIFIED'].includes(String(payload.status))||
    !Array.isArray(payload.findings))throw new Error('Invalid review result.');
  const coverage=payload.coverage as Record<string,unknown>;
  if(!coverage||typeof coverage!=='object'||Array.isArray(coverage))throw new Error('Review coverage is required.');
  exact(coverage,['target_ids','modalities','ranges','media_sha256s']);
  const covered=coverage.target_ids;
  if(!Array.isArray(covered)||covered.some(id=>typeof id!=='string'||!task.targetIds?.includes(id))||new Set(covered).size!==covered.length)
    throw new Error('Review coverage contains fabricated, duplicate or missing target identities.');
  if(payload.status!=='INSUFFICIENT_EVIDENCE'&&payload.status!=='NOT_VERIFIED'&&
    (covered.length!==task.targetIds?.length||task.targetIds?.some(id=>!covered.includes(id))))
    throw new Error('Unsupported review coverage: every requested target must be accounted for.');
  if(!Array.isArray(coverage.modalities)||!Array.isArray(coverage.ranges))throw new Error('Review coverage modalities and ranges must be arrays.');
  const mediaSha256s=coverage.media_sha256s??[];
  if(!Array.isArray(mediaSha256s)||new Set(mediaSha256s).size!==mediaSha256s.length||
    mediaSha256s.some(value=>typeof value!=='string'||!task.mediaSha256s?.includes(value))||
    (task.mediaTransferAttested?JSON.stringify(mediaSha256s)!==JSON.stringify(task.mediaSha256s):mediaSha256s.length!==0))
    throw new Error('Review media provenance differs from frozen owner-attested transfer scope.');

  if(coverage.modalities.some(modality=>!['picture','motion','sound','captions','script','manifest'].includes(String(modality)))||
    new Set(coverage.modalities).size!==coverage.modalities.length)
    throw new Error('Review coverage claims unknown or duplicate evidence modalities.');
  for(const range of coverage.ranges){
    if(!range||typeof range!=='object'||Array.isArray(range))throw new Error('Invalid review time range.');
    const value=range as Record<string,unknown>;
    exact(value,['start','end']);
    if(typeof value.start!=='number'||!Number.isFinite(value.start)||value.start<0||
      typeof value.end!=='number'||!Number.isFinite(value.end)||value.end<=value.start)
      throw new Error('Review time ranges require real finite increasing bounds.');
    if(operation==='media-review'&&(task.mediaDuration===undefined||value.end>task.mediaDuration+.01))
      throw new Error('Review coverage time range missing verified duration or outside actual frozen media.');
  }
  if(operation==='media-review'&&!task.mediaTransferAttested&&coverage.modalities.some(modality=>['picture','motion','sound','captions'].includes(String(modality))))
    throw new Error('NOT_VERIFIED: locally packaged media does not establish transferred or inspected audiovisual modalities.');
  if(task.stage==='native'&&operation!=='media-review'){
    // Author/Review/Correct/Recheck receive manifest/ledger text, not inspected media.
    if(coverage.modalities.some(item=>item!=='manifest')||coverage.ranges.length||mediaSha256s.length)
      throw new Error('NATIVE_TEXT_REVIEW_EVIDENCE_INVALID: only manifest text was provided.');
    if(!['INSUFFICIENT_EVIDENCE','NOT_VERIFIED'].includes(String(payload.status))&&
      !coverage.modalities.includes('manifest'))
      throw new Error('NATIVE_REVIEW_MANIFEST_COVERAGE_REQUIRED');
  }

  const findings=payload.findings as unknown[],ids=new Set<string>();
  for(const item of findings){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid review finding.');
    const f=item as Record<string,unknown>;
    exact(f,['id','severity','status','target_ids','requirement','evidence','recommendation']);
    if(typeof f.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(f.id)||ids.has(f.id))throw new Error('Invalid/duplicate finding ID.');
    ids.add(f.id);
    if(!['critical','major','minor'].includes(String(f.severity))||!['open','resolved','uncertain'].includes(String(f.status)))
      throw new Error('Invalid finding severity/status.');
    if(!Array.isArray(f.target_ids)||!f.target_ids.length||f.target_ids.some(id=>!task.targetIds?.includes(String(id))))
      throw new Error('Finding refers to an unknown shot/section target.');
    if(typeof f.requirement!=='string'||!f.requirement.trim()||typeof f.recommendation!=='string')throw new Error('Finding lacks violated requirement.');
    const ev=f.evidence as Record<string,unknown>;
    if(!ev||typeof ev!=='object'||Array.isArray(ev)||!['manifest','inferred','unverified','observed'].includes(String(ev.kind))||
       typeof ev.detail!=='string'||!ev.detail.trim())throw new Error('Finding lacks verifiable evidence description.');
    exact(ev,['kind','detail','source_sha256','time_range']);
    if(ev.source_sha256!==undefined&&(typeof ev.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(ev.source_sha256)))throw new Error('Malformed cited evidence SHA.');
    if(ev.time_range!==undefined){const t=ev.time_range as Record<string,unknown>;if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.start!=='number'||typeof t.end!=='number'||!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<=t.start)throw new Error('Invalid observed evidence time range.');}
    if(ev.kind==='observed'){
      if(operation!=='media-review'||!task.mediaTransferAttested)
        throw new Error('NOT_VERIFIED: visual/audio observation requires a current owner-attested manual transfer package.');
      if(typeof ev.source_sha256!=='string'||!task.mediaSha256s?.includes(ev.source_sha256))
        throw new Error('Observed evidence does not bind the exact transferred media SHA-256.');
      if(!ev.time_range&&!f.target_ids.length)
        throw new Error('Observed evidence needs an actual shot target or time range.');
      if(ev.time_range&&(task.mediaDuration===undefined||
        (ev.time_range as {end:number}).end>task.mediaDuration+.01))
        throw new Error('Observed evidence requires verified media duration and in-range timestamps.');
    }
  }
  if(operation==='recheck'&&task.findingIds?.some(id=>!ids.has(id)))throw new Error('Recheck omitted a previously unresolved finding.');
  if(payload.status==='REVIEWED_WITH_FINDINGS'&&!findings.length)throw new Error('Review declares findings but supplies none.');
  if(payload.status==='REVIEWED_WITH_FINDINGS'&&
    !findings.some(item=>['open','uncertain'].includes((item as {status:string}).status)))
    throw new Error('REVIEW_WITH_FINDINGS_REQUIRES_UNRESOLVED_FINDING');
  if(payload.status==='REVIEWED_NO_FINDINGS'&&findings.some(item=>(item as {status:string}).status!=='resolved'))throw new Error('No-findings recheck contains unresolved findings.');
  if(operation==='recheck'&&payload.status==='REVIEWED_WITH_FINDINGS'&&
    !findings.some(item=>['open','uncertain'].includes((item as {status:string}).status)))
    throw new Error('RECHECK_UNRESOLVED_FINDING_REQUIRED: only resolved findings were provided.');
  if(operation==='media-review'&&payload.status==='REVIEWED_NO_FINDINGS'&&
    (!task.mediaTransferAttested||!coverage.modalities.length||!mediaSha256s.length))
    throw new Error('INSUFFICIENT_EVIDENCE: no-findings media review needs user-attested actual attachments and explicit observed coverage.');
}
/** Retire a disabled Media Review proposal without silently discarding it.
 * The shared pending path is released only after original bytes and an
 * identity-bound recovery receipt are durably archived and re-verified.
 * Author/Review/Correct/Recheck pending proposals never enter this path.
 */
function recoverDisabledMediaReviewPending(root:string,state:StudioState):void{
  const originalPath=pendingPath(root);
  if(!fs.existsSync(originalPath))return;
  let original:Buffer;
  try{original=fs.readFileSync(originalPath);}
  catch{throw new Error('LEGACY_MEDIA_REVIEW_PENDING_RECOVERY_REQUIRED: cannot read pending bytes');}
  let pending:Record<string,unknown>;
  const blocked=(reason:string):never=>{
    throw new Error('LEGACY_MEDIA_REVIEW_PENDING_RECOVERY_REQUIRED: '+reason);
  };
  try{
    const parsed=strictJson(original.toString('utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))blocked('pending is not an object');
    pending=parsed as Record<string,unknown>;
  }catch{blocked('pending JSON is unreadable or corrupt');}
  if(pending!.operation!=='media-review')return;
  if(fs.existsSync(nativeCorrectionJournal(root)))blocked('native publication journal still exists');
  if(pending!.projectId!==state.project.id||
    !['script','native'].includes(String(pending!.stage))||
    typeof pending!.taskId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(pending!.taskId)||
    typeof pending!.token!=='string'||pending!.token.length<1||
    typeof pending!.responseSha256!=='string'||!/^[a-f0-9]{64}$/.test(pending!.responseSha256)||
    !pending!.payload||typeof pending!.payload!=='object'||Array.isArray(pending!.payload))
    blocked('legacy pending has no verified project/task/response identity');
  const stage=pending!.stage as Stage,taskId=pending!.taskId as string;
  const current=state.lifecycle?.tasks[stage+':media-review'];
  const historical=state.externalTaskArchive?.find(row=>row.stage===stage&&row.operation==='media-review'&&row.task.id===taskId)?.task;
  const task=current?.id===taskId?current:historical;
  if(!task)throw new Error('LEGACY_MEDIA_REVIEW_PENDING_RECOVERY_REQUIRED: legacy task cannot be linked or publication status is uncertain');
  if(task.stage!==stage||task.operation!=='media-review'||
    task.id!==taskId||typeof task.revision!=='number'||!Number.isInteger(task.revision)||
    typeof task.inputSha256!=='string'||!['FROZEN','STALE'].includes(String(task.status))||
    state.lifecycle?.artifacts[taskId])
    blocked('legacy task cannot be linked or publication status is uncertain');
  const responseBytes:Buffer=(()=>{
    try{
      const responseFile=resolveProjectFile(root,'.studio/external/lifecycle/results/'+taskId+'.json');
      if(!fs.existsSync(responseFile))blocked('legacy response file is missing');
      return fs.readFileSync(responseFile);
    }catch(error){
      return blocked('legacy response path or bytes are unreadable: '+String(error));
    }
  })();
  if(sha(responseBytes)!==pending!.responseSha256)blocked('legacy response SHA mismatch');
  let response:Record<string,unknown>;
  try{
    const parsed=strictJson(responseBytes.toString('utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))blocked('response is not an object');
    response=parsed as Record<string,unknown>;
  }catch{blocked('legacy response JSON is corrupt');}
  if(response!.schema!=='mode-b-lifecycle-result-v1'||
    response!.project_id!==state.project.id||response!.stage!==stage||
    response!.operation!=='media-review'||response!.task_id!==taskId||
    response!.revision!==task.revision||response!.input_sha256!==task.inputSha256||
    canonical(response!.payload)!==canonical(pending!.payload))
    blocked('legacy response envelope or payload does not match frozen task');
  const digest=sha(original);
  const archiveRelative='.studio/external/lifecycle/archived-pending/media-review-'+digest+'.json';
  const receiptRelative='.studio/external/lifecycle/archived-pending/media-review-'+digest+'.receipt.json';
  const archive=resolveProjectFile(root,archiveRelative);
  const receipt=resolveProjectFile(root,receiptRelative);
  try{
  fs.mkdirSync(path.dirname(archive),{recursive:true});
  // A partial temporary write from an interrupted process never replaces
  // the original pending or an already verified immutable archive.
  if(!fs.existsSync(archive)){
    const temp=archive+'.'+randomUUID()+'.tmp';
    try{
      const handle=fs.openSync(temp,'wx');
      try{fs.writeFileSync(handle,original);fs.fsyncSync(handle);}
      finally{fs.closeSync(handle);}
      if(sha(fs.readFileSync(temp))!==digest)blocked('temporary archive SHA mismatch');
      fs.renameSync(temp,archive);
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  if(sha(fs.readFileSync(archive))!==digest)blocked('archived pending bytes failed verification');
  const record={schema:'legacy-media-review-pending-recovery-v1',projectId:state.project.id,
    stage,operation:'media-review',taskId,token:pending!.token,
    responseSha256:pending!.responseSha256,originalSha256:digest,
    originalPath:'.studio/external/lifecycle/pending.json',archivePath:archiveRelative};
  if(fs.existsSync(receipt)){
    const saved:Record<string,unknown>=(()=>{
      try{return strictJson(fs.readFileSync(receipt,'utf8')) as Record<string,unknown>;}
      catch{return blocked('archival receipt is corrupt');}
    })();
    if(canonical(saved)!==canonical(record))blocked('archival receipt conflicts with original pending');
  }else atomicJson(receipt,record);
  if(canonical(strictJson(fs.readFileSync(receipt,'utf8')))!==canonical(record)||
    sha(fs.readFileSync(archive))!==digest)blocked('archive receipt verification failed');
  for(const file of [archive,receipt]){
    // On Windows, FlushFileBuffers requires a handle with write access.
    const handle=fs.openSync(file,'r+');
    try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
  }
  // Do not delete a shared pending that changed between validation and archive.
  if(!fs.existsSync(originalPath)||!fs.readFileSync(originalPath).equals(original))
    blocked('shared pending changed during recovery');
  fs.unlinkSync(originalPath);
  }catch(error){
    if(error instanceof Error&&error.message.startsWith('LEGACY_MEDIA_REVIEW_PENDING_RECOVERY_REQUIRED:'))
      throw error;
    blocked('archive-and-clear interrupted: '+String(error));
  }
}
export function stageLifecycleResult(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,text:string){
  requireActiveLifecycleOperation(operation);
  const state=readState(root),task=state.lifecycle?.tasks[`${stage}:${operation}`];if(!task||task.status!=='FROZEN')throw new Error('No current frozen lifecycle task exists.');
  const current=artifactFor(root,state,stage,operation,stage==='native'?(task.artifactContext??'PUBLISHED'):undefined);if(current.sha256!==task.artifactSha256)throw new Error('Lifecycle artifact is stale.');assertLifecycleFresh(appPath,root,state,task);
  const value=strictJson(text) as Record<string,unknown>;exact(value,['schema','project_id','task_id','revision','input_sha256','stage','operation','payload']);
  if(value.schema!=='mode-b-lifecycle-result-v1'||value.project_id!==state.project.id||value.task_id!==task.id||value.revision!==task.revision||value.input_sha256!==task.inputSha256||value.stage!==stage||value.operation!==operation)throw new Error('Lifecycle project/task/revision binding mismatch.');
  const payload=value.payload as Record<string,unknown>;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid lifecycle payload.');
  if(operation==='correct'){
    exact(payload,['schema','artifact_sha256','finding_ids','editable_ids','editable_paths','artifact']);
    if(payload.schema!=='mode-b-correction-v1'||payload.artifact_sha256!==task.artifactSha256||
      JSON.stringify(payload.editable_ids)!==JSON.stringify(task.editableIds??[])||
      JSON.stringify(payload.editable_paths??[])!==JSON.stringify(task.editablePaths??[])||
      JSON.stringify(payload.finding_ids)!==JSON.stringify(task.findingIds??[]))
      throw new Error('Correction scope, findings or artifact binding mismatch.');
    if(!Array.isArray(payload.finding_ids))throw new Error('Finding scope must be explicit.');
    const corrected=payload.artifact as Record<string,unknown>;
    if(!corrected||typeof corrected!=='object'||Array.isArray(corrected))throw new Error('Missing complete corrected artifact.');
    if(stage==='script'){
      const checked=validateScript(corrected);
      const previous=current.value as {sections:unknown[];authoring:unknown};
      validateLocks(stage,{schema:'mode-b-script-v1',sections:previous.sections,authoring:previous.authoring},
        checked,task.editableIds??[],task.editablePaths??[]);
      if(task.findingIds?.length&&canonical(checked)===
        canonical({schema:'mode-b-script-v1',sections:previous.sections,authoring:previous.authoring}))
        throw new Error('SCRIPT_CORRECT_NO_OP: unresolved findings require an actual authorized Script change.');
    }else{
      const previous=current.value as {manifest:Record<string,unknown>;shot_ledger:unknown;sound_script:unknown;asset_needs:unknown};
      validateManifest(state,root,corrected);
      rejectNativeUnsafePaths(corrected);
      validateLocks(stage,previous,corrected,task.editableIds??[],task.editablePaths??[]);
    }
  }else{
    validateReview(payload,task,operation);
  }
  const responseSha256=sha(text),savedPath=resultPath(root,task.id),stagingPath=pendingPath(root);
  if(fs.existsSync(stagingPath))recoverDisabledMediaReviewPending(root,state);
  if(fs.existsSync(stagingPath)){
    const existing=strictJson(fs.readFileSync(stagingPath,'utf8')) as Record<string,unknown>;
    if(existing.projectId!==state.project.id||existing.taskId!==task.id||existing.responseSha256!==responseSha256)
      throw new Error('PENDING_LIFECYCLE_CONFLICT: explicitly confirm or resolve the existing proposal before staging another.');
    if(!fs.existsSync(savedPath)||sha(fs.readFileSync(savedPath))!==responseSha256)
      throw new Error('RECOVERY_REQUIRED: staged lifecycle response bytes changed.');
    return{token:String(existing.token),before:current.value,after:payload,status:'STAGED'};
  }
  fs.mkdirSync(path.dirname(savedPath),{recursive:true});
  if(fs.existsSync(savedPath)){
    if(sha(fs.readFileSync(savedPath))!==responseSha256)
      throw new Error('Lifecycle response for this task is immutable; rebuild for a different proposal.');
  }else fs.writeFileSync(savedPath,text,{encoding:'utf8',flag:'wx'});
  const token=randomUUID();
  atomicJson(stagingPath,{token,projectId:state.project.id,taskId:task.id,stage,operation,responseSha256,payload,createdAt:new Date().toISOString()});
  return{token,before:current.value,after:payload,status:'STAGED'};
}

export interface LifecyclePublicationOptions { validator?:ConfirmOptions['validator'];previewSeconds?:number;allowSampleDraft?:boolean;hooks?:{afterJournal?:()=>void;afterStaging?:()=>void;afterNativeCommit?:()=>void} }
const nativeCorrectionJournal=(root:string)=>path.join(lifecycleDir(root),'native-publication.json');
const manifestSemanticHash=(file:string)=>sha(canonical(strictJson(fs.readFileSync(file,'utf8'))));
function finalizeLifecycle(root:string,pending:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string]){
  const state=readState(root),key=String(pending.stage)+':'+String(pending.operation);
  if(!state.lifecycle?.tasks[key]||state.lifecycle.tasks[key].id!==task.id||
    !['FROZEN','IMPORTED'].includes(state.lifecycle.tasks[key].status))throw new Error('Lifecycle finalization is stale.');
  const payload=pending.payload as Record<string,unknown>;
  state.lifecycle.artifacts[task.id]={taskId:task.id,stage:task.stage,operation:task.operation,
    artifactContext:task.artifactContext,draftAuthorTaskId:task.draftAuthorTaskId,draftToken:task.draftToken,
    artifactSha256:sha(JSON.stringify(payload)),value:payload,status:String(payload.status??'CORRECTION_STAGED'),
    createdAt:new Date().toISOString()};
  state.lifecycle.tasks[key].status='IMPORTED';
  state.lifecycle.tasks[key].confirmedResponseSha256=String(pending.responseSha256);
  if(task.stage==='script'&&task.operation==='recheck'&&payload.status==='REVIEWED_NO_FINDINGS'&&
    scriptCorrectionRechecked(state))activateScriptCandidate(root,state,'RECHECK');
  writeState(root,state);
  if(fs.existsSync(pendingPath(root)))fs.unlinkSync(pendingPath(root));
  if(fs.existsSync(nativeCorrectionJournal(root)))fs.unlinkSync(nativeCorrectionJournal(root));
  return state;
}
async function publishNativeCorrection(appPath:string,root:string,pending:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string],options:LifecyclePublicationOptions={}){
  const payload=pending.payload as {artifact:{manifest:Record<string,unknown>;shot_ledger:unknown[];sound_script:unknown[];asset_needs:unknown[]}};
  const desiredSha256=sha(canonical(payload.artifact.manifest));
  const desiredArtifactSha256=sha(canonical(payload.artifact));
  const manifestPath=path.join(root,'project.json');
  const baselineSha256=manifestSemanticHash(manifestPath);
  const journalFile=nativeCorrectionJournal(root);
  const saved=fs.existsSync(journalFile)?strictJson(fs.readFileSync(journalFile,'utf8')) as Record<string,unknown>:null;
  if(saved&&(saved.token!==pending.token||saved.taskId!==task.id||
    saved.desiredSha256!==desiredSha256||saved.desiredArtifactSha256!==desiredArtifactSha256))
    throw new Error('RECOVERY_REQUIRED: another native correction publication is pending.');
  const initial=readState(root),initialArtifact=artifactFor(root,initial,'native','correct','PUBLISHED');
  const initialArtifactSha256=sha(canonical(initialArtifact.value));
  const journal:Record<string,unknown>=saved??{
    token:pending.token,taskId:task.id,baselineSha256,desiredSha256,
    baselineArtifactSha256:initialArtifactSha256,desiredArtifactSha256,authorTaskId:null,status:'PENDING'
  };
  if(saved&&baselineSha256!==journal.baselineSha256&&baselineSha256!==desiredSha256)
    throw new Error('STALE: independent native manifest change prevents correction retry.');
  if(saved&&initialArtifactSha256!==journal.baselineArtifactSha256&&
    initialArtifactSha256!==desiredArtifactSha256)
    throw new Error('STALE: independent native creative changes prevent correction retry.');
  if(!saved){atomicJson(journalFile,journal);options.hooks?.afterJournal?.();}
  const alreadyPublished=initialArtifactSha256===desiredArtifactSha256;
  const originalNoOp=alreadyPublished&&(!saved||journal.baselineArtifactSha256===desiredArtifactSha256);
  if(baselineSha256===desiredSha256){
    if(originalNoOp){
      // A complete creative no-op needs no publication and no fabricated CLI verification.
      journal.status='NO_OP';atomicJson(journalFile,journal);
      return finalizeLifecycle(root,pending,task);
    }
    if(alreadyPublished){
      // The original CLI may have successfully published project.json before
      // lifecycle finalization was interrupted. The journal then still says
      // PENDING_RETRY, so verify its exact author task and native readiness
      // rather than misclassifying the completed manifest as auxiliary-only.
      const validatedManifestResume=Boolean(saved?.authorTaskId&&
        initial.tasks?.native?.id===saved.authorTaskId&&
        initial.tasks?.native?.status==='IMPORTED'&&initial.nativeReadiness?.sampleReady&&
        initial.nativeReadiness?.sourceFingerprint===sha(fs.readFileSync(manifestPath)));
      const publishedAuxiliary=journal.status==='AUX_PUBLISHED'||journal.status==='AUX_PENDING';
      if(!saved||!initial.external.native||
        !(validatedManifestResume||publishedAuxiliary||journal.status==='VALIDATED'))
        throw new Error('RECOVERY_REQUIRED: matching creative data without verified publication evidence is insufficient.');
      if(validatedManifestResume){journal.status='VALIDATED';atomicJson(journalFile,journal);}
      return finalizeLifecycle(root,pending,task);
    }
    if(initialArtifact.sha256!==task.artifactSha256)
      throw new Error('STALE: auxiliary correction baseline no longer matches the reviewed artifact.');
    // Auxiliary-only creative metadata is not an input to the original renderer;
    // preserve project.json, media, readiness, preview and approval verbatim.
    // If a future ledger becomes a render dependency, it must use the manifest
    // validation/invalidation path rather than this metadata-only publication.
    const current=readState(root);
    if(artifactFor(root,current,'native','correct','PUBLISHED').sha256!==task.artifactSha256||
      manifestSemanticHash(manifestPath)!==baselineSha256)
      throw new Error('STALE: native creative state changed during auxiliary publication.');
    const prior=current.external.native;
    if(!prior)throw new Error('REVIEW_REQUIRED: missing native authoring baseline.');
    validateManifest(current,root,payload.artifact as unknown as Record<string,unknown>);
    validateLocks('native',initialArtifact.value,payload.artifact,task.editableIds??[],task.editablePaths??[]);
    const revision=prior.revision+1;
    const existing=prior.artifact as Record<string,unknown>;
    current.external.native={...prior,revision,importedAt:new Date().toISOString(),
      artifact:{...existing,shotLedger:payload.artifact.shot_ledger,
        soundScript:payload.artifact.sound_script,assetNeeds:payload.artifact.asset_needs}};
    // Journal is durable before publishing; crash recovery compares complete artifacts.
    journal.status='AUX_PENDING';journal.publishedRevision=revision;atomicJson(journalFile,journal);
    options.hooks?.afterStaging?.();
    // Publish a complete historical revision pair without touching the active
    // manifest bytes or forgetting previously accepted media bindings.
    const previousAuthoringFile=path.join(root,'.studio','revisions','native-authoring-'+prior.revision+'.json');
    const previousAuthoring=fs.existsSync(previousAuthoringFile)?
      strictJson(fs.readFileSync(previousAuthoringFile,'utf8')) as Record<string,unknown>:null;
    atomicJson(path.join(root,'.studio','revisions','native-'+revision+'.json'),payload.artifact.manifest);
    atomicJson(path.join(root,'.studio','revisions','native-authoring-'+revision+'.json'),
      {shot_ledger:payload.artifact.shot_ledger,sound_script:payload.artifact.sound_script,
       asset_needs:payload.artifact.asset_needs,
       fulfillments:previousAuthoring?.fulfillments??{},missing:existing.missing??[]});
    writeState(root,current);
    journal.status='AUX_PUBLISHED';atomicJson(journalFile,journal);
    options.hooks?.afterNativeCommit?.();
    return finalizeLifecycle(root,pending,task);
  }
  if(alreadyPublished){
    if(!saved||!initial.nativeReadiness?.sampleReady||
      initial.nativeReadiness.sourceFingerprint!==sha(fs.readFileSync(manifestPath))||
      initial.tasks?.native?.status!=='IMPORTED')
      throw new Error('RECOVERY_REQUIRED: matching native bytes do not prove CLI validation.');
    journal.status='VALIDATED';journal.publishedRevision=initial.external.native?.revision;atomicJson(journalFile,journal);
    return finalizeLifecycle(root,pending,task);
  }
  let authorTask;
  const existing=readState(root).tasks?.native;
  if(journal.authorTaskId&&existing?.id===journal.authorTaskId&&existing.status==='FROZEN')
    authorTask=freezeTask(appPath,root,'native',false);
  else {
    authorTask=freezeTask(appPath,root,'native',true);
    journal.authorTaskId=authorTask.id;atomicJson(journalFile,journal);
  }
  const newState=readState(root);
  const result={schema:'mode-b-external-result-v1',project_id:newState.project.id,task_id:authorTask.id,
    revision:authorTask.revision,input_sha256:authorTask.inputSha256,stage:'native',payload:payload.artifact};
  const pendingImport=stageImport(appPath,root,'native',JSON.stringify(result));
  options.hooks?.afterStaging?.();
  try{
    await confirmImport(appPath,root,pendingImport.token,{validator:options.validator,previewSeconds:options.previewSeconds,allowSampleDraft:options.allowSampleDraft});
    options.hooks?.afterNativeCommit?.();
  }catch(error){
    journal.status='PENDING_RETRY';journal.detail=String(error);atomicJson(journalFile,journal);
    throw error;
  }
  const current=readState(root);
  if(manifestSemanticHash(manifestPath)!==desiredSha256||!current.external.native||!current.nativeReadiness?.sampleReady)
    throw new Error('RECOVERY_REQUIRED: native publication is not the validated proposed manifest.');
  journal.status='VALIDATED';journal.publishedRevision=current.external.native.revision;atomicJson(journalFile,journal);
  return finalizeLifecycle(root,pending,task);
}
export function confirmLifecycleResult(appPathOrRoot:string,rootOrToken:string,maybeToken?:string,options:LifecyclePublicationOptions={}):StudioState|Promise<StudioState>{
  const appPath=maybeToken?appPathOrRoot:path.resolve('.'),root=maybeToken?rootOrToken:appPathOrRoot,token=maybeToken??rootOrToken;
  const file=pendingPath(root);
  if(!fs.existsSync(file))throw new Error('No pending lifecycle result.');
  const pending=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>,state=readState(root);
  if(pending.operation==='media-review')throw new Error('MEDIA_REVIEW_DISABLED: legacy history is read-only.');
  if(pending.token!==token||pending.projectId!==state.project.id)throw new Error('Lifecycle confirmation token/project mismatch.');
  const key=String(pending.stage)+':'+String(pending.operation),task=state.lifecycle?.tasks[key];
  if(!task||task.id!==pending.taskId)throw new Error('Lifecycle task is stale or replayed.');
  if(task.status==='IMPORTED'&&state.lifecycle?.artifacts[task.id]?.taskId===task.id){fs.unlinkSync(file);if(fs.existsSync(nativeCorrectionJournal(root)))fs.unlinkSync(nativeCorrectionJournal(root));return state;}
  if(task.status!=='FROZEN')throw new Error('Lifecycle task is stale or replayed.');
  const recoveryJournal=nativeCorrectionJournal(root);
  const journal=fs.existsSync(recoveryJournal)?
    strictJson(fs.readFileSync(recoveryJournal,'utf8')) as Record<string,unknown>:null;
  const currentManifestSha256=manifestSemanticHash(path.join(root,'project.json'));
  const nativeTask=state.tasks?.native;
  const trustedNativeResume=Boolean(pending.operation==='correct'&&pending.stage==='native'&&journal&&
    journal.token===token&&journal.taskId===task.id&&
    (currentManifestSha256===journal.baselineSha256||currentManifestSha256===journal.desiredSha256)&&
    (!journal.authorTaskId||nativeTask?.id===journal.authorTaskId));
  assertLifecycleFresh(appPath,root,state,task,trustedNativeResume);
  const frozenFile=resultPath(root,task.id);
  if(!fs.existsSync(frozenFile)||sha(fs.readFileSync(frozenFile))!==pending.responseSha256)
    throw new Error('Frozen lifecycle response bytes changed before publication.');
  const frozen=strictJson(fs.readFileSync(frozenFile,'utf8')) as Record<string,unknown>;
  if(canonical(frozen.payload)!==canonical(pending.payload))throw new Error('Lifecycle pending response is corrupt.');
  const original=artifactFor(root,state,task.stage,task.operation,task.stage==='native'?(task.artifactContext??'PUBLISHED'):undefined);
  const desiredDraftValue=(pending.payload as {artifact?:{
    manifest:unknown;shot_ledger:unknown;sound_script:unknown;asset_needs:unknown}}).artifact;
  const draftDesiredSha256=desiredDraftValue?sha(JSON.stringify({
    manifest:desiredDraftValue.manifest,shot_ledger:desiredDraftValue.shot_ledger,
    sound_script:desiredDraftValue.sound_script,asset_needs:desiredDraftValue.asset_needs
  })):null;
  const draftRecovery=task.stage==='native'&&task.operation==='correct'&&
    task.artifactContext==='DRAFT'&&readNativeDraft(root,state)?.history.some(item=>
      item.correctTaskId===task.id&&item.previousSha256===task.artifactSha256&&
      item.artifactSha256===draftDesiredSha256)===true;
  if(original.sha256!==task.artifactSha256&&!draftRecovery) {
    const journal=nativeCorrectionJournal(root);
    const saved=fs.existsSync(journal)?strictJson(fs.readFileSync(journal,'utf8')) as Record<string,unknown>:null;
    if(!(pending.operation==='correct'&&pending.stage==='native'&&saved?.token===token&&
      saved.desiredArtifactSha256===sha(canonical(original.value))&&
      ((saved.status==='AUX_PUBLISHED'&&manifestSemanticHash(path.join(root,'project.json'))===saved.baselineSha256)||
       (manifestSemanticHash(path.join(root,'project.json'))===saved.desiredSha256&&
        state.nativeReadiness?.sampleReady&&state.nativeReadiness.sourceFingerprint===sha(fs.readFileSync(path.join(root,'project.json')))))))
      throw new Error('STALE: original lifecycle artifact changed before confirmation.');
  }
  if(pending.operation==='correct'&&pending.stage==='native'&&task.artifactContext==='DRAFT'){
    const corrected=(pending.payload as {artifact:Record<string,unknown>}).artifact;
    // Do not ever publish project.json, launch Native CLI or bind old media here.
    if(!draftRecovery){
      validateLocks('native',original.value,corrected,task.editableIds??[],task.editablePaths??[]);
    }
    publishNativeDraftCorrection(appPath,root,task.artifactSha256,corrected,{
      correctTaskId:task.id,reviewTaskId:task.sourceReviewTaskId??'',
      editableIds:task.editableIds??[],editablePaths:task.editablePaths??[],
      findingIds:task.findingIds??[]
    });
    // After a durable correction, only jobs whose effective creative target
    // changed become STALE. Unrelated jobs and approved bindings remain intact.
    invalidateGlabsJobsAfterNativeCorrection(appPath,root);
    return finalizeLifecycle(root,pending,task);
  }
  if(pending.operation==='correct'&&pending.stage==='native')
    return publishNativeCorrection(appPath,root,pending,task,options);
  if(pending.operation==='correct'&&pending.stage==='script'){
    const payload=pending.payload as {artifact:{sections:Array<{id:string;text:string}>;authoring:Record<string,unknown>}};
    const checked=validateScript(payload.artifact as unknown as Record<string,unknown>);
    const candidateText=checked.sections.map(row=>row.text).join('\n\n');
    const revision=Math.max(state.scriptCandidate?.revision??0,state.external.script?.revision??0)+1;
    state.scriptCandidate={sections:checked.sections,text:candidateText,sha256:sha(candidateText),revision,importedAt:new Date().toISOString(),taskId:task.id,authoring:checked.authoring};
    state.external.script={revision,artifact:checked,importedAt:new Date().toISOString()};
    atomicJson(path.join(root,'.studio','revisions','script-'+revision+'.json'),checked);
    state.lifecycle!.artifacts[task.id]={taskId:task.id,stage:task.stage,operation:task.operation,artifactSha256:sha(JSON.stringify(pending.payload)),value:pending.payload,status:'CORRECTION_STAGED',createdAt:new Date().toISOString()};
    task.status='IMPORTED';task.confirmedResponseSha256=String(pending.responseSha256);
    writeState(root,state);
    if(fs.existsSync(file))fs.unlinkSync(file);
    return state;
  }
  return finalizeLifecycle(root,pending,task);
}

export function exportReviewPack(root:string,kind:'preview'|'film'|'voice'|'captions'){
  const state=readState(root),available=evidence(root,state,{media:kind}),id=randomUUID();
  const relative='.studio/external/review-packs/'+kind+'-'+id,dir=resolveProjectFile(root,relative);
  const attachments:Array<{path:string;sha256:string;bytes:number;kind:string;original:string}>=[];
  const attach=(source:string,expected:string,mediaKind:string)=>{
    const input=resolveProjectFile(root,source),bytes=fs.readFileSync(input);
    if(sha(bytes)!==expected)throw new Error('BLOCKED: media review source bytes changed: '+source);
    const target='media/'+attachments.length+'-'+path.basename(source),output=path.join(dir,target);
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output);
    if(sha(fs.readFileSync(output))!==expected)throw new Error('Review package copy verification failed.');
    attachments.push({path:target,sha256:expected,bytes:bytes.length,kind:mediaKind,original:source});
  };
  for(const file of available.files as Array<{path:string;sha256:string}>)attach(file.path,file.sha256,kind);
  if((kind==='preview'||kind==='film')&&state.voice&&!state.voice.stale)attach(state.voice.path,state.voice.sha256,'voice');
  const report=kind==='preview'?state.preview:kind==='film'?state.render:null;
  if(report)attach(report.reportPath,report.reportSha256,'original_native_QA_report');
  const outputBase=kind==='preview'?'preview':'film';
  for(const extension of ['srt','vtt']){
    const subtitlePath='output/'+outputBase+'.'+extension;
    const filename=resolveProjectFile(root,subtitlePath);
    if(fs.existsSync(filename))attach(subtitlePath,sha(fs.readFileSync(filename)),'encoded_'+extension);
  }
  const sheetPath='output/'+outputBase+'-contact-sheet.png';
  const sheetFile=resolveProjectFile(root,sheetPath);
  if(fs.existsSync(sheetFile))attach(sheetPath,sha(fs.readFileSync(sheetFile)),'contact_sheet_stills_not_motion_proof');
  const promptTask=state.tasks?.native;
  if(promptTask){
    const pathToPrompt=resolveProjectFile(root,promptTask.promptPath);
    if(!fs.existsSync(pathToPrompt)||sha(fs.readFileSync(pathToPrompt))!==promptTask.promptSha256)
      throw new Error('REBUILD_REQUIRED: original frozen Native authority/task changed before review export.');
    attach(promptTask.promptPath,promptTask.promptSha256!,'original_frozen_Native_task_authority');
  }
  const native=strictJson(fs.readFileSync(path.join(root,'project.json'),'utf8')) as Record<string,unknown>;
  const originalTask=state.tasks?.native??null;
  const originalPrompt=originalTask&&fs.existsSync(resolveProjectFile(root,originalTask.promptPath))?
    {path:originalTask.promptPath,sha256:sha(fs.readFileSync(resolveProjectFile(root,originalTask.promptPath)))}:null;
  let words:unknown=null;
  if(state.alignment?.wordsSha256){
    const input=resolveProjectFile(root,state.alignment.path),bytes=fs.readFileSync(input);
    if(sha(bytes)!==state.alignment.wordsSha256)throw new Error('BLOCKED: actual alignment changed before review-pack export.');
    words=strictJson(bytes.toString('utf8'));
  }
  const pack={schema:'mode-b-review-pack-v2',project_id:state.project.id,kind,created_at:new Date().toISOString(),
    transfer_status:'LOCAL_PACKAGE_CREATED_NOT_PROOF_OF_CHATGPT_TRANSFER',attachments,
    coverage:available,script:state.approvedScript??null,original_native_task:originalPrompt,source_requirements:'See attached hash-verified original frozen Native task and the manual media-review prompt; no automatic evidence observation.',
    manifest_sha256:sha(fs.readFileSync(path.join(root,'project.json'))),shots:native.shots??[],
    captions:native.captions??[],actual_word_alignment:words,media_ledger:state.media??[],
    native_qa_report:kind==='preview'?state.preview?.reportPath:kind==='film'?state.render?.reportPath:null,
    notice:'The folder contains actual copied media and this manifest. Manually transfer the requested MP4/WAV and review-package JSON to ChatGPT. A local path or SHA does not prove the model inspected frames, heard audio or verified motion. Owner acceptance remains separate.'};
  const output=path.join(dir,'review-package.json');atomicJson(output,pack);
  return{path:relative+'/review-package.json',folder:relative,pack};
}
