import fs from 'node:fs';
import { alignmentText, captureAlignmentPin, publishAlignment, validateAlignment } from './alignment.js';
import {generateApiNarration,narrationAction,type JobInput} from './narrationApi.js';
import { acceptNarration, inspectWavBuffer, readState, strictJson } from './services.js';

/** A single API-only narration path for one or many approved sections.
 * No VOICE_STUDIO_ROOT, Python subprocess or producer checkout is required. */
export async function longformStatus(){
  return {status:'API_ONLY',instructions:'Narration uses the configured localhost Nano HTTP API.'};
}
export {narrationAction};
export async function runLongform(root:string,input:JobInput){
  return generateApiNarration(root,input);
}

export function importApprovedWav(root:string,source:string){const real=fs.realpathSync(source);if(!fs.statSync(real).isFile()||fs.statSync(real).size>100*1024*1024)throw new Error('Imported WAV is invalid or too large.');const bytes=fs.readFileSync(real),info=inspectWavBuffer(bytes);if(info.duration>900)throw new Error('Imported WAV exceeds the 900 second owner assembler limit.');const state=readState(root);if(!state.approvedScript)throw new Error('Approve the exact spoken script before importing narration.');return acceptNarration(root,{wav:bytes,expectedScriptSha256:state.approvedScript.sha256,voice:{origin:'IMPORTED_WAV'}})}

export async function importAlignedWords(appPath:string,root:string,source:string){const state=readState(root),pin=captureAlignmentPin(root);if(!state.voice||state.voice.stale||!state.approvedScript)throw new Error('Current imported/verified narration and approved script are required.');const value=strictJson(fs.readFileSync(fs.realpathSync(source),'utf8'))as Record<string,unknown>,incoming=Array.isArray(value.words)?value.words:[];const normalized={...value,words:incoming.map(item=>{const word=item as Record<string,unknown>;return{text:word.text??word.word,start:word.start,end:word.end,loss:word.loss}})},transcript=alignmentText(state.approvedScript.text),words=validateAlignment(normalized,transcript,state.voice.duration??0);return publishAlignment(appPath,root,{...normalized,words},words,transcript,'IMPORTED_WORDS',pin)}
