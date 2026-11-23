/** Script Analysis is frozen against one approved Script, never Stage='native'. */
import {randomUUID} from 'node:crypto';
import {contentHash,loadSchema,validateWithSchema,
  type ScriptAnalysis,type ScriptCharacter,type VisualTraitEvidence,
  type IdentityReviewOperation} from './contracts.js';
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
  finding_ids?:string[];review_findings?:ReviewFinding[];review_sha256?:string;
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
/** An exact quote/span proves narration bytes, NOT whether a temporary
 * action is permanent appearance. Only narrow grammatically explicit
 * appearance or recurring wardrobe claims are eligible automatically.
 * All other relationships require explicit owner visual-definition approval. */
const visualWords=(v:string)=>v.normalize('NFKC').toLocaleLowerCase('en')
  .match(/[\p{L}\p{M}\p{N}]+/gu)??[];
const quoteContainsTrait=(quote:string,trait:string)=>{
  const source=visualWords(quote),parts=visualWords(trait);
  if(!parts.length)return false;
  let offset=0;
  for(const word of source)if(word===parts[offset])offset++;
  return offset===parts.length;
};
type ScriptActorMention={charId:string;start:number;end:number};
/** Only a *single source clause* after the actor may authorize an automatic
 * visual trait. Other actor mentions and independent sentences end the window;
 * neither a long quote nor verbs from a later actor can attribute that trait.
 * Ambiguous syntax remains inspectable as requires_owner_review. */
