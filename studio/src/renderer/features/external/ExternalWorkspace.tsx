/* eslint-disable react-hooks/exhaustive-deps -- session scopes are ref-backed; project/stage scalars define invalidation */
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Textarea } from '../../components/ui';
const tabs = ['Script', 'Native'] as const; type PromptTab = (typeof tabs)[number]; type SyntaxResult = 'idle' | 'valid' | 'invalid';
const operations=['Author','Review','Correct','Recheck','Media review'] as const;type Operation=(typeof operations)[number];
interface ExternalSession { tab: PromptTab; setTab: Dispatch<SetStateAction<PromptTab>>; json: string; setJson: Dispatch<SetStateAction<string>>; result: SyntaxResult; setResult: Dispatch<SetStateAction<SyntaxResult>> }
const Context = createContext<ExternalSession | null>(null);
export function ExternalSessionProvider({ children }: { children: ReactNode }) { const [tab,setTab]=useState<PromptTab>('Script'); const [json,setJson]=useState(''); const [result,setResult]=useState<SyntaxResult>('idle'); return <Context.Provider value={{tab,setTab,json,setJson,result,setResult}}>{children}</Context.Provider>; }
const useSession=()=>{const value=useContext(Context);if(!value)throw new Error('ExternalSessionProvider missing');return value;};
export function ExternalWorkspace(){
  const {tab,setTab,json,setJson,result,setResult}=useSession(); const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState(); const [prompt,setPrompt]=useState(''); const [pending,setPending]=useState<StudioStagedImport|null>(null);const [nativeMediaStatus,setNativeMediaStatus]=useState<StudioStagedImport|null>(null); const [error,setError]=useState('');const [previewSeconds,setPreviewSeconds]=useState(20);const [draftConsent,setDraftConsent]=useState(false);const [operation,setOperation]=useState<Operation>('Author');const [reviewTargets,setReviewTargets]=useState('');const [editable,setEditable]=useState('');const [editablePaths,setEditablePaths]=useState('');const [findingScope,setFindingScope]=useState('');const [reviewMediaKind,setReviewMediaKind]=useState<'preview'|'film'|'voice'|'captions'>('preview');const [reviewFolder,setReviewFolder]=useState('');const [transferAcknowledged,setTransferAcknowledged]=useState(false);const [frozenScopeKey,setFrozenScopeKey]=useState('');const [frozenTaskId,setFrozenTaskId]=useState(''); const stage=tab.toLowerCase();const lifecycleOperation=operation.toLowerCase().replace(' ','-') as 'review'|'correct'|'recheck'|'media-review';const requests=useRef({freeze:0,validate:0,pending:0,confirm:0,export:0,jsonFile:0});const jsonFilePicker=useRef<HTMLInputElement|null>(null);const splitList=(value:string)=>value.split(',').map(x=>x.trim()).filter(Boolean);const lifecycleScope=()=>({targetIds:splitList(reviewTargets),editableIds:splitList(editable),editablePaths:splitList(editablePaths),findingIds:findingScope.trim()?splitList(findingScope):undefined,media:operation==='Media review'?reviewMediaKind:undefined,transferAcknowledged:operation==='Media review'?transferAcknowledged:undefined});const reviews=Object.values(native?.lifecycle?.artifacts??{}).filter(item=>item.stage===stage&&['review','recheck','media-review'].includes(item.operation)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const lastReview=reviews[0];const reviewFindings=((lastReview?.value??{}) as {findings?:Array<{id:string;severity:string;status:string;target_ids:string[];requirement:string}>}).findings??[];
  const projectId=native?.project.id;useEffect(()=>{setEditable('');setEditablePaths('');setFindingScope('');setJson('');setResult('idle');setPending(null);setNativeMediaStatus(null);setPrompt('');setFrozenTaskId('');setFrozenScopeKey('');setError('');setReviewFolder('');setTransferAcknowledged(false);setDraftConsent(false);},[projectId,setJson,setResult]);
  useEffect(()=>{setJson('');setResult('idle');setPending(null);setNativeMediaStatus(null);setPrompt('');setFrozenTaskId('');setFrozenScopeKey('');setError('');setReviewFolder('');setReviewMediaKind(stage==='script'?'voice':'preview');setTransferAcknowledged(false);setDraftConsent(false);},[stage,operation,setJson,setResult]);
  useEffect(()=>{requests.current.validate+=1;requests.current.pending+=1;requests.current.confirm+=1;requests.current.export+=1;requests.current.jsonFile+=1;},[projectId,stage,operation]);
  // Restore the exact actionable scope from the latest confirmed review on project
  // reopen or when the user opens Correct. Never overwrite an existing frozen task.
  const suggested=native?.suggestedCorrectScope?.[stage as 'script'|'native'];
  useEffect(()=>{
    if(operation!=='Correct'||frozenTaskId)return;
    setEditable((suggested?.editableIds??[]).join(', '));
    setFindingScope((suggested?.findingIds??[]).join(', '));
    setEditablePaths('');
  },[projectId,stage,operation,suggested?.reviewTaskId]);
  const scopeKey=()=>JSON.stringify(lifecycleScope());
  const scopeDirty=Boolean(frozenTaskId&&operation!=='Author'&&scopeKey()!==frozenScopeKey);
  // Reading a saved reservation is side-effect free. Neither typing nor rerenders
  // can replace a task that was already exported to External ChatGPT.
  useEffect(()=>{const session=captureProjectSession(),expectedStage=stage,expectedOperation=operation;
    const sequence=++requests.current.freeze;let active=true;
    setPrompt('');setFrozenTaskId('');setFrozenScopeKey('');
    if(native&&session&&window.studio?.readFrozen){
      window.studio.readFrozen(session.projectId,expectedStage,operation==='Author'?'author':lifecycleOperation)
        .then(task=>{if(!active||sequence!==requests.current.freeze||!isCurrentProjectSession(session))return;
          if(!task){setPrompt('');return;}
          setPrompt(task.prompt);setFrozenTaskId(task.id);
          if(expectedOperation!=='Author'){
            const fields={targetIds:task.targetIds??[],editableIds:task.editableIds??[],
              editablePaths:task.editablePaths??[],findingIds:task.findingIds?.length?task.findingIds:undefined,
              media:expectedOperation==='Media review'?(task.mediaKind??reviewMediaKind):undefined,
              transferAcknowledged:expectedOperation==='Media review'?Boolean(task.mediaTransferAttested):undefined};
            setReviewTargets(fields.targetIds.join(', '));setEditable(fields.editableIds.join(', '));
            setEditablePaths(fields.editablePaths.join(', '));setFindingScope((fields.findingIds??[]).join(', '));
            if(task.mediaKind)setReviewMediaKind(task.mediaKind);setTransferAcknowledged(Boolean(task.mediaTransferAttested));
            setFrozenScopeKey(JSON.stringify(fields));
          }
        }).catch(reason=>{if(active&&sequence===requests.current.freeze&&isCurrentProjectSession(session))setError(String(reason));});
    }
    return()=>{active=false};
  },[projectId,stage,operation]);
  const buildTask=async(forceRebuild=false)=>{
    if(!native||!window.studio)return;
    const session=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.freeze;
    if(!session)return;
    const snapshot=lifecycleScope(),key=JSON.stringify(snapshot);
    const rebuild=Boolean(forceRebuild||(frozenTaskId&&scopeDirty));
    try{
      const task=expectedOperation==='Author'?
        await window.studio.freezeTask(session.projectId,expectedStage,rebuild):
        await window.studio.freezeLifecycle(session.projectId,expectedStage,lifecycleOperation,snapshot,rebuild);
      if(sequence!==requests.current.freeze||!isCurrentProjectSession(session)||expectedStage!==stage||expectedOperation!==operation)return;
      setPrompt(task.prompt);setFrozenTaskId(task.id);setFrozenScopeKey(key);
      setPending(null);setNativeMediaStatus(null);setResult('idle');setJson('');setError('');
      showNotice(rebuild?'Task rebuilt. Previous exported responses are now stale.':'Frozen task ready to export.');
    }catch(reason){if(sequence===requests.current.freeze&&isCurrentProjectSession(session))setError(String(reason));}
  };
  const change=(value:string)=>{requests.current.jsonFile+=1;setJson(value);setResult('idle');setPending(null);setNativeMediaStatus(null);setDraftConsent(false);setError('');};
  const importJsonFile=(file:File)=>{
    const session=captureProjectSession(),sequence=++requests.current.jsonFile;
    if(!native||!session){setError('Open a native project before importing JSON.');return;}
    if(!/\.json$/i.test(file.name)){setError('Choose a .json file.');return;}
    const reader=new FileReader();
    reader.onload=()=>{
      if(sequence!==requests.current.jsonFile||!isCurrentProjectSession(session))return;
      if(typeof reader.result!=='string'){setError('Unable to read the selected JSON file.');return;}
      try{JSON.parse(reader.result)}catch{setError('Selected file is not valid JSON.');return;}
      change(reader.result);
      showNotice('JSON loaded from '+file.name+'. Review the content, then select Validate import.');
    };
    reader.onerror=()=>{if(sequence===requests.current.jsonFile&&isCurrentProjectSession(session))setError('Unable to read the selected JSON file.');};
    reader.readAsText(file);
  };
  const refreshPending=async()=>{if(!native||!window.studio||stage!=='native')return;const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.pending;if(!scope)return;try{const value=await window.studio.pendingMedia(native.project.id);if(!isCurrentProjectSession(scope)||expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.pending)return;if(operation==='Author')setPending(value);else setNativeMediaStatus(value);setError('');}catch(reason){if(isCurrentProjectSession(scope)&&expectedStage===stage&&expectedOperation===operation&&sequence===requests.current.pending)setError(String(reason));}};
  const validate=async()=>{const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.validate;try{if(!native||!scope||!window.studio)throw new Error('Open a native project first.');const value=operation==='Author'?await window.studio.stageImport(native.project.id,expectedStage,json):await window.studio.stageLifecycle(native.project.id,expectedStage,lifecycleOperation,json);if(!isCurrentProjectSession(scope)||expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.validate)return;setPending(value);setNativeMediaStatus(null);setResult('valid');}catch(reason){if(scope&&(!isCurrentProjectSession(scope)||expectedStage!==stage||sequence!==requests.current.validate))return;setResult('invalid');setError(reason instanceof Error?reason.message:String(reason));}};
  const copy=()=>{const scope=captureProjectSession(),expectedStage=stage;if(!scope)return;void navigator.clipboard.writeText(prompt).then(()=>{if(isCurrentProjectSession(scope)&&expectedStage===stage)showNotice(`${tab} prompt copied.`)}).catch(reason=>{if(isCurrentProjectSession(scope)&&expectedStage===stage)setError('Clipboard ERROR: '+String(reason))})};
  const exportFile=async()=>{if(!native||!window.studio)return;const scope=captureProjectSession(),expectedStage=stage,sequence=++requests.current.export;if(!scope)return;try{const file=await window.studio.exportPrompt(native.project.id,expectedStage,operation==='Author'?'author':lifecycleOperation);if(file&&isCurrentProjectSession(scope)&&expectedStage===stage&&sequence===requests.current.export)showNotice('Prompt exported: '+file);}catch(reason){if(isCurrentProjectSession(scope)&&expectedStage===stage&&sequence===requests.current.export)setError(String(reason));}};
  const exportMediaPack=async()=>{if(!native||!window.studio)return;const scope=captureProjectSession();if(!scope)return;try{const kind=reviewMediaKind;const value=await window.studio.reviewPack(scope.projectId,kind);if(isCurrentProjectSession(scope))setReviewFolder(value.folder??value.path);}catch(reason){if(isCurrentProjectSession(scope))setError(String(reason));}};
  return <div className="grid wide-left"><Card><CardHeader title="External task prompt" hint="Copy to ChatGPT manually · no embedded API" action={<Badge tone={native&&prompt?'mint':'amber'}>{native&&prompt?'FROZEN':'EMPTY'}</Badge>}/><div className="tabs">{tabs.map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</div><div className="tabs">{operations.map(item=><button key={item} className={operation===item?'active':''} onClick={()=>setOperation(item)}>{item}</button>)}</div>{['Review','Recheck','Media review'].includes(operation)&&<Field label="Review target IDs (optional; blank covers every section/shot)"><Input value={reviewTargets} onChange={event=>setReviewTargets(event.target.value)} placeholder="shot-001, shot-002"/></Field>}{operation==='Correct'&&<>{suggested?.findingIds.length? <div className="info" data-testid="correct-review-scope">Auto-filled from confirmed Review: {suggested.findingIds.join(', ')}. Editable section/shot scope: {suggested.editableIds.join(', ')}. You may narrow the scope before Build Task.</div>:<div className="info">No unresolved findings from a confirmed review of the current artifact. Build Correct only with an explicit authorized edit scope.</div>}<Field label="Editable section/shot IDs (comma separated)"><Input value={editable} onChange={event=>setEditable(event.target.value)} placeholder="S03, S04"/></Field><Field label="Expanded editable field paths (optional, comma separated)"><Input value={editablePaths} onChange={event=>setEditablePaths(event.target.value)} placeholder="/manifest/opening, /sound_script/2"/></Field></>}{['Correct','Recheck'].includes(operation)&&<Field label="Finding IDs to resolve (optional; defaults to unresolved findings)"><Input value={findingScope} onChange={event=>setFindingScope(event.target.value)} placeholder="F-001, F-002"/></Field>}<div className="external-task-toolbar" role="toolbar" aria-label="External task controls"><div className="actions external-task-build-actions"><Button disabled={!native} onClick={()=>void buildTask(false)}>{scopeDirty?'Rebuild Task':'Build Task'}</Button>{frozenTaskId&&!scopeDirty&&<Button disabled={!native} onClick={()=>void buildTask(true)}>Rebuild Task</Button>}</div><div className="actions external-task-export-actions"><Button variant="primary" disabled={!native||!prompt} onClick={copy}>Copy prompt</Button><Button disabled={!native||!prompt} onClick={exportFile}>Export .md</Button><Button onClick={()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer')}>Open ChatGPT</Button></div></div>{scopeDirty&&<div className="info error">Draft scope changed. The displayed prompt still belongs to the previous frozen scope and task ID {frozenTaskId}. Rebuild Task invalidates that task and all responses based on it.</div>}{frozenTaskId&&!scopeDirty&&<div className="info">Rebuild Task replaces the frozen task ID and invalidates earlier ChatGPT responses, even if the scope is unchanged.</div>}<pre className="prompt external-task-prompt" data-active-prompt={tab} data-testid="external-task-prompt">{native?prompt:''}</pre>{!native&&<div className="info">EMPTY — Create/open a project to freeze a real ChatGPT task. No sample prompt is available.</div>}{operation==='Media review'&&<div className="actions external-task-media-actions"><Field label="Review media scope"><select value={reviewMediaKind} onChange={event=>{setReviewMediaKind(event.target.value as 'preview'|'film'|'voice'|'captions');setReviewFolder('');setTransferAcknowledged(false);}}>{stage==='native'?<><option value="preview">Actual preview</option><option value="film">Encoded full film</option></>:<><option value="voice">Accepted narration WAV</option><option value="captions">Accepted captions</option></>}</select></Field><Button disabled={!native} onClick={exportMediaPack}>Export actual media pack</Button><label className="check"><input type="checkbox" checked={transferAcknowledged} onChange={event=>setTransferAcknowledged(event.target.checked)}/> I manually transferred this project's actual MP4/WAV and review JSON to External ChatGPT. This attestation is not proof the model inspected them.</label></div>}{reviewFolder&&<div className="info">Transfer the actual files in {reviewFolder} together with review-package.json. Local files and hashes alone do not establish audiovisual inspection.</div>}{lastReview&&<div className="info"><strong>Latest {lastReview.operation}: {lastReview.status}</strong>{reviewFindings.length?reviewFindings.map(item=><div key={item.id}>{item.id} · {item.severity} · {item.status} · {item.target_ids.join(', ')} · {item.requirement}</div>):<div>{stage==='script'?'No reported findings; corrected Script activation still requires a clean Recheck.':'No reported findings; this does not approve the native film.'}</div>}</div>}</Card>
    <Card><CardHeader title="Import JSON workspace" hint="Strict schema · diff · explicit confirmation"/><Textarea aria-label="Import JSON" value={json} onChange={event=>change(event.target.value)} placeholder="Paste the returned JSON here…"/><div className="actions"><input ref={jsonFilePicker} type="file" accept=".json,application/json" aria-label="Choose JSON file" hidden onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)importJsonFile(file);}}/><Button disabled={!native} onClick={()=>jsonFilePicker.current?.click()}>Import .json</Button><Button disabled={!json} onClick={()=>change('')}>Clear</Button><Button variant="primary" disabled={!native||!json} onClick={validate}>Validate import</Button></div>
      {result==='valid'&&<div className="info success">Schema valid. Review the staged diff before import.</div>}{result==='invalid'&&<div className="info error" role="alert">Invalid import. {error}</div>}
      {pending&&<><div className="diff-grid"><pre className="prompt">BEFORE{`\n`}{JSON.stringify(pending.before,null,2)}</pre><pre className="prompt">AFTER{`\n`}{JSON.stringify(pending.after,null,2)}</pre></div>
        {stage==='native'&&<><div className="info">Original Mode B validates the selected sample with --seconds N. FULL_READY requires separate unscoped native validation. Media outside the scoped sample may remain incomplete only for an explicitly approved draft.</div>
          <Field label="Owner-selected preview seconds (1–60)"><Input type="number" min={1} max={60} value={previewSeconds} onChange={event=>setPreviewSeconds(Number(event.target.value))}/></Field>
          <label className="check"><input type="checkbox" checked={draftConsent} onChange={event=>setDraftConsent(event.target.checked)}/> I explicitly authorize an incomplete SAMPLE_READY draft, not full-film readiness.</label>
          <Button onClick={refreshPending}>Refresh missing media after mapping</Button>
          {(nativeMediaStatus??pending).missing?.length? <div className="info">Unresolved native targets: {(nativeMediaStatus??pending).missing.map(item=>item.key+' ('+item.path+')').join(', ')}. Select each precise target in Storyboard; only in-scope missing media blocks the sample.</div>:<div className="info success">No unresolved file targets recorded; the original scoped/full CLI will still verify native integrity.</div>}
        </>}
        <Button variant="primary" onClick={async()=>{if(!window.studio||!native)return;const scope=captureProjectSession(),expectedStage=stage,expectedOperation=operation,sequence=++requests.current.confirm;if(!scope)return;try{const state=operation==='Author'?await window.studio.confirmImport(scope.projectId,pending.token,expectedStage==='native'?{previewSeconds,allowSampleDraft:draftConsent}:undefined):await window.studio.confirmLifecycle(scope.projectId,pending.token,expectedStage==='native'&&expectedOperation==='Correct'?{previewSeconds,allowSampleDraft:draftConsent}:undefined);if(expectedStage!==stage||expectedOperation!==operation||sequence!==requests.current.confirm||!setNativeIfSessionCurrent(scope,state))return;setPending(null);setNativeMediaStatus(null);setError('');
          if(expectedOperation==='Review'){
            const next=state.suggestedCorrectScope?.[expectedStage as 'script'|'native'];
            setEditable((next?.editableIds??[]).join(', '));
            setFindingScope((next?.findingIds??[]).join(', '));
            setEditablePaths('');
          }
          showNotice(operation==='Author'&&expectedStage==='native'?(state.nativeReadiness?.fullReady?'FULL_READY · original native validator PASS.':'SAMPLE_READY draft · not full render ready.'):expectedStage==='script'&&operation==='Author'?'Script imported and automatically activated for Voice.':expectedStage==='script'&&operation==='Correct'?'Script correction imported; Recheck is required before automatic activation.':expectedStage==='script'&&operation==='Recheck'?'Script Recheck imported; a clean result automatically activates the corrected Script.':`${tab} ${operation} imported.`);}catch(reason){if(!isCurrentProjectSession(scope)||expectedStage!==stage||sequence!==requests.current.confirm)return;setResult('invalid');setError(String(reason));}}}>Confirm reviewed import {operation==='Author'&&stage==='native'?'(original native CLI validation)':''}</Button>
      </>}
      {stage==='script'&&native?.scriptCandidate&&<div className="info">
        <strong>{native.approvedScript?.sha256===native.scriptCandidate.sha256&&JSON.stringify(native.approvedScript.authoring??null)===JSON.stringify(native.scriptCandidate.authoring??null)?'ACTIVE SCRIPT':'PENDING SCRIPT'} revision {native.scriptCandidate.revision}</strong> · {native.approvedScript?.sha256===native.scriptCandidate.sha256&&JSON.stringify(native.approvedScript.authoring??null)===JSON.stringify(native.scriptCandidate.authoring??null)
          ?'Automatically activated for Voice. No separate approval required.'
          :'Correction is awaiting a successful independent Recheck; Voice continues using the last active Script, if any.'}
      </div>}{error&&result!=='invalid'&&<div className="info error" role="alert">{error}</div>}{native?.nativeReadiness&&<div className="info">Current native readiness: {native.nativeReadiness.fullReady?'FULL_READY':native.nativeReadiness.sampleReady?'SAMPLE_READY draft':'NOT_READY'} · verified range {native.nativeReadiness.checkedSeconds??'ERROR'}s · latest requested {native.nativeReadiness.previewSeconds}s.</div>}
      {!native&&<div className="info">Open a project to create and import an actual frozen task. No demo import is available.</div>}
    </Card></div>;
}
