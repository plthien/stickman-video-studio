import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electronPath = createRequire(import.meta.url)('electron');
const devUrl = 'http://127.0.0.1:5174';
const env = { ...process.env, VITE_DEV_SERVER_URL: devUrl };
delete env.ELECTRON_RUN_AS_NODE;
// A localhost-only debugging socket is enabled *only* by the opt-in R1 Windows smoke test.
const smokePort = env.R1_ELECTRON_CDP_PORT;
if (smokePort && !/^\d{4,5}$/.test(smokePort)) throw new Error('R1_ELECTRON_CDP_PORT must be numeric');
const testNoSandbox = env.MODE_B_STUDIO_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
const electronArgs = smokePort
  ? ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${smokePort}`, ...testNoSandbox, '.']
  : [...testNoSandbox, '.'];
const child = spawn(electronPath, electronArgs, { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', windowsHide: false });
console.info(`R1 Electron dev: ${devUrl}`);
child.once('exit', code => { process.exitCode = code ?? 1; });
child.once('error', error => { console.error('Electron dev failed:', error); process.exitCode = 1; });
