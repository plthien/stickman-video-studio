import type { Shot } from '../../types/app';
export type EditorMode = 'edit' | 'preview' | 'approval';
export interface EditorState { shots: Shot[]; selected: number; mode: EditorMode; time: number; playing: boolean; dirty: boolean; timelineHeight: number; qaOpen: boolean; inspectorTab: 'layer'|'motion'|'style' }
