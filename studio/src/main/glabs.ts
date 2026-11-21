/** R3 G-Labs legacy adapter. Explicit owner actions only. No background paid retries. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {CredentialCipher} from './elevenlabsCredentials.js';
import {getPendingMedia,importMediaFile,fulfillMedia,nativeImageTargetIdentity,readNativeDraft} from './externalTasks.js';
import {prepareNativeImageTarget,loadImageStyleProfile} from './imagePreparation.js';
import {atomicJson,nativeSkillRoot,readState,resolveProjectFile,sha,strictJson} from './services.js';

export const GLABS_MODELS=['nano_banana_2','nano_banana_pro'] as const;
export const GLABS_RATIOS=['1:1','3:4','4:3','9:16','16:9'] as const;
type JobStatus='QUEUED'|'SUBMITTED'|'RUNNING'|'DOWNLOADED'|'VALIDATED'|'APPROVED'|'FAILED'|'UNKNOWN'|'CANCELLED'|'STALE';
export interface GLabsSettings{endpoint:string;contract:'legacy';model:string;aspectRatio:string}
export interface GLabsJob {
  schema:'r3-glabs-job-v1';id:string;projectId:string;nativeRevision:number;token:string;targetKey:string;shotId:string;layerId:string;targetPath:string;candidateSha256:string;
  authorTaskId?:string;draftRevisionAtSubmission?:number;targetCreativeSha256?:string;
  styleProfileId?:'B1'|'B2'|'B3'|'B4';styleProfileSha256?:string;
  prompt:string;promptSha256:string;references:Array<{path:string;sha256:string;mime:string;name:string;rightsSha256:string}>;model:string;aspectRatio:string;status:JobStatus;
  providerTaskId?:string;staged?:{path:string;sha256:string;mime:string;width:number;height:number};
  journalRevision?:number;
  syncPhase?:'provider'|'result'|'download'|'decode'|'stage'|'validated';
  providerCompletedAt?:string;
  lastSyncError?:{stage:string;code:string;at:string};
  /** Sanitized provider MIME evidence; actual MIME always comes from magic bytes. */
  sourceMime?:'image/png'|'image/jpeg'|'image/webp';
  mimeDiagnostic?:{declared:string;detected:string;classification:'missing'|'generic'|'alias'|'mismatch'};
  reason?:string;approved?:{rights:string;path:string;sha256:string;provenance?:{
    source:'G-Labs generated output';projectId:string;jobId:string;providerTaskId:string|null;
    model:string;promptSha256:string;imageSha256:string;nativeToken:string;
    targetKey:string;shotId:string;layerId:string;targetPath:string;
    styleSha256:string;approvedAt:string;ownerAuthorizedProjectUse:true;
    providerLicenseVerified:false;
  }};createdAt:string;updatedAt:string;
}
const MAX_RESPONSE=262_144,MAX_REQUEST=5_242_880,MAX_IMAGE=16*1024*1024;
// Keep the owner's requested aspect ratio in the G-Labs provider request.
// The provider's returned image dimensions are not an approval constraint:
// decoded PNG integrity, SHA, rights, frozen Native identity and image inspection
// remain mandatory.
const active=new Set<string>();
const defaultSettings:GLabsSettings={endpoint:'http://127.0.0.1:8765',contract:'legacy',model:'nano_banana_2',aspectRatio:'9:16'};
const settingsFile=(userData:string)=>path.join(userData,'glabs-config-r3.json');
const secretFile=(userData:string)=>path.join(userData,'glabs-key-r3.bin');
const jobsDir=(root:string)=>resolveProjectFile(root,'.studio/glabs/jobs');
const jobFile=(root:string,id:string)=>{
  if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid G-Labs job ID.');
  return resolveProjectFile(root,'.studio/glabs/jobs/'+id+'.json');
};
const timestamp=()=>new Date().toISOString();
/** Persist only an application-owned error code, never arbitrary exception text. */
function syncErrorCode(error:unknown,fallback:string):string{
  const code=error instanceof Error?
    /^(GLABS_[A-Z0-9_]+)(?::|$)/.exec(error.message)?.[1]:undefined;
  return code??fallback;
}
const pureObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function glabsEndpoint(raw:string){
  let u:URL;
  try{u=new URL(raw);}catch{throw new Error('G-Labs endpoint must be a loopback HTTP URL.');}
  if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)
    throw new Error('G-Labs requires a loopback HTTP origin without credentials, path or query.');
  return u.origin;
}
export function glabsSettings(userData:string):GLabsSettings{
  const file=settingsFile(userData);
  if(!fs.existsSync(file))return {...defaultSettings};
  const raw=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
  if(raw.contract!=='legacy')throw new Error('GLABS_CONTRACT_UNVERIFIED');
  const model=String(raw.model??''),aspectRatio=String(raw.aspectRatio??'');
  if(!(GLABS_MODELS as readonly string[]).includes(model)||!(GLABS_RATIOS as readonly string[]).includes(aspectRatio))
    throw new Error('GLABS_CONFIG_UNVERIFIED_MODEL_OR_RATIO');
  return{endpoint:glabsEndpoint(String(raw.endpoint??'')),contract:'legacy',model,aspectRatio};
}
export function saveGlabsSettings(userData:string,settings:GLabsSettings){
  if(settings.contract!=='legacy')throw new Error('GLABS_CONTRACT_UNVERIFIED: only the inspected legacy adapter is supported.');
  const endpoint=glabsEndpoint(settings.endpoint);
  if(!(GLABS_MODELS as readonly string[]).includes(settings.model)||!(GLABS_RATIOS as readonly string[]).includes(settings.aspectRatio))
    throw new Error('Unverified G-Labs model or aspect ratio.');
  const sanitized={endpoint,contract:'legacy' as const,model:settings.model,aspectRatio:settings.aspectRatio};
  atomicJson(settingsFile(userData),sanitized);
  return sanitized;
}
export function glabsCredentialStatus(userData:string,cipher:CredentialCipher){
  const file=secretFile(userData);
  return{configured:fs.existsSync(file),secureStorageAvailable:cipher.isEncryptionAvailable()};
}
export function saveGlabsKey(userData:string,cipher:CredentialCipher,key:string){
  if(!cipher.isEncryptionAvailable())throw new Error('OS secure storage is unavailable.');
  if(typeof key!=='string'||!key.trim()||key.length>8192)throw new Error('Invalid G-Labs credential.');
  const target=secretFile(userData),temporary=target+'.'+randomUUID()+'.tmp';
  fs.mkdirSync(path.dirname(target),{recursive:true});
  try{fs.writeFileSync(temporary,cipher.encryptString(key.trim()),{flag:'wx',mode:0o600});fs.renameSync(temporary,target);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return glabsCredentialStatus(userData,cipher);
}
export function clearGlabsKey(userData:string,cipher:CredentialCipher){
  const file=secretFile(userData);
  if(fs.existsSync(file))fs.unlinkSync(file);
  return glabsCredentialStatus(userData,cipher);
}
function keyFor(userData:string,cipher:CredentialCipher){
  const file=secretFile(userData);
  if(!cipher.isEncryptionAvailable()||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())
    throw new Error('G-Labs credential missing or secure storage unavailable.');
  return cipher.decryptString(fs.readFileSync(file));
}
async function requestJson(settings:GLabsSettings,userData:string,cipher:CredentialCipher,method:'GET'|'POST',route:string,payload?:Record<string,unknown>,auth=true){
  const endpoint=glabsEndpoint(settings.endpoint);
  const url=new URL(route,endpoint+'/');
  if(url.origin!==endpoint||!url.pathname.startsWith('/api/'))throw new Error('G-Labs route rejected.');
  const headers:Record<string,string>={};
  if(auth)headers['X-API-Key']=keyFor(userData,cipher);
  if(payload)headers['Content-Type']='application/json';
  const body=payload?JSON.stringify(payload):undefined;
  if(body&&Buffer.byteLength(body,'utf8')>MAX_REQUEST)throw new Error('GLABS_REQUEST_OVERSIZE');
  let res:Response;
  try{res=await fetch(url,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{throw new Error('GLABS_TRANSPORT_UNKNOWN: request failed or timed out.');}
  if(!res.ok)throw new Error('GLABS_HTTP_'+res.status);
  if(method==='POST'&&res.status!==202)throw new Error('GLABS_SUBMISSION_STATUS_UNVERIFIED');
  if(Number(res.headers.get('content-length')??0)>MAX_RESPONSE)throw new Error('GLABS_RESPONSE_OVERSIZE');
  if(!res.body)throw new Error('GLABS_RESPONSE_EMPTY');
  const reader=res.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;
      if(total>MAX_RESPONSE){await reader.cancel();throw new Error('GLABS_RESPONSE_OVERSIZE');}
      chunks.push(chunk.value);
    }
  }finally{reader.releaseLock();}
  const value=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).toString('utf8');
  if(!value)throw new Error('GLABS_RESPONSE_EMPTY');
  try{return JSON.parse(value) as unknown;}catch{throw new Error('GLABS_RESPONSE_INVALID_JSON');}
}
export async function glabsProbe(userData:string,cipher:CredentialCipher){
  const settings=glabsSettings(userData);
  // Legacy webhook has no documented read-only model capability endpoint.
  // Health/Auth prove reachability and credential acceptance only, never generation readiness.
  const base={ready:false,reachable:false,authVerified:false,modelCapability:'MODEL_CAPABILITY_UNVERIFIED' as const,
    configuredModel:settings.model,configuredRatio:settings.aspectRatio,contract:settings.contract,
    version:'not advertised',endpoint:settings.endpoint};
  let health:unknown;
  try{health=await requestJson(settings,userData,cipher,'GET','api/health',undefined,false);}
  catch{return {...base,status:'UNREACHABLE' as const,diagnostic:'GLABS_HEALTH_CHECK_FAILED'};}
  if(!pureObject(health))return {...base,status:'UNREACHABLE' as const,diagnostic:'GLABS_HEALTH_CONTRACT_INVALID'};
  const reachable={...base,reachable:true,version:String(health.version??'not advertised')};
  let auth:unknown;
  try{auth=await requestJson(settings,userData,cipher,'GET','api/tasks');}
  catch{return {...reachable,status:'REACHABLE' as const,diagnostic:'GLABS_AUTH_CHECK_FAILED'};}
  if(!pureObject(auth)&&!Array.isArray(auth))
    return {...reachable,status:'REACHABLE' as const,diagnostic:'GLABS_AUTH_CONTRACT_INVALID'};
  return {...reachable,authVerified:true,status:'AUTH_VERIFIED' as const,
    diagnostic:'MODEL_CAPABILITY_UNVERIFIED: no documented free capability proof'};
}
function imageMime(buffer:Buffer):string{
  if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';
  if(buffer.length>=10&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return'image/jpeg';
  if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return'image/webp';
  throw new Error('GLABS_MEDIA_SIGNATURE_INVALID');
}
function validatedImage(root:string,relative:string,recordedSha?:string){
  const file=resolveProjectFile(root,relative);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size>MAX_IMAGE)throw new Error('G-Labs reference is not a bounded local file.');
  const bytes=fs.readFileSync(file),mime=imageMime(bytes);
  if(recordedSha&&sha(bytes)!==recordedSha)throw new Error('G-Labs referenced image SHA changed.');
  return{bytes,mime,sha256:sha(bytes)};
}
/** B4 approved Skill references may be transmitted as image-only style anchors.
 * Their SHA and approved manifest are checked again at submission and approval. */
