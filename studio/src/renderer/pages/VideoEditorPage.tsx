import { Badge, Button } from '../components/ui';
import { ApprovalPanel } from '../features/editor/ApprovalPanel';
import { EditorModeTabs } from '../features/editor/EditorModeTabs';
import { EditorTimeline } from '../features/editor/EditorTimeline';
import { InspectorPanel } from '../features/editor/InspectorPanel';
import { NativePreviewPanel } from '../features/editor/NativePreviewPanel';
import { PortraitPreview } from '../features/editor/PortraitPreview';
import { QADetailsDialog } from '../features/editor/QADetailsDialog';
import { SceneAssetPanel } from '../features/editor/SceneAssetPanel';
import { TimelineSplitter } from '../features/editor/TimelineSplitter';
import { useEditorState } from '../features/editor/useEditorState';
import { useAppState } from '../app/AppState';

export function VideoEditorPage() {
  const { native } = useAppState();
  const editor = useEditorState();
  const { state, selectedShotIndex, selectedShot, inspectorValues, dirty, patch } = editor;

  return <div className="editor-page">
    <header className="editor-contextbar">
      <div><strong>Video Editor</strong><span>{selectedShot.id} · {selectedShot.title}</span>{dirty && <b>Edited</b>}</div>
      <Button disabled={Boolean(native)} onClick={editor.resetAll}>Reset demo only</Button>
    </header>
    <div className="editor-toolbar">
      <EditorModeTabs mode={state.mode} onChange={(mode) => patch({ mode })} />
      <Badge tone={native ? 'mint' : 'blue'}>{native ? 'PROJECT DATA · INSPECTOR READ ONLY' : 'DEMO ONLY'}</Badge>
    </div>
    <div className="editor-workbench">
      <SceneAssetPanel shots={state.shots} selected={selectedShotIndex} onSelect={editor.selectShot} />
      <PortraitPreview
        shot={selectedShot}
        time={state.time}
        playing={state.playing}
        onSeek={editor.seek}
        onPlay={editor.togglePlayback}
        onPrevious={editor.previousShot}
        onNext={editor.nextShot}
      />
      {state.mode === 'edit' ? native ? <aside className="editor-panel mode-panel"><div className="info">READ ONLY: unsupported inspector edits are not persisted. Use a scoped manual native task and reviewed import.</div></aside> : <InspectorPanel
        tab={state.inspectorTab}
        values={inspectorValues}
        dirty={dirty}
        shotId={selectedShot.id}
        onTabChange={(inspectorTab) => patch({ inspectorTab })}
        onChange={editor.updateInspector}
        onReset={editor.resetInspector}
      /> : state.mode === 'preview' ? <NativePreviewPanel
        onDetails={() => patch({ qaOpen: true })}
        onApproval={() => patch({ mode: 'approval' })}
      /> : <ApprovalPanel onDetails={() => patch({ qaOpen: true })} />}
    </div>
    <TimelineSplitter
      value={state.timelineHeight}
      onChange={(timelineHeight) => patch({ timelineHeight })}
      onReset={() => patch({ timelineHeight: 244 })}
    />
    <EditorTimeline
      shots={state.shots}
      actualTracks={native?.projection?.tracks}
      selected={state.selectedClip}
      time={state.time}
      height={state.timelineHeight}
      onSelect={editor.selectClip}
      onSeek={editor.seek}
    />
    <QADetailsDialog open={state.qaOpen} onClose={() => patch({ qaOpen: false })} />
  </div>;
}
