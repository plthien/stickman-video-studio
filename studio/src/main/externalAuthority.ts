import fs from 'node:fs';
import path from 'node:path';
import { nativeSkillRoot, sha, type Stage } from './services.js';

export type ExternalOperation = 'author'|'review'|'correct'|'recheck'|'media-review';
export interface AuthoritySource { path:string; sha256:string; applicability:string[] }

const STYLE:Record<string,string>={B1:'b1-minimal-handdrawn.md',B2:'b2-colorful-handdrawn.md',B3:'b3-television.md',B4:'b4-survival-storytelling.md'};
const SCRIPT_RULES:Record<string,string[]>={
  B1:['Use a restrained hand-drawn premise, readable staging, and narration that can be expressed without decorative clutter.'],
  B2:['Use colorful hand-drawn storytelling with purposeful color, clear emotional beats, and feasible visual actions.'],
  B3:['Write for a television presentation: a clear program premise, legible information hierarchy, and narration that supports deliberate cuts.'],
  B4:['Open with an immediate survival threat and a concrete premise.','Maintain causal escalation, consequence, and payoff; narration must stay story-led rather than list-like.','State voice and sound intentions early, but never invent timing or claim rendered evidence.']
};
const NATIVE_RULES:Record<string,string[]>={
  B1:['Preserve minimal hand-drawn readability, intentional motion, and exact narration/caption timing.'],
  B2:['Preserve purposeful color continuity, hand-drawn character/prop identity, and story-driven camera/action.'],
  B3:['Preserve television framing, typography safe areas, program continuity, and deliberate transitions.'],
  B4:['Implement the approved opening threat with picture and audio acting together.','Use story-driven blocking, camera, asset continuity, ambience and sound accents; do not decorate mechanically.','Honor B4 opening, audio, asset and production-QA contracts while retaining exact approved narration and cues.']
};

function requiredFiles(style:string,stage:Stage,operation:ExternalOperation){
  const selected=STYLE[style];if(!selected)throw new Error('External manual workflow supports B1-B4 only.');
  const files=['SKILL.md',`references/${selected}`];
  if(stage==='script')files.push('references/autopilot.md');
  else files.push('references/autopilot-runtime.md','references/autopilot-production-qa.md','references/autopilot-sound-system.md');
  if(style==='B4')files.push(stage==='script'?'references/b4-opening-direction.md':'references/b4-opening-direction.md','references/b4-audio-direction.md');
  if(operation==='media-review'&&!files.includes('references/autopilot-production-qa.md'))files.push('references/autopilot-production-qa.md');
  return [...new Set(files)];
}

export function compileAuthority(appPath:string,style:string,stage:Stage,operation:ExternalOperation){
  const root=nativeSkillRoot(appPath).root,files=requiredFiles(style,stage,operation);
  const sources:AuthoritySource[]=files.map(relative=>{
    const target=path.join(root,relative);if(!fs.existsSync(target))throw new Error(`Required Mode B authority is missing: ${relative}`);
    return{path:relative,sha256:sha(fs.readFileSync(target)),applicability:[style,stage,operation]};
  });
  const rules=[...(stage==='script'?SCRIPT_RULES[style]:NATIVE_RULES[style])];
  if(operation==='review'||operation==='recheck'||operation==='media-review')rules.push('Review independently against the original task and cited authority. Separate observed evidence, inference, and unavailable evidence; never convert uncertainty into PASS.');
  if(operation==='correct')rules.push('Change only the explicitly editable targets. Return the complete original artifact grammar and preserve all locked entities semantically.');
  return{version:'mode-b-authority-matrix-v1',style,stage,operation,rules,sources};
}
