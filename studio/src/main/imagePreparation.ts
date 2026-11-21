/** Phase-1 Native image prompt projection. No paid requests and no Native mutation. */
import fs from 'node:fs';
import path from 'node:path';
import {getPendingMedia,nativeImageTargetIdentity,nativeImageTargetIdentityFromSnapshot,readNativeDraft} from './externalTasks.js';
import {imageRequirementsForTarget} from './imageRequirements.js';
import {createContinuityResolver} from './identity/continuityGraph.js';
import {contentHash} from './identity/contracts.js';
import {nativeSkillRoot,readState,resolveProjectFile,sha,atomicJson,strictJson} from './services.js';

type Row=Record<string,unknown>;
type Style='B1'|'B2'|'B3'|'B4';
type PreparedState='READY'|'NEEDS_OWNER_REVIEW'|'BLOCKED';
export interface ImageJobSpec {
  assetKey:string;targetKeys:string[];expectedPaths:string[];
  shotId:string;layerId:string;targetKey:string;path:string;assetKind:string;
  state:PreparedState;reason:string;prompt:string;promptSha256:string;
  effectivePrompt:string;effectivePromptSha256:string;
  sourceDescription:string;sourceLedger:string;sourceRows:unknown[];
  styleProfileRef:{id:Style;path:string;sha256:string};
  references:string[];styleAnchors:Array<{id:string;label:string;sha256:string}>;
  draftIdentity:{projectId:string;authorTaskId:string;token:string;revision:number;creativeFingerprint:string};
  occurrencesAtPath:number; ownerEdited:boolean;
  /** Current policy's mandatory reference snapshot; absent on legacy jobs. */
  identityBindingSnapshotSha?:string;identityTargetBindingSha?:string;
  identityApprovalSetSha?:string;identityStyleBibleSha?:string;
  identityRequiredReferences?:string[];
  identityOwnerReferences?:string[];
  identityCharacterIds?:string[];
  identityPreviousSourceSha?:string;
}
interface Candidate {
  key:string;kind:'image'|'sfx';path:string;shotId?:string;layerId?:string;
}
interface Pending {
  token:string;missing:Candidate[];after?:{shots?:unknown[]};assetNeeds?:unknown[];shotLedger?:unknown[];
}
interface StyleProfile {
  id:Style;path:string;sha256:string;guidance:string;
  anchors:Array<{id:string;label:string;sha256:string}>;
}
const object=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const field=(row:Row,names:string[]):string=>{
  for(const name of names){const value=row[name];if(typeof value==='string'&&value.trim())return value.trim();}
  return '';
};
const extract=(text:string,from:string,to:string):string=>{
  const start=text.indexOf(from);if(start<0)throw new Error('STYLE_AUTHORITY_SECTION_MISSING: '+from);
  const end=to?text.indexOf(to,start+from.length):-1;
  return text.slice(start+from.length,end>=0?end:undefined).trim();
};
const bullets=(section:string,count:number):string=>section.split('\n').filter(line=>line.startsWith('- ')).slice(0,count).join('\n');
export function loadImageStyleProfile(appPath:string,style:Style):StyleProfile{
  const skill=nativeSkillRoot(appPath).root;
  const names:Record<Exclude<Style,'B4'>,string>={
    B1:'references/b1-minimal-handdrawn.md',
    B2:'references/b2-colorful-handdrawn.md',
    B3:'references/b3-television.md'
  };
  if(style==='B4'){
    const manifestPath=path.join(skill,'assets/b4/approved-style.json');
    const authority=path.join(skill,'assets/b4/style-lock.txt');
    const manifest=strictJson(fs.readFileSync(manifestPath,'utf8')) as Row;
    // The published B4 manifest pins the LF-canonical text. Windows Git
    // checkouts may convert only line endings to CRLF; normalize that exact
    // representation before SHA verification, never bypass the pinned hash.
    const prompt=fs.readFileSync(authority,'utf8').replace(/\r\n/g,'\n');
    if(manifest.style!=='B4'||!object(manifest.prompt)||manifest.prompt.sha256!==sha(prompt))
      throw new Error('B4_STYLE_LOCK_INTEGRITY_FAILED');
    const references=manifest.references;
    if(!Array.isArray(references)||references.length!==5)throw new Error('B4_STYLE_REFERENCES_INVALID');
    const anchors=references.map(value=>{
      if(!object(value)||typeof value.id!=='string'||typeof value.path!=='string'||typeof value.sha256!=='string'||
        !/^[a-f0-9]{64}$/.test(value.sha256)||!/^[A-Za-z0-9_-]+\.png$/.test(value.path))
        throw new Error('B4_STYLE_REFERENCE_INVALID');
      const bytes=fs.readFileSync(path.join(skill,'assets/b4',value.path));
      if(sha(bytes)!==value.sha256)throw new Error('B4_STYLE_REFERENCE_SHA_MISMATCH: '+value.id);
      return{id:value.id,label:typeof value.use==='string'?value.use:value.id,sha256:value.sha256};
    });
    return{id:style,path:'assets/b4/style-lock.txt',
      sha256:sha(JSON.stringify({lockSha256:sha(prompt),manifestSha256:sha(fs.readFileSync(manifestPath)),anchors})),
      guidance:prompt.trim(),anchors};
  }
  const relative=names[style],file=fs.readFileSync(path.join(skill,relative),'utf8');
  let guidance='';
  if(style==='B1')guidance=bullets(extract(file,'## Visual language','## Stick-figure features'),3)+'\n'+
    bullets(extract(file,'## Stick-figure features and acting','## Rhythm and sound'),5);
  if(style==='B2')guidance=bullets(extract(file,'## Resolved defaults','## Scene and motion decisions'),2);
  if(style==='B3'){
    const paragraph=file.split('\n').find(line=>line.startsWith('The established direction is a dark field,'));
    if(!paragraph)throw new Error('B3_STYLE_AUTHORITY_SECTION_MISSING');
    guidance=paragraph;
  }
  if(!guidance.trim())throw new Error('STYLE_AUTHORITY_EMPTY');
  return{id:style,path:relative,sha256:sha(file),guidance,anchors:[]};
}
interface Override {creativeFingerprint:string;style:'B1'|'B2'|'B3'|'B4';styleSha256:string;prompt:string;references:string[]}
interface OverrideFile {schema:'storyboard-image-overrides-v1';projectId:string;items:Record<string,Override>}
const overridesFile=(root:string)=>resolveProjectFile(root,'.studio/storyboard/image-overrides-v1.json');
function readOverrides(root:string,projectId:string):OverrideFile{
  const file=overridesFile(root);
  if(!fs.existsSync(file))return{schema:'storyboard-image-overrides-v1',projectId,items:{}};
  const value=strictJson(fs.readFileSync(file,'utf8')) as OverrideFile;
  if(value.schema!=='storyboard-image-overrides-v1'||value.projectId!==projectId||!object(value.items))
    throw new Error('STORYBOARD_OVERRIDES_PROJECT_IDENTITY_INVALID');
  return value;
}
export function compileImageJobSpecs(input:{
  projectId:string;style:Style;authorTaskId:string;draftRevision:number;token:string;
  pending:Pending;profile:StyleProfile;fingerprints:Record<string,string>;
  overrides?:Record<string,Override>
}):ImageJobSpec[]{
  const {projectId,style,authorTaskId,draftRevision,token,pending,profile,fingerprints}=input;
  const rows=pending.assetNeeds??[],ledgers=pending.shotLedger??[];
  const targets=pending.missing.filter(item=>item.kind==='image');
  const paths=new Map<string,number>();
  for(const item of targets)paths.set(item.path,(paths.get(item.path)??0)+1);
  const shots=Array.isArray(pending.after?.shots)?pending.after!.shots!:[];
  return targets.map(target=>{
    const fingerprint=fingerprints[target.key]??'';
    const shot=shots.find(v=>object(v)&&v.id===target.shotId);
    const layerExists=object(shot)&&Array.isArray(shot.layers)&&
      findExactLayer(shot.layers,target.layerId!,target.path);
    const requirements=imageRequirementsForTarget(rows,{
      shotId:target.shotId??'',layerId:target.layerId??'',path:target.path
    });
    const matching=requirements.matching,globals=requirements.global;
    const conflictingPath=requirements.conflicting.length>0;
    const descriptions=[...new Set(matching.map(row=>row.description).filter(Boolean))];
    // Global fields are instructions, never invented per-target descriptions.
    // Each row is rendered separately in source order and remains in provenance.
    const globalCreative=globals.map(row=>[
      ...(row.description?['CONTENT / DIRECTIVE',row.description]:[]),
      ...(row.orientation?['OUTPUT / ORIENTATION',row.orientation]:[]),
      ...(row.continuity?['CONTINUITY',row.continuity]:[]),
      ...(row.assetKind?['ASSET KIND',row.assetKind]:[])
    ]);
    const missingGlobalInstruction=globalCreative.some(parts=>parts.length===0);
    const globalSections=globalCreative.map(parts=>
      ['EXPLICIT GLOBAL IMAGE INSTRUCTION [Native asset_needs]',...parts].join('\n'));
    const declaredOrientations=[
      ...matching.map(row=>row.orientation).filter(Boolean),
      ...globals.map(row=>row.orientation).filter(Boolean)
    ];
    const declaredKinds=[
      ...matching.map(row=>row.assetKind).filter(Boolean),
      ...globals.map(row=>row.assetKind).filter(Boolean)
    ];
    const globalFieldConflict=globals.length>0&&(
      new Set(declaredOrientations).size>1||
      new Set(declaredKinds).size>1
    );
    const dimensions=[...new Set(matching.map(row=>row.orientation).filter(Boolean))];
    const continuity=[...new Set(matching.map(row=>row.continuity).filter(Boolean))];
    const ledger=ledgers.find(value=>object(value)&&(value.shot_id===target.shotId||value.shotId===target.shotId));
    const composition=object(ledger)?field(ledger,['composition']):'';
    const sourceDescription=descriptions.length===1?descriptions[0]:'';
    let state:PreparedState='READY',reason='';
    if(!layerExists||!fingerprint||!target.shotId||!target.layerId){state='BLOCKED';reason='Exact current Shot/Layer/path or creative fingerprint is invalid.';}
    else if(conflictingPath){state='BLOCKED';reason='Conflicting Native expected_path for the exact Shot/Layer; targeted Native Correct required.';}
    else if(missingGlobalInstruction){
      state='BLOCKED';reason='An explicitly global asset_needs row has no expressible creative instruction. Correct the Native Author source; this global fingerprint cannot be silently omitted from a prompt.';
    }
    else if(globalFieldConflict){
      state='BLOCKED';reason='Conflicting global versus target-specific output orientation or asset kind in Native asset_needs. Correct the source before image generation.';
    }
    else if(requirements.partial.length){state='NEEDS_OWNER_REVIEW';reason='Partial legacy Shot/Layer ownership cannot identify this image target safely. Specify exact Shot/Layer/path or one shared exact path description.';}
    else if(matching.length===0){state='NEEDS_OWNER_REVIEW';reason='No exact matching image description in asset_needs (target or shared exact path).';}
    else if(descriptions.length===0){state='NEEDS_OWNER_REVIEW';reason='Matching asset_needs has no explicit image content/description.';}
    else if(descriptions.length!==1||dimensions.length>1||continuity.length>1){
      state='NEEDS_OWNER_REVIEW';reason='Conflicting descriptions/orientations/continuity for this exact target.';
    }
    const sourceLedger=composition;
    const declaredKind=matching.map(row=>row.assetKind).find(value=>['background','character','pose','prop','object','other'].includes(value))??'other';
    const sections=[
      'APPROVED MODE B STYLE '+style+' ['+profile.path+'; SHA256 '+profile.sha256+']',
      profile.guidance,
      ...globalSections,
      'EXACT IMAGE CONTENT [Native asset_needs; '+target.shotId+'/'+target.layerId+'; '+target.path+']',
      sourceDescription,
      ...(dimensions.length===1?['ASSET ORIENTATION / OUTPUT REQUIREMENT',dimensions[0]]:[]),
      ...(continuity.length===1?['ASSET CONTINUITY REQUIREMENT',continuity[0]]:[]),
      ...(sourceLedger?['RELEVANT SHOT COMPOSITION [shot_ledger]',sourceLedger]:[])
    ];
    const computed=state==='READY'?sections.join('\n\n').trim():'';
    const owner=input.overrides?.[target.key];
    const validOwner=owner?.creativeFingerprint===fingerprint&&owner.style===style&&owner.styleSha256===profile.sha256&&
      typeof owner.prompt==='string'&&owner.prompt.trim().length>=12;
    // An owner override must not silently erase authoritative global source
    // requirements. Retain the stored owner text, add any missing global
    // directives, and retain style authority in this effective prepared prompt.
    const ownerText=validOwner?owner.prompt.trim():'';
    // Requiring the COMPLETE compiled block avoids treating a quoted fragment
    // (including a negated fragment) as evidence that a global instruction is
    // present. Existing complete compiled owner prompts are not duplicated.
    const missingOwnerGlobals=validOwner?
      globalSections.filter(section=>!ownerText.includes(section)):[];
    // Style authority is a separate immutable compiler section, never an
    // editable image description. Every owner override retains B1–B4 guidance
    // even when Native asset_needs contains no global rows.
    const authoritativeStyle='APPROVED MODE B STYLE '+style+' ['+
      profile.path+'; SHA256 '+profile.sha256+']\n\n'+profile.guidance;
    // Keep the owner-edited description as the editable field. Compile the
    // provider payload separately: owner text cannot delete style authority.
    // Both hashes are retained so the submitted provider prompt is auditable.
    const effectivePrompt=validOwner?[
      authoritativeStyle,
      ownerText.includes(authoritativeStyle)?
        ownerText.replace(authoritativeStyle,'').trim():ownerText,
      ...missingOwnerGlobals
    ].filter(Boolean).join('\n\n'):computed;
    // Legacy canonical behavior retains global directives in the visible
    // prepared prompt. When there are no global source rows, the owner-edited
    // description remains exactly as entered. Provider always gets the
    // independently composed effectivePrompt in both cases.
    const prompt=validOwner?(globals.length?effectivePrompt:ownerText):computed;
    // Owner edits can resolve a missing/conflicting description, but never a
    // structural blocker or a missing/integrity-failed style authority.
    if(validOwner&&state==='NEEDS_OWNER_REVIEW'){state='READY';reason='Owner reviewed and supplied this exact target prompt.';}
    if(style==='B4'&&state==='READY'){
      const references=validOwner&&Array.isArray(owner?.references)?owner.references:[];
      if(!references.some(value=>profile.anchors.some(anchor=>value==='@modeb/b4/'+anchor.id))){
        state='NEEDS_OWNER_REVIEW';reason='B4 requires an explicit approved style-lock reference. Select a verified installed B4 anchor.';
      }
    }
    return{
      assetKey:target.key,targetKeys:[target.key],expectedPaths:[target.path],
      targetKey:target.key,shotId:target.shotId??'',layerId:target.layerId??'',path:target.path,assetKind:declaredKind,
      state,reason,prompt,promptSha256:prompt?sha(prompt):'',
      effectivePrompt,effectivePromptSha256:effectivePrompt?sha(effectivePrompt):'',
      sourceDescription,sourceLedger,sourceRows:requirements.effective.map(row=>row.source),
      styleProfileRef:{id:style,path:profile.path,sha256:profile.sha256},
      references:validOwner&&Array.isArray(owner?.references)?owner.references:[],
      styleAnchors:profile.anchors,
      draftIdentity:{projectId,authorTaskId,token,revision:draftRevision,creativeFingerprint:fingerprint},
      occurrencesAtPath:paths.get(target.path)??1,ownerEdited:Boolean(validOwner)
    };
  });
}
function findExactLayer(layers:unknown[],layerId:string,pathValue:string):boolean{
  for(const value of layers){
    if(!object(value))continue;
    if(value.id===layerId&&value.type==='image'&&value.path===pathValue)return true;
    if(Array.isArray(value.children)&&findExactLayer(value.children,layerId,pathValue))return true;
  }
  return false;
}
/** Canonical refs are compiler-owned; owner edits only supplemental refs.
 * Never mutate legacy specs or silently remove a required reference. */
