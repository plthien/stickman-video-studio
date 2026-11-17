// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {freezeTask,confirmImport} from '../../src/main/externalTasks';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult,exportReviewPack} from '../../src/main/externalLifecycle';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,nativePayload,stageNative,validator} from './SixIssueFixtures';

afterEach(cleanup);
type Lifecycle=ReturnType<typeof freezeLifecycleTask>;
function result(root:string,task:Lifecycle,operation:'review'|'correct'|'recheck'|'media-review',payload:unknown){
  const state=readState(root);
  return JSON.stringify({schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,
    task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
    stage:task.stage,operation,payload});
}
const finding=(id:string,target:string,status='open')=>({
  id,severity:'major',status,target_ids:[target],requirement:'The stated original causal requirement',
  evidence:{kind:'manifest',detail:'Synthetic fixture text establishes the narrow causal problem.'},
  recommendation:'Clarify the existing causal relation without editing locked content.'
});
function reviewPayload(task:Lifecycle,targetIds:string[],found:ReturnType<typeof finding>[],stage:'script'|'native'){
  return {schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,
    status:found.length?'REVIEWED_WITH_FINDINGS':'REVIEWED_NO_FINDINGS',
    coverage:{target_ids:targetIds,modalities:[stage==='script'?'script':'manifest'],ranges:[],media_sha256s:[]},
    findings:found};
}
async function confirmedScriptReview(){
  const {root}=fixture();
  freezeTask(appPath,root,'script');
  const review=freezeLifecycleTask(appPath,root,'script','review');
  const staged=stageLifecycleResult(appPath,root,'script','review',result(root,review,'review',
    reviewPayload(review,['opening'],[finding('F-SCOPE','opening')],'script')));
  await Promise.resolve(confirmLifecycleResult(root,staged.token));
  return{root,review};
}
async function correctedScript(){
  const {root,review}=await confirmedScriptReview();
  const correct=freezeLifecycleTask(appPath,root,'script','correct');
  const current=readState(root).approvedScript!;
  const corrected={schema:'mode-b-script-v1',
    sections:current.sections.map(row=>({...row,text:'The established danger forces an actual rescue decision.'})),
    authoring:current.authoring??{}};
  const payload={schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
    finding_ids:correct.findingIds,editable_ids:correct.editableIds,
    editable_paths:correct.editablePaths,artifact:corrected};
  const staged=stageLifecycleResult(appPath,root,'script','correct',result(root,correct,'correct',payload));
  await Promise.resolve(confirmLifecycleResult(root,staged.token));
  return{root,review,correct};
}
async function nativeBaseline(){
  const {root}=fixture({style:'B1'});
  const staged=stageNative(root,nativePayload(root));
  await confirmImport(appPath,root,staged.response.token,{validator:validator().run});
  return root;
}

