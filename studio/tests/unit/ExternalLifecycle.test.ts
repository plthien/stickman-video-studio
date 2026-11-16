// @vitest-environment node
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {approveScriptCandidate} from '../../src/main/externalTasks';
import {afterEach,describe,expect,it} from 'vitest';
import {confirmLifecycleResult,freezeLifecycleTask,stageLifecycleResult} from '../../src/main/externalLifecycle';
import {projectId,readState,writeState,type StudioState} from '../../src/main/services';

const roots:string[]=[];const appPath=path.resolve('.');
afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-life-'));roots.push(root);fs.mkdirSync(path.join(root,'.studio'),{recursive:true});fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({version:1,style:'B4',width:1080,height:1920,fps:30,voice:{path:'assets/audio/narration.wav'},captions:[],shots:[],sfx:[]}));const text='A storm closes in. The survivor must act.';const state:StudioState={schema:'mode-b-studio-state-v1',project:{id:projectId(root),root,title:'Survival',style:'B4',updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},brief:{topic:'survival',language:'English',ratio:'9:16'},external:{script:{revision:1,artifact:{},importedAt:new Date().toISOString()}},scriptCandidate:{sections:[{id:'opening',text},{id:'payoff',text:'A grounded solution pays off.'}],text:text+'\n\nA grounded solution pays off.',sha256:'',revision:1,importedAt:new Date().toISOString(),taskId:'author',authoring:{creative_direction:{premise:'causal survival'}}}};state.scriptCandidate!.sha256=(awaitHash(state.scriptCandidate!.text));fs.mkdirSync(path.join(root,'.studio/external/tasks'),{recursive:true});const authorPrompt='ORIGINAL FROZEN SCRIPT TASK: causal survival opening, accurate style requirements, preserve story causality.';fs.writeFileSync(path.join(root,'.studio/external/tasks/script-author.md'),authorPrompt);state.tasks={script:{id:'author',revision:1,inputSha256:'frozen',promptSha256:awaitHash(authorPrompt),promptPath:'.studio/external/tasks/script-author.md',status:'IMPORTED',createdAt:new Date().toISOString()}};fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));return root}
const awaitHash=(value:string)=>createHash('sha256').update(value).digest('hex');

