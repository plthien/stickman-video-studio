// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,png,nativePayload} from './SixIssueFixtures';
import {readState,writeState,atomicJson,sha} from '../../src/main/services';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {compileStyleBible,compileAutomaticStyleBible,validateStyleBibleCurrent,referencePromptForCharacter} from '../../src/main/identity/styleBible';
import {compileReviewedBible,aiDesignFixture} from './AIIdentityFixtures';
import {frozenLegacyReferencePrompt,frozenRequestedReferencePrompt} from '../../src/main/identity/legacyStorage';
import {contentHash,hash} from '../../src/main/identity/contracts';
import {readIdentityWorkflow,registerValidatedGeneratedReference,
  approveOwnerReference,currentApprovedSource,prepareAutomaticReferenceGallery,
  approveOwnerVisualDefinition,currentOwnerVisualDefinition,prepareProjectStyleBible,freezeStyleBibleTask,
  importStyleBibleResult,approveProjectStyleBible,publishStyleBibleReferences,publishedIdentityView} from '../../src/main/identity/identityWorkflow';
import {readReferenceJob,submitReferenceJob,syncReferenceJob,
  validateNewReferenceGenerateInput} from '../../src/main/identity/referenceGeneration';
import {saveGlabsKey,glabsSettings,buildReferenceProviderRequest} from '../../src/main/glabs';
import {readApprovedNativeIdentity,validateNativeBindingPayload} from '../../src/main/identity/nativeBinding';
import {previewReferenceSwitchImpact} from '../../src/main/identity/impact';

const tmp:string[]=[];
const cipher={isEncryptionAvailable:()=>true,
  encryptString:(v:string)=>Buffer.from(v),
  decryptString:(v:Buffer)=>v.toString('utf8')};
