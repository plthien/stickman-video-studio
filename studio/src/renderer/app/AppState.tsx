import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { NativeStudioState, ProjectState } from '../types/app';

interface AppContextValue { project: ProjectState; setProject: (next: ProjectState) => void; native: NativeStudioState | null; setNative: (next: NativeStudioState | null) => void; notice: string; showNotice: (message: string) => void; requireNative: () => NonNullable<Window['studio']> }
const AppContext = createContext<AppContextValue | null>(null);
const initialProject: ProjectState = { title: 'Why We Procrastinate', topic: 'Why waiting for motivation keeps us stuck', style: 'B2', duration: 222, language: 'English', ratio: '9:16' };
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState(initialProject); const [notice, setNotice] = useState('');
  const [native, setNative] = useState<NativeStudioState | null>(null);
  const value = useMemo(() => ({ project, setProject, native, setNative, notice, requireNative: () => { if (!window.studio) throw new Error('Native Studio bridge is available in Electron only.'); return window.studio; }, showNotice: (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3800); } }), [project, native, notice]);
  return <AppContext.Provider value={value}>{children}{notice && <div className="toast" role="status">{notice}</div>}</AppContext.Provider>;
}
export const useAppState = () => { const value = useContext(AppContext); if (!value) throw new Error('AppStateProvider missing'); return value; };
