import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader } from '../../components/ui';
import { useAppState } from '../../app/AppState';
import { visualStyleLabel } from './styles';

export function OverviewDashboard() {
  const {native}=useAppState();
  const shots=native?.projection?.shots??[];
  const gates=[
    {title:'Script',ready:Boolean(native?.approvedScript),href:'/script',detail:native?.approvedScript?`${native.approvedScript.sections.length} approved sections`:'No approved script'},
    {title:'Voice & Captions',ready:Boolean(native?.voice&&!native.voice.stale&&native.projection?.captionReady),href:'/voice',detail:native?.voice&&!native.voice.stale?(native.projection?.captionReady?'Narration and approved captions verified':'Narration recorded; caption review required until approved'):'Narration and reviewed captions required'},
    {title:'Storyboard',ready:shots.length>0,href:'/storyboard',detail:shots.length?`${shots.length} native shots`:'No native storyboard shots'},
    {title:'Video Editor',ready:Boolean(native?.preview),href:'/editor',detail:native?.preview?'Native encoded sample exists':'Native preview NOT_RUN'}
  ];
  const completed=gates.filter(g=>g.ready).length;
  return <div className="grid wide-left">
    <Card><CardHeader title={native?.project.title??'No project open'} hint={native?.project.root??'Create or open a local native project to begin'}/>
      {native?<div className="kvs"><strong>{visualStyleLabel(native.project.style)}</strong><span>{native.brief.topic||'No topic specified'}</span><span>Approved narration: {native.voice&&!native.voice.stale?'PRESENT':'NOT_READY'}</span><span>Final video: {native.render?'RENDERED':'NOT_RUN'}</span></div>:
        <div className="info">EMPTY — No project, script, voice, scene, video or readiness data has been loaded. Nothing is substituted with a sample.</div>}
    </Card>
    <Card><CardHeader title="Actual project stages" hint={native?`${completed}/4 stages with evidence`:'All stages NOT_READY'}/>
      {gates.map((gate,index)=><Link className="stage-row" to={gate.href} key={gate.title}><span className="stage-number">0{index+1}</span><div><strong>{gate.title}</strong><small>{gate.detail}</small></div><Badge tone={gate.ready?'mint':'amber'}>{gate.ready?'EVIDENCE':'NOT_READY'}</Badge><b>›</b></Link>)}
    </Card>
  </div>;
}
