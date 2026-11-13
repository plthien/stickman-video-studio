#requires -Version 5.1
param([switch]$VisualReviewAccepted)
$ErrorActionPreference = 'Stop'
$sourceStudioRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$studioRoot = $sourceStudioRoot
$repoRoot = (Resolve-Path (Join-Path $studioRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsRoot = Join-Path $studioRoot 'r1-local-results'
$shots = Join-Path $resultsRoot 'screenshots'
New-Item -ItemType Directory -Force -Path $resultsRoot, $shots | Out-Null
# Remove only the known R1 artifacts from the previous run; never reuse stale evidence.
@('results.json','versions.log','visual-parity-report.md','visual-parity-report.json') | ForEach-Object { Remove-Item -LiteralPath (Join-Path $resultsRoot $_) -Force -ErrorAction SilentlyContinue }
Get-ChildItem -LiteralPath $resultsRoot -Filter '*.log' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $shots -Filter '*.png' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(app-editor|reference-v3-editor|side-by-side)-' } | Remove-Item -Force -ErrorAction SilentlyContinue
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot establish repository HEAD' }
$env:R1_HEAD_SHA = $head
$env:R1_SCREENSHOTS = $shots
$environment = [ordered]@{
  platform = [Environment]::OSVersion.VersionString
  windows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  powershell = $PSVersionTable.PSVersion.ToString()
  electron_run_as_node = [bool]$env:ELECTRON_RUN_AS_NODE
  computer = $env:COMPUTERNAME
}
$steps = [System.Collections.Generic.List[object]]::new()
$runFailed = $false

function Add-Result {
  param([string]$Name, [string]$Status, [string]$Command, $ExitCode, [string]$Reason, [int64]$ElapsedMs, [hashtable]$Counts, [string[]]$Evidence)
  $steps.Add([pscustomobject]@{
    id = $Name; status = $Status; command = $Command; exit_code = $ExitCode
    test_count = $Counts; environment = $environment; head_sha = $head
    elapsed_ms = $ElapsedMs; evidence = $Evidence; reason = $Reason
  })
  Write-Host "$Name => $Status $Reason"
}
function Skip-Step([string]$Name, [string]$Command, [string]$Reason) {
  $log = Join-Path $resultsRoot ("$Name.log")
  "NOT_RUN: $Reason" | Set-Content -LiteralPath $log -Encoding UTF8
  Add-Result $Name 'NOT_RUN' $Command $null $Reason 0 @{ passed=0; failed=0; skipped=0 } @($log)
}
function Read-TestCounts([string]$Log) {
  $body = Get-Content -LiteralPath $Log -Raw -ErrorAction SilentlyContinue
  if (-not $body) { $body = '' }
  $counts = @{ passed=0; failed=0; skipped=0 }
  foreach ($kind in @('passed','failed','skipped')) {
    $patterns = @(
      "(?m)^\s*Tests?\s+[^\r\n]*?(\d+)\s+$kind",
      "(?m)(\d+)\s+$kind\b"
    )
    foreach ($pattern in $patterns) {
      $matchesFound = [regex]::Matches($body, $pattern)
      if ($matchesFound.Count -gt 0) {
        $counts[$kind] = [int]$matchesFound[$matchesFound.Count-1].Groups[1].Value
        break
      }
    }
  }
  # TAP summary uses "# pass", "# fail" rather than Playwright "passed".
  if ($body -match '(?m)^# tests (\d+)\s*$') {
    $counts['passed'] = if ($body -match '(?m)^# pass (\d+)\s*$') { [int]$Matches[1] } else { 0 }
    $counts['failed'] = if ($body -match '(?m)^# fail (\d+)\s*$') { [int]$Matches[1] } else { 0 }
    $counts['skipped'] = if ($body -match '(?m)^# skipped (\d+)\s*$') { [int]$Matches[1] } else { 0 }
  }
  return $counts
}
function Invoke-CommandStep {
  param([string]$Name, [string]$Command, [string]$WorkingDir = $studioRoot)
  $log = Join-Path $resultsRoot ("$Name.log")
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $exitCode = $null
  $reason = ''
  $status = 'PASS'
  Push-Location $WorkingDir
  $priorErrorPreference = $ErrorActionPreference
  try {
    # Windows PowerShell can promote a harmless native stderr warning to an exception.
    # Capture both streams, then trust the real cmd.exe exit code.
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    & cmd.exe /d /s /c $Command *>&1 | Out-File -LiteralPath $log -Encoding utf8
    $exitCode = [int]$LASTEXITCODE
    if ($exitCode -ne 0) { $status = 'FAIL'; $reason = "Command exit $exitCode" }
  }
  catch {
    $status = 'FAIL'; $reason = $_.Exception.Message
    $_ | Out-String | Add-Content -LiteralPath $log -Encoding utf8
    if ($null -eq $exitCode) { $exitCode = 1 }
  }
  finally { $ErrorActionPreference = $priorErrorPreference; Pop-Location; $watch.Stop() }
  $count = Read-TestCounts $log
  if ($Name -like 'electron-*' -and $status -eq 'PASS' -and ($count.skipped -gt 0 -or $count.passed -eq 0)) {
    $status = 'NOT_RUN'
    $reason = 'No real Electron test passed (skipped or missing test count)'
  }
  Add-Result $Name $status $Command $exitCode $reason $watch.ElapsedMilliseconds $count @($log)
  if ($status -eq 'FAIL') { $script:runFailed = $true }
  return $status -eq 'PASS'
}
function Invoke-CorePreservation {
  $log = Join-Path $resultsRoot 'core-preservation.log'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $range = & git -C $repoRoot diff --name-only main...HEAD -- skills/directing-stickman-videos/ 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'git diff main...HEAD failed' }
    $working = & git -C $repoRoot diff --name-only -- skills/directing-stickman-videos/ 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'git diff working tree failed' }
    $untracked = & git -C $repoRoot ls-files --others --exclude-standard -- skills/directing-stickman-videos/ 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
    # Owner explicitly authorized the following six Windows portability repairs
    # after the R1 UI baseline had already been locked. Preserve all other Core
    # source and every approved visual, font, prompt and media baseline asset.
    $authorized = @(
      'skills/directing-stickman-videos/tests/b4-opening-runtime.test.mjs',
      'skills/directing-stickman-videos/tests/b4-style-lock.test.mjs',
      'skills/directing-stickman-videos/tests/b5-local-baseline.test.mjs',
      'skills/directing-stickman-videos/tests/runtime.test.mjs',
      'skills/directing-stickman-videos/scripts/b5-production-quality.mjs',
      'skills/directing-stickman-videos/scripts/character-explainer.mjs'
    )
    $unexpected = @($range | Where-Object { $_ -and $authorized -notcontains $_ }) +
      @($working | Where-Object { $_ }) + @($untracked | Where-Object { $_ })
    if ($unexpected.Count) { throw "Unapproved native Core changes: $($unexpected -join ', ')" }
    "Core preservation PASS: $head; only six owner-authorized portability source/test files differ from main, no other Core changes or dirty files" | Set-Content -LiteralPath $log
    Add-Result 'core-preservation' 'PASS' 'git diff main...HEAD && working tree && untracked' 0 '' $watch.ElapsedMilliseconds @{ passed=0; failed=0; skipped=0 } @($log)
  } catch {
    $_ | Out-String | Set-Content -LiteralPath $log
    Add-Result 'core-preservation' 'FAIL' 'git diff main...HEAD && working tree && untracked' 1 $_.Exception.Message $watch.ElapsedMilliseconds @{ passed=0; failed=0; skipped=0 } @($log)
    $script:runFailed = $true
  } finally { $watch.Stop() }
}
$nativeCopy = $null
$studioSnapshot = $null
$zipFile = Join-Path $sourceStudioRoot "r1-local-results-$stamp.zip"
try {
  @("timestamp=$stamp", "head_sha=$head", "platform=$($environment.platform)", "PowerShell=$($environment.powershell)", "node=$(& node --version)", "npm=$(& npm.cmd --version)", "git=$(& git --version)", "electron_run_as_node=$($environment.electron_run_as_node)") | Set-Content (Join-Path $resultsRoot 'versions.log')
  if (-not $environment.windows) {
    foreach ($name in @('install','typecheck','lint','test','build','browser','electron-dev','electron-prod','native-core-tests')) { Skip-Step $name 'Windows local acceptance' 'This single-command gate must run on an ordinary Windows desktop.' }
    Invoke-CorePreservation
  } else {
    # A clean, temporary Git HEAD checkout prevents locked @esbuild/bin files
    # in the user's existing studio/node_modules from breaking npm ci.
    $snapshotOk = $false
    $snapshotWatch = [Diagnostics.Stopwatch]::StartNew()
    $snapshotLog = Join-Path $resultsRoot 'studio-snapshot.log'
    try {
      $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      $studioSnapshot = Join-Path $tempBase ('mode-b-studio-r1-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $studioSnapshot | Out-Null
      $archive = Join-Path $studioSnapshot 'source.zip'
      & git -c core.autocrlf=false -C $repoRoot archive --format=zip "--output=$archive" HEAD -- studio docs/ui *>&1 | Out-File -LiteralPath $snapshotLog -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw "git archive studio/docs/ui failed: $LASTEXITCODE" }
      Expand-Archive -LiteralPath $archive -DestinationPath $studioSnapshot -Force
      $studioRoot = Join-Path $studioSnapshot 'studio'
      if (-not (Test-Path -LiteralPath (Join-Path $studioRoot 'package-lock.json'))) { throw 'Snapshot missing studio/package-lock.json' }
      if (-not (Test-Path -LiteralPath (Join-Path $studioSnapshot 'docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html'))) { throw 'Snapshot missing locked V3 mockup' }
      "Exported clean HEAD $head into $studioRoot; user node_modules untouched." | Add-Content -LiteralPath $snapshotLog
      $snapshotOk = $true
      Add-Result 'studio-snapshot' 'PASS' 'git archive HEAD studio docs/ui; Expand-Archive to TEMP' 0 '' $snapshotWatch.ElapsedMilliseconds @{ passed=0; failed=0; skipped=0 } @($snapshotLog)
    } catch {
      $_ | Out-String | Add-Content -LiteralPath $snapshotLog
      Add-Result 'studio-snapshot' 'FAIL' 'git archive HEAD studio docs/ui; Expand-Archive to TEMP' 1 $_.Exception.Message $snapshotWatch.ElapsedMilliseconds @{ passed=0; failed=0; skipped=0 } @($snapshotLog)
      $script:runFailed = $true
    } finally { $snapshotWatch.Stop() }
    if ($snapshotOk) {
      # Use a free ephemeral port for *this* preview test run. Never attach to
      # an unrelated process that happens to own the default preview port 4173.
      # The development port remains strict 5174 and is NOT changed here.
      $previewListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
      $previewListener.Start()
      try { $env:R1_PREVIEW_PORT = [string]$previewListener.LocalEndpoint.Port }
      finally { $previewListener.Stop() }
      $cdpListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
      $cdpListener.Start()
      try { $env:R1_ELECTRON_CDP_PORT = [string]$cdpListener.LocalEndpoint.Port }
      finally { $cdpListener.Stop() }
      "R1_BROWSER_PREVIEW_PORT=$env:R1_PREVIEW_PORT; R1_ELECTRON_CDP_PORT=$env:R1_ELECTRON_CDP_PORT; strict Vite dev port=5174" | Add-Content -LiteralPath (Join-Path $resultsRoot 'versions.log')
      $installed = Invoke-CommandStep 'install' 'npm.cmd ci --no-audit --no-fund'
      if ($installed) {
      Invoke-CommandStep 'typecheck' 'npm.cmd run typecheck' | Out-Null
      Invoke-CommandStep 'lint' 'npm.cmd run lint' | Out-Null
      Invoke-CommandStep 'test' 'npm.cmd run test' | Out-Null
      $built = Invoke-CommandStep 'build' 'npm.cmd run build'
      if ($built) {
        Invoke-CommandStep 'browser' 'npx.cmd playwright test tests/ui/r1.spec.ts --reporter=line' | Out-Null
        if ($env:ELECTRON_RUN_AS_NODE) {
          Skip-Step 'electron-dev' 'npm run dev + Electron CDP smoke' 'ELECTRON_RUN_AS_NODE injected: GUI smoke cannot be trusted.'
          Skip-Step 'electron-prod' 'Electron production shell' 'ELECTRON_RUN_AS_NODE injected: GUI smoke cannot be trusted.'
        } else {
          Invoke-CommandStep 'electron-dev' 'npx.cmd playwright test --config playwright.electron.config.ts --grep "development URL" --reporter=line' | Out-Null
          Invoke-CommandStep 'electron-prod' 'npx.cmd playwright test --config playwright.electron.config.ts --grep "production shell" --reporter=line' | Out-Null
        }
      } else {
        Skip-Step 'browser' 'npx.cmd playwright test tests/ui/r1.spec.ts' 'Production build failed; browser UI test requires built dist.'
        Skip-Step 'electron-dev' 'npm run dev + Electron CDP smoke' 'Build dependency failed; Electron smoke not attempted.'
        Skip-Step 'electron-prod' 'Electron production shell' 'Production build failed; Electron smoke not attempted.'
      }
      } else {
        foreach ($name in @('typecheck','lint','test','build','browser','electron-dev','electron-prod')) { Skip-Step $name 'npm.cmd run ...' 'Isolated npm ci failed.' }
      }
    } else {
      foreach ($name in @('install','typecheck','lint','test','build','browser','electron-dev','electron-prod')) { Skip-Step $name 'npm.cmd run ...' 'Git source snapshot failed; see studio-snapshot.log.' }
    }
    Invoke-CorePreservation
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $nativeCopy = Join-Path $tempBase ('mode-b-core-r1-' + [guid]::NewGuid().ToString('N'))
    try {
      New-Item -ItemType Directory -Path $nativeCopy | Out-Null
      # Git object bytes are mandatory for byte-exact B4/B5 fingerprints.
      # A regular Windows checkout may have been converted to CRLF.
      $nativeArchive = Join-Path $nativeCopy 'native-core-source.zip'
      & git -c core.autocrlf=false -C $repoRoot archive --format=zip "--output=$nativeArchive" HEAD -- skills/directing-stickman-videos
      if ($LASTEXITCODE -ne 0) { throw "git archive native core failed: $LASTEXITCODE" }
      Expand-Archive -LiteralPath $nativeArchive -DestinationPath $nativeCopy -Force
      $nativeDir = Join-Path $nativeCopy 'skills/directing-stickman-videos'
      if (-not (Test-Path -LiteralPath (Join-Path $nativeDir 'package-lock.json'))) { throw 'Native snapshot missing package-lock.json' }
      # Verify exact approved source fingerprints BEFORE running tests. Git autocrlf
      # would turn LF into CRLF and cause dozens of misleading cascade failures.
      $expectedLocks = @(
        @{ relative = 'assets/b4/style-lock.txt'; sha256 = 'a724ce29b03624c13e70a8ae5a8c8209e83a48b697b28244263d3eefa0193795' },
        @{ relative = 'assets/b5/example/assets/fonts/Anton-OFL.txt'; sha256 = 'dbd945e828dd179a73d9cc376742cdc6a1c9ff399ed127bf544aa3de8913f1a9' },
        @{ relative = 'assets/b5/local-baselines/jensen-v13/scene/assets/fonts/Anton-OFL.txt'; sha256 = 'dbd945e828dd179a73d9cc376742cdc6a1c9ff399ed127bf544aa3de8913f1a9' }
      )
      $hashLog = Join-Path $resultsRoot 'native-source-integrity.log'
      $integrityWatch = [Diagnostics.Stopwatch]::StartNew()
      foreach ($lock in $expectedLocks) {
        $absolute = Join-Path $nativeDir $lock.relative
        $actual = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
        "file=$($lock.relative) actual=$actual expected=$($lock.sha256)" | Add-Content -LiteralPath $hashLog
        if ($actual -ne $lock.sha256) {
          throw "NATIVE_SNAPSHOT_BYTE_MISMATCH: $($lock.relative) expected=$($lock.sha256) actual=$actual. Check Git archive EOL filters; do not alter locked Core."
        }
      }
      Add-Result 'native-source-integrity' 'PASS' 'SHA256 verify B4/B5 Git-object-approved files' 0 '' $integrityWatch.ElapsedMilliseconds @{ passed=3; failed=0; skipped=0 } @($hashLog)
      Invoke-CommandStep 'native-core-tests' 'npm.cmd ci --no-audit --no-fund && npm.cmd test' $nativeDir | Out-Null
    } catch {
      $log = Join-Path $resultsRoot 'native-core-tests.log'
      $_ | Out-String | Set-Content -LiteralPath $log
      if ($_.Exception.Message -like 'NATIVE_SNAPSHOT_BYTE_MISMATCH:*') {
        Add-Result 'native-source-integrity' 'FAIL' 'SHA256 verify B4/B5 Git-object-approved files' 1 $_.Exception.Message 0 @{ passed=0; failed=3; skipped=0 } @((Join-Path $resultsRoot 'native-source-integrity.log'))
        Skip-Step 'native-core-tests' 'isolated npm ci && npm test' 'Byte integrity prerequisite failed; do not run misleading native regression tests.'
      } else {
        Add-Result 'native-core-tests' 'FAIL' 'isolated npm ci && npm test' 1 $_.Exception.Message 0 @{ passed=0; failed=0; skipped=0 } @($log)
      }
      $runFailed = $true
    }
  }
  $parity = Join-Path $resultsRoot 'visual-parity-report.md'
  if ((Test-Path -LiteralPath $parity) -and $VisualReviewAccepted) {
    Add-Result 'visual-parity-review' 'PASS' 'Owner explicitly attested review of 4 side-by-side images' 0 'Human-reviewed using -VisualReviewAccepted; geometry report and screenshots provided.' 0 @{ passed=0; failed=0; skipped=0 } @($parity)
  } elseif (Test-Path -LiteralPath $parity) {
    Skip-Step 'visual-parity-review' 'owner compare 4 side-by-side images' 'Artifacts captured; owner visual acceptance required, not automatic PASS.'
  } else {
    Skip-Step 'visual-parity-review' 'owner compare 4 side-by-side images' 'No complete visual-parity report captured.'
  }
}
finally {
  if ($studioSnapshot -and (Test-Path -LiteralPath $studioSnapshot)) {
    $resolvedSnapshot = [IO.Path]::GetFullPath($studioSnapshot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedSnapshot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedSnapshot -Leaf) -like 'mode-b-studio-r1-*') {
      Remove-Item -LiteralPath $resolvedSnapshot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if ($nativeCopy -and (Test-Path -LiteralPath $nativeCopy)) {
    $resolved = [IO.Path]::GetFullPath($nativeCopy)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'mode-b-core-r1-*') {
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $allPassed = $steps.Count -gt 0 -and @($steps | Where-Object { $_.status -ne 'PASS' }).Count -eq 0
  $failed = @($steps | Where-Object { $_.status -eq 'FAIL' }).Count
  $notRun = @($steps | Where-Object { $_.status -eq 'NOT_RUN' }).Count
  $verdict = if ($failed -gt 0) { 'FAIL' } elseif ($notRun -gt 0) { 'PARTIAL' } elseif ($allPassed) { 'PASS' } else { 'PARTIAL' }
  [ordered]@{ head_sha=$head; timestamp=$stamp; environment=$environment; verdict=$verdict; counts=@{passed=@($steps|Where-Object status -eq 'PASS').Count;failed=$failed;not_run=$notRun}; steps=$steps; zip=$zipFile } |
    ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $resultsRoot 'results.json') -Encoding utf8
  try { Compress-Archive -Path (Join-Path $resultsRoot '*') -DestinationPath $zipFile -Force -ErrorAction Stop }
  catch { Write-Warning "Evidence ZIP failed: $($_.Exception.Message)"; $runFailed = $true }
  Write-Host "R1 verdict: $verdict | HEAD: $head | ZIP: $zipFile"
}
if ($verdict -ne 'PASS' -or $runFailed) { exit 1 }
