/** Manual external AI Style Bible contract. All creative text is opaque. */
import {contentHash,loadSchema,validateWithSchema,
  type StyleDesignCandidate,type StyleDesignReview,type ScriptAnalysis,
  type IdentityReviewOperation} from './contracts.js';
import type {PinnedStyle} from './styleBible.js';
export interface StyleDesignTask{
  stage:'style_bible';task_id:string;project_id:string;revision:number;
  operation:IdentityReviewOperation;input_sha256:string;candidate_sha256:string|null;
  source_sha256:string;finding_ids:string[];prompt:string;
  review_findings?:StyleDesignReview['findings'];review_sha256?:string;
}
export function designSourceSha(analysis:ScriptAnalysis,style:PinnedStyle){
  return contentHash({analysis:contentHash(analysis),style:style.id,
    profile:style.sha256,guidance:contentHash(style.guidance)});
}
export function validateStyleDesign(raw:unknown,analysis:ScriptAnalysis,style:PinnedStyle):StyleDesignCandidate{
  const item=raw as StyleDesignCandidate;
  if(!item||typeof item!=='object'||Array.isArray(item)||
    Object.keys(item).sort().join('|')!==['schema','project_id','analysis_sha256','style_profile_sha256','characters'].sort().join('|')||
    item.schema!=='stickman-ai-style-design-v1'||item.project_id!==analysis.project_id||
    item.analysis_sha256!==contentHash(analysis)||item.style_profile_sha256!==style.sha256||
    !Array.isArray(item.characters)||item.characters.length!==analysis.continuity_catalog.characters.length)
    throw Error('STYLE_DESIGN_SOURCE_INVALID');
  if(item.characters.some((row,index)=>row?.char_id!==analysis.continuity_catalog.characters[index]?.char_id))
    throw Error('STYLE_DESIGN_CHARACTER_ORDER_INVALID');
  const schema=loadSchema('bible');
  const rowSchema={...schema.$defs!.aiDesign};
  const ids=new Set<string>();
  for(const row of item.characters){
    validateWithSchema(rowSchema,row);
    if(ids.has(row.char_id)||!analysis.continuity_catalog.characters.some(c=>c.char_id===row.char_id)||
      !row.visual_design.trim()||!row.reference_prompt.trim())
      throw Error('STYLE_DESIGN_CHARACTER_INVALID');
    ids.add(row.char_id);
  }
  return item;
}
export function validateStyleDesignReview(raw:unknown,candidate:StyleDesignCandidate):StyleDesignReview{
  const review=raw as StyleDesignReview;
  if(!review||typeof review!=='object'||Array.isArray(review)||
    Object.keys(review).sort().join('|')!==['schema','project_id','candidate_sha256','independent_review','approved','findings'].sort().join('|')||
    review.schema!=='stickman-ai-style-design-review-v1'||review.project_id!==candidate.project_id||
    review.candidate_sha256!==contentHash(candidate)||review.independent_review!==true||
    typeof review.approved!=='boolean'||!Array.isArray(review.findings)||
    (review.approved?review.findings.length!==0:review.findings.length===0))
    throw Error('STYLE_DESIGN_REVIEW_INVALID');
  const ids=new Set<string>();
  for(const finding of review.findings){
    if(!finding||Object.keys(finding).sort().join('|')!==['finding_id','severity','location','issue','evidence'].sort().join('|')||
      typeof finding.finding_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(finding.finding_id)||
      ids.has(finding.finding_id)||!['P0','P1','P2'].includes(finding.severity)||
      [finding.location,finding.issue,finding.evidence].some(v=>typeof v!=='string'||!v.trim()))
      throw Error('STYLE_DESIGN_REVIEW_FINDING_INVALID');
    ids.add(finding.finding_id);
  }
  return review;
}
