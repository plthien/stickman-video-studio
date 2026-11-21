// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as services from '../../src/main/services';
import {fulfillMedia,getPendingMedia,importMediaFile} from '../../src/main/externalTasks';
import {cancelJob,nativeJob} from '../../src/main/nativeJobs';
import {currentNativeEvidence} from '../../src/main/nativeEvidence';
import {runLongform} from '../../src/main/voiceMedia';
import {createNanoTestProducer} from './NanoHttpMock';
import {verifier,writePreviewEvidence} from './NativeEvidenceFixtures';
import {appPath,cleanup,fixture,importedSource,nativePayload,stageNative} from './SixIssueFixtures';

afterEach(()=>{cleanup();vi.restoreAllMocks()});
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const waitFor=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('Timed out waiting for test boundary.')};
function prepareLongform(endpoint:string){
  const sample=fixture(),state=services.readState(sample.root);
  state.approvedScript!.sections=[{id:'a',text:'One two'},{id:'b',text:'three'}];
  state.approvedScript!.text='One two\n\nthree';
  state.approvedScript!.sha256=services.sha(state.approvedScript!.text);
  state.approvedScript!.revision=7;
  state.nano={endpoint,profileId:'owner'};
  state.media=[{path:'assets/audio/narration.wav',sha256:state.voice!.sha256,
    kind:'ambience',rights:'existing',importedAt:'before'}];
  services.writeState(sample.root,state);
  return sample;
}
function pendingMapping(){const sample=fixture(),{response}=stageNative(sample.root,nativePayload(sample.root,{image:'both'})),first=importMediaFile(sample.root,importedSource(sample.root),'image','owner rights');return{...sample,pending:response,first}}
async function previewReady(){const sample=fixture(),e=currentNativeEvidence(sample.root,services.readState(sample.root),{seconds:20}),adapter=verifier(e),written=writePreviewEvidence(sample.root,e),state=services.readState(sample.root);state.preview={path:'output/preview.mp4',sha256:services.sha(fs.readFileSync(written.video)),reportPath:'output/preview-report.json',reportSha256:services.sha(fs.readFileSync(written.report)),sourceFingerprint:e.fingerprint,verifiedAt:'now'};state.approval={note:'reviewed',previewSha256:state.preview.sha256,approvedAt:'now'};state.nativeReadiness={sampleReady:true,fullReady:true,previewSeconds:20,checkedSeconds:30,sourceFingerprint:services.sha(fs.readFileSync(path.join(sample.root,'project.json'))),reviewedDraft:false,verifiedAt:'now'};services.writeState(sample.root,state);fs.writeFileSync(path.join(sample.root,'output/approval.json'),JSON.stringify({preview_sha256:state.preview.sha256,preview_fingerprint:'f'.repeat(64),note:'reviewed',approved_at:'now'}));return{...sample,e,adapter}}

