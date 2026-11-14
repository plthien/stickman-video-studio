import { useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';

export function VoiceWorkspace() {
  const { native, setNative, showNotice, nanoEndpoint, setNanoEndpoint } = useAppState();
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]), [voice, setVoice] = useState(native?.nano?.profileId ?? '');
  const [status, setStatus] = useState<'idle'|'ready'|'busy'|'error'>('idle'), [message, setMessage] = useState(''), [authorized, setAuthorized] = useState(false);
  const id = native?.project.id, script = native?.approvedScript?.text ?? '';
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
  </Card></div>;
}
