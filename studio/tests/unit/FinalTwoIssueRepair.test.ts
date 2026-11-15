// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {approvedCaptionCues,approveCaptionReview,draftCaptionReview,getCaptionReview,nativeVoiceTiming} from '../../src/main/captionReview';
import {confirmImport,fulfillMedia,freezeTask,importMediaFile} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,importedSource,nativePayload,stageNative} from './SixIssueFixtures';

afterEach(()=>{vi.restoreAllMocks();cleanup()});

function deferredValidator(result:{code:number;stdout?:string;stderr?:string}={code:0}) {
  let release!:()=>void,started!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve});
  let first=true;
  const run=async(_exe:string,args:string[])=>{
    if(first){first=false;started();await waiting;}
    if(result.code!==0)return{code:result.code,stdout:result.stdout??'',stderr:result.stderr??'Injected validator failure'};
    return{code:0,stdout:JSON.stringify({valid:true,fingerprint:sha(fs.readFileSync(args[2])),checked_seconds:args.includes('--seconds')?20:30}),stderr:''};
  };
  return{run,entered,release};
}
function setVoice(root:string,value:{lead?:number;tail?:number;trim_start?:number}) {
  const file=path.join(root,'project.json'),project=JSON.parse(fs.readFileSync(file,'utf8'));
  project.voice={path:project.voice.path,...value};fs.writeFileSync(file,JSON.stringify(project));
}

describe('FIX-01: asynchronous native confirmation merges only transaction-owned state',()=>{
  it('UT-F01-A concurrent unassigned media survives while the validated candidate is promoted',async()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root)),gate=deferredValidator();
    const confirming=confirmImport(appPath,root,response.token,{validator:gate.run});await gate.entered;
    const imported=importMediaFile(root,importedSource(root),'image','Concurrent owner asset');
    expect(readState(root).media).toContainEqual(expect.objectContaining({path:imported.path}));
    gate.release();await confirming;
    const state=readState(root),project=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
    expect(state.media).toContainEqual(expect.objectContaining({path:imported.path}));expect(state.imports).toContain(imported.path);
    expect(project.shots[0].id).toBe('shot-1');expect(state.tasks?.native?.status).toBe('IMPORTED');
  });
  it('UT-F01-B conflicting frozen source mutation rejects without promotion',async()=>{
    const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json')),{response}=stageNative(root,nativePayload(root)),gate=deferredValidator();
    const confirming=confirmImport(appPath,root,response.token,{validator:gate.run});await gate.entered;
    const state=readState(root);state.approvedScript!.text='Conflicting approved text';writeState(root,state);
    gate.release();await expect(confirming).rejects.toThrow(/stale|changed|blocked|corrupt/i);
    expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);expect(readState(root).tasks?.native?.status).toBe('STALE');
  });
  it('UT-F01-C fulfillment changed during validation requires a new validation',async()=>{
    const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json')),{response}=stageNative(root,nativePayload(root,{image:'late'})),gate=deferredValidator();
    const confirming=confirmImport(appPath,root,response.token,{validator:gate.run,allowSampleDraft:true});await gate.entered;
    const imported=importMediaFile(root,importedSource(root),'image','Late owner asset');
    fulfillMedia(appPath,root,response.token,response.missing[0].key,imported.path,'Late owner asset');
    gate.release();await expect(confirming).rejects.toThrow(/fulfillment changed/);
    expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);expect(fs.existsSync(path.join(root,'.studio/external/pending.json'))).toBe(true);
  });
  it('UT-F01-D validator and promotion failures preserve independent state and recoverable pending work',async()=>{
    for(const mode of ['validator','promotion'] as const){
      const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json')),approved=readState(root).alignment!.captionReview,{response}=stageNative(root,nativePayload(root));
      const gate=deferredValidator(mode==='validator'?{code:1}:undefined),confirming=confirmImport(appPath,root,response.token,{validator:gate.run});await gate.entered;
      const imported=importMediaFile(root,importedSource(root),'image','Independent asset');
      if(mode==='promotion'){
        const rename=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,destination)=>{
          if(String(destination)===path.join(root,'project.json'))throw new Error('Injected atomic promotion failure');
          return rename(source,destination);
        });
      }
      gate.release();await expect(confirming).rejects.toThrow();vi.restoreAllMocks();
      const state=readState(root);expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);
      expect(state.media).toContainEqual(expect.objectContaining({path:imported.path}));expect(state.imports).toContain(imported.path);
      expect(state.voice?.stale).toBe(false);expect(state.alignment?.captionReview).toEqual(approved);
      expect(state.external.native).toBeUndefined();expect(fs.existsSync(path.join(root,'.studio/external/pending.json'))).toBe(true);
    }
  });
});

