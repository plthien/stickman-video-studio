// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync,inflateSync} from 'node:zlib';
import {afterEach,describe,expect,it} from 'vitest';
import {appPath,cleanup,fixture} from './SixIssueFixtures';
import {prepareArtwork,verifyArtwork,assertPreparedLineage,verifyRatio,type AssetOutput,type DecodedArtwork} from '../../src/main/assetPreparation';
import {inspectNativePlan} from '../../src/main/nativePlanPreflight';
import {readState,writeState,sha,repairB4Narrator} from '../../src/main/services';
import {structuredSoundCues} from '../../src/main/soundRequirements';
import {autoCaptionReview,ensureCaptionAuthorTask,getCaptionReview,approveCaptionReview,importCaptionAuthorResult,draftCaptionReview} from '../../src/main/captionReview';
afterEach(cleanup);
// Actual small RGBA PNG bytes; deliberately limited test decoder, never a production fallback.
const signature=Buffer.from('89504e470d0a1a0a','hex');
function crc(b:Buffer){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(name:string,data:Buffer){const tag=Buffer.from(name),n=Buffer.alloc(4),checksum=Buffer.alloc(4);n.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([n,tag,data,checksum]);}
function png(b:Buffer,w=4,h=4){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=(y*w+x)*4,t=y*(w*4+1)+1+x*4;rows[t]=b[s+2];rows[t+1]=b[s+1];rows[t+2]=b[s];rows[t+3]=b[s+3];}return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function decode(bytes:Buffer):DecodedArtwork{const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20),rows=inflateSync(bytes.subarray(41,41+bytes.readUInt32BE(33))),b=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=y*(w*4+1)+1+x*4,t=(y*w+x)*4;b[t]=rows[s+2];b[t+1]=rows[s+1];b[t+2]=rows[s];b[t+3]=rows[s+3];}return{png:bytes,width:w,height:h,bgra:b,encodeBgra:p=>png(p,w,h)};}
const output:AssetOutput={composition:'isolated',background:'transparent',preparation:'preserve',registration:'Keep fixed canvas.'};
describe('Completion repair regression: actual PNG pixels and immutable receipt',()=>{
 it('R01 R02 rejects opaque and empty output',()=>{expect(()=>verifyArtwork(decode(png(Buffer.alloc(64,255))),output)).toThrow('ASSET_TRANSPARENT_BACKGROUND_REQUIRED');expect(()=>verifyArtwork(decode(png(Buffer.alloc(64))),output)).toThrow('ASSET_EMPTY_ARTWORK');});
 it('R03 key preparation preserves subject pixels, canvas and source SHA; tampering fails',()=>{const {root}=fixture(),b=Buffer.alloc(64);for(let i=0;i<64;i+=4){b[i+1]=255;b[i+3]=255;}b.set([13,22,141,255],20);const raw=png(b),o:AssetOutput={...output,preparation:'border_key',key_rgb:[0,255,0]};const result=prepareArtwork(raw,o,decode);expect(result.receipt).toMatchObject({sourceSha:sha(raw),preparedSha:sha(result.decoded.png),width:4,height:4,transparentPixels:15,visiblePixels:1});expect(result.decoded.bgra?.subarray(20,24)).toEqual(Buffer.from([13,22,141,255]));const relative='source.png';fs.writeFileSync(path.join(root,relative),raw);const source={path:relative,sha256:sha(raw)};assertPreparedLineage(root,o,source,result.receipt,sha(result.decoded.png));fs.appendFileSync(path.join(root,relative),'tamper');expect(()=>assertPreparedLineage(root,o,source,result.receipt,sha(result.decoded.png))).toThrow('ASSET_PREPARATION_LINEAGE_INVALID');});
 it('R07 explicit mixed ratios validate independently',()=>{verifyRatio(decode(png(Buffer.alloc(64))), '1:1');verifyRatio(decode(png(Buffer.alloc(9*16*4),9,16)),'9:16');expect(()=>verifyRatio(decode(png(Buffer.alloc(64))),'9:16')).toThrow('ASSET_ORIENTATION_MISMATCH');});
});
describe('Completion repair regression: real Core plan subprocess',()=>{
 const manifest=(style:string,layers:unknown[])=>({version:1,style,width:1080,height:1920,fps:30,shots:[{id:'shot-1',start:0,end:4,layers}]});
 it('R09 R11 R12 R13 coalesces 100 exact requests, caches deterministic failure and invalidates on motion revision',async()=>{const {root}=fixture(),m=manifest('B1',[{id:'static',type:'text',text:'static'}]);const p=inspectNativePlan(appPath,root,m,4);for(let i=0;i<100;i++)expect(inspectNativePlan(appPath,root,m,4)).toBe(p);const failed=await p;expect(failed.plan).toBe('FAIL');expect(await inspectNativePlan(appPath,root,m,4)).toBe(failed);const revised=manifest('B1',[{id:'line',type:'line',points:[[0,0],[100,0]],progress:0,motion:{role:'information',reason:'Draw visible line'},keys:[{t:0,progress:0},{t:4,progress:1}]}]);const ready=await inspectNativePlan(appPath,root,revised,4);expect(ready.plan).toBe('PASS');expect(ready.candidateSha).not.toBe(failed.candidateSha);expect(ready.renderedPixels).toBe('NOT_VERIFIED');},40000);
 it('rejects shortened shot with stale keys and rejects a shortened timeline even with valid keys',async()=>{
   const {root}=fixture();
   const layer={id:'line',type:'line',points:[[0,0],[100,0]],progress:0,motion:{role:'information',reason:'Draw line'},keys:[{t:0,progress:0},{t:4,progress:1}]};
   const m=manifest('B1',[layer]);m.shots[0].end=3;
   expect(await inspectNativePlan(appPath,root,m,4)).toMatchObject({plan:'FAIL',error:expect.stringMatching(/Invalid key time/)});
   layer.keys[1].t=3;
   expect(await inspectNativePlan(appPath,root,m,4)).toMatchObject({plan:'FAIL',error:expect.stringMatching(/cover accepted timeline/)});
 },40000);
 it('R15 preserves original B4 exception for an approved hold',async()=>{const {root}=fixture({style:'B4'}),m=manifest('B4',[{id:'hold',type:'text',text:'hold'}]);Object.assign(m.shots[0],{kind:'exceptional_hold',reason:'Approved hold test',user_approval:'Owner fixture approval'});expect((await inspectNativePlan(appPath,root,m,4)).plan).toBe('PASS');},40000);
});
describe('Completion repair regression: historical audio provenance',()=>{
 it('R17 R19 repairs actual historical B4 metadata without rewriting WAV or alignment',()=>{const {root,voicePath}=fixture({style:'B4'}),state=readState(root),file=path.join(root,'project.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8')),bytes=fs.readFileSync(path.join(root,voicePath)),audioSha=sha(bytes);state.voice={...state.voice!,origin:'NANO_GENERATED',profileId:'historical',profileVersion:2,referenceBinding:'bound',receipt:{schema_version:'nano_execution_receipt_v1',voice_id:'historical',voice_version:2,reference_binding:'bound',wav_sha256:audioSha}};writeState(root,state);manifest.voice={...manifest.voice,name:'Brian',id:'brian'};fs.writeFileSync(file,JSON.stringify(manifest));repairB4Narrator(root,audioSha);expect(fs.readFileSync(path.join(root,voicePath))).toEqual(bytes);expect(readState(root).alignment).toEqual(state.alignment);expect(JSON.parse(fs.readFileSync(file,'utf8')).voice.id).toBe('nano:historical');});
 it('R20 rejects a cue mapped to another track or wrong source kind',()=>{const m={sfx:[{kind:'file',path:'assets/sfx/a.wav',time:0,gain:.1},{kind:'tap',time:1}]};const row={cue_id:'impact',track:'sfx',track_index:0,source_kind:'file',source_requirement:'Owner-created impact'};expect(structuredSoundCues(m,[row])[0].key).toBe('audio:sfx:0');expect(()=>structuredSoundCues(m,[{...row,track_index:1}])).toThrow('SOUND_CUE_TARGET_MISMATCH');expect(()=>structuredSoundCues(m,[row,{...row,cue_id:'duplicate'}])).toThrow('SOUND_CUE_TARGET_MISMATCH');});
});

