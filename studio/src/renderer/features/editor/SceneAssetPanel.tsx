import type { Shot } from '../../types/app';
export function SceneAssetPanel({ shots, selected, onSelect }: { shots: Shot[]; selected: number; onSelect: (index:number)=>void }) {
  return <aside className="editor-panel scenes-panel"><header><div><strong>Scenes & Assets</strong><small>{shots.length} native shot(s)</small></div></header>
    {shots.length===0?<div className="info">EMPTY — No native scenes.</div>:<div className="scene-list">{shots.map((shot,index)=><button key={shot.id} className={selected===index?'selected':''} onClick={()=>onSelect(index)}><div className="scene-thumb"><strong>{shot.id}</strong></div><div><strong>{shot.id}</strong><span>{shot.title}</span><small>{shot.duration}s · {shot.status}</small></div></button>)}</div>}
  </aside>;
}
