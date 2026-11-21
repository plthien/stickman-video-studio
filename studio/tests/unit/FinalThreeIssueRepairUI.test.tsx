import {useEffect} from 'react';
import {cleanup,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,describe,expect,it} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {OverviewDashboard} from '../../src/renderer/features/project/OverviewDashboard';
import type {NativeStudioState} from '../../src/renderer/types/app';

afterEach(cleanup);
const state=(captionReady:boolean):NativeStudioState=>({schema:'mode-b-studio-state-v1',project:{id:'real',root:'C:/projects/real',title:'Real project',style:'B1',updatedAt:'now',projectFile:'C:/projects/real/project.json'},brief:{topic:'actual',language:'en',ratio:'9:16'},external:{},voice:{path:'assets/audio/narration.wav',sha256:'a'.repeat(64),duration:10,stale:false},alignment:{path:'words.json',captionsPath:'captions.json',audioSha256:'a'.repeat(64),wordsSha256:'b'.repeat(64),cuesSha256:'c'.repeat(64),captionReview:{revision:1,sha256:'d'.repeat(64),approvedAt:'now',note:'reviewed'}},projection:{shots:[],duration:0,tracks:{},captionReady,demo:false}});
function Seed({value}:{value:NativeStudioState}){const{setNative}=useAppState();useEffect(()=>setNative(value),[value,setNative]);return <OverviewDashboard/>}
const renderDashboard=(value:NativeStudioState)=>render(<AppStateProvider><MemoryRouter><Seed value={value}/></MemoryRouter></AppStateProvider>);

describe('FIX-03 caption readiness dashboard truthfulness',()=>{
  it('UT-F03-F shows EVIDENCE for a caption revision already verified by projectSnapshot',async()=>{renderDashboard(state(true));const row=(await screen.findByText('Voice & Captions')).closest('a')!;expect(within(row).getByText('EVIDENCE')).toBeInTheDocument();expect(within(row).getByText(/approved captions verified/)).toBeInTheDocument()});
  it('UT-F03-G does not show success from captionReview metadata without verified readiness',async()=>{renderDashboard(state(false));const row=(await screen.findByText('Voice & Captions')).closest('a')!;expect(within(row).getByText('NOT_READY')).toBeInTheDocument();expect(within(row).queryByText('EVIDENCE')).not.toBeInTheDocument()});
});
