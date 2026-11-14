/// <reference types="vite/client" />
interface Window { studio?: Readonly<{
  platform: string; version: string;
  listRecent: () => Promise<import('./types/app').NativeProjectSummary[]>;
  createProject: (input: unknown) => Promise<import('./types/app').NativeStudioState>;
  openProjectDialog: () => Promise<string | null>; openProject: (root: string) => Promise<import('./types/app').NativeStudioState>; projectState: (root: string) => Promise<import('./types/app').NativeStudioState>; saveBrief: (root: string, brief: unknown) => Promise<import('./types/app').NativeStudioState>;
  externalPrompt: (root: string, stage: string) => Promise<string>; exportPrompt: (root: string, stage: string) => Promise<string | null>; stageImport: (root: string, stage: string, text: string) => Promise<{ token: string; before: unknown; after: unknown; changes: number }>; confirmImport: (token: string) => Promise<import('./types/app').NativeStudioState>;
  nanoHealth: (endpoint: string) => Promise<{ ready: boolean; health: number; readiness: number; detail: string }>; nanoGenerate: (root: string, input: unknown) => Promise<{ path: string; sha256: string; sampleRate: number; receipt?: unknown }>; align: (root: string, input: unknown) => Promise<{ path: string; captionsPath: string; audioSha256: string }>;
  importMedia: (root: string, kind: 'image' | 'sfx') => Promise<string | null>; nativeRun: (root: string, command: string, input?: unknown) => Promise<{ code: number; stdout: string; stderr: string }>; mediaUrl: (root: string, relative: string) => Promise<string>; openOutput: (root: string) => Promise<string>;
}> }
