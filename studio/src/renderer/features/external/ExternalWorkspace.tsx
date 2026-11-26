/* eslint-disable react-hooks/exhaustive-deps -- session scopes are ref-backed; project/stage scalars define invalidation */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';
import { IdentityAnalysisPanel } from './IdentityAnalysisPanel';
import { readExternalJsonFile } from './readExternalJsonFile';
const tabNames = ['Script', 'Script Analysis', 'Native'] as const; type PromptTab = (typeof tabNames)[number]; type SyntaxResult = 'idle' | 'valid' | 'invalid';
const operations=['Author','Review','Correct','Recheck'] as const;type Operation=(typeof operations)[number];
type History=import('../../../shared/externalHistory').ExternalHistoryRecord;
interface TabValues {
  json:string;result:SyntaxResult;prompt:string;pending:StudioStagedImport|null;
  nativeMediaStatus:StudioStagedImport|null;error:string;previewSeconds:number;
  draftConsent:boolean;reviewTargets:string;editable:string;editablePaths:string;
  findingScope:string;nativeTarget:'DRAFT'|'PUBLISHED';
  frozenScopeKey:string;frozenTaskId:string;
  history:History[];historySelectedId:string;historyLoading:boolean;
  suggestedScopeReviewTaskId?:string;scopeTouched?:boolean;
  editableTouched?:boolean;editablePathsTouched?:boolean;
}
const emptyTab=():TabValues=>({json:'',result:'idle',prompt:'',pending:null,
  nativeMediaStatus:null,error:'',previewSeconds:20,draftConsent:false,
  reviewTargets:'',editable:'',editablePaths:'',findingScope:'',nativeTarget:'DRAFT',
  frozenScopeKey:'',frozenTaskId:'',
  history:[],historySelectedId:'',historyLoading:false,
  scopeTouched:false,editableTouched:false,editablePathsTouched:false});
