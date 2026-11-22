/** F24 Style Bible 1:1 G-Labs jobs. Separate from Shot 9:16 jobs.
 * Owner-triggered only. No background POST/retry. GET-only reconciliation. */
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {CredentialCipher} from '../elevenlabsCredentials.js';
import {glabsProbe,glabsReferenceSettings,glabsReferenceSubmit,
  glabsReferenceStatus,glabsReferenceResult,glabsReferenceDownload} from '../glabs.js';
import {atomicJson,readState,resolveProjectFile,strictJson,sha} from '../services.js';
import {contentHash,type StyleBible} from './contracts.js';
import {compileStyleBible,referencePromptForCharacter,
  type ReferenceOutputFormat} from './styleBible.js';
import {currentApprovedSource,readIdentityWorkflow,publishedIdentityView,identityPolicy} from './identityWorkflow.js';
import {verifyIndependentReview} from './scriptAnalysis.js';
import {validateOwnerVisualDefinition} from './visualDefinitions.js';
import {loadImageStyleProfile} from '../imagePreparation.js';
import type {IdentityDecoder} from './referencePublication.js';

export type ReferenceJobStatus='QUEUED'|'SUBMITTED'|'RUNNING'|'UNKNOWN'|
  'VALIDATED'|'FAILED'|'STALE'|'CANCELLED';
