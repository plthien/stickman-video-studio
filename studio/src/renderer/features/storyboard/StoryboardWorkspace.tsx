/* eslint-disable react-hooks/exhaustive-deps -- session scopes are ref-backed; project/revision scalars define invalidation */
import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select} from '../../components/ui';
interface MissingTarget {key:string;kind:'image'|'sfx';path:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}
interface PendingTargets {token:string;status:string;missing:MissingTarget[];fulfillments:Record<string,unknown>}
const layerPath=(layers:unknown[],id:string):string|null=>{
  for(const value of layers){const layer=value as Record<string,unknown>;if(layer.id===id&&layer.type==='image')return typeof layer.path==='string'?layer.path:null;if(Array.isArray(layer.children)){const found=layerPath(layer.children,id);if(found!==null)return found;}}
  return null;
};
export function StoryboardWorkspace(){
  const [selected,setSelected]=useState(0),[targetKey,setTargetKey]=useState(''),[rights,setRights]=useState(''),[pending,setPending]=useState<PendingTargets|null>(null),[error,setError]=useState('');
  const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState(),id=native?.project.id;
  const active=native?.projection?.shots??[];
  const index=Math.min(selected,Math.max(0,active.length-1)),shot=active[index];
  useEffect(()=>{const scope=captureProjectSession();let mounted=true;setPending(null);setTargetKey('');setRights('');setError('');if(!id||!scope||!window.studio)return()=>{mounted=false};void window.studio.pendingMedia(id).then(value=>{if(mounted&&isCurrentProjectSession(scope))setPending(value as PendingTargets|null)}).catch(reason=>{if(mounted&&isCurrentProjectSession(scope)){setPending(null);setError('Pending media ERROR: '+(reason instanceof Error?reason.message:String(reason)))}});return()=>{mounted=false};},[id,native?.external?.native?.revision]);
  const available=pending?.missing??[];
  const target=available.find(item=>item.key===targetKey);
  const mapping=(native?.media??[]).filter(item=>{
    if(!shot||!item.rights?.trim())return false;
    if(item.kind==='image'&&item.shotId===shot.id&&item.layerId){
      const actual=(native?.manifest?.shots as Array<Record<string,unknown>>|undefined)?.find(s=>s.id===shot.id);
      return Boolean(actual&&Array.isArray(actual.layers)&&layerPath(actual.layers,item.layerId)===item.path);
    }
    if(item.kind==='sfx'&&item.track&&item.trackIndex!==undefined){
      const track=native?.manifest?.[item.track];
      return Array.isArray(track)&&(track[item.trackIndex] as Record<string,unknown>)?.path===item.path;
    }
    return false;
  });
  const importedUnassigned=(native?.media??[]).filter(item=>!item.shotId&&!item.track);
  const importAndBind=async()=>{
    if(!native||!window.studio||!pending||!target){setError('Choose an exact frozen native target before importing.');return;}
    if(!rights.trim()){setError('Enter explicit rights/source attestation.');return;}
    const scope=captureProjectSession();if(!scope)return;
    try{
      const file=await window.studio.importMedia(scope.projectId,{kind:target.kind,rights:rights.trim()});
      if(!file||!isCurrentProjectSession(scope))return;
      const result=await window.studio.fulfillMedia(scope.projectId,pending.token,target.key,file.path,rights.trim()) as PendingTargets;
      if(!isCurrentProjectSession(scope))return;
      const state=await window.studio.projectState(scope.projectId);
      if(!setNativeIfSessionCurrent(scope,state))return;
      setPending(result);setTargetKey('');
      setError('');showNotice('File bound to the selected pending native target; confirm the candidate to commit.');
    }catch(reason){if(isCurrentProjectSession(scope))setError(reason instanceof Error?reason.message:String(reason));}
  };
  return <div className="storyboard-layout"><Card>
    <CardHeader title="Storyboard shots" hint={native?'Only shots actually present in original project.json':'No project open'} action={<Badge tone={active.length?'mint':'amber'}>{active.length?'NATIVE DATA':'EMPTY'}</Badge>}/>
    {active.length?<div className="shot-grid">{active.map((item,i)=><button key={item.id} className={index===i?'selected':''} onClick={()=>{setSelected(i);setTargetKey('');}}><div className="scene-thumb"><strong>{item.id}</strong></div><div><strong>{item.id} · {item.title}</strong><small>{item.duration.toFixed(2)}s · {item.status}</small></div></button>)}</div>:<div className="info">EMPTY — No native shots. Import a reviewed Native Manifest from External ChatGPT. Pending media can still be bound below before promotion.</div>}
  </Card><Card><CardHeader title={shot?shot.id+' · '+shot.title:'Native media fulfillment'} hint="No synthetic image or default layer"/>
    {shot?<dl className="kvs"><dt>Duration</dt><dd>{shot.duration.toFixed(2)} seconds</dd><dt>Committed native media</dt><dd>{mapping.map(item=>item.path).join(', ')||'None'}</dd><dt>Source</dt><dd>project.json</dd></dl>:<div className="info">No selected native shot. This view does not create or display fixture artwork.</div>}
    <dl className="kvs"><dt>Unassigned media imports</dt><dd>{importedUnassigned.length}</dd><dt>Pending missing references</dt><dd>{available.length}</dd></dl>
    {native&&<><Field label="Exact missing candidate image layer or original audio track">
      <Select value={targetKey} onChange={event=>setTargetKey(event.target.value)}><option value="">Choose a real pending reference</option>{available.map(item=><option key={item.key} value={item.key}>{item.kind.toUpperCase()} · {item.shotId||item.track} / {item.layerId||item.trackIndex} · {item.path}</option>)}</Select>
    </Field><Field label="Owner-confirmed rights/source"><Input value={rights} onChange={event=>setRights(event.target.value)} placeholder="Owned or licensed source and rights"/></Field>
    <div className="actions"><Button variant="primary" disabled={!target||!rights.trim()} onClick={importAndBind}>Import and bind target</Button><Button onClick={async()=>{if(!window.studio||!id)return;const scope=captureProjectSession();if(!scope)return;try{const value=await window.studio.pendingMedia(id) as PendingTargets|null;if(!isCurrentProjectSession(scope))return;setPending(value);setError('')}catch(e){if(!isCurrentProjectSession(scope))return;setPending(null);setError('Pending media ERROR: '+String(e))}}}>Refresh missing references</Button></div>
    {pending&&<div className="info">Pending candidate: {pending.status}. A file is not committed until the reviewed native candidate is confirmed in External ChatGPT.</div>}
    {error&&<div className="info error" role="alert">{error}</div>}
    </>}
    {!native&&<div className="info">Open a real native project to import media.</div>}
  </Card></div>;
}
