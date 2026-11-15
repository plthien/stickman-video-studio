import { useAppState } from '../../app/AppState';
import { Badge, Button } from '../../components/ui';
import type { Shot } from '../../types/app';
export function PortraitPreview({shot,time,playing,onSeek,onPlay,onPrevious,onNext}:{shot:Shot;time:number;playing:boolean;onSeek:(n:number)=>void;onPlay:()=>void;onPrevious:()=>void;onNext:()=>void}){
  const {native}=useAppState(),duration=native?.projection?.duration??0;
  return <section className="portrait-preview" data-preview-shot={shot.id}>
    <header><div><strong>Native shot timeline</strong><small>Actual encoded frames appear only after running Native Preview</small></div><Badge tone="amber">NOT_RENDERED</Badge></header>
    <div className="preview-stage"><div className="portrait-frame"><div className="info">NO FRAME — No synthetic stickman, catalog image, or preview is substituted for renderer output.</div><span className="frame-ratio">9:16</span></div></div>
    <div className="preview-controls"><Button aria-label="Previous shot" onClick={onPrevious}>‹</Button><Button variant="primary" onClick={onPlay}>{playing?'Ⅱ Pause':'▶ Play'}</Button><Button aria-label="Next shot" onClick={onNext}>›</Button><strong>{time.toFixed(2)} / {duration.toFixed(2)}s</strong></div>
    <input aria-label="Timeline seek" className="seek" type="range" min="0" max={duration} step=".25" value={time} onChange={e=>onSeek(Number(e.target.value))}/><small className="shot-name">{shot.id} · {shot.title}</small>
  </section>;
}