interface ExternalSession {
  tab:PromptTab;setTab:Dispatch<SetStateAction<PromptTab>>;
  tabs:Record<string,TabValues>;
  patch:(key:string,value:Partial<TabValues>)=>void;
}
const Context=createContext<ExternalSession|null>(null);
export function ExternalSessionProvider({children}:{children:ReactNode}){
  const [tab,setTab]=useState<PromptTab>('Script');
  const [tabValues,setTabValues]=useState<Record<string,TabValues>>({});
  const patch=(key:string,value:Partial<TabValues>)=>setTabValues(prev=>({
    ...prev,[key]:{...(prev[key]??emptyTab()),...value}
  }));
  return <Context.Provider value={{tab,setTab,tabs:tabValues,patch}}>{children}</Context.Provider>;
}
const useSession=()=>{const value=useContext(Context);if(!value)throw new Error('ExternalSessionProvider missing');return value;};
export function ExternalWorkspace(){
  const {tab,setTab}=useSession();
  const [operation,setOperation]=useState<Operation>('Author');
  const stageTabs=<div className="tabs" role="group" aria-label="External stage">{tabNames.map(item=><button key={item} type="button" aria-pressed={tab===item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</div>;
  return <>
    <IdentityAnalysisPanel active={tab==='Script Analysis'} stageTabs={stageTabs}/>
    {tab!=='Script Analysis'&&<ScriptNativeWorkspace tab={tab} stageTabs={stageTabs}
      operation={operation} setOperation={setOperation}/>}
  </>;
}
function ScriptNativeWorkspace({tab,stageTabs,operation,setOperation}:{
  tab:Exclude<PromptTab,'Script Analysis'>;stageTabs:ReactNode;
  operation:Operation;setOperation:Dispatch<SetStateAction<Operation>>;
}){
  const {tabs,patch}=useSession();
  const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState();
  const stage=tab.toLowerCase();
  const lifecycleOperation=operation.toLowerCase() as 'review'|'correct'|'recheck';
  const projectId=native?.project.id;
  const projectEpoch=captureProjectSession()?.epoch;
  const sessionKey=[projectId??'none',stage,operation].join('|');
  const activeKey=useRef(sessionKey);activeKey.current=sessionKey;
  const local=tabs[sessionKey]??emptyTab();
  const {json,result,prompt,pending,nativeMediaStatus,error,previewSeconds,
    reviewTargets,editable,editablePaths,findingScope,nativeTarget,
    frozenScopeKey,frozenTaskId,history,historySelectedId,historyLoading}=local;
  const field=<K extends keyof TabValues,>(name:K)=>(value:TabValues[K])=>
    patch(sessionKey,{[name]:value} as Pick<TabValues,K>);
  const setJson=field('json'),setResult=field('result'),setPrompt=field('prompt');
  const setPending=field('pending'),setNativeMediaStatus=field('nativeMediaStatus');
  const setError=field('error'),setPreviewSeconds=field('previewSeconds');
  const setDraftConsent=field('draftConsent'),setReviewTargets=field('reviewTargets');
  const setFrozenScopeKey=field('frozenScopeKey');
  const setFrozenTaskId=field('frozenTaskId');
  const selectedHistory=historySelectedId?history.find(item=>item.id===historySelectedId):history[0];
  const showingHistory=historySelectedId!==''||(selectedHistory!==undefined&&(!frozenTaskId||selectedHistory.id!==frozenTaskId));
  const visibleHistory=showingHistory?selectedHistory:null;
  // Do not substitute the current prompt when a historical file is missing or corrupt.
  const visiblePrompt=showingHistory?(selectedHistory?.prompt??''):prompt;
  const hasFrozenReservation=Boolean(frozenTaskId||history.some(item=>item.status==='FROZEN'));
  const requests=useRef({freeze:0,validate:0,pending:0,confirm:0,export:0,jsonFile:0,history:0});
  const jsonFilePicker=useRef<HTMLInputElement|null>(null);
  const splitList=(value:string)=>value.split(',').map(x=>x.trim()).filter(Boolean);
  const effectiveNativeTarget=native?.nativeDraft?nativeTarget:'PUBLISHED';
  const staleNativeDraft=stage==='native'&&native?.nativeDraftRecovery==='NATIVE_DRAFT_STALE_AUTHOR_TASK';
  // Unedited suggestions are display-only. The backend recomputes rights from
  // the exact selected finding subset; only explicit owner edits are overrides.
  // Frozen identity is keyed by the VISIBLE exact scope, independent of how
  // the user obtained each field before freezing (manual or suggestion).
  const scopeKey=()=>JSON.stringify({targetContext:stage==='native'?effectiveNativeTarget:undefined,
    targetIds:splitList(reviewTargets),editableIds:splitList(editable),
    editablePaths:splitList(editablePaths),findingIds:findingScope.trim()?splitList(findingScope):undefined});
  const lifecycleScope=()=>{
    // Reusing an unchanged saved task must preserve its exact frozen arrays.
    // On a changed selection, unedited fields are instead inferred by backend.
    const reuseFrozen=Boolean(frozenTaskId&&scopeKey()===frozenScopeKey);
    // Preserve existing all-findings Script/Native behavior. For a narrowed
    // subset, never send aggregate auto-rights: backend derives selected only.
    const fullSuggestion=Boolean(suggested?.reviewTaskId&&
      local.suggestedScopeReviewTaskId===suggested.reviewTaskId&&findingScope.trim()&&
      JSON.stringify(splitList(findingScope))===JSON.stringify(suggested.findingIds));
    const sendAuto=reuseFrozen||fullSuggestion;
    return {targetContext:stage==='native'?effectiveNativeTarget:undefined,
      targetIds:splitList(reviewTargets),
      editableIds:operation==='Correct'&&!local.editableTouched&&!sendAuto?undefined:splitList(editable),
      editablePaths:operation==='Correct'&&!local.editablePathsTouched&&!sendAuto?undefined:splitList(editablePaths),
      findingIds:findingScope.trim()?splitList(findingScope):undefined};
  };
  const autoFindingFields=(text:string)=>{
    const map=suggested?.findingScopes;
    const ids=text.trim()?splitList(text):suggested?.findingIds??[];
    if(!map)return{
      ...(!local.editableTouched?{editable:''}:{}),
      ...(!local.editablePathsTouched?{editablePaths:''}:{})
    };
    return {
      ...(!local.editableTouched?{editable:[...new Set(ids.flatMap(id=>map[id]?.editableIds??[]))].join(', ')}:{}),
      ...(!local.editablePathsTouched?{editablePaths:[...new Set(ids.flatMap(id=>map[id]?.editablePaths??[]))].join(', ')}:{})
    };
  };
  const reviewFindings=visibleHistory?.findings??[];
  const lastReview=visibleHistory&&(visibleHistory.operation==='review'||visibleHistory.operation==='recheck')?visibleHistory:null;
  // Requests belong to a captured tab and project epoch; never publish late
  // results into the newly selected tab. Draft state is retained in its own key.
  useLayoutEffect(()=>{
    // Cancel obsolete file/read requests before browser file events can fire for
    // a newly selected project, stage, operation or Native target.
    for(const name of ['freeze','validate','pending','confirm','export','jsonFile','history'] as const)
      requests.current[name]+=1;
    activeKey.current=sessionKey;
    if(jsonFilePicker.current)jsonFilePicker.current.value='';
    return()=>{
      activeKey.current='';
      for(const name of ['freeze','validate','pending','confirm','export','jsonFile','history'] as const)
        requests.current[name]+=1;
    };
  },[projectId,projectEpoch,stage,operation,effectiveNativeTarget]);
  const suggested=stage==='native'&&effectiveNativeTarget==='PUBLISHED'?
    native?.suggestedCorrectScope?.nativePublished:native?.suggestedCorrectScope?.[stage as 'script'|'native'];
  useEffect(()=>{
    if(operation!=='Correct'||!suggested?.reviewTaskId||
      local.frozenTaskId||local.scopeTouched||
      local.suggestedScopeReviewTaskId===suggested.reviewTaskId)return;
    patch(sessionKey,{
      ...(!local.editableTouched?{editable:suggested.editableIds.join(', ')}:{}),
      ...(!local.editablePathsTouched?{editablePaths:suggested.editablePaths?.join(', ')??''}:{}),
      findingScope:suggested.findingIds.join(', '),
      suggestedScopeReviewTaskId:suggested.reviewTaskId});
  },[sessionKey,suggested?.reviewTaskId,local.frozenTaskId,local.scopeTouched,effectiveNativeTarget]);
  const scopeDirty=Boolean(frozenTaskId&&operation!=='Author'&&scopeKey()!==frozenScopeKey);
  const canImport=Boolean(frozenTaskId&&!scopeDirty&&
    !history.some(item=>item.id===frozenTaskId&&item.status!=='FROZEN')&&
    (!historySelectedId||historySelectedId===frozenTaskId));
  // Restore the current actionable task and historical prompt/result separately.
  // Historical data cannot make an imported or stale task actionable again.
  useEffect(()=>{
    const session=captureProjectSession(),expectedKey=sessionKey;
    const sequence=++requests.current.history;let active=true;
    if(!session||!window.studio)return;
    const op=operation==='Author'?'author':lifecycleOperation;
    const isActive=()=>active&&activeKey.current===expectedKey&&
      sequence===requests.current.history&&isCurrentProjectSession(session);
    patch(expectedKey,{historyLoading:true});
    if(window.studio.readHistory)
      window.studio.readHistory(session.projectId,stage,op)
        .then(rows=>{if(!isActive())return;
          patch(expectedKey,{history:rows,historyLoading:false,
            historySelectedId:rows.some(item=>item.id===tabs[expectedKey]?.historySelectedId)?
              tabs[expectedKey].historySelectedId:''});
        }).catch(reason=>{if(isActive())patch(expectedKey,{historyLoading:false,
          error:'History read: '+String(reason)});});
    else patch(expectedKey,{historyLoading:false});
    if(window.studio.readFrozen)
      window.studio.readFrozen(session.projectId,stage,op)
        .then(task=>{if(!isActive())return;
          if(!task){
            patch(expectedKey,{frozenTaskId:'',frozenScopeKey:'',prompt:''});
            return;
          }
          const next:Partial<TabValues>={prompt:task.prompt,
            frozenTaskId:task.id};
          if(op!=='author'){
            const fields={targetContext:stage==='native'?(task.artifactContext??'PUBLISHED'):undefined,
              targetIds:task.targetIds??[],editableIds:task.editableIds??[],
              editablePaths:task.editablePaths??[],findingIds:task.findingIds?.length?task.findingIds:undefined};
            Object.assign(next,{reviewTargets:fields.targetIds.join(', '),
              editable:fields.editableIds.join(', '),editablePaths:fields.editablePaths.join(', '),
              findingScope:(fields.findingIds??[]).join(', '),frozenScopeKey:JSON.stringify(fields)});
          }
          patch(expectedKey,next);
        }).catch(reason=>{if(isActive())patch(expectedKey,{error:String(reason)});});
    return()=>{active=false;};
  },[projectId,projectEpoch,stage,operation]);
  const reloadHistory=(project:string,expectedKey=sessionKey)=>{
    if(!window.studio?.readHistory)return;
    const session=captureProjectSession(),sequence=++requests.current.history;
    const op=operation==='Author'?'author':lifecycleOperation;
    void window.studio.readHistory(project,stage,op).then(rows=>{
      if(activeKey.current===expectedKey&&session&&sequence===requests.current.history&&isCurrentProjectSession(session)&&projectId===project)
        patch(expectedKey,{history:rows,historyLoading:false});
    }).catch(reason=>{
      if(activeKey.current===expectedKey&&session&&sequence===requests.current.history&&isCurrentProjectSession(session))patch(expectedKey,{error:'History read: '+String(reason)});
    });
  };
  const buildTask=async(forceRebuild=false)=>{
    if(!native||!window.studio)return;
    const session=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.freeze;
    requests.current.history+=1;
    if(!session)return;
    const snapshot=lifecycleScope(),key=scopeKey();
    if(!forceRebuild&&frozenTaskId&&scopeDirty){
      setError('Current FROZEN task has a different scope. Use Rebuild Task explicitly.');
      return;
    }
    const rebuild=forceRebuild;
    try{
      const task=expectedOperation==='Author'?
        await window.studio.freezeTask(session.projectId,expectedStage,rebuild):
        await window.studio.freezeLifecycle(session.projectId,expectedStage,lifecycleOperation,snapshot,rebuild);
      if(sequence!==requests.current.freeze||!isCurrentProjectSession(session)||
        expectedStage!==stage||expectedOperation!==operation||activeKey.current!==sessionKey)return;
      if(!rebuild&&frozenTaskId&&task.id===frozenTaskId){
        // An unchanged Build reuses the frozen identity. Never clear its
        // pasted JSON, staged diff or previously selected history.
        setPrompt(task.prompt);setFrozenScopeKey(key);setError('');
        showNotice('Current frozen task retained.');
        return;
      }
      setPrompt(task.prompt);setFrozenTaskId(task.id);setFrozenScopeKey(key);
      setPending(null);setNativeMediaStatus(null);setResult('idle');setJson('');setError('');
      patch(sessionKey,{history:[],historySelectedId:''});
      reloadHistory(session.projectId,sessionKey);
      showNotice(rebuild?'Task rebuilt. Previous exported responses are now stale.':'Frozen task ready to export.');
    }catch(reason){if(sequence===requests.current.freeze&&activeKey.current===sessionKey&&isCurrentProjectSession(session))setError(String(reason));}
  };
  const change=(value:string)=>{requests.current.jsonFile+=1;setJson(value);setResult('idle');setPending(null);setNativeMediaStatus(null);setDraftConsent(false);setError('');};
  const importJsonFile=(file:File)=>{
    const session=captureProjectSession(),sequence=++requests.current.jsonFile;
    if(!native||!session){setError('Open a native project before importing JSON.');return;}
    const picker=jsonFilePicker.current;
    const current=()=>sequence===requests.current.jsonFile&&
      activeKey.current===sessionKey&&isCurrentProjectSession(session);
    readExternalJsonFile(file,{
      current,clearSelection:()=>{if(picker&&picker===jsonFilePicker.current)picker.value='';},
      error:setError,
      accept:contents=>{
        patch(sessionKey,{json:contents,result:'idle',pending:null,
          nativeMediaStatus:null,draftConsent:false,error:''});
        showNotice('JSON loaded from '+file.name+'. Review the content, then select Validate import.');
      }
    });
  };
  const refreshPending=async()=>{if(!native||!window.studio||stage!=='native')return;const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.pending;if(!scope)return;try{const value=await window.studio.pendingMedia(native.project.id);if(!isCurrentProjectSession(scope)||expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.pending||activeKey.current!==sessionKey)return;if(operation==='Author')setPending(value);else setNativeMediaStatus(value);setError('');}catch(reason){if(isCurrentProjectSession(scope)&&expectedStage===stage&&expectedOperation===operation&&sequence===requests.current.pending&&activeKey.current===sessionKey)setError(String(reason));}};
  const validate=async()=>{const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.validate;try{if(!native||!scope||!window.studio||!canImport||scopeDirty)throw new Error('A current FROZEN task is required to validate an import.');const value=operation==='Author'?await window.studio.stageImport(native.project.id,expectedStage,json):await window.studio.stageLifecycle(native.project.id,expectedStage,lifecycleOperation,json);if(!isCurrentProjectSession(scope)||expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.validate||activeKey.current!==sessionKey)return;setPending(value);setNativeMediaStatus(null);setResult('valid');if(expectedStage==='native'&&expectedOperation==='Author'){const current=await window.studio.projectState(scope.projectId);if(activeKey.current===sessionKey&&sequence===requests.current.validate)setNativeIfSessionCurrent(scope,current);}}catch(reason){if(scope&&(!isCurrentProjectSession(scope)||expectedStage!==stage||sequence!==requests.current.validate||activeKey.current!==sessionKey))return;setResult('invalid');setError(reason instanceof Error?reason.message:String(reason));}};
  const primaryImport=async()=>{const scope=captureProjectSession();if(!scope||!window.studio?.importExternalResult||!canImport)return;try{const state=await window.studio.importExternalResult(scope.projectId,stage,operation.toLowerCase(),json);if(!isCurrentProjectSession(scope)||activeKey.current!==sessionKey)return;setNativeIfSessionCurrent(scope,state);setPending(null);setResult('idle');setJson('');showNotice('Imported. '+(state.nextAction?.detail??''));if(state.nextAction?.stage===stage&&state.nextAction.operation)setOperation(operations.find(op=>op.toLowerCase()===state.nextAction!.operation)??operation);else reloadHistory(scope.projectId);}catch(e){if(isCurrentProjectSession(scope)&&activeKey.current===sessionKey){setResult('invalid');setError(String(e));}}};
  const copy=()=>{const scope=captureProjectSession(),expectedStage=stage;if(!scope||!visiblePrompt||scopeDirty)return;void navigator.clipboard.writeText(visiblePrompt).then(()=>{if(isCurrentProjectSession(scope)&&expectedStage===stage&&activeKey.current===sessionKey)showNotice(`${tab} prompt copied.`)}).catch(reason=>{if(isCurrentProjectSession(scope)&&expectedStage===stage&&activeKey.current===sessionKey)setError('Clipboard ERROR: '+String(reason))})};
  const exportFile=async()=>{if(!native||!window.studio||!canImport||scopeDirty)return;const scope=captureProjectSession(),expectedStage=stage,sequence=++requests.current.export;if(!scope)return;try{const file=await window.studio.exportPrompt(native.project.id,expectedStage,operation==='Author'?'author':lifecycleOperation);if(file&&isCurrentProjectSession(scope)&&expectedStage===stage&&sequence===requests.current.export&&activeKey.current===sessionKey)showNotice('Prompt exported: '+file);}catch(reason){if(isCurrentProjectSession(scope)&&expectedStage===stage&&sequence===requests.current.export&&activeKey.current===sessionKey)setError(String(reason));}};
  const taskReadOnly=Boolean(visibleHistory&&(visibleHistory.status!=='FROZEN'||visibleHistory.id!==frozenTaskId));
  const displayedStatus=showingHistory?(visibleHistory?.status??'EMPTY'):(frozenTaskId?'FROZEN':'EMPTY');
  return <div className="grid wide-left"><Card><CardHeader title="External task prompt" hint="Copy to ChatGPT manually · no embedded API" action={<Badge tone={native&&visiblePrompt?'mint':'amber'}>{native?displayedStatus:'EMPTY'}</Badge>}/>{stageTabs}<div className="tabs">{operations.map(item=><button key={item} className={operation===item?'active':''} onClick={()=>setOperation(item)}>{item}</button>)}</div>{staleNativeDraft&&<div className="info error" role="alert" data-testid="stale-native-draft-recovery">A previous Native Author DRAFT belongs to a replaced frozen Author task. The previous pending file and original response are preserved; this DRAFT cannot be Reviewed, Corrected, Confirmed, or mapped to G-Labs. Open Native → Author, use the current frozen task (or Build Task if missing), and import a JSON response bound to its current task ID/revision/input hash. Do not manually edit or delete project files.</div>}{stage==='native'&&operation!=='Author'&&native&&<div className="stack" data-testid="native-lifecycle-target">
      <Field label="Native review target"><Select value={effectiveNativeTarget} onChange={event=>{
        for(const key of ['freeze','validate','confirm','export'] as const)requests.current[key]+=1;
        patch(sessionKey,{nativeTarget:event.target.value as 'DRAFT'|'PUBLISHED',scopeTouched:true});
      }}>
        {native.nativeDraft&&<option value="DRAFT">DRAFT · staged Author candidate (not published)</option>}
        {native.external.native&&<option value="PUBLISHED">PUBLISHED · last confirmed project.json</option>}
      </Select></Field>
      {effectiveNativeTarget==='DRAFT'&&native.nativeDraft?
        <div className="info">{native.nativeDraft.planReport&&native.nativeDraft.planReport.plan!=='PASS'&&<div role="alert">Original plan {native.nativeDraft.planReport.plan}: {native.nativeDraft.planReport.error}. Use independent Review and scoped Correct, or explicitly rebuild Author for structural changes.</div>}DRAFT revision {native.nativeDraft.revision} · SHA {native.nativeDraft.artifactSha256} · Review: {native.nativeDraft.reviewStatus} · Unresolved findings: {native.nativeDraft.unresolvedFindings} · Media fulfillment: {native.nativeDraft.readyForMedia?'REVIEWED — READY':'AVAILABLE AFTER REVIEW (recommended)'}. Original project.json remains unchanged until Native Confirm.</div>:
        <div className="info">PUBLISHED revision {native.external.native?.revision??'none'} · Existing confirmed Native artifact. Creative review does not replace original runtime validation.</div>}
    </div>}<details open={native?.identityPolicy!=='v1'}><summary>Advanced task scope and recovery</summary>{['Review','Recheck'].includes(operation)&&<Field label="Review target IDs (optional; blank covers every section/shot)"><Input value={reviewTargets} onChange={event=>setReviewTargets(event.target.value)} placeholder="shot-001, shot-002"/></Field>}{operation==='Correct'&&<>{suggested?.findingIds.length? <div className="info" data-testid="correct-review-scope">Auto-filled from confirmed Review: {suggested.findingIds.join(', ')}. Editable section/shot scope: {suggested.editableIds.join(', ')}. You may narrow the scope before Build Task.</div>:<div className="info">No unresolved findings from a confirmed review of the current artifact. Build Correct only with an explicit authorized edit scope.</div>}<Field label="Editable section/shot IDs (comma separated)"><Input value={editable} onChange={event=>patch(sessionKey,{editable:event.target.value,
  editableTouched:true,scopeTouched:true})} placeholder="S03, S04"/></Field><Field label="Expanded editable field paths (optional, comma separated)"><Input value={editablePaths} onChange={event=>patch(sessionKey,{editablePaths:event.target.value,
  editablePathsTouched:true,scopeTouched:true})} placeholder="/manifest/opening, /sound_script/2"/></Field></>}{['Correct','Recheck'].includes(operation)&&<Field label="Finding IDs to resolve (optional; defaults to unresolved findings)"><Input value={findingScope} onChange={event=>patch(sessionKey,{findingScope:event.target.value,
  ...autoFindingFields(event.target.value),scopeTouched:true})} placeholder="F-001, F-002"/></Field>}<div className="external-task-toolbar" role="toolbar" aria-label="External task controls"><div className="actions external-task-build-actions"><Button disabled={!native||(staleNativeDraft&&operation!=='Author')} onClick={()=>void buildTask(false)}>Build Task</Button>{hasFrozenReservation&&<Button disabled={!native||(staleNativeDraft&&operation!=='Author')} onClick={()=>void buildTask(true)}>Rebuild Task</Button>}</div></div></details>{stage==='native'&&operation==='Author'&&['NATIVE_REISSUE','NATIVE_RECOVERY'].includes(native?.nextAction?.action??'')&&<Button variant="primary" onClick={()=>void buildTask(true)}>Reissue Native Author for Full Production</Button>}<div className="external-task-toolbar"><div className="actions external-task-export-actions"><Button variant="primary" disabled={!native||!visiblePrompt||scopeDirty} onClick={copy}>Copy prompt</Button><Button disabled={!native||!canImport||!prompt||scopeDirty} onClick={exportFile}>Export .md</Button><Button onClick={()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer')}>Open ChatGPT</Button></div></div>{scopeDirty&&<div className="info error">Draft scope changed. {stage==='native'?'Native target or scope differs from the frozen task.':'Current Script scope differs from the frozen task.'} Copy, export, validate and confirm are blocked until you return to the frozen context or Rebuild Task. Task ID {frozenTaskId}. Rebuild Task invalidates that task and all responses based on it.</div>}{frozenTaskId&&!scopeDirty&&<div className="info">Rebuild Task replaces the frozen task ID and invalidates earlier ChatGPT responses, even if the scope is unchanged.</div>}<pre className="prompt external-task-prompt" data-active-prompt={tab} data-testid="external-task-prompt">{native?visiblePrompt:''}</pre>
    {historyLoading&&<div className="info">Reading saved task history…</div>}
    {historySelectedId&&!selectedHistory&&<div className="info error" role="alert">Selected history task is unavailable. No prompt or confirmed JSON can be displayed.</div>}
    {history.length>1&&<Field label="Saved task history"><select aria-label="Saved task history" value={selectedHistory?.id??''} onChange={event=>patch(sessionKey,{historySelectedId:event.target.value})}>{history.map(item=><option key={item.id} value={item.id}>revision {item.revision} · {item.status} · {item.id.slice(0,8)}</option>)}</select></Field>}
    {taskReadOnly&&<div className="info" data-testid="external-history-status">Saved {displayedStatus} task · read-only history. Build a new task to import a new response.</div>}
    {visibleHistory?.errors.length?<div className="info error" role="alert">History integrity: {visibleHistory.errors.join(', ')}. Missing or unverifiable data is not reconstructed.</div>:null}
    {visibleHistory?.confirmedJson&&<div className="info" data-testid="external-confirmed-history"><strong>Confirmed JSON · read-only</strong><pre className="prompt" aria-label="Confirmed JSON history">{visibleHistory.confirmedJson}</pre></div>}{!native&&<div className="info">EMPTY — Create/open a project to freeze a real ChatGPT task. No sample prompt is available.</div>}{lastReview&&<div className="info"><strong>Saved {lastReview.operation}: {lastReview.reviewStatus??lastReview.status}</strong>{reviewFindings.length?reviewFindings.map(item=><div key={item.id}>{item.id} · {item.severity} · {item.status} · {item.target_ids.join(', ')} · {item.requirement}</div>):<div>{stage==='script'?'No reported findings; corrected Script activation still requires a clean Recheck.':'No reported findings; this does not approve the native film.'}</div>}</div>}</Card>
    <Card>{stage==='script'&&native?.identityPolicy==='v1'&&native.scriptCandidate&&native.approvedScript?.revision!==native.scriptCandidate.revision&&native.nextAction?.action==='SCRIPT_APPROVE'&&window.studio?.approveScript&&<><div className="info">Current Script revision {native.scriptCandidate.revision}</div><Textarea readOnly value={native.scriptCandidate.text}/><Button variant="primary" onClick={async()=>{const scope=captureProjectSession(),c=native.scriptCandidate;if(!scope||!c)return;try{const state=await window.studio!.approveScript!(scope.projectId,{sha256:c.sha256,revision:c.revision,taskId:c.taskId,ownerAuthorized:true});if(isCurrentProjectSession(scope))setNativeIfSessionCurrent(scope,state);}catch(e){if(isCurrentProjectSession(scope))setError(String(e));}}}>Approve exact Script</Button></>}<CardHeader title="Import JSON workspace" hint="Strict schema · diff · explicit confirmation"/><Textarea aria-label="Import JSON" value={json} onChange={event=>change(event.target.value)} placeholder="Paste the returned JSON here…"/><div className="actions"><input ref={jsonFilePicker} type="file" accept=".json,application/json" aria-label="Choose JSON file" hidden onChange={event=>{const file=event.currentTarget.files?.[0];if(file)importJsonFile(file);}}/><Button disabled={!native} onClick={()=>jsonFilePicker.current?.click()}>Import .json</Button><Button disabled={!json} onClick={()=>change('')}>Clear</Button>{native?.identityPolicy==='v1'&&window.studio?.importExternalResult&&!(stage==='native'&&operation==='Correct'&&effectiveNativeTarget==='PUBLISHED')?<Button variant="primary" disabled={!json||!canImport} onClick={()=>void primaryImport()}>Import result</Button>:<Button variant="primary" disabled={!native||!json||!canImport} onClick={validate}>Validate import</Button>}</div>
      {stage==='native'&&operation==='Author'&&native?.identityPolicy==='v1'&&native.nativeDraft&&!pending&&<details><summary>Advanced Native publication recovery</summary><div className="info">Normal Full Production publishes automatically after approval of all media. <Button disabled={!canImport} onClick={refreshPending}>Load staged Native draft</Button></div></details>}
      {result==='valid'&&<div className="info success">Schema valid. Review the staged diff before import.</div>}{result==='invalid'&&<div className="info error" role="alert">Invalid import. {error}</div>}
      {pending&&canImport&&<><div className="diff-grid"><pre className="prompt">BEFORE{`\n`}{JSON.stringify(pending.before,null,2)}</pre><pre className="prompt">AFTER{`\n`}{JSON.stringify(pending.after,null,2)}</pre></div>
        {stage==='native'&&<>{operation==='Author'||operation==='Correct'&&effectiveNativeTarget==='PUBLISHED'&&native?.identityPolicy!=='v1'?
          <><div className="info">Native publication uses original Mode B full validation and all required media.</div>
            <Field label="Owner-selected preview seconds (1–60)"><Input type="number" min={1} max={60} value={previewSeconds} onChange={event=>setPreviewSeconds(Number(event.target.value))}/></Field>
            <div className="info">Full Production requires all assets before publication; preview is a scoped render of the complete project.</div>
            {operation==='Author'&&<><Button onClick={refreshPending}>Refresh missing media after mapping</Button>
              {(nativeMediaStatus??pending).missing?.length?<div className="info">Unresolved native targets: {(nativeMediaStatus??pending).missing.map(item=>item.key+' ('+item.path+')').join(', ')}. Select precise targets in Storyboard.</div>:<div className="info success">No unresolved file targets recorded; original Native CLI still verifies real readiness.</div>}</>}
          </>:
          <div className="info">{effectiveNativeTarget==='DRAFT'?'Pre-publication DRAFT creative review/revision: does not publish project.json or run Native CLI.':'PUBLISHED creative review/verdict: does not run or substitute original Native CLI QA.'} No claim of actual image/audio inspection is made.</div>}
        </>}
        <Button variant="primary" disabled={!canImport||scopeDirty} onClick={async()=>{if(!window.studio||!native||!canImport||scopeDirty)return;const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.confirm;if(!scope)return;try{const state=operation==='Author'?await window.studio.confirmImport(scope.projectId,pending.token,expectedStage==='native'?{previewSeconds,allowSampleDraft:false}:undefined):await window.studio.confirmLifecycle(scope.projectId,pending.token,expectedStage==='native'&&expectedOperation==='Correct'?{previewSeconds,allowSampleDraft:false}:undefined);if(expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.confirm||
            activeKey.current!==sessionKey||!setNativeIfSessionCurrent(scope,state))return;
          setPending(null);setNativeMediaStatus(null);setError('');setJson('');setResult('idle');
          setFrozenTaskId('');setFrozenScopeKey('');setPrompt('');
          reloadHistory(scope.projectId,sessionKey);
          // Correct scope is filled when Correct is opened, not into Review's tab state.
          showNotice(expectedStage==='native'&&operation==='Correct'&&(effectiveNativeTarget==='DRAFT'||native.identityPolicy==='v1')?'Native draft correction saved as a new immutable revision. Recheck before image generation.':operation==='Author'&&expectedStage==='native'?(state.nativeReadiness?.fullReady?'FULL_READY · original native validator PASS.':'Full Production not ready.'):expectedStage==='script'&&operation==='Author'?'Script imported and automatically activated for Voice.':expectedStage==='script'&&operation==='Correct'?'Script correction imported; Recheck is required before automatic activation.':expectedStage==='script'&&operation==='Recheck'?'Script Recheck imported; a clean result automatically activates the corrected Script.':`${tab} ${operation} imported.`);}catch(reason){if(!isCurrentProjectSession(scope)||expectedStage!==stage||sequence!==requests.current.confirm||activeKey.current!==sessionKey)return;setResult('invalid');setError(String(reason));}}}>Confirm reviewed import {operation==='Author'&&stage==='native'?'(original native CLI validation)':''}</Button>
      </>}
      {stage==='script'&&native?.scriptCandidate&&<div className="info">
        <strong>{native.approvedScript?.sha256===native.scriptCandidate.sha256&&JSON.stringify(native.approvedScript.authoring??null)===JSON.stringify(native.scriptCandidate.authoring??null)?'ACTIVE SCRIPT':'PENDING SCRIPT'} revision {native.scriptCandidate.revision}</strong> · {native.approvedScript?.sha256===native.scriptCandidate.sha256&&JSON.stringify(native.approvedScript.authoring??null)===JSON.stringify(native.scriptCandidate.authoring??null)
          ?'Automatically activated for Voice. No separate approval required.'
          :'Correction is awaiting a successful independent Recheck; Voice continues using the last active Script, if any.'}
      </div>}{error&&result!=='invalid'&&<div className="info error" role="alert">{error}</div>}{native?.nativeReadiness&&<div className="info">Current native readiness: {native.nativeReadiness.fullReady?'FULL_READY':native.nativeReadiness.sampleReady?'Historical incomplete publication — recover Full Production':'NOT_READY'} · verified range {native.nativeReadiness.checkedSeconds??'ERROR'}s · latest requested {native.nativeReadiness.previewSeconds}s.</div>}
      {!native&&<div className="info">Open a project to create and import an actual frozen task. No demo import is available.</div>}
    </Card></div>;
}
