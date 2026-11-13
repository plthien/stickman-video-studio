import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProjectState } from '../types/app';

interface AppContextValue { project: ProjectState; setProject: (next: ProjectState) => void; notice: string; showNotice: (message: string) => void }
const AppContext = createContext<AppContextValue | null>(null);
const initialProject: ProjectState = { title: 'Why We Procrastinate', topic: 'Why waiting for motivation keeps us stuck', style: 'B2 · Colorful Hand-Drawn', duration: 222, language: 'English', ratio: '9:16' };
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState(initialProject); const [notice, setNotice] = useState('');
  const value = useMemo(() => ({ project, setProject, notice, showNotice: (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800); } }), [project, notice]);
  return <AppContext.Provider value={value}>{children}{notice && <div className="toast" role="status">{notice}</div>}</AppContext.Provider>;
}
export const useAppState = () => { const value = useContext(AppContext); if (!value) throw new Error('AppStateProvider missing'); return value; };
