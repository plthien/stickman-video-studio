import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertLocalRoot,atomicJson,nativeSkillRoot,runProcess,sha,strictJson,writeState,type StudioState} from './services.js';

type CreateInput={parent:string;folder:string;title:string;topic:string;style:string;language:string;targetDuration?:number};
type Runner=typeof runProcess;
export async function createProjectStaged(appPath:string,input:CreateInput,options:{runner?:Runner;publishRecent?:(project:StudioState['project'])=>void;hooks?:{afterInit?:()=>void;afterManifest?:()=>void;afterState?:()=>void}}={}){
  if(!/^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,79}$/u.test(input.folder))throw new Error('Choose a simple project folder name.');
  const target=assertLocalRoot(path.resolve(input.parent,input.folder),false);if(fs.existsSync(target))throw new Error('Project folder already exists.');
  const staging=path.join(path.dirname(target),`.${path.basename(target)}.creating-${randomUUID()}`);if(fs.existsSync(staging))throw new Error('Project staging collision.');
  let promoted=false;
  try{
    const{cli}=nativeSkillRoot(appPath),result=await(options.runner??runProcess)(process.execPath,[cli,'init',staging,'--style',input.style],{cwd:path.dirname(cli),timeout:60_000});if(result.code!==0)throw new Error(result.stderr||result.stdout||'Native project initialization failed.');options.hooks?.afterInit?.();
    const projectFile=path.join(staging,'project.json'),manifest=strictJson(fs.readFileSync(projectFile,'utf8'))as Record<string,unknown>,voice=manifest.voice as Record<string,unknown>|undefined;if(!voice)throw new Error('Native initializer did not create voice configuration.');manifest.width=1080;manifest.height=1920;voice.path='assets/audio/narration.wav';atomicJson(projectFile,manifest);options.hooks?.afterManifest?.();
    const finalProjectFile=path.join(target,'project.json'),summary={id:sha(target.toLowerCase()).slice(0,24),root:target,title:input.title.trim(),style:input.style,updatedAt:new Date().toISOString(),projectFile:finalProjectFile};
    const state:StudioState={schema:'mode-b-studio-state-v1',project:summary,brief:{topic:input.topic,language:input.language,ratio:'9:16',targetDuration:input.targetDuration},external:{},tasks:{},nano:{endpoint:'http://127.0.0.1:3901'},imports:[]};writeState(staging,state);options.hooks?.afterState?.();
    fs.renameSync(staging,target);promoted=true;const root=fs.realpathSync(target);
    let registrationWarning:string|undefined;try{options.publishRecent?.(summary)}catch(error){registrationWarning='Project created, but recent-project registration failed: '+(error as Error).message;atomicJson(path.join(root,'.studio','recent-registration-pending.json'),{project:summary,error:(error as Error).message,createdAt:new Date().toISOString()})}
    return{root,state,registrationWarning};
  }catch(error){if(!promoted&&fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});throw error}
}
