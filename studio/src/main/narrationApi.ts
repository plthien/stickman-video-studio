/** API-only narration assembly. VoiceStudio owns 320/600-character native speech
 * segmentation; Studio owns only outer <=4096-character HTTP calls and durable
 * per-part receipts. No VoiceStudio checkout, subprocess, or paid LLM API.
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decodeProducerReceipt,nanoBase,synthesizeNano,verifiedNanoProfile} from './nanoClient.js';
import {acceptNarration,atomicJson,inspectWavBuffer,readState,resolveProjectFile,sha,strictJson,writeState} from './services.js';

const API_MAX_CHARS=4096;
const FINAL_MAX_SECONDS=900;
const active=new Set<string>();
type Part={sectionId:string;index:number;text:string;seed:number;speed:number};
type JobInput={voice?:string;resume?:boolean;retryUncertain?:boolean};
type PartReceipt={schema:string;index:number;inputSha256:string;wavSha256:string;
  receiptToken:string;proof:string;profileVersion:number;referenceSha256:string;binding:string};

export function narrationParts(sections:ReadonlyArray<{id:string;text:string}>):Part[]{
  if(!sections.length)throw new Error('Approved narration has no sections.');
  const result:Part[]=[];
  for(const section of sections){
    if(!section.text||!section.text.trim())throw new Error('Approved narration section is empty.');
    const chunks:string[]=[];
    let remaining=section.text;
    while(remaining.length>API_MAX_CHARS){
      // Split at an existing whitespace boundary; preserve the original bytes
      // exactly and never fabricate a pause or spoken word.
      let cut=-1;
      const boundaries=/\\s+/g;
      for(const match of remaining.slice(0,API_MAX_CHARS).matchAll(boundaries)){
        const end=(match.index??0)+match[0].length;
        if(end>API_MAX_CHARS/2&&end<=API_MAX_CHARS)cut=end;
      }
      if(cut<1)throw new Error('NANO_OUTER_SAFE_BOUNDARY_UNAVAILABLE: section contains an overlong unbroken span.');
      chunks.push(remaining.slice(0,cut));
      remaining=remaining.slice(cut);
    }
    if(remaining)chunks.push(remaining);
    if(chunks.join('')!==section.text)throw new Error('NARRATION_SOURCE_SEGMENT_MISMATCH');
    for(const text of chunks)result.push({sectionId:section.id,index:result.length,text,seed:42,speed:1});
  }
  if(result.length>200)throw new Error('Narration exceeds the 200-request safety limit.');
  return result;
}
function pcm(wav:Buffer):Buffer{
  inspectWavBuffer(wav);
  let offset=12,chunk:Buffer|null=null;
  while(offset+8<=wav.length){
    const name=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4);
    const start=offset+8;
    if(start+length>wav.length)throw new Error('Truncated WAV part.');
    if(name==='data'){
      if(chunk)throw new Error('Multiple WAV data chunks are not supported.');
      chunk=wav.subarray(start,start+length);
    }
    offset=start+length+(length%2);
  }
  if(!chunk||chunk.length<2||chunk.length%2)throw new Error('Invalid WAV PCM payload.');
  return chunk;
}
export function joinNarrationWavs(parts:Buffer[]):Buffer{
  if(!parts.length)throw new Error('No WAV parts to join.');
  const data=parts.map(pcm),size=data.reduce((a,b)=>a+b.length,0);
  if(size>FINAL_MAX_SECONDS*24000*2)throw new Error('FINAL_AUDIO_LIMIT_EXCEEDED: 900 seconds.');
  const wav=Buffer.alloc(44+size);
  wav.write('RIFF',0,'ascii');wav.writeUInt32LE(36+size,4);wav.write('WAVEfmt ',8,'ascii');
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36,'ascii');
  wav.writeUInt32LE(size,40);
  let offset=44;
  for(const bytes of data){bytes.copy(wav,offset);offset+=bytes.length;}
  inspectWavBuffer(wav);
  return wav;
}
function atomicBytes(file:string,bytes:Buffer){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{
    const handle=fs.openSync(temp,'wx');
    try{fs.writeFileSync(handle,bytes);fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
    fs.renameSync(temp,file);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function mark(root:string,jobId:string,status:'RUNNING'|'UNCERTAIN'|'FAILED',detail?:string){
  const state=readState(root);
  if(state.longform?.jobId===jobId){
    state.longform.status=status;
    state.longform.detail=detail?.slice(0,500);
    state.longform.updatedAt=new Date().toISOString();
    writeState(root,state);
  }
}
export async function generateApiNarration(root:string,input:JobInput){
  if(active.has(root))throw new Error('NARRATION_RUNNING: wait for the current request to finish or recover.');
  active.add(root);
  let jobId='';
  try{
    const initial=readState(root),script=initial.approvedScript,voice=input.voice??initial.nano?.profileId;
    if(!script||!voice)throw new Error('Approved Script and a selected Nano voice profile are required.');
    if(!['en','english'].includes(initial.brief.language.toLowerCase()))
      throw new Error('Pinned Nano API supports English only; import an approved WAV for this language.');
    if(sha(script.text)!==script.sha256||script.sections.map(x=>x.text).join('\\n\\n')!==script.text)
      throw new Error('NARRATION_SOURCE_MISMATCH: approved Script sections are inconsistent.');
    const endpoint=nanoBase(initial.nano?.endpoint??'http://127.0.0.1:3901').toString();
    const segments=narrationParts(script.sections);
    const verified=await verifiedNanoProfile(endpoint,voice);
    const version=Number(verified.profile.version),binding=verified.binding;
    const sourceSha256=sha(JSON.stringify({project:initial.project.id,script:script.sha256,
      revision:script.revision,voice,version,binding,endpoint,
      segments:segments.map(x=>[x.sectionId,sha(x.text),x.seed,x.speed])}));
    jobId=sourceSha256.slice(0,24);
    const relativeBase='.studio/voice/jobs/'+jobId;
    const folder=resolveProjectFile(root,relativeBase),output=resolveProjectFile(root,relativeBase+'/output');
    const manifest=resolveProjectFile(root,relativeBase+'/source.json');
    const manifestData={schema:'nano-api-narration-v1',sourceSha256,voice,version,binding,endpoint,
      parts:segments.map(x=>({sectionId:x.sectionId,index:x.index,inputSha256:sha(x.text),seed:x.seed,speed:x.speed}))};
    fs.mkdirSync(output,{recursive:true});
    if(fs.existsSync(manifest)){
      if(JSON.stringify(strictJson(fs.readFileSync(manifest,'utf8')))!==JSON.stringify(manifestData))
        throw new Error('NARRATION_MANIFEST_CHANGED: saved job does not match source.');
    }else atomicJson(manifest,manifestData);
    const old=readState(root);
    if(old.longform?.jobId===jobId&&old.longform.status==='UNCERTAIN'&&!input.retryUncertain)
      throw new Error('NANO_UNCERTAIN: explicit retry is required for this saved job.');
    const wavs:Buffer[]=[];
    for(const part of segments){
      const stem='part-'+String(part.index).padStart(4,'0');
      const wavPath=resolveProjectFile(root,relativeBase+'/output/'+stem+'.wav');
      const proofPath=resolveProjectFile(root,relativeBase+'/output/'+stem+'.json');
      const uncertainPath=resolveProjectFile(root,relativeBase+'/output/'+stem+'.inflight.json');
      if(fs.existsSync(wavPath)&&fs.existsSync(proofPath)){
        const wav=fs.readFileSync(wavPath);
        const proof=strictJson(fs.readFileSync(proofPath,'utf8')) as PartReceipt;
        if(proof.schema!=='nano-api-part-v1'||proof.index!==part.index||
          proof.inputSha256!==sha(part.text)||proof.wavSha256!==sha(wav)||
          proof.binding!==binding||proof.profileVersion!==version||
          proof.referenceSha256!==verified.profile.ref_sha256)
          throw new Error('NARRATION_CACHED_PART_INVALID: '+stem);
        decodeProducerReceipt(proof.receiptToken,proof.proof,wav,{
          input:part.text,voice,speed:part.speed,seed:part.seed,
          profile:{id:voice,version,ref_sha256:String(verified.profile.ref_sha256)},binding});
        wavs.push(wav);
        if(fs.existsSync(uncertainPath))fs.unlinkSync(uncertainPath);
        continue;
      }
      if(fs.existsSync(wavPath)||fs.existsSync(proofPath))
        throw new Error('NARRATION_INCOMPLETE_PART: partial proof/file requires manual recovery: '+stem);
      if(fs.existsSync(uncertainPath)&&!input.retryUncertain)
        throw new Error('NANO_UNCERTAIN: explicitly retry the pending part '+stem+'.');
      if(part.index>0&&wavs.length>0&&!input.resume&&!input.retryUncertain&&
        (old.longform?.jobId===jobId)&&old.longform.status!=='PASS')
        throw new Error('NARRATION_RESUME_REQUIRED: continue saved sections using Resume.');
      const fresh=readState(root);
      if(fresh.project.id!==initial.project.id||fresh.approvedScript?.sha256!==script.sha256||
        fresh.approvedScript?.revision!==script.revision||
        (fresh.nano?.endpoint??'http://127.0.0.1:3901')!== (initial.nano?.endpoint??'http://127.0.0.1:3901'))
        throw new Error('NARRATION_STALE: project Script/endpoint changed.');
      fresh.longform={jobId,manifestPath:relativeBase+'/source.json',
        outputPath:relativeBase+'/output',status:'RUNNING',sourceSha256,profileId:voice,
        profileVersion:version,resume:Boolean(input.resume),updatedAt:new Date().toISOString()};
      writeState(root,fresh);
      atomicJson(uncertainPath,{schema:'nano-api-inflight-v1',sourceSha256,index:part.index,inputSha256:sha(part.text)});
      try {
        const generated=await synthesizeNano({endpoint,input:part.text,voice,speed:part.speed,seed:part.seed,
          expectedBinding:binding,expectedVersion:version});
        atomicBytes(wavPath,generated.wav);
        const receipt:PartReceipt={schema:'nano-api-part-v1',index:part.index,
          inputSha256:sha(part.text),wavSha256:sha(generated.wav),
          receiptToken:generated.receiptToken,proof:generated.proof,
          profileVersion:version,referenceSha256:generated.referenceSha256,binding};
        atomicJson(proofPath,receipt);
        decodeProducerReceipt(receipt.receiptToken,receipt.proof,fs.readFileSync(wavPath),{
          input:part.text,voice,speed:part.speed,seed:part.seed,
          profile:{id:voice,version,ref_sha256:String(verified.profile.ref_sha256)},binding});
        fs.unlinkSync(uncertainPath);
        wavs.push(generated.wav);
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        if(message.startsWith('NANO_NOT_ADMITTED_')&&fs.existsSync(uncertainPath))
          fs.unlinkSync(uncertainPath);
        throw error;
      }
    }
    const latest=await verifiedNanoProfile(endpoint,voice);
    if(latest.binding!==binding||latest.profile.version!==version)
      throw new Error('NANO_PROFILE_CHANGED: reference changed during assembled narration.');
    const finalWav=joinNarrationWavs(wavs),info=inspectWavBuffer(finalWav);
    const beforePublish=readState(root);
    if(beforePublish.project.id!==initial.project.id||beforePublish.approvedScript?.sha256!==script.sha256||
      beforePublish.approvedScript?.revision!==script.revision)
      throw new Error('NARRATION_STALE: Script changed before WAV publication.');
    const summary={schema:'nano-api-narration-summary-v1',state:'PASS',sourceSha256,
      parts:segments.length,verifiedParts:wavs.length,finalSha256:info.sha256,
      duration:info.duration,voice,version,binding};
    const finalPath=resolveProjectFile(root,relativeBase+'/output/final.wav');
    atomicBytes(finalPath,finalWav);
    atomicJson(resolveProjectFile(root,relativeBase+'/output/summary.json'),summary);
    const longform={jobId,manifestPath:relativeBase+'/source.json',outputPath:relativeBase+'/output',
      status:'PASS' as const,sourceSha256,profileId:voice,profileVersion:version,
      resume:Boolean(input.resume),updatedAt:new Date().toISOString()};
    const published=acceptNarration(root,{wav:finalWav,expectedScriptSha256:script.sha256,
      voice:{origin:'NANO_LONGFORM',profileId:voice,profileVersion:version,referenceBinding:binding,
        receipt:{schema:'nano-api-assembled-receipt-v1',sourceSha256,summary}},
      nano:{endpoint:endpoint.replace(/\\/$/,''),profileId:voice},longform});
    return {jobId,path:published.path,sha256:info.sha256,duration:info.duration,summary};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(jobId)mark(root,jobId,/UNCERTAIN|INCOMPLETE_PART|PROFILE_CHANGED/.test(message)?'UNCERTAIN':'FAILED',message);
    throw error;
  }finally{active.delete(root);}
}
