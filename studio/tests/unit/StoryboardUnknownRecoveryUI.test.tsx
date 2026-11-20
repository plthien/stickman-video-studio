import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const target={key:'image:0:layer-1',kind:'image',path:'assets/images/first.png',shotId:'shot-1',layerId:'layer-1'};
const second={key:'image:1:layer-2',kind:'image',path:'assets/images/second.png',shotId:'shot-2',layerId:'layer-2'};
const state=(id:string):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,root:'C:/projects/'+id,title:id,style:'B2',updatedAt:'now',
    projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'One source-grounded story',language:'English',ratio:'9:16'},
  external:{},
  nativeDraft:{context:'DRAFT',token:'token-'+id,authorTaskId:'author-'+id,revision:2,
    artifactSha256:'a'.repeat(64),reviewStatus:'REVIEWED_WITH_FINDINGS',
    unresolvedFindings:1,readyForMedia:false},
  projection:{shots:[],duration:0,demo:false}
});
const pending=(id:string)=>({token:'token-'+id,status:'WAITING_FOR_MEDIA',
  missing:[target,second],fulfillments:{},after:{shots:[
    {id:'shot-1',start:0,end:2,layers:[{id:'layer-1',type:'image',path:target.path}]},
    {id:'shot-2',start:2,end:4,layers:[{id:'layer-2',type:'image',path:second.path}]}
  ],captions:[]},assetNeeds:[],shotLedger:[]});
const prepared=(id:string,blocked=false)=>({status:'PRE_MEDIA_PROJECTION',style:'B2',revision:2,
  token:'token-'+id,shotCount:2,imageOccurrences:2,uniquePaths:2,
  jobs:[target,second].map((item,index)=>({
    assetKey:item.key,targetKeys:[item.key],expectedPaths:[item.path],
    targetKey:item.key,shotId:item.shotId,layerId:item.layerId,path:item.path,
    assetKind:'other',state:blocked?'BLOCKED':'READY',reason:blocked?'Style authority changed':'',
    prompt:'APPROVED MODE B STYLE B2\n\nVerified painting for '+item.layerId,
    promptSha256:'e'.repeat(64),sourceDescription:'Verified painting for '+item.layerId,
    sourceLedger:'',sourceRows:[item],
    styleProfileRef:{id:'B2',path:'references/b2-colorful-handdrawn.md',sha256:'c'.repeat(64)},
    references:[],styleAnchors:[],draftIdentity:{projectId:id,authorTaskId:'author-'+id,
      token:'token-'+id,revision:2,creativeFingerprint:(index===0?'a':'b').repeat(64)},
    occurrencesAtPath:1,ownerEdited:false
  }))
});
const unknown={
  id:'11111111-1111-4111-8111-111111111111',projectId:'A',token:'token-A',
  targetKey:target.key,shotId:target.shotId,layerId:target.layerId,targetPath:target.path,
  status:'UNKNOWN',model:'nano_banana_2',aspectRatio:'9:16',
  providerTaskId:'ab12cd34',reason:'Original provider task timed out; billing uncertain'
};
function Harness(){
  const {setNative}=useAppState();
  // The harness, unlike application logic, seeds the first project once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(state('A'));},[]);
  return <><button onClick={()=>setNative(state('B'))}>Switch project B</button>
    <button onClick={()=>setNative(state('A'))}>Reopen project A</button>
    <StoryboardWorkspace/></>;
}
function install(options:{blocked?:boolean;pollResult?:'UNKNOWN'|'RUNNING'|'FAILED';
  journalAdvancesDuringPoll?:boolean;pollRejected?:boolean;cancellation?:boolean}={}){
  let persisted=[unknown];
  const generate=vi.fn(async()=>options.cancellation?null:{id:'22222222-2222-4222-8222-222222222222'});
  const poll=vi.fn(async()=>{
    if(options.pollRejected)throw new Error('Injected G-Labs read-only GET timeout');
    if(options.journalAdvancesDuringPoll){
      // Simulate an older poll returning UNKNOWN while persisted job history
      // has already advanced to RUNNING in a separate read-only reconciliation.
      persisted=[{...unknown,status:'RUNNING'}];
      return unknown;
    }
    if(options.pollResult&&options.pollResult!=='UNKNOWN')
      persisted=[{...unknown,status:options.pollResult}];
    return persisted[0];
  });
  const readJobs=vi.fn(async(id:string)=>id==='A'?[...persisted]:[]);
  const studio={
    pendingMedia:async(id:string)=>pending(id),prepareImages:async(id:string)=>prepared(id,options.blocked),
    glabsJobs:readJobs,glabsPoll:poll,glabsGenerate:generate,
    glabsSettings:async()=>({config:{model:'nano_banana_2',aspectRatio:'9:16'},
      credential:{configured:true,secureStorageAvailable:true}}),
    projectState:async(id:string)=>state(id),mediaUrl:async()=>''
  };
  Object.defineProperty(window,'studio',{configurable:true,value:studio});
  return{generate,poll,readJobs};
}
async function afterCheck(){
  const check=await screen.findByRole('button',{name:'Check Existing Attempt (read-only)'});
  fireEvent.click(check);
  const checkbox=await screen.findByRole('checkbox',{
    name:'Acknowledge possible duplicate billing for this exact G-Labs target'});
  return checkbox;
}
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{configurable:true,value:undefined})});

