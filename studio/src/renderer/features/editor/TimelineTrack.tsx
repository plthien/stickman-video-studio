import type { SelectedClip, TimelineTrackName } from './types';
import { PX_PER_SECOND } from './timelineScale';
export interface TimelineClip { label: string; start: number; duration: number }
export function TimelineTrack({ name, tone, clips, selected, onSelect }: {
  name: TimelineTrackName; tone: string; clips: TimelineClip[];
  selected: SelectedClip; onSelect: (clip: SelectedClip) => void;
}) {
  return <div className="timeline-track" data-track={name}>
    <strong>{name}</strong>
    <div className="track-lane">
      {clips.map((item, index) => <button
        aria-label={`${name} clip ${item.label}`}
        key={`${name}-${index}`}
        data-start={item.start}
        data-duration={item.duration}
        className={`${tone} ${selected.track === name && selected.index === index ? 'selected' : ''}`}
        onClick={() => onSelect({ track: name, index })}
        style={{ left: item.start * PX_PER_SECOND, width: item.duration * PX_PER_SECOND }}
        title={`${item.label} · ${item.start}s–${item.start + item.duration}s · demo`}
      >{item.label}</button>)}
    </div>
  </div>;
}
