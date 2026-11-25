// @vitest-environment node
import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {compileAuthority,nativeAnimationDirection,nativeReferenceInventory} from '../../src/main/externalAuthority';
import {nativeSkillRoot,sha,b4AcceptedNarrator,assertB4NarratorBinding,type StudioState} from '../../src/main/services';
import {nativePlanPreflight} from '../../src/main/nativePlanPreflight';
import {matchesExplicitAssetRatio} from '../../src/main/glabs';
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

describe('R2 all four creative style selectors',()=>{
  it('fails closed on missing source, and extracts original text for B1/B2/B3/B4 script and native',()=>{
    const appPath=path.resolve('.');
    for(const style of ['B1','B2','B3','B4']){
      const author=compileAuthority(appPath,style,'script','author');
      const native=compileAuthority(appPath,style,'native','author');
      expect(author.sources.length).toBeGreaterThanOrEqual(5);
      expect(native.sources.length).toBeGreaterThanOrEqual(6);
      expect(author.sources.some(item=>item.path==='references/autopilot-runtime.md')).toBe(false);
      expect(native.sources.some(item=>item.path==='references/autopilot-runtime.md')).toBe(true);
      for(const item of [...author.sources,...native.sources]){
        expect(sha(fs.readFileSync(path.join(nativeSkillRoot(appPath).root,item.path)))).toBe(item.sha256);
        expect(sha(item.text)).toBe(item.extractionSha256);
      }
    }
  });
});
describe('R2 source-exact creative authority',()=>{
  it('preserves B4 creative and opening/audio text from installed original sources',()=>{
    const appPath=path.resolve('.');
    const pack=compileAuthority(appPath,'B4','script','author');
    const names=pack.sources.map(source=>source.path);
    expect(names).toContain('references/b4-survival-storytelling.md');
    expect(names).toContain('references/b4-opening-direction.md');
    expect(names).toContain('references/b4-audio-direction.md');
    expect(names).not.toContain('references/autopilot-runtime.md');
    for(const source of pack.sources){
      const original=fs.readFileSync(path.join(nativeSkillRoot(appPath).root,source.path));
      expect(source.sha256).toBe(sha(original));
      expect(source.extractionSha256).toBe(sha(source.text));
      expect(source.text).not.toContain('Applicable compact normative rules:');
      expect(source.text.length).toBeGreaterThan(50);
    }
    expect(pack.sources.find(source=>source.path.includes('b4-opening-direction'))?.text).toContain('First-three-second visual escalation gate');
    expect(pack.sources.find(source=>source.path.includes('b4-audio-direction'))?.text).toContain('First-frame audio gate');
  });
  it('retains original native runtime and QA contracts without copying a generic summary',()=>{
    const pack=compileAuthority(path.resolve('.'),'B4','native','correct');
    for(const needed of ['references/autopilot-runtime.md','references/autopilot-production-qa.md','references/autopilot-sound-system.md']){
      expect(pack.sources.find(source=>source.path===needed)?.text.length).toBeGreaterThan(1000);
    }
  });
});


describe('Original Native production authority',()=>{
  it('includes selected-style production supplement and actual reference inventory for Native operations',()=>{
    const appPath=path.resolve('.');
    for(const operation of ['author','review','correct','recheck'] as const){
      for(const style of ['B1','B2','B3','B4']){
        const compiled=compileAuthority(appPath,style,'native',operation);
        expect(compiled.sources.some(row=>row.path==='references/b1-production-qa.md')).toBe(style==='B1');
        expect(compiled.referenceMedia?.length).toBeGreaterThan(0);
        expect(compiled.referenceMedia?.every(row=>row.style===style&&row.transferStatus==='LOCAL_ONLY_NOT_TRANSFERRED')).toBe(true);
      }
    }
    expect(compileAuthority(appPath,'B1','script','author').sources.some(row=>row.path==='references/b1-production-qa.md')).toBe(false);
    const media=nativeReferenceInventory(appPath,'B3');
    expect(media.some(row=>row.path.endsWith('accepted-dog-motion.mp4'))).toBe(true);
    for(const row of media)expect(row.sha256).toBe(sha(fs.readFileSync(path.join(nativeSkillRoot(appPath).root,row.path))));
  });
  it('keeps B3-specific mechanisms and B4 deliberate-hold exception explicit',()=>{
    expect(nativeAnimationDirection('B1')).toContain('2.5-second');
    expect(nativeAnimationDirection('B3')).toContain('group-local coordinates');
    expect(nativeAnimationDirection('B4')).toContain('Do not impose B1–B3 inactivity quota');
  });
});


