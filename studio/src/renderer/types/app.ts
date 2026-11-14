import type { VisualStyleId } from '../features/project/styles';
export type StatusTone = 'mint' | 'blue' | 'amber' | 'neutral';
export interface Shot { id: string; title: string; duration: number; caption: string; status: string; color: string }
export interface ProjectState { title: string; topic: string; style: VisualStyleId; duration: number; language: string; ratio: string }
export interface NativeProjectSummary { id: string; root: string; title: string; style: VisualStyleId; updatedAt: string; projectFile: string }
export interface NativeStudioState { schema: string; project: NativeProjectSummary; brief: { topic: string; language: string; ratio: '9:16' }; external: Record<string, { revision: number; artifact: unknown; importedAt: string } | undefined>; voice?: { path: string; sha256: string; receipt?: unknown }; alignment?: { path: string; captionsPath: string; audioSha256: string }; approval?: { note: string; previewSha256: string } }
