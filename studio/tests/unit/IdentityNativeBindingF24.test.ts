// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appPath,cleanup,fixture,nativePayload,stageNative,png} from './SixIssueFixtures';
import {importMediaFile,confirmImport,getNativeImageGallery,
  readNativeDraft,publishNativeDraftCorrection} from '../../src/main/externalTasks';
import {prepareNativeImages,saveNativeImagePrompt} from '../../src/main/imagePreparation';
import {saveGlabsKey,submitGlabsImage,
  pollGlabsImage,approveGlabsImage} from '../../src/main/glabs';
import {readState,writeState,atomicJson,sha} from '../../src/main/services';
import {contentHash,hash} from '../../src/main/identity/contracts';
import {compileStyleBible} from '../../src/main/identity/styleBible';
import {approveCandidate,publishApprovalSet} from '../../src/main/identity/referencePublication';
import {currentApprovedSource} from '../../src/main/identity/identityWorkflow';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {assertPublishedIdentityCurrent,readNativeIdentityReceipt} from '../../src/main/identity/finalGate';
import {readApprovedNativeIdentity} from '../../src/main/identity/nativeBinding';
import {readIdentityWorkflow,publishStyleBibleReferences,
  freezeIdentityTask,importIdentityResult,approveScriptAnalysis,
  prepareProjectStyleBible,approveProjectStyleBible,identityWorkflowSnapshot,
  registerOwnerReference,approveOwnerReference,
  approveOwnerVisualDefinition} from '../../src/main/identity/identityWorkflow';
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
function setup(continuity=false,additionalImages=0,includeBuiltIn=false,
  emptyCastSecond=false){
  const {root}=fixture();
  const state=readState(root);state.identityPolicy='v1';writeState(root,state);
  const script=currentApprovedSource(root);
  const analysis={
    schema:'stickman-script-analysis-v1' as const,project_id:script.projectId,
    source_script_sha256:script.sha256,source_authoring_sha256:contentHash(script.authoring),
    continuity_catalog:{characters:[{
      char_id:'char_001' as const,label:'One',description:'Narrative subject One',
      narrative_role:'Named character',
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
  const ownerSha=contentHash({kind:'owner-reference-bytes-v1',
    projectId:script.projectId,styleBibleSha:bible.style_bible_sha256,
    anchorId:'char_001',mediaSha:ref.sha256});
  const pending:ReferenceCandidate={
    schema:'stickman-visual-reference-candidate-v1',project_id:script.projectId,
    candidate_id:'approved-candidate-1',anchor_type:'character',anchor_id:'char_001',
    source_definition_hash:bible.characters[0].source_definition_hash,
    style_bible_sha256:bible.style_bible_sha256,
    prompt_sha256:ownerSha,
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
      content:'Source-grounded first frame',asset_kind:'character',character_ids:['char_001']},
    {shot_id:'shot-2',layer_id:'image-2',expected_path:'assets/images/late.png',
      content:emptyCastSecond?'Empty canyon and clouds':'Source-grounded second frame',
      asset_kind:emptyCastSecond?'background':'character',
      character_ids:emptyCastSecond?[]:['char_001'],
      ...(continuity?{continuity_source:{
        shot_id:'shot-1',layer_id:'image-1',relation:'match_subject'
      }}:{})}
  ];
  if(includeBuiltIn){
    // Core @b1/ image assets are legal in the original Studio path guard,
    // but never require paid G-Labs jobs or F24 character asset-needs.
    (raw.manifest.shots[0].layers as Array<Record<string,unknown>>).push({
      id:'core-builtin',type:'image',path:'@b1/stickman'
    });
  }
  const layers=raw.manifest.shots[1].layers as Array<Record<string,unknown>>;
  for(let index=0;index<additionalImages;index++){
    const layerId='extra-image-'+String(index+1).padStart(3,'0');
    const imagePath='assets/images/extra-'+String(index+1).padStart(3,'0')+'.png';
    layers.push({id:layerId,type:'image',path:imagePath});
    needs.push({shot_id:'shot-2',layer_id:layerId,expected_path:imagePath,
      content:'Extra source-grounded character image',asset_kind:'character',character_ids:['char_001']});
  }
  const source={...raw,asset_needs:needs};
  stageNative(root,source);
  return{root,ref,bible,set,source};
}
type RequestCapture={method:string;pathname:string;body:Record<string,unknown>|null};
const secondPng=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQTDkBAAHfAUZ76qvRAAAAAElFTkSuQmCC',
  'base64');
function fakeProvider(image=png()){
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
      return new Response(new Uint8Array(image),{
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
  it('EK-06/10/11 historical group authority stays byte-exact and Native survives a new unapproved draft',()=>{
    const {root,ref}=setup();
    const filename=path.join(root,'.studio/identity/workflow-v1.json');
    const prior=readIdentityWorkflow(root),script=currentApprovedSource(root);
    const profile=loadImageStyleProfile(appPath,'B1');
    const pinned={id:'B1' as const,guidance:profile.guidance,sha256:profile.sha256};
    // Model the exact original F24 published v1 shape: only the archival
    // payload has the retired kind. New author payloads below MUST not.
    const historicalAnalysis={...prior.draftAnalysis!,
      continuity_catalog:{characters:prior.draftAnalysis!.continuity_catalog.characters
        .map(char=>({...char,entity_kind:'human_group' as const}))}};
    const inherited=structuredClone(historicalAnalysis.continuity_catalog.characters[0]);
    const legacyDefinitionSha=contentHash({inherited,styleId:pinned.id,styleSha:pinned.sha256});
    const legacyCharacter={...inherited,source_definition_hash:legacyDefinitionSha,
      visual_trait_evidence:[],visual_readiness:'NEEDS_OWNER_DEFINITION' as const};
    const legacyBase={schema:'stickman-project-style-bible-v1' as const,
      project_id:script.projectId,source_script_sha256:script.sha256,
      source_authoring_sha256:contentHash(script.authoring),
      analysis_sha256:contentHash(historicalAnalysis),
      style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
      style_guidance_sha256:hash(pinned.guidance),characters:[legacyCharacter]};
    const oldBible={...legacyBase,style_bible_sha256:contentHash(legacyBase)};
    const candidate={...prior.referenceCandidates[0],
      source_definition_hash:legacyDefinitionSha,
      style_bible_sha256:oldBible.style_bible_sha256};
    const oldSet=publishApprovalSet(root,oldBible,[candidate],1,decode);
    const reviewed={...prior.independentReview!,
      analysis_sha256:contentHash(historicalAnalysis)};
    const approved={...prior.analysisApproved!,sha256:contentHash(historicalAnalysis),
      reviewSha256:contentHash(reviewed)};
    const bibleApproval={...prior.bibleTextApproved!,
      sha256:oldBible.style_bible_sha256};
    const frozenAuthority={analysis:historicalAnalysis,analysisApproved:approved,
      independentReview:reviewed,bible:oldBible,bibleTextApproved:bibleApproval,
      referenceApprovalSet:oldSet};
    atomicJson(filename,{...prior,draftAnalysis:historicalAnalysis,
      draftSha256:contentHash(historicalAnalysis),
      independentReview:reviewed,analysisApproved:approved,
      bible:oldBible,bibleTextApproved:bibleApproval,
      referenceCandidates:[candidate],referenceApprovalSet:oldSet,
      publishedAuthority:{...frozenAuthority,snapshotSha:contentHash(frozenAuthority)}});
    const savedBytes=fs.readFileSync(filename);
    const baseline=readApprovedNativeIdentity(root,appPath);
    expect(baseline.anchors[0].sha256).toBe(ref.sha256);
    expect(baseline.styleBibleSha).toBe(oldBible.style_bible_sha256);
    expect(identityWorkflowSnapshot(root,appPath).readiness).toBe('REFERENCES_PUBLISHED');
    expect(fs.readFileSync(filename).equals(savedBytes)).toBe(true);
    // An Author result cannot carry the retired property, but importing it
    // cannot republish or revoke previously approved Native authority.
    const freeze=freezeIdentityTask(root,'author',prior.revision);
    const newAnalysis=structuredClone(historicalAnalysis);
    delete (newAnalysis.continuity_catalog.characters[0] as Record<string,unknown>).entity_kind;
    const task=freeze.currentTask!.task;
    importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,payload:newAnalysis
    }),freeze.revision);
    const live=readApprovedNativeIdentity(root,appPath);
    expect(live.snapshotSha).toBe(baseline.snapshotSha);
    expect(live.anchors[0].sha256).toBe(ref.sha256);
    expect(readIdentityWorkflow(root).publishedAuthority?.snapshotSha)
      .toBe(contentHash(frozenAuthority));
    expect(readIdentityWorkflow(root).publishedAuthority?.referenceApprovalSet
      .approval_set_sha256).toBe(oldSet.approval_set_sha256);
  });
  it('U06/N08 tampered independent Analysis review digest cannot authorize Native image references',()=>{
    const {root}=setup();
    const verified=readApprovedNativeIdentity(root,appPath);
    expect(verified.anchors[0].charId).toBe('char_001');
    const altered=readIdentityWorkflow(root);
    altered.analysisApproved!.reviewSha256='0'.repeat(64);
    atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),altered);
    expect(()=>readApprovedNativeIdentity(root,appPath))
      .toThrow('IDENTITY_PUBLISHED_AUTHORITY_STALE');
    expect(()=>prepareNativeImages(appPath,root))
      .toThrow('IDENTITY_PUBLISHED_AUTHORITY_STALE');
  });
  const importAnalysis=(root:string,operation:'author'|'correct',
    update:(draft:NonNullable<ReturnType<typeof readIdentityWorkflow>['draftAnalysis']>)=>void)=>{
    const prior=readIdentityWorkflow(root),frozen=freezeIdentityTask(root,operation,prior.revision);
    const candidate=structuredClone(prior.draftAnalysis)!;
    update(candidate);
    const task=frozen.currentTask!.task;
    const envelope={schema:'mode-b-identity-external-result-v1',
      stage:'script_analysis',project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      ...(operation==='correct'?{resolved_finding_ids:task.finding_ids}:{}),
      payload:candidate};
    return importIdentityResult(root,JSON.stringify(envelope),frozen.revision);
  };
  const importReview=(root:string,operation:'review'|'recheck',approved:boolean)=>{
    const prior=readIdentityWorkflow(root),frozen=freezeIdentityTask(root,operation,prior.revision);
    const task=frozen.currentTask!.task;
    const findings=approved?[]:[{finding_id:'F01',severity:'P1',
      location:'char_001',issue:'Needs source review',evidence:'Candidate has uncertain descriptions'}];
    return importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      payload:{schema:'stickman-analysis-review-v1',project_id:task.project_id,
        analysis_sha256:contentHash(prior.draftAnalysis),independent_review:true,
        findings,approved}
    }),frozen.revision);
  };
  const p2Candidate=(root:string)=>{
    importAnalysis(root,'author',draft=>{
      draft.continuity_catalog.characters[0].description='New candidate needing independent review';
    });
  };
  const importVerdict=(root:string,operation:'review'|'recheck',
    approved:boolean,findings:Array<{
      finding_id:string;severity:'P0'|'P1'|'P2';
      location:string;issue:string;evidence:string
    }>)=>{
    const before=readIdentityWorkflow(root);
    const taskState=freezeIdentityTask(root,operation,before.revision);
    const task=taskState.currentTask!.task;
    return importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      payload:{schema:'stickman-analysis-review-v1',project_id:task.project_id,
        analysis_sha256:contentHash(before.draftAnalysis),independent_review:true,
        findings,approved}
    }),taskState.revision);
  };
  const finding=(id:string,severity:'P0'|'P1'|'P2'='P2')=>({
    finding_id:id,severity,location:'char_001',issue:'Review the source identity',
    evidence:'Exact approved narration evidence requires correction'
  });
  it('C03-01 P2-only negative Review authorizes Correct',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P2-01')]);
    const correction=freezeIdentityTask(root,'correct',reviewed.revision);
    expect(correction.currentTask?.task.finding_ids).toEqual(['P2-01']);
    expect(correction.currentTask?.task.prompt).toContain('P2-01');
  });
  it('C03-02 multiple P2 findings remain correctable with exact frozen IDs',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P2-A'),finding('P2-B')]);
    expect(freezeIdentityTask(root,'correct',reviewed.revision)
      .currentTask?.task.finding_ids).toEqual(['P2-A','P2-B']);
  });
  it('C03-03 mixed P1 and P2 findings authorize Correct without skipping P2',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P1-X','P1'),finding('P2-Y')]);
    expect(freezeIdentityTask(root,'correct',reviewed.revision)
      .currentTask?.task.finding_ids).toEqual(['P1-X','P2-Y']);
  });
  it('C03-04 a clean approved Review permits owner Analysis approval',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',true,[]);
    const approved=approveScriptAnalysis(root,reviewed.revision);
    expect(approved.analysisApproved?.sha256)
      .toBe(contentHash(approved.draftAnalysis));
  });
  it('C03-05 rejects negative verdict without any actionable findings',()=>{
    const {root}=setup();p2Candidate(root);
    expect(()=>importVerdict(root,'review',false,[]))
      .toThrow('SCRIPT_ANALYSIS_REVIEW_INVALID');
  });
  it('C03-05b rejects contradictory positive Review containing P2',()=>{
    const {root}=setup();p2Candidate(root);
    expect(()=>importVerdict(root,'review',true,[finding('P2-01')]))
      .toThrow('SCRIPT_ANALYSIS_REVIEW_INVALID');
  });
  it('C03-06 rejects incorrect resolved_finding_ids before Correct import',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P2-01')]);
    const frozen=freezeIdentityTask(root,'correct',reviewed.revision);
    const task=frozen.currentTask!.task;
    const before=readIdentityWorkflow(root);
    const wrong={schema:'mode-b-identity-external-result-v1',
      stage:'script_analysis',project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      resolved_finding_ids:['WRONG-P2'],
      payload:before.draftAnalysis};
    expect(()=>importIdentityResult(root,JSON.stringify(wrong),frozen.revision))
      .toThrow('SCRIPT_ANALYSIS_CORRECTION_FINDINGS_INVALID');
  });
  it('C03-06b pre-upgrade frozen Correct remains importable only with its original candidate/finding SHA',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P2-OLD')]);
    freezeIdentityTask(root,'correct',reviewed.revision);
    const file=path.join(root,'.studio/identity/workflow-v1.json');
    const legacy=readIdentityWorkflow(root);
    // Earlier F24 Correct envelopes had the same frozen input_sha256 but
    // did not yet expose resolved_finding_ids in the external JSON.
    delete legacy.currentTask!.task.finding_ids;
    delete legacy.currentTask!.task.review_findings;
    delete legacy.currentTask!.task.review_sha256;
    atomicJson(file,legacy);
    const task=legacy.currentTask!.task;
    const next=importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      payload:legacy.draftAnalysis
    }),legacy.revision);
    expect(next.currentTask?.status).toBe('IMPORTED');
  });
  it('C03-07 stale frozen candidate SHA cannot be corrected',()=>{
    const {root}=setup();p2Candidate(root);
    const reviewed=importVerdict(root,'review',false,[finding('P2-01')]);
    freezeIdentityTask(root,'correct',reviewed.revision);
    const file=path.join(root,'.studio/identity/workflow-v1.json');
    const changed=readIdentityWorkflow(root);
    changed.currentTask!.frozenArtifactSha='0'.repeat(64);
    atomicJson(file,changed);
    const task=changed.currentTask!.task;
    expect(()=>importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      resolved_finding_ids:task.finding_ids,payload:changed.draftAnalysis
    }),changed.revision)).toThrow('SCRIPT_ANALYSIS_FROZEN_CANDIDATE_STALE');
  });
  it('C03-08/09 negative P2 Review → Correct → Recheck retains prior published references',()=>{
    const {root,set}=setup(),publishedSha=readApprovedNativeIdentity(root,appPath).snapshotSha;
    p2Candidate(root);
    importVerdict(root,'review',false,[finding('P2-01')]);
    importAnalysis(root,'correct',draft=>{
      draft.continuity_catalog.characters[0].description='P2 corrected under frozen task';
    });
    expect(()=>approveScriptAnalysis(root,readIdentityWorkflow(root).revision))
      .toThrow('SCRIPT_ANALYSIS_RECHECK_OR_REVIEW_REQUIRED');
    const before=readIdentityWorkflow(root);
    const recheck=freezeIdentityTask(root,'recheck',before.revision);
    expect(recheck.currentTask?.task.prompt).toContain('P2-01');
    const task=recheck.currentTask!.task;
    importIdentityResult(root,JSON.stringify({
      schema:'mode-b-identity-external-result-v1',stage:'script_analysis',
      project_id:task.project_id,task_id:task.task_id,
      revision:task.revision,input_sha256:task.input_sha256,
      payload:{schema:'stickman-analysis-review-v1',project_id:task.project_id,
        analysis_sha256:contentHash(before.draftAnalysis),independent_review:true,
        findings:[finding('P2-01')],approved:false}
    }),recheck.revision);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha).toBe(publishedSha);
    expect(readIdentityWorkflow(root).publishedAuthority?.referenceApprovalSet
      .approval_set_sha256).toBe(set.approval_set_sha256);
  });
  it('C03-08b successful independent Recheck of a corrected P2 permits approval',()=>{
    const {root}=setup();p2Candidate(root);
    importVerdict(root,'review',false,[finding('P2-A')]);
    importAnalysis(root,'correct',draft=>{
      draft.continuity_catalog.characters[0].description='P2 properly corrected';
    });
    const checked=importVerdict(root,'recheck',true,[]);
    expect(approveScriptAnalysis(root,checked.revision).analysisApproved)
      .not.toBeNull();
  });
  it('A01-01/02/03/04/07/09 candidate Author, negative Review, Correct and failed Recheck preserve published A after restart',()=>{
    const {root,set}=setup();
    const initial=readApprovedNativeIdentity(root,appPath).snapshotSha;
    const candidate=importAnalysis(root,'author',draft=>{
      draft.continuity_catalog.characters[0].description='New unapproved candidate B';
    });
    expect(candidate.referenceApprovalSet).toBeNull();
    expect(candidate.publishedAuthority?.referenceApprovalSet.approval_set_sha256)
      .toBe(set.approval_set_sha256);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha).toBe(initial);
    expect(identityWorkflowSnapshot(root,appPath).readiness).toBe('REFERENCES_PUBLISHED');
    importReview(root,'review',false);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha).toBe(initial);
    importAnalysis(root,'correct',draft=>{
      draft.continuity_catalog.characters[0].description='Corrected but not accepted B';
    });
    importReview(root,'recheck',false);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha).toBe(initial);
    expect(readIdentityWorkflow(root).publishedAuthority?.referenceApprovalSet
      .approval_set_sha256).toBe(set.approval_set_sha256);
    expect(prepareNativeImages(appPath,root).jobs.every(job=>job.state==='READY'))
      .toBe(true);
  });
  it('A01-08 tampered pending Analysis SHA is rejected on reopen while published bytes remain untouched',()=>{
    const {root}=setup();
    importAnalysis(root,'author',draft=>{
      draft.continuity_catalog.characters[0].description='Candidate B not approved';
    });
    const file=path.join(root,'.studio/identity/workflow-v1.json');
    const pending=readIdentityWorkflow(root);
    pending.draftSha256='0'.repeat(64);
    atomicJson(file,pending);
    expect(()=>readIdentityWorkflow(root))
      .toThrow('IDENTITY_DRAFT_ANALYSIS_TAMPERED');
  });
  it('A01-05/08/10 owner activation of reviewed B is atomic, old published A survives until Publish and tamper fails closed',()=>{
    const {root,ref,set}=setup();
    const baseline=readApprovedNativeIdentity(root,appPath);
    importAnalysis(root,'author',draft=>{
      draft.continuity_catalog.characters[0].description='Candidate B different narrative';
    });
    importReview(root,'review',true);
    const accepted=approveScriptAnalysis(root,readIdentityWorkflow(root).revision);
    expect(accepted.analysisApproved).not.toBeNull();
    const prepared=prepareProjectStyleBible(root,appPath,accepted.revision);
    const approved=approveProjectStyleBible(root,appPath,prepared.revision,true);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha).toBe(baseline.snapshotSha);
    const imported=registerOwnerReference(root,appPath,{
      expectedRevision:approved.revision,anchorId:'char_001',
      relativePath:ref.path,ownerSource:'Explicit owner image for newly approved B'
    },decode);
    const fresh=imported.referenceCandidates.at(-1)!;
    const reviewed=approveOwnerReference(root,appPath,{
      expectedRevision:imported.revision,candidateId:fresh.candidate_id,
      ownerInspected:true
    },decode);
    const impact=previewReferenceSwitchImpact(root,[fresh.candidate_id]);
    expect(impact.changedCharacterIds).toEqual(['char_001']);
    expect(readApprovedNativeIdentity(root,appPath).approvalSetSha)
      .toBe(set.approval_set_sha256);
    const published=publishStyleBibleReferences(root,appPath,
      reviewed.revision,[fresh.candidate_id],decode,impact.impactSha256);
    expect(published.publishedAuthority?.referenceApprovalSet.approval_set_sha256)
      .not.toBe(set.approval_set_sha256);
    expect(published.referenceApprovalHistory?.some(row=>
      row.approval_set_sha256===set.approval_set_sha256)).toBe(true);
    expect(readApprovedNativeIdentity(root,appPath).snapshotSha)
      .not.toBe(baseline.snapshotSha);
    const file=path.join(root,'.studio/identity/workflow-v1.json');
    const corrupt=readIdentityWorkflow(root);
    corrupt.publishedAuthority!.snapshotSha='0'.repeat(64);
    atomicJson(file,corrupt);
    expect(()=>readIdentityWorkflow(root))
      .toThrow('IDENTITY_PUBLISHED_AUTHORITY_TAMPERED');
  });
  it('F24-AUD-01 keeps published canonical during candidate import/approval and fences UNKNOWN on replacement',()=>{
    const {root,ref,set}=setup();
    const first=readIdentityWorkflow(root);
    const added=registerOwnerReference(root,appPath,{
      expectedRevision:first.revision,anchorId:'char_001',
      relativePath:ref.path,ownerSource:'Owner-original digital reference'
    },decode);
    expect(added.referenceApprovalSet?.approval_set_sha256).toBe(set.approval_set_sha256);
    const next=added.referenceCandidates.at(-1)!;
    const reviewed=approveOwnerReference(root,appPath,{
      expectedRevision:added.revision,candidateId:next.candidate_id,ownerInspected:true
    },decode);
    expect(reviewed.referenceApprovalSet?.approval_set_sha256).toBe(set.approval_set_sha256);
    const impact=previewReferenceSwitchImpact(root,[next.candidate_id]);
    expect(impact.changedCharacterIds).toEqual(['char_001']);
    const mockJobId='00000000-0000-0000-0000-000000000001';
    atomicJson(path.join(root,'.studio/glabs/jobs',mockJobId+'.json'),{
      projectId:readState(root).project.id,status:'UNKNOWN',targetKey:'image:0:image-1'
    });
    expect(()=>publishStyleBibleReferences(root,appPath,reviewed.revision,
      [next.candidate_id],decode,impact.impactSha256))
      .toThrow('IDENTITY_CHANGE_BUSY_OR_UNKNOWN_PROVIDER_JOB');
    expect(readIdentityWorkflow(root).referenceApprovalSet?.approval_set_sha256)
      .toBe(set.approval_set_sha256);
    fs.unlinkSync(path.join(root,'.studio/glabs/jobs',mockJobId+'.json'));
    const published=publishStyleBibleReferences(root,appPath,reviewed.revision,
      [next.candidate_id],decode,impact.impactSha256);
    expect(published.referenceApprovalHistory?.at(-1)?.approval_set_sha256)
      .toBe(set.approval_set_sha256);
    expect(published.referenceApprovalSet?.approval_set_sha256)
      .not.toBe(set.approval_set_sha256);
  });
  it('F24-AUD-06 approving new visual text never silently replaces an existing canonical reference',()=>{
    const {root,set}=setup();
    const previous=prepareNativeImages(appPath,root).jobs.map(job=>
      job.identityBindingSnapshotSha);
    const journal=readIdentityWorkflow(root);
    const updated=approveOwnerVisualDefinition(root,appPath,{
      expectedRevision:journal.revision,anchorId:'char_001',
      provenance:'OWNER_BRIEF',traits:['blue scarf'],
      evidence:'Owner explicitly drew a blue scarf for the character.',
      ownerInspected:true
    });
    expect(updated.referenceApprovalSet?.approval_set_sha256)
      .toBe(set.approval_set_sha256);
    expect(prepareNativeImages(appPath,root).jobs.map(job=>
      job.identityBindingSnapshotSha)).toEqual(previous);
  });
  it('F24-AUD-02 follows an actual approved earlier image and sends both canonical and previous PNG bytes',async()=>{
    const {root,ref}=setup(true),auth=account(),{posts}=fakeProvider(secondPng);
    const initial=prepareNativeImages(appPath,root).jobs;
    expect(initial.find(job=>job.layerId==='image-2')?.state).toBe('BLOCKED');
    const first=initial.find(job=>job.layerId==='image-1')!;
    expect(first.state).toBe('READY');
    const started=await submitGlabsImage(appPath,root,auth,cipher,
      request(root,first.targetKey),decode);
    await pollGlabsImage(appPath,root,auth,cipher,started.id,decode);
    expect(approveGlabsImage(appPath,root,started.id,undefined,decode).job.status)
      .toBe('APPROVED');
    const dependent=prepareNativeImages(appPath,root).jobs.find(job=>
      job.layerId==='image-2')!;
    expect(dependent.state).toBe('READY');
    expect(dependent.references).toHaveLength(2);
    expect(dependent.references[0]).toBe(ref.path);
    expect(dependent.identityPreviousSourceSha).toMatch(/^[a-f0-9]{64}$/);
    await submitGlabsImage(appPath,root,auth,cipher,
      request(root,dependent.targetKey),decode);
    const payload=posts().at(-1)?.body?.reference_images as Array<{data:string}>;
    expect(payload).toHaveLength(2);
    expect(sha(Buffer.from(payload[0].data.split(',')[1],'base64')))
      .toBe(ref.sha256);
    expect(sha(Buffer.from(payload[1].data.split(',')[1],'base64')))
      .toBe(sha(secondPng));
    expect(posts()).toHaveLength(2);
  });
  it('A02-01/02/03/04 mixed Native Core image does not increase paid/gallery/identity targets',()=>{
    const {root}=setup(false,0,true);
    const gallery=getNativeImageGallery(appPath,root);
    expect(gallery.targets).toHaveLength(2);
    expect(gallery.targets.every(row=>row.managed)).toBe(true);
    expect(gallery.targets.some(row=>row.layerId==='core-builtin')).toBe(false);
    const prepared=prepareNativeImages(appPath,root).jobs;
    expect(prepared).toHaveLength(2);
    expect(prepared.every(job=>job.state==='READY')).toBe(true);
  });
  it('C01-11/12 owner-edited prompt introduces known actor into empty-cast background: zero paid POST',async()=>{
    const {root}=setup(false,0,false,true);
    const initial=prepareNativeImages(appPath,root).jobs.find(job=>job.layerId==='image-2')!;
    expect(initial.state).toBe('READY');
    const auth=account(),mock=fakeProvider();
    const updated=saveNativeImagePrompt(appPath,root,{
      targetKey:initial.targetKey,
      fingerprint:initial.draftIdentity.creativeFingerprint,
      styleSha256:initial.styleProfileRef.sha256,
      prompt:'One stands in the foreground facing camera.',references:[]
    });
    const edited=updated.jobs.find(job=>job.layerId==='image-2')!;
    expect(edited.state).toBe('BLOCKED');
    expect(edited.reason).toContain('NATIVE_IDENTITY_CHARACTER_CAST_MISSING');
    await expect(submitGlabsImage(appPath,root,auth,cipher,{
      targetKey:edited.targetKey,prompt:edited.prompt,
      model:'nano_banana_2',aspectRatio:'9:16',references:edited.references,
      authorized:true,preparedFingerprint:edited.draftIdentity.creativeFingerprint
    },decode)).rejects.toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING');
    expect(mock.posts()).toHaveLength(0);
    expect(getNativeImageGallery(appPath,root).targets.filter(row=>row.fulfilled))
      .toHaveLength(0);
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
async function approveAllNativeLayers(root:string,auth:string){
  for(const spec of prepareNativeImages(appPath,root).jobs){
    const created=await submitGlabsImage(appPath,root,auth,cipher,
      request(root,spec.targetKey),decode);
    const validated=await pollGlabsImage(appPath,root,auth,cipher,created.id,decode);
    expect(validated.status).toBe('VALIDATED');
    const bound=approveGlabsImage(appPath,root,created.id,undefined,decode);
    expect(bound.job.status).toBe('APPROVED');
  }
}
const mockOriginalNativeCli=async(_exe:string,args:string[])=>{
  const candidate=fs.readFileSync(args[2]);
  return{code:0,stdout:JSON.stringify({valid:true,fingerprint:sha(candidate),
    checked_seconds:30}),stderr:''};
};
  it('A04-07/08 cannot reclassify a reviewed character target into an empty-cast background via Correct',()=>{
    const {root}=setup();
    const draft=readNativeDraft(root)!;
    const corrected=structuredClone(draft.artifact) as Record<string,unknown>;
    const needs=corrected.asset_needs as Array<Record<string,unknown>>;
    needs[0].asset_kind='background';
    needs[0].character_ids=[];
    expect(()=>publishNativeDraftCorrection(appPath,root,draft.sha256,corrected,{
      correctTaskId:'test-downgrade',reviewTaskId:'test-owner-scoped-review',
      editableIds:['shot-1'],editablePaths:['asset_needs[0]'],
      findingIds:['F24-A04']
    })).toThrow('NATIVE_IDENTITY_CHARACTER_RECLASSIFICATION_BLOCKED');
  });
  it('F24-AUD-05 Native Correct keeps unchanged Layer reference snapshot SHA and invalidates only edited Layer',()=>{
    const {root}=setup();
    const before=prepareNativeImages(appPath,root).jobs;
    expect(before.every(job=>job.state==='READY')).toBe(true);
    const draft=readNativeDraft(root)!;
    const corrected=structuredClone(draft.artifact) as Record<string,unknown>;
    const needs=corrected.asset_needs as Array<Record<string,unknown>>;
    needs[1].content='Changed second-image action without touching image-1';
    const next=publishNativeDraftCorrection(appPath,root,draft.sha256,corrected,{
      correctTaskId:'test-correct-second-layer',reviewTaskId:'test-reviewed-finding',
      editableIds:['shot-2'],editablePaths:['asset_needs[1]'],findingIds:['F24-AUD-05']
    });
    expect(next.revision).toBe(draft.revision+1);
    const after=prepareNativeImages(appPath,root).jobs;
    expect(after[0].draftIdentity.revision).toBeGreaterThan(
      before[0].draftIdentity.revision);
    expect(after[0].draftIdentity.creativeFingerprint)
      .toBe(before[0].draftIdentity.creativeFingerprint);
    expect(after[0].identityBindingSnapshotSha)
      .toBe(before[0].identityBindingSnapshotSha);
    expect(after[1].identityBindingSnapshotSha)
      .not.toBe(before[1].identityBindingSnapshotSha);
  });
  it('F24-AUD-07 20-target preparation does not re-read verified Style Bible for each image',()=>{
    const {root}=setup(false,18);
    const spy=vi.spyOn(fs,'readFileSync');
    try{
      const jobs=prepareNativeImages(appPath,root).jobs;
      expect(jobs).toHaveLength(20);
      expect(jobs.every(job=>job.state==='READY')).toBe(true);
      const journalReads=spy.mock.calls.filter(args=>
        String(args[0]).endsWith('workflow-v1.json')).length;
      expect(journalReads).toBeLessThan(12);
    }finally{spy.mockRestore();}
  });
  it('F24-AUD-04 Native Confirm accepts sample-scoped first image while FULL render remains blocked',async()=>{
    const {root}=setup(),auth=account();fakeProvider(secondPng);
    const first=prepareNativeImages(appPath,root).jobs.find(v=>v.layerId==='image-1')!;
    const started=await submitGlabsImage(appPath,root,auth,cipher,
      request(root,first.targetKey),decode);
    expect((await pollGlabsImage(appPath,root,auth,cipher,started.id,decode)).status)
      .toBe('VALIDATED');
    expect(approveGlabsImage(appPath,root,started.id,undefined,decode).job.status)
      .toBe('APPROVED');
    const token=(await import('../../src/main/externalTasks'))
      .getPendingMedia(appPath,root)!.token;
    const promoted=await confirmImport(appPath,root,token,{
      previewSeconds:20,allowSampleDraft:true,validator:mockOriginalNativeCli
    });
    expect(promoted.nativeReadiness?.sampleReady).toBe(true);
    expect(promoted.nativeReadiness?.fullReady).toBe(false);
    const receipt=readNativeIdentityReceipt(root);
    expect(receipt?.scope).toBe('SAMPLE');
    expect(receipt?.totalTargets).toBe(2);
    expect(receipt?.rows).toHaveLength(1);
    expect(()=>assertPublishedIdentityCurrent(root,appPath,'SAMPLE')).not.toThrow();
    expect(()=>assertPublishedIdentityCurrent(root,appPath,'FULL'))
      .toThrow('IDENTITY_SAMPLE_NOT_FULLY_CERTIFIED');
    expect(()=>assertPublishedIdentityCurrent(root,appPath,'SAMPLE',30))
      .toThrow('IDENTITY_SAMPLE_SCOPE_EXCEEDED');
  });
  it('C08/C09 approved outputs require current canonical set and native receipt after confirm',async()=>{
    const {root}=setup(),accountRoot=account();fakeProvider();
    await approveAllNativeLayers(root,accountRoot);
    expect(getNativeImageGallery(appPath,root).targets.every(t=>t.fulfilled)).toBe(true);
    // Native validate/confirm use a stubbed original CLI but real staged media SHA,
    // rights, G-Labs job and frozen identity snapshots.
    const original=readState(root);
    expect(original.tasks?.native?.status).toBe('FROZEN');
    await confirmImport(appPath,root,
      (await import('../../src/main/externalTasks')).getPendingMedia(appPath,root)!.token,
      {previewSeconds:20,validator:mockOriginalNativeCli});
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
  it('C10 an injected late Native revision write failure rolls back F24 receipt, state and Core manifest',async()=>{
    const {root}=setup(),auth=account();fakeProvider();
    await approveAllNativeLayers(root,auth);
    const before=fs.readFileSync(path.join(root,'project.json'));
    const token=(await import('../../src/main/externalTasks'))
      .getPendingMedia(appPath,root)!.token;
    // Native Confirm writes the receipt after the Core+state promotion but
    // before its revision sidecar. Turning the final destination into a
    // directory simulates a late filesystem rename failure.
    const blockedRevision=path.join(root,'.studio/revisions/native-1.json');
    fs.mkdirSync(blockedRevision,{recursive:true});
    await expect(confirmImport(appPath,root,token,{
      previewSeconds:20,validator:mockOriginalNativeCli
    })).rejects.toThrow();
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
    expect(readState(root).tasks?.native?.status).toBe('FROZEN');
    expect(fs.existsSync(path.join(root,'.studio/identity/native-publication-v1.json')))
      .toBe(false);
    expect((await import('../../src/main/externalTasks')).getPendingMedia(appPath,root)?.token)
      .toBe(token);
  });
});
