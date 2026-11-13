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
  Invoke-Step 'browser' { $env:R1_SCREENSHOTS = $shots; npx.cmd playwright test tests/ui/r1.spec.ts --reporter=line }
  if ($env:ELECTRON_RUN_AS_NODE) {
    $results['electron-dev'] = 'NOT_RUN'; $results['electron-prod'] = 'NOT_RUN'
    'NOT_RUN: managed host forces Electron into Node mode; no --no-sandbox result is accepted.' | Set-Content (Join-Path $resultsRoot 'electron-dev.log')
    'NOT_RUN: managed host forces Electron into Node mode; no --no-sandbox result is accepted.' | Set-Content (Join-Path $resultsRoot 'electron-prod.log')
  } else {
    Invoke-Step 'electron-dev' { npx.cmd playwright test tests/ui/electron.spec.ts --grep 'development URL' --reporter=line }
    Invoke-Step 'electron-prod' { npx.cmd playwright test tests/ui/electron.spec.ts --grep 'production shell' --reporter=line }
  }
  Invoke-Step 'core-preservation' { $changes = @((git -C $repo diff --name-only main...HEAD -- skills/directing-stickman-videos/), (git -C $repo diff --name-only -- skills/directing-stickman-videos/)) | Where-Object { $_ }; if ($changes) { throw "MODE_B_CORE_CHANGED: $changes" }; 'Mode B core unchanged.' }
  $coreRoot = Join-Path $repo 'skills\directing-stickman-videos'
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $coreTestRoot = Join-Path $tempRoot ("mode-b-core-test-" + $stamp)
  try { New-Item -ItemType Directory -Path $coreTestRoot | Out-Null; Copy-Item -Path (Join-Path $coreRoot '*') -Destination $coreTestRoot -Recurse -Force; Push-Location $coreTestRoot; try { Invoke-Step 'native-core-tests' { npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "Native core npm ci failed: $LASTEXITCODE" }; npm.cmd test } } finally { Pop-Location } }
  finally { if (Test-Path $coreTestRoot) { $resolvedCoreTest = (Resolve-Path $coreTestRoot).Path; if (-not $resolvedCoreTest.StartsWith($tempRoot)) { throw "Refusing temp cleanup outside temp: $resolvedCoreTest" }; Remove-Item -LiteralPath $resolvedCoreTest -Recurse -Force } }
} finally { $results | ConvertTo-Json | Set-Content (Join-Path $resultsRoot 'results.json'); Pop-Location }
