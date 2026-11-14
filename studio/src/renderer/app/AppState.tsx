import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { NativeStudioState, ProjectState } from '../types/app';

interface AppContextValue { project: ProjectState; setProject: (next: ProjectState) => void; native: NativeStudioState | null; setNative: (next: NativeStudioState | null) => void; nanoEndpoint:string;setNanoEndpoint:(value:string)=>void; notice: string; showNotice: (message: string) => void; requireNative: () => NonNullable<Window['studio']> }
const AppContext = createContext<AppContextValue | null>(null);
const initialProject: ProjectState = { title: 'Why We Procrastinate', topic: 'Why waiting for motivation keeps us stuck', style: 'B2', duration: 222, language: 'English', ratio: '9:16' };
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState(initialProject); const [notice, setNotice] = useState('');
  const [native, setNativeRaw] = useState<NativeStudioState | null>(null); const [nanoEndpoint,setNanoEndpointRaw]=useState('http://127.0.0.1:3901');
  const setNative=(next:NativeStudioState|null)=>{setNativeRaw(next);if(next?.nano?.endpoint)setNanoEndpointRaw(next.nano.endpoint)};
  const setNanoEndpoint=(value:string)=>setNanoEndpointRaw(value);const nativeId=native?.project.id;
  useEffect(()=>{if(!nativeId||!window.studio)return;const timer=window.setTimeout(()=>void window.studio!.setNanoEndpoint(nativeId,nanoEndpoint).then(setNativeRaw).catch(()=>undefined),500);return()=>window.clearTimeout(timer)},[nativeId,nanoEndpoint]);
  const value = { project, setProject, native, setNative, nanoEndpoint,setNanoEndpoint,notice, requireNative: () => { if (!window.studio) throw new Error('Native Studio bridge is available in Electron only.'); return window.studio; }, showNotice: (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3800); } };
  return <AppContext.Provider value={value}>{children}{notice && <div className="toast" role="status">{notice}</div>}</AppContext.Provider>;
}
export const useAppState = () => { const value = useContext(AppContext); if (!value) throw new Error('AppStateProvider missing'); return value; };
