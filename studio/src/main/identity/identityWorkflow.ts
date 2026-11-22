/** F24 explicit upstream workflow. This is NOT the legacy Script/Native Stage.
 * All artifacts remain scoped to the exact approved Script and frozen task. */
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {atomicJson,readState,resolveProjectFile,strictJson,sha,writeState,type StudioState} from '../services.js';
import {loadImageStyleProfile} from '../imagePreparation.js';
import {contentHash,type ScriptAnalysis,type StyleBible,type IdentityReviewOperation} from './contracts.js';
import {analysisLineage,freezeAnalysisTask,validateAnalysisEnvelope,
  analysisAuthorContract,analysisReviewContract,
  validateScriptAnalysis,verifyIndependentReview,type ApprovedScriptSnapshot,
  type AnalysisTask,type AnalysisReview} from './scriptAnalysis.js';
import {compileStyleBible,type PinnedStyle} from './styleBible.js';
import {approveCandidate,publishApprovalSet,validatePublishedSet,verifyReferenceFile,
  type ReferenceCandidate,type ReferenceApprovalSet,type IdentityDecoder} from './referencePublication.js';
import {referencePromptForCharacter} from './styleBible.js';
import {importMediaFile} from '../externalTasks.js';
import {previewReferenceSwitchImpact,assertNoIdentityBusyJobs} from './impact.js';
import {readReferenceJob} from './referenceGeneration.js';
import {ownerVisualDefinitionDigest,validateOwnerVisualDefinition,
  type OwnerVisualDefinition} from './visualDefinitions.js';

