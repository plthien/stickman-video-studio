import { PageHeader } from '../components/layout/PageHeader'; import { OverviewDashboard } from '../features/project/OverviewDashboard';
export function OverviewPage() { return <div className="page"><PageHeader eyebrow="PROJECT CONTROL" title="Production overview" description="Review real project stages and saved evidence only. Missing stages remain NOT_READY." /><OverviewDashboard /></div>; }
