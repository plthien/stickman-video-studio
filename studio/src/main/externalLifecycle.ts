import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,readState,resolveProjectFile,sha,strictJson,writeState,type ExternalOperation,type Stage,type StudioState} from './services.js';
import {compileAuthority} from './externalAuthority.js';
import {rejectNativeUnsafePaths,validateAuthoring} from './sourceCitations.js';
import {freezeTask,stageImport,confirmImport,validateScript,validateManifest} from './externalTasks.js';

type Scope={editableIds?:string[];editablePaths?:string[];findingIds?:string[];media?:'preview'|'film'|'voice'|'captions'};
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
  const manifest=strictJson(fs.readFileSync(file,'utf8'));
  const existing=state.external.native.artifact as Record<string,unknown>|undefined;
  const value={manifest,shot_ledger:existing?.shotLedger??[],sound_script:existing?.soundScript??[],asset_needs:existing?.assetNeeds??[]};
  return{value,sha256:sha(JSON.stringify(value)),id:'native-'+state.external.native.revision+'-'+operation};
}
function evidence(root:string,state:StudioState,scope:Scope){
  const selected=scope.media;if(!selected)return{status:'NOT_VERIFIED',modalities:[],ranges:[],files:[]};
  const row=selected==='preview'?state.preview:selected==='film'?state.render:undefined;
  if((selected==='preview'||selected==='film')&&!row)throw new Error(`NOT_VERIFIED: verified ${selected} media does not exist.`);
  if(row){const file=resolveProjectFile(root,row.path),bytes=fs.readFileSync(file);if(sha(bytes)!==row.sha256)throw new Error('BLOCKED: registered review media bytes changed.');return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[{start:0,end:selected==='preview'?state.nativeReadiness?.checkedSeconds??state.nativeReadiness?.previewSeconds:null}],files:[{path:row.path,sha256:row.sha256,reportPath:row.reportPath,reportSha256:row.reportSha256}]};}
  if(selected==='voice'){if(!state.voice||state.voice.stale)throw new Error('NOT_VERIFIED: current voice evidence is unavailable.');return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[{start:0,end:state.voice.duration??null}],files:[{path:state.voice.path,sha256:state.voice.sha256}]};}
  if(!state.alignment?.captionReview)throw new Error('NOT_VERIFIED: owner-reviewed captions are unavailable.');return{status:'AVAILABLE_LOCALLY_NOT_TRANSFERRED',modalities:[],ranges:[],files:[{path:state.alignment.captionsPath,sha256:state.alignment.captionReview.sha256}]};
}

