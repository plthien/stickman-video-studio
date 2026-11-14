import { NavLink } from 'react-router-dom';
import { visualStyleLabel } from '../../features/project/styles';
import { useAppState } from '../AppState';

const workspaceNavigation = [
  ['01', 'Thiết lập project', '/'],
  ['02', 'Tổng quan', '/overview'],
  ['03', 'External ChatGPT', '/external'],
  ['04', 'Kịch bản', '/script'],
  ['05', 'Voice & Captions', '/voice'],
  ['06', 'Storyboard & Image', '/storyboard'],
  ['07', 'Video Editor', '/editor'],
  ['08', 'Render & Export', '/render'],
];
const systemNavigation = [['09', 'Cài đặt & chẩn đoán', '/settings']];

function Navigation({ items }: { items: string[][] }) {
  return <nav aria-label="Main navigation">{items.map(([number, label, path]) => (
    <NavLink key={path} end={path === '/'} to={path} className={({ isActive }) => isActive ? 'active' : ''}>
      <span>{number}</span>{label}
    </NavLink>
  ))}</nav>;
}

export function Sidebar() {
  const { project } = useAppState();
  return <aside className="sidebar">
    <div className="brand">
      <span className="brand-mark">MB</span>
      <div><strong>Mode B Studio</strong><small>External Creative · Native Render</small></div>
    </div>
    <section className="project-context" aria-label="Current project">
      <strong>{project.title}</strong>
      <small>VB-0024 · {visualStyleLabel(project.style)} · 03:42</small>
    </section>
    <div className="sidebar-section-label">Workspace</div>
    <Navigation items={workspaceNavigation} />
    <div className="sidebar-section-label system">Hệ thống</div>
    <Navigation items={systemNavigation} />
    <div className="sidebar-foot"><span className="signal" /> UI DEMO · NOT CONNECTED</div>
  </aside>;
}
