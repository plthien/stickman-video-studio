/** F24 authoritative reference planner. No API, paid POST, inferred actor or image mutation. */
import fs from 'node:fs';
import {getNativeImageGallery} from './externalTasks.js';
import {readState,resolveProjectFile,sha,strictJson} from './services.js';
import {readCharacterRegistry,readTargetBindings,verifyIdentityMedia,
  type IdentityMime,type TargetIdentityBinding} from './visualIdentityRegistry.js';

export type ReferenceReadiness='READY'|'NEEDS_MAPPING_REVIEW'|
  'CHARACTER_REFERENCE_REQUIRED'|'CONTINUITY_SOURCE_NOT_READY'|
  'REFERENCE_STALE'|'REFERENCE_BUDGET_EXCEEDED';
export interface ResolvedReference {
  kind:'character'|'previous_image'|'owner_manual';
  anchorId:string;sourcePath:string;sha256:string;mime:IdentityMime;
  sourceIdentity:string;required:boolean;rightsSha256:string;
}
export interface ReferencePlan{
  enabled:boolean;targetKey:string;characterIds:string[];
  references:ResolvedReference[];referenceSetSha256:string;
  readiness:ReferenceReadiness;blockers:string[];
  sourceSnapshotSha256?:string;
  effectivePromptAppendix:string;orderedPaths:string[];
}
const hash=(v:unknown)=>sha(JSON.stringify(v));
const FAIL=(msg:ReferenceReadiness)=>{throw new Error(msg)};
const current=(root:string,key:string)=>{
  const gallery=getNativeImageGallery('',root);
  const target=gallery.targets.find(t=>t.key===key);
  if(!target||!target.creativeFingerprint||!gallery.token)
    throw new Error('CHARACTER_TARGET_CURRENT_DRAFT_REQUIRED');
  const binding=readTargetBindings(root).bindings.find(b=>b.targetKey===key);
  if(!binding||binding.draftToken!==gallery.token||
    binding.creativeFingerprint!==target.creativeFingerprint||
    binding.shotId!==target.shotId||binding.layerId!==target.layerId||
    binding.expectedPath!==target.path)
    FAIL('NEEDS_MAPPING_REVIEW');
  return{gallery,target,binding:binding as TargetIdentityBinding};
};
/** Source owner extras and B4 style pins are frozen in project-local overrides.
 * An old-token or changed-creative override cannot authorize current continuity. */
export function currentSourceOwnerReferences(root:string,key:string):string[]{
  const filename=resolveProjectFile(root,'.studio/storyboard/image-overrides-v1.json');
  if(!fs.existsSync(filename))return[];
  const value=strictJson(fs.readFileSync(filename,'utf8')) as {
    schema?:string;projectId?:string;
    items?:Record<string,{creativeFingerprint?:string;style?:string;references?:unknown}>
  };
  if(value.schema!=='storyboard-image-overrides-v1'||
    value.projectId!==readState(root).project.id)return[];
  const item=value.items?.[key];
  const current=getNativeImageGallery('',root).targets.find(t=>t.key===key);
  if(!item||item.creativeFingerprint!==current?.creativeFingerprint||
    item.style!==readState(root).project.style||
    !Array.isArray(item.references)||item.references.some(r=>typeof r!=='string'))
    return[];
  return item.references as string[];
}
/** Verify the source is not itself stale under a newly changed ancestor/master.
 * Read-only, no Native binding mutations or paid generation. */
