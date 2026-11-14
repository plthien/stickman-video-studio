import { createContext, createElement, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { shots } from '../storyboard/StoryboardWorkspace';
import type { EditorState, InspectorValues, SelectedClip } from './types';
import { useAppState } from '../../app/AppState';

export const timelineDuration = shots.reduce((total, shot) => total + shot.duration, 0);
export const shotStartTime = (index: number, source=shots) => source.slice(0, index).reduce((total, shot) => total + shot.duration, 0);
export function shotIndexAtTime(time: number, source=shots) {
  const duration=source.reduce((total,shot)=>total+shot.duration,0);const clamped = Math.max(0, Math.min(duration, time));
  if (clamped === duration) return source.length - 1;
  let boundary = 0;
  for (let index = 0; index < source.length; index += 1) {
    boundary += source[index].duration;
    if (clamped < boundary) return index;
  }
  return source.length - 1;
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
  const {native}=useAppState();const [state, setState] = useState(createInitialState);
  useEffect(()=>{const source=native?.projection?.shots;if(!source?.length)return;setState(current=>({...current,shots:source,time:0,playing:false,selectedClip:{track:'Scenes',index:0},shotEdits:Object.fromEntries(source.map((shot,index)=>[shot.id,initialShotEdits[shot.id]??{layerName:`native_${index+1}`,x:540,y:960,w:620,angle:0,alpha:1,progress:.5}]))}))},[native?.projection]);
  return createElement(EditorSessionContext.Provider, { value: { state, setState } }, children);
}

export function useEditorState() {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error('EditorSessionProvider missing');
  const { state, setState } = session;
  // The timer is route-scoped and cleaned up as soon as the editor unmounts.
  useEffect(() => () => setState(current => ({ ...current, playing: false, qaOpen: false })), [setState]);
  const duration=state.shots.reduce((sum,shot)=>sum+shot.duration,0);const selectedShotIndex = shotIndexAtTime(state.time,state.shots);
  const selectedShot = state.shots[selectedShotIndex];
  const inspectorValues = state.shotEdits[selectedShot.id];
  const dirty = useMemo(() => JSON.stringify(inspectorValues) !== JSON.stringify(initialShotEdits[selectedShot.id]), [inspectorValues, selectedShot.id]);

  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => setState(current => {
      const currentDuration=current.shots.reduce((sum,shot)=>sum+shot.duration,0);const nextTime = Math.min(currentDuration, Number((current.time + .25).toFixed(2)));
      return { ...current, time: nextTime, playing: nextTime < currentDuration, selectedClip: { track: 'Scenes', index: shotIndexAtTime(nextTime,current.shots) } };
    }), 250);
    return () => window.clearInterval(timer);
  }, [state.playing, setState]);

  const seek = (time: number) => setState(current => {
    const nextTime = Math.max(0, Math.min(duration, time));
    return { ...current, time: nextTime, selectedClip: { track: 'Scenes', index: shotIndexAtTime(nextTime,current.shots) } };
  });
  const selectShot = (index: number) => {
    const nextIndex = Math.max(0, Math.min(state.shots.length - 1, index));
    setState(current => ({ ...current, time: shotStartTime(nextIndex,current.shots), selectedClip: { track: 'Scenes', index: nextIndex } }));
  };
  const selectClip = (clip: SelectedClip) => clip.track === 'Scenes' ? selectShot(clip.index) : setState(current => ({ ...current, selectedClip: clip }));
  const updateInspector = (values: Partial<InspectorValues>) => setState(current => ({ ...current, shotEdits: { ...current.shotEdits, [selectedShot.id]: { ...current.shotEdits[selectedShot.id], ...values } } }));
  const resetInspector = () => setState(current => ({ ...current, shotEdits: { ...current.shotEdits, [selectedShot.id]: { ...initialShotEdits[selectedShot.id] } } }));
  const togglePlayback = () => setState(current => current.time >= duration ? { ...current, time: 0, playing: true, selectedClip: { track: 'Scenes', index: 0 } } : { ...current, playing: !current.playing });
  return {
    state, selectedShotIndex, selectedShot, inspectorValues, dirty,
    patch: (next: Partial<EditorState>) => setState(current => ({ ...current, ...next })),
    seek, selectShot, selectClip, updateInspector, resetInspector, togglePlayback,
    previousShot: () => selectShot(selectedShotIndex - 1), nextShot: () => selectShot(selectedShotIndex + 1),
    resetAll: () => setState(createInitialState())
  };
}
