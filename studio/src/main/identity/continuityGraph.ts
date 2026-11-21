/** F24 previous-image dependency is NOT a canonical character identity. */
import {getNativeImageGallery} from '../externalTasks.js';
import {listGlabsJobs} from '../glabs.js';
import {readState} from '../services.js';
import {verifyReferenceFile} from './referencePublication.js';
import {resolveNativeTargetBinding} from './nativeBinding.js';
import {contentHash} from './contracts.js';
export interface ContinuityImage{
  sourceTargetKey:string;relation:string;path:string;sha256:string;
  mime:'image/png'|'image/jpeg'|'image/webp';
  sourceJobId:string;sourceBindingSha:string;sourceSnapshotSha:string;
  dependencySha:string;
}
export function resolveApprovedPreviousImage(appPath:string,root:string,
  targetKey:string,visited=new Set<string>()):ContinuityImage|null{
  if(visited.has(targetKey))throw Error('CONTINUITY_CYCLE');
  const seen=new Set(visited);seen.add(targetKey);
  const target=resolveNativeTargetBinding(root,appPath,targetKey);
  if(!target.continuitySource)return null;
  const gallery=getNativeImageGallery(appPath,root);
  const targetIndex=gallery.targets.findIndex(row=>row.key===targetKey);
  const sourceIndex=gallery.targets.findIndex(row=>
    row.shotId===target.continuitySource?.shot_id&&
    row.layerId===target.continuitySource?.layer_id);
  if(sourceIndex<0||sourceIndex>=targetIndex)
    throw Error('CONTINUITY_SOURCE_NOT_EARLIER');
  const source=gallery.targets[sourceIndex];
  if(!source.fulfilled||!source.boundSha256)
    throw Error('CONTINUITY_SOURCE_NOT_READY');
  const current=resolveNativeTargetBinding(root,appPath,source.key);
  // A continuity chain is valid only if ALL preceding approved sources remain
  // valid. Recursion is bounded by earlier-shot ordering.
  if(current.continuitySource)
    resolveApprovedPreviousImage(appPath,root,source.key,seen);
  const accepted=listGlabsJobs(root).find(job=>job.projectId===readState(root).project.id&&
    job.targetKey===source.key&&job.token===gallery.token&&
    job.status==='APPROVED'&&job.approved?.path===source.boundPath&&
    job.approved.sha256===source.boundSha256&&
    job.targetCreativeSha256===source.creativeFingerprint&&
    job.identityTargetBindingSha===current.targetBindingSha&&
    job.identityStyleBibleSha===current.styleBibleSha&&
    job.approved?.rights===readState(root).media?.find(m=>
      m.path===source.boundPath&&m.sha256===source.boundSha256&&
      m.shotId===source.shotId&&m.layerId===source.layerId)?.rights&&
    job.identityApprovalSetSha===current.approvalSetSha);
  if(!accepted)throw Error('CONTINUITY_APPROVED_SOURCE_JOB_REQUIRED');
  const ledger=readState(root).media?.find(m=>m.kind==='image'&&
    m.path===source.boundPath&&m.sha256===source.boundSha256&&m.rights?.trim()&&
    m.shotId===source.shotId&&m.layerId===source.layerId);
  if(!ledger)throw Error('CONTINUITY_SOURCE_RIGHTS_MISSING');
  const checked=verifyReferenceFile(root,source.boundPath,source.boundSha256);
  const base={sourceTargetKey:source.key,relation:target.continuitySource.relation,
    path:source.boundPath,sha256:checked.sha,mime:checked.mime,
    sourceJobId:accepted.id,sourceBindingSha:current.targetBindingSha,
    sourceSnapshotSha:current.upstreamSnapshotSha};
  return{...base,dependencySha:contentHash(base)};
}
