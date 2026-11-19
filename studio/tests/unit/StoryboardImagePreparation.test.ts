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
  it('P1-13 stale owner fingerprints cannot resurrect previously approved generation briefs',()=>{
    const {root}=staged();
    const current=prepareNativeImages(appPath,root).jobs[0];
    expect(nativeImageTargetIdentity(root,current.targetKey).fingerprint).toBe(current.draftIdentity.creativeFingerprint);
    expect(()=>saveNativeImagePrompt(appPath,root,{targetKey:'image:1:image-999',
      fingerprint:current.draftIdentity.creativeFingerprint,prompt:'Wrong image target',references:[]})).toThrow();
  });
});
