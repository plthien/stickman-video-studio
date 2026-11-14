import type { VisualStyleId } from '../features/project/styles';
export type StatusTone = 'mint' | 'blue' | 'amber' | 'neutral';
export interface Shot { id: string; title: string; duration: number; caption: string; status: string; color: string }
export interface ProjectState { title: string; topic: string; style: VisualStyleId; duration: number; language: string; ratio: string }
