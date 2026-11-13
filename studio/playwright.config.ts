import { defineConfig, devices } from '@playwright/test';

const requestedPort = process.env.R1_PREVIEW_PORT || '4173';
const previewPort = Number(requestedPort);
if (!Number.isInteger(previewPort) || previewPort < 1024 || previewPort > 65535 || previewPort === 5174) {
  throw new Error(`Invalid R1_PREVIEW_PORT: ${requestedPort}. Choose an available localhost TCP port other than development port 5174.`);
}
const previewUrl = `http://127.0.0.1:${previewPort}`;
export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/r1.spec.ts',
  outputDir: process.env.R1_SCREENSHOTS || './test-results',
  timeout: 30_000,
  use: { baseURL: previewUrl, trace: 'retain-on-failure' },
  webServer: {
    command: `npx.cmd vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
