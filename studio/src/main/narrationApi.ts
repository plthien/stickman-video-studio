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
export type JobInput={voice?:string;resume?:boolean;retryUncertain?:boolean;regenerate?:boolean};
export type NarrationAction='generate'|'regenerate'|'resume'|'retry'|'running'|'blocked';
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
      const boundaries=/\s+/g;
      for(const match of remaining.slice(0,API_MAX_CHARS).matchAll(boundaries)){
        const end=(match.index??0)+match[0].length;
        // Do not divide an inline paralinguistic marker at a whitespace.
        const prefix=remaining.slice(0,end);
        if(end>API_MAX_CHARS/2&&end<=API_MAX_CHARS&&
          prefix.lastIndexOf('[')<=prefix.lastIndexOf(']'))cut=end;
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
/** Return the one safe action. The persisted state is authoritative, never
 * a guess based on which React buttons happen to be enabled. */
export function narrationAction(root:string):{action:NarrationAction;reason:string;completed:number;total:number;currentPart?:number;status:string;detail?:string}{
  const job=readState(root).longform;
  if(active.has(root))return{action:'running',reason:'Generation request is active.',completed:job?.completedParts??0,total:job?.totalParts??0,currentPart:job?.currentPart,status:'RUNNING',detail:job?.detail};
  if(!job)return{action:'generate',reason:'No generation attempt.',completed:0,total:0,status:'READY'};
  const progress={completed:job.completedParts??0,total:job.totalParts??0,currentPart:job.currentPart,status:job.status,detail:job.detail};
  if(job.status==='PASS')return{action:'regenerate',reason:'The previous narration attempt passed.',...progress};
  const blocked=(reason:string)=>({action:'blocked' as const,reason,...progress});
  const current=readState(root),script=current.approvedScript;
  if(!script)return blocked('An approved Script is required to recover the saved attempt.');
  try{
    const source=strictJson(fs.readFileSync(resolveProjectFile(root,job.manifestPath),'utf8')) as Record<string,unknown>;
    const parts=narrationParts(script.sections);
    const saved=Array.isArray(source.parts)?source.parts as Array<Record<string,unknown>>:[];
    const matching=saved.length===parts.length&&parts.every((item,index)=>saved[index].sectionId===item.sectionId&&
      saved[index].index===item.index&&saved[index].inputSha256===sha(item.text));
    const expectedEndpoint=nanoBase(current.nano?.endpoint??'http://127.0.0.1:3901').toString();
    if(source.sourceSha256!==job.sourceSha256||source.voice!==job.profileId||
      source.endpoint!==expectedEndpoint||!matching||sha(script.text)!==script.sha256)
      return blocked('Saved attempt does not match the approved Script, voice or Nano endpoint.');
  }catch{return blocked('Saved generation manifest cannot be verified.');}
  if(job.detail&&/CACHED_PART_INVALID|FINAL_CONFLICT|SUMMARY_CONFLICT|MANIFEST_CHANGED|ORPHAN_CONFLICT|PROFILE_CHANGED|RECOVERY_INCOMPATIBLE/.test(job.detail))
    return blocked('Saved attempt contains conflicting or corrupt evidence: '+job.detail);
  const dir=resolveProjectFile(root,job.outputPath);
  const files=fs.existsSync(dir)?fs.readdirSync(dir):[];
  const incomplete=files.some(name=>{
    const match=/^(part-\d+)\.(wav|json)$/.exec(name);
    return Boolean(match&&!files.includes(match[1]+(match[2]==='wav'?'.json':'.wav')));
  });
  const uncertain=files.some(x=>/^part-\d+\.inflight\.json$/.test(x))||incomplete;
  if(uncertain)return{action:'retry',reason:'A pending or partial Nano request requires explicit owner-authorized replay.',...progress};
  if(job.status==='UNCERTAIN'){
    const stored=strictJson(fs.readFileSync(resolveProjectFile(root,job.manifestPath),'utf8')) as Record<string,unknown>;
    const count=Array.isArray(stored.parts)?stored.parts.length:0;
    const allPresent=count>0&&Array.from({length:count},(_,index)=>{
      const stem='part-'+String(index).padStart(4,'0');
      return files.includes(stem+'.wav')&&files.includes(stem+'.json');
    }).every(Boolean);
    if(!allPresent)return blocked('Uncertain job has missing parts but no pending request identity; inspect evidence before replay.');
  }
  return{action:'resume',reason:'Recover the saved attempt; verified parts will be reused.',...progress};
}

export async function generateApiNarration(root:string,input:JobInput){
  if(active.has(root))throw new Error('NARRATION_RUNNING: wait for the current request to finish or recover.');
  active.add(root);
  let jobId='';
  if((input.regenerate&& (input.resume||input.retryUncertain))||(input.retryUncertain&&!input.resume)){
    active.delete(root);throw new Error('NARRATION_INTENT_CONFLICT: select one eligible action.');
  }
  try{
    const initial=readState(root),script=initial.approvedScript,voice=input.voice??initial.nano?.profileId;
    if(!script||!voice)throw new Error('Approved Script and a selected Nano voice profile are required.');
    if(!['en','english'].includes(initial.brief.language.toLowerCase()))
      throw new Error('Pinned Nano API supports English only; import an approved WAV for this language.');
    if(sha(script.text)!==script.sha256||script.sections.map(x=>x.text).join('\n\n')!==script.text)
      throw new Error('NARRATION_SOURCE_MISMATCH: approved Script sections are inconsistent.');
    const endpoint=nanoBase(initial.nano?.endpoint??'http://127.0.0.1:3901').toString();
    const segments=narrationParts(script.sections);
    const verified=await verifiedNanoProfile(endpoint,voice);
    const version=Number(verified.profile.version),binding=verified.binding;
    const sourceSha256=sha(JSON.stringify({project:initial.project.id,script:script.sha256,
      revision:script.revision,voice,version,binding,endpoint,
      segments:segments.map(x=>[x.sectionId,sha(x.text),x.seed,x.speed])}));
    const previous=readState(root).longform;
    const recovering=Boolean(input.resume||input.retryUncertain);
    if(recovering){
      if(!previous||previous.status==='PASS')throw new Error('NARRATION_RECOVERY_UNAVAILABLE: no incomplete attempt.');
      if(previous.sourceSha256!==sourceSha256||previous.profileId!==voice||previous.profileVersion!==version)
        throw new Error('NARRATION_RECOVERY_INCOMPATIBLE: Script, endpoint or Nano profile changed.');
      jobId=previous.jobId;
    }else if(input.regenerate){
      if(!previous||previous.status!=='PASS')
        throw new Error('NARRATION_REGENERATE_INELIGIBLE: resolve the existing attempt before requesting a new generation.');
      jobId=sourceSha256.slice(0,16)+'-'+randomUUID().slice(0,12);
    }else if(previous&&previous.sourceSha256===sourceSha256){
      if(previous.status!=='PASS')throw new Error('NARRATION_RECOVERY_REQUIRED: Resume or Explicit Retry before generating anew.');
      jobId=previous.jobId;
    }else jobId=sourceSha256.slice(0,16)+'-'+randomUUID().slice(0,12);
    const relativeBase='.studio/voice/jobs/'+jobId;
    const output=resolveProjectFile(root,relativeBase+'/output');
    const manifest=resolveProjectFile(root,relativeBase+'/source.json');
    const manifestData={schema:'nano-api-narration-v1',sourceSha256,voice,version,binding,endpoint,
      parts:segments.map(x=>({sectionId:x.sectionId,index:x.index,inputSha256:sha(x.text),seed:x.seed,speed:x.speed}))};
    fs.mkdirSync(output,{recursive:true});
    if(fs.existsSync(manifest)){
      if(JSON.stringify(strictJson(fs.readFileSync(manifest,'utf8')))!==JSON.stringify(manifestData))
        throw new Error('NARRATION_MANIFEST_CHANGED: saved job does not match source.');
    }else atomicJson(manifest,manifestData);
    const old=readState(root);
    // Idempotent repeat must not republish identical WAV and invalidate current
    // alignment/caption approval merely because Generate was clicked twice.
    if(!input.regenerate&&old.longform?.jobId===jobId&&old.longform.status==='PASS'&&
      old.voice?.origin==='NANO_LONGFORM'&&!old.voice.stale&&fs.existsSync(resolveProjectFile(root,relativeBase+'/output/final.wav'))){
      const final=fs.readFileSync(resolveProjectFile(root,relativeBase+'/output/final.wav'));
      const info=inspectWavBuffer(final);
      if(info.sha256!==old.voice.sha256||
        sha(fs.readFileSync(resolveProjectFile(root,old.voice.path)))!==info.sha256)
        throw new Error('NARRATION_PUBLISHED_AUDIO_CHANGED: verified output differs from accepted WAV.');
      return {jobId,path:old.voice.path,sha256:info.sha256,duration:info.duration,
        summary:strictJson(fs.readFileSync(resolveProjectFile(root,relativeBase+'/output/summary.json'),'utf8'))};
    }
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
      if(fs.existsSync(wavPath)||fs.existsSync(proofPath)){
        if(!input.retryUncertain)
          throw new Error('NARRATION_INCOMPLETE_PART: explicit retry required for '+stem);
        // Preserve every unpaired byte in a checksum-addressed orphan file
        // before an owner-authorized replay. Never silently discard a response.
        for(const file of [wavPath,proofPath]){
          if(!fs.existsSync(file))continue;
          const bytes=fs.readFileSync(file),orphan=file+'.orphan-'+sha(bytes);
          if(fs.existsSync(orphan)){
            if(sha(fs.readFileSync(orphan))!==sha(bytes))
              throw new Error('NARRATION_ORPHAN_CONFLICT: '+stem);
          }else atomicBytes(orphan,bytes);
          if(sha(fs.readFileSync(orphan))!==sha(bytes))
            throw new Error('NARRATION_ORPHAN_VERIFICATION_FAILED: '+stem);
          fs.unlinkSync(file);
        }
      }
      if(fs.existsSync(uncertainPath)&&!input.retryUncertain)
        throw new Error('NANO_UNCERTAIN: explicitly retry the pending part '+stem+'.');
      if(fs.existsSync(uncertainPath)&&input.retryUncertain){
        // Preserve the original in-flight marker as evidence for the authorized replay.
        fs.renameSync(uncertainPath,uncertainPath+'.retry-'+randomUUID());
      }
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
        profileVersion:version,resume:Boolean(input.resume),updatedAt:new Date().toISOString(),
        completedParts:wavs.length,totalParts:segments.length,currentPart:part.index,
        mode:input.regenerate?'regenerate':input.retryUncertain?'retry':input.resume?'resume':'generate'};
      writeState(root,fresh);
      atomicJson(uncertainPath,{schema:'nano-api-inflight-v1',sourceSha256,index:part.index,inputSha256:sha(part.text),executionAttemptId:randomUUID(),authorizedRetry:Boolean(input.retryUncertain)});
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
        const progress=readState(root);if(progress.longform?.jobId===jobId){
          progress.longform.completedParts=wavs.length;progress.longform.currentPart=part.index+1;
          progress.longform.updatedAt=new Date().toISOString();writeState(root,progress);
        }
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
      beforePublish.approvedScript?.revision!==script.revision||
      (beforePublish.nano?.endpoint??'http://127.0.0.1:3901')!==
        (initial.nano?.endpoint??'http://127.0.0.1:3901'))
      throw new Error('NARRATION_STALE: Script or Nano endpoint changed before WAV publication.');
    const summary={schema:'nano-api-narration-summary-v1',state:'PASS',sourceSha256,
      parts:segments.length,verifiedParts:wavs.length,finalSha256:info.sha256,
      duration:info.duration,voice,version,binding};
    const finalPath=resolveProjectFile(root,relativeBase+'/output/final.wav');
    const summaryPath=resolveProjectFile(root,relativeBase+'/output/summary.json');
    if(fs.existsSync(finalPath)){
      if(sha(fs.readFileSync(finalPath))!==info.sha256)
        throw new Error('NARRATION_FINAL_CONFLICT: existing assembled WAV differs.');
    }else atomicBytes(finalPath,finalWav);
    if(fs.existsSync(summaryPath)){
      if(JSON.stringify(strictJson(fs.readFileSync(summaryPath,'utf8')))!==JSON.stringify(summary))
        throw new Error('NARRATION_SUMMARY_CONFLICT: saved final proof differs.');
    }else atomicJson(summaryPath,summary);
    const longform:NonNullable<ReturnType<typeof readState>['longform']>={jobId,manifestPath:relativeBase+'/source.json',outputPath:relativeBase+'/output',
      status:'PASS' as const,sourceSha256,profileId:voice,profileVersion:version,
      resume:Boolean(input.resume),updatedAt:new Date().toISOString(),
      completedParts:segments.length,totalParts:segments.length,currentPart:segments.length,
      mode:input.regenerate?'regenerate':input.retryUncertain?'retry':input.resume?'resume':'generate'};
    const accepted=readState(root).voice;
    if(accepted&&!accepted.stale&&accepted.sha256===info.sha256&&
      sha(fs.readFileSync(resolveProjectFile(root,accepted.path)))===info.sha256){
      // New attempt produced byte-identical audio: keep alignment/caption approvals.
      const state=readState(root);state.longform=longform;
      writeState(root,state);
      return {jobId,path:accepted.path,sha256:info.sha256,duration:info.duration,summary};
    }
    const published=acceptNarration(root,{wav:finalWav,expectedScriptSha256:script.sha256,
      voice:{origin:'NANO_LONGFORM',profileId:voice,profileVersion:version,referenceBinding:binding,
        receipt:{schema:'nano-api-assembled-receipt-v1',sourceSha256,summary}},
      nano:{endpoint:new URL(endpoint).origin,profileId:voice},longform});
    return {jobId,path:published.path,sha256:info.sha256,duration:info.duration,summary};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(jobId)mark(root,jobId,/UNCERTAIN|INCOMPLETE_PART|PROFILE_CHANGED/.test(message)?'UNCERTAIN':'FAILED',message);
    throw error;
  }finally{active.delete(root);}
}
