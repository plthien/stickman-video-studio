import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { alignWithElevenLabs,repairAlignmentTiming,eligibleAlignmentResponse } from './alignment.js';
import {elevenLabsStatus,saveElevenLabsKey,clearElevenLabsKey,resolveElevenLabsKey} from './elevenlabsCredentials.js';
import {acceptedNarrationPlaybackUrl,serveAcceptedNarration} from './voicePlayback.js';
import { reconcileScriptActivation, confirmImport, freezeTask, stageImport, getPendingMedia, fulfillMedia, importMediaFile } from './externalTasks.js';
import {confirmLifecycleResult,freezeLifecycleTask,readFrozenExternalTask,stageLifecycleResult} from './externalLifecycle.js';
import {readExternalHistory} from './externalHistory.js';
import { getCaptionReview, draftCaptionReview, approveCaptionReview,autoCaptionReview } from './captionReview.js';
import { discoverNano, generateNano, nanoBase } from './nanoClient.js';
import { cancelJob, nativeJob, reconcileJob } from './nativeJobs.js';
import { importAlignedWords, importApprovedWav, longformStatus, runLongform, narrationAction } from './voiceMedia.js';
import { projectSnapshot } from './projectSnapshot.js';
import {createProjectStaged} from './projectCreation.js';
import { assertLocalRoot, assertMediaRelative, fileFetchUrl, mediaUrl, projectId, readState, strictJson, writeState, type NativeCommand, type Stage, type StudioState } from './services.js';

if (process.env.MODE_B_STUDIO_DISABLE_GPU === '1') { app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('disable-gpu-compositing'); }
if(process.env.MODE_B_STUDIO_USER_DATA){const userData=path.resolve(process.env.MODE_B_STUDIO_USER_DATA);if(!path.isAbsolute(process.env.MODE_B_STUDIO_USER_DATA)||userData.startsWith('\\\\'))throw new Error('MODE_B_STUDIO_USER_DATA must be a local absolute path.');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData)}
protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const roots = new Map<string, string>();
const registerRoot = (root: string) => { const real = fs.realpathSync(root), id = projectId(real); roots.set(id, real); return id; };
const rootFor = (id: string) => { const root = roots.get(id); if (!root || projectId(root) !== id) throw new Error('Unknown or unopened project.'); return root; };

