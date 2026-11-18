// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {approveGlabsImage,clearGlabsKey,glabsCredentialStatus,glabsProbe,glabsSettings,listGlabsJobs,pollGlabsImage,saveGlabsKey,saveGlabsSettings,submitGlabsImage} from '../../src/main/glabs';
import {getPendingMedia,importMediaFile} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,importedSource,nativePayload,stageNative} from './SixIssueFixtures';
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
// Actual decodable RGB-A PNG fixtures, not 1x1 placeholders for portrait generation.
const crc32=(bytes:Buffer)=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
function pngAt(width:number,height:number){
  const chunk=(name:string,data:Buffer)=>{const label=Buffer.from(name,'ascii'),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([length,label,data,checksum]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(Buffer.alloc(height*(1+width*4)))),chunk('IEND',Buffer.alloc(0))]);
}
const portraitPng=pngAt(90,160);
function transport(opts:{postError?:boolean;maliciousFile?:boolean;image?:Buffer;healthStatus?:number;authStatus?:number;captured?:Array<{method:string;route:string;body:unknown}>}={}){
  const calls=opts.captured??[];
  const stub=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input)),route=url.pathname,method=options?.method??'GET',body=options?.body?JSON.parse(String(options.body)) as unknown:null;
    calls.push({method,route,body});
    if(method==='GET'&&route==='/api/health')return response({version:'legacy-verified-on-mock'},opts.healthStatus??200);
    if(method==='GET'&&route==='/api/tasks')return response({tasks:[]},opts.authStatus??200);
    if(method==='POST'&&route==='/api/image/generate'){
      if(opts.postError)throw new Error('injected transport timeout');
      return response({task_id:'ab12cd34',status:'pending'},202);
    }
    if(method==='GET'&&route==='/api/status/ab12cd34')return response({task_id:'ab12cd34',status:'completed'});
    if(method==='GET'&&route==='/api/result/ab12cd34')return response({task_id:'ab12cd34',status:'completed',results:[opts.maliciousFile?'http://evil.example/api/files/out.png':'http://127.0.0.1:8765/api/files/out.png']});
    if(method==='GET'&&route==='/api/files/out.png')return new Response(new Uint8Array(opts.image??portraitPng),{status:200,headers:{'Content-Type':'image/png'}});
    throw new Error('Unexpected mock route '+method+' '+route);
  });
  vi.stubGlobal('fetch',stub);
  return{calls,stub};
}
const decode=(data:Buffer)=>({png:data,width:data.readUInt32BE(16),height:data.readUInt32BE(20)});
const request=(targetKey:string)=>({targetKey,prompt:'Actual shot image prompt confirmed by the owner.',model:'nano_banana_2',aspectRatio:'9:16',references:[],authorized:true});
describe('R3 G-Labs security and lifecycle GL01–GL12',()=>{
  it('GL01 read-only health and auth never create paid image jobs',async()=>{
    const dir=credential(),{calls}=transport();
    expect(await glabsProbe(dir,cipher)).toMatchObject({ready:false,reachable:true,authVerified:true,status:'AUTH_VERIFIED',modelCapability:'MODEL_CAPABILITY_UNVERIFIED'});
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
    expect(done.staged?.sha256).toBe(sha(portraitPng));
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
    expect(job.references).toEqual([{path:imported.path,sha256:imported.sha256,mime:'image/png',name:'ref_001.png',rightsSha256:sha('Owner created and licensed this image')}]);
    const sent=calls.find(c=>c.method==='POST')!.body as {reference_images:Array<{data:string;name:string}>};
    expect(sent.reference_images[0].name).toBe('ref_001.png');
    expect(sent.reference_images[0].data).toContain('data:image/png;base64,');
  });
  it('GL07/10 explicit approved image binds one exact frozen target and attested rights',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(()=>approveGlabsImage(appPath,root,job.id,'',decode)).toThrow(/RIGHTS/);
    const result=approveGlabsImage(appPath,root,job.id,'Original artwork licensed by owner',decode);
    expect(result.job.status).toBe('APPROVED');
    expect(readState(root).media!.some(item=>item.shotId===targets[0].shotId&&item.layerId===targets[0].layerId&&Boolean(item.rights.trim()))).toBe(true);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('GL08 explicitly regenerates one target while retaining its old validated image and other untouched target',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true),{calls}=transport();
    expect(targets).toHaveLength(2);
    const first=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const previous=await pollGlabsImage(appPath,root,dir,cipher,first.id,decode);
    expect(previous.status).toBe('VALIDATED');
    const originalFile=path.join(root,previous.staged!.path),originalSha=sha(fs.readFileSync(originalFile));
    const second=await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),regenerate:true},decode);
    expect(second.id).not.toBe(first.id);
    const regenerated=await pollGlabsImage(appPath,root,dir,cipher,second.id,decode);
    expect(regenerated.status).toBe('VALIDATED');
    expect(regenerated.staged!.path).not.toBe(previous.staged!.path);
    expect(sha(fs.readFileSync(originalFile))).toBe(originalSha);
    expect(listGlabsJobs(root).find(job=>job.id===first.id)!.status).toBe('VALIDATED');
    approveGlabsImage(appPath,root,second.id,'Regenerated artwork licensed by owner',decode);
    const left=getPendingMedia(appPath,root)!.missing;
    expect(left).toHaveLength(1);expect(left[0].key).toBe(targets[1].key);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(2);
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


