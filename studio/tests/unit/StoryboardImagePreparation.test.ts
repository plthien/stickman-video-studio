// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {prepareNativeImages,saveNativeImagePrompt,loadImageStyleProfile,compileImageJobSpecs} from '../../src/main/imagePreparation';
import {readNativeDraft,nativeImageTargetIdentity,publishNativeDraftCorrection} from '../../src/main/externalTasks';
import {readState,sha} from '../../src/main/services';
import {appPath,cleanup,fixture,nativePayload,stageNative} from './SixIssueFixtures';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();cleanup();});

function staged(style:'B1'|'B2'|'B3'|'B4'='B1',both=false,legacy=false,samePath=false){
  const {root}=fixture({style});
  const payload=nativePayload(root,{image:both?'both':'early',sameBasename:samePath}) as unknown as {
    manifest:Record<string,unknown>;shot_ledger:unknown[];sound_script:unknown[];asset_needs:unknown[]
  };
  const rows=[
    {shot_id:'shot-1',layer_id:'image-1',expected_path:'assets/images/missing.png',content:'A tiny hand-drawn red kite, isolated and centered, no captions.',orientation:'transparent PNG',continuity:'Preserve red color and exact kite silhouette.'},
    {shot_id:'shot-2',layer_id:'image-2',expected_path:samePath?'assets/images/missing.png':'assets/images/late.png',content:'A navy fabric backpack, side view with one visible shoulder strap.',orientation:'transparent PNG',continuity:'Keep strap attached, navy color consistent.'}
  ];
  payload.asset_needs=(both?rows:rows.slice(0,1)).map(row=>legacy?
    'MISSING_REQUIRED_VISUAL | shot_id='+row.shot_id+' | layer_id='+row.layer_id+
    ' | expected_path='+row.expected_path+' | orientation='+row.orientation+
    ' | content='+row.content+' | shot_use=Actual frozen Shot requirements | continuity='+row.continuity+
    ' | availability=NOT_PRESENT':row);
  payload.shot_ledger=[
    {shot_id:'shot-1',composition:'Single centered red kite against the approved setting.',visual_action:'Kite moves across screen'},
    {shot_id:'shot-2',composition:'Navy backpack close-up with the strap readable.'}
  ];
  stageNative(root,payload);
  return{root,payload};
}
describe('StoryBoard Phase-1 source-grounded compiler and exact Native media queue',()=>{
  it('P1-01 inherits approved installed B1–B4 style sources with immutable SHA',()=>{
    for(const style of ['B1','B2','B3','B4'] as const){
      const profile=loadImageStyleProfile(appPath,style);
      expect(profile.id).toBe(style);
      expect(profile.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(profile.guidance).not.toBe('');
      expect(profile.path).not.toEqual('generic-stickman');
    }
    expect(loadImageStyleProfile(appPath,'B4').anchors).toHaveLength(5);
  });
  it('B4-WIN-01 verifies the pinned published B4 SHA for CRLF-only Windows checkout conversion',()=>{
    const expected=loadImageStyleProfile(appPath,'B4');
    const actualRead=fs.readFileSync;
    vi.spyOn(fs,'readFileSync').mockImplementation(((...args:unknown[])=>{
      const value=Reflect.apply(actualRead,fs,args) as Buffer|string;
      return String(args[0]).endsWith('style-lock.txt')&&typeof value==='string'?
        value.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'):value;
    }) as typeof fs.readFileSync);
    const checked=loadImageStyleProfile(appPath,'B4');
    expect(checked.guidance).toBe(expected.guidance);
    expect(checked.sha256).toBe(expected.sha256);
    expect(checked.anchors).toEqual(expected.anchors);
  });
  it('P1-SIDECAR-01 persists the effective Native revision exactly once without mutating the draft',()=>{
    const {root}=staged();
    const draft=readNativeDraft(root)!;
    const prepared=prepareNativeImages(appPath,root,true);
    const record=JSON.parse(fs.readFileSync(
      path.join(root,'.studio/storyboard/prepared-image-jobs-v1.json'),'utf8')) as {
        revision:number;artifactSha256:string;draftToken:string;jobs:unknown[]
      };
    expect(record.revision).toBe(prepared.revision);
    expect(record.artifactSha256).toBe(draft.sha256);
    expect(record.draftToken).toBe(draft.token);
    expect(record.jobs).toHaveLength(prepared.jobs.length);
    expect(readNativeDraft(root)!.sha256).toBe(draft.sha256);
  });
  it('P1-02 compiles exact structured asset content without hallucinating motion, caption or filenames',()=>{
    const {root}=staged(),queue=prepareNativeImages(appPath,root),job=queue.jobs[0];
    expect(job.state).toBe('READY');
    expect(job.sourceDescription).toContain('A tiny hand-drawn red kite');
    expect(job.prompt).toContain(job.sourceDescription);
    expect(job.prompt).toContain('Single centered red kite');
    expect(job.prompt).not.toContain('Kite moves across screen');
    expect(job.prompt).toContain('references/b1-minimal-handdrawn.md');
    expect(job.promptSha256).toBe(sha(job.prompt));
    expect(job.targetKeys).toEqual(['image:0:image-1']);
    expect(job.expectedPaths).toEqual(['assets/images/missing.png']);
    expect(job.draftIdentity.creativeFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('P1-03 legacy MISSING_REQUIRED_VISUAL pipe format compiles exact content and continuity',()=>{
    const {root}=staged('B1',false,true),job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('READY');
    expect(job.prompt).toContain('A tiny hand-drawn red kite');
    expect(job.prompt).toContain('Preserve red color and exact kite silhouette.');
  });
  it('P1-04 missing exact asset description yields owner-review reason and no invented prompt',()=>{
    const {root}=fixture(),payload=nativePayload(root,{image:'early'});
    stageNative(root,payload);
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('NEEDS_OWNER_REVIEW');
    expect(job.reason).toMatch(/No exact matching/);
    expect(job.prompt).toBe('');
  });
  it('P1-05 conflicting descriptions for same exact target are not silently chosen',()=>{
    const {root,payload}=staged();
    payload.asset_needs.push({shot_id:'shot-1',layer_id:'image-1',expected_path:'assets/images/missing.png',content:'A DIFFERENT blue bus instead of kite'});
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'p1-conflict',reviewTaskId:'p1-review',editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('NEEDS_OWNER_REVIEW');
    expect(job.reason).toMatch(/Conflicting/);
    expect(job.prompt).toBe('');
  });
  it('P1-06 path and identity mismatch never maps another shot description',()=>{
    const {root,payload}=staged('B1',true);
    payload.asset_needs=[{shot_id:'shot-2',layer_id:'image-2',expected_path:'assets/images/missing.png',content:'Wrong path belongs to shot-1'}];
    const draft=readNativeDraft(root)!;
    expect(()=>publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'bad-path',reviewTaskId:'review',editableIds:['shot-2'],editablePaths:[],findingIds:['P1']
    })).toThrow(/PATH_MISMATCH/);
  });
  it('P1-07 same basename never reduces per-occurrence jobs or exact binding IDs',()=>{
    const {root}=staged('B1',true,false,true),queue=prepareNativeImages(appPath,root);
    expect(queue.imageOccurrences).toBe(2);
    expect(queue.uniquePaths).toBe(1);
    expect(queue.jobs.map(x=>x.targetKey)).toEqual(['image:0:image-1','image:1:image-2']);
    expect(queue.jobs.every(x=>x.state==='READY')).toBe(true);
    expect(queue.jobs.every(x=>x.occurrencesAtPath===2)).toBe(true);
  });
  it('P1-08 owner edit remains scoped to exact source fingerprint and survives read-only refresh',()=>{
    const {root}=staged('B1',true);
    const before=prepareNativeImages(appPath,root),first=before.jobs[0];
    saveNativeImagePrompt(appPath,root,{targetKey:first.targetKey,fingerprint:first.draftIdentity.creativeFingerprint,
      prompt:'Owner verified custom kite pose with no text.',references:[]});
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs[0]).toMatchObject({ownerEdited:true,prompt:'Owner verified custom kite pose with no text.'});
    expect(after.jobs[1].prompt).toContain('navy fabric backpack');
    expect(after.jobs[1].ownerEdited).toBe(false);
    expect(()=>saveNativeImagePrompt(appPath,root,{targetKey:first.targetKey,fingerprint:'0'.repeat(64),
      prompt:'not allowed on stale target',references:[]})).toThrow(/STALE_TARGET/);
  });
  it('P1-09 switching projects never shares overrides, token, rights or prompt',()=>{
    const a=staged(),b=staged();
    const aa=prepareNativeImages(appPath,a.root),bb=prepareNativeImages(appPath,b.root);
    expect(aa.jobs[0].draftIdentity.projectId).not.toBe(bb.jobs[0].draftIdentity.projectId);
    saveNativeImagePrompt(appPath,a.root,{targetKey:aa.jobs[0].targetKey,
      fingerprint:aa.jobs[0].draftIdentity.creativeFingerprint,prompt:'Owner-only first project kite art',references:[]});
    expect(prepareNativeImages(appPath,b.root).jobs[0].ownerEdited).toBe(false);
    expect(prepareNativeImages(appPath,b.root).jobs[0].prompt).not.toContain('Owner-only');
  });
  it('P1-10 corrected other Shot changes only that target fingerprint and retains unaffected prompt',()=>{
    const {root,payload}=staged('B1',true,true);
    const before=prepareNativeImages(appPath,root);
    saveNativeImagePrompt(appPath,root,{targetKey:before.jobs[0].targetKey,
      fingerprint:before.jobs[0].draftIdentity.creativeFingerprint,prompt:'Kite reviewed and approved by project owner',references:[]});
    payload.asset_needs[1]=String(payload.asset_needs[1]).replace('navy fabric backpack','navy fabric satchel');
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'p1-targeted',reviewTaskId:'p1-review',editableIds:['shot-2'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs[0].draftIdentity.creativeFingerprint).toBe(before.jobs[0].draftIdentity.creativeFingerprint);
    expect(after.jobs[1].draftIdentity.creativeFingerprint).not.toBe(before.jobs[1].draftIdentity.creativeFingerprint);
    expect(after.jobs[0].ownerEdited).toBe(true);
    expect(after.jobs[1].prompt).toContain('navy fabric satchel');
  });
  it('P1-11 opening/preparing image queue makes zero network calls and no paid job files',()=>{
    const {root}=staged();
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const before=fs.readFileSync(path.join(root,'project.json'));
    const queue=prepareNativeImages(appPath,root);
    expect(queue.jobs).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root,'.studio/glabs/jobs'))).toBe(false);
    expect(fs.readFileSync(path.join(root,'project.json'))).toEqual(before);
  });
  it('P1-12 B4 guidance uses exact style-lock and verified anchors, never generic B1 text',()=>{
    const {root}=staged('B4');
    const before=prepareNativeImages(appPath,root),job=before.jobs[0];
    expect(job.state).toBe('NEEDS_OWNER_REVIEW');
    expect(job.prompt).toContain('B4 SURVIVAL STORYTELLING — DRAWING STYLE LOCK');
    expect(job.styleAnchors).toHaveLength(5);
    const selected='@modeb/b4/'+job.styleAnchors[0].id;
    const after=saveNativeImagePrompt(appPath,root,{targetKey:job.targetKey,
      fingerprint:job.draftIdentity.creativeFingerprint,prompt:job.prompt,references:[selected]});
    expect(after.jobs[0]).toMatchObject({state:'READY',references:[selected]});
  });
  it('F02-01 actual Native positional image brief compiles exact content, not availability',()=>{
    const {root,payload}=staged();
    const positional='MISSING_REQUIRED_VISUAL | assets/images/missing.png | Hand-drawn red city bus, front facing screen left, muted accents, isolated transparent raster | Planned asset; no media is present';
    payload.asset_needs=[positional];
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'positional-single',reviewTaskId:'review',editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('READY');
    expect(job.sourceDescription).toBe('Hand-drawn red city bus, front facing screen left, muted accents, isolated transparent raster');
    expect(job.prompt).toContain(job.sourceDescription);
    expect(job.prompt).not.toContain('Planned asset; no media is present');
    expect(job.sourceRows).toEqual([positional]);
  });
  it('F02-02 one positional path requirement safely serves two real occurrences without deduplicating paid jobs',()=>{
    const {root,payload}=staged('B1',true,false,true);
    const source='MISSING_REQUIRED_VISUAL | assets/images/missing.png | Same exact owner-approved red kite identity, no text, isolated transparent shape | Planned asset; no media is present';
    payload.asset_needs=[source];
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'positional-shared',reviewTaskId:'review',editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const result=prepareNativeImages(appPath,root);
    expect(result.imageOccurrences).toBe(2);
    expect(result.uniquePaths).toBe(1);
    expect(result.jobs.map(job=>job.targetKey)).toEqual(['image:0:image-1','image:1:image-2']);
    expect(result.jobs.map(job=>job.state)).toEqual(['READY','READY']);
    expect(result.jobs.every(job=>job.sourceRows.length===1&&job.sourceRows[0]===source)).toBe(true);
    expect(new Set(result.jobs.map(job=>job.targetKey)).size).toBe(2);
  });
  it('F02-03 contradictory positional briefs for same path require owner review, never first-match',()=>{
    const {root,payload}=staged();
    const first='MISSING_REQUIRED_VISUAL | assets/images/missing.png | Red kite with a visible thin string | Planned asset; no media is present';
    const other='MISSING_REQUIRED_VISUAL | assets/images/missing.png | Blue bus with windows, not a kite | Planned asset; no media is present';
    payload.asset_needs=[first,other];
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'positional-conflict',reviewTaskId:'review',editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('NEEDS_OWNER_REVIEW');
    expect(job.prompt).toBe('');
    expect(job.reason).toMatch(/Conflicting/);
    expect(job.sourceRows).toEqual([first,other]);
  });
  it('F03-01 changing positional Shot B requirement preserves Shot A fingerprint and owner override',()=>{
    const {root,payload}=staged('B1',true);
    payload.asset_needs=[
      'MISSING_REQUIRED_VISUAL | assets/images/missing.png | Red kite exact owner identity | Planned asset; no media is present',
      'MISSING_REQUIRED_VISUAL | assets/images/late.png | Navy backpack with attached strap | Planned asset; no media is present'
    ];
    const firstDraft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,firstDraft.sha256,payload,{
      correctTaskId:'positional-initial',reviewTaskId:'review',editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const before=prepareNativeImages(appPath,root);
    const a=before.jobs[0],b=before.jobs[1];
    saveNativeImagePrompt(appPath,root,{targetKey:a.targetKey,
      fingerprint:a.draftIdentity.creativeFingerprint,styleSha256:a.styleProfileRef.sha256,
      prompt:'Owner-approved red kite with a thin string',references:[]});
    const current=readNativeDraft(root)!;
    const corrected=structuredClone(current.artifact) as typeof payload;
    corrected.asset_needs[1]='MISSING_REQUIRED_VISUAL | assets/images/late.png | Navy satchel replacing the old backpack | Planned asset; no media is present';
    publishNativeDraftCorrection(appPath,root,current.sha256,corrected,{
      correctTaskId:'positional-only-b',reviewTaskId:'review',editableIds:['shot-2'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs[0].draftIdentity.creativeFingerprint).toBe(a.draftIdentity.creativeFingerprint);
    expect(after.jobs[1].draftIdentity.creativeFingerprint).not.toBe(b.draftIdentity.creativeFingerprint);
    expect(after.jobs[0].ownerEdited).toBe(true);
    expect(after.jobs[1].prompt).toContain('Navy satchel replacing');
  });
  it('F03-02 change to shared positional asset invalidates every dependent target, not just the first',()=>{
    const {root,payload}=staged('B1',true,false,true);
    payload.asset_needs=[
      'MISSING_REQUIRED_VISUAL | assets/images/missing.png | Same shared red kite pose | Planned asset; no media is present'
    ];
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'shared-original',reviewTaskId:'review',editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const before=prepareNativeImages(appPath,root);
    const current=readNativeDraft(root)!;
    const changed=structuredClone(current.artifact) as typeof payload;
    changed.asset_needs[0]='MISSING_REQUIRED_VISUAL | assets/images/missing.png | Same shared kite revised to yellow color | Planned asset; no media is present';
    publishNativeDraftCorrection(appPath,root,current.sha256,changed,{
      correctTaskId:'shared-change',reviewTaskId:'review',editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs.every((job,index)=>
      job.draftIdentity.creativeFingerprint!==before.jobs[index].draftIdentity.creativeFingerprint)).toBe(true);
    expect(after.jobs.every(job=>job.prompt.includes('revised to yellow color'))).toBe(true);
  });
  it('F05-06 wrong-path/wrong-Shot partial Native requirement contaminates neither target nor fingerprint',()=>{
    const {root,payload}=staged('B1',true);
    const bad={shot_id:'shot-1',expected_path:'assets/images/late.png',content:'This is not for either real target'};
    payload.asset_needs.push(bad);
    const before=prepareNativeImages(appPath,root);
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'strict-partial',reviewTaskId:'review',
      editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs.map(job=>job.state)).toEqual(['READY','READY']);
    expect(after.jobs[0].sourceRows).not.toContainEqual(bad);
    expect(after.jobs[1].sourceRows).not.toContainEqual(bad);
    expect(after.jobs[0].draftIdentity.creativeFingerprint).toBe(before.jobs[0].draftIdentity.creativeFingerprint);
    expect(after.jobs[1].draftIdentity.creativeFingerprint).toBe(before.jobs[1].draftIdentity.creativeFingerprint);
  });
  it('F05-07 same Shot/path with unspecified Layer stays review-only, not a fabricated exact description',()=>{
    const {root,payload}=staged();
    const partial={shot_id:'shot-1',expected_path:'assets/images/missing.png',content:'Undecided layer state'};
    payload.asset_needs.push(partial);
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'layer-ambiguous',reviewTaskId:'review',
      editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('NEEDS_OWNER_REVIEW');
    expect(job.reason).toMatch(/Partial/);
    expect(job.sourceRows).toContainEqual(partial);
    expect(job.prompt).toBe('');
  });
  it('F06-01 global directives appear in every applicable compiled prompt and ordered source provenance',()=>{
    const {root,payload}=staged('B1',true);
    const globalOne={scope:'global',content:'Use restrained texture throughout all image assets.'};
    const globalTwo={global:true,content:'Keep all raster illustration backgrounds clean of baked-in title text.'};
    payload.asset_needs=[globalOne,payload.asset_needs[0],globalTwo,payload.asset_needs[1]];
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'global-directives',reviewTaskId:'review',
      editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const result=prepareNativeImages(appPath,root);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map(job=>job.state)).toEqual(['READY','READY']);
    for(const job of result.jobs){
      expect(job.prompt).toContain(globalOne.content);
      expect(job.prompt).toContain(globalTwo.content);
      expect(job.prompt.indexOf(globalOne.content)).toBeLessThan(job.prompt.indexOf(globalTwo.content));
      expect(job.prompt).toContain('APPROVED MODE B STYLE B1');
      expect(job.sourceRows).toContainEqual(globalOne);
      expect(job.sourceRows).toContainEqual(globalTwo);
      expect(job.sourceDescription).not.toContain(globalOne.content);
    }
    expect(result.jobs[0].sourceRows).toEqual([globalOne,payload.asset_needs[1],globalTwo]);
    expect(result.jobs[1].sourceRows).toEqual([globalOne,globalTwo,payload.asset_needs[3]]);
  });
  it('F06-02 changing global source invalidates both fingerprints and a previously saved owner override',()=>{
    const {root,payload}=staged('B1',true);
    const global={scope:'global',content:'Global original approved white line weight.'};
    payload.asset_needs.push(global);
    let draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'global-before',reviewTaskId:'review',
      editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const before=prepareNativeImages(appPath,root);
    saveNativeImagePrompt(appPath,root,{targetKey:before.jobs[0].targetKey,
      fingerprint:before.jobs[0].draftIdentity.creativeFingerprint,
      prompt:'Owner verified specific red kite design with two visible edges',references:[]});
    const saved=prepareNativeImages(appPath,root).jobs[0];
    expect(saved.ownerEdited).toBe(true);
    expect(saved.prompt).toContain(global.content);
    expect(saved.prompt).toContain('APPROVED MODE B STYLE B1');
    draft=readNativeDraft(root)!;
    const revised=structuredClone(draft.artifact) as typeof payload;
    revised.asset_needs[2]={scope:'global',content:'Global revised approved thin black stroke weight.'};
    publishNativeDraftCorrection(appPath,root,draft.sha256,revised,{
      correctTaskId:'global-after',reviewTaskId:'review',
      editableIds:['shot-1','shot-2'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs.every((job,index)=>
      job.draftIdentity.creativeFingerprint!==before.jobs[index].draftIdentity.creativeFingerprint)).toBe(true);
    expect(after.jobs[0].ownerEdited).toBe(false);
    expect(after.jobs.every(job=>job.prompt.includes('Global revised approved'))).toBe(true);
  });
  it('F06-03 unsupported unscoped lines never become global or contaminate prompts',()=>{
    const {root,payload}=staged('B1',true);
    payload.asset_needs.push('Reminder: edit unrelated video later');
    const draft=readNativeDraft(root)!;
    const before=prepareNativeImages(appPath,root);
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'unsupported-row',reviewTaskId:'review',
      editableIds:['shot-2'],editablePaths:[],findingIds:['P1']
    });
    const after=prepareNativeImages(appPath,root);
    expect(after.jobs.every(job=>!job.prompt.includes('Reminder:'))).toBe(true);
    expect(after.jobs.every(job=>!job.sourceRows.includes('Reminder: edit unrelated video later'))).toBe(true);
    expect(after.jobs.map(job=>job.draftIdentity.creativeFingerprint)).toEqual(
      before.jobs.map(job=>job.draftIdentity.creativeFingerprint));
  });
  it('F06-04 incompatible global orientation versus exact target is blocked, not silently combined',()=>{
    const {root,payload}=staged();
    payload.asset_needs.push({scope:'global',orientation:'horizontal square canvas',
      content:'Global illustration orientation requirement'});
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'global-orientation-conflict',reviewTaskId:'review',
      editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('BLOCKED');
    expect(job.reason).toMatch(/Conflicting global/);
    expect(job.prompt).toBe('');
    expect(job.sourceRows.some(row=>typeof row==='object'&&row!==null&&
      (row as Record<string,unknown>).scope==='global')).toBe(true);
  });
  it('F06-05 a global row with no expressible instruction blocks instead of silently disappearing',()=>{
    const {root,payload}=staged();
    payload.asset_needs.push({scope:'global',metadata:'Unrenderable arbitrary payload'});
    const draft=readNativeDraft(root)!;
    publishNativeDraftCorrection(appPath,root,draft.sha256,payload,{
      correctTaskId:'inexpressible-global',reviewTaskId:'review',
      editableIds:['shot-1'],editablePaths:[],findingIds:['P1']
    });
    const job=prepareNativeImages(appPath,root).jobs[0];
    expect(job.state).toBe('BLOCKED');
    expect(job.reason).toMatch(/no expressible creative instruction/);
    expect(job.prompt).toBe('');
  });
  it('F04-01 revised installed B1 authority invalidates override but never mutates Native DRAFT',()=>{
    const {root}=staged();
    const before=prepareNativeImages(appPath,root).jobs[0];
    const draftSha=readNativeDraft(root)!.sha256;
    saveNativeImagePrompt(appPath,root,{targetKey:before.targetKey,
      fingerprint:before.draftIdentity.creativeFingerprint,
      styleSha256:before.styleProfileRef.sha256,prompt:'Owner verified exact red kite isolated on transparency',references:[]});
    expect(prepareNativeImages(appPath,root).jobs[0].ownerEdited).toBe(true);
    const actualRead=fs.readFileSync;
    vi.spyOn(fs,'readFileSync').mockImplementation(((...args:unknown[])=>{
      const value=Reflect.apply(actualRead,fs,args) as string|Buffer;
      return String(args[0]).endsWith('b1-minimal-handdrawn.md')&&typeof value==='string'?
        value+'\\n<!-- newly verified style authority revision -->':value;
    }) as typeof fs.readFileSync);
    const after=prepareNativeImages(appPath,root).jobs[0];
    expect(after.styleProfileRef.sha256).not.toBe(before.styleProfileRef.sha256);
    expect(after.ownerEdited).toBe(false);
    expect(after.prompt).not.toBe('Owner verified exact red kite isolated on transparency');
    expect(()=>saveNativeImagePrompt(appPath,root,{targetKey:before.targetKey,
      fingerprint:before.draftIdentity.creativeFingerprint,styleSha256:before.styleProfileRef.sha256,
      prompt:'Stale style owner prompt',references:[]})).toThrow(/STALE_STYLE_AUTHORITY/);
    expect(readNativeDraft(root)!.sha256).toBe(draftSha);
  });
  it('P1-13 stale owner fingerprints cannot resurrect previously approved generation briefs',()=>{
    const {root}=staged();
    const current=prepareNativeImages(appPath,root).jobs[0];
    expect(nativeImageTargetIdentity(root,current.targetKey).fingerprint).toBe(current.draftIdentity.creativeFingerprint);
    expect(()=>saveNativeImagePrompt(appPath,root,{targetKey:'image:1:image-999',
      fingerprint:current.draftIdentity.creativeFingerprint,prompt:'Wrong image target',references:[]})).toThrow();
  });
});
