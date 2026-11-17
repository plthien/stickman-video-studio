// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {freezeTask,stageImport,confirmImport} from '../../src/main/externalTasks';
import {freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {readExternalHistory} from '../../src/main/externalHistory';
import {readState,sha} from '../../src/main/services';
import {fixture,cleanup,appPath} from './SixIssueFixtures';

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
    expect(readExternalHistory(root,'script','review')[0].findings[0].status).toBe('open');
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
  it('REG-TAB-09 Voice and Captions histories keep distinct media-kind scopes even after replacing shared lifecycle key',()=>{
    const {root}=fixture({style:'B1'});freezeTask(appPath,root,'script');
    const voice=freezeLifecycleTask(appPath,root,'script','media-review',{media:'voice'});
    const first=readExternalHistory(root,'script','media-review','voice');
    expect(first[0].id).toBe(voice.id);
    expect(first[0].status).toBe('FROZEN');
    const captions=freezeLifecycleTask(appPath,root,'script','media-review',{media:'captions'});
    expect(readExternalHistory(root,'script','media-review','captions')[0].id).toBe(captions.id);
    const archived=readExternalHistory(root,'script','media-review','voice')[0];
    expect(archived.id).toBe(voice.id);
    expect(archived.status).toBe('STALE');
    expect(archived.prompt).toBe(voice.prompt);
    expect(readExternalHistory(root,'native','media-review','voice')).toEqual([]);
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
