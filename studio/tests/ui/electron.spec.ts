import { test, expect, _electron as electron, chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const electronPath = createRequire(import.meta.url)('electron') as string;
const execFileAsync = promisify(execFile);
const withoutElectronNodeMode = () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
const guiUnavailable = process.platform !== 'win32' || Boolean(process.env.ELECTRON_RUN_AS_NODE);
const guiReason = 'Real Electron GUI smoke requires an ordinary Windows desktop without ELECTRON_RUN_AS_NODE.';

test('Electron production shell starts and retains secure BrowserWindow preferences', async () => {
  test.skip(guiUnavailable, guiReason);
  const env = withoutElectronNodeMode();
  delete env.VITE_DEV_SERVER_URL;
  env.MODE_B_STUDIO_DISABLE_GPU = '1';
  env.MODE_B_STUDIO_USER_DATA = resolve('test-results-electron','user-data-production');
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
    expect(security.bridge?.version).toBe('0.2.0');
    expect(security.protocol).toBe('file:');
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences());
    expect(preferences?.contextIsolation).toBe(true);
    expect(preferences?.sandbox).toBe(true);
    expect(preferences?.nodeIntegration).toBe(false);
  } finally {
    if (app) await app.close();
  }
});

test('Electron development URL uses the real npm run dev on strict port 5174 without dist', async () => {
  test.skip(guiUnavailable, guiReason);
  test.setTimeout(90_000);
  const env = withoutElectronNodeMode();
  env.MODE_B_STUDIO_DISABLE_GPU = '1';
  env.MODE_B_STUDIO_USER_DATA = resolve('test-results-electron','user-data-development');
  env.R1_ELECTRON_CDP_PORT = process.env.R1_ELECTRON_CDP_PORT || '9337';
  const dist = resolve('dist');
  const backup = resolve('dist.dev-smoke-backup');
  let moved = false;
  let launched: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    // Fail rather than overwrite a different test's backup.
    await expect(access(backup)).rejects.toThrow();
    try { await access(dist); await rename(dist, backup); moved = true; }
    catch { /* clean workspace with no production build output */ }
    // This is the actual combined Vite + Electron launcher, not a separate Vite-only process.
    launched = spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], {
      cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let output = '';
    launched.stdout?.on('data', chunk => { output += String(chunk); });
    launched.stderr?.on('data', chunk => { output += String(chunk); });
    let appPage: import('@playwright/test').Page | undefined;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (launched.exitCode !== null) throw new Error(`npm run dev exited prematurely: ${launched.exitCode}\n${output}`);
      try {
        const res = await fetch('http://127.0.0.1:5174/', { signal: AbortSignal.timeout(600) });
        if (!res.ok) throw new Error(`Dev server HTTP ${res.status}`);
        if (!browser) browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.R1_ELECTRON_CDP_PORT}`, { timeout: 750 });
        appPage = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('http://127.0.0.1:5174'));
        if (appPage) break;
      } catch { /* Vite and Electron may still be starting */ }
      await new Promise(done => setTimeout(done, 500));
    }
    if (!appPage) throw new Error(`No real Electron window connected to localhost:5174 from npm run dev.\n${output}`);
    await expect(appPage.getByRole('heading', { name: 'Project Setup' })).toBeVisible();
    const check = await appPage.evaluate(() => ({
      origin: location.origin,
      bridge: window.studio?.version,
      nodeExposed: typeof (globalThis as typeof globalThis & { require?: unknown }).require !== 'undefined',
      wrongPortResources: performance.getEntriesByType('resource').some(resource => resource.name.includes('127.0.0.1:5173'))
    }));
    expect(check.origin).toBe('http://127.0.0.1:5174');
    expect(check.bridge).toBe('0.2.0');
    expect(check.nodeExposed).toBe(false);
    expect(check.wrongPortResources).toBe(false);
  } finally {
    if (browser) await browser.close();
    if (launched?.pid) {
      try { await execFileAsync('taskkill.exe', ['/PID', String(launched.pid), '/T', '/F']); }
      catch { /* process tree may already have exited */ }
    }
    if (moved) {
      let restored = false;
      for (let attempt = 0; attempt < 8 && !restored; attempt += 1) {
        try { await rename(backup, dist); restored = true; }
        // The final throw is intentional: failure to restore dist is material test damage.
        // eslint-disable-next-line no-unsafe-finally
        catch (error) { if (attempt === 7) throw error; await new Promise(done => setTimeout(done, 500)); }
      }
    }
  }
});