describe('Full Production completion: caption semantic authority and exact cue coverage',()=>{
 it('CAP01–04 technical grouping prepares a reusable frozen semantic task; only valid imported draft can be approved',()=>{
   const {root}=fixture({approve:false}),state=readState(root);state.identityPolicy='v1';writeState(root,state);
   const before=readState(root);autoCaptionReview(root);expect(getCaptionReview(root)).toMatchObject({draftKind:'TECHNICAL',canApproveDraft:false});
   expect(()=>approveCaptionReview(root,'technical only')).toThrow('CAPTION_TECHNICAL_DRAFT_REQUIRES');
   const task=ensureCaptionAuthorTask(root)!;expect(task.status).toBe('FROZEN');expect(ensureCaptionAuthorTask(root)).toEqual(task);
   importCaptionAuthorResult(root,JSON.stringify({schema:'mode-b-caption-author-result-v1',project_id:state.project.id,task_id:task.taskId,input_sha256:task.inputSha256,source_sha256:task.sourceSha256,payload:{end_word_indices:[3]}}));
   const draft=getCaptionReview(root);expect(draft).toMatchObject({draftKind:'AI_AUTHORED',canApproveDraft:true});
   approveCaptionReview(root,'Owner approved exact cues',draft.draft!.sha256);
   expect(getCaptionReview(root).status).toBe('VERIFIED');expect(readState(root).voice).toEqual(before.voice);expect(readState(root).alignment?.wordsSha256).toBe(before.alignment?.wordsSha256);
 });
 it('CAP05 explicit manual grouping is retained by automatic task preparation and corrupt draft cannot approve',()=>{
   const {root}=fixture({approve:false}),state=readState(root);state.identityPolicy='v1';writeState(root,state);
   draftCaptionReview(root,[3]);expect(getCaptionReview(root).draftKind).toBe('OWNER_CORRECTED');expect(ensureCaptionAuthorTask(root)).toBeNull();
   const draft=readState(root).alignment!.captionDraft!;fs.appendFileSync(path.join(root,draft.path),'tamper');
   expect(getCaptionReview(root).canApproveDraft).toBe(false);expect(ensureCaptionAuthorTask(root)?.status).toBe('FROZEN');
 });
 it('SOUND04 strict newly authored coverage rejects omitted executable file and procedural cues; historical compatibility retained',()=>{
   const m={sfx:[{kind:'file',path:'assets/sfx/a.wav',time:0},{kind:'tap',time:1}]};
   const file={cue_id:'a',track:'sfx',track_index:0,source_kind:'file',source_requirement:'Recorded impact'};
   const proc={cue_id:'b',track:'sfx',track_index:1,source_kind:'procedural',source_requirement:'Original tap'};
   expect(structuredSoundCues(m,[],false)).toEqual([]);expect(()=>structuredSoundCues(m,[file],true)).toThrow('SOUND_CUE_COVERAGE_REQUIRED');
   expect(structuredSoundCues(m,[file,proc],true)).toHaveLength(2);
 });
});
