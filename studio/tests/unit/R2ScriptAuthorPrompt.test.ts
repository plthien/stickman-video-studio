// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {compileAuthority,extractScriptAuthor,renderScriptAuthorGroups,SCRIPT_AUTHOR_EXTRACTION_REVISION} from '../../src/main/externalAuthority';
import {freezeTask,sourceFingerprint,stageImport,validateScript,externalOutputFilename} from '../../src/main/externalTasks';
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
      expect(native.version).toBe('stage-exact-v3');
      expect(native.referenceMedia?.length).toBeGreaterThan(0);
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
      }
      expect(author.sources.some(source=>source.blocks?.some(block=>block.text.includes('\n')))).toBe(true);
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
    expect(task.prompt).toContain('JSON FILE DELIVERY — REQUIRED');
    expect(task.prompt).toContain(externalOutputFilename('script','author',task.revision,task.id));
    expect(task.prompt).toContain('actual attachment/download artifact');
    expect(task.prompt).not.toContain('REQUIRED_NONEMPTY_ARRAY');
    expect(task.prompt).not.toContain('REPLACE_WITH_ACTUAL_SECTION_ID');
    expect(task.prompt).toContain('source SHA256');
    // The former hard-coded kite-story example was deliberately removed.
    // Require the generic source-grounded guard instead of reviving that sample.
    expect(task.prompt).toContain('CONTENT-FREE STRUCTURAL SHELL');
    expect(task.prompt).toContain('No copied example text, structural placeholders');
    expect(task.prompt).not.toContain('Never copy the kite example');
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
    // The frozen envelope intentionally contains a non-importable structural shell.
    // It must not silently become sample narration or a valid Script candidate.
    expect(example.payload).toEqual({schema:'mode-b-script-v1',sections:[],authoring:{}});
    expect(()=>validateScript(example.payload)).toThrow('Invalid script payload.');
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

  it('REG-01 / REG-02: B1 60s frozen Script contains creative rules without B3/Native production instructions',()=>{
    const root=sample(),task=freezeTask(appPath,root,'script');
    const prompt=task.prompt;
    for(const required of [
      'What If Time Froze for One Minute?', '"style": "B1"', '60 seconds',
      'Slender proportions', 'Act with the whole body',
      'first 30 seconds', 'semantic subtitles with at most one visible line',
      'Sound must communicate place', 'Place/continuity',
      'hook', 'escalation', 'payoff', 'continuity', 'visual communicability'
    ])expect(prompt).toContain(required);
    for(const forbidden of [
      'B3 has independent design/motion requirements',
      'Maintain a compact project-local shot ledger',
      'actual word times', 'The renderer accepts local keyframes',
      '## Suspense / apocalypse module',
      'low industrial air/drone', 'distant zombie horde',
      'Fill every required shot, ledger',
      'For native authoring, payload.manifest',
      'Run node scripts/autopilot.mjs doctor',
      'Check the encoded main-picture region',
      'Connect cue IDs to the sound/rights manifest'
    ])expect(prompt).not.toContain(forbidden);
  });
  it('REG-03: common suspense module excluded for all Script styles; selected B authority remains',()=>{
    for(const style of ['B1','B2','B3','B4']){
      const compiled=compileAuthority(appPath,style,'script','author');
      const sound=compiled.sources.find(source=>source.path==='references/autopilot-sound-system.md');
      expect(sound).toBeDefined();
      expect(sound!.text).toContain('Sound must communicate place');
      expect(sound!.text).toContain('Build three **functional layers**');
      expect(sound!.text).toContain('These are available roles');
      expect(sound!.text).toContain('Near-silence and complete silence are different choices.');
      expect(sound!.text).not.toContain('## Suspense / apocalypse module');
      expect(sound!.text).not.toContain('low industrial air/drone');
      const styleReference=compiled.sources.find(source=>source.path.includes(
        '/'+style.toLowerCase()+'-'));
      expect(styleReference).toBeDefined();
      if(style==='B3')expect(styleReference!.text).toContain('If narration names a behavior');
      if(style==='B4'){
        expect(styleReference!.text).toContain('Story-led horror visibility gate');
        expect(styleReference!.text).toContain('deliberate-hold exception');
        expect(compiled.sources.some(s=>s.path==='references/b4-audio-direction.md')).toBe(true);
      }
    }
  });
  it('REG-04: authorized shared-source ranges and all mixed sentence boundaries stay exact',()=>{
    const expected={
      'references/autopilot.md':['L5-L5','L11:','L13:','L21:','L25:','L43:'],
      'references/autopilot-production-qa.md':['L9-L9','L21:','L23-L24','L27:','L33-L34','L42-L42','L48:'],
      'references/autopilot-sound-system.md':['L7-L7','L18-L24','L61:','L63:','L72:']
    };
    const compiled=compileAuthority(appPath,'B1','script','author');
    for(const [relative,starts] of Object.entries(expected)){
      const source=compiled.sources.find(row=>row.path===relative)!;
      expect(source).toBeDefined();
      expect(source.locations).toHaveLength(starts.length);
      for(let i=0;i<starts.length;i++){
        expect(source.locations![i].startsWith(starts[i])).toBe(true);
      }
      const original=fs.readFileSync(path.join(nativeSkillRoot(appPath).root,relative),'utf8');
      expect(()=>extractScriptAuthor(original.replace(/\r?\n/g,'\r\n'),relative)).not.toThrow();
    }
  });
  it('REG-05: source heading is rendered exactly once, even with heading in first block',()=>{
    const original='## Visual language\n- Preserve the source rule.';
    expect(renderScriptAuthorGroups([['## Visual language',[original]]])).toBe(original);
    const grouped=renderScriptAuthorGroups([['## First 30 seconds: picture, sound and copy together',
      ['Give the first 30 seconds a dedicated hook pass.']]]);
    expect(grouped).toBe('## First 30 seconds: picture, sound and copy together\n'+
      'Give the first 30 seconds a dedicated hook pass.');
    expect(renderScriptAuthorGroups([['',['A selected rule before any Markdown heading.']]]))
      .toBe('A selected rule before any Markdown heading.');
    for(const style of ['B1','B2','B3','B4']){
      const compiled=compileAuthority(appPath,style,'script','author');
      for(const source of compiled.sources){
        expect(source.text).not.toMatch(/(^|\n)(#{2,5} [^\n]+)\n\2(\n|$)/);
        for(const block of source.blocks??[])expect(source.text).toContain(block.text);
      }
    }
  });
  it('REG-07 / REG-08: freezing Script cannot change Native task or previously approved assets',()=>{
    const {root}=fixture({style:'B1'});
    const original=readState(root);
    const creativeSnapshot=JSON.stringify({
      approvedScript:original.approvedScript,voice:original.voice,
      alignment:original.alignment,media:original.media??[]
    });
    const acceptedWavSha=sha(fs.readFileSync(path.join(root,original.voice!.path)));
    const nativeBefore=freezeTask(appPath,root,'native');
    const nativeSha=nativeBefore.promptSha256;
    freezeTask(appPath,root,'script');
    freezeTask(appPath,root,'script',true);
    const preserved=readState(root);
    expect(JSON.stringify({
      approvedScript:preserved.approvedScript,voice:preserved.voice,
      alignment:preserved.alignment,media:preserved.media??[]
    })).toBe(creativeSnapshot);
    expect(sha(fs.readFileSync(path.join(root,preserved.voice!.path)))).toBe(acceptedWavSha);
    const nativeAfter=freezeTask(appPath,root,'native');
    expect(nativeAfter.id).toBe(nativeBefore.id);
    // Native source files can carry CRLF on Windows. Initial freeze returns the
    // generated string; subsequent freeze reads the unchanged file via readUtf8,
    // which normalizes CRLF to LF. Preserve semantics and exact on-disk bytes.
    expect(nativeAfter.prompt.replace(/\r\n/g,'\n')).toBe(nativeBefore.prompt.replace(/\r\n/g,'\n'));
    expect(nativeAfter.promptSha256).toBe(nativeSha);
    expect(sha(fs.readFileSync(path.join(root,nativeAfter.promptPath)))).toBe(nativeSha);
    const scriptOriginal=sourceFingerprint(appPath,root,'script');
    const state=readState(root);
    state.brief.topic='Another independently authored project brief';
    writeState(root,state);
    expect(sourceFingerprint(appPath,root,'script')).not.toBe(scriptOriginal);
    expect(readState(root).tasks?.native?.id).toBe(nativeBefore.id);
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
