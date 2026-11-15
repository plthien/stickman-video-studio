// @vitest-environment node
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha} from '../../src/main/services';
import type {CurrentNativeEvidence,NativeVerificationAdapter} from '../../src/main/nativeEvidence';

const require=createRequire(import.meta.url),ffmpeg=String(require('ffmpeg-static')),ffprobe=String((require('@ffprobe-installer/ffprobe') as {path:string}).path),cache=new Map<number,Buffer>();let sheet:Buffer|undefined;
const run=(exe:string,args:string[])=>{const result=spawnSync(exe,args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||`${path.basename(exe)} failed`);return result.stdout};
export function realMp4(seconds:number){const key=Number(seconds.toFixed(3)),prior=cache.get(key);if(prior)return prior;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r2-real-evidence-')),file=path.join(dir,'actual.mp4');try{run(ffmpeg,['-v','error','-y','-f','lavfi','-i',`color=c=black:s=16x16:r=30:d=${key}`,'-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t',String(key),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file]);const bytes=fs.readFileSync(file);cache.set(key,bytes);return bytes}finally{fs.rmSync(dir,{recursive:true,force:true})}}
export function realSheet(){if(sheet)return sheet;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r2-real-sheet-')),file=path.join(dir,'sheet.png');try{run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=black:s=960x540','-frames:v','1',file]);sheet=fs.readFileSync(file);return sheet}finally{fs.rmSync(dir,{recursive:true,force:true})}}
const stamp=(seconds:number,vtt=false)=>{const ms=Math.round(seconds*1000);return`${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${vtt?'.':','}${String(ms%1000).padStart(3,'0')}`};
const probeFile=(file:string)=>JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file])) as Record<string,unknown>;
export function verifier(evidence:CurrentNativeEvidence,options:{fingerprint?:string;checkedSeconds?:number;duration?:number;probe?:NativeVerificationAdapter['probe'];decode?:NativeVerificationAdapter['decode']}={}):NativeVerificationAdapter{return{
  validate:async()=>({valid:true,fingerprint:options.fingerprint??'f'.repeat(64),checked_seconds:options.checkedSeconds??evidence.scopeSeconds??evidence.effectiveDuration,duration:options.duration??evidence.effectiveDuration}),
  probe:options.probe??(async file=>probeFile(file)),
  decode:options.decode??(async file=>{run(ffmpeg,['-v','error','-i',file,'-f','null','-'])})
}}
export function writePreviewEvidence(root:string,evidence:CurrentNativeEvidence,options:{fingerprint?:string;scope?:number;video?:Buffer;sheet?:Buffer;fullDecode?:string;srt?:string;vtt?:string}={}){
  const out=path.join(root,'output');fs.mkdirSync(out,{recursive:true});const scope=options.scope??evidence.scopeSeconds??evidence.effectiveDuration,video=path.join(out,'preview.mp4'),report=path.join(out,'preview-report.json'),bytes=options.video??realMp4(scope);fs.writeFileSync(video,bytes);const cues=evidence.approvedCues.filter(cue=>cue.start<scope).map(cue=>({...cue,end:Math.min(cue.end,scope)}));
  fs.writeFileSync(path.join(out,'preview.srt'),options.srt??cues.map((cue,index)=>`${index+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n'));fs.writeFileSync(path.join(out,'preview.vtt'),options.vtt??'WEBVTT\n\n'+cues.map(cue=>`${stamp(cue.start,true)} --> ${stamp(cue.end,true)}\n${cue.text}\n`).join('\n'));fs.writeFileSync(path.join(out,'preview-contact-sheet.png'),options.sheet??realSheet());
  const probe=probeFile(video),stream=(probe.streams as Array<Record<string,unknown>>).find(item=>item.codec_type==='video')!,value={fingerprint:options.fingerprint??'f'.repeat(64),preview_seconds:scope,output:path.resolve(video),output_sha256:sha(bytes),original_voice_sha256:evidence.voiceSha256,frames:Number(stream.nb_frames),duration:Number((probe.format as Record<string,unknown>).duration),caption_count:cues.length,shot_count:1,full_decode:options.fullDecode??'pass',inputs:[{path:evidence.voiceAbsolute,sha256:evidence.voiceSha256},...evidence.referenced.map(item=>({path:item.absolute,sha256:item.sha256}))]};fs.writeFileSync(report,JSON.stringify(value));return{value,video,report}
}
