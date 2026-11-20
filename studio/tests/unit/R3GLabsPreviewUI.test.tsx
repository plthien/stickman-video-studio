import {useEffect,useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const project=(id:string):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,root:'C:/projects/'+id,title:id,style:'B1',updatedAt:'now',
    projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'Real pending still',language:'English',ratio:'9:16'},
  external:{},nano:{endpoint:'http://127.0.0.1:3901'},
  projection:{shots:[],duration:0,tracks:{},demo:false}
});
const pending={token:'pending-A',status:'WAITING_FOR_MEDIA',
  missing:[{key:'shot-1:image-1',kind:'image',path:'assets/images/pending.png',
    shotId:'shot-1',layerId:'image-1'}],
  fulfillments:{},after:{shots:[{id:'shot-1',title:'Actual native shot',start:0,end:3,
    layers:[{id:'image-1',type:'image',path:'assets/images/pending.png'}]}],captions:[]}};
const first={id:'11111111-1111-4111-8111-111111111111',projectId:'A',token:'pending-A',
  targetKey:'shot-1:image-1',shotId:'shot-1',layerId:'image-1',targetPath:'assets/images/pending.png',
  status:'VALIDATED',model:'nano_banana_2',aspectRatio:'9:16',prompt:'Frozen image prompt',
  staged:{path:'assets/images/glabs-first.png',sha256:'a'.repeat(64),width:90,height:160}};
const second={...first,id:'22222222-2222-4222-8222-222222222222',
  staged:{...first.staged,path:'assets/images/glabs-second.png',sha256:'b'.repeat(64)}};
function Harness(){
  const {setNative}=useAppState(),[revision,setRevision]=useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(project('A'));},[]);
  return <><button onClick={()=>setNative(project('B'))}>Switch B</button>
    <button onClick={()=>setRevision(value=>value+1)}>Reopen Image View</button>
    <StoryboardWorkspace key={revision}/></>;
}
function install(jobs:Array<typeof first>=[first]){
  let latest=[...jobs];
  const approve=vi.fn(async()=>({status:'APPROVED'}));
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia:async(id:string)=>id==='A'?pending:null,
    glabsJobs:async(id:string)=>id==='A'?[...latest]:[],
    glabsSettings:async()=>({config:{endpoint:'http://127.0.0.1:8765',contract:'legacy',
      model:'nano_banana_2',aspectRatio:'9:16'},credential:{configured:true,
        secureStorageAvailable:true}}),
    mediaUrl:async(_id:string,relative:string)=>'studio-media://A/'+relative,
    glabsApprove:approve,projectState:async(id:string)=>project(id)
  }});
  return{approve,setJobs:(next:Array<typeof first>)=>{latest=[...next]}};
}
async function currentCard(){
  await screen.findByTestId('shot-image-gallery');
  return (await screen.findAllByTestId('shot-image-card'))[0];
}
const decoded=(image:HTMLElement)=>{
  Object.defineProperty(image,'complete',{configurable:true,value:true});
  Object.defineProperty(image,'naturalWidth',{configurable:true,value:90});
  Object.defineProperty(image,'naturalHeight',{configurable:true,value:160});
  fireEvent.load(image);
};
afterEach(()=>{
  cleanup();vi.restoreAllMocks();
  Object.defineProperty(window,'studio',{configurable:true,value:undefined});
});
describe('R3 F04 preview-verified approval on the sole Shot Image Gallery',()=>{
  it('F04-01/02/06 keeps approval disabled before load and after image error; no binding',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const card=await currentCard(),image=await within(card).findByRole('img');
    const button=within(card).getByRole('button',{name:'Approve Image'});
    expect(button).toBeDisabled();
    fireEvent.error(image);
    await waitFor(()=>expect(within(card).getByText(/preview failed to load or decode/))
      .toBeInTheDocument());
    expect(button).toBeDisabled();
    expect(within(card).getByRole('button',{name:'Retry Preview'})).toBeEnabled();
    fireEvent.click(button);
    expect(approve).not.toHaveBeenCalled();
  });
  it('F04-03 one explicit approval requires the exact loaded image; no generated rights input',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const card=await currentCard(),image=await within(card).findByRole('img');
    const button=within(card).getByRole('button',{name:'Approve Image'});
    expect(button).toBeDisabled();
    expect(screen.queryByLabelText('Owner-confirmed rights/source')).not.toBeInTheDocument();
    expect(screen.queryByText(/Layer Inspector/)).not.toBeInTheDocument();
    decoded(image);
    await waitFor(()=>expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith('A',first.id);
  });
  it('F04-04 loading an older candidate never approves a newer SHA without independently loaded preview',async()=>{
    const {approve,setJobs}=install([first,second]);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const card=await currentCard(),oldImage=await within(card).findByRole('img');
    expect(oldImage).toHaveAttribute('src','studio-media://A/assets/images/glabs-first.png');
    decoded(oldImage);
    await waitFor(()=>expect(within(card).getByRole('button',{name:'Approve Image'}))
      .toBeEnabled());
    setJobs([second,first]);
    fireEvent.click(screen.getByRole('button',{name:'Reopen Image View'}));
    const fresh=await currentCard();
    const freshImage=await within(fresh).findByRole('img');
    expect(freshImage).toHaveAttribute('src','studio-media://A/assets/images/glabs-second.png');
    const approveNew=within(fresh).getByRole('button',{name:'Approve Image'});
    expect(approveNew).toBeDisabled();
    fireEvent.click(approveNew);
    expect(approve).not.toHaveBeenCalled();
    decoded(freshImage);
    await waitFor(()=>expect(approveNew).toBeEnabled());
    fireEvent.click(approveNew);
    await waitFor(()=>expect(approve).toHaveBeenCalledWith('A',second.id));
    expect(approve).not.toHaveBeenCalledWith('A',first.id);
  });
  it('F04-05 project change invalidates old decoded preview and candidate authorization',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const card=await currentCard();
    decoded(await within(card).findByRole('img'));
    await waitFor(()=>expect(within(card).getByRole('button',{name:'Approve Image'}))
      .toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Approve Image'}))
      .not.toBeInTheDocument());
    expect(approve).not.toHaveBeenCalled();
  });
});
