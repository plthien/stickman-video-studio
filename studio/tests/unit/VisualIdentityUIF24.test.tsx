import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CharacterRegistryPanel} from '../../src/renderer/features/storyboard/CharacterRegistryPanel';
import {ShotImageGallery,type GalleryCard} from '../../src/renderer/features/storyboard/ShotImageGallery';

const id='a'.repeat(24),SHA='1'.repeat(64),CREATIVE='2'.repeat(64);
const targets=[
  {key:'image:0:portrait',shotId:'shot-1',layerId:'portrait',
    path:'assets/images/portrait.png',boundPath:'assets/images/portrait.png',
    creativeFingerprint:CREATIVE,managed:true,fulfilled:false,
    mappingCurrent:false,characters:[],noRecurringCharacter:false,
    continuity:null,readiness:'NEEDS_MAPPING_REVIEW'},
  {key:'image:1:landscape',shotId:'shot-2',layerId:'landscape',
    path:'assets/images/landscape.png',boundPath:'assets/images/landscape.png',
    creativeFingerprint:CREATIVE,managed:true,fulfilled:false,
    mappingCurrent:false,characters:[],noRecurringCharacter:false,
    continuity:null,readiness:'NEEDS_MAPPING_REVIEW'}
] as const;
const snapshot=()=>({
  registry:{schema:'stickman-character-registry-v1' as const,projectId:id,
    strict:false,revision:0,characters:[],history:[]},
  bindings:{schema:'stickman-target-bindings-v1' as const,projectId:id,
    revision:0,bindings:[],history:[]},
  coverage:{strict:false,registryRevision:0,targets:[...targets],
    mapped:0,needsReview:2,blocked:0},
  reviews:{schema:'stickman-visual-review-v1' as const,
    projectId:id,revision:0,attestations:[]}
});
function install(){
  const initial=snapshot();
  const glabsGenerate=vi.fn(),glabsApprove=vi.fn();
  const visualIdentitySnapshot=vi.fn(async()=>initial);
  const visualIdentityCreateCharacter=vi.fn(async()=>initial.registry);
  const visualIdentitySetStrict=vi.fn(async()=>initial.registry);
  const visualIdentityMapTarget=vi.fn(async()=>initial.bindings);
  const visualIdentityAttestCandidate=vi.fn(async()=>initial.reviews);
  const visualIdentityResolve=vi.fn(async()=>({
    readiness:'READY',referenceSetSha256:SHA
  }));
  const onChanged=vi.fn(async()=>undefined);
  Object.defineProperty(window,'studio',{configurable:true,value:{
    visualIdentitySnapshot,visualIdentityCreateCharacter,visualIdentitySetStrict,
    visualIdentityMapTarget,visualIdentityAttestCandidate,visualIdentityResolve,
    mediaUrl:vi.fn(async()=> 'studio-media://A/character.png'),
    glabsGenerate,glabsApprove
  }});
  return{...initial,visualIdentitySnapshot,visualIdentityCreateCharacter,
    visualIdentitySetStrict,visualIdentityMapTarget,visualIdentityAttestCandidate,
    glabsGenerate,glabsApprove,onChanged};
}
const spec:NonNullable<GalleryCard['spec']>={
  assetKey:'image:0:portrait',targetKeys:['image:0:portrait'],
  expectedPaths:['assets/images/portrait.png'],
  targetKey:'image:0:portrait',shotId:'shot-1',layerId:'portrait',
  path:'assets/images/portrait.png',assetKind:'character',
  state:'READY',reason:'',prompt:'Exact Native source action',
  promptSha256:SHA,effectivePrompt:'Exact Native source action',
  effectivePromptSha256:SHA,sourceDescription:'Exact Native source action',
  sourceLedger:'',sourceRows:[],
  styleProfileRef:{id:'B1',path:'references/b1-minimal-handdrawn.md',sha256:SHA},
  references:['assets/images/character.png'],identityOwnerReferences:[],
  styleAnchors:[],
  draftIdentity:{projectId:id,authorTaskId:'author-1',token:'native-token',
    revision:1,creativeFingerprint:CREATIVE},
  occurrencesAtPath:1,ownerEdited:false,
  referenceSetSha256:SHA,
  visualReferencePlan:{enabled:true,targetKey:'image:0:portrait',
    characterIds:['char_001'],readiness:'READY',referenceSetSha256:SHA,
    blockers:[],sourceSnapshotSha256:undefined,
    orderedPaths:['assets/images/character.png'],
    effectivePromptAppendix:'CANONICAL CHARACTER IDENTITY REFERENCES',
    references:[{kind:'character',anchorId:'char_001',
      sourcePath:'assets/images/character.png',sha256:SHA,
      mime:'image/png',rightsSha256:SHA,
      sourceIdentity:'char_001@'+SHA,required:true}]}
};
const candidate:GalleryCard={
  target:{key:'image:0:portrait',shotId:'shot-1',layerId:'portrait',
    path:'assets/images/portrait.png',boundPath:'assets/images/portrait.png',
    fulfilled:false,managed:true,creativeFingerprint:CREATIVE},
  job:{id:'d2f20000-0000-4000-8000-000000000001',projectId:id,
    token:'native-token',targetKey:'image:0:portrait',shotId:'shot-1',layerId:'portrait',
    targetPath:'assets/images/portrait.png',status:'VALIDATED',
    model:'nano_banana_2',aspectRatio:'9:16',prompt:'Exact Native source action',
    referenceSetSha256:SHA,
    staged:{path:'assets/images/candidate.png',sha256:'3'.repeat(64),
      width:768,height:1365}},
  history:[],spec
};
function readyImage(img:HTMLElement){
  Object.defineProperty(img,'complete',{configurable:true,value:true});
  Object.defineProperty(img,'naturalWidth',{configurable:true,value:768});
  Object.defineProperty(img,'naturalHeight',{configurable:true,value:1365});
  fireEvent.load(img);
}
afterEach(()=>{cleanup();vi.restoreAllMocks();
  Object.defineProperty(window,'studio',{configurable:true,value:undefined});});
