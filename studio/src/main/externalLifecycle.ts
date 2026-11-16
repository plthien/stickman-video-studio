import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,readState,resolveProjectFile,sha,strictJson,writeState,type ExternalOperation,type Stage,type StudioState} from './services.js';
import {compileAuthority} from './externalAuthority.js';
import {rejectNativeUnsafePaths,validateAuthoring} from './sourceCitations.js';
import {freezeTask,stageImport,confirmImport,validateScript,validateManifest,type ConfirmOptions} from './externalTasks.js';

type Scope={targetIds?:string[];editableIds?:string[];editablePaths?:string[];findingIds?:string[];media?:'preview'|'film'|'voice'|'captions';transferAcknowledged?:boolean};
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

function lifecycleSourceContext(state:StudioState,stage:Stage,operation:ExternalOperation){
  return sha(JSON.stringify({
    projectId:state.project.id,style:state.project.style,brief:state.brief,
    approvedScript:state.approvedScript??null,
    scriptCandidate:stage==='script'?state.scriptCandidate??null:null,
    voice:stage==='native'?state.voice??null:null,
    alignment:stage==='native'?state.alignment??null:null,
    reviewMedia:operation==='media-review'?{preview:state.preview??null,render:state.render??null}:null
  }));
}
const authorityIdentity=(authority:ReturnType<typeof compileAuthority>)=>
  sha(JSON.stringify(authority.sources.map(source=>[source.path,source.sha256,source.extractionSha256,source.extractionRevision])));