type TaskState='FROZEN'|'IMPORTED'|'STALE';
interface TaskEntry{task:AnalysisTask;status:TaskState;frozenArtifactSha:string|null;at:string}
interface JournalEvent{
  eventId:string;at:string;action:string;sha256:string;sourceRevision:number
}
export interface PublishedIdentityAuthority{
  analysis:ScriptAnalysis;analysisApproved:NonNullable<IdentityWorkflowStore['analysisApproved']>;
  independentReview:AnalysisReview;bible:StyleBible;
  bibleTextApproved:NonNullable<IdentityWorkflowStore['bibleTextApproved']>;
  referenceApprovalSet:ReferenceApprovalSet;snapshotSha:string;
}
export interface IdentityWorkflowStore{
  schema:'stickman-identity-workflow-v1';projectId:string;revision:number;
  currentTask:TaskEntry|null;draftAnalysis:ScriptAnalysis|null;
  draftSha256:string|null;independentReview:AnalysisReview|null;
  analysisApproved:{sha256:string;approvedAt:string;reviewSha256:string}|null;
  bible:StyleBible|null;bibleTextApproved:{sha256:string;approvedAt:string}|null;
  referenceCandidates:ReferenceCandidate[];
  referenceApprovalSet:ReferenceApprovalSet|null;
  referenceApprovalHistory?:ReferenceApprovalSet[];
  publishedAuthority?:PublishedIdentityAuthority|null;
  ownerVisualDefinitions?:OwnerVisualDefinition[];
  events:JournalEvent[];
}
const file=(root:string)=>resolveProjectFile(root,'.studio/identity/workflow-v1.json');
const clone=<T>(value:T):T=>structuredClone(value);
function empty(projectId:string):IdentityWorkflowStore{
  return{schema:'stickman-identity-workflow-v1',projectId,revision:0,
    currentTask:null,draftAnalysis:null,draftSha256:null,
    independentReview:null,analysisApproved:null,bible:null,bibleTextApproved:null,
    referenceCandidates:[],referenceApprovalSet:null,referenceApprovalHistory:[],
    publishedAuthority:null,ownerVisualDefinitions:[],events:[]};
}
export const identityPolicy=(state:StudioState):'legacy'|'v1'=>state.identityPolicy??'legacy';
export function currentApprovedSource(root:string):ApprovedScriptSnapshot{
  const state=readState(root),approved=state.approvedScript;
  if(!approved)throw Error('IDENTITY_APPROVED_SCRIPT_REQUIRED');
  const source:ApprovedScriptSnapshot={
    projectId:state.project.id,sha256:approved.sha256,revision:approved.revision,
    sections:clone(approved.sections),authoring:clone(approved.authoring??{})
  };
  analysisLineage(source);return source;
}
function pinned(appPath:string,root:string):PinnedStyle{
  const value=readState(root).project.style;
  if(!['B1','B2','B3','B4'].includes(value))throw Error('STYLE_BIBLE_STYLE_INVALID');
  const style=loadImageStyleProfile(appPath,value as PinnedStyle['id']);
  return{id:value as PinnedStyle['id'],sha256:style.sha256,guidance:style.guidance};
}
export function readIdentityWorkflow(root:string):IdentityWorkflowStore{
  const projectId=readState(root).project.id;
  if(!fs.existsSync(file(root)))return empty(projectId);
  const data=strictJson(fs.readFileSync(file(root),'utf8')) as unknown as IdentityWorkflowStore;
  if(data?.schema!=='stickman-identity-workflow-v1'||data.projectId!==projectId||
    !Number.isSafeInteger(data.revision)||data.revision<0||
    !Array.isArray(data.events)||!Array.isArray(data.referenceCandidates)||
    data.events.length>2000||data.referenceCandidates.length>400||
    (data.referenceApprovalHistory!==undefined&&
      (!Array.isArray(data.referenceApprovalHistory)||
       data.referenceApprovalHistory.length>100))||
    (data.ownerVisualDefinitions!==undefined&&
      (!Array.isArray(data.ownerVisualDefinitions)||
       data.ownerVisualDefinitions.length>100||
       data.ownerVisualDefinitions.some(v=>!v||typeof v.charId!=='string')||
       new Set(data.ownerVisualDefinitions.map(v=>v.charId)).size!==
         data.ownerVisualDefinitions.length)))
    throw Error('IDENTITY_WORKFLOW_CORRUPT');
  if(data.draftAnalysis&&data.draftSha256!==contentHash(data.draftAnalysis))
    throw Error('IDENTITY_DRAFT_ANALYSIS_TAMPERED');
  if(!data.draftAnalysis&&data.draftSha256!==null)
    throw Error('IDENTITY_DRAFT_ANALYSIS_TAMPERED');
  for(const priorSet of data.referenceApprovalHistory??[]){
    if(!priorSet||priorSet.schema!=='stickman-reference-approval-set-v1')
      throw Error('IDENTITY_REFERENCE_HISTORY_CORRUPT');
    const {approval_set_sha256:stored,...base}=priorSet;
    if(contentHash(base)!==stored)throw Error('IDENTITY_REFERENCE_HISTORY_CORRUPT');
  }
  publishedSnapshot(data);
  return data;
}
/** Migration reads only complete, independently reviewed prior authority. */
function publishedSnapshot(journal:IdentityWorkflowStore):PublishedIdentityAuthority|null{
  if(journal.publishedAuthority){
    const {snapshotSha,...record}=journal.publishedAuthority;
    if(contentHash(record)!==snapshotSha)
      throw Error('IDENTITY_PUBLISHED_AUTHORITY_TAMPERED');
    if(record.analysisApproved.sha256!==contentHash(record.analysis)||
      record.analysisApproved.reviewSha256!==contentHash(record.independentReview)||
      !verifyIndependentReview(record.independentReview,record.analysis)||
      record.bible.analysis_sha256!==contentHash(record.analysis)||
      record.bibleTextApproved.sha256!==record.bible.style_bible_sha256||
      record.referenceApprovalSet.style_bible_sha256!==record.bible.style_bible_sha256)
      throw Error('IDENTITY_PUBLISHED_AUTHORITY_STALE');
    const {approval_set_sha256,...setBody}=record.referenceApprovalSet;
    if(contentHash(setBody)!==approval_set_sha256)
      throw Error('IDENTITY_PUBLISHED_REFERENCE_SET_TAMPERED');
    return journal.publishedAuthority;
  }
  if(!journal.referenceApprovalSet)return null;
  const {draftAnalysis:analysis,analysisApproved,independentReview,bible,
    bibleTextApproved,referenceApprovalSet}=journal;
  if(!analysis||!analysisApproved||!independentReview||!bible||
    !bibleTextApproved||!referenceApprovalSet)
    throw Error('IDENTITY_LEGACY_PUBLISHED_AUTHORITY_INCOMPLETE');
  const record={analysis:clone(analysis),analysisApproved:clone(analysisApproved),
    independentReview:clone(independentReview),bible:clone(bible),
    bibleTextApproved:clone(bibleTextApproved),
    referenceApprovalSet:clone(referenceApprovalSet)};
  return publishedSnapshot({...journal,publishedAuthority:{
    ...record,snapshotSha:contentHash(record)}});
}
/** Native and G-Labs use last published authority during candidate review. */
export function publishedIdentityView(journal:IdentityWorkflowStore):IdentityWorkflowStore{
  const pub=publishedSnapshot(journal);
  if(!pub)return journal;
  return {...journal,draftAnalysis:pub.analysis,draftSha256:contentHash(pub.analysis),
    independentReview:pub.independentReview,analysisApproved:pub.analysisApproved,
    bible:pub.bible,bibleTextApproved:pub.bibleTextApproved,
    referenceApprovalSet:pub.referenceApprovalSet};
}
/** Preserve prior immutable canonical authority when upstream lineage changes. */
function archiveReferenceSet(next:IdentityWorkflowStore){
  const current=next.referenceApprovalSet;
  if(!current)return;
  const history=next.referenceApprovalHistory??[];
  if(!history.some(previous=>previous.approval_set_sha256===
    current.approval_set_sha256))
    next.referenceApprovalHistory=[...history,current].slice(-100);
}
function save(root:string,prior:IdentityWorkflowStore,next:IdentityWorkflowStore,
  action:string,artifact:unknown):IdentityWorkflowStore{
  const updated:IdentityWorkflowStore={...next,revision:prior.revision+1,
    events:[...prior.events,{eventId:randomUUID(),at:new Date().toISOString(),
      action,sha256:contentHash(artifact),sourceRevision:prior.revision+1}]};
  if(updated.events.length>2000)throw Error('IDENTITY_HISTORY_LIMIT_REACHED');
  atomicJson(file(root),updated);return updated;
}
function active(root:string){
  const state=readState(root);
  if(identityPolicy(state)!=='v1')throw Error('IDENTITY_POLICY_NOT_V1');
  return currentApprovedSource(root);
}
function validDraft(root:string,journal:IdentityWorkflowStore){
  const script=active(root),draft=journal.draftAnalysis;
  if(!draft)throw Error('SCRIPT_ANALYSIS_DRAFT_REQUIRED');
  validateScriptAnalysis(draft,script);
  if(journal.draftSha256!==contentHash(draft))throw Error('SCRIPT_ANALYSIS_DRAFT_CORRUPT');
  return{script,draft};
}
function validApproved(root:string,journal:IdentityWorkflowStore){
  const {script,draft}=validDraft(root,journal),approved=journal.analysisApproved;
  if(!approved||approved.sha256!==contentHash(draft)||
    !journal.independentReview||!verifyIndependentReview(journal.independentReview,draft)||
    approved.reviewSha256!==contentHash(journal.independentReview))
    throw Error('SCRIPT_ANALYSIS_NOT_REVIEWED_AND_APPROVED');
  return{script,analysis:draft};
}
export function identityWorkflowSnapshot(root:string,appPath:string){
  const record=readIdentityWorkflow(root),published=publishedIdentityView(record),
    policy=identityPolicy(readState(root));
  let readiness='LEGACY';
  if(policy==='v1'){
    try{
      const {script,analysis}=validApproved(root,published);
      readiness='ANALYSIS_APPROVED';
      if(published.bible){
        const current=compileStyleBible(analysis,script,pinned(appPath,root));
        if(published.bible.style_bible_sha256!==current.style_bible_sha256||
          contentHash(published.bible)!==contentHash(current))
          readiness='STYLE_BIBLE_STALE';
        else if(published.bibleTextApproved?.sha256!==current.style_bible_sha256)
          readiness='STYLE_BIBLE_TEXT_REVIEW_REQUIRED';
        else{
          readiness=published.referenceApprovalSet?.style_bible_sha256===
            current.style_bible_sha256?'REFERENCES_PUBLISHED':'STYLE_BIBLE_APPROVED';
        }
      }
    }catch(error){readiness=error instanceof Error?error.message:'IDENTITY_INTEGRITY_ERROR';}
  }
  return{policy,readiness,journal:record};
}
/** No implicit migration of historical candidates, Core output or reference identity. */
export function previewIdentityUpgrade(root:string){
  const state=readState(root);
  const existing=resolveProjectFile(root,'project.json');
  const nativeSha=fs.existsSync(existing)?sha(fs.readFileSync(existing)):null;
  const impacts=(state.media??[]).filter(item=>item.kind==='image').map(item=>({
    path:item.path,sha256:item.sha256,hasNativeOwner:Boolean(item.shotId||item.layerId)
  })).sort((a,b)=>a.path.localeCompare(b.path));
  const details={projectId:state.project.id,policy:identityPolicy(state),
    approvedScriptSha:state.approvedScript?.sha256??null,
    nativeProjectSha:nativeSha,media:impacts,
    importedNativeRevision:state.external.native?.revision??null,
    existingGlabsHistoryUnchanged:true,
    publishedOutputRequiresExplicitRevalidation:true};
  return{...details,impactSha256:contentHash(details)};
}
export function upgradeIdentityPolicy(root:string,input:{
  impactSha256:string;ownerConfirmed:true
}){
  const state=readState(root),preview=previewIdentityUpgrade(root);
  if(identityPolicy(state)!=='legacy'||input.ownerConfirmed!==true||
    preview.impactSha256!==input.impactSha256)
    throw Error('IDENTITY_UPGRADE_IMPACT_REVIEW_REQUIRED');
  const jobsDir=resolveProjectFile(root,'.studio/glabs/jobs');
  if(fs.existsSync(jobsDir))for(const name of fs.readdirSync(jobsDir).filter(name=>
    /^[a-f0-9-]{36}\.json$/i.test(name))){
    const record=strictJson(fs.readFileSync(resolveProjectFile(root,
      '.studio/glabs/jobs/'+name),'utf8')) as Record<string,unknown>;
    if(record.projectId===state.project.id&&
      ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(String(record.status)))
      throw Error('IDENTITY_UPGRADE_PROVIDER_JOB_ACTIVE_OR_UNKNOWN');
  }
  // Atomic sidecar first, explicit policy switch second. Recovery is fail-closed;
  // legacy never appears v1-certified until all upstream approvals are current.
  atomicJson(resolveProjectFile(root,'.studio/identity/migration-v1.json'),{
    schema:'stickman-identity-migration-v1',projectId:state.project.id,
    previousPolicy:'legacy',newPolicy:'v1',
    impactSha256:preview.impactSha256,approvedAt:new Date().toISOString(),
    impactedMedia:preview.media,preexistingNativeSha:preview.nativeProjectSha
  });
  state.identityPolicy='v1';writeState(root,state);
  return previewIdentityUpgrade(root);
}
/** Only a human explicitly selects one of the four external operations. */
export function freezeIdentityTask(root:string,operation:IdentityReviewOperation,
  expectedRevision:number):IdentityWorkflowStore{
  const script=active(root),prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  if(!['author','review','correct','recheck'].includes(operation))
    throw Error('IDENTITY_OPERATION_INVALID');
  const hasDraft=Boolean(prior.draftAnalysis);
  if(operation!=='author'&&!hasDraft)throw Error('SCRIPT_ANALYSIS_DRAFT_REQUIRED');
  if(operation==='correct'&&(!prior.independentReview||
      !prior.independentReview.findings.some(f=>f.severity==='P0'||f.severity==='P1')))
    throw Error('SCRIPT_ANALYSIS_CORRECT_REVIEW_REQUIRED');
  if(operation==='recheck'&&(!prior.currentTask||
      prior.currentTask.task.operation!=='correct'||prior.currentTask.status!=='IMPORTED'))
    throw Error('SCRIPT_ANALYSIS_RECHECK_CORRECTION_REQUIRED');
  const promptInputs={sourceAnalysisSha:prior.draftSha256,
    unresolvedFindings:prior.independentReview?.findings??[]};
  const task=freezeAnalysisTask(script,operation,prior.revision+1,promptInputs);
  if(operation==='review'||operation==='recheck'){
    task.prompt=[
      '# INDEPENDENT SCRIPT ANALYSIS REVIEW / '+operation.toUpperCase(),
      'Review the EXACT frozen analysis and Script evidence; do not author a new identity.',
      'Do not approve invented appearance or unsupported quote spans.',
      'Exact approved script sections '+JSON.stringify(script.sections),
      'Exact previous analysis '+JSON.stringify(prior.draftAnalysis),
      analysisReviewContract(task,prior.draftSha256!),
    ].join('\n\n');
  }else if(operation==='correct'){
    task.prompt=[
      '# SCOPED SCRIPT ANALYSIS CORRECTION',
      'Correct ONLY P0/P1 findings without modifying narration or inventing traits.',
      'A second independent Recheck is mandatory.',
      'Exact approved script sections '+JSON.stringify(script.sections),
      'Current analysis '+JSON.stringify(prior.draftAnalysis),
      'Independent findings '+JSON.stringify(prior.independentReview?.findings??[]),
      analysisAuthorContract(task),
    ].join('\n\n');
  }
  const next=clone(prior);
  next.currentTask={task,status:'FROZEN',frozenArtifactSha:prior.draftSha256,
    at:new Date().toISOString()};
  return save(root,prior,next,'freeze:'+operation,task);
}
/** Strict import: no direct LLM API and no stage spoofing. */
export function importIdentityResult(root:string,text:string,expectedRevision:number){
  const prior=readIdentityWorkflow(root),script=active(root),entry=prior.currentTask;
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  if(!entry||entry.status!=='FROZEN')throw Error('IDENTITY_FROZEN_TASK_REQUIRED');
  if(text.length>4*1024*1024)throw Error('IDENTITY_RESULT_OVERSIZE');
  const raw=strictJson(text) as Record<string,unknown>,task=entry.task;
  if(raw.schema!=='mode-b-identity-external-result-v1'||raw.stage!=='script_analysis'||
    raw.project_id!==task.project_id||raw.task_id!==task.task_id||
    raw.revision!==task.revision||raw.input_sha256!==task.input_sha256)
    throw Error('IDENTITY_RESULT_TASK_MISMATCH');
  const next=clone(prior);
  if(task.operation==='review'||task.operation==='recheck'){
    const payload=raw.payload as AnalysisReview;
    if(!next.draftAnalysis||!verifyIndependentReview(payload,next.draftAnalysis)&&payload.approved)
      throw Error('SCRIPT_ANALYSIS_REVIEW_INVALID');
    // False/negative review must still be an independently valid finding record.
    verifyIndependentReview(payload,next.draftAnalysis);
    next.independentReview=payload;next.analysisApproved=null;
  }else{
    const payload=validateAnalysisEnvelope(raw,task,script);
    next.draftAnalysis=payload;next.draftSha256=contentHash(payload);
    next.independentReview=null;next.analysisApproved=null;
    next.publishedAuthority=publishedSnapshot(prior);
    archiveReferenceSet(next);
    next.bible=null;next.bibleTextApproved=null;next.referenceApprovalSet=null;
  }
  next.currentTask={...entry,status:'IMPORTED'};
  return save(root,prior,next,'import:'+task.operation,raw);
}
export function approveScriptAnalysis(root:string,expectedRevision:number){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {draft}=validDraft(root,prior),review=prior.independentReview;
  if(!review||!verifyIndependentReview(review,draft)||prior.currentTask?.status!=='IMPORTED'||
    !['review','recheck'].includes(prior.currentTask.task.operation))
    throw Error('SCRIPT_ANALYSIS_RECHECK_OR_REVIEW_REQUIRED');
  const next=clone(prior);
  next.analysisApproved={sha256:contentHash(draft),approvedAt:new Date().toISOString(),
    reviewSha256:contentHash(review)};
  return save(root,prior,next,'approve:analysis',next.analysisApproved);
}
export function prepareProjectStyleBible(root:string,appPath:string,expectedRevision:number){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  const next=clone(prior);
  if(next.bible?.style_bible_sha256!==bible.style_bible_sha256){
    archiveReferenceSet(next);
    next.bible=bible;next.bibleTextApproved=null;next.referenceApprovalSet=null;
  }
  return save(root,prior,next,'prepare:style-bible',bible);
}
export function approveProjectStyleBible(root:string,appPath:string,
  expectedRevision:number,ownerInspected:true){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  if(ownerInspected!==true)throw Error('STYLE_BIBLE_OWNER_REVIEW_REQUIRED');
  const {script,analysis}=validApproved(root,prior);
  const current=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bible?.style_bible_sha256!==current.style_bible_sha256)
    throw Error('STYLE_BIBLE_SOURCE_STALE');
  const next=clone(prior);
  next.bibleTextApproved={sha256:current.style_bible_sha256,approvedAt:new Date().toISOString()};
  return save(root,prior,next,'approve:style-bible',next.bibleTextApproved);
}
/** Explicit visual traits at Style Bible stage. No automatically authored appearance.
 * Does not mutate the currently published reference set or earlier image bytes. */
