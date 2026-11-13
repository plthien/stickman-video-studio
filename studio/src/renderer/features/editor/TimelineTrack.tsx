import type { SelectedClip, TimelineTrackName } from './types';
import { TIMELINE_SECONDS } from './timelineScale';
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
        style={{ left: `${item.start / TIMELINE_SECONDS * 100}%`, width: `${item.duration / TIMELINE_SECONDS * 100}%` }}
        title={`${item.label} · ${item.start}s–${item.start + item.duration}s · demo`}
      >{item.label}</button>)}
    </div>
  </div>;
}
