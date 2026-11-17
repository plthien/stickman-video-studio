// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {freezeTask,stageImport,confirmImport} from '../../src/main/externalTasks';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {readExternalHistory} from '../../src/main/externalHistory';
import {readState,sha,writeState} from '../../src/main/services';
import {fixture,cleanup,appPath,stageNative,nativePayload,validator} from './SixIssueFixtures';

afterEach(cleanup);
const finding=(status:'open'|'resolved')=>({
  id:'F-HISTORY',severity:'major',status,target_ids:['opening'],
  requirement:'Maintain causal narration.',
  evidence:{kind:'manifest',detail:'The current exact section text establishes the cause.'},
  recommendation:'Clarify the causal link inside the current Script.'
});
const result=(root:string,task:ReturnType<typeof freezeLifecycleTask>,
  operation:'review'|'correct'|'recheck'|'media-review',payload:unknown)=>
  JSON.stringify({schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
    task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
    stage:task.stage,operation,payload});
async function fullScriptHistory(){
  const {root}=fixture({style:'B1'});
  const author=freezeTask(appPath,root,'script');
  const authored={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
    task_id:author.id,revision:author.revision,input_sha256:author.inputSha256,
    stage:'script',payload:{schema:'mode-b-script-v1',
      sections:[{id:'opening',text:'The old problem forces a risky decision.'}],
      authoring:{creative_direction:{premise:'A causal challenge.'}}}};
  const stagedAuthor=stageImport(appPath,root,'script',JSON.stringify(authored));
  await confirmImport(appPath,root,stagedAuthor.token);
  const review=freezeLifecycleTask(appPath,root,'script','review');
  const stagedReview=stageLifecycleResult(appPath,root,'script','review',result(root,review,'review',{
    schema:'mode-b-review-v1',artifact_sha256:review.artifactSha256,
    status:'REVIEWED_WITH_FINDINGS',
    coverage:{target_ids:['opening'],modalities:['script'],ranges:[],media_sha256s:[]},
    findings:[finding('open')]
  }));
  await Promise.resolve(confirmLifecycleResult(root,stagedReview.token));
  const correct=freezeLifecycleTask(appPath,root,'script','correct');
  const current=readState(root).scriptCandidate!;
  const stagedCorrect=stageLifecycleResult(appPath,root,'script','correct',result(root,correct,'correct',{
    schema:'mode-b-correction-v1',artifact_sha256:correct.artifactSha256,
    finding_ids:correct.findingIds,editable_ids:correct.editableIds,
    editable_paths:correct.editablePaths,artifact:{schema:'mode-b-script-v1',
      sections:[{id:'opening',text:'The collapsing shelter causes a specific dangerous decision.'}],
      authoring:current.authoring}
  }));
  await Promise.resolve(confirmLifecycleResult(root,stagedCorrect.token));
  const recheck=freezeLifecycleTask(appPath,root,'script','recheck');
  const stagedRecheck=stageLifecycleResult(appPath,root,'script','recheck',result(root,recheck,'recheck',{
    schema:'mode-b-review-v1',artifact_sha256:recheck.artifactSha256,
    status:'REVIEWED_NO_FINDINGS',
    coverage:{target_ids:['opening'],modalities:['script'],ranges:[],media_sha256s:[]},
    findings:[finding('resolved')]
  }));
  await Promise.resolve(confirmLifecycleResult(root,stagedRecheck.token));
  return {root,author,review,correct,recheck};
}
describe('REG-TAB read-only external history and integrity',()=>{
  it('REG-TAB-02/03/04/10 confirmed Author Review Correct Recheck survive Script activation and project re-read without mutation',async()=>{
    const {root,author,review,correct,recheck}=await fullScriptHistory();
    const state=readState(root);
    expect(state.approvedScript?.approvedBy).toBe('AUTO');
    expect(state.approvedScript?.sections[0].text).toContain('collapsing shelter');
    const all=[['author',author],['review',review],['correct',correct],['recheck',recheck]] as const;
    const stateFile=path.join(root,'.studio/state.json'),beforeSha=sha(fs.readFileSync(stateFile));
    for(const [operation,task] of all){
      const rows=readExternalHistory(root,'script',operation);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(task.id);
      expect(rows[0].status).toBe('IMPORTED');
      expect(rows[0].prompt).toBe(task.prompt);
      expect(rows[0].confirmedJson).toContain('"task_id":"'+task.id+'"');
      expect(rows[0].integrity).toBe('OK');
    }
    expect(readExternalHistory(root,'script','review')[0].reviewStatus).toBe('REVIEWED_WITH_FINDINGS');
    expect(readExternalHistory(root,'script','review')[0].findings[0].status).toBe('open');
    expect(readExternalHistory(root,'script','recheck')[0].reviewStatus).toBe('REVIEWED_NO_FINDINGS');
    expect(readExternalHistory(root,'script','recheck')[0].findings[0].status).toBe('resolved');
    // Reopen = new disk read. No in-memory UI or new task freezing needed.
    expect(readExternalHistory(root,'script','recheck')[0].confirmedJson).toContain('"resolved"');
    expect(sha(fs.readFileSync(stateFile))).toBe(beforeSha);
    expect(readState(root).lifecycle?.tasks['script:recheck'].id).toBe(recheck.id);
  });
  it('REG-TAB-07/08 replaced imported history remains read-only; corrupt or missing bytes never become invented JSON',async()=>{
    const {root,review}=await fullScriptHistory();
    const oldPrompt=path.join(root,readState(root).lifecycle!.tasks['script:review'].promptPath);
    const updated=freezeLifecycleTask(appPath,root,'script','review',{},true);
    expect(updated.id).not.toBe(review.id);
    const prior=readExternalHistory(root,'script','review').find(item=>item.id===review.id)!;
    expect(prior.status).toBe('IMPORTED');
    expect(prior.confirmedJson).toContain('"task_id":"'+review.id+'"');
    fs.appendFileSync(oldPrompt,'\nMUTATED');
    const tampered=readExternalHistory(root,'script','review').find(item=>item.id===review.id)!;
    expect(tampered.prompt).toBeNull();
    expect(tampered.errors).toContain('PROMPT_HASH_MISMATCH');
    expect(tampered.confirmedJson).toBeTruthy();
    const resultFile=path.join(root,'.studio/external/lifecycle/results',review.id+'.json');
    fs.unlinkSync(resultFile);
    const missing=readExternalHistory(root,'script','review').find(item=>item.id===review.id)!;
    expect(missing.confirmedJson).toBeNull();
    expect(missing.errors).toContain('RESPONSE_MISSING');
    expect(readState(root).lifecycle?.tasks['script:review'].id).toBe(updated.id);
  });
  it('REG-TAB-02/03 Native Author and Native Review results remain readable after confirmation and review rebuild',async()=>{
    const {root}=fixture({style:'B1'});
    const native=stageNative(root,nativePayload(root));
    await confirmImport(appPath,root,native.response.token,{validator:validator().run});
    const importedAuthor=readExternalHistory(root,'native','author');
    expect(importedAuthor).toHaveLength(1);
    expect(importedAuthor[0].status).toBe('IMPORTED');
    expect(importedAuthor[0].confirmedJson).toContain('"stage":"native"');
    const review=freezeLifecycleTask(appPath,root,'native','review');
    const staged=stageLifecycleResult(appPath,root,'native','review',result(root,review,'review',{
      schema:'mode-b-review-v1',artifact_sha256:review.artifactSha256,
      status:'REVIEWED_NO_FINDINGS',
      coverage:{target_ids:['shot-1','shot-2'],modalities:['manifest'],ranges:[],media_sha256s:[]},
      findings:[]
    }));
    await Promise.resolve(confirmLifecycleResult(root,staged.token));
    expect(readExternalHistory(root,'native','review')[0].status).toBe('IMPORTED');
    expect(readExternalHistory(root,'native','review')[0].confirmedJson).toContain('"REVIEWED_NO_FINDINGS"');
    const next=freezeLifecycleTask(appPath,root,'native','review',{},true);
    const archived=readExternalHistory(root,'native','review');
    expect(archived.map(item=>item.id)).toEqual([next.id,review.id]);
    expect(archived[1].status).toBe('IMPORTED');
    expect(archived[1].confirmedJson).toContain('"REVIEWED_NO_FINDINGS"');
  });

  it('REG-STALE-01 confirmed Native Author remains readable after a genuinely new Script activates and retires Native',async()=>{
    const {root}=fixture({style:'B1'});
    const native=stageNative(root,nativePayload(root));
    await confirmImport(appPath,root,native.response.token,{validator:validator().run});
    const nativeTask=readState(root).tasks!.native!;
    expect(nativeTask.confirmedResponseSha256).toMatch(/^[a-f0-9]{64}$/);
    const author=freezeTask(appPath,root,'script');
    const response=JSON.stringify({schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
      task_id:author.id,revision:author.revision,input_sha256:author.inputSha256,
      stage:'script',payload:{schema:'mode-b-script-v1',
        sections:[{id:'opening',text:'A collapsing rock bridge leaves one dangerous choice.'}],
        authoring:{creative_direction:{premise:'The falling bridge forces a decision.'}}}});
    const pending=stageImport(appPath,root,'script',response);
    await confirmImport(appPath,root,pending.token);
    expect(readState(root).tasks!.native!.status).toBe('STALE');
    const before=fs.readFileSync(path.join(root,'.studio/state.json'));
    const rows=readExternalHistory(root,'native','author');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('STALE');
    expect(rows[0].confirmedJson).toContain('"task_id":"'+nativeTask.id+'"');
    expect(rows[0].integrity).toBe('OK');
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    expect(readState(root).tasks!.native!.id).toBe(nativeTask.id);
  });
  it('REG-STALE-02 refuses a corrupted confirmed Native Author response without legacy fallback',async()=>{
    const {root}=fixture({style:'B1'});
    const native=stageNative(root,nativePayload(root));
    await confirmImport(appPath,root,native.response.token,{validator:validator().run});
    const state=readState(root),task=state.tasks!.native!;
    task.status='STALE';writeState(root,state);
    fs.appendFileSync(path.join(root,task.confirmedResponsePath!),'CORRUPT');
    const row=readExternalHistory(root,'native','author')[0];
    expect(row.status).toBe('STALE');
    expect(row.confirmedJson).toBeNull();
    expect(row.errors).toContain('RESPONSE_HASH_MISMATCH');
  });
  it('REG-STALE-03 never mistakes an unconfirmed staged Native response for confirmed history',()=>{
    const {root}=fixture({style:'B1'});
    const staged=stageNative(root,nativePayload(root));
    expect(staged.response.status).toBe('STAGED');
    const unconfirmed=readState(root).tasks!.native!;
    const next=freezeTask(appPath,root,'native',true);
    expect(next.id).not.toBe(unconfirmed.id);
    const old=readExternalHistory(root,'native','author').find(row=>row.id===unconfirmed.id)!;
    expect(old.status).toBe('STALE');
    expect(old.confirmedJson).toBeNull();
    expect(old.integrity).toBe('OK');
    expect(fs.existsSync(path.join(root,'.studio/external/responses',
      'native-'+unconfirmed.id+'-'+unconfirmed.revision+'-'+
      sha(fs.readFileSync(path.join(root,'.studio/external/pending.json')).toString())+'.json'))).toBe(false);
    expect(readState(root).tasks!.native!.id).toBe(next.id);
  });
  it('REG-STALE-04 restores legacy Script Author after STALE only with matching published Script artifact',async()=>{
    const {root,author}=await fullScriptHistory();
    const state=readState(root);
    state.tasks!.script!.status='STALE';
    delete state.tasks!.script!.confirmedResponseSha256;
    delete state.tasks!.script!.confirmedResponsePath;
    writeState(root,state);
    const before=fs.readFileSync(path.join(root,'.studio/state.json'));
    const recovered=readExternalHistory(root,'script','author')[0];
    expect(recovered).toMatchObject({status:'STALE',integrity:'OK'});
    expect(recovered.confirmedJson).toContain('"task_id":"'+author.id+'"');
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    const wrong=readState(root);wrong.external.script!.artifact={schema:'mode-b-script-v1',sections:[],authoring:{}};
    writeState(root,wrong);
    const rejected=readExternalHistory(root,'script','author')[0];
    expect(rejected.confirmedJson).toBeNull();
    expect(rejected.errors).toContain('LEGACY_RESPONSE_NOT_VERIFIABLE');
  });
  it('REG-STALE-04 lifecycle STALE review needs its confirmed artifact record and original response',async()=>{
    const {root}=await fullScriptHistory();
    const state=readState(root);
    state.lifecycle!.tasks['script:review'].status='STALE';writeState(root,state);
    const row=readExternalHistory(root,'script','review')[0];
    expect(row.status).toBe('STALE');
    expect(row.confirmedJson).toContain('"REVIEWED_WITH_FINDINGS"');
    const unbound=readState(root);
    delete unbound.lifecycle!.artifacts[unbound.lifecycle!.tasks['script:review'].id];
    writeState(root,unbound);
    expect(readExternalHistory(root,'script','review')[0].confirmedJson).toBeNull();
  });
  it('REG-F04-03 legacy Media Review task remains readable but cannot be created anew',()=>{
    const {root}=fixture({style:'B1'});freezeTask(appPath,root,'script');
    const review=freezeLifecycleTask(appPath,root,'script','review');
    const state=readState(root);
    const legacyPath='.studio/external/lifecycle/tasks/legacy-voice.md';
    const legacyText='PERSISTED LEGACY MEDIA REVIEW PROMPT — TEST FIXTURE ONLY';
    fs.writeFileSync(path.join(root,legacyPath),legacyText);
    state.lifecycle!.tasks['script:media-review']={
      ...state.lifecycle!.tasks['script:review'],id:'legacy-voice',revision:7,
      operation:'media-review',mediaKind:'voice',status:'STALE',
      promptPath:legacyPath,promptSha256:sha(legacyText)};
    writeState(root,state);
    const before=fs.readFileSync(path.join(root,'.studio/state.json'));
    const legacy=readExternalHistory(root,'script','media-review','voice');
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({id:'legacy-voice',status:'STALE',
      prompt:legacyText,confirmedJson:null,integrity:'OK'});
    expect(readExternalHistory(root,'script','media-review','captions')).toEqual([]);
    expect(()=>freezeLifecycleTask(appPath,root,'script','media-review',{media:'voice'}))
      .toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    expect(readState(root).lifecycle!.tasks['script:review'].id).toBe(review.id);
  });

  it('REG-F01-01 restores one legacy Author response by exact filename, SHA and immutable envelope without writing state',async()=>{
    const {root,author}=await fullScriptHistory();
    const state=readState(root);
    delete state.tasks!.script!.confirmedResponseSha256;
    delete state.tasks!.script!.confirmedResponsePath;
    writeState(root,state);
    const before=fs.readFileSync(path.join(root,'.studio/state.json'));
    const recovered=readExternalHistory(root,'script','author')[0];
    expect(recovered.id).toBe(author.id);
    expect(recovered.integrity).toBe('OK');
    expect(recovered.confirmedJson).toContain('"task_id":"'+author.id+'"');
    expect(recovered.errors).toEqual([]);
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
  });
  it('REG-F01-02 refuses tampered or wrong-identity legacy bytes even with a matching filename SHA',async()=>{
    const {root,author}=await fullScriptHistory();
    const state=readState(root),relative=state.tasks!.script!.confirmedResponsePath!;
    const actual=path.join(root,relative);
    const original=fs.readFileSync(actual,'utf8');
    delete state.tasks!.script!.confirmedResponseSha256;
    delete state.tasks!.script!.confirmedResponsePath;
    writeState(root,state);
    fs.appendFileSync(actual,'TAMPERED');
    expect(readExternalHistory(root,'script','author')[0].confirmedJson).toBeNull();
    expect(readExternalHistory(root,'script','author')[0].errors).toContain('LEGACY_RESPONSE_NOT_VERIFIABLE');
    fs.unlinkSync(actual);
    const wrong={...(JSON.parse(original) as Record<string,unknown>),project_id:'not-the-current-project'};
    const bytes=JSON.stringify(wrong),digest=sha(bytes);
    const name='script-'+author.id+'-'+author.revision+'-'+digest+'.json';
    fs.writeFileSync(path.join(root,'.studio/external/responses',name),bytes);
    const record=readExternalHistory(root,'script','author')[0];
    expect(record.confirmedJson).toBeNull();
    expect(record.errors).toContain('LEGACY_RESPONSE_NOT_VERIFIABLE');
  });
  it('REG-F01-03 refuses ambiguous legacy Author responses instead of choosing by timestamp',async()=>{
    const {root,author}=await fullScriptHistory();
    const state=readState(root),original=fs.readFileSync(path.join(root,state.tasks!.script!.confirmedResponsePath!),'utf8');
    delete state.tasks!.script!.confirmedResponseSha256;
    delete state.tasks!.script!.confirmedResponsePath;
    writeState(root,state);
    const second=JSON.stringify(JSON.parse(original),null,2);
    const secondName='script-'+author.id+'-'+author.revision+'-'+sha(second)+'.json';
    fs.writeFileSync(path.join(root,'.studio/external/responses',secondName),second);
    const record=readExternalHistory(root,'script','author')[0];
    expect(record.confirmedJson).toBeNull();
    expect(record.errors).toContain('LEGACY_RESPONSE_AMBIGUOUS');
    expect(record.integrity).toBe('PARTIAL');
  });
  it('REG-TAB-08 legacy Author without authoritative response linkage reports partial history rather than inventing confirmed JSON',()=>{
    const {root}=fixture({style:'B1'});
    const task=freezeTask(appPath,root,'script');
    const state=readState(root);
    state.tasks!.script!.status='IMPORTED';
    const file=path.join(root,'.studio/state.json');
    fs.writeFileSync(file,JSON.stringify(state));
    const history=readExternalHistory(root,'script','author')[0];
    expect(history.prompt).toBe(task.prompt);
    expect(history.confirmedJson).toBeNull();
    expect(history.errors).toContain('LEGACY_RESPONSE_NOT_VERIFIABLE');
    expect(history.integrity).toBe('PARTIAL');
  });
});
