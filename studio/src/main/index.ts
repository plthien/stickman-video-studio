import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { alignWithElevenLabs,repairAlignmentTiming,eligibleAlignmentResponse } from './alignment.js';
import {elevenLabsStatus,saveElevenLabsKey,clearElevenLabsKey,resolveElevenLabsKey} from './elevenlabsCredentials.js';
import {acceptedNarrationPlaybackUrl,serveAcceptedNarration} from './voicePlayback.js';
import { reconcileScriptActivation, confirmImport, freezeTask, stageImport, getNativeImageGallery,getPendingMedia, fulfillMedia, importMediaFile } from './externalTasks.js';
import {confirmLifecycleResult,freezeLifecycleTask,readFrozenExternalTask,stageLifecycleResult} from './externalLifecycle.js';
import {readExternalHistory} from './externalHistory.js';
import {prepareNativeImages,saveNativeImagePrompt,loadImageStyleProfile} from './imagePreparation.js';
import { getCaptionReview, draftCaptionReview, approveCaptionReview,autoCaptionReview,freezeCaptionAuthorTask,importCaptionAuthorResult } from './captionReview.js';
import {glabsSettings,saveGlabsSettings,glabsCredentialStatus,saveGlabsKey,clearGlabsKey,glabsProbe,reconcileGlabsJobs,readGlabsJob,submitGlabsImage,pollGlabsImage,approveGlabsImage,cancelQueuedGlabsImage,type GLabsSettings,type ImageRequest} from './glabs.js';
import {createGlabsAutoPolling} from './glabsAutoPolling.js';
import { discoverNano, generateNano, nanoBase } from './nanoClient.js';
import { cancelJob, nativeJob, reconcileJob } from './nativeJobs.js';
import { importAlignedWords, importApprovedWav, longformStatus, runLongform, narrationAction } from './voiceMedia.js';
import { projectSnapshot } from './projectSnapshot.js';
import {createProjectStaged} from './projectCreation.js';
import {exportNativeReferencePackage} from './externalAuthority.js';
import {identityWorkflowSnapshot,freezeIdentityTask,importIdentityResult,
  approveScriptAnalysis,prepareAutomaticReferenceGallery,prepareProjectStyleBible,approveProjectStyleBible,freezeStyleBibleTask,importStyleBibleResult,
  registerOwnerReference,approveOwnerReference,publishStyleBibleReferences,
  previewIdentityUpgrade,upgradeIdentityPolicy,registerValidatedGeneratedReference,
  readIdentityWorkflow,approveOwnerVisualDefinition} from './identity/identityWorkflow.js';
import {listReferenceJobs,submitReferenceJob,syncReferenceJob,
  validateNewReferenceGenerateInput} from './identity/referenceGeneration.js';
import {previewReferenceSwitchImpact} from './identity/impact.js';
import type {IdentityReviewOperation} from './identity/contracts.js';
import { assertLocalRoot, assertMediaRelative, fileFetchUrl, mediaUrl, projectId, readState, strictJson, writeState, type NativeCommand, type Stage, type StudioState } from './services.js';

if (process.env.MODE_B_STUDIO_DISABLE_GPU === '1') { app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('disable-gpu-compositing'); }
if(process.env.MODE_B_STUDIO_USER_DATA){const userData=path.resolve(process.env.MODE_B_STUDIO_USER_DATA);if(!path.isAbsolute(process.env.MODE_B_STUDIO_USER_DATA)||userData.startsWith('\\\\'))throw new Error('MODE_B_STUDIO_USER_DATA must be a local absolute path.');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData)}
protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const roots = new Map<string, string>();
const registerRoot = (root: string) => { const real = fs.realpathSync(root), id = projectId(real); roots.set(id, real); return id; };
const rootFor = (id: string) => { const root = roots.get(id); if (!root || projectId(root) !== id) throw new Error('Unknown or unopened project.'); return root; };

