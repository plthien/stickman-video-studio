// @vitest-environment node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {narrationParts,joinNarrationWavs} from '../../src/main/narrationApi';
import {runLongform} from '../../src/main/voiceMedia';
import {inspectWavBuffer,projectId,readState,type StudioState} from '../../src/main/services';

const golden=JSON.parse(fs.readFileSync(path.join(process.cwd(),
  'tests/fixtures/nano_api_v1/golden_receipt.json'),'utf8')) as Record<string,unknown>;
const prior=JSON.parse(String(golden.receipt_json)) as Record<string,unknown>;
const sample=Buffer.from(String(golden.wav_base64),'base64');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function project(endpoint:string,sections:Array<{id:string;text:string}>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-narration-api-'));
  roots.push(root);
  fs.mkdirSync(path.join(root,'.studio'),{recursive:true});
  fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({
    version:1,style:'B1',width:1080,height:1920,fps:30,
    voice:{path:'narration.wav'},captions:[],shots:[],sfx:[]
  }));
  const script=sections.map(x=>x.text).join('\n\n');
  const state:StudioState={schema:'mode-b-studio-state-v1',
    project:{id:projectId(root),root,title:'API narration',style:'B1',
      updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},
    brief:{topic:'Test',language:'en',ratio:'9:16'},external:{},
    approvedScript:{sections,text:script,sha256:hash(script),revision:1,
      approvedAt:new Date().toISOString()},
    nano:{endpoint}};
  fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));
  return root;
}
function producer(failSpeechAt=0){
  let speechCalls=0,integrityCalls=0;
  const server=http.createServer((req,res)=>{
    const json=(value:unknown,status=200)=>{
      res.statusCode=status;res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(value));
    };
    if(req.url==='/health')return json({status:'alive'});
    if(req.url==='/lite/readiness')return json({generation_ready:true,runtime_ready:true});
    if(req.url==='/profiles')return json({profiles:[{
      id:'voice',name:'Fixture',consent:'confirmed',language:'en',version:3,
      ref_sha256:'1'.repeat(64),source_sha256:'3'.repeat(64)}]});
    if(req.url==='/profiles/voice')return json({
      id:'voice',consent:'confirmed',language:'en',version:3,
      ref_sha256:'1'.repeat(64),source_sha256:'3'.repeat(64)});
    if(req.url==='/profiles/voice/integrity/verify'){
      integrityCalls++;
      if(req.method!=='POST')return json({code:'INVALID_METHOD'},405);
      return json({verified:true,voice_id:'voice',voice_version:3,
        reference_sha256:'1'.repeat(64),binding:'2'.repeat(64)});
    }
    if(req.url==='/lite/model-capability')return json({
      contract_version:'nano_lite_api_v1',model:'chatterbox-nano',backend:'CUDA0',
      repo_id:'ResembleAI/chatterbox-nano',model_revision:prior.model_revision,
      source_revision:prior.source_revision,loader_mode:'nano=True',
      weights_manifest_sha256:prior.weights_manifest_sha256,
      weights_sha256:Object.fromEntries(Array.from({length:8},(_,i)=>['w'+i,'a'.repeat(64)])),
      native_segment_target_chars:320,native_segment_hard_chars:600,
      segmentation_policy:'nano_sentence_v2',definite_429_nonadmission:true
    });
    if(req.url==='/lite/speed-capability')return json({
      mode:'postprocess_atempo',policy_version:'nano_atempo_speech_only_v1'});
    if(req.url==='/lite/pause-capability')return json({policy_version:'lite_inline_pause_pcm16_v1'});
    if(req.url==='/v1/audio/speech'){
      let raw='';
      req.on('data',b=>raw+=String(b));
      req.on('end',()=>{
        speechCalls++;
        if(failSpeechAt===speechCalls)return json({code:'TEMPORARY_FAILURE'},503);
        const body=JSON.parse(raw) as {input:string;seed:number;speed:number};
        const values={...prior,input_sha256:hash(body.input),seed:body.seed,
          requested_speed:body.speed.toFixed(6),effective_speed:body.speed.toFixed(6),
          atempo_applied:body.speed!==1};
        const canonical=JSON.stringify(Object.fromEntries(
          Object.keys(values).sort().map(key=>[key,values[key as keyof typeof values]])));
        const receiptToken=Buffer.from(canonical).toString('base64url');
        const proof=hash(canonical);
        const headers:Record<string,string>={
          'Content-Type':'audio/wav','X-TTS-Execution-Receipt':receiptToken,
          'X-TTS-Execution-Proof':proof,'X-TTS-Engine':'chatterbox-nano',
          'X-TTS-Backend':'CUDA0','X-TTS-Model-Revision':String(values.model_revision),
          'X-TTS-Voice-Version':'3','X-TTS-Requested-Speed':String(values.requested_speed),
          'X-TTS-Effective-Speed':String(values.effective_speed),
          'X-TTS-Audio-S':(Number(values.audio_frames)/24000).toFixed(9),
          'X-Lite-Audio-S':(Number(values.audio_frames)/24000).toFixed(9),
          'X-Lite-Speech-S':(Number(values.speech_frames)/24000).toFixed(9),
          'X-Lite-Pause-S':(Number(values.authored_pause_frames)/24000).toFixed(9),
          'X-Lite-Pause-Count':String(values.pause_count),
          'X-Lite-Speech-Segments':String(values.speech_span_count),
          'X-TTS-Native-Chunks':String(values.native_chunk_count),
          'X-TTS-Segmentation-Policy':String(values.segmentation_policy)
        };
        for(const [key,value] of Object.entries(headers))res.setHeader(key,value);
        res.end(sample);
      });
      return;
    }
    return json({code:'NOT_FOUND'},404);
  });
  return {server,get:()=>({speechCalls,integrityCalls}),
    start:async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
      const addr=server.address();
      if(!addr||typeof addr==='string')throw new Error('bad server address');
      return 'http://127.0.0.1:'+addr.port;},
    close:async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  };
}
describe('one verified Nano HTTP narration pipeline',()=>{
  it('splits only at outer API 4096-char limits, preserving exact section bytes',()=>{
    const text=('Word followed by another word. ').repeat(170);
    const chunks=narrationParts([{id:'s1',text}]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(item=>item.text.length>0&&item.text.length<=4096)).toBe(true);
    expect(chunks.map(item=>item.text).join('')).toBe(text);
    expect(()=>narrationParts([{id:'s1',text:'A'.repeat(4097)}])).toThrow(/SAFE_BOUNDARY/);
  });
  it('joins verified 24-kHz mono PCM16 WAVs without losing frames',()=>{
    const combined=joinNarrationWavs([sample,sample]);
    expect(inspectWavBuffer(combined).frames).toBe(inspectWavBuffer(sample).frames*2);
    expect(combined.readUInt32LE(40)).toBe(
      inspectWavBuffer(sample).frames*2*2);
  });
  it('generates all sections over HTTP, publishes once and reuses completed proof without deleting captions',async()=>{
    const api=producer();const endpoint=await api.start();
    try{
      const root=project(endpoint,[{id:'a',text:'First chapter.'},{id:'b',text:'Second chapter.'}]);
      const first=await runLongform(root,{voice:'voice'});
      expect(api.get().speechCalls).toBe(2);
      expect(readState(root).longform?.status).toBe('PASS');
      expect(readState(root).voice?.sha256).toBe(first.sha256);
      expect(inspectWavBuffer(fs.readFileSync(path.join(root,'assets/audio/narration.wav'))).frames)
        .toBe(inspectWavBuffer(sample).frames*2);
      const before=fs.readFileSync(path.join(root,'.studio/state.json'));
      const second=await runLongform(root,{voice:'voice'});
      expect(second.sha256).toBe(first.sha256);
      expect(api.get().speechCalls).toBe(2);
      expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    }finally{await api.close();}
  });
  it('never replays an uncertain request without explicit retry; reuses proved earlier parts',async()=>{
    const api=producer(2);const endpoint=await api.start();
    try{
      const root=project(endpoint,[{id:'a',text:'First chapter.'},{id:'b',text:'Second chapter.'}]);
      await expect(runLongform(root,{voice:'voice'})).rejects.toThrow(/NANO_UNCERTAIN/);
      expect(readState(root).longform?.status).toBe('UNCERTAIN');
      expect(api.get().speechCalls).toBe(2);
      await expect(runLongform(root,{voice:'voice',resume:true})).rejects.toThrow(/NANO_UNCERTAIN/);
      expect(api.get().speechCalls).toBe(2);
      await runLongform(root,{voice:'voice',resume:true,retryUncertain:true});
      expect(api.get().speechCalls).toBe(3);
      expect(readState(root).longform?.status).toBe('PASS');
    }finally{await api.close();}
  });
});
