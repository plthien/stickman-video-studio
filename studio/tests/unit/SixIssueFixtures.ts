// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approveCaptionReview, draftCaptionReview, approvedCaptionCues } from '../../src/main/captionReview';
import { freezeTask, stageImport } from '../../src/main/externalTasks';
import { alignmentText } from '../../src/main/alignment';
import { projectId, readState, sha, writeState, type StudioState } from '../../src/main/services';

export const appPath=path.resolve('.');
export const tmpRoots:string[]=[];
export const cleanup=()=>{for(const root of tmpRoots.splice(0))fs.rmSync(root,{recursive:true,force:true})};
const mkdir=(file:string)=>fs.mkdirSync(path.dirname(file),{recursive:true});
export const wav=(seconds=30)=>{const bytes=Buffer.alloc(44+seconds*48000);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes};
export const png=()=>Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==','base64');
export interface Fixture { root:string;state:StudioState;audio:Buffer;voicePath:string;wordsPath:string;coreCuesPath:string }
export function fixture(options:{approve?:boolean;style?:'B1'|'B2'|'B3'|'B4'}={}):Fixture{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-six-ut-'));tmpRoots.push(root);
  const voicePath='assets/audio/narration.wav',wordsPath='.studio/alignment/words.json',coreCuesPath='.studio/alignment/core-cues.json',audio=wav();
  const words={schema:'mode-b-word-alignment-v1',words:[{word:'One',start:.1,end:.3},{word:'two',start:.35,end:.6},{word:'three',start:.65,end:.9}]};
  const cues=[{start:.1,end:.9,text:'One two three'}];
  const manifest={version:1,style:options.style??'B1',width:1080,height:1920,fps:30,voice:{path:voicePath},captions:cues,shots:[{id:'old-shot',start:0,end:30,layers:[{id:'old-text',type:'text',text:'Last-good original shot'}]}],sfx:[]};
  for(const [relative,bytes] of [[voicePath,audio],[wordsPath,Buffer.from(JSON.stringify(words))],[coreCuesPath,Buffer.from(JSON.stringify(cues))]] as Array<[string,Buffer]>){const file=path.join(root,relative);mkdir(file);fs.writeFileSync(file,bytes)}
  fs.writeFileSync(path.join(root,'project.json'),JSON.stringify(manifest));
  const script='One two three',style=options.style??'B1';
  const state:StudioState={
    schema:'mode-b-studio-state-v1',project:{id:projectId(root),root,title:'Six issue UT',style,updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},
    brief:{topic:'Real persisted media and caption integration',language:'en',ratio:'9:16'},external:{},tasks:{},nano:{endpoint:'http://127.0.0.1:3901'},
    approvedScript:{sections:[{id:'opening',text:script}],text:script,sha256:sha(script),revision:1,approvedAt:new Date().toISOString(),authoring:{source_references:[]}},
    voice:{path:voicePath,sha256:sha(audio),generatedAt:new Date().toISOString(),duration:30,stale:false,origin:'IMPORTED_WAV'},
    alignment:{path:wordsPath,captionsPath:coreCuesPath,audioSha256:sha(audio),scriptSha256:sha(alignmentText(script)),wordsSha256:sha(fs.readFileSync(path.join(root,wordsPath))),cuesSha256:sha(fs.readFileSync(path.join(root,coreCuesPath))),generatedAt:new Date().toISOString(),origin:'IMPORTED_WORDS'}
  };
  writeState(root,state);
  if(options.approve!==false){draftCaptionReview(root,[3]);approveCaptionReview(root,'Verified actual grouped captions and spoken text');}
  return{root,state:readState(root),audio,voicePath,wordsPath,coreCuesPath};
}
export function nativePayload(root:string,opts:{image?:'early'|'late'|'both';sameBasename?:boolean;sfx?:boolean;unsafe?:string}={}){
  const cues=approvedCaptionCues(root),voicePath=readState(root).voice!.path,shots:Array<Record<string,unknown>>=[
    {id:'shot-1',start:0,end:20,layers:opts.image==='early'||opts.image==='both'?[{id:'image-1',type:'image',path:opts.unsafe??'assets/images/missing.png'}]:[{id:'text-1',type:'text',text:'First in-scope shot'}]},
    {id:'shot-2',start:20,end:30,layers:opts.image==='late'||opts.image==='both'?[{id:'image-2',type:'image',path:opts.sameBasename?'assets/images/missing.png':'assets/images/late.png'}]:[{id:'text-2',type:'text',text:'Second shot'}]}
  ];
  return {manifest:{version:1,style:readState(root).project.style,width:1080,height:1920,fps:30,voice:{path:voicePath},captions:cues,shots,sfx:opts.sfx?[{kind:'file',path:opts.unsafe??'assets/sfx/missing.wav',time:22,gain:.1}]:[]},shot_ledger:[],sound_script:[],asset_needs:[]};
}
export function frozenEnvelope(root:string,stage:'script'|'native',payload:unknown){
  const task=freezeTask(appPath,root,stage);
  return {schema:'mode-b-external-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage,payload};
}
export function stageNative(root:string,payload:unknown){
  const envelope=frozenEnvelope(root,'native',payload);
  const response=stageImport(appPath,root,'native',JSON.stringify(envelope));
  return {response,envelope};
}
export function validator(opts:{sampleFail?:boolean;fullFail?:boolean}={}){
  const calls:string[][]=[];
  const run=async(_exe:string,args:string[],_options:{cwd:string})=>{
    calls.push([...args]);const scoped=args.includes('--seconds');
    if(scoped&&opts.sampleFail||!scoped&&opts.fullFail)return{code:1,stdout:'',stderr:'Injected original CLI validation failure'};
    return {code:0,stdout:JSON.stringify({valid:true,fingerprint:sha(fs.readFileSync(args[2])),checked_seconds:scoped?Math.min(30,Number(args[args.indexOf('--seconds')+1])):30}),stderr:''};
  };
  return {run,calls};
}
export function importedSource(root:string,kind:'image'|'sfx'='image'){
  const source=path.join(root,'owner-source-'+kind+(kind==='image'?'.png':'.wav'));fs.writeFileSync(source,kind==='image'?png():wav(1));return source;
}
