// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {confirmImport,fulfillMedia,importMediaFile} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,importedSource,nativePayload,stageNative,validator} from './SixIssueFixtures';

afterEach(cleanup);
describe('WP-C: original native scoped preview-first validator and independent full readiness',()=>{
  it('UT-C01 original CLI receives exact scoped --seconds 20 and full unscoped validate arguments',async()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root)),check=validator();
    await confirmImport(appPath,root,response.token,{validator:check.run});
    expect(check.calls).toHaveLength(2);
    expect(check.calls[0][1]).toBe('validate');expect(check.calls[0].slice(-2)).toEqual(['--seconds','20']);
    expect(check.calls[1][1]).toBe('validate');expect(check.calls[1]).not.toContain('--seconds');
    expect(check.calls[0][2]).toContain('.project-candidate-');
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:true,checkedSeconds:20});
  });
  it('UT-C02 missing late-shot asset permits only explicit SAMPLE_READY draft with full false',async()=>{
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root,{image:'late'})),check=validator();
    expect(response.status).toBe('WAITING_FOR_MEDIA');
    await expect(confirmImport(appPath,root,response.token,{validator:check.run})).rejects.toThrow(/Explicitly approve/);
    expect(fs.existsSync(path.join(root,'.studio/external/pending.json'))).toBe(true);
    await confirmImport(appPath,root,response.token,{validator:check.run,allowSampleDraft:true});
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:false,reviewedDraft:true,missingOutsideScope:['image:1:image-2']});
    expect(check.calls.every(call=>call.includes('--seconds'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')).shots[1].layers[0].path).toBe('assets/images/late.png');
  });
  it('UT-C03 missing in-scope image or failing original scoped CLI blocks publication',async()=>{
    for(const mode of ['missing','gap']){
      const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json'));
      const {response}=stageNative(root,nativePayload(root,{image:mode==='missing'?'early':undefined}));
      const run=validator({sampleFail:mode==='gap'});
      await expect(confirmImport(appPath,root,response.token,{validator:run.run,allowSampleDraft:true})).rejects.toThrow(/Missing media|validation failure/);
      expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);
      expect(readState(root).nativeReadiness).toBeUndefined();
    }
  });
  it('UT-C04 owner 1–60 preview seconds validation; undefined uses 20, never NaN/0/61',async()=>{
    for(const seconds of [0,61,Number.NaN,-1,Infinity]){
      const {root}=fixture(),{response}=stageNative(root,nativePayload(root));
      await expect(confirmImport(appPath,root,response.token,{previewSeconds:seconds,validator:validator().run})).rejects.toThrow(/1\.\.60/);
      expect(readState(root).nativeReadiness).toBeUndefined();
    }
    for(const seconds of [1,60]){
      const {root}=fixture(),{response}=stageNative(root,nativePayload(root)),check=validator();
      await confirmImport(appPath,root,response.token,{previewSeconds:seconds,validator:check.run});
      expect(check.calls[0].slice(-2)).toEqual(['--seconds',String(seconds)]);
      expect(readState(root).nativeReadiness?.checkedSeconds).toBe(Math.min(seconds,30));
    }
    const {root}=fixture(),{response}=stageNative(root,nativePayload(root)),check=validator();
    await confirmImport(appPath,root,response.token,{validator:check.run});expect(check.calls[0].at(-1)).toBe('20');
  });
  it('UT-C05 later owner fulfillment re-freezes and validates full; prior preview/approval cannot be silently reused',async()=>{
    const {root}=fixture(),first=stageNative(root,nativePayload(root,{image:'late'}));
    await confirmImport(appPath,root,first.response.token,{validator:validator().run,allowSampleDraft:true});
    const state=readState(root);state.preview={path:'output/preview.mp4',sha256:'a'.repeat(64),reportPath:'output/preview-report.json',reportSha256:'b'.repeat(64),verifiedAt:new Date().toISOString(),sourceFingerprint:'old'};state.approval={note:'Old reviewed sample',previewSha256:'a'.repeat(64),approvedAt:new Date().toISOString()};writeState(root,state);
    const second=stageNative(root,nativePayload(root,{image:'late'})),entry=importMediaFile(root,importedSource(root),'image','owner');
    fulfillMedia(appPath,root,second.response.token,'image:1:image-2',entry.path,'owner');
    const check=validator();await confirmImport(appPath,root,second.response.token,{validator:check.run});
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:true,reviewedDraft:false});
    expect(check.calls).toHaveLength(2);expect(check.calls[1]).not.toContain('--seconds');
    expect(readState(root).approval).toBeUndefined();expect(readState(root).preview).toBeUndefined();
    expect(sha(fs.readFileSync(path.join(root,entry.path)))).toMatch(/^[a-f0-9]{64}$/);
  });
  it('UT-C06 CLI rejection/failed full validate do not manufacture readiness or damage previous native state',async()=>{
    const {root}=fixture(),before=fs.readFileSync(path.join(root,'project.json')),{response}=stageNative(root,nativePayload(root));
    await expect(confirmImport(appPath,root,response.token,{validator:validator({sampleFail:true}).run,allowSampleDraft:true})).rejects.toThrow();
    expect(fs.readFileSync(path.join(root,'project.json')).equals(before)).toBe(true);
    expect(readState(root).nativeReadiness).toBeUndefined();
    await expect(confirmImport(appPath,root,response.token,{validator:validator({fullFail:true}).run})).rejects.toThrow(/Explicitly approve/);
    expect(readState(root).nativeReadiness).toBeUndefined();
    await confirmImport(appPath,root,response.token,{validator:validator({fullFail:true}).run,allowSampleDraft:true});
    expect(readState(root).nativeReadiness).toMatchObject({sampleReady:true,fullReady:false});
  });
});
