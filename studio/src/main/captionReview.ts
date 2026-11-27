import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { alignmentText } from './alignment.js';
import { atomicJson, readState, resolveProjectFile, sha, strictJson, writeState } from './services.js';

export interface CaptionCue { start: number; end: number; text: string }
export interface CaptionReviewRecord {
  revision: number; path: string; sha256: string; sourceSha256: string; note: string; approvedAt: string;
  mode?: 'AUTO'|'MANUAL'; authorTaskId?:string;
}
export interface CaptionDraftRecord { path: string; sha256: string; sourceSha256: string; boundaries: number[] }
export interface NativeVoiceTiming { lead: number; tail: number; trimStart: number; timelineDuration: number; voiceStart: number }
const normalized = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const cueText = (words: Array<{word:string}>) => words.map(w => w.word.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const finiteRange = (value: unknown, fallback: number, label: string, maximum: number) => {
  const number = value === undefined ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > maximum) throw new Error(`Invalid native voice ${label}.`);
  return number;
};
export function nativeVoiceTiming(root: string, state = readState(root)): NativeVoiceTiming {
  if (!state.voice?.duration || !Number.isFinite(state.voice.duration) || state.voice.duration <= 0) throw new Error('Current narration duration is invalid.');
  const project = strictJson(fs.readFileSync(resolveProjectFile(root, 'project.json'), 'utf8')) as Record<string, unknown>;
  const voice = project.voice as Record<string, unknown> | undefined;
  if (!voice || typeof voice !== 'object' || Array.isArray(voice) || voice.path !== state.voice.path) throw new Error('Native voice configuration does not bind the current narration.');
  const lead = finiteRange(voice.lead, 0, 'lead', 5), tail = finiteRange(voice.tail, 0, 'tail', 5);
  const trimStart = finiteRange(voice.trim_start, 0, 'trim_start', Math.min(5, state.voice.duration - .01));
  if (project.style !== 'B4' && voice.trim_start !== undefined) throw new Error('Native voice trim_start is valid for B4 only.');
  return { lead, tail, trimStart, voiceStart: lead, timelineDuration: state.voice.duration - trimStart + lead + tail };
}
function inputs(root: string,options:{allowCoreRegroup?:boolean}={}) {
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
  const rawWords = raw.words as Array<{word:string;start:number;end:number}>;
  let previous = 0;
  for (const word of rawWords) {
    if (typeof word.word !== 'string' || !word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous || word.end <= word.start || word.end > (voice.duration ?? Infinity) + .05) throw new Error('Invalid real WORDS timing.');
    previous = word.end;
  }
  if (!same(normalized(cueText(rawWords)), normalized(alignmentText(script.text)))) throw new Error('WORDS do not cover the approved spoken text.');
  const originalBytes = fs.readFileSync(resolveProjectFile(root, alignment.captionsPath));
  if (sha(originalBytes) !== alignment.cuesSha256) throw new Error('Original Core captions changed.');
  const original = JSON.parse(originalBytes.toString('utf8')) as CaptionCue[];
  if (!Array.isArray(original) || !original.length) throw new Error('Original grouped captions are unavailable.');
  const rawBoundaries = boundariesFromCues(rawWords, original);
  const rawGrouped = buildCues(rawWords, rawBoundaries, 0, voice.duration ?? Infinity, false);
  if (!same(original, rawGrouped)) throw new Error('Original grouped captions do not match raw word boundaries.');
  const timing = nativeVoiceTiming(root, state);
  const split = rawWords.find(word => word.start < timing.trimStart && word.end > timing.trimStart + 1e-8);
  if (split) throw new Error('Native trim_start cuts through an aligned word boundary.');
  const firstVisible = rawWords.findIndex(word => word.end > timing.trimStart + 1e-8);
  if (firstVisible < 0) throw new Error('Native trim_start removes every aligned word.');
  const words = rawWords.slice(firstVisible);
  const originalBoundaries = rawBoundaries.filter(end => end > firstVisible).map(end => end - firstVisible);
  const offset = timing.lead - timing.trimStart;
  const grouped = buildCues(words, originalBoundaries, offset, timing.timelineDuration,!options.allowCoreRegroup);
  const sourceSha256 = sha(JSON.stringify({audio:voice.sha256,script:spokenSha,words:alignment.wordsSha256,original:alignment.cuesSha256,timing}));
  return {state, alignment, words, original:grouped, originalBoundaries, offset, sourceSha256, duration: timing.timelineDuration, timing};
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
function buildCues(words: Array<{word:string;start:number;end:number}>, ends: number[], offset: number, duration: number,strictGrouping=true): CaptionCue[] {
  if (!Array.isArray(ends) || !ends.length || ends.some(n => !Number.isSafeInteger(n) || n < 1 || n > words.length) || ends.at(-1) !== words.length) throw new Error('Caption boundaries must cover all real words.');
  const cues: CaptionCue[] = [];let cursor=0,previous=0;
  for (const endIndex of ends) {
    if (endIndex <= cursor) throw new Error('Caption boundaries must increase.');
    const group=words.slice(cursor,endIndex),start=group[0].start+offset,end=group.at(-1)!.end+offset,text=cueText(group);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previous-1e-8 || end<=start || end>duration+.05 || !text.trim() || (strictGrouping&&(/[\r\n]/.test(text) || text.length>58 || group.length>8 || end-start>3.5+1e-8))) throw new Error('Caption violates original timing, one-line readability or word grouping policy.');
    cues.push({start,end,text});cursor=endIndex;previous=end;
  }
  return cues;
}
export function getCaptionReview(root: string) {
  const {state,words,original,originalBoundaries,offset,sourceSha256,duration}=inputs(root,{allowCoreRegroup:true});
  const review=state.alignment?.captionReview;
  let status:'REVIEW_REQUIRED'|'STALE_REVIEW'|'CORRUPT_REGISTERED_REVIEW'|'VERIFIED'|'AUTO_VERIFIED'='REVIEW_REQUIRED',approved:({cues:CaptionCue[]}&CaptionReviewRecord)|null=null;
  if(review){if(review.sourceSha256!==sourceSha256)status='STALE_REVIEW';else{try{const bytes=fs.readFileSync(resolveProjectFile(root,review.path));if(sha(bytes)!==review.sha256)throw new Error('hash');const cues=readCues(root,review.path),boundaries=boundariesFromCues(words,cues);if(!same(cues,buildCues(words,boundaries,offset,nativeVoiceTiming(root,state).timelineDuration)))throw new Error('content');approved={...review,cues};status=review.mode==='AUTO'?'AUTO_VERIFIED':'VERIFIED'}catch{status='CORRUPT_REGISTERED_REVIEW'}}}
  const draft=state.alignment?.captionDraft;
  let verifiedDraft: (NonNullable<NonNullable<typeof state.alignment>['captionDraft']>&{cues:CaptionCue[]})|null=null;
  if(draft?.sourceSha256===sourceSha256){
    try{
      const bytes=fs.readFileSync(resolveProjectFile(root,draft.path));
      const cues=readCues(root,draft.path);
      if(sha(bytes)===draft.sha256&&same(cues,buildCues(words,draft.boundaries,offset,duration)))
        verifiedDraft={...draft,cues};
    }catch{/* stale/corrupt draft is not an approval candidate */}
  }
  const author=state.alignment?.captionAuthorTask;
  const validAuthor=author?.sourceSha256===sourceSha256&&author.inputSha256===sha(JSON.stringify({sourceSha256,words,offset,duration}))?author:null;
  const draftKind=verifiedDraft?(verifiedDraft.technicalDraft?'TECHNICAL':verifiedDraft.authorTaskId&&validAuthor?.status==='IMPORTED'&&validAuthor.taskId===verifiedDraft.authorTaskId?'AI_AUTHORED':verifiedDraft.authorTaskId?'CORRUPT':'OWNER_CORRECTED'):draft?'STALE_OR_CORRUPT':'NONE';
  const canApproveDraft=draftKind==='AI_AUTHORED'||draftKind==='OWNER_CORRECTED';
  return {words,original,sourceSha256,captionAuthorTask:validAuthor,draftKind,canApproveDraft,status,workflowStatus:status==='VERIFIED'?'USER_APPROVED':status==='STALE_REVIEW'?'STALE':status,approved,
    wordCount:words.length, cueCount:approved?.cues.length??original.length, duration,
    error:status==='REVIEW_REQUIRED'?state.alignment?.captionAutoError:undefined,
    draft: verifiedDraft,
    originalBoundaries,shift:offset};
}
function invalidateTimingDependents(root:string,state:ReturnType<typeof readState>,approvedSource:string|undefined,currentSource:string) {
  if (!approvedSource || approvedSource === currentSource) return;
  if (state.tasks?.native) state.tasks.native.status='STALE';
  state.nativeReadiness=undefined;state.preview=undefined;state.approval=undefined;state.render=undefined;
  writeState(root,state);
}
function readCues(root:string,relative:string):CaptionCue[] {
  const value=JSON.parse(fs.readFileSync(resolveProjectFile(root,relative),'utf8')) as CaptionCue[];
  if (!Array.isArray(value)) throw new Error('Caption review is not an array.');
  return value;
}
/** Freeze exact aligned words. Indices are one-based cumulative word counts,
 * equivalent to exclusive ends into the zero-based ordered word array. */
