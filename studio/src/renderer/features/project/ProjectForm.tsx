import { useEffect, useRef, useState } from 'react';
import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';
import type { NativeStudioState } from '../../types/app';
import { visualStyleChoices, visualStyleLabel } from './styles';

export function ProjectForm() {
  const { project, setProject, native, openNativeSession, captureProjectSession, isCurrentProjectSession, setNativeIfSessionCurrent, showNotice } = useAppState();
  const [parent, setParent] = useState(''); const [folder, setFolder] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const requests=useRef({navigation:0,save:0,browse:0});
  const update = (key: keyof typeof project, value: string | number) => setProject({ ...project, [key]: value });
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const applyOpened=(state:NativeStudioState)=>{requests.current.browse+=1;openNativeSession(state);setProject({ title: state.project.title, topic: state.brief.topic, style: state.project.style, language: state.brief.language, duration: state.brief.targetDuration??0, ratio: state.brief.ratio, audience:state.brief.audience??'',purpose:state.brief.purpose??'' });};
  useEffect(()=>{setBusy(false);setError('');requests.current.save+=1;},[native?.project.id]);
  const createProject=async()=>{requests.current.browse+=1;const sequence=++requests.current.navigation;setBusy(true);setError('');try{if(!window.studio)throw new Error('Run Electron to create projects.');const state=await window.studio.createProject({ parent, folder, title: project.title, topic: project.topic, style: project.style, language: project.language, targetDuration: project.duration,audience:project.audience,purpose:project.purpose });if(sequence!==requests.current.navigation)return;applyOpened(state);showNotice(state.registrationWarning??'Native project created with the original Mode B CLI.');}catch(reason){if(sequence===requests.current.navigation)fail(reason);}finally{if(sequence===requests.current.navigation)setBusy(false);}};
  const openProject=async()=>{requests.current.browse+=1;const sequence=++requests.current.navigation;setError('');try{if(!window.studio)return;const selected=await window.studio.openProjectDialog();if(!selected||sequence!==requests.current.navigation)return;const state=await window.studio.openProject(selected);if(sequence!==requests.current.navigation)return;applyOpened(state);showNotice('Project opened.');}catch(reason){if(sequence===requests.current.navigation)fail(reason);}};
  const saveBrief=async()=>{if(!native||!window.studio)return;const scope=captureProjectSession(),sequence=++requests.current.save;if(!scope)return;setBusy(true);setError('');try{const state=await window.studio.saveBrief(scope.projectId,{title:project.title,topic:project.topic,language:project.language,ratio:'9:16',targetDuration:project.duration,audience:project.audience,purpose:project.purpose});if(sequence!==requests.current.save||!setNativeIfSessionCurrent(scope,state))return;showNotice('Project setup saved to .studio/state.json.');}catch(reason){if(sequence===requests.current.save&&isCurrentProjectSession(scope))fail(reason);}finally{if(sequence===requests.current.save&&isCurrentProjectSession(scope))setBusy(false);}};
  const browseParent=async()=>{if(!window.studio)return;const sequence=++requests.current.browse;setError('');try{const selected=await window.studio.browseProjectParent();if(sequence===requests.current.browse&&selected)setParent(selected);}catch(reason){if(sequence===requests.current.browse)fail(reason);}};
  return <div className="project-setup-layout">
    <Card className="project-brief-card">
      <CardHeader title="Project brief" hint="Story, language and target length" action={<Badge tone={native?'mint':'blue'}>{native?'OPEN':'DRAFT'}</Badge>}/>
      <Field label="Project title">
        <Input value={project.title} onChange={event=>update('title',event.target.value)}/>
      </Field>
      <Field label="Topic / core idea">
        <Textarea value={project.topic} onChange={event=>update('topic',event.target.value)}/>
      </Field>
      <Field label="Audience"><Input value={project.audience??''} onChange={event=>update('audience',event.target.value)} placeholder="Optional intended audience"/></Field>
      <Field label="Purpose"><Input value={project.purpose??''} onChange={event=>update('purpose',event.target.value)} placeholder="Optional intended outcome"/></Field>
      <div className="form-grid">
        <Field label="Language">
          <Select value={project.language} onChange={event=>update('language',event.target.value)}>
            <option>English</option><option>Vietnamese</option>
          </Select>
        </Field>
        <Field label="Duration (seconds)" hint="Narration controls final timing">
          <Input type="number" min="15" max="300" value={project.duration} onChange={event=>update('duration',Number(event.target.value))}/>
        </Field>
      </div>
    </Card>
    <Card className="project-location-card">
      <CardHeader title="Project location" hint="Create a new native folder or open an existing project"/>
      <div className="field project-parent-field">
        <label htmlFor="project-parent">Parent folder</label>
        <div className="project-path-row">
          <Input id="project-parent" value={parent} onChange={event=>setParent(event.target.value)} placeholder="D:\\ModeBProjects"/>
          <Button type="button" onClick={browseParent} disabled={busy||!window.studio}>Browse folder</Button>
        </div>
      </div>
      <Field label="Project folder">
        <Input value={folder} onChange={event=>setFolder(event.target.value)} placeholder="New project folder"/>
      </Field>
      <div className="actions">
        <Button type="button" variant="primary" disabled={busy||!window.studio||!parent||!folder.trim()||!project.title.trim()||!project.topic.trim()||project.duration<=0} onClick={createProject}>{busy?'Creating…':'Create native project'}</Button>
        <Button type="button" disabled={busy||!window.studio} onClick={openProject}>Open project…</Button>
      </div>
      {error&&<div className="info error" role="alert">{error}</div>}
      {native&&<div className="info success" title={native.project.root}><strong>{native.project.title}</strong> · <span>{native.project.root}</span></div>}
    </Card>
    <Card className="project-style-card">
      <CardHeader title="Visual style" hint="Original B-style contracts"/>
      <div className="project-style-grid">
        {visualStyleChoices.map(style=><button type="button" className={`choice ${project.style===style?'selected':''}`} key={style} onClick={()=>update('style',style)}>
          <span className={`swatch ${style.toLowerCase()}`}/><div><strong>{visualStyleLabel(style)}</strong></div>
        </button>)}
        <div className="choice disabled"><span className="swatch b5"/><div><strong>B5 · Character Explainer</strong><small>Separate workflow</small></div></div>
      </div>
    </Card>
    <Card className="project-output-card">
      <div className="project-output-info">
        <h2>Output</h2>
        <span className="badge mint">9:16 Portrait</span>
        <p>Native 1080 × 1920 · target duration is planning only</p>
      </div>
      <Button type="button" variant="primary" disabled={!native||busy} onClick={saveBrief}>Save project setup</Button>
    </Card>
  </div>;
}