describe('Explicit Native asset ratios',()=>{
  it('checks all supported explicit ratios, allowing integer-pixel rounding only',()=>{
    expect(matchesExplicitAssetRatio(1024,1024,'1:1')).toBe(true);
    expect(matchesExplicitAssetRatio(1080,1920,'9:16')).toBe(true);
    expect(matchesExplicitAssetRatio(1920,1080,'16:9')).toBe(true);
    expect(matchesExplicitAssetRatio(768,1024,'3:4')).toBe(true);
    expect(matchesExplicitAssetRatio(1024,768,'4:3')).toBe(true);
    expect(matchesExplicitAssetRatio(1024,1024,'9:16')).toBe(false);
    expect(matchesExplicitAssetRatio(0,1024,'1:1')).toBe(false);
  });
});

describe('Original pre-media plan checks',()=>{
  const app=path.resolve('.');
  const manifest=(style:string,keys:unknown[])=>({version:1,style,width:1080,height:1920,fps:30,
    shots:[{id:'shot-1',start:0,end:3,layers:[{id:'actor-1',type:'image',path:'assets/images/not-yet-generated.png',w:300,h:400,x:100,y:100,
      motion:{role:'actor',reason:'Approaches the door'},keys}]}]});
  it('rejects original B1 inactivity before image generation, without fake assets',()=>{
    expect(()=>nativePlanPreflight(app,app,manifest('B1',[{t:0,x:100},{t:3,x:100}]),3)).toThrow(/principal picture inactive/);
  });
  it('runs original plan checks but never claims rendered pixel verification',()=>{
    expect(nativePlanPreflight(app,app,manifest('B1',[{t:0,x:100},{t:3,x:300}]),3))
      .toEqual({plan:'PASS',media:'NOT_VERIFIED',renderedPixels:'NOT_VERIFIED'});
  });
  it('rejects unsupported keyframe grammar',()=>{
    expect(()=>nativePlanPreflight(app,app,manifest('B2',[{t:0,rotation:0}]),3)).toThrow(/Unsupported keyframe property/);
  });
  it('preserves B4 inactivity exception',()=>{
    expect(nativePlanPreflight(app,app,manifest('B4',[]),3).renderedPixels).toBe('NOT_VERIFIED');
  });
});
describe('B4 accepted narrator provenance',()=>{
  const voice:NonNullable<StudioState['voice']>={path:'assets/audio/narration.wav',sha256:'a'.repeat(64),
    generatedAt:'2026-11-25T00:00:00Z',origin:'NANO_GENERATED',profileId:'selected-nano-profile',profileVersion:2,referenceBinding:'proof',receipt:{verified:true}};
  it('records the selected profile and rejects a falsely labeled Brian',()=>{
    const identity=b4AcceptedNarrator(voice)!;
    expect(identity.id).toBe('nano:selected-nano-profile');
    expect(identity.user_override).toContain(voice.sha256);
    expect(()=>assertB4NarratorBinding('B4',voice,{name:'Brian',id:'nPczCjzI2devNBz1zQrb'})).toThrow(/METADATA_MISMATCH/);
    expect(()=>assertB4NarratorBinding('B4',voice,identity)).not.toThrow();
    expect(()=>assertB4NarratorBinding('B1',voice,{})).not.toThrow();
  });
  it('does not represent an imported WAV as verified Brian',()=>{
    expect(b4AcceptedNarrator({...voice,origin:'IMPORTED_WAV'})?.name).toContain('speaker unverified');
  });
});
