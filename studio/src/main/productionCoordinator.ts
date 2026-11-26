import {readState} from './services.js';
import {freezeTask,readNativeDraft,getPendingMedia,inspectCurrentNativePlan,confirmImport} from './externalTasks.js';
import {freezeLifecycleTask,suggestedCorrectScope} from './externalLifecycle.js';
import {identityWorkflowSnapshot,readIdentityWorkflow,freezeIdentityTask,prepareAutomaticReferenceGallery} from './identity/identityWorkflow.js';
import {getCaptionReview,ensureCaptionAuthorTask} from './captionReview.js';
import type {IdentityDecoder} from './identity/referencePublication.js';
export type ProductionNext={action:string;detail:string;operation?:'author'|'review'|'correct'|'recheck';stage?:'script'|'native'|'analysis'};
const active=new Map<string,Promise<ProductionNext>>();
const next=(action:string,detail:string,stage?:ProductionNext['stage'],operation?:ProductionNext['operation']):ProductionNext=>({action,detail,stage,operation});
async function derive(appPath:string,root:string,decode:IdentityDecoder):Promise<ProductionNext>{
 let state=readState(root);
 if(state.identityPolicy!=='v1')return next('LEGACY','Legacy workflow remains explicit.');
 const candidate=state.scriptCandidate;
 if(candidate&&(state.approvedScript?.sha256!==candidate.sha256||state.approvedScript?.revision!==candidate.revision)){
   const correct=state.lifecycle?.tasks['script:correct'];
   if(correct?.id===candidate.taskId){
     const scope=suggestedCorrectScope(root,state,'script');
     if(scope.findingIds.length){freezeLifecycleTask(appPath,root,'script','correct',scope);return next('SCRIPT_CORRECT','Import independent scoped correction.','script','correct');}
     const recheck=state.lifecycle?.tasks['script:recheck'];
     if(recheck?.status!=='IMPORTED'){freezeLifecycleTask(appPath,root,'script','recheck',{});return next('SCRIPT_RECHECK','Import independent Recheck.','script','recheck');}
   }
   return next('SCRIPT_APPROVE','Review and approve current Script.','script');
 }
 if(!state.approvedScript){freezeTask(appPath,root,'script');return next('SCRIPT_AUTHOR','Copy frozen Script Author prompt and import result.','script','author');}
 let journal=readIdentityWorkflow(root);
 if(!journal.analysisApproved){
   let op:'author'|'review'|'correct'|'recheck'='author';
   const task=journal.currentTask;
   if(task?.status==='FROZEN')op=task.task.operation;
   else if(task?.status==='IMPORTED'){
     if(task.task.operation==='author')op='review';
     else if(task.task.operation==='correct')op='recheck';
     else if(journal.independentReview?.approved)return next('ANALYSIS_APPROVE','Approve reviewed Script Analysis.','analysis');
     else op='correct';
   }
   if(task?.status!=='FROZEN')journal=freezeIdentityTask(root,op,journal.revision);
   return next('ANALYSIS_'+op.toUpperCase(),'Import frozen Script Analysis '+op+'.','analysis',op);
 }
 if(state.voice&&!state.voice.stale&&state.alignment)ensureCaptionAuthorTask(root);
 prepareAutomaticReferenceGallery(root,appPath,journal.revision,decode);
 const upstream=identityWorkflowSnapshot(root,appPath);
 if(upstream.readiness!=='REFERENCES_PUBLISHED')return next('REFERENCE_APPROVE','Complete canonical reference gallery: '+upstream.readiness);
 state=readState(root);
 if(!state.voice||state.voice.stale)return next('VOICE','Generate or import approved narration.');
 if(!state.alignment)return next('ALIGN','Authorize alignment of accepted WAV.');
 const caption=getCaptionReview(root);
 if(caption.status!=='VERIFIED')return next(caption.draft?'CAPTION_APPROVE':'CAPTION_AUTHOR','Approve exact caption revision or import frozen Caption Author result.');
 const draft=readNativeDraft(root,state);
 if(!draft){
   if(state.tasks?.native?.status==='IMPORTED'&&state.nativeReadiness?.fullReady){
     if(!state.preview)return next('PREVIEW','Authorize original Core preview.');
     if(!state.approval)return next('PREVIEW_APPROVE','Watch and approve the current preview.');
     return next(state.render?'DONE':'RENDER',state.render?'Final render registered.':'Authorize final render.');
   }
   if(state.tasks?.native?.status==='IMPORTED')return next('NATIVE_RECOVERY','Published sample requires explicit continuation/rebuild.','native');
   freezeTask(appPath,root,'native');return next('NATIVE_AUTHOR','Copy frozen Native Author prompt and import result.','native','author');
 }
 const plan=await inspectCurrentNativePlan(appPath,root);
 state=readState(root);
 const current=readNativeDraft(root,state);
 if(!current||current.sha256!==draft.sha256||current.token!==draft.token)throw Error('COORDINATOR_DRAFT_CHANGED');
 const reports=Object.values(state.lifecycle?.artifacts??{}).filter(x=>x.stage==='native'&&x.artifactContext==='DRAFT'&&x.draftToken===draft.token&&(x.operation==='review'||x.operation==='recheck')&&(x.value as {artifact_sha256?:string}).artifact_sha256===draft.sha256).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const report=reports[0];
 if(!report){
   const op=draft.revision>1?'recheck':'review';
   freezeLifecycleTask(appPath,root,'native',op,{targetContext:'DRAFT'});
   return next('NATIVE_'+op.toUpperCase(),'Import independent Native '+op+'.','native',op);
 }
 if(report.status==='REVIEWED_WITH_FINDINGS'){
   const scope=suggestedCorrectScope(root,state,'native','DRAFT');
   if(!scope.editablePaths?.length)return next('NATIVE_REISSUE','No structured editable paths; owner must explicitly reissue Author.','native');
   freezeLifecycleTask(appPath,root,'native','correct',{...scope,targetContext:'DRAFT'});
   return next('NATIVE_CORRECT','Import scoped Native Correct result.','native','correct');
 }
 if(report.status!=='REVIEWED_NO_FINDINGS'||plan?.plan!=='PASS')return next('NATIVE_BLOCKED','Technical/creative blocker: '+(plan?.error??report.status)+'; use independent Review or explicit reissue.','native');
 const pending=getPendingMedia(appPath,root);
 if(!pending||pending.stage!=='native')throw Error('NATIVE_PENDING_MEDIA_REQUIRED');
 if(pending.missing.length)return next('ASSETS','Complete '+pending.missing.length+' required media target(s).');
 await confirmImport(appPath,root,pending.token,{allowSampleDraft:false});
 return next('PREVIEW','Full Native publication validated. Authorize original Core preview.');
}
export function advanceProduction(appPath:string,root:string,decode:IdentityDecoder):Promise<ProductionNext>{
 const existing=active.get(root);if(existing)return existing;
 const work=Promise.resolve().then(()=>derive(appPath,root,decode)).catch(error=>next('BLOCKED',error instanceof Error?error.message:String(error))).finally(()=>active.delete(root));
 active.set(root,work);return work;
}
