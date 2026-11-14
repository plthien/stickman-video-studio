// Electron's sandboxed preload loader requires CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  platform: process.platform, version: '0.2.0',
  listRecent: () => invoke('project:listRecent'), createProject: (input: unknown) => invoke('project:create', input), openProjectDialog: () => invoke('project:openDialog'), openProject: (root: string) => invoke('project:open', root), projectState: (root: string) => invoke('project:state', root), saveBrief: (root: string, brief: unknown) => invoke('project:saveBrief', root, brief),
  externalPrompt: (root: string, stage: string) => invoke('external:prompt', root, stage), exportPrompt: (root: string, stage: string) => invoke('external:exportPrompt', root, stage), stageImport: (root: string, stage: string, text: string) => invoke('external:stageImport', root, stage, text), confirmImport: (token: string) => invoke('external:confirmImport', token),
  nanoHealth: (endpoint: string) => invoke('voice:nanoHealth', endpoint), nanoGenerate: (root: string, request: unknown) => invoke('voice:nanoGenerate', root, request), align: (root: string, input: unknown) => invoke('voice:align', root, input), importMedia: (root: string, kind: string) => invoke('media:import', root, kind),
  nativeRun: (root: string, command: string, input?: unknown) => invoke('native:run', root, command, input), mediaUrl: (root: string, relative: string) => invoke('project:mediaUrl', root, relative), openOutput: (root: string) => invoke('project:openOutput', root)
}));
