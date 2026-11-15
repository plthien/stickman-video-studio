import { createContext, createElement, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Shot } from '../../types/app';
import type { EditorState, InspectorValues, SelectedClip } from './types';
import { useAppState } from '../../app/AppState';

// Only actual opened native project shots are valid inputs. No fixture shots.
export const timelineDuration = 0;
export const shotStartTime = (index: number, source: Shot[] = []) => source.slice(0, index).reduce((total, shot) => total + shot.duration, 0);
export function shotIndexAtTime(time: number, source: Shot[] = []) {
  if (!source.length) return -1;
  const duration=source.reduce((total,shot)=>total+shot.duration,0);
  const clamped=Math.max(0,Math.min(duration,time));
  if(clamped===duration)return source.length-1;
  let boundary=0;
  for(let index=0;index<source.length;index++){boundary+=source[index].duration;if(clamped<boundary)return index;}
  return source.length-1;
}
export const initialShotEdits: Record<string, InspectorValues> = {};
const createInitialState = (): EditorState => ({
  shots:[], mode:'edit', time:0, playing:false, timelineHeight:244, qaOpen:false,
  inspectorTab:'layer', shotEdits:{}, selectedClip:{track:'Scenes',index:0}
});
interface EditorSession { state:EditorState;setState:Dispatch<SetStateAction<EditorState>> }
const EditorSessionContext=createContext<EditorSession|null>(null);
export function EditorSessionProvider({children}:{children:ReactNode}){
  const {native}=useAppState(),[state,setState]=useState(createInitialState);
  useEffect(()=>{const source=native?.projection?.shots??[];setState(current=>({...current,shots:source,time:0,playing:false,selectedClip:{track:'Scenes',index:0},shotEdits:{}}));},[native?.project.id,native?.projection]);
  return createElement(EditorSessionContext.Provider,{value:{state,setState}},children);
}
export function useEditorState(){
  const session=useContext(EditorSessionContext);if(!session)throw new Error('EditorSessionProvider missing');
  const {state,setState}=session;
  useEffect(()=>()=>setState(current=>({...current,playing:false,qaOpen:false})),[setState]);
  const duration=state.shots.reduce((sum,shot)=>sum+shot.duration,0);
  const selectedShotIndex=shotIndexAtTime(state.time,state.shots);
  const selectedShot=selectedShotIndex<0?null:state.shots[selectedShotIndex];
  const inspectorValues=selectedShot?state.shotEdits[selectedShot.id]??null:null;
  const dirty=useMemo(()=>Boolean(selectedShot&&inspectorValues),[selectedShot,inspectorValues]);
  useEffect(()=>{
    if(!state.playing||!duration)return;
    const timer=window.setInterval(()=>setState(current=>{
      const total=current.shots.reduce((sum,shot)=>sum+shot.duration,0),nextTime=Math.min(total,Number((current.time+.25).toFixed(2)));
      return {...current,time:nextTime,playing:nextTime<total,selectedClip:{track:'Scenes',index:Math.max(0,shotIndexAtTime(nextTime,current.shots))}};
    }),250);
    return()=>window.clearInterval(timer);
  },[state.playing,duration,setState]);
  const seek=(time:number)=>setState(current=>{const total=current.shots.reduce((sum,shot)=>sum+shot.duration,0),nextTime=Math.max(0,Math.min(total,time));return {...current,time:nextTime,selectedClip:{track:'Scenes',index:Math.max(0,shotIndexAtTime(nextTime,current.shots))}}});
  const selectShot=(index:number)=>setState(current=>{if(!current.shots.length)return current;const nextIndex=Math.max(0,Math.min(current.shots.length-1,index));return {...current,time:shotStartTime(nextIndex,current.shots),selectedClip:{track:'Scenes',index:nextIndex}}});
  const selectClip=(clip:SelectedClip)=>clip.track==='Scenes'?selectShot(clip.index):setState(current=>({...current,selectedClip:clip}));
  const updateInspector=(_values:Partial<InspectorValues>)=>{throw new Error('Inspector edits are not supported by the original native project editor.');};
  const resetInspector=()=>{};
  const togglePlayback=()=>setState(current=>{const total=current.shots.reduce((sum,shot)=>sum+shot.duration,0);if(!total)return current;return current.time>=total?{...current,time:0,playing:true,selectedClip:{track:'Scenes',index:0}}:{...current,playing:!current.playing}});
  return {state,selectedShotIndex,selectedShot,inspectorValues,dirty,patch:(next:Partial<EditorState>)=>setState(current=>({...current,...next})),seek,selectShot,selectClip,updateInspector,resetInspector,togglePlayback,previousShot:()=>selectShot(selectedShotIndex-1),nextShot:()=>selectShot(selectedShotIndex+1),resetAll:()=>setState(createInitialState())};
}
