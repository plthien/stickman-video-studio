// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {describe,expect,it,afterEach,vi} from 'vitest';
import {freezeTask,getPendingMedia,readNativeDraft,stageImport,confirmImport,fulfillMedia,importMediaFile} from '../../src/main/externalTasks';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult,suggestedCorrectScope} from '../../src/main/externalLifecycle';
import {fixture,stageNative,nativePayload,importedSource,validator,cleanup,appPath} from './SixIssueFixtures';
import {readState,sha} from '../../src/main/services';
import {projectSnapshot} from '../../src/main/projectSnapshot';
import {saveGlabsKey,submitGlabsImage,pollGlabsImage,approveGlabsImage} from '../../src/main/glabs';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
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
  id:'N-001',severity:'major',status,target_ids:['shot-1'],editable_paths:status==='resolved'?[]:['/shot_ledger/0/meaning'],
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
function confirmReview(root:string,paths=['/shot_ledger/0/meaning']){
  const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
  const reply=delivery(root,task,'review',reviewPayload(task,'REVIEWED_WITH_FINDINGS',[{...issue(),editable_paths:paths}]));
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
    const frozenBytes=fs.readFileSync(path.join(root,first.promptPath));
    expect(Buffer.from(first.prompt,'utf8')).toEqual(frozenBytes);
    const reused=freezeTask(appPath,root,'native');
    expect(reused.prompt).toBe(first.prompt);
    expect(Buffer.from(reused.prompt,'utf8')).toEqual(frozenBytes);
    expect(reused.id).toBe(first.id);
    expect(sha(fs.readFileSync(path.join(root,readState(root).tasks!.native!.promptPath)))).toBe(first.promptSha256);
    const newer=freezeTask(appPath,root,'native',true);
    expect(newer.id).not.toBe(first.id);
    expect(fs.existsSync(path.join(root,first.promptPath))).toBe(true);
  });
  it('NA08 rejects a tampered frozen prompt without rewriting the original task',()=>{
    const {root}=fixture();
    const first=freezeTask(appPath,root,'native');
    fs.appendFileSync(path.join(root,first.promptPath),'\r\nUNAUTHORIZED_PROMPT_EDIT');
    expect(()=>freezeTask(appPath,root,'native')).toThrow(/FROZEN_TASK_PROMPT_TAMPERED/);
    expect(readState(root).tasks?.native?.id).toBe(first.id);
    expect(readState(root).tasks?.native?.status).toBe('FROZEN');
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
  it('NF01-01/02/04/05: Native Review includes exact approved sections, WAV, words, captions and offsets only once',()=>{
    const {root}=stageFixture(),state=readState(root);
    const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const evidence=task.prompt.split('## B2 — NATIVE SOURCE EVIDENCE (VERIFIED, READ-ONLY)')[1]
      ?.split('## C — ONE IMMUTABLE CURRENT TARGET')[0]??'';
    expect(evidence).toContain('"text": "One two three"');
    expect(evidence).toContain('"duration_seconds": 30');
    expect(evidence).toContain('"word": "One"');
    expect(evidence).toContain('"start": 0.1');
    expect(evidence).toContain('"approved_caption_cues"');
    expect(evidence).toContain('"lead": 0');
    expect(evidence).toContain('"tail": 0');
    expect(evidence).toContain('"trim_start": 0');
    expect(evidence).toContain(state.voice!.sha256);
    expect(evidence).toContain(state.alignment!.wordsSha256);
    expect(evidence).not.toContain('"characters":');
    expect(evidence).not.toContain('"loss":');
    expect(task.prompt.match(/## B2 — NATIVE SOURCE EVIDENCE/g)).toHaveLength(1);
    expect(task.prompt).not.toContain('## ACTUAL AUTHORING SOURCE (COMPACT PROJECTION');
  });
  it('NF01-03: Correct and Recheck see the same original authoritative Native evidence',()=>{
    const {root}=stageFixture();
    confirmReview(root);
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'DRAFT',editablePaths:['/shot_ledger/0/meaning'],findingIds:['N-001']
    }) as Task;
    expect(correct.prompt).toContain('## B2 — NATIVE SOURCE EVIDENCE');
    expect(correct.prompt).toContain('"duration_seconds": 30');
    const artifact=structuredClone(readNativeDraft(root)!.artifact);
    (artifact.shot_ledger as Array<{shot_id:string;meaning:string}>)[0].meaning='The object moves from danger to safety.';
    const result=stageLifecycleResult(appPath,root,'native','correct',delivery(root,correct,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:correct.editableIds,
      editable_paths:correct.editablePaths,artifact
    }));
    confirmLifecycleResult(appPath,root,result.token);
    const recheck=freezeLifecycleTask(appPath,root,'native','recheck',{targetContext:'DRAFT'}) as Task;
    expect(recheck.prompt).toContain('## B2 — NATIVE SOURCE EVIDENCE');
    expect(recheck.prompt).toContain('"duration_seconds": 30');
    expect(recheck.prompt).toContain('"word": "One"');
  });
  it('NF01-06: edited word-alignment bytes invalidate a frozen Native review even when decoded words look identical',()=>{
    const {root}=stageFixture();
    const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    fs.appendFileSync(path.join(root,readState(root).alignment!.path),' ');
    expect(()=>stageLifecycleResult(appPath,root,'native','review',
      delivery(root,task,'review',reviewPayload(task,'REVIEWED_NO_FINDINGS'))))
      .toThrow(/NATIVE_LIFECYCLE_WORDS_SHA_MISMATCH/);
  });
  it('NF01-07: Script lifecycle retains its independent source-specific prompt without Native evidence',()=>{
    const {root}=fixture();
    freezeTask(appPath,root,'script');
    const task=freezeLifecycleTask(appPath,root,'script','review') as Task;
    expect(task.prompt).toContain('SCRIPT REVIEW');
    expect(task.prompt).not.toContain('## B2 — NATIVE SOURCE EVIDENCE');
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
  it('NC03 scope suggestion infers only a source-explicit existing auxiliary field, never a whole ledger',()=>{
    const {root}=stageFixture();
    const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const explicit={...issue(),evidence:{kind:'manifest',
      detail:'The exact existing /shot_ledger/0/meaning field has no visible state change.'}};
    const proposal=stageLifecycleResult(appPath,root,'native','review',
      delivery(root,task,'review',reviewPayload(task,'REVIEWED_WITH_FINDINGS',[explicit])));
    confirmLifecycleResult(appPath,root,proposal.token);
    const suggested=suggestedCorrectScope(root,readState(root),'native','DRAFT');
    expect(suggested.editablePaths).toEqual(['/shot_ledger/0/meaning']);
    expect(suggested.editableIds).toEqual([]); // Auxiliary-only evidence never authorizes whole-Shot edits.
  });
  it('NF04-01/02/03: a verified auxiliary-only finding freezes no editable Shot and rejects Shot mutation',()=>{
    const {root}=stageFixture();const review=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const finding={...issue(),evidence:{kind:'manifest',detail:'Exact /shot_ledger/0/meaning omits the visible delta.'}};
    const reported=stageLifecycleResult(appPath,root,'native','review',
      delivery(root,review,'review',reviewPayload(review,'REVIEWED_WITH_FINDINGS',[finding])));
    confirmLifecycleResult(appPath,root,reported.token);
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{targetContext:'DRAFT'}) as Task;
    expect(correct.editableIds).toEqual([]);
    expect(correct.editablePaths).toEqual(['/shot_ledger/0/meaning']);
    const original=readNativeDraft(root)!.artifact;
    const unauthorized=structuredClone(original);
    ((unauthorized.manifest as {shots:Array<{layers:Array<{text:string}>}>}).shots[0].layers[0]).text='Unauthorized edit';
    expect(()=>stageLifecycleResult(appPath,root,'native','correct',
      delivery(root,correct,'correct',{schema:'mode-b-correction-v1',
        artifact_sha256:correct.artifactSha256,finding_ids:correct.findingIds,
        editable_ids:[],editable_paths:correct.editablePaths,artifact:unauthorized})))
      .toThrow(/Locked native\/creative field/);
    const corrected=structuredClone(original);
    (corrected.shot_ledger as Array<{meaning:string}>)[0].meaning='The object visibly moves into safety.';
    const staged=stageLifecycleResult(appPath,root,'native','correct',delivery(root,correct,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:[],editable_paths:correct.editablePaths,artifact:corrected
    }));
    confirmLifecycleResult(appPath,root,staged.token);
    expect(readNativeDraft(root)!.artifact).toEqual(corrected);
  });
  it('NF04-04/06: explicit mixed Shot and auxiliary scope remains supported while other Shots stay locked',()=>{
    const {root}=stageFixture(),review=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const mixed={...issue(),editable_paths:['/shot_ledger/0/meaning','/manifest/shots/0/layers/0/text'],evidence:{kind:'manifest',
      detail:'Both /shot_ledger/0/meaning and /manifest/shots/0/layers/0/text require a matching visible action.'}};
    const reviewed=stageLifecycleResult(appPath,root,'native','review',
      delivery(root,review,'review',reviewPayload(review,'REVIEWED_WITH_FINDINGS',[mixed])));
    confirmLifecycleResult(appPath,root,reviewed.token);
    const suggested=suggestedCorrectScope(root,readState(root),'native','DRAFT');
    expect(suggested.editableIds).toEqual([]);
    expect(suggested.editablePaths).toEqual(['/shot_ledger/0/meaning','/manifest/shots/0/layers/0/text']);
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'DRAFT',editableIds:[],
      editablePaths:['/shot_ledger/0/meaning','/manifest/shots/0/layers/0/text'],findingIds:['N-001']
    }) as Task;
    const artifact=structuredClone(readNativeDraft(root)!.artifact);
    ((artifact.manifest as {shots:Array<{layers:Array<{text:string}>}>}).shots[0].layers[0]).text='Action is now visible';
    (artifact.shot_ledger as Array<{meaning:string}>)[0].meaning='The action causes a visible state change.';
    const staged=stageLifecycleResult(appPath,root,'native','correct',delivery(root,correct,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:correct.editableIds,
      editable_paths:correct.editablePaths,artifact
    }));
    confirmLifecycleResult(appPath,root,staged.token);
    expect(readNativeDraft(root)!.artifact).toEqual(artifact);
  });
  it('NF05-01/02/03: WITH_FINDINGS rejects resolved-only, accepts supported open or uncertain',()=>{
    for(const findingStatus of ['open','uncertain'] as const){
      const {root}=stageFixture();
      const task=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
      expect(()=>stageLifecycleResult(appPath,root,'native','review',
        delivery(root,task,'review',reviewPayload(task,'REVIEWED_WITH_FINDINGS',[issue('resolved')]))))
        .toThrow(/REVIEW_WITH_FINDINGS_REQUIRES_UNRESOLVED_FINDING/);
      const pending=stageLifecycleResult(appPath,root,'native','review',delivery(root,task,'review',
        reviewPayload(task,'REVIEWED_WITH_FINDINGS',[{...issue(),status:findingStatus}])));
      confirmLifecycleResult(appPath,root,pending.token);
      expect(suggestedCorrectScope(root,readState(root),'native','DRAFT').findingIds).toEqual(['N-001']);
    }
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
    })).toThrow(/overly broad|whole-root|Invalid|CORRECT_SCOPE_EXCEEDS_STRUCTURED_REVIEW/i);
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
    confirmReview(root,['/manifest/shots/0/layers/0/path']);
    const correct=freezeLifecycleTask(appPath,root,'native','correct',{targetContext:'DRAFT',editablePaths:['/manifest/shots/0/layers/0/path'],findingIds:['N-001']}) as Task;
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
  it('NF02/NF01 integrated: Author -> Draft Review/Correct/Recheck -> mocked G-Labs -> original CLI confirm',async()=>{
    const {root,staged}=stageFixture(true),lastGood=fs.readFileSync(path.join(root,'project.json'));
    confirmDraftCorrection(root);
    const recheck=freezeLifecycleTask(appPath,root,'native','recheck',{targetContext:'DRAFT'}) as Task;
    const reviewed=stageLifecycleResult(appPath,root,'native','recheck',
      delivery(root,recheck,'recheck',reviewPayload(recheck,'REVIEWED_NO_FINDINGS',[issue('resolved')])));
    confirmLifecycleResult(appPath,root,reviewed.token);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(lastGood);
    const userData=fs.mkdtempSync(path.join(os.tmpdir(),'native-glabs-integration-'));
    const cipher={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),
      decryptString:(value:Buffer)=>value.toString('utf8')};
    const crc=(bytes:Buffer)=>{let sum=0xffffffff;for(const byte of bytes){sum^=byte;for(let k=0;k<8;k++)sum=(sum>>>1)^((sum&1)?0xedb88320:0);}return(sum^0xffffffff)>>>0;};
    const chunk=(name:string,data:Buffer)=>{const label=Buffer.from(name,'ascii'),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([label,data])));return Buffer.concat([size,label,data,checksum]);};
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(90,0);ihdr.writeUInt32BE(160,4);ihdr[8]=8;ihdr[9]=6;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
      chunk('IDAT',deflateSync(Buffer.alloc(160*(1+90*4)))),chunk('IEND',Buffer.alloc(0))]);
    const decode=(bytes:Buffer)=>({png:bytes,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
    const paid:string[]=[];
    try{
      saveGlabsKey(userData,cipher,'test-only-secret');
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
        const route=new URL(String(input)).pathname,method=options?.method??'GET';
        if(method==='POST'){paid.push(route);return new Response(JSON.stringify({task_id:'ab12cd34',status:'pending'}),{status:202});}
        if(route==='/api/health')return new Response(JSON.stringify({status:'ok'}),{status:200});
        if(route==='/api/tasks')return new Response(JSON.stringify({tasks:[]}),{status:200});
        if(route==='/api/status/ab12cd34')return new Response(JSON.stringify({task_id:'ab12cd34',status:'completed'}),{status:200});
        if(route==='/api/result/ab12cd34')return new Response(JSON.stringify({task_id:'ab12cd34',status:'completed',results:['http://127.0.0.1:8765/api/files/draft.png']}),{status:200});
        if(route==='/api/files/draft.png')return new Response(new Uint8Array(png),{status:200,headers:{'Content-Type':'image/png'}});
        throw new Error('Unexpected provider mock route: '+route);
      }));
      const pending=getPendingMedia(appPath,root)!;
      const image=pending.missing.find(item=>item.kind==='image')!;
      const job=await submitGlabsImage(appPath,root,userData,cipher,{
        targetKey:image.key,prompt:'Owner-approved image for a specific surviving Native shot',
        model:'nano_banana_2',aspectRatio:'9:16',references:[],authorized:true
      },decode);
      expect((await pollGlabsImage(appPath,root,userData,cipher,job.id,decode)).status).toBe('VALIDATED');
      expect(approveGlabsImage(appPath,root,job.id,'Original owner licensed artwork',decode).job.status).toBe('APPROVED');
      expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(lastGood);
      const core=validator();
      await confirmImport(appPath,root,staged.response.token,{validator:core.run,previewSeconds:30});
      expect(core.calls.some(call=>call.includes('validate'))).toBe(true);
      expect(readState(root).external.native).toBeDefined();
      expect(readNativeDraft(root)).toBeNull();
      expect(paid).toEqual(['/api/image/generate']);
    }finally{fs.rmSync(userData,{recursive:true,force:true});}
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


