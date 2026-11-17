// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {acceptedNarrationPlaybackUrl,verifyAcceptedNarrationRequest} from '../../src/main/voicePlayback';
import {assertMediaRelative,readState,writeState} from '../../src/main/services';
import {cleanup,fixture} from './SixIssueFixtures';

afterEach(cleanup);
describe('accepted narration playback, no unapproved media',()=>{
  it('issues a project-scoped audio URL only for the current SHA-verified WAV',()=>{
    const {root}=fixture();
    const url=acceptedNarrationPlaybackUrl(root);
    expect(url).toMatch(/^studio-media:\/\/[^/]+\/assets\/audio\/narration\.wav\?sha=[a-f0-9]{64}$/);
    expect(verifyAcceptedNarrationRequest(root,url)).toBe('assets/audio/narration.wav');
    expect(()=>verifyAcceptedNarrationRequest(root,url.replace('sha=','hash='))).toThrow(/DENIED/);
    expect(()=>verifyAcceptedNarrationRequest(root,url+'&sha=duplicate')).toThrow(/DENIED/);
    expect(()=>verifyAcceptedNarrationRequest(root,url.replace('assets/audio/','assets/other/'))).toThrow(/DENIED/);
    expect(url).toContain(readState(root).voice!.sha256);
    expect(assertMediaRelative('assets/audio/narration.wav')).toBe('assets/audio/narration.wav');
    expect(()=>assertMediaRelative('assets/audio/unapproved.wav')).toThrow(/allowlisted/);
    expect(()=>assertMediaRelative('../assets/audio/narration.wav')).toThrow(/Invalid/);
  });
  it('blocks stale, missing, tampered or inconsistent accepted narration',()=>{
    const {root,voicePath}=fixture(),state=readState(root);
    state.voice!.stale=true;writeState(root,state);
    expect(()=>acceptedNarrationPlaybackUrl(root)).toThrow(/stale/);
    state.voice!.stale=false;writeState(root,state);
    const file=path.join(root,voicePath);
    const wav=fs.readFileSync(file);wav[wav.length-1]^=1;fs.writeFileSync(file,wav);
    expect(()=>acceptedNarrationPlaybackUrl(root)).toThrow(/changed/);
    const priorUrl=new URL('studio-media://'+readState(root).project.id+'/assets/audio/narration.wav?sha='+readState(root).voice!.sha256);
    expect(()=>verifyAcceptedNarrationRequest(root,priorUrl.toString())).toThrow(/changed/);
    fs.unlinkSync(file);
    expect(()=>acceptedNarrationPlaybackUrl(root)).toThrow(/missing/);
  });
});
