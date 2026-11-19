import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select,Textarea} from '../../components/ui';
import type {ImageJobSpec} from '../../../main/imagePreparation.js';
import {LegacyStoryboardWorkspace} from './LegacyStoryboardWorkspace';

type Studio=NonNullable<Window['studio']>;
type Pending=Awaited<ReturnType<Studio['pendingMedia']>>;
type Prepared=Awaited<ReturnType<Studio['prepareImages']>>;
type ImageJob=Awaited<ReturnType<Studio['glabsJobs']>>[number];
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const refs=(raw:string)=>raw.split(',').map(v=>v.trim()).filter(Boolean);

/** Owner-friendly single-target queue; the unchanged manual workflow is available in Advanced. */
export function StoryboardWorkspace(){
  const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState();
  const id=native?.project.id;
  const [pending,setPending]=useState<Pending|null>(null);
  const [prepared,setPrepared]=useState<Prepared|null>(null);
  const [jobs,setJobs]=useState<ImageJob[]>([]);
  const [config,setConfig]=useState<{model:string;aspectRatio:string}|null>(null);
  const [selectedShot,setSelectedShot]=useState(''),[selectedKey,setSelectedKey]=useState('');
  const [draftPrompts,setDraftPrompts]=useState<Record<string,string>>({});
  const [draftReferences,setDraftReferences]=useState<Record<string,string>>({});
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [previewReady,setPreviewReady]=useState<Record<string,string>>({});
  const [previewErrors,setPreviewErrors]=useState<Record<string,string>>({});
  const [previewAttempts,setPreviewAttempts]=useState<Record<string,number>>({});
  const [rights,setRights]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [advanced,setAdvanced]=useState(false);
  const refresh=async(scope=captureProjectSession())=>{
    if(!scope||!window.studio)return;
    const studio=window.studio;
    const [nextPending,nextJobs,nextConfig,nextPrepared]=await Promise.all([
      studio.pendingMedia(scope.projectId),
      studio.glabsJobs(scope.projectId),
      studio.glabsSettings(),
      studio.prepareImages?.(scope.projectId)??Promise.resolve(null)
    ]);
    const nextUrls:Record<string,string>={},nextErrors:Record<string,string>={};
    await Promise.all(nextJobs.filter(job=>job.staged).map(async job=>{
      try{nextUrls[job.id]=await studio.mediaUrl(scope.projectId,job.staged!.path);}
      catch{nextErrors[job.id]='Generated image preview URL is unavailable.';}
    }));
    if(!isCurrentProjectSession(scope))return;
    setPending(nextPending);setJobs(nextJobs);setConfig(nextConfig.config);
    setPrepared(nextPrepared);setUrls(nextUrls);
    setPreviewErrors(previous=>({...previous,...nextErrors}));
  };
  useEffect(()=>{
    const scope=captureProjectSession();
    setPending(null);setPrepared(null);setJobs([]);setConfig(null);setUrls({});
    setPreviewReady({});setPreviewErrors({});setPreviewAttempts({});setError('');setRights('');
    if(scope&&window.studio)void refresh(scope).catch(e=>{if(isCurrentProjectSession(scope))setError(message(e));});
    // The session guard prevents async responses from being applied to another project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,native?.external?.native?.revision]);
  useEffect(()=>{setDraftPrompts({});setDraftReferences({});setSelectedShot('');setSelectedKey('');setAdvanced(false);},[id]);
  const shots=Array.isArray(pending?.after?.shots)?pending.after.shots as Array<Record<string,unknown>>:[];
  const shotIds=shots.filter(row=>typeof row.id==='string').map(row=>row.id as string);
  const shotId=shotIds.includes(selectedShot)?selectedShot:shotIds[0]??'';
  const imageTargets=pending?.missing.filter(row=>row.kind==='image')??[];
  const shotTargets=imageTargets.filter(row=>row.shotId===shotId);
  const target=shotTargets.find(row=>row.key===selectedKey)??shotTargets[0]??null;
  const spec=prepared?.jobs.find(row=>row.targetKey===target?.key)??null;
  const identity=[id??'',pending?.token??'',spec?.draftIdentity.creativeFingerprint??'',target?.key??''].join('|');
  const ownerPrompt=draftPrompts[identity]??spec?.prompt??'';
  const ownerRefs=draftReferences[identity]??spec?.references.join(',')??'';
  const dirty=(draftPrompts[identity]!==undefined&&draftPrompts[identity]!==spec?.prompt)||
    (draftReferences[identity]!==undefined&&draftReferences[identity]!==spec?.references.join(','));
  const ready=spec?.state==='READY'&&!dirty;
  const shotJobs=jobs.filter(job=>job.shotId===shotId);
  const previewIdentity=(job:ImageJob)=>[id,job.id,job.token,job.staged?.sha256??'-',urls[job.id]??'-',previewAttempts[job.id]??0].join('|');
  const prepare=async()=>{
    const scope=captureProjectSession();if(!scope||!window.studio?.prepareImages)return;
    setBusy(true);setError('');
    try{
      const next=await window.studio.prepareImages(scope.projectId);
      if(isCurrentProjectSession(scope))setPrepared(next);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const saveOverride=async()=>{
    const scope=captureProjectSession();if(!scope||!spec||!window.studio?.saveImagePrompt)return;
    setBusy(true);setError('');
    try{
      const next=await window.studio.saveImagePrompt(scope.projectId,{
        targetKey:spec.targetKey,fingerprint:spec.draftIdentity.creativeFingerprint,
        prompt:ownerPrompt.trim(),references:refs(ownerRefs)
      });
      if(isCurrentProjectSession(scope))setPrepared(next);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const generate=async()=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    if(!target||!spec||!ready||!config||!ownerPrompt.trim()){
      setError(spec?.reason||'Exact source-backed image requirement is not ready.');return;
    }
    const attempts=jobs.filter(job=>job.targetKey===target.key&&job.token===pending?.token);
    if(attempts.some(job=>['SUBMITTED','RUNNING','DOWNLOADED','QUEUED'].includes(job.status))){
      setError('An image job is already active for this exact target. Resume or inspect it.');return;
    }
    setBusy(true);setError('');
    try{
      // One click = at most ONE paid submission. Main owns Electron paid dialog,
      // rights/SHA validation, draft fingerprint, UNKNOWN and no-retry semantics.
      await window.studio.glabsGenerate(scope.projectId,{targetKey:target.key,prompt:ownerPrompt.trim(),
        model:config.model,aspectRatio:config.aspectRatio,references:refs(ownerRefs),authorized:true,
        regenerate:attempts.length>0,acknowledgeUnknown:attempts.some(job=>job.status==='UNKNOWN')});
      if(isCurrentProjectSession(scope))await refresh(scope);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const poll=async(jobId:string)=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    setBusy(true);setError('');
    try{await window.studio.glabsPoll(scope.projectId,jobId);if(isCurrentProjectSession(scope))await refresh(scope);}
    catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const approve=async(jobId:string)=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    const job=jobs.find(item=>item.id===jobId);
    if(!job||job.status!=='VALIDATED'||!job.staged||!urls[job.id]||previewReady[job.id]!==previewIdentity(job)){
      setError('GLABS_PREVIEW_NOT_VERIFIED: inspect the exact current image before approval.');return;
    }
    if(!rights.trim()){setError('Owner source/rights attestation required before approval.');return;}
    if(!window.confirm('I have inspected the displayed current image. Approve this exact image revision and bind only its Native target?'))return;
    setBusy(true);setError('');
    try{
      await window.studio.glabsApprove(scope.projectId,jobId,rights.trim());
      if(!isCurrentProjectSession(scope))return;
      await refresh(scope);
      const next=await window.studio.projectState(scope.projectId);
      if(setNativeIfSessionCurrent(scope,next))showNotice('Inspected image approved and bound to exact Native target.');
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const counts={ready:prepared?.jobs.filter(j=>j.state==='READY').length??0,
    review:prepared?.jobs.filter(j=>j.state==='NEEDS_OWNER_REVIEW').length??0,
    blocked:prepared?.jobs.filter(j=>j.state==='BLOCKED').length??0};
  return <div className="stack" data-testid="storyboard-automation">
    <Card>
      <CardHeader title="Storyboard & Images" hint="Prepare → Review → Generate → Inspect / Approve → Exact Native Binding" action={<Badge tone={native?.nativeDraft?'mint':'amber'}>{native?.nativeDraft?'DRAFT':'NO DRAFT'}</Badge>}/>
      <div className="info"><strong>Current Project Style:</strong> {native?.project.style??'No project'} (read-only) · Video {native?.brief.ratio??'9:16'} · Native DRAFT {native?.nativeDraft?'r'+native.nativeDraft.revision:'not available'}</div>
      <div className="info">Creative review: {native?.nativeDraft?.reviewStatus??'not verified'} · Unresolved findings are retained; media observations remain deferred.</div>
      <div className="info" data-testid="image-queue-counts">
        {prepared?.shotCount??shotIds.length} Shots · {prepared?.imageOccurrences??imageTargets.length} missing image occurrences · {prepared?.uniquePaths??new Set(imageTargets.map(item=>item.path)).size} distinct paths · READY {counts.ready} · Needs owner review {counts.review} · Blocked {counts.blocked}
      </div>
      <div className="actions"><Button disabled={!id||busy||!native?.nativeDraft} onClick={()=>void prepare()}>Prepare Images (read-only; no paid requests)</Button></div>
      {shotIds.length?<div className="shot-grid">{shotIds.map(value=><button key={value} className={shotId===value?'selected':''} onClick={()=>{setSelectedShot(value);setSelectedKey('');}}>
        <div className="scene-thumb"><strong>{value}</strong></div><div><strong>{value}</strong><small>{imageTargets.filter(t=>t.shotId===value).length} missing image layers</small></div>
      </button>)}</div>:<div className="info">No Native DRAFT shots. Stage an approved source-grounded Native Author artifact first.</div>}
    </Card>
    <Card>
      <CardHeader title={shotId?shotId+' · Image assets':'Image assets'} hint="Choose an image layer — style, prompt, model, ratio and technical IDs are inherited."/>
      {shotTargets.length?<div className="stack" aria-label="Native image asset list">{shotTargets.map(item=>{
        const row=prepared?.jobs.find(x=>x.targetKey===item.key);
        const current=jobs.find(j=>j.token===pending?.token&&j.targetKey===item.key);
        return <button key={item.key} className={target?.key===item.key?'selected':''} style={{padding:10,textAlign:'left'}}
          onClick={()=>{setSelectedKey(item.key);setError('');}}>
          <strong>{row?.sourceDescription.slice(0,115)||item.layerId||'Source description unavailable'}</strong>
          <div className="info">{row?.state??'Preparing'} · {current?.status??'Not generated'} · {row?.occurrencesAtPath??1} same-path occurrence(s), not shared jobs</div>
          {row?.reason&&<div className="info error">{row.reason}</div>}
        </button>;
      })}</div>:<div className="info" data-testid="glabs-image-unavailable">{!pending?'No Native DRAFT media candidate staged.':imageTargets.length?'No missing images in this Shot.':'All required image occurrences are fulfilled.'}</div>}
      {spec&&<div className="stack">
        <div className="info"><strong>Source image description:</strong> {spec.sourceDescription||spec.reason}</div>
        <div className="info"><strong>Image Prompt:</strong> {spec.ownerEdited?'Owner-confirmed target override':'Deterministically compiled from approved style and exact Native source'} · {spec.state}{spec.reason?' · '+spec.reason:''}</div>
        {spec.prompt&&<details><summary>Review complete Image Prompt and provenance</summary>
          <pre className="prompt">{spec.prompt}</pre>
          <pre className="prompt">{JSON.stringify(spec.sourceRows,null,2)}</pre>
        </details>}
        {spec.styleAnchors.length>0&&<Field label="Verified B4 style reference"><Select value={refs(ownerRefs).find(value=>value.startsWith('@modeb/b4/'))??''}
          onChange={event=>setDraftReferences(old=>({...old,[identity]:event.target.value}))}>
          <option value="">Choose a packaged B4 approved illustration</option>
          {spec.styleAnchors.map(anchor=><option key={anchor.id} value={'@modeb/b4/'+anchor.id}>{anchor.id} · {anchor.label.slice(0,85)}</option>)}
        </Select></Field>}
        <div className="info">G-Labs model: {config?.model??'Configure Settings first'} · Output ratio: {config?.aspectRatio??'unknown'} · Price: unavailable · Paid submissions authorized: maximum 1 per click.</div>
        {dirty&&<div className="info">Save this target's edit before paid generation. Other Shot/Layer prompts remain unchanged.</div>}
        <div className="actions"><Button variant="primary" disabled={busy||!config||!ready||!ownerPrompt.trim()} onClick={()=>void generate()}>Generate Selected (1 paid request)</Button></div>
      </div>}
      {shotJobs.some(job=>job.status==='VALIDATED')&&<Field label="Owner-confirmed rights/source"><Input value={rights} onChange={event=>setRights(event.target.value)} placeholder="Owned/licensed provider image and source"/></Field>}
      {shotJobs.length>0&&<div className="info">Actual generated-image previews (never automatically approved)</div>}
      {shotJobs.map(job=><Card key={job.id}>
        <CardHeader title={job.layerId+' · '+job.status} hint={job.model+' / '+job.aspectRatio}/>
        <div className="info">Exact target: {job.shotId}/{job.layerId} · {job.targetPath} · {job.reason??''}</div>
        {job.staged&&urls[job.id]&&<img key={previewIdentity(job)} src={urls[job.id]} alt={'G-Labs candidate for '+job.shotId+'/'+job.layerId}
          style={{maxWidth:'100%',maxHeight:260,objectFit:'contain'}}
          onLoad={event=>{
            if(event.currentTarget.complete&&event.currentTarget.naturalWidth>0&&event.currentTarget.naturalHeight>0){
              setPreviewReady(old=>({...old,[job.id]:previewIdentity(job)}));
              setPreviewErrors(old=>{const next={...old};delete next[job.id];return next;});
            }else{setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
              setPreviewErrors(old=>({...old,[job.id]:'Generated image did not decode to visible pixels.'}));}
          }}
          onError={()=>{setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
            setPreviewErrors(old=>({...old,[job.id]:'Generated image preview failed to load.'}));}}/>}
        {job.status==='VALIDATED'&&previewReady[job.id]!==previewIdentity(job)&&<div className="info">Preview not verified — approval is blocked until the actual image loads.</div>}
        {previewErrors[job.id]&&<div className="info error" role="alert">{previewErrors[job.id]}</div>}
        {job.staged&&previewErrors[job.id]&&<Button disabled={busy} onClick={()=>{
          setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
          setPreviewErrors(old=>{const next={...old};delete next[job.id];return next;});
          setPreviewAttempts(old=>({...old,[job.id]:(old[job.id]??0)+1}));
          const scope=captureProjectSession();
          if(scope)void refresh(scope).catch(e=>{if(isCurrentProjectSession(scope))setError(message(e));});
        }}>Retry image preview</Button>}
        <div className="actions">
          {['SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(job.status)&&<Button disabled={busy} onClick={()=>void poll(job.id)}>Resume / Check status (read-only)</Button>}
          {job.status==='VALIDATED'&&<Button variant="primary" disabled={busy||!rights.trim()||!urls[job.id]||previewReady[job.id]!==previewIdentity(job)} onClick={()=>void approve(job.id)}>Approve inspected image + bind</Button>}
          {job.status==='QUEUED'&&<Button disabled={busy} onClick={async()=>{
            const scope=captureProjectSession();if(!scope||!window.studio||!window.confirm('Cancel this queued request before paid submission?'))return;
            try{await window.studio.glabsCancelQueued(scope.projectId,job.id);if(isCurrentProjectSession(scope))await refresh(scope);}
            catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
          }}>Cancel queued attempt</Button>}
        </div>
        {job.approved&&<div className="info">Approved image: {job.approved.path} · SHA256 {job.approved.sha256}. This does not mean other occurrences are bound.</div>}
      </Card>)}
      {error&&<div className="info error" role="alert">{error}</div>}
      {spec&&<details><summary>Advanced · target-specific edits and verified references</summary>
        <div className="info">Native target: {spec.shotId}/{spec.layerId} · {spec.path}</div>
        <div className="info">Style authority: {spec.styleProfileRef.path} · SHA256 {spec.styleProfileRef.sha256} · Creative fingerprint {spec.draftIdentity.creativeFingerprint}</div>
        <Field label="Edit image prompt for current target only"><Textarea value={ownerPrompt} onChange={event=>setDraftPrompts(old=>({...old,[identity]:event.target.value}))} placeholder={spec.reason||'Prepared prompt appears automatically'}/></Field>
        <Field label="Approved image references (advanced)"><Input value={ownerRefs} onChange={event=>setDraftReferences(old=>({...old,[identity]:event.target.value}))} placeholder="Only exact approved asset paths"/></Field>
        <Button disabled={busy||ownerPrompt.trim().length<12} onClick={()=>void saveOverride()}>Save target-specific prompt/references</Button>
      </details>}
    </Card>
    <details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}>
      <summary>Advanced · manual Import & Bind, raw Native ledgers and diagnostics</summary>
      {advanced&&<LegacyStoryboardWorkspace/>}
    </details>
  </div>;
}
