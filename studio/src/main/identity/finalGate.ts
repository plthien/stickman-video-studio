/** F24 final publish/render gate. Never edits Native Core project.json. */
import fs from 'node:fs';
import {atomicJson,readState,resolveProjectFile,sha,strictJson} from '../services.js';
import {getNativeImageGallery,readNativeDraft,isManagedNativeImagePath} from '../externalTasks.js';
import {listGlabsJobs,readGlabsJob} from '../glabs.js';
import {readApprovedNativeIdentity,validateNativeBindingPayload} from './nativeBinding.js';
import {createContinuityResolver} from './continuityGraph.js';
import {verifyReferenceFile} from './referencePublication.js';
import {contentHash} from './contracts.js';

export interface NativeIdentityReceiptRow{
  targetKey:string;shotId:string;layerId:string;imagePath:string;imageSha:string;
  sourceJobId:string;targetBindingSha:string;referenceSetSha:string;
  previousDependencySha:string|null;
}
export interface NativeIdentityReceipt{
  schema:'stickman-native-identity-publication-v1';
  projectId:string;nativeProjectSha:string;sourceSnapshotSha:string;
  approvalSetSha:string;rows:NativeIdentityReceiptRow[];
  scope:'FULL'|'SAMPLE';totalTargets:number;sampleSeconds:number|null;
  revision:number;createdAt:string;receiptSha:string;
}
const receiptFile=(root:string)=>resolveProjectFile(root,'.studio/identity/native-publication-v1.json');
/** A sample receipt attests only layers that start inside the sample window. */
function targetStarts(manifest:Record<string,unknown>,targetKey:string):number{
  const shotIndex=Number(/^image:([0-9]+):/.exec(targetKey)?.[1]);
  const shot=(manifest.shots as Array<Record<string,unknown>>)[shotIndex];
  if(!shot||!Number.isFinite(Number(shot.start)))throw Error('IDENTITY_SAMPLE_SHOT_INVALID');
  const visit=(layers:unknown[],from=0):number|null=>{
    for(const item of layers){
      if(!item||typeof item!=='object'||Array.isArray(item))continue;
      const node=item as Record<string,unknown>;
      const next=Math.max(from,Number(node.from??0));
      if(node.type==='image'&&targetKey==='image:'+shotIndex+':'+node.id)
        return Number(shot.start)+next;
      if(Array.isArray(node.children)){
        const found=visit(node.children,next);if(found!==null)return found;
      }
    }
    return null;
  };
  const start=visit(Array.isArray(shot.layers)?shot.layers:[]);
  if(start===null||!Number.isFinite(start)||start<0)
    throw Error('IDENTITY_SAMPLE_TARGET_TIMING_INVALID');
  return start;
}
export function currentDraftIdentityReceipt(root:string,appPath:string,
  sampleSeconds?:number){
  const state=readState(root);
  if(state.identityPolicy!=='v1')return null;
  const draft=readNativeDraft(root,state);
  if(!draft)throw Error('IDENTITY_NATIVE_DRAFT_REQUIRED');
  const native=draft.artifact as unknown as {
    manifest:Record<string,unknown>;asset_needs:unknown[]
  };
  const verified=validateNativeBindingPayload(root,appPath,native.manifest,native.asset_needs);
  const gallery=getNativeImageGallery(appPath,root);
  if(gallery.token!==draft.token||gallery.targets.length!==verified.plans.length)
    throw Error('IDENTITY_NATIVE_GALLERY_MISMATCH');
  if(sampleSeconds!==undefined&&
    (!Number.isFinite(sampleSeconds)||sampleSeconds<=0))
    throw Error('IDENTITY_SAMPLE_SECONDS_INVALID');
  const scope=sampleSeconds===undefined?'FULL' as const:'SAMPLE' as const;
  const selected=verified.plans.filter(plan=>
    sampleSeconds===undefined||targetStarts(native.manifest,plan.targetKey)<sampleSeconds);
  const jobs=listGlabsJobs(root),rows:NativeIdentityReceiptRow[]=[];
  const continuity=selected.length?createContinuityResolver(appPath,root):null;
  for(const plan of selected){
    const target=gallery.targets.find(row=>row.key===plan.targetKey);
    if(!target||!target.fulfilled||!target.boundSha256)
      throw Error('IDENTITY_NATIVE_IMAGE_UNFULFILLED: '+plan.targetKey);
    const source=jobs.find(job=>job.projectId===state.project.id&&
      job.token===gallery.token&&job.targetKey===plan.targetKey&&
      job.targetCreativeSha256===target.creativeFingerprint&&
      job.status==='APPROVED'&&job.approved?.path===target.boundPath&&
      job.approved?.sha256===target.boundSha256&&
      job.identityTargetBindingSha===plan.targetBindingSha&&
      job.identityApprovalSetSha===verified.identity.approvalSetSha&&
      job.identityStyleBibleSha===verified.identity.styleBibleSha);
    if(!source)throw Error('IDENTITY_NATIVE_APPROVED_JOB_REQUIRED: '+plan.targetKey);
    const stored=readState(root).media?.find(m=>m.kind==='image'&&
      m.path===target.boundPath&&m.sha256===target.boundSha256&&
      m.shotId===target.shotId&&m.layerId===target.layerId&&
      m.rights===source.approved?.rights);
    if(!stored)throw Error('IDENTITY_NATIVE_BINDING_RIGHTS_CHANGED');
    verifyReferenceFile(root,target.boundPath,target.boundSha256);
    const previous=continuity!.resolve(plan.targetKey);
    if((source.identityPreviousSourceSha??null)!==(previous?.dependencySha??null))
      throw Error('IDENTITY_NATIVE_CONTINUITY_CHANGED: '+plan.targetKey);
    rows.push({targetKey:plan.targetKey,shotId:plan.shotId,
      layerId:plan.layerId,imagePath:target.boundPath,
      imageSha:target.boundSha256,sourceJobId:source.id,
      targetBindingSha:plan.targetBindingSha,
      referenceSetSha:verified.identity.approvalSetSha,
      previousDependencySha:previous?.dependencySha??null});
  }
  return{projectId:state.project.id,sourceSnapshotSha:verified.identity.snapshotSha,
    approvalSetSha:verified.identity.approvalSetSha,
    scope,totalTargets:verified.plans.length,sampleSeconds:sampleSeconds??null,
    rows:rows.sort((a,b)=>a.targetKey.localeCompare(b.targetKey))};
}
export function publishNativeIdentityReceipt(root:string,appPath:string,
  current:NonNullable<ReturnType<typeof currentDraftIdentityReceipt>>,
  expectedNativeSha:string){
  // Called only AFTER the original Native transaction publishes state.
  // readNativeDraft is unavailable then (FROZEN → IMPORTED). The caller checks
  // a fresh full draft receipt immediately after CLI and BEFORE that mutation.
  const validated=current;
  const identity=readApprovedNativeIdentity(root,appPath);
  if(identity.snapshotSha!==validated.sourceSnapshotSha||
    identity.approvalSetSha!==validated.approvalSetSha)
    throw Error('IDENTITY_NATIVE_SNAPSHOT_CHANGED_DURING_PUBLISH');
  const nativeFile=resolveProjectFile(root,'project.json');
  const bytes=fs.readFileSync(nativeFile);
  if(sha(bytes)!==expectedNativeSha)throw Error('IDENTITY_NATIVE_MANIFEST_CHANGED');
  const manifest=strictJson(bytes.toString('utf8')) as Record<string,unknown>;
  const actual=actualPublishedImages(manifest);
  if(actual.size!==current.totalTargets||
    current.rows.some(row=>actual.get(row.targetKey)!==row.imagePath))
    throw Error('IDENTITY_NATIVE_PUBLISHED_MAPPING_MISMATCH');
  const previous=readNativeIdentityReceipt(root);
  const record={schema:'stickman-native-identity-publication-v1' as const,
    ...validated,nativeProjectSha:expectedNativeSha,
    revision:(previous?.revision??0)+1,createdAt:new Date().toISOString()};
  const receipt:NativeIdentityReceipt={...record,receiptSha:contentHash(record)};
  atomicJson(receiptFile(root),receipt);
  return receipt;
}
export function readNativeIdentityReceipt(root:string):NativeIdentityReceipt|null{
  const file=receiptFile(root);
  if(!fs.existsSync(file))return null;
  const value=strictJson(fs.readFileSync(file,'utf8')) as NativeIdentityReceipt;
  if(value.schema!=='stickman-native-identity-publication-v1'||
    value.projectId!==readState(root).project.id||
    !Number.isSafeInteger(value.revision)||!Array.isArray(value.rows))
    throw Error('IDENTITY_NATIVE_RECEIPT_INVALID');
  const {receiptSha,...content}=value;
  if(contentHash(content)!==receiptSha)throw Error('IDENTITY_NATIVE_RECEIPT_TAMPERED');
  return value;
}
function actualPublishedImages(manifest:Record<string,unknown>){
  const shots=Array.isArray(manifest.shots)?manifest.shots as Array<Record<string,unknown>>:[];
  const out=new Map<string,string>();
  shots.forEach((shot,index)=>{
    const walk=(layers:unknown[])=>{
      for(const value of layers){
        if(!value||typeof value!=='object'||Array.isArray(value))continue;
        const layer=value as Record<string,unknown>;
        if(layer.type==='image'&&typeof layer.id==='string'&&isManagedNativeImagePath(layer.path))
          {
            const key='image:'+index+':'+layer.id;
            if(out.has(key))throw Error('NATIVE_PUBLISHED_DUPLICATE_IMAGE_TARGET');
            out.set(key,layer.path);
          }
        if(Array.isArray(layer.children))walk(layer.children);
      }
    };
    walk(Array.isArray(shot.layers)?shot.layers:[]);
  });
  return out;
}
/** Call before and AFTER each Native CLI/preview reuse. Immutable last-good
 * project.json is never treated as an F24 certification by itself. */
