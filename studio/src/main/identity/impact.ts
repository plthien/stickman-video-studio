/** F24 canonical-switch impact preview. No image writes, POST or automatic regen. */
import fs from 'node:fs';
import {readState,resolveProjectFile,strictJson} from '../services.js';
import {contentHash} from './contracts.js';
import {readIdentityWorkflow} from './identityWorkflow.js';
import {readNativeDraft,nativeImageTargetsFromManifest} from '../externalTasks.js';
import {validateNativeIdentityNeeds} from './nativeNeeds.js';

export function previewReferenceSwitchImpact(root:string,selectedIds:string[]){
  const state=readState(root),journal=readIdentityWorkflow(root);
  const bible=journal.bible;
  if(state.identityPolicy!=='v1'||!bible||!journal.bibleTextApproved||
    journal.bibleTextApproved.sha256!==bible.style_bible_sha256)
    throw Error('REFERENCE_IMPACT_UPSTREAM_NOT_READY');
  if(selectedIds.length!==bible.characters.length||
    new Set(selectedIds).size!==selectedIds.length)
    throw Error('REFERENCE_IMPACT_SELECTION_INCOMPLETE');
  const chosen=selectedIds.map(id=>journal.referenceCandidates.find(candidate=>
    candidate.candidate_id===id&&candidate.status==='APPROVED'&&
    candidate.style_bible_sha256===bible.style_bible_sha256));
  if(chosen.some(candidate=>!candidate))throw Error('REFERENCE_IMPACT_CANDIDATE_INVALID');
  const before=journal.referenceApprovalSet?.entries??[];
  const changed=bible.characters.filter(char=>{
    const selected=chosen.find(candidate=>candidate?.anchor_id===char.char_id);
    const previous=before.find(entry=>entry.anchor_id===char.char_id);
    return!selected||!previous||previous.candidate_id!==selected.candidate_id||
      previous.media_sha256!==selected.media_sha256||
      previous.source_definition_hash!==selected.source_definition_hash;
  }).map(char=>char.char_id);
  const changedIds=new Set<string>(changed),affected=new Set<string>();
  let sourceTargets:Array<{targetKey:string;shotId:string;layerId:string;
    characters:string[];source:{shot_id:string;layer_id:string}|null}>=[];
  try{
    const draft=readNativeDraft(root);
    if(draft){
      const artifact=draft.artifact as unknown as {
        manifest:Record<string,unknown>;asset_needs:unknown[]
      };
      const targets=nativeImageTargetsFromManifest(artifact.manifest);
      const validated=validateNativeIdentityNeeds(artifact.asset_needs,targets,bible,'v1');
      sourceTargets=targets.map((t,index)=>({
        targetKey:t.key,shotId:t.shotId,layerId:t.layerId,
        characters:validated.rows[index].character_ids,
        source:validated.rows[index].continuity_source??null
      }));
    }
  }catch(error){
    // Missing draft is legitimate before Native Author. A corrupt active draft
    // cannot be silently treated as no dependencies.
    if(error instanceof Error&&/NATIVE_DRAFT_STALE_AUTHOR_TASK/.test(error.message))
      throw error;
    if(fs.existsSync(resolveProjectFile(root,'.studio/external/pending.json')))
      throw Error('REFERENCE_IMPACT_NATIVE_DRAFT_UNVERIFIED');
  }
  for(const target of sourceTargets)if(target.characters.some(id=>changedIds.has(id)))
    affected.add(target.targetKey);
  let grow=true;
  while(grow){
    grow=false;
    for(const target of sourceTargets){
      const source=sourceTargets.find(row=>row.shotId===target.source?.shot_id&&
        row.layerId===target.source?.layer_id);
      if(source&&affected.has(source.targetKey)&&!affected.has(target.targetKey)){
        affected.add(target.targetKey);grow=true;
      }
    }
  }
  const targetKeys=[...affected].sort();
  const evidence={projectId:state.project.id,sourceSetSha:journal.referenceApprovalSet?.approval_set_sha256??null,
    revision:journal.revision,selectedIds:[...selectedIds],changedCharacterIds:changed.sort(),
    affectedTargetKeys:targetKeys,
    publishedNativeAffected:Boolean(state.external.native&&changed.length)};
  return{...evidence,impactSha256:contentHash(evidence)};
}
export function assertNoIdentityBusyJobs(root:string,affectedTargetKeys:string[]){
  const projectId=readState(root).project.id;
  const dirs=[
    resolveProjectFile(root,'.studio/glabs/jobs'),
    resolveProjectFile(root,'.studio/identity/reference-jobs')
  ];
  for(const folder of dirs){
    if(!fs.existsSync(folder))continue;
    for(const name of fs.readdirSync(folder).filter(name=>
      /^[a-f0-9-]{36}\.json$/i.test(name))){
      const job=strictJson(fs.readFileSync(resolveProjectFile(root,
        folder.endsWith('reference-jobs')?'.studio/identity/reference-jobs/'+name:
          '.studio/glabs/jobs/'+name),'utf8')) as Record<string,unknown>;
      // Unknown potentially charged attempts remain a fence unless owner
      // explicitly resolves them; never allow silent canonical switching.
      if(job.projectId===projectId&&
        ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(String(job.status))&&
        (folder.endsWith('reference-jobs')||!affectedTargetKeys.length||
          affectedTargetKeys.includes(String(job.targetKey))))
        throw Error('IDENTITY_CHANGE_BUSY_OR_UNKNOWN_PROVIDER_JOB');
    }
  }
  const latest=resolveProjectFile(root,'.studio/jobs/latest.json');
  if(fs.existsSync(latest)){
    const job=strictJson(fs.readFileSync(latest,'utf8')) as Record<string,unknown>;
    if(['STARTED','RUNNING'].includes(String(job.status))&&
      ['validate','preview','approve','render'].includes(String(job.command)))
      throw Error('IDENTITY_CHANGE_NATIVE_JOB_RUNNING');
  }
}
