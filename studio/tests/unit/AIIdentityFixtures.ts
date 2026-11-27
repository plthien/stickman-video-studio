/** Explicit reviewed AI fixtures; no provider calls or semantic inference. */
import {contentHash,type ScriptAnalysis,type StyleDesignCandidate,type StyleDesignReview} from '../../src/main/identity/contracts';
import {compileStyleBible,type PinnedStyle} from '../../src/main/identity/styleBible';
import type {ApprovedScriptSnapshot} from '../../src/main/identity/scriptAnalysis';
import {prepareProjectStyleBible,freezeStyleBibleTask,importStyleBibleResult,approveProjectStyleBible,
  readIdentityWorkflow} from '../../src/main/identity/identityWorkflow';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {readNativeDraft} from '../../src/main/externalTasks';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {readState} from '../../src/main/services';
export function aiDesignFixture(analysis:ScriptAnalysis,style:PinnedStyle){
  const design:StyleDesignCandidate={schema:'stickman-ai-style-design-v1',
    project_id:analysis.project_id,analysis_sha256:contentHash(analysis),style_profile_sha256:style.sha256,
    characters:analysis.continuity_catalog.characters.map(row=>({char_id:row.char_id,
      visual_design:'Approved AI-designed angular silhouette with a copper scarf.',
      source_established:[...row.explicit_visual_traits],creative_decisions:['Angular silhouette and copper scarf'],
      reference_prompt:'Draw the approved angular silhouette with a copper scarf in all reference views.'}))};
  const review:StyleDesignReview={schema:'stickman-ai-style-design-review-v1',
    project_id:design.project_id,candidate_sha256:contentHash(design),independent_review:true,approved:true,findings:[]};
  return{design,review};
}
export function compileReviewedBible(analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,style:PinnedStyle){
  const {design,review}=aiDesignFixture(analysis,style);
  return compileStyleBible(analysis,script,style,design,review);
}
export function approveAIStyleBible(root:string,appPath:string,revision:number){
  const author=prepareProjectStyleBible(root,appPath,revision);
  const analysis=readIdentityWorkflow(root).draftAnalysis!;
  const style=loadImageStyleProfile(appPath,readState(root).project.style as PinnedStyle['id']);
  const {design,review}=aiDesignFixture(analysis,{id:style.id,guidance:style.guidance,sha256:style.sha256});
  const envelope=(task:NonNullable<typeof author.styleDesignTask>['task'],payload:unknown)=>JSON.stringify({
    schema:'mode-b-style-design-result-v1',stage:task.stage,task_id:task.task_id,project_id:task.project_id,
    revision:task.revision,input_sha256:task.input_sha256,payload});
  const imported=importStyleBibleResult(root,appPath,envelope(author.styleDesignTask!.task,design),author.revision);
  const reviewing=freezeStyleBibleTask(root,appPath,'review',imported.revision);
  const reviewed=importStyleBibleResult(root,appPath,envelope(reviewing.styleDesignTask!.task,review),reviewing.revision);
  return approveProjectStyleBible(root,appPath,reviewed.revision,true);
}
export function confirmCleanNativeReview(root:string,appPath:string){
  const draft=readNativeDraft(root)!;
  const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'});
  const reply={schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
    task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'native',operation:'review',
    payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_NO_FINDINGS',
      coverage:{target_ids:(draft.artifact.manifest as {shots:Array<{id:string}>}).shots.map(shot=>shot.id),
        modalities:['manifest'],ranges:[],media_sha256s:[]},findings:[]}};
  const staged=stageLifecycleResult(appPath,root,'native','review',JSON.stringify(reply));
  confirmLifecycleResult(appPath,root,staged.token);
}
