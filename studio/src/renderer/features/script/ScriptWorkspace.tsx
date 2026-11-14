import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Badge, Button, Card, CardHeader, Textarea } from '../../components/ui';

const sections = [
  { title: '01 · The invisible loop', text: 'You keep waiting for the moment when starting feels easy. But motivation is rarely the spark.' },
  { title: '02 · Motivation follows action', text: 'Motivation often appears after action gives your brain evidence that progress is possible.' },
  { title: '03 · Make the first move smaller', text: 'Make the first move so small that resistance has nothing useful to argue with.' },
  { title: '04 · Build the evidence', text: 'Each completed step becomes evidence. Evidence is more reliable than waiting for a feeling.' },
  { title: '05 · The 10-minute rule', text: 'Give the task ten focused minutes. You may stop after that, but you must begin.' },
  { title: '06 · Closing challenge', text: 'Choose one task, shrink the first step, and start before this video ends.' }
];
const originals = sections.map(section => section.text);
interface ScriptSession {
  selected: number;
  setSelected: Dispatch<SetStateAction<number>>;
  drafts: string[];
  setDrafts: Dispatch<SetStateAction<string[]>>;
  saved: string[];
  setSaved: Dispatch<SetStateAction<string[]>>;
}
const ScriptSessionContext = createContext<ScriptSession | null>(null);
export function ScriptSessionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const [drafts, setDrafts] = useState(() => [...originals]);
  const [saved, setSaved] = useState(() => [...originals]);
  return <ScriptSessionContext.Provider value={{ selected, setSelected, drafts, setDrafts, saved, setSaved }}>{children}</ScriptSessionContext.Provider>;
}
const useScriptSession = () => {
  const state = useContext(ScriptSessionContext);
  if (!state) throw new Error('ScriptSessionProvider missing');
  return state;
};
const words = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
export function ScriptWorkspace() {
  const { selected, setSelected, drafts, setDrafts, saved, setSaved } = useScriptSession();
  const draft = drafts[selected];
  const dirty = draft !== saved[selected];
  const update = (text: string) => setDrafts(current => current.map((value, index) => index === selected ? text : value));
  const reset = () => {
    setDrafts(current => current.map((value, index) => index === selected ? originals[index] : value));
    setSaved(current => current.map((value, index) => index === selected ? originals[index] : value));
  };
  const keep = () => setSaved(current => current.map((value, index) => index === selected ? draft : value));
  return <div className="grid script-grid">
    <Card className="section-list"><CardHeader title="Sections" hint="6 app-session demo sections" />
      {sections.map((section, index) => <button key={section.title} className={selected === index ? 'selected' : ''} onClick={() => setSelected(index)}>
        <span>{section.title}</span><small>{words(drafts[index])} words{drafts[index] !== saved[index] ? ' · edited' : ''}</small>
      </button>)}
    </Card>
    <Card>
      <CardHeader title={sections[selected].title} hint="App-session draft · narration source unchanged"
        action={<Badge tone={dirty ? 'amber' : 'blue'}>{dirty ? 'UNSAVED DEMO EDIT' : saved[selected] !== originals[selected] ? 'SAVED DEMO DRAFT' : 'REVIEW'}</Badge>} />
      <Textarea aria-label="Script draft" className="script-editor" value={draft} onChange={e => update(e.target.value)} />
      <div className="editor-meta"><span>{words(draft)} words</span><span>Section {selected + 1} of {sections.length}</span><span>App session only · no disk persistence</span></div>
      <div className="actions"><Button disabled={draft === originals[selected] && saved[selected] === originals[selected]} onClick={reset}>Reset selected section</Button>
        <Button disabled={!dirty} variant="primary" onClick={keep}>Keep demo draft</Button><Button disabled>Apply to narration · R3</Button></div>
    </Card>
    <Card><CardHeader title="Review checks" /><div className="check">✓ Section drafts remain isolated</div>
      <div className="check">✓ Demo drafts survive page navigation in this session</div>
      <div className="check warn">! Closing/restarting discards demo edits</div><div className="check warn">! Narration not generated</div></Card>
  </div>;
}
