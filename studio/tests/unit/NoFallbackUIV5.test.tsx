import {useEffect,type ReactNode} from 'react';
import {cleanup as uiCleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {VoiceWorkspace} from '../../src/renderer/features/voice/VoiceWorkspace';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import {NativePreviewPanel} from '../../src/renderer/features/editor/NativePreviewPanel';
import type {NativeStudioState} from '../../src/renderer/types/app';

afterEach(()=>{uiCleanup();vi.restoreAllMocks();Object.defineProperty(window,'studio',{value:undefined,configurable:true})});
const project=(id:string,extra:Partial<NativeStudioState>={}):NativeStudioState=>({schema:'mode-b-studio-state-v1',project:{id,root:'C:/projects/'+id,title:id,style:'B1',updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},brief:{topic:'actual',language:'en',ratio:'9:16'},external:{},nano:{endpoint:'http://127.0.0.1:3901'},projection:{shots:[],duration:0,tracks:{},demo:false},...extra});
function Seed({state,children}:{state:NativeStudioState;children:ReactNode}){const{setNative}=useAppState();useEffect(()=>setNative(state),[state,setNative]);return children}
const bridge=(value:Record<string,unknown>)=>Object.defineProperty(window,'studio',{value:{
  // A complete read-only Storyboard bridge; production never substitutes
  // a success result when pendingMedia itself reports corruption.
  glabsJobs:async()=>[],
  glabsSettings:async()=>({config:{endpoint:'http://127.0.0.1:8765',contract:'legacy',
    model:'nano_banana_2',aspectRatio:'9:16'},credential:{configured:false,secureStorageAvailable:true}}),
  setNanoEndpoint:async()=>value.state,projectState:async()=>value.state,...value
},configurable:true});

describe('V5 strict UI cancellation, error and project-switch semantics',()=>{
  it('UT-NF09 cancelled WAV/WORDS import shows CANCELLED without success; absent pending is EMPTY',async()=>{const state=project('p1');const projectState=vi.fn(async()=>state),importWav=vi.fn(async()=>null);bridge({state,projectState,importWav,pendingMedia:async()=>null});render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);fireEvent.click(await screen.findByRole('button',{name:'Import WAV'}));expect(await screen.findByText(/CANCELLED — no project data changed/)).toBeInTheDocument();expect(projectState).not.toHaveBeenCalled();expect(screen.queryByText(/Approved WAV imported/)).not.toBeInTheDocument();uiCleanup();render(<AppStateProvider><Seed state={state}><StoryboardWorkspace/></Seed></AppStateProvider>);await waitFor(()=>expect(screen.getByTestId('image-queue-counts')).toHaveTextContent('0 Native images'));expect(screen.queryByRole('alert')).not.toBeInTheDocument()});
  it('UT-NF10 corrupt pending journal and caption review failures are visible ERROR states',async()=>{const aligned=project('aligned',{alignment:{path:'words.json',captionsPath:'captions.json',audioSha256:'a',wordsSha256:'b',cuesSha256:'c'}});bridge({state:aligned,captionReview:async()=>{throw new Error('approved cue bytes corrupt')},pendingMedia:async()=>{throw new Error('pending journal corrupt')}});render(<AppStateProvider><Seed state={aligned}><VoiceWorkspace/></Seed></AppStateProvider>);expect(await screen.findByRole('alert')).toHaveTextContent(/Caption review ERROR.*corrupt/);uiCleanup();render(<AppStateProvider><Seed state={aligned}><StoryboardWorkspace/></Seed></AppStateProvider>);expect(await screen.findByRole('alert')).toHaveTextContent(/Pending media ERROR.*corrupt/)});
  it('UT-NF13 switching to a second empty project clears prior video URL and PASS status',async()=>{const first=project('first',{preview:{path:'output/preview.mp4',sha256:'a'.repeat(64),reportPath:'output/preview-report.json'}}),second=project('second');bridge({state:first,mediaUrl:async(id:string)=>'studio-media://'+id+'/output/preview.mp4'});const view=render(<AppStateProvider><Seed state={first}><NativePreviewPanel onDetails={()=>{}} onApproval={()=>{}}/></Seed></AppStateProvider>);await waitFor(()=>expect(screen.getAllByText('VERIFIED').length).toBeGreaterThan(0));expect(document.querySelector('video')).toBeTruthy();bridge({state:second,mediaUrl:async()=>{throw new Error('no media')}});view.rerender(<AppStateProvider><Seed state={second}><NativePreviewPanel onDetails={()=>{}} onApproval={()=>{}}/></Seed></AppStateProvider>);await waitFor(()=>expect(screen.getAllByText('NOT_READY').length).toBeGreaterThan(0));expect(document.querySelector('video')).toBeNull();expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument()});
});
