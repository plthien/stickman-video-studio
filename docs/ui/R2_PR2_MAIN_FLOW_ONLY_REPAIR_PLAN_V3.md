# R2 / PR #2 — MAIN FLOW ONLY REPAIR PLAN V3

> **SUPERSEDED FOR THE NEXT CODEX IMPLEMENTATION ROUND:** [R2 PR #2 — Six-Issue UT-Only Repair Plan V4](R2_PR2_SIX_ISSUE_UT_ONLY_ONE_ROUND_REPAIR_PLAN_V4.md). Owner now handles E2E directly. V3 remains background for architecture, but V4 overrides its wider FIX and end-to-end test requirements.

**Status:** OWNER RE-SCOPE — AUTHORITATIVE FOR THE NEXT CODEX ROUND.
**Repository:** plthien/stickman-video-studio
**Branch:** feat/r2-external-native-workflow
**PR:** #2 (Draft; do not merge)
**Audited implementation HEAD:** 0c9ddf956c61d9761b2d33329f9423feba726fd1
**Current source context:** The branch also contains documentation-only V2 plan changes; fetch latest HEAD and use V3 over conflicting V2 priorities.
**Previous Windows evidence:** r2-local-results-20261114-192028.zip (offline native CLI fixture PASS; native core isolated tests 44 failures; actual Nano GPU, ElevenLabs live, Electron GUI NOT_RUN).
**Nano source:** plthien/VoiceStudio-GGUF-Lite, feat/chatterbox-turbo-provider, producer HEAD 7792fb47c292d8f0da8a4666d174be4689ac34b3.
**Producer references:** docs/integrations/youtube-studio-nano-api-v1.md, lite/chatterbox_contract.py, lite/chatterbox_assembly.py and tests/fixtures/nano_api_v1/golden_receipt.json.
**Source of original Mode B:** skills/directing-stickman-videos/**, unmodified.

## 0. OWNER PRIORITY OVERRIDE — DO NOT LOSE TIME ON ELECTRON INFRA

This V3 **supersedes V2 only for the current repair scope and test priority**. The goal is to make the ACTUAL VIDEO PRODUCTION WORKFLOW complete; Electron hardening, smoke, GUI-automation and pixel-perfect UI visual parity are intentionally deferred to a later owner-approved phase after Main Flow works.

**Current one-round target:**
Idea/brief & selected B1–B4 -> frozen original-Skill ChatGPT prompt -> manually approved script + creative direction -> existing Chatterbox Nano single/long-form WAV or imported verified WAV -> ElevenLabs word alignment or imported verified WORDS -> original native caption grouping -> self-contained second manual ChatGPT prompt with ACTUAL words/cues/duration -> authored media, motion, SFX and native project.json -> import/validate/diff/confirm -> original CLI preview -> explicit human approval -> original CLI render -> actual film.mp4 and SRT/VTT/QA/cache.

**Execution priority:** Main Flow critical blockers first (roughly 80% attention); minimum UI bridge/project state necessary to use that workflow second; Electron infrastructure later.

### NON-NEGOTIABLE
1. ZERO code changes in skills/directing-stickman-videos/**. Original Core remains 100% unchanged, including original design rules, native v1 JSON, B-style engine, CLI commands, preview, fingerprint, cache, sound and QA. Never modify Core/golden files or test expectations to make PR green.
2. ZERO code changes to producer repository or its TTS engine. R2 is API client and invokes its existing owned long-form assembler. Do not implement a second local TTS engine or segmentation/assembly algorithm.
3. No LLM API, G-Labs, Remotion, ChatGPT web automation, new agent framework, B5, invented new native JSON schema, fabricated word timestamps or voice/audio. Manual external ChatGPT Web remains the only authoring interface.
4. VoiceStudio Settings stays **WITHOUT ANY Contract field/version selector**. Default Nano URL http://127.0.0.1:3901; one shared connection value. Validate response formats internally, without a user-facing contract system.
5. ElevenLabs is owner-authorized FORCED ALIGNMENT ONLY, never a hidden paid or TTS fallback. Real API key remains main-side; no credentials in UI state, JSON exports, screenshots, logs or ZIP.
6. Keep 9-page R1 V3 shell and existing UI layout. Change only controls/data bindings required to produce a video. Do not redesign UI.
7. Do not skip main-flow integrity: reject stale script/audio/word timing/media, unsafe imported JSON/path, false preview approvals and uncertain TTS retry. Those are **business-flow safety**, not optional Electron infrastructure.

### EXPLICITLY DEFER TO A SEPARATE ELECTRON/PLATFORM ROUND
- Electron development/production GUI smoke, CDP/window launch automation and Windows GUI test runners.
- Historic R1 Electron smoke failures and unrelated GUI platform/environment problems.
- Pixel-perfect V3 screenshot parity/visual regression and cosmetic redesign.
- General Electron sandbox/IPC architecture refactor unrelated to actual media IO; project creation dialogs and cross-process operation only need minimal reliable wiring.
- General Windows process-tree manager and other platform-wide infrastructure beyond a necessary bounded single job + basic cancel/error behavior for actual video flow.
- Investigation/fix of **44 isolated original Core tests**, except capture their current status, verify **Core tracked diff = 0**, and report not run/failure honestly. Offline original native CLI pipeline still MUST PASS; no claim that all Core regression tests PASS.
- Avoid installing/running unrelated GUI suites or refactoring tests while core video creation is broken.

Deferral does NOT excuse a production-flow data loss, arbitrary code execution from imported JSON, unsafe file writes, absent preview, or workflow crashes. Fix narrow issues in studio/** when they directly block production.

## 1. SOURCE-VERIFIED CURRENT MAIN-FLOW FINDINGS (scope baseline)

MF-01 (P0): studio/src/main/nanoClient.ts calls GET /profiles/{id}/integrity/verify but producer requires POST; checks integrity.ok instead of verified; compares receipt requested_speed numeric vs producer six-decimal string; reads X-Lite-Speech-Spans instead of X-Lite-Speech-Segments. Mock in tests/unit/NanoIntegration.test.ts repeats consumer's mistaken shape (speed_mode "atempo", numeric requested speed, non-hex binding). Can't claim actual Nano compatibility.
MF-02 (P0): VoiceWorkspace.tsx only generates for approved script <=4096 characters; main/index.ts voice:longformStatus only reports producer script availability; no producer assembler execution/--resume/output projection through Studio; no user-facing local WAV import.
MF-03 (P0): externalTasks.ts projectContext embeds alignment FILE PATHS but not actual word timestamps and caption cue CONTENT; ChatGPT Web cannot read user's local path. Missing actual voice-led source data.
MF-04 (P0): stageImport/confirmImport trust old task.inputSha256 without recomputing a fingerprint of current script/WAV bytes/words/cues/assets/source/brief; stale native results can be accepted after upstream changes.
MF-05 (P1): Script payload permits only sections[{id,text}], dropping creative direction/character/sound/reference decisions; native payload only manifest, dropping project-local shot/sound/asset ledger. Original agent instructions are bundled but actual creative work is not persisted completely.
MF-06 (P1): native manifest top-level allowlist in externalTasks.ts rejects original-supported caption_override; imported captions are not authoritatively anchored to accepted native captions/word timing. WAITING_FOR_MEDIA paths can deadlock or become stale after user adds assets.
MF-07 (P1): nanoGenerate IPC still accepts arbitrary request.input from renderer without binding it to exact current approved narration (voice/source drift).
MF-08 (P1): ElevenLabs alignment currently has main-side env key and word coverage, but no local existing WAV/WORDS import route and no saved review of actual caption grouping/boundaries; approved audio/words should be reusable offline.
MF-09 (P1): Storyboard imports image/SFX and shows latest filename but does not attach the media to an actual shot/layer or update its native candidate revision; real project Editor still exposes in-memory inspector operations as if editing.
MF-10 (P1): Existing native preview/approval/render UI and sidecars need to revalidate CURRENT project/audio/media fingerprint before replay/reuse/approve; must never show APPROVED or FILM VERIFIED from stale state. Editor timeline currently invents captions/narration coverage and shows empty SFX/Ambience lanes despite native data.
MF-11 (P1): End-to-end evidence script runs direct original CLI fixture (20s sine WAV) separately; there is no Studio SERVICE-level test proving script->audio/words import->second prompt->native manifest promotion->video via Studio's own application services.

**Already good / must preserve:** No changes to Core; Settings Contract absent, port 3901; installed original Skill texts in frozen prompt; main-only ElevenLabs key; original native offline fixture actually rendered MP4 and cache; opt-in sample replace and approval note. Do not rewrite these working parts.

## 2. EXECUTE SIX DIRECTED FIXES, IN THIS DEPENDENCY ORDER

### FLOW-FIX-01 — VoiceStudio Nano exact API and real short + long narration
Own files: studio/src/main/nanoClient.ts, studio/src/main/index.ts, studio/src/renderer/features/voice/VoiceWorkspace.tsx, narrow producer adapter under studio/src/main/, Nano tests.

A. Make GET /health (liveness only), GET /lite/readiness (generation readiness), GET /profiles, GET /profiles/{id} work with truthful producer responses. Call **POST** /profiles/{id}/integrity/verify; require verified=true, binding 64-lowercase-hex, voice_id, voice_version, reference_sha256 match confirmed profile. No "default" placeholder voice.
B. POST /v1/audio/speech with producer-supported parameters and correct request source from MAIN: EXACT currently approved script (including approved pause markers), chosen named profile, language/speed/seed. Renderer cannot pass arbitrary substitute input. Never invoke unapproved regeneration of an accepted voice.
C. Verify bounded, correct producer HTTP WAV response: original 24k mono PCM16 bytes, SHA, all native frame accounting, proof and canonical X-TTS-Execution-Receipt, X-TTS-Execution-Proof; six-decimal STRING requested/effective speed ("1.000000"), speed_mode "postprocess_atempo", "X-Lite-Speech-Segments" header and exact required fields from lite/chatterbox_contract.py. Match input/voice/reference/profile/revisions. Proof is a checksum, not independent GPU attestation. Stage, verify and atomic publish; existing valid audio must survive failures.
D. Replace self-generated mock with producer-owned golden_receipt.json (pin producer source checksum). Add positive + negative tests for correct method/response schema, speed type/precision, headers, invalid binding/receipt, truncated WAV, reference drift, 422/429 definite failures and 499/504/transport uncertain outcome; never auto-retry uncertain request.
E. Connect producer OWNED long-form tool, do NOT reimplement segmentation/mixing: validated locally configured VOICE_STUDIO_ROOT, existing lite.chatterbox_assembly.py via python -m lite.chatterbox_assembly --manifest ... --output ... [--resume] (explicit owner-action --retry-uncertain). Stable section ID/approved text, capture status, logs, each original section receipt and final.wav/summary.json; verify final WAV and matching full source before atomic import to Studio. A 2+ section job must be usable through Voice UI, including resume after interruption.
F. Source currently uses language="en" for long-form. Do not silently claim Vietnamese or unsupported language support; expose clear unsupported/unverified status or use an already verified user-imported WAV/words workflow. Do not edit producer. Current final assembler limit 900s; no new silent cutoff.
G. Add "Import existing WAV" if producer unavailable, validating 24k mono PCM16 or a documented original-CLI-compatible WAV, provenance IMPORTED_WAV, hash, duration and explicit chosen voice/source. This path enables offline Main Flow without paid/live service; do not falsely label it Nano-generated.
PASS: producer golden fixture and correct HTTP fake producer both pass; verified generated or owner-imported WAV drives next step; existing WAV protected on failure; source-owned assembler can run and resume through Studio tests; no Contract UI.

### FLOW-FIX-02 — True alignment, semantic caption review and offline WORDS import
Own files: studio/src/main/alignment.ts, studio/src/main/index.ts, Voice/Captions workspace, minimal storage/tests.

A. ElevenLabs opt-in must upload exact accepted WAV + exact approved spoken transcript with supported pause markers excluded, retain transcript/WAV hashes, error on unmatched/missing/timing-invalid words, preserve raw confidence/character data where meaningful for review. Main-side API key only. Native captions CLI is original authority for grouping, not LLM synthetic timestamps.
B. Add imported original-compatible WORDS.json and optionally existing captions for owner-provided alignment; validate monotonically increasing finite start/end, correct token order/coverage with approved text, correct audio duration and WAV hash binding, and run original autopilot.mjs captions. Distinguish origin ELEVENLABS_LIVE vs IMPORTED_WORDS.
C. Let owner review native semantic captions and correct cue grouping in scoped project sidecar revisions, validate native one-line/safe timing, preserve real words and do not fabricate seconds. Freeze final accepted captions for the second prompt.
D. Changing WAV/text invalidates alignment and captions; changing only image/SFX does not. Live ElevenLabs is optional owner-authorized; offline imported words must allow complete video production.
PASS: actual imported WAV + real word data -> original native captions JSON; transcript mismatch and stale hashes are rejected; user can review/revise caption cue boundaries; tests cover negative and success paths.

### FLOW-FIX-03 — Exact two-stage manual ChatGPT handoff with actual creative/timing evidence
Own files: studio/src/main/externalTasks.ts, ExternalWorkspace, approved script sidecar and tests.

A. Keep TWO task handoffs: SCRIPT+CREATIVE DIRECTION before audio, and VISUAL/SHOT/SOUND/NATIVE project.json after audio/words/captions. Do not create another agent engine.
B. Script import schema sidecar includes original narrative sections PLUS creative choices, story/character direction, actual source/citation notes, SFX/ambience intentions, B-style-specific decisions. The approved exact spoken text is separately frozen; arbitrary creative sidecar fields must not be inserted into Core's project.json.
C. Second prompt includes INLINE CONTENT (not just filesystem paths) of original verified word-timing data [{word,start,end}], semantic native caption cues and hashes, actual WAV frames/duration/hash, approved script/source facts, selected Style+original Skill sources, current asset inventory with path+hash/availability/rights status, sound/shot ledger and missing assets. ChatGPT Web sees everything it needs without accessing user's disk. Preserve the approved B4 Brian/user_override and story-specific directions as needed by style.
D. Native response contains accepted original-version-B1–B4 manifest + optional Studio-only authoring ledger; validate all media and style grammar through original CLI. No duplicated/invented times; no guess that a ChatGPT response is accurate without real data.
E. Use explicit task regeneration/rebuild, scoped repair for script section or shot/layer/field. Prompt freeze remains byte-stable until relevant inputs change.
PASS: test fully self-contained exported prompt with at least 3 words, 2 actual caption cues and more than one media asset; round-trip of creative sidecars and native JSON in project state, no data loss, no local inaccessible paths required as content.

### FLOW-FIX-04 — Source binding, asset mapping, native manifest promotion and safe revision
Own files: externalTasks.ts, services.ts, Storyboard, minimum Editor mapping, tests.

A. Build a single CURRENT fingerprint for script/native tasks from actual approved script/creative direction, audio bytes/hash/profile, word/caption DATA hashes, selected B-style source hash, brief and relevant mapped assets with content hashes. Recompute at stage AND confirm; reject stale/replayed output before any file changes. Pending import/restart is recoverable, no cross-project token.
B. Main-project manifest candidate uses native schema exactly; accept all ORIGINAL allowed native fields, including caption_override in eligible B1–B3, B4 opening/voice.user_override and B3 television. Original CLI is final validator, never weaken its style/voice/caption policies. No executable/code input, unsafe paths or missing required asset metadata.
C. Import media -> **assign to a selected actual shot/layer ID or sound-track role** and persist mapping and hash. Preserve draft manifest/ledger while assets arrive. WAITING_FOR_MEDIA must give a list of missing assets and permit safe resolve -> revalidate -> confirm without stale-data deadlock. Do not conflate "file imported" with "shot mapped".
D. Show real project's approved script, shots/captions/real voice duration/media assignments. Unsupported Editor inspector mutations must be READ-ONLY or labeled DEMO; no pretending edit was saved. A supported edit must map to actual native field, diff/confirm and exact scoped invalidation.
E. Explicit before/after diff, project-local candidate, original CLI validate (scoped preview vs full separately), atomic promotion with backup. A failed validation or missing asset leaves last valid manifest/voice/approval safe; restart recovers pending state. Script/audio changes invalidate appropriate prompts/captions/approval, image changes invalidate affected shots and fingerprint only as allowed by original native gate.
PASS: stale task after changing WAV or a word is rejected; asset import+mapping works; native B-style candidate passes original CLI; invalid/missing media never destroys previous state; scoped repair preserves unrelated accepted work.

### FLOW-FIX-05 — Original native preview -> human approval -> film through Studio
Own files: nativeJobs.ts, main/index.ts only as needed, NativePreviewPanel, ApprovalPanel, RenderWorkspace, projection/Editor tracks, tests.

A. Invoke original CLI doctor/probe/init/captions/validate/preview/approve/render; same renderer, quality, cache and fingerprint logic. Do not fork rendering or authoring core.
B. Preview sample from project manifest + accepted WAV, native captions and actual image/SFX; original CLI validates and creates real MP4/report/SRT/VTT/contact sheet. Check CURRENT native source fingerprint, output bytes SHA and decode/report before reusable PASS. Explicit user confirmation before --replace.
C. Human must actually be able to play encoded sample and explicitly attest picture+sound with note; use original CLI approve, reread actual native approval report and reject stale audio/media/caption/project fingerprint. No auto-approval or fake status. Existing project can render full film only when original full-film prerequisites are valid.
D. After render, verify actual film.mp4 + SRT/VTT + report/cache and show honest artifact status, actual duration/provenance; never show all green merely from process exit=0.
E. Fix ONLY job-flow blockers: mutually exclusive operations for a project; no concurrent mutation that corrupts manifest/audio/render; bounded command timeout, cancellation/error recovery and non-destructive retries. Leave generic Electron process-tree infrastructure deferred; minimal safe Windows child handling needed for current native job still applies.
F. Real-project timeline must use the actual shot start/end, caption cues, narration duration and available SFX/ambience/dialogue data; virtual/demo placeholders clearly separate. No invented six-track contents.
PASS: Studio-backed offline project from imported WAV/words/manifest produces real current preview -> explicit fixture approval -> final MP4 and captions with exact checked artifacts and hash; modifying sampled media/audio/cue makes old approval fail; late shots cannot silently count as preview-approved.

### FLOW-FIX-06 — Focused production-flow tests & Windows evidence (NOT Electron test expansion)
Own files: studio/tests/unit/* and/or new focused studio/tests/integration/*, studio/scripts/windows-r2-main-flow-acceptance.ps1; minimal README.

Test with ORIGINAL native CLI and the actual Studio BACKEND functions/IPC handler orchestration where possible. Do not replace this with a disconnected direct CLI sine-wave fixture. Tests should be deterministic offline, using a fixture-approved WAV or producer-compatible fixed WAV, approved script, real imported words and real media. Owner-consent actions in tests are **engineering-fixture approvals only**, never a real user's approval.

**Required C0 Main Flow gates (all applicable ones must PASS):**
- C0-MF01: Core tracked diff=0; no native Core changes; existing CLI works.
- C0-MF02: Nano producer-owned golden receipt + correct POST profile integrity + header + 24k WAV and negative failure cases; prior WAV preserved.
- C0-MF03: short speech route + long-form owned assembler 2+ sections and --resume tested with correct producer response simulation; imported WAV fallback.
- C0-MF04: ElevenLabs exact authorized multipart mock and WAV+WORDS import -> native captions; tampered/stale/missing word rejection; no real paid API calls.
- C0-MF05: script+creative sidecar -> prompt pack containing actual words/cues/voice and real asset metadata -> stage/diff/confirm native import; strict task identity and post-freeze source recomputation.
- C0-MF06: missing-media resolution, actual shot/layer binding, genuine B-style manifest compatibility, candidate validation and last-good-state rollback.
- C0-MF07: STUDIO SERVICE integrated OFFLINE flow with approved script, imported WAV+WORDS+images/SFX -> native preview.mp4 -> explicit engineering-fixture approval -> film.mp4/SRT/VTT/report/cache. At least two distinct shots and nontrivial cue/asset timeline. Original CLI used through Studio backend, not directly in a disconnected fixture.
- C0-MF08: stale sample/approval after audio, caption or relevant media mutation is correctly blocked; replace is explicitly authorized.
- C0-MF09: existing typecheck, lint, unit/integration, build and relevant React UI flow tests PASS; no requirement to run or fix Electron GUI smoke/visual parity in THIS round.
- C0-MF10: Windows Main-Flow evidence ZIP with main/producer SHAs, per-gate results, production service logs, MP4/video hashes, redacted fixtures, reports, negative test outputs and truthful NOT_RUN statuses.
- C0-MF11: Settings Contract remains ABSENT, one Nano URL default :3901, no LLM API, G-Labs, Remotion, B5 or new native renderer.

**Core suite from previous ZIP:** 44/200 failures are tracked as KNOWN_BASELINE_UNRESOLVED for follow-up, NOT invented PASS, provided Core diff=0 and current original native CLI offline flow PASS. Do not modify original test files, B4 SHA locks or B5 baseline. No expensive main/PR archive-pair investigation now unless a NEW actual native CLI regression blocks MF07.

**Electron / UI later:** No playwright.electron.config.ts fixes, no Electron dev-prod smoke, no screenshot parity, no GUI infrastructure refactor. Existing UI must expose the repaired flow controls; lightweight functional render/handler tests are enough for this round. R1 historic smoke remains DEFERRED_ELECTRON_PHASE. If minimal IPC prevents actual flow, fix that ONE bridge, not an Electron-wide framework.

**C1 Owner-only checks (separate, honest):**
- Nano GTX1650 real short generation + owner voice profile/consent
- Nano long-form audio with the owner's actual voice and interruption/resume
- ElevenLabs live forced alignment only with explicit owner authorization and fee/secret
- Human visual/sound review of actual production output; GUI/desktop hardening later
If not run, mark NOT_RUN and provide exact Windows commands plus UI steps to execute owner acceptance. Never make their absence a reason to divert the current round into Electron smoke.

### Windows acceptance ZIP reporting
Create studio/scripts/windows-r2-main-flow-acceptance.ps1 which produces studio/r2-mainflow-YYYYMMDD-HHMMSS.zip, results.json, logs and real native output paths. Do not replace/overwrite user's existing test artifacts. Run despite individual test failures far enough to collect a useful report. No private reference voice, secrets, auth headers or arbitrary user files in ZIP. Report each C0-MF status PASS/FAIL/NOT_RUN and reason. A disconnected direct CLI fixture must be described as DIRECT_CORE_FIXTURE only, never SERVICE_MAIN_FLOW_PASS.

## 3. IMPLEMENTATION ORDER (ONE ROUND, NO FURTHER PLANS)
1. Fetch current Draft PR #2 HEAD and read all this V3 + existing original R2 plan. Verify only documentation has advanced since code audit; if code has changed, re-audit the affected area before editing.
2. FLOW-FIX-01 producer golden/API and safe short WAV.
3. FLOW-FIX-02 audio/words/ElevenLabs + original captions; integrate owned long-form without reimplementing producer.
4. FLOW-FIX-03 frozen full manual script/creative and second actual-word-timed prompt.
5. FLOW-FIX-04 identity, native schema/asset binding, safe WAITING_FOR_MEDIA + diff/promotion.
6. FLOW-FIX-05 full native sample/approval/render through Studio.
7. FLOW-FIX-06 focused tests, one actual Studio SERVICE main-flow end-to-end fixture and ZIP.
8. Fix failed main-flow tests in the SAME round, commit and push the existing branch, leave PR #2 Draft, DO NOT MERGE.

## 4. FINAL VERDICT RULE AND DELIVERY
- MAIN_FLOW_OFFLINE_PASS: all C0-MF01..MF11 PASS with real Studio-service offline preview+final artifacts, ZERO new Core diff, no P0/P1 on actual workflow.
- MAIN_FLOW_CODE_DONE_LIVE_NOT_RUN: all offline gates pass but owner GPU/ElevenLabs live are NOT_RUN; no claim "live production PASS".
- MAIN_FLOW_PARTIAL: one or more actual workflow features remain missing, blocked, untested or failing.
- MAIN_FLOW_FAIL: reproducible data loss/safety/regression or major P0 blocker persists.
- ELECTRON_DEFERRED: always explicitly reported as separate later phase, never written as PASS.

**Required Codex response:**
R2 PR #2 — MAIN FLOW REPAIR REPORT
BASE_MAIN_SHA:
START_HEAD_SHA:
FINAL_HEAD_SHA:
PRODUCER_SHA:
BRANCH / DRAFT_PR:
FLOW-FIX-01:
FLOW-FIX-02:
FLOW-FIX-03:
FLOW-FIX-04:
FLOW-FIX-05:
FLOW-FIX-06:
C0-MF01..C0-MF11:
STUDIO_SERVICE_MAIN_FLOW_E2E:
PREVIEW_MP4_SHA / FILM_MP4_SHA / CAPTION_REPORTS:
NANO_GPU_LIVE:
ELEVENLABS_LIVE:
CORE_CHANGED_FILES: 0 or FAIL
KNOWN_CORE_BASELINE_FAILS: 44 / current value + source
ELECTRON_GUI_TESTS: DEFERRED_BY_OWNER
VOICE_SETTINGS_CONTRACT: ABSENT
ZIP:
REMAINING_MAIN_FLOW_BLOCKERS:
VERDICT: MAIN_FLOW_OFFLINE_PASS | MAIN_FLOW_CODE_DONE_LIVE_NOT_RUN | MAIN_FLOW_PARTIAL | MAIN_FLOW_FAIL

**Do not spend the round on Electron. The deliverable is a functioning video production pipeline with hard evidence.**
