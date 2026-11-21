// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,png} from './SixIssueFixtures';
import {readState,writeState,atomicJson,sha} from '../../src/main/services';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {compileStyleBible} from '../../src/main/identity/styleBible';
import {contentHash} from '../../src/main/identity/contracts';
import {readIdentityWorkflow,registerValidatedGeneratedReference,
  approveOwnerReference,currentApprovedSource} from '../../src/main/identity/identityWorkflow';
import {readReferenceJob,submitReferenceJob,syncReferenceJob} from '../../src/main/identity/referenceGeneration';
import {saveGlabsKey} from '../../src/main/glabs';

const tmp:string[]=[];
const cipher={isEncryptionAvailable:()=>true,
  encryptString:(v:string)=>Buffer.from(v),
  decryptString:(v:Buffer)=>v.toString('utf8')};
const decode=(bytes:Buffer)=>({png:bytes,width:1,height:1});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  for(const d of tmp.splice(0))fs.rmSync(d,{recursive:true,force:true});});
function setup(){
  const {root}=fixture(),state=readState(root);
  const visualScript='One has a scar and walks.';
  state.approvedScript!.sections=[{id:'opening',text:visualScript}];
  state.approvedScript!.text=visualScript;
  state.approvedScript!.sha256=sha(visualScript);
  state.identityPolicy='v1';writeState(root,state);
  const script=currentApprovedSource(root);
  const analysis={schema:'stickman-script-analysis-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),
    continuity_catalog:{characters:[{
      char_id:'char_001' as const,label:'One',description:'One',
      entity_kind:'human_character' as const,narrative_role:'Story character One',
      explicit_visual_traits:['scar'],identity_markers:['scar'],
      continuity_notes:[],physical_constraints:[],
      occurrences:[{section_id:'opening',quote:'One',start:0,end:3}],
      presence_ranges:[{start:0,end:3}]
    }]}};
  const profile=loadImageStyleProfile(appPath,'B1');
  const bible=compileStyleBible(analysis,script,{
    id:'B1',guidance:profile.guidance,sha256:profile.sha256
  });
  const review={schema:'stickman-analysis-review-v1',project_id:script.projectId,
    analysis_sha256:contentHash(analysis),approved:true,
    independent_review:true,findings:[]};
  atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),{
    schema:'stickman-identity-workflow-v1',projectId:script.projectId,
    revision:1,currentTask:null,draftAnalysis:analysis,draftSha256:contentHash(analysis),
    independentReview:review,analysisApproved:{
      sha256:contentHash(analysis),reviewSha256:contentHash(review),
      approvedAt:new Date().toISOString()
    },bible,bibleTextApproved:{sha256:bible.style_bible_sha256,
      approvedAt:new Date().toISOString()},
    referenceCandidates:[],referenceApprovalSet:null,events:[]
  });
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f24-reference-'));
  tmp.push(dir);saveGlabsKey(dir,cipher,'reference-test-secret');
  return{root,dir};
}
function provider(failPost=false){
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input)),route=url.pathname,
      method=init?.method??'GET';
    calls.push(method+' '+route);
    const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
      status,headers:{'Content-Type':'application/json'}});
    if(route==='/api/health')return json({version:'test'});
    if(route==='/api/tasks')return json({tasks:[]});
    if(route==='/api/image/generate'&&method==='POST'){
      if(failPost)throw Error('simulated uncertain paid submit');
      const request=JSON.parse(String(init?.body)) as {
        aspect_ratio:string;reference_images:unknown[]
      };
      expect(request.aspect_ratio).toBe('1:1');
      expect(request.reference_images).toEqual([]);
      return json({task_id:'ab12cd34',status:'pending'},202);
    }
    if(route==='/api/status/ab12cd34')
      return json({task_id:'ab12cd34',status:'completed'});
    if(route==='/api/result/ab12cd34')
      return json({task_id:'ab12cd34',status:'completed',
        results:['http://127.0.0.1:8765/api/files/ref.png']});
    if(route==='/api/files/ref.png')
      return new Response(new Uint8Array(png()),{
        status:200,headers:{'Content-Type':'image/png'}});
    throw Error('Unexpected GET-only reference transport '+method+' '+route);
  }));
  return{calls,posts:()=>calls.filter(s=>s==='POST /api/image/generate')};
}
describe('F24 isolated 1:1 reference generation with explicit billing/approval boundaries',()=>{
  it('R05/R07 VALIDATED provider image remains unapproved until owner inspects, then enters real media ledger',async()=>{
    const {root,dir}=setup(),mock=provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true});
    expect(job.status).toBe('RUNNING');
    expect(mock.posts()).toHaveLength(1);
    const validated=await syncReferenceJob(appPath,root,dir,cipher,job.id,decode);
    expect(validated.status).toBe('VALIDATED');
    expect(validated.staged?.width).toBe(1);
    expect(readIdentityWorkflow(root).referenceCandidates).toHaveLength(0);
    const start=readIdentityWorkflow(root);
    registerValidatedGeneratedReference(root,appPath,{
      expectedRevision:start.revision,job:validated
    },decode);
    const candidate=readIdentityWorkflow(root).referenceCandidates[0];
    expect(candidate).toMatchObject({status:'VALIDATED',source:'GLABS_GENERATED'});
    const reviewed=approveOwnerReference(root,appPath,{
      expectedRevision:readIdentityWorkflow(root).revision,
      candidateId:candidate.candidate_id,ownerInspected:true
    },decode);
    const approved=reviewed.referenceCandidates[0];
    expect(approved.status).toBe('APPROVED');
    expect(approved.media_path).toMatch(/^assets\/images\//);
    expect(readState(root).media?.some(media=>
      media.path===approved.media_path&&media.sha256===approved.media_sha256&&
      media.rights===approved.rights)).toBe(true);
    expect(mock.posts()).toHaveLength(1);
    expect(mock.calls.filter(call=>call.startsWith('GET /api/'))).toHaveLength(5);
    expect(sha(fs.readFileSync(path.join(root,approved.media_path))))
      .toBe(validated.staged?.sha256);
  });
  it('R06 uncertain paid POST stays UNKNOWN and does not retry without explicit billing acknowledgment',async()=>{
    const {root,dir}=setup(),mock=provider(true);
    const job=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true});
    expect(job.status).toBe('UNKNOWN');
    expect(mock.posts()).toHaveLength(1);
    await expect(submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true,regenerate:true
    })).rejects.toThrow('REFERENCE_UNKNOWN_MAY_HAVE_CHARGED');
    expect(mock.posts()).toHaveLength(1);
    const after=await syncReferenceJob(appPath,root,dir,cipher,job.id,decode);
    expect(after.status).toBe('UNKNOWN');
    expect(mock.posts()).toHaveLength(1);
    expect(readReferenceJob(root,job.id).status).toBe('UNKNOWN');
  });
  it('R07 missing owner authorization always blocks before POST',async()=>{
    const {root,dir}=setup(),mock=provider();
    await expect(submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:false as true
    })).rejects.toThrow('REFERENCE_PAID_POST_OWNER_AUTH_REQUIRED');
    expect(mock.posts()).toHaveLength(0);
  });
});
