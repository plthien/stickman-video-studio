// @vitest-environment node
import {describe,expect,it} from 'vitest';
import type {NativeImageNeedV2,StyleBible,BibleCharacter} from '../../src/main/identity/contracts';
import {validateNativeIdentityNeeds} from '../../src/main/identity/nativeNeeds';
import {exactNativeTargetBindingHash,type ApprovedAnchor} from '../../src/main/identity/nativeBinding';

const character=(id:`char_${string}`,label:string,aliases:string[]=[]):BibleCharacter=>({
  char_id:id,label,description:'',
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

describe('AI-first structured Native cast, no lexical inference',()=>{
  it('G11/G12 arbitrary prose, capitalization and alias words never alter declared cast',()=>{
    for(const content of ['KIP and Mara stand in foreground','A man, woman, boy, robot, animal and creature',
      '“Little Ann,” meets ÉLISE!','char_001 char_999 One large rock','Không có người. Một con rồng máy.']){
      const declared=need(content,'background',[]);
      expect(check(declared).rows[0]).toEqual(declared);
      const explicit=need(content,'character',['char_001','char_004']);
      expect(check(explicit).rows[0]).toEqual(explicit);
    }
  });
  it('G11/G13 only explicit valid IDs authorize canonical lookup',()=>{
    expect(()=>check(need('Unrelated creative prose','character',['char_999'])))
      .toThrow('NATIVE_IDENTITY_UNKNOWN_CHARACTER');
    expect(()=>check(need('Kip stands here.','character',[])))
      .toThrow('NATIVE_IDENTITY_CHARACTER_CAST_REQUIRED');
    expect(()=>check(need('Kip','character',['char_001','char_001']))).toThrow();
    expect(()=>check(need('Mara','character',['char_002']),bible([kip])))
      .toThrow('NATIVE_IDENTITY_UNKNOWN_CHARACTER');
    expect(check(need('Mara','character',['char_002']),bible([kip,mara])).status).toBe('READY');
  });
  it('G11/G12 non-English, fictional and ambiguous aliases are not scanned',()=>{
    const catalog=bible([character('char_001','龍',['Fox']),character('char_002','Rồng máy',['Fox'])]);
    const row=need('Fox, 龍, Rồng máy and an unnamed animal','character',['char_002']);
    expect(check(row,catalog).rows[0]).toEqual(row);
    expect(check(need('A generic crowd enters the street.'),catalog).rows[0].character_ids).toEqual([]);
  });
  it('RFG-08 two source-established characters bind separate canonical anchors in one Native Shot',()=>{
    const declared=check(need('Kip and Mara walk across the field.',
      'character',['char_001','char_002'])).rows[0];
    const anchors:ApprovedAnchor[]=['char_001','char_002'].map((id,index)=>({
      charId:id,sourceDefinitionHash:String(index+1).repeat(64),
      path:'assets/images/ref-'+id+'.png',sha256:String(index+3).repeat(64),
      mime:'image/png' as const,rightsSha256:String(index+5).repeat(64),
      candidateId:'candidate-'+id,approvalEventId:'approved-'+id
    }));
    const resolved=declared.character_ids.map(id=>anchors.find(a=>a.charId===id)!);
    expect(resolved.map(a=>a.charId)).toEqual(['char_001','char_002']);
    expect(new Set(resolved.map(a=>a.path)).size).toBe(2);
    expect(new Set(resolved.map(a=>a.sha256)).size).toBe(2);
    const common={targetKey:'s1/image-1/assets/images/image-1.png',
      shotId:'s1',layerId:'image-1',path:target[0].path,
      assetKind:declared.asset_kind,characterIds:declared.character_ids,
      continuitySource:null,styleProfileSha:'b'.repeat(64)};
    const both=exactNativeTargetBindingHash({...common,canonicalAnchors:resolved});
    const missing=exactNativeTargetBindingHash({...common,
      canonicalAnchors:resolved.slice(0,1)});
    expect(both).not.toBe(missing);
    expect(declared).not.toHaveProperty('group_id');
    expect(declared).not.toHaveProperty('entity_kind');
  });
  it('C01-14 historical legacy contract is not changed',()=>{
    expect(validateNativeIdentityNeeds([need('Kip stands in scene.')],target,bible(),'legacy').status).toBe('LEGACY');
  });
});