const decode=(bytes:Buffer)=>({png:bytes,width:1,height:1});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  for(const d of tmp.splice(0))fs.rmSync(d,{recursive:true,force:true});});
function setup(underdescribed=false,fromAuthor=false,historical=false,
  options:{preserveAlignedTranscript?:boolean}={}){
  const {root}=fixture(),state=readState(root);
  // Native payloads require the original aligned WORDS and approved Caption
  // receipt. The shared fixture already has an underdescribed actor, One.
  if(options.preserveAlignedTranscript&&!underdescribed)
    throw Error('Aligned fixture does not establish the scar trait.');
  const visualScript=options.preserveAlignedTranscript?state.approvedScript!.text:
    underdescribed?'One walks.':'One has a scar and walks.';
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
  const calls:string[]=[],payloads:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input)),route=url.pathname,
      method=init?.method??'GET';
    calls.push(method+' '+route);
    const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
      status,headers:{'Content-Type':'application/json'}});
    if(route==='/api/health')return json({version:'test'});
    if(route==='/api/tasks')return json({tasks:[]});
    if(['/api/image/generate','/api/openai/generate'].includes(route)&&method==='POST'){
      if(failPost)throw Error('simulated uncertain paid submit');
      const request=JSON.parse(String(init?.body)) as {
        aspect_ratio:string;reference_images:unknown[]
      };
      payloads.push(request);
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
  return{calls,payloads,posts:()=>calls.filter(s=>s.startsWith('POST '))};
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

describe('AF02 — optional owner definition exact authority',()=>{
  const override=(root:string)=>approveOwnerVisualDefinition(root,appPath,{
    expectedRevision:readIdentityWorkflow(root).revision,anchorId:'char_001',
    provenance:'OWNER_BRIEF',evidence:'Owner explicitly approves a green scarf.',
    traits:['green scarf'],ownerInspected:true});
  function nextBible(root:string){
    const author=prepareProjectStyleBible(root,appPath,readIdentityWorkflow(root).revision);
    const profile=loadImageStyleProfile(appPath,'B1');
    const {design,review}=aiDesignFixture(author.draftAnalysis!,{id:'B1',sha256:profile.sha256,guidance:profile.guidance});
    design.characters[0].visual_design='Approved AI design B with a blue geometric silhouette.';
    design.characters[0].reference_prompt='Draw the reviewed design B blue geometric silhouette.';
    design.characters[0].creative_decisions=['Blue geometric silhouette'];
    review.candidate_sha256=contentHash(design);
    const wrap=(record:ReturnType<typeof readIdentityWorkflow>,payload:unknown)=>{
      const task=record.styleDesignTask!.task;
      return JSON.stringify({schema:'mode-b-style-design-result-v1',stage:task.stage,task_id:task.task_id,
        project_id:task.project_id,revision:task.revision,input_sha256:task.input_sha256,payload});
    };
    const imported=importStyleBibleResult(root,appPath,wrap(author,design),author.revision);
    const reviewing=freezeStyleBibleTask(root,appPath,'review',imported.revision);
    const reviewed=importStyleBibleResult(root,appPath,wrap(reviewing,review),reviewing.revision);
    return approveProjectStyleBible(root,appPath,reviewed.revision,true);
  }
  it('AF02-01/02 historical override does not block generation from the new AI design',async()=>{
    const {root,dir}=setup(true),old=override(root),mock=provider();
    const next=nextBible(root);
    expect(next.bible!.style_bible_sha256).not.toBe(old.bible!.style_bible_sha256);
    expect(currentOwnerVisualDefinition(root,appPath,'char_001')).toBeNull();
    expect(next.ownerVisualDefinitions).toEqual(old.ownerVisualDefinitions);
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    expect(job.ownerVisualDefinitionSha).toBeUndefined();
    expect(job.prompt).toContain('Draw the reviewed design B blue geometric silhouette.');
    expect(job.prompt).not.toContain('green scarf');
    expect(mock.posts()).toHaveLength(1);
  });
  it('AF02-03/04/05/07 identical override on a new Bible is a new approval; same-lineage repeats are idempotent through candidate approval',async()=>{
    const {root,dir}=setup(true),old=override(root);
    nextBible(root);
    const updated=override(root),current=currentOwnerVisualDefinition(root,appPath,'char_001')!;
    expect(current.styleBibleSha).toBe(updated.bible!.style_bible_sha256);
    expect(current.definitionSha).not.toBe(old.ownerVisualDefinitions![0].definitionSha);
    expect(updated.ownerVisualDefinitions).toContainEqual(old.ownerVisualDefinitions![0]);
    expect(override(root)).toEqual(updated);
    const mock=provider(),job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    expect(job.prompt).toContain('green scarf');
    expect(job.ownerVisualDefinitionSha).toBe(current.definitionSha);
    const validated=await syncReferenceJob(appPath,root,dir,cipher,job.id,decode);
    const registered=registerValidatedGeneratedReference(root,appPath,{expectedRevision:readIdentityWorkflow(root).revision,job:validated},decode);
    expect(registered.referenceCandidates[0].visual_definition_sha256).toBe(current.definitionSha);
    const approved=approveOwnerReference(root,appPath,{expectedRevision:registered.revision,
      candidateId:registered.referenceCandidates[0].candidate_id,ownerInspected:true},decode);
    expect(approved.referenceCandidates[0].status).toBe('APPROVED');
    expect(mock.posts()).toHaveLength(1);
  });
  it('AF02-06 corrupted current SHA or Script lineage fails closed before any POST',async()=>{
    const {root,dir}=setup(true),approved=override(root),mock=provider();
    const file=path.join(root,'.studio/identity/workflow-v1.json');
    for(const patch of [{definitionSha:'0'.repeat(64)},{sourceScriptSha:'0'.repeat(64)},{approvedByOwner:false}]){
      const corrupt=structuredClone(approved);
      Object.assign(corrupt.ownerVisualDefinitions![0],patch);atomicJson(file,corrupt);
      await expect(submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true}))
        .rejects.toThrow(/OWNER_VISUAL_DEFINITION/);
    }
    expect(mock.posts()).toHaveLength(0);
  });
  it('AF02-08 original paid job recovers by original Bible and override after new design and reapproval; no new POST',async()=>{
    const {root,dir}=setup(true),old=override(root);
    provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    expect(job.ownerVisualDefinitionSha).toBe(old.ownerVisualDefinitions![0].definitionSha);
    nextBible(root);override(root);
    const mock=provider();
    const recovered=await syncReferenceJob(appPath,root,dir,cipher,job.id,decode);
    expect(recovered.status).toBe('VALIDATED');
    expect(recovered.prompt).toBe(job.prompt);
    expect(recovered.promptSha).toBe(job.promptSha);
    expect(recovered.ownerVisualDefinitionSha).toBe(job.ownerVisualDefinitionSha);
    expect(recovered.providerTaskId).toBe(job.providerTaskId);
    expect(mock.posts()).toHaveLength(0);
    expect(mock.calls.every(call=>call.startsWith('GET '))).toBe(true);
    expect(()=>registerValidatedGeneratedReference(root,appPath,{expectedRevision:readIdentityWorkflow(root).revision,job:recovered},decode))
      .toThrow('REFERENCE_GENERATION_SOURCE_STALE');
  });
  it('AF02-09 new design and optional override never republish the existing canonical reference set',async()=>{
    const {root,dir}=setup(true);override(root);provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    const validated=await syncReferenceJob(appPath,root,dir,cipher,job.id,decode);
    const registered=registerValidatedGeneratedReference(root,appPath,{expectedRevision:readIdentityWorkflow(root).revision,job:validated},decode);
    const approved=approveOwnerReference(root,appPath,{expectedRevision:registered.revision,
      candidateId:registered.referenceCandidates[0].candidate_id,ownerInspected:true},decode);
    const published=publishStyleBibleReferences(root,appPath,approved.revision,[approved.referenceCandidates[0].candidate_id],decode);
    const original=published.publishedAuthority;
    nextBible(root);override(root);
    const after=readIdentityWorkflow(root);
    expect(after.publishedAuthority).toEqual(original);
    expect(publishedIdentityView(after).referenceApprovalSet).toEqual(published.referenceApprovalSet);
    expect(after.referenceCandidates[0]).toEqual(published.referenceCandidates[0]);
  });
});

