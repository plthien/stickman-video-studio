import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';

type Operation='author'|'review'|'correct'|'recheck';
type Entry={task:{task_id:string;operation:Operation;revision:number;prompt:string};status:'FROZEN'|'IMPORTED'};
type Journal={projectId:string;revision:number;currentTask:Entry|null;
  draftAnalysis:{continuity_catalog:{characters:{char_id:string;label:string;occurrences:unknown[]}[]}}|null;
  independentReview:{approved:boolean;findings:unknown[]}|null;analysisApproved:{sha256:string}|null};
const h=vi.hoisted(()=>({
  id:'A',epoch:1,notice:vi.fn(),snapshot:vi.fn(),freeze:vi.fn(),importResult:vi.fn(),approve:vi.fn(),
  readFrozen:vi.fn(),freezeTask:vi.fn(),freezeLifecycle:vi.fn(),stageImport:vi.fn(),stageLifecycle:vi.fn(),exportPrompt:vi.fn()
}));
vi.mock('../../src/renderer/app/AppState',()=>({useAppState:()=>({
  native:{project:{id:h.id},lifecycle:{artifacts:{}}},
  captureProjectSession:()=>({projectId:h.id,epoch:h.epoch}),
  isCurrentProjectSession:(scope:{projectId:string;epoch:number})=>scope.projectId===h.id&&scope.epoch===h.epoch,
  setNativeIfSessionCurrent:()=>true,showNotice:h.notice
})}));
const journals:Record<string,Journal>={};
const genericTasks:Record<string,{id:string;revision:number;prompt:string}>={};
const empty=(id:string):Journal=>({projectId:id,revision:0,currentTask:null,draftAnalysis:null,independentReview:null,analysisApproved:null});
const entry=(operation:Operation,revision:number,status:Entry['status']='FROZEN'):Entry=>({
  task:{task_id:operation+'-'+revision,operation,revision,prompt:'Frozen identity '+operation+' '+revision},status
});
const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
beforeEach(()=>{
  h.id='A';h.epoch=1;
  for(const key of Object.keys(journals))delete journals[key];
  for(const key of Object.keys(genericTasks))delete genericTasks[key];
  journals.A=empty('A');journals.B=empty('B');
  vi.clearAllMocks();
  h.snapshot.mockReset().mockImplementation(async(id:string)=>({policy:'v1',readiness:'READY',journal:structuredClone(journals[id])}));
  h.freeze.mockReset().mockImplementation(async(id:string,operation:Operation,revision:number)=>{
    const j=journals[id];expect(revision).toBe(j.revision);
    j.currentTask=entry(operation,++j.revision);return structuredClone(j);
  });
  h.importResult.mockReset().mockImplementation(async(id:string,_json:string,revision:number)=>{
    const j=journals[id];expect(revision).toBe(j.revision);j.revision++;
    if(j.currentTask)j.currentTask.status='IMPORTED';
    j.draftAnalysis={continuity_catalog:{characters:[{char_id:'char_001',label:'Actor A',occurrences:[{}]}]}};
    j.independentReview={approved:true,findings:[]};return structuredClone(j);
  });
  h.approve.mockReset().mockImplementation(async(id:string,revision:number)=>{
    const j=journals[id];expect(revision).toBe(j.revision);j.revision++;j.analysisApproved={sha256:'approved-sha'};return structuredClone(j);
  });
  h.readFrozen.mockReset().mockImplementation(async(id:string,stage:string,op:string)=>genericTasks[[id,stage,op].join('|')]??null);
  h.freezeTask.mockReset().mockImplementation(async(id:string,stage:string)=>{
    const task={id:stage+'-task',revision:1,prompt:'Generic '+stage+' prompt'};
    genericTasks[[id,stage,'author'].join('|')]=task;return task;
  });
  h.freezeLifecycle.mockReset();h.stageImport.mockReset();h.stageLifecycle.mockReset();h.exportPrompt.mockReset();
  Object.defineProperty(window,'studio',{configurable:true,value:{
    identitySnapshot:h.snapshot,identityFreeze:h.freeze,identityImport:h.importResult,identityApproveAnalysis:h.approve,
    readFrozen:h.readFrozen,freezeTask:h.freezeTask,freezeLifecycle:h.freezeLifecycle,
    stageImport:h.stageImport,stageLifecycle:h.stageLifecycle,exportPrompt:h.exportPrompt
  }});
});
afterEach(()=>{
  cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(window,'studio');
  if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);
  else Reflect.deleteProperty(navigator,'clipboard');
});
const workspace=()=> <ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider>;
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name,exact:true}));
const editor=()=>screen.getByLabelText('Script Analysis JSON result');
const genericEditor=()=>screen.getByRole('textbox',{name:'Import JSON'});
const enter=async()=>{
  click('Script Analysis');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Build Task'})).toBeEnabled());
};
const selectFile=(contents:string)=>fireEvent.change(screen.getByLabelText('Choose JSON file'),{
  target:{files:[new File([contents],'response.json',{type:'application/json'})]}
});
const build=async(operation:Operation,revision:number)=>{
  click('Build Task');
  await screen.findByText('Frozen identity '+operation+' '+revision);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Build Task'})).toBeEnabled());
};
describe('Script Analysis first-class External workspace',()=>{
  it('UI01 exposes three ordered stages and UI02 only renders the selected workspace',async()=>{
    render(workspace());
    const stages=()=>within(screen.getByRole('group',{name:'External stage'}));
    expect(stages().getAllByRole('button').map(b=>b.textContent)).toEqual(['Script','Script Analysis','Native']);
    expect(screen.queryByTestId('script-analysis-identity-workspace')).not.toBeInTheDocument();
    await enter();
    expect(screen.getByTestId('script-analysis-identity-workspace')).toBeInTheDocument();
    expect(screen.queryByRole('textbox',{name:'Import JSON'})).not.toBeInTheDocument();
    expect(screen.getAllByRole('button',{name:'Build Task'})).toHaveLength(1);
    click('Native');
    expect(screen.queryByTestId('script-analysis-identity-workspace')).not.toBeInTheDocument();
    expect(genericEditor()).toBeInTheDocument();
    expect(stages().getByRole('button',{name:'Native'})).toHaveAttribute('aria-pressed','true');
  });
  it('UI03 uses identity freeze for each operation and explicitly rebuilds only supported frozen tasks',async()=>{
    render(workspace());await enter();
    for(const [index,operation] of (['author','review','correct','recheck'] as const).entries()){
      click(operation[0].toUpperCase()+operation.slice(1));
      await build(operation,index+1);
      expect(h.freeze).toHaveBeenLastCalledWith('A',operation,index);
    }
    expect(h.freezeTask).not.toHaveBeenCalled();expect(h.freezeLifecycle).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'Rebuild Task'})).not.toBeInTheDocument();
    click('Author');click('Build Task');
    await screen.findByText('Frozen identity author 5');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Rebuild Task'})).toBeEnabled());
    fireEvent.change(editor(),{target:{value:'{"keep":1}'}});
    click('Build Task');expect(h.freeze).toHaveBeenCalledTimes(5);expect(editor()).toHaveValue('{"keep":1}');
    click('Rebuild Task');await screen.findByText('Frozen identity author 6');
    expect(editor()).toHaveValue('');
  });
  it('UI04 loads valid original bytes with real FileReader and never imports or approves automatically',async()=>{
    render(workspace());await enter();await build('author',1);
    const raw=' {\n  "payload": {"name":"Đúng"}\n}\n';
    selectFile(raw);await waitFor(()=>expect(editor()).toHaveValue(raw));
    expect(screen.getByRole('button',{name:'Import frozen response'})).toBeEnabled();
    expect(h.importResult).not.toHaveBeenCalled();expect(h.approve).not.toHaveBeenCalled();
    expect(h.stageImport).not.toHaveBeenCalled();
  });
  it('UI05 rejects malformed bytes and preserves manually pasted JSON',async()=>{
    render(workspace());await enter();
    fireEvent.change(editor(),{target:{value:'{"previous":true}'}});
    selectFile('{broken');
    await screen.findByText('Selected file is not valid JSON.');
    expect(editor()).toHaveValue('{"previous":true}');expect(h.importResult).not.toHaveBeenCalled();
  });
  it('UI06 retains per-stage/per-operation drafts and never enables import against cached history',async()=>{
    render(workspace());fireEvent.change(genericEditor(),{target:{value:'{"script":1}'}});
    await enter();await build('author',1);
    fireEvent.change(editor(),{target:{value:'{"author":1}'}});
    click('Review');expect(editor()).toHaveValue('');
    await build('review',2);fireEvent.change(editor(),{target:{value:'{"review":2}'}});
    click('Author');expect(editor()).toHaveValue('{"author":1}');
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen identity author 1');
    expect(screen.getByRole('button',{name:'Import frozen response'})).toBeDisabled();
    click('Script');expect(genericEditor()).toHaveValue('{"script":1}');
    click('Native');fireEvent.change(genericEditor(),{target:{value:'{"native":1}'}});
    await enter();expect(editor()).toHaveValue('{"author":1}');
    click('Review');expect(editor()).toHaveValue('{"review":2}');
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Frozen identity review 2');
    click('Native');expect(genericEditor()).toHaveValue('{"native":1}');
  });
  it('UI07 invalidates delayed reads after project, operation and stage changes, including returning to the old key',async()=>{
    class Reader {
      result:string|null=null;onload:(()=>void)|null=null;onloadend:(()=>void)|null=null;onerror:(()=>void)|null=null;
      readAsText(){readers.push(this);}
    }
    const readers:Reader[]=[];
    vi.stubGlobal('FileReader',Reader);
    const view=render(workspace());await enter();
    fireEvent.change(editor(),{target:{value:'{"A":1}'}});
    selectFile('{"stale":1}');
    h.id='B';h.epoch++;view.rerender(workspace());
    await waitFor(()=>expect(h.snapshot).toHaveBeenLastCalledWith('B'));
    expect(editor()).toHaveValue('');
    h.id='A';h.epoch++;view.rerender(workspace());
    await waitFor(()=>expect(h.snapshot).toHaveBeenLastCalledWith('A'));
    selectFile('{"stale":2}');click('Review');click('Author');
    selectFile('{"stale":3}');click('Native');await enter();
    act(()=>{for(const reader of readers){reader.result='{"stale":true}';reader.onload?.();reader.onloadend?.();}});
    expect(editor()).toHaveValue('{"A":1}');
    expect(h.notice).not.toHaveBeenCalled();expect(h.importResult).not.toHaveBeenCalled();
  });
  it('UI07 also accepts dual FileReader completion events once and only once',async()=>{
    class Reader {
      result:string|null=null;onload:(()=>void)|null=null;onloadend:(()=>void)|null=null;onerror:(()=>void)|null=null;
      readAsText(){this.result='{"valid":true}';this.onload?.();this.onloadend?.();}
    }
    vi.stubGlobal('FileReader',Reader);
    render(workspace());await enter();selectFile('{"valid":true}');
    await waitFor(()=>expect(editor()).toHaveValue('{"valid":true}'));
    expect(h.notice).toHaveBeenCalledTimes(1);expect(h.importResult).not.toHaveBeenCalled();
  });
  it('UI08 sends exact identity response and revision only through identity IPC, with separate explicit approval',async()=>{
    journals.A.currentTask=entry('review',1);journals.A.revision=1;
    render(workspace());await enter();click('Review');
    const raw='{"schema":"mode-b-identity-external-result-v1","stage":"script_analysis","task_id":"review-1"}';
    fireEvent.change(editor(),{target:{value:raw}});
    click('Import frozen response');
    await screen.findByText(/Actor A/);
    expect(h.importResult).toHaveBeenCalledWith('A',raw,1);
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.stageImport).not.toHaveBeenCalled();expect(h.stageLifecycle).not.toHaveBeenCalled();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Approve reviewed analysis'})).toBeEnabled());
    click('Approve reviewed analysis');
    await screen.findByText('Approved analysis SHA approved-sha');
    expect(h.approve).toHaveBeenCalledWith('A',2);
  });
  it('UI09 keeps Script and Native author reservations on the original generic contract',async()=>{
    render(workspace());click('Build Task');await screen.findByText('Generic script prompt');
    fireEvent.change(genericEditor(),{target:{value:'{"script":1}'}});
    await enter();click('Native');click('Build Task');await screen.findByText('Generic native prompt');
    expect(h.freezeTask.mock.calls.map(c=>c.slice(0,2))).toEqual([['A','script'],['A','native']]);
    click('Script');await screen.findByText('Generic script prompt');
    expect(genericEditor()).toHaveValue('{"script":1}');
    expect(h.freeze).not.toHaveBeenCalled();expect(h.importResult).not.toHaveBeenCalled();
  });
  it('UI10 copies and exports the selected exact frozen identity prompt, not another operation or generic IPC',async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    const create=vi.fn().mockReturnValue('blob:identity-prompt'),revoke=vi.fn();
    class DownloadURL extends URL {static createObjectURL=create;static revokeObjectURL=revoke;}
    vi.stubGlobal('URL',DownloadURL);
    const downloads:string[]=[];
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){downloads.push(this.download);});
    render(workspace());await enter();await build('author',1);click('Review');await build('review',2);
    click('Copy prompt');await waitFor(()=>expect(writeText).toHaveBeenCalledWith('Frozen identity review 2'));
    click('Export .md');
    expect(downloads).toEqual(['script-analysis-review-review-2.md']);
    expect(create).toHaveBeenCalledTimes(1);
    const blob=create.mock.calls[0][0] as Blob;
    const contents=await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob);
    });
    expect(contents).toBe('Frozen identity review 2');
    expect(revoke).toHaveBeenCalledWith('blob:identity-prompt');expect(h.exportPrompt).not.toHaveBeenCalled();
  });
});
