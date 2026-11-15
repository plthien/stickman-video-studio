import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe,expect,it} from 'vitest';
import {AppStateProvider} from '../../src/renderer/app/AppState';
import {OverviewDashboard} from '../../src/renderer/features/project/OverviewDashboard';
import {ScriptSessionProvider,ScriptWorkspace} from '../../src/renderer/features/script/ScriptWorkspace';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import {EditorSessionProvider} from '../../src/renderer/features/editor/useEditorState';
import {VideoEditorPage} from '../../src/renderer/pages/VideoEditorPage';
import {Topbar} from '../../src/renderer/app/layout/Topbar';
import {Sidebar} from '../../src/renderer/app/layout/Sidebar';
describe('production UI has no fabricated project or demo fallback',()=>{
  it('top bar and sidebar show no invented project number, status, or duration',()=>{
    render(<AppStateProvider><MemoryRouter><Topbar/><Sidebar/></MemoryRouter></AppStateProvider>);
    expect(screen.getAllByText('No project open').length).toBeGreaterThan(0);
    expect(screen.queryByText(/VB-0024/)).not.toBeInTheDocument();
    expect(screen.queryByText(/03:42/)).not.toBeInTheDocument();
    expect(screen.queryByText(/UI DEMO/)).not.toBeInTheDocument();
  });
  it('Dashboard is EMPTY until a real project is opened',()=>{
    render(<AppStateProvider><MemoryRouter><OverviewDashboard/></MemoryRouter></AppStateProvider>);
    expect(screen.getByText(/No project, script, voice, scene/)).toBeInTheDocument();
    expect(screen.queryByText('Why We Procrastinate')).not.toBeInTheDocument();
    expect(screen.queryByText('28%')).not.toBeInTheDocument();
    expect(screen.queryByText('12 shots')).not.toBeInTheDocument();
  });
  it('Script cannot substitute six invented sections',()=>{
    render(<AppStateProvider><ScriptSessionProvider><ScriptWorkspace/></ScriptSessionProvider></AppStateProvider>);
    expect(screen.getByText(/No approved script sections/)).toBeInTheDocument();
    expect(screen.queryByText('Motivation follows action')).not.toBeInTheDocument();
  });
  it('Storyboard cannot substitute hardcoded scenes',()=>{
    render(<AppStateProvider><StoryboardWorkspace/></AppStateProvider>);
    expect(screen.getByText(/No native shots/)).toBeInTheDocument();
    expect(screen.queryByText('S01-A')).not.toBeInTheDocument();
  });
  it('Editor cannot render a fabricated timeline or fake frame',()=>{
    render(<AppStateProvider><EditorSessionProvider><VideoEditorPage/></EditorSessionProvider></AppStateProvider>);
    expect(screen.getByText(/No authored native shots/)).toBeInTheDocument();
    expect(screen.queryByText('S02-B')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset demo only')).not.toBeInTheDocument();
  });
});