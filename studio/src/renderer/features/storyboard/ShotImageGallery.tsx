import {useEffect,useState} from 'react';
import {Button} from '../../components/ui';

type Studio=NonNullable<Window['studio']>;
type ImageJob=Awaited<ReturnType<Studio['glabsJobs']>>[number];
type Prepared=Awaited<ReturnType<Studio['prepareImages']>>;
export interface GalleryTarget{
  key:string;shotId:string;layerId:string;path:string;boundPath:string;
  boundSha256?:string;creativeFingerprint?:string;fulfilled:boolean;managed:boolean;
}
export interface GalleryCard{
  target:GalleryTarget;
  job:ImageJob|null;
  history:ImageJob[];
  spec:Prepared['jobs'][number]|null;
  currentlyBound?:boolean;superseded?:boolean;hasCurrentAttempt?:boolean;
}
export interface ShotImageGalleryProps{
  projectId:string;shotId:string;cards:GalleryCard[];urls:Record<string,string>;
  previewReady:Record<string,string>;previewErrors:Record<string,string>;
  previewIdentity:(job:ImageJob)=>string;busy:boolean;selectedIds:Set<string>;
  onLoaded:(job:ImageJob,valid:boolean)=>void;
  onSelect:(jobId:string,selected:boolean)=>void;
  onGenerate:(targetKey:string)=>void;
  onApprove:(jobId:string)=>void;
  onCheck:(jobId:string)=>void;
  onRetryPreview:(jobId:string)=>void;
  onInspectUnknown:(targetKey:string)=>void;
  onSavePrompt?:(targetKey:string,prompt:string,references:string[])=>void;
  onCancelQueued?:(jobId:string)=>void;
  onCheckUnknown?:(targetKey:string)=>void;
  onConsentUnknown?:(targetKey:string,checked:boolean)=>void;
  onAuthorizeUnknown?:(targetKey:string)=>void;
  unknownReview?:{targetKey:string;outcome:string|null;error:string;
    acknowledged:boolean;canAuthorize:boolean;checking:boolean};
}
const status=(card:GalleryCard)=>{
  if(card.currentlyBound??(card.target.fulfilled&&card.job?.status==='APPROVED'))return'Approved';
  if(card.target.fulfilled)return'Bound (manual)';
  if(card.job?.lastSyncError)return'Sync failed';
  if(card.job?.providerCompletedAt&&card.job.status!=='VALIDATED')return'Provider done — retrieving image';
  if(card.superseded&&!card.job)return'Needs Regeneration';
  if(card.job?.status==='QUEUED')return'Queued';
  if(card.job?.status==='RUNNING'||card.job?.status==='SUBMITTED'||
    card.job?.status==='DOWNLOADED')return'Running';
  if(card.job?.status==='VALIDATED')return'Ready to approve';
  if(card.job?.status==='FAILED')return'Failed';
  if(card.job?.status==='UNKNOWN')return'UNKNOWN';
  if(card.job?.status==='STALE')return'Stale';
  if(card.job?.status==='CANCELLED')return'Cancelled';
  return'Not Generated';
};

function HistoryCandidate({job,projectId}:{job:ImageJob;projectId:string}){
  const [expanded,setExpanded]=useState(false),[url,setUrl]=useState('');
  const stagedPath=job.staged?.path;
  useEffect(()=>{
    if(!expanded||!stagedPath||!window.studio)return;
    let current=true;
    void window.studio.mediaUrl(projectId,stagedPath).then(value=>{
      if(current)setUrl(value);
    }).catch(()=>{if(current)setUrl('');});
    return()=>{current=false};
  },[expanded,projectId,stagedPath]);
  return <details onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>{job.status} · {job.id}
      {job.staged?' · '+job.staged.width+' × '+job.staged.height:''}
    </summary>
    {job.staged&&<><div>SHA {job.staged.sha256}</div>
      {url?<div className="shot-image-history-preview"
        style={{aspectRatio:job.staged.width+' / '+job.staged.height}}>
        <img loading="lazy" src={url} alt={'Historical image candidate '+job.id}
          style={{width:'100%',height:'100%',objectFit:'contain'}}/>
      </div>:<div>Open to load historical candidate preview.</div>}
    </>}
    {job.reason&&<div>{job.reason}</div>}
  </details>;
}

