// Electron's sandboxed preload loader requires CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  platform: process.platform, version: '0.2.0',
  listRecent: () => invoke('project:listRecent'), createProject: (input: unknown) => invoke('project:create', input), browseProjectParent: () => invoke('project:browseParent'), openProjectDialog: () => invoke('project:openDialog'), openProject: (root: string) => invoke('project:open', root), projectState: (id: string) => invoke('project:state', id), saveBrief: (id: string, brief: unknown) => invoke('project:saveBrief', id, brief), setNanoEndpoint: (id: string, endpoint: string) => invoke('settings:setNano', id, endpoint),
  freezeTask: (id: string, stage: string, rebuild = false) => invoke('external:freeze', id, stage, rebuild), exportPrompt: (id: string, stage: string, operation = 'author', scope?:unknown) => invoke('external:exportPrompt', id, stage, operation, scope), stageImport: (id: string, stage: string, text: string) => invoke('external:stageImport', id, stage, text), confirmImport: (id: string, token: string, options?: unknown) => invoke('external:confirmImport', id, token, options), readFrozen:(id:string,stage:string,operation:string)=>invoke('external:readFrozen',id,stage,operation),readHistory:(id:string,stage:string,operation:string,mediaKind?:string)=>invoke('external:readHistory',id,stage,operation,mediaKind),freezeLifecycle:(id:string,stage:string,operation:string,scope:unknown,rebuild=false)=>invoke('external:freezeLifecycle',id,stage,operation,scope,rebuild),stageLifecycle:(id:string,stage:string,operation:string,text:string)=>invoke('external:stageLifecycle',id,stage,operation,text),confirmLifecycle:(id:string,token:string,options?:unknown)=>invoke('external:confirmLifecycle',id,token,options),pendingMedia: (id: string) => invoke('external:pendingMedia',id), fulfillMedia: (id:string,token:string,key:string,relative:string,rights:string,ownerReviewed?:true)=>invoke('external:fulfillMedia',id,token,key,relative,rights,ownerReviewed),
  identitySnapshot:(id:string)=>invoke('identity:snapshot',id),
  identityPreviewUpgrade:(id:string)=>invoke('identity:previewUpgrade',id),
  identityUpgrade:(id:string,input:unknown)=>invoke('identity:upgrade',id,input),
  identityFreeze:(id:string,operation:string,revision:number)=>invoke('identity:freeze',id,operation,revision),
  identityImport:(id:string,text:string,revision:number)=>invoke('identity:importResult',id,text,revision),
  identityApproveAnalysis:(id:string,revision:number)=>invoke('identity:approveAnalysis',id,revision),
  identityPrepareBible:(id:string,revision:number)=>invoke('identity:prepareBible',id,revision),
  identityFreezeStyleBible:(id:string,operation:string,revision:number)=>invoke('identity:freezeStyleBible',id,operation,revision),
  identityImportStyleBible:(id:string,text:string,revision:number)=>invoke('identity:importStyleBible',id,text,revision),
  identityApproveBible:(id:string,revision:number)=>invoke('identity:approveBible',id,revision),
  identityApproveVisualDefinition:(id:string,input:unknown)=>
    invoke('identity:approveVisualDefinition',id,input),
  identityRegisterOwnerReference:(id:string,input:unknown)=>invoke('identity:registerOwnerReference',id,input),
  identityApproveReference:(id:string,input:unknown)=>invoke('identity:approveReference',id,input),
  identityPreviewReferenceImpact:(id:string,selectedIds:string[])=>
    invoke('identity:previewReferenceImpact',id,selectedIds),
  identityPublishReferences:(id:string,revision:number,selectedIds:string[],impactSha256?:string)=>
    invoke('identity:publishReferences',id,revision,selectedIds,impactSha256),
  identityReferenceJobs:(id:string)=>invoke('identity:referenceJobs',id),
  identityGenerateReference:(id:string,input:unknown)=>invoke('identity:generateReference',id,input),
  identitySyncReference:(id:string,jobId:string)=>invoke('identity:syncReference',id,jobId),
  galleryImages: (id: string) => invoke('storyboard:gallery', id),
  prepareImages: (id: string, persist = false) => invoke('storyboard:prepareImages', id, persist), saveImagePrompt: (id: string, input: unknown) => invoke('storyboard:saveImagePrompt', id, input),
  glabsSettings:()=>invoke('glabs:settings'), glabsConfigure:(settings:unknown)=>invoke('glabs:configure',settings), glabsSaveKey:(key:string)=>invoke('glabs:saveKey',key), glabsClearKey:()=>invoke('glabs:clearKey'), glabsProbe:()=>invoke('glabs:probe'), glabsJobs:(id:string)=>invoke('glabs:jobs',id), glabsGenerate:(id:string,input:unknown)=>invoke('glabs:generate',id,input), glabsPoll:(id:string,jobId:string)=>invoke('glabs:poll',id,jobId), glabsCancelQueued:(id:string,jobId:string)=>invoke('glabs:cancelQueued',id,jobId), glabsApprove:(id:string,jobId:string,rights?:string)=>invoke('glabs:approve',id,jobId,rights),
  onGlabsJobChanged:(callback:(change:unknown)=>void)=>{
    if(typeof callback!=='function')throw new Error('GLABS_EVENT_CALLBACK_REQUIRED');
    const listener=(_event:Electron.IpcRendererEvent,payload:unknown)=>callback(payload);
    ipcRenderer.on('glabs:jobChanged',listener);
    return()=>ipcRenderer.removeListener('glabs:jobChanged',listener);
  },
  elevenLabsStatus: () => invoke('settings:elevenlabsStatus'), elevenLabsSaveKey: (key:string) => invoke('settings:elevenlabsSave',key), elevenLabsClearKey: () => invoke('settings:elevenlabsClear'),
  voicePlaybackUrl: (id:string) => invoke('voice:playbackUrl',id),
  nanoDiscover: (endpoint: string) => invoke('voice:nanoDiscover', endpoint), nanoGenerate: (id: string, request: unknown) => invoke('voice:nanoGenerate', id, request), align: (id: string, authorized: boolean) => invoke('voice:align', id, authorized), longformStatus: () => invoke('voice:longformStatus'), narrationAction:(id:string)=>invoke('voice:narrationAction',id), repairTiming:(id:string)=>invoke('voice:repairTiming',id), timingEvidence:(id:string)=>invoke('voice:timingEvidence',id), longformRun: (id:string,input:unknown) => invoke('voice:longformRun',id,input), importWav:(id:string)=>invoke('voice:importWav',id), importWords:(id:string)=>invoke('voice:importWords',id), captionReview:(id:string)=>invoke('voice:captionReview',id), captionAuto:(id:string)=>invoke('voice:captionAuto',id), captionAuthorFreeze:(id:string)=>invoke('voice:captionAuthorFreeze',id), captionAuthorImport:(id:string,text:string)=>invoke('voice:captionAuthorImport',id,text), captionDraft:(id:string,boundaries:number[])=>invoke('voice:captionDraft',id,boundaries), captionApprove:(id:string,note:string)=>invoke('voice:captionApprove',id,note), importMedia: (id: string, mapping: unknown) => invoke('media:import', id, mapping),
  nativeRun: (id: string, command: string, input?: unknown) => invoke('native:run', id, command, input), cancelNative: (id: string, jobId: string) => invoke('native:cancel', id, jobId), mediaUrl: (id: string, relative: string) => invoke('project:mediaUrl', id, relative), openOutput: (id: string) => invoke('project:openOutput', id)
}));