function assertLifecycleFresh(appPath:string,root:string,state:StudioState,task:NonNullable<StudioState['lifecycle']>['tasks'][string],journalResume=false){
  if(!task.sourceContextSha256||task.sourceContextSha256!==lifecycleSourceContext(state,task.stage,task.operation))
    throw new Error('STALE: lifecycle brief, approved creative source or voice/alignment was changed.');
  const authority=compileAuthority(appPath,state.project.style,task.stage,task.operation);
  if(!task.authorityFingerprint||task.authorityFingerprint!==authorityIdentity(authority))
    throw new Error('REBUILD_REQUIRED: installed Mode B creative authority changed.');
  for(const item of task.mediaBaseline??[]){
    const live=(state.media??[]).find(row=>JSON.stringify(row)===JSON.stringify(item));
    if(!live)throw new Error('STALE: accepted media ledger entry changed or was removed.');
    const file=resolveProjectFile(root,item.path);
    if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==item.sha256)
      throw new Error('STALE: accepted media bytes changed outside an authorized correction.');
  }
  const source=state.tasks?.[task.stage];
  if(!journalResume&&(!source||!task.originalTaskSha256||source.promptSha256!==task.originalTaskSha256))
    throw new Error('REBUILD_REQUIRED: original frozen author task changed.');
  const file=resolveProjectFile(root,task.promptPath);
  if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==task.promptSha256)
    throw new Error('REBUILD_REQUIRED: lifecycle task prompt changed.');
}
function attestLocalTransfer(root:string,kind:'preview'|'film'|'voice'|'captions',files:Array<{path:string;sha256:string}>){
  const base=resolveProjectFile(root,'.studio/external/review-packs');
  if(!fs.existsSync(base))throw new Error('MEDIA_PACK_REQUIRED: export an actual media package before manual transfer attestation.');
  const folders=fs.readdirSync(base,{withFileTypes:true}).filter(item=>item.isDirectory()&&item.name.startsWith(kind+'-'));
  for(const folder of folders){
    const directory=path.join(base,folder.name),file=path.join(directory,'review-package.json');
    if(!fs.existsSync(file))continue;
    let pack:Record<string,unknown>;
    try{pack=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>;}catch{continue;}
    if(pack.kind!==kind||pack.schema!=='mode-b-review-pack-v2')continue;
    const items=pack.attachments as Array<{sha256:string;path:string}>|undefined;
    if(!Array.isArray(items)||!files.every(item=>items.some(ref=>ref.sha256===item.sha256)))continue;
    let valid=true;
    for(const item of items){
      if(typeof item.path!=='string'||!item.path.startsWith('media/')||path.posix.normalize(item.path)!==item.path||item.path.split('/').includes('..')||
        typeof item.sha256!=='string'||!(/^[a-f0-9]{64}$/.test(item.sha256))){valid=false;break;}
      const physical=path.join(directory,item.path);
      if(!fs.existsSync(physical)||sha(fs.readFileSync(physical))!==item.sha256){valid=false;break;}
    }
    if(valid)return folder.name;
  }
  throw new Error('MEDIA_PACK_REQUIRED: no current exported package matches exact preview/audio SHA-256 bytes.');
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
  let mediaTransferAttested=false,mediaSha256s:string[]=[],mediaDuration:number|undefined;
  if(operation==='media-review'){
    const listed=evidencePack.files as Array<{path:string;sha256:string}>;
    mediaSha256s=listed.map(file=>file.sha256);
    const duration=(evidencePack.ranges as Array<{start:number;end?:number|null}>)[0]?.end;
    if(typeof duration==='number'&&Number.isFinite(duration)&&duration>0)mediaDuration=duration;
    if(scope.transferAcknowledged===true){
      if(!scope.media)throw new Error('Missing explicit media kind for transfer attestation.');
      attestLocalTransfer(root,scope.media,listed);
      mediaTransferAttested=true;
      evidencePack.status='OWNER_ATTESTED_FILE_TRANSFER_NOT_VERIFIED_BY_STUDIO';
    }else evidencePack.status='AVAILABLE_LOCALLY_NOT_TRANSFERRED';
  }
  const editableIds=[...new Set(scope.editableIds??[])],editablePaths=[...new Set(scope.editablePaths??[])];
  if(operation==='correct'&&!editableIds.length&&!editablePaths.length)throw new Error('Correct requires explicit non-empty editable IDs or field paths.');
  if(editableIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))throw new Error('Invalid editable ID.');
  if(editablePaths.some(p=>typeof p!=='string'||!/^\/(?:manifest\/)?[A-Za-z0-9_~-]+(?:\/[A-Za-z0-9_~-]+)*$/.test(p)||p==='/'||p==='/manifest'))
    throw new Error('Invalid or overly broad editable field path.');
  const sectionRows=stage==='script'?(artifact.value as {sections:Array<{id:string}>}).sections:
    ((artifact.value as {manifest:{shots?:Array<{id:string}>}}).manifest.shots??[]);
  const allTargetIds=sectionRows.map(item=>item.id);
  if(new Set(allTargetIds).size!==allTargetIds.length||allTargetIds.some(id=>typeof id!=='string'))
    throw new Error('Invalid native/script object inventory.');
  const requested=scope.targetIds??[];
  if(!Array.isArray(requested)||new Set(requested).size!==requested.length||
    requested.some(id=>typeof id!=='string'||!allTargetIds.includes(id)))
    throw new Error('Review target scope contains fabricated or duplicate entity IDs.');
  const targetIds=requested.length?requested:allTargetIds;
  if(editableIds.some(id=>!allTargetIds.includes(id)))throw new Error('Editable target does not exist in frozen artifact.');
  const relevantPrior=Object.values(state.lifecycle?.artifacts??{}).filter(item=>item.stage===stage&&['review','recheck','media-review'].includes(item.operation))
    .sort((x,y)=>y.createdAt.localeCompare(x.createdAt)).slice(0,3).map(item=>({taskId:item.taskId,operation:item.operation,value:item.value}));
  const latestFindingStatus=new Map<string,string>();
  for(const item of [...relevantPrior].reverse()){
    const p=item.value as {findings?:Array<{id:string;status?:string}>};
    for(const finding of p.findings??[])latestFindingStatus.set(finding.id,finding.status??'uncertain');
  }
  const reviewFindings=[...latestFindingStatus].filter(([,status])=>status!=='resolved').map(([id])=>id);
  const findingIds=scope.findingIds??((operation==='correct'||operation==='recheck')?[...new Set(reviewFindings)]:[]);
  if(new Set(findingIds).size!==findingIds.length||findingIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw new Error('Invalid finding scope.');
  if(operation==='recheck'&&reviewFindings.some(id=>!findingIds.includes(id)))
    throw new Error('Recheck must account for every unresolved prior finding.');
  const key=stage+':'+operation,prior=state.lifecycle?.tasks[key];
  const snapshot={projectId:state.project.id,stage,operation,artifactSha256:artifact.sha256,authorityHashes:authority.sources.map(item=>[item.path,item.sha256,item.extractionSha256]),
    originalTaskSha256:sha(originalTask),evidencePack,mediaTransferAttested,mediaSha256s,mediaDuration,editableIds,editablePaths,findingIds,targetIds,relevantPrior};
  const sourceContextSha256=lifecycleSourceContext(state,stage,operation),authorityFingerprint=authorityIdentity(authority);
  const inputSha256=sha(JSON.stringify({...snapshot,sourceContextSha256,authorityFingerprint}));
  if(!rebuild&&prior?.status==='FROZEN'&&prior.inputSha256===inputSha256&&fs.existsSync(resolveProjectFile(root,prior.promptPath)))
    return{...prior,prompt:fs.readFileSync(resolveProjectFile(root,prior.promptPath),'utf8')};
  if(prior)prior.status='STALE';
  const id=randomUUID(),revision=(prior?.revision??0)+1;
  const contract=operation==='correct'?
    {schema:'mode-b-correction-v1',artifact_sha256:artifact.sha256,finding_ids:findingIds,editable_ids:editableIds,editable_paths:editablePaths,
      artifact:stage==='script'?{schema:'mode-b-script-v1',sections:(artifact.value as {sections:unknown[]}).sections,authoring:(artifact.value as {authoring:unknown}).authoring}:
      artifact.value}:
    {schema:'mode-b-review-v1',artifact_sha256:artifact.sha256,status:'INSUFFICIENT_EVIDENCE',
      coverage:{target_ids:targetIds,modalities:[],ranges:[],media_sha256s:mediaTransferAttested?mediaSha256s:[]},findings:[]};
  const envelope={schema:'mode-b-lifecycle-result-v1',project_id:state.project.id,task_id:id,revision,input_sha256:inputSha256,stage,operation,payload:contract};
  const nativeOrScriptRules=authority.sources.map(source=>
    'BEGIN SOURCE '+source.path+' | full SHA256 '+source.sha256+' | extracted SHA256 '+source.extractionSha256+
    ' | revision '+source.extractionRevision+'\n'+source.text+'\nEND SOURCE '+source.path).join('\n\n');
  const prompt=[
    '# MODE B EXTERNAL '+operation.toUpperCase(),
    'Manual ChatGPT handoff: return a single strict JSON object, no Markdown. Independent review is not owner approval.',
    'Original frozen author task is authoritative. Do not report observing files, frames, audio, motion or timestamps unless they were actually transferred into this ChatGPT conversation.',
    'A local path/hash alone proves no inspection. Correct only explicitly authorized IDs or field paths. Return the COMPLETE artifact.',
    'Media transfer attestation is an owner declaration, not automated proof ChatGPT watched or listened. Cite exact media SHA and real time/shot IDs for audiovisual findings; if not genuinely provided, mark INSUFFICIENT_EVIDENCE.',
    'ORIGINAL FROZEN AUTHOR TASK | SHA256 '+sha(originalTask),originalTask,
    'STAGE-SCOPED INSTALLED NORMATIVE AUTHORITY',nativeOrScriptRules,
    'CREATIVE DECISIONS / BRIEF',JSON.stringify({brief:state.brief,approvedScript:state.approvedScript??null,currentCandidate:state.scriptCandidate??null},null,2),
    'IMMUTABLE TARGET ARTIFACT',JSON.stringify({id:artifact.id,sha256:artifact.sha256,value:artifact.value},null,2),
    'REVIEW COVERAGE INVENTORY',JSON.stringify(targetIds),
    'PRIOR FINDINGS AND UNCERTAINTY',JSON.stringify(relevantPrior,null,2),
    'EDITABLE SCOPE AND GLOBAL LOCKS',JSON.stringify({editableIds,editablePaths,locked:'all other section/shot IDs, fields and auxiliary ledgers',findingIds:findingIds},null,2),
    'ACTUAL EVIDENCE TRANSFER STATUS',JSON.stringify(evidencePack,null,2),
    'JSON RESPONSE CONTRACT | replace the example status/findings with supported results only',JSON.stringify(envelope,null,2)
  ].join('\n\n')+'\n';
  const relative='.studio/external/lifecycle/tasks/'+stage+'-'+operation+'-'+revision+'-'+id+'.md',target=resolveProjectFile(root,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,prompt,{encoding:'utf8',flag:'wx'});
  state.lifecycle??={tasks:{},artifacts:{}};
  state.lifecycle.tasks[key]={id,stage,operation,revision,inputSha256,artifactSha256:artifact.sha256,promptPath:relative,promptSha256:sha(prompt),status:'FROZEN',createdAt:new Date().toISOString(),editableIds,editablePaths,targetIds,findingIds,originalTaskSha256:sha(originalTask),sourceContextSha256,authorityFingerprint,mediaTransferAttested,mediaSha256s,mediaDuration,mediaBaseline:structuredClone(state.media??[])};
  writeState(root,state);
  return{...state.lifecycle.tasks[key],prompt};
}

