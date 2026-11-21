/** Owner-observed visual identity review, not machine-generated visual similarity. */
import fs from 'node:fs';
import {readCharacterRegistry,verifyIdentityMedia} from './visualIdentityRegistry.js';
import {assertVisualReferenceCurrent,resolveVisualReferences} from './visualReferenceResolver.js';
import {getNativeImageGallery} from './externalTasks.js';
import {atomicJson,readState,resolveProjectFile,strictJson} from './services.js';

interface Attestation {
  targetKey:string;sha256:string;referenceSetSha256:string;
  kind:'CANDIDATE'|'BOUND';jobId?:string;approvedAt:string;
}
interface ReviewStore{
  schema:'stickman-visual-review-v1';projectId:string;revision:number;
  attestations:Attestation[];
}
const file=(root:string)=>resolveProjectFile(root,'.studio/visual-identity/visual-review-v1.json');
const now=()=>new Date().toISOString();
export function readVisualReviews(root:string):ReviewStore{
  const id=readState(root).project.id;
  if(!fs.existsSync(file(root)))return{schema:'stickman-visual-review-v1',
    projectId:id,revision:0,attestations:[]};
  const value=strictJson(fs.readFileSync(file(root),'utf8')) as ReviewStore;
  if(value.schema!=='stickman-visual-review-v1'||value.projectId!==id||
    !Number.isSafeInteger(value.revision)||!Array.isArray(value.attestations))
    throw new Error('CHARACTER_REVIEW_JOURNAL_INVALID');
  return value;
}
function write(root:string,store:ReviewStore,record:Attestation){
  if(store.attestations.some(a=>a.targetKey===record.targetKey&&
    a.sha256===record.sha256&&a.referenceSetSha256===record.referenceSetSha256&&
    a.kind===record.kind&&a.jobId===record.jobId))return store;
  const next={...store,revision:store.revision+1,attestations:[...store.attestations,record]};
  atomicJson(file(root),next);return next;
}
/** Exactly the loaded owner-previewed current candidate, never a historical one. */
export function attestVisualCandidate(root:string,input:{
  jobId:string;targetKey:string;candidateSha256:string;referenceSetSha256:string;
  ownerConfirmed:true;
}){
  if(input.ownerConfirmed!==true)throw new Error('CHARACTER_OWNER_REVIEW_REQUIRED');
  const registry=readCharacterRegistry(root);
  if(!registry.strict)throw new Error('CHARACTER_STRICT_MODE_NOT_ENABLED');
  if(!/^[a-f0-9-]{36}$/i.test(input.jobId))throw new Error('CHARACTER_REVIEW_JOB_INVALID');
  const journal=resolveProjectFile(root,'.studio/glabs/jobs/'+input.jobId+'.json');
  if(!fs.existsSync(journal))throw new Error('CHARACTER_REVIEW_JOB_MISSING');
  const job=strictJson(fs.readFileSync(journal,'utf8')) as Record<string,unknown>;
  const staged=job.staged as Record<string,unknown>|undefined;
  if(job.projectId!==registry.projectId||job.status!=='VALIDATED'||
    job.targetKey!==input.targetKey||job.id!==input.jobId||
    job.referenceSetSha256!==input.referenceSetSha256||
    staged?.sha256!==input.candidateSha256||typeof staged.path!=='string')
    throw new Error('CHARACTER_REVIEW_STALE_CANDIDATE');
  const checked=verifyIdentityMedia(root,staged.path,input.candidateSha256);
  if(checked.sha256!==staged.sha256)throw new Error('CHARACTER_REVIEW_SHA_MISMATCH');
  assertVisualReferenceCurrent(root,{targetKey:input.targetKey,
    referenceSetSha256:input.referenceSetSha256,
    ownerReferences:Array.isArray(job.identityOwnerReferences)?
      job.identityOwnerReferences as string[]:[],
    compiledReferences:Array.isArray(job.references)?
      (job.references as Array<{path:string}>).map(r=>r.path):[]});
  return write(root,readVisualReviews(root),{
    targetKey:input.targetKey,jobId:input.jobId,
    sha256:input.candidateSha256,referenceSetSha256:input.referenceSetSha256,
    kind:'CANDIDATE',approvedAt:now()
  });
}
export function assertVisualCandidateReviewed(root:string,job:{
  id:string;targetKey:string;staged?:{sha256:string};referenceSetSha256?:string;
}){
  if(!readCharacterRegistry(root).strict)return;
  const ref=job.referenceSetSha256;
  if(!ref||!job.staged||!readVisualReviews(root).attestations.some(a=>
    a.kind==='CANDIDATE'&&a.jobId===job.id&&a.targetKey===job.targetKey&&
    a.sha256===job.staged!.sha256&&a.referenceSetSha256===ref))
    throw new Error('CHARACTER_VISUAL_REVIEW_REQUIRED');
}
/** Manual bound media cannot be rendered under strict mode until owner reviews exact SHA. */
export function attestBoundVisual(root:string,input:{
  targetKey:string;boundSha256:string;referenceSetSha256:string;ownerConfirmed:true
}){
  if(input.ownerConfirmed!==true||!readCharacterRegistry(root).strict)
    throw new Error('CHARACTER_OWNER_REVIEW_REQUIRED');
  const gallery=getNativeImageGallery('',root);
  const target=gallery.targets.find(t=>t.key===input.targetKey);
  if(!target?.fulfilled||target.boundSha256!==input.boundSha256)
    throw new Error('CHARACTER_BOUND_REVIEW_TARGET_INVALID');
  const plan=resolveVisualReferences(root,target.key);
  if(plan.readiness!=='READY'||plan.referenceSetSha256!==input.referenceSetSha256)
    throw new Error('REFERENCE_STALE');
  verifyIdentityMedia(root,target.boundPath,target.boundSha256);
  const existing=readVisualReviews(root);
  // No same-PNG re-attestation can silently clear a stale canonical change.
  // A new bound asset/verified Native Correct+rebind is required for that case.
  if(existing.attestations.some(a=>a.targetKey===target.key&&
    a.sha256===input.boundSha256&&a.referenceSetSha256!==plan.referenceSetSha256))
    throw new Error('CHARACTER_BOUND_REBIND_REQUIRED');
  return write(root,existing,{
    targetKey:target.key,sha256:input.boundSha256,
    referenceSetSha256:plan.referenceSetSha256,
    kind:'BOUND',approvedAt:now()
  });
}
/** F24 fail-closed on current bound drafts. Nothing is silently rebound or deleted. */
export function assertStrictProjectPublicationReady(root:string){
  const registry=readCharacterRegistry(root);
  if(!registry.strict)return;
  const gallery=getNativeImageGallery('',root),attestations=readVisualReviews(root).attestations;
  for(const target of gallery.targets){
    const plan=resolveVisualReferences(root,target.key);
    if(plan.readiness!=='READY')throw new Error('CHARACTER_PUBLICATION_BLOCKED: '+
      target.key+' '+plan.readiness);
    if(!target.fulfilled||!target.boundSha256)
      throw new Error('CHARACTER_PUBLICATION_BLOCKED: unbound '+target.key);
    if(attestations.some(a=>a.targetKey===target.key&&
      a.sha256===target.boundSha256&&a.referenceSetSha256!==plan.referenceSetSha256))
      throw new Error('CHARACTER_PUBLICATION_BLOCKED: rebind required '+target.key);
    const approved=attestations.some(a=>(a.kind==='BOUND'||a.kind==='CANDIDATE')&&
      a.targetKey===target.key&&a.sha256===target.boundSha256&&
      a.referenceSetSha256===plan.referenceSetSha256);
    if(!approved)throw new Error('CHARACTER_PUBLICATION_BLOCKED: stale or unreviewed '+target.key);
  }
}