// The provider job JSON is durable; the poll coordinator only performs
// read-only status/result GETs and broadcasts progress independently of tabs.
const glabsPolling=createGlabsAutoPolling({
  intervalMs:2500,concurrency:2,
  poll:(id,jobId)=>pollGlabsImage(app.getAppPath(),rootFor(id),app.getPath('userData'),safeStorage,jobId,decodeGlabsImage),
  onJob:(projectId,job)=>{
    for(const win of BrowserWindow.getAllWindows()){
      if(!win.isDestroyed()&&!win.webContents.isDestroyed())
        win.webContents.send('glabs:jobChanged',{projectId,job});
    }
  },
  onError:(projectId,jobId,_error)=>{
    // Status/result/file GET failures broadcast the verified durable job.
    // Never log exception strings, signed URLs or provider credentials.
    try{
      const job=readGlabsJob(rootFor(projectId),jobId);
      if(!job.lastSyncError)return;
      console.warn('[glabs-auto-poll] sync code',job.id,job.lastSyncError.code);
      for(const win of BrowserWindow.getAllWindows()){
        if(!win.isDestroyed()&&!win.webContents.isDestroyed())
          win.webContents.send('glabs:jobChanged',{projectId,job});
      }
    }catch{/* A closed or no-longer-open project has no renderer audience. */}
  }
});
const resumeGlabsPolling=(id:string,root:string)=>{
  try{glabsPolling.observeAll(id,reconcileGlabsJobs(app.getAppPath(),root));}
  catch(error){console.warn('[glabs-auto-poll] resume failed:',error instanceof Error?error.message:String(error));}
};


