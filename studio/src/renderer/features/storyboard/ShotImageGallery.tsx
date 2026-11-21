import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
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
  onIdentityReviewed?:(jobId:string,targetKey:string,candidateSha256:string,
    referenceSetSha256:string)=>void;
  identityReviews?:Array<{jobId?:string;targetKey:string;sha256:string;
    referenceSetSha256:string;kind:string}>;
}
const status=(card:GalleryCard)=>{
  if(card.currentlyBound??(card.target.fulfilled&&card.job?.status==='APPROVED'))return'Approved';
  if(card.target.fulfilled)return'Bound (manual)';
  if(card.job?.lastSyncError?.stage==='provider'&&!card.job.providerCompletedAt)
    return'Provider status unavailable';
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
      {url?<div className="shot-image-history-preview">
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


function IdentityReferencePreview({projectId,sourcePath,anchorId}:{
  projectId:string;sourcePath:string;anchorId:string
}){
  const [url,setUrl]=useState('');
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    let alive=true;setUrl('');setLoaded(false);
    if(!window.studio)return;
    void window.studio.mediaUrl(projectId,sourcePath).then(value=>{
      if(alive)setUrl(value);
    }).catch(()=>{if(alive)setUrl('');});
    return()=>{alive=false;};
  },[projectId,sourcePath]);
  return <div className="visual-identity-preview-reference">
    <strong>{anchorId}</strong>
    {url?<img src={url} alt={'Canonical character reference '+anchorId}
      onLoad={e=>{
        const image=e.currentTarget;
        setLoaded(image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
      }} onError={()=>setLoaded(false)}/>:<span>Reference unavailable</span>}
    <small>{loaded?'Reference loaded':'Reference not yet verified in preview'}</small>
  </div>;
}

/** One read-only preview. A mounted dialog owns keyboard focus until it closes.
 * Its source URL is the exact staged candidate already loaded in the card. */
function ImagePreviewLightbox({card,url,onClose,triggerRef,projectId,onIdentityReviewed,reviewed}:{
  card:GalleryCard;url:string;onClose:()=>void;
  triggerRef:RefObject<HTMLButtonElement|null>;projectId:string;
  onIdentityReviewed?:(jobId:string,targetKey:string,candidateSha256:string,
    referenceSetSha256:string)=>void;reviewed:boolean;
}){
  const [scale,setScale]=useState<'fit'|'original'>('fit');
  const dialogRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeRef.current?.focus();
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();onClose();
      }else if(event.key==='Tab'){
        const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)')??[]);
        if(!controls.length){event.preventDefault();return;}
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&(document.activeElement===first||
          !dialogRef.current?.contains(document.activeElement))){
          event.preventDefault();last.focus();
        }else if(!event.shiftKey&&(document.activeElement===last||
          !dialogRef.current?.contains(document.activeElement))){
          event.preventDefault();first.focus();
        }
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>{
      document.removeEventListener('keydown',handleKey);
      if(triggerRef.current?.isConnected)triggerRef.current.focus();
      else if(previousFocus?.isConnected)previousFocus.focus();
    };
  },[onClose,triggerRef]);
  const staged=card.job?.staged;
  if(!staged)return null;
  const original=scale==='original';
  const plan=card.spec?.visualReferencePlan;
  const ownerMustReview=Boolean(plan?.enabled&&card.job?.status==='VALIDATED'&&
    plan.readiness==='READY'&&card.spec?.referenceSetSha256);
  const canonical=plan?.references.filter(ref=>ref.kind==='character')??[];
  return <div className="shot-image-lightbox" role="dialog" aria-modal="true"
    aria-label="Expanded generated image" ref={dialogRef}
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="shot-image-lightbox-inner">
      <div className="shot-image-lightbox-toolbar">
        <div className="shot-image-lightbox-title">
          <strong>{card.target.shotId} / {card.target.layerId}</strong>
          <small>{staged.width} × {staged.height} px · SHA {staged.sha256}</small>
        </div>
        <div className="shot-image-lightbox-controls" role="group" aria-label="Preview scale">
          <button className="button" type="button" aria-pressed={!original}
            onClick={()=>setScale('fit')}>Fit Screen</button>
          <button className="button" type="button" aria-pressed={original}
            onClick={()=>setScale('original')}>100% Original</button>
          <button className="button" type="button" ref={closeRef}
            onClick={onClose}>Close Preview</button>
        </div>
      </div>
      <div className="visual-identity-preview-body">
        <div className={'shot-image-lightbox-viewport'+(original?' is-original':' is-fit')}
          data-testid="shot-image-preview-viewport">
          <img src={url} width={staged.width} height={staged.height}
            alt={'Expanded '+card.target.shotId+'/'+card.target.layerId}
            style={original?{
              width:staged.width+'px',height:staged.height+'px',
              maxWidth:'none',maxHeight:'none',objectFit:'contain'
            }:{
              width:'auto',height:'auto',maxWidth:'100%',maxHeight:'100%',objectFit:'contain'
            }}/>
        </div>
        {ownerMustReview&&<aside className="visual-identity-preview-aside"
          aria-label="Canonical identity comparison">
          <strong>Canonical Registry · owner identity review</strong>
          <small>Compare real master image(s) with the candidate. This is not a machine likeness check.</small>
          {canonical.map(ref=><IdentityReferencePreview key={ref.anchorId+'|'+ref.sha256}
            projectId={projectId} sourcePath={ref.sourcePath} anchorId={ref.anchorId}/>)}
          {!canonical.length&&<div className="info">Explicit no recurring character.</div>}
          <div className="info">Reference digest: {card.spec?.referenceSetSha256?.slice(0,16)}</div>
          <Button disabled={reviewed||!onIdentityReviewed}
            onClick={()=>onIdentityReviewed?.(card.job!.id,card.target.key,
              staged.sha256,card.spec!.referenceSetSha256!)}>
            {reviewed?'Identity visually checked':'I visually checked this candidate against master'}
          </Button>
        </aside>}
      </div>
    </div>
  </div>;
}

