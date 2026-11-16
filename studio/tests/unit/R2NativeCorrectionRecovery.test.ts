// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,it,expect} from 'vitest';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {confirmImport} from '../../src/main/externalTasks';
import {readState,sha} from '../../src/main/services';
import {appPath,cleanup,fixture,nativePayload,stageNative,validator} from './SixIssueFixtures';

afterEach(cleanup);

async function baseline(){
  const {root}=fixture({style:'B1'});
  const {response}=stageNative(root,nativePayload(root));
  const cli=validator();
  await confirmImport(appPath,root,response.token,{validator:cli.run});
  expect(readState(root).nativeReadiness?.fullReady).toBe(true);
  const before=fs.readFileSync(path.join(root,'project.json'));
  const task=freezeLifecycleTask(appPath,root,'native','correct',{editableIds:['shot-1']});
  const manifest=JSON.parse(before.toString('utf8')) as Record<string,unknown>;
  const shots=manifest.shots as Array<{id:string;layers:Array<{text?:string}>}>;
  shots[0].layers[0].text='Correction of an authorized shot only';
  const corrected={manifest,shot_ledger:[],sound_script:[],asset_needs:[]};
  const state=readState(root);
  const envelope={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:task.id,
    revision:task.revision,input_sha256:task.inputSha256,stage:'native',operation:'correct',
    payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,finding_ids:[],
      editable_ids:['shot-1'],editable_paths:[],artifact:corrected}};
  const staged=stageLifecycleResult(appPath,root,'native','correct',JSON.stringify(envelope));
  return{root,task,staged,before,cli,corrected};
}
describe('R2 Native correction transaction failure and retry',()=>{
  it('fails before staging and recovers without consuming the lifecycle task or losing last-good manifest',async()=>{
    const {root,task,staged,before,cli,corrected}=await baseline();
    const run=()=>Promise.resolve(confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run,
      hooks:{afterJournal:()=>{throw new Error('Injected after journal');}}}));
    await expect(run()).rejects.toThrow(/Injected after journal/);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    expect(readState(root).lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
    expect(fs.existsSync(path.join(root,'.studio/external/lifecycle/pending.json'))).toBe(true);
    await confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run});
    expect(readState(root).lifecycle?.tasks['native:correct'].status).toBe('IMPORTED');
    expect(readState(root).lifecycle?.artifacts[task.id].taskId).toBe(task.id);
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'))).toEqual(corrected.manifest);
  });
  it('retains last-good and pending lifecycle task when original Native validation fails, then retries',async()=>{
    const {root,task,staged,before,cli,corrected}=await baseline();
    const failing=validator({sampleFail:true});
    await expect(Promise.resolve(confirmLifecycleResult(appPath,root,staged.token,{validator:failing.run})))
      .rejects.toThrow(/Injected original CLI validation failure/);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    expect(readState(root).lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
    await confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run});
    expect(readState(root).lifecycle?.artifacts[task.id].taskId).toBe(task.id);
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'))).toEqual(corrected.manifest);
  });
  it('recovers after Native staging without consuming a task or overwriting last-good',async()=>{
    const {root,task,staged,before,cli,corrected}=await baseline();
    await expect(Promise.resolve(confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run,
      hooks:{afterStaging:()=>{throw new Error('Injected staged-media transaction boundary');}}})))
      .rejects.toThrow(/Injected staged-media/);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    expect(readState(root).lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
    await confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run});
    expect(readState(root).lifecycle?.artifacts[task.id].taskId).toBe(task.id);
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'))).toEqual(corrected.manifest);
  });
  it('recovers when lifecycle finalization is interrupted after validated native publication',async()=>{
    const {root,task,staged,cli,corrected}=await baseline();
    await expect(Promise.resolve(confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run,
      hooks:{afterNativeCommit:()=>{throw new Error('Injected post-publish interruption');}}})))
      .rejects.toThrow(/Injected post-publish interruption/);
    const state=readState(root);
    expect(state.lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
    expect(state.nativeReadiness?.sourceFingerprint).toBe(sha(fs.readFileSync(path.join(root,'project.json'))));
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'))).toEqual(corrected.manifest);
    await confirmLifecycleResult(appPath,root,staged.token,{validator:cli.run});
    const latest=readState(root);
    expect(latest.lifecycle?.tasks['native:correct'].status).toBe('IMPORTED');
    expect(latest.lifecycle?.artifacts[task.id].taskId).toBe(task.id);
    expect(fs.existsSync(path.join(root,'.studio/external/lifecycle/native-publication.json'))).toBe(false);
  });
});

