import { PageHeader } from '../components/layout/PageHeader'; import { ScriptWorkspace } from '../features/script/ScriptWorkspace';
export function ScriptPage() { return <div className="page"><PageHeader eyebrow="STORY DEVELOPMENT" title="Script" description="Edit the controlled demo draft and review pacing before narration." /><ScriptWorkspace /></div>; }
