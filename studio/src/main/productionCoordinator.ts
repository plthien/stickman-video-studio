import {readState,resolveProjectFile,sha} from './services.js';
import fs from 'node:fs';
import {nativeJob} from './nativeJobs.js';
import {currentNativeEvidence,verifyPersistedNativeEvidence} from './nativeEvidence.js';
import {assertPublishedIdentityCurrent} from './identity/finalGate.js';
import {freezeTask,readNativeDraft,getPendingMedia,inspectCurrentNativePlan,confirmImport} from './externalTasks.js';
import {freezeLifecycleTask,suggestedCorrectScope} from './externalLifecycle.js';
import {identityWorkflowSnapshot,readIdentityWorkflow,freezeIdentityTask,prepareAutomaticReferenceGallery} from './identity/identityWorkflow.js';
import {getCaptionReview,ensureCaptionAuthorTask} from './captionReview.js';
import type {IdentityDecoder} from './identity/referencePublication.js';
export type ProductionNext={action:string;detail:string;operation?:'author'|'review'|'correct'|'recheck';stage?:'script'|'native'|'analysis'};
const active=new Map<string,Promise<ProductionNext>>();
const next=(action:string,detail:string,stage?:ProductionNext['stage'],operation?:ProductionNext['operation']):ProductionNext=>({action,detail,stage,operation});
async function continueFullProduction(appPath:string,root:string):Promise<ProductionNext>{
 const state=readState(root);
 if(!state.nativeReadiness?.fullReady)throw Error('FULL_PRODUCTION_REQUIRES_FULL_READY');
 assertPublishedIdentityCurrent(root,appPath,'FULL');
 const evidence=currentNativeEvidence(root,state);
 const seconds=state.nativeReadiness.previewSeconds;
 const previewEvidence=currentNativeEvidence(root,state,{seconds});
 const jobFile=resolveProjectFile(root,'.studio/jobs/latest.json');
 const job=fs.existsSync(jobFile)?JSON.parse(fs.readFileSync(jobFile,'utf8')) as {command?:string;status?:string;sourceFingerprint?:string;error?:string}:null;
 // Failed local production is surfaced, not endlessly retried by state refresh.
 // Interrupted local jobs may safely resume through original transaction and lock.
 if(!state.preview){
   if(job?.command==='preview'&&job.status==='FAILED'&&job.sourceFingerprint===previewEvidence.fingerprint)
     return next('PREVIEW_RETRY','Original preview failed: '+(job.error??'See native job diagnostics'));
   await nativeJob(appPath,root,'preview',{seconds,replace:true});
   return next('PREVIEW_APPROVE','Watch and approve the exact verified preview to render the full video.');
 }
 await verifyPersistedNativeEvidence(appPath,root,state);
 if(!state.approval)return next('PREVIEW_APPROVE','Watch and approve the exact verified preview to render the full video.');
 if(state.render)return next('DONE','Verified final output: '+state.render.path);
 // A durable original approval is the explicit human authority for continuation.
 if(state.approval.previewSha256!==state.preview.sha256)throw Error('PREVIEW_APPROVAL_STALE');
 if(job?.command==='render'&&job.status==='FAILED'&&job.sourceFingerprint===evidence.fingerprint)
   return next('RENDER_RETRY','Original render failed: '+(job.error??'See native job diagnostics'));
 await nativeJob(appPath,root,'render',{replace:true});
 const final=readState(root);
 if(!final.render||sha(fs.readFileSync(resolveProjectFile(root,final.render.path)))!==final.render.sha256)throw Error('FULL_RENDER_EVIDENCE_MISSING');
 return next('DONE','Verified final output: '+final.render.path);
}
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
 if(!journal.analysisApproved||journal.draftAnalysis?.source_script_sha256!==state.approvedScript.sha256){
   let op:'author'|'review'|'correct'|'recheck'='author';
   const task=journal.currentTask;
   if(journal.draftAnalysis&&journal.draftAnalysis.source_script_sha256!==state.approvedScript.sha256){freezeIdentityTask(root,'author',journal.revision);return next('ANALYSIS_AUTHOR','Approved Script changed; import new analysis.','analysis','author');}
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
 if(caption.status!=='VERIFIED')return caption.canApproveDraft?next('CAPTION_APPROVE','Approve the exact semantic caption revision.'):next('CAPTION_AUTHOR','Import the frozen semantic Caption Author result; technical grouping is not approval authority.');
 let draft:ReturnType<typeof readNativeDraft>;
 try{draft=readNativeDraft(root,state);}catch(error){
   if(error instanceof Error&&error.message==='NATIVE_DRAFT_STALE_AUTHOR_TASK'){
     if(state.tasks?.native?.status==='FROZEN')return next('NATIVE_AUTHOR','Import the explicitly reissued Native Author; historical draft and licensed assets remain preserved.','native','author');
     return next('NATIVE_REISSUE','Previous draft has stale Author authority; explicitly reissue Native Author.','native','author');
   }
   throw error;
 }
 if(!draft){
   if(state.tasks?.native?.status==='IMPORTED'&&state.nativeReadiness?.fullReady){
     return continueFullProduction(appPath,root);
   }
   if(state.tasks?.native?.status==='IMPORTED')return next('NATIVE_RECOVERY','Historical incomplete publication: explicitly reissue Native Author for Full Production; existing licensed assets are retained.','native','author');
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
 if(report.status==='REVIEWED_NO_FINDINGS'&&plan?.plan==='FAIL'){
   // The exact preflight error is included by freezeLifecycleTask in the frozen evidence.
   // A clean verdict cannot authorize invalid motion; never synthesize findings or paths.
   const op=draft.history.length?'recheck':'review';
   const existing=state.lifecycle?.tasks['native:'+op];
   if(existing?.status==='FROZEN'&&existing.artifactSha256===draft.sha256&&existing.draftToken===draft.token)
     return next('NATIVE_'+op.toUpperCase(),'Original plan FAIL: '+plan.error+'; import independent technical repair assessment.','native',op);
   if(report.taskId===existing?.id&&existing.status==='IMPORTED'){
     const bytes=fs.readFileSync(resolveProjectFile(root,existing.promptPath));
     if(sha(bytes)!==existing.promptSha256)throw Error('NATIVE_TECHNICAL_REVIEW_PROMPT_TAMPERED');
     const prompt=bytes.toString('utf8');
     if(prompt.includes(plan.candidateSha)&&prompt.includes(JSON.stringify(plan.error).slice(1,-1)))return next('NATIVE_REISSUE','Original plan FAIL: '+plan.error+'; clean independent verdict provides no authorized correction. Explicitly reissue Native Author.','native','author');
   }
   freezeLifecycleTask(appPath,root,'native',op,{targetContext:'DRAFT'});
   return next('NATIVE_'+op.toUpperCase(),'Original plan FAIL: '+plan.error+'; import independent technical repair assessment.','native',op);
 }
 if(report.status!=='REVIEWED_NO_FINDINGS'||plan?.plan!=='PASS')return next('NATIVE_BLOCKED','Technical/creative blocker: '+(plan?.error??report.status)+'; use independent Review or explicit reissue.','native');
 const pending=getPendingMedia(appPath,root);
 if(!pending||pending.stage!=='native')throw Error('NATIVE_PENDING_MEDIA_REQUIRED');
 if(pending.missing.length)return next('ASSETS','Complete '+pending.missing.length+' required media target(s).');
 await confirmImport(appPath,root,pending.token,{allowSampleDraft:false});
 return continueFullProduction(appPath,root);
}
export function advanceProduction(appPath:string,root:string,decode:IdentityDecoder):Promise<ProductionNext>{
 const existing=active.get(root);if(existing)return existing;
 const work=Promise.resolve().then(()=>derive(appPath,root,decode)).catch(error=>next('BLOCKED',error instanceof Error?error.message:String(error))).finally(()=>active.delete(root));
 active.set(root,work);return work;
}