async function auxiliaryProposal(editablePaths:string[],modify:(artifact:{manifest:Record<string,unknown>;shot_ledger:unknown[];sound_script:unknown[];asset_needs:unknown[]})=>void){
  const {root}=fixture({style:'B1'});
  const staged=stageNative(root,nativePayload(root));
  const cli=validator();
  await confirmImport(appPath,root,staged.response.token,{validator:cli.run});
  const before=fs.readFileSync(path.join(root,'project.json'));
  const state=readState(root);
  const old=state.external.native!.artifact as {shotLedger?:unknown[];soundScript?:unknown[];assetNeeds?:unknown[]};
  const artifact={manifest:JSON.parse(before.toString('utf8')) as Record<string,unknown>,
    shot_ledger:structuredClone(old.shotLedger??[]),sound_script:structuredClone(old.soundScript??[]),
    asset_needs:structuredClone(old.assetNeeds??[])};
  const task=freezeLifecycleTask(appPath,root,'native','correct',{editablePaths});
  modify(artifact);
  const value={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:task.id,
    revision:task.revision,input_sha256:task.inputSha256,stage:'native',operation:'correct',
    payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,finding_ids:[],
      editable_ids:[],editable_paths:editablePaths,artifact}};
  const stagedCorrection=stageLifecycleResult(appPath,root,'native','correct',JSON.stringify(value));
  return{root,task,token:stagedCorrection.token,before,artifact,cli};
}
describe('R2 auxiliary-only publication and complete artifact identity',()=>{
  it('publishes sound_script without changing manifest bytes or invoking native CLI',async()=>{
    const p=await auxiliaryProposal(['/sound_script'],a=>{a.sound_script=[{target_id:'shot-1',intent:'Quiet scene ambience'}];});
    const beforeState=readState(p.root),beforeReadiness=JSON.stringify(beforeState.nativeReadiness);
    const beforePreview=JSON.stringify(beforeState.preview),beforeApproval=JSON.stringify(beforeState.approval);
    await confirmLifecycleResult(appPath,p.root,p.token,{validator:async()=>{throw new Error('CLI must not run for auxiliary-only metadata');}});
    const after=readState(p.root);
    expect(fs.readFileSync(path.join(p.root,'project.json'))).toEqual(p.before);
    expect((after.external.native!.artifact as {soundScript:unknown[]}).soundScript).toEqual(p.artifact.sound_script);
    expect(after.external.native!.revision).toBe(beforeState.external.native!.revision+1);
    expect(JSON.stringify(after.nativeReadiness)).toBe(beforeReadiness);
    expect(JSON.stringify(after.preview)).toBe(beforePreview);
    expect(JSON.stringify(after.approval)).toBe(beforeApproval);
    expect(after.lifecycle?.tasks['native:correct'].status).toBe('IMPORTED');
  });
  it('persists shot and asset ledgers without losing other authoring data',async()=>{
    const p=await auxiliaryProposal(['/shot_ledger','/asset_needs'],a=>{
      a.shot_ledger=[{shot_id:'shot-1',narrative_purpose:'Clear causal action'}];
      a.asset_needs=[{shot_id:'shot-1',intent:'New image needed, not yet supplied'}];
    });
    await confirmLifecycleResult(appPath,p.root,p.token);
    const a=readState(p.root).external.native!.artifact as {shotLedger:unknown[];assetNeeds:unknown[]};
    expect(a.shotLedger).toEqual(p.artifact.shot_ledger);
    expect(a.assetNeeds).toEqual(p.artifact.asset_needs);
    expect(fs.readFileSync(path.join(p.root,'project.json'))).toEqual(p.before);
  });
  it('handles complete no-op without a revision bump or invented validation',async()=>{
    const p=await auxiliaryProposal(['/sound_script'],()=>{});
    const revision=readState(p.root).external.native!.revision;
    await confirmLifecycleResult(appPath,p.root,p.token,{validator:async()=>{throw new Error('no-op may not call CLI');}});
    expect(readState(p.root).external.native!.revision).toBe(revision);
    expect(fs.readFileSync(path.join(p.root,'project.json'))).toEqual(p.before);
  });
  it('retains a recoverable proposal if auxiliary publication is interrupted',async()=>{
    const p=await auxiliaryProposal(['/sound_script'],a=>{a.sound_script=[{intent:'Causal foley'}];});
    await expect(Promise.resolve(confirmLifecycleResult(appPath,p.root,p.token,{
      hooks:{afterNativeCommit:()=>{throw new Error('Injected auxiliary finalization failure');}}})))
      .rejects.toThrow(/Injected auxiliary finalization/);
    expect(fs.readFileSync(path.join(p.root,'project.json'))).toEqual(p.before);
    expect(readState(p.root).lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
    await confirmLifecycleResult(appPath,p.root,p.token,{validator:async()=>{throw new Error('retry cannot call CLI');}});
    expect((readState(p.root).external.native!.artifact as {soundScript:unknown[]}).soundScript)
      .toEqual(p.artifact.sound_script);
    expect(readState(p.root).lifecycle?.tasks['native:correct'].status).toBe('IMPORTED');
  });
  it('rejects mutation of global native fields not in auxiliary scope',async()=>{
    const {root}=fixture({style:'B1'});
    const {response}=stageNative(root,nativePayload(root));
    await confirmImport(appPath,root,response.token,{validator:validator().run});
    const state=readState(root),task=freezeLifecycleTask(appPath,root,'native','correct',
      {editablePaths:['/sound_script']});
    const existing=state.external.native!.artifact as {shotLedger?:unknown[];soundScript?:unknown[];assetNeeds?:unknown[]};
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')) as Record<string,unknown>;
    manifest.fps=15;
    const result={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:task.id,
      revision:task.revision,input_sha256:task.inputSha256,stage:'native',operation:'correct',
      payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
        finding_ids:[],editable_ids:[],editable_paths:['/sound_script'],
        artifact:{manifest,shot_ledger:existing.shotLedger??[],
          sound_script:existing.soundScript??[],asset_needs:existing.assetNeeds??[]}}};
    expect(()=>stageLifecycleResult(appPath,root,'native','correct',JSON.stringify(result)))
      .toThrow(/Locked native\/creative field/);
    expect(readState(root).lifecycle?.tasks['native:correct'].status).toBe('FROZEN');
  });
});
