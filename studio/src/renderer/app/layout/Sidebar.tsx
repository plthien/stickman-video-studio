import { NavLink } from 'react-router-dom';
const navigation = [
  ['01', 'Project Setup', '/'], ['02', 'Overview', '/overview'], ['03', 'External ChatGPT', '/external'], ['04', 'Script', '/script'],
  ['05', 'Voice & Captions', '/voice'], ['06', 'Storyboard & Images', '/storyboard'], ['07', 'Video Editor', '/editor'], ['08', 'Render & Export', '/render'], ['09', 'System Settings', '/settings']
];
export function Sidebar() { return <aside className="sidebar"><div className="brand"><span className="brand-mark">MB</span><div><strong>Mode B Studio</strong><small>Vertical video pipeline</small></div></div><nav aria-label="Main navigation">{navigation.map(([number, label, path]) => <NavLink key={path} end={path === '/'} to={path} className={({ isActive }) => isActive ? 'active' : ''}><span>{number}</span>{label}</NavLink>)}</nav><div className="sidebar-foot"><span className="signal" /> UI DEMO · NOT CONNECTED</div></aside>; }
