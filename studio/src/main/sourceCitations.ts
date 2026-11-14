import path from 'node:path';

const forbiddenKeys = new Set(['__proto__','prototype','constructor']);
const controls = /[\u0000-\u001f\u007f]/;
const proseControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const schemes = /(?:javascript|file|data|vbscript):/i;
const htmlMarkup = /<\/?[a-z][^>]*>/i;
const urlInText = /https?:\/\/[^\s<>"']+/gi;
function publicCitationUrl(input: string) {
  if (input.length > 2048 || controls.test(input) || schemes.test(input) || htmlMarkup.test(input)) throw new Error('Unsafe research citation URL.');
  let url:URL;try{url=new URL(input);}catch{throw new Error('Invalid research citation URL.');}
  if (!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password) throw new Error('Only public HTTP(S) citations without credentials are permitted.');
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
  if (host==='localhost'||host==='0.0.0.0'||host==='::1'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.lan')||host.endsWith('.test')||!host.includes('.')||host.startsWith('127.')||host.startsWith('10.')||host.startsWith('192.168.')||host.startsWith('169.254.')||host.startsWith('172.')&&Number(host.split('.')[1])>=16&&Number(host.split('.')[1])<=31||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':')) throw new Error('Research URLs must use public DNS hosts (not IP/localhost/private).');
  return input;
}
function safeText(value: unknown, limit=2048): string {
  if (typeof value!=='string'||!value.trim()||value.length>limit||controls.test(value)||schemes.test(value)||htmlMarkup.test(value)) throw new Error('Invalid research citation text.');
  for (const match of value.match(urlInText)??[]) publicCitationUrl(match.replace(/[),.;]+$/,''));
  return value;
}
export function validateAuthoring(value: unknown): Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Creative authoring must be an object.');
  const object=value as Record<string,unknown>;
  function inspect(data:unknown,depth=0):void {
    if(depth>40)throw new Error('Creative authoring nesting too deep.');
    if(typeof data==='string'){if(data.length>65536||proseControls.test(data))throw new Error('Invalid creative prose.');return;}
    if(Array.isArray(data)){if(data.length>10000)throw new Error('Creative array is too large.');data.forEach(item=>inspect(item,depth+1));return;}
    if(data&&typeof data==='object'){const row=data as Record<string,unknown>;for(const [key,item] of Object.entries(row)){if(forbiddenKeys.has(key))throw new Error('Forbidden authoring key.');inspect(item,depth+1);}}
  }
  inspect(object);
  if(object.source_references!==undefined){
    if(!Array.isArray(object.source_references)||object.source_references.length>128)throw new Error('source_references must be a bounded array.');
    for(const ref of object.source_references){
      if(typeof ref==='string'){safeText(ref);continue;}
      if(!ref||typeof ref!=='object'||Array.isArray(ref))throw new Error('Invalid citation record.');
      const record=ref as Record<string,unknown>,keys=Object.keys(record);
      if(keys.some(key=>!['title','url','note'].includes(key))||typeof record.url!=='string')throw new Error('Citation supports only title, url and note.');
      publicCitationUrl(record.url);
      if(record.title!==undefined)safeText(record.title,512);
      if(record.note!==undefined)safeText(record.note,2048);
    }
  }
  return object;
}
export function rejectNativeUnsafePaths(value:unknown):void {
  const visit=(item:unknown,key=''):void=>{
    if(Array.isArray(item)){item.forEach(part=>visit(part,key));return;}
    if(item&&typeof item==='object'){
      for(const [child,value] of Object.entries(item as Record<string,unknown>)){if(forbiddenKeys.has(child))throw new Error('Forbidden native key.');visit(value,child);}
      return;
    }
    if(typeof item!=='string')return;
    if(controls.test(item)||schemes.test(item))throw new Error('Unsafe native field.');
    if(['path','file','source'].includes(key)){
      if(item.startsWith('@b1/')&&key==='path'&&!item.includes('..'))return;
      const normalized=item.replaceAll('\\','/');
      if(!normalized||path.isAbsolute(item)||path.win32.isAbsolute(item)||/^[a-z][a-z0-9+.-]*:/i.test(item)||normalized.startsWith('//')||normalized.split('/').includes('..')||normalized.split('/').includes('.')||normalized.split('/').some(p=>!p))throw new Error('Native media must use safe project-local paths.');
    }
  };
  visit(value);
}
