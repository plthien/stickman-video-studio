import fs from 'node:fs';
import path from 'node:path';
import {getCaptionReview} from './captionReview.js';
import {suggestedCorrectScope} from './externalLifecycle.js';
import {readNativeDraft} from './externalTasks.js';
import {verifyPersistedNativeEvidence,type NativeVerificationAdapter} from './nativeEvidence.js';
import {assertLocalRoot,readState,resolveProjectFile,sha,strictJson} from './services.js';

const finite=(value:unknown,label:string)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`ERROR: invalid native ${label}.`);return value};
const text=(value:unknown,label:string)=>{if(typeof value!=='string'||!value.trim())throw new Error(`ERROR: invalid native ${label}.`);return value};
export async function projectSnapshot(root:string,appPath:string,verifier?:NativeVerificationAdapter){
  const projectRoot=assertLocalRoot(root),state=readState(projectRoot),manifest=strictJson(fs.readFileSync(path.join(projectRoot,'project.json'),'utf8')) as Record<string,unknown>;
  if(!Array.isArray(manifest.shots)||!Array.isArray(manifest.captions))throw new Error('ERROR: native shots/captions must be arrays.');
  const rawShots=manifest.shots as Array<Record<string,unknown>>,rawCaptions=manifest.captions as Array<Record<string,unknown>>;
  if(Boolean(rawShots.length)!==Boolean(rawCaptions.length))throw new Error('ERROR: nonempty native production requires both shots and captions.');
  let priorShot=0;const ids=new Set<string>();
  const captions=rawCaptions.map((cue,index)=>{const start=finite(cue.start,`caption ${index+1} start`),end=finite(cue.end,`caption ${index+1} end`),label=text(cue.text,`caption ${index+1} text`);if(start<0||end<=start)throw new Error(`ERROR: invalid native caption ${index+1} timing.`);return{start,end,text:label}});
  const shots=rawShots.map((shot,index)=>{const id=text(shot.id,`shot ${index+1} ID`);if(ids.has(id))throw new Error(`ERROR: duplicate native shot ID: ${id}`);ids.add(id);const start=finite(shot.start,`shot ${id} start`),end=finite(shot.end,`shot ${id} end`);if(start<0||end<=start||Math.abs(start-priorShot)>.002)throw new Error(`ERROR: invalid native shot timing: ${id}`);priorShot=end;if(!Array.isArray(shot.layers)||!shot.layers.length)throw new Error(`ERROR: native shot has no actual layers: ${id}`);const overlaps=captions.filter(value=>value.start<end&&value.end>start);return{id,title:typeof shot.title==='string'?shot.title:'',duration:end-start,start,end,caption:overlaps[0]?.text??'',captions:overlaps,status:'NATIVE_MANIFEST',color:'#79dfc6',layers:shot.layers}});
  if(state.approvedScript&&sha(state.approvedScript.text)!==state.approvedScript.sha256)throw new Error('ERROR: registered approved script is corrupt.');
  // A newly activated Script intentionally marks the old WAV stale. Keep the project
  // readable so the user can regenerate Voice; only active audio must pass integrity checks.
  if(state.voice&&!state.voice.stale){const file=resolveProjectFile(projectRoot,state.voice.path);if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==state.voice.sha256||typeof state.voice.duration!=='number'||!Number.isFinite(state.voice.duration)||state.voice.duration<=0)throw new Error('ERROR: registered narration evidence is corrupt.')}
  if(state.alignment){for(const [relative,expected,label] of [[state.alignment.path,state.alignment.wordsSha256,'WORDS'],[state.alignment.captionsPath,state.alignment.cuesSha256,'captions']] as const){const file=resolveProjectFile(projectRoot,relative);if(!expected||!fs.existsSync(file)||sha(fs.readFileSync(file))!==expected)throw new Error(`ERROR: registered ${label} evidence is stale or corrupt.`)}}
  let captionStatus:'NEVER_CREATED'|'REVIEW_REQUIRED'|'STALE_REVIEW'|'CORRUPT_REGISTERED_REVIEW'|'VERIFIED'|'AUTO_VERIFIED'=state.alignment?'REVIEW_REQUIRED':'NEVER_CREATED';if(state.alignment)captionStatus=getCaptionReview(projectRoot).status;const captionReady=captionStatus==='VERIFIED'||captionStatus==='AUTO_VERIFIED';
  for(const item of state.media??[]){const file=resolveProjectFile(projectRoot,item.path);if(!item.rights.trim()||!fs.existsSync(file)||sha(fs.readFileSync(file))!==item.sha256)throw new Error(`ERROR: registered media evidence is stale or corrupt: ${item.path}`)}
  if(state.nativeReadiness&&(!state.nativeReadiness.sourceFingerprint||state.nativeReadiness.sourceFingerprint!==sha(fs.readFileSync(path.join(projectRoot,'project.json')))))throw new Error('BLOCKED: saved native readiness does not bind current native manifest bytes.');
  await verifyPersistedNativeEvidence(appPath,projectRoot,state,verifier);
  const duration=shots.length?shots.at(-1)!.end:0,clip=(label:string,start:number,end:number)=>({label,start,duration:end-start});
  const layers=shots.flatMap(item=>item.layers.flatMap(layer=>{const value=layer as Record<string,unknown>;return typeof value.id==='string'&&value.id.trim()?[clip(value.id,item.start,item.end)]:[]}));
  const sfx=(Array.isArray(manifest.sfx)?manifest.sfx as Array<Record<string,unknown>>:[]).map((value,index)=>{const start=finite(value.time,`SFX ${index+1} time`),label=typeof value.id==='string'&&value.id.trim()?value.id:text(value.kind,`SFX ${index+1} kind`),length=value.duration===undefined?0:finite(value.duration,`SFX ${index+1} duration`);return clip(label,start,start+length)});
  const ambience=(Array.isArray(manifest.ambience)?manifest.ambience as Array<Record<string,unknown>>:[]).map((value,index)=>clip(typeof value.id==='string'&&value.id.trim()?value.id:text(value.path,`ambience ${index+1} path`),finite(value.start,`ambience ${index+1} start`),finite(value.end,`ambience ${index+1} end`)));
  const tracks={Scenes:shots.map(item=>({...clip(item.id,item.start,item.end),captionCount:item.captions.length,captionTexts:item.captions.map(cue=>cue.text+' ['+cue.start+'–'+cue.end+']')})),Layers:layers,Captions:captions.map(item=>clip(item.text,item.start,item.end)),Narration:state.voice&&!state.voice.stale?[clip(state.voice.origin??state.voice.path,0,state.voice.duration!)]:[],SFX:sfx,Ambience:ambience};
  const jobPath=path.join(projectRoot,'.studio','jobs','latest.json'),job=fs.existsSync(jobPath)?strictJson(fs.readFileSync(jobPath,'utf8')):null;
  const nativeDraft=readNativeDraft(projectRoot,state);
  const draftReports=nativeDraft?Object.values(state.lifecycle?.artifacts??{}).filter(item=>
    item.stage==='native'&&item.artifactContext==='DRAFT'&&
    (item.operation==='review'||item.operation==='recheck')&&
    (item.value as {artifact_sha256?:string})?.artifact_sha256===nativeDraft.sha256)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[],latestDraftReview=draftReports[0];
  const currentFindings=(latestDraftReview?.value as {findings?:Array<{status:string}>}|undefined)?.findings??[];
  return{...state,manifest,projection:{shots,duration,tracks,captionReady,captionStatus,demo:false as const},job,
    nativeDraft:nativeDraft?{context:'DRAFT' as const,token:nativeDraft.token,authorTaskId:nativeDraft.authorTaskId,
      revision:nativeDraft.revision,artifactSha256:nativeDraft.sha256,
      reviewStatus:latestDraftReview?.status??'NOT_REVIEWED',
      unresolvedFindings:currentFindings.filter(item=>item.status==='open'||item.status==='uncertain').length,
      readyForMedia:latestDraftReview?.status==='REVIEWED_NO_FINDINGS'}:null,
    suggestedCorrectScope:{script:suggestedCorrectScope(projectRoot,state,'script'),
      native:suggestedCorrectScope(projectRoot,state,'native',nativeDraft?'DRAFT':'PUBLISHED'),
      nativePublished:state.external.native?suggestedCorrectScope(projectRoot,state,'native','PUBLISHED'):undefined}};
}
