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
Invoke-Gate 'R3-GLabs-Mock' 'npx' @('vitest','run','tests/unit/R3GLabs.test.ts','tests/unit/R3GLabsPreviewUI.test.tsx','tests/unit/R3WindowsAcceptance.test.ts')
Invoke-Gate 'Native-Four-Operations' 'npx' @('vitest','run','tests/unit/NativeFourOperations.test.ts','tests/unit/NativeFourOperationsUI.test.tsx')
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
    $coreStatus = 'BLOCKED'
    $exitCode = $null
    $baseline = 'main'
    try {
        # HEAD must be compared with the PR base's merge-base, never an R2 milestone SHA.
        & git rev-parse --verify 'main^{commit}' *> $diffLog
        $baseExit = $LASTEXITCODE
        if($baseExit -ne 0) {
            "Core baseline main is missing; comparison cannot be verified." | Add-Content -Path $diffLog
        }
        else {
            & git merge-base main HEAD *> $diffLog
            $mergeExit = $LASTEXITCODE
            if($mergeExit -ne 0) {
                "No trustworthy merge-base for main...HEAD." | Add-Content -Path $diffLog
            }
            else {
                & git diff --name-only main...HEAD -- skills/directing-stickman-videos/ *> $diffLog
                $exitCode = $LASTEXITCODE
                if($exitCode -ne 0) {
                    $coreStatus = 'FAIL'
                }
                elseif(!(Test-Path $diffLog)) {
                    $coreStatus = 'BLOCKED'
                }
                else {
                    $modified = (Get-Content -Path $diffLog -Raw).Trim()
                    $coreStatus = if([string]::IsNullOrWhiteSpace($modified)){'PASS'}else{'FAIL'}
                }
            }
        }
    }
    catch {
        $_ | Out-String | Add-Content -Path $diffLog
        $coreStatus = 'BLOCKED'
    }
    $results += @{name='Original-Mode-B-Core-unchanged';status=$coreStatus;baseline=$baseline;exit_code=$exitCode;log=$diffLog}
    Write-Host "Original-Mode-B-Core-unchanged : $coreStatus"
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
if(@($results | Where-Object { $_.status -in @('FAIL','BLOCKED') }).Count -gt 0){exit 1}
exit 0
