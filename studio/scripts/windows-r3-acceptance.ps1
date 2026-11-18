# STICKMAN R3 — owner-run Windows gates. No paid provider calls are made by this script.
param([switch]$IncludeUi)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$studio = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $studio '..')).Path
$reports = Join-Path $studio '.r3-acceptance'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
$results = @()
$started = (Get-Date).ToString('o')

function Invoke-Gate([string]$label,[string]$exe,[string[]]$arguments) {
    $safeName = $label -replace '[^a-zA-Z0-9_-]', '-'
    $log = Join-Path $reports "$safeName.log"
    Push-Location $studio
    $code = 1
    try {
        & $exe @arguments *> $log
        $code = $LASTEXITCODE
    }
    catch {
        $_ | Out-String | Add-Content -Path $log
    }
    finally { Pop-Location }
    $outcome = if($code -eq 0){'PASS'}else{'FAIL'}
    Write-Host "$label : $outcome (exit=$code, log=$log)"
    $script:results += @{ name=$label; status=$outcome; exit_code=$code; log=$log }
}

Invoke-Gate 'TypeScript' 'npm' @('run','typecheck')
Invoke-Gate 'ESLint' 'npm' @('run','lint')
Invoke-Gate 'R3-Auto-Captions-And-Shots' 'npx' @('vitest','run','tests/unit/R3AutoCaptions.test.ts')
Invoke-Gate 'R3-GLabs-Mock' 'npx' @('vitest','run','tests/unit/R3GLabs.test.ts')
Invoke-Gate 'R2-R3-Full-Unit' 'npm' @('test')
Invoke-Gate 'Production-Build' 'npm' @('run','build')
if($IncludeUi){
    Invoke-Gate 'Electron-Playwright' 'npm' @('run','test:ui')
}
else {
    $results += @{ name='Electron-Playwright'; status='NOT_RUN'; reason='Pass -IncludeUi when Electron/browser prerequisites are installed.' }
}

$diffLog = Join-Path $reports 'Mode-B-Core-diff.log'
Push-Location $repo
try {
    & git diff --name-only 89761c54dd7ca54c4d0c5769324d5de9828a84e6 HEAD -- skills/directing-stickman-videos *> $diffLog
    $exitCode = $LASTEXITCODE
    $modified = if(Test-Path $diffLog){(Get-Content $diffLog -Raw).Trim()}else{''}
    $coreStatus=if($exitCode -eq 0 -and [string]::IsNullOrWhiteSpace($modified)){'PASS'}else{'FAIL'}
    $results += @{name='Original-Mode-B-Core-unchanged';status=$coreStatus;exit_code=$exitCode;log=$diffLog}
}
finally {Pop-Location}

$results += @{ name='Live-GLabs-Webhook';status='NOT_RUN';reason='Requires owner running local webhook. Health/auth read-only probe is separate. No billable POST automated.' }
$results += @{ name='Windows-Native-Full-E2E';status='NOT_RUN';reason='Requires owner-controlled Script, WAV, forced alignment, native manifest, manual image approval and preview/full render.' }
$report = @{
    schema='stickman-r3-windows-acceptance-v1'
    started_at=$started
    finished_at=(Get-Date).ToString('o')
    git_head=(& git -C $repo rev-parse HEAD)
    gates=@($results)
    safety='No automatic Nano generation, ElevenLabs POST or G-Labs image generation from this script.'
}
$json=Join-Path $reports 'R3_WINDOWS_GATES.json'
$report | ConvertTo-Json -Depth 10 | Set-Content -Path $json -Encoding utf8
Write-Host "Evidence: $json"
if(@($results | Where-Object { $_.status -eq 'FAIL' }).Count -gt 0){exit 1}
exit 0
