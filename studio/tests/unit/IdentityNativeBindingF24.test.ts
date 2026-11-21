// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,nativePayload,stageNative,png} from './SixIssueFixtures';
import {importMediaFile,confirmImport,getNativeImageGallery} from '../../src/main/externalTasks';
import {prepareNativeImages} from '../../src/main/imagePreparation';
import {saveGlabsKey,submitGlabsImage,
  pollGlabsImage,approveGlabsImage} from '../../src/main/glabs';
import {readState,writeState,atomicJson,sha} from '../../src/main/services';
import {contentHash} from '../../src/main/identity/contracts';
import {compileStyleBible,referencePromptForCharacter} from '../../src/main/identity/styleBible';
import {approveCandidate,publishApprovalSet} from '../../src/main/identity/referencePublication';
import {currentApprovedSource} from '../../src/main/identity/identityWorkflow';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {assertPublishedIdentityCurrent} from '../../src/main/identity/finalGate';
import {readApprovedNativeIdentity} from '../../src/main/identity/nativeBinding';
import {readIdentityWorkflow,publishStyleBibleReferences} from '../../src/main/identity/identityWorkflow';
import {previewReferenceSwitchImpact} from '../../src/main/identity/impact';
import type {ReferenceCandidate} from '../../src/main/identity/referencePublication';

const dirs:string[]=[];
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});
});
const cipher={isEncryptionAvailable:()=>true,
  encryptString:(text:string)=>Buffer.from(text),
  decryptString:(bytes:Buffer)=>bytes.toString('utf8')};