function approvedSourceCurrent(root:string,key:string,sourceSha:string):boolean{
  const ancestor=resolveVisualReferences(root,key,currentSourceOwnerReferences(root,key));
  if(!ancestor.enabled||ancestor.readiness!=='READY')return false;
  const file=resolveProjectFile(root,'.studio/visual-identity/visual-review-v1.json');
  if(!fs.existsSync(file))return false;
  const value=strictJson(fs.readFileSync(file,'utf8')) as {
    projectId?:string;attestations?:Array<{
      targetKey:string;sha256:string;referenceSetSha256:string;
      kind:string;jobId?:string
    }>
  };
  if(value.projectId!==readState(root).project.id||!Array.isArray(value.attestations))
    return false;
  return value.attestations.some(row=>{
    if(row.targetKey!==key||row.sha256!==sourceSha||
      row.referenceSetSha256!==ancestor.referenceSetSha256)return false;
    if(row.kind==='BOUND')return true;
    if(row.kind!=='CANDIDATE'||!row.jobId||!/^[a-f0-9-]{36}$/i.test(row.jobId))
      return false;
    const jobFile=resolveProjectFile(root,'.studio/glabs/jobs/'+row.jobId+'.json');
    if(!fs.existsSync(jobFile))return false;
    const job=strictJson(fs.readFileSync(jobFile,'utf8')) as Record<string,unknown>;
    return job.status==='APPROVED'&&job.targetKey===key&&
      (job.approved as {sha256?:string}|undefined)?.sha256===sourceSha&&
      job.referenceSetSha256===row.referenceSetSha256;
  });
}
export function resolveVisualReferences(root:string,targetKey:string,
  ownerRefs:string[]=currentSourceOwnerReferences(root,targetKey)):ReferencePlan{
  const registry=readCharacterRegistry(root);
  const base:ReferencePlan={enabled:registry.strict,targetKey,characterIds:[],
    references:[],referenceSetSha256:'',readiness:'READY',blockers:[],
    effectivePromptAppendix:'',orderedPaths:[...ownerRefs]};
  if(!registry.strict)return base;
  const refs:ResolvedReference[]=[];
  let readiness:ReferenceReadiness='READY';
  const blockers:string[]=[];
  const block=(status:ReferenceReadiness)=>{
    if(readiness==='READY')readiness=status;
    if(!blockers.includes(status))blockers.push(status);
  };
  let matched:ReturnType<typeof current>|null=null;
  try{matched=current(root,targetKey);}catch{block('NEEDS_MAPPING_REVIEW');}
  if(!matched)return{...base,readiness,blockers,referenceSetSha256:hash([])};
  const {gallery,binding}=matched;
  if(!binding.noRecurringCharacter&&!binding.characters.length)block('NEEDS_MAPPING_REVIEW');
  const state=readState(root);
  for(const id of [...binding.characters].sort()){
    const character=registry.characters.find(item=>item.characterId===id);
    if(!character||character.status!=='APPROVED'||!character.canonicalReferenceId){
      block('CHARACTER_REFERENCE_REQUIRED');continue;
    }
    const source=character.references.find(r=>r.referenceId===character.canonicalReferenceId);
    if(!source){block('CHARACTER_REFERENCE_REQUIRED');continue;}
    try{
      const verified=verifyIdentityMedia(root,source.relativePath,source.sha256);
      const ledger=state.media?.find(m=>m.path===source.relativePath&&
        m.sha256===source.sha256&&m.kind==='image'&&m.rights?.trim()&&
        sha(m.rights)===source.rightsLedgerKey);
      if(!ledger||!state.imports?.includes(source.relativePath)||verified.mime!==source.mime)
        throw new Error('REFERENCE_STALE');
      refs.push({kind:'character',anchorId:id,sourcePath:source.relativePath,
        sha256:source.sha256,mime:source.mime,sourceIdentity:
          id+'@'+source.sha256+':'+source.rightsLedgerKey,
        rightsSha256:source.rightsLedgerKey,required:true});
    }catch{block('REFERENCE_STALE');}
  }
  let sourceSnapshotSha256:string|undefined;
  if(binding.continuity){
    const {sourceTargetKey,relation}=binding.continuity;
    const order=gallery.targets.map(item=>item.key);
    const source=gallery.targets.find(t=>t.key===sourceTargetKey);
    if(!source||!source.creativeFingerprint||order.indexOf(source.key)>=order.indexOf(targetKey)){
      block('CONTINUITY_SOURCE_NOT_READY');
    }else{
      const sourceBinding=readTargetBindings(root).bindings.find(t=>t.targetKey===source.key);
      if(!sourceBinding||sourceBinding.draftToken!==gallery.token||
        sourceBinding.creativeFingerprint!==source.creativeFingerprint||
        !source.fulfilled||!source.boundSha256){
        block('CONTINUITY_SOURCE_NOT_READY');
      }else{
        try{
          const verified=verifyIdentityMedia(root,source.boundPath,source.boundSha256);
          const sourceLedger=state.media?.find(m=>m.kind==='image'&&
            m.path===source.boundPath&&m.sha256===source.boundSha256&&
            m.shotId===source.shotId&&m.layerId===source.layerId&&m.rights?.trim());
          if(!sourceLedger||!approvedSourceCurrent(root,source.key,verified.sha256))
            throw new Error('CONTINUITY_SOURCE_NOT_READY');
          // Published/old-token G-Labs history does not replace this exact current Native binding.
          const snapshot={sourceTargetKey,relation,token:gallery.token,
            creativeFingerprint:source.creativeFingerprint,path:source.boundPath,
            sha256:verified.sha256,rightsSha256:sha(sourceLedger.rights)};
          sourceSnapshotSha256=hash(snapshot);
          refs.push({kind:'previous_image',anchorId:sourceTargetKey,
            sourcePath:source.boundPath,sha256:verified.sha256,mime:verified.mime,
            sourceIdentity:sourceSnapshotSha256,rightsSha256:sha(sourceLedger.rights),
            required:true});
        }catch{block('CONTINUITY_SOURCE_NOT_READY');}
      }
    }
  }
  // Manual extras are optional but always verified and always counted.
  for(const relative of ownerRefs){
    if(relative.startsWith('@modeb/b4/'))continue; // Existing pinned-style resolver owns these.
    try{
      const verified=verifyIdentityMedia(root,relative);
      const ledger=state.media?.find(m=>m.kind==='image'&&m.path===relative&&
        m.sha256===verified.sha256&&m.rights?.trim());
      if(!ledger)throw new Error('REFERENCE_STALE');
      refs.push({kind:'owner_manual',anchorId:relative,sourcePath:relative,
        sha256:verified.sha256,mime:verified.mime,sourceIdentity:hash({
          path:relative,sha256:verified.sha256,rights:ledger.rights
        }),rightsSha256:sha(ledger.rights),required:false});
    }catch{block('REFERENCE_STALE');}
  }
  const deduped:ResolvedReference[]=[];
  for(const ref of refs){
    if(!deduped.some(existing=>existing.sourcePath===ref.sourcePath&&
      existing.sha256===ref.sha256))deduped.push(ref);
  }
  const orderedPaths=[...ownerRefs.filter(ref=>ref.startsWith('@modeb/b4/')),
    ...deduped.map(ref=>ref.sourcePath)];
  if(orderedPaths.length>8)block('REFERENCE_BUDGET_EXCEEDED');
  // Do not silently omit any required image; provider budget is additionally verified
  // against exact base64 bytes by G-Labs before it sends its paid POST.
  const referenceSetSha256=hash({targetKey,token:gallery.token,
    creative:matched.target.creativeFingerprint,references:refs,
    styleRefs:ownerRefs.filter(ref=>ref.startsWith('@modeb/b4/')),
    sourceSnapshotSha256});
  const effectivePromptAppendix=binding.characters.length?[
    'CANONICAL CHARACTER IDENTITY REFERENCES [owner-approved image bytes]',
    ...binding.characters.map(id=>'Character '+id+': use its verified attached canonical image as the appearance authority.'),
    'Do not invent facial features, clothing, body proportions or identity traits.'
  ].join('\n'):'';
  const relationDirective:Record<Exclude<import('./visualIdentityRegistry.js').ContinuityRelation,'none'>,string>={
    same_setup:'Keep approved temporary setup and environmental state where consistent with this exact Native action.',
    match_subject:'Match only the expressly linked subject; do not carry incidental actors, props or text.',
    match_location:'Match the verified location, not unrelated character poses or foreground objects.',
    match_composition:'Preserve applicable layout geometry only; do not override current Shot requirements.',
    graphic_sequence:'Follow the approved graphic progression only where compatible with the current source action.'
  };
  const continuityPrompt=binding.continuity?
    '\n\nAPPROVED PREVIOUS IMAGE CONTINUITY ['+binding.continuity.relation+
    ']\nSource target '+binding.continuity.sourceTargetKey+'\n'+
    relationDirective[binding.continuity.relation]+
    '\nCanonical character references control identity. Never copy unrelated people, objects, captions or appearance traits.':'';
  return{enabled:true,targetKey,characterIds:[...binding.characters],
    references:refs,referenceSetSha256,readiness,blockers,
    sourceSnapshotSha256,effectivePromptAppendix:effectivePromptAppendix+continuityPrompt,
    orderedPaths};
}
export function assertVisualReferenceCurrent(root:string,input:{
  targetKey:string;referenceSetSha256?:string;
  ownerReferences:string[];compiledReferences:string[];
}){
  const plan=resolveVisualReferences(root,input.targetKey,input.ownerReferences);
  if(!plan.enabled){
    if(input.referenceSetSha256)throw new Error('REFERENCE_STALE');
    return;
  }
  if(plan.readiness!=='READY')throw new Error(plan.readiness);
  if(!input.referenceSetSha256||input.referenceSetSha256!==plan.referenceSetSha256)
    throw new Error('REFERENCE_STALE');
  if(JSON.stringify(plan.orderedPaths)!==JSON.stringify(input.compiledReferences))
    throw new Error('REFERENCE_STALE');
}
export function characterCoverage(root:string){
  const registry=readCharacterRegistry(root),gallery=getNativeImageGallery('',root);
  const result=gallery.targets.map(t=>{
    const mapping=readTargetBindings(root).bindings.find(b=>b.targetKey===t.key);
    const current=!!mapping&&mapping.draftToken===gallery.token&&
      mapping.creativeFingerprint===t.creativeFingerprint;
    return{...t,mappingCurrent:current,
      characters:current?mapping.characters:[],
      noRecurringCharacter:current?mapping.noRecurringCharacter:false,
      continuity:current?mapping.continuity:null,
      readiness:registry.strict?
        resolveVisualReferences(root,t.key).readiness:'READY' as ReferenceReadiness};
  });
  return{strict:registry.strict,registryRevision:registry.revision,targets:result,
    mapped:result.filter(x=>x.mappingCurrent).length,
    needsReview:result.filter(x=>!x.mappingCurrent).length,
    blocked:result.filter(x=>x.readiness!=='READY').length};
}
