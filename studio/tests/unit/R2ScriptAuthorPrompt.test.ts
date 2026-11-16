// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {compileAuthority} from '../../src/main/externalAuthority';
import {freezeTask,sourceFingerprint,stageImport,validateScript} from '../../src/main/externalTasks';
import {nativeSkillRoot,readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture} from './SixIssueFixtures';

afterEach(cleanup);
const sample=()=>{
  const {root}=fixture({style:'B1'});
  const state=readState(root);
  state.project.title='What If Time Froze for One Minute?';
  state.brief.topic='What If Time Froze for One Minute?';
  state.brief.targetDuration=180;
  state.brief.audience=undefined;
  state.brief.purpose=undefined;
  writeState(root,state);
  return root;
};
describe('R2 focused source-exact Script Author handoff',()=>{
  it('B1–B4 retain selected original creative paragraphs, SHA, line provenance and native source isolation',()=>{
    for(const style of ['B1','B2','B3','B4']){
      const author=compileAuthority(appPath,style,'script','author');
      const native=compileAuthority(appPath,style,'native','author');
      expect(author.version).toBe('script-author-source-exact-v3');
      expect(author.sources.length).toBeGreaterThanOrEqual(5);
      expect(author.sources.some(source=>source.path==='references/autopilot-runtime.md')).toBe(false);
      expect(native.version).toBe('stage-exact-v2');
      expect(native.sources.some(source=>source.path==='references/autopilot-runtime.md')).toBe(true);
      for(const source of author.sources){
        const original=fs.readFileSync(path.join(nativeSkillRoot(appPath).root,source.path));
        const lines=original.toString('utf8').replace(/\r\n/g,'\n').split('\n');
        expect(sha(original)).toBe(source.sha256);
        expect(sha(source.text)).toBe(source.extractionSha256);
        expect(source.locations?.length).toBeGreaterThan(0);
        expect(source.extractionRevision).toBe('script-author-source-exact-v3');
        for(const position of source.locations??[]){
          const line=lines[Number(position.slice(1))-1];
          expect(line?.trim()).toBeTruthy();
          expect(source.text.split('\n').some(part=>part.trim().length>15&&line.includes(part))).toBe(true);
        }
      }
      const styleSource=author.sources.find(source=>source.path.includes('/'+style.toLowerCase()+'-'));
      expect(styleSource).toBeDefined();
      const all=author.sources.map(source=>source.text).join('\n');
      expect(all).toContain('first 30 seconds');
      if(style==='B1')expect(all).toContain('Slender proportions');
      if(style==='B2')expect(all).toContain('Warm paper');
      if(style==='B3')expect(all).toContain('dark field');
      if(style==='B4'){
        expect(all).toContain('Story-led horror visibility gate');
        expect(all).toContain('First-three-second visual escalation gate');
        expect(all).toContain('First-frame audio gate');
      }
    }
  });
  it('Script prompt is mission-first, duration-aware and has no Native delivery directives',()=>{
    const root=sample(),task=freezeTask(appPath,root,'script');
    const bytes=Buffer.byteLength(task.prompt,'utf8');
    expect(bytes).toBeGreaterThan(1000);
    expect(task.prompt.split('\n').length).toBeGreaterThan(30);
    expect(task.prompt.indexOf('## 1. Mission and deliverable')).toBeLessThan(task.prompt.indexOf('## 2. Actual project brief'));
    expect(task.prompt.indexOf('## 2. Actual project brief')).toBeLessThan(task.prompt.indexOf('## 4. Applicable original Mode B authority'));
    expect(task.prompt.indexOf('## 4. Applicable original Mode B authority')).toBeLessThan(task.prompt.indexOf('## 5. Exact JSON output contract'));
    expect(task.prompt).toContain('What If Time Froze for One Minute?');
    expect(task.prompt).toContain('180 seconds');
    expect(task.prompt).toContain('No approved WPM target');
    expect(task.prompt).not.toContain('Fill every required shot, ledger');
    expect(task.prompt).not.toContain('For native authoring, payload.manifest');
    expect(task.prompt).not.toContain('Ground every shot in the approved script and actual word/caption timing');
    expect(task.prompt).not.toContain('## REQUIRED RESPONSE ENVELOPE');
    expect(task.prompt).toContain('mode-b-script-v1');
    expect(task.prompt).toContain('REQUIRED_NONEMPTY_ARRAY');
    expect(task.prompt).toContain('source SHA256');
    expect(sha(task.prompt)).toBe(task.promptSha256);
    expect(sha(fs.readFileSync(path.join(root,task.promptPath)))).toBe(task.promptSha256);
    expect(task.inputSha256).toBe(sourceFingerprint(appPath,root,'script'));
  });
  it('valid complete narration imports; invalid section IDs, duplicates and placeholders fail',()=>{
    const root=sample(),task=freezeTask(appPath,root,'script');
    const state=readState(root);
    const outer=(payload:unknown)=>JSON.stringify({
      schema:'mode-b-external-result-v1',project_id:state.project.id,task_id:task.id,
      revision:task.revision,input_sha256:task.inputSha256,stage:'script',payload
    });
    const authoring={creative_direction:{premise:'All motion stops for sixty seconds except the narrator.'},
      characters:[{id:'hero',identity:'Same person throughout'}],continuity:{rules:['Time-freeze rules remain stable']},
      style_decisions:{visual_language:'B1 hand-drawn'},voice_intentions:{tone:'wonder'},
      sound_intentions:{cause:'quiet contrast'},source_references:[]};
    const payload={schema:'mode-b-script-v1',sections:[
      {id:'opening',text:'At noon, the whole city stopped. Only Mira could move.'},
      {id:'payoff',text:'When the minute ended, one decision changed everything.'}
    ],authoring};
    expect(()=>validateScript(payload)).not.toThrow();
    expect(()=>stageImport(appPath,root,'script',outer(payload))).not.toThrow();
    expect(()=>validateScript({...payload,sections:[{id:'bad space',text:'Narration'}]})).toThrow();
    expect(()=>validateScript({...payload,sections:[payload.sections[0],payload.sections[0]]})).toThrow();
    expect(()=>validateScript({...payload,sections:[{id:'opening',text:'REQUIRED_NONEMPTY_ARRAY'}]})).toThrow();
    expect(()=>validateScript({...payload,authoring:null})).toThrow();
  });
  it('same source reuses task identity; explicit rebuild makes old JSON stale',()=>{
    const root=sample(),a=freezeTask(appPath,root,'script');
    const same=freezeTask(appPath,root,'script');
    expect(same.id).toBe(a.id);
    expect(same.promptSha256).toBe(a.promptSha256);
    const replacement=freezeTask(appPath,root,'script',true);
    expect(replacement.id).not.toBe(a.id);
    expect(replacement.revision).toBe(a.revision+1);
    const response={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
      task_id:a.id,revision:a.revision,input_sha256:a.inputSha256,stage:'script',
      payload:{schema:'mode-b-script-v1',sections:[{id:'opening',text:'A real spoken sentence.'}],authoring:{}}};
    expect(()=>stageImport(appPath,root,'script',JSON.stringify(response))).toThrow(/binding mismatch/);
  });
});