describe('REG-01 API-only concurrent narration state updates',()=>{
  it('REG-01A preserves independent state updates across deferred HTTP profile verification',async()=>{
    const entered=deferred<void>(),verifyGate=deferred<void>();
    const speechEntered=deferred<void>(),speechGate=deferred<void>();
    const api=createNanoTestProducer({
      voiceId:'owner',failSpeechAt:1,
      onFirstIntegrity:()=>{entered.resolve(undefined);return verifyGate.promise;},
      onFirstSpeech:()=>{speechEntered.resolve(undefined);return speechGate.promise;}
    });
    const endpoint=await api.start();
    try{
      const sample=prepareLongform(endpoint);
      const before=services.readState(sample.root).voice;
      const run=runLongform(sample.root,{voice:'owner'});
      const outcome=run.then(()=>null,(error:unknown)=>error);
      await entered.promise;
      const independent=services.readState(sample.root);
      independent.project.title='Independent title';
      independent.imports=['assets/images/independent.png'];
      services.writeState(sample.root,independent);
      verifyGate.resolve(undefined);
      await speechEntered.promise;
      const running=services.readState(sample.root);
      expect(running.longform?.status).toBe('RUNNING');
      expect(running.project.title).toBe('Independent title');
      expect(running.imports).toEqual(['assets/images/independent.png']);
      speechGate.resolve(undefined);
      expect(String(await outcome)).toMatch(/NANO_UNCERTAIN_503/);
      const after=services.readState(sample.root);
      expect(after.project.title).toBe('Independent title');
      expect(after.imports).toEqual(['assets/images/independent.png']);
      expect(after.voice).toEqual(before);
      expect(after.longform?.status).toBe('UNCERTAIN');
    }finally{
      verifyGate.resolve(undefined);speechGate.resolve(undefined);
      await api.close();
    }
  });
  it('REG-01B rejects source changed during HTTP producer verification before RUNNING',async()=>{
    const entered=deferred<void>(),verifyGate=deferred<void>();
    const api=createNanoTestProducer({voiceId:'owner',
      onFirstIntegrity:()=>{entered.resolve(undefined);return verifyGate.promise;}});
    const endpoint=await api.start();
    try{
      const sample=prepareLongform(endpoint);
      const run=runLongform(sample.root,{voice:'owner'});
      const outcome=run.then(()=>null,(error:unknown)=>error);
      await entered.promise;
      const changed=services.readState(sample.root);
      changed.approvedScript!.revision++;
      changed.approvedScript!.text+=' changed';
      changed.approvedScript!.sha256=services.sha(changed.approvedScript!.text);
      services.writeState(sample.root,changed);
      verifyGate.resolve(undefined);
      expect(String(await outcome)).toMatch(/changed|stale|source/i);
      expect(services.readState(sample.root).longform).toBeUndefined();
      expect(api.get().speechCalls).toBe(0);
    }finally{verifyGate.resolve(undefined);await api.close();}
  });
  it('REG-01C HTTP profile verification failure preserves last-good project evidence',async()=>{
    const api=createNanoTestProducer({voiceId:'owner',
      integrityFailure:{status:503,code:'REFERENCE_VERIFICATION_UNAVAILABLE'}});
    const endpoint=await api.start();
    try{
      const sample=prepareLongform(endpoint),before=services.readState(sample.root);
      await expect(runLongform(sample.root,{voice:'owner'})).rejects.toThrow(/verif|integrity/i);
      const after=services.readState(sample.root);
      expect(after.voice).toEqual(before.voice);
      expect(after.approvedScript).toEqual(before.approvedScript);
      expect(after.media).toEqual(before.media);
      expect(after.longform).toBeUndefined();
      expect(api.get().speechCalls).toBe(0);
    }finally{await api.close();}
  });
});

