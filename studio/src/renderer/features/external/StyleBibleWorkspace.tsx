/* eslint-disable react-hooks/exhaustive-deps -- project-scoped async snapshots */
import {useEffect,useRef,useState} from 'react';
import {useAppState} from '../../app/AppState';
import type {ReferenceCandidate} from '../../../main/identity/referencePublication';
import type {ReferenceJob} from '../../../main/identity/referenceGeneration';
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
export function StyleBibleWorkspace(){
  const {native}=useAppState(),projectId=native?.project.id;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [jobs,setJobs]=useState<ReferenceJob[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [paths,setPaths]=useState<Record<string,string>>({});
  const [sources,setSources]=useState<Record<string,string>>({});
  const [loaded,setLoaded]=useState<Set<string>>(new Set());
  const [chosen,setChosen]=useState<Record<string,string>>({});
  const [impact,setImpact]=useState<Awaited<ReturnType<
    NonNullable<Window['studio']>['identityPreviewReferenceImpact']>>|null>(null);
  const epoch=useRef(0);
  useEffect(()=>{
    const current=++epoch.current;setSnapshot(null);setJobs([]);
    setLoaded(new Set());setImpact(null);setError('');
    if(!projectId||!window.studio?.identitySnapshot)return;
    void Promise.all([window.studio.identitySnapshot(projectId),
      window.studio.identityReferenceJobs(projectId)]).then(([value,nextJobs])=>{
      if(current===epoch.current){setSnapshot(value);setJobs(nextJobs);}
    }).catch(e=>{if(current===epoch.current)setError(errorText(e));});
    return()=>{epoch.current++;};
  },[projectId]);
  const action=(fn:(id:string,revision:number)=>Promise<unknown>)=>{
    if(!projectId||!snapshot||busy||!window.studio)return;
    const nonce=epoch.current;setBusy(true);setError('');
    void fn(projectId,snapshot.journal.revision).then(()=>Promise.all([
      window.studio!.identitySnapshot(projectId),
      window.studio!.identityReferenceJobs(projectId)
    ])).then(([value,nextJobs])=>{
      if(nonce===epoch.current){setSnapshot(value);setJobs(nextJobs);setImpact(null);}
    })
      .catch(e=>{if(nonce===epoch.current)setError(errorText(e));})
      .finally(()=>{if(nonce===epoch.current)setBusy(false);});
  };
  if(!projectId)return <div className="info">Open a project before using Style Bible.</div>;
  if(!window.studio?.identitySnapshot)return null;
  if(!snapshot)return <div className="info">{error||'Reading project Style Bible…'}</div>;
  if(snapshot.policy==='legacy')return <div className="info">
    Existing projects remain LEGACY. Open External ChatGPT → Script Analysis
    to preview and explicitly opt into the new identity workflow.</div>;
  const journal=snapshot.journal;
  const bible=journal.bible;
  const approved=Boolean(bible&&
    journal.bibleTextApproved?.sha256===bible.style_bible_sha256);
  const selectedIds=bible?.characters.map(char=>
    chosen[char.char_id]??[...journal.referenceCandidates].reverse().find(c=>
      c.anchor_id===char.char_id&&c.status==='APPROVED')?.candidate_id??'')??[];
  const selectionsReady=selectedIds.every(Boolean);
  return <div className="stack" data-testid="f24-style-bible">
    <section className="card">
      <h3>Project Style Bible · approved Script Analysis lineage</h3>
      <p>Current upstream readiness: <strong>{snapshot.readiness}</strong></p>
      <p>Character identities, visual traits and source spans are inherited from the
        independently approved analysis. No appearance is inferred from filenames.</p>
      <div className="actions">
        <button className="button" type="button"
          disabled={busy||!journal.analysisApproved}
          onClick={()=>action((id,revision)=>window.studio!.identityPrepareBible(id,revision))}>
          Prepare Style Bible from Analysis
        </button>
        <button className="button primary" type="button"
          disabled={busy||!bible||approved}
          onClick={()=>action((id,revision)=>window.studio!.identityApproveBible(id,revision))}>
          Approve reviewed Style Bible text
        </button>
      </div>
      {bible&&<p>Style {bible.style_profile_id} · style SHA {bible.style_profile_sha256} ·
        Bible SHA {bible.style_bible_sha256}</p>}
    </section>
    {bible&&<section className="card">
      <h3>Source-grounded Visual Reference catalog</h3>
      {!bible.characters.length&&<p>Empty approved cast. No invented anchors are required.</p>}
      <div className="identity-bible-grid">{bible.characters.map(character=>{
        const candidates=journal.referenceCandidates.filter(candidate=>
          candidate.anchor_id===character.char_id&&
          candidate.source_definition_hash===character.source_definition_hash);
        const referenceJobs=jobs.filter(job=>job.anchorId===character.char_id);
        const unresolved=referenceJobs.some(job=>['QUEUED','SUBMITTED','RUNNING','UNKNOWN']
          .includes(job.status));
        const active=referenceJobs.some(job=>['QUEUED','SUBMITTED','RUNNING']
          .includes(job.status));
        return <article className="identity-bible-character" key={character.char_id}>
          <h4>{character.char_id} · {character.label}</h4>
          <p>{character.entity_kind} · {character.narrative_role}</p>
          <p>{character.description}</p>
          <p>Source occurrences: {character.occurrences.length} ·
            stable markers: {character.identity_markers.join(', ')||'not source-established'}</p>
          <p>Reference readiness: <strong>{character.visual_readiness}</strong></p>
          {approved&&<div className="identity-reference-generation" data-testid="identity-reference-generation">
            <div className="info">Reference generation is 1:1 and potentially paid.
              Shot image settings remain unchanged; only an explicit owner click sends POST.</div>
            <button className="button" type="button"
              disabled={busy||unresolved||character.visual_readiness!=='READY_FOR_REFERENCE'}
              onClick={()=>action(id=>window.studio!.identityGenerateReference(id,{
                anchorId:character.char_id,authorized:true,
                ...(referenceJobs.length?{regenerate:true}:{})
              }))}>
              {referenceJobs.length?'Regenerate Reference (Paid)':'Generate Reference (Paid)'}
            </button>
            {referenceJobs.map(job=><div key={job.id} className="identity-job"
              data-testid="identity-reference-job">
              <span>1:1 · {job.model} · {job.status} · {job.id.slice(0,8)}</span>
              {job.providerTaskId&&<small>Provider task {job.providerTaskId}</small>}
              {job.reason&&<small>{job.reason}</small>}
              {job.status==='UNKNOWN'&&<strong>UNKNOWN may have charged.
                No automatic paid retry.</strong>}
              {['RUNNING','SUBMITTED','UNKNOWN'].includes(job.status)&&
                <button type="button" className="button" disabled={busy||active&&
                  referenceJobs.some(other=>other.id!==job.id&&
                    ['QUEUED','SUBMITTED','RUNNING'].includes(other.status))}
                  onClick={()=>action(id=>window.studio!.identitySyncReference(id,job.id))}>
                  Retry Sync (GET only)
                </button>}
              {job.status==='VALIDATED'&&<small>Image validated; owner must preview and approve
                the registered candidate below before publication.</small>}
            </div>)}
          </div>}
          {approved&&<div className="identity-owner-import">
            <label>Existing owner-imported project image path
              <input className="input" aria-label={'Owner image '+character.char_id}
                placeholder="assets/images/approved-source.png"
                value={paths[character.char_id]??''}
                onChange={event=>setPaths(value=>({...value,
                  [character.char_id]:event.target.value}))}/>
            </label>
            <label>Owner provenance / rights
              <input className="input" aria-label={'Reference provenance '+character.char_id}
                value={sources[character.char_id]??''}
                onChange={event=>setSources(value=>({...value,
                  [character.char_id]:event.target.value}))}/>
            </label>
            <button className="button" type="button" disabled={busy||
              character.visual_readiness!=='READY_FOR_REFERENCE'||
              !paths[character.char_id]?.trim()||!sources[character.char_id]?.trim()}
              onClick={()=>action((id,revision)=>
                window.studio!.identityRegisterOwnerReference(id,{
                  expectedRevision:revision,anchorId:character.char_id,
                  relativePath:paths[character.char_id],ownerSource:sources[character.char_id]
                }))}>Register 1:1 owner reference candidate</button>
          </div>}
          {candidates.map(candidate=><div className="identity-candidate" key={candidate.candidate_id}>
            <VerifiedReferenceImage projectId={projectId} candidate={candidate}
              onLoaded={(id,ready)=>setLoaded(prev=>{
                if(prev.has(id)===ready)return prev;
                const next=new Set(prev);if(ready)next.add(id);else next.delete(id);
                return next;
              })}/>
            <p>{candidate.status} · SHA {candidate.media_sha256.slice(0,16)} ·
              {candidate.width}×{candidate.height}</p>
            <p>{candidate.source} · licensing independently verified: NO</p>
            {candidate.status==='VALIDATED'&&<button className="button" type="button"
              disabled={busy||!loaded.has(candidate.candidate_id)}
              onClick={()=>action((id,revision)=>window.studio!.identityApproveReference(id,{
                expectedRevision:revision,candidateId:candidate.candidate_id,ownerInspected:true
              }))}>I inspected the current reference image · Approve</button>}
            {candidate.status==='APPROVED'&&<label>
              <input type="radio" name={'identity-reference-'+character.char_id}
                checked={(chosen[character.char_id]??[...candidates].reverse().find(c=>
                  c.status==='APPROVED')?.candidate_id)===candidate.candidate_id}
                onChange={()=>{setChosen(old=>({...old,
                  [character.char_id]:candidate.candidate_id}));setImpact(null);}}/>
              Select as canonical {character.char_id}
            </label>}
          </div>)}
        </article>;
      })}</div>
    </section>}
    {approved&&<section className="card">
      <h3>Publish owner-approved Reference Set</h3>
      <p>Only candidates with verified bytes, current source definitions and explicit
        owner approvals are eligible. Existing G-Labs/Native assets are never auto-approved.</p>
      {journal.referenceApprovalSet&&<button className="button" type="button"
        disabled={busy||!selectionsReady}
        onClick={()=>{const token=epoch.current;setError('');
          void window.studio!.identityPreviewReferenceImpact(projectId,selectedIds)
            .then(report=>{if(token===epoch.current)setImpact(report);})
            .catch(e=>{if(token===epoch.current)setError(errorText(e));});
        }}>Preview canonical replacement impact</button>}
      {impact&&<div className="identity-impact" data-testid="f24-reference-impact">
        <strong>Proposed identity change</strong>
        <p>Changed characters: {impact.changedCharacterIds.join(', ')||'none'}</p>
        <p>Dependent Native Layers: {impact.affectedTargetKeys.join(', ')||'none'}</p>
        {impact.publishedNativeAffected&&<p>Previously published Native output will require
          a new review/rebuild. Previous bytes and history are retained.</p>}
        <small>Impact digest {impact.impactSha256}</small>
      </div>}
      <button className="button primary" type="button" disabled={busy||
        !selectionsReady||(Boolean(journal.referenceApprovalSet)&&!impact)}
        onClick={()=>action((id,revision)=>window.studio!.identityPublishReferences(id,
          revision,selectedIds,impact?.impactSha256))}>
        Publish approved canonical Reference Set
      </button>
      {journal.referenceApprovalSet&&<p>Published SHA:
        {' '}{journal.referenceApprovalSet.approval_set_sha256}</p>}
    </section>}
    <p className="info">Reference jobs use a separate 1:1 journal. Provider completion
      never implies visual approval. F24 Native automatic binding remains blocked
      until exact Shot/Layer lineage gates are integrated and verified.</p>
    {error&&<p className="info error" role="alert">{error}</p>}
  </div>;
}
