// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {deflateSync,inflateSync} from 'node:zlib';
import {afterEach,describe,expect,it} from 'vitest';
import {appPath,cleanup,fixture,stageNative,wav} from './SixIssueFixtures';
import {compileReviewedBible,confirmCleanNativeReview} from './AIIdentityFixtures';
import {currentApprovedSource} from '../../src/main/identity/identityWorkflow';
import {loadImageStyleProfile} from '../../src/main/imagePreparation';
import {contentHash,type ScriptAnalysis} from '../../src/main/identity/contracts';
import {approveCandidate,publishApprovalSet,type ReferenceCandidate} from '../../src/main/identity/referencePublication';
import {confirmImport,getPendingMedia,readNativeDraft,inspectCurrentNativePlan,importMediaFile,fulfillMedia,getNativeImageGallery} from '../../src/main/externalTasks';
import {nativeJob} from '../../src/main/nativeJobs';
import {assertPublishedIdentityCurrent} from '../../src/main/identity/finalGate';
import {bindApprovedReuseBatch} from '../../src/main/assetReuse';
import {bindSoundAssets,importSoundBatch,soundInventory} from '../../src/main/soundAssets';
import {prepareArtwork,verifyArtwork,assertPreparedLineage,verifyRatio,type AssetOutput,type DecodedArtwork} from '../../src/main/assetPreparation';
import {inspectNativePlan} from '../../src/main/nativePlanPreflight';
import {readState,writeState,sha,repairB4Narrator,atomicJson,nativeSkillRoot,runProcess} from '../../src/main/services';
import {structuredSoundCues} from '../../src/main/soundRequirements';
import {autoCaptionReview,ensureCaptionAuthorTask,getCaptionReview,approveCaptionReview,importCaptionAuthorResult,draftCaptionReview,approvedCaptionCues} from '../../src/main/captionReview';
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

/** Deterministic engineering fixtures, NOT creative acceptance or real provider evidence.
 * Run explicitly with MODE_B_PRODUCTION_FIXTURES=1. All production commands below use
 * the installed Original Core, real PNG/WAV files, no mock CLI and no paid provider. */
