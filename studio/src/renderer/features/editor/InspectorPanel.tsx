import { Badge } from '../../components/ui';
import type { InspectorTab, InspectorValues } from './types';
interface InspectorPanelProps {
  tab: InspectorTab; values: InspectorValues; dirty: boolean; shotId: string;
  onTabChange: (tab: InspectorTab) => void;
  onChange: (values: Partial<InspectorValues>) => void;
  onReset: () => void;
}
// Disabled until the original native manifest has a reviewed, persisted layer-edit path.
// Never present fake position, rotation or asset data to a production user.
export function InspectorPanel(_props: InspectorPanelProps) {
  return <aside className="editor-panel inspector"><header><div><strong>Inspector</strong><small>Native-only read-only view</small></div><Badge tone="amber">NOT_READY</Badge></header><div className="inspector-body"><div className="info">No editable native layer inspector is connected. Edit through External Native authoring and review the resulting manifest diff.</div></div></aside>;
}