function withUpstreamIdentity(appPath:string,root:string,item:ImageJobSpec,
  preverified?:ReturnType<typeof createContinuityResolver>):ImageJobSpec{
  if(!preverified&&readState(root).identityPolicy!=='v1')return item;
  try{
    const resolver=preverified??createContinuityResolver(appPath,root);
    const binding=resolver.getBinding(item.targetKey);
    const previous=resolver.resolve(item.targetKey);
    const canonical=binding.canonicalAnchors;
    const ownerRefs=[...item.references];
    const lockedStyle=ownerRefs.filter(r=>r.startsWith('@modeb/b4/'));
    const supplements=ownerRefs.filter(r=>!r.startsWith('@modeb/b4/'));
    // One identical SHA cannot be claimed as two different character identities.
    if(new Set(canonical.map(anchor=>anchor.sha256)).size!==canonical.length)
      throw Error('CHARACTER_REFERENCE_IDENTITY_COLLISION');
    const mandatory=[...canonical.map(anchor=>anchor.path),...(previous?[previous.path]:[])];
    // A canonical image and previous frame may have different project paths
    // but identical verified pixels. Send those bytes only once; retain BOTH
    // provenance branches in the frozen binding digest below. Never merge two
    // distinct character IDs even when their file SHA accidentally collides.
    const duplicatePrevious=Boolean(previous&&
      canonical.some(anchor=>anchor.sha256===previous.sha256));
    const uniqueRequired=[...canonical.map(anchor=>anchor.path),
      ...(previous&&!duplicatePrevious?[previous.path]:[])];
    const ordered=[...lockedStyle,...uniqueRequired,...supplements.filter(path=>
      !mandatory.includes(path))];
    const paths=[...new Set(ordered)];
    if(paths.length>8)throw Error('REFERENCE_BUDGET_EXCEEDED: '+paths.length+'/8');
    // Native Correct can advance the DRAFT container revision without
    // changing the exact target's creative fingerprint or canonical inputs.
    // Pin only the target-specific evidence, never the container revision.
    const {revision:_draftContainerRevision,...stableDraftIdentity}=item.draftIdentity;
    void _draftContainerRevision;
    const frozen={targetKey:item.targetKey,
      draftIdentity:stableDraftIdentity,upstreamSnapshotSha:binding.upstreamSnapshotSha,
      targetBindingSha:binding.targetBindingSha,
      characterIds:binding.characterIds,approvalSetSha:binding.approvalSetSha,
      styleBibleSha:binding.styleBibleSha,
      canonical:canonical.map(anchor=>({
        charId:anchor.charId,definitionSha:anchor.sourceDefinitionHash,
        mediaSha:anchor.sha256,rightsSha:anchor.rightsSha256,path:anchor.path
      })),
      previous:previous?{source:previous.sourceTargetKey,sha:previous.sha256,
        job:previous.sourceJobId,binding:previous.sourceBindingSha,
        dependency:previous.dependencySha}:null,
      ownerRefs};
    const identityBindingSnapshotSha=contentHash(frozen);
    const appendix=[
      'APPROVED F24 CHARACTER IMAGE BINDINGS — immutable canonical image bytes',
      ...canonical.map(anchor=>'Character '+anchor.charId+
        ': attached approved canonical reference SHA '+anchor.sha256+
        '; definition SHA '+anchor.sourceDefinitionHash),
      ...(previous?['APPROVED PREVIOUS-IMAGE CONTINUITY ['+previous.relation+
        '] from '+previous.sourceTargetKey+'; image SHA '+previous.sha256+
        '. Match only this specified transient relation, never override canonical character identity.']:[]),
      'Do not invent character appearance, cast, props or media rights.'
    ].join('\n');
    const effectivePrompt=item.effectivePrompt?
      item.effectivePrompt+'\n\n'+appendix:'';
    return{...item,references:paths,
      identityBindingSnapshotSha,identityTargetBindingSha:binding.targetBindingSha,
      identityApprovalSetSha:binding.approvalSetSha,
      identityStyleBibleSha:binding.styleBibleSha,
      identityRequiredReferences:mandatory,identityOwnerReferences:ownerRefs,
      identityCharacterIds:binding.characterIds,
      identityPreviousSourceSha:previous?.dependencySha,
      effectivePrompt,effectivePromptSha256:effectivePrompt?sha(effectivePrompt):''};
  }catch(error){
    const reason=error instanceof Error?error.message:'IDENTITY_REFERENCE_UNVERIFIED';
    return{...item,state:'BLOCKED',reason,identityRequiredReferences:[],
      identityCharacterIds:[],identityOwnerReferences:[...item.references],
      effectivePrompt:'',effectivePromptSha256:''};
  }
}
export function prepareNativeImages(appPath:string,root:string,persist=false){
  const state=readState(root),draft=readNativeDraft(root,state),pending=getPendingMedia(appPath,root);
  if(!draft||!pending||draft.token!==pending.token)
    return{status:'NO_NATIVE_DRAFT' as const,style:state.project.style,revision:0,token:'',jobs:[] as ImageJobSpec[],shotCount:0,imageOccurrences:0,uniquePaths:0};
  const style=state.project.style as Style,overrides=readOverrides(root,state.project.id);
  const image=pending.missing.filter(item=>item.kind==='image');
  const fingerprints:Record<string,string>={};
  for(const target of image){
    try{fingerprints[target.key]=nativeImageTargetIdentityFromSnapshot(state,draft,target.key).fingerprint;}
    catch{fingerprints[target.key]='';}
  }
  const profile=loadImageStyleProfile(appPath,style);
  const resolver=state.identityPolicy==='v1'?
    createContinuityResolver(appPath,root):undefined;
  const jobs=compileImageJobSpecs({projectId:state.project.id,style,authorTaskId:draft.authorTaskId,draftRevision:draft.revision,
    token:draft.token,pending,profile,fingerprints,overrides:overrides.items})
    .map(job=>resolver?withUpstreamIdentity(appPath,root,job,resolver):job);
  const result={status:'PRE_MEDIA_PROJECTION' as const,style,revision:draft.revision,token:draft.token,
    jobs,shotCount:Array.isArray(pending.after?.shots)?pending.after!.shots!.length:0,imageOccurrences:image.length,
    uniquePaths:new Set(image.map(target=>target.path)).size};
  if(persist)atomicJson(resolveProjectFile(root,'.studio/storyboard/prepared-image-jobs-v1.json'),{
    schema:'storyboard-prepared-image-jobs-v1',projectId:state.project.id,authorTaskId:draft.authorTaskId,
    draftToken:draft.token,artifactSha256:draft.sha256,
    preparedAt:new Date().toISOString(),...result
  });
  return result;
}
/**
 * Resolve only ONE frozen target for paid-request preflight.
 * Full Storyboard preparation remains available for the UI, but a single
 * Generate must not reparse/fingerprint all 100–200 image occurrences.
 */