export function validateLocks(stage:Stage,before:unknown,after:unknown,editable:string[],editablePaths:string[]){
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
  exact(coverage,['target_ids','modalities','ranges','media_sha256s']);
  const covered=coverage.target_ids;
  if(!Array.isArray(covered)||covered.some(id=>typeof id!=='string'||!task.targetIds?.includes(id))||new Set(covered).size!==covered.length)
    throw new Error('Review coverage contains fabricated, duplicate or missing target identities.');
  if(payload.status!=='INSUFFICIENT_EVIDENCE'&&payload.status!=='NOT_VERIFIED'&&
    (covered.length!==task.targetIds?.length||task.targetIds?.some(id=>!covered.includes(id))))
    throw new Error('Unsupported review coverage: every requested target must be accounted for.');
  if(!Array.isArray(coverage.modalities)||!Array.isArray(coverage.ranges))throw new Error('Review coverage modalities and ranges must be arrays.');
  const mediaSha256s=coverage.media_sha256s??[];
  if(!Array.isArray(mediaSha256s)||new Set(mediaSha256s).size!==mediaSha256s.length||
    mediaSha256s.some(value=>typeof value!=='string'||!task.mediaSha256s?.includes(value))||
    (task.mediaTransferAttested?JSON.stringify(mediaSha256s)!==JSON.stringify(task.mediaSha256s):mediaSha256s.length!==0))
    throw new Error('Review media provenance differs from frozen owner-attested transfer scope.');

  if(coverage.modalities.some(modality=>!['picture','motion','sound','captions','script','manifest'].includes(String(modality)))||
    new Set(coverage.modalities).size!==coverage.modalities.length)
    throw new Error('Review coverage claims unknown or duplicate evidence modalities.');
  for(const range of coverage.ranges){
    if(!range||typeof range!=='object'||Array.isArray(range))throw new Error('Invalid review time range.');
    const value=range as Record<string,unknown>;
    exact(value,['start','end']);
    if(typeof value.start!=='number'||!Number.isFinite(value.start)||value.start<0||
      typeof value.end!=='number'||!Number.isFinite(value.end)||value.end<=value.start)
      throw new Error('Review time ranges require real finite increasing bounds.');
    if(operation==='media-review'&&task.mediaDuration!==undefined&&value.end>task.mediaDuration+.01)
      throw new Error('Review coverage time range outside actual frozen media.');
  }
  if(operation==='media-review'&&!task.mediaTransferAttested&&coverage.modalities.some(modality=>['picture','motion','sound'].includes(String(modality))))
    throw new Error('NOT_VERIFIED: locally packaged media does not establish transferred or inspected audiovisual modalities.');

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
    exact(ev,['kind','detail','source_sha256','time_range']);
    if(ev.source_sha256!==undefined&&(typeof ev.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(ev.source_sha256)))throw new Error('Malformed cited evidence SHA.');
    if(ev.time_range!==undefined){const t=ev.time_range as Record<string,unknown>;if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.start!=='number'||typeof t.end!=='number'||!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<=t.start)throw new Error('Invalid observed evidence time range.');}
    if(ev.kind==='observed'){
      if(operation!=='media-review'||!task.mediaTransferAttested)
        throw new Error('NOT_VERIFIED: visual/audio observation requires a current owner-attested manual transfer package.');
      if(typeof ev.source_sha256!=='string'||!task.mediaSha256s?.includes(ev.source_sha256))
        throw new Error('Observed evidence does not bind the exact transferred media SHA-256.');
      if(!ev.time_range&&!f.target_ids.length)
        throw new Error('Observed evidence needs an actual shot target or time range.');
      if(ev.time_range&&task.mediaDuration!==undefined&&
        (ev.time_range as {end:number}).end>task.mediaDuration+.01)
        throw new Error('Observed evidence timestamp is outside the actual frozen media.');
    }
  }
  if(operation==='recheck'&&task.findingIds?.some(id=>!ids.has(id)))throw new Error('Recheck omitted a previously unresolved finding.');
  if(payload.status==='REVIEWED_WITH_FINDINGS'&&!findings.length)throw new Error('Review declares findings but supplies none.');
  if(payload.status==='REVIEWED_NO_FINDINGS'&&findings.some(item=>(item as {status:string}).status!=='resolved'))throw new Error('No-findings recheck contains unresolved findings.');
  if(operation==='media-review'&&payload.status==='REVIEWED_NO_FINDINGS'&&
    (!task.mediaTransferAttested||!coverage.modalities.length||!mediaSha256s.length))
    throw new Error('INSUFFICIENT_EVIDENCE: no-findings media review needs user-attested actual attachments and explicit observed coverage.');
}
export function stageLifecycleResult(appPath:string,root:string,stage:Stage,operation:Exclude<ExternalOperation,'author'>,text:string){
  const state=readState(root),task=state.lifecycle?.tasks[`${stage}:${operation}`];if(!task||task.status!=='FROZEN')throw new Error('No current frozen lifecycle task exists.');
  const current=artifactFor(root,state,stage,operation);if(current.sha256!==task.artifactSha256)throw new Error('Lifecycle artifact is stale.');assertLifecycleFresh(appPath,root,state,task);
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
  const responseSha256=sha(text),savedPath=resultPath(root,task.id),stagingPath=pendingPath(root);
  if(fs.existsSync(stagingPath)){
    const existing=strictJson(fs.readFileSync(stagingPath,'utf8')) as Record<string,unknown>;
    if(existing.projectId!==state.project.id||existing.taskId!==task.id||existing.responseSha256!==responseSha256)
      throw new Error('PENDING_LIFECYCLE_CONFLICT: explicitly confirm or resolve the existing proposal before staging another.');
    if(!fs.existsSync(savedPath)||sha(fs.readFileSync(savedPath))!==responseSha256)
      throw new Error('RECOVERY_REQUIRED: staged lifecycle response bytes changed.');
    return{token:String(existing.token),before:current.value,after:payload,status:'STAGED'};
  }
  fs.mkdirSync(path.dirname(savedPath),{recursive:true});
  if(fs.existsSync(savedPath)){
    if(sha(fs.readFileSync(savedPath))!==responseSha256)
      throw new Error('Lifecycle response for this task is immutable; rebuild for a different proposal.');
  }else fs.writeFileSync(savedPath,text,{encoding:'utf8',flag:'wx'});
  const token=randomUUID();
  atomicJson(stagingPath,{token,projectId:state.project.id,taskId:task.id,stage,operation,responseSha256,payload,createdAt:new Date().toISOString()});
  return{token,before:current.value,after:payload,status:'STAGED'};
}

