import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NativeStudioState, ProjectState } from '../types/app';

export interface ProjectSessionScope { projectId: string; epoch: number }
interface AppContextValue { project: ProjectState; setProject: (next: ProjectState) => void; native: NativeStudioState | null; setNative: (next: NativeStudioState | null) => void; openNativeSession:(next:NativeStudioState)=>void;captureProjectSession:()=>ProjectSessionScope|null;isCurrentProjectSession:(scope:ProjectSessionScope)=>boolean;setNativeIfSessionCurrent:(scope:ProjectSessionScope,next:NativeStudioState)=>boolean;setNativeIfCurrent:(projectId:string,next:NativeStudioState)=>boolean;isCurrentProject:(projectId:string)=>boolean;nanoEndpoint:string;setNanoEndpoint:(value:string)=>void; notice: string; showNotice: (message: string) => void; requireNative: () => NonNullable<Window['studio']> }
const AppContext = createContext<AppContextValue | null>(null);
// Empty creation form. Never synthesize a project, narration, shots or readiness.
const initialProject: ProjectState = { title: '', topic: '', style: 'B1', duration: 0, language: 'English', ratio: '9:16' };
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState(initialProject); const [notice, setNotice] = useState('');
  const [native, setNativeRaw] = useState<NativeStudioState | null>(null); const [nanoEndpoint,setNanoEndpointRaw]=useState('http://127.0.0.1:3901');const activeId=useRef<string|undefined>(undefined);const sessionEpoch=useRef(0);const dirtyId=useRef<string|undefined>(undefined);const request=useRef(0);
  const applyNative=(next:NativeStudioState|null,forceNewSession=false)=>{request.current+=1;dirtyId.current=undefined;const nextId=next?.project.id;if(forceNewSession||nextId!==activeId.current)sessionEpoch.current+=1;activeId.current=nextId;setNotice('');setNativeRaw(next);setNanoEndpointRaw(next?.nano?.endpoint??'http://127.0.0.1:3901')};
  const setNative=(next:NativeStudioState|null)=>applyNative(next);
  const openNativeSession=(next:NativeStudioState)=>applyNative(next,true);
  const captureProjectSession=():ProjectSessionScope|null=>activeId.current?{projectId:activeId.current,epoch:sessionEpoch.current}:null;
  const isCurrentProjectSession=(scope:ProjectSessionScope)=>activeId.current===scope.projectId&&sessionEpoch.current===scope.epoch;
  const setNativeIfSessionCurrent=(scope:ProjectSessionScope,next:NativeStudioState)=>{if(!isCurrentProjectSession(scope)||next.project.id!==scope.projectId)return false;setNative(next);return true};
  const isCurrentProject=(projectId:string)=>activeId.current===projectId;
  const setNativeIfCurrent=(projectId:string,next:NativeStudioState)=>{if(!isCurrentProject(projectId)||next.project.id!==projectId)return false;setNative(next);return true};
  const setNanoEndpoint=(value:string)=>{dirtyId.current=activeId.current;setNanoEndpointRaw(value)};const nativeId=native?.project.id;
  useEffect(()=>{if(!nativeId||!window.studio||dirtyId.current!==nativeId)return;const sequence=++request.current;const timer=window.setTimeout(()=>void window.studio!.setNanoEndpoint(nativeId,nanoEndpoint).then(next=>{if(sequence===request.current&&activeId.current===nativeId){dirtyId.current=undefined;setNativeRaw(next)}}).catch(reason=>{if(sequence===request.current&&activeId.current===nativeId)setNotice('Settings ERROR: '+String(reason))}),500);return()=>window.clearTimeout(timer)},[nativeId,nanoEndpoint]);
  const value = { project, setProject, native, setNative,openNativeSession,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,setNativeIfCurrent,isCurrentProject,nanoEndpoint,setNanoEndpoint,notice, requireNative: () => { if (!window.studio) throw new Error('Native Studio bridge is available in Electron only.'); return window.studio; }, showNotice: (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3800); } };
  return <AppContext.Provider value={value}>{children}{notice && <div className="toast" role="status">{notice}</div>}</AppContext.Provider>;
}
export const useAppState = () => { const value = useContext(AppContext); if (!value) throw new Error('AppStateProvider missing'); return value; };
