// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {StyleBibleWorkspace} from '../../src/renderer/features/external/StyleBibleWorkspace';
import type {ReferenceCandidate} from '../../src/main/identity/referencePublication';
import type {ReferenceJob} from '../../src/main/identity/referenceGeneration';

const h=vi.hoisted(()=>({
  id:'project-A',epoch:1,snapshot:vi.fn(),prepare:vi.fn(),generate:vi.fn(),sync:vi.fn(),approve:vi.fn(),jobs:vi.fn(),settings:vi.fn()
}));
vi.mock('../../src/renderer/app/AppState',()=>({useAppState:()=>({
  native:{project:{id:h.id,style:'B1'}},
  captureProjectSession:()=>({projectId:h.id,epoch:h.epoch}),
  isCurrentProjectSession:(scope:{projectId:string;epoch:number})=>scope.projectId===h.id&&scope.epoch===h.epoch
})}));
const row=(char_id:'char_001'|'char_002',label:string)=>({
  char_id,label,description:'Approved context '+label,narrative_role:'Story actor',
  visual_readiness:'READY_FOR_REFERENCE',source_definition_hash:'source-'+char_id,
  explicit_visual_traits:[],identity_markers:[],continuity_notes:[],physical_constraints:[],occurrences:[],presence_ranges:[]
});
const bible={schema:'stickman-project-style-bible-v1',style_bible_sha256:'auto-bible',
  automatic_authority:{version:'automatic-reference-authority-v1'},style_profile_id:'B1',
  characters:[row('char_001','One'),row('char_002','Two')]};
const candidate=(anchor_id:string,status:'VALIDATED'|'APPROVED',providerId:string|null=null):ReferenceCandidate=>({
  schema:'stickman-visual-reference-candidate-v1',project_id:h.id,candidate_id:'candidate-'+anchor_id,
  anchor_type:'character',anchor_id,source_definition_hash:'source-'+anchor_id,
  style_bible_sha256:'auto-bible',prompt_sha256:'prompt-'+anchor_id,
  provider_job_id:providerId,model:providerId?'gpt_image_2':'owner_imported',aspect_ratio:'1:1',
  media_path:'assets/images/'+anchor_id+'.png',media_sha256:'a'.repeat(64),media_mime:'image/png',
  width:1,height:1,rights:'owner',source:providerId?'GLABS_GENERATED':'OWNER_IMPORTED',
  status,approval_event_id:status==='APPROVED'?'approval':null,approved_at:status==='APPROVED'?'now':null
});
const job=(status:ReferenceJob['status']):ReferenceJob=>({
  schema:'stickman-reference-generate-job-v1',id:'job-two',projectId:h.id,anchorId:'char_002',
  sourceDefinitionHash:'source-char_002',styleBibleSha:'auto-bible',styleProfileSha:'style',
  analysisSha:'analysis',approvedScriptSha:'script',prompt:'Frozen automatic prompt',
  promptSha:'prompt-char_002',model:'gpt_image_2',aspectRatio:'1:1',status,
  providerTaskId:'ab12cd34',createdAt:'now',updatedAt:'now',
  ...(status==='VALIDATED'?{staged:{path:'assets/images/char_002.png',sha256:'a'.repeat(64),width:1,height:1,mime:'image/png' as const}}:{})
});
let revision:number,compiled:boolean,candidates:ReferenceCandidate[],jobs:ReferenceJob[];
let published:{entries:Array<{anchor_id:string;candidate_id:string}>;approval_set_sha256:string}|null;
const journal=()=>({revision,projectId:h.id,analysisApproved:{sha256:'analysis'},bible:compiled?bible:null,
  bibleTextApproved:null,referenceCandidates:candidates,referenceApprovalSet:published,ownerVisualDefinitions:[]});
