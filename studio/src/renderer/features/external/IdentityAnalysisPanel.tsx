/* eslint-disable react-hooks/exhaustive-deps -- project epoch and request tokens guard asynchronous identity reads */
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Textarea} from '../../components/ui';
import type {IdentityWorkflowStore} from '../../../main/identity/identityWorkflow';
import {readExternalJsonFile} from './readExternalJsonFile';

type Snapshot=Awaited<ReturnType<NonNullable<Window['studio']>['identitySnapshot']>>;
type Operation='author'|'review'|'correct'|'recheck';
type Task=NonNullable<IdentityWorkflowStore['currentTask']>;
type Draft={json:string;error:string;task:Task|null};
const emptyDraft:Draft={json:'',error:'',task:null};
const operations=['author','review','correct','recheck'] as const;
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const keyFor=(id:string,operation:Operation)=>JSON.stringify([id,'script_analysis',operation]);
export function IdentityAnalysisPanel({active=true,stageTabs}:{active?:boolean;stageTabs?:ReactNode}){
  const {native,captureProjectSession,isCurrentProjectSession,showNotice}=useAppState(),id=native?.project.id;
  const epoch=captureProjectSession()?.epoch;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [operation,setOperation]=useState<Operation>('author');
  const [drafts,setDrafts]=useState<Record<string,Draft>>({});
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('');
  const [impact,setImpact]=useState<Awaited<ReturnType<
    NonNullable<Window['studio']>['identityPreviewUpgrade']>>|null>(null);
  const sequence=useRef(0),fileSequence=useRef(0),busyRef=useRef(false);
  const picker=useRef<HTMLInputElement|null>(null);
  const key=keyFor(id??'none',operation);
  const activeKey=useRef('');
  const draft=drafts[key]??emptyDraft;
  const patch=(target:string,changes:Partial<Draft>)=>setDrafts(prev=>({
    ...prev,[target]:{...(prev[target]??emptyDraft),...changes}
  }));
  const remember=(projectId:string,journal:IdentityWorkflowStore)=>{
    const entry=journal.currentTask;
    if(entry){patch(keyFor(projectId,entry.task.operation),{task:entry});if(entry.status==='FROZEN')setOperation(entry.task.operation);}
  };
  useLayoutEffect(()=>{
    sequence.current++;busyRef.current=false;setBusy(false);setSnapshot(null);
    setLoading(false);setLoadError('');setImpact(null);
    return()=>{sequence.current++;};
  },[id,epoch]);
  useLayoutEffect(()=>{
    activeKey.current=active?key:'';
    fileSequence.current++;
    if(picker.current)picker.current.value='';
    return()=>{activeKey.current='';fileSequence.current++;};
  },[active,key,epoch]);
  useEffect(()=>{
    const scope=captureProjectSession();
    if(!active||!scope||!window.studio?.identitySnapshot||busyRef.current)return;
    const token=++sequence.current;
    const current=()=>token===sequence.current&&isCurrentProjectSession(scope);
    setLoading(true);setLoadError('');
    void window.studio.identitySnapshot(scope.projectId).then(data=>{
      if(!current())return;
      setSnapshot(data);remember(scope.projectId,data.journal);
    }).catch(e=>{if(current()){setSnapshot(null);setLoadError(errorText(e));}})
      .finally(()=>{if(current())setLoading(false);});
  },[active,id,epoch]);
  const run=(fn:(projectId:string,revision:number)=>Promise<unknown>,after?:()=>void)=>{
    const scope=captureProjectSession();
    if(!active||!id||!scope||!snapshot||loading||busyRef.current||!window.studio)return;
    const token=++sequence.current,revision=snapshot.journal.revision;
    const current=()=>token===sequence.current&&isCurrentProjectSession(scope);
    busyRef.current=true;setBusy(true);patch(key,{error:''});setLoadError('');
    fileSequence.current++;
    void (async()=>{
      try{
        await fn(scope.projectId,revision);
        if(!current())return;
        after?.();
        try{
          const data=await window.studio!.identitySnapshot(scope.projectId);
          if(current()){setSnapshot(data);remember(scope.projectId,data.journal);}
        }catch(e){
          if(current()){setSnapshot(null);setLoadError(errorText(e));}
        }
      }catch(e){if(current())patch(key,{error:errorText(e)});}
      finally{if(current()){busyRef.current=false;setBusy(false);setLoading(false);}}
    })();
  };
  const change=(value:string)=>{fileSequence.current++;patch(key,{json:value,error:''});};
  const importFile=(file:File)=>{
    const scope=captureProjectSession(),token=++fileSequence.current,selected=picker.current;
    if(!scope||!id)return;
    const current=()=>token===fileSequence.current&&activeKey.current===key&&isCurrentProjectSession(scope);
    readExternalJsonFile(file,{
      current,clearSelection:()=>{if(selected&&selected===picker.current)selected.value='';},
      error:message=>patch(key,{error:message}),
      accept:json=>{
        patch(key,{json,error:''});
        showNotice('JSON loaded from '+file.name+'. Review it, then select Import frozen response.');
      }
    });
  };
  if(!active)return null;
  const journal=snapshot?.journal;
  const currentTask=journal?.currentTask;
  const selectedCurrent=currentTask?.task.operation===operation?currentTask:null;
  const entry=selectedCurrent??draft.task;
  const ready=Boolean(id&&snapshot&&!loading&&!busy&&snapshot.policy!=='legacy');
  const isFrozen=selectedCurrent?.status==='FROZEN';
  const canRebuild=Boolean(isFrozen&&(operation==='author'||operation==='review'));
  const canApprove=Boolean(ready&&selectedCurrent?.status==='IMPORTED'&&
    (operation==='review'||operation==='recheck')&&journal?.independentReview?.approved&&!journal.analysisApproved);
  const build=(rebuild:boolean)=>{
    if(!ready)return;
    if(isFrozen&&!rebuild){showNotice('Current frozen task retained.');return;}
    if(rebuild&&!canRebuild)return;
    run((project,revision)=>window.studio!.identityFreeze(project,operation,revision),
      ()=>patch(key,{json:'',error:''}));
  };
  const copy=()=>{
    if(!entry||!entry.task.prompt)return;
    const scope=captureProjectSession(),prompt=entry.task.prompt;
    void navigator.clipboard.writeText(prompt).then(()=>{
      if(scope&&activeKey.current===key&&isCurrentProjectSession(scope))showNotice('Script Analysis prompt copied.');
    }).catch(e=>{
      if(scope&&activeKey.current===key&&isCurrentProjectSession(scope))patch(key,{error:errorText(e)});
    });
  };
  const exportPrompt=()=>{
    if(!entry?.task.prompt)return;
    try{
      const url=URL.createObjectURL(new Blob([entry.task.prompt],{type:'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');
      link.href=url;link.download='script-analysis-'+entry.task.operation+'-'+entry.task.task_id+'.md';
      try{document.body.appendChild(link);link.click();}
      finally{link.remove();URL.revokeObjectURL(url);}
      showNotice('Script Analysis prompt exported.');
    }catch(e){patch(key,{error:errorText(e)});}
  };
  return <div className="grid wide-left" data-testid="script-analysis-identity-workspace">
    <Card>
      <CardHeader title="External task prompt" hint="Script Analysis · Copy to ChatGPT manually · no embedded API"
        action={<Badge tone={entry?'mint':'amber'}>{entry?(selectedCurrent?entry.status:'HISTORY'):'EMPTY'}</Badge>}/>
      {stageTabs}
      <div className="tabs" role="group" aria-label="Script Analysis operation">
        {operations.map(item=><button type="button" key={item} className={operation===item?'active':''}
          aria-pressed={operation===item} onClick={()=>setOperation(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}
      </div>
      {!id?<div className="info">Open a project before creating an identity workflow.</div>:
        !window.studio?.identitySnapshot?<div className="info">Identity workflow requires the Electron bridge.</div>:
        !snapshot?<div className="info">{loadError||'Loading exact project identity journal…'}</div>:null}
      {snapshot?.policy==='legacy'&&<div data-testid="identity-legacy">
        <h3>Legacy project</h3>
        <p>Existing Script/Native, G-Labs jobs and output stay unchanged. Upgrade is explicit and makes current output require identity revalidation; it never approves historical images.</p>
        <Button disabled={busy||loading} onClick={()=>run(async project=>{
          const scope=captureProjectSession();
          const next=await window.studio!.identityPreviewUpgrade(project);
          if(scope&&isCurrentProjectSession(scope))setImpact(next);
        })}>Preview Upgrade Impact</Button>
        {impact&&<div className="identity-impact">
          <p>Current Native SHA: {impact.nativeProjectSha??'none'}</p>
          <p>{impact.media.length} historical image records remain unchanged.</p>
          <p>Impact digest: {impact.impactSha256}</p>
          <Button disabled={busy||loading} onClick={()=>run(project=>window.studio!.identityUpgrade(project,{
            impactSha256:impact.impactSha256,ownerConfirmed:true
          }),()=>setImpact(null))}>Upgrade Identity Workflow (explicit)</Button>
        </div>}
      </div>}
      <div className="external-task-toolbar" role="toolbar" aria-label="External task controls">
        <div className="actions external-task-build-actions">
          <Button disabled={!ready} onClick={()=>build(false)}>Build Task</Button>
          {canRebuild&&<Button disabled={!ready} onClick={()=>build(true)}>Rebuild Task</Button>}
        </div>
        <div className="actions external-task-export-actions">
          <Button variant="primary" disabled={!entry?.task.prompt} onClick={copy}>Copy prompt</Button>
          <Button disabled={!entry?.task.prompt} onClick={exportPrompt}>Export .md</Button>
          <Button onClick={()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer')}>Open ChatGPT</Button>
        </div>
      </div>
      {entry&&<div className="info">Task {entry.task.task_id} · revision {entry.task.revision} · {entry.task.operation} · {selectedCurrent?entry.status:'read-only history'}</div>}
      {entry&&!selectedCurrent&&<div className="info">This prompt is not the current identity task. Responses cannot be imported against it.</div>}
      {isFrozen&&!canRebuild&&<div className="info">This frozen task retains its required Review/Correct lineage; rebuilding is not supported by the current identity lifecycle.</div>}
      {canRebuild&&<div className="info">Rebuild replaces the task ID and invalidates earlier responses.</div>}
      <pre className="prompt external-task-prompt" data-active-prompt="Script Analysis" data-testid="external-task-prompt"
        aria-label="Frozen Script Analysis prompt">{entry?.task.prompt??''}</pre>
    </Card>
    <Card>
      <CardHeader title="Import JSON workspace" hint="Identity contract · explicit import and approval"/>
      <Textarea aria-label="Script Analysis JSON result" value={draft.json} disabled={!id||busy}
        onChange={event=>change(event.target.value)} placeholder="Paste the returned JSON here…"/>
      <div className="actions">
        <input ref={picker} type="file" accept=".json,application/json" aria-label="Choose JSON file" hidden
          disabled={!id||busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)importFile(file);}}/>
        <Button disabled={!id||busy} onClick={()=>picker.current?.click()}>Import .json</Button>
        <Button disabled={!draft.json||busy} onClick={()=>change('')}>Clear</Button>
        <Button variant="primary" disabled={!ready||!isFrozen||!draft.json.trim()}
          onClick={()=>run((project,revision)=>window.studio!.identityImport(project,draft.json,revision),
            ()=>patch(key,{json:'',error:''}))}>Import frozen response</Button>
        <Button disabled={!canApprove}
          onClick={()=>run((project,revision)=>window.studio!.identityApproveAnalysis(project,revision))}>Approve reviewed analysis</Button>
      </div>
      {journal&&<div className="info">Source readiness: <strong>{snapshot?.readiness}</strong> · journal revision {journal.revision}</div>}
      <div className="info identity-catalog">
        <strong>Character Catalog</strong>
        {!journal?.draftAnalysis?<p>No Script Analysis imported.</p>:
          journal.draftAnalysis.continuity_catalog.characters.length===0?
          <p>Valid empty catalog: the approved narration has no established recurring actors.</p>:
          journal.draftAnalysis.continuity_catalog.characters.map(c=>
            <div key={c.char_id}><strong>{c.char_id}</strong> · {c.label} · {c.occurrences.length} verified source occurrence(s)</div>)}
      </div>
      <div className="info">Independent review: {journal?.independentReview?
        (journal.independentReview.approved?'approved':'findings unresolved')+' · '+journal.independentReview.findings.length+' finding(s)':'not reviewed'}</div>
      <div className="info">{journal?.analysisApproved?'Approved analysis SHA '+journal.analysisApproved.sha256:'Analysis not approved'}</div>
      {(draft.error||loadError)&&<div className="info error" role="alert">{draft.error||loadError}</div>}
    </Card>
  </div>;
}
