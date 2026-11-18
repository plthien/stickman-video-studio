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
    native:{editableIds:['shot-1'],findingIds:['N-001'],reviewTaskId:'review-draft',
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
function install(){
  const freeze=vi.fn(async(_id:string,_stage:string,_operation:string,scope:Record<string,unknown>)=>({
    id:'task-'+String(scope.targetContext),revision:1,prompt:'Frozen '+String(scope.targetContext)+' Native mission',
    inputSha256:'b'.repeat(64),artifactSha256:'a'.repeat(64)
  }));
  Object.defineProperty(window,'studio',{configurable:true,value:{
    freezeTask:async()=>({id:'author-task',prompt:'Author prompt'}),
    freezeLifecycle:freeze,readFrozen:async()=>null,
    readHistory:async()=>[],pendingMedia:async()=>null,
    projectState:async(id:string)=>project(id)
  }});
  return{freeze};
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
    expect(await screen.findByDisplayValue('shot-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/shot_ledger/0/meaning')).toBeInTheDocument();
    expect(screen.getByDisplayValue('N-001')).toBeInTheDocument();
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
