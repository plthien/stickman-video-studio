/* eslint-disable react-hooks/exhaustive-deps -- project-scoped async snapshots */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAppState} from '../../app/AppState';
import type {ReferenceCandidate} from '../../../main/identity/referencePublication';
import type {ReferenceJob} from '../../../main/identity/referenceGeneration';
import type {GLabsReferenceModel} from '../../../main/glabs';
type Snapshot=Awaited<ReturnType<NonNullable<Window['studio']>['identitySnapshot']>>;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function VerifiedReferenceImage({projectId,candidate,onLoaded}:{
  projectId:string;candidate:ReferenceCandidate;onLoaded:(id:string,ready:boolean)=>void
}){
  const [url,setUrl]=useState('');
  const callback=useRef(onLoaded);callback.current=onLoaded;
  useEffect(()=>{
    let live=true;setUrl('');callback.current(candidate.candidate_id,false);
    void window.studio?.mediaUrl(projectId,candidate.media_path).then(value=>{
      if(live)setUrl(value);
    }).catch(()=>{if(live)setUrl('');});
    return()=>{live=false;callback.current(candidate.candidate_id,false);};
  },[projectId,candidate.candidate_id,candidate.media_path]);
  return url?<img className="identity-candidate-image" src={url}
    alt={'Visual reference candidate '+candidate.anchor_id}
    onLoad={event=>{
      const image=event.currentTarget;
      callback.current(candidate.candidate_id,
        image.complete&&image.naturalWidth===candidate.width&&
        image.naturalHeight===candidate.height);
    }}
    onError={()=>callback.current(candidate.candidate_id,false)}/>:
    <p>Reference preview unavailable</p>;
}
const models:ReadonlyArray<{value:GLabsReferenceModel;label:string}>=[
  {value:'nano_banana_2',label:'Nano Banana 2'},
  {value:'nano_banana_pro',label:'Nano Banana Pro'},
  {value:'gpt_image_2',label:'GPT Image 2'}
];
const inFlight=(job:ReferenceJob)=>['QUEUED','SUBMITTED','RUNNING'].includes(job.status);
const blocked=(job:ReferenceJob)=>inFlight(job)||job.status==='UNKNOWN';
const candidateFromJob=(candidate:ReferenceCandidate,job:ReferenceJob)=>
  candidate.source==='GLABS_GENERATED'&&candidate.style_bible_sha256===job.styleBibleSha&&
  candidate.anchor_id===job.anchorId&&candidate.provider_job_id===job.providerTaskId&&
  candidate.media_sha256===job.staged?.sha256&&candidate.prompt_sha256===job.promptSha;
