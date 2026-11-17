// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {acceptedNarrationPlaybackUrl} from '../../src/main/voicePlayback';
import {assertMediaRelative,readState,writeState} from '../../src/main/services';
import {cleanup,fixture} from './SixIssueFixtures';

afterEach(cleanup);
describe('accepted narration playback, no unapproved media',()=>{
  it('issues a project-scoped audio URL only for the current SHA-verified WAV',()=>{
    const {root}=fixture();
    const url=acceptedNarrationPlaybackUrl(root);
    expect(url).toMatch(/^studio-media:\/\/[^/]+\/assets%2Faudio%2Fnarration\.wav\?sha=[a-f0-9]{64}$/);
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
    fs.unlinkSync(file);
    expect(()=>acceptedNarrationPlaybackUrl(root)).toThrow(/missing/);
  });
});
