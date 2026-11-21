import {describe,it,expect} from 'vitest';
import {hash,contentHash,readAndValidate,loadSchema} from '../../src/main/identity/contracts';
import {validateScriptAnalysis,freezeAnalysisTask,validateAnalysisEnvelope,
  verifyIndependentReview} from '../../src/main/identity/scriptAnalysis';
import {compileStyleBible,referencePromptForCharacter,
  validateStyleBibleCurrent} from '../../src/main/identity/styleBible';
import {validateNativeIdentityNeeds} from '../../src/main/identity/nativeNeeds';
import {identityPolicy} from '../../src/main/identity/identityWorkflow';
import type {StudioState} from '../../src/main/services';
const projectId='a'.repeat(24);
const text='Kip enters the camp.\n\nBrog follows Kip.';
const authoring={characters:['Kip','Brog']};
const sections=[{id:'sec_001',text:'Kip enters the camp.'},
  {id:'sec_002',text:'Brog follows Kip.'}];
const script={projectId,sha256:hash(text),authoring,revision:1,sections};
const second=text.lastIndexOf('Kip');
const entry=()=>({char_id:'char_001',label:'Kip',description:'',
  entity_kind:'human_character' as const,narrative_role:'Character in approved narration',
  explicit_visual_traits:[],identity_markers:['Kip'],
  continuity_notes:[],physical_constraints:[],
  occurrences:[{section_id:'sec_001',quote:'Kip',start:0,end:3},
    {section_id:'sec_002',quote:'Kip',start:second,end:second+3}],
  presence_ranges:[{start:0,end:3},{start:second,end:second+3}]});
const analysis=()=>({schema:'stickman-script-analysis-v1' as const,project_id:projectId,
  source_script_sha256:script.sha256,
  source_authoring_sha256:contentHash(authoring),
  continuity_catalog:{characters:[entry()]}});
const style={id:'B1' as const,guidance:'Approved simple hand-drawn identity style.',
  sha256:hash('Approved simple hand-drawn identity style.')};
