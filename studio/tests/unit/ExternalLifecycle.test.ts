// @vitest-environment node
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {confirmLifecycleResult,freezeLifecycleTask,stageLifecycleResult} from '../../src/main/externalLifecycle';
import {freezeTask} from '../../src/main/externalTasks';
import {compileAuthority,SCRIPT_AUTHOR_EXTRACTION_REVISION} from '../../src/main/externalAuthority';
import {projectId,readState,writeState,type StudioState} from '../../src/main/services';

const roots:string[]=[];const appPath=path.resolve('.');
afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-life-'));roots.push(root);fs.mkdirSync(path.join(root,'.studio'),{recursive:true});fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({version:1,style:'B4',width:1080,height:1920,fps:30,voice:{path:'assets/audio/narration.wav'},captions:[],shots:[],sfx:[]}));const text='A storm closes in. The survivor must act.';const state:StudioState={schema:'mode-b-studio-state-v1',project:{id:projectId(root),root,title:'Survival',style:'B4',updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},brief:{topic:'survival',language:'English',ratio:'9:16'},external:{script:{revision:1,artifact:{},importedAt:new Date().toISOString()}},scriptCandidate:{sections:[{id:'opening',text},{id:'payoff',text:'A grounded solution pays off.'}],text:text+'\n\nA grounded solution pays off.',sha256:'',revision:1,importedAt:new Date().toISOString(),taskId:'author',authoring:{creative_direction:{premise:'causal survival'}}}};state.scriptCandidate!.sha256=(awaitHash(state.scriptCandidate!.text));fs.mkdirSync(path.join(root,'.studio/external/tasks'),{recursive:true});const authorPrompt='ORIGINAL FROZEN SCRIPT TASK: causal survival opening, accurate style requirements, preserve story causality.';fs.writeFileSync(path.join(root,'.studio/external/tasks/script-author.md'),authorPrompt);state.tasks={script:{id:'author',revision:1,inputSha256:'frozen',promptSha256:awaitHash(authorPrompt),promptPath:'.studio/external/tasks/script-author.md',status:'IMPORTED',createdAt:new Date().toISOString()}};fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));return root}
const awaitHash=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Synthetic six-section B1 regression fixture; NOT user-approved Author Revision 3. */
function timeFreezeFixture(){
  const root=fixture(),state=readState(root);
  const sections=[
    {id:'opening',text:'At noon, every pedestrian freezes. Mira alone moves.'},
    {id:'discovery',text:'She learns the backpack on her shoulders still moves with her.'},
    {id:'first_attempt',text:'A loose leaf hangs still until she picks it up.'},
    {id:'escalation',text:'She guesses that her jacket might let a frozen person move.'},
    {id:'rescue',text:'She wraps that jacket around a frozen child and the child takes a step.'},
    {id:'resolution',text:'Sixty seconds later, everyone moves again, unaware of the strange rescue.'}
  ];
  const text=sections.map(section=>section.text).join('\n\n');
  state.project.style='B1';state.project.title='R2 Full Flow E2E';
  state.brief={topic:'What If Time Froze for One Minute?',language:'English',ratio:'9:16',targetDuration:60};
  state.scriptCandidate={
    sections,text,sha256:awaitHash(text),revision:2,importedAt:new Date().toISOString(),
    taskId:'synthetic-six-section-source',
    authoring:{
      creative_direction:{premise:'Mira moves in a frozen world for one minute.'},
      characters:[{id:'mira',description:'Mira wears a jacket and carries a backpack.'}],
      continuity:{rules:['Objects Mira carries can move; other people remain frozen.']},
      style_decisions:{visual_intent:'Express physical interaction with simple B1 acting.'},
      voice_intentions:{tone:'Curious and urgent.'},sound_intentions:{intent:'Motivated silence.'}
    }
  };
  writeState(root,state);
  freezeTask(appPath,root,'script',true);
  return root;
}

