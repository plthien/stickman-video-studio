import {useEffect,useState} from 'react';
import {Button} from '../../components/ui';

type Studio=NonNullable<Window['studio']>;
type ImageJob=Awaited<ReturnType<Studio['glabsJobs']>>[number];
type Prepared=Awaited<ReturnType<Studio['prepareImages']>>;
export interface GalleryTarget{
  key:string;shotId:string;layerId:string;path:string;boundPath:string;
  fulfilled:boolean;managed:boolean;
}
export interface GalleryCard{
  target:GalleryTarget;
  job:ImageJob|null;
  history:ImageJob[];
  spec:Prepared['jobs'][number]|null;
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
}
const status=(card:GalleryCard)=>{
  if(card.job?.status==='APPROVED'||card.target.fulfilled)return'Approved';
  if(card.job?.status==='QUEUED')return'Queued';
  if(card.job?.status==='RUNNING'||card.job?.status==='SUBMITTED'||
    card.job?.status==='DOWNLOADED')return'Running';
  if(card.job?.status==='VALIDATED')return'Validated';
  if(card.job?.status==='FAILED')return'Failed';
  if(card.job?.status==='UNKNOWN')return'UNKNOWN';
  if(card.job?.status==='STALE')return'Stale';
  if(card.job?.status==='CANCELLED')return'Cancelled';
  return'Not Generated';
};

function HistoryCandidate({job,projectId}:{job:ImageJob;projectId:string}){
  const [expanded,setExpanded]=useState(false),[url,setUrl]=useState('');
  useEffect(()=>{
    if(!expanded||!job.staged||!window.studio)return;
    let current=true;
    void window.studio.mediaUrl(projectId,job.staged.path).then(value=>{
      if(current)setUrl(value);
    }).catch(()=>{if(current)setUrl('');});
    return()=>{current=false};
  },[expanded,projectId,job.id,job.staged?.path]);
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

/** Image-first Native Shot gallery. No Layer selection or editable rights
 * input is required to see or approve an actual provider image. */
export function ShotImageGallery({
  projectId,shotId,cards,urls,previewReady,previewErrors,previewIdentity,busy,selectedIds,
  onLoaded,onSelect,onGenerate,onApprove,onCheck,onRetryPreview,onInspectUnknown
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
        return <article className="shot-image-card" key={card.target.key}
          data-testid="shot-image-card" data-target-key={card.target.key}
          data-shot-id={card.target.shotId} data-layer-id={card.target.layerId}>
          <header className="shot-image-card-title">
            <div><strong>{card.target.layerId}</strong><small>{card.target.shotId}</small></div>
            <span className={'shot-image-status status-'+status(card).toLowerCase().replaceAll(' ','-')}>{status(card)}</span>
          </header>
          <div className="shot-image-card-stage"
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
              <span>{active?'Generating image…':
                job?.status==='UNKNOWN'?'Provider outcome unverified':
                job?.status==='FAILED'?'Image attempt failed':
                card.target.fulfilled?'Original approved image recorded':'Not Generated'}</span>}
          </div>
          <div className="shot-image-card-meta">
            <span>{staged?staged.width+' × '+staged.height+' px':'No generated dimensions'}</span>
            {staged&&<code title={staged.sha256}>SHA {staged.sha256.slice(0,12)}…</code>}
          </div>
          {previewErrors[job?.id??'']&&<div className="info error">
            {previewErrors[job!.id]}</div>}
          <div className="shot-image-card-actions">
            {job&&staged&&urls[job.id]&&<Button onClick={()=>setExpanded(job.id)}>Expand Preview</Button>}
            {mayGenerate&&<Button disabled={busy} onClick={()=>onGenerate(card.target.key)}>
              {attempts.length?'Regenerate':'Generate'} · {card.target.layerId}
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
              <span className="info">Auto-checking provider…</span>}
            {job&&job.status==='UNKNOWN'&&<Button
              onClick={()=>onInspectUnknown(card.target.key)}>Review UNKNOWN</Button>}
            {job?.staged&&previewErrors[job.id]&&<Button
              onClick={()=>onRetryPreview(job.id)}>Retry Preview</Button>}
            {job?.status==='FAILED'&&<Button onClick={()=>onCheck(job.id)}>Inspect Failure</Button>}
          </div>
          <details className="shot-image-card-details"
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
            {job&&<><div>Model {job.model} · Provider {job.providerTaskId??'not confirmed'} · Job {job.id}</div>
              {job.reason&&<div className="info error">{job.reason}</div>}
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
            {attempts.length>1&&<div className="shot-image-card-history">
              {attempts.slice(1).map(attempt=><HistoryCandidate
                key={attempt.id} job={attempt} projectId={projectId}/>)}
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