export function prepareNativeImageTarget(appPath:string,root:string,targetKey:string):ImageJobSpec|null{
  const state=readState(root),draft=readNativeDraft(root,state);
  if(!draft)return null;
  const pending=getPendingMedia(appPath,root);
  if(!pending||pending.token!==draft.token)return null;
  const target=pending.missing.find(item=>item.key===targetKey&&item.kind==='image');
  if(!target)return null;
  let fingerprint='';
  try{fingerprint=nativeImageTargetIdentityFromSnapshot(state,draft,targetKey).fingerprint;}
  catch{return null;}
  const style=state.project.style as Style,profile=loadImageStyleProfile(appPath,style);
  const overrides=readOverrides(root,state.project.id);
  const selectedPending={...pending,missing:[target]};
  const candidate=compileImageJobSpecs({
    projectId:state.project.id,style,authorTaskId:draft.authorTaskId,
    draftRevision:draft.revision,token:draft.token,pending:selectedPending,profile,
    fingerprints:{[targetKey]:fingerprint},overrides:overrides.items
  })[0];
  return candidate?withUpstreamIdentity(appPath,root,candidate):null;
}
export function saveNativeImagePrompt(appPath:string,root:string,input:{
  targetKey:string;fingerprint:string;styleSha256?:string;prompt:string;references:string[]
}){
  if(!input||typeof input.targetKey!=='string'||typeof input.fingerprint!=='string'||
    typeof input.prompt!=='string'||input.prompt.length>18000||
    !Array.isArray(input.references)||input.references.length>8||
    input.references.some(x=>typeof x!=='string'))
    throw new Error('STORYBOARD_OVERRIDE_INVALID');
  const identity=nativeImageTargetIdentity(root,input.targetKey);
  if(identity.fingerprint!==input.fingerprint)throw new Error('STORYBOARD_OVERRIDE_STALE_TARGET');
  const state=readState(root),file=readOverrides(root,state.project.id);
  const style=state.project.style as Style,profile=loadImageStyleProfile(appPath,style);
  if(input.styleSha256!==undefined&&input.styleSha256!==profile.sha256)
    throw new Error('STORYBOARD_OVERRIDE_STALE_STYLE_AUTHORITY');
  file.items[input.targetKey]={creativeFingerprint:identity.fingerprint,style,styleSha256:profile.sha256,
    prompt:input.prompt.trim(),references:[...input.references]};
  atomicJson(overridesFile(root),file);
  return prepareNativeImages(appPath,root,true);
}