function verifiedB4Reference(appPath:string,root:string,identifier:string){
  const parsed=/^@modeb\/b4\/([A-Za-z0-9_-]+)$/.exec(identifier);
  if(!parsed||readState(root).project.style!=='B4')throw new Error('GLABS_B4_REFERENCE_NOT_ELIGIBLE');
  const dir=path.join(nativeSkillRoot(appPath).root,'assets','b4');
  const raw=fs.readFileSync(path.join(dir,'approved-style.json'),'utf8');
  const manifest=strictJson(raw) as Record<string,unknown>;
  const pinnedPrompt=manifest.prompt as Record<string,unknown>|undefined;
  // Match the published LF-pinned source even when Windows converts text EOL.
  const canonicalLock=fs.readFileSync(path.join(dir,'style-lock.txt'),'utf8').replace(/\r\n/g,'\n');
  if(manifest.style!=='B4'||pinnedPrompt?.sha256!==sha(canonicalLock))
    throw new Error('GLABS_B4_STYLE_LOCK_INVALID');
  if(!Array.isArray(manifest.references))throw new Error('GLABS_B4_REFERENCE_MANIFEST_INVALID');
  const record=manifest.references.find(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).id===parsed[1]) as Record<string,unknown>|undefined;
  if(!record||typeof record.path!=='string'||!/^[A-Za-z0-9_-]+\.png$/.test(record.path)||
    typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256))
    throw new Error('GLABS_B4_REFERENCE_NOT_PINNED');
  const bytes=fs.readFileSync(path.join(dir,record.path));
  if(bytes.length>MAX_IMAGE||sha(bytes)!==record.sha256||imageMime(bytes)!=='image/png')
    throw new Error('GLABS_B4_REFERENCE_SHA_OR_MIME_MISMATCH');
  return{bytes,mime:'image/png',sha256:record.sha256,rightsSha256:sha(raw+'|style-only|'+identifier)};
}
function writeJob(root:string,job:GLabsJob){
  const file=jobFile(root,job.id);
  if(fs.existsSync(file)){
    const previous=strictJson(fs.readFileSync(file,'utf8')) as GLabsJob;
    // Do not allow an out-of-order provider GET to overwrite an already
    // VALIDATED / APPROVED image with a delayed RUNNING state.
    if(['VALIDATED','APPROVED'].includes(previous.status)&&
      ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status)){
      Object.assign(job,previous);
      return;
    }
    job.journalRevision=Math.max(previous.journalRevision??0,job.journalRevision??0)+1;
  }else job.journalRevision=Math.max(0,job.journalRevision??0)+1;
  job.updatedAt=timestamp();
  atomicJson(file,job);
}
export function readGlabsJob(root:string,id:string):GLabsJob{
  return readJob(root,id);
}
function readJob(root:string,id:string,expectedProjectId=readState(root).project.id):GLabsJob{
  const raw=strictJson(fs.readFileSync(jobFile(root,id),'utf8')) as unknown as GLabsJob;
  if(raw.schema!=='r3-glabs-job-v1'||raw.projectId!==expectedProjectId||raw.id!==id)throw new Error('GLABS_JOB_IDENTITY_INVALID');
  return raw;
}
export function listGlabsJobs(root:string):GLabsJob[]{
  const dir=jobsDir(root);
  if(!fs.existsSync(dir))return[];
  // One validated project-state read per journal scan, not one per historical
  // job file. Paid preflight used to repeat this I/O hundreds of times.
  const projectId=readState(root).project.id;
  return fs.readdirSync(dir).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name))
    .map(name=>readJob(root,name.slice(0,-5),projectId))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function pendingTarget(appPath:string,root:string,targetKey:string){
  const pending=getPendingMedia(appPath,root);
  if(!pending||pending.status==='STALE')throw new Error('GLABS_NATIVE_PENDING_REQUIRED');
  const match=pending.missing.find(item=>item.key===targetKey&&item.kind==='image'&&item.shotId&&item.layerId);
  if(!match)throw new Error('GLABS_TARGET_NOT_FROZEN_OR_ALREADY_FULFILLED');
  return{pending,match:match as typeof match & {shotId:string;layerId:string}};
}
function assertJobTarget(appPath:string,root:string,job:GLabsJob){
  const state=readState(root),current=pendingTarget(appPath,root,job.targetKey);
  if(state.project.id!==job.projectId||state.tasks?.native?.revision!==job.nativeRevision||
    current.pending.token!==job.token||current.match.shotId!==job.shotId||
    current.match.layerId!==job.layerId||current.match.path!==job.targetPath)
    throw new Error('GLABS_JOB_STALE_TARGET: review the current Native candidate.');
  if(!job.authorTaskId||!job.targetCreativeSha256||!/^[a-f0-9]{64}$/.test(job.targetCreativeSha256))
    throw new Error('GLABS_JOB_CREATIVE_EVIDENCE_MISSING: legacy job cannot be verified; create an authorized new attempt.');
  const identity=nativeImageTargetIdentity(root,job.targetKey);
  if(identity.authorTaskId!==job.authorTaskId||identity.fingerprint!==job.targetCreativeSha256||
    identity.shotId!==job.shotId||identity.layerId!==job.layerId||identity.path!==job.targetPath)
    throw new Error('GLABS_JOB_STALE_CREATIVE_TARGET: Native image instructions changed.');
  if(!job.styleProfileSha256||!job.styleProfileId)
    throw new Error('GLABS_JOB_STYLE_AUTHORITY_MISSING: old job cannot be newly approved without pinned style evidence.');
  if(state.project.style!==job.styleProfileId||
    loadImageStyleProfile(appPath,state.project.style as 'B1'|'B2'|'B3'|'B4').sha256!==job.styleProfileSha256)
    throw new Error('GLABS_JOB_STALE_STYLE_AUTHORITY: approved style source changed after image generation.');
  return current;
}
/** Persist stale attempts so output history is retained, never silently re-bound. */
function currentJobTarget(appPath:string,root:string,job:GLabsJob):boolean{
  try{assertJobTarget(appPath,root,job);return true;}
  catch(error){
    const reason=error instanceof Error?error.message:'GLABS_JOB_STALE_CREATIVE_TARGET';
    if(job.status==='UNKNOWN'){
      // Preserve the potentially charged outcome even when creative/style
      // evidence becomes stale. Otherwise a new attempt could bypass the
      // mandatory UNKNOWN-billing acknowledgement.
      const diagnostic='GLABS_UNKNOWN_MAY_HAVE_CHARGED; '+reason;
      // Append a new stale-identity diagnostic without replacing the original
      // uncertain-submit/provider evidence or rewriting it on every refresh.
      if(!job.reason?.includes(diagnostic)){
        job.reason=[job.reason,diagnostic].filter(Boolean).join(' | ');
        writeJob(root,job);
      }
    }else if(job.status!=='APPROVED'){
      job.status='STALE';job.reason=reason;
      writeJob(root,job);
    }
    return false;
  }
}
export function invalidateGlabsJobsAfterNativeCorrection(appPath:string,root:string){
  for(const job of listGlabsJobs(root)){
    if(['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','VALIDATED','UNKNOWN'].includes(job.status)){
      currentJobTarget(appPath,root,job);
    }else if(job.status==='APPROVED'){
      // Approved is historical evidence, not permission to bind an old image to
      // a revised target. Keep approval and licensed media, flag supersession.
      let current=false;
      try{
        const identity=nativeImageTargetIdentity(root,job.targetKey);
        current=identity.fingerprint===job.targetCreativeSha256&&
          identity.authorTaskId===job.authorTaskId&&
          job.styleProfileId===readState(root).project.style&&Boolean(job.styleProfileSha256)&&
          loadImageStyleProfile(appPath,job.styleProfileId as 'B1'|'B2'|'B3'|'B4').sha256===job.styleProfileSha256;
      }catch{/* A retired target has no current binding. */}
      if(!current){
        job.reason='GLABS_APPROVED_OUTPUT_SUPERSEDED: historical approved media retained; current Native draft requires a new target review.';
        writeJob(root,job);
      }
    }
  }
}
/**
 * Only legacy jobs previously rejected *solely* for output ratio are eligible
 * for local recovery. Their PNG was already decoded and staged before the old
 * aspect-ratio check. Verify that the exact staged bytes, SHA and recorded
 * dimensions still match and that the original Native/style authority is
 * current. Do not contact G-Labs or treat unrelated FAILED jobs as successes.
 */
