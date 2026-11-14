// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectWav, resolveProjectFile, strictJson } from '../../src/main/services';
const temporary: string[] = [];
afterEach(() => { for (const item of temporary.splice(0)) fs.rmSync(item, { recursive: true, force: true }); });
const project = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-b-r2-')); temporary.push(root); return root; };
describe('secure R2 main services', () => {
  it('rejects duplicate and prototype JSON keys', () => {
    expect(() => strictJson('{"schema":"a","schema":"b"}')).toThrow(/Duplicate/);
    expect(() => strictJson('{"nested":{"__proto__":{}}}')).toThrow(/Forbidden/);
  });
  it('requires object roots and bounded valid JSON', () => {
    expect(() => strictJson('[1,2]')).toThrow(/root/); expect(strictJson('{"ok":true}')).toEqual({ ok: true });
  });
  it('bounds JSON nesting depth', () => { expect(() => strictJson('{"x":'.repeat(65) + '0' + '}'.repeat(65))).toThrow(/64 levels/); });
  it('confines files to the project and rejects executables', () => {
    const root = project(); expect(resolveProjectFile(root, 'assets/image.png')).toBe(path.join(root, 'assets', 'image.png'));
    expect(() => resolveProjectFile(root, '../escape.png')).toThrow(/escapes/); expect(() => resolveProjectFile(root, 'payload.cmd')).toThrow(/Executable/);
  });
  it('verifies the exact Nano WAV format', () => {
    const root = project(); const file = path.join(root, 'voice.wav'); const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(24000,24); bytes.writeUInt32LE(48000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(2,40); fs.writeFileSync(file,bytes);
    expect(inspectWav(file)).toMatchObject({ channels: 1, sampleRate: 24000, bits: 16 }); bytes.writeUInt32LE(44100,24); fs.writeFileSync(file,bytes); expect(() => inspectWav(file)).toThrow(/24 kHz/);
  });
  it('keeps the preload bridge narrow and hides raw Electron IPC', () => {
    const preload = fs.readFileSync(path.resolve('src/preload/index.cts'), 'utf8'); expect(preload).toContain('contextBridge.exposeInMainWorld'); expect(preload).not.toContain('ipcRenderer:'); expect(preload).not.toContain('send: ipcRenderer');
  });
  it('spawns native commands without a shell', () => { expect(fs.readFileSync(path.resolve('src/main/services.ts'),'utf8')).toContain('shell: false'); });
  it('contains no G-Labs or embedded LLM route', () => { const source = fs.readFileSync(path.resolve('src/main/index.ts'),'utf8'); expect(source.toLowerCase()).not.toContain('g-labs'); expect(source).not.toContain('openai.com/v1'); });
  it('binds alignment through the original captions command', () => { const source = fs.readFileSync(path.resolve('src/main/index.ts'),'utf8'); expect(source).toContain("[cli, 'captions', target, captionsTarget]"); });
  it('marks uncertain Nano transport without automatic replay', () => { const source = fs.readFileSync(path.resolve('src/main/index.ts'),'utf8'); expect(source).toContain('outcome is uncertain'); expect(source.match(/\/v1\/audio\/speech/g)).toHaveLength(1); });
});
