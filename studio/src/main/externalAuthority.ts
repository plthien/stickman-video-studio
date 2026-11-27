import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { nativeSkillRoot, sha, type Stage } from './services.js';

export type ExternalOperation = 'author'|'review'|'correct'|'recheck'|'media-review';
export type Disposition = 'KEEP'|'MOVE_TO_NATIVE'|'STUDIO_ONLY'|'AGENT_ONLY';
export interface AuthoritySource {
  path:string; sha256:string; extractionSha256:string; extractionRevision:string;
  applicability:string[]; disposition:Disposition; headings:string[]; text:string; locations?:string[]; blocks?:Array<{location:string;text:string}>;
}
export const AUTHORITY_EXTRACTION_REVISION = 'stage-exact-v3';
const LEGACY_SCRIPT_MEDIA_EXTRACTION_REVISION = 'stage-exact-v2';

const STYLE:Record<string,string>={B1:'b1-minimal-handdrawn.md',B2:'b2-colorful-handdrawn.md',B3:'b3-television.md',B4:'b4-survival-storytelling.md'};

const NATIVE_REFERENCE_MEDIA:Record<string,readonly string[]>={
  B1:['assets/b1/approved-2026-10-23.mp4','assets/b1/approved-2026-10-23-contact-sheet.png',
    'assets/b1/approved-2026-10-23-motion-sheet.png','assets/b1/character-acting-reference.png',
    'assets/b1/approved-2026-10-24-longform-contact-sheet.jpg'],
  B2:['assets/b2/approved-style-board.jpg'],
  B3:['assets/b3/accepted-implementation-board.jpg','assets/b3/accepted-dog.png',
    'assets/b3/accepted-dog-motion.mp4','assets/b3/accepted-chair.png','assets/b3/accepted-chair-motion.mp4'],
  B4:['assets/b4/reference-01-motor-room.png','assets/b4/reference-02-rooftop.png',
    'assets/b4/reference-03-driver.png','assets/b4/reference-04-street.png','assets/b4/reference-05-opposite-rooftop.png']
};
const NATIVE_REFERENCE_TEXT:Record<string,readonly string[]>={
  B1:['assets/b1/approved-baseline.json','assets/b1/approved-production-standard.json'],
  B2:['assets/b2/approved-style-board.json'],
  B3:['assets/b3/reference-manifest.json'],
  B4:['assets/b4/approved-style.json','assets/b4/style-lock.txt']
};
export function nativeReferenceInventory(appPath:string,style:string){
  const names=NATIVE_REFERENCE_MEDIA[style];
  if(!names)throw new Error('Unsupported Native reference style: '+style);
  const root=nativeSkillRoot(appPath).root;
  return names.map(relative=>{
    const file=path.join(root,relative);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error('Required Mode B reference media missing: '+relative);
    const bytes=fs.readFileSync(file);
    if(!bytes.length)throw new Error('Required Mode B reference media empty: '+relative);
    return {path:relative,sha256:sha(bytes),bytes:bytes.length,style,transferStatus:'LOCAL_ONLY_NOT_TRANSFERRED' as const};
  });
}
export function nativeReferenceInstructions(inventory:ReturnType<typeof nativeReferenceInventory>){
  return ['## Selected-style reference media (local inventory; not evidence of transfer)',
    'Studio can export the actual selected-style reference files beside the Native prompt. Manually attach relevant images and motion clips before claiming any observation. A filename, hash or contact sheet does not establish moving-picture or audio inspection. If the authorized private B3 original or full B1 reference film is unavailable, disclose that comparison limit; bundled implementation evidence is not proof of exact replication.',
    JSON.stringify(inventory,null,2)].join('\n\n');
}
export function exportNativeReferencePackage(appPath:string,style:string,promptFile:string,promptSha256:string){
  const inventory=nativeReferenceInventory(appPath,style);
  const root=nativeSkillRoot(appPath).root;
  const directory=fs.mkdtempSync(promptFile+'.references-');
  try{
    for(const item of inventory){
      const bytes=fs.readFileSync(path.join(root,item.path));
      if(sha(bytes)!==item.sha256)throw new Error('Mode B reference changed during export: '+item.path);
      const destination=path.join(directory,item.path);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.writeFileSync(destination,bytes,{flag:'wx'});
      if(sha(fs.readFileSync(destination))!==item.sha256)throw new Error('Mode B reference export SHA mismatch: '+item.path);
    }
    fs.writeFileSync(path.join(directory,'reference-package.json'),JSON.stringify({
      schema:'mode-b-native-reference-package-v1',style,promptSha256,inventory,
      notice:'Local export only. Attach actual files to External ChatGPT; no transfer or observation is attested.'
    },null,2)+'\n',{flag:'wx'});
    return directory;
  }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
/** Creative directions; not a new executable grammar or semantic validator. */
export function nativeAnimationDirection(style:string){
  return [
    'NATIVE ANIMATION PRODUCTION — the original manifest is the executable animation design, not a slideshow storyboard. Apply only the selected B1–B4 style; ignore unrelated A/B5 routes and agent-only tool dispatch.',
    'For each shot, design its visible start, story-specific event and visible end against the real spoken words. Use shot_ledger to explain word-aligned event time, acting/expression, moving subject/prop, contact/support/weight, composition, occlusion and continuity. Explain the original executable mechanism and required pose/state assets. Keep metadata out of project.json.',
    'Design layer decomposition and asset_needs together: a prop that moves independently needs independently composable artwork or supported declarative artwork. A flat composed image cannot yield independent limb or prop movement. Describe isolated/registered assets and any required transparency in content without inventing provider capabilities or claiming validated alpha. Declare exact supported per-target orientation (9:16, 16:9, 1:1, 3:4 or 4:3) when needed. For explicit output requirements use asset_needs.output={composition: composed|isolated, background: opaque|transparent, preparation: preserve|border_key, registration: string, key_rgb?: [R,G,B]}. For border_key choose exact RGB absent from the artwork and request an entirely uniform opaque border-connected key background, with a clear margin on all sides and no antialiased key-colored fringe. Studio removes only exact border-connected pixels; if preservation or preparation is unsuitable, require owner review. No automatic crop or registration inference. Use the existing schema and safe native paths.',
    'Use original keys, increasing shot-relative seconds, x/y/w/angle (radians)/alpha/progress and selective visibility from/to as applicable. Use the 1280-wide design plane, back-to-front ordering, correct image geometry and stable explicit identities. Supported pose/state switching uses authored separate images and visibility; no inferred rig, automatic limb motion, image-to-video or physics engine.',
    ...(style==='B3'?['B3 only: use documented group/children, numeric paths, shapes, local pivots and group-local coordinates, scaleX/scaleY and selective visibility when appropriate. Preserve nested independent image children and occlusion. Never invent path morphing.']:['Do not use B3-only group, path, pivot or scaleX/scaleY mechanisms in this style.']),
    ...(style==='B4'?['B4: retain fixed b4-hook-v1 opening, meaningful picture-state changes, deliberate-hold exception and three-second narrative shot rule. Exceptional holds require real scoped owner approval. Do not impose B1–B3 inactivity quota or mandatory limb animation.']:['B1–B3: meaningful local actor/prop/information motion with original project-unique layer id, motion role/reason and effective keys; preserve the 2.5-second principal-picture inactivity gate. Global camera moves, no-op keys and caption turnover do not satisfy it. Do not add arbitrary motion or force every layer to move.']),
    'Use the original sound contract: tie actual track/cue intentions to the shot event and exact timeline, including environment, material/weight/perspective, intentional cuts and voice-first balance as applicable. Distinguish required source from acquired licensed media; never invent audio, rights, tracks or playback observations.',
    'Separate planned design, supported executable mechanisms, actual rendered motion and observed creative quality. Text review can evaluate the first two only. No fake CLI PASS, rendered frames, verified alpha, sound or actual media observation from paths or SHA alone.'
  ].join('\n\n');
}

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

/** Original Core blob identities; Script creative tasks must be explicitly re-reviewed
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
  'references/autopilot.md':[[5,5],[11,11],[13,13],[21,21],[25,25],[43,43]],
  'references/autopilot-production-qa.md':[[9,9],[21,21],[23,24],[27,27],[33,34],[42,42],[48,48]],
  'references/autopilot-sound-system.md':[[7,7],[18,24],[61,61],[63,63],[72,72]],
  'references/b1-minimal-handdrawn.md':[[7,13],[15,15],[19,23],[29,31]],
  'references/b2-colorful-handdrawn.md':[[7,13],[17,17],[19,19],[21,21],[23,25]],
  'references/b3-television.md':[[11,13],[29,39],[41,43],[47,57],[69,73]],
  'references/b4-survival-storytelling.md':[[21,39],[41,47],[61,61],[65,66]],
  'references/b4-opening-direction.md':[[11,14],[16,34],[40,54],[56,58]],
  'references/b4-audio-direction.md':[[9,9],[17,17],[19,19],[28,30],[32,32],[38,40],[47,47],[53,55]]
};
/** For a mixed-stage source line only: exact complete consecutive sentences with
 * a verified source boundary. All other source ranges are reproduced whole.
 */
const SCRIPT_AUTHOR_MIXED_SENTENCES:Record<string,readonly [string,string]>={
  'references/b2-colorful-handdrawn.md:L17-L17':['Favor specific everyday action,','Avoid unsupported psychology labels or medical claims.'],
  'references/b2-colorful-handdrawn.md:L21-L21':['Reusing a setting within one story','preserve its spatial and prop continuity.'],
  'references/autopilot-production-qa.md:L48-L48':['B1–B4 styles, languages, previews and films use','at a time**.'],
  'references/b4-survival-storytelling.md:L61-L61':['Default to English and **fix the main narrator','unless the user explicitly chooses otherwise.'],
  'references/b4-audio-direction.md:L9-L9':['Brian remains the narrator across scenes,','not a new actor.'],
  'references/b4-audio-direction.md:L32-L32':['Fit picture to the approved voice,','with no fixed SFX-only title pad.'],
  'references/autopilot.md:L11-L11':['Each B style defines its own visuals/characters','B4 retains its explicit Brian contract.'],
  'references/autopilot.md:L13-L13':['Resolve each setting in this order:','there is no mandatory shared TTS vendor.'],
  'references/autopilot.md:L21-L21':['Choose the palette from this story;','unrelated B styles.'],
  'references/autopilot.md:L25-L25':['1. Resolve the source/topic','narration language.'],
  'references/autopilot.md:L43-L43':['- **Story-led casting:**','merely for variety.'],
  'references/autopilot-production-qa.md:L21-L21':['Give the **first 30 seconds**','not faster cuts or louder effects.'],
  'references/autopilot-production-qa.md:L27-L27':['If copy is supplied or already approved','do not promise virality.'],
  'references/autopilot-sound-system.md:L61-L61':['Every added cue must answer','why this moment needs it**.'],
  'references/autopilot-sound-system.md:L63-L63':['Choose a palette from the particular story','not from the B number alone.'],
  'references/autopilot-sound-system.md:L72-L72':['Near-silence and complete silence are different choices.','fixed 0.5/2-second gap for every story.']
};
export const SCRIPT_AUTHOR_EXTRACTION_REVISION='script-author-complete-blocks-v4';
/** Presentation only: group original source blocks without copying their headings. */
export function renderScriptAuthorGroups(groups:ReadonlyArray<readonly [string,readonly string[]]>) {
  return groups.map(([heading,blocks])=>{
    const exactBlocks=blocks.join('\n\n');
    return heading && blocks[0]!==heading && !blocks[0]?.startsWith(heading+'\n')
      ? heading+'\n'+exactBlocks
      : exactBlocks;
  }).join('\n\n');
}
export function extractScriptAuthor(full:string,relative:string){
  const spans=SCRIPT_AUTHOR_BLOCKS[relative],expectedBlob=SCRIPT_AUTHOR_BLOB_SHA1[relative];
  if(!spans?.length||!expectedBlob)throw new Error('REBUILD_REQUIRED: missing Script Author requirement inventory: '+relative);
  // Git may check out source files as CRLF on Windows. Pin the original Git
  // blob content after newline normalization while hashing actual file bytes
  // separately in source.sha256 for immutable frozen-task provenance.
  const canonicalFull=full.replace(/\r\n/g,'\n');
  const actualBlob=createHash('sha1').update('blob '+Buffer.byteLength(canonicalFull,'utf8')+String.fromCharCode(0)).update(canonicalFull,'utf8').digest('hex');
  if(actualBlob!==expectedBlob)throw new Error('REBUILD_REQUIRED: Script Author original authority changed: '+relative);
  const lines=full.replace(/\r\n/g,'\n').split('\n'),locations:string[]=[],blocks:Array<{location:string;text:string}>=[],sections=new Map<string,string[]>();
  let lastEnd=0;
  for(const [start,end] of spans){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>lines.length||start<=lastEnd)
      throw new Error('REBUILD_REQUIRED: invalid or overlapping Script Author source range: '+relative+' L'+start+'-L'+end);
    lastEnd=end;
    let location='L'+start+'-L'+end;
    const selectorLocation=location;
    const mixed=SCRIPT_AUTHOR_MIXED_SENTENCES[relative+':'+selectorLocation];
    let excerpt=lines.slice(start-1,end).join('\n');
    if(mixed){
      const [from,to]=mixed,fromIndex=excerpt.indexOf(from),toIndex=excerpt.indexOf(to,fromIndex);
      if(fromIndex<0||toIndex<0||excerpt.indexOf(from,fromIndex+1)!==-1||
        excerpt.indexOf(to,toIndex+1)!==-1)
        throw new Error('REBUILD_REQUIRED: ambiguous mixed-stage sentence boundary: '+relative+' '+location);
      if(fromIndex>0&&!/[.!?]\s*$/.test(excerpt.slice(0,fromIndex)))
        throw new Error('REBUILD_REQUIRED: mixed-stage excerpt begins mid-sentence: '+relative+' '+location);
      excerpt=excerpt.slice(fromIndex,toIndex+to.length);
      if(!/[.!?]$/.test(excerpt))
        throw new Error('REBUILD_REQUIRED: mixed-stage excerpt ends mid-sentence: '+relative+' '+location);
      location='L'+start+':C'+(fromIndex+1)+'-C'+(toIndex+to.length);
    }
    if(!excerpt.trim())throw new Error('REBUILD_REQUIRED: empty Script Author source block: '+relative);
    const heading=lines.slice(0,start).reverse().find(row=>/^#{2,5} /.test(row))??'';
    const grouped=sections.get(heading)??[];grouped.push(excerpt);sections.set(heading,grouped);
    locations.push(location);blocks.push({location,text:excerpt});
  }
  const text=renderScriptAuthorGroups([...sections]);
  return{text,headings:[...sections.keys()],locations,blocks};
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
  const focused=stage==='script'&&(['author','review','correct','recheck'] as ExternalOperation[]).includes(operation)?extractScriptAuthor(full,relative):null;
  const text=focused?.text??selectSections(full,headings,relative);
  if(!text.trim())throw new Error('REBUILD_REQUIRED: required authority is empty: '+relative);
  return {path:relative,sha256:sha(bytes),extractionSha256:sha(text),
    extractionRevision:focused?SCRIPT_AUTHOR_EXTRACTION_REVISION:stage==='script'?LEGACY_SCRIPT_MEDIA_EXTRACTION_REVISION:AUTHORITY_EXTRACTION_REVISION,
    applicability:[style,stage,operation],disposition,
    headings:focused?.headings??headings,...(focused?{locations:focused.locations,blocks:focused.blocks}:{}),text};
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
    if(stage==='native'&&style==='B1')specs.push(['references/b1-production-qa.md',[],'KEEP']);
    if(stage==='native')for(const relative of NATIVE_REFERENCE_TEXT[style])specs.push([relative,[],'KEEP']);
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
  const referenceMedia=stage==='native'?nativeReferenceInventory(appPath,style):undefined;
  return {...(referenceMedia?{referenceMedia}:{}),version:stage==='script'?(operation==='media-review'?LEGACY_SCRIPT_MEDIA_EXTRACTION_REVISION:SCRIPT_AUTHOR_EXTRACTION_REVISION):AUTHORITY_EXTRACTION_REVISION,style,stage,operation,rules,sources,
    ...(scriptAuthorClassification?{scriptAuthorClassification}:{}),
    matrix:{KEEP:sources.map(item=>item.path),
      MOVE_TO_NATIVE:stage==='script'?['references/autopilot-runtime.md','native project.json contract','native CLI validation and production approval']:[],
      STUDIO_ONLY:['provider HTTP/credentials','CLI execution','cache internals','local media filesystem publication','owner approvals'],
      AGENT_ONLY:['agent tool selection','agent terminal commands','automatic browser/provider operation']}};
}
