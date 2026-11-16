import fs from 'node:fs';
import path from 'node:path';
import { nativeSkillRoot, sha, type Stage } from './services.js';

export type ExternalOperation = 'author'|'review'|'correct'|'recheck'|'media-review';
export type Disposition = 'KEEP'|'MOVE_TO_NATIVE'|'STUDIO_ONLY'|'AGENT_ONLY';
export interface AuthoritySource {
  path:string; sha256:string; extractionSha256:string; extractionRevision:string;
  applicability:string[]; disposition:Disposition; headings:string[]; text:string;
}
export const AUTHORITY_EXTRACTION_REVISION = 'stage-exact-v2';

const STYLE:Record<string,string>={B1:'b1-minimal-handdrawn.md',B2:'b2-colorful-handdrawn.md',B3:'b3-television.md',B4:'b4-survival-storytelling.md'};

const STYLE_SCRIPT_HEADINGS:Record<string,string[]>={
  B1:['## Visual language','## Stick-figure features and acting — B1 only','## Rhythm and sound','## Acceptance'],
  B2:['## Resolved defaults','## Scene and motion decisions'],
  B3:['## Reference fidelity without copying a story','## Featured pets: appealing characters, not stock symbols','## Motion planning: restrained is not frozen','## Typography, voice and scene resources','## Capability and acceptance gates'],
  B4:['## Required portable style lock','## Fixed visual language, variable story','## Story-led horror visibility gate','## Generation and anti-drift gates','## Narration, motion and finishing']
};
const SCRIPT_PLAN:Record<string,string[]>={
  'SKILL.md':['## Two modes, one Skill'],
  'references/autopilot.md':['## Independent B-style settings'],
  'references/autopilot-production-qa.md':['## Plan from meaning and actual narration','## First 30 seconds: picture, sound and copy together','## Meaningful motion, not filler','## Clear screenshots and content-matched graphics','## Natural captions and semantic sound'],
  'references/autopilot-sound-system.md':['## Common B sound contract','## Universal scene/beat sound script']
};
const B4_SCRIPT:Record<string,string[]>={
  'references/b4-opening-direction.md':['## Opening design before generation','## Text has a dramatic job','## Sound and picture must resolve together'],
  'references/b4-audio-direction.md':['## Fixed main narrator','## Automatic character casting and performance','## Automatic SFX direction and source gate']
};

function selectSections(full:string,headings:string[],relative:string){
  if(!headings.length)return full;
  const lines=full.replace(/\r\n/g,'\n').split('\n');
  return headings.map(heading=>{
    const indices=lines.flatMap((line,i)=>line.trim()===heading?[i]:[]);
    if(indices.length!==1)throw new Error('REBUILD_REQUIRED: unverified authority extraction selector: '+relative+' '+heading);
    const at=indices[0],level=(heading.match(/^#+/)??[''])[0].length;
    let end=lines.length;
    for(let j=at+1;j<lines.length;j++){
      const match=lines[j].match(/^(#{1,6})\s+/);
      if(match&&match[1].length<=level){end=j;break;}
    }
    const section=lines.slice(at,end).join('\n').trim();
    if(section.length<heading.length+30)throw new Error('REBUILD_REQUIRED: empty authority extraction: '+relative+' '+heading);
    return section;
  }).join('\n\n');
}
function source(appPath:string,relative:string,style:string,stage:Stage,operation:ExternalOperation,headings:string[],disposition:Disposition):AuthoritySource{
  const target=path.join(nativeSkillRoot(appPath).root,relative);
  if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw new Error('Required Mode B authority is missing: '+relative);
  const bytes=fs.readFileSync(target),full=bytes.toString('utf8');
  const text=selectSections(full,headings,relative);
  if(!text.trim())throw new Error('REBUILD_REQUIRED: required authority is empty: '+relative);
  return {path:relative,sha256:sha(bytes),extractionSha256:sha(text),
    extractionRevision:AUTHORITY_EXTRACTION_REVISION,applicability:[style,stage,operation],
    disposition,headings,text};
}
export function compileAuthority(appPath:string,style:string,stage:Stage,operation:ExternalOperation){
  const selected=STYLE[style];
  if(!selected)throw new Error('External manual workflow supports B1–B4 only.');
  const specs:Array<[string,string[],Disposition]>=[];
  if(stage==='script'){
    specs.push(['SKILL.md',SCRIPT_PLAN['SKILL.md'],'KEEP']);
    specs.push(['references/'+selected,STYLE_SCRIPT_HEADINGS[style],'KEEP']);
    specs.push(['references/autopilot.md',SCRIPT_PLAN['references/autopilot.md'],'KEEP']);
    specs.push(['references/autopilot-production-qa.md',SCRIPT_PLAN['references/autopilot-production-qa.md'],'KEEP']);
    specs.push(['references/autopilot-sound-system.md',SCRIPT_PLAN['references/autopilot-sound-system.md'],'KEEP']);
    if(style==='B4')for(const [relative,headings] of Object.entries(B4_SCRIPT))specs.push([relative,headings,'KEEP']);
  }else{
    specs.push(['SKILL.md',SCRIPT_PLAN['SKILL.md'],'KEEP']);
    specs.push(['references/'+selected,[],'KEEP']);
    specs.push(['references/autopilot.md',[],'KEEP']);
    specs.push(['references/autopilot-runtime.md',[],'KEEP']);
    specs.push(['references/autopilot-production-qa.md',[],'KEEP']);
    specs.push(['references/autopilot-sound-system.md',[],'KEEP']);
    if(style==='B4'){
      specs.push(['references/b4-opening-direction.md',[],'KEEP']);
      specs.push(['references/b4-audio-direction.md',[],'KEEP']);
      specs.push(['references/b4-repeatability-check.md',[],'KEEP']);
    }
  }
  const sources=specs.map(([relative,headings,disposition])=>source(appPath,relative,style,stage,operation,headings,disposition));
  const rules=[
    'Use the exact normative text below. User-approved source choices take precedence only where the original Mode B contract allows.',
    'Keep project-specific narrative causality, character/world identity, recurring props and approved creative decisions.',
    'Do not invent actual media, executed CLI commands, voice samples, aligned timings, citations or acceptance evidence.',
    'Authoring/review may plan actions and sound; Studio alone executes providers, native CLI, cache, media validation and approvals.'
  ];
  if(operation==='review'||operation==='recheck'||operation==='media-review')
    rules.push('Review independently against the frozen original task and exact evidence; distinguish observed, inferred and not verified.');
  if(operation==='correct')
    rules.push('Return a complete importable artifact. Change only authorized targets/paths; preserve everything outside scope exactly.');
  return {version:AUTHORITY_EXTRACTION_REVISION,style,stage,operation,rules,sources,
    matrix:{KEEP:sources.map(item=>item.path),
      MOVE_TO_NATIVE:stage==='script'?['references/autopilot-runtime.md','native project.json contract','native CLI validation and production approval']:[],
      STUDIO_ONLY:['provider HTTP/credentials','CLI execution','cache internals','local media filesystem publication','owner approvals'],
      AGENT_ONLY:['agent tool selection','agent terminal commands','automatic browser/provider operation']}};
}