/** Source-backed edits are local to one frozen target. Saving invokes the
 * existing Native compiler, which independently inserts mandatory B1–B4 style
 * authority and checks references; the card does not edit style guidance. */
function CardPromptEditor({card,onSave}:{
  card:GalleryCard;
  onSave?:(key:string,prompt:string,references:string[])=>void
}){
  const spec=card.spec;
  const [prompt,setPrompt]=useState(spec?.prompt??'');
  const [references,setReferences]=useState(spec?.references.join(', ')??'');
  useEffect(()=>{
    setPrompt(spec?.prompt??'');
    setReferences(spec?.references.join(', ')??'');
  },[spec?.draftIdentity.creativeFingerprint,spec?.promptSha256,
    spec?.references.join('|')]);
  if(!spec)return <div className="info">No source-backed prompt is currently prepared for this target.</div>;
  const parsed=references.split(',').map(value=>value.trim()).filter(Boolean);
  return <div className="stack">
    <strong>Verified Native target: {spec.shotId}/{spec.layerId}</strong>
    <div>Style authority {spec.styleProfileRef.id} · SHA {spec.styleProfileRef.sha256}</div>
    <label>Editable image description
      <textarea className="textarea" aria-label={'Edit image prompt '+card.target.layerId}
        value={prompt} onChange={event=>setPrompt(event.target.value)}/>
    </label>
    <label>Approved image references (comma separated)
      <input className="input" aria-label={'Approved references '+card.target.layerId}
        value={references} onChange={event=>setReferences(event.target.value)}/>
    </label>
    {spec.styleAnchors.length>0&&<label>Verified B4 style reference
      <select className="input" aria-label={'Verified B4 reference '+card.target.layerId}
        value={parsed.find(item=>item.startsWith('@modeb/b4/'))??''}
        onChange={event=>{
          const remaining=parsed.filter(item=>!item.startsWith('@modeb/b4/'));
          setReferences([...remaining,...(event.target.value?[event.target.value]:[])].join(', '));
        }}>
        <option value="">Choose approved B4 reference</option>
        {spec.styleAnchors.map(anchor=><option key={anchor.id} value={'@modeb/b4/'+anchor.id}>
          {anchor.label}</option>)}
      </select>
    </label>}
    <Button disabled={!onSave||prompt.trim().length<12||spec.state==='BLOCKED'}
      onClick={()=>onSave?.(card.target.key,prompt.trim(),parsed)}>
      Save Image Prompt & References
    </Button>
    <details><summary>Compiler source rows & immutable style</summary>
      <pre className="prompt">{JSON.stringify(spec.sourceRows,null,2)}</pre>
      <pre className="prompt">{spec.prompt}</pre>
    </details>
  </div>;
}

/** Image-first Native Shot gallery. No Layer selection or editable rights
 * input is required to see or approve an actual provider image. */