export function freezeLifecycleTask(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,scope:Scope={},rebuild=false){
  if(!['review','correct','recheck','media-review'].includes(operation))throw new Error('Unsupported lifecycle operation.');
  const state=readState(root),artifact=artifactFor(root,state,stage,operation),authority=compileAuthority(appPath,state.project.style,stage,operation);
  const ownerTask=state.tasks?.[stage];
  if(!ownerTask||!fs.existsSync(resolveProjectFile(root,ownerTask.promptPath)))
    throw new Error('REBUILD_REQUIRED: original frozen author task is unavailable for independent review/correction.');
  const originalTask=fs.readFileSync(resolveProjectFile(root,ownerTask.promptPath),'utf8');
  if(ownerTask.promptSha256!==sha(originalTask))throw new Error('REBUILD_REQUIRED: original frozen author task was modified.');
  const evidencePack=operation==='media-review'?evidence(root,state,scope):{status:'NOT_APPLICABLE',modalities:[],ranges:[],files:[]};
  const editableIds=[...new Set(scope.editableIds??[])],editablePaths=[...new Set(scope.editablePaths??[])];
  if(operation==='correct'&&!editableIds.length&&!editablePaths.length)throw new Error('Correct requires explicit non-empty editable IDs or field paths.');
  if(editableIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))throw new Error('Invalid editable ID.');
  if(editablePaths.some(p=>typeof p!=='string'||!/^\/(?:manifest\/)?[A-Za-z0-9_~-]+(?:\/[A-Za-z0-9_~-]+)*$/.test(p)||p==='/'||p==='/manifest'))
    throw new Error('Invalid or overly broad editable field path.');
  const sectionRows=stage==='script'?(artifact.value as {sections:Array<{id:string}>}).sections:
    ((artifact.value as {manifest:{shots?:Array<{id:string}>}}).manifest.shots??[]);
  const targetIds=sectionRows.map(item=>item.id);
  if(new Set(targetIds).size!==targetIds.length||targetIds.some(id=>typeof id!=='string'))throw new Error('Invalid native/script object inventory.');
  if(editableIds.some(id=>!targetIds.includes(id)))throw new Error('Editable target does not exist in frozen artifact.');
  const relevantPrior=Object.values(state.lifecycle?.artifacts??{}).filter(item=>item.stage===stage&&['review','recheck','media-review'].includes(item.operation))
    .sort((x,y)=>y.createdAt.localeCompare(x.createdAt)).slice(0,3).map(item=>({taskId:item.taskId,operation:item.operation,value:item.value}));
  const key=stage+':'+operation,prior=state.lifecycle?.tasks[key];
  const snapshot={projectId:state.project.id,stage,operation,artifactSha256:artifact.sha256,authorityHashes:authority.sources.map(item=>[item.path,item.sha256,item.extractionSha256]),
    originalTaskSha256:sha(originalTask),evidencePack,editableIds,editablePaths,findingIds:scope.findingIds??[],targetIds,relevantPrior};
  const inputSha256=sha(JSON.stringify(snapshot));
  if(!rebuild&&prior?.status==='FROZEN'&&prior.inputSha256===inputSha256&&fs.existsSync(resolveProjectFile(root,prior.promptPath)))
    return{...prior,prompt:fs.readFileSync(resolveProjectFile(root,prior.promptPath),'utf8')};
  if(prior)prior.status='STALE';
  const id=randomUUID(),revision=(prior?.revision??0)+1;
  const contract=operation==='correct'?
    {schema:'mode-b-correction-v1',artifact_sha256:artifact.sha256,finding_ids:scope.findingIds??[],editable_ids:editableIds,editable_paths:editablePaths,
      artifact:stage==='script'?{schema:'mode-b-script-v1',sections:(artifact.value as {sections:unknown[]}).sections,authoring:(artifact.value as {authoring:unknown}).authoring}:
      artifact.value}:
    {schema:'mode-b-review-v1',artifact_sha256:artifact.sha256,status:'INSUFFICIENT_EVIDENCE',
      coverage:{target_ids:targetIds,modalities:[],ranges:[]},findings:[]};
  const envelope={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:id,revision,input_sha256:inputSha256,stage,operation,payload:contract};
  const nativeOrScriptRules=authority.sources.map(source=>
    'BEGIN SOURCE '+source.path+' | full SHA256 '+source.sha256+' | extracted SHA256 '+source.extractionSha256+
    ' | revision '+source.extractionRevision+'\n'+source.text+'\nEND SOURCE '+source.path).join('\n\n');
  const prompt=[
    '# MODE B EXTERNAL '+operation.toUpperCase(),
    'Manual ChatGPT handoff: return a single strict JSON object, no Markdown. Independent review is not owner approval.',
    'Original frozen author task is authoritative. Do not report observing files, frames, audio, motion or timestamps unless they were actually transferred into this ChatGPT conversation.',
    'A local path/hash alone proves no inspection. Correct only explicitly authorized IDs or field paths. Return the COMPLETE artifact.',
    'ORIGINAL FROZEN AUTHOR TASK | SHA256 '+sha(originalTask),originalTask,
    'STAGE-SCOPED INSTALLED NORMATIVE AUTHORITY',nativeOrScriptRules,
    'CREATIVE DECISIONS / BRIEF',JSON.stringify({brief:state.brief,approvedScript:state.approvedScript??null,currentCandidate:state.scriptCandidate??null},null,2),
    'IMMUTABLE TARGET ARTIFACT',JSON.stringify({id:artifact.id,sha256:artifact.sha256,value:artifact.value},null,2),
    'REVIEW COVERAGE INVENTORY',JSON.stringify(targetIds),
    'PRIOR FINDINGS AND UNCERTAINTY',JSON.stringify(relevantPrior,null,2),
    'EDITABLE SCOPE AND GLOBAL LOCKS',JSON.stringify({editableIds,editablePaths,locked:'all other section/shot IDs, fields and auxiliary ledgers',findingIds:scope.findingIds??[]},null,2),
    'ACTUAL EVIDENCE TRANSFER STATUS',JSON.stringify(evidencePack,null,2),
    'JSON RESPONSE CONTRACT | replace the example status/findings with supported results only',JSON.stringify(envelope,null,2)
  ].join('\n\n')+'\n';
  const relative='.studio/external/lifecycle/tasks/'+stage+'-'+operation+'-'+revision+'-'+id+'.md',target=resolveProjectFile(root,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,prompt,{encoding:'utf8',flag:'wx'});
  state.lifecycle??={tasks:{},artifacts:{}};
  state.lifecycle.tasks[key]={id,stage,operation,revision,inputSha256,artifactSha256:artifact.sha256,promptPath:relative,promptSha256:sha(prompt),status:'FROZEN',createdAt:new Date().toISOString(),editableIds,editablePaths,targetIds,findingIds:scope.findingIds,originalTaskSha256:sha(originalTask)};
  writeState(root,state);
  return{...state.lifecycle.tasks[key],prompt};
}

