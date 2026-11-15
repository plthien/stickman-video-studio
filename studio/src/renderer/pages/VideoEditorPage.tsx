import { Badge } from '../components/ui';
import { ApprovalPanel } from '../features/editor/ApprovalPanel';
import { EditorModeTabs } from '../features/editor/EditorModeTabs';
import { EditorTimeline } from '../features/editor/EditorTimeline';
import { NativePreviewPanel } from '../features/editor/NativePreviewPanel';
import { PortraitPreview } from '../features/editor/PortraitPreview';
import { QADetailsDialog } from '../features/editor/QADetailsDialog';
import { SceneAssetPanel } from '../features/editor/SceneAssetPanel';
import { TimelineSplitter } from '../features/editor/TimelineSplitter';
import { useEditorState } from '../features/editor/useEditorState';
import { useAppState } from '../app/AppState';

export function VideoEditorPage(){
  const {native}=useAppState(),editor=useEditorState();
  const {state,selectedShotIndex,selectedShot,patch}=editor;
  // A new project has an empty manifest. No fallback clips, drawings or fake edits.
  if(!native||!native.projection?.shots?.length||!selectedShot)return <div className="editor-page"><header className="editor-contextbar"><strong>Video Editor</strong><Badge tone="amber">EMPTY / NOT_READY</Badge></header><div className="info">No authored native shots are available. Create/open a project and import a validated Native Manifest. No demonstration scene or preview will be substituted.</div></div>;
  return <div className="editor-page">
    <header className="editor-contextbar"><div><strong>Video Editor</strong><span>{selectedShot.id} · {selectedShot.title}</span></div></header>
    <div className="editor-toolbar"><EditorModeTabs mode={state.mode} onChange={mode=>patch({mode})}/><Badge tone="mint">NATIVE PROJECT</Badge></div>
    <div className="editor-workbench">
      <SceneAssetPanel shots={state.shots} selected={selectedShotIndex} onSelect={editor.selectShot}/>
      <PortraitPreview shot={selectedShot} time={state.time} playing={state.playing} onSeek={editor.seek} onPlay={editor.togglePlayback} onPrevious={editor.previousShot} onNext={editor.nextShot}/>
      {state.mode==='edit'?<aside className="editor-panel mode-panel"><div className="info">READ ONLY — No synthetic Inspector. Edit the native manifest through a frozen ChatGPT task and reviewed import.</div></aside>:state.mode==='preview'?<NativePreviewPanel onDetails={()=>patch({qaOpen:true})} onApproval={()=>patch({mode:'approval'})}/>:<ApprovalPanel onDetails={()=>patch({qaOpen:true})}/>}
    </div>
    <TimelineSplitter value={state.timelineHeight} onChange={timelineHeight=>patch({timelineHeight})} onReset={()=>patch({timelineHeight:244})}/>
    <EditorTimeline shots={state.shots} actualTracks={native.projection.tracks} selected={state.selectedClip} time={state.time} height={state.timelineHeight} onSelect={editor.selectClip} onSeek={editor.seek}/>
    <QADetailsDialog open={state.qaOpen} onClose={()=>patch({qaOpen:false})}/>
  </div>;
}
