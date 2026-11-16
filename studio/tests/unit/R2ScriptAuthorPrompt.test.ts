// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {compileAuthority,extractScriptAuthor,SCRIPT_AUTHOR_EXTRACTION_REVISION} from '../../src/main/externalAuthority';
import {freezeTask,sourceFingerprint,stageImport,validateScript} from '../../src/main/externalTasks';
import {nativeSkillRoot,readState,sha,writeState} from '../../src/main/services';
import {appPath,cleanup,fixture} from './SixIssueFixtures';

afterEach(cleanup);
const sample=()=>{
  const {root}=fixture({style:'B1'});
  const state=readState(root);
  state.project.title='What If Time Froze for One Minute?';
  state.brief.topic='What If Time Froze for One Minute?';
  state.brief.targetDuration=60;
  state.brief.language='English';
  state.brief.ratio='9:16';
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
      expect(author.version).toBe(SCRIPT_AUTHOR_EXTRACTION_REVISION);
      expect(author.scriptAuthorClassification?.KEEP_SCRIPT.length).toBeGreaterThan(20);
      expect(author.scriptAuthorClassification?.KEEP_SCRIPT.every(entry=>/L\d+(?:-L\d+|:C\d+-C\d+)$/.test(entry))).toBe(true);
      expect(author.scriptAuthorClassification?.DEFER_NATIVE.some(entry=>entry.includes('autopilot-runtime.md'))).toBe(true);
      expect(author.scriptAuthorClassification?.STUDIO_ONLY).toContain('provider HTTP/cost/credentials');
      expect(author.scriptAuthorClassification?.AGENT_ONLY.length).toBeGreaterThan(0);
      expect(author.sources.length).toBeGreaterThanOrEqual(5);
      expect(author.sources.some(source=>source.path==='references/autopilot-runtime.md')).toBe(false);
      expect(native.version).toBe('stage-exact-v2');
      expect(native.sources.some(source=>source.path==='references/autopilot-runtime.md')).toBe(true);
      for(const source of author.sources){
        const original=fs.readFileSync(path.join(nativeSkillRoot(appPath).root,source.path));
        const originalText=original.toString('utf8').replace(/\r\n/g,'\n');
        const lines=originalText.replace(/\r\n/g,'\n').split('\n');
        expect(sha(original)).toBe(source.sha256);
        expect(sha(source.text)).toBe(source.extractionSha256);
        expect(source.locations?.length).toBeGreaterThan(0);
        expect(source.blocks?.length).toBe(source.locations?.length);
        expect(source.extractionRevision).toBe(SCRIPT_AUTHOR_EXTRACTION_REVISION);
        for(const block of source.blocks??[]){
          expect(source.text).toContain(block.text);
          expect(originalText).toContain(block.text);
          const full=block.location.match(/^L(\d+)-L(\d+)$/);
          const partial=block.location.match(/^L(\d+):C(\d+)-C(\d+)$/);
          expect(Boolean(full||partial)).toBe(true);
          if(full){
            const start=Number(full[1]),end=Number(full[2]);
            expect(block.text).toBe(lines.slice(start-1,end).join('\n'));
          }else if(partial){
            const row=lines[Number(partial[1])-1];
            expect(block.text).toBe(row.slice(Number(partial[2])-1,Number(partial[3])));
          }
        }
        expect((source.blocks??[]).some(b=>b.text.includes('\n'))).toBe(true);
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
        expect(all).toContain('deliberate-hold exception');
      }
    }
  });
  it('Script prompt is mission-first, duration-aware and has no Native delivery directives',()=>{
    const root=sample(),task=freezeTask(appPath,root,'script');
    const bytes=Buffer.byteLength(task.prompt,'utf8');
    console.info('B1_SCRIPT_AUTHOR_60S_MEASURED',JSON.stringify({bytes,lines:task.prompt.split('\n').length,approxTokensByChars:Math.ceil(task.prompt.length/4)}));
    expect(bytes).toBeGreaterThan(1000);
    expect(task.prompt.split('\n').length).toBeGreaterThan(30);
    expect(task.prompt.indexOf('## 1. Mission and deliverable')).toBeLessThan(task.prompt.indexOf('## 2. Actual project brief'));
    expect(task.prompt.indexOf('## 2. Actual project brief')).toBeLessThan(task.prompt.indexOf('## 4. Applicable original Mode B authority'));
    expect(task.prompt.indexOf('## 4. Applicable original Mode B authority')).toBeLessThan(task.prompt.indexOf('## 5. Exact JSON output contract'));
    expect(task.prompt).toContain('What If Time Froze for One Minute?');
    expect(task.prompt).toContain('60 seconds');
    expect(task.prompt).toContain('No approved WPM target');
    expect(task.prompt).not.toContain('Fill every required shot, ledger');
    expect(task.prompt).not.toContain('For native authoring, payload.manifest');
    expect(task.prompt).not.toContain('Ground every shot in the approved script and actual word/caption timing');
    expect(task.prompt).not.toContain('## REQUIRED RESPONSE ENVELOPE');
    expect(task.prompt).toContain('mode-b-script-v1');
    expect(task.prompt).not.toContain('REQUIRED_NONEMPTY_ARRAY');
    expect(task.prompt).not.toContain('REPLACE_WITH_ACTUAL_SECTION_ID');
    expect(task.prompt).toContain('source SHA256');
    expect(task.prompt).toContain('Never copy the kite example');
    expect(task.prompt).toContain('"language": "English"');
    expect(task.prompt).toContain('"ratio": "9:16"');
    const contractStart=task.prompt.indexOf('{\n',task.prompt.indexOf('## 5. Exact JSON output contract'));
    const contractEnd=task.prompt.indexOf('\n\nRequired payload:',contractStart);
    expect(contractStart).toBeGreaterThan(0);
    expect(contractEnd).toBeGreaterThan(contractStart);
    const example=JSON.parse(task.prompt.slice(contractStart,contractEnd)) as {
      schema:string;project_id:string;task_id:string;revision:number;
      input_sha256:string;stage:string;payload:Record<string,unknown>
    };
    expect(example).toMatchObject({
      schema:'mode-b-external-result-v1',project_id:readState(root).project.id,
      task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'script'
    });
    expect(validateScript(example.payload).sections.map(s=>s.id)).toEqual(['opening','resolution']);
    expect(sha(task.prompt)).toBe(task.promptSha256);
    expect(sha(fs.readFileSync(path.join(root,task.promptPath)))).toBe(task.promptSha256);
    expect(task.inputSha256).toBe(sourceFingerprint(appPath,root,'script'));
  });
  it('fails closed if original source contents or a required source path changes',()=>{
    const file=path.join(nativeSkillRoot(appPath).root,'references/b2-colorful-handdrawn.md');
    const original=fs.readFileSync(file,'utf8');
    expect(()=>extractScriptAuthor(original,'references/b2-colorful-handdrawn.md')).not.toThrow();
    expect(()=>extractScriptAuthor(original.replace(/\r?\n/g,'\r\n'),'references/b2-colorful-handdrawn.md')).not.toThrow();
    expect(()=>extractScriptAuthor(original.replace('Warm paper','Cold paper'),
      'references/b2-colorful-handdrawn.md')).toThrow(/original authority changed/);
    expect(()=>extractScriptAuthor(original,'references/nonexistent-style.md'))
      .toThrow(/missing Script Author requirement inventory/);
  });
  it('keeps style-specific conditions and source-exact multi-line requirements',()=>{
    const originals=['b1-minimal-handdrawn.md','b2-colorful-handdrawn.md',
      'b3-television.md','b4-survival-storytelling.md'];
    const expected=[
      ['Slender proportions','Act with the whole body','not a hard requirement for every possible story'],
      ['Maintain physical contact and object ownership','Reusing a setting within one story','not a location quota'],
      ['If narration names a behavior','an unchanged dog next to the word APPROACH is not approaching','When an animal carries the story'],
      ['Scripted abnormal anatomy','deliberate-hold exception','This exception does not change A or B1–B3']
    ];
    for(let i=0;i<originals.length;i++){
      const source=compileAuthority(appPath,'B'+(i+1),'script','author').sources
        .find(s=>s.path.endsWith(originals[i]))!;
      for(const rule of expected[i])expect(source.text).toContain(rule);
    }
  });
  it('preserves the existing Native Author prompt and complete original manifest contract',()=>{
    const {root}=fixture({style:'B1'});
    const native=freezeTask(appPath,root,'native');
    expect(native.prompt).toContain('## REQUIRED RESPONSE ENVELOPE');
    expect(native.prompt).toContain('For native authoring, payload.manifest is the original B1–B4 project.json v1');
    expect(native.prompt).toContain('Fill every required shot, ledger and actual field');
    expect(native.prompt).toContain('references/autopilot-runtime.md');
    expect(native.prompt).not.toContain('## 1. Mission and deliverable');
    expect(sha(native.prompt)).toBe(native.promptSha256);
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
