// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {loadSchema} from '../../src/main/identity/contracts';
import {validateNewReferenceGenerateInput} from '../../src/main/identity/referenceGeneration';

const read=(relative:string)=>fs.readFileSync(path.resolve('src',relative),'utf8');
describe('RFG final single-reference production surfaces',()=>{
  it('RFG-01/02 active schemas do not declare character type',()=>{
    const analysis=loadSchema('analysis').$defs?.character;
    const bible=loadSchema('bible').$defs?.character;
    for(const row of [analysis,bible]){
      expect(row?.required).not.toContain('entity_kind');
      expect(row?.properties).not.toHaveProperty('entity_kind');
      expect(row?.properties).not.toHaveProperty('referenceType');
      expect(row?.properties).not.toHaveProperty('isGroup');
      expect(row?.properties).not.toHaveProperty('species');
      expect(row?.properties).not.toHaveProperty('entityScope');
      expect(row?.properties).not.toHaveProperty('layoutType');
    }
  });
  it('RFG-03/05 active Style Bible, renderer and IPC contain no format selector',()=>{
    const style=read('main/identity/styleBible.ts');
    const view=read('renderer/features/external/StyleBibleWorkspace.tsx');
    const bridge=read('renderer/vite-env.d.ts');
    const main=read('main/index.ts');
    expect(style).not.toContain('ReferenceOutputFormat');
    expect(style).not.toContain('group_overview');
    expect(style).not.toContain('outputFormat');
    expect(view).not.toContain('referenceFormats');
    expect(view).not.toContain('Reference output for this paid request');
    expect(view).not.toContain('group_overview');
    expect(bridge).not.toContain('referenceFormat');
    expect(main).not.toContain('referenceFormat');
    expect(view).toContain('identityGenerateReference');
    expect(view).toContain('identityApproveReference');
    expect(view).toContain('identityPublishReferences');
  });
  it('RFG-06/07 rejects retired and replacement taxonomy keys at IPC boundary',()=>{
    const valid={anchorId:'char_001',authorized:true as const};
    expect(validateNewReferenceGenerateInput(valid)).toEqual(valid);
    for(const field of ['referenceFormat','referenceType','isGroup','species',
      'entityScope','layoutType','entity_kind']){
      expect(()=>validateNewReferenceGenerateInput({...valid,[field]:'group_overview'}))
        .toThrow('REFERENCE_GENERATION_REQUEST_UNKNOWN_FIELD');
    }
    expect(()=>validateNewReferenceGenerateInput({anchorId:'char_001',authorized:false}))
      .toThrow('REFERENCE_PAID_POST_OWNER_AUTH_REQUIRED');
    expect(()=>validateNewReferenceGenerateInput({...valid,extra:1}))
      .toThrow('REFERENCE_GENERATION_REQUEST_UNKNOWN_FIELD');
    expect(()=>validateNewReferenceGenerateInput({...valid,regenerate:'yes'}))
      .toThrow('REFERENCE_GENERATION_REQUEST_INVALID');
  });
  it('RFG-14 Script Analysis instructs individual source-grounded IDs, not synthetic crowds',()=>{
    const author=read('main/identity/scriptAnalysis.ts');
    expect(author).toContain('ONE independently established individual identity');
    expect(author).toContain('multiple char_ids, not a group ID');
    expect(author).toContain('Do not invent identities for unnamed crowds');
  });
});