/** RF01 real confirmed two-finding Review. F-A is auxiliary-only on shot-1,
 * F-B authorizes a distinct shot-2; RF-C is a resolved, ineligible finding. */
function confirmRf01Review(root:string,context:'DRAFT'|'PUBLISHED'='DRAFT'){
  const review=freezeLifecycleTask(appPath,root,'native','review',{targetContext:context}) as Task;
  const findings=[
    {...issue(),id:'RF-A',evidence:{kind:'manifest',detail:'The exact /shot_ledger/0/meaning lacks a visible before/after state.'}},
    {...issue(),id:'RF-B',target_ids:['shot-2'],editable_paths:['/manifest/shots/1/layers/0/text'],
      requirement:'shot-2 action and pose must show the transition',
      evidence:{kind:'manifest',detail:'The current /manifest/shots/1/layers/0/text fails to show the action.'}},
    {...issue('resolved'),id:'RF-C',target_ids:['shot-2']}
  ];
  const pending=stageLifecycleResult(appPath,root,'native','review',
    delivery(root,review,'review',reviewPayload(review,'REVIEWED_WITH_FINDINGS',findings)));
  confirmLifecycleResult(appPath,root,pending.token);
  return review;
}
const rf01Freeze=(root:string,ids:string[],extra:Record<string,unknown>={})=>
  freezeLifecycleTask(appPath,root,'native','correct',{
    targetContext:'DRAFT',findingIds:ids,...extra}) as Task;