export interface LifecyclePublicationOptions { validator?:ConfirmOptions['validator'];previewSeconds?:number;allowSampleDraft?:boolean;hooks?:{afterJournal?:()=>void;afterStaging?:()=>void;afterNativeCommit?:()=>void} }
const nativeCorrectionJournal=(root:string)=>path.join(lifecycleDir(root),'native-publication.json');
const manifestSemanticHash=(file:string)=>sha(JSON.stringify(strictJson(fs.readFileSync(file,'utf8'))));
function finalizeLifecycle(root:string,pending:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string]){
  const state=readState(root),key=String(pending.stage)+':'+String(pending.operation);
  if(!state.lifecycle?.tasks[key]||state.lifecycle.tasks[key].id!==task.id||
    !['FROZEN','IMPORTED'].includes(state.lifecycle.tasks[key].status))throw new Error('Lifecycle finalization is stale.');
  const payload=pending.payload as Record<string,unknown>;
  state.lifecycle.artifacts[task.id]={taskId:task.id,stage:task.stage,operation:task.operation,
    artifactSha256:sha(JSON.stringify(payload)),value:payload,status:String(payload.status??'CORRECTION_STAGED'),
    createdAt:new Date().toISOString()};
  state.lifecycle.tasks[key].status='IMPORTED';writeState(root,state);
  if(fs.existsSync(pendingPath(root)))fs.unlinkSync(pendingPath(root));
  if(fs.existsSync(nativeCorrectionJournal(root)))fs.unlinkSync(nativeCorrectionJournal(root));
  return state;
}
async function publishNativeCorrection(appPath:string,root:string,pending:Record<string,unknown>,task:NonNullable<StudioState['lifecycle']>['tasks'][string],options:LifecyclePublicationOptions={}){
  const payload=pending.payload as {artifact:{manifest:Record<string,unknown>;shot_ledger:unknown[];sound_script:unknown[];asset_needs:unknown[]}};
  const desiredSha256=sha(JSON.stringify(payload.artifact.manifest));
  const manifestPath=path.join(root,'project.json');
  const baselineSha256=manifestSemanticHash(manifestPath);
  const journalFile=nativeCorrectionJournal(root);
  const saved=fs.existsSync(journalFile)?strictJson(fs.readFileSync(journalFile,'utf8')) as Record<string,unknown>:null;
  if(saved&&(saved.token!==pending.token||saved.taskId!==task.id||saved.desiredSha256!==desiredSha256))
    throw new Error('RECOVERY_REQUIRED: another native correction publication is pending.');
  const journal:Record<string,unknown>=saved??{token:pending.token,taskId:task.id,baselineSha256,desiredSha256,authorTaskId:null,status:'PENDING'};
  if(saved&&baselineSha256!==journal.baselineSha256&&baselineSha256!==desiredSha256)
    throw new Error('STALE: independent native manifest change prevents correction retry.');
  if(!saved){atomicJson(journalFile,journal);options.hooks?.afterJournal?.();}
  if(baselineSha256===desiredSha256){
    const finished=readState(root);
    if(!saved||!finished.external.native||!finished.nativeReadiness?.sampleReady||
      finished.nativeReadiness.sourceFingerprint!==sha(fs.readFileSync(manifestPath))||
      finished.tasks?.native?.status!=='IMPORTED')
      throw new Error('RECOVERY_REQUIRED: matching bytes alone do not establish a validated correction.');
    journal.status='VALIDATED';journal.publishedRevision=finished.external.native.revision;atomicJson(journalFile,journal);
    return finalizeLifecycle(root,pending,task);
  }
  let authorTask;
  const existing=readState(root).tasks?.native;
  if(journal.authorTaskId&&existing?.id===journal.authorTaskId&&existing.status==='FROZEN')
    authorTask=freezeTask(appPath,root,'native',false);
  else {
    authorTask=freezeTask(appPath,root,'native',true);
    journal.authorTaskId=authorTask.id;atomicJson(journalFile,journal);
  }
  const newState=readState(root);
  const result={schema:'mode-b-external-result-v1',project_id:newState.project.id,task_id:authorTask.id,
    revision:authorTask.revision,input_sha256:authorTask.inputSha256,stage:'native',payload:payload.artifact};
  const pendingImport=stageImport(appPath,root,'native',JSON.stringify(result));
  options.hooks?.afterStaging?.();
  try{
    await confirmImport(appPath,root,pendingImport.token,{validator:options.validator,previewSeconds:options.previewSeconds,allowSampleDraft:options.allowSampleDraft});
    options.hooks?.afterNativeCommit?.();
  }catch(error){
    journal.status='PENDING_RETRY';journal.detail=String(error);atomicJson(journalFile,journal);
    throw error;
  }
  const current=readState(root);
  if(manifestSemanticHash(manifestPath)!==desiredSha256||!current.external.native||!current.nativeReadiness?.sampleReady)
    throw new Error('RECOVERY_REQUIRED: native publication is not the validated proposed manifest.');
  journal.status='VALIDATED';journal.publishedRevision=current.external.native.revision;atomicJson(journalFile,journal);
  return finalizeLifecycle(root,pending,task);
}
export function confirmLifecycleResult(appPathOrRoot:string,rootOrToken:string,maybeToken?:string,options:LifecyclePublicationOptions={}):StudioState|Promise<StudioState>{
  const appPath=maybeToken?appPathOrRoot:path.resolve('.'),root=maybeToken?rootOrToken:appPathOrRoot,token=maybeToken??rootOrToken;
  const file=pendingPath(root);
  if(!fs.existsSync(file))throw new Error('No pending lifecycle result.');
  const pending=strictJson(fs.readFileSync(file,'utf8')) as Record<string,unknown>,state=readState(root);
  if(pending.token!==token||pending.projectId!==state.project.id)throw new Error('Lifecycle confirmation token/project mismatch.');
  const key=String(pending.stage)+':'+String(pending.operation),task=state.lifecycle?.tasks[key];
  if(!task||task.id!==pending.taskId)throw new Error('Lifecycle task is stale or replayed.');
  if(task.status==='IMPORTED'&&state.lifecycle?.artifacts[task.id]?.taskId===task.id){fs.unlinkSync(file);if(fs.existsSync(nativeCorrectionJournal(root)))fs.unlinkSync(nativeCorrectionJournal(root));return state;}
  if(task.status!=='FROZEN')throw new Error('Lifecycle task is stale or replayed.');
  const recoveryJournal=nativeCorrectionJournal(root);
  const journal=fs.existsSync(recoveryJournal)?
    strictJson(fs.readFileSync(recoveryJournal,'utf8')) as Record<string,unknown>:null;
  const currentManifestSha256=manifestSemanticHash(path.join(root,'project.json'));
  const nativeTask=state.tasks?.native;
  const trustedNativeResume=Boolean(pending.operation==='correct'&&pending.stage==='native'&&journal&&
    journal.token===token&&journal.taskId===task.id&&
    (currentManifestSha256===journal.baselineSha256||currentManifestSha256===journal.desiredSha256)&&
    (!journal.authorTaskId||nativeTask?.id===journal.authorTaskId));
  assertLifecycleFresh(appPath,root,state,task,trustedNativeResume);
  const frozenFile=resultPath(root,task.id);
  if(!fs.existsSync(frozenFile)||sha(fs.readFileSync(frozenFile))!==pending.responseSha256)
    throw new Error('Frozen lifecycle response bytes changed before publication.');
  const frozen=strictJson(fs.readFileSync(frozenFile,'utf8')) as Record<string,unknown>;
  if(canonical(frozen.payload)!==canonical(pending.payload))throw new Error('Lifecycle pending response is corrupt.');
  const original=artifactFor(root,state,task.stage,task.operation);
  if(original.sha256!==task.artifactSha256) {
    const journal=nativeCorrectionJournal(root);
    const saved=fs.existsSync(journal)?strictJson(fs.readFileSync(journal,'utf8')) as Record<string,unknown>:null;
    if(!(pending.operation==='correct'&&pending.stage==='native'&&saved?.token===token&&
      manifestSemanticHash(path.join(root,'project.json'))===saved.desiredSha256&&state.nativeReadiness?.sampleReady&&state.nativeReadiness.sourceFingerprint===sha(fs.readFileSync(path.join(root,'project.json')))))
      throw new Error('STALE: original lifecycle artifact changed before confirmation.');
  }
  if(pending.operation==='correct'&&pending.stage==='native')
    return publishNativeCorrection(appPath,root,pending,task,options);
  if(pending.operation==='correct'&&pending.stage==='script'){
    const payload=pending.payload as {artifact:{sections:Array<{id:string;text:string}>;authoring:Record<string,unknown>}};
    const checked=validateScript(payload.artifact as unknown as Record<string,unknown>);
    const candidateText=checked.sections.map(row=>row.text).join('\n\n');
    const revision=Math.max(state.scriptCandidate?.revision??0,state.external.script?.revision??0)+1;
    state.scriptCandidate={sections:checked.sections,text:candidateText,sha256:sha(candidateText),revision,importedAt:new Date().toISOString(),taskId:task.id,authoring:checked.authoring};
    state.external.script={revision,artifact:checked,importedAt:new Date().toISOString()};
    atomicJson(path.join(root,'.studio','revisions','script-'+revision+'.json'),checked);
    state.lifecycle!.artifacts[task.id]={taskId:task.id,stage:task.stage,operation:task.operation,artifactSha256:sha(JSON.stringify(pending.payload)),value:pending.payload,status:'CORRECTION_STAGED',createdAt:new Date().toISOString()};
    task.status='IMPORTED';
    writeState(root,state);
    if(fs.existsSync(file))fs.unlinkSync(file);
    return state;
  }
  return finalizeLifecycle(root,pending,task);
}

