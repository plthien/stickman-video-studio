// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {currentNativeEvidence} from '../../src/main/nativeEvidence';
import {exportReviewPack,freezeLifecycleTask,stageLifecycleResult,confirmLifecycleResult} from '../../src/main/externalLifecycle';
import {confirmImport} from '../../src/main/externalTasks';
import {readExternalHistory} from '../../src/main/externalHistory';
import {atomicJson,readState,sha,writeState} from '../../src/main/services';
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
/** Persist a faithful disabled historical task/pending envelope without invoking
 * the now-disabled Media Review execution path. No synthetic approval is made.
 */
function seedLegacyPending(root:string){
  const review=freezeLifecycleTask(appPath,root,'native','review');
  const state=readState(root),taskId=randomUUID();
  const legacy={...state.lifecycle!.tasks['native:review'],id:taskId,
    operation:'media-review' as const,mediaKind:'preview' as const,status:'FROZEN' as const};
  state.lifecycle!.tasks['native:media-review']=legacy;
  writeState(root,state);
  const payload={schema:'mode-b-review-v1',artifact_sha256:legacy.artifactSha256,
    status:'REVIEWED_NO_FINDINGS',coverage:{target_ids:legacy.targetIds??['shot-1','shot-2'],
      modalities:['manifest'],ranges:[],media_sha256s:[]},findings:[]};
  const envelope=JSON.stringify({schema:'mode-b-lifecycle-result-v1',
    project_id:state.project.id,task_id:taskId,revision:legacy.revision,
    input_sha256:legacy.inputSha256,stage:'native',operation:'media-review',payload});
  const responsePath=path.join(root,'.studio/external/lifecycle/results',taskId+'.json');
  fs.mkdirSync(path.dirname(responsePath),{recursive:true});
  fs.writeFileSync(responsePath,envelope,{flag:'wx'});
  const pendingPath=path.join(root,'.studio/external/lifecycle/pending.json');
  atomicJson(pendingPath,{token:randomUUID(),projectId:state.project.id,taskId,
    stage:'native',operation:'media-review',responseSha256:sha(envelope),payload,
    createdAt:new Date().toISOString()});
  return {taskId,legacy,pendingPath,responsePath,review};
}
function stageNativeReview(root:string,review:ReturnType<typeof freezeLifecycleTask>,whitespace=''){
  const response=JSON.stringify({schema:'mode-b-lifecycle-result-v1',
    project_id:readState(root).project.id,task_id:review.id,
    revision:review.revision,input_sha256:review.inputSha256,
    stage:'native',operation:'review',payload:{schema:'mode-b-review-v1',
      artifact_sha256:review.artifactSha256,status:'REVIEWED_NO_FINDINGS',
      coverage:{target_ids:review.targetIds??['shot-1','shot-2'],
        modalities:['manifest'],ranges:[],media_sha256s:[]},findings:[]}})+whitespace;
  return stageLifecycleResult(appPath,root,'native','review',response);
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
  it('REG-LEGACY-01 archives exact disabled Media Review pending before staging active Review without modifying history',async()=>{
    const {root}=await previewFixture(),seed=seedLegacyPending(root);
    const original=fs.readFileSync(seed.pendingPath),stateBefore=fs.readFileSync(path.join(root,'.studio/state.json'));
    const staged=stageNativeReview(root,seed.review);
    expect(staged.status).toBe('STAGED');
    const digest=sha(original),folder=path.join(root,'.studio/external/lifecycle/archived-pending');
    const archive=path.join(folder,'media-review-'+digest+'.json');
    const receipt=JSON.parse(fs.readFileSync(path.join(folder,'media-review-'+digest+'.receipt.json'),'utf8'));
    expect(fs.readFileSync(archive)).toEqual(original);
    expect(receipt).toMatchObject({schema:'legacy-media-review-pending-recovery-v1',
      originalSha256:digest,taskId:seed.taskId,responseSha256:sha(fs.readFileSync(seed.responsePath))});
    expect(fs.readFileSync(seed.responsePath)).toBeTruthy();
    expect(readState(root).lifecycle!.tasks['native:media-review']).toEqual(seed.legacy);
    expect(readState(root).lifecycle!.artifacts[seed.taskId]).toBeUndefined();
    expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(stateBefore);
    const active=JSON.parse(fs.readFileSync(seed.pendingPath,'utf8'));
    expect(active.operation).toBe('review');
    expect(active.taskId).toBe(seed.review.id);
    expect(readExternalHistory(root,'native','media-review','preview')[0].id).toBe(seed.taskId);
  });
  it('REG-LEGACY-02 rejects corrupt, wrong-project/task, wrong SHA and inconsistent payload without losing original pending',async()=>{
    for(const variant of ['CORRUPT','PROJECT','TASK','SHA','RESPONSE_PAYLOAD'] as const){
      const {root}=await previewFixture(),seed=seedLegacyPending(root);
      if(variant==='CORRUPT')fs.writeFileSync(seed.pendingPath,'{not-json');
      else{
        const pending=JSON.parse(fs.readFileSync(seed.pendingPath,'utf8')) as Record<string,unknown>;
        if(variant==='PROJECT')pending.projectId='foreign-project';
        if(variant==='TASK')pending.taskId=randomUUID();
        if(variant==='SHA')pending.responseSha256='0'.repeat(64);
        if(variant==='RESPONSE_PAYLOAD')pending.payload={schema:'mode-b-review-v1',findings:[]};
        fs.writeFileSync(seed.pendingPath,JSON.stringify(pending));
      }
      const before=fs.readFileSync(seed.pendingPath),state=fs.readFileSync(path.join(root,'.studio/state.json'));
      expect(()=>stageNativeReview(root,seed.review))
        .toThrow(/LEGACY_MEDIA_REVIEW_PENDING_RECOVERY_REQUIRED/);
      expect(fs.readFileSync(seed.pendingPath)).toEqual(before);
      expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(state);
      const archives=path.join(root,'.studio/external/lifecycle/archived-pending');
      expect(fs.existsSync(archives)?fs.readdirSync(archives):[]).toHaveLength(0);
    }
  });
  it('REG-LEGACY-03 retains active lifecycle pending idempotency and conflict handling unchanged',async()=>{
    const {root}=await previewFixture();
    const task=freezeLifecycleTask(appPath,root,'native','review');
    const first=stageNativeReview(root,task),old=fs.readFileSync(path.join(root,'.studio/external/lifecycle/pending.json'));
    const same=stageNativeReview(root,task);
    expect(same.token).toBe(first.token);
    expect(()=>stageNativeReview(root,task,'\\n')).toThrow(/PENDING_LIFECYCLE_CONFLICT/);
    expect(fs.readFileSync(path.join(root,'.studio/external/lifecycle/pending.json'))).toEqual(old);
  });
  it('REG-LEGACY-04 recovery is retryable if interrupted before archive, after archive or before clearing pending',async()=>{
    for(const phase of ['BEFORE_ARCHIVE','AFTER_ARCHIVE','BEFORE_CLEAR'] as const){
      const {root}=await previewFixture(),seed=seedLegacyPending(root);
      const old=fs.readFileSync(seed.pendingPath),digest=sha(old);
      const archiveDir=path.join(root,'.studio/external/lifecycle/archived-pending');
      const archive=path.join(archiveDir,'media-review-'+digest+'.json');
      const receipt=path.join(archiveDir,'media-review-'+digest+'.receipt.json');
      const oldRename=fs.renameSync.bind(fs),oldUnlink=fs.unlinkSync.bind(fs);
      const spy=phase==='BEFORE_CLEAR'?
        vi.spyOn(fs,'unlinkSync').mockImplementation(file=>{
          if(String(file)===seed.pendingPath)throw new Error('INJECTED_BEFORE_CLEAR');
          return oldUnlink(file);
        }):
        vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{
          if(String(to)===(phase==='BEFORE_ARCHIVE'?archive:receipt))
            throw new Error('INJECTED_'+phase);
          return oldRename(from,to);
        });
      try{expect(()=>stageNativeReview(root,seed.review)).toThrow(/INJECTED_/);}
      finally{spy.mockRestore();}
      expect(fs.readFileSync(seed.pendingPath)).toEqual(old);
      expect(fs.existsSync(archive)).toBe(phase!=='BEFORE_ARCHIVE');
      expect(fs.existsSync(receipt)).toBe(phase==='BEFORE_CLEAR');
      expect(readState(root).lifecycle!.tasks['native:media-review']).toEqual(seed.legacy);
      const next=stageNativeReview(root,seed.review);
      expect(next.status).toBe('STAGED');
      expect(fs.readFileSync(archive)).toEqual(old);
      expect(fs.existsSync(receipt)).toBe(true);
      expect(JSON.parse(fs.readFileSync(seed.pendingPath,'utf8')).operation).toBe('review');
    }
  });
  it('REG-LEGACY-05 keeps disabled Media Review unconfirmable after valid legacy pending is recovered',async()=>{
    const {root}=await previewFixture(),seed=seedLegacyPending(root);
    const raw=fs.readFileSync(seed.pendingPath);
    const token=(JSON.parse(raw.toString()) as {token:string}).token;
    expect(()=>freezeLifecycleTask(appPath,root,'native','media-review',{media:'preview'}))
      .toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(()=>stageLifecycleResult(appPath,root,'native','media-review','{}'))
      .toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(()=>confirmLifecycleResult(appPath,root,token)).toThrow(/MEDIA_REVIEW_DISABLED/);
    expect(fs.readFileSync(seed.pendingPath)).toEqual(raw);
    stageNativeReview(root,seed.review);
    expect(readState(root).lifecycle!.artifacts[seed.taskId]).toBeUndefined();
    expect(readExternalHistory(root,'native','media-review','preview')[0].id).toBe(seed.taskId);
    expect(readState(root).approval).toBeUndefined();
  });
});
