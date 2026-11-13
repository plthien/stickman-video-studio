import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { access, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const electronPath = createRequire(import.meta.url)('electron') as string;
const withoutElectronNodeMode = () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
};

test('Electron production shell starts and retains secure BrowserWindow preferences', async () => {
  test.skip(Boolean(process.env.ELECTRON_RUN_AS_NODE), 'Managed runner forces Electron into Node mode; run on a normal Windows desktop.');
  const env = withoutElectronNodeMode();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: electronPath, args: ['.'], env });
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Project Setup' })).toBeVisible();
    const security = await window.evaluate(() => ({
      hasNodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require !== 'undefined',
      bridge: window.studio,
      protocol: location.protocol
    }));
    expect(security.hasNodeRequire).toBe(false);
    expect(security.bridge?.version).toBe('0.1.0');
    expect(security.protocol).toBe('file:');
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences());
    expect(preferences?.contextIsolation).toBe(true);
    expect(preferences?.sandbox).toBe(true);
    expect(preferences?.nodeIntegration).toBe(false);
  } finally {
    await app.close();
  }
});

test('Electron development URL opens Project Setup without production files', async () => {
  test.skip(Boolean(process.env.ELECTRON_RUN_AS_NODE), 'Managed runner forces Electron into Node mode; run on a normal Windows desktop.');
  const env = withoutElectronNodeMode();
  env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173';
  const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--strictPort'], { cwd: process.cwd(), env, stdio: 'pipe' });
  for (let attempt=0;attempt<40;attempt+=1) { try { if ((await fetch(env.VITE_DEV_SERVER_URL)).ok) break; } catch { /* server is starting */ } await new Promise(resolveWait=>setTimeout(resolveWait,100)); }
  const dist=resolve('dist'); const backup=resolve('dist.dev-smoke-backup'); let moved=false;
  try { await access(dist); await rename(dist,backup); moved=true; } catch { /* clean workspace already has no dist */ }
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: electronPath, args: ['.'], env });
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Project Setup' })).toBeVisible();
    expect(await window.evaluate(() => location.origin)).toBe('http://127.0.0.1:5173');
  } finally { if(app)await app.close(); vite.kill(); if(moved)await rename(backup,dist); }
});
