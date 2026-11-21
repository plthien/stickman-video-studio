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

/** Serve the byte-verified WAV directly instead of delegating to file://
 * net.fetch, whose Range/MIME behavior differs by Electron runtime. */
export function serveAcceptedNarration(root:string,requestUrl:string,range:string|null,method='GET'):Response{
  const relative=verifyAcceptedNarrationRequest(root,requestUrl);
  const file=resolveProjectFile(root,relative),bytes=fs.readFileSync(file),info=inspectWavBuffer(bytes);
  if(info.sha256!==readState(root).voice?.sha256)
    throw new Error('NARRATION_PLAYBACK_REQUEST_DENIED: WAV SHA changed.');
  const size=bytes.length;
  let first=0,last=size-1,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if(!match||(!match[1]&&!match[2]))
      return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    if(match[1]){
      first=Number(match[1]);
      last=match[2]?Number(match[2]):last;
    }else{
      const suffix=Number(match[2]);first=Math.max(0,size-suffix);
    }
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>=size||first>last||last<0)
      return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    last=Math.min(size-1,last);status=206;
  }
  const headers=new Headers({
    'Content-Type':'audio/wav',
    'Accept-Ranges':'bytes',
    'Content-Length':String(last-first+1),
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  if(status===206)headers.set('Content-Range','bytes '+first+'-'+last+'/'+size);
  return new Response(method==='HEAD'?null:Uint8Array.from(bytes.subarray(first,last+1)),{status,headers});
}
