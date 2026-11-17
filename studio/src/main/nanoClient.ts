import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { acceptNarration, inspectWavBuffer, readState } from './services.js';
export { inspectWavBuffer } from './services.js';

export const PRODUCER_PIN = '7792fb47c292d8f0da8a4666d174be4689ac34b3';
const MODEL_REVISION='71ccd1d0081b430592cea481f4307e764e07bc64',SOURCE_REVISION='ab55923c27757c90cfcc407baa57dc25a7d25217',WEIGHTS_MANIFEST='d3771b5c6535499b315470191bcc9e0f89687867f1de5f331bd65f5fbcff01db';
const RECEIPT_FIELDS=new Set(['schema_version','model','backend','repo_id','model_revision','source_revision','loader_mode','weights_manifest_sha256','voice_id','voice_version','reference_sha256','reference_binding','input_sha256','seed','speed_mode','speed_policy_version','requested_speed','effective_speed','atempo_applied','pause_policy_version','segmentation_policy','speech_span_count','native_chunk_count','native_chunk_sha256','wav_sha256','sample_rate_hz','channels','sample_width_bytes','audio_frames','speech_frames','authored_pause_frames','pause_count']);
const HEX64=/^[a-f0-9]{64}$/;
const digest=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const canonical=(value:Record<string,unknown>)=>Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]))));
const speedAscii=(value:number)=>{if(!Number.isFinite(value)||value<.75||value>1.25)throw new Error('Nano speed must be 0.75..1.25.');return value.toFixed(6)};
const frameSeconds=(frames:number)=>(frames/24000).toFixed(9);

export function nanoBase(value:string){const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','::1'].includes(url.hostname)||url.username||url.password||(url.pathname!=='/'&&url.pathname!=='')||url.search||url.hash)throw new Error('Nano endpoint must be a plain loopback HTTP origin.');const port=Number(url.port||80);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Nano endpoint uses an unsafe port.');return new URL(`${url.protocol}//${url.host}`)}
const fetchLocal=(base:URL,route:string,init?:RequestInit)=>fetch(new URL(route,base),{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(10_000)});
const readJson=async(response:Response)=>{const text=await response.text();if(text.length>1024*1024)throw new Error('Nano JSON response is too large.');const value=JSON.parse(text)as unknown;if(!value||typeof value!=='object')throw new Error('Nano returned invalid JSON.');return value as Record<string,unknown>};
const requiredHeader=(response:Response,name:string)=>{const value=response.headers.get(name);if(!value)throw new Error(`Nano response missing ${name}.`);return value};

export async function discoverNano(endpoint:string){
  const base=nanoBase(endpoint),routes=['/health','/lite/readiness','/profiles','/lite/model-capability','/lite/speed-capability','/lite/pause-capability'];
  const responses=await Promise.all(routes.map(route=>fetchLocal(base,route)));if(responses.some(response=>!response.ok))throw new Error('Nano discovery endpoint failed.');
  const [health,readiness,profilesBody,model,speed,pause]=await Promise.all(responses.map(readJson));
  const listed=Array.isArray(profilesBody)?profilesBody:Array.isArray(profilesBody.profiles)?profilesBody.profiles:[];
  const profiles=listed.filter(item=>{const value=item as Record<string,unknown>;return typeof value.id==='string'&&value.consent==='confirmed'&&value.language==='en'&&Number.isInteger(value.version)&&typeof value.ref_sha256==='string'&&HEX64.test(value.ref_sha256)&&typeof value.source_sha256==='string'&&HEX64.test(value.source_sha256)});
  const weights=model.weights_sha256 as Record<string,unknown>|undefined,weightsValid=weights&&Object.keys(weights).length===8&&Object.values(weights).every(value=>typeof value==='string'&&HEX64.test(value));
  const ready=health.status==='alive'&&readiness.generation_ready===true&&readiness.runtime_ready===true&&model.contract_version==='nano_lite_api_v1'&&model.model==='chatterbox-nano'&&model.backend==='CUDA0'&&model.repo_id==='ResembleAI/chatterbox-nano'&&model.model_revision===MODEL_REVISION&&model.source_revision===SOURCE_REVISION&&model.loader_mode==='nano=True'&&model.weights_manifest_sha256===WEIGHTS_MANIFEST&&weightsValid&&model.native_segment_target_chars===320&&model.native_segment_hard_chars===600&&model.segmentation_policy==='nano_sentence_v2'&&model.definite_429_nonadmission===true&&speed.mode==='postprocess_atempo'&&speed.policy_version==='nano_atempo_speech_only_v1'&&pause.policy_version==='lite_inline_pause_pcm16_v1';
  return{ready,health,readiness,profiles,capabilities:{model,speed,pause},producerPin:PRODUCER_PIN};
}

