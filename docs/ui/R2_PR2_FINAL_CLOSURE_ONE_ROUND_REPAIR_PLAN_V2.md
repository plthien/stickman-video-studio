# R2 / PR #2 — FINAL CLOSURE REPAIR PLAN V2 (ONE IMPLEMENTATION ROUND)

**Status:** Owner-directed implementation plan, not evidence of implemented code.
**Repository:** plthien/stickman-video-studio
**Existing Draft PR:** #2, branch feat/r2-external-native-workflow -> main; keep Draft, DO NOT MERGE.
**Audited code HEAD:** 0c9ddf956c61d9761b2d33329f9423feba726fd1.
**Audited Windows ZIP:** r2-local-results-20261114-192028.zip; results.json overall FAIL, 21/21 unit/integration PASS, 21/21 browser PASS, offline native CLI preview+film PASS, native-core 156/200 PASS (44 FAIL), Electron GUI / Nano GPU / ElevenLabs live NOT_RUN.
**Original R2 scope:** docs/ui/R2_EXTERNAL_CHATGPT_NATIVE_MODE_B_ONE_ROUND_IMPLEMENTATION_PLAN.md.
**Previous repair inventory:** docs/ui/R2_PR2_ONE_ROUND_FULL_REPAIR_PLAN.md.
**Voice producer:** https://github.com/plthien/VoiceStudio-GGUF-Lite/tree/feat/chatterbox-turbo-provider, audited producer HEAD 7792fb47c292d8f0da8a4666d174be4689ac34b3.
**Producer sources of truth:** docs/integrations/youtube-studio-nano-api-v1.md; lite/chatterbox_contract.py; lite/chatterbox_assembly.py; tests/fixtures/nano_api_v1/golden_receipt.json.
**ElevenLabs API:** https://elevenlabs.io/docs/api-reference/forced-alignment/create.
**Target:** Complete all code and OFFLINE/Windows integration acceptance in this one Codex round; only truly owner-dependent hardware, voice consent, paid/cloud live verification may remain NOT_RUN with an exact owner-run acceptance script. Do not claim production-live PASS without live proof.

## 0. Hard owner invariants (cannot be relaxed to make tests green)

