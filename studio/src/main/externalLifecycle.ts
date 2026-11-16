import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,readState,resolveProjectFile,sha,strictJson,writeState,type ExternalOperation,type Stage,type StudioState} from './services.js';
import {compileAuthority} from './externalAuthority.js';
import {rejectNativeUnsafePaths,validateAuthoring} from './sourceCitations.js';
import {freezeTask,stageImport} from './externalTasks.js';

type Scope={editableIds?:string[];findingIds?:string[];media?:'preview'|'film'|'voice'|'captions'};
type Artifact={value:unknown;sha256:string;id:string};
const exact=(value:Record<string,unknown>,keys:string[])=>{const extra=Object.keys(value).filter(key=>!keys.includes(key));if(extra.length)throw new Error(`Unknown field: ${extra[0]}`)};
const lifecycleDir=(root:string)=>resolveProjectFile(root,'.studio/external/lifecycle');
const resultPath=(root:string,id:string)=>path.join(lifecycleDir(root),'results',id+'.json');
const pendingPath=(root:string)=>path.join(lifecycleDir(root),'pending.json');
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);

function artifactFor(root:string,state:StudioState,stage:Stage,operation:ExternalOperation):Artifact{
  if(stage==='script'){
    const value=state.scriptCandidate??state.approvedScript;if(!value)throw new Error('REVIEW_REQUIRED: no Script candidate or approved Script exists.');
    return{value,sha256:sha(JSON.stringify(value)),id:`script-${value.revision}`};
  }
  const file=path.join(root,'project.json');if(!state.external.native||!fs.existsSync(file))throw new Error('REVIEW_REQUIRED: no imported Native artifact exists.');
  const value=strictJson(fs.readFileSync(file,'utf8'));return{value,sha256:sha(JSON.stringify(value)),id:`native-${state.external.native.revision}-${operation}`};
}
function evidence(root:string,state:StudioState,scope:Scope){
  const selected=scope.media;if(!selected)return{status:'NOT_VERIFIED',modalities:[],ranges:[],files:[]};
  const row=selected==='preview'?state.preview:selected==='film'?state.render:undefined;
  if((selected==='preview'||selected==='film')&&!row)throw new Error(`NOT_VERIFIED: verified ${selected} media does not exist.`);
  if(row){const file=resolveProjectFile(root,row.path),bytes=fs.readFileSync(file);if(sha(bytes)!==row.sha256)throw new Error('BLOCKED: registered review media bytes changed.');return{status:'VERIFIED',modalities:['picture','motion','sound'],ranges:[{start:0,end:selected==='preview'?state.nativeReadiness?.checkedSeconds??state.nativeReadiness?.previewSeconds:null}],files:[{path:row.path,sha256:row.sha256,reportPath:row.reportPath,reportSha256:row.reportSha256}]};}
  if(selected==='voice'){if(!state.voice||state.voice.stale)throw new Error('NOT_VERIFIED: current voice evidence is unavailable.');return{status:'VERIFIED',modalities:['sound'],ranges:[{start:0,end:state.voice.duration??null}],files:[{path:state.voice.path,sha256:state.voice.sha256}]};}
  if(!state.alignment?.captionReview)throw new Error('NOT_VERIFIED: owner-reviewed captions are unavailable.');return{status:'VERIFIED',modalities:['captions'],ranges:[],files:[{path:state.alignment.captionsPath,sha256:state.alignment.captionReview.sha256}]};
}

