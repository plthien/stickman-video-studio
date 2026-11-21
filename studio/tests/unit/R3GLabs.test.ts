// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {approveGlabsImage,clearGlabsKey,glabsCredentialStatus,glabsProbe,glabsSettings,listGlabsJobs,pollGlabsImage,saveGlabsKey,saveGlabsSettings,submitGlabsImage,invalidateGlabsJobsAfterNativeCorrection,reconcileGlabsJobs} from '../../src/main/glabs';
import {getPendingMedia,getNativeImageGallery,importMediaFile,fulfillMedia,readNativeDraft,publishNativeDraftCorrection} from '../../src/main/externalTasks';
import {prepareNativeImages} from '../../src/main/imagePreparation';
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
function transport(opts:{postError?:boolean;maliciousFile?:boolean;image?:Buffer;healthStatus?:number;authStatus?:number;resultFailures?:number;downloadFailures?:number;captured?:Array<{method:string;route:string;body:unknown}>}={}){
  const calls=opts.captured??[];
  let resultFailures=opts.resultFailures??0,downloadFailures=opts.downloadFailures??0;
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
    if(method==='GET'&&route==='/api/result/ab12cd34'){
      if(resultFailures-->0)throw new Error('Injected result GET connection drop');
      return response({task_id:'ab12cd34',status:'completed',results:[opts.maliciousFile?'http://evil.example/api/files/out.png':'http://127.0.0.1:8765/api/files/out.png']});
    }
    if(method==='GET'&&route==='/api/files/out.png'){
      if(downloadFailures-->0)throw new Error('Injected image download failure');
      return new Response(new Uint8Array(opts.image??portraitPng),{status:200,headers:{'Content-Type':'image/png'}});
    }
    throw new Error('Unexpected mock route '+method+' '+route);
  });
  vi.stubGlobal('fetch',stub);
  return{calls,stub};
}
const decode=(data:Buffer)=>({png:data,width:data.readUInt32BE(16),height:data.readUInt32BE(20)});
const request=(targetKey:string)=>({targetKey,prompt:'Actual shot image prompt confirmed by the owner.',model:'nano_banana_2',aspectRatio:'9:16',references:[],authorized:true});
function reviseApprovedB1StyleForTest(){
  // Simulate a changed installed authority without mutating packaged style files.
  const original=fs.readFileSync;
  vi.spyOn(fs,'readFileSync').mockImplementation(((...args:unknown[])=>{
    const output=Reflect.apply(original,fs,args) as string|Buffer;
    return String(args[0]).endsWith('b1-minimal-handdrawn.md')&&typeof output==='string'?
      output+'\\n<!-- revised installed B1 authority -->':output;
  }) as typeof fs.readFileSync);
}
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
  it('F07-GL01 read-only UNKNOWN polling preserves original diagnostics, no duplicate POST or billing status rewrite',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({postError:true});
    const first=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(first.status).toBe('UNKNOWN');
    const originalReason=first.reason!;
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    const checked=await pollGlabsImage(appPath,root,dir,cipher,first.id,decode);
    expect(checked.status).toBe('UNKNOWN');
    expect(checked.reason).toContain(originalReason);
    expect(checked.reason).toContain('no confirmed provider task ID');
    const reopened=listGlabsJobs(root).find(job=>job.id===first.id)!;
    expect(reopened.status).toBe('UNKNOWN');
    expect(reopened.reason).toContain(originalReason);
    const again=await pollGlabsImage(appPath,root,dir,cipher,first.id,decode);
    expect(again.reason).toBe(checked.reason);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F07-GL02 explicit UNKNOWN acknowledgement + regenerate authorizes exactly one new POST, preserving old job',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({postError:true});
    const first=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const originalReason=first.reason!;
    await expect(submitGlabsImage(appPath,root,dir,cipher,{
      ...request(targets[0].key),regenerate:true
    },decode)).rejects.toThrow(/UNKNOWN/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    // A new manually acknowledged request may be sent only through existing
    // backend validation; it creates a separate job and never overwrites UNKNOWN.
    transport({captured:calls});
    const second=await submitGlabsImage(appPath,root,dir,cipher,{
      ...request(targets[0].key),acknowledgeUnknown:true,regenerate:true
    },decode);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('RUNNING');
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(2);
    const history=listGlabsJobs(root);
    expect(history.find(job=>job.id===first.id)).toMatchObject({
      status:'UNKNOWN',reason:originalReason
    });
    expect(history.find(job=>job.id===second.id)).toMatchObject({
      status:'RUNNING',providerTaskId:'ab12cd34'
    });
  });
  it('F07-GL03 changed installed style SHA blocks old prepared recovery before any paid POST',async()=>{
    const dir=credential(),{root}=fixture();
    const payload=nativePayload(root,{image:'early'}) as Record<string,unknown>;
    payload.asset_needs=[{
      shot_id:'shot-1',layer_id:'image-1',expected_path:'assets/images/missing.png',
      content:'Source-approved white kite on empty pale background'
    }];
    const staged=stageNative(root,payload);
    const target=staged.response.missing.find(item=>item.kind==='image')!;
    const prep=prepareNativeImages(appPath,root).jobs[0];
    expect(prep.state).toBe('READY');
    const actual={...request(target.key),prompt:prep.prompt,preparedFingerprint:prep.draftIdentity.creativeFingerprint};
    const {calls}=transport({postError:true});
    const first=await submitGlabsImage(appPath,root,dir,cipher,actual,decode);
    expect(first.status).toBe('UNKNOWN');
    reviseApprovedB1StyleForTest();
    await expect(submitGlabsImage(appPath,root,dir,cipher,{
      ...actual,acknowledgeUnknown:true,regenerate:true
    },decode)).rejects.toThrow(/PREPARED_TARGET_NOT_READY_OR_STALE/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    const historical=reconcileGlabsJobs(appPath,root).find(job=>job.id===first.id)!;
    expect(historical.status).toBe('UNKNOWN');
    expect(historical.reason).toContain(first.reason!);
    expect(historical.reason).toContain('STALE_STYLE_AUTHORITY');
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
  it('F08-01 G-Labs owner approval needs no manually entered rights; provenance is factual and durable',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const done=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const result=approveGlabsImage(appPath,root,submitted.id,undefined,decode);
    expect(result.job.status).toBe('APPROVED');
    expect(result.job.approved?.rights).toContain('OWNER_APPROVED_GLABS_PROJECT_USE');
    expect(result.job.approved?.rights).toContain('provider_license_not_verified');
    expect(result.job.approved?.provenance).toMatchObject({
      source:'G-Labs generated output',projectId:readState(root).project.id,
      jobId:submitted.id,providerTaskId:'ab12cd34',model:'nano_banana_2',
      promptSha256:submitted.promptSha256,imageSha256:done.staged!.sha256,
      nativeToken:submitted.token,targetKey:submitted.targetKey,
      shotId:submitted.shotId,layerId:submitted.layerId,targetPath:submitted.targetPath,
      styleSha256:submitted.styleProfileSha256,
      ownerAuthorizedProjectUse:true,providerLicenseVerified:false,
      approvedAt:expect.any(String)
    });
    expect(listGlabsJobs(root).find(job=>job.id===submitted.id)!.approved?.provenance)
      .toEqual(result.job.approved?.provenance);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
  });
  it('F11-01 approving the same job twice is idempotent without a second binding',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const first=approveGlabsImage(appPath,root,submitted.id,undefined,decode);
    const before=fs.readFileSync(path.join(root,'.studio','external','pending.json'),'utf8');
    const media=readState(root).media;
    const second=approveGlabsImage(appPath,root,submitted.id,undefined,decode);
    expect(second.job.approved).toEqual(first.job.approved);
    expect(fs.readFileSync(path.join(root,'.studio','external','pending.json'),'utf8')).toBe(before);
    expect(readState(root).media).toEqual(media);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F11-02 a second image SHA failure cannot roll back the first committed approval',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true),{calls}=transport();
    const first=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,first.id,decode);
    const second=await submitGlabsImage(appPath,root,dir,cipher,request(targets[1].key),decode);
    const secondDone=await pollGlabsImage(appPath,root,dir,cipher,second.id,decode);
    approveGlabsImage(appPath,root,first.id,undefined,decode);
    const firstBinding=getPendingMedia(appPath,root)?.fulfillments?.[targets[0].key];
    expect(firstBinding).toBeDefined();
    fs.appendFileSync(path.join(root,secondDone.staged!.path),'tampered');
    expect(()=>approveGlabsImage(appPath,root,second.id,undefined,decode))
      .toThrow(/SHA|mismatch|changed/i);
    const after=getPendingMedia(appPath,root)!;
    expect(after.fulfillments?.[targets[0].key]).toEqual(firstBinding);
    expect(after.fulfillments?.[targets[1].key]).toBeUndefined();
    expect(listGlabsJobs(root).find(row=>row.id===first.id)?.status).toBe('APPROVED');
    expect(after.missing.filter(item=>item.kind==='image')).toHaveLength(1);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(2);
  });
  it('F09-01 full frozen gallery retains approved target after pending.missing shrinks',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true);transport();
    const original=getNativeImageGallery(appPath,root);
    expect(original.token).toEqual(getPendingMedia(appPath,root)!.token);
    expect(original.targets.filter(item=>item.managed)).toHaveLength(2);
    const first=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,first.id,decode);
    const approval=approveGlabsImage(appPath,root,first.id,undefined,decode);
    const after=getNativeImageGallery(appPath,root);
    expect(after.targets).toHaveLength(original.targets.length);
    expect(after.targets.find(item=>item.key===targets[0].key)).toMatchObject({
      key:targets[0].key,shotId:targets[0].shotId,layerId:targets[0].layerId,
      fulfilled:true,boundPath:approval.job.approved!.path
    });
    expect(after.targets.find(item=>item.key===targets[1].key)?.fulfilled).toBe(false);
    expect(getPendingMedia(appPath,root)!.missing.filter(item=>item.kind==='image')).toHaveLength(1);
  });
  it('F08-02 manual third-party file import keeps the original rights validation',()=>{
    const {root}=nativeTarget();
    expect(()=>importMediaFile(root,importedSource(root),'image','')).toThrow(/rights/i);
    expect(()=>importMediaFile(root,importedSource(root),'image','   ')).toThrow(/rights/i);
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


type NativeVisualArtifact={manifest:{shots:Array<{layers:Array<Record<string,unknown>>}>};
  shot_ledger:Array<Record<string,unknown>>;sound_script:unknown[];asset_needs:Array<Record<string,unknown>>};
function correctDraftForTest(root:string,change:(artifact:NativeVisualArtifact)=>void){
  const draft=readNativeDraft(root)!;
  const corrected=structuredClone(draft.artifact) as NativeVisualArtifact;
  change(corrected);
  publishNativeDraftCorrection(appPath,root,draft.sha256,corrected,{
    correctTaskId:'test-correct-'+draft.revision,reviewTaskId:'test-review',
    editableIds:[],editablePaths:[],findingIds:[]
  });
  invalidateGlabsJobsAfterNativeCorrection(appPath,root);
  return corrected;
}

describe('R3 final repairs F01/F03/F06 — strict output, references and truthful probes',()=>{
  it('RATIO-01 ignores output aspect-ratio mismatch during approval while keeping image SHA/rights/target binding checks',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const done=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(done).toMatchObject({status:'VALIDATED',staged:{width:90,height:160}});
    const altered=JSON.parse(fs.readFileSync(path.join(root,'.studio','glabs','jobs',job.id+'.json'),'utf8')) as Record<string,unknown>;
    altered.aspectRatio='16:9';
    fs.writeFileSync(path.join(root,'.studio','glabs','jobs',job.id+'.json'),JSON.stringify(altered));
    const result=approveGlabsImage(appPath,root,job.id,'Owner rights confirmed',decode);
    expect(result.job.status).toBe('APPROVED');
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it.each([[1,1],[160,90],[768,1376]])('RATIO-02 accepts decodable output %i:%i despite requested portrait ratio, without another paid POST',async(w,h)=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({image:pngAt(w,h)});
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const received=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(received.status).toBe('VALIDATED');
    expect(received.staged).toMatchObject({width:w,height:h});
    expect(approveGlabsImage(appPath,root,job.id,'Owner rights confirmed',decode).job.status).toBe('APPROVED');
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
  });
  it.each([['1:1',90,90],['3:4',512,683],['4:3',683,512],['9:16',512,910],['16:9',910,512]] as const)(
    'RATIO-03 preserves the provider-requested %s ratio without rejecting returned PNG dimensions',async(ratio,w,h)=>{
      const dir=credential(),{root,targets}=nativeTarget();saveGlabsSettings(dir,{endpoint:'http://127.0.0.1:8765',contract:'legacy',model:'nano_banana_2',aspectRatio:ratio});transport({image:pngAt(w,h)});
      const job=await submitGlabsImage(appPath,root,dir,cipher,{...request(targets[0].key),aspectRatio:ratio},decode);
      expect((await pollGlabsImage(appPath,root,dir,cipher,job.id,decode)).status).toBe('VALIDATED');
    });
  it('RATIO-04 recovers a previously FAILED staged ratio-mismatch job on refresh without new POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({image:pngAt(768,1376)});
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const completed=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(completed.status).toBe('VALIDATED');
    const file=path.join(root,'.studio','glabs','jobs',submitted.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    stored.status='FAILED';stored.reason='GLABS_IMAGE_ASPECT_RATIO_MISMATCH';
    fs.writeFileSync(file,JSON.stringify(stored));
    const recovered=reconcileGlabsJobs(appPath,root).find(row=>row.id===submitted.id)!;
    expect(recovered.status).toBe('VALIDATED');
    expect(recovered.reason).toContain('GLABS_IMAGE_ASPECT_RATIO_MISMATCH');
    expect(recovered.staged).toMatchObject({width:768,height:1376});
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(approveGlabsImage(appPath,root,submitted.id,'Owner rights confirmed',decode).job.status).toBe('APPROVED');
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(0);
  });
  it('RATIO-05 does not recover ratio-failed history if the staged PNG SHA is tampered',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const completed=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',submitted.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    stored.status='FAILED';stored.reason='GLABS_IMAGE_ASPECT_RATIO_MISMATCH';
    fs.writeFileSync(file,JSON.stringify(stored));
    fs.writeFileSync(path.join(root,completed.staged!.path),pngAt(90,161));
    expect(reconcileGlabsJobs(appPath,root).find(row=>row.id===submitted.id)!.status).toBe('FAILED');
    expect(()=>approveGlabsImage(appPath,root,submitted.id,'Owner rights confirmed',decode)).toThrow(/NOT_VALIDATED/);
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('RATIO-07 does not promote a ratio-failed job if its staged PNG is missing',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const completed=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',submitted.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    stored.status='FAILED';stored.reason='GLABS_IMAGE_ASPECT_RATIO_MISMATCH';
    fs.writeFileSync(file,JSON.stringify(stored));
    fs.unlinkSync(path.join(root,completed.staged!.path));
    expect(reconcileGlabsJobs(appPath,root).find(row=>row.id===submitted.id)!.status).toBe('FAILED');
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('RATIO-08 does not promote a ratio-failed image when pinned style authority has changed',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',submitted.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    stored.status='FAILED';stored.reason='GLABS_IMAGE_ASPECT_RATIO_MISMATCH';
    stored.styleProfileSha256='0'.repeat(64);
    fs.writeFileSync(file,JSON.stringify(stored));
    expect(reconcileGlabsJobs(appPath,root).find(row=>row.id===submitted.id)!.status).toBe('FAILED');
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('RATIO-06 preserves unrelated provider FAILED attempts and does not silently approve them',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',submitted.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    stored.status='FAILED';stored.reason='Provider reported failure (no automatic retry).';
    fs.writeFileSync(file,JSON.stringify(stored));
    expect(reconcileGlabsJobs(appPath,root).find(row=>row.id===submitted.id)!.status).toBe('FAILED');
    expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
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
  it('F03-07 rights revoked during the async health/auth probe stop before paid submission',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    const media=importMediaFile(root,importedSource(root),'image','Owner original license');
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/tasks'){
        const current=readState(root);
        current.media!.find(item=>item.path===media.path)!.rights='Revoked license';
        writeState(root,current);
      }
      return stub(input,options);
    }));
    const failed=await submitGlabsImage(appPath,root,dir,cipher,
      {...request(targets[0].key),references:[media.path]},decode);
    expect(failed.status).toBe('FAILED');
    expect(failed.reason).toMatch(/BEFORE provider submission/);
    expect(calls.filter(item=>item.method==='POST')).toHaveLength(0);
    expect(getPendingMedia(appPath,root)!.missing).toHaveLength(1);
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


describe('F04 — immutable approved style source binding in the paid image lifecycle',()=>{
  it('F04-GL01 catches style authority changing during auth probe before a paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let revised=false;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(!revised&&new URL(String(input)).pathname==='/api/tasks'){
        revised=true;
        reviseApprovedB1StyleForTest();
      }
      return stub(input,options);
    }));
    await expect(submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode))
      .rejects.toThrow(/STALE_STYLE_AUTHORITY/);
    expect(revised).toBe(true);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(0);
    expect(readState(root).media!.filter(item=>item.shotId===targets[0].shotId)).toHaveLength(0);
  });
  it('F04-GL02 newly validated image cannot be approved after relevant style SHA changes',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(job.styleProfileId).toBe('B1');
    expect(job.styleProfileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await pollGlabsImage(appPath,root,dir,cipher,job.id,decode)).status).toBe('VALIDATED');
    reviseApprovedB1StyleForTest();
    expect(()=>approveGlabsImage(appPath,root,job.id,'Licensed image inspected by owner',decode))
      .toThrow(/STALE_CREATIVE_TARGET/);
    const persisted=listGlabsJobs(root).find(item=>item.id===job.id)!;
    expect(persisted.status).toBe('STALE');
    expect(persisted.reason).toMatch(/STALE_STYLE_AUTHORITY/);
    expect(readState(root).media!.filter(item=>item.shotId===targets[0].shotId)).toHaveLength(0);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F04-GL05 read-only Storyboard job listing reconciles stale style evidence without paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    reviseApprovedB1StyleForTest();
    const reconciled=reconcileGlabsJobs(appPath,root).find(entry=>entry.id===job.id)!;
    expect(reconciled.status).toBe('STALE');
    expect(reconciled.reason).toMatch(/STALE_STYLE_AUTHORITY/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F04-GL04 changing style cannot downgrade UNKNOWN billing into a retryable stale job',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({postError:true});
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(job.status).toBe('UNKNOWN');
    reviseApprovedB1StyleForTest();
    const checked=await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    expect(checked.status).toBe('UNKNOWN');
    expect(checked.reason).toMatch(/GLABS_UNKNOWN_MAY_HAVE_CHARGED/);
    await expect(submitGlabsImage(appPath,root,dir,cipher,{
      ...request(targets[0].key),regenerate:true
    },decode)).rejects.toThrow(/UNKNOWN/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F04-GL03 a persisted job with missing pinned style evidence cannot be newly approved',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',job.id+'.json');
    const stored=JSON.parse(fs.readFileSync(file,'utf8')) as {styleProfileSha256?:string};
    delete stored.styleProfileSha256;
    fs.writeFileSync(file,JSON.stringify(stored));
    expect(()=>approveGlabsImage(appPath,root,job.id,'Licensed inspected image',decode))
      .toThrow(/STALE_CREATIVE_TARGET/);
    expect(listGlabsJobs(root).find(item=>item.id===job.id)?.reason).toMatch(/STYLE_AUTHORITY_MISSING/);
  });
});
describe('NF02 — effective per-target Native image identity across corrections and restart',()=>{
  it('NF02-01/03/08 changing Shot A image properties stales only its old validated job, never re-POSTs',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    correctDraftForTest(root,artifact=>{artifact.manifest.shots[0].layers[0].x=123;});
    expect(listGlabsJobs(root).find(item=>item.id===job.id)?.status).toBe('STALE');
    expect(()=>approveGlabsImage(appPath,root,job.id,'Owner licensed',decode)).toThrow(/NOT_VALIDATED/);
    expect(getPendingMedia(appPath,root)!.missing.some(item=>item.key===targets[0].key)).toBe(true);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('NF02-02/09 unrelated Shot B creative correction does not stale job A or repoint its approved media',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(true),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    correctDraftForTest(root,artifact=>{artifact.manifest.shots[1].layers[0].x=321;});
    expect(listGlabsJobs(root).find(item=>item.id===job.id)?.status).toBe('VALIDATED');
    const approved=approveGlabsImage(appPath,root,job.id,'Owner licensed unchanged shot A',decode);
    expect(approved.job.status).toBe('APPROVED');
    const binding=readState(root).media!.find(item=>item.shotId==='shot-1'&&item.layerId==='image-1')!;
    correctDraftForTest(root,artifact=>{artifact.manifest.shots[1].layers[0].y=456;});
    expect(readState(root).media!.find(item=>item.shotId==='shot-1'&&item.layerId==='image-1')).toEqual(binding);
    expect(getPendingMedia(appPath,root)!.fulfillments?.[targets[0].key]).toBeDefined();
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('NF02-09 an already approved image remains in the media ledger but loses a changed creative target binding',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    approveGlabsImage(appPath,root,job.id,'Licensed original creative artwork',decode);
    const approved=readState(root).media!.find(item=>item.shotId==='shot-1'&&item.layerId==='image-1')!;
    expect(getPendingMedia(appPath,root)!.fulfillments?.[targets[0].key]).toBeDefined();
    correctDraftForTest(root,artifact=>{artifact.manifest.shots[0].layers[0].x=44;});
    const pending=getPendingMedia(appPath,root)!;
    expect(pending.fulfillments).toBeDefined();
    expect(pending.fulfillments?.[targets[0].key]).toBeUndefined();
    expect(pending.missing.some(item=>item.key===targets[0].key)).toBe(true);
    // The ledger retains both the original unassigned import and the approved
    // Shot/Layer audit entry at the same path. Match exact ownership, not the
    // first (unassigned) row. The *active* pending binding was revoked above.
    expect(readState(root).media!.find(item=>item.path===approved.path&&
      item.shotId===approved.shotId&&item.layerId===approved.layerId)).toEqual(approved);
    expect(sha(fs.readFileSync(path.join(root,approved.path)))).toBe(approved.sha256);
    const history=listGlabsJobs(root).find(item=>item.id===job.id)!;
    expect(history.status).toBe('APPROVED');
    expect(history.reason).toMatch(/GLABS_APPROVED_OUTPUT_SUPERSEDED/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('NF02-04 auxiliary target image requirement change invalidates the existing generated output',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    correctDraftForTest(root,artifact=>{
      artifact.asset_needs=[{shot_id:'shot-1',layer_id:'image-1',path:targets[0].path,
        content:'New owner-approved, contrasting daylight visual requirement'}];
    });
    expect(listGlabsJobs(root).find(item=>item.id===job.id)?.status).toBe('STALE');
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('NF02-05 changes during async health/auth probe block a paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let changed=false;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(!changed&&new URL(String(input)).pathname==='/api/tasks'){
        changed=true;
        correctDraftForTest(root,artifact=>{artifact.manifest.shots[0].layers[0].x=56;});
      }
      return stub(input,options);
    }));
    await expect(submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode))
      .rejects.toThrow(/GLABS_JOB_STALE_CREATIVE_TARGET/);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(0);
  });
  it('NF02-08 late paid POST response cannot resurrect a Native job invalidated while in flight',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let changed=false;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(!changed&&(options?.method??'GET')==='POST'){
        changed=true;
        correctDraftForTest(root,artifact=>{artifact.manifest.shots[0].layers[0].y=31;});
      }
      return stub(input,options);
    }));
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    expect(job.status).toBe('STALE');
    expect(job.providerTaskId).toBe('ab12cd34');
    expect(listGlabsJobs(root)[0].status).toBe('STALE');
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    expect(()=>approveGlabsImage(appPath,root,job.id,'Owner licensed',decode)).toThrow(/NOT_VALIDATED/);
  });
  it('NF02-06/07 legacy persisted job without target creative fingerprint fails closed on Poll and Approve',async()=>{
    const dir=credential(),{root,targets}=nativeTarget();transport();
    const job=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await pollGlabsImage(appPath,root,dir,cipher,job.id,decode);
    const file=path.join(root,'.studio','glabs','jobs',job.id+'.json');
    const saved=JSON.parse(fs.readFileSync(file,'utf8')) as {targetCreativeSha256?:string};
    delete saved.targetCreativeSha256;
    fs.writeFileSync(file,JSON.stringify(saved));
    expect((await pollGlabsImage(appPath,root,dir,cipher,job.id,decode)).status).toBe('STALE');
    expect(()=>approveGlabsImage(appPath,root,job.id,'Owner licensed',decode)).toThrow(/NOT_VALIDATED/);
    expect(readState(root).media!.filter(row=>row.shotId==='shot-1')).toHaveLength(0);
  });
});