const decode=(input:Buffer)=>({png:input,width:1,height:1});
const owned=(root:string,suffix:string)=>{
  const original=path.join(root,'ref-'+suffix+'.png');
  fs.writeFileSync(original,png());
  return importMediaFile(root,original,'image','Owner-created reference image; rights authorized');
};
function setup(){
  const {root}=fixture();
  const state=readState(root);state.identityPolicy='v1';writeState(root,state);
  const script=currentApprovedSource(root);
  const analysis={
    schema:'stickman-script-analysis-v1' as const,project_id:script.projectId,
    source_script_sha256:script.sha256,source_authoring_sha256:contentHash(script.authoring),
    continuity_catalog:{characters:[{
      char_id:'char_001' as const,label:'One',description:'Narrative subject One',
      entity_kind:'human_character' as const,narrative_role:'Named character',
      explicit_visual_traits:[],identity_markers:['One'],continuity_notes:[],
      physical_constraints:[],
      occurrences:[{section_id:'opening',quote:'One',start:0,end:3}],
      presence_ranges:[{start:0,end:3}]
    }]}
  };
  const profile=loadImageStyleProfile(appPath,'B1');
  const pinned={id:'B1' as const,guidance:profile.guidance,sha256:profile.sha256};
  const bible=compileStyleBible(analysis,script,pinned);
  const ref=owned(root,'first');
  const prompt=referencePromptForCharacter(bible,'char_001',pinned);
  const pending:ReferenceCandidate={
    schema:'stickman-visual-reference-candidate-v1',project_id:script.projectId,
    candidate_id:'approved-candidate-1',anchor_type:'character',anchor_id:'char_001',
    source_definition_hash:bible.characters[0].source_definition_hash,
    style_bible_sha256:bible.style_bible_sha256,
    prompt_sha256:prompt.prompt_sha256,
    provider_job_id:null,model:'owner_imported',aspect_ratio:'1:1',
    media_path:ref.path,media_sha256:ref.sha256,media_mime:'image/png',
    width:1,height:1,rights:'Owner-created reference image; rights authorized',
    source:'OWNER_IMPORTED',status:'VALIDATED',approval_event_id:null,approved_at:null
  };
  const approved=approveCandidate(pending,bible,root,true,decode);
  const set=publishApprovalSet(root,bible,[approved],1,decode);
  const review={
    schema:'stickman-analysis-review-v1',project_id:script.projectId,
    analysis_sha256:contentHash(analysis),independent_review:true,
    findings:[],approved:true
  };
  const record={
    schema:'stickman-identity-workflow-v1',projectId:script.projectId,revision:1,
    currentTask:null,draftAnalysis:analysis,draftSha256:contentHash(analysis),
    independentReview:review,
    analysisApproved:{sha256:contentHash(analysis),approvedAt:new Date().toISOString(),
      reviewSha256:contentHash(review)},
    bible,bibleTextApproved:{sha256:bible.style_bible_sha256,
      approvedAt:new Date().toISOString()},
    referenceCandidates:[approved],referenceApprovalSet:set,events:[]
  };
  atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),record);
  const raw=nativePayload(root,{image:'both'});
  const needs=[
    {shot_id:'shot-1',layer_id:'image-1',expected_path:'assets/images/missing.png',
      content:'Source-grounded first frame',character_ids:['char_001']},
    {shot_id:'shot-2',layer_id:'image-2',expected_path:'assets/images/late.png',
      content:'Source-grounded second frame',character_ids:['char_001']}
  ];
  const source={...raw,asset_needs:needs};
  stageNative(root,source);
  return{root,ref,bible,set,source};
}
type RequestCapture={method:string;pathname:string;body:Record<string,unknown>|null};
function fakeProvider(){
  const calls:RequestCapture[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input)),method=init?.method??'GET';
    const pathname=url.pathname;
    const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:null;
    calls.push({method,pathname,body});
    const send=(value:unknown,status=200)=>
      new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(pathname==='/api/health')return send({version:'test'});
    if(pathname==='/api/tasks')return send({tasks:[]});
    if(method==='POST'&&pathname==='/api/image/generate')
      return send({task_id:'ab12cd34',status:'pending'},202);
    if(pathname==='/api/status/ab12cd34')
      return send({task_id:'ab12cd34',status:'completed'});
    if(pathname==='/api/result/ab12cd34')
      return send({task_id:'ab12cd34',status:'completed',
        results:['http://127.0.0.1:8765/api/files/image.png']});
    if(pathname==='/api/files/image.png')
      return new Response(new Uint8Array(png()),{
        status:200,headers:{'Content-Type':'image/png'}});
    throw new Error('Unexpected '+method+' '+pathname);
  }));
  return{calls,posts:()=>calls.filter(c=>c.method==='POST')};
}
function account(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f24-glabs-'));
  dirs.push(dir);saveGlabsKey(dir,cipher,'unit-test-secret');
  return dir;
}
function request(root:string,key:string){
  const spec=prepareNativeImages(appPath,root).jobs.find(v=>v.targetKey===key)!;
  return{targetKey:key,prompt:spec.prompt,model:'nano_banana_2',
    aspectRatio:'9:16',references:spec.references,authorized:true,
    preparedFingerprint:spec.draftIdentity.creativeFingerprint};
}
describe('F24 Native canonical bytes, billing gate and final source receipt',()=>{
  it('N02/N06 two independent Layer POST payloads contain identical source-verified canonical PNG bytes',async()=>{
    const {root,ref}=setup();
    const prepared=prepareNativeImages(appPath,root);
    expect(prepared.jobs).toHaveLength(2);
    expect(prepared.jobs.map(v=>v.state)).toEqual(['READY','READY']);
    expect(prepared.jobs[0].references).toEqual([ref.path]);
    expect(prepared.jobs[1].references).toEqual([ref.path]);
    expect(prepared.jobs[0].identityBindingSnapshotSha).toMatch(/^[a-f0-9]{64}$/);
    const auth=account(),{posts}=fakeProvider();
    for(const spec of prepared.jobs)
      await submitGlabsImage(appPath,root,auth,cipher,
        request(root,spec.targetKey),decode);
    expect(posts()).toHaveLength(2);
    const encoded=posts().map(row=>(row.body?.reference_images as
      Array<{data:string}>)[0].data.split(',')[1]);
    expect(encoded[0]).toBe(encoded[1]);
    expect(sha(Buffer.from(encoded[0],'base64'))).toBe(ref.sha256);
  });
  it('U06/N08 tampered independent Analysis review digest cannot authorize Native image references',()=>{
    const {root}=setup();
    const verified=readApprovedNativeIdentity(root,appPath);
    expect(verified.anchors[0].charId).toBe('char_001');
    const altered=readIdentityWorkflow(root);
    altered.analysisApproved!.reviewSha256='0'.repeat(64);
    atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),altered);
    expect(()=>readApprovedNativeIdentity(root,appPath))
      .toThrow('IDENTITY_NATIVE_ANALYSIS_STALE');
    expect(()=>prepareNativeImages(appPath,root))
      .toThrow('IDENTITY_NATIVE_ANALYSIS_STALE');
  });
  it('N08 direct manual paid POST without prepared exact Native identity cannot bypass F24',async()=>{
    const {root}=setup(),accountRoot=account(),{posts}=fakeProvider();
    const target=getNativeImageGallery(appPath,root).targets[0];
    await expect(submitGlabsImage(appPath,root,accountRoot,cipher,{
      targetKey:target.key,prompt:'Owner manual prompt that tries to skip canonical',
      model:'nano_banana_2',aspectRatio:'9:16',references:[],
      authorized:true
    },decode)).rejects.toThrow('IDENTITY_PREPARED_FINGERPRINT_REQUIRED');
    expect(posts()).toHaveLength(0);
  });
  it('C08/C09 approved outputs require current canonical set and native receipt after confirm',async()=>{
    const {root}=setup(),accountRoot=account();fakeProvider();
    const keys=prepareNativeImages(appPath,root).jobs.map(job=>job.targetKey);
    for(const key of keys){
      const created=await submitGlabsImage(appPath,root,accountRoot,cipher,
        request(root,key),decode);
      const validated=await pollGlabsImage(appPath,root,accountRoot,cipher,created.id,decode);
      expect(validated.status).toBe('VALIDATED');
      const bound=approveGlabsImage(appPath,root,created.id,undefined,decode);
      expect(bound.job.status).toBe('APPROVED');
    }
    expect(getNativeImageGallery(appPath,root).targets.every(t=>t.fulfilled)).toBe(true);
    // Native validate/confirm use a stubbed original CLI but real staged media SHA,
    // rights, G-Labs job and frozen identity snapshots.
    const original=readState(root);
    expect(original.tasks?.native?.status).toBe('FROZEN');
    const simulated=async(_exe:string,args:string[])=>{
      const candidate=fs.readFileSync(args[2]);
      return{code:0,stdout:JSON.stringify({valid:true,
        fingerprint:sha(candidate),checked_seconds:30}),stderr:''};
    };
    await confirmImport(appPath,root,
      (await import('../../src/main/externalTasks')).getPendingMedia(appPath,root)!.token,
      {previewSeconds:20,validator:simulated});
    expect(()=>assertPublishedIdentityCurrent(root,appPath)).not.toThrow();
    const pathToReceipt=path.join(root,'.studio/identity/native-publication-v1.json');
    expect(fs.existsSync(pathToReceipt)).toBe(true);
    // A distinct owner approval event for a canonical source (even if the
    // pixel file is byte-identical) changes the published reference authority.
    // Old Native bytes stay intact but cannot be silently reused for render.
    const journal=readIdentityWorkflow(root),previous=journal.referenceCandidates[0];
    const rotated=approveCandidate({
      ...previous,candidate_id:'second-owner-reviewed-candidate',
      status:'VALIDATED',approval_event_id:null,approved_at:null
    },journal.bible!,root,true,decode);
    journal.referenceCandidates.push(rotated);
    atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),journal);
    const impact=previewReferenceSwitchImpact(root,[rotated.candidate_id]);
    expect(impact.publishedNativeAffected).toBe(true);
    publishStyleBibleReferences(root,appPath,journal.revision,[rotated.candidate_id],
      decode,impact.impactSha256);
    expect(()=>assertPublishedIdentityCurrent(root,appPath))
      .toThrow('IDENTITY_PUBLISHED_REFERENCE_LINEAGE_STALE');
  });
});
