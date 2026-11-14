# R2 PR #2 — SIX-ISSUE MAIN FLOW REPAIR PLAN V4 (UT ONLY)

STATUS: OWNER-AUTHORIZED IMPLEMENTATION SCOPE. This is a plan, not implemented code.
REPO: plthien/stickman-video-studio
BRANCH: feat/r2-external-native-workflow
PR: #2 (DRAFT; do not merge)
AUDITED CODE HEAD: 9f1ae697ef4cafd816f27f38d8228de11d9f967f
BASE MAIN AT AUDIT: 5871fd06657c014baeeb3efe405611e61cd496c9
OWNER SCOPE: Fix exactly the SIX previously audited Main Flow issues in ONE Codex implementation round with focused unit-level behavioral tests. OWNER will run E2E. No Electron GUI/desktop infrastructure, real MP4 encoding, paid calls, GPU live Nano or Core baseline investigation in this round.

This V4 overrides V2/V3 wherever they require Codex to run E2E, Electron smoke, visual-parity, the entire original Core test suite or unrelated platform work. Preserve their ORIGINAL Mode B architecture and safety constraints.

## 0. Non-negotiable guardrails

1. ZERO changes under skills/directing-stickman-videos/**; its B1–B4 native manifest grammar, CLI, references, fonts, sound rules, approval and renderer are immutable. ZERO changes to VoiceStudio-GGUF-Lite. No B5.
2. Preserve TWO manual External ChatGPT Web handoffs, actual WORDS from ElevenLabs/import, Nano producer-owned API/assembler, no LLM API, no Remotion, no G-Labs and no new creative/TTS/render engine.
3. Voice Settings remains WITHOUT a Contract field/version selector; default Nano URL 127.0.0.1:3901. Do not regress producer golden fixture, resume, WAV imports, ElevenLabs key secrecy, source identity or approved audio.
4. Existing accepted script, WAV, WORDS, reviewed captions and original native approval must not be destroyed by a failed import, failed CLI check, invalid media or task replay.
5. UT here means actual production helper/service execution against temporary project files and persisted state, with a narrowly injected original CLI runner stub where needed. Positive AND negative behavior must be asserted. A test that matches source strings or mocks the entire business function does NOT count.
6. UI edits allowed only for the six business-flow operations below. No GUI redesign, Electron architecture hardening, visual parity and no requirement that Codex runs app-level E2E.
7. Unit success is CODE_UNIT_VERIFIED, not production E2E PASS. Never fabricate owner authorization, real video proof or live provider evidence.

## 1. Precisely six audited defects

R2-01 / P0 — WAITING_FOR_MEDIA blocked: externalTasks.ts persists pending missing media and exact frozen sourceFingerprint; index.ts media:import adds files and sets task.status=STALE; the fingerprint also includes media assets; confirmImport trusts old missing array and requires task FROZEN. An intended media fulfillment becomes a forbidden source change.

R2-02 / P0 — Captions unbound: validateManifest checks cue time monotonicity but does not enforce actual approved WORDS and approved grouped caption revision. Authored native captions can change spoken text without an explicit owner-approved change.

R2-03 / P0 — Sample-first blocked: externalTasks.ts confirmImport invokes original CLI validate candidate with NO --seconds; full-film coverage/media required before original 20s sample. Original CLI supports validate PROJECT --seconds N; scoped loadProject filters later shots/media and caps N at 60s.

R2-04 / P1 — Media mappings are cosmetic: StoryboardWorkspace.tsx currently picks first layer or invented ID primary, index.ts appends state.media, but actual content-addressed filename is not substituted into correct original native image/SFX field. UI can claim MAPPED while renderer ignores media.

R2-05 / P1 — Semantic captions lack review/revision: alignment.ts calls original autopilot captions and saves actual cues; VoiceWorkspace offers no user review, grouping/boundary approval, versioning or frozen caption revision for later native authoring.

R2-06 / P1 — Research citations rejected: validateScript blanket rejectUnsafeStrings(payload.authoring) treats valid public URLs in source_references as prohibited executable/remote asset paths.

All other implementation features and already passed source-level corrections are OUT OF SCOPE except necessary regression fixes.

## 2. Work Package A — R2-01 and R2-04: missing-media fulfillment and real native mapping

Own modules: studio/src/main/externalTasks.ts, studio/src/main/index.ts media:import handler, studio/src/main/services.ts only for persisted typed sidecars, studio/src/renderer/features/storyboard/StoryboardWorkspace.tsx and focused tests.

A1. Keep the ORIGINAL frozen ChatGPT response immutable and persist a separate pending fulfillment journal with project_id, frozen task_id/revision, immutable creative source fingerprint, response/candidate hash, exact list of unresolved native references (shot/layer ID or native sound-track location, path and kind), and approved replacements.

A2. Distinguish CREATIVE INPUT CHANGE from ONLY an explicitly approved fulfillment of missing physical assets:
- Frozen creative inputs include approved script and authoring, voice WAV bytes/hash, WORDS/captions, selected original Skill/style source, project brief, and hashes of assets that already existed at freeze.
- Pending fulfillment is a narrowly allowlisted delta: one missing reference -> one approved owner-imported file SHA/path/rights and exact target field.
- Recompute original creative dependencies at stage and confirm. The newly imported and bound file is allowed ONLY if it fulfills an explicitly listed missing reference. Any changes to already inventoried media, script/audio/timings/style/Skill, wrong task or cross-project ID still yield STALE.
- NEVER exempt all asset differences from the fingerprint or silently set task back to FROZEN after a real upstream change.

A3. When staging, return deterministic WAITING_FOR_MEDIA details with path/kind/shot/layer/sound target; preserve them across app restart. Import real PNG/JPEG or local rights-cleared SFX using existing safeImportedFile content-addressed output path. Explicitly select the missing reference and native target; do not invent primary or select layers[0] silently. Validate shot/layer exists, layer.type=image for image mapping, and original legal kind=file audio target for a file SFX. Native media paths remain project-local.

A4. Create a RESOLVED CANDIDATE with ONLY owner-approved replacements inserted at exact field locations; retain original staged ChatGPT manifest and before/after diff. The resulting native manifest path MUST be the actual saved content-addressed relative filename; verify file bytes, kind, hash and rights on revalidation.

A5. After fulfillment, recompute missing paths from CURRENT resolved candidate and CURRENT files, not from stale pending.missing. One exact matching import is idempotent. If a required asset remains missing, WAITING persists. An unrelated asset import cannot unlock it. On explicit confirm, write a backup and atomically promote the approved candidate after original native validation according to WP-C, without destroying last-good project/voice/approval on failure.

A6. Show genuine selected shot/layer/sound target and resolved mapped filename/status in Storyboard. An imported file with no committed mapping is IMPORTED_UNASSIGNED, never MAPPED. Limit modifications to real mapping controls, do not rebuild Editor.

**Mandatory behavioral UT-A01..UT-A07:**
- A01: Missing image -> import actual PNG -> explicit map to selected native image layer -> recheck -> confirm; project.json path equals actual hash-prefixed file, with matching sha/rights mapping.
- A02: Wrong shot, nonimage layer, nonexistent layer, fake primary ID => FAIL and no successful mapping badge/state.
- A03: Two shots both reference same basename; mapping one cannot resolve the other.
- A04: Correct original native kind=file SFX field mapping PASS; invalid/unsafe audio path or wrong track FAIL.
- A05: Only named expected asset fulfillment keeps pending valid; changed approved script/WAV/WORDS/cues or existing asset bytes => STALE at stage AND confirm.
- A06: Restart pending, idempotent re-import, hash mismatch, path traversal, symlink/junction and mismatched project/task are rejected safely.
- A07: Inject validator failure and promotion/write failure; old accepted project.json, voice and native approval remain untouched; no false committed state.

## 3. Work Package B — R2-02 and R2-05: approved, word-grounded caption review

Own modules: studio/src/main/alignment.ts (or a narrow captionReview.ts helper), studio/src/main/externalTasks.ts, minimal index.ts/preload methods and VoiceWorkspace controls, plus focused tests.

B1. Original Core is the single timing/grouping starting point: autopilot.mjs captions WORDS.json OUTPUT.json [--lead N] calls groupWords and produces an ARRAY of native cues {start,end,text}. DO NOT rewrite original groupWords or invent WPM timing.

B2. Add revisioned, local caption review based on (i) approved spoken transcript SHA, (ii) accepted WAV byte SHA, (iii) verified WORDS file bytes/hash and word time list, and (iv) original native grouped captions. Keep raw WORDS and original native grouped output immutable. A draft review sidecar may split/merge cues at WHOLE-WORD boundaries only; cue start/end must derive from first and last real word, adjusted by original lead/trim rules. Do not allow free-text rewriting, extra words, fabricated seconds or auto-approval.

B3. Validate contiguous exact WORDS token coverage, ordering and punctuation-compatible reconstruction, finite nonoverlapping bounds, real WAV/voice lead/tail boundaries, and original B-style one-line caption readability policy. For B4, honor original trim/lead and opening rules. Re-grouping same actual words is allowed ONLY through an explicit owner-approved caption revision; do not reject all changes just because bytes differ from automatic groupWords output.

B4. Expose a lightweight caption review UI with actual grouped cues, word timing, split/merge controls, review note and Approve Revision action. Persist approved cue revision/hash and underlying words/audio/script hashes. Draft/unreviewed cues are REVIEW_REQUIRED. Native frozen prompt must include the approved cue array, not arbitrary latest draft.

B5. In BOTH stageImport and confirmImport native paths, reject manifest.captions that differs from the currently approved cue revision unless owner first explicitly approves that grouping as a new revision and regenerates/rebinds the frozen task. Changed spoken text, omitted/repeated/reordered word, timing invented outside real word bounds, or stale WAV/WORDS/hash must FAIL. Exact approved cues PASS.

B6. Invalidation: Changing narration WAV/approved spoken script/word times invalidates caption approval and dependent native task/preview. A legal regroup invalidates relevant native task/preview but does not regenerate WAV. Importing images does NOT invalidate approved caption revision.

**Mandatory behavioral UT-B01..UT-B06:**
- B01: Real WORDS -> original generated cues -> draft -> valid split/merge at word boundary -> approved revision; same word sequence and exact derived timestamps.
- B02: Missing, duplicated, reordered, rewritten or arbitrarily timed word/cue fails without overwriting approved cue file.
- B03: Unreviewed draft cannot pass native import; ChatGPT-generated new grouping cannot silently overwrite approved cues.
- B04: Valid owner-reviewed regrouping passes after refreshed native task; exact unchanged approved cues passes.
- B05: Empty cue/newline/overflow/bad duration/out-of-range/invalid B-style cue fails.
- B06: WAV/approved script/WORD hash change invalidates cue approval and dependent native data; media-only fulfillment leaves captions approved.

## 4. Work Package C — R2-03: preserve preview-first using ORIGINAL CLI scope

Own modules: externalTasks.ts, minimum current Studio state/UI readiness and nativeJobs.ts only if necessary to keep truthful render readiness, and tests.

C1. Add explicit owner preview_seconds N, 1 <= N <= 60, default 20. For SAMPLE_READY use original CLI arguments:
  node autopilot.mjs validate ABS_CANDIDATE.json --seconds N
For FULL_READY use:
  node autopilot.mjs validate ABS_CANDIDATE.json
Do not forge validator success, skip original style checks or introduce a second native schema.

C2. Determine two separate facts from actual original validator results: scoped SAMPLE_READY only if all in-scope shots, captions and media pass; FULL_READY only if unscoped original validate passes. Missing image/SFX after scope need not block preview-ready candidate; missing anything inside scope blocks sample. Expose status in project sidecar as verified scope/validation SHA and human-readable missing out-of-scope media.

C3. Owner may explicitly confirm/publish an INCOMPLETE DRAFT project.json for original scoped preview, after reviewing diff, while preserving original media needs ledger for later work. NEVER mark draft FULL_READY or enable full-film render without original full validation, complete late media and original human approval. Keep existing original preview/report approval protections in nativeJobs.

C4. Later revision completes last shots and media, validates full, then renders through original original CLI. Reassess any earlier preview approval using ORIGINAL native scoped fingerprint/review rules; never bypass it or guarantee late-shot edits always preserve approval if original Core says otherwise.

C5. If N exceeds narration duration, use the actual original rangeEnd and validator checked_seconds; never claim sample covered a fabricated 20 seconds. On any failed candidate/promote, preserve last-good manifest and approval.

**Mandatory behavioral UT-C01..UT-C06:**
- C01: CLI adapter records exact scoped validate args with --seconds 20 and unscoped args without --seconds.
- C02: First 20 seconds complete, later source shot missing => scoped SAMPLE_READY; FULL_READY=false; explicit draft promotion only.
- C03: First 20 seconds contain a missing asset/gap/bad caption => NOT SAMPLE_READY and promotion blocked.
- C04: owner-selected 1–60s accepted; 0/61/NaN/undefined malformed inputs rejected or defaulted as specified.
- C05: after late media complete, full validation becomes FULL_READY; original approval/fingerprint rechecked before render.
- C06: CLI failure/interrupted promotion leaves original project state untouched, statuses not falsely PASS.

## 5. Work Package D — R2-06: public source citations as inert, validated metadata

Own modules: externalTasks.ts validation of script.authoring.source_references and UT.

D1. Replace blanket rejectUnsafeStrings(authoring) with field-aware input validation. Preserve research references in source_references as INERT metadata (string citation or bounded object with title/url/note). Allow well-formed absolute HTTP(S) URLs for public citation records, including normal Unicode titles, query strings and fragment. NEVER fetch source URLs as part of import, never execute them or turn them into remote native media.

D2. Reject script/HTML/data/file/javascript executable schemes, credentials in URLs, local/loopback/private hosts, control characters, excessive length and prototype-polluting object keys. Keep strict project-path safety. Any remote URL in native project.json media paths, audio/SFX fields or executable positions is still forbidden.

D3. Ordinary narrative prose containing citation-like text must remain allowed. The approved script sidecar and second frozen ChatGPT prompt should round-trip source_references without truncation or synthetic changes.

**Mandatory behavioral UT-D01..UT-D04:**
- D01: Valid https citation with title/url/query/fragment passes script stage+confirm and appears unchanged in approved authoring and later frozen prompt.
- D02: javascript:/file:/data:, credentialed links, localhost/private hosts, too-long URL, invalid object shape and forbidden keys => FAIL.
- D03: URL in actual native image/audio/SFX path, absolute filesystem path, traversal => FAIL; normal native project-local media works.
- D04: Narrative description containing a quoted URL is inert prose, not a remote asset or executable; import performs no network fetch.

## 6. Unit test policy and acceptance matrix (NO E2E)

Tests may extend studio/tests/unit/ExternalTasksIntegration.test.ts, ExternalTiming.test.ts and ElevenLabsIntegration.test.ts, or add focused MediaFulfillment.test.ts, CaptionReview.test.ts, NativeSampleReadiness.test.ts, SourceReferences.test.ts.

All test fixtures use real TEMP DIRECTORY with actual project.json, .studio/state.json, pending.json, media/WORDS files and recorded before/after SHA. Use injectable stub/spy only around original CLI process invocation (assert actual argument list and behavior), never fake the business helper itself. Do not render MP4, simulate real user consent, launch Electron or call ElevenLabs/Nano live.

Gate G0: core diff=0, VoiceStudio untouched, no new TTS/LLM/renderer.
Gate G1: UT-A01..UT-A07 all PASS, with persisted exact field mapping and pending resume.
Gate G2: UT-B01..UT-B06 all PASS, reviewed word-grounded cues and native import binding.
Gate G3: UT-C01..UT-C06 all PASS, sample-only original CLI scope and full readiness split.
Gate G4: UT-D01..UT-D04 all PASS, safe source references persisted, no remote media acceptance.
Gate G5: all existing Nano golden, WAV/WORDS, ElevenLabs, source fingerprint and native approval regression UT pass without weakened asserts.
Gate G6: npm run typecheck; npm run lint; npm test; npm run build all PASS; repair any failing gate IN SAME ROUND.
Gate G7: report exact commit/changed production files, UT results/summary, no Core edits and E2E=NOT_RUN_BY_OWNER_REQUEST.

There are **23 specific behaviors** (7 A, 6 B, 6 C, 4 D). They may be grouped/table-driven but MUST each be asserted independently; do not game a test count. Browser/Electron, screenshot parity, native full render, Core 44 historic failures and Windows GPU/ElevenLabs live are explicitly outside Codex's current round.

## 7. State compatibility and failure guarantees

- Previously saved projects must reopen non-destructively. New typed sidecar fields need backward-compatible defaults. Old pending fulfillment records without verifiable binding must become REBUILD_REQUIRED, not falsely promoted.
- Keep original approved WAV, WORDS, prior accepted project.json and native original output/approval when a failed candidate is rejected. Original native approval invalidation follows real Core fingerprint policy, never blanket assumptions.
- Changing approved text/audio/words requires re-freeze; approved media fulfillment alone does not. Caption regrouping is revisioned and must be re-frozen for native authoring, no stale bypass.
- Test stage AND confirm concurrency/stale behavior. No blind assignment task.status=FROZEN after real changes.
- The current original producer/client and VoiceStudio Settings are considered repaired; do not destabilize them while fixing these six defects.

## 8. One implementation round and exact final report

1. REFRESH PR #2 HEAD, read this V4 plus original Mode B autopilot.mjs / loadProject / groupWords and current Studio sources. Read producer only if required for regressions.
2. Implement A -> B -> C -> D in production code in ONE round, then focused UT.
3. Run typecheck, lint, npm test, build. Fix any test failures before committing.
4. Commit/push to feat/r2-external-native-workflow; keep PR #2 DRAFT; DO NOT MERGE.
5. E2E deliberately belongs to OWNER. Report NOT_RUN; never claim MP4 runtime or live production PASS from UT.

Required Codex report:

R2 PR #2 — SIX-ISSUE UT REPAIR REPORT
BASE_MAIN_SHA:
START_HEAD_SHA:
FINAL_HEAD_SHA:
PR / BRANCH / DRAFT:
R2-01 WAITING_FOR_MEDIA: PASS/FAIL + file + UT
R2-02 Approved-caption binding: PASS/FAIL + file + UT
R2-03 Sample-first native validate: PASS/FAIL + file + UT
R2-04 Native shot/layer/SFX mapping: PASS/FAIL + file + UT
R2-05 Caption review/revision: PASS/FAIL + file + UT
R2-06 Research citations URL handling: PASS/FAIL + file + UT
UT-A01..UT-A07:
UT-B01..UT-B06:
UT-C01..UT-C06:
UT-D01..UT-D04:
TYPECHECK/LINT/UNIT/BUILD:
EXISTING NANO/VOICE/ALIGNMENT REGRESSIONS:
CORE_CHANGED_FILES: 0/FAIL
VOICE_SETTINGS_CONTRACT: ABSENT
E2E: NOT_RUN_BY_OWNER_REQUEST
ELECTRON/PLATFORM: DEFERRED_BY_OWNER
P0/P1 REMAINING:
FINAL_VERDICT: CODE_UNIT_VERIFIED / PARTIAL / FAIL

Do NOT implement a new engine, test Electron, or spend this round on E2E. The entire deliverable is six corrected production behaviors backed by focused UT evidence.
