import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const project=(id:string):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,root:'C:/projects/'+id,title:id,style:'B1',updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'Real pending still',language:'English',ratio:'9:16'},
  external:{},nano:{endpoint:'http://127.0.0.1:3901'},
  projection:{shots:[],duration:0,tracks:{},demo:false}
});
const pending={token:'pending-A',status:'WAITING_FOR_MEDIA',
  missing:[{key:'shot-1:image-1',kind:'image',path:'assets/images/pending.png',shotId:'shot-1',layerId:'image-1'}],
  fulfillments:{},after:{shots:[{id:'shot-1',title:'Actual native shot',start:0,end:3,
    layers:[{id:'image-1',type:'image',path:'assets/images/pending.png'}]}],captions:[]}};
const first={id:'11111111-1111-4111-8111-111111111111',projectId:'A',token:'pending-A',
  targetKey:'shot-1:image-1',shotId:'shot-1',layerId:'image-1',targetPath:'assets/images/pending.png',
  status:'VALIDATED',model:'nano_banana_2',aspectRatio:'9:16',prompt:'Frozen image prompt',
  staged:{path:'assets/images/glabs-first.png',sha256:'a'.repeat(64),width:90,height:160}};
const second={...first,id:'22222222-2222-4222-8222-222222222222',
  staged:{...first.staged,path:'assets/images/glabs-second.png',sha256:'b'.repeat(64)}};
function Harness(){
  const {setNative}=useAppState();
  // Seed the initial session once: setNative is not referentially stable across provider renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(project('A'));},[]);
  return <><button onClick={()=>setNative(project('B'))}>Switch B</button><StoryboardWorkspace/></>;
}
const install=(jobs:Array<typeof first>=[first])=>{
  const approve=vi.fn(async()=>({status:'APPROVED'}));
  const calls={approve};
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia:async(id:string)=>id==='A'?pending:null,
    glabsJobs:async(id:string)=>id==='A'?jobs:[],
    glabsSettings:async()=>({config:{endpoint:'http://127.0.0.1:8765',contract:'legacy',
      model:'nano_banana_2',aspectRatio:'9:16'},credential:{configured:true,secureStorageAvailable:true}}),
    mediaUrl:async(_id:string,relative:string)=>'studio-media://A/'+relative,
    glabsApprove:approve,projectState:async(id:string)=>project(id)
  }});
  return calls;
};
const enableDecodedLoad=(img:HTMLElement)=>{
  Object.defineProperty(img,'complete',{configurable:true,value:true});
  Object.defineProperty(img,'naturalWidth',{configurable:true,value:90});
  Object.defineProperty(img,'naturalHeight',{configurable:true,value:160});
  fireEvent.load(img);
};
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{configurable:true,value:undefined});});
describe('R3 F04 preview-verified owner approval',()=>{
  it('F04-01/02/06 keeps approval disabled before load and after image error; no binding',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const image=await screen.findByRole('img',{name:'G-Labs candidate for shot-1/image-1'});
    fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owner licensed artwork'}});
    const button=screen.getByRole('button',{name:'Approve inspected image + bind'});
    expect(button).toBeDisabled();
    fireEvent.error(image);
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/preview failed to load/));
    expect(button).toBeDisabled();
    expect(screen.getByRole('button',{name:'Retry image preview'})).toBeEnabled();
    fireEvent.click(button);
    expect(approve).not.toHaveBeenCalled();
  });
  it('F04-03 successful current preview, rights and explicit inspection are required',async()=>{
    const {approve}=install();
    const confirmed=vi.spyOn(window,'confirm').mockReturnValue(false);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const image=await screen.findByRole('img',{name:'G-Labs candidate for shot-1/image-1'});
    fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owner licensed artwork'}});
    enableDecodedLoad(image);
    const button=screen.getByRole('button',{name:'Approve inspected image + bind'});
    await waitFor(()=>expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(confirmed).toHaveBeenCalledWith(expect.stringContaining('I have inspected'));
    expect(approve).not.toHaveBeenCalled();
    confirmed.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(()=>expect(approve).toHaveBeenCalledWith('A',first.id,'Owner licensed artwork'));
  });
  it('F04-04 a loaded image never authorizes another output SHA or job revision',async()=>{
    install([first,second]);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const images=await screen.findAllByRole('img',{name:'G-Labs candidate for shot-1/image-1'});
    fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owner licensed artwork'}});
    enableDecodedLoad(images[0]);
    const buttons=screen.getAllByRole('button',{name:'Approve inspected image + bind'});
    await waitFor(()=>expect(buttons[0]).toBeEnabled());
    expect(buttons[1]).toBeDisabled();
  });
  it('F04-05 switching project invalidates an already loaded preview',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const image=await screen.findByRole('img',{name:'G-Labs candidate for shot-1/image-1'});
    fireEvent.change(screen.getByLabelText('Owner-confirmed rights/source'),{target:{value:'Owner licensed artwork'}});
    enableDecodedLoad(image);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Approve inspected image + bind'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Approve inspected image + bind'})).not.toBeInTheDocument());
    expect(approve).not.toHaveBeenCalled();
  });
});