export interface ReferenceJob{
  schema:'stickman-reference-generate-job-v1';
  id:string;projectId:string;anchorId:string;sourceDefinitionHash:string;
  styleBibleSha:string;styleProfileSha:string;analysisSha:string;
  approvedScriptSha:string;prompt:string;promptSha:string;
  /** Request-scoped format. Absent only on historical frozen jobs. */
  referenceFormat?:ReferenceOutputFormat;
  ownerVisualDefinitionSha?:string;
  model:string;aspectRatio:'1:1';status:ReferenceJobStatus;
  providerTaskId?:string;providerCompletedAt?:string;
  staged?:{path:string;sha256:string;width:number;height:number;mime:'image/png'};
  reason?:string;createdAt:string;updatedAt:string;
}
const idPattern=/^[a-f0-9-]{36}$/i;
const dir=(root:string)=>resolveProjectFile(root,'.studio/identity/reference-jobs');
const file=(root:string,id:string)=>{
  if(!idPattern.test(id))throw Error('REFERENCE_JOB_ID_INVALID');
  return resolveProjectFile(root,'.studio/identity/reference-jobs/'+id+'.json');
};
const stamp=()=>new Date().toISOString();
const locks=new Set<string>();
const syncLocks=new Set<string>();
export function readReferenceJob(root:string,id:string):ReferenceJob{
  const value=strictJson(fs.readFileSync(file(root,id),'utf8')) as unknown as ReferenceJob;
  if(value.schema!=='stickman-reference-generate-job-v1'||
    value.id!==id||value.projectId!==readState(root).project.id||
    !idPattern.test(value.id)||!['QUEUED','SUBMITTED','RUNNING','UNKNOWN',
      'VALIDATED','FAILED','STALE','CANCELLED'].includes(value.status))
    throw Error('REFERENCE_JOB_JOURNAL_INVALID');
  return value;
}
function write(root:string,job:ReferenceJob){
  job.updatedAt=stamp();atomicJson(file(root,job.id),job);
}
export function listReferenceJobs(root:string):ReferenceJob[]{
  const folder=dir(root);
  if(!fs.existsSync(folder))return[];
  return fs.readdirSync(folder).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name))
    .map(name=>readReferenceJob(root,name.slice(0,-5)))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function ready(root:string,appPath:string,anchorId:string,
  referenceFormat:ReferenceOutputFormat='four_view'):{
  bible:StyleBible;sourceDefinitionHash:string;prompt:string;promptSha:string;
  styleSha:string;analysisSha:string;scriptSha:string;
  ownerVisualDefinitionSha?:string
}{
  const state=readState(root);
  if(identityPolicy(state)!=='v1')throw Error('REFERENCE_IDENTITY_POLICY_REQUIRED');
  const working=readIdentityWorkflow(root),source=currentApprovedSource(root);
  // Generate a new candidate's master only after its own independent approval
  // and Style Bible text review. During an unapproved Author/Correct, the
  // old published canonical remains usable and cannot be replaced implicitly.
  const candidateReady=Boolean(working.draftAnalysis&&working.analysisApproved&&
    working.bible&&working.bibleTextApproved&&
    working.analysisApproved.sha256===contentHash(working.draftAnalysis)&&
    working.bibleTextApproved.sha256===working.bible.style_bible_sha256);
  const journal=candidateReady?working:publishedIdentityView(working);
  const analysis=journal.draftAnalysis,approved=journal.analysisApproved;
  if(!analysis||!approved||approved.sha256!==contentHash(analysis)||
    !journal.independentReview||
    !verifyIndependentReview(journal.independentReview,analysis)||
    approved.reviewSha256!==contentHash(journal.independentReview)||
    analysis.source_script_sha256!==source.sha256||
    analysis.source_authoring_sha256!==contentHash(source.authoring))
    throw Error('REFERENCE_SCRIPT_ANALYSIS_NOT_CURRENT');
  const style=loadImageStyleProfile(appPath,state.project.style as 'B1'|'B2'|'B3'|'B4');
  const pinned={id:style.id,guidance:style.guidance,sha256:style.sha256};
  const bible=compileStyleBible(analysis,source,pinned);
  if(journal.bibleTextApproved?.sha256!==bible.style_bible_sha256||
    !journal.bible||contentHash(journal.bible)!==contentHash(bible)||
    journal.bible.style_bible_sha256!==bible.style_bible_sha256)
    throw Error('REFERENCE_STYLE_BIBLE_NOT_APPROVED');
  const row=bible.characters.find(char=>char.char_id===anchorId);
  if(!row)throw Error('REFERENCE_CHARACTER_NOT_FOUND');
  const owner=journal.ownerVisualDefinitions?.find(value=>value.charId===anchorId);
  if(owner)validateOwnerVisualDefinition(owner,source,bible);
  if(row.visual_readiness!=='READY_FOR_REFERENCE'&&!owner)
    throw Error('REFERENCE_CHARACTER_NOT_READY');
  const prompt=referencePromptForCharacter(bible,anchorId,pinned,owner,referenceFormat);
  return{bible,sourceDefinitionHash:row.source_definition_hash,
    prompt:prompt.prompt,promptSha:prompt.prompt_sha256,styleSha:style.sha256,
    analysisSha:bible.analysis_sha256,scriptSha:bible.source_script_sha256,
    ...(owner?{ownerVisualDefinitionSha:owner.definitionSha}:{})};
}
function isCurrent(root:string,appPath:string,job:ReferenceJob){
  try{
    const snapshot=ready(root,appPath,job.anchorId,job.referenceFormat??'four_view');
    return job.projectId===readState(root).project.id&&
      job.styleBibleSha===snapshot.bible.style_bible_sha256&&
      job.sourceDefinitionHash===snapshot.sourceDefinitionHash&&
      job.styleProfileSha===snapshot.styleSha&&
      job.analysisSha===snapshot.analysisSha&&
      job.approvedScriptSha===snapshot.scriptSha&&
      job.promptSha===snapshot.promptSha&&
      job.ownerVisualDefinitionSha===snapshot.ownerVisualDefinitionSha&&
      sha(job.prompt)===job.promptSha;
  }catch{return false;}
}
function markStale(root:string,job:ReferenceJob){
  const note='REFERENCE_SOURCE_STALE: old provider billing/history retained; cannot approve as current';
  if(['SUBMITTED','RUNNING','UNKNOWN'].includes(job.status)){
    // A POST may already have charged while this reference source changed.
    // Even a confirmed provider ID must not let an older attempt become
    // a free-to-retry STALE record. Preserve the paid/UNKNOWN barrier.
    const changed=job.status!=='UNKNOWN'||!job.reason?.includes(note);
    job.status='UNKNOWN';
    job.reason=[job.reason?.includes(note)?'':job.reason,note].filter(Boolean).join(' | ');
    if(changed)write(root,job);
    return job;
  }
  if(job.status!=='STALE'){
    job.status='STALE';job.reason=note;write(root,job);
  }
  return job;
}
export async function submitReferenceJob(appPath:string,root:string,userData:string,
  cipher:CredentialCipher,input:{anchorId:string;authorized:true;regenerate?:boolean;
    acknowledgeUnknown?:boolean;referenceFormat?:ReferenceOutputFormat}):Promise<ReferenceJob>{
  if(input?.authorized!==true)throw Error('REFERENCE_PAID_POST_OWNER_AUTH_REQUIRED');
  const referenceFormat=input.referenceFormat??'four_view';
  if(!['four_view','group_overview'].includes(referenceFormat))
    throw Error('REFERENCE_OUTPUT_FORMAT_INVALID');
  if(referenceFormat==='group_overview'&&input.referenceFormat!=='group_overview')
    throw Error('REFERENCE_GROUP_OWNER_SELECTION_REQUIRED');
  const definition=ready(root,appPath,input.anchorId,referenceFormat);
  const older=listReferenceJobs(root).filter(row=>row.anchorId===input.anchorId);
  if(older.some(row=>['QUEUED','SUBMITTED','RUNNING'].includes(row.status)))
    throw Error('REFERENCE_ACTIVE_ATTEMPT_EXISTS');
  if(older.some(row=>row.status==='UNKNOWN')&&!input.acknowledgeUnknown)
    throw Error('REFERENCE_UNKNOWN_MAY_HAVE_CHARGED');
  if(older.length&&!input.regenerate&&!older.every(row=>
    ['FAILED','CANCELLED','STALE'].includes(row.status)))
    throw Error('REFERENCE_REGENERATE_EXPLICIT_AUTH_REQUIRED');
  const config=glabsReferenceSettings(userData);
  const lock=readState(root).project.id+'|'+input.anchorId;
  if(locks.has(lock))throw Error('REFERENCE_SUBMISSION_BUSY');
  locks.add(lock);
  try{
    const probe=await glabsProbe(userData,cipher);
    if(!probe.authVerified)throw Error('REFERENCE_PROVIDER_HEALTH_AUTH_UNVERIFIED');
    const refreshed=glabsReferenceSettings(userData);
    if(refreshed.model!==config.model||refreshed.endpoint!==config.endpoint)
      throw Error('REFERENCE_PROVIDER_SETTINGS_CHANGED');
    if(!isCurrent(root,appPath,{
      schema:'stickman-reference-generate-job-v1',id:randomUUID(),
      projectId:readState(root).project.id,anchorId:input.anchorId,
      sourceDefinitionHash:definition.sourceDefinitionHash,
      styleBibleSha:definition.bible.style_bible_sha256,
      styleProfileSha:definition.styleSha,analysisSha:definition.analysisSha,
      approvedScriptSha:definition.scriptSha,prompt:definition.prompt,
      promptSha:definition.promptSha,referenceFormat,
      ...(definition.ownerVisualDefinitionSha?{
        ownerVisualDefinitionSha:definition.ownerVisualDefinitionSha}:{}),
      model:config.model,aspectRatio:'1:1',
      status:'QUEUED',createdAt:stamp(),updatedAt:stamp()
    }))throw Error('REFERENCE_SOURCE_STALE_BEFORE_POST');
    const live=listReferenceJobs(root).filter(row=>row.anchorId===input.anchorId);
    if(live.some(row=>['QUEUED','SUBMITTED','RUNNING'].includes(row.status)))
      throw Error('REFERENCE_ACTIVE_ATTEMPT_EXISTS');
    if(live.some(row=>row.status==='UNKNOWN')&&!input.acknowledgeUnknown)
      throw Error('REFERENCE_UNKNOWN_MAY_HAVE_CHARGED');
    const created=stamp();
    const job:ReferenceJob={schema:'stickman-reference-generate-job-v1',
      id:randomUUID(),projectId:readState(root).project.id,
      anchorId:input.anchorId,sourceDefinitionHash:definition.sourceDefinitionHash,
      styleBibleSha:definition.bible.style_bible_sha256,styleProfileSha:definition.styleSha,
      analysisSha:definition.analysisSha,approvedScriptSha:definition.scriptSha,
      prompt:definition.prompt,promptSha:definition.promptSha,referenceFormat,
      ...(definition.ownerVisualDefinitionSha?{
        ownerVisualDefinitionSha:definition.ownerVisualDefinitionSha}:{}),
      model:config.model,aspectRatio:'1:1',status:'QUEUED',createdAt:created,updatedAt:created};
    write(root,job);
    if(!isCurrent(root,appPath,job))return markStale(root,job);
    // Durable uncertain marker precedes the ONE paid POST, exactly as Shot G-Labs.
    job.status='SUBMITTED';write(root,job);
    try{
      const response=await glabsReferenceSubmit(userData,cipher,{
        model:job.model,prompt:job.prompt});
      const result=response as Record<string,unknown>;
      if(!result||typeof result.task_id!=='string'||
        !/^[a-f0-9]{8}$/i.test(result.task_id)||
        !['pending','running'].includes(String(result.status)))
        throw Error('REFERENCE_PROVIDER_SUBMISSION_CONTRACT_INVALID');
      job.providerTaskId=result.task_id.toLowerCase();
      if(!isCurrent(root,appPath,job))return markStale(root,job);
      job.status='RUNNING';write(root,job);
    }catch{
      job.status='UNKNOWN';job.reason='REFERENCE_PAID_OUTCOME_UNKNOWN: no automatic replay';
      write(root,job);
    }
    return job;
  }finally{locks.delete(lock);}
}
export async function syncReferenceJob(appPath:string,root:string,userData:string,
  cipher:CredentialCipher,id:string,decode:IdentityDecoder):Promise<ReferenceJob>{
  const lock=readState(root).project.id+'|'+id;
  if(syncLocks.has(lock))throw Error('REFERENCE_SYNC_ALREADY_RUNNING');
  syncLocks.add(lock);
  try{
  const job=readReferenceJob(root,id);
  if(['VALIDATED','FAILED','CANCELLED','STALE'].includes(job.status))return job;
  if(!isCurrent(root,appPath,job))return markStale(root,job);
  if(!job.providerTaskId){
    if(job.status!=='UNKNOWN'){
      job.status='UNKNOWN';job.reason='REFERENCE_PROVIDER_ID_UNKNOWN: no POST retry';
      write(root,job);
    }
    return job;
  }
  const task=job.providerTaskId;
  const response=await glabsReferenceStatus(userData,cipher,task) as Record<string,unknown>;
  if(!response||response.task_id!==task||
    !['pending','running','failed','completed'].includes(String(response.status)))
    throw Error('REFERENCE_PROVIDER_STATUS_INVALID');
  if(!isCurrent(root,appPath,job))return markStale(root,job);
  if(response.status==='failed'&&!job.providerCompletedAt){
    job.status='FAILED';job.reason='REFERENCE_PROVIDER_FAILED';write(root,job);return job;
  }
  if(response.status!=='completed'&&!job.providerCompletedAt){
    job.status='RUNNING';write(root,job);return job;
  }
  job.providerCompletedAt??=stamp();write(root,job);
  const result=await glabsReferenceResult(userData,cipher,task) as Record<string,unknown>;
  if(!isCurrent(root,appPath,job))return markStale(root,job);
  if(!result||result.task_id!==task||result.status!=='completed'||
    !Array.isArray(result.results)||typeof result.results[0]!=='string')
    throw Error('REFERENCE_PROVIDER_RESULT_INVALID');
  const downloaded=await glabsReferenceDownload(userData,cipher,result.results[0]);
  if(!isCurrent(root,appPath,job))return markStale(root,job);
  const decoded=decode(downloaded.data);
  if(!decoded||!Buffer.isBuffer(decoded.png)||decoded.png.length<24||
    decoded.png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
    !Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
    decoded.width!==decoded.height||decoded.width<1||decoded.width>8192||
    decoded.png.length>16*1024*1024)
    throw Error('REFERENCE_GENERATED_IMAGE_INVALID');
  const relative='assets/images/identity-ref-'+job.id+'.png';
  const target=resolveProjectFile(root,relative),bytes=decoded.png;
  fs.mkdirSync(resolveProjectFile(root,'assets/images'),{recursive:true});
  if(fs.existsSync(target)){
    if(sha(fs.readFileSync(target))!==sha(bytes))
      throw Error('REFERENCE_STAGED_BYTES_CONFLICT');
  }else{
    const temporary=target+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,target);}
    finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  if(!isCurrent(root,appPath,job))return markStale(root,job);
  job.staged={path:relative,sha256:sha(bytes),width:decoded.width,
    height:decoded.height,mime:'image/png'};
  job.status='VALIDATED';write(root,job);
  return job;
  }finally{syncLocks.delete(lock);}
}
