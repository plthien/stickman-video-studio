import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import { atomicJson, inspectWavBuffer, nativeSkillRoot, readState, resolveProjectFile, runProcess, sha, strictJson, writeState } from './services.js';

export const alignmentText = (text: string) => text.replace(/\[pause(?:\s+(?:\d+(?:\.\d+)?(?:ms|s)))?\]/gi, ' ').replace(/\s+/g, ' ').trim();
const tokens = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
export type AlignedWord = { word: string; start: number; end: number; loss?: number };

/** Canonical timing comes from exact character evidence, not vendor word rows.
 * A malformed character payload fails closed rather than falling back to words. */
function canonicalCharacterWords(raw:Record<string,unknown>,transcript:string,duration:number):AlignedWord[]|undefined{
  if(raw.characters===undefined)return undefined;
  if(!Array.isArray(raw.characters)||!raw.characters.length)
    throw new Error('ELEVENLABS_CHARACTER_TIMING_INVALID: no character evidence.');
  const characters:Array<{begin:number;finish:number;start:number;end:number}>=[];
  let reconstructed='',previousStart=0,previousEnd=0;
  for(const [index,item] of raw.characters.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item))
      throw new Error('ELEVENLABS_CHARACTER_TIMING_INVALID: index='+index+' invalid object.');
    const value=item as Record<string,unknown>,text=value.text??value.character;
    const start=value.start,end=value.end;
    if(typeof text!=='string'||!text.length||typeof start!=='number'||typeof end!=='number'||
      !Number.isFinite(start)||!Number.isFinite(end)||start<previousStart||end<previousEnd||end<start||
      end>duration+1/24000)
      throw new Error('ELEVENLABS_CHARACTER_TIMING_INVALID: index='+index+' invalid timing/text.');
    const begin=reconstructed.length;reconstructed+=text;
    characters.push({begin,finish:reconstructed.length,start,end});
    previousStart=start;previousEnd=end;
  }
  if(reconstructed!==transcript)
    throw new Error('ELEVENLABS_CHARACTER_TEXT_MISMATCH: character evidence must exactly reconstruct approved transcript.');
  const spans=[...transcript.matchAll(/[\p{L}\p{N}']+/gu)];
  if(!spans.length)throw new Error('ELEVENLABS_CHARACTER_TIMING_INVALID: no spoken words.');
  let previousWordEnd=0;
  const words=spans.map((match,index)=>{
    const begin=match.index??-1;
    if(begin<0)throw new Error('ELEVENLABS_CHARACTER_COVERAGE_INVALID: missing transcript match index.');
    const finish=begin+match[0].length;
    const covered=characters.filter(x=>x.finish>begin&&x.begin<finish);
    if(!covered.length||covered[0].begin>begin||covered[covered.length-1].finish<finish)
      throw new Error('ELEVENLABS_CHARACTER_COVERAGE_INVALID: index='+index);
    const start=covered[0].start,end=covered[covered.length-1].end;
    if(end<=start||start<previousWordEnd||end>duration+1/24000)
      throw new Error('ELEVENLABS_CHARACTER_WORD_TIMING_INVALID: index='+index);
    previousWordEnd=end;
    const vendor=Array.isArray(raw.words)?raw.words[index]:null;
    const row=vendor&&typeof vendor==='object'&&!Array.isArray(vendor)?vendor as Record<string,unknown>:null;
    const loss=row?.loss;
    return {word:match[0],start,end,...(row&&(row.text??row.word)===match[0]&&
      typeof loss==='number'&&Number.isFinite(loss)?{loss}:{})};
  });
  return words;
}

/** Strict word-only compatibility for providers that supply no characters. */
function strictProviderWords(raw:Record<string,unknown>,transcript:string,duration:number):AlignedWord[]{
  if(!Array.isArray(raw.words)||!raw.words.length)
    throw new Error('ELEVENLABS_WORD_TIMING_INVALID: provider returned no usable words or characters.');
  let previous=0;
  const words=raw.words.map((entry,index)=>{
    const value=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry as Record<string,unknown>:null;
    const word=value?.text??value?.word,start=value?.start,end=value?.end,loss=value?.loss;
    const invalid=(reason:string):never=>{throw new Error(
      'ELEVENLABS_WORD_TIMING_INVALID: index='+index+' reason='+reason+
      ' start='+String(start)+' end='+String(end)+' audio_duration='+duration.toFixed(4)
    )};
    if(typeof word!=='string'||!word.trim())return invalid('MISSING_OR_INVALID_WORD');
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||
      !Number.isFinite(end)||start<0||end<start)return invalid('MISSING_OR_INVALID_TIMESTAMP');
    if(end===start)return invalid('ZERO_DURATION_WITHOUT_POSITIVE_CHARACTER_EVIDENCE');
    if(start<previous)return invalid('OVERLAPPING_OR_OUT_OF_ORDER');
    if(end>duration+.05)return invalid('BEYOND_ACCEPTED_WAV_DURATION');
    if(loss!==undefined&&(typeof loss!=='number'||!Number.isFinite(loss)))return invalid('INVALID_LOSS');
    previous=end;
    return {word,start,end,...(loss===undefined?{}:{loss})};
  });
  const expected=tokens(transcript),actual=tokens(words.map(item=>item.word).join(' '));
  if(expected.length!==actual.length||expected.some((word,index)=>word!==actual[index]))
    throw new Error('ELEVENLABS_WORD_SEQUENCE_MISMATCH: provider words do not cover approved transcript.');
  return words;
}
export function validateAlignment(raw:unknown,transcript:string,duration:number):AlignedWord[]{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Number.isFinite(duration)||duration<=0)
    throw new Error('ELEVENLABS_ALIGNMENT_INVALID: expected response and positive audio duration.');
  const object=raw as Record<string,unknown>;
  return canonicalCharacterWords(object,transcript,duration)??strictProviderWords(object,transcript,duration);
}
function validateCharacters(raw:Record<string,unknown>,duration:number){
  if(raw.characters===undefined)return undefined;
  if(!Array.isArray(raw.characters))throw new Error('ElevenLabs characters evidence is invalid.');
  let previousStart=0,previousEnd=0;
  return raw.characters.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))
      throw new Error('ElevenLabs character evidence is invalid at index '+index);
    const value=item as Record<string,unknown>,character=value.text??value.character;
    if(typeof character!=='string'||!character.length||typeof value.start!=='number'||
      typeof value.end!=='number'||!Number.isFinite(value.start)||!Number.isFinite(value.end)||
      value.start<previousStart||value.end<previousEnd||value.end<value.start||value.end>duration+1/24000)
      throw new Error('ElevenLabs character timing is invalid at index '+index);
    previousStart=value.start;previousEnd=value.end;
    return {...value,character};
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
    return [{index,reason:'CHARACTER_FIRST_CANONICAL_DERIVATION',
      provider_start:original.start,provider_end:original.end,
      character_start:word.start,character_end:word.end}];
  });
  const evidence = { schema: 'mode-b-word-alignment-v1', origin, transcript, audio_sha256: wav.sha256, script_sha256: sha(transcript), words, ...(characters ? { characters } : {}), ...(typeof raw.loss === 'number' && Number.isFinite(raw.loss) ? { loss: raw.loss } : {}), ...(timingRepairs.length ? {timing_repairs:timingRepairs}: {}) };
  const target = resolveProjectFile(root, relative), captionsTarget = resolveProjectFile(root, captionsRelative),staging=resolveProjectFile(root,`.studio/alignment/.staging-${stamp}`),stagedWords=path.join(staging,'words.json'),stagedCaptions=path.join(staging,'captions.json');
  fs.mkdirSync(staging,{recursive:true});
  try{atomicJson(stagedWords,evidence);assertAlignmentPin(root,expectedPin);
    const { cli } = nativeSkillRoot(appPath), result = await runner(process.execPath,[cli,'captions',stagedWords,stagedCaptions],{ cwd: path.dirname(cli), timeout: 60_000 });
    if (result.code !== 0) throw new Error(result.stderr || 'Original captions command failed.');
    assertAlignmentPin(root,expectedPin);if(!fs.existsSync(stagedCaptions))throw new Error('Original captions command did not publish cues.');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(stagedWords,target);fs.renameSync(stagedCaptions,captionsTarget);
    const latest=readState(root);assertAlignmentPin(root,expectedPin);
    const previous=latest.alignment,newWordsSha=sha(fs.readFileSync(target)),newCoreSha=sha(fs.readFileSync(captionsTarget));
    let preserveReview=false;
    if(previous?.captionReview&&previous.audioSha256===wav.sha256&&
      previous.scriptSha256===sha(transcript)&&previous.wordsSha256===newWordsSha&&previous.cuesSha256===newCoreSha){
      try{
        const {getCaptionReview}=await import('./captionReview.js');
        preserveReview=['VERIFIED','AUTO_VERIFIED'].includes(getCaptionReview(root).status);
      }catch{/* A missing/corrupt old review is never inherited. */}
    }
    latest.alignment = { path: relative, captionsPath: captionsRelative, audioSha256: wav.sha256, scriptSha256: sha(transcript), wordsSha256:newWordsSha, cuesSha256:newCoreSha, origin, words, ...(characters ? { characters } : {}), ...(typeof raw.loss === 'number' ? { loss: raw.loss } : {}), generatedAt: new Date().toISOString(),
      ...(preserveReview?{captionReview:previous!.captionReview,captionDraft:previous!.captionDraft}:{}) };
    if(!preserveReview){
      if(latest.tasks?.native)latest.tasks.native.status='STALE';
      latest.nativeReadiness=undefined;latest.preview=undefined;latest.approval=undefined;latest.render=undefined;
    }
    writeState(root, latest);
    // R3: Local word-boundary regroup only. Never re-upload to ElevenLabs or edit WAV.
    try{
      const {autoCaptionReview,ensureCaptionAuthorTask}=await import('./captionReview.js');
      if(readState(root).identityPolicy==='v1')ensureCaptionAuthorTask(root);
      autoCaptionReview(root);
    }catch(error){
      const now=readState(root);
      if(now.alignment && now.alignment.wordsSha256===latest.alignment.wordsSha256){
        now.alignment.captionAutoError=error instanceof Error?error.message:String(error);
        writeState(root,now); // Alignment remains accepted; captions explicitly need review.
      }
    }
    return readState(root).alignment!;
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
  const body=await response.text();
  if(Buffer.byteLength(body,'utf8')>2*1024*1024)throw new Error('ELEVENLABS_RESPONSE_TOO_LARGE');
  persistAlignmentResponse(root,pin,body); // Preserve the exact successful HTTP text before JSON parsing.
  const raw=JSON.parse(body) as Record<string,unknown>;
  const words=validateAlignment(raw,transcript,wav.duration);
  assertAlignmentPin(root,pin);return publishAlignment(appPath,root,raw,words,transcript,'ELEVENLABS',pin);
}

