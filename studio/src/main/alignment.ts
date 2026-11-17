import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, inspectWavBuffer, nativeSkillRoot, readState, resolveProjectFile, runProcess, sha, writeState } from './services.js';

export const alignmentText = (text: string) => text.replace(/\[pause(?:\s+(?:\d+(?:\.\d+)?(?:ms|s)))?\]/gi, ' ').replace(/\s+/g, ' ').trim();
const tokens = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
export type AlignedWord = { word: string; start: number; end: number; loss?: number };

/** For a provider zero-duration word, recover a span ONLY when its own
 * character evidence spells the exact word and has positive timing. */
function characterWordSpans(raw:Record<string,unknown>,words:ReadonlyArray<Record<string,unknown>>):Array<{start:number;end:number}|null>{
  if(!Array.isArray(raw.characters))return words.map(()=>null);
  const table:Array<{begin:number;end:number;start:number;finish:number}>=[];
  let fullText='';
  for(const entry of raw.characters){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))return words.map(()=>null);
    const value=entry as Record<string,unknown>;
    const char=value.text??value.character;
    if(typeof char!=='string'||!char.length||typeof value.start!=='number'||typeof value.end!=='number'||
      !Number.isFinite(value.start)||!Number.isFinite(value.end)||value.start<0||value.end<value.start)
      return words.map(()=>null);
    const begin=fullText.length;fullText+=char;
    table.push({begin,end:fullText.length,start:value.start,finish:value.end});
  }
  let cursor=0;
  const result:Array<{start:number;end:number}|null>=[];
  for(const word of words){
    const text=word.text??word.word;
    if(typeof text!=='string'||!text.length){result.push(null);continue;}
    const at=fullText.indexOf(text,cursor);
    if(at<cursor||fullText.slice(cursor,at).trim()){
      result.push(null);cursor=fullText.length;continue;
    }
    const finish=at+text.length;
    const matching=table.filter(item=>item.begin<finish&&item.end>at);
    if(!matching.length||matching[0].begin!==at||matching[matching.length-1].end!==finish)
      result.push(null);
    else result.push({start:matching[0].start,end:matching[matching.length-1].finish});
    cursor=finish;
  }
  return result;
}

export function validateAlignment(raw: unknown, transcript: string, duration: number): AlignedWord[] {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('ELEVENLABS_ALIGNMENT_INVALID: expected an object.');
  const object=raw as Record<string,unknown>;
  const providerWords=Array.isArray(object.words)?object.words:null;
  if(!providerWords?.length)throw new Error('ElevenLabs returned no words.');
  const rows=providerWords.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new Error('ELEVENLABS_WORD_TIMING_INVALID: invalid word object.');
    return value as Record<string,unknown>;
  });
  const characterEvidence=characterWordSpans(object,rows);
  let prior=0;
  const words=rows.map((value,index)=>{
    const word=value.text??value.word;
    const start=value.start,end=value.end,loss=value.loss;
    const invalid=(reason:string)=>{throw new Error(
      'ELEVENLABS_WORD_TIMING_INVALID: index='+index+' reason='+reason+
      ' start='+String(start)+' end='+String(end)+' audio_duration='+duration.toFixed(4)
    );};
    if(typeof word!=='string'||!word.trim()||
      typeof start!=='number'||typeof end!=='number'||
      !Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start)
      return invalid('MISSING_OR_INVALID_TIMESTAMP');
    if(loss!==undefined&&(typeof loss!=='number'||!Number.isFinite(loss)))
      return invalid('INVALID_LOSS');
    let from=start,to=end;
    if(end===start){
      const evidence=characterEvidence[index];
      if(!evidence||evidence.end<=evidence.start)
        return invalid('ZERO_DURATION_WITHOUT_POSITIVE_CHARACTER_EVIDENCE');
      from=evidence.start;to=evidence.end;
    }
    if(from<prior)return invalid('OVERLAPPING_OR_OUT_OF_ORDER');
    if(to>duration+.05)return invalid('BEYOND_ACCEPTED_WAV_DURATION');
    if(to<=from)return invalid('NON_POSITIVE_DURATION');
    prior=to;
    return {word,start:from,end:to,...(loss===undefined?{}:{loss})};
  });
  const expected=tokens(transcript),actual=tokens(words.map(item=>item.word).join(' '));
  if(expected.length!==actual.length||expected.some((token,index)=>token!==actual[index]))
    throw new Error('ELEVENLABS_WORD_SEQUENCE_MISMATCH: aligned words do not cover the exact approved transcript.');
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
export interface AlignmentPin { projectId:string;scriptRevision:number;scriptSha256:string;transcriptSha256:string;voicePath:string;audioSha256:string;profileId?:string;profileVersion?:number }
export function captureAlignmentPin(root:string):AlignmentPin{const state=readState(root);if(!state.voice||state.voice.stale||!state.approvedScript)throw new Error('Current approved script and narration are required.');const audio=fs.readFileSync(resolveProjectFile(root,state.voice.path)),wav=inspectWavBuffer(audio),transcript=alignmentText(state.approvedScript.text);if(wav.sha256!==state.voice.sha256)throw new Error('Narration bytes changed; alignment is stale.');return{projectId:state.project.id,scriptRevision:state.approvedScript.revision,scriptSha256:state.approvedScript.sha256,transcriptSha256:sha(transcript),voicePath:state.voice.path,audioSha256:wav.sha256,profileId:state.voice.profileId,profileVersion:state.voice.profileVersion}}
function assertAlignmentPin(root:string,pin:AlignmentPin){const current=captureAlignmentPin(root);if(JSON.stringify(current)!==JSON.stringify(pin))throw new Error('BLOCKED: approved script, transcript, narration WAV or voice profile changed during alignment.');return current}

