import fs from 'node:fs';
import path from 'node:path';
import {approvedCaptionCues,nativeVoiceTiming,type CaptionCue} from './captionReview.js';
import {nativeSkillRoot,readState,resolveProjectFile,runProcess,sha,strictJson,type StudioState} from './services.js';

const hashFile=(file:string)=>sha(fs.readFileSync(file));
const hex64=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const close=(a:number,b:number,tolerance=.055)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
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

export interface CurrentNativeEvidence {fingerprint:string;projectSha256:string;voicePath:string;voiceAbsolute:string;voiceSha256:string;wordsSha256:string;originalCuesSha256:string;approvedCuesSha256:string;approvedCues:CaptionCue[];timing:ReturnType<typeof nativeVoiceTiming>;scopeSeconds:number|null;effectiveDuration:number;referenced:Array<{path:string;absolute:string;sha256:string}>}
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
  if(JSON.stringify(manifest.captions)!==JSON.stringify(approved))throw new Error('BLOCKED: native manifest captions do not match the approved caption revision.');
  const timing=nativeVoiceTiming(root,state),effectiveDuration=timing.timelineDuration,scopeSeconds=options.seconds===undefined?null:Math.min(effectiveDuration,options.seconds);
  if(options.seconds!==undefined&&(!Number.isFinite(options.seconds)||options.seconds<=0||options.seconds>60))throw new Error('BLOCKED: requested preview scope is invalid.');
  const refs=referencedPaths(manifest).filter(item=>scopeSeconds===null||item.scopeStart<scopeSeconds).map(item=>localReference(root,item.relative)).filter((item):item is NonNullable<typeof item>=>Boolean(item));
  for(const ref of refs){if(ref.path===state.voice.path)continue;const row=(state.media??[]).find(item=>item.path===ref.path&&item.sha256===ref.sha256&&item.rights.trim());if(!row)throw new Error(`BLOCKED: referenced media lacks current hash/rights evidence: ${ref.path}`)}
  const payload={project:sha(projectBytes),projectId:state.project.id,scopeSeconds,script:state.approvedScript.sha256,voice:state.voice.sha256,words:state.alignment.wordsSha256,originalCues:state.alignment.cuesSha256,approvedCues:review.sha256,approved,timing,referenced:refs.map(item=>[item.path,item.sha256])};
  return{fingerprint:sha(JSON.stringify(payload)),projectSha256:payload.project,voicePath:state.voice.path,voiceAbsolute:path.resolve(voiceFile),voiceSha256:state.voice.sha256,wordsSha256:state.alignment.wordsSha256!,originalCuesSha256:state.alignment.cuesSha256!,approvedCuesSha256:review.sha256,approvedCues:approved,timing,scopeSeconds,effectiveDuration,referenced:refs};
}

