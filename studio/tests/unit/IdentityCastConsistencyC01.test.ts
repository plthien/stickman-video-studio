// @vitest-environment node
import {describe,expect,it} from 'vitest';
import type {NativeImageNeedV2,StyleBible,BibleCharacter} from '../../src/main/identity/contracts';
import {validateNativeIdentityNeeds,detectPublishedCharacterMentions,
  assertNativeCastConsistency} from '../../src/main/identity/nativeNeeds';

const character=(id:`char_${string}`,label:string,aliases:string[]=[]):BibleCharacter=>({
  char_id:id,label,entity_kind:'human_character',description:'',
  narrative_role:'Source-grounded actor',explicit_visual_traits:[],
  identity_markers:aliases,continuity_notes:[],physical_constraints:[],
  visual_readiness:'NEEDS_OWNER_DEFINITION',
  source_definition_hash:'a'.repeat(64),
  occurrences:[{section_id:'s1',quote:label,start:0,end:label.length},
    ...aliases.map(name=>({section_id:'s1',quote:name,start:0,end:name.length}))],
  presence_ranges:[{start:0,end:20}]
});
const kip=character('char_001','Kip'),mara=character('char_002','Mara');
const known=[kip,mara,character('char_003','Ann',['Little Ann']),
  character('char_004','Élise')];
const bible=(characters:BibleCharacter[]=known)=>({
  style_bible_sha256:'b'.repeat(64),characters
}) as StyleBible;
const target=[{shotId:'s1',layerId:'image-1',path:'assets/images/image-1.png'}];
const need=(content:string,asset_kind:NativeImageNeedV2['asset_kind']='background',
  character_ids:NativeImageNeedV2['character_ids']=[]):NativeImageNeedV2=>({
  shot_id:'s1',layer_id:'image-1',expected_path:target[0].path,
  content,asset_kind,character_ids
});
const check=(row:NativeImageNeedV2,catalog=bible())=>
  validateNativeIdentityNeeds([row],target,catalog,'v1');

describe('F24-C01 source-grounded cast consistency and ambiguous alias gates',()=>{
  it('C01-01 background pretending to be empty while depicting Kip fails',()=>{
    expect(()=>check(need('Kip stands in foreground, looking at camera.')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_001');
  });
  it('C01-02 other kind cannot hide Kip',()=>{
    expect(()=>check(need('KIP runs across the frame.','other')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_001');
  });
  it('C01-03 exact approved canonical ID passes',()=>{
    expect(check(need('Kip stands in the frame.','character',['char_001'])).status)
      .toBe('READY');
  });
  it('C01-04 two explicitly present actors with only one cast fail',()=>{
    expect(()=>check(need('Kip and Mara walk across the field.',
      'character',['char_001'])))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_002');
  });
  it('C01-05 two approved actors and both cast pass',()=>{
    expect(check(need('Kip and Mara walk across the field.',
      'character',['char_001','char_002'])).status).toBe('READY');
  });
  it('C01-06 a true character-free environment retains empty cast',()=>{
    expect(check(need('Wind moves through a mountain canyon with no people.'))
      .rows[0].character_ids).toEqual([]);
  });
  it('C01-07 Ann does not match anniversary or banner',()=>{
    expect(check(need('Anniversary banner hangs above the empty street.'))
      .status).toBe('READY');
    expect(()=>check(need('Ann enters the empty street.')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_003');
  });
  it('C01-08 token, punctuation, case, Unicode, multiword aliases',()=>{
    expect(detectPublishedCharacterMentions('“Little Ann,” meets ÉLISE!',bible())
      .map(m=>m.charId)).toEqual(['char_003','char_004']);
    expect(()=>check(need('“Little Ann,” meets ÉLISE!','background')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING');
  });
  it('C01-09 identical source-evidenced alias for two actors requires review',()=>{
    const a=character('char_001','Kip',['Fox']);
    const b=character('char_002','Mara',['Fox']);
    expect(()=>check(need('Fox steps forward.'),bible([a,b])))
      .toThrow('NATIVE_IDENTITY_ALIAS_REVIEW_REQUIRED');
  });
  it('C01-10 candidate Mara cannot become current actor without Publish',()=>{
    const published=bible([kip]);
    expect(check(need('Mara looks into the lens.'),published).status)
      .toBe('READY');
    expect(()=>check(need('Mara looks into the lens.'),bible([kip,mara])))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_002');
  });
  it('C01-13 forbidden empty cast and mismatched asset kind stay gated',()=>{
    expect(()=>check(need('Kip stands here.','character')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_REQUIRED');
    expect(()=>check(need('Kip stands here.','background',['char_001'])))
      .toThrow('NATIVE_IDENTITY_ASSET_KIND_CONFLICT');
  });
  it('C01-14 legacy native contract is not changed',()=>{
    expect(validateNativeIdentityNeeds([need('Kip stands in scene.')],
      target,bible(),'legacy').status).toBe('LEGACY');
  });
  it('C01 stable ID cannot bypass a missing canonical binding',()=>{
    expect(()=>check(need('char_001 appears on screen.')))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: char_001');
  });
  it('C01 ambiguous prop ownership requires owner Native review',()=>{
    expect(()=>check(need("Kip's red hat is lying on a shelf.",'prop')))
      .toThrow('NATIVE_IDENTITY_CAST_REVIEW_REQUIRED');
  });
  it('C01 negative appearance instructions do not silently bind an actor',()=>{
    expect(()=>check(need('Do not include Kip anywhere in the background.')))
      .toThrow('NATIVE_IDENTITY_CAST_REVIEW_REQUIRED');
  });
});
