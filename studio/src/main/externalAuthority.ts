import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { nativeSkillRoot, sha, type Stage } from './services.js';

export type ExternalOperation = 'author'|'review'|'correct'|'recheck'|'media-review';
export type Disposition = 'KEEP'|'MOVE_TO_NATIVE'|'STUDIO_ONLY'|'AGENT_ONLY';
export interface AuthoritySource {
  path:string; sha256:string; extractionSha256:string; extractionRevision:string;
  applicability:string[]; disposition:Disposition; headings:string[]; text:string; locations?:string[];
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

/** Original Core blob identities; Script Author must be explicitly re-reviewed
 * if ANY installed source bytes change. Native/lifecycle extraction remains unchanged.
 * Ranges are 1-based inclusive source line spans, preserving complete Markdown blocks.
 */
const SCRIPT_AUTHOR_BLOB_SHA1:Record<string,string>={
  'SKILL.md':'d49ecae27df011f1907eb45abd94123da1c6ec7b',
  'references/autopilot.md':'c0f8eb0b7a00448cbc851fa276ad40c68ae3d06f',
  'references/autopilot-production-qa.md':'9e15738e6e54b95b6d9eb968575ecf6cddee9d8f',
  'references/autopilot-sound-system.md':'3c3b9dbeed43b9cf229e617315359c7d0e7317a1',
  'references/b1-minimal-handdrawn.md':'1a2b0abadff0a8ecedc50e4f8af3f04a5dcfdb73',
  'references/b2-colorful-handdrawn.md':'f2b38416743c166353324d45f10396dcdb9fc247',
  'references/b3-television.md':'7ab242cf7751bf72de477fb53179cb62f1b58b64',
  'references/b4-survival-storytelling.md':'271770dbe59f3fb74823012dae9a8c8363f1e944',
  'references/b4-opening-direction.md':'8f2283ae23ceb52b0afc26a5eefce4cf0203c16d',
  'references/b4-audio-direction.md':'9cada12dd379ba06f1a44311764a8bfc1b64b294'
};
/** Exact source spans selected by human review against the pinned original.
 * Entire lines/paragraphs, subordinate bullets, conditions and exceptions remain
 * intact; no mid-sentence excerpt is permitted. Mixed-stage paragraphs retain
 * original wording; Script Author is explicitly told to defer execution duties.
 */
const SCRIPT_AUTHOR_BLOCKS:Record<string,Array<readonly [number,number]>>={
  'SKILL.md':[[19,19],[21,23],[25,25]],
  'references/autopilot.md':[[5,5],[11,15],[17,21],[25,26],[43,43],[49,52]],
  'references/autopilot-production-qa.md':[[5,9],[19,27],[29,34],[36,42],[44,52]],
  'references/autopilot-sound-system.md':[[5,7],[18,24],[45,49],[61,72],[74,80],[84,91]],
  'references/b1-minimal-handdrawn.md':[[7,13],[15,23],[25,31]],
  'references/b2-colorful-handdrawn.md':[[7,13],[15,19],[21,25]],
  'references/b3-television.md':[[11,13],[29,39],[41,43],[47,57],[69,73]],
  'references/b4-survival-storytelling.md':[[21,39],[41,47],[58,66]],
  'references/b4-opening-direction.md':[[5,14],[16,34],[40,54],[56,60]],
  'references/b4-audio-direction.md':[[5,9],[13,19],[24,34],[38,47],[49,55]]
};
export const SCRIPT_AUTHOR_EXTRACTION_REVISION='script-author-complete-blocks-v4';
function extractScriptAuthor(full:string,relative:string){
  const spans=SCRIPT_AUTHOR_BLOCKS[relative],expectedBlob=SCRIPT_AUTHOR_BLOB_SHA1[relative];
  if(!spans?.length||!expectedBlob)throw new Error('REBUILD_REQUIRED: missing Script Author requirement inventory: '+relative);
  const actualBlob=createHash('sha1').update('blob '+Buffer.byteLength(full,'utf8')+'\\0').update(full,'utf8').digest('hex');
  if(actualBlob!==expectedBlob)throw new Error('REBUILD_REQUIRED: Script Author original authority changed: '+relative);
  const lines=full.replace(/\\r\\n/g,'\\n').split('\\n'),locations:string[]=[],sections=new Map<string,string[]>();
  let lastEnd=0;
  for(const [start,end] of spans){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>lines.length||start<=lastEnd)
      throw new Error('REBUILD_REQUIRED: invalid or overlapping Script Author source range: '+relative+' L'+start+'-L'+end);
    lastEnd=end;
    const excerpt=lines.slice(start-1,end).join('\\n');
    if(!excerpt.trim())throw new Error('REBUILD_REQUIRED: empty Script Author source block: '+relative);
    const heading=lines.slice(0,start).reverse().find(row=>/^#{2,5} /.test(row))??'# '+relative;
    const grouped=sections.get(heading)??[];grouped.push(excerpt);sections.set(heading,grouped);
    locations.push('L'+start+'-L'+end);
  }
  const text=[...sections].map(([heading,blocks])=>heading+'\\n'+blocks.join('\\n\\n')).join('\\n\\n');
  return{text,headings:[...sections.keys()],locations};
}

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
  const focused=stage==='script'&&operation==='author'?extractScriptAuthor(full,relative):null;
  const text=focused?.text??selectSections(full,headings,relative);
  if(!text.trim())throw new Error('REBUILD_REQUIRED: required authority is empty: '+relative);
  return {path:relative,sha256:sha(bytes),extractionSha256:sha(text),
    extractionRevision:focused?SCRIPT_AUTHOR_EXTRACTION_REVISION:AUTHORITY_EXTRACTION_REVISION,
    applicability:[style,stage,operation],disposition,
    headings:focused?.headings??headings,...(focused?{locations:focused.locations}:{}),text};
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
  const scriptAuthorClassification=stage==='script'&&operation==='author'?{
    KEEP_SCRIPT:sources.flatMap(item=>(item.locations??[]).map(location=>item.path+':'+location)),
    DEFER_NATIVE:[
      'references/autopilot-runtime.md (original manifest, CLI and cache)',
      'references/autopilot-production-qa.md#Whole-film delivery gate',
      'references/autopilot-sound-system.md#Mix, runtime and acceptance',
      'Native shot/caption timing, original project.json v1 and asset publication',
      ...(style==='B4'?[
        'references/b4-survival-storytelling.md#Generation and anti-drift gates',
        'references/b4-opening-direction.md#Acceptance evidence',
        'references/b4-audio-direction.md#Evidence and acceptance gates'
      ]:[])
    ],
    STUDIO_ONLY:['provider HTTP/cost/credentials','WAV/alignment/media bytes and licensing checks',
      'original CLI execution, actual preview/render verification and owner approval'],
    AGENT_ONLY:['automatic tool dispatch, local terminal/browser automation and unattended producer calls']
  }:undefined;
  return {version:stage==='script'&&operation==='author'?SCRIPT_AUTHOR_EXTRACTION_REVISION:AUTHORITY_EXTRACTION_REVISION,style,stage,operation,rules,sources,
    ...(scriptAuthorClassification?{scriptAuthorClassification}:{}),
    matrix:{KEEP:sources.map(item=>item.path),
      MOVE_TO_NATIVE:stage==='script'?['references/autopilot-runtime.md','native project.json contract','native CLI validation and production approval']:[],
      STUDIO_ONLY:['provider HTTP/credentials','CLI execution','cache internals','local media filesystem publication','owner approvals'],
      AGENT_ONLY:['agent tool selection','agent terminal commands','automatic browser/provider operation']}};
}
