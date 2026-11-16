// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {validateLocks} from '../../src/main/externalLifecycle';

describe('R2 original-artifact scoped correction regression',()=>{
  const script=()=>({
    schema:'mode-b-script-v1',
    sections:Array.from({length:6},(_,i)=>({id:'sec_00'+(i+1),text:'Approved original section '+(i+1)+'.'})),
    authoring:{creative_direction:{premise:'Storm and survival'},characters:[{id:'hero',description:'same protagonist'}],
      continuity:{rules:['The same character survives throughout the story']}}
  });
  it('permits only section 2 and section 5 changes in a six-section Script',()=>{
    const before=script(),after=structuredClone(before);
    after.sections[1].text='A new real causal escalation.';
    after.sections[4].text='The payoff resolves the danger.';
    expect(()=>validateLocks('script',before,after,['sec_002','sec_005'],[])).not.toThrow();
    after.sections[2].text='Unauthorized rewrite';
    expect(()=>validateLocks('script',before,after,['sec_002','sec_005'],[])).toThrow(/Locked/);
  });
  it('rejects script authoring/character identity mutation even if one section is editable',()=>{
    const before=script(),after=structuredClone(before);
    after.authoring.characters[0].description='unapproved new character';
    expect(()=>validateLocks('script',before,after,['sec_002'],[])).toThrow(/Locked/);
  });
  const native=()=>({
    manifest:{version:1,style:'B4',voice:{path:'assets/audio/narration.wav',lead:0},
      captions:[{start:0,end:1,text:'unchanged'}],opening:{kind:'b4-hook-v1'},
      shots:Array.from({length:25},(_,i)=>({id:'shot_'+String(i+1).padStart(3,'0'),start:i,end:i+1,
        layers:[{id:'layer_1',path:'assets/images/accepted.png',opacity:1}]})),
      sfx:[],ambience:[],music:[],fps:30,width:1080,height:1920},
    shot_ledger:[{shot_id:'shot_001',character_id:'hero'}],
    sound_script:[{target_id:'shot_001',intent:'impact'}],
    asset_needs:[]
  });
  it('permits three shots and preserves 22 other shots plus global fields',()=>{
    const before=native(),after=structuredClone(before);
    for(const id of ['shot_003','shot_010','shot_022']){
      const shot=after.manifest.shots.find(item=>item.id===id)!;
      shot.layers[0].opacity=.75;
    }
    expect(()=>validateLocks('native',before,after,['shot_003','shot_010','shot_022'],[])).not.toThrow();
    after.manifest.shots[0].layers[0].opacity=.2;
    expect(()=>validateLocks('native',before,after,['shot_003','shot_010','shot_022'],[])).toThrow(/Locked/);
  });
  it('rejects global style, sound/asset ledger, voice and caption mutations',()=>{
    const before=native();
    const changedStyle=structuredClone(before);changedStyle.manifest.opening.kind='new-unapproved-hook';
    expect(()=>validateLocks('native',before,changedStyle,['shot_003'],[])).toThrow(/Locked/);
    expect(()=>validateLocks('native',before,changedStyle,[],['/manifest/opening'])).not.toThrow();
    const changedLedger=structuredClone(before);changedLedger.sound_script[0].intent='random explosion';
    expect(()=>validateLocks('native',before,changedLedger,['shot_003'],[])).toThrow(/Locked/);
    const changedVoice=structuredClone(before);changedVoice.manifest.voice.lead=3;
    expect(()=>validateLocks('native',before,changedVoice,[],['/manifest/voice'])).toThrow(/immutable/);
    const changedCaptions=structuredClone(before);changedCaptions.manifest.captions[0].text='wrong speech';
    expect(()=>validateLocks('native',before,changedCaptions,[],['/manifest/captions'])).toThrow(/immutable/);
  });
  it('rejects reordered or removed shot identities even if one is editable',()=>{
    const before=native(),after=structuredClone(before);
    [after.manifest.shots[0],after.manifest.shots[1]]=[after.manifest.shots[1],after.manifest.shots[0]];
    expect(()=>validateLocks('native',before,after,['shot_001','shot_002'],[])).toThrow(/ordering/);
    after.manifest.shots.pop();
    expect(()=>validateLocks('native',before,after,['shot_001','shot_002'],[])).toThrow(/structural/);
  });
});