export function ShotImageGallery({
  projectId,shotId,cards,urls,previewReady,previewErrors,previewIdentity,busy,selectedIds,
  onLoaded,onSelect,onGenerate,onApprove,onCheck,onRetryPreview,onInspectUnknown,
  onSavePrompt,onCancelQueued,onCheckUnknown,onConsentUnknown,onAuthorizeUnknown,unknownReview
}:ShotImageGalleryProps){
  const [expanded,setExpanded]=useState<string|null>(null);
  const [openDetails,setOpenDetails]=useState<Set<string>>(new Set());
  const eligible=(card:GalleryCard)=>{
    const job=card.job;
    return Boolean(job&&job.status==='VALIDATED'&&job.staged&&
      urls[job.id]&&!previewErrors[job.id]&&
      previewReady[job.id]===previewIdentity(job));
  };
  const expandedCard=cards.find(card=>card.job?.id===expanded);
  return <div className="shot-image-gallery-workspace" data-testid="shot-image-gallery">
    <div className="shot-image-gallery-header">
      <strong>{shotId} · {cards.length} Native image Layers</strong>
      <span>All image cards · actual dimensions · preview before approval</span>
    </div>
    <div className="shot-image-gallery-grid">
      {cards.map(card=>{
        const job=card.job,staged=job?.staged,canApprove=eligible(card);
        const attempts=card.history;
        const active=Boolean(job&&['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status));
        const unknown=Boolean(attempts.some(attempt=>attempt.status==='UNKNOWN'));
        const mayGenerate=card.target.managed&&!card.target.fulfilled&&
          card.spec?.state==='READY'&&!active&&!unknown&&
          (!job||!['APPROVED','VALIDATED'].includes(job.status));
        const needsSync=Boolean(job?.providerCompletedAt&&job.lastSyncError);
        const unknownForCard=attempts.filter(attempt=>attempt.status==='UNKNOWN');
        const review=unknownReview?.targetKey===card.target.key?unknownReview:null;
        return <article className="shot-image-card" key={card.target.key}
          data-testid="shot-image-card" data-target-key={card.target.key}
          data-shot-id={card.target.shotId} data-layer-id={card.target.layerId}>
          <header className="shot-image-card-title">
            <div><strong>{card.target.layerId}</strong><small>{card.target.shotId}</small></div>
            <span className={'shot-image-status status-'+status(card).toLowerCase().replaceAll(' ','-')}>{status(card)}</span>
          </header>
          <div className={'shot-image-card-stage'+(!staged?' is-placeholder':'')}
            style={{aspectRatio:staged&&staged.width>0&&staged.height>0?
              staged.width+' / '+staged.height:'9 / 16'}}
            data-testid="shot-image-stage">
            {job&&staged&&urls[job.id]?<img
              key={previewIdentity(job)} src={urls[job.id]}
              alt={'Shot gallery '+card.target.shotId+'/'+card.target.layerId}
              width={staged.width} height={staged.height}
              loading="eager" decoding="async"
              onLoad={event=>{
                const image=event.currentTarget;
                onLoaded(job,image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
              }}
              onError={()=>onLoaded(job,false)}
              style={{width:'100%',height:'100%',objectFit:'contain'}}/>:
              <span>{needsSync?'Sync failed — Retry Sync':
                job?.providerCompletedAt?'Provider done — retrieving image':
                active?'Generating image…':
                job?.status==='UNKNOWN'?'Provider outcome unverified':
                job?.status==='FAILED'?'Image attempt failed':
                card.superseded?'Needs Regeneration · previous image in History':
                card.target.fulfilled?'Bound image recorded':'Not Generated'}</span>}
          </div>
          {card.spec&&<div className="storyboard-source-summary" title={card.spec.sourceDescription}>
            <strong>Image:</strong> {card.spec.sourceDescription||card.spec.reason}
          </div>}
          <div className="shot-image-card-meta">
            <span>{staged?staged.width+' × '+staged.height+' px':'No generated dimensions'}</span>
            {staged&&<code title={staged.sha256}>SHA {staged.sha256.slice(0,12)}…</code>}
          </div>
          {previewErrors[job?.id??'']&&<div className="info error">
            {previewErrors[job!.id]}</div>}
          <div className="shot-image-card-actions">
            {job&&staged&&urls[job.id]&&<Button onClick={()=>setExpanded(job.id)}>Expand Preview</Button>}
            {mayGenerate&&<Button disabled={busy} onClick={()=>onGenerate(card.target.key)}>
              {card.superseded?'Regenerate for Current Draft':
                attempts.length?'Regenerate Image':'Generate Image'} · {card.target.layerId}
            </Button>}
            {job&&job.status==='VALIDATED'&&<label className="shot-image-select">
              <input type="checkbox" aria-label={'Select '+card.target.layerId}
                checked={selectedIds.has(job.id)}
                disabled={busy||!canApprove}
                onChange={event=>onSelect(job.id,event.target.checked)}/>
              Select
            </label>}
            {job?.status==='VALIDATED'&&<Button variant="primary"
              disabled={busy||!canApprove} onClick={()=>onApprove(job.id)}>
              Approve Image
            </Button>}
            {job&&['SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status)&&
              <span className="info">{needsSync?'Sync failed — read-only Retry Sync available':
                job.providerCompletedAt?'Provider done — retrieving image':'Auto-checking provider…'}</span>}
            {job&&needsSync&&<Button disabled={busy} onClick={()=>onCheck(job.id)}>
              Retry Sync (GET only)
            </Button>}
            {unknownForCard.length>0&&<Button
              onClick={()=>{
                setOpenDetails(previous=>new Set(previous).add(card.target.key));
                onInspectUnknown(card.target.key);
              }}>Review UNKNOWN</Button>}
            {job?.status==='QUEUED'&&onCancelQueued&&<Button disabled={busy}
              onClick={()=>onCancelQueued(job.id)}>Cancel Queued</Button>}
            {job?.staged&&previewErrors[job.id]&&<Button
              onClick={()=>onRetryPreview(job.id)}>Retry Preview</Button>}
            {job?.status==='FAILED'&&<Button onClick={()=>setOpenDetails(previous=>
              new Set(previous).add(card.target.key))}>Inspect Failure</Button>}
          </div>
          <details className="shot-image-card-details"
            open={openDetails.has(card.target.key)}
            onToggle={event=>{
              const open=event.currentTarget.open;
              setOpenDetails(previous=>{
                const next=new Set(previous);
                if(open)next.add(card.target.key);else next.delete(card.target.key);
                return next;
              });
            }}>
            <summary>Prompt · references · candidate history · diagnostics</summary>
            {openDetails.has(card.target.key)&&<>
            <div><strong>Exact target:</strong> {card.target.key}</div>
            <div><strong>Original:</strong> {card.target.path}</div>
            <div><strong>Resolved:</strong> {card.target.boundPath}</div>
            {card.spec&&<><div><strong>Style:</strong> {card.spec.styleProfileRef.id} · SHA {card.spec.styleProfileRef.sha256}</div>
              <pre className="prompt">{card.spec.prompt}</pre>
              <pre className="prompt">{JSON.stringify(card.spec.references,null,2)}</pre>
            </>}
            <CardPromptEditor card={card} onSave={onSavePrompt}/>
            {job&&<><div>Model {job.model} · Provider {job.providerTaskId??'not confirmed'} · Job {job.id}</div>
              {job.reason&&<div className="info error">{job.reason}</div>}
              {job.providerCompletedAt&&<div>Provider completed {job.providerCompletedAt} ·
                ingestion phase: {job.syncPhase??'result'}</div>}
              {job.lastSyncError&&<div className="info error" role="status">
                Sync error {job.lastSyncError.code} at {job.lastSyncError.stage}
                {' · '}{job.lastSyncError.at}. Retry Sync only rechecks the existing provider task.
              </div>}
              {job.journalRevision!==undefined&&<div>Journal revision {job.journalRevision}</div>}
              {job.approved&&<div>Approved binding: {job.approved.path} · SHA {job.approved.sha256}</div>}
              {job.approved?.provenance&&<div className="shot-image-provenance">
                <strong>Generated-image source:</strong> {job.approved.provenance.source}
                <div>Model {job.approved.provenance.model} · Provider task {job.approved.provenance.providerTaskId??'not supplied'}</div>
                <div>Prompt SHA {job.approved.provenance.promptSha256}</div>
                <div>Image SHA {job.approved.provenance.imageSha256}</div>
                <div>Approved {job.approved.provenance.approvedAt} for project use by owner</div>
                <div>Provider licensing terms have not been independently verified.</div>
              </div>}
            </>}
            {card.superseded&&<div className="info">
              Historical APPROVED image is superseded by the current Native DRAFT.
              No current binding is claimed and no paid retry happens automatically.
            </div>}
            {unknownForCard.length>0&&<section className="stack" data-testid="unknown-card-recovery">
              <strong>UNKNOWN provider outcome · possible duplicate billing</strong>
              <div>Project {projectId} · Native target {card.target.shotId}/{card.target.layerId}
                {' · '}{card.target.key} · token {card.spec?.draftIdentity.token??job?.token??'unknown'}</div>
              {unknownForCard.map(attempt=><div key={attempt.id} data-testid="unknown-attempt-evidence">
                Job {attempt.id} · provider task {attempt.providerTaskId??'not confirmed'}
                {' · '}{attempt.reason??'Paid submission outcome unverified'}
              </div>)}
              <Button disabled={busy||review?.checking||!onCheckUnknown}
                onClick={()=>onCheckUnknown?.(card.target.key)}>
                Check Existing Attempt (read-only)
              </Button>
              {review?.outcome&&<div data-testid="unknown-check-outcome">
                {review.outcome} · {review.error||(
                  review.outcome==='CHECKED_STILL_UNKNOWN'?
                    'Prior paid request is still uncertain.':'No conclusive result.')}
              </div>}
              {(review?.outcome==='CHECKED_STILL_UNKNOWN'||
                review?.outcome==='CHECK_FAILED_UNVERIFIED')&&review?.canAuthorize&&<>
                <label className="shot-image-select">
                  <input type="checkbox"
                    aria-label="Acknowledge possible duplicate billing for this exact G-Labs target"
                    checked={review.acknowledged}
                    onChange={event=>onConsentUnknown?.(card.target.key,event.target.checked)}/>
                  I understand the previous paid attempt may already have charged me.
                </label>
                <Button variant="primary" disabled={busy||!review.acknowledged||
                  !onAuthorizeUnknown||card.spec?.state!=='READY'}
                  onClick={()=>onAuthorizeUnknown?.(card.target.key)}>
                  Authorize ONE New Image Attempt (paid confirmation)
                </Button>
              </>}
            </section>}
            {attempts.filter(attempt=>attempt.id!==job?.id).length>0&&
              <div className="shot-image-card-history">
                <strong>Candidate History</strong>
                {attempts.filter(attempt=>attempt.id!==job?.id).map(attempt=>
                  <HistoryCandidate key={attempt.id} job={attempt} projectId={projectId}/>)}
              </div>}
            </>}
          </details>
        </article>;
      })}
    </div>
    {!cards.length&&<div className="info">No image Layers found in this frozen Native Shot.</div>}
    {expandedCard?.job?.staged&&urls[expandedCard.job.id]&&<div className="shot-image-lightbox"
      role="dialog" aria-label="Expanded generated image">
      <div className="shot-image-lightbox-inner">
        <Button onClick={()=>setExpanded(null)}>Close Preview</Button>
        <div>{expandedCard.target.shotId} / {expandedCard.target.layerId} ·
          {' '+expandedCard.job.staged.width} × {expandedCard.job.staged.height}</div>
        <img src={urls[expandedCard.job.id]}
          alt={'Expanded '+expandedCard.target.shotId+'/'+expandedCard.target.layerId}
          style={{maxWidth:'100%',maxHeight:'80vh',width:'auto',height:'auto',objectFit:'contain'}}/>
      </div>
    </div>}
  </div>;
}
