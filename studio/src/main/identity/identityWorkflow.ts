/** F24 explicit upstream workflow. This is NOT the legacy Script/Native Stage.
 * All artifacts remain scoped to the exact approved Script and frozen task. */
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {atomicJson,readState,resolveProjectFile,strictJson,type StudioState} from '../services.js';
import {loadImageStyleProfile} from '../imagePreparation.js';
import {contentHash,type ScriptAnalysis,type StyleBible} from './contracts.js';
import {analysisLineage,freezeAnalysisTask,validateAnalysisEnvelope,
  validateScriptAnalysis,verifyIndependentReview,type ApprovedScriptSnapshot,
  type AnalysisTask,type AnalysisReview,type IdentityReviewOperation} from './scriptAnalysis.js';
import {compileStyleBible,type PinnedStyle} from './styleBible.js';
import {approveCandidate,publishApprovalSet,validateCandidate,validatePublishedSet,
  type ReferenceCandidate,type ReferenceApprovalSet,type IdentityDecoder} from './referencePublication.js';

type TaskState='FROZEN'|'IMPORTED'|'STALE';
interface TaskEntry{task:AnalysisTask;status:TaskState;frozenArtifactSha:string|null;at:string}
interface JournalEvent{
  eventId:string;at:string;action:string;sha256:string;sourceRevision:number
}
export interface IdentityWorkflowStore{
  schema:'stickman-identity-workflow-v1';projectId:string;revision:number;
  currentTask:TaskEntry|null;draftAnalysis:ScriptAnalysis|null;
  draftSha256:string|null;independentReview:AnalysisReview|null;
  analysisApproved:{sha256:string;approvedAt:string;reviewSha256:string}|null;
  bible:StyleBible|null;bibleTextApproved:{sha256:string;approvedAt:string}|null;
  referenceCandidates:ReferenceCandidate[];
  referenceApprovalSet:ReferenceApprovalSet|null;
  events:JournalEvent[];
}
const file=(root:string)=>resolveProjectFile(root,'.studio/identity/workflow-v1.json');
const clone=<T>(value:T):T=>structuredClone(value);
function empty(projectId:string):IdentityWorkflowStore{
  return{schema:'stickman-identity-workflow-v1',projectId,revision:0,
    currentTask:null,draftAnalysis:null,draftSha256:null,
    independentReview:null,analysisApproved:null,bible:null,bibleTextApproved:null,
    referenceCandidates:[],referenceApprovalSet:null,events:[]};
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
    data.events.length>2000||data.referenceCandidates.length>400)
    throw Error('IDENTITY_WORKFLOW_CORRUPT');
  return data;
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
  const record=readIdentityWorkflow(root),policy=identityPolicy(readState(root));
  let readiness='LEGACY';
  if(policy==='v1'){
    try{
      const {script,analysis}=validApproved(root,record);
      readiness='ANALYSIS_APPROVED';
      if(record.bible){
        const current=compileStyleBible(analysis,script,pinned(appPath,root));
        if(record.bible.style_bible_sha256!==current.style_bible_sha256)
          readiness='STYLE_BIBLE_STALE';
        else if(record.bibleTextApproved?.sha256!==current.style_bible_sha256)
          readiness='STYLE_BIBLE_TEXT_REVIEW_REQUIRED';
        else{
          readiness='STYLE_BIBLE_APPROVED';
          if(record.referenceApprovalSet){
            validatePublishedSet(root,current,record.referenceApprovalSet,
              record.referenceCandidates.filter(c=>c.status==='APPROVED'),
              // Readiness does not decode untrusted reference bytes.
              // Publication gets full decoder verification at its actual gate.
              ()=>{throw Error('REFERENCE_SNAPSHOT_READ_ONLY');});
          }
        }
      }
    }catch(error){readiness=error instanceof Error?error.message:'IDENTITY_INTEGRITY_ERROR';}
  }
  return{policy,readiness,journal:record};
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
      'Return a stickman-analysis-review-v1 payload inside the frozen result envelope.',
      'Findings require finding_id, severity P0/P1/P2, location, issue, evidence.',
      'Only approve if no unresolved P0/P1 and the source-grounded identities are correct.',
      'Exact previous analysis '+JSON.stringify(prior.draftAnalysis),
      'Frozen envelope '+JSON.stringify({schema:'mode-b-identity-external-result-v1',
        stage:'script_analysis',project_id:task.project_id,task_id:task.task_id,
        revision:task.revision,input_sha256:task.input_sha256,
        payload:{schema:'stickman-analysis-review-v1',project_id:task.project_id,
          analysis_sha256:prior.draftSha256,independent_review:true,
          findings:[],approved:false}})
    ].join('\n\n');
  }else if(operation==='correct'){
    task.prompt=[
      '# SCOPED SCRIPT ANALYSIS CORRECTION',
      'Only correct the actual P0/P1 findings. Do not revise narration or invent traits.',
      'A second independent Recheck is mandatory. Return exact frozen JSON envelope.',
      'Current analysis '+JSON.stringify(prior.draftAnalysis),
      'Independent findings '+JSON.stringify(prior.independentReview?.findings??[]),
      'Frozen task '+JSON.stringify(task)
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
export function publishStyleBibleReferences(root:string,appPath:string,
  expectedRevision:number,selectedIds:string[],decode:IdentityDecoder){
  const prior=readIdentityWorkflow(root);
  if(prior.revision!==expectedRevision)throw Error('IDENTITY_REVISION_CONFLICT');
  const {script,analysis}=validApproved(root,prior);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(prior.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('STYLE_BIBLE_TEXT_APPROVAL_REQUIRED');
  const selected=selectedIds.map(id=>prior.referenceCandidates.find(c=>
    c.candidate_id===id&&c.status==='APPROVED'));
  if(selected.some(x=>!x))throw Error('REFERENCE_APPROVAL_SET_MISSING_CANDIDATE');
  const approvalSet=publishApprovalSet(root,bible,selected as ReferenceCandidate[],
    (prior.referenceApprovalSet?.revision??0)+1,decode);
  const next=clone(prior);next.referenceApprovalSet=approvalSet;
  return save(root,prior,next,'publish:reference-set',approvalSet);
}
export function assertIdentityUpstreamCurrent(root:string,appPath:string,
  decode:IdentityDecoder){
  const state=readState(root);
  if(identityPolicy(state)==='legacy')return null;
  const journal=readIdentityWorkflow(root);
  const {script,analysis}=validApproved(root,journal);
  const bible=compileStyleBible(analysis,script,pinned(appPath,root));
  if(journal.bibleTextApproved?.sha256!==bible.style_bible_sha256||
    !journal.referenceApprovalSet)
    throw Error('IDENTITY_UPSTREAM_NOT_PUBLISHED');
  return validatePublishedSet(root,bible,journal.referenceApprovalSet,
    journal.referenceCandidates.filter(c=>c.status==='APPROVED'),decode);
}
