/* eslint-disable react-hooks/exhaustive-deps -- project-id/epoch scoped identity reads */
import {useEffect,useRef,useState} from 'react';
import {useAppState} from '../../app/AppState';
import type {IdentityWorkflowStore} from '../../../main/identity/identityWorkflow';

type Snapshot=Awaited<ReturnType<NonNullable<Window['studio']>['identitySnapshot']>>;
type Operation='author'|'review'|'correct'|'recheck';
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
export function IdentityAnalysisPanel(){
  const {native}=useAppState(),id=native?.project.id;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [operation,setOperation]=useState<Operation>('author');
  const [result,setResult]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [impact,setImpact]=useState<Awaited<ReturnType<
    NonNullable<Window['studio']>['identityPreviewUpgrade']>>|null>(null);
  const sequence=useRef(0);
  useEffect(()=>{
    const token=++sequence.current;setSnapshot(null);setResult('');setError('');setImpact(null);
    if(!id||!window.studio?.identitySnapshot)return;
    void window.studio.identitySnapshot(id).then(data=>{
      if(sequence.current===token)setSnapshot(data);
    }).catch(e=>{if(sequence.current===token)setError(errorText(e));});
    return()=>{sequence.current++;};
  },[id]);
  const reload=async(projectId:string,token:number)=>{
    const data=await window.studio!.identitySnapshot(projectId);
    if(token===sequence.current)setSnapshot(data);
  };
  const run=(fn:(projectId:string,revision:number)=>Promise<unknown>)=>{
    if(!id||!snapshot||busy||!window.studio)return;
    const token=sequence.current,revision=snapshot.journal.revision;
    setBusy(true);setError('');
    void fn(id,revision).then(()=>reload(id,token)).catch(e=>{
      if(token===sequence.current)setError(errorText(e));
    }).finally(()=>{if(token===sequence.current)setBusy(false);});
  };
  if(!id)return <section className="card"><h3>Script Analysis</h3>
    <p>Open a project before creating an identity workflow.</p></section>;
  if(!window.studio?.identitySnapshot)return null;
  if(!snapshot)return <section className="card"><h3>Script Analysis</h3>
    <p>{error||'Loading exact project identity journal…'}</p></section>;
  const journal:IdentityWorkflowStore=snapshot.journal;
  if(snapshot.policy==='legacy')return <section className="card" data-testid="identity-legacy">
    <h3>Script Analysis · Legacy project</h3>
    <p>Existing Script/Native, G-Labs jobs and output stay unchanged. Upgrade is explicit and
      makes current output require identity revalidation; it never approves historical images.</p>
    <button type="button" className="button" disabled={busy}
      onClick={()=>{setBusy(true);setError('');
        void window.studio!.identityPreviewUpgrade(id).then(setImpact)
          .catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>
      Preview Upgrade Impact
    </button>
    {impact&&<div className="identity-impact">
      <p>Current Native SHA: {impact.nativeProjectSha??'none'}</p>
      <p>{impact.media.length} historical image records remain unchanged.</p>
      <p>Impact digest: {impact.impactSha256}</p>
      <button type="button" className="button" disabled={busy}
        onClick={()=>{setBusy(true);setError('');const token=sequence.current;
          void window.studio!.identityUpgrade(id,{
            impactSha256:impact.impactSha256,ownerConfirmed:true
          }).then(()=>reload(id,token)).catch(e=>{
            if(token===sequence.current)setError(errorText(e));
          }).finally(()=>{if(token===sequence.current)setBusy(false);});}}>
        Upgrade Identity Workflow (explicit)
      </button>
    </div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
  return <section className="card" data-testid="script-analysis-identity-workspace">
    <h3>Script Analysis · External ChatGPT</h3>
    <p>Source-grounded; identity records are extracted from the exact approved Script,
      not created in Storyboard. No LLM API or automatic image generation.</p>
    <p>Source readiness: <strong>{snapshot.readiness}</strong> · journal revision {journal.revision}</p>
    <div className="actions" role="group" aria-label="Script Analysis operation">
      {(['author','review','correct','recheck'] as const).map(item=>
        <button type="button" className={'button '+(operation===item?'primary':'')}
          key={item} aria-pressed={operation===item} onClick={()=>setOperation(item)}>
          {item[0].toUpperCase()+item.slice(1)}
        </button>)}
    </div>
    <div className="actions">
      <button type="button" className="button" disabled={busy}
        onClick={()=>run((project,revision)=>window.studio!.identityFreeze(project,operation,revision))}>
        Build frozen {operation} task
      </button>
      <button type="button" className="button" disabled={!journal.currentTask}
        onClick={()=>void navigator.clipboard.writeText(journal.currentTask?.task.prompt??'')}>
        Copy frozen prompt
      </button>
    </div>
    {journal.currentTask&&<><p>Task {journal.currentTask.task.task_id} ·
      {' '}{journal.currentTask.status} · {journal.currentTask.task.operation}</p>
      <pre className="prompt external-task-prompt" aria-label="Frozen Script Analysis prompt">
        {journal.currentTask.task.prompt}
      </pre></>}
    <label className="field">External ChatGPT JSON result
      <textarea className="textarea" aria-label="Script Analysis JSON result"
        rows={8} value={result} onChange={e=>setResult(e.target.value)}/>
    </label>
    <div className="actions">
      <button type="button" className="button" disabled={!result.trim()||busy||
        journal.currentTask?.status!=='FROZEN'}
        onClick={()=>run(async(project,revision)=>{
          await window.studio!.identityImport(project,result,revision);
          setResult('');
        })}>Import frozen response</button>
      <button type="button" className="button" disabled={busy||
        !journal.independentReview?.approved||journal.currentTask?.status!=='IMPORTED'}
        onClick={()=>run((project,revision)=>window.studio!.identityApproveAnalysis(project,revision))}>
        Approve reviewed analysis
      </button>
    </div>
    {journal.draftAnalysis&&<div className="identity-catalog">
      <strong>Source-grounded characters</strong>
      {journal.draftAnalysis.continuity_catalog.characters.length===0?
        <p>Valid empty catalog: the approved narration has no established recurring actors.</p>:
        journal.draftAnalysis.continuity_catalog.characters.map(c=>
          <div key={c.char_id}><strong>{c.char_id}</strong> · {c.label} ·
            {' '}{c.occurrences.length} verified source occurrence(s)</div>)}
    </div>}
    {journal.independentReview&&<p>Independent review: {journal.independentReview.approved?'approved':'findings unresolved'} ·
      {' '}{journal.independentReview.findings.length} finding(s)</p>}
    {journal.analysisApproved&&<p>Approved analysis SHA {journal.analysisApproved.sha256}</p>}
    {error&&<p className="info error" role="alert">{error}</p>}
  </section>;
}