export function freezeLifecycleTask(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,scope:Scope={},rebuild=false){
  if(!['review','correct','recheck','media-review'].includes(operation))throw new Error('Unsupported lifecycle operation.');
  const state=readState(root),artifact=artifactFor(root,state,stage,operation),authority=compileAuthority(appPath,state.project.style,stage,operation);
  const evidencePack=operation==='media-review'?evidence(root,state,scope):{status:'NOT_APPLICABLE',modalities:[],ranges:[],files:[]};
  const editableIds=[...new Set(scope.editableIds??[])];if(operation==='correct'&&!editableIds.length)throw new Error('Correct requires an explicit non-empty editable target scope.');
  const inputSha256=sha(JSON.stringify({projectId:state.project.id,stage,operation,artifactSha256:artifact.sha256,authority,evidencePack,editableIds,findingIds:scope.findingIds??[]}));
  const key=`${stage}:${operation}`,prior=state.lifecycle?.tasks[key];
  if(!rebuild&&prior?.status==='FROZEN'&&prior.inputSha256===inputSha256&&fs.existsSync(resolveProjectFile(root,prior.promptPath)))return{...prior,prompt:fs.readFileSync(resolveProjectFile(root,prior.promptPath),'utf8')};
  if(prior)prior.status='STALE';const id=randomUUID(),revision=(prior?.revision??0)+1;
  const contract=operation==='review'||operation==='recheck'||operation==='media-review'
    ?{schema:'mode-b-review-v1',artifact_sha256:artifact.sha256,status:'REVIEWED_WITH_FINDINGS',coverage:{modalities:evidencePack.modalities,ranges:evidencePack.ranges},findings:[{id:'F-001',severity:'major',target_ids:['actual-id'],requirement:'Exact violated requirement',evidence:{kind:'observed|manifest|inferred|unverified',detail:'Actual evidence or INSUFFICIENT_EVIDENCE'},recommendation:'Scoped corrective target'}]}
    :{schema:'mode-b-correction-v1',artifact_sha256:artifact.sha256,finding_ids:scope.findingIds??[],editable_ids:editableIds,artifact:stage==='script'?{schema:'mode-b-script-v1',sections:[{id:'actual-id',text:'Complete corrected narration'}],authoring:{creative_direction:{},characters:[],style_decisions:{},voice_intentions:{},sound_intentions:{},source_references:[]}}:{manifest:'COMPLETE_ORIGINAL_PROJECT_JSON_V1',shot_ledger:[],sound_script:[],asset_needs:[]}};
  const envelope={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:id,revision,input_sha256:inputSha256,stage,operation,payload:contract};
  const prompt=`# MODE B EXTERNAL ${operation.toUpperCase()}\n\nReturn exactly one JSON object. Review independently; an author report is not evidence. Technical/native PASS remains Studio-owned. Do not claim frames, timestamps, motion or sound not actually present in the transferred evidence. For correction, modify only editable IDs and return the complete original artifact grammar.\n\nAUTHORITY\n${authority.rules.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n\nTRACEABILITY\n${JSON.stringify(authority.sources,null,2)}\n\nORIGINAL TASK INPUT\n${JSON.stringify({project:state.brief,style:state.project.style,approvedScript:state.approvedScript??null},null,2)}\n\nIMMUTABLE ARTIFACT\n${JSON.stringify({id:artifact.id,sha256:artifact.sha256,value:artifact.value},null,2)}\n\nSCOPE AND LOCKS\n${JSON.stringify({editableIds,locked:'all artifact entity IDs not listed as editable',findingIds:scope.findingIds??[]},null,2)}\n\nAVAILABLE EVIDENCE\n${JSON.stringify(evidencePack,null,2)}\n\nRESPONSE CONTRACT\n${JSON.stringify(envelope,null,2)}\n`;
  const relative=`.studio/external/lifecycle/tasks/${stage}-${operation}-${revision}-${id}.md`,target=resolveProjectFile(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,prompt,{encoding:'utf8',flag:'wx'});
  state.lifecycle??={tasks:{},artifacts:{}};const lifecycle=state.lifecycle;lifecycle.tasks[key]={id,stage,operation,revision,inputSha256,artifactSha256:artifact.sha256,promptPath:relative,promptSha256:sha(prompt),status:'FROZEN',createdAt:new Date().toISOString(),editableIds,findingIds:scope.findingIds};writeState(root,state);
  return{...lifecycle.tasks[key],prompt};
}

function entities(stage:Stage,value:unknown){if(stage==='script')return ((value as {sections?:unknown[]}).sections??[]) as Array<Record<string,unknown>>;return ((value as {shots?:unknown[]}).shots??[]) as Array<Record<string,unknown>>;}
function validateLocks(stage:Stage,before:unknown,after:unknown,editable:string[]){
  const idKey='id',oldRows=entities(stage,before),newRows=entities(stage,after),map=new Map(newRows.map(row=>[String(row[idKey]),row]));
  if(oldRows.length!==newRows.length)throw new Error('Correction cannot add/remove entities without explicit expanded structural scope.');
  for(const row of oldRows){const id=String(row[idKey]);if(!editable.includes(id)&&canonical(row)!==canonical(map.get(id)))throw new Error(`Locked entity changed: ${id}`);}
}
export function stageLifecycleResult(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,text:string){
  const state=readState(root),task=state.lifecycle?.tasks[`${stage}:${operation}`];if(!task||task.status!=='FROZEN')throw new Error('No current frozen lifecycle task exists.');
  const current=artifactFor(root,state,stage,operation);if(current.sha256!==task.artifactSha256)throw new Error('Lifecycle artifact is stale.');compileAuthority(appPath,state.project.style,stage,operation);
  const value=strictJson(text) as Record<string,unknown>;exact(value,['schema','project_id','task_id','revision','input_sha256','stage','operation','payload']);
  if(value.schema!=='mode-b-lifecycle-result-v1'||value.project_id!==state.project.id||value.task_id!==task.id||value.revision!==task.revision||value.input_sha256!==task.inputSha256||value.stage!==stage||value.operation!==operation)throw new Error('Lifecycle project/task/revision binding mismatch.');
  const payload=value.payload as Record<string,unknown>;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid lifecycle payload.');
  if(operation==='correct'){
    exact(payload,['schema','artifact_sha256','finding_ids','editable_ids','artifact']);if(payload.schema!=='mode-b-correction-v1'||payload.artifact_sha256!==task.artifactSha256||JSON.stringify(payload.editable_ids)!==JSON.stringify(task.editableIds??[]))throw new Error('Correction scope/artifact binding mismatch.');
    const corrected=payload.artifact as Record<string,unknown>;if(stage==='script'){if(corrected.schema!=='mode-b-script-v1'||!Array.isArray(corrected.sections)||!corrected.sections.length)throw new Error('Invalid complete Script correction.');validateAuthoring(corrected.authoring);validateLocks(stage,current.value,corrected,task.editableIds??[]);}else{const manifest=(corrected.manifest??corrected) as Record<string,unknown>;rejectNativeUnsafePaths(manifest);validateLocks(stage,current.value,manifest,task.editableIds??[]);}
  }else{
    exact(payload,['schema','artifact_sha256','status','coverage','findings']);if(payload.schema!=='mode-b-review-v1'||payload.artifact_sha256!==task.artifactSha256||!['REVIEWED_WITH_FINDINGS','REVIEWED_NO_FINDINGS','NOT_VERIFIED'].includes(String(payload.status))||!Array.isArray(payload.findings))throw new Error('Invalid review result.');
    const coverage=payload.coverage as {modalities?:unknown[];ranges?:unknown[]};if(!coverage||!Array.isArray(coverage.modalities)||!Array.isArray(coverage.ranges))throw new Error('Review coverage is required.');
    if(operation==='media-review'&&payload.status==='REVIEWED_NO_FINDINGS'&&!coverage.modalities.length)throw new Error('INSUFFICIENT_EVIDENCE: media review cannot claim no findings without observed modalities.');
  }
  const responseSha256=sha(text),token=randomUUID();fs.mkdirSync(path.dirname(resultPath(root,task.id)),{recursive:true});fs.writeFileSync(resultPath(root,task.id),text,{encoding:'utf8',flag:'wx'});atomicJson(pendingPath(root),{token,projectId:state.project.id,taskId:task.id,stage,operation,responseSha256,payload,createdAt:new Date().toISOString()});return{token,before:current.value,after:payload,status:'STAGED'};
}

