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
