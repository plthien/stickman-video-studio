// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,it,expect} from 'vitest';
import {currentNativeEvidence} from '../../src/main/nativeEvidence';
import {exportReviewPack,freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {confirmImport} from '../../src/main/externalTasks';
import {readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture,nativePayload,stageNative,validator} from './SixIssueFixtures';
import {writePreviewEvidence} from './NativeEvidenceFixtures';

afterEach(cleanup);
async function previewFixture(){
  const {root}=fixture({style:'B1'});
  const {response}=stageNative(root,nativePayload(root));
  await confirmImport(appPath,root,response.token,{validator:validator().run});
  const evidence=currentNativeEvidence(root,readState(root),{seconds:20});
  const files=writePreviewEvidence(root,evidence);
  const state=readState(root);
  state.preview={path:'output/preview.mp4',sha256:sha(fs.readFileSync(files.video)),
    reportPath:'output/preview-report.json',reportSha256:sha(fs.readFileSync(files.report)),
    sourceFingerprint:evidence.fingerprint,verifiedAt:new Date().toISOString()};
  writeState(root,state);
  return{root,previewSha256:state.preview.sha256};
}
const envelope=(root:string,task:ReturnType<typeof freezeLifecycleTask>,sha256:string)=>JSON.stringify({
  schema:'mode-b-lifecycle-result-v1',project_id:readState(root).project.id,
  task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,
  stage:'native',operation:'media-review',payload:{
    schema:'mode-b-review-v1',artifact_sha256:task.artifactSha256,
    status:'REVIEWED_WITH_FINDINGS',
    coverage:{target_ids:['shot-1','shot-2'],modalities:['picture'],ranges:[{start:0,end:1}],
      media_sha256s:[sha256]},
    findings:[{id:'F-AV-001',severity:'major',status:'open',target_ids:['shot-1'],
      requirement:'Meaningful principal-picture action in the actual sample',
      evidence:{kind:'observed',source_sha256:sha256,time_range:{start:0,end:1},
        detail:'Manually transferred actual MP4 shows a static synthetic black frame in this OFFLINE TEST FIXTURE; not real project creative acceptance.'},
      recommendation:'Correct the authored shot and rerender an actual project preview'}]
  }
});

describe('R2 honest actual-media review handoff',()=>{
  it('exports byte-verified playable MP4/voice/QA files and accepts scoped owner-attested review findings without owner approval',async()=>{
    const {root,previewSha256}=await previewFixture();
    const exported=exportReviewPack(root,'preview');
    const folder=path.join(root,exported.folder);
    const attachments=(exported.pack.attachments as Array<{path:string;sha256:string;kind:string}>);
    expect(attachments.some(item=>item.sha256===previewSha256)).toBe(true);
    expect(attachments.some(item=>item.kind==='original_native_QA_report')).toBe(true);
    for(const item of attachments)expect(sha(fs.readFileSync(path.join(folder,item.path)))).toBe(item.sha256);
    const task=freezeLifecycleTask(appPath,root,'native','media-review',{media:'preview',transferAcknowledged:true});
    expect(task.prompt).toContain('OWNER_ATTESTED_FILE_TRANSFER_NOT_VERIFIED_BY_STUDIO');
    const pending=stageLifecycleResult(appPath,root,'native','media-review',envelope(root,task,previewSha256));
    confirmLifecycleResult(appPath,root,pending.token);
    expect(readState(root).approval).toBeUndefined();
    expect(readState(root).lifecycle?.artifacts[task.id].status).toBe('REVIEWED_WITH_FINDINGS');
  });
  it('rejects claimed audiovisual observations without owner-attested transfer',async()=>{
    const {root,previewSha256}=await previewFixture();
    exportReviewPack(root,'preview');
    const task=freezeLifecycleTask(appPath,root,'native','media-review',{media:'preview'});
    expect(()=>stageLifecycleResult(appPath,root,'native','media-review',envelope(root,task,previewSha256)))
      .toThrow(/NOT_VERIFIED|media provenance/);
    expect(readState(root).approval).toBeUndefined();
  });
  it('rejects media-review target timestamps beyond the actual preview',async()=>{
    const {root,previewSha256}=await previewFixture();
    exportReviewPack(root,'preview');
    const task=freezeLifecycleTask(appPath,root,'native','media-review',{media:'preview',transferAcknowledged:true});
    const bad=envelope(root,task,previewSha256).replace('"end":1}', '"end":999}');
    expect(()=>stageLifecycleResult(appPath,root,'native','media-review',bad)).toThrow(/outside|range/);
  });
});
