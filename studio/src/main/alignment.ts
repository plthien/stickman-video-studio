import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, nativeSkillRoot, readState, resolveProjectFile, runProcess, sha, writeState } from './services.js';
import { inspectWavBuffer } from './nanoClient.js';

export const alignmentText = (text: string) => text.replace(/\[pause(?:\s+(?:\d+(?:\.\d+)?(?:ms|s)))?\]/gi, ' ').replace(/\s+/g, ' ').trim();
const tokens = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
export type AlignedWord = { word: string; start: number; end: number; loss?: number };

export function validateAlignment(raw: unknown, transcript: string, duration: number): AlignedWord[] {
  const object = raw as Record<string, unknown>, providerWords = Array.isArray(object.words) ? object.words : null;
  if (!providerWords?.length) throw new Error('ElevenLabs returned no words.');
  let prior = 0;
  const words = providerWords.map(item => {
    const value = item as Record<string, unknown>, text = value.text ?? value.word;
    if (typeof text !== 'string' || !text.trim() || typeof value.start !== 'number' || typeof value.end !== 'number' || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start < prior || value.end <= value.start || value.end > duration + .05 || (value.loss !== undefined && (typeof value.loss !== 'number' || !Number.isFinite(value.loss)))) throw new Error('ElevenLabs word timing is invalid or truncated.');
    prior = value.end;
    return { word: text, start: value.start, end: value.end, ...(value.loss === undefined ? {} : { loss: value.loss }) };
  });
  const expected = tokens(transcript), actual = tokens(words.map(item => item.word).join(' '));
  if (expected.length !== actual.length || expected.some((token, index) => token !== actual[index])) throw new Error('ElevenLabs word sequence does not cover the exact approved transcript.');
  return words;
}

function validateCharacters(raw: Record<string, unknown>, duration: number) {
  if (raw.characters === undefined) return undefined;
  if (!Array.isArray(raw.characters)) throw new Error('ElevenLabs characters evidence is invalid.');
  let prior = 0;
  return raw.characters.map(item => {
    const value = item as Record<string, unknown>, character = value.character ?? value.text;
    if (typeof character !== 'string' || typeof value.start !== 'number' || typeof value.end !== 'number' || value.start < prior || value.end < value.start || value.end > duration + .05) throw new Error('ElevenLabs character timing is invalid.');
    prior = value.end;
    return { ...value, character };
  });
}

function endpoint() {
  const official = 'https://api.elevenlabs.io/v1/forced-alignment', configured = process.env.ELEVENLABS_ALIGNMENT_URL ?? official, url = new URL(configured);
  if (configured !== official && !(process.env.NODE_ENV === 'test' && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) throw new Error('Invalid ElevenLabs alignment endpoint.');
  return url;
}

const randomSuffix = () => Math.random().toString(16).slice(2, 10);

export async function publishAlignment(appPath: string, root: string, raw: Record<string, unknown>, words: AlignedWord[], transcript: string, origin: 'ELEVENLABS' | 'IMPORTED_WORDS') {
  const state = readState(root);
  if (!state.voice || state.voice.stale || !state.approvedScript) throw new Error('Current approved script and narration are required.');
  const audio = fs.readFileSync(resolveProjectFile(root, state.voice.path)), wav = inspectWavBuffer(audio);
  if (wav.sha256 !== state.voice.sha256) throw new Error('Narration bytes changed; alignment is stale.');
  const characters = validateCharacters(raw, wav.duration), stamp = `${Date.now()}-${randomSuffix()}`;
  const relative = `.studio/alignment/words-${stamp}.json`, captionsRelative = `.studio/alignment/captions-${stamp}.json`;
  const evidence = { schema: 'mode-b-word-alignment-v1', origin, transcript, audio_sha256: wav.sha256, script_sha256: sha(transcript), words, ...(characters ? { characters } : {}), ...(raw.loss === undefined ? {} : { loss: raw.loss }) };
  const target = resolveProjectFile(root, relative), captionsTarget = resolveProjectFile(root, captionsRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); atomicJson(target, evidence);
  const { cli } = nativeSkillRoot(appPath), result = await runProcess(process.execPath,[cli,'captions',target,captionsTarget],{ cwd: path.dirname(cli), timeout: 60_000 });
  if (result.code !== 0) throw new Error(result.stderr || 'Original captions command failed.');
  state.alignment = { path: relative, captionsPath: captionsRelative, audioSha256: wav.sha256, scriptSha256: sha(transcript), wordsSha256: sha(fs.readFileSync(target)), cuesSha256: sha(fs.readFileSync(captionsTarget)), origin, words, ...(characters ? { characters } : {}), ...(typeof raw.loss === 'number' ? { loss: raw.loss } : {}), generatedAt: new Date().toISOString() };
  state.preview = undefined; state.approval = undefined; state.render = undefined; writeState(root, state); return state.alignment;
}

export async function alignWithElevenLabs(appPath: string, root: string, authorized: boolean) {
  if (authorized !== true) throw new Error('Explicit cloud-upload authorization is required.');
  const key = process.env.ELEVENLABS_API_KEY; if (!key) throw new Error('ELEVENLABS_API_KEY is not configured in the Electron main-process environment.');
  const state = readState(root); if (!state.voice || state.voice.stale || !state.approvedScript) throw new Error('Current approved script and verified narration are required.');
  const audio = fs.readFileSync(resolveProjectFile(root, state.voice.path)), wav = inspectWavBuffer(audio); if (wav.sha256 !== state.voice.sha256) throw new Error('Narration bytes changed; alignment is stale.');
  const transcript = alignmentText(state.approvedScript.text), form = new FormData(); form.append('file', new Blob([audio], { type: 'audio/wav' }), 'narration.wav'); form.append('text', transcript);
  const response = await fetch(endpoint(), { method: 'POST', headers: { 'xi-api-key': key }, body: form, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`ElevenLabs forced alignment failed (${response.status}).`);
  const raw = await response.json() as Record<string, unknown>, words = validateAlignment(raw, transcript, wav.duration);
  return publishAlignment(appPath, root, raw, words, transcript, 'ELEVENLABS');
}