describe('RF01 — Native Correct subset authorization and confirmed lineage',()=>{
  it('RF01-01 selects Shot F-B without inheriting F-A auxiliary pointer',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=rf01Freeze(root,['RF-B']);
    expect(task.findingIds).toEqual(['RF-B']);
    expect(task.editableIds).toEqual([]);
    expect(task.editablePaths).toEqual(['/manifest/shots/1/layers/0/text']);
    expect(task.prompt).toContain('"RF-B"');
    expect(task.prompt).toContain('"shot-2"');
    expect(task.prompt).toContain('/manifest/shots/1/layers/0/text');
  });
  it('RF01-02 selects auxiliary F-A without unlocking F-B or the whole shot-1',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=rf01Freeze(root,['RF-A']);
    expect(task.findingIds).toEqual(['RF-A']);
    expect(task.editableIds).toEqual([]);
    expect(task.editablePaths).toEqual(['/shot_ledger/0/meaning']);
    expect(readState(root).lifecycle!.tasks['native:correct'].sourceReviewTaskId).toBeTruthy();
  });
  it('RF01-03 defaults to both unresolved findings with exactly both kinds of rights',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=freezeLifecycleTask(appPath,root,'native','correct',{targetContext:'DRAFT'}) as Task;
    expect(task.findingIds).toEqual(['RF-A','RF-B']);
    expect(task.editableIds).toEqual([]);
    expect(task.editablePaths).toEqual(['/shot_ledger/0/meaning','/manifest/shots/1/layers/0/text']);
    const suggestions=suggestedCorrectScope(root,readState(root),'native','DRAFT',['RF-B']);
    expect(suggestions).toMatchObject({findingIds:['RF-B'],editableIds:[],editablePaths:['/manifest/shots/1/layers/0/text']});
  });
  it('RF01-04 mixed evidence supports the explicit Shot and the exact auxiliary pointer',()=>{
    const {root}=stageFixture();
    const review=freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}) as Task;
    const mixed={...issue(),id:'RF-M',editable_paths:['/shot_ledger/0/meaning','/manifest/shots/0/layers/0/text'],evidence:{kind:'manifest',
      detail:'Both /shot_ledger/0/meaning and /manifest/shots/0/layers/0/text omit the visible action.'}};
    const pending=stageLifecycleResult(appPath,root,'native','review',
      delivery(root,review,'review',reviewPayload(review,'REVIEWED_WITH_FINDINGS',[mixed])));
    confirmLifecycleResult(appPath,root,pending.token);
    const task=rf01Freeze(root,['RF-M']);
    expect(task.editableIds).toEqual([]);
    expect(task.editablePaths).toEqual(['/shot_ledger/0/meaning','/manifest/shots/0/layers/0/text']);
  });
  it('RF01-05 explicit empty Shot rights never refill from selected F-B',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=rf01Freeze(root,['RF-A','RF-B'],{editableIds:[]});
    expect(task.editableIds).toEqual([]);
    expect(task.editablePaths).toEqual(['/shot_ledger/0/meaning','/manifest/shots/1/layers/0/text']);
  });
  it('RF01-06 explicit empty auxiliary paths never refill from selected F-A',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    expect(()=>rf01Freeze(root,['RF-A','RF-B'],{editablePaths:[]})).toThrow(/Correct requires/);
  });
  it('RF01-07 unselected auxiliary finding cannot be changed using Shot-only rights',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=rf01Freeze(root,['RF-B']);
    const corrected=structuredClone(readNativeDraft(root)!.artifact);
    (corrected.shot_ledger as Array<{meaning:string}>)[0].meaning='UNAUTHORIZED CHANGE FROM RF-A';
    expect(()=>stageLifecycleResult(appPath,root,'native','correct',delivery(root,task,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
      finding_ids:task.findingIds,editable_ids:task.editableIds,
      editable_paths:task.editablePaths,artifact:corrected
    }))).toThrow(/Locked native\/creative field changed/);
    expect(readNativeDraft(root)!.artifact.shot_ledger).not.toEqual(corrected.shot_ledger);
  });
  it('RF01-08 unknown, resolved and stale Review finding IDs fail closed',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    for(const id of ['UNKNOWN-ID','RF-C']){
      expect(()=>rf01Freeze(root,[id])).toThrow(/CORRECT_FINDING_SCOPE_INVALID/);
    }
    expect(()=>rf01Freeze(root,['RF-B','RF-B'])).toThrow(/CORRECT_FINDING_SCOPE_INVALID/);
    // A newly corrected current artifact cannot borrow findings from a prior SHA.
    const correct=rf01Freeze(root,['RF-A']);
    const changed=structuredClone(readNativeDraft(root)!.artifact);
    (changed.shot_ledger as Array<{meaning:string}>)[0].meaning='The action now visibly changes state.';
    const proposal=stageLifecycleResult(appPath,root,'native','correct',delivery(root,correct,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
      finding_ids:correct.findingIds,editable_ids:correct.editableIds,
      editable_paths:correct.editablePaths,artifact:changed}));
    confirmLifecycleResult(appPath,root,proposal.token);
    expect(()=>rf01Freeze(root,['RF-B'])).toThrow(/CORRECT_FINDING_SCOPE_INVALID/);
  });
  it('RF01-09 reuse preserves frozen scope; altered subset requires explicit Rebuild',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const first=rf01Freeze(root,['RF-B']);
    const reused=rf01Freeze(root,['RF-B']);
    expect(reused.id).toBe(first.id);
    expect(reused.inputSha256).toBe(first.inputSha256);
    expect(reused.editableIds).toEqual(['shot-2']);
    expect(reused.editablePaths).toEqual([]);
    expect(()=>rf01Freeze(root,['RF-A'])).toThrow(/FROZEN_TASK_REBUILD_REQUIRED/);
    expect(readState(root).lifecycle!.tasks['native:correct'].id).toBe(first.id);
    const rebuilt=freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'DRAFT',findingIds:['RF-A']},true) as Task;
    expect(rebuilt.id).not.toBe(first.id);
    expect(rebuilt.findingIds).toEqual(['RF-A']);
    expect(rebuilt.editableIds).toEqual([]);
    expect(rebuilt.editablePaths).toEqual(['/shot_ledger/0/meaning']);
  });
  it('RF01-10 changed editable IDs, paths or findings in imported correction are rejected',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const task=rf01Freeze(root,['RF-B']);
    const artifact=structuredClone(readNativeDraft(root)!.artifact);
    const payload={schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
      finding_ids:task.findingIds,editable_ids:task.editableIds,
      editable_paths:task.editablePaths,artifact};
    for(const patch of [
      {editable_ids:['shot-1']},{editable_paths:['/shot_ledger/0/meaning']},
      {finding_ids:['RF-A']}
    ]){
      expect(()=>stageLifecycleResult(appPath,root,'native','correct',
        delivery(root,task,'correct',{...payload,...patch})))
        .toThrow(/Correction scope, findings or artifact binding mismatch/);
    }
  });
  it('RF01-11 Draft auxiliary Correct cannot mutate last-good published project.json',()=>{
    const {root}=stageFixture();confirmRf01Review(root);
    const prior=fs.readFileSync(path.join(root,'project.json'));
    const task=rf01Freeze(root,['RF-A']);
    const corrected=structuredClone(readNativeDraft(root)!.artifact);
    (corrected.shot_ledger as Array<{meaning:string}>)[0].meaning='Visible change is unambiguous.';
    const staged=stageLifecycleResult(appPath,root,'native','correct',
      delivery(root,task,'correct',{schema:'mode-b-correction-v1',
        artifact_sha256:task.artifactSha256,finding_ids:task.findingIds,
        editable_ids:task.editableIds,editable_paths:task.editablePaths,artifact:corrected}));
    confirmLifecycleResult(appPath,root,staged.token);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(prior);
    expect(readNativeDraft(root)!.artifact).toEqual(corrected);
  });
  it('RF01-12 Published Shot-only Correct retains original native CLI validation',async()=>{
    const {root,staged}=stageFixture();
    await confirmImport(appPath,root,staged.response.token,{validator:validator().run,previewSeconds:30});
    const before=fs.readFileSync(path.join(root,'project.json'));
    const review=confirmRf01Review(root,'PUBLISHED');
    const task=freezeLifecycleTask(appPath,root,'native','correct',{
      targetContext:'PUBLISHED',findingIds:['RF-B']}) as Task;
    expect(readState(root).lifecycle!.tasks['native:correct'].sourceReviewTaskId).toBe(review.id);
    expect(task.editableIds).toEqual(['shot-2']);
    expect(task.editablePaths).toEqual([]);
    const manifest=JSON.parse(before.toString('utf8')) as {shots:Array<{layers:Array<{text?:string}>}>};
    manifest.shots[1].layers[0].text='An explicit Shot-2 correction';
    const current=readState(root).external.native!.artifact as {shotLedger?:unknown[];soundScript?:unknown[];assetNeeds?:unknown[]};
    const artifact={manifest,shot_ledger:current.shotLedger??[],
      sound_script:current.soundScript??[],asset_needs:current.assetNeeds??[]};
    const proposed=stageLifecycleResult(appPath,root,'native','correct',delivery(root,task,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
      finding_ids:task.findingIds,editable_ids:task.editableIds,
      editable_paths:task.editablePaths,artifact}));
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    const cli=validator();
    await confirmLifecycleResult(appPath,root,proposed.token,{validator:cli.run});
    expect(cli.calls.some(call=>call.includes('validate'))).toBe(true);
    expect((JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')) as typeof manifest).shots[1].layers[0].text)
      .toBe('An explicit Shot-2 correction');
  });
});

