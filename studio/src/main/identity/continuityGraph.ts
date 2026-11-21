/** F24 continuation image dependencies are distinct from character identity.
 * One verified planner snapshot per batch avoids O(N^2) Native/ledger reads.
 * Single-target paid preflight builds a fresh snapshot before any POST. */
import {getNativeImageGallery,readNativeDraft} from '../externalTasks.js';
import {listGlabsJobs} from '../glabs.js';
import {readState} from '../services.js';
import {verifyReferenceFile} from './referencePublication.js';
import {validateNativeBindingPayload} from './nativeBinding.js';
import {contentHash} from './contracts.js';

export interface ContinuityImage{
  sourceTargetKey:string;relation:string;path:string;sha256:string;
  mime:'image/png'|'image/jpeg'|'image/webp';
  sourceJobId:string;sourceBindingSha:string;sourceSnapshotSha:string;
  dependencySha:string;
}
export function createContinuityResolver(appPath:string,root:string){
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)throw Error('IDENTITY_NATIVE_DRAFT_REQUIRED');
  const artifact=draft.artifact as unknown as {
    manifest:Record<string,unknown>;asset_needs:unknown[]
  };
  const snapshot=validateNativeBindingPayload(root,appPath,
    artifact.manifest,artifact.asset_needs);
  const gallery=getNativeImageGallery(appPath,root);
  if(gallery.token!==draft.token||gallery.targets.length!==snapshot.plans.length)
    throw Error('CONTINUITY_DRAFT_GALLERY_MISMATCH');
  const byKey=new Map(snapshot.plans.map((plan,index)=>[plan.targetKey,{
    ...plan,index,approvalSetSha:snapshot.identity.approvalSetSha,
    styleBibleSha:snapshot.identity.styleBibleSha
  }] as const));
  const byShotLayer=new Map(snapshot.plans.map(plan=>[
    plan.shotId+'/'+plan.layerId,plan.targetKey] as const));
  const sourceGallery=new Map(gallery.targets.map(row=>[row.key,row] as const));
  const jobs=listGlabsJobs(root),memo=new Map<string,ContinuityImage|null>();
  const resolve=(key:string,visiting=new Set<string>()):ContinuityImage|null=>{
    if(visiting.has(key))throw Error('CONTINUITY_CYCLE');
    if(memo.has(key))return memo.get(key)!;
    const target=byKey.get(key);
    if(!target)throw Error('CONTINUITY_TARGET_NOT_FOUND');
    const source=target.continuitySource;
    if(!source){memo.set(key,null);return null;}
    const sourceKey=byShotLayer.get(source.shot_id+'/'+source.layer_id);
    const parent=sourceKey?byKey.get(sourceKey):undefined;
    if(!parent||parent.index>=target.index)
      throw Error('CONTINUITY_SOURCE_NOT_EARLIER');
    const next=new Set(visiting);next.add(key);
    const inherited=resolve(sourceKey!,next);
    const galleryRow=sourceGallery.get(sourceKey!);
    if(!galleryRow?.fulfilled||!galleryRow.boundSha256)
      throw Error('CONTINUITY_SOURCE_NOT_READY');
    const job=jobs.find(job=>job.projectId===state.project.id&&
      job.targetKey===sourceKey&&job.token===gallery.token&&
      job.status==='APPROVED'&&job.approved?.path===galleryRow.boundPath&&
      job.approved?.sha256===galleryRow.boundSha256&&
      job.targetCreativeSha256===galleryRow.creativeFingerprint&&
      job.identityTargetBindingSha===parent.targetBindingSha&&
      job.identityApprovalSetSha===parent.approvalSetSha&&
      job.identityStyleBibleSha===parent.styleBibleSha);
    if(!job)throw Error('CONTINUITY_APPROVED_SOURCE_JOB_REQUIRED');
    const media=state.media?.find(m=>m.kind==='image'&&
      m.path===galleryRow.boundPath&&m.sha256===galleryRow.boundSha256&&
      m.shotId===galleryRow.shotId&&m.layerId===galleryRow.layerId&&
      m.rights?.trim()&&m.rights===job.approved?.rights);
    if(!media)throw Error('CONTINUITY_SOURCE_RIGHTS_MISSING');
    const checked=verifyReferenceFile(root,galleryRow.boundPath,
      galleryRow.boundSha256);
    const base={sourceTargetKey:sourceKey!,relation:source.relation,
      path:galleryRow.boundPath,sha256:checked.sha,mime:checked.mime,
      sourceJobId:job.id,sourceBindingSha:parent.targetBindingSha,
      sourceSnapshotSha:parent.upstreamSnapshotSha,
      parentDependencySha:inherited?.dependencySha??null};
    const result:ContinuityImage={...base,dependencySha:contentHash(base)};
    memo.set(key,result);return result;
  };
  return{
    getBinding:(key:string)=>{
      const value=byKey.get(key);
      if(!value)throw Error('IDENTITY_NATIVE_TARGET_NOT_CURRENT');
      return value;
    },
    resolve,
    targetCount:snapshot.plans.length
  };
}
export function resolveApprovedPreviousImage(appPath:string,root:string,
  targetKey:string,visited=new Set<string>()):ContinuityImage|null{
  return createContinuityResolver(appPath,root).resolve(targetKey,visited);
}
