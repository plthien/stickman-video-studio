import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { confirmExternalImport, externalPrompt, fileFetchUrl, inspectWav, mediaUrl, nativeSkillRoot, projectId, readState, resolveProjectFile, runNative, runProcess, safeImportedFile, stageExternalImport, strictJson, writeState, type Stage, type StudioState } from './services.js';

if (process.env.MODE_B_STUDIO_DISABLE_GPU === '1') app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const roots = new Map<string, string>();

function registerIpc() {
  const recentPath = path.join(app.getPath('userData'), 'recent-projects.json');
  const recent = () => fs.existsSync(recentPath) ? strictJson(fs.readFileSync(recentPath, 'utf8')) as { projects?: StudioState['project'][] } : { projects: [] };
  const saveRecent = (project: StudioState['project']) => {
    const projects = [project, ...(recent().projects ?? []).filter(item => item.id !== project.id)].slice(0, 12);
    fs.mkdirSync(path.dirname(recentPath), { recursive: true }); fs.writeFileSync(recentPath, JSON.stringify({ projects }, null, 2)); roots.set(project.id, project.root);
  };
  ipcMain.handle('project:listRecent', () => recent().projects ?? []);
  ipcMain.handle('project:create', async (_event, input: { parent: string; folder: string; title: string; topic: string; style: string; language: string }) => {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,79}$/u.test(input.folder)) throw new Error('Choose a simple project folder name.');
    const target = path.resolve(input.parent, input.folder); if (fs.existsSync(target)) throw new Error('Project folder already exists.');
    const { cli } = nativeSkillRoot(app.getAppPath()); const result = await runProcess(process.execPath, [cli, 'init', target, '--style', input.style], { cwd: path.dirname(cli), timeout: 60_000 });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'Native project initialization failed.');
    try {
      const projectFile = path.join(target, 'project.json'); const manifest = strictJson(fs.readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
      manifest.width = 1080; manifest.height = 1920; fs.writeFileSync(projectFile, `${JSON.stringify(manifest, null, 2)}\n`);
      const summary = { id: projectId(target), root: fs.realpathSync(target), title: input.title.trim(), style: input.style, updatedAt: new Date().toISOString(), projectFile };
      const state: StudioState = { schema: 'mode-b-studio-state-v1', project: summary, brief: { topic: input.topic, language: input.language, ratio: '9:16' }, external: {} };
      writeState(target, state); saveRecent(summary); return state;
    } catch (error) { throw new Error(`Native project was created but Studio setup failed: ${(error as Error).message}`); }
  });
  ipcMain.handle('project:openDialog', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('project:open', (_event, root: string) => { const state = readState(root); saveRecent(state.project); return state; });
  ipcMain.handle('project:state', (_event, root: string) => readState(root));
  ipcMain.handle('project:saveBrief', (_event, root: string, brief: StudioState['brief'] & { title: string }) => { const state = readState(root); state.project.title = brief.title.trim(); state.brief = { topic: brief.topic, language: brief.language, ratio: '9:16' }; state.project.updatedAt = new Date().toISOString(); writeState(root, state); saveRecent(state.project); return state; });
  ipcMain.handle('external:prompt', (_event, root: string, stage: Stage) => externalPrompt(readState(root), stage));
  ipcMain.handle('external:exportPrompt', async (_event, root: string, stage: Stage) => { const prompt = externalPrompt(readState(root), stage); const result = await dialog.showSaveDialog({ defaultPath: path.join(root, '.studio', 'external', `${stage}-prompt.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (result.canceled || !result.filePath) return null; fs.mkdirSync(path.dirname(result.filePath), { recursive: true }); fs.writeFileSync(result.filePath, prompt, 'utf8'); return result.filePath; });
  ipcMain.handle('external:stageImport', (_event, root: string, stage: Stage, text: string) => stageExternalImport(root, stage, text));
  ipcMain.handle('external:confirmImport', (_event, token: string) => confirmExternalImport(token));
  ipcMain.handle('voice:nanoHealth', async (_event, endpoint: string) => { const base = new URL(endpoint); if (!['127.0.0.1','localhost','::1'].includes(base.hostname)) throw new Error('Nano must use localhost.'); const [health, readiness] = await Promise.all([fetch(new URL('/health', base)), fetch(new URL('/lite/readiness', base))]); return { health: health.status, readiness: readiness.status, ready: health.ok && readiness.ok, detail: await readiness.text() }; });
  ipcMain.handle('voice:nanoGenerate', async (_event, root: string, request: Record<string, unknown> & { endpoint: string }) => {
    const base = new URL(request.endpoint); if (!['127.0.0.1','localhost','::1'].includes(base.hostname)) throw new Error('Nano must use localhost.');
    const body = { model: 'chatterbox-nano', voice: request.voice, input: request.input, response_format: 'wav', language: request.language || 'en', speed: request.speed ?? 1, seed: request.seed ?? 0 };
    let response: Response; try { response = await fetch(new URL('/v1/audio/speech', base), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/wav' }, body: JSON.stringify(body) }); } catch { throw new Error('Nano connection outcome is uncertain; inspect server jobs before retrying.'); }
    if (!response.ok) { const definite = [422,429].includes(response.status); throw new Error(`${definite ? 'Nano request was not admitted' : 'Nano outcome may be uncertain'} (${response.status}).`); }
    const output = resolveProjectFile(root, 'assets/audio/narration.wav'); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, Buffer.from(await response.arrayBuffer())); const wav = inspectWav(output);
    const receiptHeader = response.headers.get('x-nano-execution-receipt'); const receipt = receiptHeader ? JSON.parse(Buffer.from(receiptHeader, 'base64url').toString('utf8')) as unknown : null;
    const state = readState(root); state.voice = { path: 'assets/audio/narration.wav', sha256: wav.sha256, receipt, generatedAt: new Date().toISOString() };
    const manifestPath = resolveProjectFile(root, 'project.json'); const manifest = strictJson(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>; const priorVoice = manifest.voice && typeof manifest.voice === 'object' ? manifest.voice as Record<string, unknown> : {}; manifest.voice = { ...priorVoice, path: state.voice.path }; fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeState(root, state); return { ...wav, path: state.voice.path, receipt };
  });
  ipcMain.handle('voice:align', async (_event, root: string, input: { apiKey: string; transcript: string }) => {
    const state = readState(root); if (!state.voice) throw new Error('Generate or import narration first.'); const audio = fs.readFileSync(resolveProjectFile(root, state.voice.path));
    const form = new FormData(); form.append('file', new Blob([audio], { type: 'audio/wav' }), 'narration.wav'); form.append('text', input.transcript);
    const response = await fetch('https://api.elevenlabs.io/v1/forced-alignment', { method: 'POST', headers: { 'xi-api-key': input.apiKey }, body: form }); if (!response.ok) throw new Error(`ElevenLabs forced alignment failed (${response.status}).`);
    const raw = await response.json() as { words?: Array<{ text: string; start: number; end: number; loss?: number }> }; if (!Array.isArray(raw.words) || !raw.words.length) throw new Error('ElevenLabs returned no aligned words.');
    const native = { words: raw.words.map(word => ({ word: word.text, start: word.start, end: word.end, ...(word.loss === undefined ? {} : { loss: word.loss }) })) };
    const stamp = Date.now(); const relative = `.studio/alignment/words-${stamp}.json`; const captionsRelative = `.studio/alignment/captions-${stamp}.json`; const target = resolveProjectFile(root, relative); const captionsTarget = resolveProjectFile(root, captionsRelative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(native, null, 2)}\n`);
    const { cli } = nativeSkillRoot(app.getAppPath()); const captionResult = await runProcess(process.execPath, [cli, 'captions', target, captionsTarget], { cwd: path.dirname(cli), timeout: 60_000 }); if (captionResult.code !== 0) throw new Error(captionResult.stderr || 'Original captions command failed.');
    const captions = JSON.parse(fs.readFileSync(captionsTarget, 'utf8')) as unknown; if (!Array.isArray(captions)) throw new Error('Original captions command returned an invalid artifact.'); const manifestPath = resolveProjectFile(root, 'project.json'); const manifest = strictJson(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>; manifest.captions = captions; fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    state.alignment = { path: relative, captionsPath: captionsRelative, audioSha256: state.voice.sha256, generatedAt: new Date().toISOString() }; writeState(root, state); return state.alignment;
  });
  ipcMain.handle('media:import', async (_event, root: string, kind: 'image' | 'sfx') => { const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: kind === 'image' ? [{ name: 'Images', extensions: ['png','jpg','jpeg'] }] : [{ name: 'Audio', extensions: ['wav','mp3','m4a','aac','ogg','flac'] }] }); return result.canceled ? null : safeImportedFile(root, result.filePaths[0], kind); });
  ipcMain.handle('native:run', async (_event, root: string, command: Parameters<typeof runNative>[2], input: Parameters<typeof runNative>[3]) => {
    const result = await runNative(app.getAppPath(), root, command, input);
    if (command === 'approve') {
      const approval = strictJson(fs.readFileSync(resolveProjectFile(root, 'output/approval.json'), 'utf8')) as { note?: string; preview_sha256?: string; approved_at?: string };
      const state = readState(root); state.approval = { note: approval.note || '', previewSha256: approval.preview_sha256 || '', approvedAt: approval.approved_at || new Date().toISOString() }; writeState(root, state);
    }
    return result;
  });
  ipcMain.handle('project:mediaUrl', (_event, root: string, relative: string) => { roots.set(projectId(root), fs.realpathSync(root)); return mediaUrl(root, relative); });
  ipcMain.handle('project:openOutput', (_event, root: string) => shell.openPath(resolveProjectFile(root, 'output')));
}

const createWindow = () => {
  const win = new BrowserWindow({ width: 1440, height: 800, minWidth: 960, minHeight: 620, backgroundColor: '#07131f', webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://chatgpt.com/')) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); });
  const devUrl = process.env.VITE_DEV_SERVER_URL; if (devUrl) void win.loadURL(devUrl); else void win.loadFile(join(import.meta.dirname, '../../dist/index.html'));
};
app.whenReady().then(() => { registerIpc(); protocol.handle('studio-media', request => { const url = new URL(request.url); const root = roots.get(url.hostname); if (!root) return new Response('Unknown project', { status: 404 }); try { return net.fetch(fileFetchUrl(root, decodeURIComponent(url.pathname.slice(1))), { headers: request.headers }); } catch { return new Response('Forbidden', { status: 403 }); } }); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
