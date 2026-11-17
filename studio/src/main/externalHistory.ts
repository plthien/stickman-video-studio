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
function readOne(root:string,state:StudioState,stage:Stage,operation:ExternalOperation,task:TaskRecord):ExternalHistoryRecord{
  const errors:string[]=[];
  const id=String(task.id),revision=Number(task.revision);
  const status=task.status as 'FROZEN'|'IMPORTED'|'STALE';
  const prompt=typeof task.promptPath==='string'&&typeof task.promptSha256==='string'?
    safeRead(root,task.promptPath,task.promptSha256,errors,'PROMPT'):
    (errors.push('PROMPT_METADATA_MISSING'),null);
  let confirmedJson:string|null=null;
  let findings:ExternalHistoryRecord['findings']=[];
  if(status==='IMPORTED'){
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
      }else errors.push('LEGACY_RESPONSE_NOT_VERIFIABLE');
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
                const rows=(parsed.payload as {findings?:unknown})?.findings;
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
    prompt,confirmedJson,findings,errors,integrity:errors.length?(prompt===null&&confirmedJson===null?'ERROR':'PARTIAL'):'OK',
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
