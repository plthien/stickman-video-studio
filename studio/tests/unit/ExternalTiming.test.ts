// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import{afterEach,describe,expect,it}from'vitest';
import{approveCaptionReview,draftCaptionReview}from'../../src/main/captionReview';
import{freezeTask,stageImport}from'../../src/main/externalTasks';
import{projectId,sha,type StudioState}from'../../src/main/services';

const temporary:string[]=[];
afterEach(()=>temporary.splice(0).forEach(item=>fs.rmSync(item,{recursive:true,force:true})));
const wav=()=>{const data=Buffer.alloc(48_000),out=Buffer.alloc(44+data.length);out.write('RIFF',0);out.writeUInt32LE(36+data.length,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(24_000,24);out.writeUInt32LE(48_000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(data.length,40);data.copy(out,44);return out};

describe('native handoff timing fingerprint',()=>{
  it('embeds actual word/cue/media evidence and rejects changed timing before staging',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2-native-task-'));temporary.push(root);
    fs.mkdirSync(path.join(root,'.studio/alignment'),{recursive:true});fs.mkdirSync(path.join(root,'assets/audio'),{recursive:true});fs.mkdirSync(path.join(root,'assets/images'),{recursive:true});
    const audio=wav(),audioSha=sha(audio),image=Buffer.from('actual-owner-image'),imageSha=sha(image),script='One two three';
    fs.writeFileSync(path.join(root,'assets/audio/narration.wav'),audio);fs.writeFileSync(path.join(root,'assets/images/story.png'),image);
    fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({version:1,style:'B4',width:1080,height:1920,fps:30,voice:{path:'assets/audio/narration.wav',name:'Owner-imported WAV (speaker unverified)',id:'imported-wav:'+audioSha,user_override:'Owner imported this narration WAV; speaker identity not independently verified.'},shots:[],captions:[]}));
    const words={words:[{word:'One',start:0,end:.2},{word:'two',start:.25,end:.5},{word:'three',start:.55,end:.9}]},cues=[{start:0,end:.5,text:'One two'},{start:.55,end:.9,text:'three'}],wordBytes=Buffer.from(JSON.stringify(words)),cueBytes=Buffer.from(JSON.stringify(cues));
    fs.writeFileSync(path.join(root,'.studio/alignment/words.json'),wordBytes);fs.writeFileSync(path.join(root,'.studio/alignment/captions.json'),cueBytes);
    const state:StudioState={schema:'mode-b-studio-state-v1',project:{id:projectId(root),root,title:'Timed project',style:'B4',updatedAt:new Date().toISOString(),projectFile:path.join(root,'project.json')},brief:{topic:'Timing',language:'en',ratio:'9:16'},external:{},tasks:{},approvedScript:{sections:[{id:'a',text:script}],text:script,sha256:sha(script),revision:1,approvedAt:new Date().toISOString(),authoring:{creative_direction:{mood:'story'}}},voice:{path:'assets/audio/narration.wav',sha256:audioSha,generatedAt:new Date().toISOString(),duration:1,stale:false,origin:'IMPORTED_WAV'},alignment:{path:'.studio/alignment/words.json',captionsPath:'.studio/alignment/captions.json',audioSha256:audioSha,scriptSha256:sha(script),wordsSha256:sha(wordBytes),cuesSha256:sha(cueBytes),origin:'IMPORTED_WORDS',generatedAt:new Date().toISOString()},media:[{path:'assets/images/story.png',sha256:imageSha,kind:'image',shotId:'S1',layerId:'hero',rights:'owner',importedAt:new Date().toISOString()}]};
    fs.mkdirSync(path.join(root,'.studio'),{recursive:true});fs.writeFileSync(path.join(root,'.studio/state.json'),JSON.stringify(state));
    draftCaptionReview(root,[2,3]);approveCaptionReview(root,'Owner reviewed actual timing');
    const task=freezeTask(path.resolve('.'),root,'native');
    expect(task.prompt).toContain('"word": "One"');expect(task.prompt).toContain('"text": "One two"');expect(task.prompt).toContain('assets/images/story.png');expect(task.prompt).toContain('b4-opening-direction.md');
    fs.writeFileSync(path.join(root,'.studio/alignment/words.json'),JSON.stringify({words:[...words.words,{word:'changed',start:.91,end:.99}]}));
    const returned={schema:'mode-b-external-result-v1',project_id:state.project.id,task_id:task.id,revision:task.revision,input_sha256:task.inputSha256,stage:'native',payload:{manifest:{}}};
    expect(()=>stageImport(path.resolve('.'),root,'native',JSON.stringify(returned))).toThrow(/stale|changed/);
  });
});