export interface NanoExpected {input:string;voice:string;speed:number;seed:number;profile:{id:string;version:number;ref_sha256:string};binding:string}
export function decodeProducerReceipt(token:string,proof:string,wav:Buffer,expected:NanoExpected){
  if(!token||token.includes('=')||Buffer.byteLength(token)>8192||!/^[A-Za-z0-9_-]+$/.test(token)||!HEX64.test(proof))throw new Error('Invalid Nano execution receipt/proof.');
  const raw=Buffer.from(token,'base64url');if(raw.length>6144)throw new Error('Nano receipt is too large.');let receipt:Record<string,unknown>;try{receipt=JSON.parse(raw.toString('utf8'))as Record<string,unknown>}catch{throw new Error('Invalid Nano receipt JSON.')}
  if(Object.keys(receipt).length!==RECEIPT_FIELDS.size||Object.keys(receipt).some(key=>!RECEIPT_FIELDS.has(key))||!canonical(receipt).equals(raw)||digest(raw)!==proof)throw new Error('Nano receipt is noncanonical or proof mismatched.');
  const speed=speedAscii(expected.speed),wavInfo=inspectWavBuffer(wav),fixed:Record<string,unknown>={schema_version:'nano_execution_receipt_v1',model:'chatterbox-nano',backend:'CUDA0',repo_id:'ResembleAI/chatterbox-nano',model_revision:MODEL_REVISION,source_revision:SOURCE_REVISION,loader_mode:'nano=True',weights_manifest_sha256:WEIGHTS_MANIFEST,voice_id:expected.voice,voice_version:expected.profile.version,reference_sha256:expected.profile.ref_sha256,reference_binding:expected.binding,input_sha256:digest(expected.input),seed:expected.seed,speed_mode:'postprocess_atempo',speed_policy_version:'nano_atempo_speech_only_v1',requested_speed:speed,effective_speed:speed,atempo_applied:speed!=='1.000000',pause_policy_version:'lite_inline_pause_pcm16_v1',segmentation_policy:'nano_sentence_v2',wav_sha256:digest(wav),sample_rate_hz:24000,channels:1,sample_width_bytes:2};
  for(const[key,value]of Object.entries(fixed))if(receipt[key]!==value)throw new Error(`Nano execution context mismatch: ${key}`);
  const chunks=receipt.native_chunk_sha256;if(!Array.isArray(chunks)||chunks.length<1||chunks.some(value=>typeof value!=='string'||!HEX64.test(value))||!Number.isInteger(receipt.speech_span_count)||Number(receipt.speech_span_count)<1||receipt.audio_frames!==wavInfo.frames||receipt.audio_frames!==Number(receipt.speech_frames)+Number(receipt.authored_pause_frames)||receipt.native_chunk_count!==chunks.length||!Number.isInteger(receipt.pause_count)||Number(receipt.pause_count)<0)throw new Error('Nano frame/chunk receipt mismatch.');
  return{receipt,wavInfo};
}

export function verifyProducerHeaders(response:Response,receipt:Record<string,unknown>){const expected:Record<string,string>={'Content-Type':'audio/wav','X-TTS-Engine':String(receipt.model),'X-TTS-Backend':String(receipt.backend),'X-TTS-Model-Revision':String(receipt.model_revision),'X-TTS-Voice-Version':String(receipt.voice_version),'X-TTS-Requested-Speed':String(receipt.requested_speed),'X-TTS-Effective-Speed':String(receipt.effective_speed),'X-TTS-Audio-S':frameSeconds(Number(receipt.audio_frames)),'X-Lite-Audio-S':frameSeconds(Number(receipt.audio_frames)),'X-Lite-Speech-S':frameSeconds(Number(receipt.speech_frames)),'X-Lite-Pause-S':frameSeconds(Number(receipt.authored_pause_frames)),'X-Lite-Pause-Count':String(receipt.pause_count),'X-Lite-Speech-Segments':String(receipt.speech_span_count),'X-TTS-Native-Chunks':String(receipt.native_chunk_count),'X-TTS-Segmentation-Policy':String(receipt.segmentation_policy)};for(const[name,value]of Object.entries(expected)){const actual=name==='Content-Type'?(requiredHeader(response,name).split(';')[0].trim().toLowerCase()):requiredHeader(response,name);if(actual!==value)throw new Error(`Nano response header mismatch: ${name}`)}}

async function profileProof(base:URL,voice:string,profile:Record<string,unknown>){const detailResponse=await fetchLocal(base,`/profiles/${encodeURIComponent(voice)}`),proofResponse=await fetchLocal(base,`/profiles/${encodeURIComponent(voice)}/integrity/verify`,{method:'POST',headers:{accept:'application/json'}});if(!detailResponse.ok||!proofResponse.ok){const bad=!detailResponse.ok?detailResponse:proofResponse;let reason='';try{const value=await readJson(bad);reason=String(value.code??value.error??'').slice(0,96);}catch{/* Safe status is still available. */}throw new Error('Nano profile detail/integrity verification failed: HTTP '+bad.status+(reason?' '+reason:''));}const detail=await readJson(detailResponse),proof=await readJson(proofResponse);if(detail.id!==profile.id||detail.version!==profile.version||detail.ref_sha256!==profile.ref_sha256||detail.source_sha256!==profile.source_sha256||detail.consent!=='confirmed'||proof.verified!==true||proof.voice_id!==voice||proof.voice_version!==profile.version||proof.reference_sha256!==profile.ref_sha256||typeof proof.binding!=='string'||!HEX64.test(proof.binding))throw new Error('Nano profile detail/integrity binding mismatch.');return{detail,proof}}

