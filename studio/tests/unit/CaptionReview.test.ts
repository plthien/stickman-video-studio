// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {approvedCaptionCues,approveCaptionReview,draftCaptionReview,getCaptionReview,freezeCaptionAuthorTask,importCaptionAuthorResult,autoCaptionReview} from '../../src/main/captionReview';
import {freezeTask,stageImport,importMediaFile} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,frozenEnvelope,importedSource,nativePayload,stageNative} from './SixIssueFixtures';

afterEach(cleanup);
describe('WP-B: exact word-grounded caption draft, approval and frozen native binding',()=>{
  it('G09/G10 AI caption boundaries bind exact aligned words and require owner approval',()=>{
    const {root}=fixture({approve:false}),state=readState(root);
    state.identityPolicy='v1';writeState(root,state);
    const task=freezeCaptionAuthorTask(root);
    const envelope={schema:'mode-b-caption-author-result-v1',project_id:state.project.id,
      task_id:task.taskId,input_sha256:task.inputSha256,source_sha256:task.sourceSha256,
      payload:{end_word_indices:[1,3]}};
    for(const invalid of [[1,2],[1,1,3],[4],[0,3]])
      expect(()=>importCaptionAuthorResult(root,JSON.stringify({...envelope,payload:{end_word_indices:invalid}}))).toThrow();
    const imported=importCaptionAuthorResult(root,JSON.stringify(envelope));
    expect(imported.cues).toEqual([{start:.1,end:.3,text:'One'},{start:.35,end:.9,text:'two three'}]);
    expect(readState(root).alignment!.captionReview).toBeUndefined();
    approveCaptionReview(root,'Reviewed AI semantic grouping');
    expect(approvedCaptionCues(root)).toEqual(imported.cues);
    expect(readState(root).alignment!.captionReview!.authorTaskId).toBe(task.taskId);
  });
  it('G09 technical local caption suggestion does not silently authorize v1 captions',()=>{
    const {root}=fixture({approve:false}),state=readState(root);
    state.identityPolicy='v1';writeState(root,state);
    autoCaptionReview(root);
    expect(readState(root).alignment!.captionReview).toBeUndefined();
    expect(()=>approveCaptionReview(root,'Attempt technical draft auto-approval')).toThrow('CAPTION_TECHNICAL_DRAFT');
  });
  it('UT-B01 original Core grouped words -> valid split/merge -> revisioned owner approval with exact word timing',()=>{
    const {root}=fixture({approve:false}),initial=getCaptionReview(root);
    expect(initial.original).toEqual([{start:.1,end:.9,text:'One two three'}]);expect(initial.originalBoundaries).toEqual([3]);
    const split=draftCaptionReview(root,[1,3]);
    expect(split.cues).toEqual([{start:.1,end:.3,text:'One'},{start:.35,end:.9,text:'two three'}]);
    const approved=approveCaptionReview(root,'I reviewed all spoken words and timing');
    expect(approved.revision).toBe(1);expect(approvedCaptionCues(root)).toEqual(split.cues);
    const merged=draftCaptionReview(root,[3]);expect(merged.cues).toEqual(initial.original);
    expect(approveCaptionReview(root,'Re-group to original Core segmentation').revision).toBe(2);
    expect(approvedCaptionCues(root)).toEqual(initial.original);
    expect(fs.existsSync(path.join(root,initial.originalBoundaries.length?readState(root).alignment!.captionsPath:''))).toBe(true);
  });
  it('UT-B02 omission, duplicate, reorder and modified timing/text are rejected without replacing approved cues',()=>{
    const {root}=fixture(),prior=readState(root).alignment!.captionReview!,before=fs.readFileSync(path.join(root,prior.path));
    for(const indices of [[1,1,3],[2,1,3],[1,2],[0,3],[4]])expect(()=>draftCaptionReview(root,indices)).toThrow();
    draftCaptionReview(root,[1,3]);const current=readState(root).alignment!.captionDraft!;
    fs.writeFileSync(path.join(root,current.path),JSON.stringify([{start:99,end:100,text:'Extra invented speech'}]));
    expect(()=>approveCaptionReview(root,'Should be rejected')).toThrow(/changed|stale/i);
    expect(fs.readFileSync(path.join(root,prior.path)).equals(before)).toBe(true);
    expect(approvedCaptionCues(root)).toEqual([{start:.1,end:.9,text:'One two three'}]);
  });
  it('UT-B03 unreviewed Core captions and unapproved draft cannot authorize native import',()=>{
    const {root}=fixture({approve:false});
    expect(()=>freezeTask(appPath,root,'native')).toThrow(/REVIEW_REQUIRED|Caption/);
    draftCaptionReview(root,[1,3]);
    expect(()=>freezeTask(appPath,root,'native')).toThrow(/REVIEW_REQUIRED|Caption/);
    expect(readState(root).alignment!.captionReview).toBeUndefined();
  });
  it('UT-B04 approved owner regroup passes after re-freeze; old frozen envelope rejected',()=>{
    const {root}=fixture(),task=freezeTask(appPath,root,'native'),oldEnvelope=frozenEnvelope(root,'native',nativePayload(root));
    const first=stageImport(appPath,root,'native',JSON.stringify(oldEnvelope));expect(first.status).toBe('STAGED');
    draftCaptionReview(root,[1,3]);approveCaptionReview(root,'Reviewed new semantic word split');
    expect(()=>stageImport(appPath,root,'native',JSON.stringify(oldEnvelope))).toThrow();
    const refreshed=freezeTask(appPath,root,'native',true);
    expect(refreshed.id).not.toBe(task.id);
    const newPayload=nativePayload(root),newEnvelope=frozenEnvelope(root,'native',newPayload);
    expect(stageImport(appPath,root,'native',JSON.stringify(newEnvelope)).status).toBe('STAGED');
    const unauthorized={...newPayload,manifest:{...newPayload.manifest,captions:[{start:.1,end:.9,text:'One two three'}]}};
    expect(()=>stageImport(appPath,root,'native',JSON.stringify({...newEnvelope,payload:unauthorized}))).toThrow(/approved/);
  });
  it('UT-B05 empty/newline/overflow/out-of-range and invalid B-style cues fail',()=>{
    const {root}=fixture();
    for(const bad of [{start:0,end:0,text:''},{start:0,end:31,text:'One two three'},{start:.1,end:.9,text:'One\ntwo three'},{start:.1,end:.9,text:'a'.repeat(300)}]){
      const current=nativePayload(root);
      expect(()=>stageNative(root,{...current,manifest:{...current.manifest,captions:[bad]}})).toThrow();
    }
    const state=readState(root),tooLong='a'.repeat(70),file=path.join(root,state.alignment!.path),cues=path.join(root,state.alignment!.captionsPath);
    state.approvedScript!.text=tooLong;state.approvedScript!.sections=[{id:'opening',text:tooLong}];state.approvedScript!.sha256=sha(tooLong);
    fs.writeFileSync(file,JSON.stringify({words:[{word:tooLong,start:.1,end:.9}]}));
    fs.writeFileSync(cues,JSON.stringify([{start:.1,end:.9,text:tooLong}]));
    state.alignment!.wordsSha256=sha(fs.readFileSync(file));state.alignment!.cuesSha256=sha(fs.readFileSync(cues));state.alignment!.scriptSha256=sha(tooLong);
    writeState(root,state);
    expect(()=>draftCaptionReview(root,[1])).toThrow(/readability|one-line/);
  });
  it('UT-B06 changing accepted script/audio/words invalidates review; image import alone preserves approval',()=>{
    for(const kind of ['script','wav','words']){
      const {root,voicePath,wordsPath}=fixture();
      expect(approvedCaptionCues(root)).toHaveLength(1);
      if(kind==='script'){const state=readState(root);state.approvedScript!.text='Other spoken text';writeState(root,state);}
      if(kind==='wav'){const file=path.join(root,voicePath),bytes=fs.readFileSync(file);bytes[101]^=1;fs.writeFileSync(file,bytes);}
      if(kind==='words')fs.appendFileSync(path.join(root,wordsPath),' ');
      expect(()=>approvedCaptionCues(root)).toThrow(/stale|changed|source/i);
    }
    const {root}=fixture(),before=approvedCaptionCues(root);
    const task=freezeTask(appPath,root,'native');
    importMediaFile(root,importedSource(root),'image','owner');
    expect(approvedCaptionCues(root)).toEqual(before);
    expect(readState(root).tasks?.native?.id).toBe(task.id);
    expect(readState(root).tasks?.native?.status).toBe('FROZEN');
  });
});
