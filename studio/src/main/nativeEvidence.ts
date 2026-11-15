import fs from 'node:fs';
import path from 'node:path';
import {approvedCaptionCues,nativeVoiceTiming} from './captionReview.js';
import {readState,resolveProjectFile,sha,strictJson,type StudioState} from './services.js';

const hashFile=(file:string)=>sha(fs.readFileSync(file));
const hex64=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const localReference=(root:string,relative:string)=>{
  if(relative.startsWith('@b1/'))return null;
  const file=resolveProjectFile(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error(`BLOCKED: referenced native input is missing: ${relative}`);
  return{path:relative,absolute:path.resolve(file),sha256:hashFile(file)};
};
function referencedPaths(manifest:Record<string,unknown>){
  const values=new Map<string,number>();const add=(relative:string,start:number)=>values.set(relative,Math.min(values.get(relative)??Infinity,start));
  const walk=(layers:unknown[],shotStart:number,parentFrom=0)=>{for(const item of layers){const layer=item as Record<string,unknown>,from=Math.max(parentFrom,typeof layer.from==='number'?layer.from:0);if(layer.type==='image'&&typeof layer.path==='string')add(layer.path,shotStart+from);if(Array.isArray(layer.children))walk(layer.children,shotStart,from)}};
  for(const value of Array.isArray(manifest.shots)?manifest.shots:[]){const shot=value as Record<string,unknown>;if(Array.isArray(shot.layers))walk(shot.layers,typeof shot.start==='number'?shot.start:0)}
  for(const name of ['sfx','dialogue','ambience'] as const)for(const value of Array.isArray(manifest[name])?manifest[name] as unknown[]:[]){const item=value as Record<string,unknown>;if(typeof item.path==='string')add(item.path,typeof item.time==='number'?item.time:typeof item.start==='number'?item.start:0)}
  const music=manifest.music as Record<string,unknown>|undefined;if(typeof music?.path==='string')add(music.path,0);
  return[...values].map(([relative,scopeStart])=>({relative,scopeStart})).sort((a,b)=>a.relative.localeCompare(b.relative));
}
export interface CurrentNativeEvidence {fingerprint:string;projectSha256:string;voiceSha256:string;wordsSha256:string;originalCuesSha256:string;approvedCuesSha256:string;timing:ReturnType<typeof nativeVoiceTiming>;referenced:Array<{path:string;absolute:string;sha256:string}>}
export function currentNativeEvidence(root:string,state=readState(root),options:{seconds?:number}={}):CurrentNativeEvidence{
  const projectFile=resolveProjectFile(root,'project.json'),projectBytes=fs.readFileSync(projectFile),manifest=strictJson(projectBytes.toString('utf8')) as Record<string,unknown>;
  if(!state.approvedScript||sha(state.approvedScript.text)!==state.approvedScript.sha256)throw new Error('BLOCKED: approved script evidence is missing or corrupt.');
  if(!state.voice||state.voice.stale)throw new Error('BLOCKED: accepted narration is missing or stale.');
  const voiceFile=resolveProjectFile(root,state.voice.path);if(!fs.existsSync(voiceFile)||hashFile(voiceFile)!==state.voice.sha256)throw new Error('BLOCKED: accepted narration bytes do not match state.');
  if(!state.alignment)throw new Error('BLOCKED: word alignment is missing.');
  const wordsFile=resolveProjectFile(root,state.alignment.path),coreCuesFile=resolveProjectFile(root,state.alignment.captionsPath);
  if(!fs.existsSync(wordsFile)||hashFile(wordsFile)!==state.alignment.wordsSha256)throw new Error('BLOCKED: WORDS evidence is missing or changed.');
  if(!fs.existsSync(coreCuesFile)||hashFile(coreCuesFile)!==state.alignment.cuesSha256)throw new Error('BLOCKED: original caption evidence is missing or changed.');
  const approved=approvedCaptionCues(root),review=state.alignment.captionReview;if(!review)throw new Error('REVIEW_REQUIRED: approved caption revision is missing.');
  const approvedFile=resolveProjectFile(root,review.path);if(!fs.existsSync(approvedFile)||hashFile(approvedFile)!==review.sha256)throw new Error('BLOCKED: approved caption revision bytes changed.');
  const timing=nativeVoiceTiming(root,state),refs=referencedPaths(manifest).filter(item=>options.seconds===undefined||item.scopeStart<options.seconds).map(item=>localReference(root,item.relative)).filter((item):item is NonNullable<typeof item>=>Boolean(item));
  for(const ref of refs){if(ref.path===state.voice.path)continue;const row=(state.media??[]).find(item=>item.path===ref.path&&item.sha256===ref.sha256&&item.rights.trim());if(!row)throw new Error(`BLOCKED: referenced media lacks current hash/rights evidence: ${ref.path}`)}
  const payload={project:sha(projectBytes),projectId:state.project.id,scopeSeconds:options.seconds??null,script:state.approvedScript.sha256,voice:state.voice.sha256,words:state.alignment.wordsSha256,originalCues:state.alignment.cuesSha256,approvedCues:review.sha256,approved,timing,referenced:refs.map(item=>[item.path,item.sha256])};
  return{fingerprint:sha(JSON.stringify(payload)),projectSha256:payload.project,voiceSha256:state.voice.sha256,wordsSha256:state.alignment.wordsSha256!,originalCuesSha256:state.alignment.cuesSha256!,approvedCuesSha256:review.sha256,timing,referenced:refs};
}
const assertVideo=(file:string,label:string)=>{const bytes=fs.readFileSync(file);if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw new Error(`BLOCKED: ${label} is not a current MP4.`);return sha(bytes)};
const assertPng=(file:string,label:string)=>{const bytes=fs.readFileSync(file);if(bytes.length<8||bytes[0]!==0x89||bytes.toString('ascii',1,4)!=='PNG')throw new Error(`BLOCKED: ${label} is corrupt.`)};
function verifyReportInputs(report:Record<string,unknown>,evidence:CurrentNativeEvidence){
  if(!Array.isArray(report.inputs))throw new Error('BLOCKED: native report input evidence is missing.');
  for(const ref of evidence.referenced){if(!report.inputs.some(value=>{const item=value as Record<string,unknown>;return path.resolve(String(item.path))===ref.absolute&&item.sha256===ref.sha256}))throw new Error(`BLOCKED: native report does not bind current input: ${ref.path}`)}
}
export function verifyPreviewEvidence(root:string,evidence=currentNativeEvidence(root)){
  const relative={video:'output/preview.mp4',report:'output/preview-report.json',srt:'output/preview.srt',vtt:'output/preview.vtt',sheet:'output/preview-contact-sheet.png'};
  for(const item of Object.values(relative)){const file=resolveProjectFile(root,item);if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size===0)throw new Error(`BLOCKED: native preview artifact missing or empty: ${item}`)}
  const video=resolveProjectFile(root,relative.video),reportFile=resolveProjectFile(root,relative.report),report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>,videoSha=assertVideo(video,'preview MP4');assertPng(resolveProjectFile(root,relative.sheet),'preview contact sheet');
  if(report.output_sha256!==videoSha||path.resolve(String(report.output))!==video||report.full_decode!=='pass'||report.original_voice_sha256!==evidence.voiceSha256||!hex64(report.fingerprint))throw new Error('BLOCKED: native preview report does not match current MP4/source evidence.');verifyReportInputs(report,evidence);
  return{path:relative.video,sha256:videoSha,reportPath:relative.report,reportSha256:hashFile(reportFile),sourceFingerprint:evidence.fingerprint,coreFingerprint:String(report.fingerprint),report};
}
export function verifyFilmEvidence(root:string,evidence=currentNativeEvidence(root)){
  const relative={video:'output/film.mp4',report:'output/film-report.json',srt:'output/film.srt',vtt:'output/film.vtt',checkpoint:'output/checkpoint.json',sheet:'output/film-contact-sheet.png'};
  for(const item of Object.values(relative)){const file=resolveProjectFile(root,item);if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size===0)throw new Error(`BLOCKED: native render artifact missing or empty: ${item}`)}
  const video=resolveProjectFile(root,relative.video),reportFile=resolveProjectFile(root,relative.report),report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>,videoSha=assertVideo(video,'film MP4');assertPng(resolveProjectFile(root,relative.sheet),'film contact sheet');strictJson(fs.readFileSync(resolveProjectFile(root,relative.checkpoint),'utf8'));
  if(report.output_sha256!==videoSha||path.resolve(String(report.output))!==video||report.full_decode!=='pass'||report.original_voice_sha256!==evidence.voiceSha256||!hex64(report.fingerprint))throw new Error('BLOCKED: native film report does not match current MP4/source evidence.');verifyReportInputs(report,evidence);
  return{path:relative.video,sha256:videoSha,reportPath:relative.report,reportSha256:hashFile(reportFile),sourceFingerprint:evidence.fingerprint,coreFingerprint:String(report.fingerprint),report};
}
export function verifyPersistedNativeEvidence(root:string,state:StudioState){
  if(!state.preview&&!state.approval&&!state.render)return;
  const reportFile=resolveProjectFile(root,'output/preview-report.json');if(!fs.existsSync(reportFile))throw new Error('BLOCKED: preview report is missing.');const report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>,seconds=report.preview_seconds;if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||seconds>60)throw new Error('BLOCKED: preview scope evidence is invalid.');
  const previewEvidence=currentNativeEvidence(root,state,{seconds}),preview=verifyPreviewEvidence(root,previewEvidence);
  if(!state.preview||state.preview.sourceFingerprint!==previewEvidence.fingerprint||state.preview.sha256!==preview.sha256||state.preview.reportSha256!==preview.reportSha256)throw new Error('BLOCKED: saved preview status is stale or unverified.');
  if(state.approval){const file=resolveProjectFile(root,'output/approval.json');if(!fs.existsSync(file))throw new Error('BLOCKED: native approval evidence is missing.');const approval=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;if(approval.preview_sha256!==preview.sha256||approval.preview_fingerprint!==preview.coreFingerprint||state.approval.previewSha256!==preview.sha256)throw new Error('BLOCKED: saved approval does not bind the current verified preview.')}
  if(state.render){const fullEvidence=currentNativeEvidence(root,state),film=verifyFilmEvidence(root,fullEvidence);if(state.render.sourceFingerprint!==fullEvidence.fingerprint||state.render.sha256!==film.sha256||state.render.reportSha256!==film.reportSha256)throw new Error('BLOCKED: saved render status is stale or unverified.')}
}