describe('F24 owner-only registry controls and F25 continuity-review integration',()=>{
  it('VCR-19/UI-01 opening or refreshing Registry sends no G-Labs requests',async()=>{
    const api=install();
    render(<CharacterRegistryPanel projectId={id} onChanged={api.onChanged}/>);
    expect(await screen.findByText(/Owner-approved images only/)).toBeInTheDocument();
    expect(screen.getByTestId('character-coverage'))
      .toHaveTextContent('Current Native Layers 2');
    expect(screen.getByRole('button',{name:'Enable Strict Character Continuity'}))
      .toBeEnabled();
    expect(api.glabsGenerate).not.toHaveBeenCalled();
    expect(api.glabsApprove).not.toHaveBeenCalled();
  });
  it('VCR-01/UI-02 stable character creation is a local, explicit owner action',async()=>{
    const api=install();
    render(<CharacterRegistryPanel projectId={id} onChanged={api.onChanged}/>);
    await screen.findByRole('button',{name:'Create Character'});
    fireEvent.change(screen.getByLabelText('New character ID'),{target:{value:'char_001'}});
    fireEvent.change(screen.getByLabelText('New character label'),{target:{value:'Owner supplied name'}});
    fireEvent.click(screen.getByRole('button',{name:'Create Character'}));
    await waitFor(()=>expect(api.visualIdentityCreateCharacter).toHaveBeenCalledWith(id,{
      characterId:'char_001',label:'Owner supplied name',expectedRevision:0
    }));
    expect(api.glabsGenerate).not.toHaveBeenCalled();
  });
  it('VCR-05/24/UI-03 owner selects exact Layers; no auto-all or paid mapping',async()=>{
    const api=install();
    render(<CharacterRegistryPanel projectId={id} onChanged={api.onChanged}/>);
    await screen.findByText(/Owner-approved images only/);
    fireEvent.click(screen.getByText(/Exact-target Character Mapping/));
    fireEvent.click(screen.getByRole('checkbox',{name:'Select target image:0:portrait'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'No recurring character'}));
    const button=screen.getByRole('button',{name:'Confirm mapping for 1 selected Layers'});
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(()=>expect(api.visualIdentityMapTarget).toHaveBeenCalledWith(id,
      expect.objectContaining({targetKey:'image:0:portrait',characters:[],
        noRecurringCharacter:true,continuity:null,expectedRevision:0})));
    expect(api.visualIdentityMapTarget).toHaveBeenCalledTimes(1);
    expect(api.glabsGenerate).not.toHaveBeenCalled();
    expect(api.glabsApprove).not.toHaveBeenCalled();
  });
  it('VCR-21/23/UI-04 current candidate and master must load before a human identity attestation',async()=>{
    const api=install(),onLoaded=vi.fn(),onReview=vi.fn();
    const view=render(<ShotImageGallery projectId={id} shotId="shot-1"
      cards={[candidate]} urls={{[candidate.job!.id]:'studio-media://A/candidate.png'}}
      previewReady={{}} previewErrors={{}} previewIdentity={job=>job.id}
      busy={false} selectedIds={new Set()} onLoaded={onLoaded}
      onSelect={vi.fn()} onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}
      onIdentityReviewed={onReview} identityReviews={[]}/>);
    const card=screen.getByTestId('shot-image-card');
    const thumbnail=within(card).getByRole('button',{name:'Expand image shot-1/portrait'});
    expect(thumbnail).toBeDisabled();
    expect(within(card).getByTestId('shot-image-stage')).not.toHaveAttribute('style');
    const renderReady=()=>view.rerender(<ShotImageGallery projectId={id} shotId="shot-1"
      cards={[candidate]} urls={{[candidate.job!.id]:'studio-media://A/candidate.png'}}
      previewReady={{[candidate.job!.id]:candidate.job!.id}} previewErrors={{}}
      previewIdentity={job=>job.id}
      busy={false} selectedIds={new Set()} onLoaded={onLoaded}
      onSelect={vi.fn()} onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}
      onIdentityReviewed={onReview} identityReviews={[]}/>);
    readyImage(within(card).getByRole('img'));
    renderReady();
    fireEvent.click(thumbnail);
    const dialog=screen.getByRole('dialog',{name:'Expanded generated image'});
    expect(dialog).toHaveTextContent('Canonical Registry');
    expect(within(dialog).getByRole('button',{
      name:'I visually checked this candidate against master'})).toBeDisabled();
    const master=await within(dialog).findByRole('img',{
      name:'Canonical character reference char_001'
    });
    readyImage(master);
    const reviewed=within(dialog).getByRole('button',{
      name:'I visually checked this candidate against master'
    });
    expect(reviewed).toBeEnabled();
    fireEvent.click(reviewed);
    expect(onReview).toHaveBeenCalledWith(candidate.job!.id,candidate.target.key,
      candidate.job!.staged!.sha256,SHA);
    expect(api.glabsGenerate).not.toHaveBeenCalled();
    expect(api.glabsApprove).not.toHaveBeenCalled();
  });
  it('VCR-21/UI-05 strict continuity blocked target does not expose a paid generation CTA',()=>{
    install();
    const blocked:GalleryCard={...candidate,
      spec:{...spec,state:'BLOCKED',reason:'CONTINUITY_SOURCE_NOT_READY',
        visualReferencePlan:{...spec.visualReferencePlan!,
          readiness:'CONTINUITY_SOURCE_NOT_READY',
          blockers:['CONTINUITY_SOURCE_NOT_READY']}},
      job:null,history:[]};
    render(<ShotImageGallery projectId={id} shotId="shot-1" cards={[blocked]}
      urls={{}} previewReady={{}} previewErrors={{}} previewIdentity={()=>''}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:/Generate Image/})).not.toBeInTheDocument();
    const card=screen.getByTestId('shot-image-card');
    fireEvent.click(within(card).getByText(/Prompt · references · candidate history/));
    expect(within(card).getByTestId('character-card-binding'))
      .toHaveTextContent('CONTINUITY_SOURCE_NOT_READY');
  });
});
