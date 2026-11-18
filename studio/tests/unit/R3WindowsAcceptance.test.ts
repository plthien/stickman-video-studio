// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';

// Structural regressions for the Windows-only acceptance runner.
// Actual Git exit codes and diff results must still be verified on a Windows checkout.
const source=()=>fs.readFileSync(path.resolve('scripts/windows-r3-acceptance.ps1'),'utf8');
describe('R3 F05 Core immutability gate',()=>{
  it('F05-01 compares the PR merge-base main...HEAD against the actual Core directory',()=>{
    const script=source();
    expect(script).toContain("git diff --name-only main...HEAD -- skills/directing-stickman-videos/");
    expect(script).not.toContain('89761c54dd7ca54c4d0c5769324d5de9828a84e6');
    expect(script).toContain("if([string]::IsNullOrWhiteSpace($modified)){'PASS'}else{'FAIL'}");
  });
  it('F05-02 includes modifications in the Core diff as FAIL',()=>{
    expect(source()).toContain("$coreStatus = if([string]::IsNullOrWhiteSpace($modified)){'PASS'}else{'FAIL'}");
  });
  it('F05-03 requires a local main baseline and valid merge-base, never PASS on a missing ref',()=>{
    const script=source();
    expect(script).toContain("git rev-parse --verify 'main^{commit}'");
    expect(script).toContain('git merge-base main HEAD');
    expect(script).toContain("if($baseExit -ne 0)");
    expect(script).toContain("if($mergeExit -ne 0)");
    expect(script).toContain("$coreStatus = 'BLOCKED'");
  });
  it('F05-04 handles command errors and exits nonzero for failed or blocked Core checks',()=>{
    const script=source();
    expect(script).toContain('$exitCode = $LASTEXITCODE');
    expect(script).toContain("if($exitCode -ne 0)");
    expect(script).toContain("Where-Object { $_.status -in @('FAIL','BLOCKED') }");
    expect(script).toContain('ConvertTo-Json -Depth 10');
  });
});