function recoverLegacyRatioFailures(appPath:string,root:string){
  for(const job of listGlabsJobs(root)){
    if(job.status!=='FAILED'||job.reason!=='GLABS_IMAGE_ASPECT_RATIO_MISMATCH'||!job.staged)
      continue;
    try{
      assertJobTarget(appPath,root,job);
      if(job.staged.path!=='assets/images/glabs-'+job.id+'.png'||
        job.staged.mime!=='image/png')continue;
      const image=validatedImage(root,job.staged.path,job.staged.sha256);
      const png=image.bytes;
      if(image.mime!=='image/png'||png.length<33||png.toString('ascii',12,16)!=='IHDR'||
        png.readUInt32BE(8)!==13||
        png.readUInt32BE(16)!==job.staged.width||
        png.readUInt32BE(20)!==job.staged.height||
        job.staged.width<1||job.staged.height<1||
        job.staged.width>8192||job.staged.height>8192)continue;
      job.status='VALIDATED';
      job.reason='Recovered from GLABS_IMAGE_ASPECT_RATIO_MISMATCH: staged PNG SHA and recorded dimensions verified. Owner must still inspect and approve this image.';
      writeJob(root,job);
    }catch{/* Preserve FAILED evidence if source authority, file or SHA cannot be verified. */}
  }
}
/** Reconcile existing current targets and locally recover former ratio-only failures.
 * No provider POST, retry or implicit media approval occurs here. */
