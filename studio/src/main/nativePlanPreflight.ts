/** Pre-media technical validation. Core owns motion and B3 geometry; never fabricate files. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {nativeSkillRoot,sha,subprocessEnvironment,resolveProjectFile} from './services.js';
export type PlanReport={plan:'PASS'|'FAIL'|'NOT_VERIFIED';media:'NOT_VERIFIED';renderedPixels:'NOT_VERIFIED';error?:string;candidateSha:string;authoritySha:string};
const checked=new Map<string,PlanReport>(),inFlight=new Map<string,Promise<PlanReport>>();
const run=String.raw`
import fs from 'node:fs';
import {ROOT,hashFile,mediaPath} from './scripts/autopilot-core.mjs';
import {walkLayers,validateB3} from './scripts/b3-graphics.mjs';
import {prepareBStyleQuality} from './scripts/b-style-quality.mjs';
const {manifest:p,base,duration}=JSON.parse(fs.readFileSync(0,'utf8'));
try{
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
      if(l.type==='shadow'){number(l.w,'shadow width',1,10000);number(l.h,'shadow height',1,10000);}
      if(l.type==='text'&&(typeof l.text!=='string'||!l.text.trim()||l.text.length>400))throw Error('Text layer must be 1–400 characters');
      if(l.type==='line'&&(!Array.isArray(l.points)||l.points.length<2||l.points.some(pt=>!Array.isArray(pt)||pt.length!==2||pt.some(n=>!Number.isFinite(n)))))throw Error('Line requires finite [x,y] points');
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
console.log(JSON.stringify({plan:'PASS'}));
}catch(error){console.log(JSON.stringify({plan:'FAIL',error:error instanceof Error?error.message:String(error)}));}
`;
function inputs(appPath:string,root:string,manifest:unknown,duration:number,candidateSha=sha(JSON.stringify(manifest))){
  const skill=nativeSkillRoot(appPath).root;
  const input=JSON.stringify({manifest,base:root,duration});
  const core=['autopilot-core.mjs','b-style-quality.mjs','b-style-motion-geometry.mjs','b3-graphics.mjs'].map(name=>sha(fs.readFileSync(path.join(skill,'scripts',name))));
  const customFont=(manifest as {captionFont?:unknown})?.captionFont;
  const fontSha=typeof customFont==='string'?sha(fs.readFileSync(resolveProjectFile(root,customFont))):null;
  const authoritySha=sha(JSON.stringify({core,fontSha,validator:sha(run),bundledFont:sha(fs.readFileSync(path.join(skill,'assets/fonts/NotoSans.ttf')))}));
  const key=sha(JSON.stringify({skill,input,candidateSha,authoritySha}));
  return{skill,input,key,candidateSha,authoritySha};
}
export function cachedNativePlan(appPath:string,root:string,manifest:unknown,duration:number,candidateSha?:string){
  try{return checked.get(inputs(appPath,root,manifest,duration,candidateSha).key)??null;}catch{return null;}
}
export function inspectNativePlan(appPath:string,root:string,manifest:unknown,duration:number,candidateSha?:string):Promise<PlanReport>{
  let v:ReturnType<typeof inputs>;
  try{v=inputs(appPath,root,manifest,duration,candidateSha);}catch(e){return Promise.resolve({plan:'NOT_VERIFIED',media:'NOT_VERIFIED',renderedPixels:'NOT_VERIFIED',candidateSha:candidateSha??sha(JSON.stringify(manifest)),authoritySha:'',error:e instanceof Error?e.message:String(e)});}
  const existing=checked.get(v.key);if(existing)return Promise.resolve(existing);
  const active=inFlight.get(v.key);if(active)return active;
  const promise=new Promise<PlanReport>(resolve=>{
    const base={candidateSha:v.candidateSha,authoritySha:v.authoritySha,media:'NOT_VERIFIED' as const,renderedPixels:'NOT_VERIFIED' as const};
    let child:ReturnType<typeof spawn>;
    try{child=spawn(process.execPath,['--input-type=module','-e',run],{cwd:v.skill,env:subprocessEnvironment(process.execPath),windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch(e){resolve({...base,plan:'NOT_VERIFIED',error:String(e)});return;}
    let stdout='',stderr='',done=false;
    const finish=(report:PlanReport)=>{if(done)return;done=true;clearTimeout(timer);resolve(report);};
    const timer=setTimeout(()=>{child.kill();finish({...base,plan:'NOT_VERIFIED',error:'Original plan validator timed out'});},30000);
    child.stdout?.on('data',(c:Buffer)=>{stdout=(stdout+c.toString('utf8')).slice(-2*1024*1024);});
    child.stderr?.on('data',(c:Buffer)=>{stderr=(stderr+c.toString('utf8')).slice(-12000);});
    child.on('error',e=>finish({...base,plan:'NOT_VERIFIED',error:e.message}));
    child.stdin?.on('error',e=>finish({...base,plan:'NOT_VERIFIED',error:e.message}));
    child.on('close',code=>{
      try{
        if(code!==0)throw Error(stderr||'Original plan validator unavailable');
        const result=JSON.parse(stdout.trim());
        if(result.plan!=='PASS'&&result.plan!=='FAIL')throw Error('Invalid plan evidence');
        finish({...base,plan:result.plan,...(result.plan==='FAIL'?{error:String(result.error)}:{})});
      }catch(e){finish({...base,plan:'NOT_VERIFIED',error:e instanceof Error?e.message:String(e)});}
    });
    child.stdin?.end(v.input);
  }).then(report=>{
    if(report.plan!=='NOT_VERIFIED'){if(checked.size>=64)checked.clear();checked.set(v.key,report);}
    return report;
  }).finally(()=>inFlight.delete(v.key));
  inFlight.set(v.key,promise);return promise;
}
export async function nativePlanPreflight(appPath:string,root:string,manifest:unknown,duration:number,candidateSha?:string){
  const report=await inspectNativePlan(appPath,root,manifest,duration,candidateSha);
  if(report.plan!=='PASS')throw Error('NATIVE_PLAN_'+report.plan+' ['+report.candidateSha+']: '+report.error);
  return report;
}