export interface NativeVerificationAdapter {
  validate(root:string,seconds?:number):Promise<{valid:boolean;fingerprint:string;checked_seconds:number;duration:number}>;
  probe(file:string):Promise<Record<string,unknown>>;
  decode(file:string):Promise<void>;
}
export function productionNativeVerifier(appPath:string):NativeVerificationAdapter{
  const{cli}=nativeSkillRoot(appPath),cwd=path.dirname(cli);
  return{
    async validate(root,seconds){const args=[cli,'validate',resolveProjectFile(root,'project.json')];if(seconds!==undefined)args.push('--seconds',String(seconds));const result=await runProcess(process.execPath,args,{cwd,timeout:10*60_000});if(result.code!==0)throw new Error(result.stderr.trim()||result.stdout.trim()||'Original Core validation failed.');return strictJson(result.stdout) as {valid:boolean;fingerprint:string;checked_seconds:number;duration:number}},
    async probe(file){const result=await runProcess(process.execPath,[cli,'probe',file],{cwd,timeout:60_000});if(result.code!==0)throw new Error(result.stderr.trim()||result.stdout.trim()||'Original Core media probe failed.');return strictJson(result.stdout) as Record<string,unknown>},
    async decode(file){const result=await runProcess(process.env.FFMPEG||'ffmpeg',['-v','error','-i',file,'-f','null','-'],{cwd,timeout:10*60_000});if(result.code!==0)throw new Error(result.stderr.trim()||'Native media full decode failed.')}
  };
}
type Stream=Record<string,unknown>;
function streams(probe:Record<string,unknown>){if(!Array.isArray(probe.streams))throw new Error('BLOCKED: media probe has no streams.');return probe.streams as Stream[]}
function format(probe:Record<string,unknown>){if(!probe.format||typeof probe.format!=='object')throw new Error('BLOCKED: media probe has no format.');return probe.format as Record<string,unknown>}
function timestamp(value:string,separator:','|'.') {const match=value.match(new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2})\\${separator}(\\d{3})$`));if(!match)throw new Error('BLOCKED: caption timestamp is invalid.');return Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000}
function parseSidecar(text:string,kind:'srt'|'vtt'){
  const lines=text.replace(/\r/g,'').split('\n'),cues:Array<CaptionCue>=[];let index=kind==='vtt'?(lines[0]==='WEBVTT'?1:(()=>{throw new Error('BLOCKED: VTT header is invalid.')})()):0;
  while(index<lines.length){while(index<lines.length&&!lines[index].trim())index++;if(index>=lines.length)break;if(kind==='srt'){if(!/^\d+$/.test(lines[index].trim()))throw new Error('BLOCKED: SRT cue index is invalid.');index++}const timing=lines[index++]?.trim(),match=timing?.match(kind==='srt'?/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/:/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/);if(!match)throw new Error(`BLOCKED: ${kind.toUpperCase()} cue timing is invalid.`);const content:string[]=[];while(index<lines.length&&lines[index].trim())content.push(lines[index++]);if(content.length!==1)throw new Error(`BLOCKED: ${kind.toUpperCase()} cue text must be one nonempty line.`);cues.push({start:timestamp(match[1],kind==='srt'?',':'.'),end:timestamp(match[2],kind==='srt'?',':'.'),text:content[0]})}
  return cues;
}
function expectedCues(evidence:CurrentNativeEvidence){const duration=evidence.scopeSeconds??evidence.effectiveDuration;return evidence.approvedCues.filter(cue=>cue.start<duration).map(cue=>({...cue,end:Math.min(cue.end,duration)}))}
function verifyCues(root:string,prefix:'preview'|'film',evidence:CurrentNativeEvidence){const expected=expectedCues(evidence);for(const kind of ['srt','vtt'] as const){const file=resolveProjectFile(root,`output/${prefix}.${kind}`);if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw new Error(`BLOCKED: native ${kind.toUpperCase()} sidecar is missing or empty.`);const actual=parseSidecar(fs.readFileSync(file,'utf8'),kind);if(actual.length!==expected.length||actual.some((cue,index)=>cue.text!==expected[index].text||!close(cue.start,expected[index].start,.0011)||!close(cue.end,expected[index].end,.0011)))throw new Error(`BLOCKED: native ${kind.toUpperCase()} sidecar does not match approved current captions.`)}return expected}
function verifyReportInputs(report:Record<string,unknown>,evidence:CurrentNativeEvidence){
  if(!Array.isArray(report.inputs))throw new Error('BLOCKED: native report input evidence is missing.');
  const required=[{absolute:evidence.voiceAbsolute,sha256:evidence.voiceSha256,path:evidence.voicePath},...evidence.referenced];
  for(const ref of required){if(!report.inputs.some(value=>{const item=value as Record<string,unknown>;return path.resolve(String(item.path))===ref.absolute&&item.sha256===ref.sha256}))throw new Error(`BLOCKED: native report does not bind current input: ${ref.path}`)}
}
async function verifyContactSheet(root:string,prefix:'preview'|'film',adapter:NativeVerificationAdapter){const file=resolveProjectFile(root,`output/${prefix}-contact-sheet.png`);if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw new Error('BLOCKED: native contact sheet is missing or empty.');const info=await adapter.probe(file),video=streams(info).find(stream=>stream.codec_type==='video');if(!video||video.codec_name!=='png'||Number(video.width)!==960||Number(video.height)!==540)throw new Error('BLOCKED: native contact sheet is not a valid 960x540 PNG.');await adapter.decode(file)}
async function verifyVideo(root:string,prefix:'preview'|'film',evidence:CurrentNativeEvidence,adapter:NativeVerificationAdapter){
  const video=resolveProjectFile(root,`output/${prefix}.mp4`),reportFile=resolveProjectFile(root,`output/${prefix}-report.json`);for(const file of[video,reportFile])if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw new Error(`BLOCKED: native ${prefix} artifact is missing or empty.`);
  const report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>,scope=evidence.scopeSeconds??undefined,core=await adapter.validate(root,scope);
  if(core.valid!==true||!hex64(core.fingerprint)||!close(Number(core.checked_seconds),evidence.scopeSeconds??evidence.effectiveDuration,.002)||!close(Number(core.duration),evidence.effectiveDuration,.002))throw new Error('BLOCKED: original Core validation does not match current effective scope.');
  if(report.fingerprint!==core.fingerprint)throw new Error('BLOCKED: native report fingerprint does not match current original Core fingerprint.');
  if(prefix==='preview'&&!close(Number(report.preview_seconds),evidence.scopeSeconds??NaN,.002))throw new Error('BLOCKED: preview report scope is inconsistent with current original Core scope.');
  if(prefix==='film'&&report.preview_seconds!==null)throw new Error('BLOCKED: film report must represent a full unscoped render.');
  const probe=await adapter.probe(video),mediaFormat=format(probe),allStreams=streams(probe),videoStream=allStreams.find(stream=>stream.codec_type==='video'),audioStream=allStreams.find(stream=>stream.codec_type==='audio'),duration=Number(mediaFormat.duration),frames=Number(videoStream?.nb_frames),expectedDuration=evidence.scopeSeconds??evidence.effectiveDuration;
  if(!String(mediaFormat.format_name??'').split(',').some(name=>['mov','mp4','m4a','3gp','3g2','mj2'].includes(name))||!videoStream||!audioStream||!Number.isInteger(frames)||frames<=0||!close(duration,expectedDuration)||!close(Number(report.duration),duration)||Number(report.frames)!==frames)throw new Error('BLOCKED: native MP4 probe has invalid video/audio/duration/frame evidence.');
  await adapter.decode(video);const videoSha=hashFile(video),cues=verifyCues(root,prefix,evidence);await verifyContactSheet(root,prefix,adapter);
  if(report.output_sha256!==videoSha||path.resolve(String(report.output))!==video||report.full_decode!=='pass'||report.original_voice_sha256!==evidence.voiceSha256||Number(report.caption_count)!==cues.length)throw new Error('BLOCKED: native report does not match current decoded MP4/source evidence.');verifyReportInputs(report,evidence);
  return{path:`output/${prefix}.mp4`,sha256:videoSha,reportPath:`output/${prefix}-report.json`,reportSha256:hashFile(reportFile),sourceFingerprint:evidence.fingerprint,coreFingerprint:core.fingerprint,report};
}
export async function verifyPreviewEvidence(appPath:string,root:string,evidence=currentNativeEvidence(root),adapter=productionNativeVerifier(appPath)){return verifyVideo(root,'preview',evidence,adapter)}
export async function verifyFilmEvidence(appPath:string,root:string,evidence=currentNativeEvidence(root),adapter=productionNativeVerifier(appPath)){const result=await verifyVideo(root,'film',evidence,adapter),checkpointFile=resolveProjectFile(root,'output/checkpoint.json');if(!fs.existsSync(checkpointFile))throw new Error('BLOCKED: native film checkpoint is missing.');const checkpoint=strictJson(fs.readFileSync(checkpointFile,'utf8')) as Record<string,unknown>;if(checkpoint.stage!=='complete'||checkpoint.kind!=='film'||checkpoint.fingerprint!==result.coreFingerprint)throw new Error('BLOCKED: native film checkpoint does not match current completed render.');return result}
export async function verifyPersistedNativeEvidence(appPath:string,root:string,state:StudioState,adapter=productionNativeVerifier(appPath)){
  if(!state.preview&&!state.approval&&!state.render)return;
  const reportFile=resolveProjectFile(root,'output/preview-report.json');if(!fs.existsSync(reportFile))throw new Error('BLOCKED: preview report is missing.');const report=strictJson(fs.readFileSync(reportFile,'utf8')) as Record<string,unknown>,seconds=report.preview_seconds;if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||seconds>60)throw new Error('BLOCKED: preview scope evidence is invalid.');
  const previewEvidence=currentNativeEvidence(root,state,{seconds}),preview=await verifyPreviewEvidence(appPath,root,previewEvidence,adapter);
  if(!state.preview||state.preview.sourceFingerprint!==previewEvidence.fingerprint||state.preview.sha256!==preview.sha256||state.preview.reportSha256!==preview.reportSha256)throw new Error('BLOCKED: saved preview status is stale or unverified.');
  if(state.approval){const file=resolveProjectFile(root,'output/approval.json');if(!fs.existsSync(file))throw new Error('BLOCKED: native approval evidence is missing.');const approval=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;if(approval.preview_sha256!==preview.sha256||approval.preview_fingerprint!==preview.coreFingerprint||state.approval.previewSha256!==preview.sha256)throw new Error('BLOCKED: saved approval does not bind the current verified preview.')}
  if(state.render){const fullEvidence=currentNativeEvidence(root,state),film=await verifyFilmEvidence(appPath,root,fullEvidence,adapter);if(state.render.sourceFingerprint!==fullEvidence.fingerprint||state.render.sha256!==film.sha256||state.render.reportSha256!==film.reportSha256)throw new Error('BLOCKED: saved render status is stale or unverified.')}
}