describe('SB automatic reference authority and verified provider model contracts',()=>{
  const prepare=(root:string)=>prepareAutomaticReferenceGallery(root,appPath,readIdentityWorkflow(root).revision,decode);
  const approve=(root:string,candidateId:string)=>approveOwnerReference(root,appPath,{
    expectedRevision:readIdentityWorkflow(root).revision,candidateId,ownerInspected:true
  },decode);
  const materialize=async(root:string,dir:string,jobId:string)=>{
    const validated=await syncReferenceJob(appPath,root,dir,cipher,jobId,decode);
    expect(validated.status).toBe('VALIDATED');
    const journal=registerValidatedGeneratedReference(root,appPath,{
      expectedRevision:readIdentityWorkflow(root).revision,job:validated
    },decode);
    return{validated,candidate:journal.referenceCandidates.at(-1)!};
  };
  it('SB01–05/SB08/SB19 compiles an underdescribed approved catalog without filtering or a fabricated review',()=>{
    const {root}=setup(true,false,true),prior=readIdentityWorkflow(root),source=currentApprovedSource(root);
    const profile=loadImageStyleProfile(appPath,'B1');
    const pinned={id:'B1' as const,guidance:profile.guidance,sha256:profile.sha256};
    const updated=prepare(root),bible=updated.bible!;
    expect(bible.automatic_authority).toEqual({version:'automatic-reference-authority-v1'});
    expect(bible.design_authority).toBeUndefined();
    expect(updated.bibleTextApproved).toBeNull();
    expect(updated.independentReview).toEqual(prior.independentReview);
    expect(updated.analysisApproved).toEqual(prior.analysisApproved);
    expect(bible.characters[0]).toMatchObject(prior.draftAnalysis!.continuity_catalog.characters[0]);
    expect(bible.characters[0].visual_readiness).toBe('READY_FOR_REFERENCE');
    expect(bible.characters[0].ai_design).toBeUndefined();
    expect(bible.style_profile_sha256).toBe(pinned.sha256);
    expect(bible).toEqual(compileAutomaticStyleBible(prior.draftAnalysis!,source,pinned));
    const prompt=referencePromptForCharacter(bible,'char_001',pinned);
    expect(prompt.prompt).toContain(JSON.stringify(prior.draftAnalysis!.continuity_catalog.characters[0]));
    expect(prompt.prompt).toContain(pinned.guidance);
    expect(prompt.prompt).toContain('Where appearance is unspecified');
    expect(prompt.prompt).toContain('Exactly FOUR edge-to-edge panels');
    expect(prompt.aspect_ratio).toBe('1:1');
    expect(prompt.prompt_sha256).toBe(hash(prompt.prompt));
    expect(validateStyleBibleCurrent(bible,prior.draftAnalysis!,source,pinned)).toBe(true);
    const forged={...bible,characters:bible.characters.map(row=>({...row,description:'fabricated'}))};
    const {style_bible_sha256:discarded,...body}=forged;
    expect(discarded).toBe(bible.style_bible_sha256);
    expect(()=>validateStyleBibleCurrent({...body,style_bible_sha256:contentHash(body)},prior.draftAnalysis!,source,pinned)).toThrow();
    expect(prepare(root).revision).toBe(updated.revision);
  });
  it.each(['nano_banana_2','nano_banana_pro','gpt_image_2'] as const)('SB06–08 exact model-specific wire body for %s with unchanged Storyboard settings',async model=>{
    const {root,dir}=setup(true,false,true),mock=provider(),global=glabsSettings(dir);
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model});
    expect(job.status).toBe('RUNNING');expect(job.model).toBe(model);
    expect(job.aspectRatio).toBe('1:1');expect(mock.posts()).toHaveLength(1);
    const expected=model==='gpt_image_2'?{
      prompt:job.prompt,aspect_ratio:'1:1',reference_images:[],quality:'high',
      prompt_mode:'direct',reasoning:'none',web_search:false
    }:{prompt:job.prompt,model,aspect_ratio:'1:1',reference_images:[],upscale:[]};
    expect(mock.payloads[0]).toEqual(expected);
    expect(mock.posts()[0]).toBe(model==='gpt_image_2'?'POST /api/openai/generate':'POST /api/image/generate');
    expect(glabsSettings(dir)).toEqual(global);
    expect(job.providerRequestVersion).toBe('glabs-reference-wire-v1');
    expect(job.providerRequestSha).toBe(contentHash({endpoint:global.endpoint,...buildReferenceProviderRequest(job)}));
    expect(readReferenceJob(root,job.id).prompt).toBe(job.prompt);
  });
  it('SB09/SB11–12/SB14–15 explicit approval publishes the first complete set; Native receives exact verified bytes',async()=>{
    const {root,dir}=setup(true,false,true,{preserveAlignedTranscript:true}),mock=provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{
      anchorId:'char_001',authorized:true,model:'gpt_image_2'
    });
    const {validated,candidate}=await materialize(root,dir,job.id);
    expect(candidate.status).toBe('VALIDATED');
    expect(readIdentityWorkflow(root).referenceApprovalSet).toBeNull();
    const approved=approve(root,candidate.candidate_id);
    expect(approved.referenceApprovalSet?.entries).toHaveLength(1);
    expect(approved.publishedAuthority?.bibleTextApproved).toBeNull();
    expect(approved.publishedAuthority?.bible.automatic_authority?.version).toBe('automatic-reference-authority-v1');
    const identity=readApprovedNativeIdentity(root,appPath);
    expect(identity.anchors[0].sha256).toBe(validated.staged?.sha256);
    expect(identity.anchors[0].charId).toBe('char_001');
    expect(sha(fs.readFileSync(path.join(root,identity.anchors[0].path)))).toBe(identity.anchors[0].sha256);
    const native=nativePayload(root,{image:'both'});
    const needs=[
      {shot_id:'shot-1',layer_id:'image-1',expected_path:'assets/images/missing.png',
        content:'One in first frame',asset_kind:'character',character_ids:['char_001']},
      {shot_id:'shot-2',layer_id:'image-2',expected_path:'assets/images/late.png',
        content:'Empty background',asset_kind:'background',character_ids:[]}
    ];
    const binding=validateNativeBindingPayload(root,appPath,native.manifest,needs);
    expect(binding.plans[0].canonicalAnchors).toEqual(identity.anchors);
    expect(binding.plans[1].canonicalAnchors).toEqual([]);
    const again=registerValidatedGeneratedReference(root,appPath,{
      expectedRevision:approved.revision,job:validated
    },decode);
    expect(again.referenceCandidates).toHaveLength(1);
    expect(again.revision).toBe(approved.revision);
    expect(mock.posts()).toHaveLength(1);
  });
  it('SB13 publishes an empty automatic catalog without provider activity',()=>{
    const {root}=setup(true,false,true),prior=readIdentityWorkflow(root),mock=provider();
    const analysis={...prior.draftAnalysis!,continuity_catalog:{characters:[]}};
    const review={...prior.independentReview!,analysis_sha256:contentHash(analysis)};
    atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),{
      ...prior,draftAnalysis:analysis,draftSha256:contentHash(analysis),independentReview:review,
      analysisApproved:{...prior.analysisApproved!,sha256:contentHash(analysis),reviewSha256:contentHash(review)},
      bible:null,bibleTextApproved:null
    });
    const updated=prepare(root);
    expect(updated.bible?.characters).toEqual([]);
    expect(updated.referenceApprovalSet?.entries).toEqual([]);
    expect(readApprovedNativeIdentity(root,appPath).anchors).toEqual([]);
    expect(mock.calls).toEqual([]);
  });
  it('SB16 preserves last-good automatic publication during regeneration and requires exact replacement impact',async()=>{
    const {root,dir}=setup(true,false,true),mock=provider();
    const first=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'nano_banana_2'});
    const initial=approve(root,(await materialize(root,dir,first.id)).candidate.candidate_id);
    const old=initial.publishedAuthority!.snapshotSha;
    const second=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'nano_banana_pro',regenerate:true});
    expect(readIdentityWorkflow(root).publishedAuthority!.snapshotSha).toBe(old);
    const candidate=(await materialize(root,dir,second.id)).candidate;
    const reviewed=approve(root,candidate.candidate_id);
    expect(reviewed.publishedAuthority!.snapshotSha).toBe(old);
    expect(()=>publishStyleBibleReferences(root,appPath,reviewed.revision,[candidate.candidate_id],decode)).toThrow('REFERENCE_CANONICAL_IMPACT_REVIEW_REQUIRED');
    const impact=previewReferenceSwitchImpact(root,[candidate.candidate_id]);
    const replaced=publishStyleBibleReferences(root,appPath,reviewed.revision,[candidate.candidate_id],decode,impact.impactSha256);
    expect(replaced.referenceApprovalSet?.entries[0].candidate_id).toBe(candidate.candidate_id);
    expect(mock.posts()).toHaveLength(2);
  });
  it('SB16 retains historical reviewed published authority and original receipt without regeneration',async()=>{
    const {root,dir}=setup(),mock=provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true});
    const candidate=(await materialize(root,dir,job.id)).candidate;
    const approved=approve(root,candidate.candidate_id);
    const original=publishStyleBibleReferences(root,appPath,approved.revision,[candidate.candidate_id],decode);
    const prepared=prepare(root);
    expect(prepared).toEqual(original);
    expect(prepared.bibleTextApproved).not.toBeNull();
    expect(prepared.bible?.design_authority).toBeDefined();
    expect(mock.posts()).toHaveLength(1);
  });
  it('SB17 an uncertain new model POST stays UNKNOWN and GET sync cannot send another paid request',async()=>{
    const {root,dir}=setup(true,false,true),mock=provider(true);
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'gpt_image_2'});
    expect(job.status).toBe('UNKNOWN');
    await expect(submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'nano_banana_2',regenerate:true})).rejects.toThrow('REFERENCE_UNKNOWN_MAY_HAVE_CHARGED');
    expect((await syncReferenceJob(appPath,root,dir,cipher,job.id,decode)).status).toBe('UNKNOWN');
    expect(mock.posts()).toHaveLength(1);
  });
  it('SB18 stale approved Script blocks new automatic generation before network',async()=>{
    const {root,dir}=setup(true,false,true),mock=provider();
    const state=readState(root);state.approvedScript!.text='New source.';
    state.approvedScript!.sections=[{id:'opening',text:'New source.'}];
    state.approvedScript!.sha256=sha('New source.');writeState(root,state);
    await expect(submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'gpt_image_2'})).rejects.toThrow();
    expect(mock.calls).toEqual([]);
  });
  it('SB18 a style change during health probe blocks POST from the old prompt',async()=>{
    const {root,dir}=setup(true,false,true),mock=provider();
    const original=fetch;
    vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
      const response=await original(input,init);
      if(new URL(String(input)).pathname==='/api/tasks'){
        const state=readState(root);state.project.style='B2';writeState(root,state);
      }
      return response;
    });
    await expect(submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'nano_banana_2'})).rejects.toThrow('REFERENCE_SOURCE_STALE_BEFORE_POST');
    expect(mock.posts()).toHaveLength(0);
  });
  it('SB06/SB18 tampered durable wire configuration cannot be resumed',async()=>{
    const {root,dir}=setup(true,false,true);provider();
    const job=await submitReferenceJob(appPath,root,dir,cipher,{anchorId:'char_001',authorized:true,model:'gpt_image_2'});
    atomicJson(path.join(root,'.studio/identity/reference-jobs',job.id+'.json'),{...job,model:'nano_banana_pro'});
    expect(()=>readReferenceJob(root,job.id)).toThrow('REFERENCE_JOB_REQUEST_TAMPERED');
  });
});
