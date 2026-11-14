import { PageHeader } from '../components/layout/PageHeader'; import { ProjectForm } from '../features/project/ProjectForm';
export function ProjectSetupPage() { return <div className="page"><PageHeader eyebrow="START HERE" title="Project Setup" description="Define the vertical story, style contract and delivery target before entering the pipeline." /><ProjectForm /></div>; }
