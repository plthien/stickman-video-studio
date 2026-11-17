/* eslint-disable react-hooks/exhaustive-deps -- harness sessions are intentionally controlled by buttons */
import {useEffect,type ReactNode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {ApprovalPanel} from '../../src/renderer/features/editor/ApprovalPanel';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';
import {ProjectForm} from '../../src/renderer/features/project/ProjectForm';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import {VoiceWorkspace} from '../../src/renderer/features/voice/VoiceWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{value:undefined,configurable:true})});
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason?:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return{promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const project=(id:string,extra:Partial<NativeStudioState>={}):NativeStudioState=>({schema:'mode-b-studio-state-v1',project:{id,root:'C:/projects/'+id,title:id,style:'B1',updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},brief:{topic:id+' topic',language:'English',ratio:'9:16',targetDuration:60},external:{},nano:{endpoint:'http://127.0.0.1:3901'},projection:{shots:[],duration:0,tracks:{},demo:false},...extra});
const preview={path:'output/preview.mp4',sha256:'a'.repeat(64),reportPath:'output/preview-report.json'};
const A=project('A',{preview}),B=project('B');
function Harness({children,first=A}:{children:ReactNode;first?:NativeStudioState}){const{native,setNative}=useAppState();useEffect(()=>setNative(first),[]);return <><button onClick={()=>setNative(B)}>Switch B</button><button onClick={()=>setNative(first)}>Reopen A</button><output aria-label="active-project">{native?.project.id??'none'}</output>{children}</>}
const bridge=(value:Record<string,unknown>)=>Object.defineProperty(window,'studio',{value:{setNanoEndpoint:async()=>B,freezeTask:async(id:string,stage:string)=>({id:'test-frozen-'+id+'-'+stage,revision:1,prompt:`${id}-${stage}-prompt`}),mediaUrl:async()=>'',pendingMedia:async()=>null,projectState:async()=>A,...value},configurable:true});
const candidate={token:'pending-A',status:'STAGED',missing:[{key:'shot-1:image-1',kind:'image',path:'assets/a.png',shotId:'shot-1',layerId:'image-1'}],fulfillments:{}};
const caption={words:[{word:'A-WORD',start:0,end:1},{word:'tail',start:1,end:2}],original:[{start:0,end:2,text:'A-WORD tail'}],originalBoundaries:[2],draft:null,approved:null};

describe('REG-03 final project-session isolation',()=>{
  it('R2-SETUP-01 Browse folder selects a real parent folder from Electron',async()=>{bridge({browseProjectParent:async()=> 'C:/owner-projects'});render(<AppStateProvider><ProjectForm/></AppStateProvider>);fireEvent.click(screen.getByRole('button',{name:'Browse folder'}));await waitFor(()=>expect(screen.getByLabelText('Parent folder')).toHaveValue('C:/owner-projects'));});
  it('R2-SETUP-02 cancelling folder dialog preserves the previously typed parent',async()=>{bridge({browseProjectParent:async()=>null});render(<AppStateProvider><ProjectForm/></AppStateProvider>);fireEvent.change(screen.getByLabelText('Parent folder'),{target:{value:'C:/existing'}});fireEvent.click(screen.getByRole('button',{name:'Browse folder'}));await flush();expect(screen.getByLabelText('Parent folder')).toHaveValue('C:/existing');});

  it('REG03-F01 approve A then switch B ignores late success',async()=>{const gate=deferred<{state:NativeStudioState;stdout:string}>();bridge({nativeRun:()=>gate.promise});render(<AppStateProvider><Harness><ApprovalPanel onDetails={()=>{}}/></Harness></AppStateProvider>);fireEvent.change(await screen.findByLabelText('Approval note'),{target:{value:'reviewed A'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve reviewed preview'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));gate.resolve({state:{...A,approval:{note:'reviewed A',previewSha256:preview.sha256}},stdout:''});await flush();expect(screen.getByLabelText('active-project')).toHaveTextContent('B');expect(screen.queryByText('Native preview approval recorded against current evidence.')).not.toBeInTheDocument();expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument()});
  it('REG03-F02 approve A rejection after switch B is invisible',async()=>{const gate=deferred<{state:NativeStudioState;stdout:string}>();bridge({nativeRun:()=>gate.promise});render(<AppStateProvider><Harness><ApprovalPanel onDetails={()=>{}}/></Harness></AppStateProvider>);fireEvent.change(await screen.findByLabelText('Approval note'),{target:{value:'reviewed A'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve reviewed preview'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));gate.reject(new Error('A approval failed'));await flush();expect(screen.queryByText(/A approval failed/)).not.toBeInTheDocument();expect(screen.getByLabelText('active-project')).toHaveTextContent('B')});
  it('REG03-F03 import A then switch B before fulfill does not continue binding',async()=>{const imported=deferred<{path:string}>(),fulfill=vi.fn();bridge({pendingMedia:async()=>candidate,importMedia:()=>imported.promise,fulfillMedia:fulfill});render(<AppStateProvider><Harness><StoryboardWorkspace/></Harness></AppStateProvider>);await screen.findByRole('option',{name:/IMAGE.*shot-1/});fireEvent.change(screen.getByLabelText('Exact missing candidate image layer or original audio track'),{target:{value:'shot-1:image-1'}});fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owned'}});fireEvent.click(screen.getByRole('button',{name:'Import and bind target'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));imported.resolve({path:'media/a.png'});await flush();expect(fulfill).not.toHaveBeenCalled();expect(screen.getByLabelText('active-project')).toHaveTextContent('B')});
  it('REG03-F04 fulfill A already started cannot update B pending or native state',async()=>{const fulfilled=deferred<typeof candidate>(),projectState=vi.fn(async()=>A);bridge({pendingMedia:async()=>candidate,importMedia:async()=>({path:'media/a.png'}),fulfillMedia:()=>fulfilled.promise,projectState});render(<AppStateProvider><Harness><StoryboardWorkspace/></Harness></AppStateProvider>);await screen.findByRole('option',{name:/IMAGE.*shot-1/});fireEvent.change(screen.getByLabelText('Exact missing candidate image layer or original audio track'),{target:{value:'shot-1:image-1'}});fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owned'}});fireEvent.click(screen.getByRole('button',{name:'Import and bind target'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Switch B'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Switch B'}));fulfilled.resolve({...candidate,status:'FULFILLED',missing:[]});await flush();expect(projectState).not.toHaveBeenCalled();expect(screen.getByLabelText('active-project')).toHaveTextContent('B');expect(screen.queryByText(/FULFILLED/)).not.toBeInTheDocument()});
  it('REG03-F05 refresh pending A cannot display A pending on B',async()=>{const refresh=deferred<typeof candidate|null>();const pendingMedia=vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(refresh.promise).mockResolvedValue(null);bridge({pendingMedia});render(<AppStateProvider><Harness><StoryboardWorkspace/></Harness></AppStateProvider>);await waitFor(()=>expect(pendingMedia).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'Refresh missing references'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));refresh.resolve(candidate);await flush();expect(screen.queryByText(/Pending candidate: STAGED/)).not.toBeInTheDocument();expect(screen.getByLabelText('active-project')).toHaveTextContent('B')});
  it('AUTO-CORRECT-02: opening Correct prepopulates confirmed Review findings and editable targets',async()=>{
    const scope={editableIds:['first_attempt','escalation','rescue'],findingIds:['SR4-CAUSAL-01'],reviewTaskId:'review-4'};
    const withReview=project('A',{suggestedCorrectScope:{script:scope,native:{editableIds:[],findingIds:[],reviewTaskId:null}}});
    const freezeLifecycle=vi.fn(async(_id:string,_stage:string,_operation:string,_scope:unknown)=>({id:'correct-task',prompt:'current Correct task prompt',revision:1}));
    bridge({readFrozen:async()=>null,freezeLifecycle});
    render(<AppStateProvider><Harness first={withReview}><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Correct'}));
    await waitFor(()=>expect(screen.getByDisplayValue('first_attempt, escalation, rescue')).toBeInTheDocument());
    expect(screen.getByDisplayValue('SR4-CAUSAL-01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(freezeLifecycle).toHaveBeenCalledWith('A','script','correct',
      expect.objectContaining({editableIds:['first_attempt','escalation','rescue'],findingIds:['SR4-CAUSAL-01']}),false));
  });

  it('AUTO-CORRECT-03: confirmed Review immediately supplies Correct scope within the same project',async()=>{
    const initial=project('A',{lifecycle:{tasks:{},artifacts:{}}});
    const scope={editableIds:['first_attempt','escalation','rescue'],findingIds:['SR4-CAUSAL-01'],reviewTaskId:'review-task'};
    const confirmed=project('A',{lifecycle:{tasks:{},artifacts:{'review-task':{
      taskId:'review-task',stage:'script',operation:'review',artifactSha256:'review-result',
      status:'REVIEWED_WITH_FINDINGS',createdAt:'2026-11-17T04:00:00.000Z',
      value:{status:'REVIEWED_WITH_FINDINGS',findings:[{id:'SR4-CAUSAL-01',severity:'major',status:'open',
        target_ids:scope.editableIds,requirement:'Causality bridge'}]}
    }}},suggestedCorrectScope:{script:scope,native:{editableIds:[],findingIds:[],reviewTaskId:null}}});
    const freezeLifecycle=vi.fn(async()=>({id:'review-task',prompt:'Script Review task prompt'}));
    bridge({
      readFrozen:async()=>null,freezeLifecycle,
      stageLifecycle:async()=>({token:'ready',status:'STAGED',before:{},after:{},changes:1}),
      confirmLifecycle:async()=>confirmed
    });
    render(<AppStateProvider><Harness first={initial}><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Review'}));
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await screen.findByText('Script Review task prompt');
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"result":"review"}'}});
    fireEvent.click(screen.getByRole('button',{name:'Validate import'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm reviewed import'}));
    await waitFor(()=>expect(screen.getByText('Script Review imported.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    await waitFor(()=>expect(screen.getByDisplayValue('first_attempt, escalation, rescue')).toBeInTheDocument());
    expect(screen.getByDisplayValue('SR4-CAUSAL-01')).toBeInTheDocument();
    expect(screen.getByText(/Auto-filled from confirmed Review/)).toBeInTheDocument();
  });
  it('REG03-F06 validate Script response cannot become Native pending',async()=>{const staged=deferred<StudioStagedImport>();bridge({stageImport:()=>staged.promise,exportPrompt:async()=>null});render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);fireEvent.click(await screen.findByRole('button',{name:'Build Task'}));await screen.findByText('A-script-prompt');fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"script":"A"}'}});fireEvent.click(screen.getByRole('button',{name:'Validate import'}));fireEvent.click(screen.getByRole('button',{name:'Native'}));staged.resolve({token:'script-A',stage:'script',before:{},after:{},changes:1,status:'STAGED',missing:[],fulfillments:{}});await flush();expect(screen.queryByText(/Schema valid/)).not.toBeInTheDocument();expect(screen.queryByText(/BEFORE/)).not.toBeInTheDocument()});
  it('REG03-F07 caption refresh after draft cannot display A words on B',async()=>{const gate=deferred<typeof caption>(),captionReview=vi.fn().mockResolvedValueOnce(caption).mockReturnValueOnce(gate.promise);const aligned=project('A',{preview,alignment:{path:'words.json',captionsPath:'captions.json',audioSha256:'a',wordsSha256:'b',cuesSha256:'c'}});bridge({captionReview,captionDraft:async()=>({}),projectState:async()=>aligned});render(<AppStateProvider><Harness first={aligned}><VoiceWorkspace/></Harness></AppStateProvider>);await screen.findByText(/Actual aligned words:.*A-WORD/);fireEvent.click(screen.getByRole('button',{name:'Save reviewed grouping draft'}));await waitFor(()=>expect(captionReview).toHaveBeenCalledTimes(2));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));gate.resolve(caption);await flush();expect(screen.queryByText(/A-WORD/)).not.toBeInTheDocument();expect(screen.getByLabelText('active-project')).toHaveTextContent('B')});
  it('REG03-F08 Nano Discover A response cannot replace B profile list',async()=>{const gate=deferred<{ready:boolean;profiles:Array<Record<string,unknown>>}>();bridge({nanoDiscover:()=>gate.promise});render(<AppStateProvider><Harness><VoiceWorkspace/></Harness></AppStateProvider>);fireEvent.click(await screen.findByRole('button',{name:'Discover producer'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));gate.resolve({ready:true,profiles:[{id:'A-voice',name:'A Voice',version:1}]});await flush();expect(screen.queryByRole('option',{name:/A Voice/})).not.toBeInTheDocument();expect(screen.queryByText(/confirmed profile/)).not.toBeInTheDocument()});
  it('REG03-F09 Save Brief A response cannot replace B',async()=>{const gate=deferred<NativeStudioState>();bridge({saveBrief:()=>gate.promise});render(<AppStateProvider><Harness><ProjectForm/></Harness></AppStateProvider>);fireEvent.click(await screen.findByRole('button',{name:'Save project setup'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));gate.resolve({...A,brief:{...A.brief,topic:'saved A'}});await flush();expect(screen.getByLabelText('active-project')).toHaveTextContent('B');expect(screen.queryByText(/Project setup saved/)).not.toBeInTheDocument()});
  it('REG03-F10 latest Open Project request wins inverse completion order',async()=>{const openA=deferred<NativeStudioState>(),openB=deferred<NativeStudioState>();const dialog=vi.fn().mockResolvedValueOnce('A').mockResolvedValueOnce('B');bridge({openProjectDialog:dialog,openProject:vi.fn((path:string)=>path==='A'?openA.promise:openB.promise)});render(<AppStateProvider><ProjectForm/></AppStateProvider>);const open=screen.getByRole('button',{name:'Open project…'});fireEvent.click(open);fireEvent.click(open);await waitFor(()=>expect(dialog).toHaveBeenCalledTimes(2));openB.resolve(B);await waitFor(()=>expect(screen.getByText('B')).toBeInTheDocument());openA.resolve(A);await flush();expect(screen.queryByText('A')).not.toBeInTheDocument();expect(screen.getByDisplayValue('B')).toBeInTheDocument()});
  it('REG03-F10B newer Create C invalidates an older in-flight Open B',async()=>{const openB=deferred<NativeStudioState>(),openProject=vi.fn(()=>openB.promise),C=project('C');bridge({openProjectDialog:async()=> 'B',openProject,createProject:async()=>C});render(<AppStateProvider><ProjectForm/></AppStateProvider>);fireEvent.change(screen.getByLabelText('Project title'),{target:{value:'C'}});fireEvent.change(screen.getByLabelText('Topic / core idea'),{target:{value:'C topic'}});fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'60'}});fireEvent.change(screen.getByLabelText('Parent folder'),{target:{value:'C:/projects'}});fireEvent.change(screen.getByLabelText('Project folder'),{target:{value:'C'}});fireEvent.click(screen.getByRole('button',{name:'Open project…'}));await waitFor(()=>expect(openProject).toHaveBeenCalledWith('B'));fireEvent.click(screen.getByRole('button',{name:'Create native project'}));await waitFor(()=>expect(screen.getAllByText('C:/projects/C').length).toBeGreaterThan(0));openB.resolve(B);await flush();expect(screen.getByLabelText('Project title')).toHaveValue('C');expect(screen.getAllByText('C:/projects/C').length).toBeGreaterThan(0);expect(screen.queryByText('C:/projects/B')).not.toBeInTheDocument()});
  it('REG03-F11 A1 response cannot enter reopened A2 session',async()=>{const gate=deferred<{state:NativeStudioState;stdout:string}>();bridge({nativeRun:()=>gate.promise});render(<AppStateProvider><Harness><ApprovalPanel onDetails={()=>{}}/></Harness></AppStateProvider>);fireEvent.change(await screen.findByLabelText('Approval note'),{target:{value:'A1'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve reviewed preview'}));fireEvent.click(screen.getByRole('button',{name:'Switch B'}));fireEvent.click(screen.getByRole('button',{name:'Reopen A'}));gate.resolve({state:{...A,approval:{note:'A1',previewSha256:preview.sha256}},stdout:''});await flush();expect(screen.getByLabelText('active-project')).toHaveTextContent('A');expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();expect(screen.queryByText(/approval recorded/)).not.toBeInTheDocument()});
  it('REG03-F12 current-session approval updates state and success notice',async()=>{const approved={...A,approval:{note:'same session',previewSha256:preview.sha256}};bridge({nativeRun:async()=>({state:approved,stdout:''})});render(<AppStateProvider><Harness><ApprovalPanel onDetails={()=>{}}/></Harness></AppStateProvider>);fireEvent.change(await screen.findByLabelText('Approval note'),{target:{value:'same session'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve reviewed preview'}));expect(await screen.findByText('VERIFIED')).toBeInTheDocument();expect(screen.getByText('Native preview approval recorded against current evidence.')).toBeInTheDocument();expect(screen.getByLabelText('active-project')).toHaveTextContent('A')});
});


describe('REG-TAB navigation persistence, read-only history and async isolation',()=>{
  const record=(id:string,operation:string,status:'FROZEN'|'IMPORTED'|'STALE'='IMPORTED',mediaKind?:string)=>({
    id,revision:1,stage:'script',operation,status,mediaKind,prompt:'Saved prompt '+id,
    confirmedJson:status==='IMPORTED'?'{"confirmed":"'+id+'"}':null,
    findings:operation==='review'||operation==='recheck'?[{
      id:'F-'+id,status:operation==='recheck'?'resolved':'open',
      severity:'major',target_ids:['opening'],requirement:'Exact causal evidence'
    }]:[],errors:[],integrity:'OK'
  });
  it('REG-TAB-01/05 preserves Review draft through every operation and isolates both stages/projects',async()=>{
    bridge({readFrozen:async()=>null,readHistory:async()=>[]});
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Review'}));
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"review":"A"}'}});
    for(const operation of ['Correct','Recheck','Author']){
      fireEvent.click(screen.getByRole('button',{name:operation}));
      expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    }
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"review":"A"}');
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Script'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"review":"A"}');
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Reopen A'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"review":"A"}');
  });
  it('REG-TAB-02/03/04/07 displays confirmed and stale history without issuing any freeze, including after remount',async()=>{
    const readHistory=vi.fn(async(id:string,stage:string,op:string)=>id==='A'&&stage==='script'?
      [record('A-'+op,op,op==='correct'?'STALE':'IMPORTED')]:[]);
    const freezeTask=vi.fn(),freezeLifecycle=vi.fn();
    bridge({readFrozen:async()=>null,readHistory,freezeTask,freezeLifecycle});
    const view=render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    for(const operation of ['Author','Review','Correct','Recheck']){
      if(operation!=='Author')fireEvent.click(screen.getByRole('button',{name:operation}));
      const op=operation.toLowerCase();
      await waitFor(()=>expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Saved prompt A-'+op));
      expect(screen.getByTestId('external-history-status')).toHaveTextContent(op==='correct'?'STALE':'IMPORTED');
      expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
      if(op!=='correct')expect(screen.getByLabelText('Confirmed JSON history')).toHaveTextContent(op);
      if(op==='recheck')expect(screen.getByText(/F-A-recheck/)).toBeInTheDocument();
    }
    expect(freezeTask).not.toHaveBeenCalled();
    expect(freezeLifecycle).not.toHaveBeenCalled();
    view.unmount();
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Recheck'}));
    await waitFor(()=>expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Saved prompt A-recheck'));
    expect(freezeTask).not.toHaveBeenCalled();
    expect(freezeLifecycle).not.toHaveBeenCalled();
  });
  it('REG-TAB-06 does not publish an obsolete history response after switching tabs or project',async()=>{
    const gate=deferred<ReturnType<typeof record>[]>();
    const readHistory=vi.fn((id:string,_stage:string,op:string)=>id==='A'&&op==='review'?
      gate.promise:Promise.resolve([]));
    bridge({readFrozen:async()=>null,readHistory});
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Review'}));
    await waitFor(()=>expect(readHistory).toHaveBeenCalledWith('A','script','review',undefined));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    gate.resolve([record('A-review','review')]);
    await flush();
    expect(screen.getByLabelText('active-project')).toHaveTextContent('B');
    expect(screen.queryByText('Saved prompt A-review')).not.toBeInTheDocument();
  });
  it('REG-TAB-06 validates pending Review only in its captured tab; late result cannot appear in Correct',async()=>{
    const gate=deferred<StudioStagedImport>();
    bridge({readFrozen:async()=>null,readHistory:async()=>[],
      freezeLifecycle:async()=>({id:'review-frozen',revision:1,prompt:'Review frozen prompt'}),
      stageLifecycle:()=>gate.promise});
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Review'}));
    fireEvent.click(screen.getByRole('button',{name:'Build Task'}));
    await waitFor(()=>expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('Review frozen prompt'));
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"review":"pending"}'}});
    fireEvent.click(screen.getByRole('button',{name:'Validate import'}));
    fireEvent.click(screen.getByRole('button',{name:'Correct'}));
    gate.resolve({token:'old-review',stage:'script',status:'STAGED',before:{},after:{},changes:1,missing:[]});
    await flush();
    expect(screen.queryByText(/Schema valid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BEFORE/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"review":"pending"}');
    expect(screen.queryByText(/Schema valid/)).not.toBeInTheDocument();
  });
  it('REG-TAB-08 never reconstructs corrupt/missing history from unrelated state',async()=>{
    bridge({readFrozen:async()=>null,
      readHistory:async()=>[{...record('damaged','review'),prompt:null,confirmedJson:null,
        errors:['PROMPT_HASH_MISMATCH','RESPONSE_MISSING'],integrity:'ERROR'}]});
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Review'}));
    await waitFor(()=>expect(screen.getByText(/PROMPT_HASH_MISMATCH/)).toBeInTheDocument());
    expect(screen.getByTestId('external-task-prompt')).toHaveTextContent('');
    expect(screen.queryByLabelText('Confirmed JSON history')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
  });
  it('REG-F04-01/REG-TAB-09 exposes only Author/Review/Correct/Recheck with isolated Script/Native drafts',async()=>{
    bridge({readFrozen:async()=>null,readHistory:async()=>[]});
    render(<AppStateProvider><Harness><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></Harness></AppStateProvider>);
    for(const operation of ['Author','Review','Correct','Recheck'])
      expect(screen.getByRole('button',{name:operation})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Media review'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Export actual media pack'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Review media scope')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"script":"review"}'}});
    fireEvent.click(screen.getByRole('button',{name:'Native'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Import JSON'),{target:{value:'{"native":"review"}'}});
    fireEvent.click(screen.getByRole('button',{name:'Script'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"script":"review"}');
    fireEvent.click(screen.getByRole('button',{name:'Recheck'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    expect(screen.getByLabelText('Import JSON')).toHaveValue('{"script":"review"}');
  });
});