function tone(seconds:number,hz:number){const b=wav(seconds);for(let i=0;i<(b.length-44)/2;i++)b.writeInt16LE(Math.round(9000*Math.sin(2*Math.PI*hz*i/24000)),44+i*2);return b;}
function art(w:number,h:number,pixel:(x:number,y:number)=>number[]){const b=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)b.set(pixel(x,y),(y*w+x)*4);return png(b,w,h);}
function testIdentity(root:string,style:'B1'|'B2'|'B3'|'B4',actor:boolean,actorPng:Buffer){
  const state=readState(root);state.identityPolicy='v1';writeState(root,state);
  const script=currentApprovedSource(root),analysis:ScriptAnalysis={schema:'stickman-script-analysis-v1',project_id:script.projectId,source_script_sha256:script.sha256,source_authoring_sha256:contentHash(script.authoring),continuity_catalog:{characters:actor?[{char_id:'char_001',label:'One',description:'Synthetic engineering actor',narrative_role:'Named character',explicit_visual_traits:[],identity_markers:['One'],continuity_notes:[],physical_constraints:[],occurrences:[{section_id:'opening',quote:'One',start:0,end:3}],presence_ranges:[{start:0,end:3}]}]:[]}};
  const profile=loadImageStyleProfile(appPath,style),bible=compileReviewedBible(analysis,script,{id:style,guidance:profile.guidance,sha256:profile.sha256});
  const candidates:ReferenceCandidate[]=[];
  if(actor){
    const file=path.join(root,'fixture-reference.png');fs.writeFileSync(file,actorPng);
    const ref=importMediaFile(root,file,'image','Synthetic fixture; owned test pixels');
    const candidate:ReferenceCandidate={schema:'stickman-visual-reference-candidate-v1',project_id:script.projectId,candidate_id:'fixture-reference',anchor_type:'character',anchor_id:'char_001',source_definition_hash:bible.characters[0].source_definition_hash,style_bible_sha256:bible.style_bible_sha256,prompt_sha256:contentHash({kind:'owner-reference-bytes-v1',projectId:script.projectId,styleBibleSha:bible.style_bible_sha256,anchorId:'char_001',mediaSha:ref.sha256}),provider_job_id:null,model:'owner_imported',aspect_ratio:'1:1',media_path:ref.path,media_sha256:ref.sha256,media_mime:'image/png',width:64,height:64,rights:ref.rights,source:'OWNER_IMPORTED',status:'VALIDATED',approval_event_id:null,approved_at:null};
    candidates.push(approveCandidate(candidate,bible,root,true,decode));
  }
  const review={schema:'stickman-analysis-review-v1',project_id:script.projectId,analysis_sha256:contentHash(analysis),independent_review:true,findings:[],approved:true};
  atomicJson(path.join(root,'.studio/identity/workflow-v1.json'),{schema:'stickman-identity-workflow-v1',projectId:script.projectId,revision:1,currentTask:null,draftAnalysis:analysis,draftSha256:contentHash(analysis),independentReview:review,analysisApproved:{sha256:contentHash(analysis),approvedAt:new Date().toISOString(),reviewSha256:contentHash(review)},bible,bibleTextApproved:{sha256:bible.style_bible_sha256,approvedAt:new Date().toISOString()},referenceCandidates:candidates,referenceApprovalSet:publishApprovalSet(root,bible,candidates,1,decode),events:[]});
}
// B3-only engineering oracle. The fixed reference path is a sibling of the
// rotating group; the off-centre orange rectangle cannot satisfy this oracle
// by translating, changing captions, fading, or rotating around the origin.
const b3Width=360,b3Height=640,b3Fps=15,b3Scale=b3Width/1280;
const b3Samples=[
  {frame:0,time:0,center:[660,680],size:[240,80]},
  {frame:18,time:1.2,center:[440,860],size:[80,240]},
  {frame:36,time:2.4,center:[260,640],size:[240,80]}
] as const;
function b3PivotShot(){
  return {id:'shot-1',start:0,end:3,layers:[{id:'group',type:'group',x:400,y:600,pivotX:80,pivotY:80,children:[
    {id:'nested',type:'group',x:20,y:20,pivotX:40,pivotY:40,angle:0,
      keys:[{t:0,angle:0},{t:1.2,angle:Math.PI/2},{t:2.4,angle:Math.PI}],
      motion:{role:'prop',reason:'Rotate asymmetric numeric artwork about its fixed local attachment'},
      children:[{id:'local',type:'rect',x:120,y:20,w:240,h:80,fill:'#ff5500'}]},
    {id:'path',type:'path',commands:[['M',60,36],['L',84,60],['L',60,84],['L',36,60],['Z']],fill:'#e9eaea'}
  ]}]};
}
function assertB3PivotManifest(value:unknown){
  const m=value as Record<string,unknown>;
  expect(m).toMatchObject({style:'B3',width:b3Width,height:b3Height,fps:b3Fps,television:{enabled:false}});
  // Compare the entire authored hierarchy, transforms, keyframes and motion
  // metadata against a fresh expected value, not against the imported object.
  expect(m.shots).toEqual([b3PivotShot()]);
}
type B3Ink={cx:number;cy:number;w:number;h:number;count:number};
function b3Ink(rgb:Buffer,kind:'orange'|'anchor'):B3Ink{
  expect(rgb.length,'B3 decoded RGB frame size').toBe(b3Width*b3Height*3);
  let x0=b3Width,y0=b3Height,x1=-1,y1=-1,count=0;
  // The complete swept artwork is in the upper half, far from the caption band.
  for(let y=0;y<b3Height/2;y++)for(let x=0;x<b3Width;x++){
    const i=(y*b3Width+x)*3,r=rgb[i],g=rgb[i+1],b=rgb[i+2];
    const match=kind==='orange'?r>150&&r-g>70&&g-b>30:Math.min(r,g,b)>150&&Math.max(r,g,b)-Math.min(r,g,b)<35;
    if(match){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);count++;}
  }
  expect(count,'B3 pivot '+kind+' visible ink').toBeGreaterThan(kind==='orange'?800:40);
  return {cx:(x0+x1+1)/2,cy:(y0+y1+1)/2,w:x1-x0+1,h:y1-y0+1,count};
}
function assertB3PivotFrames(frames:Buffer[]){
  expect(frames).toHaveLength(b3Samples.length);
  return frames.map((rgb,i)=>{
    const sample=b3Samples[i],rect=b3Ink(rgb,'orange'),anchor=b3Ink(rgb,'anchor');
    const near=(actual:number,expected:number,label:string)=>expect(Math.abs(actual-expected),'B3 pivot '+label+' at '+sample.time+'s').toBeLessThanOrEqual(4);
    // Expected cardinal-angle geometry is calculated independently of the
    // renderer: world pivot (460,660), initial centre offset (+200,+20).
    // At 90 degrees the long axis must become vertical, not just move.
    near(rect.w,sample.size[0]*b3Scale,'rectangle width');
    near(rect.h,sample.size[1]*b3Scale,'rectangle height');
    near(rect.cx,sample.center[0]*b3Scale,'rectangle centre x');
    near(rect.cy,sample.center[1]*b3Scale,'rectangle centre y');
    near(anchor.cx,460*b3Scale,'stationary anchor x');
    near(anchor.cy,660*b3Scale,'stationary anchor y');
    near(anchor.w,48*b3Scale,'stationary anchor width');
    near(anchor.h,48*b3Scale,'stationary anchor height');
    return {frame:sample.frame,time:sample.time,rect,anchor};
  });
}
function verifyB3PivotVideo(file:string){
  // Decode actual Studio-produced MP4s by frame index (no seek rounding,
  // no reconstructed frames). The installed Core uses the same FFMPEG setting.
  const stride=b3Width*b3Height*3;
  // Decode each selected frame independently and reset its PTS to zero.
  // Sparse multi-frame output can duplicate frames under default CFR sync;
  // this avoids that ambiguity and the removed legacy -vsync option.
  const frames=b3Samples.map(sample=>{
    const filter='select=eq(n\\,'+sample.frame+'),setpts=PTS-STARTPTS';
    const result=spawnSync(process.env.FFMPEG||'ffmpeg',['-v','error','-i',file,'-map','0:v:0','-vf',filter,'-frames:v','1','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
    expect(result.error).toBeUndefined();
    expect(result.status,result.stderr?.toString('utf8')).toBe(0);
    expect(result.stdout.length,'B3 frame '+sample.frame+' RGB byte length').toBe(stride);
    return result.stdout;
  });
  const measured=assertB3PivotFrames(frames);
  console.info('B3 actual decoded pivot evidence',JSON.stringify({file,samples:measured}));
}
function assertB3PivotDiagnostics(report:{local_motion:{intervals:Array<{id:string;changed_pixels:number}>;windows:Array<{id:string;changed_pixels:number}>}}){
  expect(report.local_motion.intervals.some(w=>w.id==='nested'&&w.changed_pixels>=8)).toBe(true);
  expect(report.local_motion.windows.every(w=>w.id==='nested'&&w.changed_pixels>=8)).toBe(true);
}
// Synthetic negative controls exercise the exact same pixel oracle, not a
// fabricated observation of an actual encoded output. In particular the
// translation-only control visits the intended centres but never turns.
describe('B3 pivot-specific oracle negative controls',()=>{
  for(const kind of ['constant angle','pivot only','translation only'] as const)it('rejects '+kind,()=>{
    const shot=b3PivotShot(),nested=shot.layers[0].children[0] as {keys?:Array<{t:number;angle?:number;x?:number;y?:number}>};
    if(kind==='constant angle')nested.keys=[{t:0,angle:0},{t:1.2,angle:0},{t:2.4,angle:0}];
    else if(kind==='pivot only')delete nested.keys;
    else nested.keys=[{t:0,x:20,y:20},{t:1.2,x:-200,y:200},{t:2.4,x:-380,y:-20}];
    expect(()=>assertB3PivotManifest({style:'B3',width:b3Width,height:b3Height,fps:b3Fps,television:{enabled:false},shots:[shot]})).toThrow();
    const frames=b3Samples.map(sample=>{
      const rgb=Buffer.alloc(b3Width*b3Height*3);
      const fill=(cx:number,cy:number,w:number,h:number,color:number[])=>{
        for(let y=Math.round((cy-h/2)*b3Scale);y<Math.round((cy+h/2)*b3Scale);y++)
          for(let x=Math.round((cx-w/2)*b3Scale);x<Math.round((cx+w/2)*b3Scale);x++)rgb.set(color,(y*b3Width+x)*3);
      };
      const center=kind==='translation only'?sample.center:b3Samples[0].center;
      fill(460,660,48,48,[233,234,234]);
      fill(center[0],center[1],240,80,[255,85,0]);
      return rgb;
    });
    expect(()=>assertB3PivotFrames(frames)).toThrow(/B3 pivot rectangle width at 1\.2s/);
  });
});
const runtimeSuite=process.env.MODE_B_PRODUCTION_FIXTURES==='1'?describe:describe.skip;
runtimeSuite('RF07 Original Core production-interface B1–B4 fixtures',()=>{
 for(const style of ['B1','B2','B3','B4'] as const)it(style+' staged Author + independent Review + preflight + approved media + FULL_READY + actual preview/full render',async()=>{
  const seconds=style==='B4'?6:3,{root,voicePath}=fixture({style,seconds,approve:false});
  const audio=tone(seconds,440),state=readState(root),manifest=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')) as Record<string,unknown>,voice=manifest.voice as Record<string,unknown>;
  fs.writeFileSync(path.join(root,voicePath),audio);state.voice!.sha256=sha(audio);state.alignment!.audioSha256=sha(audio);
  if(style==='B4')voice.id='imported-wav:'+sha(audio);
  Object.assign(manifest,{width:360,height:640,fps:15});fs.writeFileSync(path.join(root,'project.json'),JSON.stringify(manifest));writeState(root,state);
  draftCaptionReview(root,[3]);approveCaptionReview(root,'Synthetic fixture caption approval only');
  manifest.captions=approvedCaptionCues(root);
  const actor=art(64,64,(x,y)=>x>23&&x<40&&y>5&&y<58?[style==='B2'?45:10,style==='B2'?110:10,style==='B2'?200:10,255]:[0,0,0,0]);
  const prop=art(64,64,(x,y)=>x>8&&x<55&&y>8&&y<55?[35,95,210,255]:[0,255,0,255]);
  const actorStyle=style==='B1'||style==='B2';
  testIdentity(root,style,actorStyle,actor);
  const needs:Array<Record<string,unknown>>=[],sound:Array<Record<string,unknown>>=[],assets=new Map<string,{bytes:Buffer;output:AssetOutput}>();
  const add=(shotId:string,layerId:string,bytes:Buffer,assetKind:'character'|'prop'|'background',spec:AssetOutput,orientation:'1:1'|'9:16',reuse?:{shot_id:string;layer_id:string;sha256?:string})=>{
    const expected='assets/images/'+layerId+'.png';
    needs.push({shot_id:shotId,layer_id:layerId,expected_path:expected,content:'Synthetic engineering '+layerId,asset_kind:assetKind,character_ids:assetKind==='character'?['char_001']:[],output:spec,orientation,...(reuse?{reuse_approved:reuse,continuity_source:{shot_id:reuse.shot_id,layer_id:reuse.layer_id,relation:'same_setup'}}:{})});
    if(!reuse)assets.set(layerId,{bytes,output:spec});
    return expected;
  };
  if(actorStyle){
    const a=add('shot-1','actor',actor,'character',output,'1:1');
    const pOutput:AssetOutput={...output,preparation:'border_key',key_rgb:[0,255,0]};
    const p=add('shot-1','prop',prop,'prop',pOutput,'1:1');
    const h=sha(prepareArtwork(prop,pOutput,decode).decoded.png);
    const p2=add('shot-1','prop2',prop,'prop',pOutput,'1:1',{shot_id:'shot-1',layer_id:'prop',sha256:h});
    const p3=add('shot-1','prop3',prop,'prop',pOutput,'1:1',{shot_id:'shot-1',layer_id:'prop2',sha256:h});
    manifest.shots=[{id:'shot-1',start:0,end:seconds,layers:[
      {id:'actor',type:'image',path:a,x:220,y:340,w:230,h:230,keys:[{t:0,x:220},{t:3,x:620}],motion:{role:'actor',reason:'Independent visible actor translation'}},
      {id:'prop',type:'image',path:p,x:250,y:700,w:140,h:140,keys:[{t:0,y:700},{t:3,y:1040}],motion:{role:'prop',reason:'Independent visible prop translation'}},
      {id:'prop2',type:'image',path:p2,x:750,y:700,w:120,h:120},{id:'prop3',type:'image',path:p3,x:970,y:700,w:120,h:120}]}];
  }else if(style==='B3'){
    manifest.television={enabled:false}; // Clean rotation evidence, as recommended by B3 runtime documentation.
    manifest.shots=[b3PivotShot()];
  }else{
    const opaque:AssetOutput={composition:'composed',background:'opaque',preparation:'preserve',registration:'Same full canvas'};
    const scene=(open:boolean)=>art(144,256,(x,y)=>x>=100&&x<125&&y>=60&&y<145?(open?[60,80,185,255]:[65,65,65,255]):[32,31,30,255]);
    const before=add('hook','hook-before',scene(false),'background',opaque,'9:16');
    const after=add('hook','hook-after',scene(true),'background',opaque,'9:16');
    const held=add('hold','held',scene(true),'background',opaque,'9:16',{shot_id:'hook',layer_id:'hook-after',sha256:sha(scene(true))});
    const {root:core}=nativeSkillRoot(appPath);
    const hook=await runProcess(process.execPath,['--input-type=module','-e',"import {makeB4Opening} from './scripts/b4-opening.mjs'; console.log(JSON.stringify(makeB4Opening(JSON.parse(process.argv[1]))));",JSON.stringify({setup:'ONE',payoff:'TWO THREE',before,after,meaning:'Synthetic local panel changes color',width:360,height:640,duration:1.6})],{cwd:core,timeout:30000});
    expect(hook.code,hook.stderr).toBe(0);
    const authored=JSON.parse(hook.stdout);
    manifest.opening=authored.opening;
    manifest.shots=[{id:'hook',...authored.shot},{id:'hold',start:1.6,end:seconds,kind:'exceptional_hold',reason:'Deliberate engineering hold fixture',user_approval:'Synthetic test-only authority',layers:[{id:'held',type:'image',path:held,x:0,y:0,w:1280,h:1280*640/360}]}];
    const bedPath=path.join(root,'bed.wav');fs.writeFileSync(bedPath,tone(seconds,300));
    const bed=importMediaFile(root,bedPath,'sfx','Synthetic fixture audio');
    manifest.ambience=[{path:bed.path,start:0,end:seconds,gain:.06}];manifest.sfx=[{kind:'file',path:'assets/sfx/impact.wav',time:1,gain:.15,duration:.5}];
    sound.push({cue_id:'bed',track:'ambience',track_index:0,source_kind:'file',source_requirement:'Synthetic continuous ambience',reuse:{path:bed.path,sha256:bed.sha256}},{cue_id:'impact',track:'sfx',track_index:0,source_kind:'file',source_requirement:'Synthetic impact',preparation:'pcm16'});
  }
  if(style!=='B4'){
    manifest.audio_cuts=[{start:0,end:seconds,reason:'Isolated engineering motion fixture',return_trigger:'Fixture ends'}];
    sound.push({cue_id:'cut',track:'audio_cuts',track_index:0,source_kind:'cut',source_requirement:'Intentional fixture silence except voice'});
  }
  const {response}=stageNative(root,{manifest,shot_ledger:[],sound_script:sound,asset_needs:needs});
  if(style==='B3'){
    assertB3PivotManifest(readNativeDraft(root)!.artifact.manifest);
    expect(needs).toEqual([]);expect(getNativeImageGallery(appPath,root).targets).toEqual([]);
  }
  confirmCleanNativeReview(root,appPath);
  expect((await inspectCurrentNativePlan(appPath,root))?.plan).toBe('PASS');
  const token=response.token,draft=readNativeDraft(root)!;
  for(const target of getNativeImageGallery(appPath,root).targets){
    const asset=assets.get(target.layerId);if(!asset)continue;
    const prepared=prepareArtwork(asset.bytes,asset.output,decode);
    const file=path.join(root,target.layerId+'.png');fs.writeFileSync(file,prepared.decoded.png);
    const imported=importMediaFile(root,file,'image','Synthetic fixture; owned test pixels');
    fulfillMedia(appPath,root,token,target.key,imported.path,imported.rights,{ownerReviewed:true,decode});
  }
  const reuse=needs.filter(row=>row.reuse_approved).map(row=>({targetKey:getNativeImageGallery(appPath,root).targets.find(t=>t.layerId===row.layer_id)!.key,sourceSha:(row.reuse_approved as {sha256:string}).sha256}));
  if(reuse.length){
    const bound=await bindApprovedReuseBatch(appPath,root,{token,candidateSha:draft.sha256,items:reuse,ownerAuthorized:true},decode);
    expect(bound.every(item=>item.status==='BOUND'),JSON.stringify(bound)).toBe(true);
  }
  if(style==='B4'){
    const impact=path.join(root,'impact.wav'),other=path.join(root,'other.wav');
    fs.writeFileSync(impact,tone(1,680));fs.writeFileSync(other,tone(1,900));
    const imported=await importSoundBatch(appPath,root,{token,candidateSha:draft.sha256,files:[impact,other],rights:'Synthetic fixture audio',ownerAuthorized:true});
    expect(imported.results.map(x=>x.status)).toEqual(['IMPORTED','IMPORTED']);
    const inventory=soundInventory(appPath,root),bed=inventory.cues.find(c=>c.track==='ambience')?.exactSource,fx=inventory.sources.find(s=>s.path===imported.results[0].detail)!;
    expect(bed).toBeTruthy();expect(inventory.cues.find(c=>c.track==='sfx')?.exactSource).toBeNull();
    const result=await bindSoundAssets(appPath,root,{token,candidateSha:draft.sha256,ownerAuthorized:true,items:[{key:'audio:ambience:0',...bed!},{key:'audio:sfx:0',...fx}]});
    expect(result.results.every(x=>x.status==='BOUND'),JSON.stringify(result.results)).toBe(true);
  }
  expect(getPendingMedia(appPath,root)?.missing).toEqual([]);
  await confirmImport(appPath,root,token,{fullProduction:true,allowSampleDraft:false,previewSeconds:seconds});
  expect(readState(root).nativeReadiness?.fullReady).toBe(true);
  assertPublishedIdentityCurrent(root,appPath,'FULL');
  if(style==='B3')assertB3PivotManifest(JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8')));
  await nativeJob(appPath,root,'preview',{seconds,replace:true});
  const preview=readState(root).preview!;
  expect(preview.sha256).toBe(sha(fs.readFileSync(path.join(root,preview.path))));
  const report=JSON.parse(fs.readFileSync(path.join(root,preview.reportPath),'utf8'));
  if(style==='B4'){expect(report.opening_visual.status).toBe('diagnostic_pass');expect(report.opening_audio.status).toBe('diagnostic_pass');}
  else {expect(report.local_motion.windows.length).toBeGreaterThan(0);expect(report.local_motion.windows.every((w:{changed_pixels:number})=>w.changed_pixels>=8)).toBe(true);}
  if(style==='B3'){assertB3PivotDiagnostics(report);verifyB3PivotVideo(path.join(root,preview.path));}
  await expect(nativeJob(appPath,root,'approve',{reviewedSha256:'0'.repeat(64),attested:true,note:'Negative stale synthetic fixture'})).rejects.toThrow();
  await nativeJob(appPath,root,'approve',{reviewedSha256:preview.sha256,attested:true,note:'Synthetic engineering test approval; not owner production acceptance'});
  await nativeJob(appPath,root,'render',{replace:true});
  const film=readState(root).render!;expect(film.sha256).toBe(sha(fs.readFileSync(path.join(root,film.path))));
  const full=JSON.parse(fs.readFileSync(path.join(root,film.reportPath),'utf8'));
  if(style==='B4')expect(full.opening_visual.status).toBe('diagnostic_pass');
  else expect(full.local_motion.windows.every((w:{changed_pixels:number})=>w.changed_pixels>=8)).toBe(true);
  if(style==='B3'){assertB3PivotDiagnostics(full);verifyB3PivotVideo(path.join(root,film.path));}
 },600000);
});