export function confirmLifecycleResult(appPathOrRoot:string,rootOrToken:string,maybeToken?:string){
  const appPath=maybeToken?appPathOrRoot:path.resolve('.'),root=maybeToken?rootOrToken:appPathOrRoot,token=maybeToken??rootOrToken;
  const pending=strictJson(fs.readFileSync(pendingPath(root),'utf8')) as Record<string,unknown>,state=readState(root);if(pending.token!==token||pending.projectId!==state.project.id)throw new Error('Lifecycle confirmation token/project mismatch.');
  const key=`${pending.stage}:${pending.operation}`,task=state.lifecycle?.tasks[key];if(!task||task.id!==pending.taskId||task.status!=='FROZEN')throw new Error('Lifecycle task is stale or replayed.');
  const payload=pending.payload as Record<string,unknown>;if(pending.operation==='correct'){
    const artifact=(payload.artifact??{}) as Record<string,unknown>;
    if(pending.stage==='script'){const sections=artifact.sections as Array<{id:string;text:string}>,text=sections.map(row=>row.text.trim()).join('\n\n');state.scriptCandidate={sections,text,sha256:sha(text),revision:(state.external.script?.revision??0)+1,importedAt:new Date().toISOString(),taskId:task.id,authoring:artifact.authoring as Record<string,unknown>};}
    else atomicJson(path.join(lifecycleDir(root),'corrections',task.id+'.json'),artifact);
  }
  state.lifecycle!.artifacts[task.id]={taskId:task.id,stage:task.stage,operation:task.operation,artifactSha256:sha(JSON.stringify(payload)),value:payload,status:String(payload.status??'CORRECTION_PENDING'),createdAt:new Date().toISOString()};
  task.status='IMPORTED';writeState(root,state);fs.unlinkSync(pendingPath(root));
  if(pending.operation==='correct'&&pending.stage==='native'){
    const authored=freezeTask(appPath,root,'native',true),artifact=((payload.artifact??{}) as Record<string,unknown>);
    stageImport(appPath,root,'native',JSON.stringify({schema:'mode-b-external-result-v1',project_id:state.project.id,task_id:authored.id,revision:authored.revision,input_sha256:authored.inputSha256,stage:'native',payload:artifact}));
    return readState(root);
  }
  return state;
}

export function exportReviewPack(root:string,kind:'preview'|'film'|'voice'|'captions'){
  const state=readState(root),pack=evidence(root,state,{media:kind}),id=randomUUID(),relative=`.studio/external/review-packs/${kind}-${id}.json`;
  const value={schema:'mode-b-review-pack-v1',project_id:state.project.id,kind,created_at:new Date().toISOString(),coverage:pack,script:state.approvedScript??null,manifest_sha256:sha(fs.readFileSync(path.join(root,'project.json'))),media_ledger:state.media??[],notice:'Local export only. The user must explicitly transfer listed media; this JSON alone does not prove picture, motion or sound was observed.'};atomicJson(resolveProjectFile(root,relative),value);return{path:relative,pack:value};
}
