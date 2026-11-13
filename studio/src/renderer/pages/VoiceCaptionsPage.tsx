import { PageHeader } from '../components/layout/PageHeader'; import { VoiceWorkspace } from '../features/voice/VoiceWorkspace';
export function VoiceCaptionsPage() { return <div className="page"><PageHeader eyebrow="AUDIO SYSTEM" title="Voice & Captions" description="Choose voice direction and inspect illustrative cues without claiming synthesis or alignment." /><VoiceWorkspace /></div>; }
