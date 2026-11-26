/** Explicit output contract; no semantic parsing, segmentation or creative crop. */
import fs from 'node:fs';
import {resolveProjectFile,sha} from './services.js';
import {imageRequirementsForTarget,type ImageRequirementTarget} from './imageRequirements.js';
export interface AssetOutput {composition:'composed'|'isolated';background:'opaque'|'transparent';preparation:'preserve'|'border_key';registration:string;key_rgb?:number[]}
export interface DecodedArtwork {png:Buffer;width:number;height:number;bgra?:Buffer;encodeBgra?:(pixels:Buffer)=>Buffer}
export type AssetDecoder=(bytes:Buffer)=>DecodedArtwork;
export interface AssetPreparationReceipt {sourceSha:string;preparedSha:string;output:AssetOutput;width:number;height:number;transparentPixels:number;visiblePixels:number}
export function assertAssetOutput(o:AssetOutput){
  if(!o||!['composed','isolated'].includes(o.composition)||!['opaque','transparent'].includes(o.background)||!['preserve','border_key'].includes(o.preparation)||typeof o.registration!=='string'||!o.registration.trim()||o.registration.length>2000)throw Error('ASSET_OUTPUT_INVALID');
  if(o.preparation==='border_key'){
    if(o.background!=='transparent'||!Array.isArray(o.key_rgb)||o.key_rgb.length!==3||o.key_rgb.some(x=>!Number.isInteger(x)||x<0||x>255))throw Error('ASSET_KEY_BACKGROUND_INVALID');
  }else if(o.key_rgb!==undefined)throw Error('ASSET_UNEXPECTED_KEY_RGB');
}
export function assetOutputForTarget(rows:unknown[],target:ImageRequirementTarget):AssetOutput|undefined{
  const effective=imageRequirementsForTarget(rows,target).effective;
  const declared=effective.flatMap(row=>row.source&&typeof row.source==='object'&&'output'in row.source?[(row.source as {output:AssetOutput}).output]:[]);
  for(const o of declared)assertAssetOutput(o);
  if(new Set(declared.map(x=>JSON.stringify(x))).size>1)throw Error('ASSET_OUTPUT_CONFLICT');
  return declared[0];
}
export function assetOutputPrompt(o:AssetOutput){
  return 'EXPLICIT ASSET OUTPUT: '+JSON.stringify(o)+(o.preparation==='border_key'?' — exact solid RGB key background connected to all borders; margin around subject, no key color in artwork; do not crop or reposition.':' — preserve requested background and registration.');
}
export function verifyRatio(d:DecodedArtwork,ratio:string){
  const [w,h]=ratio.split(':').map(Number);
  if(!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1||!w||!h||Math.abs(d.width*h-d.height*w)>Math.max(w,h))throw Error('ASSET_ORIENTATION_MISMATCH '+ratio);
}
function pixels(d:DecodedArtwork){
  if(!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1||d.width*d.height>16777216||!Buffer.isBuffer(d.bgra)||d.bgra.length!==d.width*d.height*4)throw Error('ASSET_PIXEL_DECODE_REQUIRED');
  return d.bgra;
}
export function verifyArtwork(d:DecodedArtwork,o:AssetOutput){
  assertAssetOutput(o);
  if(!Buffer.isBuffer(d.png)||d.png.length<33||d.png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('ASSET_PNG_REQUIRED');
  const b=pixels(d);let transparentPixels=0,visiblePixels=0,opaque=0;
  for(let i=3;i<b.length;i+=4){if(b[i]===0)transparentPixels++;else visiblePixels++;if(b[i]===255)opaque++;}
  if(!visiblePixels)throw Error('ASSET_EMPTY_ARTWORK');
  if(o.background==='transparent'&&!transparentPixels)throw Error('ASSET_TRANSPARENT_BACKGROUND_REQUIRED');
  if(o.background==='opaque'&&opaque!==b.length/4)throw Error('ASSET_OPAQUE_BACKGROUND_REQUIRED');
  return{transparentPixels,visiblePixels};
}
export function prepareArtwork(source:Buffer,o:AssetOutput,decode:AssetDecoder){
  assertAssetOutput(o);let d=decode(source);
  if(o.preparation==='border_key'){
    const input=pixels(d),b=Buffer.from(input),w=d.width,h=d.height,n=w*h,[r,g,blue]=o.key_rgb!;
    const key=(i:number)=>b[i*4]===blue&&b[i*4+1]===g&&b[i*4+2]===r&&b[i*4+3]===255;
    const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
    const enqueue=(i:number)=>{if(!seen[i]&&key(i)){seen[i]=1;queue[tail++]=i;}};
    for(let x=0;x<w;x++){if(!key(x)||!key((h-1)*w+x))throw Error('ASSET_KEY_BORDER_NOT_UNIFORM');enqueue(x);enqueue((h-1)*w+x);}
    for(let y=0;y<h;y++){if(!key(y*w)||!key(y*w+w-1))throw Error('ASSET_KEY_BORDER_NOT_UNIFORM');enqueue(y*w);enqueue(y*w+w-1);}
    while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);if(x>0)enqueue(i-1);if(x<w-1)enqueue(i+1);if(y>0)enqueue(i-w);if(y<h-1)enqueue(i+w);}
    if(!tail||tail===n||!d.encodeBgra)throw Error('ASSET_KEY_PREPARATION_UNSUITABLE');
    for(let i=0;i<n;i++){if(key(i)&&!seen[i])throw Error('ASSET_KEY_COLOR_INSIDE_ARTWORK');if(seen[i])b.fill(0,i*4,i*4+4);}
    const encoded=d.encodeBgra(b);const result=decode(encoded);
    if(result.width!==w||result.height!==h||!pixels(result).equals(b))throw Error('ASSET_KEY_REGISTRATION_OR_PIXELS_CHANGED');
    d={...result,png:encoded};
  }
  const evidence=verifyArtwork(d,o);
  return{decoded:d,receipt:{sourceSha:sha(source),preparedSha:sha(d.png),output:o,width:d.width,height:d.height,...evidence} satisfies AssetPreparationReceipt};
}
export function assertPreparedLineage(root:string,output:AssetOutput,source:{path:string;sha256:string}|undefined,receipt:AssetPreparationReceipt|undefined,preparedSha:string){
  if(!source||!receipt||receipt.sourceSha!==source.sha256||receipt.preparedSha!==preparedSha||JSON.stringify(receipt.output)!==JSON.stringify(output)||sha(fs.readFileSync(resolveProjectFile(root,source.path)))!==source.sha256)throw Error('ASSET_PREPARATION_LINEAGE_INVALID');
}
