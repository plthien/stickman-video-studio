// @vitest-environment node
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {reconcileScriptActivation,confirmImport,freezeTask,stageImport} from '../../src/main/externalTasks';
import {projectId,readState,writeState,type StudioState} from '../../src/main/services';
import {cleanup,fixture} from './SixIssueFixtures';
const temporary:string[]=[];afterEach(()=>{temporary.splice(0).forEach(item=>fs.rmSync(item,{recursive:true,force:true}));cleanup();});
describe('frozen source-grounded manual tasks',()=>{it('automatically activates confirmed Script Author import for Voice',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-task-'));temporary.push(root);fs.mkdirSync(path.join(root,'.studio'),{recursive:true});fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({version:1,style:'B2',width:1080,height:1920,fps:30,shots:[],captions:[]}));
  const state:StudioState={schema:'mode-b-studio-state-v1',project:{id:projectId(root),root,title:'Actual project',style:'B2',updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},brief:{topic:'Actual topic',language:'Vietnamese',ratio:'9:16',audience:'Creators',purpose:'Teach'},external:{},tasks:{},nano:{endpoint:'http://127.0.0.1:3901'}};fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));
  const appPath=path.resolve('.'),first=freezeTask(appPath,root,'script'),again=freezeTask(appPath,root,'script');expect(again.id).toBe(first.id);expect(again.prompt).toBe(first.prompt);expect(first.prompt).toContain('Actual topic');expect(first.prompt).toContain('b2-colorful-handdrawn.md');expect(first.prompt).not.toContain('autopilot-runtime.md');
  const returned={schema:'mode-b-external-result-v1',project_id:state.project.id,task_id:first.id,revision:first.revision,input_sha256:first.inputSha256,stage:'script',payload:{schema:'mode-b-script-v1',sections:[{id:'intro',text:'Approved exact text.'}],authoring:{creative_direction:{},characters:[],style_decisions:{},source_references:[],voice_intentions:{},sound_intentions:{}}}};
  const pending=stageImport(appPath,root,'script',JSON.stringify(returned));await confirmImport(appPath,root,pending.token);let persisted=JSON.parse(fs.readFileSync(path.join(root,'.studio/state.json'),'utf8')) as StudioState;
  expect(persisted.scriptCandidate?.text).toBe('Approved exact text.');expect(persisted.approvedScript?.text).toBe('Approved exact text.');expect(persisted.approvedScript?.approvedBy).toBe('AUTO');expect(()=>stageImport(appPath,root,'script',JSON.stringify(returned))).toThrow(/frozen task/);
  // Previously stored candidates from the old manual-approval flow are recovered on reopen.
  persisted.approvedScript=undefined;writeState(root,persisted);
  const recovered=reconcileScriptActivation(root);
  expect(recovered.approvedScript?.text).toBe('Approved exact text.');
  expect(reconcileScriptActivation(root).approvedScript?.approvedAt).toBe(recovered.approvedScript?.approvedAt);
  it('changing Script automatically stales old Voice/Native evidence without losing its files',async()=>{
    const {root}=fixture({style:'B1'}),original=readState(root),oldVoice=original.voice!;
    const task=freezeTask(path.resolve('.'),root,'script');
    const payload={schema:'mode-b-external-result-v1',project_id:original.project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',
      payload:{schema:'mode-b-script-v1',sections:[{id:'opening',text:'The world suddenly freezes, but one person moves.'}],
        authoring:{creative_direction:{premise:'A frozen city with one moving protagonist.'}}}};
    const staged=stageImport(path.resolve('.'),root,'script',JSON.stringify(payload));
    await confirmImport(path.resolve('.'),root,staged.token);
    const saved=readState(root);
    expect(saved.approvedScript?.text).toContain('world suddenly freezes');
    expect(saved.approvedScript?.approvedBy).toBe('AUTO');
    expect(saved.voice?.stale).toBe(true);
    expect(saved.alignment).toBeUndefined();
    expect(saved.nativeReadiness).toBeUndefined();
    expect(saved.preview).toBeUndefined();
    expect(saved.approval).toBeUndefined();
    expect(saved.render).toBeUndefined();
    expect(fs.existsSync(path.join(root,oldVoice.path))).toBe(true);
  });
});
