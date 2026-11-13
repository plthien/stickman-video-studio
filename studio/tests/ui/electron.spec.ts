import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
const electronPath = createRequire(import.meta.url)('electron') as string;

test('Electron shell starts and retains secure BrowserWindow preferences', async () => {
  test.skip(Boolean(process.env.ELECTRON_RUN_AS_NODE), 'Managed runner forces Electron into Node mode; run on a normal Windows desktop.');
  delete process.env.ELECTRON_RUN_AS_NODE;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  // The managed Windows runner cannot create Chromium's OS sandbox token; production does not pass this flag.
  const app = await electron.launch({ executablePath: electronPath, args: ['.', '--in-process-gpu', '--disable-software-rasterizer', '--no-sandbox'], env });
  try {
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