/** Persist successful vendor evidence before normalization so timing can be
 * repaired locally without a second billable upload. No API key is stored. */
export function persistAlignmentResponse(root:string,pin:AlignmentPin,raw:Record<string,unknown>|string){
  const payload=typeof raw==='string'?raw:JSON.stringify(raw);
  if(Buffer.byteLength(payload,'utf8')>2*1024*1024)throw new Error('ELEVENLABS_RESPONSE_TOO_LARGE');
  const requestId=randomUUID();
  const relative='.studio/alignment/provider-'+requestId+'.json';
  atomicJson(resolveProjectFile(root,relative),{
    schema:'elevenlabs-response-evidence-v1',requestId,projectId:pin.projectId,
    approvedTranscriptSha256:pin.transcriptSha256,approvedScriptSha256:pin.scriptSha256,
    acceptedWavSha256:pin.audioSha256,pin,responseSha256:sha(payload),responseText:payload
  });
  return relative;
}
export function eligibleAlignmentResponse(root:string,pin=captureAlignmentPin(root)){
  const dir=resolveProjectFile(root,'.studio/alignment');
  if(!fs.existsSync(dir))return null;
  const candidates=fs.readdirSync(dir).filter(x=>/^provider-[\w-]+\.json$/.test(x))
    .sort((a,b)=>fs.statSync(path.join(dir,b)).mtimeMs-fs.statSync(path.join(dir,a)).mtimeMs);
  for(const name of candidates){
    const value=strictJson(fs.readFileSync(resolveProjectFile(root,'.studio/alignment/'+name),'utf8')) as Record<string,unknown>;
    if(value.schema!=='elevenlabs-response-evidence-v1'||JSON.stringify(value.pin)!==JSON.stringify(pin))
      continue;
    const body=value.responseText;
    if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>2*1024*1024||sha(body)!==value.responseSha256)
      throw new Error('ELEVENLABS_RESPONSE_EVIDENCE_CORRUPT');
    let raw:unknown;
    try{raw=JSON.parse(body);}catch{throw new Error('ELEVENLABS_RESPONSE_EVIDENCE_MALFORMED_JSON');}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))
      throw new Error('ELEVENLABS_RESPONSE_EVIDENCE_INVALID_JSON');
    return raw as Record<string,unknown>;
  }
  return null;
}
export async function repairAlignmentTiming(appPath:string,root:string){
  const pin=captureAlignmentPin(root),raw=eligibleAlignmentResponse(root,pin);
  if(!raw)throw new Error('ELEVENLABS_RESPONSE_EVIDENCE_MISSING: explicitly authorize a new request in order to align.');
  const state=readState(root),transcript=alignmentText(state.approvedScript!.text);
  const audio=inspectWavBuffer(fs.readFileSync(resolveProjectFile(root,pin.voicePath)));
  const words=validateAlignment(raw,transcript,audio.duration);
  assertAlignmentPin(root,pin);
  const prior=readState(root).alignment;
  if(prior&&prior.audioSha256===pin.audioSha256&&prior.scriptSha256===sha(transcript)&&
    JSON.stringify(prior.words)===JSON.stringify(words)&&prior.wordsSha256&&prior.cuesSha256){
    const wordFile=resolveProjectFile(root,prior.path),cueFile=resolveProjectFile(root,prior.captionsPath);
    if(fs.existsSync(wordFile)&&fs.existsSync(cueFile)&&
      sha(fs.readFileSync(wordFile))===prior.wordsSha256&&
      sha(fs.readFileSync(cueFile))===prior.cuesSha256)
      return prior; // Byte-identical timing: do not invalidate existing caption approval.
  }
  return publishAlignment(appPath,root,raw,words,transcript,'ELEVENLABS',pin);
}