- ZERO changes under skills/directing-stickman-videos/**, including scripts/tests/references/assets/fingerprints/voice/style. Mode B B1–B4 native CLI is the sole engine; B5 remains a separate excluded route.
- ZERO changes to VoiceStudio producer branch or engine. Use its existing direct API and long-form assembler. Do not write a second TTS backend, segmentation or assembly engine in Studio.
- Only manual External ChatGPT Web authoring: copy/export prompt, human runs ChatGPT Web, paste/import result. No LLM API, web automation, G-Labs, Remotion, speculative backend or invented speech/image assets.
- Nano is localhost HTTP, default 127.0.0.1:3901; ElevenLabs is opt-in cloud FORCED ALIGNMENT only. No OS/ElevenLabs TTS fallback, no hidden charges/retries.
- VoiceStudio Settings must have NO "Contract" label, field, value, version selector or negotiation UI. Current deletion is correct; keep it. Adapter may validate response formats and capabilities as normal API-client responsibilities.
- Preserve V3 nine-page UI and real native preview/approve/render, port 5174. Do not replace the UI or label fixture/virtual previews as production.
- Existing accepted narration, assets, caption timings, script, and native approval MUST NOT be invalidated except when their proven dependencies change. Any mutation uses a scoped revision + diff + explicit confirm.
- Tests MUST independently validate producer-owned fixture and real native outputs, not restate consumer assumptions in mocks. No blind PASS and no weakening acceptance assertions.

## 1. Definition of CLOSED versus VERIFIED-LIVE (mandatory vocabulary)

**CODE/OFFLINE CLOSED:** all P0/P1 below fixed in production code; every C0 offline gate passes in actual Windows main/preload/Electron and original CLI; no Core regression; UI flows to real preview.mp4 and film.mp4 using an approved local WAV and imported real word timestamps, without any billable call. Evidence ZIP uploaded/provided with exact Git HEAD, logs, outputs and hashes.

**LIVE/OWNER ACCEPTED:** in addition, owner deliberately generates a real short+long Chatterbox Nano job on GTX 1650 and performs a real authorized ElevenLabs alignment, verifies actual words/captions/audio subjectively, and re-runs native sample/final via app. Requires the user's running service, owned voice profile, account/secret/permission and any associated cost. No Codex-only claim can substitute for these.

If C0 fails: verdict FAIL. If C0 all passes but owner-dependent live checks cannot run: verdict CODE_CLOSED_LIVE_NOT_RUN, NOT production-live PASS. If live fails: repair adapter in the SAME round if reproducible and accessible, otherwise report a precise external blocker, not "finished". No unconditional guarantee can honestly cover hardware, billing and user approval outside the execution environment.

## 2. Exact repair inventory and fix-to-test mapping

### F01 — Nano direct API accuracy (P0-01; old R2-17)

Implement direct Nano client strictly against the source-owned producer behavior at the pinned HEAD, WITHOUT surfacing a user-facing Contract field.

Required request/response corrections:
1. GET /health checks liveness only; GET /lite/readiness reads generation_ready AND runtime_ready; GET /profiles gives real confirmed profiles; selected voice must have consent confirmed, identity/version and current reference SHA.
2. POST /profiles/{id}/integrity/verify (NOT GET). Require body.verified === true, matching voice_id / voice_version / reference_sha256 and exact binding, not "ok". Compare detail profile, discovery and receipt versions/binding.
3. POST /v1/audio/speech exactly as producer supports. Verify content-type WAV, full HTTP response envelope, X-TTS-Execution-Receipt, X-TTS-Execution-Proof and canonical bounded receipt. Requested/effective speeds are SIX-DECIMAL STRINGS (e.g., 1.000000) in receipt, numeric in request; speed_mode is postprocess_atempo; reference_binding is 64 lowercase hex; preserve seed and exact requested input hash.
4. Verify original source/model/revision/weights-manifest properties where producer supplies them; frame counts, chunks, pause counts, native segmentation and the actual 24k mono PCM16 WAV SHA-256. Required header is X-Lite-Speech-Segments (NOT X-Lite-Speech-Spans). Verify the header fields defined by lite/chatterbox_contract.py, not a hand-invented subset.
5. Never publish the generated WAV before verifying EVERY required field and actual bytes. Preserve previous accepted WAV/state on any failure. Check profile/reference identity again before commit if it could have changed during generation.
6. 403/404/409/422 and proven 429 have definite error semantics; connection loss/499/504/post-admission uncertainty are UNKNOWN and never automatically replayed. Owned cancellable request ID/token may be used only through producer's documented cancel API, without secret disclosure.
7. Input MUST be the latest exact approved narration text and approved profile, derived in MAIN from project state, not arbitrary text supplied by renderer IPC. If script contains pause tokens, preserve valid Nano syntax; don't allow the renderer to silently alter it. A different WAV/script/voice/profile invalidates downstream alignment/prompt/preview/approval.

Mandatory independent tests: one producer-owned frozen golden_receipt.json loaded/copied with provenance and SHA pin; golden receipt decode + exact producer response headers; POST integrity (GET must be rejected); six-decimal numeric-vs-string regression; bad receipt/context/voice/headers/speed/binding/frames/truncated WAV; successful safe publication and old-WAV preservation; nonadmission vs uncertainty. Test mock server must use real producer schema/fixture, not fixture generated by the consumer under test. Include one serial end-to-end mock HTTP route for discovery -> integrity -> speech -> persisted WAV.

### F02 — Real Nano long-form and resume (P1-01; old R2-19)

Implement in Studio a narrowly configured subprocess adapter (outside native Core) invoking THE EXISTING producer module:
  python -m lite.chatterbox_assembly --manifest ABS_JOB.json --output ABS_JOB_DIR [--resume] [--retry-uncertain]
with cwd/environment safely pointing to the owner-selected VoiceStudio checkout using a validated local path from VOICE_STUDIO_ROOT, never executing downloaded/ChatGPT-provided code.

- Use producer's own section manifest format (voice, ordered sections with stable IDs, input, seed/speed), output/job directory, resume-manifest.json, proof checks and FINAL published final.wav. Avoid second chunker/concatenator/copy of producer logic.
- Build sections at meaningful approved script boundaries (within producer limits, max 200, final 900s); preserve immutable source string, approved script hash, voice version and ordered input/section hashes. Producer native segmentation currently soft target 320/hard 600 and HTTP max 4096; do NOT hardcode old 520 target.
- Show real button Generate / Resume / Review uncertain / Explicit retry where supported. Save durable job identity/path/proofs and user-controlled retry decisions. Correctly show NOT_CONFIGURED with exact setup if VoiceStudio checkout/worker missing. Don't claim long-form success merely because voice:longformStatus returns CONFIGURED.
- After completed job: independently inspect producer final.wav + summary/manifest, verify full coverage/real frame counts and voice binding, import/copy accepted result atomically into project, invalidate alignment/native tasks if changed. Allow import of a pre-existing WAV without a live producer, with precise provenance: IMPORTED_WAV, not NANO_GENERATED.
- Check language mismatch explicitly: producer long-form source currently sends language=en. For a non-English project, block with a truthful unsupported/unverified language status unless actual source and accepted live proof support it; do not silently generate English-only voice for another language.
- Test short and long job with source-owned assembler using a deterministic local mock producer and mocked responses; test 2+ sections, resumed skip with verified proofs, failure in the middle, uncertain state and explicit retry, missing checkout, previous accepted WAV preserved.

### F03 — External ChatGPT task content, creative authority, timestamps (P0-02; P1-03; old R2-18)

- Keep exactly TWO MANUAL HANDOFF MOMENTS in the original agent workflow: script+creative-direction first; after real voice/word timing, visual+shot+sound authoring and original native v1 manifest. Do not invent separate production engine or force three new agent tasks.
- Script response must carry approved script sections PLUS original-agent creative direction/characters/style decisions/source references/voice and sound intentions as project-local sidecar authoring data; never drop them because the current mode-b-script-v1 only understands sections[]. Original Mode B user-facing creative approvals remain explicit.
- Native handoff must include SELF-CONTAINED actual words array [{word,start,end}], actual semantic caption cues, final WAV duration/sha, script hash, chosen B-style source text, relevant shot/sound/media ledger, image asset paths+hashes/rights status, and missing assets. ChatGPT Web cannot see local file paths; file references are not substitutes for their text/timestamps. No fabricated words/clip lengths.
- Preserve exact word/cue time units, lead/tail, source hashes and timing provenance. B4 opening/user_override/story-led sound rights must be carried when selected. Prompt snapshots are immutable, deterministic, reproducible from approved inputs and versioned; if too large, export a complete self-contained prompt PACK with .md plus attached .json, never silently truncate or omit words. State size limits/errors honestly.
- Native return can include a project-local shot ledger/sound script/asset-needs authoring SIDE-CAR as well as manifest. Strip ONLY Studio envelope before writing original project.json; no sidecar metadata added to native schema.
- Validation must compare shot boundaries/caption timings to real narration and check actual asset inventory before native CLI validation. Allow legitimate partial ~20s sample using native scoped validate, but distinguish preview-ready from full-film-ready.
- Tests must inspect exported frozen bytes and parse them: exact original source bundle, actual 3+ word timestamps, multi-cue captions, voice hash and asset hashes, B4-specific source; feed into a strict, bound native candidate and verify full native validator behavior.

### F04 — Frozen tasks, stale source, robust import and approval (P0-03; P1-05)

- Define a SINGLE source-fingerprint function for each task from current project brief/style/ratio/approved-script revision, voice bytes/hash/voice profile, word data/caption content/hash, source reference files, media inventory hashes and any other applicable upstream input. Freeze records immutable fingerprint and task ID, SHA, revision and prompt bytes.
- Recompute CURRENT fingerprint at BOTH stageImport AND confirmImport. If ANY dependency changes, mark task STALE, invalidate pending confirmation and reject returned task output BEFORE any file/state mutation. A matching stale outer envelope is not enough. Atomic state writes alone are not a sufficient stale check.
- All changes to script, voice, alignment, source, selected style, relevant assets and authoring revisions must invalidate only dependent stages, samples and approvals. Do not invalidate valid unrelated sample assets. Test timeline and sidecars across restart, crashes, interrupted candidate promotion, stale project identities and repeated imports.
- UI exposes explicit Rebuild Task / Scoped Repair on approved script section or shot/layer/field, using a new revision/ID and showing before/after diff and scope. No cloned "FROZEN" badge when task no longer frozen or inputs changed. No silent accepted-script edit.
- Strict JSON parser and envelopes: bounded bytes/depth/count, escaped-key duplicates and property pollution, no code/URL/absolute paths, correct types and unknown fields, project/style/task/revision/hash binding and replay rejection. Allow original supported native fields based on actual Core (not consumer's speculative incomplete list), explicitly including caption_override where allowed, B3 television and B4 native authoring/voice override. Always defer final authority to original CLI.
- Candidate import Stage -> Validate/WAITING_FOR_MEDIA -> Diff -> Explicit Confirm -> atomic backup+promotion+resume/reconciliation. Validator failure keeps previous native project and approvals unchanged. Asset import after WAITING_FOR_MEDIA can proceed by revalidating the SAME task/fingerprint per an explicit, correct asset-ledger revision; do not deadlock or silently accept a stale task.
- Tests: freeze A -> change WAV/words/source/media -> old JSON rejected at stage and confirm; crash/restart pending; corrupted candidate; valid B1/B2/B3/B4 native field acceptance where Core permits; unknown/unsafe field rejection; idempotent replay; scoped repair preserves accepted shot and cached media.

### F05 — ElevenLabs alignment, imported WAV and caption review (P1-11 + remaining FIX-04)

- Use only POST https://api.elevenlabs.io/v1/forced-alignment, multipart file=the EXACT final accepted WAV and text=exact spoken transcript stripped of valid [pause ...] control markers. Keep ELEVENLABS_API_KEY only in main-side environment/secure owner config. Confirm explicit audio upload + possible charges; never auto-request. Official response has words, characters, and overall loss; inspect the full current response, not only whether words[] is nonempty.
- Validate finite monotone word times, duration bound, returned token sequence/coverage with Unicode/punctuation normalization, missing phrase, duplicate, whitespace and zero-coverage errors. Preserve words/characters/loss for review, not fabricate timestamps or silently claim that an external aligner guarantees audio was actually spoken correctly.
- Store WAV byte hash + approved transcript hash + word/cue hash; changes invalidate binding. Native captions command groups REAL words; provide user review/edit of semantic cue boundaries through scoped sidecar revisions, with original one-line B1–B4 visual gate, and revalidate native output on changes.
- Implement secure local WAV import and local aligned words JSON import (owner-supplied artifacts) as explicit alternatives; validate format/hash, call original captions, label origins IMPORTED/ELVENLABS, never misleading "NANO GENERATED"/"ELEVENLABS VERIFIED". No secret in renderer/ZIP.
- NOTE: ElevenLabs current published multilingual language support does not explicitly list Vietnamese. Do not assert Vietnamese forced-alignment support by default; show language verification/owner-test status, allow verified manual word import when service coverage is not confirmed. No silent STT/Whisper or TTS fallback.
- Tests: live endpoint contract reproduced independently, multipart exact bytes/text, authorized vs unauthorized, stale WAV/script, gaps and bad timings, response loss+characters, punctuation and valid pause tags, imported WAV+words, no secret in logs/renderer. Live API remains opt-in only.

### F06 — Native project/preview/approval/render and real editor (P1-04, P1-06..P1-10, old R2-21..25)

- Do not touch original CLI: doctor/probe/init/captions/validate/preview/approve/render exactly as supported. Native project.json v1 remains unchanged.
- Main process creates/opens projects via user-confirmed OS dialogs or an explicitly validated main-side parent selection. Renderer works with opaque opened project IDs, not arbitrary raw root paths. Resolve realpaths for EVERY existing ancestor, reject UNC and junction/symlink escape, uploaded absolute paths/remote source references and code. Safe media URLs can only serve approved paths within an opened project. Handle malicious relative paths and URL encoding.
- Native manifest voice must refer to the actual verified/imported narration; validate accepted script and word/cue timeline, missing images/sound rights, caption/group, B4 casting user override (do not pretend Nano is Brian), style-specific allowed top-level fields, full timeline gap/overlap. Original CLI is final validator. Never auto-rewrite original style conditions.
- Connect Storyboard imported PNG/JPEG/SFX to explicit native shot/layer/track mapping using real IDs and content hashes; a mere latest-imported filename display is NOT adequate. No synthetic mutable inspector values as if saved. Supported inspector edits: original layer/key field mapping -> validated revision/diff/confirm, invalidates only affected outputs. All unsupported fields display READ-ONLY / DEMO.
- Editor in real project mode must use original project shots (including start/end), actual captions cues, WAV duration, ambience, SFX, dialogue and layer timing. Six-track UI must not display invented narration tracks or empty SFX when assets exist. Timeline/seek/playback show true native scoped MP4 preview when available; R1 CSS art is DEMO ONLY with explicit label. Reset Demo may not overwrite project work.
- All native jobs (including doctor/probe where relevant) have consistent per-project operation identity, no overwritten map entries, safe cancellation and bounded Windows process-tree cleanup (including FFmpeg descendants), timeouts/close/error races, restart recovery and truthful logging. Cancel cannot be represented as successful completion.
- Native preview uses original scoped CLI and requires actual encoded output/preview.mp4 plus original report/SRT/VTT/contact sheet, full decode, SHA and CURRENT source fingerprint. Existing preview must never be silently --replace; reuse only if project still matches original fingerprint. Reopen/restart recomputes current approval from native facts, not stale sidecar.
- Human must explicitly review real MP4 picture AND sound and note approval before original CLI approve. Do not infer actual human playback, only record attestation. A changed sample source invalidates approval. Full render requires full native validate/asset coverage, original current preview approval and verified final MP4/SRT/VTT/report/cache. Render page status reflects actual stage evidence, not exit code alone.
- Tests: hostile filesystem and IPC project IDs, symlink/junction and URL traversal, concurrent jobs/cancel/restart, stale native preview with unchanged bytes but mutated project, explicit --replace confirmation, valid B4 source identities, 2+ real shot caption/SFX tracks, actual native preview/report hashes and final cache reuse.

### F07 — Fix the test architecture: original Core baseline comparison, real Electron, no fixture-only PASS (old R2-16)

Current owner ZIP at audited HEAD reports 44/200 native-core failures in archived copy, largely B4 references/fingerprints, B5 golden baseline and provider routing; Main-vs-PR source Core files were verified identical. This is a test problem until a baseline comparison identifies the cause, NOT license to change Core.

1. Before any rewrite, produce TWO identical-environment clean tests: git archive BASE_MAIN -> isolated temp directory and git archive PR_HEAD -> separate isolated temp directory. Install each with own lockfile under their original native Skill path. Compare SHA-256 of EVERY tracked Core blob and of post-extraction files, including references/autopilot.md, assets/b4/style-lock.txt, and assets/b5/local-baselines/jensen-v13/scene/README.md. Also compare newline/encoding, Git attributes/checkout transformations, relative locations and dependency resolution.
2. Run the ORIGINAL npm test command for both with same Node, npm, native dependency versions, FFMPEG/FFPROBE and independent folders. Capture each test name, error, pass/fail and file hash; categorize BASELINE_FAIL or NEW_R2_REGRESSION. Do NOT mutate Core, tests, golden SHA or pin simply to make green. If baseline itself fails, do not mark NATIVE_CORE_PASS; report BASELINE_FAIL with proof, and require ZERO extra failures on PR branch.
3. Keep genuine offline CLI video fixture as regression proof but DO NOT treat it as Electron app E2E. Add at least one complete app REAL main/preload/Electron test, using offline imported WAV + real aligned words + valid ChatGPT transport JSON + image/SFX, completing project create/open -> script approval -> media import -> captions -> prompt freeze -> native import -> validate -> preview.mp4 -> explicit approval -> film.mp4 through the app IPC and genuine CLI (no page.addInitScript fake bridge). Use a short 6–20 second fixture, controlled local assets and test-only authorization note. Assert output hashes/report/SRT/VTT, multiple shot paths, caching and state after restart. No paid call.
4. Test the same flow for one B1 and one non-B1 B-style where supported, including B4 override constraints in negative/positive native tests. Test sample-only partial media and full-render readiness separately.
5. Keep unit mocks as CONTRACT_TEST, not true GPU/live. New source-own Nano golden fixture test MUST fail with the current broken client before fix and PASS after; no counterfeit mocked schema. Add zero-retry tests for 499/504/transport and resume.
6. Run Playwright real Electron dev and production smoke on an interactive Windows owner desktop via -RunElectron. If a historical R1 issue remains, reproduce on base main and attach both logs; classify KNOWN_DEFERRED_R1 ONLY if identical. No new R2 IPC/media/security failure may be deferred.
7. Existing V3 screenshots at 1280x720 and 1656x790 are PENDING_OWNER_VISUAL_REVIEW. Keep approved composition and export side-by-side screenshots; do not call pixel-perfect parity PASS automatically. Fix any actual new R2 layout regressions or state truthfulness that block usage.
8. Update studio/scripts/windows-r2-acceptance.ps1 and README setup. Make the acceptance script report per-gate PASS/FAIL/NOT_RUN/BASELINE_FAIL, command, duration, BASE/HEAD sha, exact reason, evidence SHA256, output metadata and working tree diff. Handle failure gracefully to still produce ZIP and summary even when one gate fails. Never delete user files. No automatically paid/cloud live jobs.
9. Native offline test and real Electron app integration are BOTH mandatory C0. Build/lint/mocks/browser passing alone is insufficient.

## 3. Dependency order, mandatory gates, and how to close in ONE round

Execute all work in this order WITHOUT producing another planning document:
A. Capture BASE_MAIN, START_HEAD, producer branch SHA and current Windows evidence; confirm NO Core diff and record source checksum baseline.
B. F01 Nano API accuracy + golden tests. Do not proceed on fake producer schema.
C. F02 existing assembler integration, manual existing-WAV route, resumable job evidence. Test section-level verification before publicizing audio.
D. F05 ElevenLabs / imported word and caption review + secure authorization.
E. F03 complete agent handoff preserving creative data and inline real words/cues. Run external prompt tests against actual approved audio and alignment.
F. F04 stale task, imports, original native schema and scoped repairs, including WAITING_FOR_MEDIA flow.
G. F06 secure Electron, storyboard/layer mapping, true native preview/approval/render and recovery.
H. F07 baseline tests, real Electron E2E, Windows evidence and visual review artifacts.
I. Repair all failed C0s within THIS SAME implementation round, commit/push to existing Draft PR #2, do not merge.

Do not stop at partial FIX completion, placeholders, screenshots, typecheck success, fake badges, or integration unit tests only.

### C0 — required offline closure matrix (ALL must PASS or proven BASELINE_FAIL only where allowed)

C0-00 Core tracked diff = 0, no new executable paths or modification to original native schema.
C0-01 Producer golden fixture and actual API request/response test all fields PASS; no accepted WAV clobber.
C0-02 Short voice route and producer-owned long-form route (2+ sections, one resumed) PASS under mock HTTP with exact real producer response proof.
C0-03 Local existing WAV + verified word import and ElevenLabs fake HTTP exact multipart/privacy tests PASS.
C0-04 Full self-contained ChatGPT prompt contains actual word/cue data, creative sidecars and style sources; no missing local references PASS.
C0-05 Stale/replay/cross-project/changed-source imports rejected, scoped repair and atomic promotion PASS.
C0-06 Manifest passed through ORIGINAL CLI, B1/B2/B3/B4 native schema compatibility and B4 voice/override validation PASS where applicable.
C0-07 Real-project Storyboard/Editor and asset-to-layer mapping/timeline truthfulness PASS; unsupported controls never claim changes saved.
C0-08 Secure IPC, file/junction restrictions, job collision/kill-tree/restart and stale approvals PASS.
C0-09 Original native CLI actual offline preview + approval + final MP4/SRT/VTT/report + cache PASS.
C0-10 REAL Electron main/preload renderer integration creates project and drives offline input through native MP4 without browser bridge mock; reopens and recovers PASS.
C0-11 Typecheck/lint/unit/integration/browser/build/required Electron smoke PASS; verified historical R1 exception has base-main evidence if applicable.
C0-12 Core baseline-vs-PR suite: zero NEW_R2_REGRESSION. Any shared 44 (or other) BASELINE_FAIL must be reported with exact SHA and tests, NOT as a native suite PASS.
C0-13 Windows ZIP evidence correctly identifies real HEAD, includes all logs, output hashes, negative tests and explicit NOT_RUNs; no secrets/private voice.
C0-14 Voice Settings has NO Contract field; ONE shared Nano endpoint default 3901 survives restart, no UI drift and no generic version layer.

### C1 — owner-dependent, not fabricated

C1-01 User's real VoiceStudio Nano is running on localhost 3901; confirmed owned voice; owner-authorized short actual speech WAV with valid producer receipt.
C1-02 Real 2+ sections long-form on owner GTX1650, resume if interrupted; verified producer summary, listen to full audio.
C1-03 User authorizes ElevenLabs charge/upload and supplies secret via main environment; real forced alignment returns words and semantic captions reviewed.
C1-04 User personally watches real current encoded preview and approves, then real project full render; inspect visuals and sound.
C1-05 Owner visually approves V3 parity if materially different.

If owner-dependent access is unavailable, provide ONE exact Windows owner-acceptance procedure with commands/UI steps and expected assertions; mark C1 NOT_RUN and output CODE_CLOSED_LIVE_NOT_RUN (not full PASS). User never has to authorize paid calls implicitly.

## 4. Evidence & final Codex report (mandatory)

Save ZIP under studio/r2-final-closure-results-YYYYMMDD-HHMMSS.zip with:
- results.json with actual test status + per-gate PASS/FAIL/NOT_RUN/BASELINE_FAIL, start/final/base SHAs and producer pin
- Git Core blob/diff reports; two clean main/PR native-core test logs plus per-test comparison
- Producer golden-fixture validation and API negative/positive responses redacted
- External frozen prompt snapshot, minimal sanitized accepted script and real words/caption data, stale/replay negative logs
- Local WAV/words test artifact, original native project candidate/approved manifest, SRT/VTT and encoded preview/film with hash+decode reports
- Real-Electron main/preload IPC/GUI logs; browser snapshots and visual parity report; no secrets/owned private voice
- Job rollback/restart and --replace/approval invalidation evidence
- live-service status and exact owner handoff if C1 not run

Final report MUST use this exact structure:

R2 PR #2 FINAL CLOSURE
BASE_MAIN_SHA:
START_HEAD_SHA:
FINAL_HEAD_SHA:
VOICE_PRODUCER_SHA:
PR / BRANCH / DRAFT:
F01 Nano producer compatibility:
F02 Owner assembler long-form:
F03 Manual ChatGPT creative/timing:
F04 Frozen task/import/native manifest:
F05 ElevenLabs + WAV/words/captions:
F06 Original native/UI/IPC/job lifecycle:
F07 Independent core/e2e/Windows acceptance:
VOICE_SETTINGS_CONTRACT: ABSENT
NANO_BASE_URL_DEFAULT: http://127.0.0.1:3901
CORE_CHANGED_FILES: 0
C0-00..C0-14:
CORE_BASELINE_FAILURES:
CORE_NEW_R2_REGRESSIONS:
ELECTRON_REAL_E2E:
PREVIEW / FILM SHA + REPORT:
C1-01..C1-05:
WINDOWS_EVIDENCE_ZIP:
P0_REMAINING:
P1_REMAINING:
FINAL_VERDICT: FAIL | CODE_CLOSED_LIVE_NOT_RUN | LIVE_OWNER_ACCEPTED

**Merge policy:** No merge until C0 is closed and the owner has reviewed any live/visual outstanding evidence. Preserve Draft PR #2.