export function freezeCaptionAuthorTask(root:string){
  const {state,alignment,words,sourceSha256,offset,duration}=inputs(root,{allowCoreRegroup:true});
  const taskId=randomUUID(),inputSha256=sha(JSON.stringify({sourceSha256,words,offset,duration}));
  const envelope={schema:'mode-b-caption-author-result-v1',project_id:state.project.id,
    task_id:taskId,input_sha256:inputSha256,source_sha256:sourceSha256,
    payload:{end_word_indices:[]}};
  const prompt=[
    '# STICKMAN — External AI Caption Author',
    'Choose semantic phrase boundaries using only these exact aligned words. Preserve every word and its order. Return ONLY cumulative one-based end-word counts, strictly increasing, final count exactly equal to the number of words.',
    'Respect one-line Core limits: at most 8 aligned words, 58 characters and 3.5 seconds per cue. No invented words, timestamps or rewritten narration.',
    JSON.stringify(words.map((word,index)=>({index:index+1,...word})),null,2),
    'Frozen JSON result envelope (fill payload, preserve identity):',
    JSON.stringify(envelope,null,2)
  ].join('\n\n');
  alignment.captionAuthorTask={taskId,sourceSha256,inputSha256,prompt,status:'FROZEN'};
  writeState(root,state);return alignment.captionAuthorTask;
}
export function importCaptionAuthorResult(root:string,text:string){
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root,{allowCoreRegroup:true});
  const task=alignment.captionAuthorTask;
  if(!task||task.status!=='FROZEN'||task.sourceSha256!==sourceSha256||
    task.inputSha256!==sha(JSON.stringify({sourceSha256,words,offset,duration})))
    throw Error('CAPTION_AUTHOR_TASK_STALE');
  if(Buffer.byteLength(text,'utf8')>4*1024*1024)throw Error('CAPTION_AUTHOR_RESULT_OVERSIZE');
  const result=strictJson(text) as Record<string,unknown>;
  if(!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).sort().join('|')!==['schema','project_id','task_id','input_sha256','source_sha256','payload'].sort().join('|')||
    result.schema!=='mode-b-caption-author-result-v1'||result.project_id!==state.project.id||
    result.task_id!==task.taskId||result.input_sha256!==task.inputSha256||result.source_sha256!==sourceSha256)
    throw Error('CAPTION_AUTHOR_ENVELOPE_INVALID');
  const payload=result.payload as {end_word_indices:number[]};
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).join('|')!=='end_word_indices')throw Error('CAPTION_AUTHOR_PAYLOAD_INVALID');
  const boundaries=payload.end_word_indices,cues=buildCues(words,boundaries,offset,duration);
  const relative='.studio/alignment/caption-ai-draft-'+randomUUID()+'.json';
  atomicJson(resolveProjectFile(root,relative),cues);
  alignment.captionDraft={path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),
    sourceSha256,boundaries:[...boundaries],authorTaskId:task.taskId};
  alignment.captionAuthorTask={...task,status:'IMPORTED'};
  writeState(root,state);return {cues,sourceSha256,status:'REVIEW_REQUIRED' as const};
}
export function draftCaptionReview(root:string,boundaries:number[]) {
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root,{allowCoreRegroup:true});
  const cues=buildCues(words,boundaries,offset,duration);
  const relative=`.studio/alignment/caption-draft-${randomUUID()}.json`;
  atomicJson(resolveProjectFile(root,relative),cues);
  const task=alignment.captionAuthorTask;
  const authorTaskId=task?.status==='IMPORTED'&&task.sourceSha256===sourceSha256?task.taskId:undefined;
  alignment.captionDraft={path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,boundaries:[...boundaries],
    ...(authorTaskId?{authorTaskId}:{})};
  writeState(root,state);
  return {cues,sourceSha256,status:'REVIEW_REQUIRED'};
}
export function approveCaptionReview(root:string,note:string,expectedSha?:string) {
  if (typeof note!=='string' || !note.trim()) throw new Error('Explicit caption revision review note is required.');
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root,{allowCoreRegroup:true});
  const draft=alignment.captionDraft;
  if (!draft || draft.sourceSha256!==sourceSha256 || sha(fs.readFileSync(resolveProjectFile(root,draft.path)))!==draft.sha256) throw new Error('Caption draft source is stale or missing.');
  if(expectedSha!==undefined&&expectedSha!==draft.sha256)throw Error('CAPTION_APPROVAL_STALE');
  if(draft.technicalDraft)throw Error('CAPTION_TECHNICAL_DRAFT_REQUIRES_AI_AUTHOR_OR_EXPLICIT_MANUAL_CORRECTION');
  if(!getCaptionReview(root).canApproveDraft)throw Error('CAPTION_DRAFT_AUTHORITY_INVALID');
  const cues=buildCues(words,draft.boundaries,offset,duration);
  if (!same(cues,readCues(root,draft.path))) throw new Error('Caption draft was changed outside review.');
  const existing=alignment.captionReview;
  if(existing&&existing.sourceSha256===sourceSha256&&fs.existsSync(resolveProjectFile(root,existing.path))&&sha(fs.readFileSync(resolveProjectFile(root,existing.path)))===existing.sha256&&same(readCues(root,existing.path),cues)&&existing.mode!=='AUTO'&&existing.authorTaskId===draft.authorTaskId){
    alignment.captionDraft=undefined;writeState(root,state);return{...existing,cues};
  }
  const revision=(alignment.captionReview?.revision??0)+1;
  const relative=`.studio/alignment/caption-review-${revision}-${randomUUID()}.json`;
  atomicJson(resolveProjectFile(root,relative),cues);
  alignment.captionReview={revision,path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,note:note.trim(),approvedAt:new Date().toISOString(),mode:'MANUAL',...(draft.authorTaskId?{authorTaskId:draft.authorTaskId}:{})};
  alignment.captionDraft=undefined;
  if(state.tasks?.native)state.tasks.native.status='STALE';
  state.nativeReadiness=undefined;state.preview=undefined;state.approval=undefined;state.render=undefined;
  writeState(root,state);
  return { ...alignment.captionReview,cues };
}
export function approvedCaptionCues(root:string):CaptionCue[] {
  const {state,alignment,words,offset,duration,sourceSha256}=inputs(root,{allowCoreRegroup:true});
  const review=alignment.captionReview;
  invalidateTimingDependents(root,state,review?.sourceSha256,sourceSha256);
  if (!review || review.sourceSha256!==sourceSha256) throw new Error('Caption REVIEW_REQUIRED: approve exact word-grounded AI or owner-reviewed boundaries first.');
  const bytes=fs.readFileSync(resolveProjectFile(root,review.path));
  if (sha(bytes)!==review.sha256) throw new Error('Approved caption revision was modified.');
  const cues=JSON.parse(bytes.toString('utf8')) as CaptionCue[];
  const boundaries=boundariesFromCues(words,cues);
  if (!same(cues,buildCues(words,boundaries,offset,duration))) throw new Error('Approved caption timing or text changed.');
  if(!state.voice||state.voice.stale)throw new Error('Caption approval has no current narration.');
  return cues;
}