describe('External creative lifecycle',()=>{

  it('REG-01 / REG-02 / REG-05 / REG-09: Script Review sees exact B1 creative authority and one six-section target',()=>{
    const root=timeFreezeFixture(),author=readState(root).tasks!.script!;
    const original=fs.readFileSync(path.join(root,author.promptPath),'utf8');
    const review=freezeLifecycleTask(appPath,root,'script','review');
    const prompt=review.prompt,preAppendix=prompt.split('## H — ORIGINAL FROZEN AUTHOR TASK')[0];
    console.info('B1_SCRIPT_REVIEW_60S_MEASURED',JSON.stringify({
      bytes:Buffer.byteLength(prompt,'utf8'),lines:prompt.split('\n').length,
      approximateTokensByChars:Math.ceil(prompt.length/4)
    }));
    const compiled=compileAuthority(appPath,'B1','script','review');
    expect(compiled.version).toBe(SCRIPT_AUTHOR_EXTRACTION_REVISION);
    expect(compiled.sources.every(row=>row.extractionRevision===SCRIPT_AUTHOR_EXTRACTION_REVISION)).toBe(true);
    for(const style of ['B1','B2','B3','B4']){
      const focused=compileAuthority(appPath,style,'script','review');
      expect(focused.version).toBe(SCRIPT_AUTHOR_EXTRACTION_REVISION);
      expect(focused.sources.some(row=>row.path.includes('/'+style.toLowerCase()+'-'))).toBe(true);
      expect(focused.sources.find(row=>row.path==='references/autopilot-sound-system.md')!.text)
        .not.toContain('## Suspense / apocalypse module');
    }
    expect(prompt).toContain('What If Time Froze for One Minute?');
    expect(prompt).toContain('Slender proportions');
    expect(prompt).toContain('first 30 seconds');
    expect(prompt).toContain('semantic subtitles with at most one visible line');
    for(let i=1;i<=12;i++)expect(preAppendix).toContain('CR-'+String(i).padStart(2,'0'));
    for(const label of ['## A — REVIEW MISSION','## B — CURRENT PROJECT BRIEF',
      '## C — IMMUTABLE REVIEW TARGET','## D — REVIEW CRITERIA AND AUTHORITY',
      '## E — PRIOR FINDINGS','## F — REVIEW COVERAGE','## G — RESPONSE CONTRACT',
      '## H — ORIGINAL FROZEN AUTHOR TASK'])expect(prompt).toContain(label);
    for(const id of ['opening','discovery','first_attempt','escalation','rescue','resolution'])
      expect(preAppendix).toContain('"'+id+'"');
    expect(preAppendix).toContain('She learns the backpack on her shoulders still moves with her.');
    expect(preAppendix).toContain('She wraps that jacket around a frozen child');
    expect(preAppendix).not.toContain('BEGIN SOURCE ');
    expect(preAppendix).not.toContain('B3 has independent design/motion requirements');
    expect(preAppendix).not.toContain('Maintain a compact project-local shot ledger');
    expect(preAppendix).not.toContain('The renderer accepts local keyframes');
    expect(preAppendix).not.toContain('## Suspense / apocalypse module');
    expect(preAppendix).not.toContain('actual word times');
    expect(preAppendix).not.toContain('low industrial air/drone');
    expect(preAppendix.match(/## C — IMMUTABLE REVIEW TARGET/g)).toHaveLength(1);
    expect(prompt).toContain('Original frozen Author task SHA256: '+awaitHash(original));
    expect(prompt.endsWith(original+'\n')).toBe(true);
    expect(preAppendix).toContain('REVIEWED_NO_FINDINGS is NOT a default');
    expect(preAppendix).toContain('modalities=["script"]');
    expect(preAppendix).toContain('"media_sha256s": []');
    expect(preAppendix).toContain('F-001');
    expect(preAppendix).toContain('FORMAT ONLY');
    expect(preAppendix).not.toContain('INSUFFICIENT_EVIDENCE: no-findings media review');
  });
  it('REG-03 / REG-04: supported text findings and no-findings statuses validate, fabricated claims do not',()=>{
    const root=timeFreezeFixture();
    const task=freezeLifecycleTask(appPath,root,'script','review');
    const ids=['opening','discovery','first_attempt','escalation','rescue','resolution'];
    const finding=(targets:string[])=>({
      id:'F-001',severity:'major',status:'open',target_ids:targets,
      requirement:'World-rule causality must hold across sections.',
      evidence:{kind:'manifest',detail:'Backpack motion does not establish jacket transfer to another body.'},
      recommendation:'Clarify the transfer rule in escalation or revise the rescue event.'
    });
    const base=(findings:unknown[],status='REVIEWED_WITH_FINDINGS',targetIds=ids)=>({
      schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'script',operation:'review',payload:{schema:'mode-b-review-v1',
        artifact_sha256:task.artifactSha256,status,
        coverage:{target_ids:targetIds,modalities:['script'],ranges:[],media_sha256s:[]},
        findings}
    });
    const invalid=(payload:ReturnType<typeof base>)=>
      expect(()=>stageLifecycleResult(appPath,root,'script','review',JSON.stringify(payload))).toThrow();
    invalid(base([finding(['not-an-id'])]));
    invalid(base([finding(['opening']),finding(['rescue'])]));
    invalid(base([{...finding(['opening']),requirement:''}]));
    invalid(base([{...finding(['opening']),recommendation:undefined}]));
    invalid(base([{...finding(['opening']),evidence:{kind:'fabricated',detail:'Unsupported'}}]));
    invalid(base([{...finding(['opening']),evidence:{kind:'observed',detail:'Invented video inspection'}}]));
    invalid(base([finding(['opening'])],'UNKNOWN_STATUS'));
    invalid(base([],'REVIEWED_WITH_FINDINGS'));
    invalid(base([],'REVIEWED_NO_FINDINGS',['opening']));
    const valid=base([finding(['escalation','rescue'])]);
    const pending=stageLifecycleResult(appPath,root,'script','review',JSON.stringify(valid));
    expect(pending.token).toBeTruthy();
    expect(readState(root).scriptCandidate?.sections).toHaveLength(6);
    const cleanRoot=timeFreezeFixture(),cleanTask=freezeLifecycleTask(appPath,cleanRoot,'script','review');
    const clean={...base([],'REVIEWED_NO_FINDINGS'),project_id:readState(cleanRoot).project.id,
      task_id:cleanTask.id,revision:cleanTask.revision,input_sha256:cleanTask.inputSha256,
      payload:{...base([],'REVIEWED_NO_FINDINGS').payload,artifact_sha256:cleanTask.artifactSha256}};
    expect(()=>stageLifecycleResult(appPath,cleanRoot,'script','review',JSON.stringify(clean))).not.toThrow();
  });
  it('REG-01: Script Correct and Recheck use the same focused creative inventory; Media and Native retain their own authority',()=>{
    for(const style of ['B1','B2','B3','B4']){
      const author=compileAuthority(appPath,style,'script','author');
      for(const op of ['review','correct','recheck'] as const){
        const compare=compileAuthority(appPath,style,'script',op);
        expect(compare.sources.map(x=>[x.path,x.sha256,x.extractionSha256,x.extractionRevision]))
          .toEqual(author.sources.map(x=>[x.path,x.sha256,x.extractionSha256,x.extractionRevision]));
      }
      expect(compileAuthority(appPath,style,'script','media-review').version).toBe('stage-exact-v2');
      expect(compileAuthority(appPath,style,'native','review').version).toBe('stage-exact-v2');
    }
  });

  it('binds independent review to the exact candidate and never approves it',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review');expect(task.prompt).toContain('causal');expect(task.prompt).toContain('B4');const result={schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'review',payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_WITH_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},findings:[{id:'F-1',severity:'major',status:'open',target_ids:['opening'],requirement:'opening threat',evidence:{kind:'manifest',detail:'threat lacks consequence'},recommendation:'strengthen causal consequence'}]}};const pending=stageLifecycleResult(appPath,root,'script','review',JSON.stringify(result));confirmLifecycleResult(root,pending.token);expect(readState(root).approvedScript).toBeUndefined();expect(readState(root).lifecycle?.artifacts[task.id].status).toBe('REVIEWED_WITH_FINDINGS')});
  it('rejects correction outside the explicit section lock and accepts a scoped candidate',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening'],findingIds:['F-1']});const base=readState(root).scriptCandidate!;const envelope=(sections:typeof base.sections)=>({schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'correct',payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,finding_ids:['F-1'],editable_ids:['opening'],artifact:{schema:'mode-b-script-v1',sections,authoring:base.authoring}}});expect(()=>stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'Changed.'},{id:'payoff',text:'Unauthorized.'}])))).toThrow(/Locked (?:entity|native\/creative field)/);const pending=stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'The storm destroys the only shelter, forcing action.'},base.sections[1]])));confirmLifecycleResult(root,pending.token);expect(readState(root).scriptCandidate?.sections[0].text).toContain('forcing action');expect(readState(root).approvedScript).toBeUndefined()});
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
  it('corrected Script auto-activates only after exact-current-candidate clean Recheck',()=>{
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
    expect(readState(root).approvedScript).toBeUndefined();
    const recheck=freezeLifecycleTask(appPath,root,'script','recheck',{findingIds:['F-001']});
    const reviewed=stageLifecycleResult(appPath,root,'script','recheck',wrap(recheck,'recheck',{
      schema:'mode-b-review-v1',artifact_sha256:recheck.artifactSha256,
      status:'REVIEWED_NO_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},
      findings:[finding('resolved')]}));
    confirmLifecycleResult(root,reviewed.token);
    const accepted=readState(root);
    expect(accepted.approvedScript?.approvedBy).toBe('AUTO');
    expect(accepted.approvedScript?.sections[0].text).toContain('forcing');
    expect(accepted.approvedScript?.sections[1]).toEqual(candidate.sections[1]);
  });
  it('fails closed when a media review has no verified transferable media',()=>{const root=fixture();expect(()=>freezeLifecycleTask(appPath,root,'script','media-review',{media:'voice'})).toThrow(/NOT_VERIFIED/)})
});
