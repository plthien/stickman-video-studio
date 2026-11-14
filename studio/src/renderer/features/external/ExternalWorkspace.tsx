import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAppState } from '../../app/AppState';
import { visualStyleLabel } from '../project/styles';
import { Badge, Button, Card, CardHeader, Textarea } from '../../components/ui';

const tabs = ['Script', 'Storyboard', 'Captions'] as const;
type PromptTab = (typeof tabs)[number];
type SyntaxResult = 'idle' | 'valid' | 'invalid';
interface ExternalSession {
  tab: PromptTab; setTab: Dispatch<SetStateAction<PromptTab>>;
  json: string; setJson: Dispatch<SetStateAction<string>>;
  result: SyntaxResult; setResult: Dispatch<SetStateAction<SyntaxResult>>;
}
const ExternalSessionContext = createContext<ExternalSession | null>(null);
export function ExternalSessionProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<PromptTab>('Script');
  const [json, setJson] = useState('');
  const [result, setResult] = useState<SyntaxResult>('idle');
  return <ExternalSessionContext.Provider value={{ tab, setTab, json, setJson, result, setResult }}>{children}</ExternalSessionContext.Provider>;
}
const useExternalSession = () => {
  const state = useContext(ExternalSessionContext);
  if (!state) throw new Error('ExternalSessionProvider missing');
  return state;
};
const promptFor = (tab: PromptTab, styleLabel: string): string => {
  const instruction: Record<PromptTab, string> = {
    Script: 'Create a structured demo script for project VB-0024.\nPreserve section IDs and return one UTF-8 JSON object only.\nDEMO: no reservation, schema acceptance or backend task exists.',
    Storyboard: `Create shot briefs for project VB-0024 using the selected ${styleLabel} contract.\nPreserve scene and shot IDs and return one UTF-8 JSON object only.\nDEMO: no image provider or production import is connected.`,
    Captions: 'Create concise portrait-safe caption cues for project VB-0024.\nPreserve cue ordering and return one UTF-8 JSON object only.\nDEMO: no audio alignment or production import is connected.'
  };
  return `# MODE B EXTERNAL AUTHORING — ${tab.toUpperCase()}\n\nProject demo visual style: ${styleLabel}\n\n${instruction[tab]}`;
};
export function ExternalWorkspace() {
  const { tab, setTab, json, setJson, result, setResult } = useExternalSession();
  const { project, showNotice } = useAppState();
  const activePrompt = useMemo(() => promptFor(tab, visualStyleLabel(project.style)), [tab, project.style]);
  const changeText = (text: string) => { setJson(text); setResult('idle'); };
  const validate = () => {
    try {
      const parsed: unknown = JSON.parse(json);
      setResult(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? 'valid' : 'invalid');
    } catch { setResult('invalid'); }
  };
  const copyPrompt = () => navigator.clipboard.writeText(activePrompt)
    .then(() => showNotice(`${tab} demo prompt copied.`)).catch(() => showNotice('Clipboard unavailable.'));
  const exportPrompt = () => {
    const blob = new Blob([activePrompt], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `mode-b-${tab.toLowerCase()}-demo.md`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showNotice(`${tab} demo prompt exported.`);
  };
  return <div className="grid wide-left">
    <Card><CardHeader title="External task prompt" hint="Copy to ChatGPT manually · no embedded API" action={<Badge tone="amber">DEMO</Badge>} />
      <div className="tabs">{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
      <pre className="prompt" data-active-prompt={tab}>{activePrompt}</pre>
      <div className="actions"><Button variant="primary" onClick={copyPrompt}>Copy prompt</Button><Button onClick={exportPrompt}>Export .md</Button>
        <Button onClick={() => window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer')}>Open ChatGPT</Button></div>
    </Card>
    <Card><CardHeader title="Import JSON workspace" hint="Syntax check only · no production import" />
      <Textarea aria-label="Import JSON" value={json} onChange={e => changeText(e.target.value)} placeholder="Paste the returned JSON here…" />
      <div className="actions"><Button onClick={() => changeText('{\n  "artifact_id": "demo_script_01",\n  "stage": "script"\n}')}>Use sample</Button>
        <Button disabled={!json} onClick={() => changeText('')}>Clear</Button><Button variant="primary" onClick={validate}>Validate syntax demo</Button></div>
      {result === 'valid' && <div className="info success">Valid JSON syntax · DEMO ONLY. No artifact was imported or accepted.</div>}
      {result === 'invalid' && <div className="info error" role="alert">Invalid JSON. Fix syntax before continuing.</div>}
      <div className="info">App-session workspace only · closing this app discards imported text.</div>
      <Button disabled>Production import · Not connected</Button>
    </Card>
  </div>;
}
