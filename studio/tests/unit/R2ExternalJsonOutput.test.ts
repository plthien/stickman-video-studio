// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {freezeTask,externalOutputFilename} from '../../src/main/externalTasks';
import {freezeLifecycleTask} from '../../src/main/externalLifecycle';
import {readState,sha,writeState,type ExternalOperation,type Stage} from '../../src/main/services';
import {appPath,cleanup,fixture} from './SixIssueFixtures';

afterEach(cleanup);

describe('R2 frozen task JSON attachment delivery',()=>{
  it('uses exactly the first eight normalized UUID characters and canonical operation/kind',()=>{
    const id='F4823514-aa00-4b12-a001-123456789abc';
    expect(externalOutputFilename('script','review',2,id))
      .toBe('mode_b_script_review_r2_f4823514.json');
    expect(externalOutputFilename('native','media-review',7,id,'preview'))
      .toBe('mode_b_native_media_review_preview_r7_f4823514.json');
    expect(externalOutputFilename('script','author',3,'c2a6c08e-88ab-4333-9123-0123456789ab'))
      .toBe('mode_b_script_author_r3_c2a6c08e.json');
    expect(()=>externalOutputFilename('script','media-review',1,id)).toThrow(/media kind/);
    expect(()=>externalOutputFilename('script','author',0,id)).toThrow(/positive task revision/);
    expect(()=>externalOutputFilename('native','author',1,'not-a-uuid')).toThrow(/UUID-derived/);
  });

  it('produces ten frozen tasks with required downloadable JSON filenames, and maintains stable task identity',()=>{
    const {root}=fixture({style:'B1'});
    const state=readState(root);
    state.external.native={revision:1,artifact:{shotLedger:[],soundScript:[],assetNeeds:[]},importedAt:new Date().toISOString()};
    // Synthetic registered preview for filename/transport behavior only; no
    // statement of real audiovisual inspection or successful playback.
    const previewPath='.studio/fake-preview.mp4',reportPath='.studio/fake-preview-report.json';
    fs.mkdirSync(path.dirname(path.join(root,previewPath)),{recursive:true});
    const preview=Buffer.from('Synthetic test-only preview marker');
    const report=Buffer.from(JSON.stringify({duration:20}));
    fs.writeFileSync(path.join(root,previewPath),preview);
    fs.writeFileSync(path.join(root,reportPath),report);
    state.preview={path:previewPath,sha256:sha(preview),
      reportPath,reportSha256:sha(report),verifiedAt:new Date().toISOString()};
    writeState(root,state);

    const all:Array<{stage:Stage;operation:ExternalOperation;media?:'voice'|'preview'}>=[];
    for(const stage of ['script','native'] as Stage[]){
      for(const operation of ['author','review','correct','recheck','media-review'] as ExternalOperation[]){
        all.push({stage,operation,...(operation==='media-review'?{media:stage==='script'?'voice' as const:'preview' as const}:{})});
      }
    }
    expect(all).toHaveLength(10);
    const seen=new Set<string>();
    for(const row of all){
      const scope=row.operation==='correct'?
        {editableIds:[row.stage==='script'?'opening':'old-shot']}:
        row.operation==='media-review'?{media:row.media}:{};
      const task=row.operation==='author'?
        freezeTask(appPath,root,row.stage):
        freezeLifecycleTask(appPath,root,row.stage,row.operation,scope);
      const filename=externalOutputFilename(row.stage,row.operation,task.revision,task.id,row.media);
      const shortId=task.id.replace(/-/g,'').slice(0,8).toLowerCase();
      const expected='mode_b_'+row.stage+'_'+row.operation.replace(/-/g,'_')+
        (row.media?'_'+row.media:'')+'_r'+task.revision+'_'+shortId+'.json';
      expect(filename).toBe(expected);
      expect(filename).toMatch(/^[a-z0-9_]+\.json$/);
      expect(task.prompt).toContain('JSON FILE DELIVERY — REQUIRED');
      expect(task.prompt).toContain('required filename: '+filename);
      expect(task.prompt).toContain('COMPLETE final frozen response envelope');
      expect(task.prompt).toContain('actual attachment/download artifact');
      expect(task.prompt).toContain('never claim creation or fabricate a download link');
      expect(task.prompt).toContain(task.id);
      seen.add(row.stage+':'+row.operation);
      const same=row.operation==='author'?
        freezeTask(appPath,root,row.stage):
        freezeLifecycleTask(appPath,root,row.stage,row.operation,scope);
      expect(same.id).toBe(task.id);
      expect(externalOutputFilename(row.stage,row.operation,same.revision,same.id,row.media)).toBe(filename);
    }
    expect(seen.size).toBe(10);

    const before=freezeLifecycleTask(appPath,root,'script','review');
    const rebuilt=freezeLifecycleTask(appPath,root,'script','review',{},true);
    expect(rebuilt.id).not.toBe(before.id);
    expect(rebuilt.revision).toBe(before.revision+1);
    const rebuiltFilename=externalOutputFilename('script','review',rebuilt.revision,rebuilt.id);
    expect(rebuiltFilename).not.toBe(externalOutputFilename('script','review',before.revision,before.id));
    expect(rebuilt.prompt).toContain(rebuiltFilename);
    expect(rebuilt.prompt).toContain('"task_id": "'+rebuilt.id+'"');
  });
});
