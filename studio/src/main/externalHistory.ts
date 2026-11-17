import fs from 'node:fs';
import {readState,resolveProjectFile,sha,strictJson,type ExternalOperation,type Stage,type StudioState} from './services.js';
import type {ExternalHistoryRecord} from '../shared/externalHistory.js';

type TaskRecord=Record<string,unknown>;
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value as Record<string,unknown>)
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  return JSON.stringify(value);
}
const validTask=(value:TaskRecord,stage:Stage,operation:ExternalOperation)=>
  typeof value.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value.id)&&
  typeof value.revision==='number'&&Number.isInteger(value.revision)&&value.revision>0&&
  typeof value.promptPath==='string'&&typeof value.promptSha256==='string'&&
  ['FROZEN','IMPORTED','STALE'].includes(String(value.status))&&
  (operation==='author'||value.stage===stage&&value.operation===operation);
function safeRead(root:string,relative:string,expectedSha:string,errors:string[],label:string):string|null{
  try{
    const file=resolveProjectFile(root,relative);
    if(!fs.existsSync(file)){errors.push(label+'_MISSING');return null;}
    const bytes=fs.readFileSync(file);
    if(!/^[a-f0-9]{64}$/.test(expectedSha)||sha(bytes)!==expectedSha){
      errors.push(label+'_HASH_MISMATCH');return null;
    }
    return bytes.toString('utf8');
  }catch{errors.push(label+'_UNREADABLE');return null;}
}
/** Recover a legacy Author response only from byte-verified, identity-exact project files.
 * Never infer a winner from order, timestamps or a near-matching filename.
 */
/** A response file can exist before confirmation. STALE legacy recovery needs
 * independent persisted evidence connecting this task to a published artifact.
 */
/** Stale legacy Native tasks have no old task-ID receipt; only a current
 * retired Author task whose committed Native revision files and state artifact
 * agree with the exact candidate response can count as confirmed.
 */