export function approveOwnerVisualDefinition(root:string,appPath:string,input:{
  expectedRevision:number;anchorId:string;provenance:'SCRIPT_AUTHOR'|'OWNER_BRIEF';
  evidence:string;traits:string[];ownerInspected:true
}){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==input.expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  if(input.ownerInspected!==true)throw Error('OWNER_VISUAL_DEFINITION_APPROVAL_REQUIRED');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('STYLE_BIBLE_TEXT_APPROVAL_REQUIRED');
  const prepared={
    charId:input.anchorId,styleBibleSha:bible.style_bible_sha256,
    sourceScriptSha:script.sha256,sourceAuthoringSha:contentHash(script.authoring),
    provenance:input.provenance,evidence:input.evidence.trim(),
    traits:input.traits.map(trait=>trait.trim()),approvedByOwner:true as const,
    approvedAt:new Date().toISOString()
  };
  const definition:OwnerVisualDefinition={
    ...prepared,definitionSha:ownerVisualDefinitionDigest(prepared)};
  validateOwnerVisualDefinition(definition,script,bible);
  const previous=prior.ownerVisualDefinitions?.find(v=>v.charId===input.anchorId);
  if(previous&&previous.provenance===definition.provenance&&
    previous.evidence===definition.evidence&&
    JSON.stringify(previous.traits)===JSON.stringify(definition.traits))
    return prior;
  const next=clone(prior);
  next.ownerVisualDefinitions=[
    ...(next.ownerVisualDefinitions??[]).filter(v=>v.charId!==input.anchorId),
    definition
  ];
  // A visual definition changes future generated reference prompts only.
  // Already published canonical refs retain their old approval event/SHA
  // until the owner explicitly reviews and publishes replacements.
  return save(root,prior,next,'approve:visual-definition',definition);
}
export function currentOwnerVisualDefinition(root:string,appPath:string,charId:string){
  const prior=readIdentityWorkflow(root);
  const found=prior.ownerVisualDefinitions?.find(v=>v.charId===charId);
  if(!found)return null;
  const {script,analysis}=validApproved(root,prior);
  return validateOwnerVisualDefinition(found,script,
    compileStyleBible(analysis,script,pinned(appPath,root)));
}
/** Promote a real previously imported owner image as an unapproved candidate.
 * Import alone never asserts a four-view presentation or visual correctness. */