export function exportReviewPack(root:string,kind:'preview'|'film'|'voice'|'captions'){
  const state=readState(root),available=evidence(root,state,{media:kind}),id=randomUUID();
  const relative='.studio/external/review-packs/'+kind+'-'+id,dir=resolveProjectFile(root,relative);
  const attachments:Array<{path:string;sha256:string;bytes:number;kind:string;original:string}>=[];
  const attach=(source:string,expected:string,mediaKind:string)=>{
    const input=resolveProjectFile(root,source),bytes=fs.readFileSync(input);
    if(sha(bytes)!==expected)throw new Error('BLOCKED: media review source bytes changed: '+source);
    const target='media/'+attachments.length+'-'+path.basename(source),output=path.join(dir,target);
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output);
    if(sha(fs.readFileSync(output))!==expected)throw new Error('Review package copy verification failed.');
    attachments.push({path:target,sha256:expected,bytes:bytes.length,kind:mediaKind,original:source});
  };
  for(const file of available.files as Array<{path:string;sha256:string}>)attach(file.path,file.sha256,kind);
  if((kind==='preview'||kind==='film')&&state.voice&&!state.voice.stale)attach(state.voice.path,state.voice.sha256,'voice');
  const report=kind==='preview'?state.preview:kind==='film'?state.render:null;
  if(report)attach(report.reportPath,report.reportSha256,'original_native_QA_report');
  const outputBase=kind==='preview'?'preview':'film';
  for(const extension of ['srt','vtt']){
    const subtitlePath='output/'+outputBase+'.'+extension;
    const filename=resolveProjectFile(root,subtitlePath);
    if(fs.existsSync(filename))attach(subtitlePath,sha(fs.readFileSync(filename)),'encoded_'+extension);
  }
  const sheetPath='output/'+outputBase+'-contact-sheet.png';
  const sheetFile=resolveProjectFile(root,sheetPath);
  if(fs.existsSync(sheetFile))attach(sheetPath,sha(fs.readFileSync(sheetFile)),'contact_sheet_stills_not_motion_proof');
  const promptTask=state.tasks?.native;
  if(promptTask){
    const pathToPrompt=resolveProjectFile(root,promptTask.promptPath);
    if(!fs.existsSync(pathToPrompt)||sha(fs.readFileSync(pathToPrompt))!==promptTask.promptSha256)
      throw new Error('REBUILD_REQUIRED: original frozen Native authority/task changed before review export.');
    attach(promptTask.promptPath,promptTask.promptSha256!,'original_frozen_Native_task_authority');
  }
  const native=strictJson(fs.readFileSync(path.join(root,'project.json'),'utf8')) as Record<string,unknown>;
  const originalTask=state.tasks?.native??null;
  const originalPrompt=originalTask&&fs.existsSync(resolveProjectFile(root,originalTask.promptPath))?
    {path:originalTask.promptPath,sha256:sha(fs.readFileSync(resolveProjectFile(root,originalTask.promptPath)))}:null;
  let words:unknown=null;
  if(state.alignment?.wordsSha256){
    const input=resolveProjectFile(root,state.alignment.path),bytes=fs.readFileSync(input);
    if(sha(bytes)!==state.alignment.wordsSha256)throw new Error('BLOCKED: actual alignment changed before review-pack export.');
    words=strictJson(bytes.toString('utf8'));
  }
  const pack={schema:'mode-b-review-pack-v2',project_id:state.project.id,kind,created_at:new Date().toISOString(),
    transfer_status:'LOCAL_PACKAGE_CREATED_NOT_PROOF_OF_CHATGPT_TRANSFER',attachments,
    coverage:available,script:state.approvedScript??null,original_native_task:originalPrompt,source_requirements:'See attached hash-verified original frozen Native task and the manual media-review prompt; no automatic evidence observation.',
    manifest_sha256:sha(fs.readFileSync(path.join(root,'project.json'))),shots:native.shots??[],
    captions:native.captions??[],actual_word_alignment:words,media_ledger:state.media??[],
    native_qa_report:kind==='preview'?state.preview?.reportPath:kind==='film'?state.render?.reportPath:null,
    notice:'The folder contains actual copied media and this manifest. Manually transfer the requested MP4/WAV and review-package JSON to ChatGPT. A local path or SHA does not prove the model inspected frames, heard audio or verified motion. Owner acceptance remains separate.'};
  const output=path.join(dir,'review-package.json');atomicJson(output,pack);
  return{path:relative+'/review-package.json',folder:relative,pack};
}
