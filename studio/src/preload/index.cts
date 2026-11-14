// Electron's sandboxed preload loader requires CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  platform: process.platform, version: '0.2.0',
  listRecent: () => invoke('project:listRecent'), createProject: (input: unknown) => invoke('project:create', input), openProjectDialog: () => invoke('project:openDialog'), openProject: (root: string) => invoke('project:open', root), projectState: (id: string) => invoke('project:state', id), saveBrief: (id: string, brief: unknown) => invoke('project:saveBrief', id, brief), setNanoEndpoint: (id: string, endpoint: string) => invoke('settings:setNano', id, endpoint),
  freezeTask: (id: string, stage: string, rebuild = false) => invoke('external:freeze', id, stage, rebuild), exportPrompt: (id: string, stage: string) => invoke('external:exportPrompt', id, stage), stageImport: (id: string, stage: string, text: string) => invoke('external:stageImport', id, stage, text), confirmImport: (id: string, token: string) => invoke('external:confirmImport', id, token),
  nanoDiscover: (endpoint: string) => invoke('voice:nanoDiscover', endpoint), nanoGenerate: (id: string, request: unknown) => invoke('voice:nanoGenerate', id, request), align: (id: string, authorized: boolean) => invoke('voice:align', id, authorized), longformStatus: () => invoke('voice:longformStatus'), longformRun: (id:string,input:unknown) => invoke('voice:longformRun',id,input), importWav:(id:string)=>invoke('voice:importWav',id), importWords:(id:string)=>invoke('voice:importWords',id), importMedia: (id: string, mapping: unknown) => invoke('media:import', id, mapping),
  nativeRun: (id: string, command: string, input?: unknown) => invoke('native:run', id, command, input), cancelNative: (id: string, jobId: string) => invoke('native:cancel', id, jobId), mediaUrl: (id: string, relative: string) => invoke('project:mediaUrl', id, relative), openOutput: (id: string) => invoke('project:openOutput', id)
}));
