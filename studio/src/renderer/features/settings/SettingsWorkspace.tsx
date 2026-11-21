import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select} from '../../components/ui';

type KeyStatus=Awaited<ReturnType<NonNullable<Window['studio']>['elevenLabsStatus']>>;

export function SettingsWorkspace(){
  const {native,nanoEndpoint,setNanoEndpoint}=useAppState();
  const [doctor,setDoctor]=useState('NOT RUN'),[detail,setDetail]=useState('');
  const [compact,setCompact]=useState(true);
  const [key,setKey]=useState(''),[keyStatus,setKeyStatus]=useState<KeyStatus|null>(null);
  const [keyBusy,setKeyBusy]=useState(false),[keyError,setKeyError]=useState('');
  const [glabs,setGlabs]=useState({endpoint:'http://127.0.0.1:8765',contract:'legacy' as const,model:'nano_banana_2',aspectRatio:'9:16'});
  const [glabsKey,setGlabsKey]=useState(''),[glabsConfigured,setGlabsConfigured]=useState(false),[glabsSecure,setGlabsSecure]=useState(false);
  const [glabsBusy,setGlabsBusy]=useState(false),[glabsStatus,setGlabsStatus]=useState('NOT TESTED'),[glabsError,setGlabsError]=useState('');
  useEffect(()=>{
    let active=true;
    if(!window.studio?.glabsSettings)return()=>{active=false};
    void window.studio.glabsSettings().then(data=>{if(active){setGlabs(data.config);setGlabsConfigured(data.credential.configured);setGlabsSecure(data.credential.secureStorageAvailable);}})
      .catch(error=>{if(active)setGlabsError(String(error));});
    return()=>{active=false};
  },[]);
  const applyGlabs=async()=>{
    if(!window.studio||glabsBusy)return;setGlabsBusy(true);setGlabsError('');
    try{await window.studio.glabsConfigure(glabs);setGlabsStatus('CONFIGURED — NOT TESTED');}
    catch(error){setGlabsError(String(error));}finally{setGlabsBusy(false);}
  };
  const storeGlabsKey=async()=>{
    if(!window.studio||!glabsKey.trim()||glabsBusy)return;setGlabsBusy(true);setGlabsError('');
    try{await window.studio.glabsSaveKey(glabsKey);setGlabsKey('');setGlabsConfigured(true);setGlabsStatus('NOT TESTED');}
    catch(error){setGlabsError(String(error));}finally{setGlabsBusy(false);}
  };
  const checkGlabs=async()=>{
    if(!window.studio||glabsBusy)return;setGlabsBusy(true);setGlabsError('');setGlabsStatus('TESTING (READ-ONLY)');
    try{const result=await window.studio.glabsProbe();setGlabsStatus(result.status+' · '+result.modelCapability+' · selected '+result.configuredModel);if(result.status!=='AUTH_VERIFIED')setGlabsError(result.diagnostic);}
    catch(error){setGlabsError(String(error));setGlabsStatus('BLOCKED');}finally{setGlabsBusy(false);}
  };
  useEffect(()=>{
    let active=true;
    if(!window.studio?.elevenLabsStatus)return()=>{active=false};
    void window.studio.elevenLabsStatus().then(value=>{
      if(active){setKeyStatus(value);setKeyError('');}
    }).catch(reason=>{
      if(active)setKeyError('ElevenLabs settings unavailable: '+String(reason));
    });
    return()=>{active=false};
  },[]);
  const save=async()=>{
    if(!window.studio||!key.trim()||keyBusy)return;
    setKeyBusy(true);setKeyError('');
    try{
      const status=await window.studio.elevenLabsSaveKey(key);
      setKeyStatus(status);setKey('');
    }catch(error){setKeyError('Could not save ElevenLabs API key: '+String(error));}
    finally{setKeyBusy(false);}
  };
  const clear=async()=>{
    if(!window.studio||keyBusy)return;
    setKeyBusy(true);setKeyError('');
    try{
      setKeyStatus(await window.studio.elevenLabsClearKey());
      setKey('');
    }catch(error){setKeyError('Could not remove ElevenLabs API key: '+String(error));}
    finally{setKeyBusy(false);}
  };
  return <div className="grid two">
    <div className="stack">
      <Card>
        <CardHeader title="VoiceStudio Nano" hint="Shared localhost producer configuration" action={<Badge tone="neutral">LOCAL ONLY</Badge>}/>
        <Field label="Base URL"><Input value={nanoEndpoint} onChange={e=>setNanoEndpoint(e.target.value)}/></Field>
        <div className="info">Default port 3901. Voice & Captions uses this same value and discovers readiness, capabilities, and confirmed profiles directly.</div>
      </Card>
      <Card>
        <CardHeader title="ElevenLabs API key" hint="For authorized forced alignment only" action={<Badge tone={keyStatus?.configured?'mint':'amber'}>{keyStatus?.configured?'CONFIGURED':'NOT CONFIGURED'}</Badge>}/>
        <Field label="API key">
          <Input type="password" autoComplete="off" value={key} onChange={event=>setKey(event.target.value)} placeholder="Enter ElevenLabs API key (never displayed after save)" />
        </Field>
        <div className="actions">
          <Button variant="primary" disabled={!window.studio||keyBusy||!key.trim()||!keyStatus?.secureStorageAvailable} onClick={save}>Save API key</Button>
          <Button disabled={!window.studio||keyBusy||keyStatus?.source!=='secure-storage'} onClick={clear}>Remove saved key</Button>
        </div>
        <div className="info">
          {keyStatus?.source==='secure-storage'?'Stored using OS-protected encryption on this device.':
           keyStatus?.source==='environment'?'Configured through the Electron main-process environment.':
           'No ElevenLabs key configured.'}
          {!keyStatus?.secureStorageAvailable?' Secure key storage is unavailable; use a main-process environment variable instead.':''}
          {' '}The key is never shown or stored in a project. Each alignment still requires explicit upload authorization.
        </div>
        {keyError&&<div className="info error" role="alert">{keyError}</div>}
      </Card>
      <Card>
        <CardHeader title="G-Labs image webhook" hint="Local-only legacy adapter · health/auth check never creates paid jobs" action={<Badge tone={glabsStatus.startsWith('AUTH_VERIFIED')?'neutral':'amber'}>{glabsStatus}</Badge>}/>
        <Field label="Local webhook origin"><Input value={glabs.endpoint} onChange={event=>setGlabs(v=>({...v,endpoint:event.target.value}))} placeholder="http://127.0.0.1:8765"/></Field>
        <Field label="Selected image model"><Select value={glabs.model} onChange={event=>setGlabs(v=>({...v,model:event.target.value}))}>
          <option value="nano_banana_2">nano_banana_2</option><option value="nano_banana_pro">nano_banana_pro</option>
        </Select></Field>
        <Field label="Aspect ratio"><Select value={glabs.aspectRatio} onChange={event=>setGlabs(v=>({...v,aspectRatio:event.target.value}))}>
          {['1:1','3:4','4:3','9:16','16:9'].map(ratio=><option key={ratio} value={ratio}>{ratio}</option>)}
        </Select></Field>
        <Button disabled={glabsBusy} onClick={applyGlabs}>Save webhook settings</Button>
        <Field label="G-Labs API key"><Input type="password" autoComplete="off" value={glabsKey} onChange={event=>setGlabsKey(event.target.value)} placeholder="Encrypted in Windows OS storage"/></Field>
        <div className="actions">
          <Button disabled={glabsBusy||!glabsSecure||!glabsKey.trim()} onClick={storeGlabsKey}>Save G-Labs key</Button>
          <Button disabled={glabsBusy||!glabsConfigured} onClick={async()=>{if(!window.studio)return;setGlabsBusy(true);try{await window.studio.glabsClearKey();setGlabsConfigured(false);setGlabsStatus('NOT TESTED');}catch(e){setGlabsError(String(e));}finally{setGlabsBusy(false);}}}>Remove key</Button>
          <Button variant="primary" disabled={glabsBusy||!glabsConfigured} onClick={checkGlabs}>Test health + auth (free)</Button>
        </div>
        <div className="info">Key {glabsConfigured?'configured':'missing'} · OS storage {glabsSecure?'available':'unavailable'}. v5 is blocked until its live request contract can be verified. Every image POST additionally needs explicit confirmation in Storyboard.</div>
        {glabsError&&<div className="info error" role="alert">{glabsError}</div>}
      </Card>
      <Card>
        <CardHeader title="External authoring"/>
        <div className="check">✓ Manual ChatGPT Web handoff</div>
        <div className="check">✓ Frozen project-bound tasks</div>
        <div className="check">✓ No embedded LLM API</div>
        <div className="check">✓ Local verified media only</div>
      </Card>
    </div>
    <div className="stack">
      <Card>
        <CardHeader title="Desktop preferences"/>
        <label className="toggle"><input type="checkbox" checked={compact} onChange={e=>setCompact(e.target.checked)}/><span/> Compact pipeline density</label>
      </Card>
      <Card>
        <CardHeader title="Mode B core integrity" hint="Original native runtime" action={<Badge tone={doctor==='PASS'?'mint':'amber'}>{doctor}</Badge>}/>
        <dl className="kvs"><dt>Runtime</dt><dd>autopilot.mjs</dd><dt>Renderer</dt><dd>autopilot-render.mjs</dd><dt>IPC</dt><dd>Opaque project ID allowlist</dd></dl>
        <Button disabled={!native||doctor==='RUNNING'} onClick={async()=>{
          if(!native||!window.studio)return;setDoctor('RUNNING');
          try{const result=await window.studio.nativeRun(native.project.id,'doctor',{});setDetail(result.stdout);setDoctor('PASS')}
          catch(reason){setDetail(String(reason));setDoctor('FAIL')}
        }}>Run native doctor</Button>
        {detail&&<pre className="prompt">{detail}</pre>}
      </Card>
      <Card>
        <CardHeader title="Diagnostics"/>
        <div className="check">✓ Context isolation and sandbox</div>
        <div className="check">✓ Node integration disabled</div>
        <div className="check">✓ External navigation denied</div>
      </Card>
    </div>
  </div>;
}
