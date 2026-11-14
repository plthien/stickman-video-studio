import { RouterProvider } from 'react-router-dom';
import { AppStateProvider } from './AppState';
import { router } from './routes';
import { ScriptSessionProvider } from '../features/script/ScriptWorkspace';
import { ExternalSessionProvider } from '../features/external/ExternalWorkspace';
import { EditorSessionProvider } from '../features/editor/useEditorState';

export function App() {
  return <AppStateProvider>
    <ScriptSessionProvider><ExternalSessionProvider><EditorSessionProvider>
      <RouterProvider router={router} />
    </EditorSessionProvider></ExternalSessionProvider></ScriptSessionProvider>
  </AppStateProvider>;
}
