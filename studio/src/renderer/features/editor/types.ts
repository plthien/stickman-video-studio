import type { Shot } from '../../types/app';
export type EditorMode = 'edit' | 'preview' | 'approval';
export type InspectorTab = 'layer' | 'motion' | 'style';
export type TimelineTrackName = 'Scenes' | 'Layers' | 'Captions' | 'Narration' | 'SFX' | 'Ambience';
export interface InspectorValues { layerName: string; x: number; y: number; w: number; angle: number; alpha: number; progress: number }
export interface SelectedClip { track: TimelineTrackName; index: number }
export interface EditorState {
  shots: Shot[];
  mode: EditorMode;
  time: number;
  playing: boolean;
  timelineHeight: number;
  qaOpen: boolean;
  inspectorTab: InspectorTab;
  shotEdits: Record<string, InspectorValues>;
  selectedClip: SelectedClip;
}