/** Strict profile/reference proof, read directly from the localhost producer. */
export async function verifiedNanoProfile(endpoint:string,voice:string) {
  const discovered=await discoverNano(endpoint);
  if(!discovered.ready)throw new Error('Nano producer is not generation-ready.');
  const profile=discovered.profiles.find(item=>(item as Record<string,unknown>).id===voice) as Record<string,unknown>|undefined;
  if(!profile)throw new Error('Selected confirmed Nano profile does not exist.');
  const verified=await profileProof(nanoBase(endpoint),voice,profile);
  return {profile,binding:String(verified.proof.binding)};
}

/** One complete, producer-verified request. No WAV is published until the caller
 * verifies the entire narration and its immutable approved-script identity. */
export async function synthesizeNano(request:{
  endpoint:string;input:string;voice:string;speed:number;seed:number;
  expectedBinding?:string;expectedVersion?:number;
}) {
  const {endpoint,input,voice,speed,seed}=request;
  if(input.length<1||input.length>4096)throw new Error('Nano API input must be 1..4096 characters.');
  const discovered=await discoverNano(endpoint);
  if(!discovered.ready)throw new Error('Nano producer is not generation-ready.');
  const profile=discovered.profiles.find(item=>(item as Record<string,unknown>).id===voice) as Record<string,unknown>|undefined;
  if(!profile)throw new Error('Selected confirmed Nano profile does not exist.');
  const base=nanoBase(endpoint),first=await profileProof(base,voice,profile);
  const binding=String(first.proof.binding),version=Number(profile.version);
  if((request.expectedBinding&&request.expectedBinding!==binding)||
     (request.expectedVersion!==undefined&&request.expectedVersion!==version))
    throw new Error('NANO_PROFILE_CHANGED: selected reference changed during narration.');
  const requestId=randomUUID(),cancelToken=randomBytes(24).toString('base64url');
  let response:Response;
  try {
    response=await fetchLocal(base,'/v1/audio/speech',{
      method:'POST',signal:AbortSignal.timeout(10*60_000),
      headers:{'content-type':'application/json',accept:'audio/wav',
        'X-TTS-Request-Id':requestId,'X-TTS-Cancel-Token':cancelToken},
      body:JSON.stringify({model:'chatterbox-nano',voice,input,response_format:'wav',
        language:'en',speed,seed})
    });
  }catch{throw new Error('NANO_UNCERTAIN: transport outcome may have been admitted; inspect producer status before owner-authorized retry.')}
  if(!response.ok){
    if([403,404,409,422].includes(response.status)||
      (response.status===429&&(discovered.capabilities.model as Record<string,unknown>).definite_429_nonadmission===true))
      throw new Error(`NANO_NOT_ADMITTED_${response.status}`);
    throw new Error(`NANO_UNCERTAIN_${response.status}: do not automatically replay.`);
  }
  const wav=Buffer.from(await response.arrayBuffer());
  const receiptToken=requiredHeader(response,'X-TTS-Execution-Receipt');
  const proof=requiredHeader(response,'X-TTS-Execution-Proof');
  const expected:NanoExpected={input,voice,speed,seed,
    profile:{id:String(profile.id),version,ref_sha256:String(profile.ref_sha256)},binding};
  const verified=decodeProducerReceipt(receiptToken,proof,wav,expected);
  verifyProducerHeaders(response,verified.receipt);
  const last=await profileProof(base,voice,profile);
  if(last.proof.binding!==binding)throw new Error('NANO_PROFILE_CHANGED: reference changed during generation; WAV was not accepted.');
  return {wav,receipt:verified.receipt,receiptToken,proof,info:verified.wavInfo,
    profileVersion:version,referenceSha256:String(profile.ref_sha256),binding};
}

export async function generateNano(root:string,request:{endpoint:string;voice:string;speed:number;seed:number}) {
  const state=readState(root);
  if(!state.approvedScript)throw new Error('An approved script is required.');
  if(!['en','english'].includes(state.brief.language.toLowerCase()))
    throw new Error('Nano producer pin supports English only; import an approved WAV for this project language.');
  const result=await synthesizeNano({...request,input:state.approvedScript.text});
  const voice=acceptNarration(root,{
    wav:result.wav,expectedScriptSha256:state.approvedScript.sha256,
    voice:{receipt:result.receipt,profileId:request.voice,profileVersion:result.profileVersion,
      referenceBinding:result.binding,origin:'NANO_GENERATED'},
    nano:{endpoint:nanoBase(request.endpoint).toString().replace(/\\/$/,''),profileId:request.voice}
  });
  return {...result.info,path:voice.path,receipt:result.receipt};
}
