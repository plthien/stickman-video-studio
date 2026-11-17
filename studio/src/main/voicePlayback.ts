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
  return mediaUrl(root,voice.path)+'?sha='+info.sha256;
}
