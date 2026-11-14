import { createHashRouter } from 'react-router-dom'; import { AppShell } from './layout/AppShell';
import { ProjectSetupPage } from '../pages/ProjectSetupPage'; import { OverviewPage } from '../pages/OverviewPage'; import { ExternalChatGPTPage } from '../pages/ExternalChatGPTPage'; import { ScriptPage } from '../pages/ScriptPage'; import { VoiceCaptionsPage } from '../pages/VoiceCaptionsPage'; import { StoryboardImagesPage } from '../pages/StoryboardImagesPage'; import { VideoEditorPage } from '../pages/VideoEditorPage'; import { RenderExportPage } from '../pages/RenderExportPage'; import { SystemSettingsPage } from '../pages/SystemSettingsPage';
export const router = createHashRouter([{ path: '/', element: <AppShell />, children: [
  { index: true, element: <ProjectSetupPage /> }, { path: 'overview', element: <OverviewPage /> }, { path: 'external', element: <ExternalChatGPTPage /> },
  { path: 'script', element: <ScriptPage /> }, { path: 'voice', element: <VoiceCaptionsPage /> }, { path: 'storyboard', element: <StoryboardImagesPage /> },
  { path: 'editor', element: <VideoEditorPage /> }, { path: 'render', element: <RenderExportPage /> }, { path: 'settings', element: <SystemSettingsPage /> }
]}]);
