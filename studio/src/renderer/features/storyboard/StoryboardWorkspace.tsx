import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select} from '../../components/ui';
export const shots=[{id:'S01-A',title:'The wait',duration:4,caption:'WHY DO WE WAIT?',status:'Demo fixture',color:'#7bd9c9'},{id:'S01-B',title:'Stuck at the desk',duration:5,caption:'FOR MOTIVATION?',status:'Demo fixture',color:'#f1b75f'},{id:'S02-A',title:'First small action',duration:4,caption:'ACTION COMES FIRST',status:'Demo fixture',color:'#77aee8'},{id:'S02-B',title:'Momentum begins',duration:6,caption:'THEN MOTIVATION',status:'Demo fixture',color:'#d18be8'},{id:'S03-A',title:'Ten minute rule',duration:5,caption:'START WITH TEN',status:'Demo fixture',color:'#ec7d82'},{id:'S03-B',title:'Evidence grows',duration:6,caption:'BUILD THE PROOF',status:'Demo fixture',color:'#6ec48c'}];
export function ShotArt({color,caption}:{color:string;caption:string}){return <div className="shot-art" style={{'--shot-color':color}as React.CSSProperties}><div className="sun"/><div className="stick"><i/><b/><em/></div><strong>{caption}</strong></div>}

interface MissingTarget {key:string;kind:'image'|'sfx';path:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}
interface PendingTargets {token:string;status:string;missing:MissingTarget[];fulfillments:Record<string,unknown>}
const layerPath=(layers:unknown[],id:string):string|null=>{
  for(const value of layers){const layer=value as Record<string,unknown>;if(layer.id===id&&layer.type==='image')return typeof layer.path==='string'?layer.path:null;if(Array.isArray(layer.children)){const found=layerPath(layer.children,id);if(found!==null)return found;}}
  return null;
};
export function StoryboardWorkspace(){
  const [selected,setSelected]=useState(0),[targetKey,setTargetKey]=useState(''),[rights,setRights]=useState(''),[pending,setPending]=useState<PendingTargets|null>(null),[error,setError]=useState('');
  const {native,setNative,showNotice}=useAppState(),id=native?.project.id;
  const active=native?.projection?.shots?.length?native.projection.shots:shots;
  const index=Math.min(selected,active.length-1),shot=active[index];
  useEffect(()=>{let mounted=true;if(!id||!window.studio){setPending(null);return;}void window.studio.pendingMedia(id).then(value=>{if(mounted)setPending(value as PendingTargets)}).catch(()=>{if(mounted)setPending(null)});return()=>{mounted=false};},[id,native?.external?.native?.revision]);
  const available=pending?.missing??[]; // Targets belong to the frozen candidate, which may not yet be promoted to project.json.
  const target=available.find(item=>item.key===targetKey);
  const mapping= (native?.media??[]).filter(item=>{
    if(!item.rights?.trim())return false;
    if(item.kind==='image'&&item.shotId===shot.id&&item.layerId){
      const actual=(native?.manifest?.shots as Array<Record<string,unknown>>|undefined)?.find(s=>s.id===shot.id);
      return actual&&Array.isArray(actual.layers)&&layerPath(actual.layers,item.layerId)===item.path;
    }
    if(item.kind==='sfx'&&item.track&&item.trackIndex!==undefined){
      const track=native?.manifest?.[item.track];
      return Array.isArray(track)&&(track[item.trackIndex] as Record<string,unknown>)?.path===item.path;
    }
    return false;
  });
  const importedUnassigned=(native?.media??[]).filter(item=>!item.shotId&&!item.track);
  const importAndBind=async()=>{
    if(!native||!window.studio||!pending||!target){setError('Choose one explicit frozen native target before importing.');return;}
    if(!rights.trim()){setError('Enter explicit rights/source attestation.');return;}
    try{
      const file=await window.studio.importMedia(native.project.id,{kind:target.kind,rights:rights.trim()});
      if(!file)return;
      const result=await window.studio.fulfillMedia(native.project.id,pending.token,target.key,file.path,rights.trim()) as PendingTargets;
      setPending(result);setTargetKey('');setNative(await window.studio.projectState(native.project.id));
      setError('');showNotice('Asset bound to the exact frozen native target; confirm candidate import to commit mapping.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  };
  return <div className="storyboard-layout"><Card>
    <CardHeader title="Storyboard shots" hint={native?'Original native project shots · physical media mapping requires explicit target':'Demo fixture · open a native project'} action={<Badge tone={native?'mint':'amber'}>{native?'NATIVE DATA':'DEMO'}</Badge>}/>
    <div className="shot-grid">{active.map((item,i)=><button key={item.id} className={index===i?'selected':''} onClick={()=>{setSelected(i);setTargetKey('');}}><ShotArt color={item.color} caption={item.caption}/><div><strong>{item.id} · {item.title}</strong><small>{item.duration.toFixed(2)}s · {item.status}</small></div></button>)}</div>
  </Card><Card><CardHeader title={shot.id+' · '+shot.title} hint="Approved native fields only"/><div className="portrait-detail"><ShotArt color={shot.color} caption={shot.caption}/></div>
    <dl className="kvs"><dt>Duration</dt><dd>{shot.duration.toFixed(2)} seconds</dd><dt>Committed native media</dt><dd>{mapping.map(item=>item.path).join(', ')||'No committed mapping'}</dd><dt>Unassigned imports</dt><dd>{importedUnassigned.length}</dd><dt>Source</dt><dd>{native?'Original project.json':'DEMO only'}</dd></dl>
    {native&&<><Field label="Select exact missing candidate shot/layer or original audio track">
      <Select value={targetKey} onChange={event=>setTargetKey(event.target.value)}><option value="">Select an explicit target — no automatic primary layer</option>{available.map(item=><option key={item.key} value={item.key}>{item.kind.toUpperCase()} · {item.shotId||item.track} / {item.layerId||item.trackIndex} · {item.path}</option>)}</Select>
    </Field><Field label="Owner-confirmed rights/source"><Input value={rights} onChange={event=>setRights(event.target.value)} placeholder="Owned or licensed source and rights"/></Field>
    <div className="actions"><Button variant="primary" disabled={!target||!rights.trim()} onClick={importAndBind}>Import and bind selected target</Button><Button onClick={async()=>{if(!window.studio||!id)return;try{setPending(await window.studio.pendingMedia(id) as PendingTargets);setError('')}catch(e){setError(String(e))}}}>Refresh targets</Button></div>
    {pending&&<div className="info">Pending target state: {pending.status}; owner must confirm the resolved candidate in External Native before project.json changes. Pending candidate shots may not appear in the last-good storyboard until confirmation. Unassigned imports are never marked MAPPED.</div>}
    {error&&<div className="info error" role="alert">{error}</div>}
    </>}
    {!native&&<div className="info">Illustrative UI only. Open a real project to inspect shots and their native media references.</div>}
  </Card></div>;
}