describe('R3 final repairs F01/F03/F06 — strict output, references and truthful probes',()=>{
  it('F01-01 validates a real 9:16 generated PNG and F01-05 rechecks ratio at approval',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const done=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(done).toMatchObject({status:'VALIDATED',staged:{width:90,height:160}});
    const altered=JSON.parse(fs.readFileSync(path.join(root,'.studio','glabs','jobs',job.id+'.json'),'utf8')) as Record<string,unknown>;
    altered.aspectRatio='16:9';
    fs.writeFileSync(path.join(root,'.studio','glabs','jobs',job.id+'.json'),JSON.stringify(altered));
    expect(()=>approveGlabsImage(appPath,root,job.id,'Owner rights confirmed',decode)).toThrow(/ASPECT_RATIO_MISMATCH/);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(1);
  });
  it.each([[1,1],[160,90]])('F01-02/03/06 rejects output %i:%i for portrait job without a second paid POST',async(w,h)=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({image:pngAt(w,h)});
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const failed=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(failed.status).toBe('FAILED');expect(failed.reason).toMatch(/ASPECT_RATIO_MISMATCH/);
    expect(failed.staged).toMatchObject({width:w,height:h});
    expect(()=>approveGlabsImage(appPath,root,job.id,'Owner rights confirmed',decode)).toThrow(/NOT_VALIDATED/);
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(1);
  });
  it.each([['1:1',90,90],['3:4',512,683],['4:3',683,512],['9:16',512,910],['16:9',910,512]] as const)(
    'F01-04 tolerates normal integer rounding for requested %s',async(ratio,w,h)=>{
      const dir=credential(),{root,targets}=nativeTarget();saveGlabsSettings(dir,{endpoint:'http://127.0.0.1:8765',contract:'legacy',model:'nano_banana_2',aspectRatio:ratio});transport({image:pngAt(w,h)});
      const job=await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),aspectRatio:ratio},decode);
      expect((await pollGlabsImage(appPath,root,dir,cipher,job.id,decode)).status).toBe('VALIDATED');
    });
  it('F03-01/05 unchanged reference and rights approve with immutable frozen evidence',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();const{calls}=transport();
    const media=importMediaFile(root,importedSource(root),'image','Owner licensed original');
    const job=await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),references:[media.path]},decode);
    const original=structuredClone(job.references);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(approveGlabsImage(appPath,root,job.id,'Generated art licensed',decode).job.status).toBe('APPROVED');
    expect(listGlabsJobs(root).find(x=>x.id===job.id)!.references).toEqual(original);
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it.each(['changed-bytes','missing-file','rights-changed','rights-removed','missing-evidence'])(
    'F03-02/03/04/06/07 rejects %s without mutation or additional paid generation',async(failure)=>{
      const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
      const media=importMediaFile(root,importedSource(root),'image','Owner licensed original');
      const job=await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),references:[media.path]},decode);
      await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
      const before=getPendingMedia(appPath,root),mediaBefore=readState(root).media;
      const reference=path.join(root,media.path);
      if(failure==='changed-bytes')fs.writeFileSync(reference,pngAt(3,4));
      if(failure==='missing-file')fs.unlinkSync(reference);
      if(failure==='rights-changed'||failure==='rights-removed'){
        const state=readState(root),item=state.media!.find(x=>x.path===media.path)!;
        item.rights=failure==='rights-removed'?'':'Other license text';writeState(root,state);
      }
      if(failure==='missing-evidence'){
        const file=path.join(root,'.studio','glabs','jobs',job.id+'.json');
        const jobRecord=JSON.parse(fs.readFileSync(file,'utf8')) as {references:Array<{rightsSha256?:string}>};
        delete jobRecord.references[0].rightsSha256;fs.writeFileSync(file,JSON.stringify(jobRecord));
      }
      expect(()=>approveGlabsImage(appPath,root,job.id,'Generated art licensed',decode)).toThrow(/reference/i);
      expect(getPendingMedia(appPath,root)).toEqual(before);
      if(failure!=='rights-changed'&&failure!=='rights-removed')expect(readState(root).media).toEqual(mediaBefore);
      expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
      expect(listGlabsJobs(root).find(x=>x.id===job.id)!.status).toBe('VALIDATED');
    });
  it('F06-01 health failure reports unreachable and makes no paid POST',async()=>{
    const dir=credential(),{calls}=transport({healthStatus:503});
    expect(await glabsProbe(dir,cipher)).toMatchObject({ready:false,reachable:false,authVerified:false,status:'UNREACHABLE'});
    expect(calls.map(x=>x.method)).toEqual(['GET']);
  });
  it('F06-02 failed authenticated read-only call reports reachable but not authenticated',async()=>{
    const dir=credential(),{calls}=transport({authStatus:401});
    expect(await glabsProbe(dir,cipher)).toMatchObject({ready:false,reachable:true,authVerified:false,status:'REACHABLE'});
    expect(calls.map(x=>x.method)).toEqual(['GET','GET']);
  });
  it('F06-03/04/05/06 passes read-only auth but never pretends that local model selection is verified',async()=>{
    const dir=credential(),{calls}=transport();
    const probe=await glabsProbe(dir,cipher);
    expect(probe).toMatchObject({ready:false,reachable:true,authVerified:true,status:'AUTH_VERIFIED',
      modelCapability:'MODEL_CAPABILITY_UNVERIFIED',configuredModel:'nano_banana_2'});
    expect(JSON.stringify(probe)).not.toContain('confidential-test-key');
    expect(probe).not.toHaveProperty('supportedModels');
    expect(calls.map(x=>x.method)).toEqual(['GET','GET']);
  });
  it('F06-05 blocks generation at health/auth preflight before any paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({authStatus:401});
    await expect(submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode)).rejects.toThrow(/HEALTH_AUTH_UNVERIFIED/);
    expect(calls.some(x=>x.method==='POST')).toBe(false);
  });
});
