import {useEffect,useState} from 'react';
import {Button,Card,CardHeader} from '../../components/ui';
type Studio=NonNullable<Window['studio']>;
type Snapshot=Awaited<ReturnType<Studio['visualIdentitySnapshot']>>;
type Character=Snapshot['registry']['characters'][number];
type Target=Snapshot['coverage']['targets'][number];
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
function ReferenceThumb({projectId,path}:{
  projectId:string;path:string
}){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let alive=true;setUrl('');
    if(!window.studio)return;
    void window.studio.mediaUrl(projectId,path).then(value=>{
      if(alive)setUrl(value);
    }).catch(()=>{if(alive)setUrl('');});
    return()=>{alive=false;};
  },[projectId,path]);
  return url?<img className="visual-identity-ref-image"
    src={url} alt={'Owner-approved reference '+path} loading="lazy"/>:
    <span className="info">Reference preview unavailable</span>;
}
/** Explicit human assignment only. No appearance inference or hidden paid operations. */
export function CharacterRegistryPanel({projectId,onChanged,onSnapshot}:{
  projectId:string;onChanged:()=>Promise<unknown>|void;
  onSnapshot?:(value:Snapshot)=>void;
}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [characterId,setCharacterId]=useState(''),[label,setLabel]=useState('');
  const [rights,setRights]=useState(''),[referenceId,setReferenceId]=useState('ref_main');
  const [existingPath,setExistingPath]=useState(''),[generatedJobId,setGeneratedJobId]=useState('');
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [pickedCharacters,setPickedCharacters]=useState<Set<string>>(new Set());
  const [noRecurring,setNoRecurring]=useState(false);
  const [relation,setRelation]=useState('none');
  const [sourceKey,setSourceKey]=useState('');
  const [reviewedImpact,setReviewedImpact]=useState<Record<string,string>>({});
  const load=async()=>{
    if(!window.studio?.visualIdentitySnapshot)return;
    const next=await window.studio.visualIdentitySnapshot(projectId);
    setSnapshot(next);onSnapshot?.(next);
  };
  useEffect(()=>{
    let alive=true;setSnapshot(null);setError('');setSelected(new Set());
    if(!window.studio?.visualIdentitySnapshot)return;
    void window.studio.visualIdentitySnapshot(projectId).then(value=>{
      if(alive){setSnapshot(value);onSnapshot?.(value);}
    }).catch(e=>{if(alive)setError(message(e));});
    return()=>{alive=false;};
  },[projectId]);
  const act=async(work:()=>Promise<unknown>)=>{
    if(busy)return;
    setBusy(true);setError('');
    try{await work();await load();await onChanged();}
    catch(e){setError(message(e));}
    finally{setBusy(false);}
  };
  if(!snapshot)return <Card><CardHeader title="Characters & References"/>
    <div className="info">{error||'Loading project-scoped identity registry…'}</div></Card>;
  const {registry,bindings,coverage}=snapshot;
  const currentTargets=coverage.targets;
  const selectedTargets=currentTargets.filter(t=>selected.has(t.key));
  const before=(target:Target)=>currentTargets.filter(t=>
    currentTargets.indexOf(t)<currentTargets.indexOf(target));
  const mapOne=async(key:string,selection:string[],none:boolean,cont:{
    sourceTargetKey:string;relation:'same_setup'|'match_subject'|
      'match_location'|'match_composition'|'graphic_sequence'
  }|null,revision:number)=>{
    if(!window.studio)throw Error('Studio disconnected.');
    return window.studio.visualIdentityMapTarget(projectId,{
      targetKey:key,characters:selection,noRecurringCharacter:none,
      continuity:cont,expectedRevision:revision
    });
  };
  return <Card>
    <CardHeader title="Characters & References"/>
    <div className="info">
      Owner-approved images only. Character mapping is explicit; no image, trait or paid generation
      is inferred from a name. Strict mode is {registry.strict?'ON':'OFF'}.
    </div>
    <div className="storyboard-compact-toolbar">
      <Button disabled={busy} onClick={()=>void act(()=>window.studio!.visualIdentitySetStrict(projectId,{
        enabled:!registry.strict,expectedRevision:registry.revision}))}>
        {registry.strict?'Disable Strict Character Continuity':'Enable Strict Character Continuity'}
      </Button>
      <Button disabled={busy} onClick={()=>void act(async()=>{})}>Refresh Registry</Button>
    </div>
    <div className="info" data-testid="character-coverage">
      Current Native Layers {currentTargets.length} · mapped {coverage.mapped} ·
      No recurring character {currentTargets.filter(t=>t.noRecurringCharacter).length} ·
      mapping review {coverage.needsReview} · blocked {coverage.blocked}
    </div>
    <div className="visual-identity-form">
      <label>Stable character ID<input className="input" aria-label="New character ID"
        placeholder="char_001" value={characterId} onChange={e=>setCharacterId(e.target.value)}/></label>
      <label>Owner label<input className="input" aria-label="New character label"
        value={label} onChange={e=>setLabel(e.target.value)}/></label>
      <Button disabled={busy||!characterId||!label.trim()}
        onClick={()=>void act(async()=>{
          await window.studio!.visualIdentityCreateCharacter(projectId,{
            characterId,label,expectedRevision:registry.revision});
          setCharacterId('');setLabel('');
        })}>Create Character</Button>
    </div>
    <div className="visual-identity-form">
      <label>Reference ID<input className="input" value={referenceId}
        aria-label="Character reference ID" onChange={e=>setReferenceId(e.target.value)}/></label>
      <label>Existing approved media path<input className="input" value={existingPath}
        aria-label="Existing reference media path" onChange={e=>setExistingPath(e.target.value)}
        placeholder="assets/images/owner-import.png"/></label>
      <label>Optional original approved G-Labs job ID<input className="input" value={generatedJobId}
        aria-label="Approved G-Labs source job ID" onChange={e=>setGeneratedJobId(e.target.value)}/></label>
      <label>Rights/source attestation for new imported image<input className="input"
        value={rights} aria-label="Character image rights" onChange={e=>setRights(e.target.value)}/></label>
    </div>
    <div className="visual-identity-character-list">
      {registry.characters.map((character:Character)=><section className="visual-identity-character"
        key={character.characterId} data-testid="character-registry-card">
        <div><strong>{character.characterId}</strong> · {character.label} · {character.status} ·
          identity v{character.identityVersion}</div>
        <div className="info">
          Referenced current Layers: {currentTargets.filter(t=>
            t.characters.includes(character.characterId)).length}
        </div>
        <div className="visual-identity-reference-list">
          {character.references.map(ref=><div className="visual-identity-reference"
            key={ref.referenceId}>
            <ReferenceThumb projectId={projectId} path={ref.relativePath}/>
            <div>{ref.referenceId} {character.canonicalReferenceId===ref.referenceId?'· CANONICAL':''}
              <div className="info">{ref.relativePath}</div>
              <div className="info">SHA {ref.sha256.slice(0,16)} · {ref.sourceKind} ·
                {' '}{ref.mime}</div>
              {ref.sourceKind==='APPROVED_GLABS'&&
                <small>Provider licensing independently verified: NO</small>}
            </div>
            <Button disabled={busy||character.status==='ARCHIVED'||
              character.canonicalReferenceId===ref.referenceId}
              onClick={()=>void act(async()=>{
                const impact=character.canonicalReferenceId?
                  await window.studio!.visualIdentityImpact(projectId,character.characterId):null;
                if(impact){
                  setReviewedImpact(prev=>({...prev,[character.characterId]:impact.impactSha256}));
                  // Explicit impact display precedes the replacement commit.
                  if(reviewedImpact[character.characterId]!==impact.impactSha256){
                    throw new Error('Impact review required: '+impact.targets.join(', ')+
                      '. Click Set Canonical again after inspecting affected Layers.');
                  }
                }
                await window.studio!.visualIdentityApproveCharacter(projectId,{
                  characterId:character.characterId,referenceId:ref.referenceId,
                  expectedRevision:registry.revision,
                  ...(impact?{reviewedImpactSha256:impact.impactSha256}:{})
                });
              })}>Set Canonical</Button>
          </div>)}
        </div>
        {reviewedImpact[character.characterId]&&
          <div className="info">Impact preview acknowledged for this registry revision.
            Replacement may invalidate current draft identity mappings and dependent outputs.</div>}
        <div className="storyboard-compact-toolbar">
          <Button disabled={busy||!referenceId.trim()||!rights.trim()||
            character.status==='ARCHIVED'}
            onClick={()=>void act(async()=>{
              await window.studio!.visualIdentityImportReference(projectId,{
                characterId:character.characterId,referenceId,rights,
                expectedRevision:registry.revision
              });
            })}>Import Owner Image</Button>
          <Button disabled={busy||!referenceId.trim()||!existingPath.trim()||
            character.status==='ARCHIVED'}
            onClick={()=>void act(()=>window.studio!.visualIdentityAddExistingReference(projectId,{
              characterId:character.characterId,referenceId,relativePath:existingPath,
              ...(generatedJobId.trim()?{sourceJobId:generatedJobId.trim()}:{ }),
              expectedRevision:registry.revision
            }))}>Add Existing Approved Image</Button>
          <Button disabled={busy||character.status==='ARCHIVED'}
            onClick={()=>void act(async()=>{
              const impact=await window.studio!.visualIdentityImpact(projectId,character.characterId);
              if(reviewedImpact[character.characterId]!==impact.impactSha256){
                setReviewedImpact(prev=>({...prev,[character.characterId]:impact.impactSha256}));
                throw new Error('Review impact before archive: '+impact.targets.join(', ')+
                  '. Click Archive again to confirm.');
              }
              await window.studio!.visualIdentityArchiveCharacter(projectId,{
                characterId:character.characterId,
                reviewedImpactSha256:impact.impactSha256,expectedRevision:registry.revision
              });
            })}>Archive</Button>
        </div>
      </section>)}
    </div>
    <details className="visual-identity-targets">
      <summary>Exact-target Character Mapping · {currentTargets.length} Layers</summary>
      <div className="info">Select only the exact Layers you approve. Never infer character
        from description or asset kind. Unmapped strict targets cannot generate.</div>
      <div className="visual-identity-form">
        <label><input type="checkbox" checked={noRecurring}
          onChange={e=>{setNoRecurring(e.target.checked);if(e.target.checked)setPickedCharacters(new Set());}}/>
          No recurring character</label>
        {registry.characters.filter(c=>c.status!=='ARCHIVED').map(c=><label key={c.characterId}>
          <input type="checkbox" aria-label={'Map '+c.characterId}
            checked={pickedCharacters.has(c.characterId)} disabled={noRecurring}
            onChange={e=>setPickedCharacters(prev=>{
              const next=new Set(prev);
              if(e.target.checked)next.add(c.characterId);else next.delete(c.characterId);
              return next;
            })}/>{c.characterId} · {c.label}
        </label>)}
      </div>
      <Button disabled={busy||!selectedTargets.length||
        (!noRecurring&&!pickedCharacters.size)}
        onClick={()=>void act(async()=>{
          let revision=bindings.revision;
          for(const target of selectedTargets){
            const updated=await mapOne(target.key,[...pickedCharacters],noRecurring,null,revision);
            revision=updated.revision;
          }
          setSelected(new Set());
        })}>Confirm mapping for {selectedTargets.length} selected Layers</Button>
      <div className="visual-identity-layer-list">
        {currentTargets.map(target=><div key={target.key} className="visual-identity-layer"
          data-testid="character-coverage-target">
          <label><input type="checkbox" aria-label={'Select target '+target.key}
            checked={selected.has(target.key)}
            onChange={e=>setSelected(prev=>{
              const next=new Set(prev);if(e.target.checked)next.add(target.key);
              else next.delete(target.key);return next;
            })}/>
            <strong>{target.shotId}/{target.layerId}</strong>
            <small>{target.key}</small></label>
          <span>{target.mappingCurrent?
            (target.noRecurringCharacter?'No recurring character':target.characters.join(', ')):
            'NEEDS_MAPPING_REVIEW'}</span>
          <span>{target.readiness}</span>
          <div className="visual-identity-form">
            <label>Previous approved image source
              <select className="input" aria-label={'Continuity source '+target.key}
                value={selected.has(target.key)?sourceKey:''}
                onChange={e=>{setSelected(new Set([target.key]));setSourceKey(e.target.value);}}>
                <option value="">No previous-image dependency</option>
                {before(target).map(source=><option key={source.key} value={source.key}>
                  {source.shotId}/{source.layerId} · {source.key}</option>)}
              </select>
            </label>
            <label>Relation
              <select className="input" aria-label={'Continuity relation '+target.key}
                value={selected.has(target.key)?relation:'none'}
                onChange={e=>{setSelected(new Set([target.key]));setRelation(e.target.value);}}>
                {['none','same_setup','match_subject','match_location','match_composition',
                  'graphic_sequence'].map(value=><option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <Button disabled={busy||!selected.has(target.key)||
              (relation!=='none'&&!sourceKey)}
              onClick={()=>void act(async()=>{
                const existing=bindings.bindings.find(b=>b.targetKey===target.key);
                await mapOne(target.key,
                  existing?.characters??[...pickedCharacters],
                  existing?.noRecurringCharacter??noRecurring,
                  relation==='none'?null:{
                    sourceTargetKey:sourceKey,
                    relation:relation as 'same_setup'|'match_subject'|'match_location'|
                      'match_composition'|'graphic_sequence'
                  },bindings.revision);
              })}>Save Exact Continuity</Button>
          </div>
        </div>)}
      </div>
    </details>
    {error&&<div className="info error" role="alert">{error}</div>}
  </Card>;
}
