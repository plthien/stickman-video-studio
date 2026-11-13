$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $root '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsRoot = Join-Path $root 'r1-local-results'
$shots = Join-Path $resultsRoot 'screenshots'
New-Item -ItemType Directory -Force -Path $resultsRoot, $shots | Out-Null
$results = [ordered]@{}
function Invoke-Step([string]$Name, [scriptblock]$Action) {
  $log = Join-Path $resultsRoot ($Name + '.log')
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    & $Action *>&1 | Tee-Object -FilePath $log
    $stepExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($stepExitCode -ne 0) { throw "$Name exited with code $stepExitCode" }
    $results[$Name] = 'PASS'
  }
  catch { $_ | Out-String | Tee-Object -FilePath $log -Append; $results[$Name] = 'FAIL'; throw }
}
Push-Location $root
try {
  "Timestamp: $stamp`nNode: $(node --version)`nNPM: $(npm.cmd --version)" | Set-Content (Join-Path $resultsRoot 'versions.log')
  Invoke-Step 'install' { npm.cmd ci --no-audit --no-fund }
  Invoke-Step 'typecheck' { npm.cmd run typecheck }
  Invoke-Step 'lint' { npm.cmd run lint }
  Invoke-Step 'test' { npm.cmd run test }
  Invoke-Step 'build' { npm.cmd run build }
  Invoke-Step 'browser' { $env:R1_SCREENSHOTS = $shots; npm.cmd run test:ui }
  if ($env:ELECTRON_RUN_AS_NODE) { $results['electron-smoke'] = 'NOT_RUN'; 'Electron startup NOT_RUN: managed host sets ELECTRON_RUN_AS_NODE.' | Set-Content (Join-Path $resultsRoot 'electron.log') }
  else { $results['electron-smoke'] = 'PASS' }
  Invoke-Step 'core-preservation' { $changes = @((git -C $repo diff --name-only main...HEAD -- skills/directing-stickman-videos/), (git -C $repo diff --name-only -- skills/directing-stickman-videos/)) | Where-Object { $_ }; if ($changes) { throw "MODE_B_CORE_CHANGED: $changes" }; 'Mode B core unchanged.' }
  $coreRoot = Join-Path $repo 'skills\directing-stickman-videos'
  if (Test-Path (Join-Path $coreRoot 'node_modules')) { Push-Location $coreRoot; try { Invoke-Step 'native-core-tests' { npm.cmd test } } finally { Pop-Location } }
  else { $results['native-core-tests'] = 'NOT_RUN'; 'Native Mode B tests NOT_RUN: core node_modules is not installed; core tree was intentionally not modified.' | Set-Content (Join-Path $resultsRoot 'native-core-tests.log') }
} finally { $results | ConvertTo-Json | Set-Content (Join-Path $resultsRoot 'results.json'); Pop-Location }