describe('F24 upstream source-grounded contract gates',()=>{
  it('U02 rejects unknown fields, duplicate IDs and duplicate nested JSON keys',()=>{
    expect(()=>validateScriptAnalysis(analysis(),script)).not.toThrow();
    expect(()=>validateScriptAnalysis({...analysis(),extra:'untrusted'},script))
      .toThrow('IDENTITY_SCHEMA_EXTRA');
    expect(()=>validateScriptAnalysis({...analysis(),
      continuity_catalog:{characters:[entry(),entry()]}},script))
      .toThrow('IDENTITY_SCHEMA_DUPLICATE');
    const corrupt=JSON.stringify(analysis()).replace('"label":"Kip"',
      '"label":"Kip","label":"Impostor"');
    expect(()=>readAndValidate(loadSchema('analysis'),corrupt))
      .toThrow('IDENTITY_JSON_DUPLICATE_KEY');
  });
  it('U03 demands exact UTF-16 source quote and matching section ID',()=>{
    const bad=analysis();bad.continuity_catalog.characters[0].occurrences[0].quote='Not Kip';
    expect(()=>validateScriptAnalysis(bad,script)).toThrow('SCRIPT_ANALYSIS_QUOTE_OR_SPAN_INVALID');
    const foreign=analysis();foreign.continuity_catalog.characters[0].occurrences[0].section_id='sec_999';
    expect(()=>validateScriptAnalysis(foreign,script)).toThrow('SCRIPT_ANALYSIS_UNKNOWN_SECTION');
  });
  it('U03a rejects unsupported appearance traits even when an actor quote is valid',()=>{
    const invented=analysis();
    invented.continuity_catalog.characters[0].explicit_visual_traits=[
      'neon green eyes that are not in the approved narration'
    ];
    expect(()=>validateScriptAnalysis(invented,script))
      .toThrow('SCRIPT_ANALYSIS_UNSUPPORTED_VISUAL_TRAIT');
  });
  it('U04 has a separate frozen task envelope not spoofed as Native',()=>{
    const task=freezeAnalysisTask(script,'author',1);
    expect(task.stage).toBe('script_analysis');
    const response={schema:'mode-b-identity-external-result-v1',project_id:projectId,
      task_id:task.task_id,revision:task.revision,input_sha256:task.input_sha256,
      stage:'script_analysis',payload:analysis()};
    expect(()=>validateAnalysisEnvelope(response,task,script)).not.toThrow();
    expect(()=>validateAnalysisEnvelope({...response,stage:'native'},task,script))
      .toThrow('SCRIPT_ANALYSIS_ENVELOPE_INVALID');
  });
  it('U05 rejects unreviewed authoritative identity defects',()=>{
    const review={schema:'stickman-analysis-review-v1' as const,project_id:projectId,
      analysis_sha256:contentHash(analysis()),independent_review:true as const,
      approved:true,findings:[{finding_id:'F01',severity:'P1' as const,
        location:'char_001',issue:'unsupported trait',evidence:'exact quote'}]};
    expect(()=>verifyIndependentReview(review,analysis()))
      .toThrow('SCRIPT_ANALYSIS_REVIEW_INVALID');
  });
  it('U07/U08/U09 preserves an empty catalog and never invents appearance',()=>{
    expect(compileStyleBible({...analysis(),continuity_catalog:{characters:[]}},
      script,style).characters).toEqual([]);
    const unchanged=analysis(),bible=compileStyleBible(unchanged,script,style);
    expect(bible.characters[0].char_id).toBe('char_001');
    expect(bible.characters[0].occurrences).toEqual(entry().occurrences);
    expect(validateStyleBibleCurrent(bible,unchanged,script,style)).toBe(true);
    const unknown=analysis();unknown.continuity_catalog.characters[0].identity_markers=[];
    const incomplete=compileStyleBible(unknown,script,style);
    expect(incomplete.characters[0].visual_readiness).toBe('NEEDS_OWNER_DEFINITION');
    expect(()=>referencePromptForCharacter(incomplete,'char_001',style))
      .toThrow('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
  });
  it('U09/R10 pins full B1–B4 source SHA separately from extracted guidance text SHA',()=>{
    const pinned={...style,sha256:'c'.repeat(64)};
    const bible=compileStyleBible(analysis(),script,pinned);
    expect(bible.style_profile_sha256).toBe(pinned.sha256);
    expect(bible.style_guidance_sha256).toBe(hash(pinned.guidance));
    expect(bible.style_guidance_sha256).not.toBe(bible.style_profile_sha256);
    expect(()=>referencePromptForCharacter(bible,'char_001',pinned)).not.toThrow();
  });
  it('R01/R02 compiles a single 1:1 four-view human or single group overview',()=>{
    const bible=compileStyleBible(analysis(),script,style);
    const prompt=referencePromptForCharacter(bible,'char_001',style);
    expect(prompt.aspect_ratio).toBe('1:1');
    expect(prompt.prompt).toMatch(/Upper-left: front close-up/);
    expect(prompt.prompt).toMatch(/Lower-right: back full body/);
    const group={...analysis(),continuity_catalog:{characters:[
      {...entry(),entity_kind:'human_group' as const}
    ]}};
    const sheet=compileStyleBible(group,script,style);
    const groupPrompt=referencePromptForCharacter(sheet,'char_001',style);
    expect(groupPrompt.prompt).toContain('ONE GROUP OVERVIEW');
    expect(groupPrompt.prompt).not.toContain('Upper-left:');
  });
  it('N02/N03 requires exact typed cast, validates DAG and rejects unknown characters',()=>{
    const bible=compileStyleBible(analysis(),script,style);
    const targets=[{shotId:'s1',layerId:'l1',path:'assets/images/a.png'},
      {shotId:'s2',layerId:'l2',path:'assets/images/b.png'}];
    const first={shot_id:'s1',layer_id:'l1',expected_path:targets[0].path,
      content:'Real character action',character_ids:['char_001']};
    const second={shot_id:'s2',layer_id:'l2',expected_path:targets[1].path,
      content:'Real empty-cast action',character_ids:[],continuity_source:{
        shot_id:'s1',layer_id:'l1',relation:'same_setup'}};
    expect(validateNativeIdentityNeeds([first,second],targets,bible,'v1').status).toBe('READY');
    expect(()=>validateNativeIdentityNeeds([{...first,character_ids:['char_999']},second],
      targets,bible,'v1')).toThrow('NATIVE_IDENTITY_UNKNOWN_CHARACTER');
    expect(()=>validateNativeIdentityNeeds([first],targets,bible,'v1'))
      .toThrow('NATIVE_IDENTITY_DECLARATION_MISSING');
  });
  it('U12 defaults missing identityPolicy to LEGACY and honors v1 opt-in',()=>{
    expect(identityPolicy({} as StudioState)).toBe('legacy');
    expect(identityPolicy({identityPolicy:'v1'} as StudioState)).toBe('v1');
  });
});
