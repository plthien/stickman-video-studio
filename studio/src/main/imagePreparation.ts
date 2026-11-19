/** Phase-1 Native image prompt projection. No paid requests and no Native mutation. */
import fs from 'node:fs';
import path from 'node:path';
import {getPendingMedia,nativeImageTargetIdentity,readNativeDraft} from './externalTasks.js';
import {nativeSkillRoot,readState,resolveProjectFile,sha,atomicJson,strictJson} from './services.js';

type Row=Record<string,unknown>;
type Style='B1'|'B2'|'B3'|'B4';
type PreparedState='READY'|'NEEDS_OWNER_REVIEW'|'BLOCKED';
export interface ImageJobSpec {
  assetKey:string;targetKeys:string[];expectedPaths:string[];
  shotId:string;layerId:string;targetKey:string;path:string;assetKind:string;
  state:PreparedState;reason:string;prompt:string;promptSha256:string;
  sourceDescription:string;sourceLedger:string;sourceRows:unknown[];
  styleProfileRef:{id:Style;path:string;sha256:string};
  references:string[];styleAnchors:Array<{id:string;label:string;sha256:string}>;
  draftIdentity:{projectId:string;authorTaskId:string;token:string;revision:number;creativeFingerprint:string};
  occurrencesAtPath:number; ownerEdited:boolean;
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
  for(const name of names){const v=row[name];if(typeof v==='string'&&v.trim())return v.trim();}
  return '';
};
const idOf=(row:Row,parts:string[])=>field(row,parts);
const needFields=(value:unknown):Row|null=>{
  if(object(value))return value;
  if(typeof value!=='string'||!value.startsWith('MISSING_REQUIRED_VISUAL |'))return null;
  // Documented original Native legacy serialization: pipe-separated key=value,
  // with content, orientation, shot_use and continuity fields.
  const parsed:Row={};
  for(const segment of value.split(/\s+\|\s+/).slice(1)){
    const index=segment.indexOf('=');
    if(index<1)continue;
    const key=segment.slice(0,index).trim(),text=segment.slice(index+1).trim();
    if(['shot_id','layer_id','expected_path','path','content','orientation','shot_use','continuity','availability','asset_kind'].includes(key))
      parsed[key]=text;
  }
  parsed.__legacy=value;
  return parsed;
};
const targetMatch=(row:Row,target:Candidate,uniquePaths:Map<string,number>):boolean=>{
  const shot=idOf(row,['shot_id','shotId','target_shot_id','targetShotId']);
  const layer=idOf(row,['layer_id','layerId','target_layer_id','targetLayerId']);
  const expected=idOf(row,['expected_path','expectedPath','asset_path','assetPath','path']);
  if(expected&&expected!==target.path)return false;
  if(shot&&shot!==target.shotId)return false;
  if(layer&&layer!==target.layerId)return false;
  // Accept exact Shot+Layer ownership even if the old row omitted its path.
  if(shot&&layer)return true;
  // Path-only legacy is eligible ONLY if the expected path has one image occurrence.
  return Boolean(expected&&!shot&&!layer&&uniquePaths.get(expected)===1);
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
    const prompt=fs.readFileSync(authority,'utf8');
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
    return{id:style,path:'assets/b4/style-lock.txt',sha256:sha(prompt),guidance:prompt.trim(),anchors};
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
interface Override {creativeFingerprint:string;prompt:string;references:string[]}
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
  const targets=pending.missing.filter(item=>item.kind==='image'&&item.shotId&&item.layerId);
  const paths=new Map<string,number>();
  for(const item of targets)paths.set(item.path,(paths.get(item.path)??0)+1);
  const shots=Array.isArray(pending.after?.shots)?pending.after!.shots!:[];
  return targets.map(target=>{
    const fingerprint=fingerprints[target.key]??'';
    const shot=shots.find(v=>object(v)&&v.id===target.shotId);
    const layerExists=object(shot)&&Array.isArray(shot.layers)&&
      findExactLayer(shot.layers,target.layerId!,target.path);
    const matching=rows.filter(row=>{const fields=needFields(row);return fields?targetMatch(fields,target,paths):false;});
    const parsed=matching.map(needFields).filter((value):value is Row=>Boolean(value));
    const descriptions=[...new Set(parsed.map(row=>field(row,['content','image_description','imageDescription','asset_description','assetDescription','description'])).filter(Boolean))];
    const dimensions=[...new Set(parsed.map(row=>field(row,['orientation','framing','canvas'])).filter(Boolean))];
    const continuity=[...new Set(parsed.map(row=>field(row,['continuity','visual_constraints','visualConstraints'])).filter(Boolean))];
    const ledger=ledgers.find(value=>object(value)&&(value.shot_id===target.shotId||value.shotId===target.shotId));
    const composition=object(ledger)?field(ledger,['composition']):'';
    const sourceDescription=descriptions.length===1?descriptions[0]:'';
    let state:PreparedState='READY',reason='';
    if(!layerExists||!fingerprint){state='BLOCKED';reason='Exact current Shot/Layer/path or creative fingerprint is invalid.';}
    else if(matching.length===0){state='NEEDS_OWNER_REVIEW';reason='No exact matching image description in asset_needs.';}
    else if(descriptions.length===0){state='NEEDS_OWNER_REVIEW';reason='Matching asset_needs has no explicit image content/description.';}
    else if(descriptions.length!==1||dimensions.length>1||continuity.length>1){
      state='NEEDS_OWNER_REVIEW';reason='Conflicting descriptions/orientations/continuity for this exact target.';
    }
    const sourceLedger=composition;
    const sections=[
      'APPROVED MODE B STYLE '+style+' ['+profile.path+'; SHA256 '+profile.sha256+']',
      profile.guidance,
      'EXACT IMAGE CONTENT [Native asset_needs; '+target.shotId+'/'+target.layerId+'; '+target.path+']',
      sourceDescription,
      ...(dimensions.length===1?['ASSET ORIENTATION / OUTPUT REQUIREMENT',dimensions[0]]:[]),
      ...(continuity.length===1?['ASSET CONTINUITY REQUIREMENT',continuity[0]]:[]),
      ...(sourceLedger?['RELEVANT SHOT COMPOSITION [shot_ledger]',sourceLedger]:[])
    ];
    const computed=state==='READY'?sections.join('\n\n').trim():'';
    const owner=input.overrides?.[target.key];
    const validOwner=owner?.creativeFingerprint===fingerprint&&typeof owner.prompt==='string'&&owner.prompt.trim().length>=12;
    const prompt=validOwner?owner.prompt.trim():computed;
    // Owner edits can resolve a missing/conflicting description, but never a
    // structural blocker or a missing/integrity-failed style authority.
    if(validOwner&&state==='NEEDS_OWNER_REVIEW'){state='READY';reason='Owner reviewed and supplied this exact target prompt.';}
    if(style==='B4'&&state==='READY'){
      const references=validOwner&&Array.isArray(owner.references)?owner.references:[];
      if(!references.some(value=>profile.anchors.some(anchor=>value==='@modeb/b4/'+anchor.id))){
        state='NEEDS_OWNER_REVIEW';reason='B4 requires an explicit approved style-lock reference. Select a verified installed B4 anchor.';
      }
    }
    return{
      assetKey:target.key,targetKeys:[target.key],expectedPaths:[target.path],
      targetKey:target.key,shotId:target.shotId!,layerId:target.layerId!,path:target.path,assetKind:'other',
      state,reason,prompt,promptSha256:prompt?sha(prompt):'',
      sourceDescription,sourceLedger,sourceRows:matching,
      styleProfileRef:{id:style,path:profile.path,sha256:profile.sha256},
      references:validOwner&&Array.isArray(owner.references)?owner.references:[],
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
export function prepareNativeImages(appPath:string,root:string){
  const state=readState(root),draft=readNativeDraft(root,state),pending=getPendingMedia(appPath,root);
  if(!draft||!pending||draft.token!==pending.token)
    return{status:'NO_NATIVE_DRAFT' as const,style:state.project.style,revision:0,token:'',jobs:[] as ImageJobSpec[],shotCount:0,imageOccurrences:0,uniquePaths:0};
  const style=state.project.style as Style,overrides=readOverrides(root,state.project.id);
  const image=pending.missing.filter(item=>item.kind==='image');
  const fingerprints:Record<string,string>={};
  for(const target of image){
    try{fingerprints[target.key]=nativeImageTargetIdentity(root,target.key).fingerprint;}
    catch{fingerprints[target.key]='';}
  }
  const profile=loadImageStyleProfile(appPath,style);
  const jobs=compileImageJobSpecs({projectId:state.project.id,style,authorTaskId:draft.authorTaskId,draftRevision:draft.revision,
    token:draft.token,pending,profile,fingerprints,overrides:overrides.items});
  return{status:'PRE_MEDIA_PROJECTION' as const,style,revision:draft.revision,token:draft.token,
    jobs,shotCount:Array.isArray(pending.after?.shots)?pending.after!.shots!.length:0,imageOccurrences:image.length,
    uniquePaths:new Set(image.map(target=>target.path)).size};
}
export function saveNativeImagePrompt(appPath:string,root:string,input:{
  targetKey:string;fingerprint:string;prompt:string;references:string[]
}){
  if(!input||typeof input.targetKey!=='string'||typeof input.fingerprint!=='string'||
    typeof input.prompt!=='string'||input.prompt.length>18000||
    !Array.isArray(input.references)||input.references.length>8||
    input.references.some(x=>typeof x!=='string'))
    throw new Error('STORYBOARD_OVERRIDE_INVALID');
  const identity=nativeImageTargetIdentity(root,input.targetKey);
  if(identity.fingerprint!==input.fingerprint)throw new Error('STORYBOARD_OVERRIDE_STALE_TARGET');
  const state=readState(root),file=readOverrides(root,state.project.id);
  file.items[input.targetKey]={creativeFingerprint:identity.fingerprint,prompt:input.prompt.trim(),references:[...input.references]};
  atomicJson(overridesFile(root),file);
  return prepareNativeImages(appPath,root);
}
