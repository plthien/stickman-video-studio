import { RouterProvider } from 'react-router-dom'; import { AppStateProvider } from './AppState'; import { router } from './routes';
export function App() { return <AppStateProvider><RouterProvider router={router} /></AppStateProvider>; }
