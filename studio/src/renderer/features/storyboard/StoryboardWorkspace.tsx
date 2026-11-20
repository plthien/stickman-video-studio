/* eslint-disable react-hooks/exhaustive-deps -- all async refreshes are guarded by the captured project session */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader} from '../../components/ui';
import {LegacyStoryboardWorkspace} from './LegacyStoryboardWorkspace';
import {ShotImageGallery,type GalleryTarget,type GalleryCard} from './ShotImageGallery';

type Studio=NonNullable<Window['studio']>;
type Pending=Awaited<ReturnType<Studio['pendingMedia']>>;
type Prepared=Awaited<ReturnType<Studio['prepareImages']>>;
type ImageJob=Awaited<ReturnType<Studio['glabsJobs']>>[number];
type Gallery=Awaited<ReturnType<NonNullable<Studio['galleryImages']>>>;
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
type JobView=Awaited<ReturnType<NonNullable<Window['studio']>['glabsJobs']>>[number];
const legacyStatusRank=(status:string)=>({
  QUEUED:0,SUBMITTED:1,RUNNING:2,DOWNLOADED:3,UNKNOWN:4,
  FAILED:5,VALIDATED:6,APPROVED:7,CANCELLED:8,STALE:9
} as Record<string,number>)[status]??0;
/** Persisted journal revision is authoritative over timing of IPC delivery.
 * For pre-migration/test jobs without revisions, never regress a terminal
 * candidate to a transient RUNNING event. */
function newerImageJob(current:JobView,incoming:JobView):JobView{
  if(current.id!==incoming.id||current.token!==incoming.token||
    current.targetKey!==incoming.targetKey)return current;
  const left=current.journalRevision??0,right=incoming.journalRevision??0;
  if(right!==left)return right>left?incoming:current;
  return legacyStatusRank(incoming.status)>=legacyStatusRank(current.status)?incoming:current;
}

