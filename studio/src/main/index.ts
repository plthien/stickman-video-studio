import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { alignWithElevenLabs } from './alignment.js';
import { confirmImport, freezeTask, stageImport } from './externalTasks.js';
import { discoverNano, generateNano, nanoBase } from './nanoClient.js';
import { cancelJob, nativeJob, reconcileJob } from './nativeJobs.js';
import { importAlignedWords, importApprovedWav, longformStatus, runLongform } from './voiceMedia.js';
import { assertMediaRelative, fileFetchUrl, mediaUrl, nativeSkillRoot, projectId, projectSnapshot, readState, runProcess, safeImportedFile, sha, strictJson, writeState, type NativeCommand, type Stage, type StudioState } from './services.js';

if (process.env.MODE_B_STUDIO_DISABLE_GPU === '1') { app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('disable-gpu-compositing'); }
if(process.env.MODE_B_STUDIO_USER_DATA){const userData=path.resolve(process.env.MODE_B_STUDIO_USER_DATA);if(!path.isAbsolute(process.env.MODE_B_STUDIO_USER_DATA)||userData.startsWith('\\\\'))throw new Error('MODE_B_STUDIO_USER_DATA must be a local absolute path.');fs.mkdirSync(userData,{recursive:true});app.setPath('userData',userData)}
protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const roots = new Map<string, string>();
const registerRoot = (root: string) => { const real = fs.realpathSync(root), id = projectId(real); roots.set(id, real); return id; };
const rootFor = (id: string) => { const root = roots.get(id); if (!root || projectId(root) !== id) throw new Error('Unknown or unopened project.'); return root; };