describe('External creative lifecycle',()=>{
  it('binds independent review to the exact candidate and never approves it',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review');expect(task.prompt).toContain('causal');expect(task.prompt).toContain('B4');const result={schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'review',payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_WITH_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},findings:[{id:'F-1',severity:'major',status:'open',target_ids:['opening'],requirement:'opening threat',evidence:{kind:'manifest',detail:'threat lacks consequence'},recommendation:'strengthen causal consequence'}]}};const pending=stageLifecycleResult(appPath,root,'script','review',JSON.stringify(result));confirmLifecycleResult(root,pending.token);expect(readState(root).approvedScript).toBeUndefined();expect(readState(root).lifecycle?.artifacts[task.id].status).toBe('REVIEWED_WITH_FINDINGS')});
  it('rejects correction outside the explicit section lock and accepts a scoped candidate',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening'],findingIds:['F-1']});const base=readState(root).scriptCandidate!;const envelope=(sections:typeof base.sections)=>({schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'correct',payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,finding_ids:['F-1'],editable_ids:['opening'],artifact:{schema:'mode-b-script-v1',sections,authoring:base.authoring}}});expect(()=>stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'Changed.'},{id:'payoff',text:'Unauthorized.'}])))).toThrow(/Locked entity/);const pending=stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'The storm destroys the only shelter, forcing action.'},base.sections[1]])));confirmLifecycleResult(root,pending.token);expect(readState(root).scriptCandidate?.sections[0].text).toContain('forcing action');expect(readState(root).approvedScript).toBeUndefined()});
  it('rejects fabricated review target IDs, incomplete coverage and duplicate findings',()=>{
    const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review'),project_id=readState(root).project.id;
    const result=(findings:unknown[],target_ids:string[],status='REVIEWED_WITH_FINDINGS')=>JSON.stringify({
      schema:'mode-b-lifecycle-result-v1',project_id,task_id:task.id,revision:task.revision,
      input_sha256:task.inputSha256,stage:'script',operation:'review',
      payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status,
        coverage:{target_ids,modalities:[],ranges:[]},findings}
    });
    const finding=(id:string,target:string)=>({id,status:'open',severity:'major',target_ids:[target],
      requirement:'actual source rule',evidence:{kind:'manifest',detail:'verified script bytes'},
      recommendation:'repair only actual target'});
    expect(()=>stageLifecycleResult(appPath,root,'script','review',result([finding('F-001','made-up')],['opening','payoff']))).toThrow(/unknown shot\/section|unknown.*target/);
    expect(()=>stageLifecycleResult(appPath,root,'script','review',result([finding('F-001','opening')],['opening']))).toThrow(/coverage/);
    expect(()=>stageLifecycleResult(appPath,root,'script','review',result([finding('F-001','opening'),finding('F-001','payoff')],['opening','payoff']))).toThrow(/duplicate/);
  });
  it('binds staged reviews to candidate revision and rejects obsolete imports',()=>{
    const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review');
    const state=readState(root);state.scriptCandidate!.sections[0].text='Updated latest creative candidate.';
    state.scriptCandidate!.text=state.scriptCandidate!.sections.map(x=>x.text).join('\n\n');
    state.scriptCandidate!.sha256=awaitHash(state.scriptCandidate!.text);
    state.scriptCandidate!.revision++;writeState(root,state);
    const response=JSON.stringify({schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'review',
      payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,
        status:'REVIEWED_NO_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},findings:[]}});
    expect(()=>stageLifecycleResult(appPath,root,'script','review',response)).toThrow(/stale/);
  });
  it('reuses staged identical lifecycle response and never overwrites pending with a new proposal',()=>{
    const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review'),project_id=readState(root).project.id;
    const response=JSON.stringify({schema:'mode-b-lifecycle-result-v1',project_id,task_id:task.id,
      revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'review',
      payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_NO_FINDINGS',
        coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},findings:[]}});
    const first=stageLifecycleResult(appPath,root,'script','review',response);
    const second=stageLifecycleResult(appPath,root,'script','review',response);
    expect(first.token).toBe(second.token);
    expect(()=>stageLifecycleResult(appPath,root,'script','review',response.replace('REVIEWED_NO_FINDINGS','INSUFFICIENT_EVIDENCE'))).toThrow(/PENDING_LIFECYCLE_CONFLICT/);
  });
  it('corrected Script cannot approve until exact-current-candidate Recheck resolves original findings',()=>{
    const root=fixture(),project_id=readState(root).project.id;
    const review=freezeLifecycleTask(appPath,root,'script','review');
    const finding=(status:string)=>({id:'F-001',severity:'major',status,target_ids:['opening'],
      requirement:'A real causal survival opening',evidence:{kind:'manifest',detail:'Exact frozen section wording'},
      recommendation:'Repair section opening only'});
    const wrap=(task:typeof review,operation:string,payload:unknown)=>JSON.stringify({schema:'mode-b-lifecycle-result-v1',
      project_id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'script',operation,payload});
    const first=stageLifecycleResult(appPath,root,'script','review',wrap(review,'review',{
      schema:'mode-b-review-v1',artifact_sha256:review.artifactSha256,
      status:'REVIEWED_WITH_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},
      findings:[finding('open')]}));
    confirmLifecycleResult(root,first.token);
    const correction=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening'],findingIds:['F-001']});
    const candidate=readState(root).scriptCandidate!;
    const modified=structuredClone(candidate.sections);
    modified[0].text='The shelter collapses, forcing an urgent causal survival decision.';
    const result=stageLifecycleResult(appPath,root,'script','correct',wrap(correction,'correct',{
      schema:'mode-b-correction-v1',artifact_sha256:correction.artifactSha256,
      finding_ids:['F-001'],editable_ids:['opening'],editable_paths:[],
      artifact:{schema:'mode-b-script-v1',sections:modified,authoring:candidate.authoring}}));
    confirmLifecycleResult(root,result.token);
    expect(()=>approveScriptCandidate(root,'Accept repaired narration')).toThrow(/RECHECK_REQUIRED/);
    const recheck=freezeLifecycleTask(appPath,root,'script','recheck',{findingIds:['F-001']});
    const reviewed=stageLifecycleResult(appPath,root,'script','recheck',wrap(recheck,'recheck',{
      schema:'mode-b-review-v1',artifact_sha256:recheck.artifactSha256,
      status:'REVIEWED_NO_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},
      findings:[finding('resolved')]}));
    confirmLifecycleResult(root,reviewed.token);
    const accepted=approveScriptCandidate(root,'Owner checked corrected narration and evidence');
    expect(accepted.approvedScript?.sections[0].text).toContain('forcing');
    expect(accepted.approvedScript?.sections[1]).toEqual(candidate.sections[1]);
  });
  it('fails closed when a media review has no verified transferable media',()=>{const root=fixture();expect(()=>freezeLifecycleTask(appPath,root,'script','media-review',{media:'voice'})).toThrow(/NOT_VERIFIED/)})
});
