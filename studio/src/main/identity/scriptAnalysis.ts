/** Script Analysis is frozen against one approved Script, never Stage='native'. */
import {randomUUID} from 'node:crypto';
import {contentHash,loadSchema,validateWithSchema,
  type ScriptAnalysis,type IdentityReviewOperation} from './contracts.js';
export interface ApprovedScriptSnapshot {
  projectId:string;sha256:string;revision:number;
  sections:Array<{id:string;text:string}>;
  authoring:Record<string,unknown>;
}
export interface AnalysisTask {
  schema:'mode-b-identity-external-task-v1';stage:'script_analysis';
  operation:IdentityReviewOperation;project_id:string;task_id:string;
  revision:number;input_sha256:string;source_script_sha256:string;
  source_authoring_sha256:string;prompt:string;
}
export interface ReviewFinding {
  finding_id:string;severity:'P0'|'P1'|'P2';
  location:string;issue:string;evidence:string;
}
export interface AnalysisReview {
  schema:'stickman-analysis-review-v1';project_id:string;
  analysis_sha256:string;independent_review:true;
  findings:ReviewFinding[];approved:boolean;
}
export function assertApprovedScript(script:ApprovedScriptSnapshot){
  if(!/^[a-f0-9]{24}$/.test(script.projectId)||!Number.isSafeInteger(script.revision)||
    script.revision<1||!Array.isArray(script.sections)||!script.sections.length)
    throw Error('IDENTITY_APPROVED_SCRIPT_REQUIRED');
  const ids=new Set<string>();
  for(const section of script.sections){
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(section.id)||ids.has(section.id)||
      typeof section.text!=='string'||!section.text.trim())
      throw Error('IDENTITY_SCRIPT_SECTION_INVALID');
    ids.add(section.id);
  }
  if(contentHash(script.sections.map(s=>s.text).join('\n\n'))!==script.sha256 &&
     // Existing Mode B source hash uses sha256 directly on joined speech text.
     script.sha256!==hashText(script.sections.map(s=>s.text).join('\n\n')))
    throw Error('IDENTITY_SCRIPT_SHA_MISMATCH');
  if(!script.authoring||Array.isArray(script.authoring)||typeof script.authoring!=='object')
    throw Error('IDENTITY_AUTHORING_INVALID');
}
import {hash as hashText} from './contracts.js';
export function analysisLineage(script:ApprovedScriptSnapshot){
  assertApprovedScript(script);
  return{projectId:script.projectId,scriptSha:script.sha256,
    authoringSha:contentHash(script.authoring),revision:script.revision};
}
export function validateScriptAnalysis(raw:unknown,script:ApprovedScriptSnapshot):ScriptAnalysis{
  const analysis=validateWithSchema<ScriptAnalysis>(loadSchema('analysis'),raw);
  const lineage=analysisLineage(script);
  if(analysis.project_id!==lineage.projectId||
    analysis.source_script_sha256!==lineage.scriptSha||
    analysis.source_authoring_sha256!==lineage.authoringSha)
    throw Error('SCRIPT_ANALYSIS_SOURCE_STALE');
  const sections=new Map(script.sections.map(s=>[s.id,s.text]));
  const beginnings=new Map<string,number>();let cursor=0;
  for(const section of script.sections){beginnings.set(section.id,cursor);
    cursor+=section.text.length+2;}
  for(const char of analysis.continuity_catalog.characters){
    const occurrences=[...char.occurrences].sort((a,b)=>a.start-b.start);
    let lastEnd=-1;
    for(const hit of occurrences){
      const source=sections.get(hit.section_id);
      if(source===undefined)throw Error('SCRIPT_ANALYSIS_UNKNOWN_SECTION');
      const absolute=beginnings.get(hit.section_id)!;
      // Positions are absolute UTF-16 offsets in exact joined Script text.
      if(hit.start>=hit.end||hit.start<absolute||hit.end>absolute+source.length||
        script.sections.map(s=>s.text).join('\n\n').slice(hit.start,hit.end)!==hit.quote)
        throw Error('SCRIPT_ANALYSIS_QUOTE_OR_SPAN_INVALID');
      if(hit.start<lastEnd)throw Error('SCRIPT_ANALYSIS_OCCURRENCE_OVERLAP');
      lastEnd=hit.end;
    }
    const ranges=[...char.presence_ranges].sort((a,b)=>a.start-b.start);
    let end=-1;
    for(const range of ranges){
      if(range.start>=range.end||range.end>cursor-2||range.start<end)
        throw Error('SCRIPT_ANALYSIS_PRESENCE_RANGE_INVALID');
      end=range.end;
    }
    for(const hit of occurrences){if(!ranges.some(r=>r.start<=hit.start&&r.end>=hit.end))
      throw Error('SCRIPT_ANALYSIS_OCCURRENCE_OUTSIDE_PRESENCE');}
    // Source-bearing appearance traits must remain owner-reviewable: a quote
    // proves the cited words, never an inferred appearance detail.
  }
  return analysis;
}
export function freezeAnalysisTask(script:ApprovedScriptSnapshot,operation:IdentityReviewOperation,
  revision:number,promptInputs:Record<string,unknown>={}):AnalysisTask{
  const lineage=analysisLineage(script),input_sha256=contentHash({lineage,operation,revision,promptInputs});
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('IDENTITY_TASK_REVISION_INVALID');
  const task_id=randomUUID();
  const lines=[
    '# STICKMAN — External ChatGPT Script Analysis',
    'Independently analyze the FROZEN approved Script. Do not modify narration.',
    'Return strict stickman-script-analysis-v1 JSON, no commentary.',
    'Use exact source quotes and UTF-16 offsets from the joined sections separated by two LF.',
    'Only report source-grounded attributes. Missing appearance stays empty; never invent.',
    'SCRIPT IDENTITY '+JSON.stringify(lineage),
    'SECTION TEXT '+JSON.stringify(script.sections),
    'AUTHORING CONTEXT (untrusted suggestions) '+JSON.stringify(script.authoring),
    'TASK ID '+task_id+' / INPUT SHA256 '+input_sha256
  ];
  return{schema:'mode-b-identity-external-task-v1',stage:'script_analysis',operation,
    project_id:lineage.projectId,task_id,revision,input_sha256,
    source_script_sha256:lineage.scriptSha,
    source_authoring_sha256:lineage.authoringSha,prompt:lines.join('\n\n')};
}
export function validateAnalysisEnvelope(raw:unknown,task:AnalysisTask,script:ApprovedScriptSnapshot){
  const row=raw as Record<string,unknown>;
  if(!row||Array.isArray(row)||typeof row!=='object'||
    Object.keys(row).sort().join('|')!==['input_sha256','payload','project_id','revision','schema','stage','task_id'].sort().join('|')||
    row.schema!=='mode-b-identity-external-result-v1'||row.stage!=='script_analysis'||
    row.task_id!==task.task_id||row.input_sha256!==task.input_sha256||
    row.project_id!==task.project_id||row.revision!==task.revision)
    throw Error('SCRIPT_ANALYSIS_ENVELOPE_INVALID');
  return validateScriptAnalysis(row.payload,script);
}
export function verifyIndependentReview(review:AnalysisReview,analysis:ScriptAnalysis){
  if(review?.schema!=='stickman-analysis-review-v1'||
    review.project_id!==analysis.project_id||
    review.analysis_sha256!==contentHash(analysis)||review.independent_review!==true||
    !Array.isArray(review.findings)||new Set(review.findings.map(f=>f.finding_id)).size!==review.findings.length||
    review.findings.some(f=>!/^[A-Za-z0-9_-]{1,80}$/.test(f.finding_id)||
      !['P0','P1','P2'].includes(f.severity)||!f.issue||!f.evidence)||
    (review.approved&&review.findings.some(f=>['P0','P1'].includes(f.severity))))
    throw Error('SCRIPT_ANALYSIS_REVIEW_INVALID');
  return review.approved;
}
