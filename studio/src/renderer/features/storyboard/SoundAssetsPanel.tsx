import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Button,Card,CardHeader,Field,Input,Select} from '../../components/ui';
type Inventory=Awaited<ReturnType<NonNullable<Window['studio']>['soundInventory']>>;
export function SoundAssetsPanel({revision,refreshKey,onBound}:{revision:string;refreshKey:number;onBound:()=>void}){
  const {native,captureProjectSession,isCurrentProjectSession}=useAppState(),id=native?.project.id;
  const [inventory,setInventory]=useState<Inventory|null>(null),[selected,setSelected]=useState<Record<string,string>>({}),[rights,setRights]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let alive=true;const scope=captureProjectSession();setSelected({});setInventory(null);setError('');if(!scope||!revision||!window.studio?.soundInventory)return()=>{alive=false};void window.studio.soundInventory(scope.projectId).then(v=>{if(alive&&isCurrentProjectSession(scope))setInventory(v)}).catch(e=>{if(alive&&isCurrentProjectSession(scope))setError(String(e))});return()=>{alive=false};},[id,revision,refreshKey,captureProjectSession,isCurrentProjectSession]);
  const importFile=async(key:string)=>{
    const scope=captureProjectSession(),studio=window.studio;if(!scope||!studio||!rights.trim())return;
    setBusy(true);setError('');
    try{const file=await studio.importMedia(scope.projectId,{kind:'sfx',rights:rights.trim()});if(!file||!isCurrentProjectSession(scope))return;const fresh=await studio.soundInventory(scope.projectId);if(!isCurrentProjectSession(scope)||fresh.candidateSha!==revision)return;setInventory(fresh);setSelected(s=>({...s,[key]:file.path}));}
    catch(e){if(isCurrentProjectSession(scope))setError(String(e));}finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const importBatch=async()=>{const scope=captureProjectSession(),studio=window.studio;if(!scope||!studio?.soundImportBatch||!inventory||!rights.trim())return;setBusy(true);setError('');try{const result=await studio.soundImportBatch(scope.projectId,{token:inventory.token,candidateSha:inventory.candidateSha,rights:rights.trim(),ownerAuthorized:true});if(!result||!isCurrentProjectSession(scope))return;setInventory(result.inventory);setError(result.results.filter(r=>r.status==='FAILED').map(r=>r.file+': '+r.detail).join(' | '));}catch(e){if(isCurrentProjectSession(scope))setError(String(e));}finally{if(isCurrentProjectSession(scope))setBusy(false);}};
  if(!revision)return null;
  const ready=inventory?.cues.flatMap(c=>{if(c.status!=='MISSING')return[];const source=inventory.sources.find(s=>s.path===(selected[c.key]??c.exactSource?.path)&&(!c.cue?.reuse||s.sha256===c.cue.reuse.sha256));return source?[{key:c.key,...source}]:[]})??[];
  const bind=async()=>{
    const scope=captureProjectSession(),studio=window.studio;if(!scope||!studio||!inventory||!ready.length)return;
    setBusy(true);setError('');
    try{const result=await studio.soundBindBatch(scope.projectId,{token:inventory.token,candidateSha:inventory.candidateSha,ownerAuthorized:true,items:ready});if(!isCurrentProjectSession(scope))return;setInventory(result.inventory);setError(result.results.filter(r=>r.status==='FAILED').map(r=>r.key+': '+r.detail).join(' | '));onBound();}
    catch(e){if(isCurrentProjectSession(scope))setError(String(e));}finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  return <Card><CardHeader title="Sound assets" hint="Original Native tracks · exact local sources"/>{error&&<div role="alert" className="info error">{error}</div>}{!inventory?<div className="info">Sound inventory loading or unavailable.</div>:<>
    <Field label="Source rights for newly imported audio"><Input value={rights} onChange={e=>setRights(e.target.value)} placeholder="Owner recording / licensed local source"/></Field>
    <Button disabled={busy||!rights.trim()||!window.studio?.soundImportBatch} onClick={()=>void importBatch()}>Import local audio files</Button>
    {inventory.cues.map(c=><div className="info" key={c.key}><strong>{c.cue?.cue_id??c.key} · {c.status}</strong><div>{c.cue?.source_requirement??c.path??c.sourceKind}</div><details><summary>Track diagnostics</summary><div>{JSON.stringify(c.entry)}</div></details>{c.status==='MISSING'&&<div className="actions"><Select value={selected[c.key]??c.exactSource?.path??''} onChange={e=>setSelected(s=>({...s,[c.key]:e.target.value}))}><option value="">Select registered audio</option>{inventory.sources.filter(s=>!c.cue?.reuse||s.path===c.cue.reuse.path&&s.sha256===c.cue.reuse.sha256).map(s=><option key={s.path} value={s.path}>{s.path}</option>)}</Select><details><summary>Advanced single import</summary><Button disabled={busy||!rights.trim()||!!c.cue?.reuse} onClick={()=>void importFile(c.key)}>Import source</Button></details></div>}</div>)}
    <Button variant="primary" disabled={busy||!ready.length} onClick={()=>void bind()}>Approve &amp; bind selected sound assets ({ready.length})</Button>
  </>}</Card>;
}
