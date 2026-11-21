/** F24 filesystem-only character authority. No generated traits or paid operations. */
import fs from 'node:fs';
import {getNativeImageGallery} from './externalTasks.js';
import {atomicJson,readState,resolveProjectFile,sha,strictJson} from './services.js';

export type IdentityMime='image/png'|'image/jpeg'|'image/webp';
export type IdentityStatus='DRAFT'|'APPROVED'|'ARCHIVED';
export interface CharacterReference{
  referenceId:string;relativePath:string;sha256:string;mime:IdentityMime;
  rightsLedgerKey:string;sourceKind:'OWNER_IMPORTED'|'APPROVED_GLABS';
  approvedAt:string;sourceJobId?:string;providerLicenseVerified?:false;
}
export interface CharacterRecord{
  characterId:string;label:string;identityVersion:number;status:IdentityStatus;
  canonicalReferenceId:string|null;references:CharacterReference[];
}
export interface Registry{
  schema:'stickman-character-registry-v1';projectId:string;revision:number;
  strict:boolean;characters:CharacterRecord[];
  history:Array<{revision:number;at:string;reason:string;digest:string}>;
}
export type ContinuityRelation='none'|'same_setup'|'match_subject'|'match_location'|
  'match_composition'|'graphic_sequence';
export interface TargetIdentityBinding{
  targetKey:string;shotId:string;layerId:string;expectedPath:string;
  draftToken:string;creativeFingerprint:string;
  characters:string[];noRecurringCharacter:boolean;confirmedByOwner:true;
  continuity:null|{sourceTargetKey:string;relation:Exclude<ContinuityRelation,'none'>};
  updatedAt:string;
}
export interface BindingStore{
  schema:'stickman-target-bindings-v1';projectId:string;revision:number;
  bindings:TargetIdentityBinding[];
  history:Array<{revision:number;at:string;reason:string;digest:string}>;
}
const registryPath=(root:string)=>resolveProjectFile(root,'.studio/visual-identity/character-registry-v1.json');
const bindingsPath=(root:string)=>resolveProjectFile(root,'.studio/visual-identity/target-bindings-v1.json');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:string)=>/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value);
const hash=(value:unknown)=>sha(JSON.stringify(value));
const hex=(value:string)=>/^[a-f0-9]{64}$/.test(value);
const now=()=>new Date().toISOString();
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function restoreIfMissing<T>(root:string,file:string,empty:T):T{
  if(!fs.existsSync(file))return empty;
  const value=strictJson(fs.readFileSync(file,'utf8')) as T;
  return value;
}
export function readCharacterRegistry(root:string):Registry{
  const projectId=readState(root).project.id;
  const doc=restoreIfMissing(root,registryPath(root),{
    schema:'stickman-character-registry-v1' as const,projectId,revision:0,strict:false,
    characters:[] as CharacterRecord[],history:[] as Registry['history']
  });
  if(doc.schema!=='stickman-character-registry-v1'||doc.projectId!==projectId||
    !Number.isSafeInteger(doc.revision)||doc.revision<0||typeof doc.strict!=='boolean'||
    !Array.isArray(doc.characters)||!Array.isArray(doc.history)||
    doc.characters.some(c=>!validId(c.characterId)||typeof c.label!=='string'||
      !Number.isInteger(c.identityVersion)||!['DRAFT','APPROVED','ARCHIVED'].includes(c.status)||
      !Array.isArray(c.references)||!c.references.every(r=>validId(r.referenceId)&&
        hex(r.sha256)&&typeof r.relativePath==='string'&&
        ['image/png','image/jpeg','image/webp'].includes(r.mime)))||
    new Set(doc.characters.map(c=>c.characterId)).size!==doc.characters.length)
    throw new Error('CHARACTER_REGISTRY_INVALID');
  return doc;
}
export function readTargetBindings(root:string):BindingStore{
  const projectId=readState(root).project.id;
  const doc=restoreIfMissing(root,bindingsPath(root),{
    schema:'stickman-target-bindings-v1' as const,projectId,revision:0,
    bindings:[] as TargetIdentityBinding[],history:[] as BindingStore['history']
  });
  if(doc.schema!=='stickman-target-bindings-v1'||doc.projectId!==projectId||
    !Number.isSafeInteger(doc.revision)||doc.revision<0||
    !Array.isArray(doc.bindings)||!Array.isArray(doc.history)||
    new Set(doc.bindings.map(v=>v.targetKey)).size!==doc.bindings.length||
    doc.bindings.some(v=>!v||typeof v.targetKey!=='string'||
      typeof v.draftToken!=='string'||!hex(v.creativeFingerprint)||
      !Array.isArray(v.characters)||v.characters.some(c=>!validId(c))||
      typeof v.noRecurringCharacter!=='boolean'||v.confirmedByOwner!==true))
    throw new Error('CHARACTER_BINDINGS_INVALID');
  return doc;
}
function commitRegistry(root:string,current:Registry,next:Registry,reason:string){
  if(same(current.characters,next.characters)&&current.strict===next.strict)return current;
  next.revision=current.revision+1;
  next.history=[...current.history,{revision:current.revision,at:now(),reason,
    digest:hash({characters:current.characters,strict:current.strict})}].slice(-500);
  atomicJson(registryPath(root),next);return next;
}
function commitBindings(root:string,current:BindingStore,next:BindingStore,reason:string){
  if(same(current.bindings,next.bindings))return current;
  next.revision=current.revision+1;
  next.history=[...current.history,{revision:current.revision,at:now(),reason,
    digest:hash(current.bindings)}].slice(-500);
  atomicJson(bindingsPath(root),next);return next;
}
/** Real registered project-local bytes only. No label/filename is appearance evidence. */
export function verifyIdentityMedia(root:string,relativePath:string,expectedSha?:string){
  if(!/^assets\/images\/[^/]+\.(png|jpe?g|webp)$/i.test(relativePath))
    throw new Error('CHARACTER_REFERENCE_PATH_INVALID');
  const file=resolveProjectFile(root,relativePath);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()||
    fs.statSync(file).size<24||fs.statSync(file).size>16*1024*1024)
    throw new Error('CHARACTER_REFERENCE_FILE_MISSING_OR_OVERSIZE');
  const data=fs.readFileSync(file),foundSha=sha(data);
  if(expectedSha&&foundSha!==expectedSha)throw new Error('REFERENCE_STALE');
  let mime:IdentityMime;
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    data.toString('ascii',12,16)==='IHDR')mime='image/png';
  else if(data[0]===255&&data[1]===216&&data[2]===255)mime='image/jpeg';
  else if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')mime='image/webp';
  else throw new Error('CHARACTER_REFERENCE_MIME_INVALID');
  return{bytes:data,sha256:foundSha,mime};
}
function admittedMedia(root:string,relativePath:string){
  const state=readState(root),image=verifyIdentityMedia(root,relativePath);
  const ledger=state.media?.find(m=>m.kind==='image'&&m.path===relativePath&&
    m.sha256===image.sha256&&m.rights?.trim());
  if(!ledger)throw new Error('CHARACTER_REFERENCE_UNAPPROVED_MEDIA');
  if(!state.imports?.includes(relativePath))throw new Error('CHARACTER_REFERENCE_NOT_IMPORTED');
  return{image,ledger};
}
export function registerCharacter(root:string,input:{characterId:string;label:string;expectedRevision:number}){
  const current=readCharacterRegistry(root);
  if(input.expectedRevision!==current.revision)throw new Error('CHARACTER_REGISTRY_REVISION_CONFLICT');
  if(!validId(input.characterId)||typeof input.label!=='string'||!input.label.trim()||
    input.label.length>100)throw new Error('CHARACTER_ID_OR_LABEL_INVALID');
  if(current.characters.some(c=>c.characterId===input.characterId))
    throw new Error('CHARACTER_DUPLICATE_ID');
  return commitRegistry(root,current,{...current,characters:[...current.characters,{
    characterId:input.characterId,label:input.label.trim(),identityVersion:1,
    status:'DRAFT',canonicalReferenceId:null,references:[]
  }]},'create:'+input.characterId);
}
export function addCharacterReference(root:string,input:{
  characterId:string;referenceId:string;relativePath:string;expectedRevision:number;
  sourceJobId?:string;
},decode:(bytes:Buffer)=>{png:Buffer;width:number;height:number}){
  const current=readCharacterRegistry(root);
  if(input.expectedRevision!==current.revision)throw new Error('CHARACTER_REGISTRY_REVISION_CONFLICT');
  const record=current.characters.find(c=>c.characterId===input.characterId);
  if(!record||record.status==='ARCHIVED'||!validId(input.referenceId)||
    record.references.some(r=>r.referenceId===input.referenceId))
    throw new Error('CHARACTER_REFERENCE_ID_INVALID');
  const {image,ledger}=admittedMedia(root,input.relativePath);
  if(ledger.rights.includes('G-Labs-generated')&&!input.sourceJobId)
    throw new Error('CHARACTER_GENERATED_PROVENANCE_REQUIRED');
  const decoded=decode(image.bytes);
  if(!decoded||!Buffer.isBuffer(decoded.png)||decoded.width<1||decoded.height<1||
    decoded.width>8192||decoded.height>8192)throw new Error('CHARACTER_REFERENCE_DECODE_FAILED');
  let sourceKind:CharacterReference['sourceKind']='OWNER_IMPORTED';
  if(input.sourceJobId){
    const jobPath=resolveProjectFile(root,'.studio/glabs/jobs/'+input.sourceJobId+'.json');
    if(!/^[a-f0-9-]{36}$/i.test(input.sourceJobId)||!fs.existsSync(jobPath))
      throw new Error('CHARACTER_GENERATED_PROVENANCE_MISSING');
    const job=strictJson(fs.readFileSync(jobPath,'utf8')) as Record<string,unknown>;
    const approved=job.approved as Record<string,unknown>|undefined;
    if(job.projectId!==readState(root).project.id||job.status!=='APPROVED'||
      approved?.path!==input.relativePath||approved.sha256!==image.sha256)
      throw new Error('CHARACTER_GENERATED_PROVENANCE_INVALID');
    sourceKind='APPROVED_GLABS';
  }
  const reference:CharacterReference={
    referenceId:input.referenceId,relativePath:input.relativePath,
    sha256:image.sha256,mime:image.mime,rightsLedgerKey:sha(ledger.rights),
    sourceKind,approvedAt:now(),
    ...(input.sourceJobId?{sourceJobId:input.sourceJobId,providerLicenseVerified:false as const}:{})
  };
  const next={...record,identityVersion:record.identityVersion+1,
    references:[...record.references,reference]};
  return commitRegistry(root,current,{...current,characters:current.characters.map(c=>
    c.characterId===record.characterId?next:c)},'add-ref:'+record.characterId);
}
/** A potentially charged provider request is never invalidated by registry edits. */
function assertNoBusyVisualJobs(root:string,targets:string[]){
  const dir=resolveProjectFile(root,'.studio/glabs/jobs');
  if(!fs.existsSync(dir)||!targets.length)return;
  const currentProject=readState(root).project.id;
  for(const name of fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\\.json$/i.test(n))){
    const job=strictJson(fs.readFileSync(resolveProjectFile(root,
      '.studio/glabs/jobs/'+name),'utf8')) as Record<string,unknown>;
    if(job.projectId===currentProject&&targets.includes(String(job.targetKey))&&
      ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(String(job.status)))
      throw new Error('CHARACTER_IDENTITY_BUSY_PENDING_PROVIDER');
  }
}
export function approveCharacter(root:string,input:{
  characterId:string;referenceId:string;expectedRevision:number;reviewedImpactSha256?:string;
}){
  const current=readCharacterRegistry(root);
  if(input.expectedRevision!==current.revision)throw new Error('CHARACTER_REGISTRY_REVISION_CONFLICT');
  const record=current.characters.find(c=>c.characterId===input.characterId);
  const anchor=record?.references.find(r=>r.referenceId===input.referenceId);
  if(!record||!anchor||record.status==='ARCHIVED')throw new Error('CHARACTER_CANONICAL_REFERENCE_REQUIRED');
  const {image,ledger}=admittedMedia(root,anchor.relativePath);
  if(image.sha256!==anchor.sha256||image.mime!==anchor.mime||
    sha(ledger.rights)!==anchor.rightsLedgerKey)throw new Error('REFERENCE_STALE');
  if(record.canonicalReferenceId&&record.canonicalReferenceId!==input.referenceId){
    const impact=previewCharacterImpact(root,input.characterId);
    if(input.reviewedImpactSha256!==impact.impactSha256)
      throw new Error('CHARACTER_REPLACEMENT_IMPACT_REVIEW_REQUIRED');
    assertNoBusyVisualJobs(root,impact.targets);
  }
  const next:CharacterRecord={...record,identityVersion:record.identityVersion+1,
    canonicalReferenceId:anchor.referenceId,status:'APPROVED'};
  return commitRegistry(root,current,{...current,characters:current.characters.map(c=>
    c.characterId===next.characterId?next:c)},'approve:'+record.characterId);
}
export function setStrictCharacterMode(root:string,input:{enabled:boolean;expectedRevision:number}){
  const current=readCharacterRegistry(root);
  if(current.revision!==input.expectedRevision)throw new Error('CHARACTER_REGISTRY_REVISION_CONFLICT');
  return commitRegistry(root,current,{...current,strict:input.enabled},'strict:'+input.enabled);
}
export function archiveCharacter(root:string,input:{characterId:string;expectedRevision:number;reviewedImpactSha256:string}){
  const current=readCharacterRegistry(root),impact=previewCharacterImpact(root,input.characterId);
  if(current.revision!==input.expectedRevision)throw new Error('CHARACTER_REGISTRY_REVISION_CONFLICT');
  if(input.reviewedImpactSha256!==impact.impactSha256)
    throw new Error('CHARACTER_ARCHIVE_IMPACT_REVIEW_REQUIRED');
  assertNoBusyVisualJobs(root,impact.targets);
  return commitRegistry(root,current,{...current,characters:current.characters.map(c=>
    c.characterId===input.characterId?{...c,status:'ARCHIVED'}:c)},'archive:'+input.characterId);
}
export function saveTargetBinding(root:string,input:{
  targetKey:string;characters:string[];noRecurringCharacter:boolean;
  continuity:null|{sourceTargetKey:string;relation:Exclude<ContinuityRelation,'none'>};
  expectedRevision:number;
}){
  const current=readTargetBindings(root),registry=readCharacterRegistry(root);
  if(input.expectedRevision!==current.revision)throw new Error('CHARACTER_BINDINGS_REVISION_CONFLICT');
  const gallery=getNativeImageGallery('',root),target=gallery.targets.find(t=>t.key===input.targetKey);
  assertNoBusyVisualJobs(root,[input.targetKey]);
  if(!target||!target.creativeFingerprint||!gallery.token)
    throw new Error('CHARACTER_TARGET_CURRENT_DRAFT_REQUIRED');
  if(!Array.isArray(input.characters)||input.characters.some(c=>!validId(c))||
    new Set(input.characters).size!==input.characters.length||
    (input.noRecurringCharacter&&input.characters.length>0)||
    (!input.noRecurringCharacter&&input.characters.length===0))
    throw new Error('CHARACTER_MAPPING_CLASSIFICATION_REQUIRED');
  for(const id of input.characters)if(!registry.characters.some(c=>
    c.characterId===id&&c.status!=='ARCHIVED'))
    throw new Error('CHARACTER_MAPPING_UNKNOWN_ID');
  if(input.continuity){
    const rel=input.continuity;
    if(!['same_setup','match_subject','match_location','match_composition','graphic_sequence']
      .includes(rel.relation))throw new Error('CONTINUITY_RELATION_INVALID');
    const order=gallery.targets.map(t=>t.key),sourceIndex=order.indexOf(rel.sourceTargetKey);
    const targetIndex=order.indexOf(target.key);
    if(sourceIndex<0||sourceIndex>=targetIndex)
      throw new Error('CONTINUITY_SOURCE_NOT_EARLIER');
    let cursor=rel.sourceTargetKey;
    const visited=new Set<string>();
    const other=new Map(current.bindings.map(b=>[b.targetKey,b]));
    while(cursor){
      if(cursor===input.targetKey||visited.has(cursor))throw new Error('CONTINUITY_CYCLE');
      visited.add(cursor);
      cursor=other.get(cursor)?.continuity?.sourceTargetKey??'';
    }
  }
  const next:TargetIdentityBinding={
    targetKey:target.key,shotId:target.shotId,layerId:target.layerId,
    expectedPath:target.path,draftToken:gallery.token,
    creativeFingerprint:target.creativeFingerprint,
    characters:[...input.characters].sort(),noRecurringCharacter:input.noRecurringCharacter,
    continuity:input.continuity,confirmedByOwner:true,updatedAt:now()
  };
  return commitBindings(root,current,{...current,bindings:[
    ...current.bindings.filter(b=>b.targetKey!==target.key),next
  ]},'map:'+target.key);
}
export function previewCharacterImpact(root:string,characterId:string){
  const registry=readCharacterRegistry(root),store=readTargetBindings(root);
  if(!registry.characters.some(c=>c.characterId===characterId))
    throw new Error('CHARACTER_ID_NOT_FOUND');
  const affected=new Set(store.bindings.filter(b=>b.characters.includes(characterId))
    .map(b=>b.targetKey));
  let added=true;
  while(added){
    added=false;
    for(const b of store.bindings){
      if(b.continuity&&affected.has(b.continuity.sourceTargetKey)&&!affected.has(b.targetKey)){
        affected.add(b.targetKey);added=true;
      }
    }
  }
  const targets=[...affected].sort();
  const impactSha256=hash({projectId:registry.projectId,registryRevision:registry.revision,
    bindingRevision:store.revision,characterId,targets});
  return{characterId,targets,impactSha256};
}
