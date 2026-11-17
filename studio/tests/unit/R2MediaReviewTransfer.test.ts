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
describe('R2 disabled External Media Review and preserved technical media QA',()=>{
  it('REG-F04-05 keeps verified preview, audio and Native QA bytes even though External Media Review is unavailable',async()=>{
    const {root,previewSha256}=await previewFixture();
    const exported=exportReviewPack(root,'preview');
    const folder=path.join(root,exported.folder);
    const attachments=exported.pack.attachments as Array<{path:string;sha256:string;kind:string}>;
    expect(attachments.some(item=>item.sha256===previewSha256)).toBe(true);
    expect(attachments.some(item=>item.kind==='original_native_QA_report')).toBe(true);
    for(const item of attachments)
      expect(sha(fs.readFileSync(path.join(folder,item.path)))).toBe(item.sha256);
    const before=fs.readFileSync(path.join(root,'.studio/state.json'));
    expect(()=>freezeLifecycleTask(appPath,root,'native','media-review',
      {media:'preview',transferAcknowledged:true})).toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    expect(currentNativeEvidence(root,readState(root),{seconds:20}).fingerprint).toBeTruthy();
  });
  it('REG-F04-02 rejects every new Script/Native media kind at the backend boundary',async()=>{
    const {root}=await previewFixture();
    for(const [stage,kind] of [
      ['script','voice'],['script','captions'],['native','preview'],['native','film'],
      ['script','preview'],['native','voice']
    ] as const)
      expect(()=>freezeLifecycleTask(appPath,root,stage,'media-review',{media:kind}))
        .toThrow(/MEDIA_REVIEW_DISABLED/);
  });
  it('REG-F04-02 prevents Stage/Confirm for an existing frozen legacy Media Review task without changing pending data',async()=>{
    const {root}=await previewFixture();
    freezeLifecycleTask(appPath,root,'native','review');
    const state=readState(root);
    const legacy={...state.lifecycle!.tasks['native:review'],id:'legacy-native-media',
      operation:'media-review' as const,mediaKind:'preview' as const,status:'FROZEN' as const};
    state.lifecycle!.tasks['native:media-review']=legacy;
    writeState(root,state);
    expect(()=>stageLifecycleResult(appPath,root,'native','media-review','{}'))
      .toThrow(/MEDIA_REVIEW_DISABLED/);
    const pendingPath=path.join(root,'.studio/external/lifecycle/pending.json');
    const pending={token:'legacy-token',projectId:state.project.id,stage:'native',
      operation:'media-review',taskId:legacy.id};
    fs.writeFileSync(pendingPath,JSON.stringify(pending));
    const before=fs.readFileSync(pendingPath);
    expect(()=>confirmLifecycleResult(appPath,root,'legacy-token'))
      .toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(fs.readFileSync(pendingPath)).toEqual(before);
    expect(readState(root).lifecycle!.tasks['native:media-review'].id).toBe(legacy.id);
    expect(readState(root).approval).toBeUndefined();
  });
});
