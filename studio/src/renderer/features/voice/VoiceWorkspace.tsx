import { useEffect, useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';

export function VoiceWorkspace() {
  const { native, captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent, showNotice, nanoEndpoint, setNanoEndpoint } = useAppState();
  const savedAttempt=native?.longform;
  const pinnedVoice=savedAttempt?.status&&savedAttempt.status!=='PASS'
    ?savedAttempt.profileId??native?.nano?.profileId
    :native?.nano?.profileId??savedAttempt?.profileId;
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]), [voice, setVoice] = useState(pinnedVoice??'');
  const [status, setStatus] = useState<'idle'|'ready'|'busy'|'error'|'cancelled'>('idle'), [message, setMessage] = useState(''), [authorized, setAuthorized] = useState(false);
  const [jobAction,setJobAction]=useState<null|{action:'generate'|'regenerate'|'resume'|'retry'|'running'|'blocked';reason:string;completed:number;total:number;currentPart?:number;status:string;detail?:string}>(null);
  const [timingEvidence,setTimingEvidence]=useState(false);
  const id = native?.project.id, script = native?.approvedScript?.text ?? '';
  useEffect(()=>{setVoice(pinnedVoice??'');setProfiles([]);setAuthorized(false);},[id,pinnedVoice]);
  const [playbackUrl,setPlaybackUrl]=useState(''),[playbackError,setPlaybackError]=useState(''),[playbackRetry,setPlaybackRetry]=useState(0);
  const [playbackSeconds,setPlaybackSeconds]=useState(0),[manualCorrection,setManualCorrection]=useState(false),[autoGenerating,setAutoGenerating]=useState(false);
  const audioSha=native?.voice?.sha256,voiceStale=native?.voice?.stale;
  useEffect(()=>{setPlaybackRetry(0);setPlaybackSeconds(0);},[id,audioSha]);
  const refreshVoiceOperations=async(scope=captureProjectSession())=>{
    if(!scope||!window.studio?.narrationAction)return;
    const [next,evidence]=await Promise.all([
      window.studio.narrationAction(scope.projectId),
      window.studio.timingEvidence?.(scope.projectId)??Promise.resolve(false)
    ]);
    if(isCurrentProjectSession(scope)){setJobAction(next);setTimingEvidence(evidence);}
  };
  useEffect(()=>{
    setJobAction(null);setTimingEvidence(false);
    const scope=captureProjectSession();
    if(!scope||!window.studio?.narrationAction)return;
    void refreshVoiceOperations(scope).catch(error=>{
      if(isCurrentProjectSession(scope))setMessage('Voice status unavailable: '+String(error));
    });
  },[id,audioSha,native?.longform?.status]);
  useEffect(()=>{
    if(status!=='busy'||!id)return;
    const timer=window.setInterval(()=>{
      const scope=captureProjectSession();
      if(!scope)return;
      void Promise.all([window.studio!.projectState(scope.projectId),window.studio!.narrationAction(scope.projectId)])
        .then(([state,next])=>{if(setNativeIfSessionCurrent(scope,state))setJobAction(next);})
        .catch(()=>{/* The operation's own handler reports errors. */});
    },1500);
    return()=>window.clearInterval(timer);
  },[id,status]);
  useEffect(()=>{
    let active=true;setPlaybackUrl('');setPlaybackError('');
    const scope=captureProjectSession();
    if(!scope||!audioSha||voiceStale||!window.studio?.voicePlaybackUrl)return()=>{active=false};
    void window.studio.voicePlaybackUrl(scope.projectId).then(value=>{
      if(active&&isCurrentProjectSession(scope))setPlaybackUrl(value);
    }).catch(reason=>{
      if(active&&isCurrentProjectSession(scope))
        setPlaybackError('Narration playback unavailable: '+String(reason));
    });
    return()=>{active=false};
  },[id,audioSha,voiceStale,playbackRetry]);
  const hasAlignment = Boolean(native?.alignment);
  const wordsSha256 = native?.alignment?.wordsSha256;
  const captionRevision = native?.alignment?.captionReview?.revision;
  const [review,setReview]=useState<null|{status:string;workflowStatus:string;error?:string;wordCount:number;cueCount:number;duration:number;words:Array<{word:string;start:number;end:number}>;original:Array<{start:number;end:number;text:string}>;originalBoundaries:number[];captionAuthorTask?:{taskId:string;prompt:string;status:'FROZEN'|'IMPORTED'}|null;canApproveDraft?:boolean;draftKind?:string;draft:null|{sha256?:string;technicalDraft?:boolean;boundaries:number[];cues:Array<{start:number;end:number;text:string}>};approved:null|{revision:number;mode?:'AUTO'|'MANUAL';cues:Array<{start:number;end:number;text:string}>}}>(null);
  const [captionResult,setCaptionResult]=useState('');
  const [historicalNarrator,setHistoricalNarrator]=useState('');
  useEffect(()=>setHistoricalNarrator(''),[id,audioSha]);
  const [boundaries,setBoundaries]=useState<number[]>([]),[selectedBoundary,setSelectedBoundary]=useState(1),[reviewNote,setReviewNote]=useState('');
  const refreshCaptionReview=async(scope= captureProjectSession())=>{if(!id||!scope||!window.studio)return false;const value=await window.studio.captionReview(scope.projectId);if(!isCurrentProjectSession(scope))return false;setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);return true;};
  useEffect(()=>{setMessage('');setStatus('idle');setReview(null);setBoundaries([]);setSelectedBoundary(1);setReviewNote('');setCaptionResult('');setManualCorrection(false);setAutoGenerating(false);let active=true;if(!id||!hasAlignment||!window.studio)return()=>{active=false};void window.studio.captionReview(id).then(value=>{if(active){setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);}}).catch(reason=>{if(active){setStatus('error');setMessage('Caption review ERROR: '+(reason instanceof Error?reason.message:String(reason)))}});return()=>{active=false};},[id,hasAlignment,wordsSha256,captionRevision]);
  const runReview=async(work:()=>Promise<unknown>,success:string)=>{const scope=captureProjectSession();if(!id||!scope)return;setStatus('busy');try{await work();if(!isCurrentProjectSession(scope))return;if(window.studio){const next=await window.studio.projectState(scope.projectId);if(!setNativeIfSessionCurrent(scope,next))return;}if(!await refreshCaptionReview(scope))return;setStatus('ready');showNotice(success);}catch(reason){if(isCurrentProjectSession(scope))fail(reason)}};
  const splitAtWord=()=>{const number=selectedBoundary;if(!review||number<1||number>=review.words.length)return;setBoundaries(value=>[...new Set([...value,number])].sort((a,b)=>a-b));};
  const mergeAtWord=()=>{if(!review)return;setBoundaries(value=>value.filter(number=>number!==selectedBoundary));};
  const captionCues=review?.draft?.cues??review?.approved?.cues??review?.original??[];
  const nativeVoice=(native?.manifest?.voice??{}) as Record<string,unknown>;
  const timelineSeconds=playbackSeconds+(typeof nativeVoice.lead==='number'?nativeVoice.lead:0)-(typeof nativeVoice.trim_start==='number'?nativeVoice.trim_start:0);
  const currentCue=captionCues.find(cue=>cue.start<=timelineSeconds&&cue.end>=timelineSeconds);
  const fail = (reason: unknown) => { setStatus('error'); setMessage(reason instanceof Error ? reason.message : String(reason)); };
  const act = async (work: () => Promise<unknown>, notice: string,afterSuccess?:()=>void) => { const scope=captureProjectSession();if(!id||!scope)return;setStatus('busy');setMessage(''); try { const result=await work();if(!isCurrentProjectSession(scope))return;if(result===null){setStatus('cancelled');setMessage('CANCELLED — no project data changed.');return;} if (window.studio){const next=await window.studio.projectState(scope.projectId);if(!setNativeIfSessionCurrent(scope,next))return;} afterSuccess?.();setStatus('ready'); showNotice(notice); } catch (reason) { if(isCurrentProjectSession(scope))fail(reason); } finally {if(isCurrentProjectSession(scope))void refreshVoiceOperations(scope).catch(()=>{});} };
  const reportPlaybackError=(code:number|undefined)=>{
    const category=code===1?'PLAYBACK_ABORTED':code===2?'MEDIA_LOADING_FAILED':
      code===3?'WAV_DECODING_ERROR':code===4?'MEDIA_UNSUPPORTED_OR_REQUEST_DENIED':'MEDIA_UNKNOWN_ERROR';
    setPlaybackError(category+' (MediaError '+String(code??'unavailable')+').');
    const scope=captureProjectSession();
    if(scope&&window.studio?.voicePlaybackUrl)
      void window.studio.voicePlaybackUrl(scope.projectId).catch(error=>{
        if(isCurrentProjectSession(scope))setPlaybackError('NARRATION_MISSING_OR_INTEGRITY_DENIED: '+String(error));
      });
  };
  const runNarration=async()=>{
    const scope=captureProjectSession(),action=jobAction?.action;
    if(!scope||!action||action==='running'||action==='blocked'||!window.studio)return;
    if(action==='retry'&&!window.confirm('The previous Nano request may already have produced audio. Explicitly authorize replay of only the uncertain part?'))return;
    const input={voice,...(action==='regenerate'?{regenerate:true}:{}),
      ...(action==='resume'?{resume:true}:{}),
      ...(action==='retry'?{resume:true,retryUncertain:true}:{})};
    setStatus('busy');setMessage('');
    try{
      if(native?.identityPolicy==='v1'&&window.studio.generateAndAlign&&native.approvedScript){await window.studio.generateAndAlign(scope.projectId,{...input,expectedScriptSha:native.approvedScript.sha256,ownerAuthorized:true});}else await window.studio.longformRun(scope.projectId,input);
      if(!isCurrentProjectSession(scope))return;
      const next=await window.studio.projectState(scope.projectId);
      if(!setNativeIfSessionCurrent(scope,next))return;
      setStatus('ready');showNotice(action==='regenerate'?'New narration attempt verified.':'Narration job verified.');
    }catch(error){if(isCurrentProjectSession(scope))fail(error);}
    finally{
      if(isCurrentProjectSession(scope)){
        try{
          const next=await window.studio.projectState(scope.projectId);
          setNativeIfSessionCurrent(scope,next);
          await refreshVoiceOperations(scope);
        }catch(error){if(isCurrentProjectSession(scope))setMessage('Voice state refresh failed: '+String(error));}
      }
    }
  };
  return <div className="grid wide-left"><div className="stack"><Card>
    <CardHeader title="VoiceStudio Chatterbox Nano" hint="Direct owner API · localhost:3901" action={<Badge tone={status==='ready'?'mint':status==='error'?'amber':'neutral'}>{status.toUpperCase()}</Badge>}/>
    <Field label="Local endpoint"><Input value={nanoEndpoint} onChange={event=>setNanoEndpoint(event.target.value)}/></Field>
    <Field label="Confirmed voice profile"><Select value={voice} onChange={event=>setVoice(event.target.value)}><option value="">Select discovered profile</option>{voice&&!profiles.some(item=>String(item.id)===voice)&&<option value={voice}>{voice} · saved attempt profile</option>}{profiles.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name??item.id)} · v{String(item.version)}</option>)}</Select></Field>
    <Field label="Approved narration (project source, read only)"><Textarea readOnly value={script}/></Field>
    <div className="actions"><Button disabled={!window.studio||status==='busy'} onClick={async()=>{const scope=captureProjectSession();if(!scope)return;setStatus('busy');try{const result=await window.studio!.nanoDiscover(nanoEndpoint);if(!isCurrentProjectSession(scope))return;setProfiles(result.profiles);setStatus(result.ready?'ready':'error');setMessage(result.ready?`${result.profiles.length} confirmed profile(s); producer ready.`:'Producer readiness failed.')}catch(reason){if(isCurrentProjectSession(scope))fail(reason)}}}>Discover producer</Button>
      <Button variant="primary" disabled={!id||!script||!voice||status==='busy'||!jobAction||(jobAction.action==='running'||jobAction.action==='blocked')} onClick={()=>void runNarration()}>{jobAction?.action==='generate'?(native?.identityPolicy==='v1'?'Generate Voice & Align (possible ElevenLabs charge)':'Generate narration'):jobAction?.action==='regenerate'?(native?.identityPolicy==='v1'?'Regenerate Voice & Align (possible ElevenLabs charge)':'Regenerate narration'):jobAction?.action==='resume'?(native?.identityPolicy==='v1'?'Resume Voice & Align (possible ElevenLabs charge)':'Resume narration'):jobAction?.action==='retry'?(native?.identityPolicy==='v1'?'Explicit Retry uncertain part & Align (possible ElevenLabs charge)':'Explicit Retry uncertain part'):jobAction?.action==='running'?'Generation running':jobAction?.action==='blocked'?'Recovery blocked — refresh status':'Checking job state...'}</Button>
      <Button disabled={!id||status==='busy'} onClick={()=>act(()=>window.studio!.importWav(id!),'Approved WAV imported.')}>Import WAV</Button></div>
    <div className="info">Recovery: {jobAction?.reason??'Checking saved job state'} · Parts {jobAction?.completed??0}/{jobAction?.total??0} · Current part {jobAction?.currentPart??'-'} · {jobAction?.status??'UNKNOWN'}{jobAction?.detail?' · '+jobAction.detail:''}</div>
    <Button disabled={!id||status==='busy'} onClick={()=>void refreshVoiceOperations().catch(fail)}>Refresh Voice status</Button>
    {message&&<div className={`info ${status==='error'?'error':''}`} role={status==='error'?'alert':undefined}>{message}</div>}<div className="info">Exact text and language come from approved main-process project state. Uncertain requests are never auto-replayed.</div>
  </Card><Card><CardHeader title="Narration evidence"/><dl className="kvs"><dt>Audio</dt><dd>{native?.voice?.path??'Not generated'}</dd><dt>Origin</dt><dd>{native?.voice?.origin??'Missing'}</dd><dt>SHA-256</dt><dd><code>{native?.voice?.sha256??'Missing'}</code></dd><dt>Long-form</dt><dd>{native?.longform?.status??'Not run'}</dd></dl>
    {native?.voice&&!voiceStale&&playbackUrl?<div className="stack">
      <strong>Listen to accepted narration</strong>
      <audio key={id+':'+audioSha+':'+playbackRetry} aria-label="Accepted narration audio" controls preload="metadata" src={playbackUrl} style={{width:'100%'}}
        onLoadedMetadata={()=>setPlaybackError('')}
        onTimeUpdate={event=>setPlaybackSeconds(event.currentTarget.currentTime)}
        onError={event=>reportPlaybackError(event.currentTarget.error?.code)}/>
    </div>:<div className="info">{voiceStale?'Narration is stale; regenerate or import approved WAV.':'No verified narration available for playback.'}</div>}
    {native?.project.style==='B4'&&native.voice&&!voiceStale&&<details><summary>B4 narrator metadata recovery</summary><p>Verify accepted source and repair metadata only. WAV, words and captions are not regenerated.</p><Button disabled={status==='busy'} onClick={()=>act(()=>window.studio!.repairB4Narrator(id!,audioSha!),'B4 narrator metadata verified/repaired.')}>Repair from accepted source</Button>{!native.voice.origin&&<><Field label="Historical narrator name (owner declaration, not verified)"><Input value={historicalNarrator} onChange={e=>setHistoricalNarrator(e.target.value)}/></Field><Button disabled={!historicalNarrator.trim()||!native.approvedScript||status==='busy'} onClick={()=>act(()=>window.studio!.repairB4Narrator(id!,audioSha!,{name:historicalNarrator,scriptSha:native.approvedScript!.sha256,ownerConfirmed:true}),'Owner narrator declaration saved.')}>Confirm narrator for this exact WAV</Button></>}</details>}
    {playbackError&&<div className="info error" role="alert">{playbackError}</div>}
    {playbackError&&playbackRetry<2&&<Button disabled={!id||status==='busy'} onClick={()=>{setPlaybackRetry(n=>n+1);setPlaybackUrl('');}}>Retry playback (read-only)</Button>}
  </Card></div>
  <Card><CardHeader title="ElevenLabs forced alignment" hint="Exact approved script + exact accepted WAV" action={<Badge tone="amber">USER AUTHORIZED ONLY</Badge>}/><Field label="Exact transcript uploaded"><Textarea readOnly value={script}/></Field>
    {native?.identityPolicy!=='v1'&&<label className="check"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)}/> I authorize this upload and possible paid usage now.</label>}
    <div className="actions"><Button variant="primary" disabled={!id||!native?.voice||native.voice.stale||(native.identityPolicy!=='v1'&&!authorized)||status==='busy'} onClick={()=>act(()=>window.studio!.align(id!,true),'ElevenLabs alignment saved.',()=>setAuthorized(false))}>{native?.identityPolicy==='v1'?'Align current WAV (possible ElevenLabs charge)':'Run forced alignment'}</Button><Button disabled={!id||!native?.voice||status==='busy'} onClick={()=>act(()=>window.studio!.importWords(id!),'Aligned words imported and captions generated.')}>Import aligned words JSON</Button>
    <Button disabled={!id||!native?.voice||native.voice.stale||!timingEvidence||status==='busy'} onClick={()=>act(()=>window.studio!.repairTiming(id!),'Saved provider response revalidated without a paid upload.')}>Repair Timing (saved response)</Button></div>
    <div className="info">Vietnamese support is not assumed. Import owner-verified word timestamps when live language coverage is unconfirmed. Secrets remain main-process only.</div><dl className="kvs"><dt>Words file</dt><dd>{native?.alignment?.path??'Not aligned'}</dd><dt>Origin</dt><dd>{native?.alignment?.origin??'Missing'}</dd></dl>
  </Card>
  <Card><CardHeader title="AI Caption Author" hint="Exact aligned words · AI semantic boundaries · owner approval" action={<Badge tone={review?.approved?'mint':'amber'}>{autoGenerating?'GENERATING':review?.workflowStatus??'NOT_READY'}</Badge>}/>
    {!review?<div className="info">NOT_READY — Align or import verified word timestamps to enable AI caption authoring.</div>:<>
      <dl className="kvs"><dt>Auto status</dt><dd>{autoGenerating?'GENERATING':review.workflowStatus??(review.approved?'USER_APPROVED':'REVIEW_REQUIRED')}</dd><dt>Words</dt><dd>{review.wordCount??review.words.length}</dd><dt>Cues</dt><dd>{review.cueCount??captionCues.length}</dd><dt>Voice timeline</dt><dd>{Number.isFinite(review.duration)?review.duration.toFixed(2):(native?.voice?.duration?.toFixed(2)??'—')}s</dd><dt>Revision</dt><dd>{review.approved?.revision??'Not verified'}</dd></dl>
      {review.error&&<div className="info error" role="alert">{review.error}</div>}
      <div className="info" aria-live="polite">Synced caption at {timelineSeconds.toFixed(2)}s: {currentCue?.text??'—'}</div>
      <div className="stack" aria-label="Caption cue timestamps" style={{maxHeight:220,overflowY:'auto'}}>{captionCues.map((cue,i)=><div key={i} className="info">{cue.start.toFixed(3)}–{cue.end.toFixed(3)}s · {cue.text}</div>)}</div>
      <Button disabled={!id||status==='busy'||autoGenerating||review.workflowStatus==='USER_APPROVED'} onClick={async()=>{
        setAutoGenerating(true);
        try{await act(()=>window.studio!.captionAuto(id!),'Technical grouping prepared; review is required for AI-first projects.');}
        finally{setAutoGenerating(false);}
      }}>Prepare technical grouping (legacy auto)</Button>
      {native?.identityPolicy!=='v1'?<Button disabled={!id||status==='busy'} onClick={()=>runReview(()=>window.studio!.captionAuthorFreeze(id!),'Caption Author task frozen.')}>Freeze AI Caption Author</Button>:<details><summary>Advanced caption recovery</summary><Button disabled={!id||status==='busy'} onClick={()=>runReview(()=>window.studio!.captionAuthorFreeze(id!),'Caption Author task frozen.')}>Rebuild AI Caption Author</Button></details>}
      {review.captionAuthorTask?.status==='FROZEN'&&<div className="stack">
        <Textarea readOnly value={review.captionAuthorTask.prompt}/>
        <Button onClick={()=>void navigator.clipboard.writeText(review.captionAuthorTask!.prompt)}>Copy frozen prompt</Button>
        <Field label="Caption Author JSON result"><Textarea value={captionResult} onChange={event=>setCaptionResult(event.target.value)}/></Field>
        <Button disabled={status==='busy'||!captionResult.trim()||review.captionAuthorTask.status!=='FROZEN'} onClick={()=>{setManualCorrection(true);void runReview(()=>window.studio!.captionAuthorImport(id!,captionResult),'AI boundaries imported; review and approve the compiled cues.');}}>Import AI word boundaries</Button>
      </div>}
      <Button onClick={()=>setManualCorrection(value=>!value)}>{manualCorrection?'Hide Manual Correction':'Manual Correction'}</Button>
      {manualCorrection&&<>
      <div className="info">Actual aligned words: {review.words.map((word,i)=>(i+1)+': '+word.word+' ['+word.start+'–'+word.end+']').join(' · ')}</div>
      <Field label="Word boundary to split after / merge at"><Select value={selectedBoundary} onChange={event=>setSelectedBoundary(Number(event.target.value))}>{review.words.slice(0,-1).map((word,i)=><option key={i+1} value={i+1}>{i+1} · after {word.word}</option>)}</Select></Field>
      <div className="actions"><Button disabled={status==='busy'} onClick={splitAtWord}>Split cue at word</Button><Button disabled={status==='busy'} onClick={mergeAtWord}>Merge adjacent cues</Button><Button disabled={status==='busy'||!id} onClick={()=>runReview(()=>window.studio!.captionDraft(id!,boundaries),'Caption draft saved; approval still required.')}>Save reviewed grouping draft</Button></div>
      <div className="info">Cue ends (word indices): {boundaries.join(', ')}. Each cue retains original word text and exact recorded boundaries; no free-text edits.</div>
      <dl className="kvs"><dt>Original Core cues</dt><dd>{review.original.map(cue=>cue.text+' ('+cue.start+'–'+cue.end+')').join(' | ')}</dd><dt>Draft cues</dt><dd>{review.draft?.cues.map(cue=>cue.text+' ('+cue.start+'–'+cue.end+')').join(' | ')??'No saved draft'}</dd><dt>Approved cues</dt><dd>{review.approved?.cues.map(cue=>cue.text).join(' | ')??'None'}</dd></dl>
      {native?.identityPolicy!=='v1'&&<><Field label="Required owner review note"><Textarea value={reviewNote} onChange={event=>setReviewNote(event.target.value)} placeholder="Confirm exact spoken words and semantic cue grouping"/></Field>
      <Button variant="primary" disabled={!id||!review.draft||!reviewNote.trim()||status==='busy'} onClick={()=>runReview(()=>window.studio!.captionApprove(id!,reviewNote),'Caption revision approved and native task invalidated for re-freeze.')}>Approve caption revision</Button></>}
      </>}
      {native?.identityPolicy==='v1'&&review.canApproveDraft&&review.draft?.sha256&&<Button variant="primary" disabled={status==='busy'||!id} onClick={()=>runReview(()=>window.studio!.captionApproveCurrent!(id!,{sha256:review.draft!.sha256!,ownerAuthorized:true}),'Exact caption draft approved.')}>Approve caption revision</Button>}
    </>}
  </Card></div>;
}
