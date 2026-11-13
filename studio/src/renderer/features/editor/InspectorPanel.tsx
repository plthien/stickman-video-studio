import { useAppState } from '../../app/AppState';
import { Badge, Button, Field, Input } from '../../components/ui';
import { visualStyleLabel } from '../project/styles';
import type { InspectorTab, InspectorValues } from './types';

interface InspectorPanelProps {
  tab: InspectorTab;
  values: InspectorValues;
  dirty: boolean;
  shotId: string;
  onTabChange: (tab: InspectorTab) => void;
  onChange: (values: Partial<InspectorValues>) => void;
  onReset: () => void;
}

const number = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function InspectorPanel({ tab, values, dirty, shotId, onTabChange, onChange, onReset }: InspectorPanelProps) {
  const { project } = useAppState();

  return <aside className="editor-panel inspector">
    <header>
      <div><strong>Inspector</strong><small>{shotId} · local demo fields</small></div>
      {dirty && <Badge tone="amber">EDITED</Badge>}
    </header>
    <div className="inspector-v3-tabs" aria-label="V3 inspector groups">
      <button className="active" type="button">Layer</button>
      <button type="button" disabled title="Caption inspector is unavailable in R1">Caption</button>
      <button type="button" disabled title="Audio inspector is unavailable in R1">Audio</button>
    </div>
    <div className="inspector-tabs" role="tablist" aria-label="Local demo controls">
      {(['layer', 'motion', 'style'] as const).map((item) => <button
        role="tab"
        aria-selected={tab === item}
        key={item}
        className={tab === item ? 'active' : ''}
        onClick={() => onTabChange(item)}
      >{item}</button>)}
    </div>
    <div className="inspector-body">
      <section className="inspector-selection">
        <strong>Selected image layer</strong>
        <code>▧ demo/{shotId.toLowerCase()}.svg</code>
      </section>
      {tab === 'layer' && <div data-inspector-content="layer">
        <Field label="Layer name"><Input value={values.layerName} onChange={(event) => onChange({ layerName: event.target.value })} /></Field>
        <div className="form-grid">
          <Field label="X · design units"><Input type="number" value={values.x} onChange={(event) => onChange({ x: number(event.target.value) })} /></Field>
          <Field label="Y · design units"><Input type="number" value={values.y} onChange={(event) => onChange({ y: number(event.target.value) })} /></Field>
          <Field label="Width"><Input type="number" value={values.w} onChange={(event) => onChange({ w: number(event.target.value) })} /></Field>
        </div>
      </div>}
      {tab === 'motion' && <div data-inspector-content="motion">
        <Field label="Rotation · rad"><Input type="number" value={values.angle} onChange={(event) => onChange({ angle: number(event.target.value) })} /></Field>
        <Field label={`Progress · ${Math.round(values.progress * 100)}%`}><input aria-label="Progress" type="range" min="0" max="1" step=".05" value={values.progress} onChange={(event) => onChange({ progress: number(event.target.value) })} /></Field>
        <div className="info">Motion values map only to existing Mode B angle/progress fields.</div>
      </div>}
      {tab === 'style' && <div data-inspector-content="style">
        <Field label={`Alpha · ${Math.round(values.alpha * 100)}%`}><input aria-label="Alpha" type="range" min="0" max="1" step=".05" value={values.alpha} onChange={(event) => onChange({ alpha: number(event.target.value) })} /></Field>
        <div className="style-swatch"><span />{visualStyleLabel(project.style)} · demo accent</div>
        <div className="info">Style preview is illustrative; no asset or native manifest is written.</div>
      </div>}
      <div className="info">Local demo state only. Native project.json remains untouched.</div>
      <Button disabled={!dirty} onClick={onReset}>Reset {shotId} edits</Button>
    </div>
  </aside>;
}
