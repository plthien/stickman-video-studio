import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';

const harness=vi.hoisted(()=>({
  projectId:'project-A',readFrozen:vi.fn(),freezeLifecycle:vi.fn(),freezeTask:vi.fn(),
  messages:vi.fn()
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
  Object.defineProperty(window,'studio',{configurable:true,value:{
    readFrozen:harness.readFrozen,freezeLifecycle:harness.freezeLifecycle,freezeTask:harness.freezeTask
  }});
});
afterEach(()=>{cleanup();Reflect.deleteProperty(window,'studio');});
function showCorrect(){
  render(<ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Correct'}));
}
describe('R2 explicit external reservation identity',()=>{
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