/** Owner-friendly single-target queue; the unchanged manual workflow is available in Advanced. */
export function StoryboardWorkspace(){
  const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState();
  const id=native?.project.id;
  const [pending,setPending]=useState<Pending|null>(null);
  const [prepared,setPrepared]=useState<Prepared|null>(null);
  const [jobs,setJobs]=useState<ImageJob[]>([]);
  const [gallery,setGallery]=useState<Gallery|null>(null);
  const [selectedApproved,setSelectedApproved]=useState<Set<string>>(new Set());
  const approving=useRef(false);
  const approvalBatch=useRef<{cancelled:boolean}|null>(null);
  const [approvalResults,setApprovalResults]=useState<Array<{
    jobId:string;shotId:string;layerId:string;status:'approved'|'failed';detail:string
  }>>([]);
  // Provider events can arrive while initial source preparation is still
  // running. Buffer them so an older glabsJobs snapshot cannot hide DONE.
  const receivedJobUpdates=useRef<Map<string,ImageJob>>(new Map());
  const [config,setConfig]=useState<{model:string;aspectRatio:string}|null>(null);
  const [selectedShot,setSelectedShot]=useState('');
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [previewReady,setPreviewReady]=useState<Record<string,string>>({});
  const [previewErrors,setPreviewErrors]=useState<Record<string,string>>({});
  const [previewAttempts,setPreviewAttempts]=useState<Record<string,number>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
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
  const [unknownReview,setUnknownReview]=useState<{
    targetKey:string;identity:string;
    outcome:'CHECK_FAILED_UNVERIFIED'|'CHECKED_STILL_UNKNOWN'|'CHECKED_RESOLVED'|null;
    error:string;acknowledged:boolean;canAuthorize:boolean;checking:boolean;
  }|null>(null);
  const recoveryEpoch=useRef(0);
  const refresh=async(scope=captureProjectSession())=>{
    if(!scope||!window.studio)return;
    const studio=window.studio;
    // Resolve the Native journal first: a rejected pendingMedia must be
    // handled even if a later IPC method is missing or throws synchronously.
    // Show corruption as an explicit error instead of an empty queue.
    const nextPending=await studio.pendingMedia(scope.projectId)
      .catch(cause=>{throw new Error('Pending media ERROR: '+message(cause));});
    const [nextJobs,nextConfig,nextPrepared,nextGallery]=await Promise.all([
      studio.glabsJobs(scope.projectId),
      studio.glabsSettings(),
      studio.prepareImages?.(scope.projectId)??Promise.resolve(null),
      studio.galleryImages?.(scope.projectId)??Promise.resolve(null)
    ]);
    // Avoid N image URL IPC roundtrips for projects with hundreds of jobs.
    // Only the selected candidate's preview is resolved on demand below.
    if(!isCurrentProjectSession(scope))return;
    const updates=receivedJobUpdates.current;
    const merged=nextJobs.map(job=>{
      const newer=updates.get(job.id);
      return newer?newerImageJob(job,newer):job;
    });
    for(const newer of updates.values()){
      if(newer.token===nextPending?.token&&!merged.some(job=>job.id===newer.id))
        merged.unshift(newer);
    }
    setPending(nextPending);setJobs(merged);setConfig(nextConfig.config);
    setPrepared(nextPrepared);setGallery(nextGallery);
    return{pending:nextPending,jobs:merged};
  };
  useEffect(()=>{
    const scope=captureProjectSession();
    receivedJobUpdates.current.clear();
    if(approvalBatch.current)approvalBatch.current.cancelled=true;
    setPending(null);setPrepared(null);setJobs([]);setGallery(null);setConfig(null);setUrls({});
    setSelectedApproved(new Set());setApprovalResults([]);
    setPreviewReady({});setPreviewErrors({});setPreviewAttempts({});setError('');setBusy(false);
    setUnknownReview(null);recoveryEpoch.current+=1;
    setSubmission(null);setBatchProgress(null);
    if(scope&&window.studio)void refresh(scope).catch(e=>{if(isCurrentProjectSession(scope))setError(message(e));});
    // The session guard prevents async responses from being applied to another project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,native?.external?.native?.revision]);
  // Electron's independent GET-only coordinator pushes each persisted provider
  // transition. A selected completed job immediately resolves its image URL
  // using the existing lazy-preview effect: no manual "Check Status" required.
  useEffect(()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio?.onGlabsJobChanged)return;
    return window.studio.onGlabsJobChanged(change=>{
      if(!change||change.projectId!==scope.projectId||
        !isCurrentProjectSession(scope)||!change.job||
        change.job.projectId!==scope.projectId)return;
      const updated=change.job;
      const buffered=receivedJobUpdates.current.get(updated.id);
      receivedJobUpdates.current.set(updated.id,buffered?
        newerImageJob(buffered,updated):updated);
      setJobs(previous=>{
        const index=previous.findIndex(job=>job.id===updated.id);
        if(index<0)return[updated,...previous];
        return previous.map(job=>job.id===updated.id?
          newerImageJob(job,updated):job);
      });
    });
  },[id]);
  useEffect(()=>()=>{if(batchSession.current)batchSession.current.cancelled=true;},[]);
  // The project-session epoch tracks project switches, NOT same-project
  // Native DRAFT revisions. Cancel any remaining paid submissions during the
  // revision commit (before an in-flight provider Promise may settle), rather
  // than relying on asynchronous refresh or an unchanged pending token.
  useLayoutEffect(()=>{
    if(batchSession.current)batchSession.current.cancelled=true;
    if(approvalBatch.current)approvalBatch.current.cancelled=true;
  },[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,
    native?.external?.native?.revision]);
  useEffect(()=>{
    if(batchSession.current)batchSession.current.cancelled=true;
    if(approvalBatch.current)approvalBatch.current.cancelled=true;
    setSelectedApproved(new Set());setApprovalResults([]);
    setSelectedShot('');setUnknownReview(null);recoveryEpoch.current+=1;
    setAdvanced(false);setUrls({});
  },[id]);
  const candidateAfter=pending?.after as {shots?:unknown[]}|undefined;
  const shots=Array.isArray(candidateAfter?.shots)?candidateAfter.shots as Array<Record<string,unknown>>:[];
  const shotIds=gallery&&pending&&gallery.token===pending.token&&gallery.shots.length?
    gallery.shots.map(shot=>shot.id):
    shots.filter(row=>typeof row.id==='string').map(row=>row.id as string);
  const shotId=shotIds.includes(selectedShot)?selectedShot:shotIds[0]??'';
  const imageTargets=pending?.missing.filter(row=>row.kind==='image')??[];
  // Legacy test fixtures may not supply the gallery IPC method. Derive their
  // display-only inventory from the verified Native after.shots projection,
  // never from its shrinking missing-media list.
  const fallbackGalleryTargets:GalleryTarget[]=[];
  shots.forEach((shot,index)=>{
    if(typeof shot.id!=='string')return;
    const visit=(values:unknown[])=>{
      for(const value of values){
        if(!value||typeof value!=='object'||Array.isArray(value))continue;
        const layer=value as Record<string,unknown>;
        if(layer.type==='image'&&typeof layer.id==='string'&&typeof layer.path==='string'){
          const key=imageTargets.find(item=>item.shotId===shot.id&&
            item.layerId===layer.id)?.key??'image:'+index+':'+layer.id;
          fallbackGalleryTargets.push({key,shotId:shot.id as string,
            layerId:layer.id,path:layer.path,boundPath:layer.path,
            fulfilled:Boolean(pending?.fulfillments?.[key]),managed:!layer.path.startsWith('@b1/')});
        }
        if(Array.isArray(layer.children))visit(layer.children);
      }
    };
    if(Array.isArray(shot.layers))visit(shot.layers);
  });
  const galleryTargets=gallery&&pending&&gallery.token===pending.token?
    gallery.targets:fallbackGalleryTargets;
  const previewIdentity=(job:ImageJob)=>[id,job.id,job.token,job.staged?.sha256??'-',urls[job.id]??'-',previewAttempts[job.id]??0].join('|');
  // Native fulfillment and exact creative/style lineage, not APPROVED history,
  // decide which image is current. A corrected Shot can reuse the target KEY.
  const resolvedCards:GalleryCard[]=galleryTargets.map(item=>{
    const history=jobs.filter(job=>job.token===pending?.token&&
      job.targetKey===item.key&&job.shotId===item.shotId&&
      job.layerId===item.layerId).sort((left,right)=>
        (right.createdAt??'').localeCompare(left.createdAt??''));
    const spec=prepared?.jobs.find(value=>value.targetKey===item.key)??null;
    const sameAuthority=(job:ImageJob)=>(
      (!job.targetCreativeSha256||
        ((spec?.draftIdentity.creativeFingerprint??item.creativeFingerprint)===
          job.targetCreativeSha256))&&
      (!job.styleProfileSha256||!spec||
        job.styleProfileSha256===spec.styleProfileRef.sha256)&&
      (!job.styleProfileId||!native?.project.style||
        job.styleProfileId===native.project.style)
    );
    const bound=history.find(job=>job.status==='APPROVED'&&item.fulfilled&&
      sameAuthority(job)&&(!job.approved||
        job.approved.path===item.boundPath&&
        (!item.boundSha256||job.approved.sha256===item.boundSha256)));
    const active=history.find(job=>job.status!=='APPROVED'&&
      sameAuthority(job)&&job.status!=='STALE');
    const job=bound??(!item.fulfilled?active:null)??null;
    return{target:item,job,history,spec,currentlyBound:Boolean(bound),
      superseded:!item.fulfilled&&history.some(value=>value.status==='APPROVED'),
      hasCurrentAttempt:Boolean(active)};
  });
  const cards=resolvedCards.filter(card=>card.target.shotId===shotId);
  const inspectedReadyCards=resolvedCards.filter((card):card is GalleryCard&{job:ImageJob}=>Boolean(
    !card.target.fulfilled&&card.job?.status==='VALIDATED'&&card.job.staged&&
    urls[card.job.id]&&!previewErrors[card.job.id]&&
    previewReady[card.job.id]===previewIdentity(card.job)
  ));
  // A bulk click covers only never-attempted, source-backed READY targets.
  // FAILED/UNKNOWN/staged/approved jobs are excluded; none is retried.
  const eligibleBulk=prepared&&pending&&prepared.token===pending.token&&config?
    prepared.jobs.filter(item=>item.state==='READY'&&Boolean(item.prompt.trim())&&
      imageTargets.some(candidate=>candidate.key===item.targetKey&&
        candidate.shotId===item.shotId&&candidate.layerId===item.layerId&&
        candidate.path===item.path)&&
      !jobs.some(job=>job.token===pending?.token&&job.targetKey===item.targetKey)&&
      true):[];
  const galleryPreviewKey=cards.map(card=>[
    card.job?.id??'',card.job?.staged?.path??'',
    card.job?.staged?.sha256??''
  ].join(':')).join('|');
  // Fetch visible Shot candidates only (typically 3–5), not every historical
  // attempt in a 200-image project. The existing background GET coordinator
  // updates jobs automatically when a result is ready.
  useEffect(()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio)return;
    let active=true;
    for(const card of cards){
      const job=card.job;
      if(!job?.staged||urls[job.id]||
        previewErrors[job.id])continue;
      void window.studio.mediaUrl(scope.projectId,job.staged.path).then(url=>{
        if(active&&isCurrentProjectSession(scope))
          setUrls(previous=>({...previous,[job.id]:url}));
      }).catch(()=>{
        if(active&&isCurrentProjectSession(scope))
          setPreviewErrors(previous=>({
            ...previous,[job.id]:'Generated image preview URL is unavailable.'
          }));
      });
    }
    return()=>{active=false;};
  },[id,shotId,galleryPreviewKey,JSON.stringify(urls),
    JSON.stringify(previewErrors),JSON.stringify(previewAttempts)]);
  useEffect(()=>{setSelectedApproved(new Set());},[id,shotId,pending?.token,
    native?.nativeDraft?.revision]);
  useEffect(()=>{
    // Selection/approval intent is scoped to the visible Native Shot.
    // Navigating away stops remaining approvals after the current mutation.
    if(approvalBatch.current)approvalBatch.current.cancelled=true;
    if(batchSession.current)batchSession.current.cancelled=true;
  },[id,shotId,native?.nativeDraft?.token,native?.nativeDraft?.revision]);
  const prepare=async()=>{
    const scope=captureProjectSession();if(!scope||!window.studio?.prepareImages)return;
    setBusy(true);setError('');
    try{
      const next=await window.studio.prepareImages(scope.projectId,true);
      if(isCurrentProjectSession(scope))setPrepared(next);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const unknownIdentityFor=(key:string,source=jobs)=>{
    const target=galleryTargets.find(item=>item.key===key&&item.shotId===shotId);
    const spec=prepared?.jobs.find(item=>item.targetKey===key);
    const uncertain=source.filter(job=>job.token===pending?.token&&
      job.targetKey===key&&job.status==='UNKNOWN');
    if(!target||!spec||!pending||!uncertain.length)return'';
    return[id??'',pending.token,shotId,target.layerId,target.path,
      spec.draftIdentity.creativeFingerprint,spec.styleProfileRef.sha256,
      ...uncertain.map(job=>job.id+':'+(job.providerTaskId??'')).sort()].join('|');
  };
  const liveUnknownReview=unknownReview&&unknownReview.identity===
    unknownIdentityFor(unknownReview.targetKey)?unknownReview:null;
  useLayoutEffect(()=>{
    recoveryEpoch.current+=1;
    setUnknownReview(null);
  },[id,shotId,native?.nativeDraft?.token,native?.nativeDraft?.revision]);
  const savePromptForCard=async(targetKey:string,prompt:string,references:string[])=>{
    const scope=captureProjectSession();
    const spec=prepared?.jobs.find(item=>item.targetKey===targetKey);
    const target=galleryTargets.find(item=>item.key===targetKey&&item.shotId===shotId);
    if(!scope||!window.studio?.saveImagePrompt||busy||!spec||!target||
      spec.draftIdentity.token!==pending?.token||
      spec.shotId!==target.shotId||spec.layerId!==target.layerId||
      spec.path!==target.path)return;
    setBusy(true);setError('');
    try{
      const next=await window.studio.saveImagePrompt(scope.projectId,{
        targetKey,fingerprint:spec.draftIdentity.creativeFingerprint,
        styleSha256:spec.styleProfileRef.sha256,prompt,references
      });
      if(isCurrentProjectSession(scope))setPrepared(next);
    }catch(error){if(isCurrentProjectSession(scope))setError(message(error));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const checkUnknownForCard=async(targetKey:string)=>{
    const scope=captureProjectSession(),studio=window.studio;
    const identity=unknownIdentityFor(targetKey);
    if(!scope||!studio||!identity||busy||paidInFlight.current)return;
    const epoch=++recoveryEpoch.current;
    const uncertain=jobs.filter(job=>job.token===pending?.token&&
      job.targetKey===targetKey&&job.status==='UNKNOWN');
    setUnknownReview({targetKey,identity,checking:true,outcome:null,
      acknowledged:false,canAuthorize:false,error:''});
    let failed='';
    let outcomes:unknown[]=[];
    try{
      // GET-only requests; failure is NOT evidence of generation failure.
      outcomes=await Promise.all(uncertain.map(job=>studio.glabsPoll(scope.projectId,job.id)));
    }catch(error){failed=message(error);}
    try{
      // Re-read persisted evidence after a successful OR rejected provider GET.
      const [latest,fresh]=await Promise.all([
        studio.glabsJobs(scope.projectId),studio.pendingMedia(scope.projectId)
      ]);
      if(!isCurrentProjectSession(scope)||recoveryEpoch.current!==epoch)return;
      const unchanged=fresh?.token===pending?.token&&
        unknownIdentityFor(targetKey,latest)===identity&&
        !latest.some(job=>job.token===pending?.token&&job.targetKey===targetKey&&
          ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','VALIDATED'].includes(job.status));
      const stillUnknown=unchanged&&(failed.length>0||
        outcomes.every(outcome=>Boolean(outcome&&typeof outcome==='object'&&
          'status' in outcome&&outcome.status==='UNKNOWN')));
      const outcome=stillUnknown?
        failed?'CHECK_FAILED_UNVERIFIED':'CHECKED_STILL_UNKNOWN':'CHECKED_RESOLVED';
      setUnknownReview({targetKey,identity,checking:false,outcome,error:failed,
        acknowledged:false,canAuthorize:Boolean(stillUnknown)});
      if(!stillUnknown)await refresh(scope);
    }catch(error){
      if(isCurrentProjectSession(scope)&&recoveryEpoch.current===epoch)
        setUnknownReview({targetKey,identity,checking:false,
          outcome:'CHECK_FAILED_UNVERIFIED',
          error:'Cannot verify persisted journal: '+message(error),
          acknowledged:false,canAuthorize:false});
    }
  };
  const consentUnknownForCard=(targetKey:string,checked:boolean)=>{
    setUnknownReview(previous=>previous&&previous.targetKey===targetKey&&
      previous.identity===unknownIdentityFor(targetKey)&&previous.canAuthorize?
      {...previous,acknowledged:checked}:previous);
  };
  const authorizeUnknownForCard=async(targetKey:string)=>{
    const scope=captureProjectSession(),studio=window.studio;
    const review=liveUnknownReview,spec=prepared?.jobs.find(item=>item.targetKey===targetKey);
    const target=galleryTargets.find(item=>item.key===targetKey&&item.shotId===shotId);
    if(!scope||!studio||!review||!review.acknowledged||!review.canAuthorize||
      !pending||!spec||spec.state!=='READY'||!config||!target||
      paidInFlight.current||batchSession.current||busy)return;
    const epoch=recoveryEpoch.current,expected=review.identity;
    paidInFlight.current=true;
    setSubmission({key:targetKey,label:target.shotId+'/'+target.layerId});
    setError('');
    try{
      const [fresh,latest]=await Promise.all([
        studio.pendingMedia(scope.projectId),studio.glabsJobs(scope.projectId)
      ]);
      if(!isCurrentProjectSession(scope)||recoveryEpoch.current!==epoch||
        unknownIdentityFor(targetKey,latest)!==expected||
        fresh?.token!==pending.token||
        !fresh.missing.some(row=>row.kind==='image'&&row.key===targetKey&&
          row.shotId===target.shotId&&row.layerId===target.layerId&&
          row.path===target.path)||
        latest.some(job=>job.token===pending.token&&job.targetKey===targetKey&&
          ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','VALIDATED'].includes(job.status))){
        setError('GLABS_UNKNOWN_STALE_CHECK: provider journal/Native DRAFT changed. No paid POST.');
        return;
      }
      // Consent is single-use and consumed BEFORE Electron's paid dialog.
      setUnknownReview(null);
      recoveryEpoch.current+=1;
      const result=await studio.glabsGenerate(scope.projectId,{
        targetKey,prompt:spec.prompt,model:config.model,
        aspectRatio:config.aspectRatio,references:[...spec.references],
        authorized:true,regenerate:true,acknowledgeUnknown:true,
        preparedFingerprint:spec.draftIdentity.creativeFingerprint
      });
      if(isCurrentProjectSession(scope)&&result!==null)await refresh(scope);
    }catch(error){
      if(isCurrentProjectSession(scope))setError(message(error));
    }finally{
      paidInFlight.current=false;
      if(isCurrentProjectSession(scope))setSubmission(null);
    }
  };
  const generateAll=async(shotFilter?:string)=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!pending||!config||!eligibleBulk.length||
      busy||paidInFlight.current||batchSession.current)return;
    // The button displays the exact number of individually billed requests.
    // It is the owner's explicit one-time authorization for this frozen queue.
    const queue=eligibleBulk.filter(item=>!shotFilter||item.shotId===shotFilter);
    if(!queue.length)return;
    const batch={cancelled:false,projectId:scope.projectId,token:pending.token};
    batchSession.current=batch;
    paidInFlight.current=true;
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
  const generateForGallery=async(targetKey:string)=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!prepared||!pending||!config||
      paidInFlight.current||batchSession.current||busy)return;
    const entry=prepared.jobs.find(item=>item.targetKey===targetKey);
    const nativeTarget=imageTargets.find(item=>item.key===targetKey);
    if(!entry||entry.state!=='READY'||!entry.prompt.trim()||!nativeTarget||
      entry.path!==nativeTarget.path||entry.shotId!==nativeTarget.shotId||
      entry.layerId!==nativeTarget.layerId){
      setError('Exact frozen Native image target is not READY.');return;
    }
    const attempts=jobs.filter(job=>job.token===pending.token&&job.targetKey===targetKey);
    if(attempts.some(job=>['QUEUED','SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(job.status))){
      setError('Existing active or UNKNOWN image may already be charged. No duplicate POST.');return;
    }
    if(attempts.some(job=>job.status==='APPROVED'&&
      job.targetCreativeSha256===entry.draftIdentity.creativeFingerprint&&
      job.styleProfileSha256===entry.styleProfileRef.sha256)){
      setError('This exact Native target was already approved. No paid POST.');return;
    }
    paidInFlight.current=true;
    setBatchProgress(null);setSubmission({key:targetKey,label:entry.shotId+'/'+entry.layerId});setError('');
    try{
      const result=await window.studio.glabsGenerate(scope.projectId,{
        targetKey:entry.targetKey,prompt:entry.prompt,model:config.model,
        aspectRatio:config.aspectRatio,references:[...entry.references],
        authorized:true,regenerate:attempts.length>0,acknowledgeUnknown:false,
        preparedFingerprint:entry.draftIdentity.creativeFingerprint
      });
      if(isCurrentProjectSession(scope)&&result&&typeof result==='object'&&
        'id' in result&&typeof result.id==='string'&&'targetKey' in result&&
        result.targetKey===targetKey&&'token' in result&&result.token===pending.token){
        const submitted=result as ImageJob;
        setJobs(previous=>[submitted,...previous.filter(job=>job.id!==submitted.id)]);
      }else if(isCurrentProjectSession(scope)&&result!==null)await refresh(scope);
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{
      paidInFlight.current=false;
      if(isCurrentProjectSession(scope))setSubmission(null);
    }
  };
  const approveCandidates=async(requestedIds:string[])=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio||!pending||approving.current||busy||!requestedIds.length)return;
    const immutableToken=pending.token;
    const queue=inspectedReadyCards.filter(card=>requestedIds.includes(card.job.id));
    if(queue.length!==new Set(requestedIds).size){
      setError('GLABS_PREVIEW_NOT_VERIFIED: every requested candidate must be VALIDATED and visibly loaded.');return;
    }
    approving.current=true;
    const batch={cancelled:false};approvalBatch.current=batch;
    setBusy(true);setError('');setApprovalResults([]);
    const results:Array<{jobId:string;shotId:string;layerId:string;status:'approved'|'failed';detail:string}>=[];
    try{
      for(const card of queue){
        if(batch.cancelled||!isCurrentProjectSession(scope))break;
        const stillCurrent=await window.studio.pendingMedia(scope.projectId);
        if(batch.cancelled||!isCurrentProjectSession(scope)||
          stillCurrent?.token!==immutableToken){
          results.push({jobId:card.job.id,shotId:card.target.shotId,
            layerId:card.target.layerId,status:'failed',
            detail:'Native DRAFT changed; remaining approvals stopped before binding.'});
          if(isCurrentProjectSession(scope))setApprovalResults([...results]);
          break;
        }
        // Read-only refresh of current journal preconditions; backend verifies
        // the immutable candidate SHA, references, style and Native lineage.
        try{
          await window.studio.glabsApprove(scope.projectId,card.job.id);
          results.push({jobId:card.job.id,shotId:card.target.shotId,
            layerId:card.target.layerId,status:'approved',detail:'Approved & bound'});
        }catch(e){
          results.push({jobId:card.job.id,shotId:card.target.shotId,
            layerId:card.target.layerId,status:'failed',detail:message(e)});
          // Keep successful earlier approvals. Other independently validated
          // targets can still continue; no automatic paid retry occurs.
        }
        if(isCurrentProjectSession(scope))setApprovalResults([...results]);
      }
      if(isCurrentProjectSession(scope)){
        await refresh(scope);
        const latest=await window.studio.projectState(scope.projectId);
        if(setNativeIfSessionCurrent(scope,latest))
          showNotice(results.filter(row=>row.status==='approved').length+
            ' image(s) approved and bound. Review per-image results.');
        setSelectedApproved(new Set());
      }
    }catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{
      approving.current=false;
      if(approvalBatch.current===batch)approvalBatch.current=null;
      if(isCurrentProjectSession(scope))setBusy(false);
    }
  };
  const poll=async(jobId:string)=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    setBusy(true);setError('');
    try{await window.studio.glabsPoll(scope.projectId,jobId);if(isCurrentProjectSession(scope))await refresh(scope);}
    catch(e){if(isCurrentProjectSession(scope))setError(message(e));}
    finally{if(isCurrentProjectSession(scope))setBusy(false);}
  };
  const counts={ready:prepared?.jobs.filter(j=>j.state==='READY').length??0,
    review:prepared?.jobs.filter(j=>j.state==='NEEDS_OWNER_REVIEW').length??0,
    blocked:prepared?.jobs.filter(j=>j.state==='BLOCKED').length??0};
  const imageCounts={
    notGenerated:resolvedCards.filter(card=>!card.target.fulfilled&&!card.job&&!card.superseded).length,
    processing:resolvedCards.filter(card=>card.job&&
      ['QUEUED','SUBMITTED','RUNNING','DOWNLOADED'].includes(card.job.status)&&
      !card.job.lastSyncError).length,
    syncIssues:resolvedCards.filter(card=>Boolean(card.job?.lastSyncError)).length,
    inspectedReady:inspectedReadyCards.length,
    approved:resolvedCards.filter(card=>card.currentlyBound).length,
    superseded:resolvedCards.filter(card=>card.superseded).length
  };
  const uniquePaths=new Set(galleryTargets.map(item=>item.path)).size;
  const nextReviewShot=()=>resolvedCards.find(card=>card.job?.status==='VALIDATED'&&
    !card.target.fulfilled&&
    (!card.job.staged||previewReady[card.job.id]!==previewIdentity(card.job)))
    ?.target.shotId??shotIds[0]??'';
  return <div className="stack" data-testid="storyboard-automation">
    <Card>
      <CardHeader title="Storyboard Images" action={<Badge tone={native?.nativeDraft?'mint':'amber'}>{native?.nativeDraft?'DRAFT':'NO DRAFT'}</Badge>}/>
      <div className="storyboard-compact-toolbar">
        <div className="info" data-testid="image-queue-counts">
          {galleryTargets.length} Native images · {imageCounts.notGenerated} not generated ·
          {' '+imageCounts.processing} processing · {imageCounts.syncIssues} sync issue ·
          {' '+imageCounts.inspectedReady} inspected ready ·
          {' '+imageCounts.approved} currently approved ·
          {' '+imageCounts.superseded} superseded ·
          READY {counts.ready} · Review {counts.review} · Blocked {counts.blocked}
        </div>
        <Button disabled={!id||busy||Boolean(submission)||!native?.nativeDraft} onClick={()=>void prepare()}>Refresh Images</Button>
        <span title="Starts one potentially paid G-Labs request per never-attempted READY image. Total cost is unavailable. No automatic retries.">
          <Button variant="primary" disabled={busy||Boolean(submission)||!eligibleBulk.length}
            onClick={()=>void generateAll()}>
            Generate All Ready ({eligibleBulk.length} paid attempts)
          </Button>
        </span>
        <Button disabled={!shotIds.length} onClick={()=>{
          setSelectedShot(nextReviewShot());setUnknownReview(null);
        }}>Review Project Images</Button>
        <Button disabled={busy||!inspectedReadyCards.length}
          onClick={()=>void approveCandidates(inspectedReadyCards.map(card=>card.job.id))}>
          Approve All Inspected Ready ({inspectedReadyCards.length})
        </Button>
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
      {approvalResults.length>0&&<div className="info" role="status" data-testid="bulk-approval-results">
        <strong>Approval results: {approvalResults.filter(row=>row.status==='approved').length} approved ·
          {' '+approvalResults.filter(row=>row.status==='failed').length} failed</strong>
        {approvalResults.map(row=><div key={row.jobId}>
          {row.shotId}/{row.layerId} · {row.status.toUpperCase()} · {row.detail}
        </div>)}
      </div>}
      {shotIds.length?<div className="storyboard-shot-strip" aria-label="Native shots">{shotIds.map(value=><button key={value}
        className={shotId===value?'selected':''}
        onClick={()=>{recoveryEpoch.current+=1;setUnknownReview(null);setSelectedShot(value);}}>
        {value}<small>{galleryTargets.filter(item=>item.shotId===value).length} images ·
          {' '+resolvedCards.filter(card=>card.target.shotId===value&&
            card.job?.status==='VALIDATED'&&!card.target.fulfilled).length} ready</small>
      </button>)}</div>:<div className="info">No native shots in the current Native DRAFT. Stage an approved source-grounded Native Author artifact first.</div>}
      <details className="storyboard-technical-details">
        <summary>Project &amp; queue details</summary>
        <div className="info"><strong>Current Project Style:</strong> {native?.project.style??'No project'} · {native?.brief.ratio??'9:16'} · Native DRAFT {native?.nativeDraft?'r'+native.nativeDraft.revision:'not available'}</div>
        <div className="info">Creative review: {native?.nativeDraft?.reviewStatus??'not verified'}</div>
        <div className="info">{prepared?.shotCount??shotIds.length} Shots · {prepared?.uniquePaths??new Set(imageTargets.map(item=>item.path)).size} distinct paths</div>
      </details>
    </Card>
    <Card>
      <CardHeader title={shotId?shotId+' · Shot Image Gallery':'Shot Image Gallery'}/>
      <div className="storyboard-compact-toolbar">
        <Button variant="primary" disabled={busy||Boolean(submission)||
          !eligibleBulk.some(item=>item.shotId===shotId)}
          onClick={()=>void generateAll(shotId)}>
          Generate All in Shot ({eligibleBulk.filter(item=>item.shotId===shotId).length} paid attempts)
        </Button>
        <Button disabled={busy||!inspectedReadyCards.some(card=>
          card.target.shotId===shotId&&selectedApproved.has(card.job.id))}
          onClick={()=>void approveCandidates(inspectedReadyCards.filter(card=>
            card.target.shotId===shotId&&selectedApproved.has(card.job.id)).map(card=>card.job.id))}>
          Approve Selected ({inspectedReadyCards.filter(card=>
            card.target.shotId===shotId&&selectedApproved.has(card.job.id)).length})
        </Button>
        <Button disabled={busy||!inspectedReadyCards.some(card=>card.target.shotId===shotId)}
          onClick={()=>void approveCandidates(inspectedReadyCards.filter(card=>
            card.target.shotId===shotId).map(card=>card.job.id))}>
          Approve All Inspected Ready in Shot ({inspectedReadyCards.filter(card=>
            card.target.shotId===shotId).length})
        </Button>
      </div>
      <div className="info">Only inspected, successfully loaded VALIDATED images can be approved.
        Other Shots must be visually reviewed before project-wide approval.
        G-Labs provenance is recorded automatically; external licensing is not independently verified.
        Each Generate request may incur a separate charge.
        {galleryTargets.length>uniquePaths&&
          ' '+galleryTargets.length+' Native occurrences map to '+uniquePaths+
          ' unique asset paths: each eligible target can be billed separately; no shared binding is implied.'}
      </div>
      <ShotImageGallery projectId={id??''} shotId={shotId} cards={cards} urls={urls}
        previewReady={previewReady} previewErrors={previewErrors}
        previewIdentity={previewIdentity}
        busy={busy||Boolean(submission)||Boolean(batchSession.current)}
        selectedIds={selectedApproved}
        onLoaded={(job,valid)=>{
          if(valid){
            setPreviewReady(previous=>({...previous,[job.id]:previewIdentity(job)}));
            setPreviewErrors(previous=>{
              const next={...previous};delete next[job.id];return next;
            });
          }else{
            setPreviewReady(previous=>{
              const next={...previous};delete next[job.id];return next;
            });
            setPreviewErrors(previous=>({
              ...previous,[job.id]:'Generated image preview failed to load or decode.'
            }));
          }
        }}
        onSelect={(jobId,selected)=>setSelectedApproved(previous=>{
          const next=new Set(previous);
          if(selected)next.add(jobId);else next.delete(jobId);
          return next;
        })}
        onGenerate={key=>void generateForGallery(key)}
        onApprove={jobId=>void approveCandidates([jobId])}
        onCheck={jobId=>void poll(jobId)}
        onRetryPreview={jobId=>{
          setPreviewReady(previous=>{
            const next={...previous};delete next[jobId];return next;
          });
          setPreviewErrors(previous=>{
            const next={...previous};delete next[jobId];return next;
          });
          setPreviewAttempts(previous=>({...previous,[jobId]:(previous[jobId]??0)+1}));
        }}
        onInspectUnknown={key=>{
          if(unknownReview?.targetKey!==key)setUnknownReview(null);
        }}
        unknownReview={liveUnknownReview??undefined}
        onCheckUnknown={key=>void checkUnknownForCard(key)}
        onConsentUnknown={consentUnknownForCard}
        onAuthorizeUnknown={key=>void authorizeUnknownForCard(key)}
        onSavePrompt={(key,prompt,references)=>void savePromptForCard(key,prompt,references)}
        onCancelQueued={jobId=>{
          const scope=captureProjectSession();
          if(!scope||!window.studio||!window.confirm(
            'Cancel this queued request before paid submission?'))return;
          void window.studio.glabsCancelQueued(scope.projectId,jobId).then(
            ()=>refresh(scope)).catch(error=>{
              if(isCurrentProjectSession(scope))setError(message(error));
            });
        }}
      />
    </Card>
    <details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}>
      <summary>Advanced · manual Import & Bind, raw Native ledgers and diagnostics</summary>
      {advanced&&<LegacyStoryboardWorkspace/>}
    </details>
  </div>;
}
