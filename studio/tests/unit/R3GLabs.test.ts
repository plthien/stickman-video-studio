// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {approveGlabsImage,clearGlabsKey,glabsCredentialStatus,glabsProbe,glabsSettings,listGlabsJobs,pollGlabsImage,saveGlabsKey,submitGlabsImage} from '../../src/main/glabs';
import {getPendingMedia,importMediaFile} from '../../src/main/externalTasks';
import {readState,sha} from '../../src/main/services';
import {appPath,cleanup,fixture,importedSource,nativePayload,png,stageNative} from './SixIssueFixtures';
const userFolders:string[]=[];
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();for(const p of userFolders.splice(0))fs.rmSync(p,{recursive:true,force:true});});
const cipher={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString('utf8')};
function credential(){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'r3-glabs-config-'));userFolders.push(folder);
  saveGlabsKey(folder,cipher,'confidential-test-key');
  return folder;
}
function nativeTarget(both=false){
  const {root}=fixture(),result=stageNative(root,nativePayload(root,{image:both?'both':'early'}));
  expect(result.response.status).toBe('WAITING_FOR_MEDIA');
  return{root,targets:result.response.missing.filter(x=>x.kind==='image')};
}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function transport(opts:{postError?:boolean;maliciousFile?:boolean;captured?:Array<{method:string;route:string;body:unknown}>}={}){
  const calls=opts.captured??[];
  const stub=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input)),route=url.pathname,method=options?.method??'GET',body=options?.body?JSON.parse(String(options.body)) as unknown:null;
    calls.push({method,route,body});
    if(method==='GET'&&route==='/api/health')return response({version:'legacy-verified-on-mock'});
    if(method==='GET'&&route==='/api/tasks')return response({tasks:[]});
    if(method==='POST'&&route==='/api/image/generate'){
      if(opts.postError)throw new Error('injected transport timeout');
      return response({task_id:'ab12cd34',status:'pending'},202);
    }
    if(method==='GET'&&route==='/api/status/ab12cd34')return response({task_id:'ab12cd34',status:'completed'});
    if(method==='GET'&&route==='/api/result/ab12cd34')return response({task_id:'ab12cd34',status:'completed',results:[opts.maliciousFile?'http://evil.example/api/files/out.png':'http://127.0.0.1:8765/api/files/out.png']});
    if(method==='GET'&&route==='/api/files/out.png')return new Response(new Uint8Array(png()),{status:200,headers:{'Content-Type':'image/png'}});
    throw new Error('Unexpected mock route '+method+' '+route);
  });
  vi.stubGlobal('fetch',stub);
  return{calls,stub};
}
const decode=(data:Buffer)=>({png:data,width:1,height:1});
const request=(targetKey:string)=>({targetKey,prompt:'Actual shot image prompt confirmed by the owner.',model:'nano_banana_2',aspectRatio:'9:16',references:[],authorized:true});
describe('R3 G-Labs security and lifecycle GL01–GL12',()=>{
  it('GL01 read-only health and auth never create paid image jobs',async()=>{
    const dir=credential(),{calls}=transport();
    expect((await glabsProbe(dir,cipher)).ready).toBe(true);
    expect(calls.map(c=>c.method)).toEqual(['GET','GET']);
    expect(glabsCredentialStatus(dir,cipher)).toMatchObject({configured:true,secureStorageAvailable:true});
  });
  it('GL02 exact legacy route/model/ratio with no automatic fallback',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(job.status).toBe('RUNNING');
    const paid=calls.filter(c=>c.method==='POST');
    expect(paid).toHaveLength(1);expect(paid[0].route).toBe('/api/image/generate');
    expect(paid[0].body).toMatchObject({model:'nano_banana_2',aspect_ratio:'9:16',reference_images:[],upscale:[]});
    expect((await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),model:'other'},decode).catch(e=>String(e)))).toMatch(/MODEL_CONFIG_MISMATCH/);
  });
  it('GL03/04 target identity and provider task survive persistence/poll/restart',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(job).toMatchObject({shotId:targets[0].shotId,layerId:targets[0].layerId,token:expect.any(String),providerTaskId:'ab12cd34'});
    expect(listGlabsJobs(root)[0].providerTaskId).toBe('ab12cd34');
    const done=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(done.status).toBe('VALIDATED');
    expect(done.staged?.sha256).toBe(sha(png()));
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('GL05/09 unknown paid submit never automatically replays after reopening',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({postError:true});
    const uncertain=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(uncertain.status).toBe('UNKNOWN');expect(uncertain.providerTaskId).toBeUndefined();
    expect(listGlabsJobs(root)[0].status).toBe('UNKNOWN');
    await expect(submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode)).rejects.toThrow(/UNKNOWN/);
    const checked=await pollGlabsImage(appPath,root,dir,cipher,uncertain.id,decode);
    expect(checked.status).toBe('UNKNOWN');
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('GL06 ordered reference image uses exact verified file SHA',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const imported=importMediaFile(root,importedSource(root),'image','Owner created and licensed this image');
    const req={...request(targets[0].key),references:[imported.path]};
    const job=await submitGlabsImage(appPath,root,dir,cipher,req,decode);
    expect(job.references).toEqual([{path:imported.path,sha256:imported.sha256,mime:'image/png',name:'ref_001.png'}]);
    const sent=calls.find(c=>c.method==='POST')!.body as {reference_images:Array<{data:string;name:string}>};
    expect(sent.reference_images[0].name).toBe('ref_001.png');
    expect(sent.reference_images[0].data).toContain('data:image/png;base64,');
  });
  it('GL07/10 explicit approved image binds one exact frozen target and attested rights',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(()=>approveGlabsImage(appPath,root,job.id,'')).toThrow(/RIGHTS/);
    const result=approveGlabsImage(appPath,root,job.id,'Original artwork licensed by owner');
    expect(result.job.status).toBe('APPROVED');
    expect(readState(root).media!.some(item=>item.shotId===targets[0].shotId&&item.layerId===targets[0].layerId&&Boolean(item.rights.trim()))).toBe(true);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('GL08 modifying one target leaves another target pending',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true);transport();
    expect(targets).toHaveLength(2);
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    approveGlabsImage(appPath,root,job.id,'Original artwork licensed by owner');
    const left=getPendingMedia(appPath,root)!.missing;
    expect(left).toHaveLength(1);expect(left[0].key).toBe(targets[1].key);
  });
  it('GL11 unsafe file URLs are blocked with no implicit second paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({maliciousFile:true});
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,job.id,decode)).rejects.toThrow(/RESULT_URL_UNSAFE/);
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
    expect(listGlabsJobs(root)[0].status).toBe('DOWNLOADED');
  });
  it('GL12 no key is persisted in project job ledger or renderer-safe settings',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(JSON.stringify(listGlabsJobs(root))).not.toContain('confidential-test-key');
    expect(JSON.stringify(glabsSettings(dir))).not.toContain('confidential-test-key');
    expect(JSON.stringify(job)).not.toContain('confidential-test-key');
    clearGlabsKey(dir,cipher);expect(glabsCredentialStatus(dir,cipher).configured).toBe(false);
  });
  it('GL03/05 rejects unapproved, nonfrozen targets and unauthorized paid submission',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();const {calls}=transport();
    await expect(submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),authorized:false},decode)).rejects.toThrow(/EXPLICIT_OWNER_AUTHORIZATION/);
    await expect(submitGlabsImage(appPath,root,dir,cipher,request('unfrozen-layer'),decode)).rejects.toThrow(/NOT_FROZEN/);
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
  });
});
