// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,nativePayload,stageNative} from './SixIssueFixtures';
import {getNativeImageGallery,fulfillMedia,importMediaFile,readNativeDraft,
  publishNativeDraftCorrection} from '../../src/main/externalTasks';
import {prepareNativeImages,saveNativeImagePrompt} from '../../src/main/imagePreparation';
import {readState,sha} from '../../src/main/services';
import {addCharacterReference,approveCharacter,archiveCharacter,previewCharacterImpact,
  readCharacterRegistry,readTargetBindings,registerCharacter,saveTargetBinding,
  setStrictCharacterMode,verifyIdentityMedia} from '../../src/main/visualIdentityRegistry';
import {characterCoverage,resolveVisualReferences} from '../../src/main/visualReferenceResolver';
import {attestBoundVisual,attestVisualCandidate,assertStrictProjectPublicationReady,
  assertVisualCandidateReviewed} from '../../src/main/visualIdentityReview';
import {approveGlabsImage,listGlabsJobs,pollGlabsImage,saveGlabsKey,submitGlabsImage} from '../../src/main/glabs';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  for(const directory of tempCredentials.splice(0))fs.rmSync(directory,{force:true,recursive:true});
});
const tempCredentials:string[]=[];
const cipher={isEncryptionAvailable:()=>true,encryptString:(text:string)=>Buffer.from(text),
  decryptString:(bytes:Buffer)=>bytes.toString('utf8')};
const credential=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vcr-'));
  tempCredentials.push(dir);saveGlabsKey(dir,cipher,'owner-secret');return dir;};
