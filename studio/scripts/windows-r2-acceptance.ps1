#requires -Version 5.1
param([switch]$RunElectron)
$ErrorActionPreference = 'Stop'
$studioRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $studioRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$results = Join-Path $studioRoot ("r2-local-results-" + $stamp)
New-Item -ItemType Directory -Path $results | Out-Null
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
$records = [System.Collections.Generic.List[object]]::new()
function Record([string]$id,[string]$status,[string]$command,[string]$reason,[int]$exitCode,[long]$elapsed,[string]$log) {
  $records.Add([pscustomobject]@{ id=$id; status=$status; command=$command; reason=$reason; exit_code=$exitCode; elapsed_ms=$elapsed; head_sha=$head; evidence=$log })
  Write-Host "$id => $status $reason"
}
function Run-Step([string]$id,[string]$command,[string]$cwd=$studioRoot) {
  $log=Join-Path $results ($id+'.log'); $watch=[Diagnostics.Stopwatch]::StartNew(); Push-Location $cwd
  $priorPreference=$ErrorActionPreference
  try { $ErrorActionPreference='Continue'; & cmd.exe /d /s /c $command *>&1 | Out-File -LiteralPath $log -Encoding utf8; $code=[int]$LASTEXITCODE; if($code -eq 0){Record $id 'PASS' $command '' $code $watch.ElapsedMilliseconds $log}else{Record $id 'FAIL' $command "exit $code" $code $watch.ElapsedMilliseconds $log} }
  catch { $_ | Out-String | Add-Content -LiteralPath $log; Record $id 'FAIL' $command $_.Exception.Message 1 $watch.ElapsedMilliseconds $log }
  finally { $ErrorActionPreference=$priorPreference; Pop-Location; $watch.Stop() }
}
function Not-Run([string]$id,[string]$command,[string]$reason){$log=Join-Path $results ($id+'.log');("NOT_RUN: "+$reason)|Set-Content -LiteralPath $log;Record $id 'NOT_RUN' $command $reason 0 0 $log}

@("timestamp=$stamp","head=$head","windows=$([Environment]::OSVersion.VersionString)","powershell=$($PSVersionTable.PSVersion)","node=$(& node --version)","npm=$(& npm.cmd --version)") | Set-Content -LiteralPath (Join-Path $results 'versions.log')
Run-Step 'typecheck' 'npm.cmd run typecheck'
Run-Step 'lint' 'npm.cmd run lint'
Run-Step 'unit-integration' 'npm.cmd test'
Run-Step 'build' 'npm.cmd run build'
$preview = $null
try {
  $preview = Start-Process -FilePath 'node.exe' -ArgumentList @('node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort') -WorkingDirectory $studioRoot -WindowStyle Hidden -PassThru
  for($attempt=0;$attempt -lt 40;$attempt++){try{$response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/' -TimeoutSec 1;if($response.StatusCode -eq 200){break}}catch{};Start-Sleep -Milliseconds 250}
  $env:R2_EXTERNAL_SERVER='1'; Run-Step 'browser-ui' 'node node_modules/@playwright/test/cli.js test tests/ui/r1.spec.ts tests/ui/r2.spec.ts --reporter=line'
} finally { Remove-Item Env:R2_EXTERNAL_SERVER -ErrorAction SilentlyContinue; if($preview -and -not $preview.HasExited){Stop-Process -Id $preview.Id -Force} }
if(Test-Path -LiteralPath (Join-Path $repoRoot 'skills/directing-stickman-videos/node_modules/@napi-rs/canvas')){Run-Step 'native-core' 'npm.cmd test' (Join-Path $repoRoot 'skills/directing-stickman-videos')}else{Not-Run 'native-core' 'npm.cmd test' 'Native Core dependencies are not installed in this checkout; original CLI init was verified separately and no dependency mutation was authorized.'}
$changed = @(& git -C $repoRoot diff --name-only -- skills/directing-stickman-videos) + @(& git -C $repoRoot ls-files --others --exclude-standard -- skills/directing-stickman-videos)
$coreLog=Join-Path $results 'core-preservation.log'
if($changed.Count -eq 0){'No R2 working-tree native Core changes.'|Set-Content $coreLog;Record 'core-preservation' 'PASS' 'git diff working tree and untracked' '' 0 0 $coreLog}else{$changed|Set-Content $coreLog;Record 'core-preservation' 'FAIL' 'git diff working tree and untracked' 'Native Core changed during R2' 1 0 $coreLog}
if($RunElectron -and -not $env:ELECTRON_RUN_AS_NODE){Run-Step 'electron-native' 'npx.cmd playwright test --config playwright.electron.config.ts --reporter=line'}else{Not-Run 'electron-native' 'Playwright Electron dev/prod smoke' 'Use -RunElectron on an interactive Windows desktop; no GUI claim was made.'}
Not-Run 'nano-live' 'VoiceStudio Nano generation' 'Paid/live/provider network tests are excluded; contract and WAV verification are covered locally.'
Not-Run 'elevenlabs-live' 'ElevenLabs forced alignment' 'User authorization and a live secret are required; no cloud request was made.'
$summary=[pscustomobject]@{schema='r2-local-acceptance-v1';head_sha=$head;created_at=(Get-Date).ToString('o');steps=$records;overall=if($records.status -contains 'FAIL'){'FAIL'}else{'PASS_WITH_NOT_RUN'}}
$summary|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $results 'results.json') -Encoding utf8
$zip=Join-Path $studioRoot ("r2-local-results-"+$stamp+'.zip');Compress-Archive -LiteralPath $results -DestinationPath $zip
Write-Host "Evidence: $zip"
if($records.status -contains 'FAIL'){exit 1}
