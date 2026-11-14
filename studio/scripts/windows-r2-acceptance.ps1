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
  $evidenceHash=if(Test-Path -LiteralPath $log){(Get-FileHash -Algorithm SHA256 -LiteralPath $log).Hash.ToLowerInvariant()}else{''}
  $records.Add([pscustomobject]@{ id=$id; status=$status; command=$command; reason=$reason; exit_code=$exitCode; elapsed_ms=$elapsed; head_sha=$head; evidence=$log; evidence_sha256=$evidenceHash })
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
$env:FFMPEG=(& node -e "process.stdout.write(require('ffmpeg-static'))")
$env:FFPROBE=(& node -e "process.stdout.write(require('@ffprobe-installer/ffprobe').path)")
$env:PATH=(Split-Path -Parent $env:FFMPEG)+';'+(Split-Path -Parent $env:FFPROBE)+';'+$env:PATH
Run-Step 'typecheck' 'npm.cmd run typecheck'
Run-Step 'lint' 'npm.cmd run lint'
Run-Step 'unit-integration' 'npm.cmd test'
Run-Step 'build' 'npm.cmd run build'
$preview = $null
try {
  $preview = Start-Process -FilePath 'node.exe' -ArgumentList @('node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort') -WorkingDirectory $studioRoot -WindowStyle Hidden -PassThru
  for($attempt=0;$attempt -lt 40;$attempt++){try{$response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/' -TimeoutSec 1;if($response.StatusCode -eq 200){break}}catch{};Start-Sleep -Milliseconds 250}
  $browserEvidence=Join-Path $results 'browser';New-Item -ItemType Directory -Path $browserEvidence|Out-Null;$env:R1_SCREENSHOTS=$browserEvidence;$env:R2_EXTERNAL_SERVER='1'; Run-Step 'browser-ui' 'node node_modules/@playwright/test/cli.js test tests/ui/r1.spec.ts tests/ui/r2.spec.ts --reporter=line'
} finally { Remove-Item Env:R2_EXTERNAL_SERVER -ErrorAction SilentlyContinue;Remove-Item Env:R1_SCREENSHOTS -ErrorAction SilentlyContinue;if($preview -and -not $preview.HasExited){Stop-Process -Id $preview.Id -Force} }
$coreArchive=Join-Path $results 'core.tar';$coreSnapshot=Join-Path $results 'core-snapshot';& git -C $repoRoot archive -o $coreArchive HEAD skills/directing-stickman-videos;if($LASTEXITCODE -ne 0){throw 'git archive failed'};New-Item -ItemType Directory -Path $coreSnapshot|Out-Null;& tar.exe -xf $coreArchive -C $coreSnapshot;if($LASTEXITCODE -ne 0){throw 'core archive extraction failed'}
Run-Step 'native-core' 'npm.cmd ci --no-audit --no-fund && npm.cmd test' (Join-Path $coreSnapshot 'skills/directing-stickman-videos')
Remove-Item -LiteralPath $coreSnapshot -Recurse -Force;Remove-Item -LiteralPath $coreArchive -Force
Run-Step 'offline-native' ("node scripts/r2-offline-native.mjs `""+$results+"`"")
$baseMain=(& git -C $repoRoot rev-parse origin/main).Trim();$historyChanged=@(& git -C $repoRoot diff --name-status "$baseMain...$head" -- skills/directing-stickman-videos);$changed = $historyChanged + @(& git -C $repoRoot diff --name-status -- skills/directing-stickman-videos) + @(& git -C $repoRoot ls-files --others --exclude-standard -- skills/directing-stickman-videos)
$coreLog=Join-Path $results 'core-preservation.log'
if($changed.Count -eq 0){"BASE_MAIN=$baseMain`nHEAD=$head`nHistory, worktree and untracked Core diff are empty."|Set-Content $coreLog;Record 'core-preservation' 'PASS' 'git diff BASE_MAIN...HEAD plus worktree/untracked' '' 0 0 $coreLog}else{$changed|Set-Content $coreLog;Record 'core-preservation' 'FAIL' 'git diff BASE_MAIN...HEAD plus worktree/untracked' 'Native Core changed during R2' 1 0 $coreLog}
if($RunElectron -and -not $env:ELECTRON_RUN_AS_NODE){Run-Step 'electron-native' 'npx.cmd playwright test --config playwright.electron.config.ts --reporter=line'}else{Not-Run 'electron-native' 'Playwright Electron dev/prod smoke' 'Use -RunElectron on an interactive Windows desktop; no GUI claim was made.'}
Not-Run 'nano-live' 'VoiceStudio Nano generation' 'Owner GTX1650 producer was not invoked; local contract tests are not a hardware PASS.'
Not-Run 'elevenlabs-live' 'ElevenLabs forced alignment' 'User authorization and a live secret are required; no cloud request was made.'
$summary=[pscustomobject]@{schema='r2-local-acceptance-v1';head_sha=$head;created_at=(Get-Date).ToString('o');steps=$records;overall=if($records.status -contains 'FAIL'){'FAIL'}else{'PASS_WITH_NOT_RUN'}}
$summary|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $results 'results.json') -Encoding utf8
$zip=Join-Path $studioRoot ("r2-local-results-"+$stamp+'.zip');Compress-Archive -LiteralPath $results -DestinationPath $zip
Write-Host "Evidence: $zip"
if($records.status -contains 'FAIL'){exit 1}