const decodeGlabsImage=(bytes:Buffer)=>{
  const decoded=nativeImage.createFromBuffer(bytes);
  if(decoded.isEmpty())throw new Error('GLABS_IMAGE_DECODE_FAILED');
  const size=decoded.getSize();return{png:decoded.toPNG(),width:size.width,height:size.height,
    bgra:decoded.toBitmap(),encodeBgra:(pixels:Buffer)=>nativeImage.createFromBitmap(pixels,{width:size.width,height:size.height,scaleFactor:1}).toPNG()};
};
function registerIpc() {
  const recentPath = path.join(app.getPath('userData'), 'recent-projects.json');
  const recent = () => fs.existsSync(recentPath) ? strictJson(fs.readFileSync(recentPath, 'utf8')) as { projects?: StudioState['project'][] } : { projects: [] };
  const saveRecent = (project: StudioState['project']) => { const projects = [project, ...(recent().projects ?? []).filter(item => item.id !== project.id)].slice(0, 12); fs.mkdirSync(path.dirname(recentPath), { recursive: true }); fs.writeFileSync(recentPath, JSON.stringify({ projects }, null, 2)); roots.set(project.id, project.root); const pending=path.join(project.root,'.studio','recent-registration-pending.json');if(fs.existsSync(pending))fs.unlinkSync(pending); };
  ipcMain.handle('project:listRecent', () => { const projects = recent().projects ?? []; for (const project of projects) if (fs.existsSync(project.root)) registerRoot(project.root); return projects; });
  ipcMain.handle('project:create', async (_event, input: { parent: string; folder: string; title: string; topic: string; style: string; language: string; targetDuration?: number; audience?:string; purpose?:string }) => {
    const created=await createProjectStaged(app.getAppPath(),input,{publishRecent:saveRecent});registerRoot(created.root);return{...(await projectSnapshot(created.root,app.getAppPath())),registrationWarning:created.registrationWarning};
  });
  ipcMain.handle('project:browseParent', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : assertLocalRoot(result.filePaths[0]);
  });
  ipcMain.handle('project:openDialog', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('project:open', (_event, root: string) => {
    const state=reconcileScriptActivation(root);
    registerRoot(root);saveRecent(state.project);reconcileJob(root);
    resumeGlabsPolling(state.project.id,root);
    return projectSnapshot(root,app.getAppPath());
  });
  ipcMain.handle('project:state', (_event, id: string) => { const root=rootFor(id); reconcileScriptActivation(root); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('project:saveBrief', (_event, id: string, brief: StudioState['brief'] & { title: string }) => { const root = rootFor(id), state = readState(root); state.project.title = brief.title.trim(); state.brief = { topic: brief.topic, language: brief.language, ratio: '9:16', targetDuration: brief.targetDuration, audience: brief.audience, purpose: brief.purpose }; state.project.updatedAt = new Date().toISOString(); writeState(root, state); saveRecent(state.project); return projectSnapshot(root,app.getAppPath()); });
  // F24 upstream uses a separate typed identity workflow; never Stage='native'.
  ipcMain.handle('identity:snapshot',(_event,id:string)=>
    identityWorkflowSnapshot(rootFor(id),app.getAppPath()));
  ipcMain.handle('identity:previewUpgrade',(_event,id:string)=>
    previewIdentityUpgrade(rootFor(id)));
  ipcMain.handle('identity:upgrade',(_event,id:string,input:{
    impactSha256:string;ownerConfirmed:true
  })=>upgradeIdentityPolicy(rootFor(id),input));
  ipcMain.handle('identity:freeze',(_event,id:string,operation:IdentityReviewOperation,
    revision:number)=>freezeIdentityTask(rootFor(id),operation,revision));
  ipcMain.handle('identity:importResult',(_event,id:string,result:string,revision:number)=>
    importIdentityResult(rootFor(id),result,revision));
  ipcMain.handle('identity:approveAnalysis',(_event,id:string,revision:number)=>
    approveScriptAnalysis(rootFor(id),revision));
  ipcMain.handle('identity:prepareAutomaticGallery',(_event,id:string,revision:number)=>
    prepareAutomaticReferenceGallery(rootFor(id),app.getAppPath(),revision,decodeGlabsImage));
  ipcMain.handle('identity:prepareBible',(_event,id:string,revision:number)=>
    prepareProjectStyleBible(rootFor(id),app.getAppPath(),revision));
  ipcMain.handle('identity:freezeStyleBible',(_event,id:string,operation:IdentityReviewOperation,revision:number)=>
    freezeStyleBibleTask(rootFor(id),app.getAppPath(),operation,revision));
  ipcMain.handle('identity:importStyleBible',(_event,id:string,result:string,revision:number)=>
    importStyleBibleResult(rootFor(id),app.getAppPath(),result,revision));
  ipcMain.handle('identity:approveBible',(_event,id:string,revision:number)=>
    approveProjectStyleBible(rootFor(id),app.getAppPath(),revision,true));
  ipcMain.handle('identity:approveVisualDefinition',(_event,id:string,input:{
    expectedRevision:number;anchorId:string;provenance:'SCRIPT_AUTHOR'|'OWNER_BRIEF';
    evidence:string;traits:string[];ownerInspected:true
  })=>approveOwnerVisualDefinition(rootFor(id),app.getAppPath(),input));
  ipcMain.handle('identity:registerOwnerReference',(_event,id:string,input:{
    expectedRevision:number;anchorId:string;relativePath:string;ownerSource:string
  })=>registerOwnerReference(rootFor(id),app.getAppPath(),input,decodeGlabsImage));
  ipcMain.handle('identity:approveReference',(_event,id:string,input:{
    expectedRevision:number;candidateId:string;ownerInspected:true
  })=>approveOwnerReference(rootFor(id),app.getAppPath(),input,decodeGlabsImage));
  ipcMain.handle('identity:previewReferenceImpact',(_event,id:string,selectedIds:string[])=>
    previewReferenceSwitchImpact(rootFor(id),selectedIds));
  ipcMain.handle('identity:publishReferences',(_event,id:string,revision:number,
    selectedIds:string[],reviewedImpactSha256?:string)=>publishStyleBibleReferences(rootFor(id),app.getAppPath(),
      revision,selectedIds,decodeGlabsImage,reviewedImpactSha256));
  ipcMain.handle('identity:referenceJobs',(_event,id:string)=>
    listReferenceJobs(rootFor(id)));
  ipcMain.handle('identity:generateReference',(_event,id:string,input:unknown)=>{
    const request=validateNewReferenceGenerateInput(input);
    return submitReferenceJob(app.getAppPath(),rootFor(id),app.getPath('userData'),
      safeStorage,request);
  });
  ipcMain.handle('identity:syncReference',async(_event,id:string,jobId:string)=>{
    const root=rootFor(id);
    const job=await syncReferenceJob(app.getAppPath(),root,app.getPath('userData'),
      safeStorage,jobId,decodeGlabsImage);
    if(job.status==='VALIDATED'){
      const working=readIdentityWorkflow(root);
      // Frozen legacy jobs must never attach to an unrelated newer draft.
      const sameDraft=working.draftSha256===job.analysisSha&&
        working.bible?.style_bible_sha256===job.styleBibleSha;
      if(sameDraft)
        registerValidatedGeneratedReference(root,app.getAppPath(),{
          expectedRevision:working.revision,job
        },decodeGlabsImage);
    }
    return job;
  });

  ipcMain.handle('storyboard:gallery',(_event,id:string)=>{
    const root=rootFor(id),inventory=getNativeImageGallery(app.getAppPath(),root);
    const style=readState(root).project.style;
    if(!['B1','B2','B3','B4'].includes(style))
      throw new Error('NATIVE_GALLERY_STYLE_UNVERIFIED');
    return{...inventory,
      styleProfileSha256:loadImageStyleProfile(app.getAppPath(),style as 'B1'|'B2'|'B3'|'B4').sha256};
  });
  ipcMain.handle('storyboard:prepareImages',(_event,id:string,persist=false)=>prepareNativeImages(app.getAppPath(),rootFor(id),persist===true));
  ipcMain.handle('storyboard:saveImagePrompt',(_event,id:string,input:Parameters<typeof saveNativeImagePrompt>[2])=>saveNativeImagePrompt(app.getAppPath(),rootFor(id),input));
  ipcMain.handle('glabs:settings',()=>({config:glabsSettings(app.getPath('userData')),credential:glabsCredentialStatus(app.getPath('userData'),safeStorage)}));
  ipcMain.handle('glabs:configure',(_event,value:GLabsSettings)=>saveGlabsSettings(app.getPath('userData'),value));
  ipcMain.handle('glabs:saveKey',(_event,key:string)=>saveGlabsKey(app.getPath('userData'),safeStorage,key));
  ipcMain.handle('glabs:clearKey',()=>clearGlabsKey(app.getPath('userData'),safeStorage));
  ipcMain.handle('glabs:probe',()=>glabsProbe(app.getPath('userData'),safeStorage));
  ipcMain.handle('glabs:jobs',(_event,id:string)=>{
    const jobs=reconcileGlabsJobs(app.getAppPath(),rootFor(id));
    glabsPolling.observeAll(id,jobs);
    return jobs;
  });
  ipcMain.handle('glabs:generate',async(_event,id:string,input:ImageRequest)=>{
    const root=rootFor(id);
    if(!input||input.authorized!==true)throw new Error('GLABS_EXPLICIT_AUTH_REQUIRED');
    // Clicking an enabled Generate/Regenerate Image button is already the
    // owner's explicit authorization for ONE provider request. Do not require
    // a redundant modal for the ordinary workflow (as in YTB AI Studio).
    // UNKNOWN recovery is exceptional: the old POST may already be charged,
    // so preserve its distinct, deliberately acknowledged billing warning.
    if(input.acknowledgeUnknown===true){
      const confirmed=await dialog.showMessageBox({
        type:'warning',buttons:['Cancel','Authorize ONE new image attempt'],defaultId:0,cancelId:0,noLink:true,
        title:'Previous G-Labs outcome UNKNOWN',
        message:'The previous request may already have been charged.',
        detail:'Project: '+id+'\nNative target: '+String(input.targetKey)+
          '\nModel: '+String(input.model)+'\nRatio: '+String(input.aspectRatio)+
          '\nThis action can result in duplicate billing. No automatic retries.'
      });
      if(confirmed.response!==1)return null;
    }
    const job=await submitGlabsImage(app.getAppPath(),root,app.getPath('userData'),safeStorage,input,decodeGlabsImage);
    glabsPolling.observe(id,job);
    return job;
  });
  ipcMain.handle('glabs:poll',(_event,id:string,jobId:string)=>{
    rootFor(id); // Validate registered project even when joining an in-flight poll.
    return glabsPolling.pollNow(id,jobId);
  });
  ipcMain.handle('glabs:cancelQueued',(_event,id:string,jobId:string)=>cancelQueuedGlabsImage(rootFor(id),jobId));
  ipcMain.handle('glabs:approve',(_event,id:string,jobId:string,rights?:string)=>approveGlabsImage(app.getAppPath(),rootFor(id),jobId,rights,decodeGlabsImage));
  ipcMain.handle('settings:elevenlabsStatus', () => elevenLabsStatus(app.getPath('userData'),safeStorage));
  ipcMain.handle('settings:elevenlabsSave', (_event,key:string) => saveElevenLabsKey(app.getPath('userData'),safeStorage,key));
  ipcMain.handle('settings:elevenlabsClear', () => clearElevenLabsKey(app.getPath('userData'),safeStorage));
  ipcMain.handle('settings:setNano', (_event, id: string, endpoint: string) => { const root = rootFor(id), state = readState(root); state.nano = { ...state.nano, endpoint: nanoBase(endpoint).toString().replace(/\/$/, '') }; writeState(root, state); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('external:freeze', (_event, id: string, stage: Stage, rebuild = false) => freezeTask(app.getAppPath(), rootFor(id), stage, rebuild));
  ipcMain.handle('external:exportPrompt', async (_event, id: string, stage: Stage, operation: 'author'|'review'|'correct'|'recheck'|'media-review' = 'author', _scope:Record<string,unknown>={}) => { if(operation==='media-review')throw new Error('MEDIA_REVIEW_DISABLED: legacy history is read-only.'); const root = rootFor(id), task = readFrozenExternalTask(app.getAppPath(),root,stage,operation); if(!task)throw new Error('Build a frozen task before exporting its prompt.'); const result = await dialog.showSaveDialog({ defaultPath: path.join(root, '.studio', 'external', `${stage}-prompt.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled || !result.filePath) return null; const current=readFrozenExternalTask(app.getAppPath(),root,stage,operation); if(!current||current.promptSha256!==task.promptSha256)throw new Error('Frozen task changed during export.'); if(stage==='native')exportNativeReferencePackage(app.getAppPath(),readState(root).project.style,result.filePath,current.promptSha256); fs.copyFileSync(path.join(root, current.promptPath), result.filePath); return result.filePath; });
  ipcMain.handle('external:stageImport', (_event, id: string, stage: Stage, text: string) => stageImport(app.getAppPath(), rootFor(id), stage, text));
  ipcMain.handle('external:confirmImport', async (_event, id: string, token: string, options?: {previewSeconds?:number;allowSampleDraft?:boolean}) => { const root = rootFor(id); await confirmImport(app.getAppPath(), root, token, options); return projectSnapshot(root,app.getAppPath()); });
  ipcMain.handle('external:readFrozen',(_event,id:string,stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review')=>readFrozenExternalTask(app.getAppPath(),rootFor(id),stage,operation));
  ipcMain.handle('external:readHistory',(_event,id:string,stage:Stage,operation:'author'|'review'|'correct'|'recheck'|'media-review',mediaKind?:'voice'|'captions'|'preview'|'film')=>readExternalHistory(rootFor(id),stage,operation,mediaKind));
  ipcMain.handle('external:freezeLifecycle',(_event,id:string,stage:Stage,operation:'review'|'correct'|'recheck',scope:Record<string,unknown>,rebuild=false)=>freezeLifecycleTask(app.getAppPath(),rootFor(id),stage,operation,scope,rebuild));
  ipcMain.handle('external:stageLifecycle',(_event,id:string,stage:Stage,operation:'review'|'correct'|'recheck',text:string)=>stageLifecycleResult(app.getAppPath(),rootFor(id),stage,operation,text));
  ipcMain.handle('external:confirmLifecycle',async(_event,id:string,token:string,options?:{previewSeconds?:number;allowSampleDraft?:boolean})=>{const root=rootFor(id);await confirmLifecycleResult(app.getAppPath(),root,token,options);return projectSnapshot(root,app.getAppPath())});
  ipcMain.handle('external:pendingMedia', (_event, id: string) => getPendingMedia(app.getAppPath(), rootFor(id)));
  ipcMain.handle('external:fulfillMedia', (_event, id: string, token:string, key:string, relative:string, rights:string,ownerReviewed?:true) => fulfillMedia(app.getAppPath(), rootFor(id), token, key, relative, rights,{ownerReviewed,decode:decodeGlabsImage}));
  ipcMain.handle('voice:captionReview', (_event, id: string) => getCaptionReview(rootFor(id)));
  ipcMain.handle('voice:captionAuto',(_event,id:string)=>autoCaptionReview(rootFor(id)));
  ipcMain.handle('voice:captionAuthorFreeze',(_event,id:string)=>freezeCaptionAuthorTask(rootFor(id)));
  ipcMain.handle('voice:captionAuthorImport',(_event,id:string,text:string)=>importCaptionAuthorResult(rootFor(id),text));
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
app.on('before-quit',()=>glabsPolling.close());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
