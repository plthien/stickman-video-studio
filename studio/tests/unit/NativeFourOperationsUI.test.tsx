/* eslint-disable react-hooks/exhaustive-deps -- tests deliberately seed a fixed project once */
import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const project=(id:string,withDraft=true):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',project:{id,root:'C:/projects/'+id,title:id,style:'B1',
    updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'A coherent story',language:'English',ratio:'9:16'},
  external:{native:{revision:2,artifact:{},importedAt:'now'}},
  nativeDraft:withDraft?{context:'DRAFT',token:'pending-'+id,authorTaskId:'author-'+id,
    revision:2,artifactSha256:(id==='A'?'a':'b').repeat(64),reviewStatus:'REVIEWED_WITH_FINDINGS',
    unresolvedFindings:1,readyForMedia:false}:null,
  suggestedCorrectScope:{
    script:{editableIds:[],findingIds:[],reviewTaskId:null},
    native:{editableIds:[],findingIds:['N-001'],reviewTaskId:'review-draft',
      editablePaths:['/shot_ledger/0/meaning']},
    nativePublished:{editableIds:['shot-2'],findingIds:['P-001'],reviewTaskId:'review-published'}
  },
  nano:{endpoint:'http://127.0.0.1:3901'},projection:{shots:[],duration:0,tracks:{},demo:false}
});
function Harness(){
  const {setNative}=useAppState();
  useEffect(()=>{setNative(project('A'));},[]);
  return <><button onClick={()=>setNative(project('B'))}>Switch project B</button>
    <ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></>;
}
function projectWithFindings(id:string):NativeStudioState{
  const base=project(id),isA=id==='A';
  return {...base,suggestedCorrectScope:{...base.suggestedCorrectScope!,
    native:isA?{
      editableIds:['shot-2'],editablePaths:['/shot_ledger/0/meaning'],
      findingIds:['RF-A','RF-B'],reviewTaskId:'review-A',
      findingScopes:{
        'RF-A':{editableIds:[],editablePaths:['/shot_ledger/0/meaning']},
        'RF-B':{editableIds:['shot-2'],editablePaths:[]}
      }
    }:{
      editableIds:['shot-1'],editablePaths:[],
      findingIds:['RF-D'],reviewTaskId:'review-B',
      findingScopes:{'RF-D':{editableIds:['shot-1'],editablePaths:[]}}
    }
  }};
}
function MultiFindingHarness(){
  const {setNative}=useAppState();
  useEffect(()=>{setNative(projectWithFindings('A'));},[]);
  return <><button onClick={()=>setNative(projectWithFindings('B'))}>Switch findings project B</button>
    <ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></>;
}
function install(){
  const staged=vi.fn(async()=>({token:'staged-native',before:{},after:{manifest:{}},status:'STAGED'}));
  const freeze=vi.fn(async(_id:string,_stage:string,_operation:string,scope:Record<string,unknown>)=>({
    id:'task-'+String(scope.targetContext),revision:1,prompt:'Frozen '+String(scope.targetContext)+' Native mission',
    inputSha256:'b'.repeat(64),artifactSha256:'a'.repeat(64)
  }));
  Object.defineProperty(window,'studio',{configurable:true,value:{
    freezeTask:async()=>({id:'author-task',prompt:'Author prompt'}),
    freezeLifecycle:freeze,stageLifecycle:staged,readFrozen:async()=>null,
    readHistory:async()=>[],pendingMedia:async()=>null,
    projectState:async(id:string)=>project(id)
  }});
  return{freeze,staged};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{configurable:true,value:undefined});});
