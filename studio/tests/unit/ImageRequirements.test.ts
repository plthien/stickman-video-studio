// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {imageRequirementsForTarget,imageRequirementFingerprintSources,
  normalizeNativeImageRequirement} from '../../src/main/imageRequirements';

const sharedPath='assets/visual/b1/bus_left_muted_red.png';
const oldAuthor='MISSING_REQUIRED_VISUAL | '+sharedPath+
  ' | Hand-drawn city bus, front toward screen left, muted red accents, stable bus identity, isolated transparent raster | Planned asset; no media is present';
const a={shotId:'sh_001',layerId:'sh_001_layer_03',path:sharedPath};
const b={shotId:'sh_002',layerId:'sh_002_layer_04',path:sharedPath};
describe('Actual Native Author asset-needs normalization and target ownership',()=>{
  it('F02 positional: preserves original source and never mistakes availability for content',()=>{
    const result=normalizeNativeImageRequirement(oldAuthor);
    expect(result.format).toBe('legacy-positional');
    expect(result.scope).toBe('path');
    expect(result.path).toBe(sharedPath);
    expect(result.shotId).toBe('');
    expect(result.layerId).toBe('');
    expect(result.description).toBe('Hand-drawn city bus, front toward screen left, muted red accents, stable bus identity, isolated transparent raster');
    expect(result.description).not.toContain('Planned asset');
    expect(result.source).toBe(oldAuthor);
  });
  it('F02 shared path: both occurrences inherit one source but remain independently bound',()=>{
    const first=imageRequirementsForTarget([oldAuthor],a);
    const second=imageRequirementsForTarget([oldAuthor],b);
    expect(first.matching.map(x=>x.source)).toEqual([oldAuthor]);
    expect(second.matching.map(x=>x.source)).toEqual([oldAuthor]);
    expect(imageRequirementFingerprintSources([oldAuthor],a)).toEqual([oldAuthor]);
    expect(imageRequirementFingerprintSources([oldAuthor],b)).toEqual([oldAuthor]);
  });
  it('F02/F03 exact structured and legacy key=value select only their declared target',()=>{
    const structured={shot_id:'sh_001',layer_id:'sh_001_layer_03',expected_path:sharedPath,content:'Red city bus, approved side pose'};
    const keyed='MISSING_REQUIRED_VISUAL | shot_id=sh_002 | layer_id=sh_002_layer_04 | expected_path='+
      sharedPath+' | content=Red city bus, approved front pose | availability=NOT_PRESENT';
    const rows=[structured,keyed];
    expect(imageRequirementFingerprintSources(rows,a)).toEqual([structured]);
    expect(imageRequirementFingerprintSources(rows,b)).toEqual([keyed]);
    expect(normalizeNativeImageRequirement(keyed).description).not.toContain('availability');
  });
  it('F02 two conflicting path descriptions remain visible; no first-match ownership guess',()=>{
    const different='MISSING_REQUIRED_VISUAL | '+sharedPath+' | A completely different blue van | Planned asset; no media is present';
    const selection=imageRequirementsForTarget([oldAuthor,different],a);
    expect(selection.matching.map(x=>x.description)).toHaveLength(2);
    expect(new Set(selection.matching.map(x=>x.description)).size).toBe(2);
    expect(selection.matching.map(x=>x.source)).toEqual([oldAuthor,different]);
  });
  it('F03 unrelated path and unsupported text are never hashed globally',()=>{
    const unrelated='MISSING_REQUIRED_VISUAL | assets/visual/b1/phone.png | A handheld phone | Planned asset; no media is present';
    const unknown='Unparseable note with no exact Native ownership';
    expect(imageRequirementFingerprintSources([oldAuthor,unrelated,unknown],a)).toEqual([oldAuthor]);
    const explicit={scope:'global',content:'Owner-approved global illustration constraint'};
    expect(imageRequirementFingerprintSources([oldAuthor,unrelated,unknown,explicit],a)).toEqual([oldAuthor,explicit]);
  });
  it('F03 path mismatch is reported only against explicit matching Shot/Layer identity',()=>{
    const wrong={shot_id:a.shotId,layer_id:a.layerId,expected_path:'assets/visual/b1/wrong.png',content:'Wrong path'};
    expect(imageRequirementsForTarget([wrong],a).conflicting).toHaveLength(1);
    expect(imageRequirementFingerprintSources([wrong],a)).toEqual([wrong]);
    expect(imageRequirementFingerprintSources([wrong],b)).toEqual([]);
  });
  it('F02 incomplete Shot-only ownership does not silently become shared or global',()=>{
    const partial={shot_id:'sh_001',expected_path:sharedPath,content:'Ambiguous bus pose'};
    expect(imageRequirementsForTarget([partial],a).partial).toHaveLength(1);
    expect(imageRequirementsForTarget([partial],b).partial).toHaveLength(0);
    expect(imageRequirementsForTarget([partial],a).matching).toHaveLength(0);
  });
  it('F05-01 strict partial Shot+path requires both; another path in the same Shot cannot contaminate',()=>{
    const scoped={shot_id:a.shotId,expected_path:sharedPath,content:'Only this file may contain bus art'};
    const sameShotOtherPath={...a,path:'assets/visual/b1/other.png'};
    expect(imageRequirementsForTarget([scoped],a).partial.map(row=>row.source)).toEqual([scoped]);
    expect(imageRequirementsForTarget([scoped],sameShotOtherPath).partial).toEqual([]);
    expect(imageRequirementFingerprintSources([scoped],sameShotOtherPath)).toEqual([]);
  });
  it('F05-02 same path cannot override an explicitly different Shot',()=>{
    const scoped={shot_id:a.shotId,expected_path:sharedPath,content:'Bus art for this one Shot'};
    expect(imageRequirementsForTarget([scoped],b).partial).toEqual([]);
    expect(imageRequirementFingerprintSources([scoped],b)).toEqual([]);
  });
  it('F05-03 incomplete Layer ownership reports scoped ambiguity, not READY or global',()=>{
    const scoped={shot_id:a.shotId,expected_path:sharedPath,content:'Unresolved layer pose'};
    const sameShotSamePathOtherLayer={...a,layerId:'different_layer'};
    expect(imageRequirementsForTarget([scoped],a).partial).toHaveLength(1);
    expect(imageRequirementsForTarget([scoped],sameShotSamePathOtherLayer).partial).toHaveLength(1);
    expect(imageRequirementsForTarget([scoped],a).matching).toHaveLength(0);
    expect(imageRequirementsForTarget([scoped],a).global).toHaveLength(0);
    const withLayer={layer_id:a.layerId,expected_path:sharedPath,content:'Only this layer'};
    expect(imageRequirementsForTarget([withLayer],{...a,layerId:'other'}).partial).toEqual([]);
  });
  it('F05-04 full Shot/Layer/path identity matches exactly, wrong path is flagged only on the owning Shot/Layer',()=>{
    const exact={shot_id:a.shotId,layer_id:a.layerId,expected_path:sharedPath,content:'Exact A'};
    const wrong={...exact,expected_path:'assets/visual/b1/other.png'};
    const selection=imageRequirementsForTarget([exact,wrong],a);
    expect(selection.matching.map(row=>row.source)).toEqual([exact]);
    expect(selection.conflicting.map(row=>row.source)).toEqual([wrong]);
    expect(imageRequirementFingerprintSources([exact,wrong],b)).toEqual([]);
  });
  it('F05-05 shared positional path remains applicable to both independent occurrences',()=>{
    expect(imageRequirementsForTarget([oldAuthor],a).matching).toHaveLength(1);
    expect(imageRequirementsForTarget([oldAuthor],b).matching).toHaveLength(1);
    expect(imageRequirementFingerprintSources([oldAuthor],a)).toEqual([oldAuthor]);
    expect(imageRequirementFingerprintSources([oldAuthor],b)).toEqual([oldAuthor]);
  });
  it('F06-01 explicit global rows retain effective source order, unsupported text stays excluded',()=>{
    const g1={scope:'global',content:'Global render grain must remain subtle'};
    const exact={shot_id:a.shotId,layer_id:a.layerId,expected_path:sharedPath,content:'A bus'};
    const g2={global:true,content:'No embedded title overlay'};
    const unknown='An unparseable line with no declared scope';
    const rows=[g1,exact,unknown,g2];
    const selection=imageRequirementsForTarget(rows,a);
    expect(selection.effective.map(row=>row.source)).toEqual([g1,exact,g2]);
    expect(selection.global.map(row=>row.source)).toEqual([g1,g2]);
    expect(imageRequirementFingerprintSources(rows,a)).toEqual([g1,exact,g2]);
    expect(imageRequirementFingerprintSources(rows,b)).toEqual([g1,g2]);
  });
});
