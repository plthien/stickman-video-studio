import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Textarea } from '../../components/ui';

const demo = [
  { id: 'The invisible loop', text: 'You keep waiting for the moment when starting feels easy. But motivation is rarely the spark.' },
  { id: 'Motivation follows action', text: 'Motivation often appears after action gives your brain evidence that progress is possible.' },
  { id: 'Make the first move smaller', text: 'Make the first move so small that resistance has nothing useful to argue with.' },
  { id: 'Build the evidence', text: 'Each completed step becomes evidence. Evidence is more reliable than waiting for a feeling.' },
  { id: 'The 10-minute rule', text: 'Give the task ten focused minutes. You may stop after that, but you must begin.' },
  { id: 'Closing challenge', text: 'Choose one task, shrink the first step, and start before this video ends.' }
];
const originals = demo.map(section => section.text);
interface ScriptSession { selected: number; setSelected: Dispatch<SetStateAction<number>>; drafts: string[]; setDrafts: Dispatch<SetStateAction<string[]>>; saved: string[]; setSaved: Dispatch<SetStateAction<string[]>> }
const Session = createContext<ScriptSession | null>(null);
export function ScriptSessionProvider({ children }: { children: ReactNode }) { const [selected,setSelected]=useState(0);const[drafts,setDrafts]=useState([...originals]);const[saved,setSaved]=useState([...originals]);return <Session.Provider value={{selected,setSelected,drafts,setDrafts,saved,setSaved}}>{children}</Session.Provider> }
const words=(text:string)=>text.trim()?(text.match(/\S+/g)??[]).length:0;

export function ScriptWorkspace(){
  const session=useContext(Session);if(!session)throw new Error('ScriptSessionProvider missing');
  const{native}=useAppState();const sections=native?.approvedScript?.sections?.length?native.approvedScript.sections:demo;const selected=Math.min(session.selected,sections.length-1),section=sections[selected];
  const draft=native?section.text:session.drafts[selected],dirty=!native&&draft!==session.saved[selected];
  const update=(text:string)=>session.setDrafts(current=>current.map((value,index)=>index===selected?text:value));
  const reset=()=>{session.setDrafts(current=>current.map((value,index)=>index===selected?originals[index]:value));session.setSaved(current=>current.map((value,index)=>index===selected?originals[index]:value))};
  const keep=()=>session.setSaved(current=>current.map((value,index)=>index===selected?draft:value));
  return <div className="grid script-grid">
    <Card className="section-list"><CardHeader title="Sections" hint={native?'Approved project revision':'6 app-session demo sections'}/>{sections.map((item,index)=><button key={item.id} className={selected===index?'selected':''} onClick={()=>session.setSelected(index)}><span>{String(index+1).padStart(2,'0')} · {item.id}</span><small>{words(native?item.text:session.drafts[index])} words</small></button>)}</Card>
    <Card><CardHeader title={section.id} hint={native?'Immutable approved narration source':'App-session demo draft · no disk persistence'} action={<Badge tone={native?'mint':dirty?'amber':'blue'}>{native?'PROJECT DATA':dirty?'UNSAVED DEMO EDIT':session.saved[selected]!==originals[selected]?'SAVED DEMO DRAFT':'DEMO'}</Badge>}/><Textarea aria-label="Script draft" className="script-editor" readOnly={Boolean(native)} value={draft} onChange={event=>update(event.target.value)}/><div className="editor-meta"><span>{words(draft)} words</span><span>Section {selected+1} of {sections.length}</span><span>{native?`Revision ${native.approvedScript?.revision}`:'No disk persistence'}</span></div>{native?<div className="info">Script changes require a frozen, project-bound manual task and explicit import review.</div>:<div className="actions"><Button disabled={draft===originals[selected]&&session.saved[selected]===originals[selected]} onClick={reset}>Reset selected section</Button><Button disabled={!dirty} variant="primary" onClick={keep}>Keep demo draft</Button></div>}</Card>
    <Card><CardHeader title="Source bindings"/><div className={native?'check':'check warn'}>{native?'✓ Approved script loaded from project state':'! Demo fixture visible because no native project is open'}</div><div className={native?.voice&&!native.voice.stale?'check':'check warn'}>{native?.voice&&!native.voice.stale?'✓ Narration matches current script revision':'! Current verified narration required'}</div><div className={native?.alignment?'check':'check warn'}>{native?.alignment?'✓ Real word alignment recorded':'! Forced alignment not recorded'}</div></Card>
  </div>;
}
