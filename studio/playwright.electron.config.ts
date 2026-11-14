import { defineConfig } from '@playwright/test';

/** Electron tests launch the real desktop application; they must not require a Vite preview web server. */
export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/electron.spec.ts',
  outputDir: process.env.R1_ELECTRON_RESULTS || './test-results-electron',
  timeout: 90_000,
  workers: 1,
  use: { trace: 'retain-on-failure' }
});
