// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {confirmImport,freezeTask,stageImport} from '../../src/main/externalTasks';
import {validateAuthoring} from '../../src/main/sourceCitations';
import {readState} from '../../src/main/services';
import {appPath,cleanup,fixture,frozenEnvelope,nativePayload,stageNative} from './SixIssueFixtures';

afterEach(()=>{vi.unstubAllGlobals();cleanup()});
const script=(refs:unknown[]=[],direction='Research-led survival narrative')=>({schema:'mode-b-script-v1',sections:[{id:'opening',text:'One two three'}],authoring:{creative_direction:{description:direction},source_references:refs,characters:[],style_decisions:{},voice_intentions:{},sound_intentions:{}}});
describe('WP-D: safe inert public citations without weakening native path rules',()=>{
  it('UT-D01 approved Unicode HTTP(S) citation survives stage, confirmation and next native frozen prompt verbatim',async()=>{
    const {root}=fixture(),citation={title:'Nghiên cứu nguồn gốc nhân loại',url:'https://research.example.org/papers?q=ancient%20humans&lang=vi#results',note:'Nguồn tham khảo công khai — kiểm tra thủ công'};
    const payload=script([citation,'https://university.example.edu/research?id=123#figure']);
    const envelope=frozenEnvelope(root,'script',payload);
    const staged=stageImport(appPath,root,'script',JSON.stringify(envelope));
    expect(staged.status).toBe('STAGED');
    await confirmImport(appPath,root,staged.token);
    expect(readState(root).approvedScript?.authoring?.source_references).toEqual(payload.authoring.source_references);
    const next=freezeTask(appPath,root,'native');
    expect(next.prompt).toContain(citation.url);
    expect(next.prompt).toContain(citation.title);
    expect(next.prompt).toContain('figure');
  });
  it('UT-D02 executable, credentialed, localhost/private, oversized and malformed citation shapes fail',()=>{
    const {root}=fixture();
    const bad:unknown[]=['javascript:alert(1)','file:///etc/passwd','data:text/html;base64,abc','https://user:password@example.org/doc',
      'https://localhost/p','http://127.0.0.1/secret','https://192.168.1.2/','https://10.0.0.1','http://172.20.2.4',
      'https://example.org/'+('x'.repeat(2050)),{title:'T',url:'https://example.org',executable:'no'},{title:77,url:'https://example.org'},{title:'A',url:'https://localhost/'},{title:'Missing URL'}];
    const frozen=freezeTask(appPath,root,'script');
    for(const ref of bad){
      const response={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,task_id:frozen.id,revision:frozen.revision,input_sha256:frozen.inputSha256,stage:'script',payload:script([ref])};
      expect(()=>stageImport(appPath,root,'script',JSON.stringify(response))).toThrow();
    }
    expect(()=>validateAuthoring(JSON.parse('{"source_references":[{"url":"https://example.org","__proto__":{}}]}'))).toThrow(/Citation|Forbidden|key/);
  });
  it('UT-D03 URLs, absolute and traversal in original native image/voice/SFX paths fail; safe relative paths remain accepted',()=>{
    const {root}=fixture(),task=freezeTask(appPath,root,'native');
    for(const unsafe of ['https://cdn.example.org/image.png','file:///C:/secret.png','C:\\Users\\x\\photo.png','../outside.png','assets/images/../../outside.png']){
      const payload=nativePayload(root,{image:'early',unsafe}),env={schema:'mode-b-external-result-v1',project_id:readState(root).project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'native',payload};
      expect(()=>stageImport(appPath,root,'native',JSON.stringify(env))).toThrow();
    }
    const audio=nativePayload(root,{sfx:true,unsafe:'https://example.org/external.wav'});
    expect(()=>stageImport(appPath,root,'native',JSON.stringify({...frozenEnvelope(root,'native',audio)}))).toThrow();
    const safe=stageNative(root,nativePayload(root));
    expect(safe.response.status).toBe('STAGED');
  });
  it('UT-D04 narrative prose may quote a public URL with no network fetch or remote media interpretation',async()=>{
    const {root}=fixture(),fetch=vi.fn(()=>{throw new Error('No network fetching allowed during source citation import')});
    vi.stubGlobal('fetch',fetch);
    const description='The speaker says "https://museum.example.org/exhibit?q=stone#gallery" as an inert quoted source, not a media request.';
    const payload=script([],description),returned=frozenEnvelope(root,'script',payload);
    const staged=stageImport(appPath,root,'script',JSON.stringify(returned));
    await confirmImport(appPath,root,staged.token);
    expect(readState(root).approvedScript?.authoring?.creative_direction).toEqual({description});
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root,'.studio/state.json'),'utf8')).toContain('museum.example.org');
  });
});
