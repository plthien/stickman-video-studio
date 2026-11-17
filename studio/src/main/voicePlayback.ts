/** Read-only access to the exact accepted narration WAV via studio-media. */
import fs from 'node:fs';
import {assertMediaRelative,inspectWavBuffer,mediaUrl,readState,resolveProjectFile} from './services.js';

export const ACCEPTED_NARRATION_PATH='assets/audio/narration.wav';

export function acceptedNarrationPlaybackUrl(root:string):string{
  const state=readState(root),voice=state.voice;
  if(!voice||voice.stale)throw new Error('Accepted narration is missing or stale.');
  if(voice.path!==ACCEPTED_NARRATION_PATH)
    throw new Error('Accepted narration path is not the canonical audio path.');
  const file=resolveProjectFile(root,assertMediaRelative(voice.path));
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())
    throw new Error('Accepted narration WAV is missing.');
  const info=inspectWavBuffer(fs.readFileSync(file));
  if(info.sha256!==voice.sha256)
    throw new Error('Accepted narration WAV changed; playback is blocked.');
  const url=new URL(mediaUrl(root,voice.path));
  // Keep path separators as URL separators. Encoding the entire relative path
  // into a single %2F-containing component is unsafe for Chromium media URLs.
  url.pathname='/'+voice.path;
  url.searchParams.set('sha',info.sha256);
  return url.toString();
}

/** Reverify bytes and immutable project identity for each browser media request.
 * Never compare raw URL strings: Chromium normalizes escaping and range URLs. */
export function verifyAcceptedNarrationRequest(root:string,requestUrl:string):string{
  const url=new URL(requestUrl);
  const voice=readState(root).voice;
  if(url.protocol!=='studio-media:'||!voice||voice.stale||
    url.pathname!=='/'+ACCEPTED_NARRATION_PATH||
    url.searchParams.size!==1||url.searchParams.get('sha')!==voice.sha256)
    throw new Error('NARRATION_PLAYBACK_REQUEST_DENIED');
  const canonical=new URL(acceptedNarrationPlaybackUrl(root));
  if(url.host!==canonical.host||url.pathname!==canonical.pathname||
    url.searchParams.get('sha')!==canonical.searchParams.get('sha'))
    throw new Error('NARRATION_PLAYBACK_REQUEST_DENIED');
  return ACCEPTED_NARRATION_PATH;
}
