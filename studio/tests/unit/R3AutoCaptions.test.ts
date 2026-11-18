// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {autoCaptionReview,approvedCaptionCues,draftCaptionReview,getCaptionReview,nativeVoiceTiming} from '../../src/main/captionReview';
import {freezeTask} from '../../src/main/externalTasks';
import {projectSnapshot} from '../../src/main/projectSnapshot';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture} from './SixIssueFixtures';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
function replaceWords(root:string,text:string,words:Array<{word:string;start:number;end:number}>,cues:Array<{start:number;end:number;text:string}>){
  const state=readState(root),alignment=state.alignment!;
  state.approvedScript!.text=text;state.approvedScript!.sha256=sha(text);state.approvedScript!.sections=[{id:'opening',text}];
  fs.writeFileSync(path.join(root,alignment.path),JSON.stringify({schema:'mode-b-word-alignment-v1',words}));
  fs.writeFileSync(path.join(root,alignment.captionsPath),JSON.stringify(cues));
  alignment.wordsSha256=sha(fs.readFileSync(path.join(root,alignment.path)));
  alignment.cuesSha256=sha(fs.readFileSync(path.join(root,alignment.captionsPath)));
  alignment.scriptSha256=sha(text);
  writeState(root,state);
}
describe('R3 Auto Captions AC01–AC12',()=>{
  it('AC01/02 real verified words become AUTO_VERIFIED without manual draft or approval note',()=>{
    const {root}=fixture({approve:false});
    expect(getCaptionReview(root).status).toBe('REVIEW_REQUIRED');
    const result=autoCaptionReview(root),state=readState(root);
    expect(result.status).toBe('AUTO_VERIFIED');
    expect(result.cues).toEqual([{start:.1,end:.9,text:'One two three'}]);
    expect(state.alignment!.captionReview).toMatchObject({mode:'AUTO',note:'',revision:1});
    expect(state.alignment!.captionDraft).toBeUndefined();
    expect(getCaptionReview(root).workflowStatus).toBe('AUTO_VERIFIED');
  });
  it('AC03 regroup does not upload audio, invoke ElevenLabs or change WAV',()=>{
    const {root,voicePath}=fixture({approve:false}),before=fs.readFileSync(path.join(root,voicePath));
    const network=vi.spyOn(globalThis,'fetch');
    autoCaptionReview(root);
    expect(network).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root,voicePath))).toEqual(before);
  });
  it('AC04/05 ordered spoken words and real timestamps survive regroup',()=>{
    const {root}=fixture({approve:false});
    const cues=autoCaptionReview(root).cues;
    expect(cues.map(c=>c.text).join(' ')).toBe('One two three');
    expect(cues.map(c=>[c.start,c.end])).toEqual([[.1,.9]]);
  });
  it('AC06 supports punctuation and real pauses without invented timestamps',()=>{
    const {root}=fixture({approve:false}),text='Hello, world. Again friend';
    replaceWords(root,text,[
      {word:'Hello,',start:.1,end:.2},{word:'world.',start:.25,end:.5},
      {word:'Again',start:1.1,end:1.4},{word:'friend',start:1.45,end:1.8}
    ],[{start:.1,end:1.8,text}]);
    const result=autoCaptionReview(root);
    expect(result.cues.length).toBeGreaterThanOrEqual(2);
    expect(result.cues.map(c=>c.text).join(' ')).toBe(text);
    expect(result.cues[0].start).toBe(.1);
    expect(result.cues.at(-1)!.end).toBe(1.8);
    expect(result.cues[0].end).toBe(.5);
    expect(result.cues[1].start).toBe(1.1);
  });
  it('AC07 impossible single long word requires review, no fake approval',()=>{
    const {root}=fixture({approve:false}),veryLong='x'.repeat(70);
    replaceWords(root,veryLong,[{word:veryLong,start:.1,end:.9}],[{start:.1,end:.9,text:veryLong}]);
    expect(()=>autoCaptionReview(root)).toThrow(/CAPTION_REVIEW_REQUIRED/);
    expect(readState(root).alignment!.captionReview).toBeUndefined();
  });
  it('AC08 B4 native voice lead/tail/trim_start translate exactly',()=>{
    const {root}=fixture({approve:false,style:'B4'}),file=path.join(root,'project.json');
    const manifest=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    manifest.voice={path:'assets/audio/narration.wav',lead:.5,tail:.25,trim_start:.3};
    fs.writeFileSync(file,JSON.stringify(manifest));
    const result=autoCaptionReview(root),timing=nativeVoiceTiming(root);
    expect(timing).toMatchObject({lead:.5,tail:.25,trimStart:.3});
    expect(result.cues).toEqual([{start:.55,end:1.1,text:'two three'}]);
  });
  it('AC09 manual approval is preserved and never overwritten by auto routine',()=>{
    const {root}=fixture(),before=readState(root).alignment!.captionReview!,cues=approvedCaptionCues(root);
    const result=autoCaptionReview(root);
    expect(result.status).toBe('USER_APPROVED');
    expect(readState(root).alignment!.captionReview).toEqual(before);
    expect(approvedCaptionCues(root)).toEqual(cues);
  });
  it('AC10 script, WAV and words tampering cannot produce new AUTO_VERIFIED evidence',()=>{
    for(const changed of ['script','wav','words']){
      const {root,voicePath,wordsPath}=fixture({approve:false});autoCaptionReview(root);
      if(changed==='script'){const state=readState(root);state.approvedScript!.text='Changed narration';writeState(root,state);}
      if(changed==='wav'){const file=path.join(root,voicePath),bytes=fs.readFileSync(file);bytes[100]^=1;fs.writeFileSync(file,bytes);}
      if(changed==='words')fs.appendFileSync(path.join(root,wordsPath),' ');
      expect(()=>approvedCaptionCues(root)).toThrow(/changed|stale|source/i);
    }
  });
  it('AC11 Native Author freezes exact auto-verified cues without manual approval',()=>{
    const {root}=fixture({approve:false});autoCaptionReview(root);
    const frozen=freezeTask(appPath,root,'native');
    expect(frozen.prompt).toContain('AUTO');
    expect(frozen.prompt).toContain('One two three');
  });
  it('AC12 persisted revision survives reopen and stays isolated per project',()=>{
    const first=fixture({approve:false}),second=fixture({approve:false});
    autoCaptionReview(first.root);
    expect(getCaptionReview(first.root).workflowStatus).toBe('AUTO_VERIFIED');
    expect(getCaptionReview(second.root).status).toBe('REVIEW_REQUIRED');
    expect(readState(first.root).alignment!.captionReview!.mode).toBe('AUTO');
  });
});
describe('R3 Shot and Caption mapping SH01–SH05',()=>{
  it('SH01/02/03 overlap mapping lists all cues, preserving cross-shot timestamp',async()=>{
    const {root}=fixture(),file=path.join(root,'project.json');
    const manifest=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    const cues=[{start:.1,end:.2,text:'One'},{start:.3,end:.4,text:'two'},{start:.5,end:.6,text:'three'}];
    manifest.captions=cues;
    manifest.shots=[
      {id:'shot-A',start:0,end:.35,layers:[{id:'text-A',type:'text',text:'A'}]},
      {id:'shot-B',start:.35,end:30,layers:[{id:'text-B',type:'text',text:'B'}]}
    ];
    fs.writeFileSync(file,JSON.stringify(manifest));
    const out=await projectSnapshot(root,appPath);
    expect(out.projection.shots[0].captions).toEqual(cues.slice(0,2));
    expect(out.projection.shots[1].captions).toEqual(cues.slice(1));
    expect(out.projection.shots[0].captions![1]).toEqual(out.projection.shots[1].captions![0]);
    expect(out.projection.tracks.Captions).toHaveLength(3);
  });
  it('SH04 changing shots does not regenerate voice/WORDS or mutate alignment state',async()=>{
    const {root}=fixture(),stateBytes=fs.readFileSync(path.join(root,'.studio/state.json'));
    const manifestFile=path.join(root,'project.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')) as Record<string,unknown>;
    manifest.shots=[
      {id:'A',start:0,end:15,layers:[{id:'a',type:'text',text:'A'}]},
      {id:'B',start:15,end:30,layers:[{id:'b',type:'text',text:'B'}]}
    ];fs.writeFileSync(manifestFile,JSON.stringify(manifest));
    const out=await projectSnapshot(root,appPath);
    expect(out.projection.shots).toHaveLength(2);
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(stateBytes);
  });
  it('SH05 preserves six original Editor tracks',async()=>{
    const {root}=fixture(),out=await projectSnapshot(root,appPath);
    expect(Object.keys(out.projection.tracks)).toEqual(['Scenes','Layers','Captions','Narration','SFX','Ambience']);
  });
});
