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
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen DRAFT Native mission');
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
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen PUBLISHED Native mission');
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
  token:'native-pending-A',status:'WAITING_FOR_MEDIA',
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
function StoryboardHarness(){
  const {setNative}=useAppState();
  useEffect(()=>{setNative(project('A'));},[]);
  return <StoryboardWorkspace/>;
}
function installStoryboard(pending:unknown=storyboardCandidate){
  const glabsGenerate=vi.fn(async()=>({id:'new-image-job'}));
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia:vi.fn(async()=>pending),
    glabsSettings:vi.fn(async()=>({config:{model:'gpt-image-2',aspectRatio:'9:16'}})),
    glabsJobs:vi.fn(async()=>[]),
    glabsGenerate,
    mediaUrl:vi.fn(async()=>''),projectState:vi.fn(async()=>project('A'))
  }});
  return{glabsGenerate};
}
describe('Storyboard — visible G-Labs image generation for current Native Shot',()=>{
  it('SB-IMG-01 shows Generate without hidden import-dropdown selection, defaults to first image and keeps paid authorization explicit',async()=>{
    const {glabsGenerate}=installStoryboard();
    render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    const generate=screen.getByRole('button',{name:'Generate / Regenerate image (paid confirmation)'});
    expect(generate).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByLabelText('Image layer to generate')).toHaveValue('image:0:layer-1'));
    expect(generate).toBeDisabled();
    await waitFor(()=>expect(screen.getByText(/Model: gpt-image-2/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Image prompt (owner-confirmed, not invented)'),{
      target:{value:'A verified owner-authored image prompt for this layer'}});
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    await waitFor(()=>expect(glabsGenerate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:'image:0:layer-1',model:'gpt-image-2',aspectRatio:'9:16',
      prompt:'A verified owner-authored image prompt for this layer',authorized:true
    })));
  });
  it('SB-IMG-02 switching layer or Shot clears the old prompt and cannot send it to a different image target',async()=>{
    installStoryboard();render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    const select=await screen.findByLabelText('Image layer to generate');
    const prompt=screen.getByLabelText('Image prompt (owner-confirmed, not invented)');
    fireEvent.change(prompt,{target:{value:'First image prompt is not reusable'}});
    fireEvent.change(select,{target:{value:'image:0:layer-2'}});
    expect(prompt).toHaveValue('');
    expect(select).toHaveValue('image:0:layer-2');
    fireEvent.change(prompt,{target:{value:'Second image must be different'}});
    fireEvent.click(screen.getByRole('button',{name:/shot-2.*Second shot/}));
    await waitFor(()=>expect(screen.getByLabelText('Image layer to generate')).toHaveValue('image:1:layer-3'));
    expect(screen.getByLabelText('Image prompt (owner-confirmed, not invented)')).toHaveValue('');
    expect(screen.getByRole('button',{name:'Generate / Regenerate image (paid confirmation)'})).toBeDisabled();
  });
  it('SB-IMG-03 shows the image action but blocks submission when no Native candidate exists',async()=>{
    const {glabsGenerate}=installStoryboard(null);
    render(<AppStateProvider><StoryboardHarness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('glabs-image-unavailable')).toHaveTextContent(
      'No current Native Author candidate is staged'));
    const generate=screen.getByRole('button',{name:'Generate / Regenerate image (paid confirmation)'});
    expect(generate).toBeDisabled();
    expect(glabsGenerate).not.toHaveBeenCalled();
  });
});