/** R3: choose real-word boundaries; never invent text/timestamps or silently approve on failure. */
export function autoCaptionReview(root:string){
  const snapshot=inputs(root,{allowCoreRegroup:true});
  const {state,alignment,words,offset,duration,sourceSha256,originalBoundaries}=snapshot;
  const existing=alignment.captionReview;
  if(existing?.sourceSha256===sourceSha256){
    try{
      const bytes=fs.readFileSync(resolveProjectFile(root,existing.path));
      if(sha(bytes)===existing.sha256){
        const cues=readCues(root,existing.path),boundaries=boundariesFromCues(words,cues);
        if(same(cues,buildCues(words,boundaries,offset,duration)))return{status:existing.mode==='AUTO'?'AUTO_VERIFIED':'USER_APPROVED',cues,revision:existing.revision};
      }
    }catch{/* Corrupt existing evidence is not replaced; owner must review it. */}
    throw new Error('CAPTION_REGISTERED_REVISION_CORRUPT: existing revision must not be overwritten.');
  }
  // Dynamic programming is bounded by the original Core maximum of eight words per cue.
  // A valid Core boundary is preferred. Otherwise punctuation and actual pauses guide grouping.
  const best=new Array<number>(words.length+1).fill(Infinity),next=new Array<number>(words.length+1).fill(-1);
  best[words.length]=0;
  for(let i=words.length-1;i>=0;i--){
    for(let j=i+1;j<=Math.min(i+8,words.length);j++){
      let cue:CaptionCue;
      try{cue=buildCues(words.slice(i,j),[j-i],offset,duration)[0];}catch{continue;}
      if(!Number.isFinite(best[j]))continue;
      const gap=j<words.length?words[j].start-words[j-1].end:0;
      const punctuation=/[.!?;:,]$/.test(words[j-1].word.trim());
      const atOriginal=originalBoundaries.includes(j);
      const crossesRealPause=words.slice(i+1,j).some((word,k)=>word.start-words[i+k].end>=.24);
      const crossesSentenceBreak=words.slice(i,j-1).some(word=>/[.!?]$/.test(word.word.trim()));
      const cost=3+Math.max(0,1.5-(cue.end-cue.start))*.45+
        (crossesRealPause?4:0)+(crossesSentenceBreak?1.2:0)+
        (j<words.length&&!punctuation&&!atOriginal&&gap<.24?1.5:0)-
        (punctuation?1.1:0)-(gap>=.24?1.2:0)-(atOriginal?1.8:0)+best[j];
      if(cost<best[i]){best[i]=cost;next[i]=j;}
    }
  }
  if(next[0]<0)throw new Error('CAPTION_REVIEW_REQUIRED: a single aligned word or boundary violates Core readability/timing.');
  const boundaries:number[]=[];
  for(let i=0;i<words.length;){const j=next[i];if(j<=i)throw new Error('CAPTION_REVIEW_REQUIRED: grouping cannot cover all spoken words.');boundaries.push(j);i=j;}
  const cues=buildCues(words,boundaries,offset,duration);
  if(state.identityPolicy==='v1'){
    // The local grouping is a technical preview only. It cannot authorize a
    // new Native task without explicit semantic authoring/owner review.
    const current=getCaptionReview(root);
    if(current.canApproveDraft&&current.draft)return {status:'REVIEW_REQUIRED' as const,cues:current.draft.cues,revision:existing?.revision??0};
    const relative='.studio/alignment/caption-technical-draft-'+randomUUID()+'.json';
    atomicJson(resolveProjectFile(root,relative),cues);
    alignment.captionDraft={path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,boundaries,technicalDraft:true};
    writeState(root,state);return {status:'REVIEW_REQUIRED' as const,cues,revision:existing?.revision??0};
  }
  const relative=`.studio/alignment/caption-auto-${(existing?.revision??0)+1}-${randomUUID()}.json`;
  atomicJson(resolveProjectFile(root,relative),cues);
  // Do not publish against a changed WAV/script/word/core/voice-timing fingerprint.
  if(inputs(root,{allowCoreRegroup:true}).sourceSha256!==sourceSha256)throw new Error('CAPTION_SOURCE_STALE_DURING_AUTOGROUP');
  const latest=readState(root);
  if(latest.alignment?.captionReview?.sourceSha256===sourceSha256)throw new Error('CAPTION_CONCURRENT_REVIEW: current revision changed.');
  const revision=(latest.alignment?.captionReview?.revision??0)+1;
  if(revision!==(existing?.revision??0)+1)throw new Error('CAPTION_REVISION_CHANGED');
  latest.alignment!.captionReview={revision,path:relative,sha256:sha(fs.readFileSync(resolveProjectFile(root,relative))),sourceSha256,note:'',approvedAt:new Date().toISOString(),mode:'AUTO'};
  latest.alignment!.captionAutoError=undefined;
  if(latest.tasks?.native)latest.tasks.native.status='STALE';
  latest.nativeReadiness=undefined;latest.preview=undefined;latest.approval=undefined;latest.render=undefined;
  writeState(root,latest);
  return{status:'AUTO_VERIFIED' as const,cues,revision};
}

export function ensureCaptionAuthorTask(root:string){const current=getCaptionReview(root);if(current.status==='VERIFIED'||current.canApproveDraft||current.captionAuthorTask?.status==='FROZEN')return current.captionAuthorTask;return freezeCaptionAuthorTask(root);}
