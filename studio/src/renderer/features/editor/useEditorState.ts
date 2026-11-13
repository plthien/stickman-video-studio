import { createContext, createElement, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { shots } from '../storyboard/StoryboardWorkspace';
import type { EditorState, InspectorValues, SelectedClip } from './types';

export const timelineDuration = shots.reduce((total, shot) => total + shot.duration, 0);
export const shotStartTime = (index: number) => shots.slice(0, index).reduce((total, shot) => total + shot.duration, 0);
export function shotIndexAtTime(time: number) {
  const clamped = Math.max(0, Math.min(timelineDuration, time));
  if (clamped === timelineDuration) return shots.length - 1;
  let boundary = 0;
  for (let index = 0; index < shots.length; index += 1) {
    boundary += shots[index].duration;
    if (clamped < boundary) return index;
  }
  return shots.length - 1;
}

export const initialShotEdits: Record<string, InspectorValues> = Object.fromEntries(shots.map((shot, index) => [shot.id, {
  layerName: `stickman_${String(index + 1).padStart(2, '0')}`,
  x: 540 + index * 8,
  y: 910 - index * 6,
  w: 620,
  angle: index % 2 === 0 ? 0 : -4,
  alpha: 1,
  progress: Math.min(.9, .45 + index * .08)
}])) as Record<string, InspectorValues>;

const createInitialState = (): EditorState => ({
  shots,
  mode: 'edit',
  time: 0,
  playing: false,
  timelineHeight: 244,
  qaOpen: false,
  inspectorTab: 'layer',
  shotEdits: structuredClone(initialShotEdits),
  selectedClip: { track: 'Scenes', index: 0 }
});

interface EditorSession {
  state: EditorState;
  setState: Dispatch<SetStateAction<EditorState>>;
}
const EditorSessionContext = createContext<EditorSession | null>(null);
/** Kept above the router: navigation never discards in-memory inspector and timeline edits. */
export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createInitialState);
  return createElement(EditorSessionContext.Provider, { value: { state, setState } }, children);
}

export function useEditorState() {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error('EditorSessionProvider missing');
  const { state, setState } = session;
  // The timer is route-scoped and cleaned up as soon as the editor unmounts.
  useEffect(() => () => setState(current => ({ ...current, playing: false, qaOpen: false })), [setState]);
  const selectedShotIndex = shotIndexAtTime(state.time);
  const selectedShot = state.shots[selectedShotIndex];
  const inspectorValues = state.shotEdits[selectedShot.id];
  const dirty = useMemo(() => JSON.stringify(inspectorValues) !== JSON.stringify(initialShotEdits[selectedShot.id]), [inspectorValues, selectedShot.id]);

  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => setState(current => {
      const nextTime = Math.min(timelineDuration, Number((current.time + .25).toFixed(2)));
      return { ...current, time: nextTime, playing: nextTime < timelineDuration, selectedClip: { track: 'Scenes', index: shotIndexAtTime(nextTime) } };
    }), 250);
    return () => window.clearInterval(timer);
  }, [state.playing]);

  const seek = (time: number) => setState(current => {
    const nextTime = Math.max(0, Math.min(timelineDuration, time));
    return { ...current, time: nextTime, selectedClip: { track: 'Scenes', index: shotIndexAtTime(nextTime) } };
  });
  const selectShot = (index: number) => {
    const nextIndex = Math.max(0, Math.min(state.shots.length - 1, index));
    setState(current => ({ ...current, time: shotStartTime(nextIndex), selectedClip: { track: 'Scenes', index: nextIndex } }));
  };
  const selectClip = (clip: SelectedClip) => clip.track === 'Scenes' ? selectShot(clip.index) : setState(current => ({ ...current, selectedClip: clip }));
  const updateInspector = (values: Partial<InspectorValues>) => setState(current => ({ ...current, shotEdits: { ...current.shotEdits, [selectedShot.id]: { ...current.shotEdits[selectedShot.id], ...values } } }));
  const resetInspector = () => setState(current => ({ ...current, shotEdits: { ...current.shotEdits, [selectedShot.id]: { ...initialShotEdits[selectedShot.id] } } }));
  const togglePlayback = () => setState(current => current.time >= timelineDuration ? { ...current, time: 0, playing: true, selectedClip: { track: 'Scenes', index: 0 } } : { ...current, playing: !current.playing });
  return {
    state, selectedShotIndex, selectedShot, inspectorValues, dirty,
    patch: (next: Partial<EditorState>) => setState(current => ({ ...current, ...next })),
    seek, selectShot, selectClip, updateInspector, resetInspector, togglePlayback,
    previousShot: () => selectShot(selectedShotIndex - 1), nextShot: () => selectShot(selectedShotIndex + 1),
    resetAll: () => setState(createInitialState())
  };
}