export function reconcileGlabsJobs(appPath:string,root:string):GLabsJob[]{
  // Published projects have no active DRAFT; preserve their historical approvals.
  if(!readNativeDraft(root))return listGlabsJobs(root);
  recoverLegacyRatioFailures(appPath,root);
  invalidateGlabsJobsAfterNativeCorrection(appPath,root);
  return listGlabsJobs(root);
}
export type GLabsDecoder=(bytes:Buffer)=>{png:Buffer;width:number;height:number};
export interface ImageRequest{
  targetKey:string;prompt:string;model:string;aspectRatio:string;
  references:string[];authorized:boolean;acknowledgeUnknown?:boolean;regenerate?:boolean;preparedFingerprint?:string;
}
function assertPreparedImageRequest(appPath:string,root:string,input:ImageRequest){
  // Existing explicit manual owner-authored workflow remains supported.
  // Automatic Storyboard submissions carry a frozen creative fingerprint
  // and cannot bypass source readiness or reuse a stale saved prompt.
  if(input.preparedFingerprint===undefined)return null;
  if(typeof input.preparedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.preparedFingerprint))
    throw new Error('GLABS_PREPARED_FINGERPRINT_INVALID');
  const candidate=prepareNativeImageTarget(appPath,root,input.targetKey);
  const ready=candidate?.draftIdentity.creativeFingerprint===input.preparedFingerprint?candidate:null;
  if(!ready||ready.state!=='READY'||ready.prompt.trim()!==input.prompt.trim()||
    JSON.stringify(ready.references)!==JSON.stringify(input.references))
    throw new Error('GLABS_PREPARED_TARGET_NOT_READY_OR_STALE');
  return ready;
}
export async function submitGlabsImage(appPath:string,root:string,userData:string,cipher:CredentialCipher,input:ImageRequest,decode:GLabsDecoder){
  const preflightStarted=performance.now();
  if(input.authorized!==true)throw new Error('GLABS_PAID_SUBMISSION_REQUIRES_EXPLICIT_OWNER_AUTHORIZATION');
  if(typeof input.prompt!=='string'||input.prompt.trim().length<12||input.prompt.length>18000)
    throw new Error('GLABS_PROMPT_REQUIRED: owner must confirm an actual image requirement.');
  const prepared=assertPreparedImageRequest(appPath,root,input);
  // Owner prompt is an editable description; for prepared Native image jobs
  // the authoritative selected B1–B4 guidance is independently composed.
  const providerPrompt=prepared?.effectivePrompt??input.prompt.trim();
  if(providerPrompt.length>18000)
    throw new Error('GLABS_EFFECTIVE_PROMPT_OVERSIZE');
  const config=glabsSettings(userData);
  if(input.model!==config.model||input.aspectRatio!==config.aspectRatio)
    throw new Error('GLABS_MODEL_CONFIG_MISMATCH: save exact chosen model/ratio in Settings.');
  const {pending,match}=pendingTarget(appPath,root,input.targetKey);
  const state=readState(root),creative=nativeImageTargetIdentity(root,input.targetKey),
    styleProfile=loadImageStyleProfile(appPath,state.project.style as 'B1'|'B2'|'B3'|'B4'),
    old=listGlabsJobs(root).filter(j=>j.token===pending.token&&j.targetKey===input.targetKey);
  const shots=(pending.after as Record<string,unknown>).shots;
  if(!['B1','B2','B3','B4'].includes(state.project.style)||state.brief.ratio!=='9:16'||
    !Array.isArray(shots)||shots.some(item=>!pureObject(item)||typeof item.end!=='number'||item.end>=300))
    throw new Error('GLABS_R3_SCOPE_INVALID: only verified B1–B4 portrait Native candidates below 300 seconds.');
  if(state.project.style==='B4'){
    const locked=loadImageStyleProfile(appPath,'B4').guidance;
    if(!providerPrompt.includes(locked))throw new Error('GLABS_B4_STYLE_LOCK_REQUIRED');
    if(!input.references.some(ref=>typeof ref==='string'&&ref.startsWith('@modeb/b4/')))
      throw new Error('GLABS_B4_APPROVED_REFERENCE_REQUIRED');
  }
  if(old.some(j=>['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(j.status)))
    throw new Error('GLABS_EXISTING_ACTIVE_ATTEMPT');
  if(old.some(j=>j.status==='UNKNOWN')&&!input.acknowledgeUnknown)
    throw new Error('GLABS_UNKNOWN_MAY_HAVE_CHARGED: explicit owner acknowledgement is required.');
  if(old.length&&!input.regenerate&&!old.every(j=>j.status==='FAILED'||j.status==='STALE'||j.status==='CANCELLED'))
    throw new Error('GLABS_NEW_ATTEMPT_REQUIRES_EXPLICIT_REGENERATE');
  if(!Array.isArray(input.references)||input.references.length>8||new Set(input.references).size!==input.references.length)
    throw new Error('GLABS_REFERENCES_INVALID');
  const referenceFiles=input.references.map((relative,index)=>{
    if(typeof relative==='string'&&relative.startsWith('@modeb/b4/')){
      const pinned=verifiedB4Reference(appPath,root,relative);
      return{path:relative,sha256:pinned.sha256,mime:pinned.mime,name:'ref_'+String(index+1).padStart(3,'0')+'.png',rightsSha256:pinned.rightsSha256};
    }
    if(typeof relative!=='string'||!/^assets\/images\/[^/]+\.(png|jpe?g)$/i.test(relative))
      throw new Error('GLABS_REFERENCE_PATH_INVALID');
    const entry=(state.media??[]).find(m=>m.path===relative&&m.kind==='image'&&Boolean(m.rights?.trim()));
    if(!entry)throw new Error('GLABS_REFERENCE_UNAPPROVED');
    const checked=validatedImage(root,relative,entry.sha256);
    const verified=decode(checked.bytes);
    if(!verified||!Buffer.isBuffer(verified.png)||verified.width<1||verified.height<1||
      verified.width>8192||verified.height>8192||imageMime(verified.png)!=='image/png')
      throw new Error('GLABS_REFERENCE_IMAGE_UNDECODABLE');
    const ext=checked.mime==='image/jpeg'?'jpg':checked.mime==='image/png'?'png':'webp';
    return{path:relative,sha256:checked.sha256,mime:checked.mime,name:'ref_'+String(index+1).padStart(3,'0')+'.'+ext,rightsSha256:sha(entry.rights)};
  });
  // Only read-only probes before an explicitly authorized paid POST.
  const synchronousPreflightMs=Math.round(performance.now()-preflightStarted);
  if(synchronousPreflightMs>=80)console.warn('[glabs-perf] sync_preflight_ms='+synchronousPreflightMs);
  const probe=await glabsProbe(userData,cipher);
  if(!probe.authVerified)throw new Error('GLABS_HEALTH_AUTH_UNVERIFIED: paid submission blocked before POST.');
  const afterProbeStarted=performance.now();
  const job:GLabsJob={schema:'r3-glabs-job-v1',id:randomUUID(),projectId:state.project.id,
    nativeRevision:state.tasks?.native?.revision??0,token:pending.token,targetKey:match.key,shotId:match.shotId,layerId:match.layerId,
    targetPath:match.path,candidateSha256:sha(JSON.stringify(pending.after)),
    authorTaskId:creative.authorTaskId,draftRevisionAtSubmission:creative.draftRevision,targetCreativeSha256:creative.fingerprint,
    styleProfileId:styleProfile.id,styleProfileSha256:styleProfile.sha256,
    prompt:providerPrompt,promptSha256:sha(providerPrompt),
    references:referenceFiles,model:input.model,aspectRatio:input.aspectRatio,status:'QUEUED',createdAt:timestamp(),updatedAt:timestamp()};
  const lock=job.projectId+':'+job.token+':'+job.targetKey;
  if(active.has(lock))throw new Error('GLABS_TARGET_ALREADY_RUNNING');
  active.add(lock);
  try{
    // The initial read occurred before the asynchronous health/auth probe.
    // Re-check inside the local job lock so concurrent callers cannot send two paid POSTs.
    assertJobTarget(appPath,root,job);
    assertPreparedImageRequest(appPath,root,input);
    const latest=listGlabsJobs(root).filter(j=>j.token===job.token&&j.targetKey===job.targetKey);
    if(latest.some(j=>['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(j.status)))
      throw new Error('GLABS_EXISTING_ACTIVE_ATTEMPT');
    if(latest.some(j=>j.status==='UNKNOWN')&&!input.acknowledgeUnknown)
      throw new Error('GLABS_UNKNOWN_MAY_HAVE_CHARGED');
    if(latest.length&&!input.regenerate&&!latest.every(j=>['FAILED','CANCELLED','STALE'].includes(j.status)))
      throw new Error('GLABS_NEW_ATTEMPT_REQUIRES_EXPLICIT_REGENERATE');
    const refreshedSettings=glabsSettings(userData);
    if(refreshedSettings.endpoint!==config.endpoint||refreshedSettings.model!==job.model||
      refreshedSettings.aspectRatio!==job.aspectRatio)
      throw new Error('GLABS_CONFIG_CHANGED_DURING_PREFLIGHT');
    writeJob(root,job);
    // All deterministic input validation must finish before the paid/uncertain marker.
    let providerPayload:Record<string,unknown>;
    try{
      // Creative draft or source rights may have changed during the async probe.
      assertJobTarget(appPath,root,job);
      assertPreparedImageRequest(appPath,root,input);
      assertJobReferences(appPath,root,job,decode);
      const refs=job.references.map(ref=>{
        const checked=ref.path.startsWith('@modeb/b4/')?verifiedB4Reference(appPath,root,ref.path):validatedImage(root,ref.path,ref.sha256);
        return{data:'data:'+ref.mime+';base64,'+checked.bytes.toString('base64'),name:ref.name};
      });
      providerPayload={prompt:job.prompt,model:job.model,aspect_ratio:job.aspectRatio,reference_images:refs,upscale:[]};
      if(Buffer.byteLength(JSON.stringify(providerPayload),'utf8')>MAX_REQUEST)
        throw new Error('GLABS_REQUEST_OVERSIZE');
    }catch{
      job.status='FAILED';job.reason='Request/reference validation failed BEFORE provider submission. No paid POST was made.';
      writeJob(root,job);return job;
    }
    if(!currentJobTarget(appPath,root,job))return job;
    const secondPreflightMs=Math.round(performance.now()-afterProbeStarted);
    if(secondPreflightMs>=80)console.warn('[glabs-perf] post_probe_sync_validation_ms='+secondPreflightMs);
    job.status='SUBMITTED';writeJob(root,job); // durable uncertain marker BEFORE paid HTTP
    try{
      const result=await requestJson(config,userData,cipher,'POST','api/image/generate',providerPayload);
      if(!pureObject(result)||typeof result.task_id!=='string'||!/^[0-9a-f]{8}$/i.test(result.task_id)||
         !['pending','running'].includes(String(result.status)))
        throw new Error('GLABS_SUBMISSION_CONTRACT_UNVERIFIED');
      job.providerTaskId=result.task_id.toLowerCase();
      // A correction may complete while the paid POST is awaiting its response.
      // Preserve the real provider ID but never resurrect a now-stale attempt.
      if(!currentJobTarget(appPath,root,job))return job;
      job.status='RUNNING';writeJob(root,job);
    }catch{
      if(!currentJobTarget(appPath,root,job)){
        job.reason+=' Paid submission outcome may be chargeable; no automatic replay.';
        writeJob(root,job);return job;
      }
      job.status='UNKNOWN';job.reason='Paid submission outcome unconfirmed. No automatic replay; reconcile or explicitly authorize another attempt.';
      writeJob(root,job);
    }
    return job;
  }finally{active.delete(lock);}
}
async function downloadImage(settings:GLabsSettings,urlText:string,userData:string,cipher:CredentialCipher){
  const origin=glabsEndpoint(settings.endpoint),url=new URL(urlText);
  if(url.origin!==origin||!/^\/api\/files\/[a-zA-Z0-9._-]+$/.test(url.pathname)||
    url.pathname.includes('..')||url.username||url.password||url.hash||url.search)
    throw new Error('GLABS_RESULT_URL_UNSAFE');
  let res:Response;
  try{res=await fetch(url,{headers:{'X-API-Key':keyFor(userData,cipher)},redirect:'error',signal:AbortSignal.timeout(60000)});}
  catch{throw new Error('GLABS_DOWNLOAD_UNKNOWN');}
  if(!res.ok)throw new Error('GLABS_DOWNLOAD_HTTP_'+res.status);
  const length=Number(res.headers.get('content-length')??0);
  if(length>MAX_IMAGE)throw new Error('GLABS_DOWNLOAD_OVERSIZE');
  if(!res.body)throw new Error('GLABS_DOWNLOAD_EMPTY');
  const reader=res.body.getReader(),parts:Uint8Array[]=[];let total=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;total+=next.value.length;
      if(total>MAX_IMAGE)throw new Error('GLABS_DOWNLOAD_OVERSIZE');parts.push(next.value);}
  }finally{reader.releaseLock();}
  if(!total)throw new Error('GLABS_DOWNLOAD_EMPTY');
  const data=Buffer.concat(parts.map(x=>Buffer.from(x)));
  // HTTP success does not prove an image. Classify by bytes first, and reject
  // HTML/JSON/XML error bodies before any decoder or staging operation.
  let mime:'image/png'|'image/jpeg'|'image/webp';
  try{mime=imageMime(data) as 'image/png'|'image/jpeg'|'image/webp';}
  catch{throw new Error('GLABS_IMAGE_BODY_NOT_SUPPORTED');}
  const declaredRaw=res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()??'';
  const aliases:Record<string,string>={
    'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg',
    'image/x-png':'image/png','image/x-webp':'image/webp'
  };
  const declared=aliases[declaredRaw]??declaredRaw;
  const supported=['image/png','image/jpeg','image/webp'];
  if(declared&&declared!=='application/octet-stream'&&!supported.includes(declared))
    throw new Error('GLABS_DECLARED_MIME_UNSUPPORTED');
  // A missing/generic header or a mismatch among supported IMAGE declarations
  // is recoverable only because the caller MUST decode and validate the PNG.
  const classification:NonNullable<GLabsJob['mimeDiagnostic']>['classification']|null=
    !declared?'missing':declared==='application/octet-stream'?'generic':
    declared!==mime?'mismatch':declaredRaw!==declared?'alias':null;
  const mimeDiagnostic=classification?{
    declared:declared||'(missing)',detected:mime,classification
  }:undefined;
  return{data,mime,mimeDiagnostic};
}
export async function pollGlabsImage(appPath:string,root:string,userData:string,cipher:CredentialCipher,id:string,
  decode:GLabsDecoder){
  const job=readJob(root,id);
  if(['APPROVED','FAILED','CANCELLED','STALE'].includes(job.status))return job;
  if(!currentJobTarget(appPath,root,job))return job;
  if(job.status==='VALIDATED')return job;
  if(!job.providerTaskId){
    const note='Submission has no confirmed provider task ID; never auto-POST again.';
    if(job.status!=='UNKNOWN'||!job.reason?.includes(note)){
      job.status='UNKNOWN';job.reason=[job.reason,note].filter(Boolean).join(' | ');
      writeJob(root,job);
    }
    return job;
  }
  const config=glabsSettings(userData),task=job.providerTaskId;
  let response:unknown;
  try{
    response=await requestJson(config,userData,cipher,'GET','api/status/'+task);
    if(!pureObject(response)||response.task_id!==task)
      throw new Error('GLABS_STATUS_TASK_ID_MISMATCH');
    if(!['pending','running','failed','completed'].includes(String(response.status)))
      throw new Error('GLABS_STATUS_UNRECOGNIZED');
  }catch(error){
    // Read the latest durable evidence: a concurrent GET may have already
    // validated this image. Never downgrade that journal from a stale failure.
    const latest=readJob(root,id);
    if(['VALIDATED','APPROVED','STALE','CANCELLED'].includes(latest.status))return latest;
    if(!currentJobTarget(appPath,root,latest))return latest;
    const code=syncErrorCode(error,'GLABS_STATUS_READ_FAILED');
    latest.lastSyncError={stage:'provider',code,at:timestamp()};
    if(!latest.providerCompletedAt)latest.syncPhase='provider';
    writeJob(root,latest);
    throw error;
  }
  if(!currentJobTarget(appPath,root,job))return job;
  const latest=readJob(root,id);
  if(['VALIDATED','APPROVED'].includes(latest.status))return latest;
  Object.assign(job,latest);
  const status=String((response as Record<string,unknown>).status);
  if((status==='pending'||status==='running')&&!job.providerCompletedAt){
    if(job.status!=='RUNNING'||job.lastSyncError?.stage==='provider'){
      job.status='RUNNING';job.syncPhase='provider';
      if(job.lastSyncError?.stage==='provider')delete job.lastSyncError;
      writeJob(root,job);
    }
    return job;
  }
  if(status==='failed'&&!job.providerCompletedAt){
    if(job.lastSyncError?.stage==='provider')delete job.lastSyncError;
    job.status='FAILED';job.reason='Provider reported failure (no automatic retry).';
    writeJob(root,job);return job;
  }
  // Once completion has been persisted, any later stale pending/running/failed
  // status cannot revoke the DONE evidence or strand an image with an earlier
  // result/download failure. Continue GET-only ingestion of that SAME task.
  if(status!=='completed'&&!job.providerCompletedAt)
    throw new Error('GLABS_STATUS_UNRECOGNIZED');
  // Provider completion is independently durable evidence. Errors below are
  // result-ingestion errors, never a failed/chargeable generation or new POST.
  if(!job.providerCompletedAt||job.lastSyncError?.stage==='provider'){
    if(!job.providerCompletedAt)job.providerCompletedAt=timestamp();
    job.syncPhase='result';
    if(job.lastSyncError?.stage==='provider')delete job.lastSyncError;
    writeJob(root,job);
  }
  try{
    const resolved=await requestJson(config,userData,cipher,'GET','api/result/'+task);
    if(!currentJobTarget(appPath,root,job))return job;
    if(!pureObject(resolved)||resolved.task_id!==task||resolved.status!=='completed'||
      !Array.isArray(resolved.results)||!resolved.results.length||typeof resolved.results[0]!=='string')
      throw new Error('GLABS_RESULT_CONTRACT_INVALID');
    job.status='DOWNLOADED';job.syncPhase='download';writeJob(root,job);
    const image=await downloadImage(config,resolved.results[0],userData,cipher);
    if(!currentJobTarget(appPath,root,job))return job;
    job.sourceMime=image.mime;
    if(image.mimeDiagnostic)job.mimeDiagnostic=image.mimeDiagnostic;
    else delete job.mimeDiagnostic;
    job.syncPhase='decode';writeJob(root,job);
    const decoded=decode(image.data);
    if(!decoded||!Buffer.isBuffer(decoded.png)||imageMime(decoded.png)!=='image/png'||
      !Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
      decoded.width<1||decoded.height<1||decoded.width>8192||decoded.height>8192)
      throw new Error('GLABS_IMAGE_DECODE_INVALID');
    if(decoded.png.length>MAX_IMAGE)throw new Error('GLABS_DECODED_IMAGE_OVERSIZE');
    job.syncPhase='stage';writeJob(root,job);
    const relative='assets/images/glabs-'+job.id+'.png',file=resolveProjectFile(root,relative);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file)&&sha(fs.readFileSync(file))!==sha(decoded.png))throw new Error('GLABS_STAGING_FILE_TAMPERED');
    if(!fs.existsSync(file)){const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,decoded.png,{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
    job.staged={path:relative,sha256:sha(decoded.png),mime:'image/png',width:decoded.width,height:decoded.height};
    job.status='VALIDATED';job.syncPhase='validated';delete job.lastSyncError;
    writeJob(root,job);
    return job;
  }catch(error){
    // currentJobTarget can mark this attempt STALE during an awaited GET.
    // Never resurrect an outdated Native image to RUNNING.
    if(job.status==='STALE'||job.status==='CANCELLED')return job;
    const code=syncErrorCode(error,'GLABS_SYNC_READ_FAILED');
    job.lastSyncError={stage:job.syncPhase??'result',code,at:timestamp()};
    writeJob(root,job);
    throw error;
  }
}
function assertJobReferences(appPath:string,root:string,job:GLabsJob,decode:GLabsDecoder){
  if(!Array.isArray(job.references))throw new Error('GLABS_REFERENCE_EVIDENCE_MISSING');
  const media=readState(root).media??[];
  for(const ref of job.references){
    if(ref&&typeof ref.path==='string'&&ref.path.startsWith('@modeb/b4/')){
      const pinned=verifiedB4Reference(appPath,root,ref.path);
      if(ref.sha256!==pinned.sha256||ref.mime!==pinned.mime||ref.rightsSha256!==pinned.rightsSha256)
        throw new Error('GLABS_B4_REFERENCE_PIN_CHANGED');
      const decoded=decode(pinned.bytes);
      if(!decoded||!Buffer.isBuffer(decoded.png)||imageMime(decoded.png)!=='image/png'||
        decoded.width<1||decoded.height<1||decoded.width>8192||decoded.height>8192)
        throw new Error('GLABS_B4_REFERENCE_IMAGE_UNDECODABLE');
      continue;
    }
    if(!ref||typeof ref.path!=='string'||!/^assets\/images\/[^/]+\.(png|jpe?g)$/i.test(ref.path)||
       typeof ref.sha256!=='string'||typeof ref.mime!=='string'||typeof ref.rightsSha256!=='string'||
       !/^[a-f0-9]{64}$/.test(ref.rightsSha256))
      throw new Error('GLABS_REFERENCE_RIGHTS_EVIDENCE_MISSING: inspect and explicitly regenerate if needed.');
    const approved=media.some(item=>item.path===ref.path&&item.kind==='image'&&
      item.sha256===ref.sha256&&Boolean(item.rights?.trim())&&sha(item.rights)===ref.rightsSha256);
    if(!approved)throw new Error('GLABS_REFERENCE_RIGHTS_CHANGED_OR_REVOKED');
    const checked=validatedImage(root,ref.path,ref.sha256);
    if(checked.mime!==ref.mime)throw new Error('GLABS_REFERENCE_MIME_CHANGED');
    const verified=decode(checked.bytes);
    if(!verified||!Buffer.isBuffer(verified.png)||imageMime(verified.png)!=='image/png'||
      !Number.isSafeInteger(verified.width)||!Number.isSafeInteger(verified.height)||
      verified.width<1||verified.height<1||verified.width>8192||verified.height>8192)
      throw new Error('GLABS_REFERENCE_IMAGE_UNDECODABLE');
  }
}
function generatedApprovalProvenance(job:GLabsJob){
  if(!job.staged||!job.styleProfileSha256)throw new Error('GLABS_APPROVAL_PROVENANCE_INCOMPLETE');
  return{
    source:'G-Labs generated output' as const,projectId:job.projectId,
    jobId:job.id,providerTaskId:job.providerTaskId??null,model:job.model,
    promptSha256:job.promptSha256,imageSha256:job.staged.sha256,
    nativeToken:job.token,targetKey:job.targetKey,shotId:job.shotId,
    layerId:job.layerId,targetPath:job.targetPath,styleSha256:job.styleProfileSha256,
    approvedAt:timestamp(),ownerAuthorizedProjectUse:true as const,
    providerLicenseVerified:false as const
  };
}
/**
 * Recover only a fully committed, exact same-job native binding when the
 * process was interrupted after fulfillMedia committed pending.json/state.json
 * but BEFORE the APPROVED job journal was written.
 *
 * Nothing is imported or rebound; mismatched project/style/creative identity,
 * rights provenance, source SHA or original PNG fail closed.
 */
function recoverCommittedGeneratedApproval(
  appPath:string,root:string,job:GLabsJob,decode:GLabsDecoder
){
  if(job.status!=='VALIDATED'||!job.staged||!job.styleProfileId||
    !job.styleProfileSha256||!job.targetCreativeSha256)return null;
  // Normal approvals are unbound. Inspect the small persisted journal first:
  // do NOT hash/resolve all Native targets twice for every 200-image approval.
  const file=resolveProjectFile(root,'.studio/external/pending.json');
  if(!fs.existsSync(file))return null;
  const snapshot=strictJson(fs.readFileSync(file,'utf8')) as {
    token?:string;fulfillments?:Record<string,{relative:string;sha256:string;rights:string;kind:string}>
  };
  if(snapshot.token!==job.token||!snapshot.fulfillments?.[job.targetKey])return null;
  const pending=getPendingMedia(appPath,root);
  if(!pending||pending.status==='STALE'||pending.token!==job.token)return null;
  // The verified pending read above checks the transaction and media bytes.
  // Use the same synchronous journal snapshot to avoid assuming that generic
  // script pending results have image fulfillments.
  const binding=snapshot.fulfillments?.[job.targetKey];
  if(!binding||binding.kind!=='image'||binding.sha256!==job.staged.sha256)return null;
  const authorization='OWNER_APPROVED_GLABS_PROJECT_USE | job='+job.id+
    ' | source=G-Labs-generated | provider_license_not_verified';
  if(binding.rights!==authorization)return null;
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft||state.project.id!==job.projectId||
    state.tasks?.native?.revision!==job.nativeRevision||
    job.promptSha256!==sha(job.prompt)||
    draft.token!==job.token||
    draft.authorTaskId!==job.authorTaskId||
    draft.revision!==job.draftRevisionAtSubmission||
    state.project.style!==job.styleProfileId||
    loadImageStyleProfile(appPath,job.styleProfileId).sha256!==job.styleProfileSha256)return null;
  const creative=nativeImageTargetIdentity(root,job.targetKey);
  if(creative.fingerprint!==job.targetCreativeSha256||
    creative.shotId!==job.shotId||creative.layerId!==job.layerId||
    creative.path!==job.targetPath)return null;
  const mapped=state.media?.find(row=>row.kind==='image'&&row.path===binding.relative&&
    row.sha256===binding.sha256&&row.rights===authorization&&
    row.shotId===job.shotId&&row.layerId===job.layerId);
  if(!mapped||!state.imports?.includes(binding.relative))return null;
  const source=validatedImage(root,job.staged.path,job.staged.sha256);
  const imported=validatedImage(root,binding.relative,binding.sha256);
  if(source.mime!=='image/png'||imported.mime!=='image/png')return null;
  const decoded=decode(source.bytes);
  if(!decoded||!Buffer.isBuffer(decoded.png)||imageMime(decoded.png)!=='image/png'||
    decoded.width!==job.staged.width||decoded.height!==job.staged.height)return null;
  assertJobReferences(appPath,root,job,decode);
  job.approved={rights:authorization,path:binding.relative,
    sha256:binding.sha256,provenance:generatedApprovalProvenance(job)};
  job.status='APPROVED';writeJob(root,job);
  return{job,pending};
}
// All approved Native fulfillment writes happen synchronously under this
// per-project lock. Concurrent IPC approval cannot interleave pending.json
// mutations; a repeated approval of the same job is an idempotent read.
const approvalLocks=new Set<string>();
export function approveGlabsImage(appPath:string,root:string,id:string,rights:string|undefined,decode:GLabsDecoder){
  const projectLock=fs.realpathSync(root);
  if(approvalLocks.has(projectLock))throw new Error('GLABS_APPROVAL_BUSY');
  approvalLocks.add(projectLock);
  try{
    const job=readJob(root,id);
    if(job.status==='APPROVED'&&job.approved){
      // No repeat import, no repeat fulfillMedia and no second approval event.
      return{job,pending:getPendingMedia(appPath,root)};
    }
    if(job.status!=='VALIDATED'||!job.staged)throw new Error('GLABS_IMAGE_NOT_VALIDATED');
    // Validate provider-prompt provenance on EVERY approval path, before
    // attempting crash recovery or mutating a fulfillment journal. A forged
    // prompt hash must fail closed without rewriting the original job state.
    if(typeof job.prompt!=='string'||typeof job.promptSha256!=='string'||
      job.promptSha256!==sha(job.prompt))
      throw new Error('GLABS_JOB_STALE_PROMPT_EVIDENCE: stored image prompt SHA does not match the original provider payload.');
    // Crash-safe idempotency: only the exact same generated job can recover its
    // already committed binding; there must never be a second import.
    const recovered=recoverCommittedGeneratedApproval(appPath,root,job,decode);
    if(recovered)return recovered;
    // Undefined is the new G-Labs project-use approval. A legacy explicit
    // empty string still fails rather than masquerading as authorization.
    if(rights!==undefined&&(typeof rights!=='string'||rights.trim().length<5))
      throw new Error('GLABS_RIGHTS_ATTESTATION_REQUIRED');
    if(!currentJobTarget(appPath,root,job))
      throw new Error('GLABS_JOB_STALE_CREATIVE_TARGET: inspected output cannot be bound.');
    const image=validatedImage(root,job.staged.path,job.staged.sha256);
    if(image.mime!=='image/png'||job.staged.mime!=='image/png')throw new Error('GLABS_IMAGE_MIME_INVALID');
    const decoded=decode(image.bytes);
    if(!decoded||!Buffer.isBuffer(decoded.png)||imageMime(decoded.png)!=='image/png'||
      !Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
      decoded.width!==job.staged.width||decoded.height!==job.staged.height||
      decoded.width<1||decoded.height<1||decoded.width>8192||decoded.height>8192)
      throw new Error('GLABS_IMAGE_APPROVAL_DECODE_MISMATCH');
    assertJobReferences(appPath,root,job,decode);
    const provenance=generatedApprovalProvenance(job);
    // Media core still requires a nonempty rights string. This is a factual
    // owner-authorization provenance marker, NOT an independently verified
    // third-party license. Manual uploads keep their ordinary rights check.
    const authorization=rights===undefined?
      'OWNER_APPROVED_GLABS_PROJECT_USE | job='+job.id+
      ' | source=G-Labs-generated | provider_license_not_verified':rights.trim();
    const imported=importMediaFile(root,resolveProjectFile(root,job.staged.path),'image',authorization);
    const bound=fulfillMedia(appPath,root,job.token,job.targetKey,imported.path,authorization);
    job.approved={rights:authorization,path:imported.path,sha256:imported.sha256,provenance};
    job.status='APPROVED';writeJob(root,job);
    return{job,pending:bound};
  }finally{approvalLocks.delete(projectLock);}
}

/** Local cancellation is possible only before a provider POST has been submitted. */
export function cancelQueuedGlabsImage(root:string,id:string){
  const job=readJob(root,id);
  if(job.status!=='QUEUED')throw new Error('GLABS_CANNOT_CANCEL_SUBMITTED: reconcile provider task before changing state.');
  job.status='CANCELLED';job.reason='Owner cancelled before provider submission.';
  writeJob(root,job);return job;
}
