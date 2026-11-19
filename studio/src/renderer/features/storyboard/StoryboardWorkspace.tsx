/* eslint-disable react-hooks/exhaustive-deps -- session scopes are ref-backed; project/revision scalars define invalidation */
import {useEffect,useState} from 'react';
import {useAppState} from '../../app/AppState';
import {Badge,Button,Card,CardHeader,Field,Input,Select,Textarea} from '../../components/ui';
import type {Shot} from '../../types/app';
interface MissingTarget {key:string;kind:'image'|'sfx';path:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}
interface PendingTargets {token:string;status:string;missing:MissingTarget[];fulfillments:Record<string,unknown>;after?:{shots?:unknown[];captions?:unknown[]};shotLedger?:unknown[];assetNeeds?:unknown[]}
const nativeImageLayers=(layers:unknown[]):string[]=>{
  const result:string[]=[];
  for(const item of layers){
    if(!item||typeof item!=='object'||Array.isArray(item))continue;
    const layer=item as Record<string,unknown>;
    if(layer.type==='image'&&typeof layer.id==='string')result.push(layer.id);
    if(Array.isArray(layer.children))result.push(...nativeImageLayers(layer.children));
  }
  return result;
};
const layerPath=(layers:unknown[],id:string):string|null=>{
  for(const value of layers){const layer=value as Record<string,unknown>;if(layer.id===id&&layer.type==='image')return typeof layer.path==='string'?layer.path:null;if(Array.isArray(layer.children)){const found=layerPath(layer.children,id);if(found!==null)return found;}}
  return null;
};
export function StoryboardWorkspace(){
  const [selected,setSelected]=useState(0),[targetKey,setTargetKey]=useState(''),[rights,setRights]=useState(''),[pending,setPending]=useState<PendingTargets|null>(null),[error,setError]=useState('');
  type ImageJob=Awaited<ReturnType<NonNullable<Window['studio']>['glabsJobs']>>[number];
  const [glabsJobs,setGlabsJobs]=useState<ImageJob[]>([]),[imageUrls,setImageUrls]=useState<Record<string,string>>({});
  const [previewReady,setPreviewReady]=useState<Record<string,string>>({}),[previewErrors,setPreviewErrors]=useState<Record<string,string>>({}),[previewAttempts,setPreviewAttempts]=useState<Record<string,number>>({});
  const [glabsConfig,setGlabsConfig]=useState<{model:string;aspectRatio:string}|null>(null);
  const [imagePrompt,setImagePrompt]=useState(''),[referencePaths,setReferencePaths]=useState(''),[glabsBusy,setGlabsBusy]=useState(false),[glabsError,setGlabsError]=useState('');
  const {native,captureProjectSession,isCurrentProjectSession,setNativeIfSessionCurrent,showNotice}=useAppState(),id=native?.project.id;
  const candidateRaw=Array.isArray(pending?.after?.shots)?pending.after.shots as Array<Record<string,unknown>>:[];
  const candidateCaptions=Array.isArray(pending?.after?.captions)?pending.after.captions as Array<Record<string,unknown>>:[];
  const candidateShots:Shot[]=candidateRaw.filter(item=>typeof item.id==='string'&&typeof item.start==='number'&&typeof item.end==='number').map(item=>{
    const start=item.start as number,end=item.end as number;
    const captions=candidateCaptions.filter(cue=>typeof cue.start==='number'&&typeof cue.end==='number'&&cue.start<end&&cue.end>start).map(cue=>({start:cue.start as number,end:cue.end as number,text:String(cue.text??'')}));
    return{id:item.id as string,title:typeof item.title==='string'?item.title:'',start,end,duration:end-start,caption:captions[0]?.text??'',captions,status:'PENDING_NATIVE_CANDIDATE',color:'#79dfc6',layers:Array.isArray(item.layers)?item.layers:[]};
  });
  const active=candidateShots.length?candidateShots:(native?.projection?.shots??[]);
  const index=Math.min(selected,Math.max(0,active.length-1)),shot=active[index];
  useEffect(()=>{const scope=captureProjectSession();let mounted=true;setPending(null);setTargetKey('');setRights('');setError('');setGlabsJobs([]);setImageUrls({});setPreviewReady({});setPreviewErrors({});setPreviewAttempts({});setImagePrompt('');setReferencePaths('');setGlabsError('');if(!id||!scope||!window.studio)return()=>{mounted=false};void window.studio.pendingMedia(id).then(value=>{if(mounted&&isCurrentProjectSession(scope))setPending(value as PendingTargets|null)}).catch(reason=>{if(mounted&&isCurrentProjectSession(scope)){setPending(null);setError('Pending media ERROR: '+(reason instanceof Error?reason.message:String(reason)))}});return()=>{mounted=false};},[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,native?.external?.native?.revision]);
  const refreshImages=async(scope=captureProjectSession())=>{
    if(!scope||!window.studio?.glabsJobs)return;
    const jobs=await window.studio.glabsJobs(scope.projectId);
    if(!isCurrentProjectSession(scope))return;
    setGlabsJobs(jobs);
    const urls:Record<string,string>={},errors:Record<string,string>={};
    await Promise.all(jobs.filter(item=>item.staged).map(async item=>{
      try{urls[item.id]=await window.studio!.mediaUrl(scope.projectId,item.staged!.path);}
      catch{errors[item.id]='Generated image preview URL is unavailable. Retry preview after checking the project asset.';}
    }));
    if(isCurrentProjectSession(scope)){
      setImageUrls(urls);
      if(Object.keys(errors).length)setPreviewErrors(previous=>({...previous,...errors}));
    }
  };
  useEffect(()=>{const scope=captureProjectSession();if(!scope||!window.studio?.glabsSettings)return;
    void window.studio.glabsSettings().then(value=>{if(isCurrentProjectSession(scope))setGlabsConfig(value.config);})
      .catch(e=>{if(isCurrentProjectSession(scope))setGlabsError(String(e));});
    void refreshImages(scope).catch(e=>{if(isCurrentProjectSession(scope))setGlabsError(String(e));});
  },[id,native?.nativeDraft?.token,native?.nativeDraft?.revision,native?.external?.native?.revision]);
  const available=pending?.missing??[];
  const visibleTargets=available.filter(item=>!shot||item.kind!=='image'||item.shotId===shot.id);
  const target=available.find(item=>item.key===targetKey);
  // A Shot's first outstanding image is actionable without making the owner
  // discover a second, unrelated media-import dropdown. Selection stays
  // scoped to the visible Shot and is never a paid submission by itself.
  const shotImageTargets=available.filter(item=>item.kind==='image'&&shot!==undefined&&item.shotId===shot.id);
  const imageTarget=shotImageTargets.find(item=>item.key===targetKey)??shotImageTargets[0]??null;
  const shotJobs=glabsJobs.filter(item=>item.shotId===shot?.id);
  const latestTargetJob=glabsJobs.find(item=>item.targetKey===imageTarget?.key&&item.token===pending?.token);
  // A load belongs only to this project, immutable job, image SHA, URL and preview attempt.
  const previewIdentity=(job:ImageJob)=>[id,job.id,job.token,job.staged?.sha256??'-',imageUrls[job.id]??'-',previewAttempts[job.id]??0].join('|');
  const matchingLedger=(pending?.shotLedger??[]).filter(item=>{
    if(!shot||!item||typeof item!=='object')return false;
    const row=item as Record<string,unknown>;
    return row.shot_id===shot.id||row.shotId===shot.id||row.id===shot.id;
  });
  const relevantNeeds=(pending?.assetNeeds??[]).filter(item=>{
    if(!shot||!item||typeof item!=='object')return false;
    const row=item as Record<string,unknown>;
    return row.shot_id===shot.id||row.shotId===shot.id||row.id===shot.id;
  });
  const generateImage=async()=>{
    const scope=captureProjectSession();
    if(!scope||!window.studio)return;
    if(!imageTarget){setGlabsError('Choose a Shot with a missing Native IMAGE layer before generating.');return;}
    if(!glabsConfig){setGlabsError('Configure the G-Labs image model and aspect ratio in Settings first.');return;}
    if(!imagePrompt.trim()){setGlabsError('Confirm the exact native/creative image prompt before submitting.');return;}
    const sameTarget=glabsJobs.filter(item=>item.targetKey===imageTarget.key&&item.token===pending?.token);
    const unknown=sameTarget.some(item=>item.status==='UNKNOWN');
    // Electron main owns the mandatory paid-request confirmation, including UNKNOWN billing warnings.
    // No renderer-only boolean can bypass that native dialog.
    setGlabsBusy(true);setGlabsError('');
    try{
      await window.studio.glabsGenerate(scope.projectId,{targetKey:imageTarget.key,prompt:imagePrompt.trim(),
        model:glabsConfig.model,aspectRatio:glabsConfig.aspectRatio,
        references:referencePaths.split(',').map(value=>value.trim()).filter(Boolean),authorized:true,
        regenerate:sameTarget.length>0,acknowledgeUnknown:unknown});
      if(isCurrentProjectSession(scope))await refreshImages(scope);
    }catch(e){if(isCurrentProjectSession(scope))setGlabsError(String(e));}
    finally{if(isCurrentProjectSession(scope))setGlabsBusy(false);}
  };
  const pollImage=async(jobId:string)=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    setGlabsBusy(true);setGlabsError('');
    try{await window.studio.glabsPoll(scope.projectId,jobId);if(isCurrentProjectSession(scope))await refreshImages(scope);}
    catch(e){if(isCurrentProjectSession(scope))setGlabsError(String(e));}
    finally{if(isCurrentProjectSession(scope))setGlabsBusy(false);}
  };
  const approveImage=async(jobId:string)=>{
    const scope=captureProjectSession();if(!scope||!window.studio)return;
    if(!rights.trim()){setGlabsError('Owner source/rights attestation required before approval.');return;}
    const job=glabsJobs.find(item=>item.id===jobId);
    if(!job||job.status!=='VALIDATED'||!job.staged||!imageUrls[job.id]||previewReady[job.id]!==previewIdentity(job)){
      setGlabsError('GLABS_PREVIEW_NOT_VERIFIED: load and inspect the current generated image before approval.');return;
    }
    if(!window.confirm('I have inspected the displayed current image. Approve this exact image revision and bind only its Native target?'))return;
    setGlabsBusy(true);setGlabsError('');
    try{
      await window.studio.glabsApprove(scope.projectId,jobId,rights.trim());
      if(!isCurrentProjectSession(scope))return;
      setPending(await window.studio.pendingMedia(scope.projectId) as PendingTargets|null);
      await refreshImages(scope);
      const next=await window.studio.projectState(scope.projectId);
      if(setNativeIfSessionCurrent(scope,next))showNotice('Approved G-Labs image bound to frozen target; confirm Native candidate separately.');
    }catch(e){if(isCurrentProjectSession(scope))setGlabsError(String(e));}
    finally{if(isCurrentProjectSession(scope))setGlabsBusy(false);}
  };
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
    <CardHeader title="Storyboard shots" hint={candidateShots.length?'Frozen external Native candidate · not yet committed':'Only shots actually present in original project.json'} action={<Badge tone={active.length?'mint':'amber'}>{active.length?'NATIVE DATA':'EMPTY'}</Badge>}/>
    {active.length?<div className="shot-grid">{active.map((item,i)=><button key={item.id} className={index===i?'selected':''} onClick={()=>{setSelected(i);setTargetKey('');setImagePrompt('');}}><div className="scene-thumb"><strong>{item.id}</strong></div><div><strong>{item.id} · {item.title}</strong><small>{item.duration.toFixed(2)}s · {item.status}</small></div></button>)}</div>:<div className="info">EMPTY — No native shots. Import a reviewed Native Manifest from External ChatGPT. Pending media can still be bound below before promotion.</div>}
  </Card><Card><CardHeader title={shot?shot.id+' · '+shot.title:'Native media fulfillment'} hint="No synthetic image or default layer"/>
    {shot?<dl className="kvs"><dt>Duration</dt><dd>{shot.duration.toFixed(2)} seconds</dd><dt>Caption overlaps</dt><dd>{shot.captions?.map(item=>item.text+' ('+item.start+'–'+item.end+')').join(' | ')??shot.caption}</dd><dt>Committed native media</dt><dd>{mapping.map(item=>item.path).join(', ')||'None'}</dd><dt>Source</dt><dd>{candidateShots.length?'FROZEN NATIVE CANDIDATE':'project.json'}</dd></dl>:<div className="info">No selected native shot. This view does not create or display fixture artwork.</div>}
    {native&&<Card><CardHeader title="Generate G-Labs image" hint="Choose a missing image layer for this Shot. Submissions are paid and require explicit confirmation."/>
      <div className="info">Missing image targets in selected Shot: {shotImageTargets.length} · Total unresolved media references: {available.length}.</div>
      {shotImageTargets.length>0?<Field label="Image layer to generate"><Select value={imageTarget?.key??''} onChange={event=>{setTargetKey(event.target.value);setImagePrompt('');setGlabsError('');}}>
        {shotImageTargets.map(item=><option key={item.key} value={item.key}>{item.layerId} · {item.path}</option>)}
      </Select></Field>:<div className="info" data-testid="glabs-image-unavailable">{!pending?'No current Native Author candidate is staged. Import/validate Native Author JSON first.':available.some(item=>item.kind==='image')?'No missing IMAGE layer in this Shot. Select another Shot on the left.':'No unfulfilled IMAGE layer remains in the current Native candidate.'}</div>}
      {imageTarget&&<div className="info">{imageTarget.shotId} / {imageTarget.layerId} · {imageTarget.path}</div>}
      <Field label="Image prompt (owner-confirmed, not invented)"><Textarea value={imagePrompt} onChange={event=>setImagePrompt(event.target.value)} placeholder="Paste/confirm the actual image requirement from Native asset_needs or shot ledger"/></Field>
      <Field label="Ordered image references (comma-separated approved assets/images paths)"><Input value={referencePaths} onChange={event=>setReferencePaths(event.target.value)} placeholder="assets/images/reference1.png, assets/images/reference2.png"/></Field>
      <div className="info">Model: {glabsConfig?.model??'Configure Settings first'} · Ratio: {glabsConfig?.aspectRatio??'unconfigured'} · Existing attempt: {latestTargetJob?.status??'None'}</div>
      <Button variant="primary" disabled={glabsBusy||!imageTarget||!glabsConfig||!imagePrompt.trim()} onClick={generateImage}>Generate / Regenerate image (paid confirmation)</Button>
    </Card>}
    {shot&&<><div className="info">Image layers: {nativeImageLayers(shot.layers??[]).join(', ')||'No image layers'}</div>
      {matchingLedger.length>0&&<pre className="prompt">Shot creative ledger (read only): {JSON.stringify(matchingLedger,null,2)}</pre>}
      {relevantNeeds.length>0&&<pre className="prompt">Asset needs (read only): {JSON.stringify(relevantNeeds,null,2)}</pre>}
    </>}
    <dl className="kvs"><dt>Unassigned media imports</dt><dd>{importedUnassigned.length}</dd><dt>Pending missing references</dt><dd>{available.length}</dd></dl>
    {native&&<><Field label="Exact missing candidate image layer or original audio track">
      <Select value={targetKey} onChange={event=>{setTargetKey(event.target.value);setImagePrompt('');setGlabsError('');}}><option value="">Choose a real pending reference</option>{visibleTargets.map(item=><option key={item.key} value={item.key}>{item.kind.toUpperCase()} · {item.shotId||item.track} / {item.layerId||item.trackIndex} · {item.path}</option>)}</Select>
    </Field><Field label="Owner-confirmed rights/source"><Input value={rights} onChange={event=>setRights(event.target.value)} placeholder="Owned or licensed source and rights"/></Field>
    <div className="actions"><Button variant="primary" disabled={!target||!rights.trim()} onClick={importAndBind}>Import and bind target</Button><Button onClick={async()=>{if(!window.studio||!id)return;const scope=captureProjectSession();if(!scope)return;try{const value=await window.studio.pendingMedia(id) as PendingTargets|null;if(!isCurrentProjectSession(scope))return;setPending(value);setError('')}catch(e){if(!isCurrentProjectSession(scope))return;setPending(null);setError('Pending media ERROR: '+String(e))}}}>Refresh missing references</Button></div>
    {pending&&<div className="info">Pending candidate: {pending.status}. A file is not committed until the reviewed native candidate is confirmed in External ChatGPT.</div>}

    {shotJobs.length>0&&<div className="stack" aria-label="G-Labs image attempts">{shotJobs.map(job=><Card key={job.id}>
      <CardHeader title={job.layerId+' · '+job.status} hint={job.model+' / '+job.aspectRatio}/>
      <div className="info">Target: {job.targetPath} · Task: {job.providerTaskId??'Unconfirmed'} · {job.reason??''}</div>
      {job.staged&&imageUrls[job.id]&&<img key={previewIdentity(job)} src={imageUrls[job.id]} alt={'G-Labs candidate for '+job.shotId+'/'+job.layerId} style={{maxWidth:'100%',maxHeight:260,objectFit:'contain'}}
        onLoad={event=>{
          if(event.currentTarget.complete&&event.currentTarget.naturalWidth>0&&event.currentTarget.naturalHeight>0){
            setPreviewReady(previous=>({...previous,[job.id]:previewIdentity(job)}));
            setPreviewErrors(previous=>{const next={...previous};delete next[job.id];return next;});
          }else{
            setPreviewReady(previous=>{const next={...previous};delete next[job.id];return next;});
            setPreviewErrors(previous=>({...previous,[job.id]:'The image did not decode to visible pixels.'}));
          }
        }}
        onError={()=>{
          setPreviewReady(previous=>{const next={...previous};delete next[job.id];return next;});
          setPreviewErrors(previous=>({...previous,[job.id]:'Generated image preview failed to load.'}));
        }}/>} 
      {job.status==='VALIDATED'&&previewReady[job.id]!==previewIdentity(job)&&<div className="info">Preview not verified — approve is disabled until the actual image loads.</div>}
      {previewErrors[job.id]&&<div className="info error" role="alert">{previewErrors[job.id]}</div>}
      {job.staged&&previewErrors[job.id]&&<Button disabled={glabsBusy} onClick={()=>{
        setPreviewReady(previous=>{const next={...previous};delete next[job.id];return next;});
        setPreviewErrors(previous=>{const next={...previous};delete next[job.id];return next;});
        setPreviewAttempts(previous=>({...previous,[job.id]:(previous[job.id]??0)+1}));
        const scope=captureProjectSession();
        if(scope)void refreshImages(scope).catch(error=>{if(isCurrentProjectSession(scope))setGlabsError(String(error));});
      }}>Retry image preview</Button>}
      <div className="actions">
        {['SUBMITTED','RUNNING','DOWNLOADED','UNKNOWN'].includes(job.status)&&<Button disabled={glabsBusy} onClick={()=>void pollImage(job.id)}>{job.providerTaskId?'Resume / Check status (read-only)':'Reconcile unconfirmed submission (read-only)'}</Button>}
        {job.status==='QUEUED'&&<Button disabled={glabsBusy} onClick={async()=>{
          const scope=captureProjectSession();if(!scope||!window.studio||!window.confirm('Cancel this queued G-Labs attempt before paid submission?'))return;
          try{await window.studio.glabsCancelQueued(scope.projectId,job.id);if(isCurrentProjectSession(scope))await refreshImages(scope);}
          catch(error){if(isCurrentProjectSession(scope))setGlabsError(String(error));}
        }}>Cancel queued attempt</Button>}
        {job.status==='VALIDATED'&&<Button variant="primary" disabled={glabsBusy||!rights.trim()||!imageUrls[job.id]||previewReady[job.id]!==previewIdentity(job)} onClick={()=>void approveImage(job.id)}>Approve inspected image + bind</Button>}
      </div>
      {job.approved&&<div className="info">Owner approved media: {job.approved.path} · SHA {job.approved.sha256}. Native candidate confirmation is separate.</div>}
    </Card>)}</div>}
    {shotJobs.some(job=>job.status==='APPROVED')&&<div className="info">An approved image remains locked. To replace it, start a new reviewed Native correction candidate for the exact Shot/layer; the existing committed asset is retained until the new candidate is confirmed.</div>}
    {glabsError&&<div className="info error" role="alert">{glabsError}</div>}
    {error&&<div className="info error" role="alert">{error}</div>}
    </>}
    {!native&&<div className="info">Open a real native project to import media.</div>}
  </Card></div>;
}
