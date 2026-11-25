/** Pre-media technical validation. Core owns motion and B3 geometry; never fabricate files. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {nativeSkillRoot,sha,subprocessEnvironment} from './services.js';
const checked=new Map<string,true>();
const run=String.raw`
import fs from 'node:fs';
import {ROOT,hashFile,mediaPath} from './scripts/autopilot-core.mjs';
import {walkLayers,validateB3} from './scripts/b3-graphics.mjs';
import {prepareBStyleQuality} from './scripts/b-style-quality.mjs';
const {manifest:p,base,duration}=JSON.parse(fs.readFileSync(0,'utf8'));
const number=(v,label,min=0,max=Infinity)=>{
  if(!Number.isFinite(v)||v<min||v>max)throw Error('Invalid '+label);
};
// Structural subset of the original loadProject contract, independent of media existence.
// This is not a motion algorithm or a substitute for loadProject.
number(duration,'duration',.01,86400);
number(p.width,'width',256,3840);number(p.height,'height',256,3840);number(p.fps,'fps',12,60);
if(![p.width,p.height,p.fps].every(Number.isInteger)||p.width%2||p.height%2)throw Error('Even integer dimensions and integer fps required');
if(!Array.isArray(p.shots)||!p.shots.length)throw Error('Shots required');
const types=new Set(['image','pose','text','line','arrow','underline']);
if(p.style==='B4')types.add('shadow');
if(p.style==='B3')for(const type of ['group','path','rect','ellipse'])types.add(type);
let end=0;
for(const shot of p.shots){
  try{
    number(shot.start,'shot start');number(shot.end,'shot end');
    if(Math.abs(shot.start-end)>.002||shot.end<=shot.start)throw Error('gap/overlap or nonpositive duration');
    end=shot.end;
    const span=shot.end-shot.start;
    if(p.style==='B4'&&span>3.000001&&!(shot.kind==='exceptional_hold'&&typeof shot.user_approval==='string'&&shot.user_approval.trim()&&typeof shot.reason==='string'&&shot.reason.trim()))throw Error('B4 narrative shots must be at most 3 seconds; exceptional holds require user_approval and reason');
    if(!Array.isArray(shot.layers)||!shot.layers.length)throw Error('No layers');
    if(p.style==='B3')validateB3(shot.layers,p.television);
    for(const l of walkLayers(shot.layers)){
      if(!types.has(l.type))throw Error('Unknown layer '+l.type);
      const title=p.style==='B4'&&l.type==='text'&&['setup','payoff'].includes(l.b4Hook);
      if(p.style!=='B3'&&['children','commands','radius','fill','stroke',...(!title?['pivotX','pivotY','scaleX','scaleY']:[])].some(k=>l[k]!==undefined))throw Error('B3 artwork properties cannot be used in another style');
      if(l.b4Hook!==undefined&&!title)throw Error('Fixed B4 hook typography belongs to B4 text only');
      if(l.type==='pose'&&(p.style!=='B1'||!Number.isInteger(l.pose)||l.pose<0||l.pose>2))throw Error('Invalid B1 pose atlas index or style');
      for(const k of ['x','y','w','h','size','angle','alpha','progress','lineWidth'])if(l[k]!==undefined)number(l[k],k,-10000,10000);
      if(l.w!==undefined&&l.w<=0||l.size!==undefined&&l.size<=0)throw Error('Layer dimensions must be positive');
      number(l.from??0,'layer from',0,span);number(l.to??span,'layer to',l.from??0,span);
      let previous=-1;
      for(const key of l.keys||[]){
        number(key.t,'key time',0,span);
        if(key.t<=previous)throw Error('Key times must increase');
        previous=key.t;
        for(const k of Object.keys(key)){
          if(!['t','x','y','w','angle','alpha','progress',...(p.style==='B3'||title?['scaleX','scaleY']:[])].includes(k))throw Error('Unsupported keyframe property: '+k);
          number(key[k],k,-10000,10000);
          if(k==='w'&&key[k]<=0||['alpha','progress'].includes(k)&&(key[k]<0||key[k]>1))throw Error('Invalid size/opacity/progress keyframe');
          if(['scaleX','scaleY'].includes(k)&&(key[k]<=0||key[k]>100))throw Error('Invalid artwork scale keyframe');
        }
      }
    }
  }catch(e){throw Error('Shot '+shot.id+': '+e.message);}
}
if(Math.abs(end-duration)>.06)throw Error('Shots do not cover accepted timeline duration');
// Uses the exact original inactivity/geometry implementation, including B4 exclusion.
prepareBStyleQuality({...p,base,rangeEnd:duration},{root:ROOT,hashFile,mediaPath});
console.log(JSON.stringify({plan:'PASS',media:'NOT_VERIFIED',renderedPixels:'NOT_VERIFIED'}));
`;
export function nativePlanPreflight(appPath:string,root:string,manifest:unknown,duration:number){
  const skill=nativeSkillRoot(appPath).root;
  const input=JSON.stringify({manifest,base:root,duration});
  const core=['autopilot-core.mjs','b-style-quality.mjs','b-style-motion-geometry.mjs','b3-graphics.mjs'].map(name=>sha(fs.readFileSync(path.join(skill,'scripts',name))));
  // Custom font bytes may change independently; never cache this case.
  const customFont=(manifest as {captionFont?:unknown})?.captionFont;
  const key=sha(JSON.stringify({skill,input,core}));
  if(!customFont&&checked.has(key))return {plan:'PASS' as const,media:'NOT_VERIFIED' as const,renderedPixels:'NOT_VERIFIED' as const};
  const result=spawnSync(process.execPath,['--input-type=module','-e',run],{cwd:skill,env:subprocessEnvironment(process.execPath),input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr.trim()||'Original plan validation could not execute');
  const report=JSON.parse(result.stdout.trim());
  if(report.plan!=='PASS'||report.media!=='NOT_VERIFIED'||report.renderedPixels!=='NOT_VERIFIED')throw Error('Invalid plan evidence');
  if(!customFont){if(checked.size>=32)checked.clear();checked.set(key,true);}
  return {plan:'PASS' as const,media:'NOT_VERIFIED' as const,renderedPixels:'NOT_VERIFIED' as const};
}
