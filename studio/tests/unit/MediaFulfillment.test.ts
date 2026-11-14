// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {confirmImport,fulfillMedia,getPendingMedia,importMediaFile,stageImport} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,frozenEnvelope,importedSource,nativePayload,stageNative,validator} from './SixIssueFixtures';

afterEach(()=>{vi.restoreAllMocks();cleanup()});
describe('WP-A: persisted approved media fulfillment and exact native fields',()=>{
  it('UT-A01 missing PNG -> owner import -> exact image-layer binding -> real native candidate promotion',async()=>{
    const {root,voicePath}=fixture(),{response}=stageNative(root,nativePayload(root,{image:'early'}));
    expect(response.status).toBe('WAITING_FOR_MEDIA');expect(response.missing).toHaveLength(1);
    const entry=importMediaFile(root,importedSource(root),'image','Owner-created PNG');
    expect(entry.status).toBe('IMPORTED_UNASSIGNED');
    const mapped=fulfillMedia(appPath,root,response.token,response.missing[0].key,entry.path,'Owner-created PNG');
    expect(mapped.status).toBe('STAGED');
    expect(readState(root).tasks?.native?.status).toBe('FROZEN');
    const originalWav=readState(root).voice?.sha256;
    const check=validator();await confirmImport(appPath,root,response.token,{validator:check.run});
    const native=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
    expect(native.shots[0].layers[0].path).toBe(entry.path);
    const row=readState(root).media?.find(item=>item.path===entry.path&&item.layerId==='image-1');
    expect(row).toMatchObject({shotId:'shot-1',kind:'image',rights:'Owner-created PNG',sha256:sha(fs.readFileSync(path.join(root,entry.path)))});
    expect(readState(root).voice?.path).toBe(voicePath);expect(readState(root).voice?.sha256).toBe(originalWav);
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:true});
  });
  it('UT-A02 wrong shot, nonimage/absent layer and invented primary cannot map',()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root,{image:'early'})),entry=importMediaFile(root,importedSource(root),'image','owner');
    for(const key of ['image:1:image-1','image:0:primary','image:0:text-1','image:0:missing'])expect(()=>fulfillMedia(appPath,root,response.token,key,entry.path,'owner')).toThrow();
    expect(getPendingMedia(appPath,root).missing).toHaveLength(1);
    expect(readState(root).media?.some(item=>item.shotId)).toBe(false);
  });
  it('UT-A03 duplicate basenames have distinct frozen shot/layer references',()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root,{image:'both',sameBasename:true}));
    expect(response.missing.map(item=>item.key)).toEqual(['image:0:image-1','image:1:image-2']);
    const entry=importMediaFile(root,importedSource(root),'image','owner');
    const after=fulfillMedia(appPath,root,response.token,response.missing[0].key,entry.path,'owner');
    expect(after.missing.map(item=>item.key)).toEqual(['image:1:image-2']);
    expect(after.status).toBe('WAITING_FOR_MEDIA');
    const check=validator();await confirmImport(appPath,root,response.token,{validator:check.run,allowSampleDraft:true});
    const native=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
    expect(native.shots[0].layers[0].path).toBe(entry.path);
    expect(native.shots[1].layers[0].path).toBe('assets/images/missing.png');
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:false});
  });
  it('UT-A04 exact original kind=file SFX target maps; unsafe/wrong track fails',async()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root,{sfx:true}));
    expect(response.missing[0]).toMatchObject({key:'audio:sfx:0',kind:'sfx',track:'sfx',trackIndex:0});
    const entry=importMediaFile(root,importedSource(root,'sfx'),'sfx','Licensed SFX');
    expect(()=>fulfillMedia(appPath,root,response.token,'audio:dialogue:0',entry.path,'Licensed SFX')).toThrow();
    fulfillMedia(appPath,root,response.token,'audio:sfx:0',entry.path,'Licensed SFX');
    await confirmImport(appPath,root,response.token,{validator:validator().run});
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')).sfx[0].path).toBe(entry.path);
    const second=fixture();
    expect(()=>stageNative(second.root,nativePayload(second.root,{sfx:true,unsafe:'http://example.org/audio.wav'}))).toThrow(/Native media|Unsafe/);
  });
  it('UT-A05 approved text/WAV/WORDS/cues/existing assets cause STALE at stage and confirm',async()=>{
    for(const mutation of ['script','wav','words','cues','asset']){
      for(const point of ['stage','confirm']){
        const {root,voicePath,wordsPath,coreCuesPath}=fixture();
        if(mutation==='asset')importMediaFile(root,importedSource(root),'image','owner');
        const envelope=frozenEnvelope(root,'native',nativePayload(root));
        let pending:string|undefined;
        if(point==='confirm')pending=stageImport(appPath,root,'native',JSON.stringify(envelope)).token;
        if(mutation==='script'){const state=readState(root);state.approvedScript!.text='Changed script';writeState(root,state);}
        if(mutation==='wav'){const file=path.join(root,voicePath),bytes=fs.readFileSync(file);bytes[100]^=1;fs.writeFileSync(file,bytes);}
        if(mutation==='words')fs.appendFileSync(path.join(root,wordsPath),' ');
        if(mutation==='cues')fs.appendFileSync(path.join(root,coreCuesPath),' ');
        if(mutation==='asset'){const item=readState(root).media![0];fs.appendFileSync(path.join(root,item.path),'x');}
        if(point==='stage')expect(()=>stageImport(appPath,root,'native',JSON.stringify(envelope))).toThrow(/stale|changed/);
        else await expect(confirmImport(appPath,root,pending!,{validator:validator().run})).rejects.toThrow(/stale|changed/);
        expect(readState(root).tasks?.native?.status).toBe('STALE');
      }
    }
  });
  it('UT-A06 restart/idempotence and wrong token, file hash, traversal, symlink bindings',()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root,{image:'early'}));
    const entry=importMediaFile(root,importedSource(root),'image','owner');
    const mapped=fulfillMedia(appPath,root,response.token,response.missing[0].key,entry.path,'owner');
    expect(getPendingMedia(appPath,root).token).toBe(response.token);
    expect(fulfillMedia(appPath,root,response.token,response.missing[0].key,entry.path,'owner').status).toBe(mapped.status);
    expect(()=>fulfillMedia(appPath,root,'wrong-token',response.missing[0].key,entry.path,'owner')).toThrow(/token/);
    expect(()=>fulfillMedia(appPath,root,response.token,response.missing[0].key,'../escape.png','owner')).toThrow();
    const another=fixture();expect(()=>fulfillMedia(appPath,another.root,response.token,response.missing[0].key,entry.path,'owner')).toThrow();
    fs.appendFileSync(path.join(root,entry.path),'tampered');
    expect(()=>getPendingMedia(appPath,root)).toThrow(/stale|hash|binding/i);
    // Windows may deny symlink creation without Developer Mode: assert when supported.
    const symlinkRoot=fixture(),start=stageNative(symlinkRoot.root,nativePayload(symlinkRoot.root,{image:'early'}));
    const real=importMediaFile(symlinkRoot.root,importedSource(symlinkRoot.root),'image','owner');
    const target=path.join(symlinkRoot.root,real.path);
    try{fs.unlinkSync(target);fs.symlinkSync(importedSource(symlinkRoot.root),target);expect(()=>fulfillMedia(appPath,symlinkRoot.root,start.response.token,start.response.missing[0].key,real.path,'owner')).toThrow();}catch(error){if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw error;}
  });
  it('UT-A07 native CLI reject and candidate promotion failure preserve last-good project, WAV and approval',async()=>{
    for(const mode of ['validator','promotion']){
      const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json')),state=readState(root);
      state.approval={note:'Original human approval',previewSha256:'a'.repeat(64),approvedAt:new Date().toISOString()};writeState(root,state);
      const {response}=stageNative(root,nativePayload(root));
      if(mode==='promotion'){
        const original=fs.renameSync;vi.spyOn(fs,'renameSync').mockImplementation((source,dest)=>{
          if(String(dest)===path.join(root,'project.json'))throw new Error('Injected promotion failure');
          return original(source,dest);
        });
      }
      await expect(confirmImport(appPath,root,response.token,{validator:validator({sampleFail:mode==='validator'}).run})).rejects.toThrow();
      expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);
      expect(readState(root).approval).toMatchObject(state.approval);
      expect(readState(root).voice?.sha256).toBe(state.voice?.sha256);
      expect(fs.existsSync(path.join(root,'.studio/external/pending.json'))).toBe(true);
      vi.restoreAllMocks();
    }
  });
});
