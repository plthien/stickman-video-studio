import { visualStyleLabel } from '../../features/project/styles';
import { useLocation } from 'react-router-dom';
import { useAppState } from '../AppState';
const names: Record<string, string> = { '/': 'Thiết lập project', '/overview': 'Tổng quan', '/external': 'External ChatGPT', '/script': 'Kịch bản', '/voice': 'Voice & Captions', '/storyboard': 'Storyboard & Image', '/editor': 'Video Editor', '/render': 'Render & Export', '/settings': 'Cài đặt & chẩn đoán' };
export function Topbar() {
  const {pathname}=useLocation(),{native}=useAppState();
  return <header className="topbar"><div><small>MODE B / {names[pathname]?.toUpperCase()}</small><strong>{native?.project.title||'No project open'}</strong></div>
    <div className="top-actions">{native?<><span className="project-chip">{native.project.id.slice(0,8)} · {visualStyleLabel(native.project.style)}</span><span className="badge">PROJECT OPEN</span></>:<span className="badge amber">NO PROJECT</span>}</div>
  </header>;
}