export function registerOwnerReference(root:string,appPath:string,input:{
  expectedRevision:number;anchorId:string;relativePath:string;ownerSource:string
},decode:IdentityDecoder){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==input.expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('STYLE_BIBLE_TEXT_APPROVAL_REQUIRED');
  const row=bible.characters.find(c=>c.char_id===input.anchorId);
  // An explicitly owned real reference image may supply visual appearance
  // absent from narration. This NEVER invents textual traits or authorizes
  // automatic generation from an underspecified character.
  if(!row)throw Error('REFERENCE_CHARACTER_NOT_FOUND');
  const media=readState(root);
  const own=media.media?.find(item=>item.path===input.relativePath&&
    item.kind==='image'&&item.rights?.trim()&&
    media.imports?.includes(item.path));
  if(!own||!input.ownerSource?.trim())throw Error('REFERENCE_OWNER_PROVENANCE_REQUIRED');
  const verified=verifyReferenceFile(root,input.relativePath,own.sha256);
  const details=decode(verified.bytes);
  // An owner-imported image never went through the provider prompt. Give
  // its actual owner-import provenance an independent domain-separated SHA.
  const ownerAuthoritySha=contentHash({kind:'owner-reference-bytes-v1',
    projectId:media.project.id,styleBibleSha:bible.style_bible_sha256,
    anchorId:input.anchorId,mediaSha:verified.sha});
  const candidate:ReferenceCandidate={
    schema:'stickman-visual-reference-candidate-v1',project_id:media.project.id,
    candidate_id:randomUUID(),anchor_type:'character',anchor_id:input.anchorId,
    source_definition_hash:row.source_definition_hash,
    style_bible_sha256:bible.style_bible_sha256,
    prompt_sha256:ownerAuthoritySha,provider_job_id:null,model:'owner_imported',
    aspect_ratio:'1:1',media_path:input.relativePath,media_sha256:verified.sha,
    media_mime:verified.mime,width:details.width,height:details.height,
    // Ledger rights must stay byte-exact; owner source attestation is an
    // independently hashed audit event, not fabricated new media rights.
    rights:own.rights,source:'OWNER_IMPORTED',
    status:'VALIDATED',approval_event_id:null,approved_at:null
  };
  // Verify byte signatures and pixel dimensions before journaling the candidate.
  // Owner must still inspect identity and 2x2 views; no generated media claims.
  if(details.width!==details.height)throw Error('REFERENCE_SQUARE_IMAGE_REQUIRED');
  const next=clone(prior);
  next.referenceCandidates.push(candidate);
  if(next.referenceCandidates.length>400)throw Error('IDENTITY_CANDIDATES_LIMIT');
  // Owner import is merely a candidate; the published set remains immutable.
  return save(root,prior,next,
    'candidate:owner-import:source-sha-'+sha(input.ownerSource.trim()),candidate);
}
/** Polling completion is only a candidate. Never turn DONE into owner approval. */
export function registerValidatedGeneratedReference(root:string,appPath:string,
  input:{expectedRevision:number;job:import('./referenceGeneration.js').ReferenceJob},
  decode:IdentityDecoder){
  const prior=readIdentityWorkflow(root),job=input.job;
  if(prior.revision!==input.expectedRevision)
    throw Error('IDENTITY_REVISION_CONFLICT');
  if(job.status!=='VALIDATED'||!job.providerTaskId||!job.staged||
    job.projectId!==readState(root).project.id)
    throw Error('REFERENCE_GENERATION_NOT_VALIDATED');
  const persisted=readReferenceJob(root,job.id);
  if(persisted.status!=='VALIDATED'||persisted.projectId!==job.projectId||
    persisted.anchorId!==job.anchorId||
    persisted.providerTaskId!==job.providerTaskId||
    persisted.styleBibleSha!==job.styleBibleSha||
    persisted.sourceDefinitionHash!==job.sourceDefinitionHash||
    persisted.ownerVisualDefinitionSha!==job.ownerVisualDefinitionSha||
    persisted.staged?.path!==job.staged.path||
    persisted.staged?.sha256!==job.staged.sha256)
    throw Error('REFERENCE_GENERATED_JOB_PROVENANCE_INVALID');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256||
    job.styleBibleSha!==bible.style_bible_sha256||
    job.styleProfileSha!==bible.style_profile_sha256||
    job.analysisSha!==bible.analysis_sha256||
    job.approvedScriptSha!==bible.source_script_sha256)
    throw Error('REFERENCE_GENERATION_SOURCE_STALE');
  const row=bible.characters.find(row=>row.char_id===job.anchorId);
  if(!row||row.source_definition_hash!==job.sourceDefinitionHash)
    throw Error('REFERENCE_GENERATION_ANCHOR_STALE');
  const verified=verifyReferenceFile(root,job.staged.path,job.staged.sha256,'image/png');
  const actual=decode(verified.bytes);
  if(!actual||actual.width!==job.staged.width||
    actual.height!==job.staged.height||actual.width!==actual.height)
    throw Error('REFERENCE_GENERATION_DECODE_STALE');
  const existing=prior.referenceCandidates.find(c=>c.media_path===job.staged?.path);
  if(existing){
    if(existing.media_sha256!==job.staged.sha256||
      existing.source_definition_hash!==row.source_definition_hash)
      throw Error('REFERENCE_GENERATION_JOURNAL_CONFLICT');
    return prior;
  }
  const owner=prior.ownerVisualDefinitions?.find(d=>d.charId===job.anchorId);
  if(owner)validateOwnerVisualDefinition(owner,script,bible);
  if(owner?.definitionSha!==job.ownerVisualDefinitionSha)
    throw Error('REFERENCE_GENERATION_VISUAL_DEFINITION_STALE');
  const prompt=referencePromptForCharacter(bible,job.anchorId,pinned(appPath,root),
    owner);
  if(prompt.prompt_sha256!==job.promptSha)
    throw Error('REFERENCE_GENERATION_PROMPT_STALE');
  const candidate:ReferenceCandidate={
    schema:'stickman-visual-reference-candidate-v1',project_id:job.projectId,
    candidate_id:randomUUID(),anchor_type:'character',anchor_id:job.anchorId,
    source_definition_hash:row.source_definition_hash,
    style_bible_sha256:bible.style_bible_sha256,
    prompt_sha256:job.promptSha,provider_job_id:job.providerTaskId,model:job.model,
    ...(owner?{visual_definition_sha256:owner.definitionSha}:{}),
    aspect_ratio:'1:1',media_path:job.staged.path,media_sha256:job.staged.sha256,
    media_mime:'image/png',width:actual.width,height:actual.height,
    rights:'OWNER_AUTHORIZED_GLABS_GENERATED | job='+job.id+
      ' | provider_license_not_independently_verified',
    source:'GLABS_GENERATED',status:'VALIDATED',
    approval_event_id:null,approved_at:null
  };
  const next=clone(prior);
  next.referenceCandidates.push(candidate);
  if(next.referenceCandidates.length>400)throw Error('IDENTITY_CANDIDATES_LIMIT');
  return save(root,prior,next,'candidate:glabs-validated',candidate);
}
export function approveOwnerReference(root:string,appPath:string,input:{
  expectedRevision:number;candidateId:string;ownerInspected:true
},decode:IdentityDecoder){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==input.expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('STYLE_BIBLE_TEXT_APPROVAL_REQUIRED');
  const candidate=prior.referenceCandidates.find(c=>c.candidate_id===input.candidateId);
  if(!candidate)throw Error('REFERENCE_CANDIDATE_NOT_FOUND');
  if(candidate.status!=='VALIDATED')throw Error('REFERENCE_CANDIDATE_NOT_UNAPPROVED');
  // Verify the exact generated bytes before any ledger write. A generated
  // staged PNG is *not* automatically an approved media/rights declaration.
  const verified=approveCandidate(candidate,bible,root,input.ownerInspected,decode);
  let approved=verified;
  if(verified.source==='GLABS_GENERATED'){
    const owner=prior.ownerVisualDefinitions?.find(d=>d.charId===verified.anchor_id);
    if(owner)validateOwnerVisualDefinition(owner,script,bible);
    if(verified.visual_definition_sha256!==owner?.definitionSha)
      throw Error('REFERENCE_GENERATED_VISUAL_DEFINITION_STALE');
    const match=/^assets\/images\/identity-ref-([a-f0-9-]{36})\.png$/i.exec(verified.media_path);
    if(!match)throw Error('REFERENCE_GENERATED_JOB_PROVENANCE_INVALID');
    const source=readReferenceJob(root,match[1]);
    if(source.status!=='VALIDATED'||source.projectId!==verified.project_id||
      source.anchorId!==verified.anchor_id||
      source.providerTaskId!==verified.provider_job_id||
      source.sourceDefinitionHash!==verified.source_definition_hash||
      source.styleBibleSha!==verified.style_bible_sha256||
      source.promptSha!==verified.prompt_sha256||
      source.ownerVisualDefinitionSha!==verified.visual_definition_sha256||
      source.staged?.path!==verified.media_path||
      source.staged?.sha256!==verified.media_sha256)
      throw Error('REFERENCE_GENERATED_JOB_PROVENANCE_INVALID');
    const imported=importMediaFile(root,resolveProjectFile(root,verified.media_path),
      'image',verified.rights);
    if(imported.sha256!==verified.media_sha256)
      throw Error('REFERENCE_IMPORTED_SOURCE_SHA_CHANGED');
    approved={...verified,media_path:imported.path};
  }
  const next=clone(prior);
  next.referenceCandidates=next.referenceCandidates.map(c=>
    c.candidate_id===approved.candidate_id?approved:c);
  // Reviewing an alternative candidate does NOT republish or revoke canonical authority.
  return save(root,prior,next,'approve:reference',approved);
}
export function publishStyleBibleReferences(root:string,appPath:string,
  expectedRevision:number,selectedIds:string[],decode:IdentityDecoder,
  reviewedImpactSha256?:string){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('STYLE_BIBLE_TEXT_APPROVAL_REQUIRED');
  const selected=selectedIds.map(id=>prior.referenceCandidates.find(c=>
    c.candidate_id===id&&c.status==='APPROVED'));
  if(selected.some(x=>!x))throw Error('REFERENCE_APPROVAL_SET_MISSING_CANDIDATE');
  const impact=previewReferenceSwitchImpact(root,selectedIds);
  const oldActiveSet=publishedSnapshot(prior)?.referenceApprovalSet;
  if(oldActiveSet&&impact.changedCharacterIds.length){
    if(reviewedImpactSha256!==impact.impactSha256)
      throw Error('REFERENCE_CANONICAL_IMPACT_REVIEW_REQUIRED');
    assertNoIdentityBusyJobs(root,impact.affectedTargetKeys);
  }
  // Re-publishing the very same approved source must be idempotent; a synthetic
  // revision bump would incorrectly stale every already-generated image.
  if(oldActiveSet&&!impact.changedCharacterIds.length)
    return prior;
  const oldPublished=publishedSnapshot(prior);
  const approvalSet=publishApprovalSet(root,bible,selected as ReferenceCandidate[],
    (oldPublished?.referenceApprovalSet.revision??0)+1,decode);
  const next=clone(prior);
  archiveReferenceSet(next);
  if(oldPublished&&!next.referenceApprovalHistory?.some(entry=>
    entry.approval_set_sha256===oldPublished.referenceApprovalSet.approval_set_sha256))
    next.referenceApprovalHistory=[...(next.referenceApprovalHistory??[]),
      oldPublished.referenceApprovalSet].slice(-100);
  next.referenceApprovalSet=approvalSet;
  const candidate={analysis:clone(analysis),
    analysisApproved:clone(prior.analysisApproved!),
    independentReview:clone(prior.independentReview!),
    bible:clone(bible),bibleTextApproved:clone(prior.bibleTextApproved!),
    referenceApprovalSet:clone(approvalSet)};
  next.publishedAuthority={...candidate,snapshotSha:contentHash(candidate)};
  return save(root,prior,next,'publish:reference-set',next.publishedAuthority);
}
export function assertIdentityUpstreamCurrent(root:string,appPath:string,
  decode:IdentityDecoder){
  const state=readState(root);
  if(identityPolicy(state)==='legacy')return null;
  const journal=publishedIdentityView(readIdentityWorkflow(root));
  const {script,analysis}=validApproved(root,journal);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(journal.bibleTextApproved?.sha256!==bible.style_bible_sha256||
    !journal.referenceApprovalSet)
    throw Error('IDENTITY_UPSTREAM_NOT_PUBLISHED');
  const selected=journal.referenceApprovalSet.entries.map(entry=>
    journal.referenceCandidates.find(c=>c.candidate_id===entry.candidate_id&&
      c.status==='APPROVED'));
  if(selected.some(c=>!c))throw Error('REFERENCE_APPROVAL_SET_MISSING_CANDIDATE');
  return validatePublishedSet(root,bible,journal.referenceApprovalSet,
    selected as ReferenceCandidate[],decode);
}
