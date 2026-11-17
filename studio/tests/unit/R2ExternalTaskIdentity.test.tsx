import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';

const harness=vi.hoisted(()=>({
  projectId:'project-A',readFrozen:vi.fn(),freezeLifecycle:vi.fn(),freezeTask:vi.fn(),
  messages:vi.fn(),stageImport:vi.fn(),stageLifecycle:vi.fn()
}));
vi.mock('../../src/renderer/app/AppState',()=>({
  useAppState:()=>({
    native:{project:{id:harness.projectId},lifecycle:{artifacts:{}}},
    captureProjectSession:()=>({projectId:harness.projectId}),
    isCurrentProjectSession:(scope:{projectId:string})=>scope.projectId===harness.projectId,
    setNativeIfSessionCurrent:()=>true,showNotice:harness.messages
  })
}));
const task=(id:string,scope:Record<string,unknown>)=>({
  id,revision:1,prompt:'Frozen task '+id,editableIds:scope.editableIds??[],
  editablePaths:scope.editablePaths??[],targetIds:scope.targetIds??[],
  findingIds:scope.findingIds??[],mediaTransferAttested:scope.transferAcknowledged??false,
  mediaKind:scope.media
});
beforeEach(()=>{
  harness.projectId='project-A';
  harness.readFrozen.mockReset().mockResolvedValue(null);
  harness.freezeLifecycle.mockReset().mockImplementation(async(_id:string,_stage:string,_op:string,scope:Record<string,unknown>,rebuild:boolean)=>{
    if(rebuild)return task('rebuild-2',scope);
    return task('frozen-1',scope);
  });
  harness.freezeTask.mockReset().mockResolvedValue(task('author-1',{}));
  harness.stageImport.mockReset();harness.stageLifecycle.mockReset();
  Object.defineProperty(window,'studio',{configurable:true,value:{
    readFrozen:harness.readFrozen,freezeLifecycle:harness.freezeLifecycle,freezeTask:harness.freezeTask,
    stageImport:harness.stageImport,stageLifecycle:harness.stageLifecycle
  }});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();Reflect.deleteProperty(window,'studio');});
function showCorrect(){
  render(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Correct'}));
}
describe('R2 explicit external reservation identity',()=>{

  it('loads a local .json file verbatim into the editor without staging or confirming import',async()=>{
    showCorrect();
    const response=JSON.stringify({schema:'mode-b-external-result-v1',payload:{sections:[]}},null,2);
    fireEvent.change(screen.getByLabelText('Choose JSON file'),{
      target:{files:[new File([response],'response.json',{type:'application/json'})]}
    });
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Import JSON'})).toHaveValue(response));
    expect(screen.getByRole('button',{name:'Validate import'})).toBeEnabled();
    expect(harness.stageImport).not.toHaveBeenCalled();
    expect(harness.stageLifecycle).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:/Confirm reviewed import/})).not.toBeInTheDocument();
  });
  it('rejects malformed .json without replacing existing pasted JSON or staging an import',async()=>{
    showCorrect();
    const editor=screen.getByRole('textbox',{name:'Import JSON'});
    fireEvent.change(editor,{target:{value:'{"previous":true}'}});
    fireEvent.change(screen.getByLabelText('Choose JSON file'),{
      target:{files:[new File(['{broken'], 'invalid.json',{type:'application/json'})]}
    });
    await screen.findByText('Selected file is not valid JSON.');
    expect(editor).toHaveValue('{"previous":true}');
    expect(harness.stageImport).not.toHaveBeenCalled();
    expect(harness.stageLifecycle).not.toHaveBeenCalled();
  });
  it('discards a selected JSON file read after switching the native project session',async()=>{
    const delayed:{current:DelayedFileReader|null}={current:null};
    class DelayedFileReader {
      result:string|null=null;
      onload:(()=>void)|null=null;
      onerror:(()=>void)|null=null;
      readAsText(){delayed.current=this;}
    }
    vi.stubGlobal('FileReader',DelayedFileReader);
    const view=render(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
    fireEvent.change(screen.getByLabelText('Choose JSON file'),{
      target:{files:[new File(['{"stale":"old project"}'],'old.json',{type:'application/json'})]}
    });
    expect(delayed.current).not.toBeNull();
    harness.projectId='project-B';
    view.rerender(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
    await waitFor(()=>expect(harness.readFrozen).toHaveBeenCalledWith('project-B','script','author'));
    act(()=>{
      const reader=delayed.current;
      if(reader){reader.result='{"stale":"old project"}';reader.onload?.();}
    });
    expect(screen.getByRole('textbox',{name:'Import JSON'})).toHaveValue('');
    expect(harness.stageImport).not.toHaveBeenCalled();
  });
  it('typing and rerendering scope never freezes; Build is one reservation',async()=>{
    showCorrect();
    const input=screen.getByPlaceholderText('S03, S04');
    for(const text of ['s','sh','shot','shot-1'])fireEvent.change(input,{target:{value:text}});
    expect(harness.freezeLifecycle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(harness.freezeLifecycle).toHaveBeenCalledTimes(1));
    await screen.findByText(/Frozen task frozen-1/);
    fireEvent.change(input,{target:{value:'shot-2'}});
    expect(harness.freezeLifecycle).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Draft scope changed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Rebuild Task'}));
    await waitFor(()=>expect(harness.freezeLifecycle).toHaveBeenCalledTimes(2));
    expect(harness.freezeLifecycle.mock.calls[1][4]).toBe(true);
  });
  it('preserves the task ID when building the unchanged scope, then rebuilds explicitly',async()=>{
    showCorrect();
    fireEvent.change(screen.getByPlaceholderText('S03, S04'),{target:{value:'shot-1'}});
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await screen.findByText(/Frozen task frozen-1/);
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(harness.freezeLifecycle).toHaveBeenCalledTimes(2));
    expect(harness.freezeLifecycle.mock.calls[1][4]).toBe(false);
    expect(screen.getByText(/Frozen task frozen-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Rebuild Task'}));
    await screen.findByText(/Frozen task rebuild-2/);
    expect(harness.freezeLifecycle.mock.calls[2][4]).toBe(true);
  });
  it('discards delayed frozen-task replies from a previous project',async()=>{
    let resolveOld:(value:unknown)=>void=()=>{};
    harness.readFrozen.mockImplementation((id:string)=>id==='project-A'?
      new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(null));
    const view=render(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
    await waitFor(()=>expect(harness.readFrozen).toHaveBeenCalledWith('project-A','script','author'));
    harness.projectId='project-B';
    view.rerender(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
    await waitFor(()=>expect(harness.readFrozen).toHaveBeenCalledWith('project-B','script','author'));
    resolveOld(task('stale-project-A',{}));
    await waitFor(()=>expect(screen.queryByText(/Frozen task stale-project-A/)).not.toBeInTheDocument());
  });
  it('restores a frozen task through read-only IPC without a new reservation',async()=>{
    harness.readFrozen.mockImplementation(async(_project:string,_stage:string,operation:string)=>
      operation==='correct'?task('persisted-7',{editableIds:['shot-1']}):null);
    showCorrect();
    await screen.findByText(/Frozen task persisted-7/);
    expect(harness.freezeLifecycle).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('S03, S04')).toHaveValue('shot-1');
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(harness.freezeLifecycle).toHaveBeenCalledTimes(1));
    expect(harness.freezeLifecycle.mock.calls[0][4]).toBe(false);
  });
});