describe('P-01 through P-14 lifecycle prompt, lock, evidence and ancestry contracts',()=>{
  it('P-02 Script Correct refuses unresolved no-op and locked authoring mutation',async()=>{
    const {root}=await confirmedScriptReview();
    const correct=freezeLifecycleTask(appPath,root,'script','correct');
    expect(correct.findingIds).toEqual(['F-SCOPE']);
    expect(correct.editableIds).toEqual(['opening']);
    const current=readState(root).approvedScript!;
    const noOp={schema:'mode-b-script-v1',sections:current.sections,authoring:current.authoring};
    const wrap=(artifact:unknown)=>result(root,correct,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:correct.editableIds,
      editable_paths:correct.editablePaths,artifact});
    expect(()=>stageLifecycleResult(appPath,root,'script','correct',wrap(noOp)))
      .toThrow(/SCRIPT_CORRECT_NO_OP/);
    expect(()=>stageLifecycleResult(appPath,root,'script','correct',wrap({
      ...noOp,authoring:{creative_direction:{premise:'Unauthorized replacement'}}
    }))).toThrow(/Locked/);
    const changed={...noOp,sections:[{id:'opening',text:'The true cause now drives the action.'}]};
    expect(()=>stageLifecycleResult(appPath,root,'script','correct',wrap(changed))).not.toThrow();
  });

  it('P-04 Script Recheck requires exact confirmed correction, includes findings and can activate only after clean result',async()=>{
    const {root}=await correctedScript();
    const recheck=freezeLifecycleTask(appPath,root,'script','recheck');
    expect(recheck.findingIds).toEqual(['F-SCOPE']);
    expect(recheck.prompt).toContain('SCRIPT RECHECK — TEXT EVIDENCE AND ACTIVATION GATE');
    expect(recheck.prompt).toContain('Required exact finding IDs: ["F-SCOPE"]');
    expect(recheck.prompt).not.toMatch(/"status"\s*:\s*"REVIEWED_NO_FINDINGS"/);
    const incomplete=reviewPayload(recheck,['opening'],[],'script');
    expect(()=>stageLifecycleResult(appPath,root,'script','recheck',
      result(root,recheck,'recheck',incomplete))).toThrow(/omitted/);
    const resolved=reviewPayload(recheck,['opening'],[finding('F-SCOPE','opening','resolved')],'script');
    resolved.status='REVIEWED_NO_FINDINGS';
    const staged=stageLifecycleResult(appPath,root,'script','recheck',
      result(root,recheck,'recheck',resolved));
    await Promise.resolve(confirmLifecycleResult(root,staged.token));
    expect(readState(root).approvedScript?.approvedBy).toBe('AUTO');
    expect(readState(root).approvedScript?.sections[0].text).toContain('true cause');
  });

  it('P-05/P-06 native Recheck binds exact published correction, rejecting unrelated review history',async()=>{
    const root=await nativeBaseline();
    const review=freezeLifecycleTask(appPath,root,'native','review');
    const staged=stageLifecycleResult(appPath,root,'native','review',
      result(root,review,'review',reviewPayload(review,['shot-1','shot-2'],
        [finding('F-NATIVE','shot-1')],'native')));
    await Promise.resolve(confirmLifecycleResult(root,staged.token));
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{editableIds:['shot-1']});
    const state=readState(root);
    const previous=state.external.native!.artifact as Record<string,unknown>;
    const artifact={manifest:JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')),
      shot_ledger:previous.shotLedger??[],sound_script:previous.soundScript??[],asset_needs:previous.assetNeeds??[]};
    const payload={schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:correct.editableIds,
      editable_paths:correct.editablePaths,artifact};
    const pending=stageLifecycleResult(appPath,root,'native','correct',
      result(root,correct,'correct',payload));
    await Promise.resolve(confirmLifecycleResult(root,pending.token));
    // Synthetic hostile history only: 6 foreign/stale records must never
    // become evidence that this exact Native correction resolved a finding.
    const changed=readState(root);
    for(let i=0;i<6;i++)changed.lifecycle!.artifacts['foreign-'+i]={
      taskId:'foreign-'+i,stage:i%2?'script':'native',
      operation:i%2?'review':'media-review',artifactSha256:'unrelated',
      createdAt:'2099-01-01T00:00:00.000Z',status:'REVIEWED_WITH_FINDINGS',
      value:{artifact_sha256:'other',findings:[finding('F-FOREIGN-'+i,'shot-2')]}
    };
    writeState(root,changed);
    const recheck=freezeLifecycleTask(appPath,root,'native','recheck');
    expect(recheck.findingIds).toEqual(['F-NATIVE']);
    expect(recheck.prompt).toContain('NATIVE RECHECK');
    expect(recheck.prompt).not.toContain('F-FOREIGN-0');
    expect(recheck.prompt).not.toContain('F-FOREIGN-5');
  });

  it('P-07/P-08 Voice and Captions reviews retain actual SHA and reject untransferred media modalities',()=>{
    const {root}=fixture();freezeTask(appPath,root,'script');
    const voicePack=exportReviewPack(root,'voice');
    expect((voicePack.pack.attachments as Array<{sha256:string}>)
      .some(item=>item.sha256===readState(root).voice!.sha256)).toBe(true);
    const voice=freezeLifecycleTask(appPath,root,'script','media-review',{media:'voice'});
    expect(voice.prompt).toContain('VOICE MEDIA REVIEW');
    expect(voice.prompt).not.toMatch(/"status"\s*:\s*"INSUFFICIENT_EVIDENCE"/);
    const voiceClaim={schema:'mode-b-review-v1',artifact_sha256:voice.artifactSha256,
      status:'REVIEWED_WITH_FINDINGS',
      coverage:{target_ids:voice.targetIds,modalities:['sound'],ranges:[],media_sha256s:[]},
      findings:[finding('F-VOICE','opening')]};
    expect(()=>stageLifecycleResult(appPath,root,'script','media-review',
      result(root,voice,'media-review',voiceClaim))).toThrow(/NOT_VERIFIED/);
    exportReviewPack(root,'captions');
    const captions=freezeLifecycleTask(appPath,root,'script','media-review',{media:'captions'});
    expect(captions.prompt).toContain('CAPTIONS MEDIA REVIEW');
    const captionClaim={...voiceClaim,artifact_sha256:captions.artifactSha256,
      coverage:{target_ids:captions.targetIds,modalities:['captions'],ranges:[],media_sha256s:[]}};
    expect(()=>stageLifecycleResult(appPath,root,'script','media-review',
      result(root,captions,'media-review',captionClaim))).toThrow(/NOT_VERIFIED/);
    const receipt=readState(root).alignment!.captionReview!;
    expect(captions.prompt).toContain(receipt.sha256);
  });

  it('P-10 Film review refuses partial Native sample and accepts only full-duration registered scope',async()=>{
    const root=await nativeBaseline(),state=readState(root);
    const file='output/synthetic-film.mp4',report='output/synthetic-film-report.json';
    fs.mkdirSync(path.join(root,'output'),{recursive:true});
    // Contract-only synthetic bytes; NOT a claim of playable or watched film.
    fs.writeFileSync(path.join(root,file),'SYNTHETIC_NOT_PLAYABLE');
    fs.writeFileSync(path.join(root,report),JSON.stringify({duration:30}));
    state.render={path:file,sha256:sha(fs.readFileSync(path.join(root,file))),
      reportPath:report,reportSha256:sha(fs.readFileSync(path.join(root,report))),
      verifiedAt:new Date().toISOString()};
    writeState(root,state);
    expect(()=>freezeLifecycleTask(appPath,root,'native','media-review',
      {media:'film'})).toThrow(/FULL_READY/);
    const updated=readState(root);
    updated.nativeReadiness={...updated.nativeReadiness!,fullReady:true};
    writeState(root,updated);
    const film=freezeLifecycleTask(appPath,root,'native','media-review',{media:'film'});
    expect(film.targetIds).toEqual(['shot-1','shot-2']);
    expect(film.prompt).toContain('FILM MEDIA REVIEW');
    expect(film.prompt).toContain('SYNTHETIC_NOT_PLAYABLE').toBe(false);
  });

  it('P-12/P-13 lifecycle response examples contain frozen identity but never preset review outcomes',async()=>{
    const root=await nativeBaseline();
    const review=freezeLifecycleTask(appPath,root,'native','review');
    const prompt=review.prompt.split('## G — RESPONSE CONTRACT — NO PRESET OUTCOME')[1]
      ?.split('## H — ORIGINAL FROZEN AUTHOR TASK')[0]??'';
    expect(prompt).toContain('"task_id": "'+review.id+'"');
    expect(prompt).toContain('"artifact_sha256": "'+review.artifactSha256+'"');
    expect(prompt).not.toMatch(/"status"\s*:\s*"(?:REVIEWED_WITH_FINDINGS|REVIEWED_NO_FINDINGS|INSUFFICIENT_EVIDENCE|NOT_VERIFIED)"/);
    expect(prompt).toContain('payload.status is REQUIRED and NOT PRESELECTED');
    expect(review.prompt).toContain('mode_b_native_review_r'+review.revision+'_');
    const same=freezeLifecycleTask(appPath,root,'native','review');
    expect(same.id).toBe(review.id);
    expect(same.prompt).toBe(review.prompt);
    const rebuilt=freezeLifecycleTask(appPath,root,'native','review',{},true);
    expect(rebuilt.id).not.toBe(review.id);
    expect(()=>stageLifecycleResult(appPath,root,'native','review',result(root,review,'review',
      reviewPayload(review,['shot-1','shot-2'],[],'native')))).toThrow(/binding mismatch/);
  });
});
