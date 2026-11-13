import { useAppState } from '../../app/AppState';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';

const visualStyles = [
  'B1 · Minimal Line Art',
  'B2 · Colorful Hand-Drawn',
  'B3 · Retro TV',
  'B4 · Survival Thriller',
];

export function ProjectForm() {
  const { project, setProject, showNotice } = useAppState();
  const update = (key: keyof typeof project, value: string | number) =>
    setProject({ ...project, [key]: value });

  return (
    <div className="grid two">
      <Card>
        <CardHeader
          title="Project brief"
          hint="Local UI state · no files are written"
          action={<Badge tone="blue">DRAFT</Badge>}
        />
        <Field label="Project title">
          <Input value={project.title} onChange={(event) => update('title', event.target.value)} />
        </Field>
        <Field label="Topic / core idea">
          <Textarea value={project.topic} onChange={(event) => update('topic', event.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Language">
            <Select value={project.language} onChange={(event) => update('language', event.target.value)}>
              <option>English</option>
              <option>Vietnamese</option>
            </Select>
          </Field>
          <Field label="Duration (seconds)" hint="Maximum 300 seconds">
            <Input
              type="number"
              min="15"
              max="300"
              value={project.duration}
              onChange={(event) => update('duration', Number(event.target.value))}
            />
          </Field>
        </div>
      </Card>

      <div className="stack">
        <Card>
          <CardHeader title="Visual style" hint="Locked native Mode B contracts" />
          {visualStyles.map((style) => (
            <button
              className={`choice ${project.style === style ? 'selected' : ''}`}
              key={style}
              onClick={() => update('style', style)}
            >
              <span className={`swatch ${style.slice(0, 2).toLowerCase()}`} />
              <div>
                <strong>{style}</strong>
                <small>Original Mode B style contract</small>
              </div>
              <span>›</span>
            </button>
          ))}
          <div className="choice disabled">
            <span className="swatch b5" />
            <div>
              <strong>B5 · Character Explainer</strong>
              <small>Separate workflow · External JSON unsupported</small>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Output" />
          <div className="segmented">
            <button className="active" aria-pressed="true" disabled>
              9:16 Portrait
            </button>
            <button disabled>16:9</button>
            <button disabled>1:1</button>
          </div>
          <div className="info">
            R1 configures demo UI only. Native project creation arrives with the runtime adapter.
          </div>
          <Button
            variant="primary"
            onClick={() => showNotice('Demo saved locally in UI state. No project.json was created.')}
          >
            Save demo setup
          </Button>
        </Card>
      </div>
    </div>
  );
}
