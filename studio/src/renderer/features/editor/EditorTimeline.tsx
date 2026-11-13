import type { CSSProperties } from 'react';
import type { Shot } from '../../types/app';
import type { SelectedClip, TimelineTrackName } from './types';
import { TimelineTrack, type TimelineClip } from './TimelineTrack';

import { TIMELINE_SECONDS, PX_PER_SECOND, TRACK_LABEL_PX, timelineX } from './timelineScale';
interface TrackDefinition { name: TimelineTrackName; tone: string; clips: TimelineClip[] }
const clip = (label: string, start: number, duration: number): TimelineClip => ({ label, start, duration });
export function editorTracks(shots: Shot[]): TrackDefinition[] {
  let elapsed = 0;
  const scenes: TimelineClip[] = shots.map(shot => {
    const current = clip(shot.id, elapsed, shot.duration);
    elapsed += shot.duration;
    return current;
  });
  return [
    { name: 'Scenes', tone: 'mint', clips: scenes },
    { name: 'Layers', tone: 'blue', clips: [clip('Stickman', 0, 4), clip('Clock', 4, 5), clip('Desk', 9, 4), clip('Arrow', 13, 6)] },
    { name: 'Captions', tone: 'amber', clips: [clip('WHY DO WE WAIT?', 0, 4), clip('ACTION COMES FIRST', 9, 4), clip('START WITH TEN', 19, 5)] },
    { name: 'Narration', tone: 'purple', clips: [clip('Narration · Section 01', 0, 9), clip('Section 02', 9, 21)] },
    { name: 'SFX', tone: 'red', clips: [clip('Tick', 1, 1), clip('Whoosh', 9, 2), clip('Tap', 19, 1)] },
    { name: 'Ambience', tone: 'green', clips: [clip('Room tone · -22 dB', 0, 30)] }
  ];
}
const ticks = [0, 5, 10, 15, 20, 25, 30];
export function EditorTimeline({ shots, selected, time, height, onSelect, onSeek }: {
  shots: Shot[]; selected: SelectedClip; time: number; height: number;
  onSelect: (clip: SelectedClip) => void; onSeek: (seconds: number) => void;
}) {
  const tracks = editorTracks(shots);
  const seekAtX = (x: number, origin: number) => {
    const seconds = Math.max(0, Math.min(TIMELINE_SECONDS, (x - origin) / PX_PER_SECOND));
    onSeek(Math.round(seconds * 4) / 4);
  };
  const style = {
    '--timeline-label': `${TRACK_LABEL_PX}px`,
    '--timeline-lane': `${TIMELINE_SECONDS * PX_PER_SECOND}px`,
    '--playhead-px': `${timelineX(time)}px`
  } as CSSProperties;
  return <section className="editor-timeline" style={{ ...style, height }} aria-label="Editor timeline">
    <header><div><strong>Timeline</strong><small>6 tracks · 30-second demo fixture</small></div><span>Fixed demo scale · {PX_PER_SECOND} px/s</span></header>
    <div className="timeline-scroll">
      <div className="ruler">
        <div className="ruler-label" aria-hidden="true">TIME</div>
        <div className="ruler-scale" aria-label="Timeline ruler" onClick={event => seekAtX(event.clientX, event.currentTarget.getBoundingClientRect().left)}>
          {ticks.map(second => <span key={second} data-tick={second} style={{ left: second * PX_PER_SECOND }}>
            00:{String(second).padStart(2, '0')}
          </span>)}
        </div>
      </div>
      <div className="tracks">{tracks.map(track => <TimelineTrack key={track.name} {...track} selected={selected} onSelect={onSelect} />)}
        <i className="playhead" data-playhead-seconds={time} aria-hidden="true" />
      </div>
    </div>
  </section>;
}