export function StyleBibleWorkspace(){
  const {native,captureProjectSession,isCurrentProjectSession}=useAppState(),projectId=native?.project.id;
  const projectEpoch=captureProjectSession?.()?.epoch;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [snapshotProjectId,setSnapshotProjectId]=useState<string|null>(null);
  const [jobs,setJobs]=useState<ReferenceJob[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState(false);
  const [modelByProject,setModelByProject]=useState<Record<string,GLabsReferenceModel>>({});
  const model=modelByProject[projectId??'']??'nano_banana_2';
  const [paths,setPaths]=useState<Record<string,string>>({});
  const [sources,setSources]=useState<Record<string,string>>({});
  const [visualTraits,setVisualTraits]=useState<Record<string,string>>({});
  const [visualEvidence,setVisualEvidence]=useState<Record<string,string>>({});
  const [visualOrigins,setVisualOrigins]=useState<Record<string,'SCRIPT_AUTHOR'|'OWNER_BRIEF'>>({});
  const [loaded,setLoaded]=useState<Set<string>>(new Set());
  const [chosen,setChosen]=useState<Record<string,string>>({});
  const [syncErrors,setSyncErrors]=useState<Record<string,string>>({});
  const [impact,setImpact]=useState<Awaited<ReturnType<
    NonNullable<Window['studio']>['identityPreviewReferenceImpact']>>|null>(null);
  const epoch=useRef(0),busyRef=useRef(false),pollCursor=useRef(0);
  const scopeCurrent=(token:number,scope:ReturnType<typeof captureProjectSession>)=>
    token===epoch.current&&(!scope||isCurrentProjectSession(scope));
  useLayoutEffect(()=>{
    epoch.current++;busyRef.current=false;pollCursor.current=0;setBusy(false);setPrepared(false);
    setSnapshot(null);setSnapshotProjectId(null);setJobs([]);
    setLoaded(new Set());setChosen({});setImpact(null);setError('');setSyncErrors({});
    setPaths({});setSources({});setVisualTraits({});setVisualEvidence({});setVisualOrigins({});
    return()=>{epoch.current++;};
  },[projectId,projectEpoch]);
  useEffect(()=>{
    const id=projectId,token=epoch.current,scope=captureProjectSession?.()??null;
    if(!id||!window.studio?.identitySnapshot)return;
    const bridge=window.studio;
    const current=()=>scopeCurrent(token,scope);
    void (async()=>{
      try{
        let value=await bridge.identitySnapshot(id);
        if(!current())return;
        let ready=false;
        if(value.policy==='v1'&&value.journal.analysisApproved){
          // No provider calls or owner approval here. This is technical compilation
          // (or read-only reuse of historical published authority).
          if(bridge.identityPrepareAutomaticGallery){
            try{
              await bridge.identityPrepareAutomaticGallery(id,value.journal.revision);
              if(!current())return;
              value=await bridge.identitySnapshot(id);
              ready=true;
            }catch(e){if(current())setError(errorText(e));}
          }else ready=Boolean(value.journal.bible);
        }
        const nextJobs=await bridge.identityReferenceJobs(id);
        if(current()){setSnapshot(value);setSnapshotProjectId(id);setJobs(nextJobs);setPrepared(ready);}
      }catch(e){if(current())setError(errorText(e));}
    })();
  },[projectId,projectEpoch]);
  const action=(fn:(id:string,revision:number,current:()=>boolean)=>Promise<unknown>)=>{
    if(!projectId||!snapshot||snapshotProjectId!==projectId||busyRef.current||!window.studio)return;
    const id=projectId,token=epoch.current,scope=captureProjectSession?.()??null,bridge=window.studio;
    const current=()=>scopeCurrent(token,scope);
    busyRef.current=true;setBusy(true);setError('');
    void (async()=>{
      try{await fn(id,snapshot.journal.revision,current);}
      catch(e){if(current())setError(errorText(e));}
      finally{
        if(current()){
          try{
            const [value,nextJobs]=await Promise.all([bridge.identitySnapshot(id),bridge.identityReferenceJobs(id)]);
            if(current()){setSnapshot(value);setJobs(nextJobs);setImpact(null);}
          }catch(e){if(current())setError(errorText(e));}
        }
        if(current()){busyRef.current=false;setBusy(false);}
      }
    })();
  };
  // Poll one reference job at a time, only while this project is visible.
  // A sync is GET-only. UNKNOWN and failed syncs never cause automatic POST.
  useEffect(()=>{
    if(!snapshot||snapshotProjectId!==projectId||busy||!projectId)return;
    const pendingJobs=jobs.filter(job=>inFlight(job)&&!syncErrors[job.id]);
    if(!pendingJobs.length)return;
    const pending=pendingJobs[pollCursor.current%pendingJobs.length];
    const timer=window.setTimeout(()=>action(async(id,_revision,current)=>{
      pollCursor.current++;
      try{await window.studio!.identitySyncReference(id,pending.id);}
      catch(e){if(current())setSyncErrors(old=>({...old,[pending.id]:errorText(e)}));}
    }),2000);
    return()=>window.clearTimeout(timer);
  },[projectId,projectEpoch,snapshotProjectId,snapshot,jobs,busy,syncErrors]);
  if(!projectId)return <div className="info">Open a project before using Style Bible.</div>;
  if(!window.studio?.identitySnapshot)return null;
  if(!snapshot||snapshotProjectId!==projectId)
    return <div className="info">{error||'Reading project Style Bible…'}</div>;
  if(snapshot.policy==='legacy')return <div className="info">
    Existing projects remain LEGACY. Open External ChatGPT → Script Analysis
    to preview and explicitly opt into the identity workflow.</div>;
  const journal=snapshot.journal;
  const bible=journal.bible??journal.publishedAuthority?.bible;
  const approved=Boolean(prepared&&journal.bible&&
    (journal.bible.automatic_authority?.version==='automatic-reference-authority-v1'?
      !journal.bibleTextApproved:journal.bibleTextApproved?.sha256===journal.bible.style_bible_sha256));
  const publishedSet=journal.publishedAuthority?.referenceApprovalSet??journal.referenceApprovalSet;
  const currentCandidates=(charId:string,sourceHash:string)=>journal.referenceCandidates.filter(c=>
    c.anchor_id===charId&&c.source_definition_hash===sourceHash&&c.style_bible_sha256===bible?.style_bible_sha256);
  const available=(charId:string,sourceHash:string)=>currentCandidates(charId,sourceHash).filter(c=>c.status==='APPROVED');
  const candidateFor=(charId:string,sourceHash:string)=>{
    const candidates=available(charId,sourceHash),explicit=chosen[charId];
    if(explicit&&candidates.some(c=>c.candidate_id===explicit))return explicit;
    const publishedId=publishedSet?.entries.find(e=>e.anchor_id===charId)?.candidate_id;
    if(publishedId&&candidates.some(c=>c.candidate_id===publishedId))return publishedId;
    return candidates.at(-1)?.candidate_id??'';
  };
  const selectedIds=bible?.characters.map(char=>candidateFor(char.char_id,char.source_definition_hash))??[];
  const selectionsReady=selectedIds.length===(bible?.characters.length??0)&&selectedIds.every(Boolean);
  const impactCurrent=Boolean(impact&&impact.revision===journal.revision&&
    JSON.stringify(impact.selectedIds)===JSON.stringify(selectedIds)&&impact.projectId===projectId);
  const currentRows=bible?.characters??[];
  const generatedCount=currentRows.filter(row=>currentCandidates(row.char_id,row.source_definition_hash).length>0).length;
  const approvedCount=currentRows.filter(row=>available(row.char_id,row.source_definition_hash).length>0).length;
  const readyToApprove=currentRows.flatMap(row=>{
    // Explicit bulk inspection is limited to a single loaded current candidate per character.
    const latest=currentCandidates(row.char_id,row.source_definition_hash).filter(c=>
      c.status==='VALIDATED'&&loaded.has(c.candidate_id)).at(-1);
    return latest?[latest]:[];
  });
  const remaining=currentRows.filter(row=>
    row.visual_readiness==='READY_FOR_REFERENCE'&&
    !currentCandidates(row.char_id,row.source_definition_hash).length&&
    !jobs.some(job=>job.anchorId===row.char_id&&(blocked(job)||
      (job.status==='VALIDATED'&&job.styleBibleSha===bible?.style_bible_sha256))));
  const generate=(anchorId:string,acknowledgeUnknown=false)=>{
    if(!approved)return;
    action(id=>window.studio!.identityGenerateReference(id,{anchorId,authorized:true,model,
      ...(jobs.some(job=>job.anchorId===anchorId)||currentRows.some(row=>row.char_id===anchorId&&
        currentCandidates(anchorId,row.source_definition_hash).length)?{regenerate:true}:{}),
      ...(acknowledgeUnknown?{acknowledgeUnknown:true}:{})}));
  };
  const approveImages=(ids:string[])=>{
    if(!approved||!ids.length||ids.some(id=>!loaded.has(id)))return;
    action(async(id,revision,current)=>{
      const bridge=window.studio!;
      let nextRevision=revision;
      for(const candidateId of ids){
        if(!current())return;
        const result=await bridge.identityApproveReference(id,{expectedRevision:nextRevision,candidateId,ownerInspected:true});
        nextRevision=result.revision;
      }
      if(current()&&bridge.identityPrepareAutomaticGallery)
        await bridge.identityPrepareAutomaticGallery(id,nextRevision);
    });
  };
  const retrySync=(job:ReferenceJob)=>action(async(id,_revision,current)=>{
    try{
      await window.studio!.identitySyncReference(id,job.id);
      if(current())setSyncErrors(old=>{const next={...old};delete next[job.id];return next;});
    }catch(e){
      if(current())setSyncErrors(old=>({...old,[job.id]:errorText(e)}));
      throw e;
    }
  });
  return <div className="stack" data-testid="f24-style-bible">
    <section className="card">
      <h3>Character Reference Gallery</h3>
      <p>Approved Script Analysis: <strong>{approved?'READY':snapshot.readiness}</strong> ·
        Style {bible?.style_profile_id??native?.project.style??'not ready'} · {currentRows.length} characters</p>
      <p>Generated {generatedCount}/{currentRows.length} · Approved {approvedCount}/{currentRows.length} ·
        Canonical {publishedSet?'published':'not published'}</p>
      <label className="field">Reference image model
        <select className="input" aria-label="Reference image model" disabled={busy} value={model}
          onChange={event=>setModelByProject(old=>({...old,[projectId]:event.target.value as GLabsReferenceModel}))}>
          {models.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <div className="actions">
        <button type="button" className="button primary" disabled={busy||!approved||!remaining.length}
          onClick={()=>action(async(id,_revision,current)=>{
            // Sequential submissions, never a retry loop. A failed/unknown
            // paid attempt stops this batch; no already-approved row is sent.
            for(const row of remaining){
              if(!current())return;
              const job=await window.studio!.identityGenerateReference(id,{
                anchorId:row.char_id,authorized:true,model,
                ...(jobs.some(old=>old.anchorId===row.char_id)?{regenerate:true}:{})
              });
              if(job.status!=='RUNNING')throw Error('REFERENCE_BATCH_STOPPED: '+job.status+'; inspect job before continuing.');
            }
          })}>Generate All Remaining</button>
        <button type="button" className="button" disabled={busy||!approved||!readyToApprove.length}
          onClick={()=>approveImages(readyToApprove.map(c=>c.candidate_id))}>Approve All Ready</button>
      </div>
      <small>Generation is potentially paid. Approve All Ready confirms inspection of every selected loaded image.
        Reference model is independent of Storyboard; all references are 1:1.</small>
      {!approved&&<div className="info">Complete and approve the current Script Analysis before generating new references.</div>}
      {publishedSet&&<div className="info" data-testid="f24-published-identity">
        Last-good canonical references remain active until an explicitly confirmed replacement.
      </div>}
      <details><summary>Advanced / diagnostics</summary>
        <p>Journal revision {journal.revision}</p>
        {bible&&<p>Style SHA {bible.style_profile_sha256} · Bible SHA {bible.style_bible_sha256}</p>}
        {journal.styleDesign&&<details><summary>Historical AI visual design</summary><pre>{JSON.stringify(journal.styleDesign,null,2)}</pre></details>}
        {journal.styleDesignReview&&<details><summary>Historical AI review</summary><pre>{JSON.stringify(journal.styleDesignReview,null,2)}</pre></details>}
        {publishedSet&&<p>Published SHA {publishedSet.approval_set_sha256}</p>}
        {snapshot.currentOwnerVisualDefinitionError&&<p role="alert">{snapshot.currentOwnerVisualDefinitionError}</p>}
      </details>
    </section>
    {bible&&<section className="card">
      {!currentRows.length&&<p>Empty approved character catalog. No image generation is required.</p>}
      <div className="identity-bible-grid">{currentRows.map(character=>{
        const visualDefinition=snapshot.currentOwnerVisualDefinitions?.find(value=>value.charId===character.char_id);
        const candidates=currentCandidates(character.char_id,character.source_definition_hash);
        const historicalCandidates=journal.referenceCandidates.filter(candidate=>
          candidate.anchor_id===character.char_id&&!candidates.some(c=>c.candidate_id===candidate.candidate_id));
        const referenceJobs=jobs.filter(job=>job.anchorId===character.char_id);
        const unresolved=referenceJobs.some(blocked),active=referenceJobs.some(inFlight);
        const awaitingRegistration=referenceJobs.some(job=>job.status==='VALIDATED'&&
          job.styleBibleSha===bible.style_bible_sha256&&!candidates.some(c=>candidateFromJob(c,job)));
        const canGenerate=approved&&!busy&&!unresolved&&!awaitingRegistration&&
          (character.visual_readiness==='READY_FOR_REFERENCE'||Boolean(visualDefinition));
        return <article className="identity-bible-character" key={character.char_id}>
          <h4>{character.label} · {character.char_id}</h4>
          <p>{character.narrative_role}</p><p>{character.description}</p>
          <p>Status: <strong>{unresolved?referenceJobs.find(blocked)?.status:
            awaitingRegistration?'REGISTRATION_REQUIRED':
            available(character.char_id,character.source_definition_hash).length?'APPROVED':
            candidates.length?'READY FOR INSPECTION':referenceJobs[0]?.status??'NOT GENERATED'}</strong></p>
          <div className="actions" data-testid="identity-reference-generation">
            {!candidates.length&&!referenceJobs.length?
              <button className="button primary" type="button" disabled={!canGenerate}
                onClick={()=>generate(character.char_id)}>Generate Image</button>:
              <button className="button" type="button" disabled={!canGenerate}
                onClick={()=>generate(character.char_id)}>Regenerate Image</button>}
          </div>
          {candidates.map(candidate=><div className="identity-candidate" key={candidate.candidate_id}>
            <VerifiedReferenceImage projectId={projectId} candidate={candidate}
              onLoaded={(id,ready)=>setLoaded(prev=>{
                if(prev.has(id)===ready)return prev;
                const next=new Set(prev);if(ready)next.add(id);else next.delete(id);return next;
              })}/>
            <p>{candidate.status} · {candidate.width}×{candidate.height} · {candidate.model}</p>
            {publishedSet?.entries.some(entry=>entry.candidate_id===candidate.candidate_id)&&<strong>Current canonical</strong>}
            {candidate.status==='VALIDATED'&&<button className="button primary" type="button"
              disabled={busy||!approved||!loaded.has(candidate.candidate_id)}
              onClick={()=>approveImages([candidate.candidate_id])}>Approve</button>}
            {candidate.status==='APPROVED'&&publishedSet&&<label>
              <input type="radio" name={'identity-reference-'+character.char_id}
                checked={candidateFor(character.char_id,character.source_definition_hash)===candidate.candidate_id}
                onChange={()=>{setChosen(old=>({...old,[character.char_id]:candidate.candidate_id}));setImpact(null);}}/>
              Select as canonical {character.char_id}
            </label>}
          </div>)}
          {!candidates.length&&<div className="info">No current reference image.</div>}
          {referenceJobs.map(job=><div key={job.id} className="identity-job" data-testid="identity-reference-job">
            <span>{job.model} · 1:1 · {job.status}</span>
            {job.status==='UNKNOWN'&&<div className="info error">UNKNOWN may have charged. No automatic paid retry.</div>}
            {(job.status==='UNKNOWN'||syncErrors[job.id]||
              (job.status==='VALIDATED'&&job.styleBibleSha===bible.style_bible_sha256&&
                !candidates.some(c=>candidateFromJob(c,job))))&&
              <button type="button" className="button" disabled={busy} onClick={()=>retrySync(job)}>Retry Sync (GET only)</button>}
            {job.status==='UNKNOWN'&&<button type="button" className="button"
              disabled={!approved||busy||active} onClick={()=>generate(character.char_id,true)}>
              I acknowledge possible previous charge — Generate again (Paid)
            </button>}
            {syncErrors[job.id]&&<p role="alert">{syncErrors[job.id]}</p>}
            <details><summary>Exact frozen prompt / job diagnostics</summary>
              <small>{job.id} · {job.providerTaskId??'no provider ID'} · {job.reason??''}</small>
              <pre className="prompt">{job.prompt}</pre><small>Prompt SHA {job.promptSha}</small>
            </details>
          </div>)}
          <details><summary>Advanced · owner instructions / import existing image</summary>
            {historicalCandidates.map(candidate=><div key={candidate.candidate_id}>
              <VerifiedReferenceImage projectId={projectId} candidate={candidate} onLoaded={()=>{}}/>
              <small>Previous candidate · {candidate.status} · {candidate.model}</small>
            </div>)}
            {visualDefinition&&<p>Current owner instructions: {visualDefinition.traits.join(', ')}</p>}
            <label>Evidence origin
              <select className="input" value={visualOrigins[character.char_id]??'OWNER_BRIEF'}
                onChange={event=>setVisualOrigins(old=>({...old,[character.char_id]:
                  event.target.value as 'SCRIPT_AUTHOR'|'OWNER_BRIEF'}))}>
                <option value="OWNER_BRIEF">Explicit owner instructions</option>
                <option value="SCRIPT_AUTHOR">Exact approved Script Author text</option>
              </select>
            </label>
            <label>Optional appearance instructions, comma separated
              <input className="input" aria-label={'Owner visual traits '+character.char_id}
                value={visualTraits[character.char_id]??''}
                onChange={event=>setVisualTraits(old=>({...old,[character.char_id]:event.target.value}))}/>
            </label>
            <label>Owner instructions provenance / exact source excerpt
              <textarea className="textarea" aria-label={'Owner visual evidence '+character.char_id}
                value={visualEvidence[character.char_id]??''}
                onChange={event=>setVisualEvidence(old=>({...old,[character.char_id]:event.target.value}))}/>
            </label>
            <button className="button" type="button" disabled={!approved||busy||
              !visualTraits[character.char_id]?.trim()||!visualEvidence[character.char_id]?.trim()}
              onClick={()=>action((id,revision)=>window.studio!.identityApproveVisualDefinition(id,{
                expectedRevision:revision,anchorId:character.char_id,
                provenance:visualOrigins[character.char_id]??'OWNER_BRIEF',
                traits:(visualTraits[character.char_id]??'').split(',').map(value=>value.trim()).filter(Boolean),
                evidence:visualEvidence[character.char_id]??'',ownerInspected:true
              }))}>Save optional owner instructions</button>
            <label>Existing owner-imported image path
              <input className="input" aria-label={'Owner image '+character.char_id}
                value={paths[character.char_id]??''} placeholder="assets/images/approved-source.png"
                onChange={event=>setPaths(old=>({...old,[character.char_id]:event.target.value}))}/>
            </label>
            <label>Owner provenance / rights
              <input className="input" aria-label={'Reference provenance '+character.char_id}
                value={sources[character.char_id]??''}
                onChange={event=>setSources(old=>({...old,[character.char_id]:event.target.value}))}/>
            </label>
            <button className="button" type="button" disabled={!approved||busy||
              !paths[character.char_id]?.trim()||!sources[character.char_id]?.trim()}
              onClick={()=>action((id,revision)=>window.studio!.identityRegisterOwnerReference(id,{
                expectedRevision:revision,anchorId:character.char_id,
                relativePath:paths[character.char_id],ownerSource:sources[character.char_id]
              }))}>Register 1:1 owner reference candidate</button>
          </details>
        </article>;
      })}</div>
    </section>}
    {approved&&publishedSet&&<section className="card">
      <h3>Replace published canonical references</h3>
      <button className="button" type="button" disabled={busy||!selectionsReady}
        onClick={()=>{
          const token=epoch.current,scope=captureProjectSession?.()??null;setError('');
          void window.studio!.identityPreviewReferenceImpact(projectId,selectedIds)
            .then(report=>{if(scopeCurrent(token,scope))setImpact(report);})
            .catch(e=>{if(scopeCurrent(token,scope))setError(errorText(e));});
        }}>Preview canonical replacement impact</button>
      {impact&&<div className="identity-impact" data-testid="f24-reference-impact">
        <p>Changed characters: {impact.changedCharacterIds.join(', ')||'none'}</p>
        <p>Dependent Native Layers: {impact.affectedTargetKeys.join(', ')||'none'}</p>
        {impact.publishedNativeAffected&&<p>Published Native output will require revalidation. Existing bytes are retained.</p>}
      </div>}
      <button className="button primary" type="button" disabled={busy||!selectionsReady||!impactCurrent}
        onClick={()=>action((id,revision)=>window.studio!.identityPublishReferences(id,
          revision,selectedIds,impact!.impactSha256))}>Publish approved canonical Reference Set</button>
    </section>}
    {error&&<p className="info error" role="alert">{error}</p>}
  </div>;
}
