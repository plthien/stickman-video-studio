import {useEffect,type ReactNode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {SettingsWorkspace} from '../../src/renderer/features/settings/SettingsWorkspace';
import {VoiceWorkspace} from '../../src/renderer/features/voice/VoiceWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

afterEach(()=>{
  cleanup();vi.restoreAllMocks();
  Object.defineProperty(window,'studio',{value:undefined,configurable:true});
});
const bridge=(implementation:Record<string,unknown>)=>Object.defineProperty(window,'studio',{
  value:{...implementation},configurable:true
});
const project=(id:string,voice=false):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',project:{id,root:'C:/projects/'+id,title:id,
    style:'B1',updatedAt:'now',projectFile:'C:/projects/'+id+'/project.json'},
  brief:{topic:'real narration',language:'English',ratio:'9:16'},external:{},
  nano:{endpoint:'http://127.0.0.1:3901'},
  ...(voice?{voice:{path:'assets/audio/narration.wav',sha256:'a'.repeat(64),
    duration:12,stale:false,origin:'NANO_LONGFORM' as const}}:{}),
  projection:{shots:[],duration:0,tracks:{},demo:false}
});
function Seed({state,children}:{state:NativeStudioState;children:ReactNode}){
  const {setNative}=useAppState();
  useEffect(()=>setNative(state),[state]);
  return children;
}
describe('ElevenLabs settings and generated voice preview',()=>{
  it('stores credential via main-only IPC and never displays the submitted key',async()=>{
    const stored={configured:true,source:'secure-storage' as const,secureStorageAvailable:true};
    const save=vi.fn(async(_key:string)=>stored);
    const remove=vi.fn(async()=>({configured:false,source:'none' as const,secureStorageAvailable:true}));
    bridge({elevenLabsStatus:async()=>({configured:false,source:'none',secureStorageAvailable:true}),
      elevenLabsSaveKey:save,elevenLabsClearKey:remove});
    render(<AppStateProvider><SettingsWorkspace/></AppStateProvider>);
    const input=await screen.findByLabelText('API key') as HTMLInputElement;
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save API key'})).toBeDisabled());
    expect(input.type).toBe('password');
    fireEvent.change(input,{target:{value:'test-secret-never-display'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save API key'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Save API key'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith('test-secret-never-display'));
    await waitFor(()=>expect(input.value).toBe(''));
    expect(screen.getByText(/Stored using OS-protected encryption/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('test-secret-never-display');
    fireEvent.click(screen.getByRole('button',{name:'Remove saved key'}));
    await waitFor(()=>expect(remove).toHaveBeenCalledTimes(1));
  });
  it('keeps secure Save disabled when OS encryption is unavailable',async()=>{
    bridge({elevenLabsStatus:async()=>({configured:false,source:'none',secureStorageAvailable:false})});
    render(<AppStateProvider><SettingsWorkspace/></AppStateProvider>);
    fireEvent.change(await screen.findByLabelText('API key'),{target:{value:'key'}});
    await waitFor(()=>expect(screen.getByText(/Secure key storage is unavailable/)).toBeInTheDocument());
    expect(screen.getByRole('button',{name:'Save API key'})).toBeDisabled();
  });
  it('loads verified WAV player and clears it after switching to a project without voice',async()=>{
    const first=project('voice-A',true),second=project('voice-B',false);
    const playback=vi.fn(async(id:string)=>'studio-media://'+id+
      '/assets%2Faudio%2Fnarration.wav?sha='+'a'.repeat(64));
    bridge({voicePlaybackUrl:playback});
    const view=render(<AppStateProvider><Seed state={first}><VoiceWorkspace/></Seed></AppStateProvider>);
    await waitFor(()=>expect(playback).toHaveBeenCalledWith('voice-A'));
    const player=await screen.findByLabelText('Accepted narration audio') as HTMLAudioElement;
    expect(player.getAttribute('src')).toContain('studio-media://voice-A/');
    expect(player.controls).toBe(true);
    view.rerender(<AppStateProvider><Seed state={second}><VoiceWorkspace/></Seed></AppStateProvider>);
    await waitFor(()=>expect(screen.queryByLabelText('Accepted narration audio')).not.toBeInTheDocument());
  });
  it('does not expose a player when the accepted voice hash cannot be verified',async()=>{
    const state=project('voice-corrupt',true);
    bridge({voicePlaybackUrl:async()=>{throw new Error('Accepted narration WAV changed; playback is blocked.')}});
    render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/playback.*changed/i);
    expect(screen.queryByLabelText('Accepted narration audio')).not.toBeInTheDocument();
  });
});
