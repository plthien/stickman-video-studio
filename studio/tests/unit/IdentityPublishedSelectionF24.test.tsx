// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {StyleBibleWorkspace} from '../../src/renderer/features/external/StyleBibleWorkspace';

const harness=vi.hoisted(()=>({projectId:'project-A'}));
vi.mock('../../src/renderer/app/AppState',()=>({
  useAppState:()=>({native:{project:{id:harness.projectId}}})
}));
const makeSnapshot=(projectId:string)=>({
  policy:'v1',readiness:'REFERENCES_PUBLISHED',
  journal:{
    revision:7,bible:{schema:'stickman-project-style-bible-v1',
      style_bible_sha256:'current-bible',characters:[{
        char_id:'char_001',label:'Kip',description:'Narrative identity',
        entity_kind:'human_character',narrative_role:'Named actor',
        source_definition_hash:'fixed-definition',occurrences:[],
        identity_markers:[],visual_readiness:'NEEDS_OWNER_DEFINITION'
      }]},
    bibleTextApproved:{sha256:'current-bible'},
    analysisApproved:{sha256:'reviewed'},referenceCandidates:[
      {candidate_id:'published-A',anchor_id:'char_001',
        source_definition_hash:'fixed-definition',status:'APPROVED',
        media_path:'assets/images/a.png',media_sha256:'a'.repeat(64),
        width:1,height:1,source:'OWNER_IMPORTED'},
      {candidate_id:'unpublished-B',anchor_id:'char_001',
        source_definition_hash:'fixed-definition',status:'APPROVED',
        media_path:'assets/images/b.png',media_sha256:'b'.repeat(64),
        width:1,height:1,source:'OWNER_IMPORTED'}
    ],
    referenceApprovalSet:{entries:[{anchor_id:'char_001',candidate_id:'published-A'}]},
    ownerVisualDefinitions:[],projectId,
  }
});
const preview=vi.fn();
const publish=vi.fn();
beforeEach(()=>{
  harness.projectId='project-A';
  preview.mockReset().mockImplementation(async(projectId:string,selectedIds:string[])=>
    ({projectId,revision:7,selectedIds,impactSha256:'impact-v7',
      changedCharacterIds:['char_001'],affectedTargetKeys:[],
      publishedNativeAffected:false}));
  publish.mockReset().mockResolvedValue({});
  Object.defineProperty(window,'studio',{configurable:true,value:{
    identitySnapshot:vi.fn(async(id:string)=>makeSnapshot(id)),
    identityReferenceJobs:vi.fn(async()=>[]),
    mediaUrl:vi.fn(async()=>''),identityPreviewReferenceImpact:preview,
    identityPublishReferences:publish,
  }});
});
afterEach(()=>{cleanup();Reflect.deleteProperty(window,'studio');vi.clearAllMocks();});
describe('F24-A05 canonical selection is distinct from newly approved candidates',()=>{
  it('A05-01/02/03 defaults to published A, and B requires an exact impact preview',async()=>{
    render(<StyleBibleWorkspace/>);
    const radios=await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    const publishButton=screen.getByRole('button',{
      name:'Publish approved canonical Reference Set'});
    expect(publishButton).toBeDisabled();
    fireEvent.click(radios[1]);
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
    expect(publishButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{
      name:'Preview canonical replacement impact'}));
    await waitFor(()=>expect(preview).toHaveBeenCalledWith(
      'project-A',['unpublished-B']));
    await waitFor(()=>expect(publishButton).toBeEnabled());
    expect(publish).not.toHaveBeenCalled();
  });
  it('A05-05/06 switching projects clears prior choice and preview, restores published canonical',async()=>{
    const view=render(<StyleBibleWorkspace/>);
    const radios=await screen.findAllByRole('radio');
    fireEvent.click(radios[1]);
    harness.projectId='project-B';
    view.rerender(<StyleBibleWorkspace/>);
    const updated=await screen.findAllByRole('radio');
    await waitFor(()=>expect(updated[0]).toBeChecked());
    expect(updated[1]).not.toBeChecked();
    expect(preview).not.toHaveBeenCalled();
  });
});
