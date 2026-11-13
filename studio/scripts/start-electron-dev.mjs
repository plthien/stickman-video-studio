import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electronPath = createRequire(import.meta.url)('electron');
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ['.'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', windowsHide: false });
child.once('exit', code => process.exitCode = code ?? 1);
child.once('error', error => { console.error(error); process.exitCode = 1; });
