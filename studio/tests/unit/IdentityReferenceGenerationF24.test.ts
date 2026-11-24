// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,png} from './SixIssueFixtures';
import {readState,writeState,atomicJson,sha} from '../../src/main/services';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {compileStyleBible} from '../../src/main/identity/styleBible';
import {compileReviewedBible} from './AIIdentityFixtures';
import {frozenLegacyReferencePrompt,frozenRequestedReferencePrompt} from '../../src/main/identity/legacyStorage';
import {contentHash,hash} from '../../src/main/identity/contracts';
import {readIdentityWorkflow,registerValidatedGeneratedReference,
  approveOwnerReference,currentApprovedSource,
  approveOwnerVisualDefinition} from '../../src/main/identity/identityWorkflow';
import {readReferenceJob,submitReferenceJob,syncReferenceJob,
  validateNewReferenceGenerateInput} from '../../src/main/identity/referenceGeneration';
import {saveGlabsKey} from '../../src/main/glabs';

const tmp:string[]=[];
const cipher={isEncryptionAvailable:()=>true,
  encryptString:(v:string)=>Buffer.from(v),
  decryptString:(v:Buffer)=>v.toString('utf8')};
const decode=(bytes:Buffer)=>({png:bytes,width:1,height:1});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  for(const d of tmp.splice(0))fs.rmSync(d,{recursive:true,force:true});});
function setup(underdescribed=false,fromAuthor=false,historical=false){
  const {root}=fixture(),state=readState(root);
  const visualScript=underdescribed?'One walks.':'One has a scar and walks.';
  if(fromAuthor)state.approvedScript!.authoring={
    characters:[{name:'One',appearance:'One wears a red coat.'}]
  };
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
      narrative_role:'Story character One',
      explicit_visual_traits:underdescribed?[]:['scar'],
      visual_trait_evidence:underdescribed?[]:[{trait:'scar',
        relationship:'intrinsic_appearance' as const,
        source:{section_id:'opening',quote:'One has a scar',start:0,end:14}}],
      identity_markers:underdescribed?[]:['scar'],
      continuity_notes:[],physical_constraints:[],
      occurrences:[{section_id:'opening',quote:'One',start:0,end:3}],
      presence_ranges:[{start:0,end:3}]
    }]}};
  const profile=loadImageStyleProfile(appPath,'B1');
  const bible=(historical?compileStyleBible:compileReviewedBible)(analysis,script,{
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
  it('G05 optional owner override uses exact Script Author source evidence without lexical inference',async()=>{
    const {root,dir}=setup(true,true),mock=provider();
    expect(readIdentityWorkflow(root).bible!.characters[0].visual_readiness).toBe('READY_FOR_REFERENCE');
    expect(mock.posts()).toHaveLength(0);
    await expect(()=>approveOwnerVisualDefinition(root,appPath,{
      expectedRevision:readIdentityWorkflow(root).revision,anchorId:'char_001',
      provenance:'SCRIPT_AUTHOR',traits:['blue hair'],
      evidence:'No such source text exists.',ownerInspected:true
    })).toThrow('OWNER_VISUAL_AUTHORING_EVIDENCE_MISSING');
    const reviewed=approveOwnerVisualDefinition(root,appPath,{
      expectedRevision:readIdentityWorkflow(root).revision,anchorId:'char_001',
      provenance:'SCRIPT_AUTHOR',traits:['red coat'],
      evidence:'One wears a red coat.',ownerInspected:true
    });
    expect(reviewed.ownerVisualDefinitions?.[0].traits).toEqual(['red coat']);
    expect(reviewed.referenceApprovalSet).toBe(null);
    const created=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true
    });
    expect(created.ownerVisualDefinitionSha)
      .toBe(reviewed.ownerVisualDefinitions?.[0].definitionSha);
    expect(created.prompt).toContain('red coat');
    expect(mock.posts()).toHaveLength(1);
    const valid=await syncReferenceJob(appPath,root,dir,cipher,created.id,decode);
    const prior=readIdentityWorkflow(root);
    const imported=registerValidatedGeneratedReference(root,appPath,{
      expectedRevision:prior.revision,job:valid
    },decode);
    const candidate=imported.referenceCandidates[0];
    expect(candidate.visual_definition_sha256)
      .toBe(reviewed.ownerVisualDefinitions?.[0].definitionSha);
  });
  it('G06 optional owner brief augments approved AI design without rewriting it',async()=>{
    const {root,dir}=setup(true),mock=provider();
    const approved=approveOwnerVisualDefinition(root,appPath,{
      expectedRevision:readIdentityWorkflow(root).revision,anchorId:'char_001',
      provenance:'OWNER_BRIEF',traits:['plain green scarf'],
      evidence:'Owner drew a plain green scarf for this character.',
      ownerInspected:true
    });
    const job=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true
    });
    expect(job.prompt).toContain('plain green scarf');
    expect(job.ownerVisualDefinitionSha).toBe(
      approved.ownerVisualDefinitions?.[0].definitionSha);
    expect(mock.posts()).toHaveLength(1);
  });
  it('EK-12 frozen historical group UNKNOWN job keeps original prompt and reconciles GET-only',async()=>{
    const {root,dir}=setup(),original=readIdentityWorkflow(root);
    const source=currentApprovedSource(root);
    const profile=loadImageStyleProfile(appPath,'B1');
    const pinned={id:'B1' as const,guidance:profile.guidance,sha256:profile.sha256};
    const oldAnalysis={...original.draftAnalysis!,
      continuity_catalog:{characters:original.draftAnalysis!.continuity_catalog.characters
        .map(char=>({...char,entity_kind:'human_group' as const}))}};
    const inherited=structuredClone(oldAnalysis.continuity_catalog.characters[0]);
    const definitionSha=contentHash({inherited,styleId:pinned.id,styleSha:pinned.sha256});
    const oldCharacter={...inherited,source_definition_hash:definitionSha,
      visual_readiness:'READY_FOR_REFERENCE' as const};
    const bibleBase={schema:'stickman-project-style-bible-v1' as const,
      project_id:source.projectId,source_script_sha256:source.sha256,
      source_authoring_sha256:contentHash(source.authoring),
      analysis_sha256:contentHash(oldAnalysis),
      style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
      style_guidance_sha256:hash(pinned.guidance),characters:[oldCharacter]};
    const bible={...bibleBase,style_bible_sha256:contentHash(bibleBase)};
    const reviewed={...original.independentReview!,
      analysis_sha256:contentHash(oldAnalysis)};
    const approved={...original.analysisApproved!,
      sha256:contentHash(oldAnalysis),reviewSha256:contentHash(reviewed)};
    const filename=path.join(root,'.studio/identity/workflow-v1.json');
    atomicJson(filename,{...original,draftAnalysis:oldAnalysis,
      draftSha256:contentHash(oldAnalysis),independentReview:reviewed,
      analysisApproved:approved,bible,bibleTextApproved:{
        ...original.bibleTextApproved!,sha256:bible.style_bible_sha256
      }});
    const workflowBytes=fs.readFileSync(filename);
    const oldPrompt=frozenLegacyReferencePrompt(bible,'char_001',pinned);
    const id='12345678-1234-1234-1234-123456789012';
    const persisted={
      schema:'stickman-reference-generate-job-v1',id,
      projectId:source.projectId,anchorId:'char_001',
      sourceDefinitionHash:definitionSha,styleBibleSha:bible.style_bible_sha256,
      styleProfileSha:pinned.sha256,analysisSha:bible.analysis_sha256,
      approvedScriptSha:source.sha256,
      prompt:oldPrompt.prompt,promptSha:oldPrompt.prompt_sha256,
      model:'nano_banana_2',aspectRatio:'1:1',
      status:'UNKNOWN',providerTaskId:'ab12cd34',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    fs.mkdirSync(path.join(root,'.studio/identity/reference-jobs'),{recursive:true});
    atomicJson(path.join(root,'.studio/identity/reference-jobs',id+'.json'),persisted);
    const mock=provider();
    const result=await syncReferenceJob(appPath,root,dir,cipher,id,decode);
    expect(result.status).toBe('VALIDATED');
    expect(result.prompt).toBe(persisted.prompt);
    expect(result.promptSha).toBe(persisted.promptSha);
    expect(result).not.toHaveProperty('referenceFormat');
    expect(result.staged?.width).toBe(result.staged?.height);
    expect(mock.posts()).toHaveLength(0);
    expect(readIdentityWorkflow(root).referenceCandidates).toHaveLength(0);
    expect(fs.readFileSync(filename).equals(workflowBytes)).toBe(true);
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
  it('RFG-06 rejects any retired generation option before network or paid POST',async()=>{
    const {root,dir}=setup(),mock=provider();
    for(const referenceFormat of ['group_overview','four_view','animal']){
      const legacy={anchorId:'char_001',authorized:true,referenceFormat};
      expect(()=>validateNewReferenceGenerateInput(legacy))
        .toThrow('REFERENCE_GENERATION_REQUEST_UNKNOWN_FIELD');
      await expect(submitReferenceJob(appPath,root,dir,cipher,
        legacy as unknown as Parameters<typeof submitReferenceJob>[4]))
        .rejects.toThrow('REFERENCE_GENERATION_REQUEST_UNKNOWN_FIELD');
    }
    expect(mock.calls).toHaveLength(0);
  });
  it('G05/G06 underdescribed character can generate from reviewed AI design alone',async()=>{
    const {root,dir}=setup(true),mock=provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    expect(job.prompt).toContain('Draw the approved angular silhouette with a copper scarf');
    expect(mock.posts()).toHaveLength(1);
  });
  it('G06 historical Bible cannot authorize new paid reference creation',async()=>{
    const {root,dir}=setup(false,false,true),mock=provider();
    await expect(submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true}))
      .rejects.toThrow('STYLE_DESIGN_REAPPROVAL_REQUIRED');
    expect(mock.posts()).toHaveLength(0);
  });
  it('RFG-03/04 creates only one 1:1 four-view job without retired format field',async()=>{
    const {root,dir}=setup(),mock=provider();
    const created=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true
    });
    expect(created.aspectRatio).toBe('1:1');
    expect(created.prompt).toContain('Exactly FOUR edge-to-edge panels in a 2×2 sheet');
    expect(created.prompt).not.toContain('ONE GROUP OVERVIEW');
    expect(created).not.toHaveProperty('referenceFormat');
    expect(readReferenceJob(root,created.id)).not.toHaveProperty('referenceFormat');
    expect(mock.posts()).toHaveLength(1);
  });
  it('RFG-12 frozen requested group/four-view jobs keep exact SHA and GET-only recovery',async()=>{
    const {root,dir}=setup(false,false,true),mock=provider();
    const snapshot=readIdentityWorkflow(root),script=currentApprovedSource(root);
    const profile=loadImageStyleProfile(appPath,'B1');
    const pinned={id:'B1' as const,guidance:profile.guidance,sha256:profile.sha256};
    const history:unknown[]=[];
    for(const [index,referenceFormat] of (['group_overview','four_view'] as const).entries()){
      const frozen=frozenRequestedReferencePrompt(snapshot.bible!,
        'char_001',pinned,undefined,referenceFormat);
      const id=index===0?'12345678-1234-1234-1234-123456789012':
        '22345678-1234-1234-1234-123456789012';
      const job={schema:'stickman-reference-generate-job-v1',id,
        projectId:script.projectId,anchorId:'char_001',
        sourceDefinitionHash:frozen.source_definition_hash,
        styleBibleSha:snapshot.bible!.style_bible_sha256,
        styleProfileSha:pinned.sha256,analysisSha:snapshot.bible!.analysis_sha256,
        approvedScriptSha:script.sha256,prompt:frozen.prompt,promptSha:frozen.prompt_sha256,
        referenceFormat,model:'nano_banana_2',aspectRatio:'1:1',
        status:'UNKNOWN',providerTaskId:'ab12cd34',
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      };
      const folder=path.join(root,'.studio/identity/reference-jobs');
      fs.mkdirSync(folder,{recursive:true});
      atomicJson(path.join(folder,id+'.json'),job);
      const finished=await syncReferenceJob(appPath,root,dir,cipher,id,decode);
      expect(finished.status).toBe('VALIDATED');
      expect(finished.prompt).toBe(job.prompt);
      expect(finished.promptSha).toBe(job.promptSha);
      expect(finished.referenceFormat).toBe(referenceFormat);
      history.push(finished);
    }
    expect(history).toHaveLength(2);
    expect(mock.posts()).toHaveLength(0);
    expect(readIdentityWorkflow(root).referenceCandidates).toHaveLength(0);
  });
  it('R07 missing owner authorization always blocks before POST',async()=>{
    const {root,dir}=setup(),mock=provider();
    await expect(submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:false as true
    })).rejects.toThrow('REFERENCE_PAID_POST_OWNER_AUTH_REQUIRED');
    expect(mock.posts()).toHaveLength(0);
  });
});
