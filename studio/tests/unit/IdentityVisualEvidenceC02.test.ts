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
const verify=(text:string,trait:string,relation:VisualTraitRelationship)=>
  {const f=fixture(text,trait,relation);
    return{...f,bible:compileStyleBible(f.analysis,f.script,pinned)};};
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

describe('F24-C02 permanent visual traits require exact actor/span/relationship',()=>{
  it('C02-01 facial scar from explicit identity sentence is eligible',()=>{
    const f=verify('Kip has a scar across his cheek.','scar across cheek',
      'intrinsic_appearance');
    expect(f.bible.characters[0].explicit_visual_traits)
      .toEqual(['scar across cheek']);
    expect(f.bible.characters[0].visual_readiness).toBe('READY_FOR_REFERENCE');
    expect(referencePromptForCharacter(f.bible,'char_001',pinned).prompt)
      .toContain('scar across cheek');
  });
  it('C02-02 picked-up red hat cannot be passed as permanent wardrobe',()=>{
    const f=fixture('Kip picks up a red hat.','red hat','stable_wardrobe');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
    f.analysis.continuity_catalog.characters[0].visual_trait_evidence![0]
      .relationship='transient_object';
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_TRANSIENT_NOT_CANONICAL');
  });
  it('C02-03 a black hair trait seen on Brog cannot belong to Kip',()=>{
    const f=fixture("Kip sees Brog's black hair.",'black hair','intrinsic_appearance');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
  });
  it('C02-04 wooden club held by an actor is not body appearance',()=>{
    const f=fixture('Brog holds a wooden club.','wooden club',
      'intrinsic_appearance','Brog');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
  });
  it('C02-04b mere ownership of a red hat is not a permanent body trait',()=>{
    const f=fixture('Kip has a red hat.','red hat','intrinsic_appearance');
    expect(()=>compileStyleBible(f.analysis,f.script,pinned))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
  });
  it('C02-05 temporary running is not intrinsic appearance',()=>{
    const f=fixture('Kip is running.','running','transient_action');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_TRANSIENT_NOT_CANONICAL');
  });
  it('C02-06 ungrounded appearance is not drawable',()=>{
    const f=fixture('Kip enters the camp.','');
    const bible=compileStyleBible(f.analysis,f.script,pinned);
    expect(bible.characters[0].visual_readiness).toBe('NEEDS_OWNER_DEFINITION');
    expect(()=>referencePromptForCharacter(bible,'char_001',pinned))
      .toThrow('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
  });
  it('C02-07 stable clothing requires a verifiable recurrence claim',()=>{
    const f=verify('Kip wears a red hat every day.','red hat','stable_wardrobe');
    expect(f.bible.characters[0].explicit_visual_traits).toEqual(['red hat']);
    const transient=fixture('Kip wears a red hat today.','red hat','stable_wardrobe');
    expect(()=>compileStyleBible(transient.analysis,transient.script,pinned))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
  });
  it('C02-09 old unverified traits never reach the canonical provider prompt',()=>{
    const text='Kip has a scar. Kip picks up a red hat.';
    const f=fixture(text,'scar','intrinsic_appearance');
    const second=f.analysis.continuity_catalog.characters[0];
    second.visual_trait_evidence![0].source={section_id:'opening',
      quote:'Kip has a scar',start:0,end:14};
    second.explicit_visual_traits.push('red hat');
    // A legacy analyzer may repeat an action as a proposed trait without
    // evidence. It is inspectable but never becomes drawable authority.
    second.occurrences.push({section_id:'opening',quote:'Kip',start:16,end:19});
    second.presence_ranges.push({start:16,end:19});
    const bible=compileStyleBible(f.analysis,f.script,pinned);
    const prompt=referencePromptForCharacter(bible,'char_001',pinned).prompt;
    expect(prompt).toContain('scar');
    expect(prompt).not.toContain('red hat');
  });
  it('C02-10 tampering source offsets or source quote fails closed',()=>{
    const f=fixture('Kip has a scar.','scar','intrinsic_appearance');
    f.analysis.continuity_catalog.characters[0].visual_trait_evidence![0]
      .source.end--;
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_EVIDENCE_SPAN_INVALID');
  });
  it('C02-12 ambiguity stays owner-review-only without an LLM classifier',()=>{
    const f=verify('Kip with a red coat.','red coat','requires_owner_review');
    expect(f.bible.characters[0].visual_readiness).toBe('NEEDS_OWNER_DEFINITION');
    expect(f.bible.characters[0].explicit_visual_traits).toEqual([]);
    expect(()=>referencePromptForCharacter(f.bible,'char_001',pinned))
      .toThrow('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
  });
  it('AUD01-01 cross-sentence blue eyes cannot be attributed to Character A',()=>{
    const f=pairFixture('Character A has a scar. Character B has blue eyes.',
      'char_001','blue eyes','intrinsic_appearance');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED: char_001');
    expect(()=>compileStyleBible(f.analysis,f.script,pinned))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
  });
  it('AUD01-01c another named subject fails closed even if catalog omitted it',()=>{
    const f=fixture('Character A has a scar and Character B has blue eyes.',
      'blue eyes','intrinsic_appearance','Character A');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED: char_001');
  });
  it('AUD01-01b same sentence, another character predicate cuts the claim',()=>{
    const f=pairFixture('Character A has a scar and Character B has blue eyes.',
      'char_001','blue eyes','intrinsic_appearance');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED: char_001');
  });
  it('AUD01-02 same source legitimately attributes blue eyes to Character B',()=>{
    const f=pairFixture('Character A has a scar. Character B has blue eyes.',
      'char_002','blue eyes','intrinsic_appearance');
    const bible=compileStyleBible(f.analysis,f.script,pinned);
    expect(bible.characters.find(c=>c.char_id==='char_002')?.explicit_visual_traits)
      .toEqual(['blue eyes']);
    expect(bible.characters.find(c=>c.char_id==='char_001')?.explicit_visual_traits)
      .toEqual([]);
  });
  it('AUD01-03 a same-character scar remains valid',()=>{
    const f=pairFixture('Character A has a scar. Character B has blue eyes.',
      'char_001','scar','intrinsic_appearance');
    expect(compileStyleBible(f.analysis,f.script,pinned)
      .characters[0].explicit_visual_traits).toEqual(['scar']);
  });
  it('AUD01-04 recurring approved wardrobe in the same actor clause remains valid',()=>{
    const f=pairFixture('Character A wears a blue coat every day. Character B smiles.',
      'char_001','blue coat','stable_wardrobe');
    expect(compileStyleBible(f.analysis,f.script,pinned)
      .characters[0].explicit_visual_traits).toEqual(['blue coat']);
  });
  it('AUD01-05 temporary held objects cannot become permanent clothing',()=>{
    const f=pairFixture('Character A picks up a red hat. Character B has blue eyes.',
      'char_001','red hat','stable_wardrobe');
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_VISUAL_RELATION_REVIEW_REQUIRED');
    f.analysis.continuity_catalog.characters[0].visual_trait_evidence![0]
      .relationship='transient_object';
    expect(()=>validateScriptAnalysis(f.analysis,f.script))
      .toThrow('SCRIPT_ANALYSIS_TRANSIENT_NOT_CANONICAL');
  });
  it('AUD01-06 unresolved cross-actor appearance is not canonical or drawable',()=>{
    const f=pairFixture('Character A has a scar. Character B has blue eyes.',
      'char_001','blue eyes','requires_owner_review');
    const bible=compileStyleBible(f.analysis,f.script,pinned);
    expect(bible.characters[0].explicit_visual_traits).toEqual([]);
    expect(bible.characters[0].visual_readiness).toBe('NEEDS_OWNER_DEFINITION');
    expect(()=>referencePromptForCharacter(bible,'char_001',pinned))
      .toThrow('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
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
