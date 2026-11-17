import { useEffect, useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';

export function VoiceWorkspace() {
  const { native, captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent, showNotice, nanoEndpoint, setNanoEndpoint } = useAppState();
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]), [voice, setVoice] = useState(native?.nano?.profileId ?? '');
  const [status, setStatus] = useState<'idle'|'ready'|'busy'|'error'|'cancelled'>('idle'), [message, setMessage] = useState(''), [authorized, setAuthorized] = useState(false);
  const id = native?.project.id, script = native?.approvedScript?.text ?? '';
  useEffect(()=>{setVoice(native?.nano?.profileId??'');setProfiles([]);setAuthorized(false);},[id,native?.nano?.profileId]);
  const [playbackUrl,setPlaybackUrl]=useState(''),[playbackError,setPlaybackError]=useState('');
  const audioSha=native?.voice?.sha256,voiceStale=native?.voice?.stale;
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
  },[id,audioSha,voiceStale]);
  const hasAlignment = Boolean(native?.alignment);
  const wordsSha256 = native?.alignment?.wordsSha256;
  const captionRevision = native?.alignment?.captionReview?.revision;
  const [review,setReview]=useState<null|{words:Array<{word:string;start:number;end:number}>;original:Array<{start:number;end:number;text:string}>;originalBoundaries:number[];draft:null|{boundaries:number[];cues:Array<{start:number;end:number;text:string}>};approved:null|{revision:number;cues:Array<{start:number;end:number;text:string}>}}>(null);
  const [boundaries,setBoundaries]=useState<number[]>([]),[selectedBoundary,setSelectedBoundary]=useState(1),[reviewNote,setReviewNote]=useState('');
  const refreshCaptionReview=async(scope= captureProjectSession())=>{if(!id||!scope||!window.studio)return false;const value=await window.studio.captionReview(scope.projectId);if(!isCurrentProjectSession(scope))return false;setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);return true;};
  useEffect(()=>{setMessage('');setStatus('idle');setReview(null);setBoundaries([]);setSelectedBoundary(1);setReviewNote('');let active=true;if(!id||!hasAlignment||!window.studio)return()=>{active=false};void window.studio.captionReview(id).then(value=>{if(active){setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);}}).catch(reason=>{if(active){setStatus('error');setMessage('Caption review ERROR: '+(reason instanceof Error?reason.message:String(reason)))}});return()=>{active=false};},[id,hasAlignment,wordsSha256,captionRevision]);
  const runReview=async(work:()=>Promise<unknown>,success:string)=>{const scope=captureProjectSession();if(!id||!scope)return;setStatus('busy');try{await work();if(!isCurrentProjectSession(scope))return;if(window.studio){const next=await window.studio.projectState(scope.projectId);if(!setNativeIfSessionCurrent(scope,next))return;}if(!await refreshCaptionReview(scope))return;setStatus('ready');showNotice(success);}catch(reason){if(isCurrentProjectSession(scope))fail(reason)}};
  const splitAtWord=()=>{const number=selectedBoundary;if(!review||number<1||number>=review.words.length)return;setBoundaries(value=>[...new Set([...value,number])].sort((a,b)=>a-b));};
  const mergeAtWord=()=>{if(!review)return;setBoundaries(value=>value.filter(number=>number!==selectedBoundary));};
  const fail = (reason: unknown) => { setStatus('error'); setMessage(reason instanceof Error ? reason.message : String(reason)); };
  const act = async (work: () => Promise<unknown>, notice: string,afterSuccess?:()=>void) => { const scope=captureProjectSession();if(!id||!scope)return;setStatus('busy');setMessage(''); try { const result=await work();if(!isCurrentProjectSession(scope))return;if(result===null){setStatus('cancelled');setMessage('CANCELLED — no project data changed.');return;} if (window.studio){const next=await window.studio.projectState(scope.projectId);if(!setNativeIfSessionCurrent(scope,next))return;} afterSuccess?.();setStatus('ready'); showNotice(notice); } catch (reason) { if(isCurrentProjectSession(scope))fail(reason); } };
  return <div className="grid wide-left"><div className="stack"><Card>
    <CardHeader title="VoiceStudio Chatterbox Nano" hint="Direct owner API · localhost:3901" action={<Badge tone={status==='ready'?'mint':status==='error'?'amber':'neutral'}>{status.toUpperCase()}</Badge>}/>
    <Field label="Local endpoint"><Input value={nanoEndpoint} onChange={event=>setNanoEndpoint(event.target.value)}/></Field>
    <Field label="Confirmed voice profile"><Select value={voice} onChange={event=>setVoice(event.target.value)}><option value="">Select discovered profile</option>{profiles.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name??item.id)} · v{String(item.version)}</option>)}</Select></Field>
    <Field label="Approved narration (project source, read only)"><Textarea readOnly value={script}/></Field>
    <div className="actions"><Button disabled={!window.studio||status==='busy'} onClick={async()=>{const scope=captureProjectSession();if(!scope)return;setStatus('busy');try{const result=await window.studio!.nanoDiscover(nanoEndpoint);if(!isCurrentProjectSession(scope))return;setProfiles(result.profiles);setStatus(result.ready?'ready':'error');setMessage(result.ready?`${result.profiles.length} confirmed profile(s); producer ready.`:'Producer readiness failed.')}catch(reason){if(isCurrentProjectSession(scope))fail(reason)}}}>Discover producer</Button>
      <Button variant="primary" disabled={!id||!script||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice}),'API narration verified and published.')}>Generate narration</Button>
      <Button disabled={!id||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice,resume:true}),'Owner assembler resumed.')}>Resume</Button>
      <Button disabled={!id||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice,resume:true,retryUncertain:true}),'Explicit uncertain retry completed.')}>Explicit retry</Button>
      <Button disabled={!id||status==='busy'} onClick={()=>act(()=>window.studio!.importWav(id!),'Approved WAV imported.')}>Import WAV</Button></div>
    {message&&<div className={`info ${status==='error'?'error':''}`} role={status==='error'?'alert':undefined}>{message}</div>}<div className="info">Exact text and language come from approved main-process project state. Uncertain requests are never auto-replayed.</div>
  </Card><Card><CardHeader title="Narration evidence"/><dl className="kvs"><dt>Audio</dt><dd>{native?.voice?.path??'Not generated'}</dd><dt>Origin</dt><dd>{native?.voice?.origin??'Missing'}</dd><dt>SHA-256</dt><dd><code>{native?.voice?.sha256??'Missing'}</code></dd><dt>Long-form</dt><dd>{native?.longform?.status??'Not run'}</dd></dl>
    {native?.voice&&!voiceStale&&playbackUrl?<div className="stack">
      <strong>Listen to accepted narration</strong>
      <audio key={id+':'+audioSha} aria-label="Accepted narration audio" controls preload="metadata" src={playbackUrl} style={{width:'100%'}}
        onError={()=>setPlaybackError('Accepted narration WAV could not be played.')}/>
    </div>:<div className="info">{voiceStale?'Narration is stale; regenerate or import approved WAV.':'No verified narration available for playback.'}</div>}
    {playbackError&&<div className="info error" role="alert">{playbackError}</div>}
  </Card></div>
  <Card><CardHeader title="ElevenLabs forced alignment" hint="Exact approved script + exact accepted WAV" action={<Badge tone="amber">USER AUTHORIZED ONLY</Badge>}/><Field label="Exact transcript uploaded"><Textarea readOnly value={script}/></Field>
    <label className="check"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)}/> I authorize this upload and possible paid usage now.</label>
    <div className="actions"><Button variant="primary" disabled={!id||!native?.voice||native.voice.stale||!authorized||status==='busy'} onClick={()=>act(()=>window.studio!.align(id!,true),'ElevenLabs alignment saved.',()=>setAuthorized(false))}>Run forced alignment</Button><Button disabled={!id||!native?.voice||status==='busy'} onClick={()=>act(()=>window.studio!.importWords(id!),'Aligned words imported and captions generated.')}>Import aligned words JSON</Button></div>
    <div className="info">Vietnamese support is not assumed. Import owner-verified word timestamps when live language coverage is unconfirmed. Secrets remain main-process only.</div><dl className="kvs"><dt>Words file</dt><dd>{native?.alignment?.path??'Not aligned'}</dd><dt>Origin</dt><dd>{native?.alignment?.origin??'Missing'}</dd></dl>
  </Card>
  <Card><CardHeader title="Semantic caption review" hint="Original Core grouping · real WORDS · owner-approved revision" action={<Badge tone={review?.approved?'mint':'amber'}>{review?.approved?'APPROVED r'+review.approved.revision:'REVIEW REQUIRED'}</Badge>}/>
    {!review?<div className="info">Align/import real word timestamps, then review exact Core-generated cues. Generated captions are not implicitly approved.</div>:<>
      <div className="info">Actual aligned words: {review.words.map((word,i)=>(i+1)+': '+word.word+' ['+word.start+'–'+word.end+']').join(' · ')}</div>
      <Field label="Word boundary to split after / merge at"><Select value={selectedBoundary} onChange={event=>setSelectedBoundary(Number(event.target.value))}>{review.words.slice(0,-1).map((word,i)=><option key={i+1} value={i+1}>{i+1} · after {word.word}</option>)}</Select></Field>
      <div className="actions"><Button disabled={status==='busy'} onClick={splitAtWord}>Split cue at word</Button><Button disabled={status==='busy'} onClick={mergeAtWord}>Merge adjacent cues</Button><Button disabled={status==='busy'||!id} onClick={()=>runReview(()=>window.studio!.captionDraft(id!,boundaries),'Caption draft saved; approval still required.')}>Save reviewed grouping draft</Button></div>
      <div className="info">Cue ends (word indices): {boundaries.join(', ')}. Each cue retains original word text and exact recorded boundaries; no free-text edits.</div>
      <dl className="kvs"><dt>Original Core cues</dt><dd>{review.original.map(cue=>cue.text+' ('+cue.start+'–'+cue.end+')').join(' | ')}</dd><dt>Draft cues</dt><dd>{review.draft?.cues.map(cue=>cue.text+' ('+cue.start+'–'+cue.end+')').join(' | ')??'No saved draft'}</dd><dt>Approved cues</dt><dd>{review.approved?.cues.map(cue=>cue.text).join(' | ')??'None'}</dd></dl>
      <Field label="Required owner review note"><Textarea value={reviewNote} onChange={event=>setReviewNote(event.target.value)} placeholder="Confirm exact spoken words and semantic cue grouping"/></Field>
      <Button variant="primary" disabled={!id||!review.draft||!reviewNote.trim()||status==='busy'} onClick={()=>runReview(()=>window.studio!.captionApprove(id!,reviewNote),'Caption revision approved and native task invalidated for re-freeze.')}>Approve caption revision</Button>
    </>}
  </Card></div>;
}
