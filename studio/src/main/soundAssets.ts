import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getPendingMedia,readNativeDraft,fulfillMedia,importMediaFile,requireCurrentNativePlan,requireReviewedNativeDraft} from './externalTasks.js';
import {readApprovedNativeIdentity} from './identity/nativeBinding.js';
import {nativeSkillRoot,readState,resolveProjectFile,runProcess,sha,atomicJson} from './services.js';
import {manifestAudioTracks,structuredSoundCues,type AudioPreparationReceipt} from './soundRequirements.js';
export function soundInventory(appPath:string,root:string){
  const draft=readNativeDraft(root),state=readState(root);
  const sources=(state.media??[]).filter(m=>m.kind==='sfx'&&!m.track&&Boolean(m.rights.trim())).map(m=>({path:m.path,sha256:m.sha256,rights:m.rights}));
  if(!draft)return{token:'',candidateSha:'',cues:[],sources};
  const manifest=draft.artifact.manifest as Record<string,unknown>,pending=getPendingMedia(appPath,root)!;
  const cues=structuredSoundCues(manifest,draft.artifact.sound_script as unknown[]);
  const verifiedSources=sources.filter(s=>{try{return sha(fs.readFileSync(resolveProjectFile(root,s.path)))===s.sha256;}catch{return false;}});
  return{token:draft.token,candidateSha:draft.sha256,sources:verifiedSources,
    cues:manifestAudioTracks(manifest).map(row=>{
      const cue=cues.find(c=>c.key===row.key),missing=pending.missing.some(ref=>ref.key===row.key);
      const exact=cue?.reuse?verifiedSources.filter(s=>s.path===cue.reuse!.path&&s.sha256===cue.reuse!.sha256):verifiedSources.filter(s=>s.path===row.entry.path);
      return{...row,cue:cue??null,status:row.sourceKind==='file'?(missing?'MISSING':'BOUND'):'ORIGINAL_CORE',path:typeof row.entry.path==='string'?row.entry.path:null,exactSource:exact.length===1?exact[0]:null};
    })};
}
async function probeAudio(appPath:string,file:string){
  const {cli}=nativeSkillRoot(appPath),result=await runProcess(process.execPath,[cli,'probe',file],{cwd:path.dirname(cli),timeout:30000});
  if(result.code!==0)throw Error('SOUND_PROBE_FAILED '+result.stderr.trim().slice(-800));
  const data=JSON.parse(result.stdout) as {streams?:Array<{codec_type?:string}>;format?:{duration?:string}};
  const duration=Number(data.format?.duration);
  if(data.streams?.filter(s=>s.codec_type==='audio').length!==1||!Number.isFinite(duration)||duration<=0)throw Error('SOUND_AUDIO_STREAM_INVALID');
  return duration;
}
const active=new Set<string>();
export async function bindSoundAssets(appPath:string,root:string,input:{token:string;candidateSha:string;ownerAuthorized:true;items:Array<{key:string;path:string;sha256:string;rights:string}>}){
  if(input.ownerAuthorized!==true||!Array.isArray(input.items)||!input.items.length||new Set(input.items.map(x=>x.key)).size!==input.items.length)throw Error('SOUND_BATCH_AUTHORITY_REQUIRED');
  if(active.has(root))throw Error('SOUND_BATCH_BUSY');active.add(root);
  const results:Array<{key:string;status:'BOUND'|'FAILED';detail:string}>=[];
  try{
    await requireCurrentNativePlan(appPath,root);
    const initial=soundInventory(appPath,root);
    if(initial.token!==input.token||initial.candidateSha!==input.candidateSha)throw Error('SOUND_BATCH_STALE');
    const initialState=readState(root),draft=readNativeDraft(root)!;
    if(initialState.identityPolicy==='v1')requireReviewedNativeDraft(initialState,draft,readApprovedNativeIdentity(root,appPath).snapshotSha);
    for(const item of input.items){
      try{
        const target=initial.cues.find(c=>c.key===item.key&&c.status==='MISSING'&&c.sourceKind==='file');
        if(!target)throw Error('SOUND_TARGET_NOT_MISSING');
        const source=initial.sources.find(s=>s.path===item.path&&s.sha256===item.sha256&&s.rights===item.rights);
        if(!source)throw Error('SOUND_SOURCE_NOT_REGISTERED');
        if(target.cue?.reuse&&(target.cue.reuse.path!==source.path||target.cue.reuse.sha256!==source.sha256))throw Error('SOUND_EXPLICIT_REUSE_MISMATCH');
        const file=resolveProjectFile(root,source.path),bytes=fs.readFileSync(file);
        if(sha(bytes)!==source.sha256)throw Error('SOUND_SOURCE_SHA_MISMATCH');
        const method=target.cue?.preparation??'preserve';
        let prepared=source,duration=await probeAudio(appPath,file);
        if(method==='pcm16'){
          const relative='.studio/sound-preparation/'+randomUUID()+'.wav',output=resolveProjectFile(root,relative);
          fs.mkdirSync(path.dirname(output),{recursive:true});
          try{
            const result=await runProcess(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error','-n','-i',file,'-map','0:a:0','-c:a','pcm_s16le',output],{cwd:root,timeout:120000});
            if(result.code!==0)throw Error('SOUND_PCM16_PREPARATION_FAILED '+result.stderr.trim().slice(-800));
            const converted=await probeAudio(appPath,output);
            if(Math.abs(converted-duration)>.06)throw Error('SOUND_PREPARATION_DURATION_CHANGED');
            const imported=importMediaFile(root,output,'sfx',source.rights);
            if(imported.rights!==source.rights)throw Error('SOUND_PREPARED_RIGHTS_MISMATCH');
            prepared={path:imported.path,sha256:imported.sha256,rights:imported.rights};duration=converted;
          }finally{if(fs.existsSync(output))fs.unlinkSync(output);}
        }
        const fresh=soundInventory(appPath,root);
        if(fresh.token!==input.token||fresh.candidateSha!==input.candidateSha||!fresh.cues.some(c=>c.key===item.key&&c.status==='MISSING')||sha(fs.readFileSync(file))!==source.sha256)throw Error('SOUND_BATCH_STALE');
        const receipt:AudioPreparationReceipt={projectId:initialState.project.id,token:input.token,targetKey:item.key,cueSha:sha(JSON.stringify(target.cue??null)),sourcePath:source.path,sourceSha:source.sha256,preparedPath:prepared.path,preparedSha:prepared.sha256,rightsSha:sha(source.rights),method,duration,createdAt:new Date().toISOString()};
        atomicJson(resolveProjectFile(root,'.studio/sound-receipts/'+sha(JSON.stringify(receipt))+'.json'),receipt);
        fulfillMedia(appPath,root,input.token,item.key,prepared.path,source.rights,{audioReceipt:receipt});
        results.push({key:item.key,status:'BOUND',detail:prepared.path});
      }catch(e){results.push({key:item.key,status:'FAILED',detail:e instanceof Error?e.message:String(e)});}
    }
    return{results,inventory:soundInventory(appPath,root)};
  }finally{active.delete(root);}
}

export async function importSoundBatch(appPath:string,root:string,input:{token:string;candidateSha:string;rights:string;files:string[];ownerAuthorized:true}){
 if(input.ownerAuthorized!==true||!input.rights?.trim()||!Array.isArray(input.files)||!input.files.length)throw Error('SOUND_BATCH_IMPORT_AUTHORITY_REQUIRED');
 const before=soundInventory(appPath,root);if(before.token!==input.token||before.candidateSha!==input.candidateSha)throw Error('SOUND_BATCH_STALE');
 const results:Array<{file:string;status:'IMPORTED'|'FAILED';detail:string}>=[];
 for(const file of [...new Set(input.files)]){
   try{if(!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('SOUND_LOCAL_FILE_REQUIRED');const originalSha=sha(fs.readFileSync(file));await probeAudio(appPath,file);if(sha(fs.readFileSync(file))!==originalSha)throw Error('SOUND_SOURCE_SHA_MISMATCH');const current=soundInventory(appPath,root);if(current.token!==input.token||current.candidateSha!==input.candidateSha)throw Error('SOUND_BATCH_STALE');
     const source=importMediaFile(root,file,'sfx',input.rights.trim());if(source.sha256!==originalSha||source.rights!==input.rights.trim())throw Error('SOUND_SOURCE_RIGHTS_MISMATCH');
     results.push({file,status:'IMPORTED',detail:source.path});
   }catch(error){results.push({file,status:'FAILED',detail:error instanceof Error?error.message:String(error)});}
 }
 return{results,inventory:soundInventory(appPath,root)};
}