function directlyAttributedAppearance(evidence:VisualTraitEvidence,
  char:ScriptCharacter,mentions:ScriptActorMention[]):boolean{
  if(!['intrinsic_appearance','stable_wardrobe'].includes(evidence.relationship))
    return false;
  const hit=evidence.source,bodyCues=new Set(['scar','hair','eye','eyes','skin','face',
    'beard','moustache','mustache','freckle','freckles','tattoo','birthmark',
    'nose','cheek','cheeks','ears','ear','height','body','arm','arms','leg',
    'legs','tall','short','thin','skinny','slim','bald','muscular','heavyset']);
  const intrinsicCue=visualWords(evidence.trait).some(word=>bodyCues.has(word));
  return char.occurrences.some(actor=>{
    if(actor.start<hit.start||actor.end>hit.end||
      hit.quote.slice(actor.start-hit.start,actor.end-hit.start)!==actor.quote)
      return false;
    const afterActor=actor.end-hit.start;
    const tail=hit.quote.slice(afterActor);
    const sentenceEnd=tail.search(/[.!?;\r\n]/u);
    // A second named/pronominal subject with its own finite appearance
    // predicate also ends attribution, even if upstream omitted that actor
    // from its catalog. This is a fail-closed boundary, not name inference.
    const newSubject=tail.search(/(?:[,;]\s*|\b(?:and|but|while|whereas)\s+)(?:[\p{Lu}][\p{L}\p{M}'’-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{M}\p{N}'’-]*){0,2}|(?:he|she|they|someone|somebody|(?:another|a|an|the)\s+[\p{Ll}][\p{L}\p{M}'’-]*))\s+(?:has|have|is|was|wears?|looks?|seems?)\b/u);
    const nextOther=mentions.filter(m=>m.charId!==char.char_id&&
      m.start>=actor.end&&m.start<hit.end)
      .reduce((first,m)=>Math.min(first,m.start-hit.start),hit.quote.length);
    const last=Math.min(sentenceEnd<0?hit.quote.length:afterActor+sentenceEnd,
      newSubject<0?hit.quote.length:afterActor+newSubject,nextOther);
    if(last<=afterActor)return false;
    const clause=hit.quote.slice(afterActor,last).normalize('NFKC')
      .toLocaleLowerCase('en');
    if(!quoteContainsTrait(clause,evidence.trait))return false;
    // Subject + attributable predicate must both be in this same clause.
    if(evidence.relationship==='intrinsic_appearance')
      return intrinsicCue&&/^\s*(?:['’]s\s+[\p{L}\p{M}\p{N} ]+\s+(?:is|are)|(?:has|have|is|was|looks?|seems?|has\s+got)\b)/u
        .test(clause);
    return /^\s*(?:wears?|dresses?\s+in)\b/u.test(clause)&&
      /\b(?:every\s+day|daily|always|usually|habitually|signature|never\s+removes?)\b/u
        .test(clause);
  });
}
function validateTraitEvidence(evidence:VisualTraitEvidence,
  char:ScriptCharacter,sections:Map<string,string>,
  beginnings:Map<string,number>,mentions:ScriptActorMention[]){
  const hit=evidence.source,source=sections.get(hit.section_id);
  const offset=beginnings.get(hit.section_id);
  if(source===undefined||offset===undefined||
    hit.start>=hit.end||hit.start<offset||hit.end>offset+source.length||
    source.slice(hit.start-offset,hit.end-offset)!==hit.quote)
    throw Error('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_SPAN_INVALID: '+char.char_id);
  if(!mentions.some(v=>v.charId===char.char_id&&v.start>=hit.start&&
    v.end<=hit.end))
    throw Error('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_OWNER_INVALID: '+char.char_id);
  if(!quoteContainsTrait(hit.quote,evidence.trait))
    throw Error('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_TRAIT_INVALID: '+char.char_id);
  if(['transient_object','transient_action','scene_state'].includes(evidence.relationship))
    throw Error('SCRIPT_ANALYSIS_TRANSIENT_NOT_CANONICAL: '+char.char_id);
  if(evidence.relationship==='requires_owner_review')return;
  if(!directlyAttributedAppearance(evidence,char,mentions))
    throw Error('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED: '+char.char_id);
}
/** Reuse the same source-clause gate for drawable trait projection. Caller
 * validates the complete Analysis first, including strict quote/span/lineage. */
export function verifiedVisualTraits(char:ScriptCharacter,
  catalog:ScriptCharacter[]=[char]):string[]{
  const mentions=catalog.flatMap(actor=>actor.occurrences.map(hit=>({
    charId:actor.char_id,start:hit.start,end:hit.end
  })));
  return char.explicit_visual_traits.filter(trait=>
    char.visual_trait_evidence?.some(record=>record.trait===trait&&
      directlyAttributedAppearance(record,char,mentions)));
}
export function validateScriptAnalysis(raw:unknown,script:ApprovedScriptSnapshot,
  schema=loadSchema('analysis')):ScriptAnalysis{
  const analysis=validateWithSchema<ScriptAnalysis>(schema,raw);
  const lineage=analysisLineage(script);
  if(analysis.project_id!==lineage.projectId||
    analysis.source_script_sha256!==lineage.scriptSha||
    analysis.source_authoring_sha256!==lineage.authoringSha)
    throw Error('SCRIPT_ANALYSIS_SOURCE_STALE');
  const sections=new Map(script.sections.map(s=>[s.id,s.text]));
  const beginnings=new Map<string,number>();let cursor=0;
  for(const section of script.sections){beginnings.set(section.id,cursor);
    cursor+=section.text.length+2;}
  const sourceText=script.sections.map(section=>section.text).join('\n\n');
  const folded=sourceText.toLocaleLowerCase('en');
  const mentions=analysis.continuity_catalog.characters.flatMap(character=>
    character.occurrences.map(hit=>({charId:character.char_id,start:hit.start,end:hit.end})));
  const attributedTo=(charId:string,phrase:string)=>{
    const needle=phrase.trim().toLocaleLowerCase('en');
    for(let pos=folded.indexOf(needle);pos!==-1;
      pos=folded.indexOf(needle,pos+1)){
      const boundary=Math.max(folded.lastIndexOf('.',pos-1),
        folded.lastIndexOf('!',pos-1),folded.lastIndexOf('?',pos-1),
        folded.lastIndexOf(';',pos-1),folded.lastIndexOf('\n',pos-1))+1;
      const before=mentions.filter(hit=>hit.start>=boundary&&
        hit.start<=pos&&pos-hit.start<240)
        .sort((a,b)=>b.start-a.start);
      if(before.length&&before[0].charId===charId&&
        !before.some(hit=>hit.start===before[0].start&&hit.charId!==charId))
        return true;
    }
    return false;
  };
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
    // A character ID can be inferred from recurring narration mentions, but
    // appearance traits cannot. A literal source phrase is minimum evidence;
    // the independent owner review still checks its attribution to this actor.
    for(const marker of char.identity_markers){
      if(typeof marker!=='string'||!marker.trim()||
        !folded.includes(marker.trim().toLocaleLowerCase('en')))
        throw Error('SCRIPT_ANALYSIS_IDENTITY_MARKER_NOT_IN_SOURCE: '+char.char_id);
    }
    for(const trait of char.explicit_visual_traits){
      if(typeof trait!=='string'||!trait.trim()||
        (!char.visual_trait_evidence?.some(v=>v.trait===trait)&&
          !attributedTo(char.char_id,trait)))
        throw Error('SCRIPT_ANALYSIS_UNSUPPORTED_VISUAL_TRAIT: '+char.char_id);
    }
    for(const constraint of char.physical_constraints){
      if(typeof constraint!=='string'||!constraint.trim()||
        !attributedTo(char.char_id,constraint))
        throw Error('SCRIPT_ANALYSIS_UNSUPPORTED_VISUAL_TRAIT: '+char.char_id);
    }
    const supplied=char.visual_trait_evidence??[];
    for(const evidence of supplied){
      if(!char.explicit_visual_traits.includes(evidence.trait))
        throw Error('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_UNDECLARED_TRAIT: '+char.char_id);
      validateTraitEvidence(evidence,char,sections,beginnings,mentions);
    }
    // The absence of evidence in an old F24 record is NOT evidence of a
    // stable trait: Style Bible will keep it as NEEDS_OWNER_DEFINITION.

  }
  return analysis;
}
/** The literal frozen task envelope is the only accepted external output.
 * A complete JSON Schema is embedded so External ChatGPT never guesses keys. */
export function analysisResultContract(task:AnalysisTask,payload:unknown){
  return [
    '## REQUIRED EXACT OUTPUT ENVELOPE (valid JSON object, no Markdown fences)',
    JSON.stringify({schema:'mode-b-identity-external-result-v1',
      stage:'script_analysis',project_id:task.project_id,
      task_id:task.task_id,revision:task.revision,
      input_sha256:task.input_sha256,
      ...(task.operation==='correct'&&task.finding_ids?{
        resolved_finding_ids:task.finding_ids}:{}),
      payload},null,2),
    'Keep ALL six envelope identity fields byte-for-value; only replace payload.',
    'No additional envelope keys, no comments, no invented source spans.'
  ].join('\n\n');
}
export function analysisAuthorContract(task:AnalysisTask){
  return [
    '## EXACT stickman-script-analysis-v1 JSON Schema (payload must conform)',
    JSON.stringify(loadSchema('analysis'),null,2),
    'Each char_id must match ^char_[0-9]{3}$ (e.g. char_001).',
    'Each char_id represents ONE independently established individual identity.',
    'A shot with multiple established actors uses multiple char_ids, not a group ID.',
    'Do not invent identities for unnamed crowds or generic background people.',
    'Character objects require ALL: char_id, label, description,',
    'narrative_role, explicit_visual_traits, identity_markers, continuity_notes,',
    'physical_constraints, occurrences, presence_ranges.',
    'Each occurrence has {section_id,quote,start,end}; ranges have {start,end}.',
    'Indices are 0-based UTF-16 offsets in EXACT joined Script, between',
    'sections separated by two LF characters. End is exclusive.',
    'No approximate quotes. Traits require per-trait visual_trait_evidence',
    '{trait,source:{section_id,quote,start,end},relationship}.',
    'Only intrinsic_appearance or stable_wardrobe from explicit stable wording',
    'can be canonical. Picked-up/held objects, running poses and momentary',
    'scene states are NOT appearance. Mark requires_owner_review for ambiguity.',
    'Without verifiable evidence, leave explicit_visual_traits empty.',
    'Never infer permanent clothes/body details from actor mention proximity.',
    analysisResultContract(task,{
      schema:'stickman-script-analysis-v1',project_id:task.project_id,
      source_script_sha256:task.source_script_sha256,
      source_authoring_sha256:task.source_authoring_sha256,
      continuity_catalog:{characters:[]}
    })
  ].join('\n\n');
}
export function analysisReviewContract(task:AnalysisTask,analysisSha:string){
  return [
    '## EXACT review JSON contract',
    'The payload schema is stickman-analysis-review-v1 with only',
    '{schema,project_id,analysis_sha256,independent_review,findings,approved}.',
    'independent_review must be true. Every finding contains',
    '{finding_id,severity,location,issue,evidence}.',
    'severity is exactly P0, P1 or P2; every finding requires Correct then Recheck.',
    'approved=true requires an EMPTY findings array. approved=false requires at least one finding.',
    'The independent reviewer must actually examine source quotes and spans.',
    analysisResultContract(task,{
      schema:'stickman-analysis-review-v1',project_id:task.project_id,
      analysis_sha256:analysisSha,independent_review:true,
      findings:[],approved:true
    })
  ].join('\n\n');
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
  const task:AnalysisTask={schema:'mode-b-identity-external-task-v1',
    stage:'script_analysis',operation,project_id:lineage.projectId,
    task_id,revision,input_sha256,source_script_sha256:lineage.scriptSha,
    source_authoring_sha256:lineage.authoringSha,prompt:''};
  task.prompt=lines.join('\n\n')+'\n\n'+analysisAuthorContract(task);
  return task;
}
export function validateAnalysisEnvelope(raw:unknown,task:AnalysisTask,script:ApprovedScriptSnapshot){
  const row=raw as Record<string,unknown>;
  if(!row||Array.isArray(row)||typeof row!=='object'||
    Object.keys(row).sort().join('|')!==[
      'input_sha256','payload','project_id','revision','schema','stage','task_id',
      ...(task.operation==='correct'&&task.finding_ids?['resolved_finding_ids']:[])
    ].sort().join('|')||
    row.schema!=='mode-b-identity-external-result-v1'||row.stage!=='script_analysis'||
    row.task_id!==task.task_id||row.input_sha256!==task.input_sha256||
    row.project_id!==task.project_id||row.revision!==task.revision)
    throw Error('SCRIPT_ANALYSIS_ENVELOPE_INVALID');
  if(task.operation==='correct'&&task.finding_ids&&
    (!Array.isArray(row.resolved_finding_ids)||
      JSON.stringify([...row.resolved_finding_ids].sort())!==
        JSON.stringify([...(task.finding_ids??[])].sort())))
    throw Error('SCRIPT_ANALYSIS_CORRECTION_FINDINGS_INVALID');
  return validateScriptAnalysis(row.payload,script);
}
export function verifyIndependentReview(review:AnalysisReview,analysis:ScriptAnalysis){
  if(!review||typeof review!=='object'||Array.isArray(review)||
    Object.keys(review).sort().join('|')!==
      ['schema','project_id','analysis_sha256','independent_review',
        'findings','approved'].sort().join('|'))
    throw Error('SCRIPT_ANALYSIS_REVIEW_INVALID');
  if(review?.schema!=='stickman-analysis-review-v1'||
    review.project_id!==analysis.project_id||
    review.analysis_sha256!==contentHash(analysis)||review.independent_review!==true||
    !Array.isArray(review.findings)||
    review.findings.some(f=>!f||typeof f!=='object'||
      Object.keys(f).sort().join('|')!==
        ['finding_id','severity','location','issue','evidence'].sort().join('|')||
      typeof f.finding_id!=='string'||
      !/^[A-Za-z0-9_-]{1,80}$/.test(f.finding_id)||
      !['P0','P1','P2'].includes(f.severity)||
      typeof f.location!=='string'||!f.location.trim()||
      typeof f.issue!=='string'||!f.issue.trim()||
      typeof f.evidence!=='string'||!f.evidence.trim())||
    new Set(review.findings.map(f=>f.finding_id)).size!==review.findings.length||
    typeof review.approved!=='boolean'||
    // A negative verdict without actionable findings strands Correct.
    // Any finding on an approved review is contradictory; P2 findings
    // also require explicit Correct→independent Recheck.
    (review.approved?review.findings.length!==0:review.findings.length===0))
    throw Error('SCRIPT_ANALYSIS_REVIEW_INVALID');
  return review.approved;
}
