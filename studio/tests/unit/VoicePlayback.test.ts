// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {acceptedNarrationPlaybackUrl,verifyAcceptedNarrationRequest,serveAcceptedNarration} from '../../src/main/voicePlayback';
import {assertMediaRelative,readState,writeState,sha} from '../../src/main/services';
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
  it('PB-01/02: the canonical protocol response is a decodable WAV with byte-range support',async()=>{
    const {root,voicePath}=fixture(),url=acceptedNarrationPlaybackUrl(root);
    const actual=fs.readFileSync(path.join(root,voicePath));
    const full=serveAcceptedNarration(root,url,null);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/wav');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await full.arrayBuffer())).toEqual(actual);
    const partial=serveAcceptedNarration(root,url,'bytes=0-43');
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 0-43/'+actual.length);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(actual.subarray(0,44));
    const suffix=serveAcceptedNarration(root,url,'bytes=-2');
    expect(suffix.status).toBe(206);
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(actual.subarray(-2));
    expect(serveAcceptedNarration(root,url,'bytes=999999999-').status).toBe(416);
  });
  it('PB-03/04/06: only current project and current SHA may fetch media',()=>{
    const {root,voicePath}=fixture(),url=acceptedNarrationPlaybackUrl(root);
    const wrongProject=url.replace(new URL(url).hostname,'a'.repeat(24));
    expect(()=>serveAcceptedNarration(root,wrongProject,null)).toThrow(/DENIED/);
    expect(()=>serveAcceptedNarration(root,url.replace('sha=','hash='),null)).toThrow(/DENIED/);
    const oldBytes=fs.readFileSync(path.join(root,voicePath)),nextBytes=Buffer.from(oldBytes);
    nextBytes[nextBytes.length-1]^=1;
    fs.writeFileSync(path.join(root,voicePath),nextBytes);
    expect(()=>serveAcceptedNarration(root,url,null)).toThrow(/changed|DENIED/);
    const state=readState(root);state.voice!.sha256=sha(nextBytes);writeState(root,state);
    const current=acceptedNarrationPlaybackUrl(root);
    expect(current).not.toBe(url);
    expect(()=>serveAcceptedNarration(root,url,null)).toThrow(/DENIED/);
    expect(serveAcceptedNarration(root,current,null).status).toBe(200);
  });

});