describe('F07 — UNKNOWN recovery in the primary Storyboard without automatic paid retries',()=>{
  it('F07-UI01 exposes persisted UNKNOWN, exact target, provider task and original diagnostic; normal generation stays blocked',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    expect(await screen.findByTestId('unknown-attempt-evidence')).toHaveTextContent(
      'Original provider task timed out; billing uncertain');
    expect(screen.getByTestId('unknown-attempt-evidence')).toHaveTextContent('ab12cd34');
    expect(screen.getByText(/Exact Native target:/).closest('div')).toHaveTextContent('shot-1/layer-1');
    expect(screen.getByRole('button',{name:'Regenerate Image'})).toBeDisabled();
    expect(screen.queryByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI02 read-only existing-attempt check does not submit a second paid image',async()=>{
    const {poll,generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await afterCheck();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith('A',unknown.id);
    expect(generate).not.toHaveBeenCalled();
    expect(screen.getByTestId('unknown-recovery-confirmation')).toHaveTextContent('duplicate billing');
  });
  it('F12-UNKNOWN-01 rejected provider GET is CHECK_FAILED_UNVERIFIED, not CHECKED_STILL_UNKNOWN',async()=>{
    const {poll,generate}=install({pollRejected:true});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Check Existing Attempt (read-only)'}));
    await waitFor(()=>expect(screen.getByTestId('unknown-check-outcome'))
      .toHaveTextContent('CHECK_FAILED_UNVERIFIED'));
    expect(screen.getByTestId('unknown-attempt-evidence')).toHaveTextContent('UNKNOWN');
    expect(screen.queryByTestId('unknown-recovery-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox',{
      name:'Acknowledge possible duplicate billing for this exact G-Labs target'
    })).not.toBeInTheDocument();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI03 UNKNOWN evidence survives a fresh UI mount, but no old recovery consent does',async()=>{
    const {generate}=install();
    const view=render(<AppStateProvider><Harness/></AppStateProvider>);
    const checkbox=await afterCheck();
    fireEvent.click(checkbox);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).toBeEnabled());
    view.unmount();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    expect(await screen.findByTestId('unknown-attempt-evidence')).toHaveTextContent('ab12cd34');
    expect(screen.queryByRole('checkbox',{name:/Acknowledge possible duplicate billing/})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI04 no deliberate checkbox acknowledgement means no recovery submission',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await afterCheck();
    const authorize=screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'});
    expect(authorize).toBeDisabled();
    fireEvent.click(authorize);
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI05 explicit owner acknowledgement authorizes only one new request with original prepared identity',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const checkbox=await afterCheck();
    fireEvent.click(checkbox);
    const authorize=screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'});
    await waitFor(()=>expect(authorize).toBeEnabled());
    fireEvent.click(authorize);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:target.key,authorized:true,acknowledgeUnknown:true,regenerate:true,
      preparedFingerprint:'a'.repeat(64),model:'nano_banana_2',aspectRatio:'9:16',
      prompt:'APPROVED MODE B STYLE B2\n\nVerified painting for layer-1',references:[]
    }));
    expect(screen.queryByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'}))
      .not.toBeInTheDocument();
  });
  it('F07-UI06 Electron paid-dialog cancellation returns null without automatically repeating the request',async()=>{
    const {generate}=install({cancellation:true});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await afterCheck());
    fireEvent.click(screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'}));
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('checkbox',{name:/Acknowledge possible duplicate billing/})).not.toBeInTheDocument();
    expect(screen.getByTestId('unknown-attempt-evidence')).toHaveTextContent('Original provider task timed out');
    // The production IPC still owns the real dialog and refuses POST on cancel.
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('F07-UI07 changing selected target or project resets explicit recovery consent',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await afterCheck());
    expect(screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:/shot-2/}));
    expect(screen.queryByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/shot-1/}));
    expect(await screen.findByTestId('unknown-attempt-evidence')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox',{name:/Acknowledge possible duplicate billing/})).not.toBeInTheDocument();
    fireEvent.click(await afterCheck());
    fireEvent.click(screen.getByRole('button',{name:'Switch project B'}));
    await screen.findByText(/Current Project Style:/);
    expect(screen.queryByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Reopen project A'}));
    expect(await screen.findByTestId('unknown-attempt-evidence')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox',{name:/Acknowledge possible duplicate billing/})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI08 stale prepared Native/style authority blocks recovery even with acknowledgement',async()=>{
    const {generate}=install({blocked:true});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await afterCheck());
    expect(screen.getByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI09 provider RUNNING result removes UNKNOWN recovery and never sends a paid request',async()=>{
    const {generate,poll}=install({pollResult:'RUNNING'});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Check Existing Attempt (read-only)' }));
    await waitFor(()=>expect(poll).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.queryByTestId('unknown-attempt-evidence')).not.toBeInTheDocument());
    expect(screen.queryByRole('button',{name:'Authorize ONE New Image Attempt (paid confirmation)'})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI11 an old UNKNOWN poll reply cannot authorize a new paid attempt when persisted history is RUNNING',async()=>{
    const {generate,poll}=install({journalAdvancesDuringPoll:true});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const check=await screen.findByRole('button',{name:'Check Existing Attempt (read-only)'});
    fireEvent.click(check);
    await waitFor(()=>expect(poll).toHaveBeenCalledWith('A',unknown.id));
    await waitFor(()=>expect(screen.getByTestId('storyboard-selected-image')).toHaveTextContent('Generating image…'));
    await waitFor(()=>expect(screen.queryByTestId('unknown-recovery-confirmation')).not.toBeInTheDocument());
    expect(screen.queryByRole('checkbox',{
      name:'Acknowledge possible duplicate billing for this exact G-Labs target'
    })).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F07-UI10 a late UNKNOWN polling result after target switch/back cannot grant recovery',async()=>{
    let resolve!: (value:typeof unknown)=>void;
    const gate=new Promise<typeof unknown>(done=>{resolve=done;});
    const {generate,poll}=install();
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsPoll:vi.fn(()=>gate)
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Check Existing Attempt (read-only)'}));
    fireEvent.click(screen.getByRole('button',{name:/shot-2/}));
    fireEvent.click(screen.getByRole('button',{name:/shot-1/}));
    resolve(unknown);
    await waitFor(()=>expect(screen.getByTestId('unknown-attempt-evidence')).toBeInTheDocument());
    expect(screen.queryByRole('checkbox',{name:/Acknowledge possible duplicate billing/})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });
});