const crc=(bytes:Buffer)=>{let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)
    value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;
};
function png(color:number){
  const chunk=(kind:string,data:Buffer)=>{const key=Buffer.from(kind);
    const size=Buffer.alloc(4),hash=Buffer.alloc(4);size.writeUInt32BE(data.length);
    hash.writeUInt32BE(crc(Buffer.concat([key,data])));
    return Buffer.concat([size,key,data,hash]);};
  const header=Buffer.alloc(13);
  header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const rgba=Buffer.from([color,20,45,255,color,20,45,255,color,20,45,255,color,20,45,255]);
  const rows=Buffer.concat([Buffer.from([0]),rgba.subarray(0,8),
    Buffer.from([0]),rgba.subarray(8,16)]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const decode=(buffer:Buffer)=>({png:buffer,width:buffer.readUInt32BE(16),
  height:buffer.readUInt32BE(20)});
function stage(count=2,style:'B1'|'B4'='B1'){
  const {root}=fixture({style});
  const payload=nativePayload(root,{image:count>1?'both':'early'}) as {
    manifest:{shots:Array<{id:string;layers:Array<Record<string,unknown>>}>};
    shot_ledger:unknown[];sound_script:unknown[];asset_needs:unknown[];
  };
  if(count>2)for(let index=2;index<count;index++){
    const shot=payload.manifest.shots[1];
    shot.layers.push({id:'image-'+(index+1),type:'image',
      path:'assets/images/missing-'+(index+1)+'.png'});
  }
  payload.asset_needs=payload.manifest.shots.flatMap(shot=>shot.layers
    .filter(layer=>layer.type==='image').map(layer=>({
      shot_id:shot.id,layer_id:layer.id,expected_path:layer.path,
      content:'Explicit owner-approved Native action for '+layer.id+
        ' with no invented character appearance.'})));
  stageNative(root,payload);
  const targets=getNativeImageGallery(appPath,root).targets;
  expect(targets).toHaveLength(count);
  return{root,targets,payload};
}
function imported(root:string,id:string,color:number){
  const filename=path.join(root,'owner-character-'+id+'.png');
  fs.writeFileSync(filename,png(color));
  return importMediaFile(root,filename,'image','Owner produced and approved image '+id);
}
function character(root:string,id:string,color:number){
  let revision=readCharacterRegistry(root).revision;
  registerCharacter(root,{characterId:id,label:'Owner label '+id,expectedRevision:revision});
  revision=readCharacterRegistry(root).revision;
  const media=imported(root,id,color);
  addCharacterReference(root,{characterId:id,referenceId:'ref_main',relativePath:media.path,
    expectedRevision:revision},decode);
  revision=readCharacterRegistry(root).revision;
  approveCharacter(root,{characterId:id,referenceId:'ref_main',expectedRevision:revision});
  return{media,ref:readCharacterRegistry(root).characters.find(c=>c.characterId===id)!.references[0]};
}
function strict(root:string){
  setStrictCharacterMode(root,{enabled:true,expectedRevision:readCharacterRegistry(root).revision});
}
function map(root:string,key:string,characters:string[],noRecurringCharacter=false,
  continuity:null|{sourceTargetKey:string;relation:'match_subject'|'same_setup'}=null){
  return saveTargetBinding(root,{targetKey:key,characters,noRecurringCharacter,continuity,
    expectedRevision:readTargetBindings(root).revision});
}
type Call={method:string;route:string;body:Record<string,unknown>|null};
function transport(opts:{failPost?:boolean;pauseHealth?:Promise<void>}={}){
  const calls:Call[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input)),method=options?.method??'GET',route=url.pathname;
    const body=options?.body?JSON.parse(String(options.body)) as Record<string,unknown>:null;
    calls.push({method,route,body});
    if(route==='/api/health'){if(opts.pauseHealth)await opts.pauseHealth;
      return new Response(JSON.stringify({version:'test'}),{status:200});}
    if(route==='/api/tasks')return new Response(JSON.stringify({tasks:[]}),{status:200});
    if(method==='POST'&&route==='/api/image/generate'){
      if(opts.failPost)throw new Error('simulated uncertain provider transport');
      return new Response(JSON.stringify({task_id:'ab12cd34',status:'pending'}),{status:202});
    }
    if(route==='/api/status/ab12cd34')
      return new Response(JSON.stringify({task_id:'ab12cd34',status:'completed'}),{status:200});
    if(route==='/api/result/ab12cd34')
      return new Response(JSON.stringify({task_id:'ab12cd34',status:'completed',
        results:['http://127.0.0.1:8765/api/files/identity.png']}),{status:200});
    if(route==='/api/files/identity.png')
      return new Response(new Uint8Array(png(77)),{status:200,
        headers:{'Content-Type':'image/png'}});
    throw new Error('Unexpected mock '+method+' '+route);
  }));
  return{calls,posts:()=>calls.filter(c=>c.method==='POST')};
}
function request(root:string,key:string){
  const spec=prepareNativeImages(appPath,root).jobs.find(j=>j.targetKey===key)!;
  return{targetKey:key,prompt:spec.prompt,model:'nano_banana_2',
    aspectRatio:'9:16',references:spec.references,authorized:true,
    preparedFingerprint:spec.draftIdentity.creativeFingerprint};
}
describe('F24 source-grounded registry, reference payload and strict gates',()=>{
  it('VCR-01/19 creates only project-scoped owner-approved canonical image; legacy read-only reopen makes no files',()=>{
    const {root}=stage(1),filename=path.join(root,'.studio/visual-identity/character-registry-v1.json');
    expect(readCharacterRegistry(root)).toMatchObject({strict:false,revision:0,characters:[]});
    expect(fs.existsSync(filename)).toBe(false);
    const {media,ref}=character(root,'char_001',12);
    expect(readCharacterRegistry(root).characters[0]).toMatchObject({
      characterId:'char_001',status:'APPROVED',canonicalReferenceId:'ref_main'});
    expect(ref.sha256).toBe(sha(fs.readFileSync(path.join(root,media.path))));
    expect(ref.rightsLedgerKey).toMatch(/^[a-f0-9]{64}$/);
    expect(readCharacterRegistry(root).characters[0].status).toBe('APPROVED');
    expect(prepareNativeImages(appPath,root).jobs[0].state).toBe('READY');
    expect(fs.existsSync(filename)).toBe(true);
  });
  it('VCR-02 wrong-project/mutated SHA/missing canonical all fail closed',async()=>{
    const {root,targets}=stage(1),other=stage(1).root;
    character(root,'char_001',15);strict(root);map(root,targets[0].key,['char_001']);
    expect(()=>map(other,getNativeImageGallery(appPath,other).targets[0].key,
      ['char_001'])).toThrow('CHARACTER_MAPPING_UNKNOWN_ID');
    const ref=readCharacterRegistry(root).characters[0].references[0];
    fs.writeFileSync(path.join(root,ref.relativePath),png(81));
    const plan=resolveVisualReferences(root,targets[0].key);
    expect(plan.readiness).toBe('REFERENCE_STALE');
    const {posts}=transport(),dir=credential();
    await expect(submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode)).rejects.toThrow('REFERENCE_STALE');
    expect(posts()).toHaveLength(0);
  });
  it('VCR-03 identical char canonical bytes are encoded in two independent provider requests',async()=>{
    const {root,targets}=stage(2),{ref}=character(root,'char_001',24);
    strict(root);
    for(const target of targets)map(root,target.key,['char_001']);
    const specs=prepareNativeImages(appPath,root).jobs;
    expect(specs.map(j=>j.state)).toEqual(['READY','READY']);
    expect(specs[0].references).toEqual(specs[1].references);
    const {posts}=transport(),dir=credential();
    for(const target of targets)await submitGlabsImage(appPath,root,dir,cipher,
      request(root,target.key),decode);
    expect(posts()).toHaveLength(2);
    const refs=posts().map(call=>call.body!.reference_images as Array<{data:string}>);
    expect(refs[0]).toHaveLength(1);expect(refs[1]).toHaveLength(1);
    expect(refs[0][0].data).toBe(refs[1][0].data);
    expect(Buffer.from(refs[0][0].data.split(',')[1],'base64')).toEqual(
      fs.readFileSync(path.join(root,ref.relativePath)));
    expect(listGlabsJobs(root).map(j=>j.referenceSetSha256)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),expect.stringMatching(/^[a-f0-9]{64}$/)
    ]);
  });
  it('VCR-04 / VCR-05 two owner-mapped characters attach BOTH anchors; explicit no-character remains zero refs',async()=>{
    const {root,targets}=stage(2);
    const a=character(root,'char_001',10),b=character(root,'char_002',70);
    strict(root);
    map(root,targets[0].key,['char_002','char_001']);
    map(root,targets[1].key,[],true);
    const first=resolveVisualReferences(root,targets[0].key);
    expect(first).toMatchObject({readiness:'READY',characterIds:['char_001','char_002']});
    expect(first.references.map(r=>r.anchorId)).toEqual(['char_001','char_002']);
    const second=resolveVisualReferences(root,targets[1].key);
    expect(second).toMatchObject({readiness:'READY',characterIds:[],orderedPaths:[]});
    const {posts}=transport(),dir=credential();
    await submitGlabsImage(appPath,root,dir,cipher,request(root,targets[0].key),decode);
    await submitGlabsImage(appPath,root,dir,cipher,request(root,targets[1].key),decode);
    const bytes=(posts()[0].body!.reference_images as Array<{data:string}>)
      .map(ref=>sha(Buffer.from(ref.data.split(',')[1],'base64')));
    expect(bytes).toEqual([a.ref.sha256,b.ref.sha256]);
    expect(posts()[1].body!.reference_images).toEqual([]);
  });
  it('VCR-06 unclassified strict target returns CHARACTER_MAPPING_REVIEW_REQUIRED without POST',async()=>{
    const {root,targets}=stage(1);strict(root);
    expect(prepareNativeImages(appPath,root).jobs[0].visualReferencePlan?.readiness)
      .toBe('NEEDS_MAPPING_REVIEW');
    const {posts}=transport(),dir=credential();
    await expect(submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode)).rejects.toThrow('CHARACTER_MAPPING_REVIEW_REQUIRED');
    expect(posts()).toHaveLength(0);
  });
  it('VCR-08 more than eight distinct required character references cannot be silently dropped',async()=>{
    const {root,targets}=stage(1);
    const ids:string[]=[];
    for(let i=1;i<=9;i++){
      const id='char_'+String(i).padStart(3,'0');ids.push(id);character(root,id,i*15);
    }
    strict(root);map(root,targets[0].key,ids);
    const plan=resolveVisualReferences(root,targets[0].key);
    expect(plan.readiness).toBe('REFERENCE_BUDGET_EXCEEDED');
    expect(plan.orderedPaths).toHaveLength(9);
    const {posts}=transport(),dir=credential();
    await expect(submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode)).rejects.toThrow('REFERENCE_BUDGET_EXCEEDED');
    expect(posts()).toHaveLength(0);
  });
  it('VCR-09 registry anchor change across async health/auth is rejected before POST',async()=>{
    const {root,targets}=stage(1);
    character(root,'char_001',1);
    const secondary=imported(root,'secondary',92);
    addCharacterReference(root,{characterId:'char_001',referenceId:'ref_side',
      relativePath:secondary.path,expectedRevision:readCharacterRegistry(root).revision},decode);
    strict(root);map(root,targets[0].key,['char_001']);
    let unblock!:()=>void;
    const gate=new Promise<void>(resolve=>{unblock=resolve;});
    const dir=credential(),{posts}=transport({pauseHealth:gate});
    const send=submitGlabsImage(appPath,root,dir,cipher,request(root,targets[0].key),decode);
    // Wait until GET health has entered before changing the approved canonical master.
    await vi.waitFor(()=>expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled());
    const impact=previewCharacterImpact(root,'char_001');
    approveCharacter(root,{characterId:'char_001',referenceId:'ref_side',
      expectedRevision:readCharacterRegistry(root).revision,
      reviewedImpactSha256:impact.impactSha256});
    unblock();
    await expect(send).rejects.toThrow(/GLABS_PREPARED_TARGET_NOT_READY_OR_STALE|REFERENCE_STALE/);
    expect(posts()).toHaveLength(0);
  });
  it('VCR-10 owner source text cannot erase compiler-owned identity master and B1 style',()=>{
    const {root,targets}=stage(1);
    character(root,'char_001',17);strict(root);map(root,targets[0].key,['char_001']);
    const spec=prepareNativeImages(appPath,root).jobs[0];
    const updated=saveNativeImagePrompt(appPath,root,{targetKey:targets[0].key,
      fingerprint:spec.draftIdentity.creativeFingerprint,
      prompt:'Owner edited a different action for this exact shot with no description of appearance.',
      references:[]}).jobs[0];
    expect(updated.effectivePrompt).toContain('APPROVED MODE B STYLE B1');
    expect(updated.effectivePrompt).toContain('CANONICAL CHARACTER IDENTITY REFERENCES');
    expect(updated.effectivePrompt).toContain('Character char_001');
    expect(updated.references).toHaveLength(1);
    expect(updated.identityOwnerReferences).toEqual([]);
  });
  it('VCR-11 VALIDATED output is not an approved continuity source',async()=>{
    const {root,targets}=stage(2);character(root,'char_001',23);
    strict(root);map(root,targets[0].key,['char_001']);
    map(root,targets[1].key,['char_001'],false,
      {sourceTargetKey:targets[0].key,relation:'match_subject'});
    const {posts}=transport(),dir=credential();
    const first=await submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode);
    expect((await pollGlabsImage(appPath,root,dir,cipher,first.id,decode)).status)
      .toBe('VALIDATED');
    expect(resolveVisualReferences(root,targets[1].key).readiness)
      .toBe('CONTINUITY_SOURCE_NOT_READY');
    await expect(submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[1].key),decode)).rejects.toThrow('CONTINUITY_SOURCE_NOT_READY');
    expect(posts()).toHaveLength(1);
  });
  it('VCR-12 current manually approved and bound source is a real exact previous-image dependency',()=>{
    const {root,targets}=stage(2);const a=character(root,'char_001',29);
    strict(root);map(root,targets[0].key,['char_001']);
    map(root,targets[1].key,['char_001'],false,
      {sourceTargetKey:targets[0].key,relation:'same_setup'});
    const pending=getNativeImageGallery(appPath,root);
    expect(pending.targets[0].fulfilled).toBe(false);
    fulfillMedia(appPath,root,pending.token!,targets[0].key,a.media.path,
      'Owner produced and approved image char_001');
    const plan=resolveVisualReferences(root,targets[1].key);
    expect(plan.readiness).toBe('READY');
    expect(plan.sourceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.references.some(ref=>ref.kind==='previous_image'&&
      ref.sha256===a.ref.sha256)).toBe(true);
  });
  it('VCR-14/15 dependency impact is transitive and future/cyclic source mapping fails',()=>{
    const {root,targets}=stage(4);
    character(root,'char_001',31);strict(root);
    map(root,targets[0].key,['char_001']);
    map(root,targets[1].key,[],true,
      {sourceTargetKey:targets[0].key,relation:'same_setup'});
    map(root,targets[2].key,[],true,
      {sourceTargetKey:targets[1].key,relation:'same_setup'});
    map(root,targets[3].key,[],true);
    expect(previewCharacterImpact(root,'char_001').targets).toEqual(
      [targets[0].key,targets[1].key,targets[2].key].sort());
    expect(()=>map(root,targets[0].key,['char_001'],false,
      {sourceTargetKey:targets[2].key,relation:'same_setup'}))
      .toThrow('CONTINUITY_SOURCE_NOT_EARLIER');
  });
  it('VCR-16 a once reviewed bound image becomes unpublishable when canonical SHA changes',()=>{
    const {root,targets}=stage(1);
    const a=character(root,'char_001',37);
    const extra=imported(root,'new-master',87);
    addCharacterReference(root,{characterId:'char_001',referenceId:'replacement',
      relativePath:extra.path,expectedRevision:readCharacterRegistry(root).revision},decode);
    strict(root);map(root,targets[0].key,['char_001']);
    const token=getNativeImageGallery(appPath,root).token!;
    fulfillMedia(appPath,root,token,targets[0].key,a.media.path,
      'Owner produced and approved image char_001');
    const plan=resolveVisualReferences(root,targets[0].key);
    attestBoundVisual(root,{targetKey:targets[0].key,boundSha256:a.ref.sha256,
      referenceSetSha256:plan.referenceSetSha256,ownerConfirmed:true});
    expect(()=>assertStrictProjectPublicationReady(root)).not.toThrow();
    const impact=previewCharacterImpact(root,'char_001');
    approveCharacter(root,{characterId:'char_001',referenceId:'replacement',
      reviewedImpactSha256:impact.impactSha256,expectedRevision:readCharacterRegistry(root).revision});
    expect(()=>assertStrictProjectPublicationReady(root)).toThrow('CHARACTER_PUBLICATION_BLOCKED');
    expect(verifyIdentityMedia(root,a.media.path,a.ref.sha256).sha256).toBe(a.ref.sha256);
  });
  it('VCR-17 active or UNKNOWN provider job blocks canonical replacement with no automatic POST',async()=>{
    const {root,targets}=stage(1);character(root,'char_001',45);
    const next=imported(root,'future-master',88);
    addCharacterReference(root,{characterId:'char_001',referenceId:'future',
      relativePath:next.path,expectedRevision:readCharacterRegistry(root).revision},decode);
    strict(root);map(root,targets[0].key,['char_001']);
    const {posts}=transport({failPost:true}),dir=credential();
    const uncertain=await submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode);
    expect(uncertain.status).toBe('UNKNOWN');
    const impact=previewCharacterImpact(root,'char_001');
    expect(()=>approveCharacter(root,{characterId:'char_001',referenceId:'future',
      reviewedImpactSha256:impact.impactSha256,
      expectedRevision:readCharacterRegistry(root).revision}))
      .toThrow('CHARACTER_IDENTITY_BUSY_PENDING_PROVIDER');
    expect(listGlabsJobs(root)[0].status).toBe('UNKNOWN');
    expect(posts()).toHaveLength(1);
  });
  it('VCR-18 Native Correct changes only the touched creative target mapping',()=>{
    const {root,targets,payload}=stage(2);character(root,'char_001',56);
    strict(root);for(const target of targets)map(root,target.key,['char_001']);
    const first=readNativeDraft(root)!;
    const revised=structuredClone(payload);
    (revised.asset_needs[0] as {content:string}).content+=' UPDATED SOURCE.';
    publishNativeDraftCorrection(appPath,root,first.sha256,revised,{
      correctTaskId:'vcr-correct-1',reviewTaskId:'vcr-reviewed',editableIds:[],
      editablePaths:[],findingIds:[]
    });
    const coverage=characterCoverage(root);
    expect(coverage.targets.find(t=>t.key===targets[0].key)?.mappingCurrent).toBe(false);
    expect(coverage.targets.find(t=>t.key===targets[1].key)?.mappingCurrent).toBe(true);
  });
  it('VCR-20 owner promotion of an APPROVED G-Labs artifact preserves unverified provider license',async()=>{
    const {root,targets}=stage(1);
    const {posts}=transport(),dir=credential();
    const created=await submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode);
    const finished=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(finished.status).toBe('VALIDATED');
    const approved=approveGlabsImage(appPath,root,created.id,undefined,decode);
    registerCharacter(root,{characterId:'char_001',label:'Owner exact artifact',
      expectedRevision:0});
    addCharacterReference(root,{characterId:'char_001',referenceId:'ref_main',
      relativePath:approved.job.approved!.path,sourceJobId:created.id,
      expectedRevision:1},decode);
    const ref=readCharacterRegistry(root).characters[0].references[0];
    expect(ref).toMatchObject({sourceKind:'APPROVED_GLABS',sourceJobId:created.id,
      providerLicenseVerified:false});
    expect(posts()).toHaveLength(1);
  });
  it('VCR-22 reopening source sidecars does not mutate native output or trigger provider calls',()=>{
    const {root}=stage(1);
    const manifest=fs.readFileSync(path.join(root,'project.json'));
    const {posts}=transport();
    character(root,'char_001',42);strict(root);
    const before=readCharacterRegistry(root);
    for(let i=0;i<3;i++)expect(readCharacterRegistry(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(manifest);
    expect(posts()).toHaveLength(0);
  });
  it('VCR-23 strict candidate approval requires human visual attestation bound to SHA/digest',async()=>{
    const {root,targets}=stage(1);character(root,'char_001',77);
    strict(root);map(root,targets[0].key,['char_001']);
    const dir=credential();transport();
    const created=await submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode);
    const staged=await pollGlabsImage(appPath,root,dir,cipher,created.id,decode);
    expect(staged.status).toBe('VALIDATED');
    expect(()=>approveGlabsImage(appPath,root,created.id,undefined,decode))
      .toThrow('CHARACTER_VISUAL_REVIEW_REQUIRED');
    expect(()=>assertVisualCandidateReviewed(root,staged)).toThrow();
    attestVisualCandidate(root,{jobId:staged.id,targetKey:staged.targetKey,
      candidateSha256:staged.staged!.sha256,
      referenceSetSha256:staged.referenceSetSha256!,ownerConfirmed:true});
    expect(()=>assertVisualCandidateReviewed(root,staged)).not.toThrow();
    expect(approveGlabsImage(appPath,root,created.id,undefined,decode).job.status)
      .toBe('APPROVED');
  });
  it('VCR-24 only explicitly mapped and ready target can be billed; unrelated strict target skipped',async()=>{
    const {root,targets}=stage(2);character(root,'char_001',80);
    strict(root);map(root,targets[0].key,['char_001']);
    expect(prepareNativeImages(appPath,root).jobs.map(j=>j.state))
      .toEqual(['READY','BLOCKED']);
    const {posts}=transport(),dir=credential();
    await submitGlabsImage(appPath,root,dir,cipher,
      request(root,targets[0].key),decode);
    expect(posts()).toHaveLength(1);
  });
});
