// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {hash,contentHash,type ScriptAnalysis,
  type ScriptCharacter,type VisualTraitRelationship} from '../../src/main/identity/contracts';
import {validateScriptAnalysis} from '../../src/main/identity/scriptAnalysis';
import {compileStyleBible,referencePromptForCharacter} from '../../src/main/identity/styleBible';

const projectId='a'.repeat(24);
const pinned={id:'B1' as const,guidance:'Verified local hand-drawn style.',
  sha256:hash('full-style-document-v1')};
const fixture=(text:string,trait:string,relation?:VisualTraitRelationship,
  actorName='Kip')=>{
  const authoring={};
  const script={projectId,revision:1,sha256:hash(text),authoring,
    sections:[{id:'opening',text}]};
  const offset=text.indexOf(actorName);
  const actor:ScriptCharacter={
    char_id:'char_001',label:actorName,description:'Role only',
    narrative_role:'Story actor',
    explicit_visual_traits:trait?[trait]:[],identity_markers:[],
    physical_constraints:[],continuity_notes:[],
    occurrences:[{section_id:'opening',quote:actorName,
      start:offset,end:offset+actorName.length}],
    presence_ranges:[{start:offset,end:offset+actorName.length}],
    ...(relation?{visual_trait_evidence:[{
      trait,relationship:relation,source:{
        section_id:'opening',quote:text,start:0,end:text.length
      }
    }]}:{})
  };
  const analysis:ScriptAnalysis={
    schema:'stickman-script-analysis-v1',
    project_id:projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(authoring),
    continuity_catalog:{characters:[actor]}
  };
  return{script,analysis};
};
/** Two actual, source-quoted identities, never invented from the trait text. */
const pairFixture=(text:string,owner:'char_001'|'char_002',trait:string,
  relationship:VisualTraitRelationship)=>{
  const f=fixture(text,owner==='char_001'?trait:'',
    owner==='char_001'?relationship:undefined,'Character A');
  const first=f.analysis.continuity_catalog.characters[0];
  const offset=text.indexOf('Character B');
  if(offset<0)throw Error('TEST_PAIR_MISSING_SECOND_ACTOR');
  const second:ScriptCharacter={
    ...structuredClone(first),char_id:'char_002',label:'Character B',
    explicit_visual_traits:owner==='char_002'?[trait]:[],
    visual_trait_evidence:owner==='char_002'?[{
      trait,relationship,source:{section_id:'opening',
        quote:text,start:0,end:text.length}
    }]:[],
    occurrences:[{section_id:'opening',quote:'Character B',
      start:offset,end:offset+'Character B'.length}],
    presence_ranges:[{start:offset,end:offset+'Character B'.length}]
  };
  f.analysis.continuity_catalog.characters.push(second);
  return f;
};

describe('AI-first visual authority — validate source bytes, never infer attribution',()=>{
  it('G02/G03 creative claims and relationship enum survive unchanged when exact spans are valid',()=>{
    for(const relationship of ['intrinsic_appearance','stable_wardrobe','transient_object','transient_action','scene_state','requires_owner_review'] as const){
      const f=pairFixture('Character A has a scar. Character B has blue eyes.',
        'char_001','blue eyes',relationship);
      expect(validateScriptAnalysis(f.analysis,f.script)).toEqual(f.analysis);
    }
  });
  it('G02 no appearance vocabulary, grammar or proximity determines approved structured traits',()=>{
    const f=fixture('龍 đi qua một khu vườn.','vảy phát sáng như sao','intrinsic_appearance','龍');
    expect(validateScriptAnalysis(f.analysis,f.script)).toEqual(f.analysis);
  });
  it('G05/G06 a reviewed AI design makes an underdescribed character drawable without a manual visual definition',()=>{
    const f=fixture('Kip enters the camp.','');
    const design:import('../../src/main/identity/contracts').StyleDesignCandidate={
      schema:'stickman-ai-style-design-v1',project_id:f.analysis.project_id,
      analysis_sha256:contentHash(f.analysis),style_profile_sha256:pinned.sha256,
      characters:[{char_id:'char_001',visual_design:'Blue angular silhouette with a copper scarf.',
        source_established:[],creative_decisions:['Blue angular silhouette','Copper scarf'],
        reference_prompt:'Draw the approved blue angular silhouette with a copper scarf.'}]};
    const review:import('../../src/main/identity/contracts').StyleDesignReview={
      schema:'stickman-ai-style-design-review-v1',project_id:design.project_id,
      candidate_sha256:contentHash(design),independent_review:true,approved:true,findings:[]};
    expect(()=>compileStyleBible(f.analysis,f.script,pinned,design)).toThrow('STYLE_DESIGN_REVIEW_REQUIRED');
    const compiled=compileStyleBible(f.analysis,f.script,pinned,design,review);
    expect(compiled.characters[0].ai_design).toEqual(design.characters[0]);
    expect(compiled.characters[0].visual_readiness).toBe('READY_FOR_REFERENCE');
    expect(referencePromptForCharacter(compiled,'char_001',pinned).prompt).toContain(design.characters[0].reference_prompt);
    const changed=structuredClone(design);changed.characters[0].reference_prompt='Unreviewed edit';
    expect(()=>compileStyleBible(f.analysis,f.script,pinned,changed,review)).toThrow('STYLE_DESIGN_REVIEW_INVALID');
  });
  it('G03 rejects an undeclared evidence trait even if source bytes are exact',()=>{
    const f=fixture('Kip has a scar.','scar','intrinsic_appearance');
    f.analysis.continuity_catalog.characters[0].visual_trait_evidence![0].trait='other';
    expect(()=>validateScriptAnalysis(f.analysis,f.script)).toThrow('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_UNDECLARED_TRAIT');
  });
  it('AUD01-07 tampered spans, quote and section name are still rejected',()=>{
    const text='Character A has a scar. Character B has blue eyes.';
    const base=()=>pairFixture(text,'char_002','blue eyes','intrinsic_appearance');
    const offset=base();
    offset.analysis.continuity_catalog.characters[1].visual_trait_evidence![0]
      .source.start=1;
    expect(()=>validateScriptAnalysis(offset.analysis,offset.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_SPAN_INVALID');
    const quote=base();
    quote.analysis.continuity_catalog.characters[1].visual_trait_evidence![0]
      .source.quote='a different quote';
    expect(()=>validateScriptAnalysis(quote.analysis,quote.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_SPAN_INVALID');
    const section=base();
    section.analysis.continuity_catalog.characters[1].visual_trait_evidence![0]
      .source.section_id='absent';
    expect(()=>validateScriptAnalysis(section.analysis,section.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_SPAN_INVALID');
  });

});
