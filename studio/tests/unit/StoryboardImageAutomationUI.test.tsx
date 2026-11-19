import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const native=(id:string):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,root:'C:/projects/'+id,title:id,style:'B2',updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'Test',language:'English',ratio:'9:16'},external:{},
  nativeDraft:{context:'DRAFT',token:'token-'+id,authorTaskId:'author-'+id,revision:2,
    artifactSha256:'b'.repeat(64),reviewStatus:'REVIEWED_WITH_FINDINGS',unresolvedFindings:2,readyForMedia:false},
  projection:{shots:[],duration:0,demo:false}
});
const targets=[
  {key:'image:0:layer-a',kind:'image',path:'assets/images/a.png',shotId:'sh-a',layerId:'layer-a'},
  {key:'image:1:layer-b',kind:'image',path:'assets/images/b.png',shotId:'sh-b',layerId:'layer-b'}
];
const pending=(id:string)=>({token:'token-'+id,status:'WAITING_FOR_MEDIA',missing:targets,fulfillments:{},
  after:{shots:[
    {id:'sh-a',start:0,end:2,layers:[{id:'layer-a',type:'image',path:'assets/images/a.png'}]},
    {id:'sh-b',start:2,end:4,layers:[{id:'layer-b',type:'image',path:'assets/images/b.png'}]}
  ],captions:[]},shotLedger:[],assetNeeds:[]});
const jobs=(id:string)=>targets.map((target,i)=>({
  assetKey:target.key,targetKeys:[target.key],expectedPaths:[target.path],
  targetKey:target.key,shotId:target.shotId,layerId:target.layerId,path:target.path,
  assetKind:'other',state:'READY',reason:'',prompt:'APPROVED B2 STYLE\n\n'+(i===0?'A painted red kite':'A blue backpack'),
  promptSha256:String(i).repeat(64),sourceDescription:i===0?'A painted red kite':'A blue backpack',
  sourceLedger:'',sourceRows:[target],styleProfileRef:{id:'B2',path:'references/b2-colorful-handdrawn.md',sha256:'a'.repeat(64)},
  references:[],styleAnchors:[],draftIdentity:{projectId:id,authorTaskId:'author-'+id,token:'token-'+id,revision:2,
    creativeFingerprint:(i===0?'a':'b').repeat(64)},occurrencesAtPath:1,ownerEdited:false
}));
function Harness(){
  const {setNative}=useAppState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(native('A'));},[]);
  return <><button onClick={()=>setNative(native('B'))}>Switch project B</button><StoryboardWorkspace/></>;
}
const install=()=>{
  const generate=vi.fn(async()=>({status:'RUNNING'}));
  const prepare=vi.fn(async(id:string)=>({status:'PRE_MEDIA_PROJECTION',style:'B2',revision:2,
    token:'token-'+id,shotCount:2,imageOccurrences:2,uniquePaths:2,jobs:jobs(id)}));
  const save=vi.fn(async(id:string)=>prepare(id));
  const glabsJobs=vi.fn(async()=>[]);
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia:async(id:string)=>pending(id),prepareImages:prepare,saveImagePrompt:save,
    glabsJobs,glabsSettings:async()=>({config:{endpoint:'http://127.0.0.1:8765',contract:'legacy',model:'nano_banana_2',aspectRatio:'9:16'},
      credential:{configured:true,secureStorageAvailable:true}}),
    glabsGenerate:generate,projectState:async(id:string)=>native(id),mediaUrl:async()=>''
  }});
  return{generate,prepare,save};
};
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{configurable:true,value:undefined});});
describe('Storyboard P1: real renderer queue and paid-action isolation',()=>{
  it('UI-01 opening and Prepare Images are read-only; style B2 is inherited and review findings do not block',async()=>{
    const {generate,prepare}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await screen.findByText(/Current Project Style:/);
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 2'));
    expect(screen.getByText(/Creative review:/)).toHaveTextContent('REVIEWED_WITH_FINDINGS');
    expect(screen.getByText(/Current Project Style:/)).toHaveTextContent('B2');
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Prepare Images (read-only; no paid requests)'}));
    await waitFor(()=>expect(prepare).toHaveBeenCalledTimes(2));
    expect(generate).not.toHaveBeenCalled();
  });
  it('UI-02 switching Shot cannot inherit previous asset prompt, targets or edit',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 2'));
    fireEvent.click(screen.getByText(/Advanced · target-specific edits/));
    const input=screen.getByLabelText('Edit image prompt for current target only');
    fireEvent.change(input,{target:{value:'Owner custom red kite pose and no caption'}});
    expect(screen.getByText(/Save this target's edit before paid generation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/sh-b/}));
    expect(screen.getByText(/A blue backpack/)).toBeInTheDocument();
    const selected=screen.getByText(/Source image description:/).closest('div');
    expect(selected).toHaveTextContent('A blue backpack');
    expect(generate).not.toHaveBeenCalled();
  });
  it('UI-03 only explicit Generate Selected calls existing one-target paid confirmation contract',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const button=await screen.findByRole('button',{name:'Generate Selected (1 paid request)'});
    await waitFor(()=>expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:'image:0:layer-a',model:'nano_banana_2',aspectRatio:'9:16',authorized:true,
      prompt:expect.stringContaining('A painted red kite'),references:[]
    }));
  });
  it('UI-04 a project session change discards earlier prompt and queue results',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 2'));
    fireEvent.click(screen.getByRole('button',{name:'Switch project B'}));
    await waitFor(()=>expect(screen.getByText(/Current Project Style:/)).toHaveTextContent('B2'));
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 2'));
    fireEvent.click(screen.getByRole('button',{name:'Generate Selected (1 paid request)'}));
    await waitFor(()=>expect(generate).toHaveBeenCalled());
    expect(generate).toHaveBeenLastCalledWith('B',expect.objectContaining({targetKey:'image:0:layer-a'}));
  });
  it('UI-05 original manual Import & Bind remains available only on demand',async()=>{
    install();render(<AppStateProvider><Harness/></AppStateProvider>);
    await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('READY 2'));
    expect(screen.queryByRole('button',{name:'Import and bind target'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Advanced · manual Import & Bind/));
    expect(await screen.findByRole('button',{name:'Import and bind target'})).toBeInTheDocument();
  });
});
