import { useEffect, useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';

export function VoiceWorkspace() {
  const { native, setNative, showNotice, nanoEndpoint, setNanoEndpoint } = useAppState();
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]), [voice, setVoice] = useState(native?.nano?.profileId ?? '');
  const [status, setStatus] = useState<'idle'|'ready'|'busy'|'error'>('idle'), [message, setMessage] = useState(''), [authorized, setAuthorized] = useState(false);
  const id = native?.project.id, script = native?.approvedScript?.text ?? '';
  const [review,setReview]=useState<null|{words:Array<{word:string;start:number;end:number}>;original:Array<{start:number;end:number;text:string}>;originalBoundaries:number[];draft:null|{boundaries:number[];cues:Array<{start:number;end:number;text:string}>};approved:null|{revision:number;cues:Array<{start:number;end:number;text:string}>}}>(null);
  const [boundaries,setBoundaries]=useState<number[]>([]),[selectedBoundary,setSelectedBoundary]=useState(1),[reviewNote,setReviewNote]=useState('');
  const refreshCaptionReview=async()=>{if(!id||!window.studio)return;const value=await window.studio.captionReview(id);setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);};
  useEffect(()=>{let active=true;if(!id||!native?.alignment||!window.studio){setReview(null);return;}void window.studio.captionReview(id).then(value=>{if(active){setReview(value);setBoundaries(value.draft?.boundaries??value.originalBoundaries);}}).catch(()=>{if(active)setReview(null)});return()=>{active=false};},[id,native?.alignment?.wordsSha256,native?.alignment?.captionReview?.revision]);
  const runReview=async(work:()=>Promise<unknown>,success:string)=>{setStatus('busy');try{await work();if(id&&window.studio)setNative(await window.studio.projectState(id));await refreshCaptionReview();setStatus('ready');showNotice(success);}catch(reason){fail(reason)}};
  const splitAtWord=()=>{const number=selectedBoundary;if(!review||number<1||number>=review.words.length)return;setBoundaries(value=>[...new Set([...value,number])].sort((a,b)=>a-b));};
  const mergeAtWord=()=>{if(!review)return;setBoundaries(value=>value.filter(number=>number!==selectedBoundary));};
  const fail = (reason: unknown) => { setStatus('error'); setMessage(reason instanceof Error ? reason.message : String(reason)); };
  const act = async (work: () => Promise<unknown>, notice: string) => { setStatus('busy'); try { await work(); if (id && window.studio) setNative(await window.studio.projectState(id)); setStatus('ready'); showNotice(notice); } catch (reason) { fail(reason); } };
  return <div className="grid wide-left"><div className="stack"><Card>
    <CardHeader title="VoiceStudio Chatterbox Nano" hint="Direct owner API · localhost:3901" action={<Badge tone={status==='ready'?'mint':status==='error'?'amber':'neutral'}>{status.toUpperCase()}</Badge>}/>
    <Field label="Local endpoint"><Input value={nanoEndpoint} onChange={event=>setNanoEndpoint(event.target.value)}/></Field>
    <Field label="Confirmed voice profile"><Select value={voice} onChange={event=>setVoice(event.target.value)}><option value="">Select discovered profile</option>{profiles.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name??item.id)} · v{String(item.version)}</option>)}</Select></Field>
    <Field label="Approved narration (project source, read only)"><Textarea readOnly value={script}/></Field>
    <div className="actions"><Button disabled={!window.studio||status==='busy'} onClick={async()=>{setStatus('busy');try{const result=await window.studio!.nanoDiscover(nanoEndpoint);setProfiles(result.profiles);setStatus(result.ready?'ready':'error');setMessage(result.ready?`${result.profiles.length} confirmed profile(s); producer ready.`:'Producer readiness failed.')}catch(reason){fail(reason)}}}>Discover producer</Button>
      <Button variant="primary" disabled={!id||!script||!voice||status==='busy'||script.length>4096} onClick={()=>act(()=>window.studio!.nanoGenerate(id!,{voice,speed:1,seed:0}),'Short narration verified and published.')}>Generate short</Button>
      <Button disabled={!id||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice}),'Owner assembler long-form published.')}>Generate long-form</Button>
      <Button disabled={!id||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice,resume:true}),'Owner assembler resumed.')}>Resume</Button>
      <Button disabled={!id||!voice||status==='busy'} onClick={()=>act(()=>window.studio!.longformRun(id!,{voice,resume:true,retryUncertain:true}),'Explicit uncertain retry completed.')}>Explicit retry</Button>
      <Button disabled={!id||status==='busy'} onClick={()=>act(()=>window.studio!.importWav(id!),'Approved WAV imported.')}>Import WAV</Button></div>
    {message&&<div className={`info ${status==='error'?'error':'success'}`}>{message}</div>}<div className="info">Exact text and language come from approved main-process project state. Uncertain requests are never auto-replayed.</div>
  </Card><Card><CardHeader title="Narration evidence"/><dl className="kvs"><dt>Audio</dt><dd>{native?.voice?.path??'Not generated'}</dd><dt>Origin</dt><dd>{native?.voice?.origin??'Missing'}</dd><dt>SHA-256</dt><dd><code>{native?.voice?.sha256??'Missing'}</code></dd><dt>Long-form</dt><dd>{native?.longform?.status??'Not run'}</dd></dl></Card></div>
  <Card><CardHeader title="ElevenLabs forced alignment" hint="Exact approved script + exact accepted WAV" action={<Badge tone="amber">USER AUTHORIZED ONLY</Badge>}/><Field label="Exact transcript uploaded"><Textarea readOnly value={script}/></Field>
    <label className="check"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)}/> I authorize this upload and possible paid usage now.</label>
    <div className="actions"><Button variant="primary" disabled={!id||!native?.voice||native.voice.stale||!authorized||status==='busy'} onClick={()=>act(async()=>{await window.studio!.align(id!,true);setAuthorized(false)},'ElevenLabs alignment saved.')}>Run forced alignment</Button><Button disabled={!id||!native?.voice||status==='busy'} onClick={()=>act(()=>window.studio!.importWords(id!),'Aligned words imported and captions generated.')}>Import aligned words JSON</Button></div>
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