beforeEach(()=>{
  h.id='project-A';h.epoch=1;revision=1;compiled=false;
  candidates=[candidate('char_001','APPROVED')];jobs=[];published=null;
  vi.clearAllMocks();
  h.snapshot.mockReset().mockImplementation(async()=>({policy:'v1',readiness:'ANALYSIS_APPROVED',
    journal:structuredClone(journal()),currentOwnerVisualDefinitions:[]}));
  h.prepare.mockReset().mockImplementation(async(_id:string,expected:number)=>{
    expect(expected).toBe(revision);if(!compiled){compiled=true;revision++;}
    return structuredClone(journal());
  });
  h.jobs.mockReset().mockImplementation(async()=>structuredClone(jobs));
  h.generate.mockReset().mockImplementation(async()=>{const next=job('RUNNING');jobs=[next];return next;});
  h.sync.mockReset().mockImplementation(async()=>{
    if(jobs[0]?.status==='UNKNOWN')return jobs[0];
    const next=job('VALIDATED');jobs=[next];candidates=[...candidates,candidate('char_002','VALIDATED','ab12cd34')];revision++;
    return next;
  });
  h.approve.mockReset().mockImplementation(async(_id:string,input:{candidateId:string;expectedRevision:number;ownerInspected:boolean})=>{
    expect(input.expectedRevision).toBe(revision);expect(input.ownerInspected).toBe(true);
    candidates=candidates.map(c=>c.candidate_id===input.candidateId?{...c,status:'APPROVED',approval_event_id:'explicit',approved_at:'now'}:c);
    revision++;
    if(candidates.every(c=>c.status==='APPROVED'))published={entries:candidates.map(c=>({anchor_id:c.anchor_id,candidate_id:c.candidate_id})),approval_set_sha256:'published'};
    return structuredClone(journal());
  });
  Object.defineProperty(window,'studio',{configurable:true,value:{
    identitySnapshot:h.snapshot,identityPrepareAutomaticGallery:h.prepare,
    identityReferenceJobs:h.jobs,identityGenerateReference:h.generate,identitySyncReference:h.sync,
    identityApproveReference:h.approve,mediaUrl:vi.fn(async(_id:string,relative:string)=>'studio-media://project/'+relative),
    saveGlabsSettings:h.settings
  }});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();Reflect.deleteProperty(window,'studio');});
const button=(name:string)=>screen.getByRole('button',{name});
const markLoaded=(image:HTMLElement)=>{
  Object.defineProperties(image,{complete:{configurable:true,value:true},
    naturalWidth:{configurable:true,value:1},naturalHeight:{configurable:true,value:1}});
  fireEvent.load(image);
};
describe('SB simplified automatic character gallery',()=>{
  it('SB01–03/SB06–11 compiles on open, selects independent model, skips approved cast, polls GET and waits for explicit loaded-image approval',async()=>{
    render(<StyleBibleWorkspace/>);
    await screen.findByText('Two · char_002');
    expect(h.prepare).toHaveBeenCalledWith('project-A',1);
    expect(screen.queryByRole('button',{name:'Freeze AI Style Bible Author'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('AI Style Bible result JSON')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Approve reviewed Style Bible text'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Publish approved canonical Reference Set'})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reference image model'),{target:{value:'gpt_image_2'}});
    fireEvent.click(button('Generate All Remaining'));
    await waitFor(()=>expect(h.generate).toHaveBeenCalledWith('project-A',{
      anchorId:'char_002',authorized:true,model:'gpt_image_2'
    }));
    expect(h.generate).toHaveBeenCalledTimes(1);expect(h.settings).not.toHaveBeenCalled();
    await waitFor(()=>expect(h.sync).toHaveBeenCalledWith('project-A','job-two'),{timeout:4000});
    const image=await screen.findByRole('img',{name:'Visual reference candidate char_002'});
    expect(button('Approve All Ready')).toBeDisabled();
    expect(h.approve).not.toHaveBeenCalled();
    markLoaded(image);
    await waitFor(()=>expect(button('Approve All Ready')).toBeEnabled());
    fireEvent.click(button('Approve All Ready'));
    await waitFor(()=>expect(h.approve).toHaveBeenCalledWith('project-A',{
      expectedRevision:3,candidateId:'candidate-char_002',ownerInspected:true
    }));
    await screen.findByText(/Canonical published/);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(button('Generate All Remaining')).toBeDisabled();
  });
  it('SB17 UNKNOWN is excluded from bulk generation and remains explicit GET-only recovery',async()=>{
    compiled=true;jobs=[job('UNKNOWN')];
    render(<StyleBibleWorkspace/>);
    await screen.findByText('Two · char_002');
    expect(button('Generate All Remaining')).toBeDisabled();
    const jobCard=screen.getByTestId('identity-reference-job');
    expect(within(jobCard).getByText(/UNKNOWN may have charged/)).toBeInTheDocument();
    await new Promise(resolve=>setTimeout(resolve,2200));
    expect(h.generate).not.toHaveBeenCalled();expect(h.sync).not.toHaveBeenCalled();
    fireEvent.click(button('Retry Sync (GET only)'));
    await waitFor(()=>expect(h.sync).toHaveBeenCalledWith('project-A','job-two'));
    expect(h.generate).not.toHaveBeenCalled();
  });
});