describe('Native four-operation UI — explicit draft/published target and session isolation',()=>{
  it('N05-UI-01 Native draft is an explicit selectable review target before media',async()=>{
    const {freeze}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    expect(await screen.findByLabelText('Native review target')).toHaveValue('DRAFT');
    expect(screen.getByText(/DRAFT revision 2/)).toHaveTextContent('REVIEWED_WITH_FINDINGS');
    expect(screen.getByText(/DRAFT revision 2/)).toHaveTextContent('Unresolved findings: 1');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('A','native','review',
      expect.objectContaining({targetContext:'DRAFT'}),false));
    await waitFor(()=>expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen DRAFT Native mission'));
  });
  it('N05-UI-02 selecting Published never silently freezes draft content',async()=>{
    const{freeze}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    const select=await screen.findByLabelText('Native review target');
    fireEvent.change(select,{target:{value:'PUBLISHED'}});
    expect(screen.getByText(/PUBLISHED revision 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('A','native','review',
      expect.objectContaining({targetContext:'PUBLISHED'}),false));
  });
  it('N06-UI-03 draft Correct inherits exact confirmed auxiliary path and only current finding',async()=>{
    install();render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    expect(await screen.findByLabelText('Editable section/shot IDs (comma separated)')).toHaveValue('');
    expect(screen.getByDisplayValue('/shot_ledger/0/meaning')).toBeInTheDocument();
    expect(screen.getByDisplayValue('N-001')).toBeInTheDocument();
  });
  it('NF03-01/03/04/07 switches frozen Draft/Published without leaking actionable prompt or losing pasted JSON',async()=>{
    install();render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    const target=await screen.findByLabelText('Native review target');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await screen.findByText('Frozen DRAFT Native mission');
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"payload":"draft"}'}});
    expect(screen.getByRole('button',{name:'Copy prompt'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Export .md'})).toBeEnabled();
    fireEvent.change(target,{target:{value:'PUBLISHED'}});
    expect(screen.getByText(/Native target or scope differs from the frozen task/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Copy prompt'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Export .md'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"payload":"draft"}');
    fireEvent.change(target,{target:{value:'DRAFT'}});
    expect(screen.getByRole('button',{name:'Copy prompt'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Export .md'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Validate import'})).toBeEnabled();
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"payload":"draft"}');
  });
  it('NF03-02/05: changing target blocks confirmation of already staged JSON; Rebuild gets a new target',async()=>{
    const {freeze,staged}=install();render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    const target=await screen.findByLabelText('Native review target');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await screen.findByText('Frozen DRAFT Native mission');
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"result":"draft"}'}});
    fireEvent.click(screen.getByRole('button',{name:'Validate import'}));
    await waitFor(()=>expect(staged).toHaveBeenCalled());
    expect(screen.getByRole('button',{name:/Confirm reviewed import/})).toBeEnabled();
    fireEvent.change(target,{target:{value:'PUBLISHED'}});
    expect(screen.queryByRole('button',{name:/Confirm reviewed import/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Rebuild Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('A','native','review',
      expect.objectContaining({targetContext:'PUBLISHED'}),true));
    await waitFor(()=>expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen PUBLISHED Native mission'));
  });
  it('RF01-13: narrowing finding IDs removes only auto-inferred rights from unselected findings',async()=>{
    const {freeze}=install();
    render(<AppStateProvider><MultiFindingHarness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    const findings=await screen.findByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)');
    const shots=screen.getByLabelText('Editable section/shot IDs (comma separated)');
    const paths=screen.getByLabelText('Expanded editable field paths (optional, comma separated)');
    await waitFor(()=>expect(findings).toHaveValue('RF-A, RF-B'));
    expect(shots).toHaveValue('shot-2');
    expect(paths).toHaveValue('/shot_ledger/0/meaning');
    fireEvent.change(findings,{target:{value:'RF-B'}});
    expect(shots).toHaveValue('shot-2');
    expect(paths).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('A','native','correct',
      expect.objectContaining({findingIds:['RF-B'],editableIds:undefined,editablePaths:undefined}),false));
    // After freezing, switching to F-A cannot keep submitting the old task.
    fireEvent.change(findings,{target:{value:'RF-A'}});
    expect(shots).toHaveValue('');
    expect(paths).toHaveValue('/shot_ledger/0/meaning');
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
  });
  it('RF01-13 explicit manual fields remain owner-controlled when findings narrow',async()=>{
    install();render(<AppStateProvider><MultiFindingHarness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    const findings=await screen.findByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)');
    const shots=screen.getByLabelText('Editable section/shot IDs (comma separated)');
    const paths=screen.getByLabelText('Expanded editable field paths (optional, comma separated)');
    await waitFor(()=>expect(findings).toHaveValue('RF-A, RF-B'));
    fireEvent.change(shots,{target:{value:'shot-1'}});
    fireEvent.change(paths,{target:{value:''}});
    fireEvent.change(findings,{target:{value:'RF-B'}});
    expect(shots).toHaveValue('shot-1');
    expect(paths).toHaveValue('');
  });
  it('RF01-09 UI same frozen scope can be reused without replacing its exact editable arrays',async()=>{
    const {freeze}=install();render(<AppStateProvider><MultiFindingHarness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    await waitFor(()=>expect(screen.getByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)'))
      .toHaveValue('RF-A, RF-B'));
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledTimes(1));
    expect(freeze.mock.calls[0][3]).toMatchObject({
      findingIds:['RF-A','RF-B'],editableIds:['shot-2'],
      editablePaths:['/shot_ledger/0/meaning']});
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledTimes(2));
    expect(freeze.mock.calls[1][3]).toMatchObject({
      findingIds:['RF-A','RF-B'],editableIds:['shot-2'],
      editablePaths:['/shot_ledger/0/meaning']});
    expect(freeze).toHaveBeenNthCalledWith(2,'A','native','correct',expect.any(Object),false);
  });
  it('RF01-14 switching project changes both suggestions and selected findings without scope leakage',async()=>{
    const {freeze}=install();render(<AppStateProvider><MultiFindingHarness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    const input=await screen.findByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)');
    await waitFor(()=>expect(input).toHaveValue('RF-A, RF-B'));
    fireEvent.change(input,{target:{value:'RF-B'}});
    fireEvent.click(screen.getByRole('button',{name:'Switch findings project B'}));
    await waitFor(()=>expect(screen.getByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)')).toHaveValue('RF-D'));
    expect(screen.getByLabelText('Editable section/shot IDs (comma separated)')).toHaveValue('shot-1');
    expect(screen.getByLabelText('Expanded editable field paths (optional, comma separated)')).toHaveValue('');
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    // Project B has its own full, current suggestion: preserving that explicit
    // auto-scope is correct. Assert exact B rights, and no leaked A finding/path.
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('B','native','correct',
      expect.objectContaining({
        findingIds:['RF-D'],editableIds:['shot-1'],editablePaths:[]
      }),false));
    const bScope=freeze.mock.calls.find(call=>call[0]==='B')?.[3];
    expect(bScope).toBeDefined();
    expect(JSON.stringify(bScope)).not.toContain('RF-A');
    expect(JSON.stringify(bScope)).not.toContain('RF-B');
    expect(JSON.stringify(bScope)).not.toContain('shot-2');
    expect(JSON.stringify(bScope)).not.toContain('/shot_ledger/0/meaning');
  });
  it('N05-UI-04 project switch does not expose A draft evidence or its frozen prompt on B',async()=>{
    install();render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    await screen.findByText(/DRAFT revision 2/);
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await screen.findByText('Frozen DRAFT Native mission');
    fireEvent.click(screen.getByRole('button',{name:'Switch project B'}));
    await waitFor(()=>expect(screen.getByText(/DRAFT revision 2/)).toHaveTextContent('b'.repeat(64)));
    expect(screen.getByText(/DRAFT revision 2/)).not.toHaveTextContent('a'.repeat(64));
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('');
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
  });
});

const storyboardCandidate={
  token:'pending-A',status:'WAITING_FOR_MEDIA',
  after:{shots:[
    {id:'shot-1',title:'First shot',start:0,end:5,layers:[
      {id:'layer-1',type:'image',path:'assets/images/one.png'},
      {id:'layer-2',type:'image',path:'assets/images/two.png'}]},
    {id:'shot-2',title:'Second shot',start:5,end:10,layers:[
      {id:'layer-3',type:'image',path:'assets/images/three.png'}]}
  ],captions:[]},
  missing:[
    {key:'image:0:layer-1',kind:'image',shotId:'shot-1',layerId:'layer-1',path:'assets/images/one.png'},
    {key:'image:0:layer-2',kind:'image',shotId:'shot-1',layerId:'layer-2',path:'assets/images/two.png'},
    {key:'image:1:layer-3',kind:'image',shotId:'shot-2',layerId:'layer-3',path:'assets/images/three.png'}
  ],
  fulfillments:{}
};
type StoryboardCandidate=typeof storyboardCandidate;
function preparedImages(candidate:StoryboardCandidate|null){
  const missing=candidate?.missing??[];
  return{status:candidate?'PRE_MEDIA_PROJECTION':'NO_NATIVE_DRAFT',style:'B1',revision:2,
    token:candidate?.token??'',shotCount:candidate?.after.shots.length??0,imageOccurrences:missing.length,
    uniquePaths:new Set(missing.map(item=>item.path)).size,
    jobs:missing.map((item,index)=>({
      assetKey:item.key,targetKeys:[item.key],expectedPaths:[item.path],
      targetKey:item.key,shotId:item.shotId,layerId:item.layerId,path:item.path,
      assetKind:'other',state:'READY',reason:'',
      prompt:'Approved B1 style. Exact owner-approved image for '+item.layerId,
      promptSha256:String(index).repeat(64),
      sourceDescription:'Owner-approved image for '+item.layerId,
      sourceLedger:'',sourceRows:[{shot_id:item.shotId,layer_id:item.layerId,path:item.path,
        content:'Owner-approved image for '+item.layerId}],
      styleProfileRef:{id:'B1',path:'references/b1-minimal-handdrawn.md',sha256:'c'.repeat(64)},
      references:[],styleAnchors:[],
      draftIdentity:{projectId:'A',authorTaskId:'author-A',token:candidate!.token,
        revision:2,creativeFingerprint:String(index+1).repeat(64)},
      occurrencesAtPath:1,ownerEdited:false
    }))
  };
}
function StoryboardHarness(){
  const {setNative}=useAppState();
  useEffect(()=>{setNative(project('A'));},[]);
  return <StoryboardWorkspace/>;
}
function installStoryboard(candidate:StoryboardCandidate|null=storyboardCandidate){
  const glabsGenerate=vi.fn(async()=>({id:'new-image-job'}));
  const pendingMedia=vi.fn(async()=>candidate);
  const prepareImages=vi.fn(async()=>preparedImages(candidate));
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia,prepareImages,
    glabsSettings:vi.fn(async()=>({config:{model:'nano_banana_2',aspectRatio:'9:16'}})),
    glabsJobs:vi.fn(async()=>[]),glabsGenerate,
    mediaUrl:vi.fn(async()=>''),projectState:vi.fn(async()=>project('A'))
  }});
  return{glabsGenerate,pendingMedia,prepareImages};
}
describe('Storyboard — source-grounded paid image generation for current Native Shot',()=>{
  it('SB-IMG-01 compiles first missing layer automatically; paid submission requires explicit owner click',async()=>{
    const {glabsGenerate}=installStoryboard();
    render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    const generate=await screen.findByRole('button',{name:'Generate Image'});
    await waitFor(()=>expect(generate).toBeEnabled());
    expect(screen.getByText(/Current Project Style:/).closest('div')).toHaveTextContent('B1');
    expect(screen.getByText(/Image:/).closest('div')).toHaveTextContent('layer-1');
    expect(screen.getByText('Approved B1 style. Exact owner-approved image for layer-1', {selector:'pre'})).toBeInTheDocument();
    expect(glabsGenerate).not.toHaveBeenCalled();
    fireEvent.click(generate);
    await waitFor(()=>expect(glabsGenerate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:'image:0:layer-1',model:'nano_banana_2',aspectRatio:'9:16',
      preparedFingerprint:'1'.repeat(64),
      prompt:'Approved B1 style. Exact owner-approved image for layer-1',authorized:true
    })));
  });
  it('SB-IMG-02 target switching isolates owner-edited prompts and never auto-posts',async()=>{
    const {glabsGenerate}=installStoryboard();
    render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 3'));
    fireEvent.click(screen.getByText(/Advanced · target-specific edits/));
    const prompt=screen.getByLabelText('Edit image prompt for current target only');
    fireEvent.change(prompt,{target:{value:'Owner changes only first layer image pose'}});
    expect(screen.getByText(/Save the edited prompt\/references before generating this image\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Owner-approved image for layer-2/}));
    expect(screen.getByLabelText('Edit image prompt for current target only')).toHaveValue(
      'Approved B1 style. Exact owner-approved image for layer-2');
    expect(screen.getByLabelText('Edit image prompt for current target only')).not.toHaveValue(
      'Owner changes only first layer image pose');
    fireEvent.click(screen.getByRole('button',{name:/shot-2/}));
    expect(screen.getByText(/Image:/).closest('div')).toHaveTextContent('layer-3');
    expect(glabsGenerate).not.toHaveBeenCalled();
  });
  it('SB-IMG-04 Native DRAFT correction refreshes exact missing target without leaking previous selection',async()=>{
    const oldDraft={...storyboardCandidate,token:'draft-2',
      missing:[storyboardCandidate.missing[0]]};
    const nextDraft={...storyboardCandidate,token:'draft-3',
      missing:[storyboardCandidate.missing[1]]};
    const {pendingMedia}=installStoryboard(oldDraft);
    pendingMedia.mockResolvedValueOnce(oldDraft).mockResolvedValueOnce(nextDraft);
    const prepareImages=vi.fn().mockResolvedValueOnce(preparedImages(oldDraft))
      .mockResolvedValueOnce(preparedImages(nextDraft));
    Object.defineProperty(window,'studio',{configurable:true,value:{...window.studio,prepareImages}});
    function RecheckHarness(){
      const {setNative}=useAppState();
      const snapshot=(rev:number):NativeStudioState=>{
        const base=project('A');
        return {...base,nativeDraft:{...base.nativeDraft!,revision:rev,token:'draft-'+rev}};
      };
      useEffect(()=>{setNative(snapshot(2));},[]);
      return <><button onClick={()=>setNative(snapshot(3))}>Commit current corrected DRAFT</button>
        <StoryboardWorkspace/></>;
    }
    render(<AppStateProvider><RecheckHarness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByText(/Image:/).closest('div')).toHaveTextContent('layer-1'));
    fireEvent.click(screen.getByRole('button',{name:'Commit current corrected DRAFT'}));
    await waitFor(()=>expect(pendingMedia).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getByText(/Image:/).closest('div')).toHaveTextContent('layer-2'));
    expect(screen.queryByRole('button',{name:/Owner-approved image for layer-1/})).not.toBeInTheDocument();
  });
  it('SB-IMG-03 missing Native candidate never offers a paid Generate action',async()=>{
    const {glabsGenerate}=installStoryboard(null);
    render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('glabs-image-unavailable')).toHaveTextContent(
      'No Native DRAFT media candidate staged.'));
    expect(screen.queryByRole('button',{name:/Generate Image|Regenerate Image/})).not.toBeInTheDocument();
    expect(glabsGenerate).not.toHaveBeenCalled();
  });
});
