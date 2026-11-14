import { useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';
import { visualStyleChoices, visualStyleLabel } from './styles';

export function ProjectForm() {
  const { project, setProject, native, setNative, showNotice } = useAppState();
  const [parent, setParent] = useState(''); const [folder, setFolder] = useState('mode-b-project'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const update = (key: keyof typeof project, value: string | number) => setProject({ ...project, [key]: value });
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  return <div className="grid two">
    <Card><CardHeader title="Project brief" hint={native ? native.project.root : 'Create or open a local native project'} action={<Badge tone={native ? 'mint' : 'blue'}>{native ? 'OPEN' : 'DRAFT'}</Badge>} />
      <Field label="Project title"><Input value={project.title} onChange={event => update('title', event.target.value)} /></Field>
      <Field label="Topic / core idea"><Textarea value={project.topic} onChange={event => update('topic', event.target.value)} /></Field>
      <div className="form-grid"><Field label="Language"><Select value={project.language} onChange={event => update('language', event.target.value)}><option>English</option><option>Vietnamese</option></Select></Field><Field label="Duration (seconds)" hint="Planning target; native audio controls final duration"><Input type="number" min="15" max="300" value={project.duration} onChange={event => update('duration', Number(event.target.value))} /></Field></div>
    </Card>
    <div className="stack">
      <Card><CardHeader title="Native project" hint="Original Mode B init · local files only" />
        <Field label="Parent folder"><Input value={parent} onChange={event => setParent(event.target.value)} placeholder="D:\\ModeBProjects" /></Field><Field label="Project folder"><Input value={folder} onChange={event => setFolder(event.target.value)} /></Field>
        <div className="actions"><Button disabled={busy || !window.studio || !parent} variant="primary" onClick={async () => { setBusy(true); setError(''); try { if (!window.studio) throw new Error('Run Electron to create projects.'); const state = await window.studio.createProject({ parent, folder, title: project.title, topic: project.topic, style: project.style, language: project.language }); setNative(state); showNotice('Native project created with the original Mode B CLI.'); } catch (reason) { fail(reason); } finally { setBusy(false); } }}>{busy ? 'Creating…' : 'Create native project'}</Button><Button disabled={busy || !window.studio} onClick={async () => { try { const selected = await window.studio?.openProjectDialog(); if (!selected) return; const state = await window.studio!.openProject(selected); setNative(state); setProject({ ...project, title: state.project.title, topic: state.brief.topic, style: state.project.style, language: state.brief.language }); showNotice('Project opened.'); } catch (reason) { fail(reason); } }}>Open project…</Button></div>
        {error && <div className="info error" role="alert">{error}</div>}{native && <div className="info success"><strong>{native.project.title}</strong><br />{native.project.root}</div>}
      </Card>
      <Card><CardHeader title="Visual style" hint="Locked native Mode B contracts" />{visualStyleChoices.map(style => <button className={`choice ${project.style === style ? 'selected' : ''}`} key={style} onClick={() => update('style', style)}><span className={`swatch ${style.toLowerCase()}`} /><div><strong>{visualStyleLabel(style)}</strong><small>Original Mode B style contract</small></div><span>›</span></button>)}<div className="choice disabled"><span className="swatch b5" /><div><strong>B5 · Character Explainer</strong><small>Separate workflow · External JSON unsupported</small></div></div></Card>
      <Card><CardHeader title="Output" /><div className="segmented"><button className="active" aria-pressed="true" disabled>9:16 Portrait</button><button disabled>16:9</button><button disabled>1:1</button></div><div className="info">Portrait is written as 1080 × 1920 after native init.</div><Button variant="primary" disabled={!native || busy} onClick={async () => { if (!native || !window.studio) return; setBusy(true); try { const state = await window.studio.saveBrief(native.project.root, { title: project.title, topic: project.topic, language: project.language, ratio: '9:16' }); setNative(state); showNotice('Project setup saved to .studio/state.json.'); } catch (reason) { fail(reason); } finally { setBusy(false); } }}>Save project setup</Button></Card>
    </div>
  </div>;
}