function registerIpc() {
  const recentPath = path.join(app.getPath('userData'), 'recent-projects.json');
  const recent = () => fs.existsSync(recentPath) ? strictJson(fs.readFileSync(recentPath, 'utf8')) as { projects?: StudioState['project'][] } : { projects: [] };
  const saveRecent = (project: StudioState['project']) => { const projects = [project, ...(recent().projects ?? []).filter(item => item.id !== project.id)].slice(0, 12); fs.mkdirSync(path.dirname(recentPath), { recursive: true }); fs.writeFileSync(recentPath, JSON.stringify({ projects }, null, 2)); roots.set(project.id, project.root); const pending=path.join(project.root,'.studio','recent-registration-pending.json');if(fs.existsSync(pending))fs.unlinkSync(pending); };
  ipcMain.handle('project:listRecent', () => { const projects = recent().projects ?? []; for (const project of projects) if (fs.existsSync(project.root)) registerRoot(project.root); return projects; });
  ipcMain.handle('project:create', async (_event, input: { parent: string; folder: string; title: string; topic: string; style: string; language: string; targetDuration?: number }) => {
    const created=await createProjectStaged(app.getAppPath(),input,{publishRecent:saveRecent});registerRoot(created.root);return{...(await projectSnapshot(created.root,app.getAppPath())),registrationWarning:created.registrationWarning};
  });
  ipcMain.handle('project:browseParent', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : assertLocalRoot(result.filePaths[0]);
  });
  ipcMain.handle('project:openDialog', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('project:open', (_event, root: string) => { const state = reconcileScriptActivation(root); registerRoot(root); saveRecent(state.project); reconcileJob(root); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('project:state', (_event, id: string) => { const root=rootFor(id); reconcileScriptActivation(root); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('project:saveBrief', (_event, id: string, brief: StudioState['brief'] & { title: string }) => { const root = rootFor(id), state = readState(root); state.project.title = brief.title.trim(); state.brief = { topic: brief.topic, language: brief.language, ratio: '9:16', targetDuration: brief.targetDuration, audience: brief.audience, purpose: brief.purpose }; state.project.updatedAt = new Date().toISOString(); writeState(root, state); saveRecent(state.project); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('settings:elevenlabsStatus', () => elevenLabsStatus(app.getPath('userData'),safeStorage));
  ipcMain.handle('settings:elevenlabsSave', (_event,key:string) => saveElevenLabsKey(app.getPath('userData'),safeStorage,key));
  ipcMain.handle('settings:elevenlabsClear', () => clearElevenLabsKey(app.getPath('userData'),safeStorage));
  ipcMain.handle('settings:setNano', (_event, id: string, endpoint: string) => { const root = rootFor(id), state = readState(root); state.nano = { ...state.nano, endpoint: nanoBase(endpoint).toString().replace(/\/$/, '') }; writeState(root, state); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('external:freeze', (_event, id: string, stage: Stage, rebuild = false) => freezeTask(app.getAppPath(), rootFor(id), stage, rebuild));
  ipcMain.handle('external:exportPrompt', async (_event, id: string, stage: Stage, operation: 'author'|'review'|'correct'|'recheck'|'media-review' = 'author', _scope:Record<string,unknown>={}) => { if(operation==='media-review')throw new Error('MEDIA_REVIEW_DISABLED: legacy history is read-only.'); const root = rootFor(id), task = readFrozenExternalTask(app.getAppPath(),root,stage,operation); if(!task)throw new Error('Build a frozen task before exporting its prompt.'); const result = await dialog.showSaveDialog({ defaultPath: path.join(root, '.studio', 'external', `${stage}-prompt.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled || !result.filePath) return null; fs.copyFileSync(path.join(root, task.promptPath), result.filePath); return result.filePath; });
  ipcMain.handle('external:stageImport', (_event, id: string, stage: Stage, text: string) => stageImport(app.getAppPath(), rootFor(id), stage, text));
  ipcMain.handle('external:confirmImport', async (_event, id: string, token: string, options?: {previewSeconds?:number;allowSampleDraft?:boolean}) => { const root = rootFor(id); await confirmImport(app.getAppPath(), root, token, options); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('external:readFrozen',(_event,id:string,stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review')=>readFrozenExternalTask(app.getAppPath(),rootFor(id),stage,operation));
  ipcMain.handle('external:readHistory',(_event,id:string,stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review',mediaKind?:'voice'|'captions'|'preview'|'film')=>readExternalHistory(rootFor(id),stage,operation,mediaKind));
  ipcMain.handle('external:freezeLifecycle',(_event,id:string,stage:Stage,operation:'review'|'correct'|'recheck',scope:Record<string,unknown>,rebuild=false)=>freezeLifecycleTask(app.getAppPath(),rootFor(id),stage,operation,scope,rebuild));
  ipcMain.handle('external:stageLifecycle',(_event,id:string,stage:Stage,operation:'review'|'correct'|'recheck',text:string)=>stageLifecycleResult(app.getAppPath(),rootFor(id),stage,operation,text));
  ipcMain.handle('external:confirmLifecycle',async(_event,id:string,token:string,options?:{previewSeconds?:number;allowSampleDraft?:boolean})=>{const root=rootFor(id);await confirmLifecycleResult(app.getAppPath(),root,token,options);return projectSnapshot(root,app.getAppPath())});
  ipcMain.handle('external:pendingMedia', (_event, id: string) => getPendingMedia(app.getAppPath(), rootFor(id)));
  ipcMain.handle('external:fulfillMedia', (_event, id: string, token:string, key:string, relative:string, rights:string) => fulfillMedia(app.getAppPath(), rootFor(id), token, key, relative, rights));
  ipcMain.handle('voice:captionReview', (_event, id: string) => getCaptionReview(rootFor(id)));
  ipcMain.handle('voice:captionAuto',(_event,id:string)=>autoCaptionReview(rootFor(id)));
  ipcMain.handle('voice:captionDraft', (_event, id: string, boundaries: number[]) => draftCaptionReview(rootFor(id),boundaries));
  ipcMain.handle('voice:captionApprove', (_event, id: string, note: string) => approveCaptionReview(rootFor(id),note));
  ipcMain.handle('voice:nanoDiscover', (_event, endpoint: string) => discoverNano(endpoint));
  ipcMain.handle('voice:nanoGenerate', async (_event, id: string, request: { voice: string; speed: number; seed: number }) => { const root = rootFor(id), state = readState(root); return generateNano(root, { ...request, endpoint: state.nano?.endpoint ?? 'http://127.0.0.1:3901' }); });
  ipcMain.handle('voice:align', (_event, id: string, authorized: boolean) => alignWithElevenLabs(
    app.getAppPath(),rootFor(id),authorized,
    authorized?resolveElevenLabsKey(app.getPath('userData'),safeStorage):undefined));
  ipcMain.handle('voice:playbackUrl', (_event,id:string) => acceptedNarrationPlaybackUrl(rootFor(id)));
  ipcMain.handle('voice:narrationAction', (_event,id:string)=>narrationAction(rootFor(id)));
  ipcMain.handle('voice:repairTiming', (_event,id:string)=>repairAlignmentTiming(app.getAppPath(),rootFor(id)));
  ipcMain.handle('voice:timingEvidence', (_event,id:string)=>{
    const root=rootFor(id),state=readState(root);
    if(!state.approvedScript||!state.voice||state.voice.stale)return false;
    try{return Boolean(eligibleAlignmentResponse(root));}
    catch{return false;} // Invalid/missing local evidence cannot authorize timing recovery.
  });
  ipcMain.handle('voice:longformStatus', () => longformStatus());
  ipcMain.handle('voice:longformRun', (_event, id: string, input: {voice?:string;resume?:boolean;retryUncertain?:boolean;regenerate?:boolean}) => runLongform(rootFor(id), input));
  ipcMain.handle('voice:importWav', async (_event, id: string) => { const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'PCM WAV',extensions:['wav']}]}); return result.canceled?null:importApprovedWav(rootFor(id),result.filePaths[0]); });
  ipcMain.handle('voice:importWords', async (_event, id: string) => { const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Aligned words JSON',extensions:['json']}]}); return result.canceled?null:importAlignedWords(app.getAppPath(),rootFor(id),result.filePaths[0]); });
  ipcMain.handle('media:import', async (_event, id: string, mapping: {kind:'image'|'sfx';rights:string}) => {
    if(!mapping||!['image','sfx'].includes(mapping.kind)||typeof mapping.rights!=='string'||!mapping.rights.trim())throw new Error('Media kind and rights/source attestation are required.');
    const root = rootFor(id);
    const result=await dialog.showOpenDialog({properties:['openFile'],filters:mapping.kind==='image'?[{name:'Images',extensions:['png','jpg','jpeg']}]:[{name:'Audio',extensions:['wav','mp3','m4a','aac','ogg','flac']}]});
    return result.canceled?null:importMediaFile(root,result.filePaths[0],mapping.kind,mapping.rights);
  });
  ipcMain.handle('native:run', async (_event, id: string, command: NativeCommand, input: Parameters<typeof nativeJob>[3]) => { const root = rootFor(id), result = await nativeJob(app.getAppPath(), root, command, input); return { ...result, state: await projectSnapshot(root,app.getAppPath()) }; });
  ipcMain.handle('native:cancel', (_event, id: string, jobId: string) => cancelJob(rootFor(id), jobId));
  ipcMain.handle('project:mediaUrl', (_event, id: string, relative: string) => mediaUrl(rootFor(id), assertMediaRelative(relative)));
  ipcMain.handle('project:openOutput', (_event, id: string) => shell.openPath(path.join(rootFor(id), 'output')));
}

const createWindow = () => { const win = new BrowserWindow({ width: 1440, height: 800, minWidth: 960, minHeight: 620, backgroundColor: '#07131f', webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } }); win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://chatgpt.com/')) void shell.openExternal(url); return { action: 'deny' }; }); win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); }); const devUrl = process.env.VITE_DEV_SERVER_URL; if (devUrl) void win.loadURL(devUrl); else void win.loadFile(join(import.meta.dirname, '../../dist/index.html')); };
app.whenReady().then(() => {
  registerIpc();
  protocol.handle('studio-media',request=>{
    const url=new URL(request.url),root=roots.get(url.hostname);
    if(!root)return new Response('Unknown project',{status:404});
    try{
      const relative=assertMediaRelative(decodeURIComponent(url.pathname.slice(1)));
      if(relative==='assets/audio/narration.wav'){
        try{return serveAcceptedNarration(root,request.url,request.headers.get('range'),request.method);}
        catch{return new Response('Accepted narration authorization changed',{status:409});}
      }
      return net.fetch(fileFetchUrl(root,relative),{headers:request.headers});
    }catch{return new Response('Forbidden',{status:403});}
  });
  createWindow();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
