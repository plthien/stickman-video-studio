// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {narrationParts,joinNarrationWavs} from '../../src/main/narrationApi';
import {runLongform} from '../../src/main/voiceMedia';
import {createNanoTestProducer} from './NanoHttpMock';
import {inspectWavBuffer,projectId,readState,type StudioState} from '../../src/main/services';

const golden=JSON.parse(fs.readFileSync(path.join(process.cwd(),
  'tests/fixtures/nano_api_v1/golden_receipt.json'),'utf8')) as Record<string,unknown>;
const sample=Buffer.from(String(golden.wav_base64),'base64');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function project(endpoint:string,sections:Array<{id:string;text:string}>){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-narration-api-'));
  roots.push(root);
  fs.mkdirSync(path.join(root,'.studio'),{recursive:true});
  fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({
    version:1,style:'B1',width:1080,height:1920,fps:30,
    voice:{path:'narration.wav'},captions:[],shots:[],sfx:[]
  }));
  const script=sections.map(x=>x.text).join('\n\n');
  const state:StudioState={schema:'mode-b-studio-state-v1',
    project:{id:projectId(root),root,title:'API narration',style:'B1',
      updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},
    brief:{topic:'Test',language:'en',ratio:'9:16'},external:{},
    approvedScript:{sections,text:script,sha256:hash(script),revision:1,
      approvedAt:new Date().toISOString()},
    nano:{endpoint}};
  fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));
  return root;
}
function producer(failSpeechAt=0){
  return createNanoTestProducer({voiceId:'voice',failSpeechAt});
}
describe('one verified Nano HTTP narration pipeline',()=>{
  it('splits only at outer API 4096-char limits, preserving exact section bytes',()=>{
    const text=('Word followed by another word. ').repeat(170);
    const chunks=narrationParts([{id:'s1',text}]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(item=>item.text.length>0&&item.text.length<=4096)).toBe(true);
    expect(chunks.map(item=>item.text).join('')).toBe(text);
    expect(()=>narrationParts([{id:'s1',text:'A'.repeat(4097)}])).toThrow(/SAFE_BOUNDARY/);
  });
  it('joins verified 24-kHz mono PCM16 WAVs without losing frames',()=>{
    const combined=joinNarrationWavs([sample,sample]);
    expect(inspectWavBuffer(combined).frames).toBe(inspectWavBuffer(sample).frames*2);
    expect(combined.readUInt32LE(40)).toBe(
      inspectWavBuffer(sample).frames*2*2);
  });
  it('uses the same one-button API pipeline for a single approved section',async()=>{
    const api=producer();const endpoint=await api.start();
    try{
      const root=project(endpoint,[{id:'only',text:'One complete section.'}]);
      const result=await runLongform(root,{voice:'voice'});
      expect(result.sha256).toBe(readState(root).voice?.sha256);
      expect(api.get().speechCalls).toBe(1);
      expect(readState(root).longform?.status).toBe('PASS');
    }finally{await api.close();}
  });
  it('generates all sections over HTTP, publishes once and reuses completed proof without deleting captions',async()=>{
    const api=producer();const endpoint=await api.start();
    try{
      const root=project(endpoint,[{id:'a',text:'First chapter.'},{id:'b',text:'Second chapter.'}]);
      const first=await runLongform(root,{voice:'voice'});
      expect(api.get().speechCalls).toBe(2);
      expect(readState(root).longform?.status).toBe('PASS');
      expect(readState(root).voice?.sha256).toBe(first.sha256);
      expect(inspectWavBuffer(fs.readFileSync(path.join(root,'assets/audio/narration.wav'))).frames)
        .toBe(inspectWavBuffer(sample).frames*2);
      const before=fs.readFileSync(path.join(root,'.studio/state.json'));
      const second=await runLongform(root,{voice:'voice'});
      expect(second.sha256).toBe(first.sha256);
      expect(api.get().speechCalls).toBe(2);
      expect(fs.readFileSync(path.join(root,'.studio/state.json'))).toEqual(before);
    }finally{await api.close();}
  });
  it('never replays an uncertain request without explicit retry; reuses proved earlier parts',async()=>{
    const api=producer(2);const endpoint=await api.start();
    try{
      const root=project(endpoint,[{id:'a',text:'First chapter.'},{id:'b',text:'Second chapter.'}]);
      await expect(runLongform(root,{voice:'voice'})).rejects.toThrow(/NANO_UNCERTAIN/);
      expect(readState(root).longform?.status).toBe('UNCERTAIN');
      expect(api.get().speechCalls).toBe(2);
      await expect(runLongform(root,{voice:'voice',resume:true})).rejects.toThrow(/NANO_UNCERTAIN/);
      expect(api.get().speechCalls).toBe(2);
      await runLongform(root,{voice:'voice',resume:true,retryUncertain:true});
      expect(api.get().speechCalls).toBe(3);
      expect(readState(root).longform?.status).toBe('PASS');
    }finally{await api.close();}
  });
});
