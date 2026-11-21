/** F24 derived, durable current-DRAFT identity overlay.
 * Never rewrites historical G-Labs jobs or Native pending fulfillments. */
import fs from 'node:fs';
import {getNativeImageGallery} from './externalTasks.js';
import {listGlabsJobs} from './glabs.js';
import {readCharacterRegistry,readTargetBindings} from './visualIdentityRegistry.js';
import {readVisualReviews} from './visualIdentityReview.js';
import {resolveVisualReferences} from './visualReferenceResolver.js';
import {atomicJson,readState,resolveProjectFile,sha,strictJson} from './services.js';
export interface ContinuityOverlayRow{
  targetKey:string;shotId:string;layerId:string;creativeFingerprint:string;
  currentReferenceSetSha256:string;
  status:'READY'|'NEEDS_MAPPING_REVIEW'|'CHARACTER_REFERENCE_REQUIRED'|
    'CONTINUITY_SOURCE_NOT_READY'|'REFERENCE_STALE'|'REFERENCE_BUDGET_EXCEEDED'|
    'CHARACTER_VISUAL_REVIEW_REQUIRED';
  currentlyBound:boolean;candidateIds:string[];reason:string;
}
export interface ContinuityOverlay{
  schema:'stickman-continuity-overlay-v1';projectId:string;revision:number;
  sourceDigest:string;rows:ContinuityOverlayRow[];
}
const file=(root:string)=>resolveProjectFile(root,'.studio/visual-identity/continuity-overlay-v1.json');
const signature=(value:unknown)=>sha(JSON.stringify(value));
export function previewContinuityOverlay(root:string):Omit<ContinuityOverlay,'revision'>{
  const registry=readCharacterRegistry(root),bindings=readTargetBindings(root),
    gallery=getNativeImageGallery('',root),reviews=readVisualReviews(root);
  const jobs=listGlabsJobs(root).filter(job=>job.token===gallery.token);
  const rows:ContinuityOverlayRow[]=[];
  if(registry.strict)for(const target of gallery.targets){
    // One target's owner-selected extras are frozen independently of the
    // current Native creative fingerprint. No fallback to a previous target.
    const historical=jobs.filter(job=>job.targetKey===target.key);
    const current=historical.filter(job=>job.targetCreativeSha256===target.creativeFingerprint);
    const currentBound=current.find(job=>target.fulfilled&&job.status==='APPROVED'&&
      job.approved?.sha256===target.boundSha256&&job.approved?.path===target.boundPath);
    const latest=currentBound??current[0];
    // Undefined selects exact current Native owner overrides (B4/manual);
    // current jobs instead retain the frozen explicit owner selections.
    const plan=resolveVisualReferences(root,target.key,latest?.identityOwnerReferences);
    let status:ContinuityOverlayRow['status']=plan.readiness;
    const currentDigest=plan.referenceSetSha256;
    if(status==='READY'){
      if(latest?.referenceSetSha256&&latest.referenceSetSha256!==currentDigest)
        status='REFERENCE_STALE';
      if(target.fulfilled&&target.boundSha256){
        const hasReview=reviews.attestations.some(a=>
          a.targetKey===target.key&&a.sha256===target.boundSha256&&
          a.referenceSetSha256===currentDigest&&
          (a.kind==='BOUND'||a.kind==='CANDIDATE'));
        if(!hasReview)status=reviews.attestations.some(a=>a.targetKey===target.key)?
          'REFERENCE_STALE':'CHARACTER_VISUAL_REVIEW_REQUIRED';
      }
    }
    rows.push({targetKey:target.key,shotId:target.shotId,layerId:target.layerId,
      creativeFingerprint:target.creativeFingerprint??'',
      currentReferenceSetSha256:currentDigest,status,currentlyBound:target.fulfilled,
      candidateIds:current.map(job=>job.id),reason:status==='READY'?'':status});
  }
  return{schema:'stickman-continuity-overlay-v1',projectId:registry.projectId,
    sourceDigest:signature({registryRevision:registry.revision,
      bindingRevision:bindings.revision,draftToken:gallery.token,rows}),rows};
}
export function reconcileContinuityOverlay(root:string):ContinuityOverlay{
  const proposal=previewContinuityOverlay(root);
  const previous=readContinuityOverlay(root);
  if(previous&&previous.sourceDigest===proposal.sourceDigest)return previous;
  const next={...proposal,revision:(previous?.revision??0)+1};
  atomicJson(file(root),next);
  return next;
}
export function readContinuityOverlay(root:string):ContinuityOverlay|null{
  const filename=file(root);
  if(!fs.existsSync(filename))return null;
  const value=strictJson(fs.readFileSync(filename,'utf8')) as ContinuityOverlay;
  if(value.schema!=='stickman-continuity-overlay-v1'||value.projectId!==readState(root).project.id||
    !Array.isArray(value.rows)||!Number.isSafeInteger(value.revision))
    throw new Error('CONTINUITY_OVERLAY_INVALID');
  return value;
}