describe('FIX-02: captions follow original Core lead/tail/B4 trim semantics',()=>{
  it('UT-F02-A nonzero lead shifts word-bound cues onto the native timeline',()=>{
    const {root}=fixture();setVoice(root,{lead:1.5});
    const review=getCaptionReview(root),timing=nativeVoiceTiming(root);
    expect(review.original).toEqual([{start:1.6,end:2.4,text:'One two three'}]);expect(timing.timelineDuration).toBe(31.5);
    draftCaptionReview(root,[3]);approveCaptionReview(root,'Reviewed the lead-adjusted native timing');expect(approvedCaptionCues(root)).toEqual(review.original);
  });
  it('UT-F02-B tail expands timeline only and never fabricates or stretches caption content',()=>{
    const {root}=fixture();setVoice(root,{tail:2});
    expect(nativeVoiceTiming(root).timelineDuration).toBe(32);expect(getCaptionReview(root).original).toEqual([{start:.1,end:.9,text:'One two three'}]);
  });
  it('UT-F02-C B4 trim_start removes fully trimmed words and maps remaining exact boundaries',()=>{
    const {root}=fixture({style:'B4'});setVoice(root,{trim_start:.31});
    const review=getCaptionReview(root);
    expect(review.words.map(word=>word.word)).toEqual(['two','three']);expect(review.originalBoundaries).toEqual([2]);
    expect(review.original[0]).toMatchObject({text:'two three'});expect(review.original[0].start).toBeCloseTo(.04);expect(review.original[0].end).toBeCloseTo(.59);
  });
  it('UT-F02-D combined lead/tail/trim has Core-equivalent duration and cue mapping',()=>{
    const {root}=fixture({style:'B4'});setVoice(root,{lead:.5,tail:2,trim_start:.31});
    const timing=nativeVoiceTiming(root),cue=getCaptionReview(root).original[0];
    expect(timing.timelineDuration).toBeCloseTo(32.19);expect(cue.start).toBeCloseTo(.54);expect(cue.end).toBeCloseTo(1.09);expect(cue.text).toBe('two three');
  });
  it('UT-F02-E invalid trim/timing/text/overlap reject and preserve the prior approval record',()=>{
    const cut=fixture({style:'B4'}),cutPrior=readState(cut.root).alignment!.captionReview;setVoice(cut.root,{trim_start:.2});
    expect(()=>getCaptionReview(cut.root)).toThrow(/word boundary/);expect(readState(cut.root).alignment!.captionReview).toEqual(cutPrior);
    for(const bad of [[{start:99,end:100,text:'One two three'}],[{start:.1,end:.3,text:'One'},{start:.2,end:.9,text:'two three'}],[{start:.1,end:.9,text:'three two One'}]]){
      const sample=fixture(),state=readState(sample.root),record=state.alignment!.captionReview!,file=path.join(sample.root,record.path);
      fs.writeFileSync(file,JSON.stringify(bad));record.sha256=sha(fs.readFileSync(file));writeState(sample.root,state);
      const preserved=readState(sample.root).alignment!.captionReview;
      expect(()=>approvedCaptionCues(sample.root)).toThrow();expect(readState(sample.root).alignment!.captionReview).toEqual(preserved);
    }
  });
  it('UT-F02-F timing revision stales caption approval and downstream native artifacts',()=>{
    const {root}=fixture();freezeTask(appPath,root,'native');const state=readState(root);
    state.preview={path:'output/preview.mp4',sha256:'a'.repeat(64),reportPath:'output/report.json',reportSha256:'b'.repeat(64),verifiedAt:new Date().toISOString(),sourceFingerprint:'old'};
    state.approval={note:'Old timing approval',previewSha256:'a'.repeat(64),approvedAt:new Date().toISOString()};writeState(root,state);
    setVoice(root,{lead:.5});const review=getCaptionReview(root),fresh=readState(root);
    expect(review.approved).toBeNull();expect(fresh.alignment?.captionReview).toBeDefined();expect(fresh.tasks?.native?.status).toBe('STALE');expect(fresh.preview).toBeUndefined();expect(fresh.approval).toBeUndefined();
  });
});
