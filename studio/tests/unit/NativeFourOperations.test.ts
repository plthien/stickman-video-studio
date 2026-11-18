// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it,afterEach} from 'vitest';
import {freezeTask,getPendingMedia,readNativeDraft,stageImport,confirmImport,fulfillMedia,importMediaFile} from '../../src/main/externalTasks';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {fixture,stageNative,nativePayload,importedSource,validator,cleanup,appPath} from './SixIssueFixtures';
import {readState,sha} from '../../src/main/services';

afterEach(()=>cleanup());
type Task={id:string;revision:number;inputSha256:string;artifactSha256:string;
  editableIds?:string[];editablePaths?:string[];findingIds?:string[];prompt:string};
const delivery=(root:string,task:Task,operation:'review'|'correct'|'recheck',payload:unknown)=>JSON.stringify({
  schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
  task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
  stage:'native',operation,payload
});
const reviewPayload=(task:Task,status:'REVIEWED_WITH_FINDINGS'|'REVIEWED_NO_FINDINGS',
  findings:Array<Record<string,unknown>>=[])=>({
  schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status,
  coverage:{target_ids:['shot-1','shot-2'],modalities:['manifest'],ranges:[],media_sha256s:[]},findings
});
const issue=(status:'open'|'resolved'='open')=>({
  id:'N-001',severity:'major',status,target_ids:['shot-1'],
  requirement:'The confirmed ledger must communicate a concrete, meaningful visual delta.',
  evidence:{kind:'manifest',detail:status==='resolved'?'Current corrected ledger specifies the rescued object visibly moves.':'Original ledger describes no visible change.'},
  recommendation:'Repair the precise shot_ledger meaning for shot-1.'
});
function stageFixture(image=false){
  const {root}=fixture();
  const base=nativePayload(root,{image:image?'early':undefined});
  const candidate={...base,shot_ledger:[{shot_id:'shot-1',meaning:'Only static props are visible.'}]};
  const staged=stageNative(root,candidate);
  return{root,staged,candidate};
}
function confirmReview(root:string){
  const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
  const reply=delivery(root,task,'review',reviewPayload(task,'REVIEWED_WITH_FINDINGS',[issue()]));
  const staged=stageLifecycleResult(appPath,root,'native','review',reply);
  confirmLifecycleResult(appPath,root,staged.token);
  return task;
}
function confirmDraftCorrection(root:string){
  confirmReview(root);
  const task=freezeLifecycleTask(appPath,root,'native','correct',{
    targetContext:'DRAFT',editablePaths:['/shot_ledger/0/meaning'],findingIds:['N-001']
  }) as Task;
  const before=readNativeDraft(root)!.artifact;
  const corrected={...before,shot_ledger:[{shot_id:'shot-1',meaning:'The rescued object visibly moves from the trapped surface to safety.'}]};
  const reply=delivery(root,task,'correct',{
    schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
    finding_ids:task.findingIds,editable_ids:task.editableIds,
    editable_paths:task.editablePaths,artifact:corrected
  });
  const staged=stageLifecycleResult(appPath,root,'native','correct',reply);
  confirmLifecycleResult(appPath,root,staged.token);
  return{task,corrected};
}
describe('N01–N07: original Native Author plus pre-publication four-operation lifecycle',()=>{
  it('NA01/02/03/04/06/07 compact Author prompt uses exact word timing and source authority, not character timing',()=>{
    const {root}=fixture();
    const task=freezeTask(appPath,root,'native'),state=readState(root);
    const text=task.prompt;
    expect(text).toContain('native-author-word-only-v1');
    expect(text).toContain('ordered_words');
    expect(text).toContain('approved_caption_cues');
    expect(text).toContain('Shot');expect(text).toContain('keyframes/motion');
    expect(text).toContain('G-Labs-compatible');
    expect(text).toContain('SOURCE-EXACT VERIFIED STAGE EXTRACTIONS');
    expect(text).toContain('accepted WAV');
    expect(text).toContain('"duration": 30');
    expect(text).not.toContain('"characters":');
    expect(text).not.toContain('"loss":');
    expect(text).not.toContain('"caption_cues":');
    expect(state.alignment?.wordsSha256).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(root,state.alignment!.path),'utf8'))).toHaveProperty('words');
    const identity=task.prompt.match(/"task_id":\s*"([^"]+)"/)?.[1];
    expect(identity).toBe(task.id);
    expect(task.prompt).toContain('"shot_ledger": []');
    expect(task.prompt).toContain('"asset_needs": []');
  });
  it('NA05 asset needs with explicit Shot/Layer identities must match actual Native image paths',()=>{
    const {root}=fixture();
    const good=nativePayload(root,{image:'early'});
    const expectedPath=((good.manifest.shots[0] as {layers:Array<{path:string}>}).layers[0]).path;
    const candidate={...good,asset_needs:[{shot_id:'shot-1',layer_id:'image-1',path:expectedPath,
      content:'Owner to generate a still matching the approved visual world.'}]};
    stageNative(root,candidate);
    expect(readNativeDraft(root)?.artifact.asset_needs).toEqual(candidate.asset_needs);
    const task=readState(root).tasks!.native!;
    const invalid={...candidate,asset_needs:[{...candidate.asset_needs[0],path:'assets/images/unrelated.png'}]};
    const envelope={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'native',payload:invalid};
    expect(()=>stageImport(appPath,root,'native',JSON.stringify(envelope)))
      .toThrow(/NATIVE_ASSET_NEED_PATH_MISMATCH/);
  });
  it('NA08 frozen Author bytes/identity remain immutable until an explicit rebuild',()=>{
    const {root}=fixture();
    const first=freezeTask(appPath,root,'native');
    expect(freezeTask(appPath,root,'native').prompt).toBe(first.prompt);
    expect(freezeTask(appPath,root,'native').id).toBe(first.id);
    expect(sha(fs.readFileSync(path.join(root,readState(root).tasks!.native!.promptPath)))).toBe(first.promptSha256);
    const newer=freezeTask(appPath,root,'native',true);
    expect(newer.id).not.toBe(first.id);
    expect(fs.existsSync(path.join(root,first.promptPath))).toBe(true);
  });
  it('NR01/02/05/06 freezes Review against staged Native draft without publishing project.json',()=>{
    const {root}=stageFixture(true),before=fs.readFileSync(path.join(root,'project.json'));
    const draft=readNativeDraft(root)!;
    expect(draft.revision).toBe(1);
    const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'});
    expect(task.artifactSha256).toBe(draft.sha256);
    expect(task.prompt).toContain('INDEPENDENT CREATIVE');
    expect(task.prompt).toContain('NON-ADJACENT');
    expect(task.prompt).toContain('shot_ledger');
    expect(task.prompt).toContain('coverage.modalities=["manifest"]');
    expect(task.prompt).not.toContain('"characters":');
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
  });
  it('NR03/04 rejects invented targets and falsely observed picture coverage in text-only Review',()=>{
    const {root}=stageFixture(),task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const forged=reviewPayload(task,'REVIEWED_WITH_FINDINGS',[{...issue(),target_ids:['not-a-real-shot']}]);
    expect(()=>stageLifecycleResult(appPath,root,'native','review',delivery(root,task,'review',forged)))
      .toThrow(/unknown shot\/section target/);
    const falsePicture=reviewPayload(task,'REVIEWED_WITH_FINDINGS',[issue()]);
    falsePicture.coverage.modalities=['picture'];
    expect(()=>stageLifecycleResult(appPath,root,'native','review',delivery(root,task,'review',falsePicture)))
      .toThrow(/NATIVE_TEXT_REVIEW_EVIDENCE_INVALID/);
  });
  it('NC03/05/06 and NK01/02/05 keeps published manifest & Author response while correcting only auxiliary data',()=>{
    const {root}=stageFixture(),before=fs.readFileSync(path.join(root,'project.json'));
    const source=readState(root).tasks!.native!,responseBytes=fs.readFileSync(path.join(root,'.studio','external','pending.json'));
    const authorOriginal=JSON.parse(responseBytes.toString('utf8')) as {responsePath:string;responseSha256:string};
    const frozen=fs.readFileSync(path.join(root,authorOriginal.responsePath));
    const {task,corrected}=confirmDraftCorrection(root);
    const draft=readNativeDraft(root)!;
    expect(draft.revision).toBe(2);
    expect(draft.history[0]).toMatchObject({correctTaskId:task.id,previousSha256:task.artifactSha256});
    expect(draft.artifact).toEqual(corrected);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    expect(fs.readFileSync(path.join(root,authorOriginal.responsePath))).toEqual(frozen);
    expect(readState(root).tasks?.native?.id).toBe(source.id);
    const recheck=freezeLifecycleTask(appPath,root,'native','recheck',{targetContext:'DRAFT'}) as Task;
    expect(recheck.findingIds).toEqual(['N-001']);
    expect(recheck.artifactSha256).toBe(draft.sha256);
    expect(recheck.prompt).toContain('CURRENT corrected Native artifact');
    const resolved=reviewPayload(recheck,'REVIEWED_NO_FINDINGS',[issue('resolved')]);
    const staged=stageLifecycleResult(appPath,root,'native','recheck',delivery(root,recheck,'recheck',resolved));
    confirmLifecycleResult(appPath,root,staged.token);
    expect(readNativeDraft(root)!.sha256).toBe(draft.sha256);
    const reviewRecords=Object.values(readState(root).lifecycle!.artifacts);
    expect(reviewRecords.find(item=>item.taskId===recheck.id)?.status).toBe('REVIEWED_NO_FINDINGS');
  });
  it('NC01/02/04 rejects unauthorized locked shot and entire auxiliary collection',()=>{
    const {root}=stageFixture();confirmReview(root);
    expect(()=>freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'DRAFT',editablePaths:['/shot_ledger'],findingIds:['N-001']
    })).toThrow(/overly broad|whole-root|Invalid/i);
    const task=freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'DRAFT',editablePaths:['/shot_ledger/0/meaning'],findingIds:['N-001']
    }) as Task;
    const before=readNativeDraft(root)!.artifact;
    const corrected=structuredClone(before);
    ((corrected.manifest as {shots:Array<{layers:Array<{text?:string}>}>}).shots[1].layers[0]).text='Unauthorized';
    const envelope=delivery(root,task,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
      finding_ids:task.findingIds,editable_ids:task.editableIds,editable_paths:task.editablePaths,
      artifact:corrected});
    expect(()=>stageLifecycleResult(appPath,root,'native','correct',envelope)).toThrow(/Locked native/);
  });
  it('NC07 targeted image-path correction invalidates only affected fulfillment, not accepted media',()=>{
    const {root,staged}=stageFixture(true);
    const imported=importMediaFile(root,importedSource(root),'image','Owner licensed local');
    const pending=getPendingMedia(appPath,root)!;
    fulfillMedia(appPath,root,pending.token,pending.missing[0].key,imported.path,'Owner licensed local');
    confirmReview(root);
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{targetContext:'DRAFT',editableIds:['shot-1'],findingIds:['N-001']}) as Task;
    const prior=readNativeDraft(root)!.artifact;
    const corrected=structuredClone(prior);
    ((corrected.manifest as {shots:Array<{layers:Array<{path:string}>}>}).shots[0].layers[0]).path='assets/images/replacement.png';
    const reply=delivery(root,correct,'correct',{schema:'mode-b-correction-v1',
      artifact_sha256:correct.artifactSha256,finding_ids:correct.findingIds,
      editable_ids:correct.editableIds,editable_paths:correct.editablePaths,artifact:corrected});
    const proposal=stageLifecycleResult(appPath,root,'native','correct',reply);
    confirmLifecycleResult(appPath,root,proposal.token);
    const after=getPendingMedia(appPath,root)!;
    expect(after.fulfillments).toEqual({});
    expect(after.missing.some(item=>item.path==='assets/images/replacement.png')).toBe(true);
    expect(readState(root).media!.some(item=>item.path===imported.path)).toBe(true);
    expect(staged.response.token).toBe(after.token);
  });
  it('NC08 restart-like read verifies persisted immutable Draft revision and fails closed on tamper',()=>{
    const {root}=stageFixture();confirmDraftCorrection(root);
    const draft=readNativeDraft(root)!;
    expect(readNativeDraft(root)?.revision).toBe(2);
    const record=path.join(root,draft.history[0].recordPath);
    fs.appendFileSync(record,'modified');
    expect(()=>readNativeDraft(root)).toThrow(/TAMPERED/);
  });
  it('NK02/05/06 requires all historical findings, not empty clean recheck or stale old draft',()=>{
    const {root}=stageFixture();confirmDraftCorrection(root);
    const task=freezeLifecycleTask(appPath,root,'native','recheck',{targetContext:'DRAFT'}) as Task;
    const empty=reviewPayload(task,'REVIEWED_NO_FINDINGS',[]);
    expect(()=>stageLifecycleResult(appPath,root,'native','recheck',delivery(root,task,'recheck',empty)))
      .toThrow(/omitted/);
    const unresolved=reviewPayload(task,'REVIEWED_NO_FINDINGS',[issue()]);
    expect(()=>stageLifecycleResult(appPath,root,'native','recheck',delivery(root,task,'recheck',unresolved)))
      .toThrow(/unresolved/);
  });
  it('N05 complete pre-media path keeps project.json untouched until original CLI native confirmation',async()=>{
    const {root,staged}=stageFixture(),original=fs.readFileSync(path.join(root,'project.json'));
    confirmDraftCorrection(root);
    const task=freezeLifecycleTask(appPath,root,'native','recheck',{targetContext:'DRAFT'}) as Task;
    const proposal=stageLifecycleResult(appPath,root,'native','recheck',delivery(root,task,'recheck',
      reviewPayload(task,'REVIEWED_NO_FINDINGS',[issue('resolved')])));
    confirmLifecycleResult(appPath,root,proposal.token);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(original);
    const mock=validator();
    await confirmImport(appPath,root,staged.response.token,{validator:mock.run,previewSeconds:30});
    expect(mock.calls.some(call=>call.includes('validate'))).toBe(true);
    expect(readState(root).external.native).toBeDefined();
    expect(readNativeDraft(root)).toBeNull();
  });
  it('N05 target selection is mandatory when a new pending draft coexists with last-good Published Native',async()=>{
    const {root,staged}=stageFixture();
    await confirmImport(appPath,root,staged.response.token,{validator:validator().run,previewSeconds:30});
    const published=fs.readFileSync(path.join(root,'project.json'));
    const nextAuthor=freezeTask(appPath,root,'native',true);
    const newPayload=nativePayload(root);
    const envelope={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
      task_id:nextAuthor.id,revision:nextAuthor.revision,input_sha256:nextAuthor.inputSha256,
      stage:'native',payload:newPayload};
    stageImport(appPath,root,'native',JSON.stringify(envelope));
    expect(()=>freezeLifecycleTask(appPath,root,'native','review')).toThrow(/NATIVE_TARGET_SELECTION_REQUIRED/);
    const draft=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'});
    expect(draft.artifactContext).toBe('DRAFT');
    const confirmed=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'PUBLISHED'},true);
    expect(confirmed.artifactContext).toBe('PUBLISHED');
    expect(confirmed.artifactSha256).not.toBe(draft.artifactSha256);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(published);
  });
  it('NR07 old Published Native Review remains supported after the original CLI confirms Author',async()=>{
    const {root,staged}=stageFixture();
    await confirmImport(appPath,root,staged.response.token,{validator:validator().run,previewSeconds:30});
    const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'PUBLISHED'});
    expect(task.artifactContext).toBe('PUBLISHED');
    expect(task.prompt).toContain('PUBLISHED');
  });
});
