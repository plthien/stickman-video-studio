/** Studio-only exact cue sidecar. Original manifest remains sole timeline/mixer authority. */
import fs from 'node:fs';
import {resolveProjectFile,sha} from './services.js';
type Track='sfx'|'ambience'|'dialogue'|'music'|'audio_cuts';
export interface SoundCue {cue_id:string;track:Track;track_index:number;source_kind:'file'|'procedural'|'cut';source_requirement:string;preparation?:'preserve'|'pcm16';reuse?:{path:string;sha256:string}}
export interface AudioPreparationReceipt {projectId:string;token:string;targetKey:string;cueSha:string;sourcePath:string;sourceSha:string;preparedPath:string;preparedSha:string;rightsSha:string;method:'preserve'|'pcm16';duration:number;createdAt:string}
export function manifestAudioTracks(manifest:Record<string,unknown>){
  const result:Array<{key:string;track:Track;index:number;sourceKind:SoundCue['source_kind'];entry:Record<string,unknown>}>=[];
  for(const track of ['sfx','ambience','dialogue','music','audio_cuts'] as const){
    const entries=track==='music'?(manifest.music?[manifest.music]:[]):manifest[track]??[];
    if(!Array.isArray(entries))throw Error('SOUND_TRACK_INVALID '+track);
    entries.forEach((entry,index)=>{
      if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('SOUND_TRACK_ENTRY_INVALID '+track);
      const row=entry as Record<string,unknown>,sourceKind=track==='audio_cuts'?'cut':track==='sfx'&&row.kind!=='file'?'procedural':'file';
      if(sourceKind==='file'&&(typeof row.path!=='string'||!row.path))throw Error('SOUND_FILE_PATH_REQUIRED '+track+':'+index);
      result.push({key:'audio:'+track+':'+index,track,index,sourceKind,entry:row});
    });
  }
  return result;
}
export function structuredSoundCues(manifest:Record<string,unknown>,rows:unknown[],requireCoverage=false){
  const tracks=manifestAudioTracks(manifest),ids=new Set<string>(),keys=new Set<string>(),out:Array<SoundCue&{key:string}>=[];
  for(const value of rows){
    if(!value||typeof value!=='object'||Array.isArray(value)||!('source_kind'in value))continue; // historical prose retained
    const row=value as SoundCue;
    if(typeof row.cue_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.cue_id)||ids.has(row.cue_id)||!Number.isSafeInteger(row.track_index)||row.track_index<0||typeof row.source_requirement!=='string'||!row.source_requirement.trim()||row.source_requirement.length>12000)throw Error('SOUND_CUE_INVALID');
    const key='audio:'+row.track+':'+row.track_index,target=tracks.find(t=>t.key===key);
    if(!target||keys.has(key)||target.sourceKind!==row.source_kind)throw Error('SOUND_CUE_TARGET_MISMATCH '+row.cue_id);
    if(row.preparation!==undefined&&(!['preserve','pcm16'].includes(row.preparation)||target.sourceKind!=='file'))throw Error('SOUND_PREPARATION_INVALID');
    if(row.reuse&& (target.sourceKind!=='file'||typeof row.reuse.path!=='string'||!row.reuse.path.startsWith('assets/sfx/')||row.reuse.path.split('/').includes('..')||! /^[a-f0-9]{64}$/.test(row.reuse.sha256)))throw Error('SOUND_REUSE_INVALID');
    ids.add(row.cue_id);keys.add(key);out.push({...row,key});
  }
  if(requireCoverage){const missing=tracks.filter(t=>!keys.has(t.key));if(missing.length)throw Error('SOUND_CUE_COVERAGE_REQUIRED '+missing.map(t=>t.key).join(', '));}
  return out;
}
export function assertAudioReceipt(root:string,projectId:string,token:string,key:string,relative:string,hash:string,rights:string,cue:(SoundCue&{key:string})|undefined,r:AudioPreparationReceipt|undefined){
  if(!r||r.projectId!==projectId||r.token!==token||r.targetKey!==key||r.preparedPath!==relative||r.preparedSha!==hash||r.rightsSha!==sha(rights)||r.cueSha!==sha(JSON.stringify(cue??null))||r.method!==(cue?.preparation??'preserve')||!Number.isFinite(r.duration)||r.duration<=0||sha(fs.readFileSync(resolveProjectFile(root,r.sourcePath)))!==r.sourceSha||cue?.reuse&&(cue.reuse.path!==r.sourcePath||cue.reuse.sha256!==r.sourceSha))throw Error('SOUND_PREPARATION_EVIDENCE_INVALID');
}