export function assertPublishedIdentityCurrent(root:string,appPath:string,
  required:'FULL'|'SAMPLE'='FULL',requestedSeconds?:number){
  const state=readState(root);
  if(state.identityPolicy!=='v1')return null;
  const identity=readApprovedNativeIdentity(root,appPath);
  const receipt=readNativeIdentityReceipt(root);
  if(!receipt||receipt.sourceSnapshotSha!==identity.snapshotSha||
    receipt.approvalSetSha!==identity.approvalSetSha)
    throw Error('IDENTITY_PUBLISHED_REFERENCE_LINEAGE_STALE');
  if(receipt.scope==='SAMPLE'&&required==='FULL')
    throw Error('IDENTITY_SAMPLE_NOT_FULLY_CERTIFIED');
  if(receipt.scope==='SAMPLE'&&requestedSeconds!==undefined&&
    (!Number.isFinite(requestedSeconds)||requestedSeconds<=0||
     receipt.sampleSeconds===null||requestedSeconds>receipt.sampleSeconds))
    throw Error('IDENTITY_SAMPLE_SCOPE_EXCEEDED');
  if(!['SAMPLE','FULL'].includes(receipt.scope)||
    !Number.isSafeInteger(receipt.totalTargets)||receipt.totalTargets<receipt.rows.length)
    throw Error('IDENTITY_PUBLISHED_RECEIPT_SCOPE_INVALID');
  const bytes=fs.readFileSync(resolveProjectFile(root,'project.json'));
  if(sha(bytes)!==receipt.nativeProjectSha)
    throw Error('IDENTITY_PUBLISHED_NATIVE_SOURCE_STALE');
  const manifest=strictJson(bytes.toString('utf8')) as Record<string,unknown>;
  const current=actualPublishedImages(manifest);
  if(current.size!==receipt.totalTargets)throw Error('IDENTITY_PUBLISHED_IMAGE_COUNT_MISMATCH');
  if(receipt.scope==='FULL'&&receipt.rows.length!==receipt.totalTargets)
    throw Error('IDENTITY_PUBLISHED_FULL_COVERAGE_INVALID');
  for(const row of receipt.rows){
    if(current.get(row.targetKey)!==row.imagePath)
      throw Error('IDENTITY_PUBLISHED_NATIVE_IMAGE_REMAPPED');
    verifyReferenceFile(root,row.imagePath,row.imageSha);
    // Published output must retain its real original G-Labs approval journal,
    // not just a filename and a rehashed local receipt.
    const source=readGlabsJob(root,row.sourceJobId);
    if(source.status!=='APPROVED'||source.projectId!==state.project.id||
      source.targetKey!==row.targetKey||
      source.shotId!==row.shotId||source.layerId!==row.layerId||
      source.approved?.path!==row.imagePath||
      source.approved?.sha256!==row.imageSha||
      source.identityTargetBindingSha!==row.targetBindingSha||
      source.identityApprovalSetSha!==receipt.approvalSetSha)
      throw Error('IDENTITY_PUBLISHED_APPROVAL_JOURNAL_STALE');
    const stored=state.media?.find(m=>m.kind==='image'&&
      m.path===row.imagePath&&m.sha256===row.imageSha&&
      m.shotId===row.shotId&&m.layerId===row.layerId&&
      m.rights===source.approved?.rights&&m.rights.trim());
    if(!stored)throw Error('IDENTITY_PUBLISHED_MEDIA_RIGHTS_REVOKED');
  }
  return receipt;
}
