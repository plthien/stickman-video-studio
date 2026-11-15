// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {bindAcceptedNarration,readState} from '../../src/main/services';
import {importApprovedWav} from '../../src/main/voiceMedia';
import {cleanup,fixture,wav} from './SixIssueFixtures';
afterEach(cleanup);
describe('original init voice path matches actual accepted narration, with no fixture shortcut',()=>{
  it('binds an original Core scaffold path to owner-imported WAV and preserves B4 identity/timing',()=>{
    const {root}=fixture({style:'B4'}),file=path.join(root,'project.json');
    const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    // The real original autopilot init writes narration.wav; reproduce its mismatch.
    manifest.voice={path:'narration.wav',name:'Brian',id:'original-voice',user_override:'Owner narrator',lead:0.5,tail:1,trim_start:0};
    fs.writeFileSync(file,JSON.stringify(manifest));
    const incoming=path.join(root,'incoming.wav');fs.writeFileSync(incoming,wav(2));
    const imported=importApprovedWav(root,incoming);
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    expect(saved.voice).toMatchObject({path:'assets/audio/narration.wav',name:'Brian',id:'original-voice',user_override:'Owner narrator',lead:0.5,tail:1,trim_start:0});
    expect(imported.path).toBe(saved.voice.path);
    expect(imported.sha256).toBe(readState(root).voice?.sha256);
    expect(fs.existsSync(path.join(root,saved.voice.path))).toBe(true);
    bindAcceptedNarration(root,imported.path);
    expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(saved);
  });
  it('rejects a malformed original native project instead of creating fake voice fields',()=>{
    const {root}=fixture(),file=path.join(root,'project.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    delete manifest.voice;fs.writeFileSync(file,JSON.stringify(manifest));
    expect(()=>bindAcceptedNarration(root,'assets/audio/narration.wav')).toThrow(/voice/i);
  });
});