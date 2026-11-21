import { PageHeader } from '../components/layout/PageHeader'; import { ScriptWorkspace } from '../features/script/ScriptWorkspace';
export function ScriptPage() { return <div className="page"><PageHeader eyebrow="STORY DEVELOPMENT" title="Script" description="Review exact approved project narration. No sample script or local draft is substituted." /><ScriptWorkspace /></div>; }
