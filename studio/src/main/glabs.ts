/** R3 G-Labs legacy adapter. Explicit owner actions only. No background paid retries. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {CredentialCipher} from './elevenlabsCredentials.js';
import {getPendingMedia,importMediaFile,fulfillMedia} from './externalTasks.js';
import {atomicJson,readState,resolveProjectFile,sha,strictJson} from './services.js';

export const GLABS_MODELS=['nano_banana_2','nano_banana_pro'] as const;
export const GLABS_RATIOS=['1:1','3:4','4:3','9:16','16:9'] as const;
type JobStatus='QUEUED'|'SUBMITTED'|'RUNNING'|'DOWNLOADED'|'VALIDATED'|'APPROVED'|'FAILED'|'UNKNOWN'|'CANCELLED'|'STALE';
export interface GLabsSettings{endpoint:string;contract:'legacy';model:string;aspectRatio:string}
export interface GLabsJob {
  schema:'r3-glabs-job-v1';id:string;projectId:string;nativeRevision:number;token:string;targetKey:string;shotId:string;layerId:string;targetPath:string;candidateSha256:string;
  prompt:string;promptSha256:string;references:Array<{path:string;sha256:string;mime:string;name:string}>;model:string;aspectRatio:string;status:JobStatus;
  providerTaskId?:string;staged?:{path:string;sha256:string;mime:string;width:number;height:number};
  reason?:string;approved?:{rights:string;path:string;sha256:string};createdAt:string;updatedAt:string;
}
const MAX_RESPONSE=2*1024*1024,MAX_IMAGE=16*1024*1024;
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
  return{endpoint:glabsEndpoint(String(raw.endpoint??'')),contract:'legacy',
    model:String(raw.model??defaultSettings.model),aspectRatio:String(raw.aspectRatio??defaultSettings.aspectRatio)};
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
  let res:Response;
  try{res=await fetch(url,{method,headers,body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{throw new Error('GLABS_TRANSPORT_UNKNOWN: request failed or timed out.');}
  if(!res.ok)throw new Error('GLABS_HTTP_'+res.status);
  if(method==='POST'&&res.status!==202)throw new Error('GLABS_SUBMISSION_STATUS_UNVERIFIED');
  if(Number(res.headers.get('content-length')??0)>MAX_RESPONSE)throw new Error('GLABS_RESPONSE_OVERSIZE');
  const value=await res.text();
  if(Buffer.byteLength(value,'utf8')>MAX_RESPONSE)throw new Error('GLABS_RESPONSE_OVERSIZE');
  try{return JSON.parse(value) as unknown;}catch{throw new Error('GLABS_RESPONSE_INVALID_JSON');}
}
export async function glabsProbe(userData:string,cipher:CredentialCipher){
  const settings=glabsSettings(userData);
  const health=await requestJson(settings,userData,cipher,'GET','api/health',undefined,false);
  if(!pureObject(health))throw new Error('G-Labs health contract is invalid.');
  const auth=await requestJson(settings,userData,cipher,'GET','api/tasks');
  if(!pureObject(auth)&&!Array.isArray(auth))throw new Error('G-Labs read-only authentication contract is invalid.');
  return{ready:true,contract:settings.contract,version:String(health.version??'not advertised'),endpoint:settings.endpoint,
    supportedModels:[...GLABS_MODELS],supportedRatios:[...GLABS_RATIOS],authVerified:true};
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
function writeJob(root:string,job:GLabsJob){
  job.updatedAt=timestamp();
  atomicJson(jobFile(root,job.id),job);
}
function readJob(root:string,id:string):GLabsJob{
  const raw=strictJson(fs.readFileSync(jobFile(root,id),'utf8')) as unknown as GLabsJob;
  if(raw.schema!=='r3-glabs-job-v1'||raw.projectId!==readState(root).project.id||raw.id!==id)throw new Error('GLABS_JOB_IDENTITY_INVALID');
  return raw;
}
export function listGlabsJobs(root:string):GLabsJob[]{
  const dir=jobsDir(root);
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name)).map(name=>readJob(root,name.slice(0,-5)))
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
  return current;
}
export type GLabsDecoder=(bytes:Buffer)=>{png:Buffer;width:number;height:number};
export interface ImageRequest{
  targetKey:string;prompt:string;model:string;aspectRatio:string;
  references:string[];authorized:boolean;acknowledgeUnknown?:boolean;regenerate?:boolean;
}
export async function submitGlabsImage(appPath:string,root:string,userData:string,cipher:CredentialCipher,input:ImageRequest,decode:GLabsDecoder){
  if(input.authorized!==true)throw new Error('GLABS_PAID_SUBMISSION_REQUIRES_EXPLICIT_OWNER_AUTHORIZATION');
  if(typeof input.prompt!=='string'||input.prompt.trim().length<12||input.prompt.length>18000)
    throw new Error('GLABS_PROMPT_REQUIRED: owner must confirm an actual image requirement.');
  const config=glabsSettings(userData);
  if(input.model!==config.model||input.aspectRatio!==config.aspectRatio)
    throw new Error('GLABS_MODEL_CONFIG_MISMATCH: save exact chosen model/ratio in Settings.');
  const {pending,match}=pendingTarget(appPath,root,input.targetKey);
  const state=readState(root),old=listGlabsJobs(root).filter(j=>j.token===pending.token&&j.targetKey===input.targetKey);
  const shots=(pending.after as Record<string,unknown>).shots;
  if(!['B1','B2','B3','B4'].includes(state.project.style)||state.brief.ratio!=='9:16'||
    !Array.isArray(shots)||shots.some(item=>!pureObject(item)||typeof item.end!=='number'||item.end>=300))
    throw new Error('GLABS_R3_SCOPE_INVALID: only verified B1–B4 portrait Native candidates below 300 seconds.');
  if(old.some(j=>['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(j.status)))
    throw new Error('GLABS_EXISTING_ACTIVE_ATTEMPT');
  if(old.some(j=>j.status==='UNKNOWN')&&!input.acknowledgeUnknown)
    throw new Error('GLABS_UNKNOWN_MAY_HAVE_CHARGED: explicit owner acknowledgement is required.');
  if(old.length&&!input.regenerate&&!old.every(j=>j.status==='FAILED'||j.status==='STALE'||j.status==='CANCELLED'))
    throw new Error('GLABS_NEW_ATTEMPT_REQUIRES_EXPLICIT_REGENERATE');
  if(!Array.isArray(input.references)||input.references.length>8||new Set(input.references).size!==input.references.length)
    throw new Error('GLABS_REFERENCES_INVALID');
  const referenceFiles=input.references.map((relative,index)=>{
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
    return{path:relative,sha256:checked.sha256,mime:checked.mime,name:'ref_'+String(index+1).padStart(3,'0')+'.'+ext};
  });
  // Only read-only probes before an explicitly authorized paid POST.
  await glabsProbe(userData,cipher);
  const job:GLabsJob={schema:'r3-glabs-job-v1',id:randomUUID(),projectId:state.project.id,
    nativeRevision:state.tasks?.native?.revision??0,token:pending.token,targetKey:match.key,shotId:match.shotId,layerId:match.layerId,
    targetPath:match.path,candidateSha256:sha(JSON.stringify(pending.after)),prompt:input.prompt.trim(),promptSha256:sha(input.prompt.trim()),
    references:referenceFiles,model:input.model,aspectRatio:input.aspectRatio,status:'QUEUED',createdAt:timestamp(),updatedAt:timestamp()};
  const lock=job.projectId+':'+job.token+':'+job.targetKey;
  if(active.has(lock))throw new Error('GLABS_TARGET_ALREADY_RUNNING');
  active.add(lock);
  try{
    writeJob(root,job);assertJobTarget(appPath,root,job);
    job.status='SUBMITTED';writeJob(root,job); // durable uncertain marker BEFORE paid HTTP
    try{
      const refs=job.references.map(ref=>{
        const checked=validatedImage(root,ref.path,ref.sha256);
        return{data:'data:'+ref.mime+';base64,'+checked.bytes.toString('base64'),name:ref.name};
      });
      const result=await requestJson(config,userData,cipher,'POST','api/image/generate',
        {prompt:job.prompt,model:job.model,aspect_ratio:job.aspectRatio,reference_images:refs,upscale:[]});
      if(!pureObject(result)||typeof result.task_id!=='string'||!/^[0-9a-f]{8}$/i.test(result.task_id)||
         !['pending','running'].includes(String(result.status)))
        throw new Error('GLABS_SUBMISSION_CONTRACT_UNVERIFIED');
      job.providerTaskId=result.task_id.toLowerCase();job.status='RUNNING';writeJob(root,job);
    }catch{
      job.status='UNKNOWN';job.reason='Paid submission outcome unconfirmed. No automatic replay; reconcile or explicitly authorize another attempt.';
      writeJob(root,job);
    }
    return job;
  }finally{active.delete(lock);}
}
async function downloadImage(settings:GLabsSettings,urlText:string,userData:string,cipher:CredentialCipher){
  const origin=glabsEndpoint(settings.endpoint),url=new URL(urlText);
  if(url.origin!==origin||!url.pathname.startsWith('/api/files/')||url.username||url.password||url.hash||
    url.pathname.includes('..')||url.search)
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
  const data=Buffer.concat(parts.map(x=>Buffer.from(x))),mime=imageMime(data);
  const ct=res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if(!ct||ct!==mime)throw new Error('GLABS_MIME_SIGNATURE_MISMATCH');
  return{data,mime};
}
export async function pollGlabsImage(appPath:string,root:string,userData:string,cipher:CredentialCipher,id:string,
  decode:GLabsDecoder){
  const job=readJob(root,id);
  if(job.status==='VALIDATED'||job.status==='APPROVED'||job.status==='FAILED'||job.status==='CANCELLED')return job;
  try{assertJobTarget(appPath,root,job);}catch{job.status='STALE';writeJob(root,job);return job;}
  if(!job.providerTaskId){
    job.status='UNKNOWN';job.reason='Submission has no confirmed provider task ID; never auto-POST again.';writeJob(root,job);return job;
  }
  const config=glabsSettings(userData),task=job.providerTaskId;
  const response=await requestJson(config,userData,cipher,'GET','api/status/'+task);
  if(!pureObject(response)||response.task_id!==task)throw new Error('GLABS_STATUS_TASK_ID_MISMATCH');
  const status=String(response.status);
  if(status==='pending'||status==='running'){job.status='RUNNING';writeJob(root,job);return job;}
  if(status==='failed'){job.status='FAILED';job.reason='Provider reported failure (no automatic retry).';writeJob(root,job);return job;}
  if(status!=='completed')throw new Error('GLABS_STATUS_UNRECOGNIZED');
  const resolved=await requestJson(config,userData,cipher,'GET','api/result/'+task);
  if(!pureObject(resolved)||resolved.task_id!==task||resolved.status!=='completed'||
    !Array.isArray(resolved.results)||!resolved.results.length||typeof resolved.results[0]!=='string')
    throw new Error('GLABS_RESULT_CONTRACT_INVALID');
  job.status='DOWNLOADED';writeJob(root,job);
  const image=await downloadImage(config,resolved.results[0],userData,cipher);
  const decoded=decode(image.data);
  if(!decoded||!Buffer.isBuffer(decoded.png)||imageMime(decoded.png)!=='image/png'||
    !Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
    decoded.width<1||decoded.height<1||decoded.width>8192||decoded.height>8192)
    throw new Error('GLABS_IMAGE_DECODE_INVALID');
  if(decoded.png.length>MAX_IMAGE)throw new Error('GLABS_DECODED_IMAGE_OVERSIZE');
  const relative='assets/images/glabs-'+job.id+'.png',file=resolveProjectFile(root,relative);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)&&sha(fs.readFileSync(file))!==sha(decoded.png))throw new Error('GLABS_STAGING_FILE_TAMPERED');
  if(!fs.existsSync(file)){const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,decoded.png,{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
  job.staged={path:relative,sha256:sha(decoded.png),mime:'image/png',width:decoded.width,height:decoded.height};
  job.status='VALIDATED';writeJob(root,job);
  return job;
}
export function approveGlabsImage(appPath:string,root:string,id:string,rights:string){
  const job=readJob(root,id);
  if(job.status!=='VALIDATED'||!job.staged)throw new Error('GLABS_IMAGE_NOT_VALIDATED');
  if(typeof rights!=='string'||rights.trim().length<5)throw new Error('GLABS_RIGHTS_ATTESTATION_REQUIRED');
  assertJobTarget(appPath,root,job);
  validatedImage(root,job.staged.path,job.staged.sha256);
  const imported=importMediaFile(root,resolveProjectFile(root,job.staged.path),'image',rights.trim());
  const bound=fulfillMedia(appPath,root,job.token,job.targetKey,imported.path,rights.trim());
  job.approved={rights:rights.trim(),path:imported.path,sha256:imported.sha256};
  job.status='APPROVED';writeJob(root,job);
  return{job,pending:bound};
}

/** Local cancellation is possible only before a provider POST has been submitted. */
export function cancelQueuedGlabsImage(root:string,id:string){
  const job=readJob(root,id);
  if(job.status!=='QUEUED')throw new Error('GLABS_CANNOT_CANCEL_SUBMITTED: reconcile provider task before changing state.');
  job.status='CANCELLED';job.reason='Owner cancelled before provider submission.';
  writeJob(root,job);return job;
}