function registerIpc() {
  const recentPath = path.join(app.getPath('userData'), 'recent-projects.json');
  const recent = () => fs.existsSync(recentPath) ? strictJson(fs.readFileSync(recentPath, 'utf8')) as { projects?: StudioState['project'][] } : { projects: [] };
  const saveRecent = (project: StudioState['project']) => { const projects = [project, ...(recent().projects ?? []).filter(item => item.id !== project.id)].slice(0, 12); fs.mkdirSync(path.dirname(recentPath), { recursive: true }); fs.writeFileSync(recentPath, JSON.stringify({ projects }, null, 2)); roots.set(project.id, project.root); };
  ipcMain.handle('project:listRecent', () => { const projects = recent().projects ?? []; for (const project of projects) if (fs.existsSync(project.root)) registerRoot(project.root); return projects; });
  ipcMain.handle('project:create', async (_event, input: { parent: string; folder: string; title: string; topic: string; style: string; language: string; targetDuration?: number }) => {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,79}$/u.test(input.folder)) throw new Error('Choose a simple project folder name.');
    const target = path.resolve(input.parent, input.folder); if (fs.existsSync(target)) throw new Error('Project folder already exists.');
    const { cli } = nativeSkillRoot(app.getAppPath()); const result = await runProcess(process.execPath, [cli, 'init', target, '--style', input.style], { cwd: path.dirname(cli), timeout: 60_000 }); if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'Native project initialization failed.');
    const projectFile = path.join(target, 'project.json'); const manifest = strictJson(fs.readFileSync(projectFile, 'utf8')) as Record<string, unknown>; manifest.width = 1080; manifest.height = 1920; fs.writeFileSync(projectFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const summary = { id: registerRoot(target), root: fs.realpathSync(target), title: input.title.trim(), style: input.style, updatedAt: new Date().toISOString(), projectFile };
    const state: StudioState = { schema: 'mode-b-studio-state-v1', project: summary, brief: { topic: input.topic, language: input.language, ratio: '9:16', targetDuration: input.targetDuration }, external: {}, tasks: {}, nano: { endpoint: 'http://127.0.0.1:3901' }, imports: [] };
    writeState(target, state); saveRecent(summary); return projectSnapshot(target);
  });
  ipcMain.handle('project:openDialog', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('project:open', (_event, root: string) => { const state = readState(root); registerRoot(root); saveRecent(state.project); reconcileJob(root); return projectSnapshot(root); });
  ipcMain.handle('project:state', (_event, id: string) => projectSnapshot(rootFor(id)));
  ipcMain.handle('project:saveBrief', (_event, id: string, brief: StudioState['brief'] & { title: string }) => { const root = rootFor(id), state = readState(root); state.project.title = brief.title.trim(); state.brief = { topic: brief.topic, language: brief.language, ratio: '9:16', targetDuration: brief.targetDuration, audience: brief.audience, purpose: brief.purpose }; state.project.updatedAt = new Date().toISOString(); writeState(root, state); saveRecent(state.project); return projectSnapshot(root); });
  ipcMain.handle('settings:setNano', (_event, id: string, endpoint: string) => { const root = rootFor(id), state = readState(root); state.nano = { ...state.nano, endpoint: nanoBase(endpoint).toString().replace(/\/$/, '') }; writeState(root, state); return projectSnapshot(root); });
  ipcMain.handle('external:freeze', (_event, id: string, stage: Stage, rebuild = false) => freezeTask(app.getAppPath(), rootFor(id), stage, rebuild));
  ipcMain.handle('external:exportPrompt', async (_event, id: string, stage: Stage) => { const root = rootFor(id), task = freezeTask(app.getAppPath(), root, stage, false); const result = await dialog.showSaveDialog({ defaultPath: path.join(root, '.studio', 'external', `${stage}-prompt.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled || !result.filePath) return null; fs.copyFileSync(path.join(root, task.promptPath), result.filePath); return result.filePath; });
  ipcMain.handle('external:stageImport', (_event, id: string, stage: Stage, text: string) => stageImport(app.getAppPath(), rootFor(id), stage, text));
  ipcMain.handle('external:confirmImport', async (_event, id: string, token: string) => { const root = rootFor(id); await confirmImport(app.getAppPath(), root, token); return projectSnapshot(root); });
  ipcMain.handle('voice:nanoDiscover', (_event, endpoint: string) => discoverNano(endpoint));
  ipcMain.handle('voice:nanoGenerate', async (_event, id: string, request: { voice: string; speed: number; seed: number }) => { const root = rootFor(id), state = readState(root); return generateNano(root, { ...request, endpoint: state.nano?.endpoint ?? 'http://127.0.0.1:3901' }); });
  ipcMain.handle('voice:align', (_event, id: string, authorized: boolean) => alignWithElevenLabs(app.getAppPath(), rootFor(id), authorized));
  ipcMain.handle('voice:longformStatus', () => longformStatus());
  ipcMain.handle('voice:longformRun', (_event, id: string, input: {voice?:string;resume?:boolean;retryUncertain?:boolean}) => runLongform(rootFor(id), input));
  ipcMain.handle('voice:importWav', async (_event, id: string) => { const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'PCM WAV',extensions:['wav']}]}); return result.canceled?null:importApprovedWav(rootFor(id),result.filePaths[0]); });
  ipcMain.handle('voice:importWords', async (_event, id: string) => { const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Aligned words JSON',extensions:['json']}]}); return result.canceled?null:importAlignedWords(app.getAppPath(),rootFor(id),result.filePaths[0]); });
  ipcMain.handle('media:import', async (_event, id: string, mapping: {kind:'image'|'sfx';shotId?:string;layerId?:string;rights:string}) => { if(!mapping||!['image','sfx'].includes(mapping.kind)||typeof mapping.rights!=='string'||!mapping.rights.trim())throw new Error('Media kind and rights/source attestation are required.'); const root = rootFor(id); const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: mapping.kind === 'image' ? [{ name: 'Images', extensions: ['png','jpg','jpeg'] }] : [{ name: 'Audio', extensions: ['wav','mp3','m4a','aac','ogg','flac'] }] }); if (result.canceled) return null; const relative = safeImportedFile(root, result.filePaths[0], mapping.kind), state = readState(root), entry={path:relative,sha256:sha(fs.readFileSync(path.join(root,relative))),kind:mapping.kind,shotId:mapping.shotId,layerId:mapping.layerId,rights:mapping.rights.trim(),importedAt:new Date().toISOString()} as const; state.imports = [...new Set([...(state.imports ?? []), relative])]; state.media=[...(state.media??[]).filter(item=>!(item.path===relative&&item.shotId===mapping.shotId&&item.layerId===mapping.layerId)),entry]; if(state.tasks?.native)state.tasks.native.status='STALE'; writeState(root, state); return entry; });
  ipcMain.handle('native:run', async (_event, id: string, command: NativeCommand, input: Parameters<typeof nativeJob>[3]) => { const root = rootFor(id), result = await nativeJob(app.getAppPath(), root, command, input); return { ...result, state: projectSnapshot(root) }; });
  ipcMain.handle('native:cancel', (_event, id: string, jobId: string) => cancelJob(rootFor(id), jobId));
  ipcMain.handle('project:mediaUrl', (_event, id: string, relative: string) => mediaUrl(rootFor(id), assertMediaRelative(relative)));
  ipcMain.handle('project:openOutput', (_event, id: string) => shell.openPath(path.join(rootFor(id), 'output')));
}

const createWindow = () => { const win = new BrowserWindow({ width: 1440, height: 800, minWidth: 960, minHeight: 620, backgroundColor: '#07131f', webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } }); win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://chatgpt.com/')) void shell.openExternal(url); return { action: 'deny' }; }); win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); }); const devUrl = process.env.VITE_DEV_SERVER_URL; if (devUrl) void win.loadURL(devUrl); else void win.loadFile(join(import.meta.dirname, '../../dist/index.html')); };
app.whenReady().then(() => { registerIpc(); protocol.handle('studio-media', request => { const url = new URL(request.url), root = roots.get(url.hostname); if (!root) return new Response('Unknown project', { status: 404 }); try { return net.fetch(fileFetchUrl(root, assertMediaRelative(decodeURIComponent(url.pathname.slice(1)))), { headers: request.headers }); } catch { return new Response('Forbidden', { status: 403 }); } }); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
