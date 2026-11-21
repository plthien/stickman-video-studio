import { useLocation } from 'react-router-dom';
export function PipelineStrip() {
  const {pathname}=useLocation();
  if(pathname==='/editor')return null;
  const stages=[['Setup','/'],['Script','/script'],['Voice','/voice'],['Images','/storyboard'],['Edit','/editor'],['Render','/render']];
  return <div className="pipeline" aria-label="Production navigation">{stages.map(([label,route],index)=><div key={route} className={pathname===route?'current':''}><span>{index+1}</span>{label}</div>)}</div>;
}