describe('Native Author re-freeze: safe project-open recovery',()=>{
  it('ND-REC01 opens a project with stale draft provenance without deleting the original pending Author payload',async()=>{
    const {root}=fixture();
    stageNative(root,nativePayload(root));
    const draftBefore=readNativeDraft(root)!;
    const pendingFile=path.join(root,'.studio','external','pending.json');
    const pendingBytes=fs.readFileSync(pendingFile);
    const manifestBytes=fs.readFileSync(path.join(root,'project.json'));
    const newTask=freezeTask(appPath,root,'native',true);
    expect(newTask.id).not.toBe(draftBefore.authorTaskId);
    expect(()=>readNativeDraft(root)).toThrow(/NATIVE_DRAFT_STALE_AUTHOR_TASK/);
    const snapshot=await projectSnapshot(root,appPath);
    expect(snapshot.project.id).toBe(readState(root).project.id);
    expect(snapshot.nativeDraft).toBeNull();
    expect(snapshot.nativeDraftRecovery).toBe('NATIVE_DRAFT_STALE_AUTHOR_TASK');
    expect(fs.readFileSync(pendingFile)).toEqual(pendingBytes);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(manifestBytes);
    expect(()=>freezeLifecycleTask(appPath,root,'native','review',{targetContext:'DRAFT'}))
      .toThrow(/NATIVE_DRAFT_STALE_AUTHOR_TASK/);
  });
  it('ND-REC02 imports a newly bound Author reply and recovers DRAFT without changing the preserved former response',async()=>{
    const {root}=fixture();
    stageNative(root,nativePayload(root));
    const oldPending=JSON.parse(fs.readFileSync(path.join(root,'.studio','external','pending.json'),'utf8')) as {responsePath:string};
    const originalResponseFile=path.join(root,oldPending.responsePath);
    const originalBytes=fs.readFileSync(originalResponseFile);
    const next=freezeTask(appPath,root,'native',true);
    const state=readState(root);
    const envelope={schema:'mode-b-external-result-v1',project_id:state.project.id,
      task_id:next.id,revision:next.revision,input_sha256:next.inputSha256,stage:'native',
      payload:nativePayload(root)};
    const staged=stageImport(appPath,root,'native',JSON.stringify(envelope));
    expect(['STAGED','WAITING_FOR_MEDIA']).toContain(staged.status);
    const snapshot=await projectSnapshot(root,appPath);
    expect(snapshot.nativeDraftRecovery).toBeNull();
    expect(snapshot.nativeDraft?.authorTaskId).toBe(next.id);
    expect(fs.readFileSync(originalResponseFile)).toEqual(originalBytes);
  });
  it('ND-REC03 still blocks project open when staged pending payload integrity is invalid',async()=>{
    const {root}=fixture();
    stageNative(root,nativePayload(root));
    const file=path.join(root,'.studio','external','pending.json');
    const pending=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    pending.payloadSha256='0'.repeat(64);
    fs.writeFileSync(file,JSON.stringify(pending));
    await expect(projectSnapshot(root,appPath)).rejects.toThrow(/Pending imported payload was modified/);
  });
});
