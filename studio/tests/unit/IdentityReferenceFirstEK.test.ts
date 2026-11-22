// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {canonical,contentHash,hash,loadSchema,type ScriptAnalysis,
  type ScriptCharacter,type StyleBible} from '../../src/main/identity/contracts';
import {validateScriptAnalysis,type ApprovedScriptSnapshot} from '../../src/main/identity/scriptAnalysis';
import {compileStyleBible,referencePromptForCharacter} from '../../src/main/identity/styleBible';
import {frozenLegacyReferencePrompt,isFrozenLegacyAnalysis,
  validateHistoricalPublishedBible} from '../../src/main/identity/legacyStorage';

const name='Character A',line=name+' has a scar.',quote=name+' has a scar';
const pinned={id:'B1' as const,guidance:'Test-approved simple illustrations',
  sha256:hash('Pinned approved B1 style bytes')};
const script:ApprovedScriptSnapshot={projectId:'a'.repeat(24),
  sha256:hash(line),revision:1,sections:[{id:'opening',text:line}],authoring:{}};
const row=():ScriptCharacter=>({
  char_id:'char_001',label:name,description:'Narrative identity only',
  narrative_role:'Actor in narration',explicit_visual_traits:['scar'],
  visual_trait_evidence:[{trait:'scar',relationship:'intrinsic_appearance',
    source:{section_id:'opening',quote,start:0,end:quote.length}}],
  identity_markers:[],continuity_notes:[],physical_constraints:[],
  occurrences:[{section_id:'opening',quote:name,start:0,end:name.length}],
  presence_ranges:[{start:0,end:name.length}]
});
const analysis=():ScriptAnalysis=>({
  schema:'stickman-script-analysis-v1',project_id:script.projectId,
  source_script_sha256:script.sha256,
  source_authoring_sha256:contentHash(script.authoring),
  continuity_catalog:{characters:[row()]}
});
function historical(kind:'human_character'|'human_group'){
  const character={...row(),entity_kind:kind};
  const original={...analysis(),continuity_catalog:{characters:[character]}};
  const inherited=structuredClone(character);
  const derived={...inherited,source_definition_hash:contentHash({inherited,
    styleId:pinned.id,styleSha:pinned.sha256}),
    visual_readiness:'READY_FOR_REFERENCE' as const};
  const base={schema:'stickman-project-style-bible-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),
    analysis_sha256:contentHash(original),style_profile_id:pinned.id,
    style_profile_sha256:pinned.sha256,
    style_guidance_sha256:hash(pinned.guidance),characters:[derived]};
  const bible={...base,style_bible_sha256:contentHash(base)} as StyleBible;
  return{original,bible};
}
describe('EK reference-first new schema and read-only historical boundary',()=>{
  it('EK-01/EK-02 new Script Analysis accepts no kind and rejects retired field',()=>{
    expect(validateScriptAnalysis(analysis(),script)).toEqual(analysis());
    expect(()=>validateScriptAnalysis(historical('human_group').original,script))
      .toThrow('IDENTITY_SCHEMA_EXTRA');
    expect(loadSchema('analysis').$defs?.character?.required).not.toContain('entity_kind');
    expect(loadSchema('analysis').$defs?.character?.properties).not.toHaveProperty('entity_kind');
  });
  it('EK-03/EK-05 new Style Bible is taxonomy-free, with four neutral 1:1 views',()=>{
    const bible=compileStyleBible(analysis(),script,pinned);
    expect(JSON.stringify(bible.characters)).not.toContain('entity_kind');
    expect(loadSchema('bible').$defs?.character?.properties).not.toHaveProperty('entity_kind');
    const prompt=referencePromptForCharacter(bible,'char_001',pinned);
    expect(prompt.aspect_ratio).toBe('1:1');
    for(const view of ['Upper-left: front close-up','Upper-right: front full',
      'Lower-left: side view','Lower-right: back view'])
      expect(prompt.prompt).toContain(view);
    expect(prompt.prompt).not.toContain('face and shoulders');
    expect(prompt.prompt).not.toContain('ONE GROUP OVERVIEW');
  });
  it('EK-05 labels human/animal/robot/fictional do not drive image anatomy or format',()=>{
    const prompts:string[]=[];
    for(const label of ['Human A','Animal A','Robot A','Imaginary A']){
      const candidate=analysis();
      candidate.continuity_catalog.characters[0].label=label;
      const bible=compileStyleBible(candidate,script,pinned);
      const rendered=referencePromptForCharacter(bible,'char_001',pinned);
      expect(rendered.aspect_ratio).toBe('1:1');
      expect(rendered.prompt).toContain('Exactly FOUR');
      expect(rendered.prompt).toContain('No assumed human anatomy');
      expect(rendered.prompt).not.toContain(label);
      expect(bible.characters[0]).not.toHaveProperty('entity_kind');
      prompts.push(rendered.prompt);
    }
    expect(new Set(prompts).size).toBe(1);
  });
  it('EK-07 owner-requested group overview is only a per-request output format',()=>{
    const bible=compileStyleBible(analysis(),script,pinned);
    const group=referencePromptForCharacter(bible,'char_001',pinned,
      undefined,'group_overview');
    const four=referencePromptForCharacter(bible,'char_001',pinned);
    expect(group.aspect_ratio).toBe('1:1');
    expect(group.prompt).toContain('ONE GROUP OVERVIEW');
    expect(group.prompt).not.toContain('Upper-left:');
    expect(group.prompt_sha256).not.toBe(four.prompt_sha256);
    expect(bible.characters[0]).not.toHaveProperty('entity_kind');
  });
  it('EK-06/EK-10 original legacy group Bible/SHA and job prompt stay byte-exact',()=>{
    const {original,bible}=historical('human_group');
    expect(isFrozenLegacyAnalysis(original)).toBe(true);
    const baseline=canonical(bible),oldSha=bible.style_bible_sha256;
    const verified=validateHistoricalPublishedBible(original,script,pinned,bible);
    expect(canonical(verified)).toBe(baseline);
    expect(verified.style_bible_sha256).toBe(oldSha);
    const frozen=frozenLegacyReferencePrompt(verified,'char_001',pinned);
    expect(frozen.prompt).toContain('ONE GROUP OVERVIEW');
    expect(frozen.prompt).not.toContain('Upper-left:');
    expect(frozen.prompt_sha256).toBe(hash(frozen.prompt));
    expect(()=>validateHistoricalPublishedBible(original,script,pinned,
      {...bible,style_bible_sha256:'0'.repeat(64)}))
      .toThrow('IDENTITY_LEGACY_PUBLISHED_BIBLE_TAMPERED');
  });
  it('EK-19 historical individual frozen prompt retains original four-view bytes',()=>{
    const {original,bible}=historical('human_character');
    const verified=validateHistoricalPublishedBible(original,script,pinned,bible);
    const old=frozenLegacyReferencePrompt(verified,'char_001',pinned);
    expect(old.prompt).toContain('Upper-left: front close-up face and shoulders.');
    expect(old.prompt).toContain('Lower-right: back full body, head to feet.');
    expect(old.prompt).not.toContain('ONE GROUP OVERVIEW');
    expect(old.prompt).toContain(String.fromCharCode(10));
    expect(old.prompt).not.toContain(String.fromCharCode(92,110,92,110));
  });
});