export async function publishAlignment(appPath: string, root: string, raw: Record<string, unknown>, words: AlignedWord[], transcript: string, origin: 'ELEVENLABS' | 'IMPORTED_WORDS', expectedPin=captureAlignmentPin(root), runner=runProcess) {
  assertAlignmentPin(root,expectedPin);if(sha(transcript)!==expectedPin.transcriptSha256)throw new Error('BLOCKED: alignment transcript does not match the pinned approved script.');
  const audio = fs.readFileSync(resolveProjectFile(root, expectedPin.voicePath)), wav = inspectWavBuffer(audio);
  const characters = validateCharacters(raw, wav.duration), stamp = `${Date.now()}-${randomSuffix()}`;
  const relative = `.studio/alignment/words-${stamp}.json`, captionsRelative = `.studio/alignment/captions-${stamp}.json`;
  const originalWords=Array.isArray(raw.words)?raw.words as Array<Record<string,unknown>>:[];
  const timingRepairs=words.flatMap((word,index)=>{
    const original=originalWords[index];
    if(!original||typeof original.start!=='number'||typeof original.end!=='number'||
      (original.start===word.start&&original.end===word.end))return [];
    return [{index,reason:'POSITIVE_CHARACTER_TIMING_FOR_ZERO_DURATION_WORD',
      provider_start:original.start,provider_end:original.end,
      character_start:word.start,character_end:word.end}];
  });
  const evidence = { schema: 'mode-b-word-alignment-v1', origin, transcript, audio_sha256: wav.sha256, script_sha256: sha(transcript), words, ...(characters ? { characters } : {}), ...(raw.loss === undefined ? {} : { loss: raw.loss }), ...(timingRepairs.length ? {timing_repairs:timingRepairs}: {}) };
  const target = resolveProjectFile(root, relative), captionsTarget = resolveProjectFile(root, captionsRelative),staging=resolveProjectFile(root,`.studio/alignment/.staging-${stamp}`),stagedWords=path.join(staging,'words.json'),stagedCaptions=path.join(staging,'captions.json');
  fs.mkdirSync(staging,{recursive:true});
  try{atomicJson(stagedWords,evidence);assertAlignmentPin(root,expectedPin);
    const { cli } = nativeSkillRoot(appPath), result = await runner(process.execPath,[cli,'captions',stagedWords,stagedCaptions],{ cwd: path.dirname(cli), timeout: 60_000 });
    if (result.code !== 0) throw new Error(result.stderr || 'Original captions command failed.');
    assertAlignmentPin(root,expectedPin);if(!fs.existsSync(stagedCaptions))throw new Error('Original captions command did not publish cues.');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(stagedWords,target);fs.renameSync(stagedCaptions,captionsTarget);
    const latest=readState(root);assertAlignmentPin(root,expectedPin);
    latest.alignment = { path: relative, captionsPath: captionsRelative, audioSha256: wav.sha256, scriptSha256: sha(transcript), wordsSha256: sha(fs.readFileSync(target)), cuesSha256: sha(fs.readFileSync(captionsTarget)), origin, words, ...(characters ? { characters } : {}), ...(typeof raw.loss === 'number' ? { loss: raw.loss } : {}), generatedAt: new Date().toISOString() };
    latest.preview = undefined; latest.approval = undefined; latest.render = undefined; writeState(root, latest); return latest.alignment;
  }catch(error){for(const file of [target,captionsTarget])if(fs.existsSync(file))fs.unlinkSync(file);throw error}finally{if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true})}
}

export async function alignWithElevenLabs(appPath: string, root: string, authorized: boolean, configuredKey?:string) {
  if (authorized !== true) throw new Error('Explicit cloud-upload authorization is required.');
  const key = configuredKey ?? process.env.ELEVENLABS_API_KEY; if (!key) throw new Error('Configure ElevenLabs API key in Settings or set ELEVENLABS_API_KEY in the Electron main-process environment.');
  const state = readState(root); if (!state.voice || state.voice.stale || !state.approvedScript) throw new Error('Current approved script and verified narration are required.');const pin=captureAlignmentPin(root);
  const audio = fs.readFileSync(resolveProjectFile(root, state.voice.path)), wav = inspectWavBuffer(audio); if (wav.sha256 !== state.voice.sha256) throw new Error('Narration bytes changed; alignment is stale.');
  const transcript = alignmentText(state.approvedScript.text), form = new FormData(); form.append('file', new Blob([audio], { type: 'audio/wav' }), 'narration.wav'); form.append('text', transcript);
  const response = await fetch(endpoint(), { method: 'POST', headers: { 'xi-api-key': key }, body: form, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`ElevenLabs forced alignment failed (${response.status}).`);
  const raw = await response.json() as Record<string, unknown>, words = validateAlignment(raw, transcript, wav.duration);
  assertAlignmentPin(root,pin);return publishAlignment(appPath, root, raw, words, transcript, 'ELEVENLABS',pin);
}
