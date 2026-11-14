import { PageHeader } from '../components/layout/PageHeader'; import { OverviewDashboard } from '../features/project/OverviewDashboard';
export function OverviewPage() { return <div className="page"><PageHeader eyebrow="PROJECT CONTROL" title="Production overview" description="Track the demo pipeline without implying provider, validator, or render success." /><OverviewDashboard /></div>; }
