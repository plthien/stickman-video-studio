import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Card, CardHeader, Textarea } from '../../components/ui';

interface ScriptSession { selected: number; setSelected: Dispatch<SetStateAction<number>> }
const Session = createContext<ScriptSession | null>(null);
export function ScriptSessionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  return <Session.Provider value={{ selected, setSelected }}>{children}</Session.Provider>;
}
const words=(text:string)=>text.trim()?(text.match(/\S+/g)??[]).length:0;

export function ScriptWorkspace(){
  const session=useContext(Session);if(!session)throw new Error('ScriptSessionProvider missing');
  const {native}=useAppState();
  const sections=native?.approvedScript?.sections??[];
  const selected=Math.min(session.selected,Math.max(0,sections.length-1));
  const section=sections[selected];
  return <div className="grid script-grid">
    <Card className="section-list"><CardHeader title="Sections" hint={native?'Approved project revision':'No native project open'}/>
      {sections.length===0?<div className="info">EMPTY — No approved script sections. Create/open a project, then import and approve a real Script task in External ChatGPT.</div>:
        sections.map((item,index)=><button key={item.id} className={selected===index?'selected':''} onClick={()=>session.setSelected(index)}><span>{String(index+1).padStart(2,'0')} · {item.id}</span><small>{words(item.text)} words</small></button>)}
    </Card>
    <Card><CardHeader title={section?.id??'No approved narration'} hint={section?'Immutable approved project script':'NOT_READY'} action={<Badge tone={section?'mint':'amber'}>{section?'PROJECT DATA':'EMPTY'}</Badge>}/>
      {section?<><Textarea aria-label="Script draft" className="script-editor" readOnly value={section.text}/><div className="editor-meta"><span>{words(section.text)} words</span><span>Section {selected+1} of {sections.length}</span><span>Revision {native?.approvedScript?.revision}</span></div><div className="info">Script changes require a new project-bound External task and explicit reviewed import.</div></>:
        <div className="info">No script is available. Nothing has been generated or approved.</div>}
    </Card>
    <Card><CardHeader title="Source bindings"/>
      <div className={native?.approvedScript?'check':'check warn'}>{native?.approvedScript?'✓ Approved script from project state':'! Approved script required'}</div>
      <div className={native?.voice&&!native.voice.stale?'check':'check warn'}>{native?.voice&&!native.voice.stale?'✓ Accepted narration present':'! Verified narration required'}</div>
      <div className={native?.alignment?.captionReview?'check':'check warn'}>{native?.alignment?.captionReview?'✓ Caption revision recorded':'! Reviewed captions required'}</div>
    </Card>
  </div>;
}