describe('F17 durable provider completion and read-only ingestion recovery',()=>{
  it('F17-01 provider completed + failed result GET records sync error then retries the SAME task without new POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({resultFailures:1});
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode)).rejects.toThrow();
    const failed=listGlabsJobs(root).find(item=>item.id===submitted.id)!;
    expect(failed.status).not.toBe('FAILED');
    expect(failed.providerTaskId).toBe('ab12cd34');
    expect(failed.providerCompletedAt).toEqual(expect.any(String));
    expect(failed.syncPhase).toBe('result');
    expect(failed.lastSyncError).toMatchObject({stage:'result'});
    const ready=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(ready).toMatchObject({status:'VALIDATED',syncPhase:'validated'});
    expect(ready.lastSyncError).toBeUndefined();
    expect(ready.journalRevision).toBeGreaterThan(failed.journalRevision!);
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
    expect(calls.filter(c=>c.route==='/api/status/ab12cd34').length).toBe(2);
  });
  it('F17-03 persisted DONE evidence resumes image download even when provider status later regresses to running',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport({resultFailures:1});
    const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,created.id,decode)).rejects.toThrow();
    const afterFailure=listGlabsJobs(root).find(item=>item.id===created.id)!;
    expect(afterFailure.providerCompletedAt).toBeTruthy();
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/status/ab12cd34')
        return response({task_id:'ab12cd34',status:'running'});
      return stub(input,options);
    }));
    const result=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(result.status).toBe('VALIDATED');
    expect(result.providerCompletedAt).toBe(afterFailure.providerCompletedAt);
    expect(result.lastSyncError).toBeUndefined();
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    expect(calls.filter(call=>call.route==='/api/result/ab12cd34')).toHaveLength(2);
  });
  it('F17-02 download failure is a recoverable ingestion issue, not another paid generation',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport({downloadFailures:1});
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode)).rejects.toThrow();
    const persisted=listGlabsJobs(root).find(item=>item.id===submitted.id)!;
    expect(persisted.lastSyncError).toMatchObject({
      stage:'download',code:'GLABS_DOWNLOAD_UNKNOWN'
    });
    expect(persisted.providerCompletedAt).toEqual(expect.any(String));
    const fixed=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(fixed.status).toBe('VALIDATED');
    expect(fixed.staged?.sha256).toBe(sha(portraitPng));
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
    expect(calls.filter(c=>c.route==='/api/files/out.png')).toHaveLength(2);
  });
});
describe('F19/F22 MIME-safe provider ingestion and GET-only recovery',()=>{
  it('F19-01 canonical PNG and permitted generic/missing/alias headers validate with one POST each',async()=>{
    for(const header of ['image/png',' IMAGE/PNG ; charset=binary','application/octet-stream',null,'image/x-png']){
      const dir=credential(),{root,targets}=nativeTarget();
      const {calls}=transport();
      const base=globalThis.fetch;
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
        if(new URL(String(input)).pathname==='/api/files/out.png')return new Response(new Uint8Array(portraitPng),{
          status:200,headers:header===null?{}:{'Content-Type':header}
        });
        return base(input,options);
      }));
      const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
      const validated=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
      expect(validated).toMatchObject({status:'VALIDATED',sourceMime:'image/png',
        staged:{mime:'image/png',sha256:sha(portraitPng),width:90,height:160}});
      expect(validated.mimeDiagnostic?.classification).toBe(header===null?'missing':
        header==='application/octet-stream'?'generic':header==='image/x-png'?'alias':undefined);
      expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
  it('F19-02 supported image/jpeg and image/webp signatures are decoded into validated PNG',async()=>{
    const jpg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDbooor44+iP//Z','base64');
    const webp=Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAIAAoBCJaACdLoB+AADsAD+7Srf/WV/Mr+ZX+1d/8s+fw2dGAAA','base64');
    for(const [bytes,header,mime,classification] of [
      [jpg,'image/jpeg','image/jpeg',undefined],
      [jpg,'image/jpg','image/jpeg','alias'],
      [webp,'image/webp','image/webp',undefined],
      [jpg,'image/png','image/jpeg','mismatch']
    ] as const){
      const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
      const base=globalThis.fetch;
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
        if(new URL(String(input)).pathname==='/api/files/out.png')return new Response(new Uint8Array(bytes),{
          status:200,headers:{'Content-Type':header}
        });
        return base(input,options);
      }));
      // Electron's production decoder re-encodes into PNG; the isolated test
      // decoder models that successful, dimension-bounded decode explicitly.
      const decodeImage=()=>({png:portraitPng,width:90,height:160});
      const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decodeImage);
      const validated=await pollGlabsImage(appPath,root,dir,cipher,created.id,decodeImage);
      expect(validated).toMatchObject({status:'VALIDATED',sourceMime:mime,
        staged:{mime:'image/png',sha256:sha(portraitPng),width:90,height:160}});
      expect(validated.mimeDiagnostic?.classification).toBe(classification);
      expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
  it('F19-03 HTML JSON XML non-image and unsupported MIME never stage or approve image',async()=>{
    const cases=[
      {bytes:Buffer.from('<html>error</html>'),header:'text/html',code:'GLABS_IMAGE_BODY_NOT_SUPPORTED'},
      {bytes:Buffer.from('{"error":"missing"}'),header:'application/json',code:'GLABS_IMAGE_BODY_NOT_SUPPORTED'},
      {bytes:Buffer.from('<svg></svg>'),header:'image/svg+xml',code:'GLABS_IMAGE_BODY_NOT_SUPPORTED'},
      {bytes:Buffer.from('not an image'),header:'image/png',code:'GLABS_IMAGE_BODY_NOT_SUPPORTED'},
      {bytes:portraitPng,header:'text/html',code:'GLABS_DECLARED_MIME_UNSUPPORTED'},
      {bytes:portraitPng,header:'image/svg+xml',code:'GLABS_DECLARED_MIME_UNSUPPORTED'}
    ];
    for(const sample of cases){
      const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
      const base=globalThis.fetch;
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
        if(new URL(String(input)).pathname==='/api/files/out.png')return new Response(new Uint8Array(sample.bytes),{
          status:200,headers:{'Content-Type':sample.header}
        });
        return base(input,options);
      }));
      const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
      await expect(pollGlabsImage(appPath,root,dir,cipher,created.id,decode))
        .rejects.toThrow(sample.code);
      const persisted=listGlabsJobs(root).find(row=>row.id===created.id)!;
      expect(persisted.status).not.toBe('VALIDATED');
      expect(persisted.lastSyncError?.code).toBe(sample.code);
      expect(persisted.staged).toBeUndefined();
      expect(getPendingMedia(appPath,root)?.missing).toHaveLength(1);
      expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
      await expect(submitGlabsImage(appPath,root,dir,cipher,{
        ...request(targets[0].key),regenerate:true
      },decode)).rejects.toThrow(/EXISTING_ACTIVE_ATTEMPT/);
      expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
  it('F19-04 incompatible MIME then corrected GET-only retry preserves original provider ID and paid POST count',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let incompatible=true;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/files/out.png'&&incompatible)
        return new Response(new Uint8Array(portraitPng),{status:200,headers:{'Content-Type':'text/html'}});
      return stub(input,options);
    }));
    const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,created.id,decode))
      .rejects.toThrow('GLABS_DECLARED_MIME_UNSUPPORTED');
    const failed=listGlabsJobs(root).find(row=>row.id===created.id)!;
    expect(failed.providerCompletedAt).toBeTruthy();
    expect(failed.lastSyncError).toMatchObject({stage:'download',code:'GLABS_DECLARED_MIME_UNSUPPORTED'});
    incompatible=false;
    const recovered=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(recovered.status).toBe('VALIDATED');
    expect(recovered.providerTaskId).toBe('ab12cd34');
    expect(recovered.providerCompletedAt).toBe(failed.providerCompletedAt);
    expect(recovered.staged).toMatchObject({sha256:sha(portraitPng),width:90,height:160});
    expect(recovered.lastSyncError).toBeUndefined();
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F19-05 oversized file and HTTP redirects are rejected before image staging',async()=>{
    for(const mode of ['oversize','redirect'] as const){
      const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
        if(new URL(String(input)).pathname==='/api/files/out.png'){
          expect(options?.redirect).toBe('error');
          return mode==='oversize'?
            new Response(new Uint8Array(portraitPng),{status:200,headers:{
              'Content-Type':'image/png','Content-Length':String(16*1024*1024+1)}}):
            Response.redirect('http://127.0.0.1:8765/api/files/other.png',302);
        }
        return stub(input,options);
      }));
      const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
      await expect(pollGlabsImage(appPath,root,dir,cipher,created.id,decode)).rejects.toThrow(
        mode==='oversize'?'GLABS_DOWNLOAD_OVERSIZE':'GLABS_DOWNLOAD_HTTP_302');
      expect(listGlabsJobs(root).find(item=>item.id===created.id)?.staged).toBeUndefined();
      expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
  it('F22-01 status GET failure persists per-job diagnostic; later GET-only completion recovers',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let failStatus=true;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/status/ab12cd34'&&failStatus)
        throw new Error('injected provider status read timeout');
      return stub(input,options);
    }));
    const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,created.id,decode))
      .rejects.toThrow('GLABS_TRANSPORT_UNKNOWN');
    const recorded=listGlabsJobs(root).find(row=>row.id===created.id)!;
    expect(recorded).toMatchObject({status:'RUNNING',syncPhase:'provider',providerTaskId:'ab12cd34',
      lastSyncError:{stage:'provider',code:'GLABS_TRANSPORT_UNKNOWN',at:expect.any(String)}});
    expect(recorded.providerCompletedAt).toBeUndefined();
    expect(recorded.journalRevision).toBeGreaterThan(created.journalRevision!);
    failStatus=false;
    const recovered=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(recovered.status).toBe('VALIDATED');
    expect(recovered.lastSyncError).toBeUndefined();
    expect(recovered.providerTaskId).toBe(created.providerTaskId);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F22-04 decoding error descriptions persist only GLABS code and same-task GET-only recovery',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,submitted.id,()=>{
      throw new Error('GLABS_IMAGE_DECODE_FAILED: private path or decoder details must not persist');
    })).rejects.toThrow('GLABS_IMAGE_DECODE_FAILED');
    const failed=listGlabsJobs(root).find(row=>row.id===submitted.id)!;
    expect(failed.lastSyncError).toMatchObject({stage:'decode',code:'GLABS_IMAGE_DECODE_FAILED'});
    expect(JSON.stringify(failed)).not.toContain('private path or decoder details');
    expect(failed.providerCompletedAt).toBeTruthy();
    const recovered=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(recovered.status).toBe('VALIDATED');
    expect(recovered.providerTaskId).toBe('ab12cd34');
    expect(recovered.lastSyncError).toBeUndefined();
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F22-02 provider returns RUNNING after failed GET: obsolete status diagnostic clears without any POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    let failStatus=true;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/status/ab12cd34'){
        if(failStatus)throw new Error('read interrupted');
        return response({task_id:'ab12cd34',status:'running'});
      }
      return stub(input,options);
    }));
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode)).rejects.toThrow();
    expect(listGlabsJobs(root).find(item=>item.id===submitted.id)?.lastSyncError?.stage)
      .toBe('provider');
    failStatus=false;
    const running=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(running.status).toBe('RUNNING');
    expect(running.lastSyncError).toBeUndefined();
    expect(running.providerCompletedAt).toBeUndefined();
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F22-03 invalid status payload persists sanitized provider diagnostic, never another paid POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls,stub}=transport();
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/api/status/ab12cd34')
        return response({task_id:'ab12cd34',status:'unexpected'});
      return stub(input,options);
    }));
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    await expect(pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode))
      .rejects.toThrow('GLABS_STATUS_UNRECOGNIZED');
    expect(listGlabsJobs(root).find(item=>item.id===submitted.id)?.lastSyncError)
      .toMatchObject({stage:'provider',code:'GLABS_STATUS_UNRECOGNIZED'});
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
});
describe('F11 crash-safe generated-image approval journal recovery',()=>{
  it('F11-INTEGRITY-03 rejects a forged generated-image prompt SHA before any Native binding',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const completed=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(completed.status).toBe('VALIDATED');
    const file=path.join(root,'.studio','glabs','jobs',completed.id+'.json');
    const persisted=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    persisted.promptSha256='0'.repeat(64);
    fs.writeFileSync(file,JSON.stringify(persisted));
    expect(()=>approveGlabsImage(appPath,root,completed.id,undefined,decode))
      .toThrow(/GLABS_JOB_STALE_PROMPT_EVIDENCE/);
    expect(listGlabsJobs(root).find(item=>item.id===completed.id)?.status).toBe('VALIDATED');
    expect(getPendingMedia(appPath,root)?.missing).toHaveLength(1);
    expect(readState(root).media!.filter(row=>row.shotId===completed.shotId))
      .toHaveLength(0);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F11-IDEMP-02 a forged prompt hash cannot recover an already committed binding',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const created=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const ready=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    const authorization='OWNER_APPROVED_GLABS_PROJECT_USE | job='+ready.id+
      ' | source=G-Labs-generated | provider_license_not_verified';
    const imported=importMediaFile(root,path.join(root,ready.staged!.path),'image',authorization);
    fulfillMedia(appPath,root,ready.token,ready.targetKey,imported.path,authorization);
    const file=path.join(root,'.studio','glabs','jobs',ready.id+'.json');
    const persisted=JSON.parse(fs.readFileSync(file,'utf8')) as Record<string,unknown>;
    persisted.promptSha256='0'.repeat(64);
    fs.writeFileSync(file,JSON.stringify(persisted));
    expect(()=>approveGlabsImage(appPath,root,ready.id,undefined,decode))
      .toThrow(/GLABS_TARGET_NOT_FROZEN_OR_ALREADY_FULFILLED|GLABS_JOB_STALE/);
    expect(listGlabsJobs(root).find(item=>item.id===ready.id)?.status).toBe('VALIDATED');
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('F11-IDEMP-01 recovers the exact already-bound G-Labs candidate without another import, mapping or provider POST',async()=>{
    const dir=credential(),{root,targets}=nativeTarget(),{calls}=transport();
    const submitted=await submitGlabsImage(appPath,root,dir,cipher,request(targets[0].key),decode);
    const complete=await pollGlabsImage(appPath,root,dir,cipher,submitted.id,decode);
    expect(complete.status).toBe('VALIDATED');
    const authorization='OWNER_APPROVED_GLABS_PROJECT_USE | job='+complete.id+
      ' | source=G-Labs-generated | provider_license_not_verified';
    // Reproduce process termination between native fulfillment commit and the
    // APPROVED job JSON write. Both native files are already committed.
    const imported=importMediaFile(root,path.join(root,complete.staged!.path),'image',authorization);
    const alreadyBound=fulfillMedia(appPath,root,complete.token,complete.targetKey,
      imported.path,authorization);
    expect(alreadyBound).toMatchObject({fulfillments:{
      [complete.targetKey]:{
        sha256:complete.staged!.sha256,rights:authorization
      }
    }});
    const before=readState(root),listBefore=fs.readdirSync(path.join(root,'assets','images'));
    const recovered=approveGlabsImage(appPath,root,complete.id,undefined,decode);
    expect(recovered.job.status).toBe('APPROVED');
    expect(recovered.job.approved?.provenance).toMatchObject({
      projectId:complete.projectId,jobId:complete.id,
      promptSha256:complete.promptSha256,imageSha256:complete.staged!.sha256,
      ownerAuthorizedProjectUse:true,providerLicenseVerified:false
    });
    expect(readState(root).media).toEqual(before.media);
    expect(readState(root).imports).toEqual(before.imports);
    expect(fs.readdirSync(path.join(root,'assets','images'))).toEqual(listBefore);
    expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
    const again=approveGlabsImage(appPath,root,complete.id,undefined,decode);
    expect(again.job.status).toBe('APPROVED');
    expect(readState(root).media).toEqual(before.media);
  });
});
