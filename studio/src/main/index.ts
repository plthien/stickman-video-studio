import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

// Optional compatibility fallback for affected remote desktops; production keeps normal process isolation by default.
if (process.env.MODE_B_STUDIO_DISABLE_GPU === '1') app.disableHardwareAcceleration();

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440, height: 800, minWidth: 960, minHeight: 620, backgroundColor: '#07131f',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://chatgpt.com/' || url.startsWith('https://chatgpt.com/')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl); else void win.loadFile(join(import.meta.dirname, '../../dist/index.html'));
};
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
