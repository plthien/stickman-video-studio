/** Deterministic localhost Nano HTTP test server.
 * Uses the producer golden WAV/receipt shape, but binds every proof to the
 * actual requested voice, input and speed. No production integrity bypass.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const golden=JSON.parse(fs.readFileSync(path.join(process.cwd(),
  'tests/fixtures/nano_api_v1/golden_receipt.json'),'utf8')) as Record<string,unknown>;
const prior=JSON.parse(String(golden.receipt_json)) as Record<string,unknown>;
const wav=Buffer.from(String(golden.wav_base64),'base64');
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

export interface NanoMockOptions{
  voiceId?:string;
  failSpeechAt?:number;
  integrityFailure?:{status:number;code:string};
  onFirstIntegrity?:()=>Promise<void>;
  onFirstSpeech?:()=>Promise<void>;
}

export function createNanoTestProducer(options:NanoMockOptions={}){
  const voiceId=options.voiceId??'voice',voicePath='/profiles/'+encodeURIComponent(voiceId);
  let speechCalls=0,integrityCalls=0;
  const profile={id:voiceId,name:'Fixture',consent:'confirmed',language:'en',
    version:3,ref_sha256:'1'.repeat(64),source_sha256:'3'.repeat(64)};
  const binding='2'.repeat(64);
  const server=http.createServer((req,res)=>{
    const json=(value:unknown,status=200)=>{
      res.statusCode=status;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(value));
    };
    if(req.url==='/health')return json({status:'alive'});
    if(req.url==='/lite/readiness')return json({generation_ready:true,runtime_ready:true});
    if(req.url==='/profiles')return json({profiles:[profile]});
    if(req.url===voicePath)return json(profile);
    if(req.url===voicePath+'/integrity/verify'){
      if(req.method!=='POST')return json({code:'INVALID_METHOD'},405);
      const number=++integrityCalls;
      void (async()=>{
        try{
          if(number===1)await options.onFirstIntegrity?.();
          if(options.integrityFailure)
            return json({code:options.integrityFailure.code},options.integrityFailure.status);
          return json({verified:true,voice_id:voiceId,voice_version:3,
            reference_sha256:profile.ref_sha256,binding});
        }catch{return json({code:'MOCK_INTEGRITY_FAILURE'},500);}
      })();
      return;
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
    if(req.url==='/lite/pause-capability')return json({
      policy_version:'lite_inline_pause_pcm16_v1'});
    if(req.url==='/v1/audio/speech'){
      let raw='';
      req.on('data',part=>raw+=String(part));
      req.on('end',()=>{
        const number=++speechCalls;
        void (async()=>{
          try{
            if(number===1)await options.onFirstSpeech?.();
            if(number===options.failSpeechAt)return json({code:'TEMPORARY_FAILURE'},503);
            const body=JSON.parse(raw) as {input:string;speed:number;seed:number};
            const values={...prior,voice_id:voiceId,voice_version:profile.version,
              reference_sha256:profile.ref_sha256,reference_binding:binding,
              input_sha256:hash(body.input),native_chunk_sha256:[hash(body.input)],
              seed:body.seed,requested_speed:body.speed.toFixed(6),
              effective_speed:body.speed.toFixed(6),atempo_applied:body.speed!==1};
            const canonical=JSON.stringify(Object.fromEntries(
              Object.keys(values).sort().map(key=>[key,values[key]])));
            const receiptToken=Buffer.from(canonical).toString('base64url');
            const headers:Record<string,string>={
              'Content-Type':'audio/wav',
              'X-TTS-Execution-Receipt':receiptToken,
              'X-TTS-Execution-Proof':hash(canonical),
              'X-TTS-Engine':'chatterbox-nano',
              'X-TTS-Backend':'CUDA0',
              'X-TTS-Model-Revision':String(values.model_revision),
              'X-TTS-Voice-Version':String(values.voice_version),
              'X-TTS-Requested-Speed':String(values.requested_speed),
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
            for(const [key,value]of Object.entries(headers))res.setHeader(key,value);
            res.end(wav);
          }catch{return json({code:'MOCK_SPEECH_FAILURE'},500);}
        })();
      });
      return;
    }
    return json({code:'NOT_FOUND'},404);
  });
  return {
    server,
    get:()=>({speechCalls,integrityCalls}),
    start:async()=>{
      await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
      const address=server.address();
      if(!address||typeof address==='string')throw new Error('Missing mock producer address.');
      return 'http://127.0.0.1:'+address.port;
    },
    close:async()=>{
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  };
}
