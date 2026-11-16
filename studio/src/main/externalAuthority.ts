import fs from 'node:fs';
import path from 'node:path';
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

/** Script Author selections are literal complete source paragraphs/requirements.
 * No model-authored paraphrases; every selector must resolve uniquely or fail closed.
 * These prefixes are version-controlled source-boundary locators, not summaries.
 */
const SCRIPT_AUTHOR_REQUIREMENTS:Record<string,string[]>={
  'SKILL.md':[
    'A and B share installation, not production contracts.',
    'B accepts topics, briefs, articles and scripts.',
    'Captions: B1–B4 single-line;'
  ],
  'references/autopilot.md':[
    'Resolve each setting in this order:',
    'Font, text-effect and language presets are defaults',
    'Shared B rules govern source fidelity',
    '1. Resolve the source/topic, audience, purpose, target duration',
    '- **Story-led casting:**',
    '- Design scenes around meaning, not uniform three-second cuts.',
    '- Identity and acting are separate:',
    '- Micro-animation must advance the meaning:'
  ],
  'references/autopilot-production-qa.md':[
    'Make actions, objects, diagrams and marks explain the spoken idea.',
    'Give the **first 30 seconds**',
    '- When writing copy, start with a short, concrete line',
    '- Match each line to a specific principal action',
    'If copy is supplied or already approved, preserve it;',
    '- No **principal-picture inactivity longer than 2.5 seconds**',
    '- Do not repeat compositions to fill time.',
    '- Vary entry order by meaning:',
    'Match icons, platform/company marks',
    'B1–B4 styles, languages, previews and films use **semantic subtitles'
  ],
  'references/autopilot-sound-system.md':[
    'Sound must communicate place, physical contact, information or emotion',
    'Build three **functional layers**',
    '1. **Place/continuity',
    '2. **Physical/spatial events',
    '3. **Emotional punctuation',
    'These are available roles,',
    'Every added cue must answer',
    'Choose a palette from the particular story',
    '**AUDIO CUT** is an intentional designed exception',
    '“Low, breathy,”'
  ],
  'references/b1-minimal-handdrawn.md':[
    '- Near-white warm paper',
    '- Expressive hand-drawn stick figures',
    '- Hand-drawn colored props',
    '- Large, short in-scene text',
    '- **Slender proportions:',
    '- **More exaggerated expressions:',
    '- **Act with the whole body:',
    '- **New content, new acting:',
    '- **Detailed enough, not cluttered:',
    'Voice leads at native **1×** speed.',
    'Use semantic match cuts, a prop carried between ideas'
  ],
  'references/b2-colorful-handdrawn.md':[
    '- Warm paper, irregular fine ink contours',
    '- Ordinary round-headed stickmen',
    '- Handwritten scene headings',
    '- Original restrained action SFX',
    'Plan from the complete voice recording and actual pauses.',
    'Keep the drawing language consistent, not the set.',
    'Before drawing a new story, record a short scene map',
    'Maintain physical contact and object ownership'
  ],
  'references/b3-television.md':[
    'Reference priority is **explicit user choices',
    'Use references as visual study, not as a reusable soundtrack',
    'The established direction is a dark field',
    'Plan the edit across shots as well as within them',
    'When an animal carries the story',
    'Use stable poses with bounded local animation.',
    'If narration names a behavior, **show that behavior**',
    'The following are **not** substitutes',
    'Use varied story-specific environments, prop details'
  ],
  'references/b4-survival-storytelling.md':[
    'The reference set and style prompt fix clear slightly organic black contours',
    'Do **not** translate “refined,”',
    'The current dispatcher specifically uses a bald round white head',
    'Gloves have rounded palms',
    '**Limb proportion and reach are a separate visual gate.',
    '**Check the pelvis-to-leg fork,',
    'For local expression or threat-state changes,',
    'Scripted abnormal anatomy is a **named-character exception',
    'For **B4 horror stories**',
    '- **Name the visible evidence before generation.',
    '- **Separate cast identity from menace.',
    '- **Make the threat visible, not merely described.',
    '- **Well-drawn held poses are a valid B4 baseline.',
    '- Read and execute the required [B4 audio contract]',
    "B4's deliberate-hold exception takes precedence"
  ],
  'references/b4-opening-direction.md':[
    '- **Earn attention with the story.',
    '- **Reserve distinct opening artwork.',
    '- **Progress, do not merely decorate.',
    'Use a concise question, usually two short semantic groups',
    'The first three seconds need a designed progression',
    'Alongside the text, show at least one',
    'For horror, the change must strengthen',
    'Every B4 **narrative shot is at most 3.0 seconds**',
    '**Show facts; do not label every fact.',
    'Spot the immediate hearing hook'
  ],
  'references/b4-audio-direction.md':[
    '1. **Cast only real roles.',
    '3. **Act the scene, not a preset.',
    '**Start with perceptible story-led sound',
    'Fit picture to the approved voice',
    'Intentional opening silence remains possible',
    '**Subtle continuous bed, necessary SFX.',
    '- **Hook and payoff follow genre.',
    'Use an ending choice only when the brief or story calls'
  ]
};
/** Exact contiguous substrings of mixed-stage source paragraphs; never paraphrased. */
const SCRIPT_AUTHOR_EXCERPT:Record<string,string>={
  'Plan from the complete voice recording and actual pauses.':'Favor specific everyday action, amusing visual contradictions, explanatory object diagrams and a concrete payoff.',
  '- Read and execute the required [B4 audio contract]':'Default to English and **fix the main narrator to Brian — Deep, Resonant and Comforting**',
  'B1–B4 styles, languages, previews and films use **semantic subtitles':'B1–B4 styles, languages, previews and films use **semantic subtitles with at most one visible line at a time**.'
};
function extractScriptAuthor(full:string,relative:string){
  const prefixes=SCRIPT_AUTHOR_REQUIREMENTS[relative];
  if(!prefixes?.length)throw new Error('REBUILD_REQUIRED: missing Script Author authority selection: '+relative);
  const lines=full.replace(/\r\n/g,'\n').split('\n');
  const locations:string[]=[];
  const sections=new Map<string,string[]>();
  for(const prefix of prefixes){
    const hits=lines.flatMap((line,i)=>line.trimStart().startsWith(prefix)?[i]:[]);
    if(hits.length!==1)throw new Error('REBUILD_REQUIRED: Script Author source selector missing or ambiguous: '+relative+' '+prefix);
    const index=hits[0],line=lines[index];
    const heading=lines.slice(0,index+1).reverse().find(row=>/^#{2,5} /.test(row))??'# '+relative;
    const excerpt=SCRIPT_AUTHOR_EXCERPT[prefix];
    if(excerpt&&!line.includes(excerpt))throw new Error('REBUILD_REQUIRED: changed exact creative requirement: '+relative+' '+prefix);
    const entries=sections.get(heading)??[];entries.push(excerpt??line);sections.set(heading,entries);
    locations.push('L'+String(index+1));
  }
  const text=[...sections].map(([heading,entries])=>heading+'\n'+entries.join('\n\n')).join('\n\n');
  if(!text.trim())throw new Error('REBUILD_REQUIRED: empty Script Author authority for '+relative);
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
    extractionRevision:focused?'script-author-source-exact-v3':AUTHORITY_EXTRACTION_REVISION,
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
  return {version:stage==='script'&&operation==='author'?'script-author-source-exact-v3':AUTHORITY_EXTRACTION_REVISION,style,stage,operation,rules,sources,
    ...(scriptAuthorClassification?{scriptAuthorClassification}:{}),
    matrix:{KEEP:sources.map(item=>item.path),
      MOVE_TO_NATIVE:stage==='script'?['references/autopilot-runtime.md','native project.json contract','native CLI validation and production approval']:[],
      STUDIO_ONLY:['provider HTTP/credentials','CLI execution','cache internals','local media filesystem publication','owner approvals'],
      AGENT_ONLY:['agent tool selection','agent terminal commands','automatic browser/provider operation']}};
}
