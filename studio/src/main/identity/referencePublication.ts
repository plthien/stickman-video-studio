/** Owner-reviewed reference publication; no provider calls or implicit approvals.
 * This module is independent of shot G-Labs jobs and preserves old snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,contentHash,type StyleBible} from './contracts.js';

export type Mime='image/png'|'image/jpeg'|'image/webp';
/** Required production decoder: Electron nativeImage or a verified image library. */
export type IdentityDecoder=import('../assetPreparation.js').AssetDecoder;
export interface ReferenceCandidate {
  schema:'stickman-visual-reference-candidate-v1';
  project_id:string;candidate_id:string;anchor_type:'character';anchor_id:string;
  source_definition_hash:string;style_bible_sha256:string;
  visual_definition_sha256?:string;
  prompt_sha256:string;provider_job_id:string|null;model:string;aspect_ratio:'1:1';
  media_path:string;media_sha256:string;media_mime:Mime;
  width:number;height:number;rights:string;source:'OWNER_IMPORTED'|'GLABS_GENERATED';
  status:'VALIDATED'|'APPROVED';approval_event_id:string|null;approved_at:string|null;
}
export interface ReferenceApprovalSet {
  schema:'stickman-reference-approval-set-v1';project_id:string;revision:number;
  source_script_sha256:string;analysis_sha256:string;style_bible_sha256:string;
  entries:Array<{anchor_type:'character';anchor_id:string;source_definition_hash:string;
    media_path:string;media_sha256:string;media_mime:Mime;
    approval_event_id:string;rights_sha256:string;candidate_id:string;
    visual_definition_sha256?:string}>;
  approval_set_sha256:string;
}
function projectPath(root:string,relative:string){
  if(!/^assets\/images\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp)$/i.test(relative)||
    relative.split('/').includes('..'))throw Error('REFERENCE_MEDIA_PATH_INVALID');
  const realRoot=fs.realpathSync(root),target=path.resolve(realRoot,relative);
  if(!target.startsWith(realRoot+path.sep))throw Error('REFERENCE_PATH_ESCAPE');
  let cursor=target;
  while(cursor!==realRoot){
    if(fs.existsSync(cursor)){
      if(fs.lstatSync(cursor).isSymbolicLink()||fs.realpathSync(cursor)!==cursor)
        throw Error('REFERENCE_SYMLINK_FORBIDDEN');
    }
    cursor=path.dirname(cursor);
  }
  return target;
}
export function verifyReferenceFile(root:string,relative:string,expectedSha:string,
  expectedMime?:Mime){
  const absolute=projectPath(root,relative),stat=fs.statSync(absolute);
  if(!stat.isFile()||stat.size<24||stat.size>16*1024*1024)
    throw Error('REFERENCE_FILE_SIZE_INVALID');
  const bytes=fs.readFileSync(absolute),sha=hash(bytes);
  if(sha!==expectedSha)throw Error('REFERENCE_SHA_CHANGED');
  const mime:Mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    bytes.toString('ascii',12,16)==='IHDR'?'image/png':
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
    bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':
    (()=>{throw Error('REFERENCE_INVALID_SIGNATURE')})();
  if(expectedMime&&expectedMime!==mime)throw Error('REFERENCE_MIME_CHANGED');
  return{mime,sha,bytes};
}
export function validateCandidate(candidate:ReferenceCandidate,bible:StyleBible,
  root:string,decode:IdentityDecoder){
  const row=bible.characters.find(c=>c.char_id===candidate.anchor_id);
  if(!row||candidate.schema!=='stickman-visual-reference-candidate-v1'||
    candidate.project_id!==bible.project_id||candidate.anchor_type!=='character'||
    candidate.source_definition_hash!==row.source_definition_hash||
    candidate.style_bible_sha256!==bible.style_bible_sha256||
    candidate.aspect_ratio!=='1:1'||candidate.width<1||candidate.height<1||
    candidate.width!==candidate.height||!candidate.rights.trim()||
    !/^[a-f0-9]{64}$/.test(candidate.media_sha256))
    throw Error('REFERENCE_CANDIDATE_LINEAGE_INVALID');
  const verified=verifyReferenceFile(root,candidate.media_path,candidate.media_sha256,
    candidate.media_mime);
  const decoded=decode(verified.bytes);
  if(!decoded||!Buffer.isBuffer(decoded.png)||decoded.png.length<24||
    decoded.png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
    !Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||
    decoded.width!==candidate.width||decoded.height!==candidate.height||
    decoded.width<1||decoded.height<1||decoded.width>8192||decoded.height>8192)
    throw Error('REFERENCE_DECODE_OR_DIMENSION_INVALID');
  return verified;
}
/** Explicit owner approval; HTTP DONE/decoded cannot transition automatically. */
export function approveCandidate(candidate:ReferenceCandidate,bible:StyleBible,root:string,
  ownerInspected:boolean,decode:IdentityDecoder){
  if(ownerInspected!==true||candidate.status!=='VALIDATED')
    throw Error('REFERENCE_OWNER_PREVIEW_REQUIRED');
  validateCandidate(candidate,bible,root,decode);
  const approved:ReferenceCandidate={...candidate,status:'APPROVED',
    approved_at:new Date().toISOString(),approval_event_id:randomUUID()};
  return approved;
}
export function publishApprovalSet(root:string,bible:StyleBible,
  selected:ReferenceCandidate[],revision:number,decode:IdentityDecoder):ReferenceApprovalSet{
  if(selected.length!==bible.characters.length||!Number.isInteger(revision)||revision<1)
    throw Error('REFERENCE_APPROVAL_SET_INCOMPLETE');
  const entries=selected.map(candidate=>{
    if(candidate.status!=='APPROVED'||!candidate.approval_event_id||!candidate.approved_at)
      throw Error('REFERENCE_NOT_OWNER_APPROVED');
    validateCandidate(candidate,bible,root,decode);
    return{anchor_type:'character' as const,anchor_id:candidate.anchor_id,
      source_definition_hash:candidate.source_definition_hash,
      media_path:candidate.media_path,media_sha256:candidate.media_sha256,
      media_mime:candidate.media_mime,approval_event_id:candidate.approval_event_id,
      rights_sha256:hash(candidate.rights),candidate_id:candidate.candidate_id,
      ...(candidate.visual_definition_sha256?{
        visual_definition_sha256:candidate.visual_definition_sha256}:{})};
  }).sort((a,b)=>a.anchor_id.localeCompare(b.anchor_id));
  if(new Set(entries.map(e=>e.anchor_id)).size!==entries.length||
    entries.some(e=>!bible.characters.some(c=>c.char_id===e.anchor_id)))
    throw Error('REFERENCE_APPROVAL_SET_INVALID');
  const base={schema:'stickman-reference-approval-set-v1' as const,
    project_id:bible.project_id,revision,
    source_script_sha256:bible.source_script_sha256,
    analysis_sha256:bible.analysis_sha256,style_bible_sha256:bible.style_bible_sha256,entries};
  return{...base,approval_set_sha256:contentHash(base)};
}
export function validatePublishedSet(root:string,bible:StyleBible,
  approvalSet:ReferenceApprovalSet,candidates:ReferenceCandidate[],decode:IdentityDecoder){
  if(approvalSet.style_bible_sha256!==bible.style_bible_sha256||
    approvalSet.source_script_sha256!==bible.source_script_sha256||
    approvalSet.analysis_sha256!==bible.analysis_sha256||
    approvalSet.project_id!==bible.project_id)
    throw Error('REFERENCE_SET_STALE');
  const expected=publishApprovalSet(root,bible,candidates,approvalSet.revision,decode);
  if(expected.approval_set_sha256!==approvalSet.approval_set_sha256)
    throw Error('REFERENCE_SET_INTEGRITY_INVALID');
  return expected;
}
