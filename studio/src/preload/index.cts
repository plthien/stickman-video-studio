// Electron's sandboxed preload loader requires CommonJS even though the main package uses ESM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge } = require('electron') as typeof import('electron');
contextBridge.exposeInMainWorld('studio', Object.freeze({ platform: process.platform, version: '0.1.0' }));
