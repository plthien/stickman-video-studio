/* eslint-disable react-hooks/exhaustive-deps -- tests deliberately seed a fixed project once */
import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';
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
      findingIds:['RF-A','RF-B'],editableIds:undefined,editablePaths:undefined});
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledTimes(2));
    expect(freeze.mock.calls[1][3]).toMatchObject({
      findingIds:['RF-A','RF-B'],editableIds:['shot-2'],
      editablePaths:['/shot_ledger/0/meaning']});
    expect(freeze.mock.calls[1][4]).toBe(false);
  });
  it('RF01-14 switching project changes both suggestions and selected findings without scope leakage',async()=>{
    const {freeze}=install();render(<AppStateProvider><MultiFindingHarness/></AppStateProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    const input=await screen.findByLabelText('Finding IDs to resolve (optional; defaults to unresolved findings)');
    await waitFor(()=>expect(input).toHaveValue('RF-A, RF-B'));
    fireEvent.change(input,{target:{value:'RF-B'}});
    fireEvent.click(screen.getByRole('button',{name:'Switch findings project B'}));
    await waitFor(()=>expect(input).toHaveValue('RF-D'));
    expect(screen.getByLabelText('Editable section/shot IDs (comma separated)')).toHaveValue('shot-1');
    expect(screen.getByLabelText('Expanded editable field paths (optional, comma separated)')).toHaveValue('');
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freeze).toHaveBeenCalledWith('B','native','correct',
      expect.objectContaining({findingIds:['RF-D'],editableIds:undefined,editablePaths:undefined}),false));
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
