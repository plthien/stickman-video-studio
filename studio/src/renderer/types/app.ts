export type StatusTone = 'mint' | 'blue' | 'amber' | 'neutral';
export interface Shot { id: string; title: string; duration: number; caption: string; status: string; color: string }
export interface ProjectState { title: string; topic: string; style: string; duration: number; language: string; ratio: string }
