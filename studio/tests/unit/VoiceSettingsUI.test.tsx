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


describe('Voice actions use main-process eligibility, not permanently enabled buttons',()=>{
  const withProfile=(id:string)=>{const value=project(id,true);value.nano={
    endpoint:'http://127.0.0.1:3901',profileId:'voice'
  };
    value.approvedScript={sections:[{id:'s1',text:'Hello world'}],text:'Hello world',
      sha256:'1'.repeat(64),revision:1};
    return value;
  };
  it('GEN-02/UI: PASS offers Regenerate only and sends the regenerate intent',async()=>{
    const state=withProfile('voice-regen'),run=vi.fn(async()=>({jobId:'new-attempt'}));
    bridge({
      voicePlaybackUrl:async()=> 'studio-media://voice-regen/assets/audio/narration.wav?sha='+'a'.repeat(64),
      narrationAction:async()=>({action:'regenerate',reason:'PASS',completed:1,total:1,status:'PASS'}),
      timingEvidence:async()=>false,longformRun:run,projectState:async()=>state
    });
    render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Regenerate narration'}));
    await waitFor(()=>expect(run).toHaveBeenCalledWith('voice-regen',{voice:'voice',regenerate:true}));
    expect(screen.queryByRole('button',{name:'Resume narration'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Explicit Retry/})).not.toBeInTheDocument();
  });
  it('GEN-05/06: UNCERTAIN replay requires a separate confirmation gesture',async()=>{
    const state=withProfile('voice-uncertain'),run=vi.fn(async()=>({jobId:'recovered'}));
    bridge({
      voicePlaybackUrl:async()=> 'studio-media://voice-uncertain/assets/audio/narration.wav?sha='+'a'.repeat(64),
      narrationAction:async()=>({action:'retry',reason:'UNCERTAIN',completed:1,total:2,status:'UNCERTAIN'}),
      timingEvidence:async()=>false,longformRun:run,projectState:async()=>state
    });
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);
    const button=await screen.findByRole('button',{name:'Explicit Retry uncertain part'});
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(()=>expect(run).toHaveBeenCalledWith('voice-uncertain',
      {voice:'voice',resume:true,retryUncertain:true}));
  });
  it('GEN-08/09: after restart Resume retains its frozen profile rather than an older accepted voice',async()=>{
    const state=withProfile('voice-restart');
    state.nano!.profileId='old-accepted';
    state.longform={status:'UNCERTAIN',jobId:'pending',profileId:'frozen-current',
      completedParts:1,totalParts:2};
    const run=vi.fn(async()=>({jobId:'pending'}));
    bridge({
      voicePlaybackUrl:async()=> 'studio-media://voice-restart/assets/audio/narration.wav?sha='+'a'.repeat(64),
      narrationAction:async()=>({action:'retry',reason:'UNCERTAIN',completed:1,total:2,status:'UNCERTAIN'}),
      timingEvidence:async()=>false,longformRun:run,projectState:async()=>state
    });
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Explicit Retry uncertain part'}));
    await waitFor(()=>expect(run).toHaveBeenCalledWith('voice-restart',
      {voice:'frozen-current',resume:true,retryUncertain:true}));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('MF07-4/GEN-08: switching projects replaces pending pinned profile, not reuse the prior voice',async()=>{
    const first=withProfile('voice-project-A');
    first.nano!.profileId='old-accepted-A';
    first.longform={status:'UNCERTAIN',jobId:'pending-A',profileId:'frozen-A',
      completedParts:0,totalParts:1};
    const second=withProfile('voice-project-B');
    second.nano!.profileId='accepted-B';
    bridge({
      voicePlaybackUrl:async(id:string)=> 'studio-media://'+id+'/assets/audio/narration.wav?sha='+'a'.repeat(64),
      narrationAction:async()=>({action:'blocked',reason:'not eligible',completed:0,total:0,status:'BLOCKED'}),
      timingEvidence:async()=>false
    });
    const view=render(<AppStateProvider><Seed state={first}><VoiceWorkspace/></Seed></AppStateProvider>);
    const profile=await screen.findByLabelText('Confirmed voice profile') as HTMLSelectElement;
    await waitFor(()=>expect(profile.value).toBe('frozen-A'));
    view.rerender(<AppStateProvider><Seed state={second}><VoiceWorkspace/></Seed></AppStateProvider>);
    await waitFor(()=>expect((screen.getByLabelText('Confirmed voice profile') as HTMLSelectElement).value).toBe('accepted-B'));
    expect(screen.queryByRole('option',{name:/frozen-A/})).not.toBeInTheDocument();
  });
  it('PB-05: bounded read-only playback retry never invokes Nano synthesis',async()=>{
    const state=withProfile('voice-player'),run=vi.fn(),url=vi.fn(async()=>
      'studio-media://voice-player/assets/audio/narration.wav?sha='+'a'.repeat(64));
    bridge({
      voicePlaybackUrl:url,
      narrationAction:async()=>({action:'regenerate',reason:'PASS',completed:1,total:1,status:'PASS'}),
      timingEvidence:async()=>false,longformRun:run
    });
    render(<AppStateProvider><Seed state={state}><VoiceWorkspace/></Seed></AppStateProvider>);
    const player=await screen.findByLabelText('Accepted narration audio');
    await waitFor(()=>expect(url).toHaveBeenCalledTimes(1)); // Initial verified playback URL
    fireEvent.error(player);
    await waitFor(()=>expect(url).toHaveBeenCalledTimes(2)); // Read-only integrity recheck
    fireEvent.click(await screen.findByRole('button',{name:'Retry playback (read-only)'}));
    await waitFor(()=>expect(url).toHaveBeenCalledTimes(3)); // Explicit retry fetches URL
    expect(url).toHaveBeenNthCalledWith(1,'voice-player');
    expect(url).toHaveBeenNthCalledWith(2,'voice-player');
    expect(url).toHaveBeenNthCalledWith(3,'voice-player');
    expect(run).not.toHaveBeenCalled();
  });
});