/** Image-first Native Shot gallery. No Layer selection or editable rights
 * input is required to see or approve an actual provider image. */
export function ShotImageGallery({
  projectId,shotId,cards,urls,previewReady,previewErrors,previewIdentity,busy,selectedIds,
  onLoaded,onSelect,onGenerate,onApprove,onCheck,onRetryPreview,onInspectUnknown,
  onSavePrompt,onCancelQueued,onCheckUnknown,onConsentUnknown,onAuthorizeUnknown,unknownReview,
  onIdentityReviewed,identityReviews=[]
}:ShotImageGalleryProps){
  const [expanded,setExpanded]=useState<string|null>(null);
  const previewTrigger=useRef<HTMLButtonElement|null>(null);
  const closePreview=useCallback(()=>setExpanded(null),[]);
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
        // Historical UNKNOWN from a previous Native token remains in History,
        // but cannot lock an unrelated current DRAFT request.
        const currentToken=card.spec?.draftIdentity.token??job?.token;
        const unknown=Boolean(attempts.some(attempt=>
          attempt.token===currentToken&&attempt.status==='UNKNOWN'));
        const mayGenerate=card.target.managed&&!card.target.fulfilled&&
          card.spec?.state==='READY'&&!active&&!unknown&&
          (!job||job.status!=='APPROVED');
        const needsSync=Boolean(job?.providerTaskId&&job.lastSyncError&&
          ['SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status));
        const statusUnavailable=Boolean(needsSync&&!job?.providerCompletedAt&&
          job?.lastSyncError?.stage==='provider');
        const ingestionBlocked=Boolean(needsSync&&job?.providerCompletedAt&&active);
        const unknownForCard=attempts.filter(attempt=>
          attempt.token===currentToken&&attempt.status==='UNKNOWN');
        const review=unknownReview?.targetKey===card.target.key?unknownReview:null;
        return <article className="shot-image-card" key={card.target.key}
          data-testid="shot-image-card" data-target-key={card.target.key}
          data-shot-id={card.target.shotId} data-layer-id={card.target.layerId}>
          <header className="shot-image-card-title">
            <div><strong>{card.target.layerId}</strong><small>{card.target.shotId}</small></div>
            <span className={'shot-image-status status-'+status(card).toLowerCase().replaceAll(' ','-')}>{status(card)}</span>
          </header>
          <div className={'shot-image-card-stage'+(!staged?' is-placeholder':'')}
            data-testid="shot-image-stage">
            {job&&staged&&urls[job.id]?<button className="shot-image-thumbnail-button"
              type="button"
              aria-label={'Expand image '+card.target.shotId+'/'+card.target.layerId}
              title="Open image preview"
              disabled={Boolean(previewErrors[job.id])||
                previewReady[job.id]!==previewIdentity(job)}
              onClick={event=>{
                previewTrigger.current=event.currentTarget;
                setExpanded(job.id);
              }}>
              <img key={previewIdentity(job)} src={urls[job.id]}
                alt={'Shot gallery '+card.target.shotId+'/'+card.target.layerId}
                width={staged.width} height={staged.height}
                loading="eager" decoding="async"
                onLoad={event=>{
                  const image=event.currentTarget;
                  onLoaded(job,image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
                }}
                onError={()=>onLoaded(job,false)}
                style={{width:'100%',height:'100%',objectFit:'contain'}}/>
              </button>:
              <span>{statusUnavailable?'Provider status unavailable — Retry Sync (GET only)':
                needsSync?'Sync failed — Retry Sync (GET only)':
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
            {mayGenerate&&<Button disabled={busy} onClick={()=>onGenerate(card.target.key)}>
              {card.superseded?'Regenerate for Current Draft (Paid)':
                attempts.length?'Regenerate Image (Paid)':'Generate Image'} · {card.target.layerId}
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
              <span className="info">{statusUnavailable?
                'Provider status unavailable — use Retry Sync (GET only)':
                needsSync?'Sync failed — read-only Retry Sync available':
                job.providerCompletedAt?'Provider done — retrieving image':'Auto-checking provider…'}</span>}
            {needsSync&&<span className="info" data-testid="glabs-sync-evidence">
              Job {job!.id} · provider task {job!.providerTaskId} ·
              {job!.syncPhase??'provider'} · {job!.lastSyncError!.code} · {job!.lastSyncError!.at}
            </span>}
            {ingestionBlocked&&<div className="info" data-testid="glabs-ingestion-regenerate-blocked">
              Paid regeneration blocked: the provider task already completed and may have been charged.
              Retry Sync (GET only) can recover its original image without another paid POST.
              Abandoning ingestion requires a separate backend-confirmed duplicate-charge workflow.
            </div>}
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
            {card.spec?.visualReferencePlan?.enabled&&<div className="info"
              data-testid="character-card-binding">
              <strong>Characters · Canonical Registry:</strong>{' '}
              {card.spec.visualReferencePlan.characterIds.join(', ')||'No recurring character'}
              <div>Reference readiness: {card.spec.visualReferencePlan.readiness}</div>
              <div>Required/optional references: {card.spec.visualReferencePlan.references.filter(r=>r.required).length}/
                {card.spec.visualReferencePlan.references.filter(r=>!r.required).length} ·
                total provider refs {card.spec.references.length}/8</div>
              {card.spec.visualReferencePlan.references.map(ref=><div key={ref.kind+'|'+ref.anchorId}>
                {ref.kind} · {ref.anchorId} · SHA {ref.sha256.slice(0,16)} ·
                {ref.required?'required':'optional'}
              </div>)}
              {card.spec.visualReferencePlan.sourceSnapshotSha256&&<div>
                Continuity source digest {card.spec.visualReferencePlan.sourceSnapshotSha256.slice(0,16)}
              </div>}
            </div>}
            <CardPromptEditor card={card} onSave={onSavePrompt}/>
            {job&&<><div>Model {job.model} · Provider {job.providerTaskId??'not confirmed'} · Job {job.id}</div>
              {job.reason&&<div className="info error">{job.reason}</div>}
              {job.providerCompletedAt&&<div>Provider completed {job.providerCompletedAt} ·
                ingestion phase: {job.syncPhase??'result'}</div>}
              {job.sourceMime&&<div>Decoded provider format: {job.sourceMime}</div>}
              {job.mimeDiagnostic&&<div className="info" data-testid="glabs-mime-diagnostic">
                Source MIME: declared {job.mimeDiagnostic.declared} · verified {job.mimeDiagnostic.detected}
                {' · '}{job.mimeDiagnostic.classification} (decoder-verified)
              </div>}
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
    {expandedCard?.job?.staged&&urls[expandedCard.job.id]&&
      !previewErrors[expandedCard.job.id]&&
      previewReady[expandedCard.job.id]===previewIdentity(expandedCard.job)&&
      <ImagePreviewLightbox key={expandedCard.job.id}
        card={expandedCard} url={urls[expandedCard.job.id]}
        projectId={projectId}
        onIdentityReviewed={onIdentityReviewed}
        reviewed={identityReviews.some(review=>review.kind==='CANDIDATE'&&
          review.jobId===expandedCard.job!.id&&
          review.sha256===expandedCard.job!.staged?.sha256&&
          review.referenceSetSha256===expandedCard.spec?.referenceSetSha256)}
        onClose={closePreview} triggerRef={previewTrigger}/>}
  </div>;
}
