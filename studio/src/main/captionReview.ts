import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { alignmentText } from './alignment.js';
import { atomicJson, readState, resolveProjectFile, sha, strictJson, writeState } from './services.js';

export interface CaptionCue { start: number; end: number; text: string }
export interface CaptionReviewRecord {
  revision: number; path: string; sha256: string; sourceSha256: string; note: string; approvedAt: string;
}
export interface CaptionDraftRecord { path: string; sha256: string; sourceSha256: string; boundaries: number[] }
const normalized = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const cueText = (words: Array<{word:string}>) => words.map(w => w.word.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function inputs(root: string) {
  const state = readState(root), alignment = state.alignment, voice = state.voice, script = state.approvedScript;
  if (!alignment || !voice || voice.stale || !script) throw new Error('Approved script, WAV and real aligned WORDS are required.');
  const audio = fs.readFileSync(resolveProjectFile(root, voice.path));
  if (sha(audio) !== voice.sha256 || alignment.audioSha256 !== voice.sha256) throw new Error('Caption source WAV is stale.');
  const spokenSha = sha(alignmentText(script.text));
  if (alignment.scriptSha256 !== spokenSha) throw new Error('Caption source transcript changed.');
  const wordBytes = fs.readFileSync(resolveProjectFile(root, alignment.path));
  if (sha(wordBytes) !== alignment.wordsSha256) throw new Error('Caption source WORDS changed.');
  const raw = strictJson(wordBytes.toString('utf8')) as Record<string, unknown>;
  if (!Array.isArray(raw.words) || !raw.words.length) throw new Error('Aligned WORDS are missing.');
  const words = raw.words as Array<{word:string;start:number;end:number}>;
  let previous = 0;
  for (const word of words) {
    if (typeof word.word !== 'string' || !word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous || word.end <= word.start || word.end > (voice.duration ?? Infinity) + .05) throw new Error('Invalid real WORDS timing.');
    previous = word.end;
  }
  if (!same(normalized(cueText(words)), normalized(alignmentText(script.text)))) throw new Error('WORDS do not cover the approved spoken text.');
  const originalBytes = fs.readFileSync(resolveProjectFile(root, alignment.captionsPath));
  if (sha(originalBytes) !== alignment.cuesSha256) throw new Error('Original Core captions changed.');
  const original = JSON.parse(originalBytes.toString('utf8')) as CaptionCue[];
  if (!Array.isArray(original) || !original.length) throw new Error('Original grouped captions are unavailable.');
  const offset = original[0].start - words[0].start;
  if (!Number.isFinite(offset) || Math.abs(offset) > 5) throw new Error('Original Core caption time offset is invalid.');
  const sourceSha256 = sha(JSON.stringify({audio:voice.sha256,script:spokenSha,words:alignment.wordsSha256,original:alignment.cuesSha256,offset}));
  return {state, alignment, words, original, offset, sourceSha256, duration: voice.duration ?? Infinity};
}
function boundariesFromCues(words: Array<{word:string}>, cues: CaptionCue[]) {
  const ends:number[] = [];let cursor=0;
  for (const cue of cues) {
    if (!cue || typeof cue.text !== 'string') throw new Error('Caption cue is invalid.');
    const want = normalized(cue.text);let next = cursor;
    while (next < words.length && normalized(cueText(words.slice(cursor,next+1))).length < want.length) next += 1;
    if (next >= words.length || !same(normalized(cueText(words.slice(cursor,next+1))), want)) throw new Error('Original captions do not cover exact real WORDS.');
    ends.push(next + 1); cursor = next + 1;
  }
  if (cursor !== words.length) throw new Error('Original captions omit real WORDS.');
  return ends;
}
function buildCues(words: Array<{word:string;start:number;end:number}>, ends: number[], offset: number, duration: number): CaptionCue[] {
  if (!Array.isArray(ends) || !ends.length || ends.some(n => !Number.isSafeInteger(n) || n < 1 || n > words.length) || ends.at(-1) !== words.length) throw new Error('Caption boundaries must cover all real words.');
  const cues: CaptionCue[] = [];let cursor=0,previous=0;
  for (const endIndex of ends) {
    if (endIndex <= cursor) throw new Error('Caption boundaries must increase.');
    const group=words.slice(cursor,endIndex),start=group[0].start+offset,end=group.at(-1)!.end+offset,text=cueText(group);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previous-1e-8 || end<=start || end>duration+.05 || !text.trim() || /[\r\n]/.test(text) || text.length>58 || group.length>8 || end-start>3.5+1e-8) throw new Error('Caption violates original timing, one-line readability or word grouping policy.');
    cues.push({start,end,text});cursor=endIndex;previous=end;
  }
  return cues;
}
export function getCaptionReview(root: string) {
  const {state,words,original,offset,sourceSha256,duration}=inputs(root);
  const originalBoundaries=boundariesFromCues(words,original);
  const grouped=buildCues(words,originalBoundaries,offset,duration);
  if (original.some((cue,index)=>!same(cue,grouped[index]))) throw new Error('Original grouped captions do not match word boundaries.');
  const review=state.alignment?.captionReview;
  const validReview=review && review.sourceSha256===sourceSha256 && fs.existsSync(resolveProjectFile(root,review.path)) && sha(fs.readFileSync(resolveProjectFile(root,review.path)))===review.sha256;
  const draft=state.alignment?.captionDraft;
  const validDraft=draft && draft.sourceSha256===sourceSha256 && fs.existsSync(resolveProjectFile(root,draft.path)) && sha(fs.readFileSync(resolveProjectFile(root,draft.path)))===draft.sha256;
  return {words,original,sourceSha256,approved: validReview ? { ...review, cues: readCues(root, review!.path) } : null,
    draft: validDraft ? { ...draft, cues: readCues(root,draft!.path) } : null,
    originalBoundaries,shift:offset};
}
function readCues(root:string,relative:string):CaptionCue[] {
  const value=JSON.parse(fs.readFileSync(resolveProjectFile(root,relative),'utf8')) as CaptionCue[];
  if (!Array.isArray(value)) throw new Error('Caption review is not an array.');
  return value;
}
export function draftCaptionReview(root:string,boundaries:number[]) {
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root);
  const cues=buildCues(words,boundaries,offset,duration);
  const relative=`.studio/alignment/caption-draft-${randomUUID()}.json`;
  atomicJson(resolveProjectFile(root,relative),cues);
  alignment.captionDraft={path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,boundaries:[...boundaries]};
  writeState(root,state);
  return {cues,sourceSha256,status:'REVIEW_REQUIRED'};
}
export function approveCaptionReview(root:string,note:string) {
  if (typeof note!=='string' || !note.trim()) throw new Error('Explicit caption revision review note is required.');
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root);
  const draft=alignment.captionDraft;
  if (!draft || draft.sourceSha256!==sourceSha256 || sha(fs.readFileSync(resolveProjectFile(root,draft.path)))!==draft.sha256) throw new Error('Caption draft source is stale or missing.');
  const cues=buildCues(words,draft.boundaries,offset,duration);
  if (!same(cues,readCues(root,draft.path))) throw new Error('Caption draft was changed outside review.');
  const existing=alignment.captionReview;
  if(existing&&existing.sourceSha256===sourceSha256&&fs.existsSync(resolveProjectFile(root,existing.path))&&sha(fs.readFileSync(resolveProjectFile(root,existing.path)))===existing.sha256&&same(readCues(root,existing.path),cues)){
    alignment.captionDraft=undefined;writeState(root,state);return{...existing,cues};
  }
  const revision=(alignment.captionReview?.revision??0)+1;
  const relative=`.studio/alignment/caption-review-${revision}-${randomUUID()}.json`;
  atomicJson(resolveProjectFile(root,relative),cues);
  alignment.captionReview={revision,path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,note:note.trim(),approvedAt:new Date().toISOString()};
  alignment.captionDraft=undefined;
  if(state.tasks?.native)state.tasks.native.status='STALE';
  state.preview=undefined;state.approval=undefined;state.render=undefined;
  writeState(root,state);
  return { ...alignment.captionReview,cues };
}
export function approvedCaptionCues(root:string):CaptionCue[] {
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root);
  const review=alignment.captionReview;
  if (!review || review.sourceSha256!==sourceSha256) throw new Error('Caption REVIEW_REQUIRED: approve an exact word-grounded revision first.');
  const bytes=fs.readFileSync(resolveProjectFile(root,review.path));
  if (sha(bytes)!==review.sha256) throw new Error('Approved caption revision was modified.');
  const cues=JSON.parse(bytes.toString('utf8')) as CaptionCue[];
  const boundaries=boundariesFromCues(words,cues);
  if (!same(cues,buildCues(words,boundaries,offset,duration))) throw new Error('Approved caption timing or text changed.');
  if(!state.voice||state.voice.stale)throw new Error('Caption approval has no current narration.');
  return cues;
}