function legacyNativePublicationMatches(root:string,state:StudioState,task:TaskRecord,payload?:unknown):boolean{
  const published=state.external.native,active=state.tasks?.native;
  if(!published||!active||active.id!==task.id||
    typeof task.createdAt!=='string'||!Number.isFinite(Date.parse(task.createdAt))||
    !Number.isFinite(Date.parse(published.importedAt))||
    Date.parse(published.importedAt)<Date.parse(task.createdAt)||
    !Number.isInteger(published.revision)||published.revision<1)return false;
  if(payload===undefined)return true; // Candidate scan only: no confirmation.
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return false;
  try{
    const proposed=payload as Record<string,unknown>;
    const artifact=published.artifact as Record<string,unknown>;
    if(!artifact||canonical(artifact.manifest)!==canonical(proposed.manifest)||
      canonical(artifact.shotLedger)!==canonical(proposed.shot_ledger)||
      canonical(artifact.soundScript)!==canonical(proposed.sound_script)||
      canonical(artifact.assetNeeds)!==canonical(proposed.asset_needs))return false;
    const revision=published.revision;
    const manifestPath=resolveProjectFile(root,'.studio/revisions/native-'+revision+'.json');
    const authoringPath=resolveProjectFile(root,'.studio/revisions/native-authoring-'+revision+'.json');
    const manifest=strictJson(fs.readFileSync(manifestPath,'utf8'));
    const authoring=strictJson(fs.readFileSync(authoringPath,'utf8')) as Record<string,unknown>;
    return canonical(manifest)===canonical(proposed.manifest)&&
      canonical(authoring.shot_ledger)===canonical(proposed.shot_ledger)&&
      canonical(authoring.sound_script)===canonical(proposed.sound_script)&&
      canonical(authoring.asset_needs)===canonical(proposed.asset_needs);
  }catch{return false;}
}
function legacyAuthorPublished(root:string,state:StudioState,stage:Stage,task:TaskRecord,payload?:unknown):boolean{
  const archived=state.externalTaskArchive?.some(item=>item.stage===stage&&item.operation==='author'&&
    item.task.id===task.id&&item.task.revision===task.revision&&
    item.task.inputSha256===task.inputSha256&&item.task.status==='IMPORTED');
  if(archived)return true;
  if(stage==='script'){
    const candidate=state.scriptCandidate;
    return Boolean(candidate?.taskId===task.id&&state.external.script&&
      (payload===undefined||canonical(state.external.script.artifact)===canonical(payload)));
  }
  return legacyNativePublicationMatches(root,state,task,payload);
}
function legacyAuthorResponse(root:string,state:StudioState,stage:Stage,task:TaskRecord,errors:string[],requiresProof=false):string|null{
  const folder='.studio/external/responses';
  let names:string[]=[];
  try{
    const dir=resolveProjectFile(root,folder);
    if(!fs.existsSync(dir)){errors.push('LEGACY_RESPONSE_NOT_VERIFIABLE');return null;}
    names=fs.readdirSync(dir);
  }catch{errors.push('LEGACY_RESPONSE_UNREADABLE');return null;}
  const prefix=stage+'-'+String(task.id)+'-'+String(task.revision)+'-';
  const verified:string[]=[];
  for(const name of names){
    if(!name.startsWith(prefix)||!name.endsWith('.json'))continue;
    const digest=name.slice(prefix.length,-'.json'.length);
    if(!/^[a-f0-9]{64}$/.test(digest))continue;
    try{
      const filename=resolveProjectFile(root,folder+'/'+name);
      const bytes=fs.readFileSync(filename);
      if(sha(bytes)!==digest)continue;
      const parsed=strictJson(bytes.toString('utf8')) as Record<string,unknown>;
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
        parsed.schema!=='mode-b-external-result-v1'||parsed.project_id!==state.project.id||
        parsed.task_id!==task.id||parsed.revision!==task.revision||
        parsed.input_sha256!==task.inputSha256||parsed.stage!==stage||
        !parsed.payload||typeof parsed.payload!=='object'||Array.isArray(parsed.payload))continue;
      if(requiresProof&&!legacyAuthorPublished(root,state,stage,task,parsed.payload))continue;
      verified.push(bytes.toString('utf8'));
    }catch{ /* An invalid/corrupt file cannot become historical evidence. */ }
  }
  if(verified.length===1)return verified[0];
  errors.push(verified.length>1?'LEGACY_RESPONSE_AMBIGUOUS':'LEGACY_RESPONSE_NOT_VERIFIABLE');
  return null;
}
function readOne(root:string,state:StudioState,stage:Stage,operation:ExternalOperation,task:TaskRecord):ExternalHistoryRecord{
  const errors:string[]=[];
  const id=String(task.id),revision=Number(task.revision);
  const status=task.status as 'FROZEN'|'IMPORTED'|'STALE';
  const prompt=typeof task.promptPath==='string'&&typeof task.promptSha256==='string'?
    safeRead(root,task.promptPath,task.promptSha256,errors,'PROMPT'):
    (errors.push('PROMPT_METADATA_MISSING'),null);
  let confirmedJson:string|null=null;
  let findings:ExternalHistoryRecord['findings']=[];
  let reviewStatus:string|undefined;
  const authorReceipt=typeof task.confirmedResponsePath==='string'&&
    typeof task.confirmedResponseSha256==='string';
  const lifecycleRecord=state.lifecycle?.artifacts[id];
  const lifecyclePublished=Boolean(lifecycleRecord&&lifecycleRecord.taskId===id&&
    lifecycleRecord.stage===stage&&lifecycleRecord.operation===operation);
  // STALE only controls actionability. It must not erase a verifiably
  // confirmed publication, nor turn an unconfirmed staged response into one.
  if(status==='IMPORTED'||status==='STALE'&&
      (operation==='author'?authorReceipt||legacyAuthorPublished(root,state,stage,task):
        lifecyclePublished)){
    if(operation==='author'){
      const responseSha=task.confirmedResponseSha256;
      const responsePath=task.confirmedResponsePath;
      if(typeof responseSha==='string'&&typeof responsePath==='string'){
        const text=safeRead(root,responsePath,responseSha,errors,'RESPONSE');
        if(text!==null){
          try{
            const parsed=strictJson(text) as Record<string,unknown>;
            if(parsed.task_id!==id||parsed.revision!==revision||parsed.stage!==stage||
              parsed.project_id!==state.project.id||parsed.input_sha256!==task.inputSha256||
              parsed.schema!=='mode-b-external-result-v1')errors.push('RESPONSE_IDENTITY_MISMATCH');
            else confirmedJson=text;
          }catch{errors.push('RESPONSE_INVALID_JSON');}
        }
      }else confirmedJson=legacyAuthorResponse(root,state,stage,task,errors,status==='STALE');
    }else{
      const relative='.studio/external/lifecycle/results/'+id+'.json';
      const saved=state.lifecycle?.artifacts[id];
      if(!saved||saved.taskId!==id||saved.operation!==operation||saved.stage!==stage)
        errors.push('CONFIRMED_RESULT_RECORD_MISSING');
      else{
        const file=resolveProjectFile(root,relative);
        if(!fs.existsSync(file))errors.push('RESPONSE_MISSING');
        else{
          const bytes=fs.readFileSync(file);
          if(typeof task.confirmedResponseSha256==='string'&&sha(bytes)!==task.confirmedResponseSha256)
            errors.push('RESPONSE_HASH_MISMATCH');
          else{
            try{
              const parsed=strictJson(bytes.toString('utf8')) as Record<string,unknown>;
              if(parsed.task_id!==id||parsed.stage!==stage||parsed.operation!==operation||
                parsed.project_id!==state.project.id||parsed.input_sha256!==task.inputSha256||
                parsed.revision!==revision||parsed.schema!=='mode-b-lifecycle-result-v1'||
                canonical(parsed.payload)!==canonical(saved.value))errors.push('RESPONSE_IDENTITY_MISMATCH');
              else {
                confirmedJson=bytes.toString('utf8');
                const payload=parsed.payload as {findings?:unknown;status?:unknown};
                if(typeof payload.status==='string')reviewStatus=payload.status;
                const rows=payload.findings;
                if(Array.isArray(rows))findings=rows.filter((x):x is ExternalHistoryRecord['findings'][number]=>{
                  if(!x||typeof x!=='object')return false;
                  const row=x as Record<string,unknown>;
                  return typeof row.id==='string'&&typeof row.status==='string'&&
                    typeof row.severity==='string'&&Array.isArray(row.target_ids)&&
                    typeof row.requirement==='string';
                });
              }
            }catch{errors.push('RESPONSE_INVALID_JSON');}
          }
        }
      }
    }
  }
  return {id,revision,stage,operation,status,mediaKind:task.mediaKind as ExternalHistoryRecord['mediaKind'],
    prompt,confirmedJson,findings,reviewStatus,errors,integrity:errors.length?(prompt===null&&confirmedJson===null?'ERROR':'PARTIAL'):'OK',
    editableIds:task.editableIds as string[]|undefined,
    editablePaths:task.editablePaths as string[]|undefined,
    targetIds:task.targetIds as string[]|undefined,
    findingIds:task.findingIds as string[]|undefined,
    mediaTransferAttested:task.mediaTransferAttested===true};
}
/** Pure project-local read. No freeze, no source rebuild and no state mutation. */
export function readExternalHistory(root:string,stage:Stage,operation:ExternalOperation,
  mediaKind?:'voice'|'captions'|'preview'|'film'):ExternalHistoryRecord[]{
  if(!['script','native'].includes(stage)||
    !['author','review','correct','recheck','media-review'].includes(operation)||
    (operation==='media-review'&&!(['voice','captions','preview','film'] as unknown[]).includes(mediaKind)))
    throw new Error('INVALID_HISTORY_SCOPE');
  if(operation==='media-review'&&
    !(stage==='script'&&['voice','captions'].includes(mediaKind!)||
      stage==='native'&&['preview','film'].includes(mediaKind!)))
    throw new Error('INVALID_HISTORY_MEDIA_KIND');
  const state=readState(root);
  const active=operation==='author'?state.tasks?.[stage]:state.lifecycle?.tasks[stage+':'+operation];
  const candidates:TaskRecord[]=[];
  if(active)candidates.push(active as unknown as TaskRecord);
  for(const row of [...(state.externalTaskArchive??[])].reverse())
    if(row.stage===stage&&row.operation===operation)candidates.push(row.task);
  const unique=new Set<string>();
  return candidates.filter(task=>validTask(task,stage,operation)&&
    (operation!=='media-review'||task.mediaKind===mediaKind)&&
    !unique.has(String(task.id))&&Boolean(unique.add(String(task.id))))
    .map(task=>readOne(root,state,stage,operation,task));
}