function validateLocks(stage:Stage,before:unknown,after:unknown,editable:string[],editablePaths:string[]){
  const parent=stage==='script'?'/sections':'/manifest/shots';
  const oldRows=stage==='script'?((before as {sections:Array<{id:string}>}).sections):
    ((before as {manifest:{shots:Array<{id:string}>}}).manifest.shots);
  const newRows=stage==='script'?((after as {sections:Array<{id:string}>}).sections):
    ((after as {manifest:{shots:Array<{id:string}>}}).manifest.shots);
  if(!Array.isArray(oldRows)||!Array.isArray(newRows)||oldRows.length!==newRows.length)
    throw new Error('Correction cannot add/remove shots or sections without an explicit structural reissue.');
  for(let i=0;i<oldRows.length;i++){
    if(oldRows[i].id!==newRows[i].id)throw new Error('Correction changed the locked entity identity or ordering.');
  }
  if(stage==='native'){
    const left=(before as {manifest:Record<string,unknown>}).manifest,right=(after as {manifest:Record<string,unknown>}).manifest;
    for(const key of ['voice','captions']){
      if(canonical(left[key])!==canonical(right[key]))throw new Error('Approved narration and word/caption timing are immutable in Native correction: '+key);
    }
  }
  function authorized(pointer:string):boolean{
    if(editablePaths.some(path=>pointer===path||pointer.startsWith(path+'/')))return true;
    for(let i=0;i<oldRows.length;i++){
      const rowPath=parent+'/'+i;
      if(editable.includes(oldRows[i].id)&&pointer.startsWith(rowPath+'/')&&pointer!==rowPath+'/id')return true;
    }
    return false;
  }
  function compare(left:unknown,right:unknown,pointer:string){
    if(canonical(left)===canonical(right))return;
    if(authorized(pointer))return;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))
      throw new Error('Locked native/creative field changed: '+(pointer||'/'));
    if(Array.isArray(left)&&Array.isArray(right)){
      if(left.length!==right.length)throw new Error('Locked array size changed: '+pointer);
      for(let i=0;i<left.length;i++)compare(left[i],right[i],pointer+'/'+i);
      return;
    }
    const l=left as Record<string,unknown>,r=right as Record<string,unknown>;
    for(const key of new Set([...Object.keys(l),...Object.keys(r)]))
      compare(l[key],r[key],pointer+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
  }
  compare(before,after,'');
}
function validateReview(payload:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string],operation:ExternalOperation){
  exact(payload,['schema','artifact_sha256','status','coverage','findings']);
  if(payload.schema!=='mode-b-review-v1'||payload.artifact_sha256!==task.artifactSha256||
    !['REVIEWED_WITH_FINDINGS','REVIEWED_NO_FINDINGS','INSUFFICIENT_EVIDENCE','NOT_VERIFIED'].includes(String(payload.status))||
    !Array.isArray(payload.findings))throw new Error('Invalid review result.');
  const coverage=payload.coverage as Record<string,unknown>;
  if(!coverage||typeof coverage!=='object'||Array.isArray(coverage))throw new Error('Review coverage is required.');
  exact(coverage,['target_ids','modalities','ranges']);
  const covered=coverage.target_ids;
  if(!Array.isArray(covered)||covered.some(id=>typeof id!=='string'||!task.targetIds?.includes(id))||new Set(covered).size!==covered.length)
    throw new Error('Review coverage contains fabricated, duplicate or missing target identities.');
  if(payload.status!=='INSUFFICIENT_EVIDENCE'&&payload.status!=='NOT_VERIFIED'&&
    (covered.length!==task.targetIds?.length||task.targetIds?.some(id=>!covered.includes(id))))
    throw new Error('Unsupported review coverage: every requested target must be accounted for.');
  if(!Array.isArray(coverage.modalities)||!Array.isArray(coverage.ranges))throw new Error('Review coverage modalities and ranges must be arrays.');
  const findings=payload.findings as unknown[],ids=new Set<string>();
  for(const item of findings){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid review finding.');
    const f=item as Record<string,unknown>;
    exact(f,['id','severity','status','target_ids','requirement','evidence','recommendation']);
    if(typeof f.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(f.id)||ids.has(f.id))throw new Error('Invalid/duplicate finding ID.');
    ids.add(f.id);
    if(!['critical','major','minor'].includes(String(f.severity))||!['open','resolved','uncertain'].includes(String(f.status)))
      throw new Error('Invalid finding severity/status.');
    if(!Array.isArray(f.target_ids)||!f.target_ids.length||f.target_ids.some(id=>!task.targetIds?.includes(String(id))))
      throw new Error('Finding refers to an unknown shot/section target.');
    if(typeof f.requirement!=='string'||!f.requirement.trim()||typeof f.recommendation!=='string')throw new Error('Finding lacks violated requirement.');
    const ev=f.evidence as Record<string,unknown>;
    if(!ev||typeof ev!=='object'||Array.isArray(ev)||!['manifest','inferred','unverified','observed'].includes(String(ev.kind))||
       typeof ev.detail!=='string'||!ev.detail.trim())throw new Error('Finding lacks verifiable evidence description.');
    if(ev.kind==='observed'&&operation==='media-review')throw new Error('NOT_VERIFIED: local media path/hash is not proof of transferred audiovisual observation.');
  }
  if(payload.status==='REVIEWED_WITH_FINDINGS'&&!findings.length)throw new Error('Review declares findings but supplies none.');
  if(payload.status==='REVIEWED_NO_FINDINGS'&&findings.length)throw new Error('No-findings status conflicts with supplied findings.');
  if(operation==='media-review'&&payload.status==='REVIEWED_NO_FINDINGS')
    throw new Error('INSUFFICIENT_EVIDENCE: physical media inspection requires a verified transfer/owner review, not path metadata.');
}
export function stageLifecycleResult(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,text:string){
  const state=readState(root),task=state.lifecycle?.tasks[`${stage}:${operation}`];if(!task||task.status!=='FROZEN')throw new Error('No current frozen lifecycle task exists.');
  const current=artifactFor(root,state,stage,operation);if(current.sha256!==task.artifactSha256)throw new Error('Lifecycle artifact is stale.');compileAuthority(appPath,state.project.style,stage,operation);
  const value=strictJson(text) as Record<string,unknown>;exact(value,['schema','project_id','task_id','revision','input_sha256','stage','operation','payload']);
  if(value.schema!=='mode-b-lifecycle-result-v1'||value.project_id!==state.project.id||value.task_id!==task.id||value.revision!==task.revision||value.input_sha256!==task.inputSha256||value.stage!==stage||value.operation!==operation)throw new Error('Lifecycle project/task/revision binding mismatch.');
  const payload=value.payload as Record<string,unknown>;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid lifecycle payload.');
  if(operation==='correct'){
    exact(payload,['schema','artifact_sha256','finding_ids','editable_ids','editable_paths','artifact']);
    if(payload.schema!=='mode-b-correction-v1'||payload.artifact_sha256!==task.artifactSha256||
      JSON.stringify(payload.editable_ids)!==JSON.stringify(task.editableIds??[])||
      JSON.stringify(payload.editable_paths??[])!==JSON.stringify(task.editablePaths??[])||
      JSON.stringify(payload.finding_ids)!==JSON.stringify(task.findingIds??[]))
      throw new Error('Correction scope, findings or artifact binding mismatch.');
    if(!Array.isArray(payload.finding_ids))throw new Error('Finding scope must be explicit.');
    const corrected=payload.artifact as Record<string,unknown>;
    if(!corrected||typeof corrected!=='object'||Array.isArray(corrected))throw new Error('Missing complete corrected artifact.');
    if(stage==='script'){
      const checked=validateScript(corrected);
      const previous=current.value as {sections:unknown[];authoring:unknown};
      validateLocks(stage,{schema:'mode-b-script-v1',sections:previous.sections,authoring:previous.authoring},
        checked,task.editableIds??[],task.editablePaths??[]);
    }else{
      const previous=current.value as {manifest:Record<string,unknown>;shot_ledger:unknown;sound_script:unknown;asset_needs:unknown};
      validateManifest(state,root,corrected);
      rejectNativeUnsafePaths(corrected);
      validateLocks(stage,previous,corrected,task.editableIds??[],task.editablePaths??[]);
    }
  }else{
    validateReview(payload,task,operation);
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