describe('REG-02 fulfillment recovery preserves independent imports',()=>{
  it('REG-02A interrupted mapping recovery preserves a later independent import',()=>{const sample=pendingMapping(),pendingFile=path.join(sample.root,'.studio/external/pending.json'),pendingBefore=JSON.parse(fs.readFileSync(pendingFile,'utf8')),ref=sample.pending.missing![0],binding={relative:sample.first.path,sha256:sample.first.sha256,rights:'owner rights',kind:'image'},ownedMapping={...sample.first,shotId:ref.shotId,layerId:ref.layerId};const partial=structuredClone(pendingBefore);partial.fulfillments[ref.key]=binding;fs.writeFileSync(pendingFile,JSON.stringify(partial));fs.writeFileSync(path.join(sample.root,'.studio/external/fulfillment-transaction.json'),JSON.stringify({schema:'media-fulfillment-transaction-v2',pendingBefore,key:ref.key,binding,ownedMapping}));const independent=importMediaFile(sample.root,importedSource(sample.root,'sfx'),'sfx','independent rights');expect(()=>getPendingMedia(appPath,sample.root)).toThrow(/RECOVERY_REQUIRED/);const recovered=services.readState(sample.root);expect(recovered.imports).toContain(independent.path);expect(recovered.media?.some(row=>row.path===independent.path&&row.rights==='independent rights')).toBe(true);expect(getPendingMedia(appPath,sample.root)?.fulfillments).toEqual({})});
  it('REG-02B recovery preserves an earlier exact committed mapping',()=>{const sample=pendingMapping(),firstKey=sample.pending.missing![0].key;fulfillMedia(appPath,sample.root,sample.pending.token,firstKey,String(sample.first.path),'owner rights');const pendingFile=path.join(sample.root,'.studio/external/pending.json'),pendingBefore=JSON.parse(fs.readFileSync(pendingFile,'utf8')),ref=sample.pending.missing![1],binding={relative:sample.first.path,sha256:sample.first.sha256,rights:'owner rights',kind:'image'},ownedMapping={...sample.first,shotId:ref.shotId,layerId:ref.layerId};fs.writeFileSync(path.join(sample.root,'.studio/external/fulfillment-transaction.json'),JSON.stringify({schema:'media-fulfillment-transaction-v2',pendingBefore,key:ref.key,binding,ownedMapping}));expect(()=>getPendingMedia(appPath,sample.root)).toThrow(/RECOVERY_REQUIRED/);const mapped=services.readState(sample.root).media?.find(row=>row.shotId);expect(mapped).toMatchObject({shotId:'shot-1',layerId:'image-1',rights:'owner rights'})});
  it('REG-02C corrupt recovery evidence is blocked without ledger mutation',()=>{const sample=pendingMapping(),before=services.readState(sample.root),pendingBefore=JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/external/pending.json'),'utf8')),ref=sample.pending.missing![0],binding={relative:sample.first.path,sha256:'0'.repeat(64),rights:'forged',kind:'image'},ownedMapping={...sample.first,sha256:binding.sha256,rights:binding.rights,shotId:ref.shotId,layerId:ref.layerId};fs.writeFileSync(path.join(sample.root,'.studio/external/fulfillment-transaction.json'),JSON.stringify({schema:'media-fulfillment-transaction-v2',pendingBefore,key:ref.key,binding,ownedMapping}));expect(()=>getPendingMedia(appPath,sample.root)).toThrow(/RECOVERY_REQUIRED|BLOCKED/);expect(services.readState(sample.root).media).toEqual(before.media)});
});

describe('REG-04 diagnostic commands cannot overwrite a mutating job journal',()=>{
  it('REG-04A Doctor during active Preview leaves Preview as latest tracked job',async()=>{const sample=fixture(),gate=deferred<{code:number;stdout:string;stderr:string}>(),run=nativeJob(appPath,sample.root,'preview',{seconds:20,replace:true},{runner:async()=>gate.promise});await waitFor(()=>JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8')).status==='RUNNING');const previewJob=JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'));await nativeJob(appPath,sample.root,'doctor',{}, {runner:async()=>({code:0,stdout:'doctor ok',stderr:''})});expect(JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'))).toMatchObject({id:previewJob.id,command:'preview',status:'RUNNING'});cancelJob(sample.root,previewJob.id);gate.resolve({code:1,stdout:'',stderr:'cancelled'});await expect(run).rejects.toThrow();expect(JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8')).id).toBe(previewJob.id)});
  it('REG-04B Probe during active Render does not replace Render journal identity',async()=>{const sample=await previewReady(),gate=deferred<{code:number;stdout:string;stderr:string}>(),run=nativeJob(appPath,sample.root,'render',{replace:true},{verifier:sample.adapter,runner:async()=>gate.promise});await waitFor(()=>JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8')).command==='render'&&JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8')).status==='RUNNING');const renderJob=JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'));await nativeJob(appPath,sample.root,'probe',{file:'output/preview.mp4'},{runner:async()=>({code:0,stdout:'{}',stderr:''})});expect(JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'))).toMatchObject({id:renderJob.id,command:'render',status:'RUNNING'});cancelJob(sample.root,renderJob.id);gate.resolve({code:1,stdout:'',stderr:'cancelled'});await expect(run).rejects.toThrow()});
  it('REG-04C cancellation still targets the original mutating job after a diagnostic',async()=>{const sample=fixture(),gate=deferred<{code:number;stdout:string;stderr:string}>(),run=nativeJob(appPath,sample.root,'preview',{seconds:20,replace:true},{runner:async()=>gate.promise});await waitFor(()=>fs.existsSync(path.join(sample.root,'.studio/jobs/latest.json')));const original=JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'));await nativeJob(appPath,sample.root,'doctor',{}, {runner:async()=>({code:0,stdout:'ok',stderr:''})});expect(cancelJob(sample.root,original.id)).toEqual({cancelled:true,id:original.id});gate.resolve({code:1,stdout:'',stderr:'cancelled'});await expect(run).rejects.toThrow();expect(JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'))).toMatchObject({id:original.id,status:'INTERRUPTED'})});
  it('REG-04D failed diagnostic cannot alter another job status or artifacts',async()=>{const sample=fixture(),sentinel=path.join(sample.root,'output/sentinel.txt');fs.mkdirSync(path.dirname(sentinel),{recursive:true});fs.writeFileSync(sentinel,'keep');const gate=deferred<{code:number;stdout:string;stderr:string}>(),run=nativeJob(appPath,sample.root,'preview',{seconds:20,replace:true},{runner:async()=>gate.promise});await waitFor(()=>JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8')).status==='RUNNING');const original=JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'));await expect(nativeJob(appPath,sample.root,'doctor',{}, {runner:async()=>({code:1,stdout:'',stderr:'doctor failed'})})).rejects.toThrow(/doctor failed/);expect(JSON.parse(fs.readFileSync(path.join(sample.root,'.studio/jobs/latest.json'),'utf8'))).toMatchObject({id:original.id,status:'RUNNING'});expect(fs.readFileSync(sentinel,'utf8')).toBe('keep');cancelJob(sample.root,original.id);gate.resolve({code:1,stdout:'',stderr:'cancelled'});await expect(run).rejects.toThrow()});
});
