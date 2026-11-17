// @vitest-environment node
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {confirmLifecycleResult,freezeLifecycleTask,stageLifecycleResult,suggestedCorrectScope} from '../../src/main/externalLifecycle';
import {freezeTask,stageImport,confirmImport,externalOutputFilename,validateScript} from '../../src/main/externalTasks';
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


  it('REG-08: confirmed Script Author JSON activates automatically without manual approval',async()=>{
    const root=timeFreezeFixture(),state=readState(root),task=state.tasks!.script!;
    const candidate=state.scriptCandidate!;
    expect(state.approvedScript).toBeUndefined();
    const response={
      schema:'mode-b-external-result-v1',project_id:state.project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'script',payload:{schema:'mode-b-script-v1',
        sections:candidate.sections,authoring:candidate.authoring}
    };
    const staged=stageImport(appPath,root,'script',JSON.stringify(response));
    await confirmImport(appPath,root,staged.token);
    const activated=readState(root);
    expect(activated.approvedScript?.approvedBy).toBe('AUTO');
    expect(activated.approvedScript?.sections).toEqual(candidate.sections);
    expect(activated.approvedScript?.authoring).toEqual(candidate.authoring);
    expect(activated.tasks?.script?.status).toBe('IMPORTED');
    expect(activated.scriptCandidate?.taskId).toBe(task.id);
  });
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
    expect(preAppendix).toContain('Finding field contract (no sample finding and no placeholder target IDs):');
    expect(preAppendix).not.toContain('"<real-section-id>"');
    expect(preAppendix).not.toContain('INSUFFICIENT_EVIDENCE: no-findings media review');
  });

  it('CONTRACT REG-01: frozen Script Review identity has no preset review status or findings',()=>{
    const root=timeFreezeFixture(),task=freezeLifecycleTask(appPath,root,'script','review');
    const g=task.prompt.split('## G — RESPONSE CONTRACT')[1]?.split('## H — ORIGINAL FROZEN AUTHOR TASK')[0]??'';
    const reference=g.split('Frozen identity (immutable fields, NOT a complete review result):\n\n')[1]
      ?.split('\n\nReview payload field contract (no preset outcome):')[0];
    expect(reference).toBeTruthy();
    const frozen=JSON.parse(reference!) as Record<string,unknown>;
    expect(frozen).toEqual({
      schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'script',operation:'review',
      payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256}
    });
    const payload=frozen.payload as Record<string,unknown>;
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('findings');
    expect(payload).not.toHaveProperty('coverage');
    expect(g).not.toMatch(/"status"\s*:\s*"(?:REVIEWED_NO_FINDINGS|REVIEWED_WITH_FINDINGS|INSUFFICIENT_EVIDENCE|NOT_VERIFIED)"/);
    expect(g).toContain('The Review response has no preset outcome.');
    expect(g).toContain('Independently evaluate every requested section and the complete authoring JSON');
    expect(g).toContain('Assemble exactly one complete JSON object');
    for(const status of ['REVIEWED_WITH_FINDINGS','REVIEWED_NO_FINDINGS','INSUFFICIENT_EVIDENCE','NOT_VERIFIED'])
      expect(g).toContain(status+' —');
    expect(g).toContain('missing WAV/MP4 alone does NOT cause this status');
    const requested=readState(root).scriptCandidate!.sections.map(row=>row.id);
    expect(g).toContain(JSON.stringify({target_ids:requested,modalities:['script'],ranges:[],media_sha256s:[]},null,2));
  });
  it('CONTRACT REG-02: finding reference uses real frozen target inventory and never a fake target placeholder',()=>{
    const root=timeFreezeFixture(),task=freezeLifecycleTask(appPath,root,'script','review');
    const prompt=task.prompt,g=prompt.split('## G — RESPONSE CONTRACT')[1]?.split('## H — ORIGINAL FROZEN AUTHOR TASK')[0]??'';
    expect(g).toContain('Finding field contract (no sample finding and no placeholder target IDs):');
    expect(prompt).not.toContain('<real-section-id>');
    for(const field of ['id','severity','status','target_ids','requirement','evidence','evidence.detail','recommendation'])
      expect(g).toContain(field+' —');
    expect(g).toContain('target_ids — non-empty array containing ONLY real section IDs listed in REVIEW COVERAGE');
    expect(g).toContain('manifest for direct Script/authoring JSON evidence');
    expect(g).toContain('Never use observed to claim audio/video inspection');
    expect(g).not.toContain('"id": "F-001"');
    expect(g).not.toContain('Backpack motion does not establish jacket');
    expect(g).toContain('Do not supply source_sha256 or time_range without actual supporting evidence');
    expect(g).toContain('recommendation — concrete repair guidance');
  });
  it('CONTRACT REG-03: all supported Script review decisions remain import-compatible; fake target and schema fail closed',()=>{
    type Case={status:string; findings:unknown[];targetIds?:string[]};
    // Each case gets an independent frozen task and pending journal.
    const cases:Case[]=[
      {status:'REVIEWED_WITH_FINDINGS',findings:[{
        id:'F-001',severity:'major',status:'open',target_ids:['opening'],
        requirement:'Story setup must support the opening claim.',
        evidence:{kind:'manifest',detail:'Text content in the synthetic fixture'},
        recommendation:'Clarify the related narration while preserving other sections.'
      }]},
      {status:'REVIEWED_NO_FINDINGS',findings:[]},
      {status:'INSUFFICIENT_EVIDENCE',targetIds:[],findings:[{
        id:'F-uncertain',severity:'minor',status:'uncertain',target_ids:['opening'],
        requirement:'Required evidence for a hypothetical additional claim.',
        evidence:{kind:'unverified',detail:'Synthetic status-contract fixture: evidence was not supplied for this hypothetical verification.'},
        recommendation:'Provide the missing textual evidence for this hypothetical verification.'
      }]}
    ];
    for(const item of cases){
      const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review'),state=readState(root);
      const envelope={
        schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,
        task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
        stage:'script',operation:'review',payload:{
          schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,
          status:item.status,
          coverage:{target_ids:item.targetIds??['opening','payoff'],modalities:['script'],ranges:[],media_sha256s:[]},
          findings:item.findings
        }
      };
      expect(()=>stageLifecycleResult(appPath,root,'script','review',JSON.stringify(envelope))).not.toThrow();
    }
    const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review'),state=readState(root);
    const wrap=(findings:unknown[])=>JSON.stringify({
      schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
      stage:'script',operation:'review',payload:{
        schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_WITH_FINDINGS',
        coverage:{target_ids:['opening','payoff'],modalities:['script'],ranges:[],media_sha256s:[]},findings
      }
    });
    const supported={id:'F-001',severity:'major',status:'open',target_ids:['opening'],
      requirement:'Real requirement',evidence:{kind:'manifest',detail:'Text source evidence'},
      recommendation:'Specific repair'};
    expect(()=>stageLifecycleResult(appPath,root,'script','review',
      wrap([{...supported,target_ids:['invented_section']}]))).toThrow(/unknown.*target/i);
    expect(()=>stageLifecycleResult(appPath,root,'script','review',
      wrap([{...supported,evidence:{kind:'imaginary',detail:'Unsupported evidence'}}]))).toThrow(/evidence/i);
  });
  it('CONTRACT REG-04 / REG-05: reuse preserves frozen identity/filename; rebuild rejects the old response',()=>{
    const root=fixture(),first=freezeLifecycleTask(appPath,root,'script','review');
    const originalFile=fs.readFileSync(path.join(root,first.promptPath),'utf8');
    const same=freezeLifecycleTask(appPath,root,'script','review');
    expect([same.id,same.revision,same.inputSha256,same.promptSha256])
      .toEqual([first.id,first.revision,first.inputSha256,first.promptSha256]);
    expect(same.prompt).toBe(originalFile);
    const filename=externalOutputFilename('script','review',first.revision,first.id);
    expect(first.prompt).toContain('JSON FILE DELIVERY — REQUIRED');
    expect(first.prompt).toContain(filename);
    expect(first.prompt).toContain('actual attachment/download artifact');
    expect(first.prompt).toContain('never claim creation or fabricate a download link');
    const oldResult=JSON.stringify({
      schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
      task_id:first.id,revision:first.revision,input_sha256:first.inputSha256,
      stage:'script',operation:'review',payload:{
        schema:'mode-b-review-v1',artifact_sha256:first.artifactSha256,
        status:'REVIEWED_NO_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:['script'],ranges:[],media_sha256s:[]},findings:[]
      }
    });
    const rebuilt=freezeLifecycleTask(appPath,root,'script','review',{},true);
    expect(rebuilt.id).not.toBe(first.id);
    expect(rebuilt.revision).toBe(first.revision+1);
    expect(rebuilt.inputSha256).toBe(first.inputSha256);
    const nextFilename=externalOutputFilename('script','review',rebuilt.revision,rebuilt.id);
    expect(nextFilename).not.toBe(filename);
    expect(rebuilt.prompt).toContain(nextFilename);
    expect(()=>stageLifecycleResult(appPath,root,'script','review',oldResult)).toThrow(/binding mismatch/i);
  });
  it('REG-F01-01 / REG-F01-02: generated Script Correct prompt specifies only schema, sections and authoring, excluding candidate metadata',()=>{
    const root=fixture();
    const task=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening']});
    const contract=task.prompt.split('SCRIPT CORRECT — EXACT ARTIFACT CONTRACT')[1]
      ?.split('## JSON FILE DELIVERY — REQUIRED')[0]??'';
    expect(contract).toContain('payload.artifact must be a COMPLETE mode-b-script-v1 object');
    expect(contract).toContain('containing EXACTLY these three top-level fields:');
    expect([...contract.matchAll(/^([1-3])\\. (schema|sections|authoring)$/gm)]
      .map(match=>match[2])).toEqual(['schema','sections','authoring']);
    expect(contract).toContain('Must equal "mode-b-script-v1"');
    expect(contract).toContain('Each section must contain EXACTLY:');
    expect(contract).toContain('- id: unchanged existing section ID');
    expect(contract).toContain('- text: spoken narration');
    expect(contract).toContain('Preserve all section IDs and their original order.');
    expect(contract).toContain('Modify text ONLY for explicitly authorized editable section IDs.');
    expect(contract).toContain('Preserve every locked section text exactly.');
    expect(contract).toContain('Preserve it unchanged unless a specific authoring field path');
    expect(contract).toContain('Return the complete corrected artifact, not a partial patch.');
    for(const field of ['text','sha256','revision','importedAt','taskId',
      'approvedAt','approvedBy','approvalNote'])
      expect(contract).toContain('- '+field+'\\n');
    expect(contract).toContain('but they are NOT fields of mode-b-script-v1.');
    expect(task.prompt.split('SCRIPT CORRECT — EXACT ARTIFACT CONTRACT').length).toBe(2);
  });

  it('REG-F01-05: exact corrected Script artifact imports; candidate metadata stays rejected by existing validator',()=>{
    const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening']});
    const candidate=readState(root).scriptCandidate!;
    const artifact={schema:'mode-b-script-v1',
      sections:candidate.sections.map(row=>row.id==='opening'
        ?{id:row.id,text:'The real storm now forces a clear decision.'}
        :{id:row.id,text:row.text}),
      authoring:candidate.authoring!};
    expect(Object.keys(artifact)).toEqual(['schema','sections','authoring']);
    expect(validateScript(artifact)).toEqual(artifact);
    const envelope=(payloadArtifact:Record<string,unknown>)=>JSON.stringify({
      schema:'mode-b-lifecycle-result-v1',
      project_id:readState(root).project.id,task_id:task.id,revision:task.revision,
      input_sha256:task.inputSha256,stage:'script',operation:'correct',
      payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,
        finding_ids:task.findingIds??[],editable_ids:task.editableIds??[],
        editable_paths:task.editablePaths??[],artifact:payloadArtifact}
    });
    for(const field of ['text','sha256','revision','importedAt','taskId',
      'approvedAt','approvedBy','approvalNote']){
      const malformed={...artifact,[field]:'unapproved candidate metadata'};
      expect(()=>validateScript(malformed)).toThrow();
      expect(()=>stageLifecycleResult(appPath,root,'script','correct',envelope(malformed))).toThrow();
    }
    expect(()=>stageLifecycleResult(appPath,root,'script','correct',
      envelope({...artifact,sections:[{...artifact.sections[0],sha256:'not a section field'},artifact.sections[1]]}))).toThrow();
    const staged=stageLifecycleResult(appPath,root,'script','correct',envelope(artifact));
    expect(staged.token).toBeTruthy();
  });

  it('CONTRACT REG-06: other stage/operation prompts retain their separate response contracts',()=>{
    const root=fixture();
    const correct=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening']});
    expect(correct.prompt).toContain('ORIGINAL FROZEN AUTHOR TASK — IMMUTABLE REFERENCE APPENDIX');
    expect(correct.prompt).toContain('RESPONSE CONTRACT — NO PRESET OUTCOME');
    expect(correct.prompt).toContain('SCRIPT CORRECT');
    expect(correct.prompt).toContain('mode-b-correction-v1');
    expect(correct.prompt).not.toContain('JSON RESPONSE CONTRACT | replace the example status/findings');
    expect(()=>freezeLifecycleTask(appPath,root,'script','recheck')).toThrow(/RECHECK_LINEAGE_REQUIRED/);
    const scripted=freezeLifecycleTask(appPath,root,'script','review');
    expect(scripted.prompt).toContain('Frozen identity (immutable fields, NOT a complete review result):');
    // Native and media remain separately checked by the existing ten-task regression suite.
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

  it('AUTO-CORRECT-01: confirmed current-review findings become the Correct scope without manual IDs',()=>{
    const root=fixture(),state=readState(root),review=freezeLifecycleTask(appPath,root,'script','review');
    const response={
      schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,
      task_id:review.id,revision:review.revision,input_sha256:review.inputSha256,
      stage:'script',operation:'review',payload:{
        schema:'mode-b-review-v1',artifact_sha256:review.artifactSha256,
        status:'REVIEWED_WITH_FINDINGS',
        coverage:{target_ids:['opening','payoff'],modalities:['script'],ranges:[],media_sha256s:[]},
        findings:[
          {id:'F-open',severity:'major',status:'open',target_ids:['opening'],
            requirement:'Establish a readable causal hook.',evidence:{kind:'manifest',detail:'The opening has a factual causal gap.'},recommendation:'Clarify opening.'},
          {id:'F-resolved',severity:'minor',status:'resolved',target_ids:['payoff'],
            requirement:'Preserve payoff consistency.',evidence:{kind:'manifest',detail:'The payoff remains coherent.'},recommendation:'No change required.'}
        ]
      }
    };
    const staged=stageLifecycleResult(appPath,root,'script','review',JSON.stringify(response));
    confirmLifecycleResult(root,staged.token);
    const suggested=suggestedCorrectScope(root,readState(root),'script');
    expect(suggested).toMatchObject({findingIds:['F-open'],editableIds:['opening'],reviewTaskId:review.id});
    const correct=freezeLifecycleTask(appPath,root,'script','correct');
    expect(correct.findingIds).toEqual(['F-open']);
    expect(correct.editableIds).toEqual(['opening']);
    expect(correct.prompt).toContain('F-open');
    expect(correct.prompt).toContain('"opening"');
    const updated=readState(root);
    updated.scriptCandidate!.sections[0].text='A completely new Script version.';
    updated.scriptCandidate!.text=updated.scriptCandidate!.sections.map(x=>x.text).join('\n\n');
    updated.scriptCandidate!.sha256=awaitHash(updated.scriptCandidate!.text);
    writeState(root,updated);
    expect(suggestedCorrectScope(root,readState(root),'script').findingIds).toEqual([]);
    expect(()=>freezeLifecycleTask(appPath,root,'script','correct')).toThrow(/requires unresolved findings/);
  });

  it('binds independent review to the exact candidate and never approves it',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','review');expect(task.prompt).toContain('causal');expect(task.prompt).toContain('B4');const result={schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'review',payload:{schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,status:'REVIEWED_WITH_FINDINGS',coverage:{target_ids:['opening','payoff'],modalities:[],ranges:[]},findings:[{id:'F-1',severity:'major',status:'open',target_ids:['opening'],requirement:'opening threat',evidence:{kind:'manifest',detail:'threat lacks consequence'},recommendation:'strengthen causal consequence'}]}};const pending=stageLifecycleResult(appPath,root,'script','review',JSON.stringify(result));confirmLifecycleResult(root,pending.token);expect(readState(root).approvedScript).toBeUndefined();expect(readState(root).lifecycle?.artifacts[task.id].status).toBe('REVIEWED_WITH_FINDINGS')});
  it('rejects correction outside the explicit section lock and accepts a scoped candidate',()=>{const root=fixture(),task=freezeLifecycleTask(appPath,root,'script','correct',{editableIds:['opening']});const base=readState(root).scriptCandidate!;const envelope=(sections:typeof base.sections)=>({schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script',operation:'correct',payload:{schema:'mode-b-correction-v1',artifact_sha256:task.artifactSha256,finding_ids:[],editable_ids:['opening'],editable_paths:[],artifact:{schema:'mode-b-script-v1',sections,authoring:base.authoring}}});expect(()=>stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'Changed.'},{id:'payoff',text:'Unauthorized.'}])))).toThrow(/Locked (?:entity|native\/creative field)/);const pending=stageLifecycleResult(appPath,root,'script','correct',JSON.stringify(envelope([{id:'opening',text:'The storm destroys the only shelter, forcing action.'},base.sections[1]])));confirmLifecycleResult(root,pending.token);expect(readState(root).scriptCandidate?.sections[0].text).toContain('forcing action');expect(readState(root).approvedScript).toBeUndefined()});
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
    expect(recheck.prompt).toContain('SCRIPT RECHECK — TEXT EVIDENCE AND ACTIVATION GATE');
    expect(recheck.prompt).toContain('Missing WAV/MP4 does not automatically mean INSUFFICIENT_EVIDENCE');
    expect(recheck.prompt).toContain('Required exact finding IDs: ["F-001"]');
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
