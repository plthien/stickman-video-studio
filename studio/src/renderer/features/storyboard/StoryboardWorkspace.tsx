/* eslint-disable react-hooks/exhaustive-deps -- all async refreshes are guarded by the captured project session */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select,Textarea} from '../../components/ui';
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
  // A single in-flight submission or sequential owner-started batch never
  // blocks Shot/Layer navigation. Paid requests remain one-at-a-time.
  const paidInFlight=useRef(false);
  const batchSession=useRef<{cancelled:boolean;projectId:string;token:string}|null>(null);
  const [submission,setSubmission]=useState<{key:string;label:string}|null>(null);
  const [batchProgress,setBatchProgress]=useState<{
    state:'running'|'complete'|'stopped';total:number;sent:number;
    current:string;reason:string
  }|null>(null);
  // UNKNOWN consent belongs to one exact project/session/Shot/Layer/attempt
  // identity. It is neither persisted nor reused after selection changes.
  const [checkedUnknown,setCheckedUnknown]=useState('');
  const [acknowledgedUnknown,setAcknowledgedUnknown]=useState('');
  const recoveryEpoch=useRef(0);
  const recoveryIdentityRef=useRef('');
  const refresh=async(scope=captureProjectSession())=>{
    if(!scope||!window.studio)return;
    const studio=window.studio;
    // Resolve the Native journal first: a rejected pendingMedia must be
    // handled even if a later IPC method is missing or throws synchronously.
    // Show corruption as an explicit error instead of an empty queue.
    const nextPending=await studio.pendingMedia(scope.projectId)
      .catch(cause=>{throw new Error('Pending media ERROR: '+message(cause));});
    const [nextJobs,nextConfig,nextPrepared]=await Promise.all([
      studio.glabsJobs(scope.projectId),
      studio.glabsSettings(),
      studio.prepareImages?.(scope.projectId)??Promise.resolve(null)
    ]);
    // Avoid N image URL IPC roundtrips for projects with hundreds of jobs.
    // Only the selected candidate's preview is resolved on demand below.
    if(!isCurrentProjectSession(scope))return;
    setPending(nextPending);setJobs(nextJobs);setConfig(nextConfig.config);
    setPrepared(nextPrepared);
    return{pending:nextPending,jobs:nextJobs};
  };
  useEffect(()=>{
    const scope=captureProjectSession();
    setPending(null);setPrepared(null);setJobs([]);setConfig(null);setUrls({});
    setPreviewReady({});setPreviewErrors({});setPreviewAttempts({});setError('');setRights('');setBusy(false);
    setSubmission(null);setBatchProgress(null);
    if(scope&&window.studio)void refresh(scope).catch(e=>{if(isCurrentProjectSession(scope))setError(message(e));});
    // The session guard prevents async responses from being applied to another project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,native?.external?.native?.revision]);
  useEffect(()=>()=>{if(batchSession.current)batchSession.current.cancelled=true;},[]);
  useEffect(()=>{
    if(batchSession.current)batchSession.current.cancelled=true;
    setDraftPrompts({});setDraftReferences({});setSelectedShot('');setSelectedKey('');
    setAdvanced(false);setUrls({});
  },[id]);
  const candidateAfter=pending?.after as {shots?:unknown[]}|undefined;
  const shots=Array.isArray(candidateAfter?.shots)?candidateAfter.shots as Array<Record<string,unknown>>:[];
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
  const selectedAttempts=jobs.filter(job=>job.targetKey===target?.key&&job.token===pending?.token);
  const unknownAttempts=selectedAttempts.filter(job=>job.status==='UNKNOWN');
  const hasUncertainAttempt=unknownAttempts.length>0;
  const recoveryIdentity=hasUncertainAttempt&&target?[
    id??'',pending?.token??'',target.shotId,target.layerId,target.path,
    spec?.draftIdentity.creativeFingerprint??'NO_PREPARED_FINGERPRINT',
    spec?.styleProfileRef.sha256??'NO_STYLE_AUTHORITY',
    ...unknownAttempts.map(job=>job.id+':'+(job.providerTaskId??'')).sort()
  ].join('|'):'';
  // Layout effect establishes identity before the freshly displayed UNKNOWN
  // controls can be clicked. A passive effect can invalidate a just-started
  // polling request after the click, losing the reconciliation result.
  useLayoutEffect(()=>{
    recoveryIdentityRef.current=recoveryIdentity;
    recoveryEpoch.current+=1;
    setCheckedUnknown('');
    setAcknowledgedUnknown('');
  },[recoveryIdentity,selectedShot,selectedKey]);
  const recoveryChecked=Boolean(recoveryIdentity&&checkedUnknown===recoveryIdentity);
  const recoveryAcknowledged=Boolean(recoveryChecked&&acknowledgedUnknown===recoveryIdentity);
  const hasActiveAttempt=selectedAttempts.some(job=>['SUBMITTED','RUNNING','DOWNLOADED','QUEUED'].includes(job.status));
  const hasPreviousAttempt=selectedAttempts.length>0;
  const canSubmit=Boolean(ready&&!hasUncertainAttempt&&!hasActiveAttempt&&
    !submission&&!batchSession.current);
  // A bulk click covers only never-attempted, source-backed READY targets.
  // FAILED/UNKNOWN/staged/approved jobs are excluded; none is retried.
  const eligibleBulk=prepared&&pending&&prepared.token===pending.token&&config?
    prepared.jobs.filter(item=>item.state==='READY'&&Boolean(item.prompt.trim())&&
      imageTargets.some(candidate=>candidate.key===item.targetKey&&
        candidate.shotId===item.shotId&&candidate.layerId===item.layerId&&
        candidate.path===item.path)&&
      !jobs.some(job=>job.token===pending?.token&&job.targetKey===item.targetKey)&&
      draftPrompts[[id??'',pending?.token??'',item.draftIdentity.creativeFingerprint,
        item.targetKey].join('|')]===undefined&&
      draftReferences[[id??'',pending?.token??'',item.draftIdentity.creativeFingerprint,
        item.targetKey].join('|')]===undefined):[];
  const shotJobs=jobs.filter(job=>job.shotId===shotId&&job.targetKey===target?.key&&job.token===pending?.token);
  // G-Labs returns newest jobs first. Keep history, but show only the current
  // selected target and latest candidate on the main screen.
  const visibleJobs=shotJobs.slice(0,1);
  const previousJobs=shotJobs.slice(1);
  const selectedPreview=visibleJobs[0];
  useEffect(()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!selectedPreview?.staged||
      urls[selectedPreview.id]||previewErrors[selectedPreview.id])return;
    let current=true;
    const job=selectedPreview;
    void window.studio.mediaUrl(scope.projectId,job.staged!.path).then(url=>{
      if(current&&isCurrentProjectSession(scope))setUrls(previous=>({...previous,[job.id]:url}));
    }).catch(()=>{
      if(current&&isCurrentProjectSession(scope))setPreviewErrors(previous=>({
        ...previous,[job.id]:'Generated image preview URL is unavailable.'
      }));
    });
    return()=>{current=false};
  },[id,selectedPreview?.id,selectedPreview?.staged?.path,
    selectedPreview&&urls[selectedPreview.id],
    selectedPreview&&previewErrors[selectedPreview.id],
    selectedPreview&&previewAttempts[selectedPreview.id]]);
  const previewIdentity=(job:ImageJob)=>[id,job.id,job.token,job.staged?.sha256??'-',urls[job.id]??'-',previewAttempts[job.id]??0].join('|');
  const prepare=async()=>{
    const scope=captureProjectSession();if(!scope||!window.studio?.prepareImages)return;
    setBusy(true);setError('');
    try{
      const next=await window.studio.prepareImages(scope.projectId,true);
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
        styleSha256:spec.styleProfileRef.sha256,
        prompt:ownerPrompt.trim(),references:refs(ownerRefs)
      });
      if(isCurrentProjectSession(scope))setPrepared(next);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const checkUnknownAttempts=async()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!recoveryIdentity||!unknownAttempts.length||busy)return;
    const identity=recoveryIdentity,epoch=recoveryEpoch.current;
    setBusy(true);setError('');setCheckedUnknown('');setAcknowledgedUnknown('');
    try{
      // Only existing read-only polling routes. Never trigger a provider POST.
      const outcomes=await Promise.all(unknownAttempts.map(job=>
        window.studio!.glabsPoll(scope.projectId,job.id)));
      if(!isCurrentProjectSession(scope)||recoveryEpoch.current!==epoch||
        recoveryIdentityRef.current!==identity)return;
      const refreshed=await refresh(scope);
      // A late provider response is not authoritative if the persisted job
      // journal now says RUNNING/FAILED or the set of UNKNOWN jobs changed.
      const previousIds=unknownAttempts.map(job=>job.id).sort();
      const persistedIds=refreshed?.jobs.filter(job=>job.token===pending?.token&&
        job.targetKey===target?.key&&job.status==='UNKNOWN').map(job=>job.id).sort();
      const stillUnknown=Boolean(refreshed?.pending?.token===pending?.token&&
        persistedIds&&JSON.stringify(persistedIds)===JSON.stringify(previousIds));
      if(stillUnknown&&isCurrentProjectSession(scope)&&
        recoveryEpoch.current===epoch&&recoveryIdentityRef.current===identity&&
        outcomes.every(job=>job!==null&&typeof job==='object'&&
          'status' in job&&job.status==='UNKNOWN'))
        setCheckedUnknown(identity);
    }catch(e){if(isCurrentProjectSession(scope)&&recoveryEpoch.current===epoch)
      setError('Checking existing G-Labs attempt failed: '+message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const generate=async(recoverUnknown=false)=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||busy||paidInFlight.current||batchSession.current)return;
    if(!target||!spec||!ready||!config||!ownerPrompt.trim()){
      setError(spec?.reason||'Exact source-backed image requirement is not ready.');return;
    }
    const attempts=jobs.filter(job=>job.targetKey===target.key&&job.token===pending?.token);
    const uncertain=attempts.some(job=>job.status==='UNKNOWN');
    if(uncertain&&!recoverUnknown){
      setError('GLABS_UNKNOWN_MAY_HAVE_CHARGED: check the existing attempt before authorizing another potentially paid image.');return;
    }
    if(recoverUnknown&&(!uncertain||!recoveryAcknowledged||
      recoveryIdentityRef.current!==recoveryIdentity)){
      setError('GLABS_UNKNOWN_ACK_REQUIRED: first check the existing attempt and explicitly acknowledge possible duplicate billing for this exact target.');return;
    }
    if(attempts.some(job=>['SUBMITTED','RUNNING','DOWNLOADED','QUEUED'].includes(job.status))){
      setError('An image job is already active for this exact target. Resume or inspect it.');return;
    }
    // The clearly labeled Generate/Regenerate action is already an explicit
    // one-request authorization. Never show a redundant browser confirmation.
    // UNKNOWN attempts still require the separate recovery flow.
    // Consume consent BEFORE awaiting the Electron dialog; a second click
    // cannot reuse consent, even if the owner cancels that paid confirmation.
    if(recoverUnknown){setCheckedUnknown('');setAcknowledgedUnknown('');}
    paidInFlight.current=true;
    const selectedTargetKey=target.key;
    setBatchProgress(null);
    setSubmission({key:selectedTargetKey,label:target.shotId+'/'+target.layerId});
    setError('');
    try{
      // One owner click = at most one paid POST, with no automatic retry.
      // Show feedback immediately; the IPC request may take time.
      await window.studio.glabsGenerate(scope.projectId,{targetKey:selectedTargetKey,prompt:ownerPrompt.trim(),
        model:config.model,aspectRatio:config.aspectRatio,references:refs(ownerRefs),authorized:true,
        regenerate:attempts.length>0,acknowledgeUnknown:recoverUnknown,
        preparedFingerprint:spec.draftIdentity.creativeFingerprint});
      if(isCurrentProjectSession(scope))await refresh(scope);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{
      paidInFlight.current=false;
      if(isCurrentProjectSession(scope))setSubmission(null);
    }
  };
  const generateAll=async()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!pending||!config||!eligibleBulk.length||
      busy||paidInFlight.current||batchSession.current)return;
    // The button displays the exact number of individually billed requests.
    // It is the owner's explicit one-time authorization for this frozen queue.
    const batch={cancelled:false,projectId:scope.projectId,token:pending.token};
    batchSession.current=batch;
    paidInFlight.current=true;
    const queue=[...eligibleBulk];
    const selectedConfig={...config};
    let sent=0;
    let stopReason='';
    setError('');
    setBatchProgress({state:'running',total:queue.length,sent:0,current:'Preparing queue',reason:''});
    try{
      for(const item of queue){
        if(batch.cancelled||!isCurrentProjectSession(scope)){stopReason='Stopped by owner or project change.';break;}
        setSubmission({key:item.targetKey,label:item.shotId+'/'+item.layerId});
        setBatchProgress({state:'running',total:queue.length,sent,
          current:item.shotId+'/'+item.layerId,reason:''});
        // Verify the exact Native queue identity immediately before each
        // attempt. Backend repeats frozen fingerprint/style/reference/rights
        // validation and rejects creative drift before any provider POST.
        const current=await window.studio.pendingMedia(scope.projectId);
        if(batch.cancelled||!isCurrentProjectSession(scope)){
          stopReason='Stopped by owner or project change.';break;
        }
        if(!current||current.token!==batch.token||!current.missing.some(candidate=>
          candidate.key===item.targetKey&&candidate.kind==='image'&&
          candidate.shotId===item.shotId&&candidate.layerId===item.layerId&&
          candidate.path===item.path)){
          stopReason='Native DRAFT changed or target already fulfilled. No further requests were sent.';break;
        }
        const response=await window.studio.glabsGenerate(scope.projectId,{
          targetKey:item.targetKey,prompt:item.prompt,model:selectedConfig.model,
          aspectRatio:selectedConfig.aspectRatio,references:[...item.references],
          authorized:true,regenerate:false,acknowledgeUnknown:false,
          preparedFingerprint:item.draftIdentity.creativeFingerprint
        });
        if(response===null){
          stopReason='Submission was cancelled. Remaining images were not requested.';break;
        }
        if(!response||typeof response!=='object'||!('status' in response)||
          !('id' in response)||typeof response.id!=='string'||
          !('targetKey' in response)||response.targetKey!==item.targetKey){
          stopReason='Provider submission did not return a verified job for this exact target. Batch stopped safely.';break;
        }
        {
          const status=String(response.status);
          // An inconclusive or rejected POST must stop the queue. No retry.
          if(status==='UNKNOWN'||status==='FAILED'||status==='CANCELLED'||status==='STALE'){
            stopReason='Image '+item.shotId+'/'+item.layerId+' returned '+status+
              '. The batch stopped without retrying or billing further targets.';
            break;
          }
          if(isCurrentProjectSession(scope)){
            const submittedJob=response as ImageJob;
            setJobs(previous=>[submittedJob,...previous.filter(job=>job.id!==submittedJob.id)]);
          }
        }
        sent++;
        if(isCurrentProjectSession(scope))setBatchProgress({
          state:'running',total:queue.length,sent,current:item.shotId+'/'+item.layerId,reason:''
        });
      }
    }catch(e){
      stopReason='Batch stopped: '+message(e)+'. No automatic retry was attempted.';
    }finally{
      if(isCurrentProjectSession(scope)){
        setBatchProgress({state:stopReason||batch.cancelled?'stopped':'complete',
          total:queue.length,sent,current:'',reason:stopReason});
        setSubmission(null);
        try{await refresh(scope);}catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
      }
      paidInFlight.current=false;
      if(batchSession.current===batch)batchSession.current=null;
    }
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
      <CardHeader title="Storyboard Images" action={<Badge tone={native?.nativeDraft?'mint':'amber'}>{native?.nativeDraft?'DRAFT':'NO DRAFT'}</Badge>}/>
      <div className="storyboard-compact-toolbar">
        <div className="info" data-testid="image-queue-counts">
          {prepared?.imageOccurrences??imageTargets.length} missing image occurrences · READY {counts.ready} · Review {counts.review} · Blocked {counts.blocked}
        </div>
        <Button disabled={!id||busy||Boolean(submission)||!native?.nativeDraft} onClick={()=>void prepare()}>Refresh Images</Button>
        <span title="Starts one potentially paid G-Labs request per never-attempted READY image. Total cost is unavailable. No automatic retries.">
          <Button variant="primary" disabled={busy||Boolean(submission)||!eligibleBulk.length}
            onClick={()=>void generateAll()}>
            Generate All Ready ({eligibleBulk.length} requests)
          </Button>
        </span>
      </div>
      {batchProgress&&<div className="storyboard-batch-progress" role="status" data-testid="image-batch-progress">
        <strong>{batchProgress.state==='running'?'Submitting image requests':
          batchProgress.state==='complete'?'Batch submitted':'Batch stopped'}</strong>
        <span>{batchProgress.sent} / {batchProgress.total} requests submitted
          {batchProgress.current?' · '+batchProgress.current:''}
          {batchProgress.reason?' · '+batchProgress.reason:''}</span>
        {batchProgress.state==='running'&&<Button onClick={()=>{
          if(batchSession.current)batchSession.current.cancelled=true;
        }}>Stop after current request</Button>}
      </div>}
      {submission&&!batchProgress&&<div className="storyboard-batch-progress" role="status" data-testid="image-submitting">
        Submitting image {submission.label} to G-Labs… Shot and Layer navigation stays available.
      </div>}
      {shotIds.length?<div className="storyboard-shot-strip" aria-label="Native shots">{shotIds.map(value=><button key={value}
        className={shotId===value?'selected':''}
        onClick={()=>{recoveryEpoch.current+=1;setCheckedUnknown('');setAcknowledgedUnknown('');setSelectedShot(value);setSelectedKey('');}}>
        {value}<small>{imageTargets.filter(item=>item.shotId===value).length} images</small>
      </button>)}</div>:<div className="info">No native shots in the current Native DRAFT. Stage an approved source-grounded Native Author artifact first.</div>}
      <details className="storyboard-technical-details">
        <summary>Project &amp; queue details</summary>
        <div className="info"><strong>Current Project Style:</strong> {native?.project.style??'No project'} · {native?.brief.ratio??'9:16'} · Native DRAFT {native?.nativeDraft?'r'+native.nativeDraft.revision:'not available'}</div>
        <div className="info">Creative review: {native?.nativeDraft?.reviewStatus??'not verified'}</div>
        <div className="info">{prepared?.shotCount??shotIds.length} Shots · {prepared?.uniquePaths??new Set(imageTargets.map(item=>item.path)).size} distinct paths</div>
      </details>
    </Card>
    <Card>
      <CardHeader title={shotId?shotId+' · Images':'Images'}/>
      <div className="storyboard-focus" data-testid="storyboard-focus">
        <div className="storyboard-focus-controls">
      {shotTargets.length?<div className="storyboard-layer-strip" aria-label="Native image asset list">{shotTargets.map(item=>{
        const row=prepared?.jobs.find(value=>value.targetKey===item.key);
        const current=jobs.find(job=>job.token===pending?.token&&job.targetKey===item.key);
        return <button key={item.key} className={target?.key===item.key?'selected':''}
          onClick={()=>{recoveryEpoch.current+=1;setCheckedUnknown('');setAcknowledgedUnknown('');setSelectedKey(item.key);setError('');}}>
          <strong>{row?.sourceDescription.slice(0,70)||item.layerId||'Image asset'}</strong>
          <small>{current?.status==='FAILED'&&current.staged?'Needs revision':current?.status??row?.state??'Preparing'}</small>
        </button>;
      })}</div>:<div className="info" data-testid="glabs-image-unavailable">{!pending?'No Native DRAFT media candidate staged.':imageTargets.length?'No missing images in this Shot.':'All required image occurrences are fulfilled.'}</div>}
      {spec&&<div className="stack">
        <div className="info storyboard-source-summary" title={spec.sourceDescription||spec.reason}>
          <strong>Image:</strong> {spec.sourceDescription||spec.reason}
        </div>
        {spec.state!=='READY'&&<div className="info error">{spec.state}: {spec.reason}</div>}
        {spec.styleAnchors.length>0&&<Field label="Verified B4 style reference"><Select value={refs(ownerRefs).find(value=>value.startsWith('@modeb/b4/'))??''}
          onChange={event=>setDraftReferences(old=>({...old,[identity]:event.target.value}))}>
          <option value="">Choose an approved B4 illustration</option>
          {spec.styleAnchors.map(anchor=><option key={anchor.id} value={'@modeb/b4/'+anchor.id}>{anchor.id} · {anchor.label.slice(0,85)}</option>)}
        </Select></Field>}
        {dirty&&<div className="info">Save the edited prompt/references before generating this image.</div>}
        {hasActiveAttempt&&<div className="info">Generation in progress. Use Check Status rather than submitting again.</div>}
        {!hasPreviousAttempt&&<div className="actions">
          <Button variant="primary" disabled={busy||!config||!canSubmit||!ownerPrompt.trim()} onClick={()=>void generate(false)}>
            Generate Image
          </Button>
        </div>}
        <details className="storyboard-technical-details">
          <summary>Image prompt &amp; source details</summary>
          <div className="info"><strong>Image Prompt:</strong> {spec.ownerEdited?'Edited':'Compiled'} · {spec.state}</div>
          {spec.prompt&&<details><summary>Review complete Image Prompt and provenance</summary>
            <pre className="prompt">{spec.prompt}</pre>
            <pre className="prompt">{JSON.stringify(spec.sourceRows,null,2)}</pre>
          </details>}
          <div className="info">G-Labs model: {config?.model??'Not configured'} · {config?.aspectRatio??'unknown'} · Style: {spec.styleProfileRef.id}</div>
          <div className="info">Native target: {spec.shotId}/{spec.layerId} · {spec.path}</div>
        </details>
      </div>}
      {hasUncertainAttempt&&target&&<Card>
        <CardHeader title="UNKNOWN image attempt · owner recovery" hint="Existing provider request may already have been charged. Checking is read-only."/>
        <div className="info"><strong>Exact Native target:</strong> {target.shotId}/{target.layerId} · {target.path} · {target.key}</div>
        {unknownAttempts.map(job=><div key={job.id} className="info" data-testid="unknown-attempt-evidence">
          <strong>UNKNOWN</strong> · Job {job.id} · Provider task ID: {job.providerTaskId??'Not confirmed'}
          <div>Persisted diagnostic: {job.reason??'No further provider evidence available'}</div>
        </div>)}
        <div className="info error" role="alert">UNKNOWN does not mean failed or successful. The provider may have charged for the prior request; do not assume it is safe to retry.</div>
        <Button disabled={busy} onClick={()=>void checkUnknownAttempts()}>Check Existing Attempt (read-only)</Button>
        {recoveryChecked&&<div className="stack" data-testid="unknown-recovery-confirmation">
          <div className="info error">Existing attempt still UNKNOWN after checking. A new image attempt can cause duplicate billing.</div>
          <label style={{display:'flex',gap:8,alignItems:'flex-start'}}>
            <input type="checkbox" aria-label="Acknowledge possible duplicate billing for this exact G-Labs target"
              checked={recoveryAcknowledged}
              onChange={event=>setAcknowledgedUnknown(event.target.checked?recoveryIdentity:'')}/>
            I understand the previous request may already have been charged, and I authorize one separate new attempt for this exact Shot/Layer.
          </label>
          <Button variant="primary" disabled={busy||!ready||!config||!ownerPrompt.trim()||!recoveryAcknowledged||hasActiveAttempt}
            onClick={()=>void generate(true)}>Authorize ONE New Image Attempt (paid confirmation)</Button>
        </div>}
      </Card>}
      {previousJobs.length>0&&<details className="storyboard-technical-details">
        <summary>Previous attempts ({previousJobs.length})</summary>
        {previousJobs.map(job=><div key={job.id} className="info">{job.status} · {job.id}
          {job.providerTaskId?' · Provider '+job.providerTaskId:''}
          {job.reason?' · '+job.reason:''}
        </div>)}
      </details>}
      {error&&<div className="info error" role="alert">{error}</div>}
      {spec&&<details><summary>Advanced · target-specific edits and verified references</summary>
        <div className="info">Native target: {spec.shotId}/{spec.layerId} · {spec.path}</div>
        <div className="info">Style authority: {spec.styleProfileRef.path} · SHA256 {spec.styleProfileRef.sha256} · Creative fingerprint {spec.draftIdentity.creativeFingerprint}</div>
        <Field label="Edit image prompt for current target only"><Textarea value={ownerPrompt} onChange={event=>setDraftPrompts(old=>({...old,[identity]:event.target.value}))} placeholder={spec.reason||'Prepared prompt appears automatically'}/></Field>
        <Field label="Approved image references (advanced)"><Input value={ownerRefs} onChange={event=>setDraftReferences(old=>({...old,[identity]:event.target.value}))} placeholder="Only exact approved asset paths"/></Field>
        <Button disabled={busy||ownerPrompt.trim().length<12} onClick={()=>void saveOverride()}>Save target-specific prompt/references</Button>
      </details>}
        </div>
        <div className="storyboard-focus-preview">
          {!visibleJobs.length&&<div className="storyboard-empty-preview" data-testid="storyboard-empty-preview">
            <strong>{target?target.shotId+' / '+target.layerId:'Select an image layer'}</strong>
            <span>{submission?.key===target?.key?'Submitting image to G-Labs…':
              target?'Generated image will appear here.':'Choose a Shot and image layer to preview.'}</span>
          </div>}
      {visibleJobs.map(job=><div key={job.id} className="storyboard-selected-image" data-testid="storyboard-selected-image">
        <div className="storyboard-image-stage">
          {job.staged&&urls[job.id]?<img key={previewIdentity(job)} src={urls[job.id]}
            alt={'G-Labs candidate for '+job.shotId+'/'+job.layerId}
            onLoad={event=>{
              if(event.currentTarget.complete&&event.currentTarget.naturalWidth>0&&event.currentTarget.naturalHeight>0){
                setPreviewReady(old=>({...old,[job.id]:previewIdentity(job)}));
                setPreviewErrors(old=>{const next={...old};delete next[job.id];return next;});
              }else{setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
                setPreviewErrors(old=>({...old,[job.id]:'Generated image did not decode to visible pixels.'}));}
            }}
            onError={()=>{setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
              setPreviewErrors(old=>({...old,[job.id]:'Generated image preview failed to load.'}));}}/>
          :<span>{['SUBMITTED','RUNNING','DOWNLOADED','QUEUED'].includes(job.status)?'Generating image…':'No image preview available'}</span>}
        </div>
        <div className="storyboard-image-review">
          <strong>{job.status==='FAILED'&&job.staged?'Image generated · validation failed':
            job.status==='VALIDATED'?'Ready to review':job.status==='RUNNING'?'Generating image…':
            job.status==='APPROVED'?'Approved image':job.status}</strong>
          {job.status==='FAILED'&&job.staged&&<div className="info error">The image was generated, but did not pass validation. Inspect the result before regenerating.</div>}
          {job.status==='VALIDATED'&&previewReady[job.id]!==previewIdentity(job)&&<div className="info">Loading image preview before approval…</div>}
          {previewErrors[job.id]&&<div className="info error" role="alert">{previewErrors[job.id]}</div>}
          {job.staged&&previewErrors[job.id]&&<Button disabled={busy} onClick={()=>{
            setPreviewReady(old=>{const next={...old};delete next[job.id];return next;});
            setPreviewErrors(old=>{const next={...old};delete next[job.id];return next;});
            setPreviewAttempts(old=>({...old,[job.id]:(old[job.id]??0)+1}));
            const scope=captureProjectSession();
            if(scope)void refresh(scope).catch(e=>{if(isCurrentProjectSession(scope))setError(message(e));});
          }}>Retry Preview</Button>}
          {job.status==='VALIDATED'&&<Field label="Owner-confirmed rights/source"><Input value={rights} onChange={event=>setRights(event.target.value)} placeholder="Owned or licensed image source"/></Field>}
          <div className="actions">
            {hasPreviousAttempt&&<Button variant={canSubmit?'primary':'ghost'}
              disabled={busy||!config||!canSubmit||!ownerPrompt.trim()} onClick={()=>void generate(false)}>
              Regenerate Image
            </Button>}
            {['SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status)&&<Button disabled={busy} onClick={()=>void poll(job.id)}>Check Status</Button>}
            {job.status==='VALIDATED'&&<Button variant="primary" disabled={busy||!rights.trim()||!urls[job.id]||previewReady[job.id]!==previewIdentity(job)} onClick={()=>void approve(job.id)}>Approve Image &amp; Bind</Button>}
            {job.status==='QUEUED'&&<Button disabled={busy} onClick={async()=>{
              const scope=captureProjectSession();if(!scope||!window.studio||!window.confirm('Cancel this queued request before paid submission?'))return;
              try{await window.studio.glabsCancelQueued(scope.projectId,job.id);if(isCurrentProjectSession(scope))await refresh(scope);}
              catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
            }}>Cancel Queued</Button>}
          </div>
          <details className="storyboard-technical-details">
            <summary>Job details</summary>
            <div className="info">{job.model} · {job.aspectRatio} · {job.shotId}/{job.layerId}</div>
            <div className="info">{job.targetPath}</div>
            {job.reason&&<div className="info">{job.reason}</div>}
            {job.providerTaskId&&<div className="info">Provider task ID: {job.providerTaskId}</div>}
            {job.approved&&<div className="info">Approved: {job.approved.path} · SHA256 {job.approved.sha256}</div>}
          </details>
        </div>
      </div>)}
        </div>
      </div>
    </Card>
    <details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}>
      <summary>Advanced · manual Import & Bind, raw Native ledgers and diagnostics</summary>
      {advanced&&<LegacyStoryboardWorkspace/>}
    </details>
  </div>;
}
