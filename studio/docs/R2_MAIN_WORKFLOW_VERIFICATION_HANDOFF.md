# R2 Main Workflow — Implementation and verification handoff

Repository: plthien/stickman-video-studio
PR: #2, branch feat/r2-external-native-workflow (keep Draft, do not merge)
Baseline reviewed: 0a42f76fec29630fc0fe7951f562d06a814608f1

## Production changes committed

FIX-01: source-exact, stage-scoped authority and 4-way KEEP/MOVE_TO_NATIVE/
STUDIO_ONLY/AGENT_ONLY matrix; B4 story, opening, sound and motion contracts.
Original source and extraction hashes, revision and selectors; missing source
fails closed. Source file guidance remains installed/unchanged.

FIX-02: Script candidate vs approval, frozen original Task/brief/sections,
review finding/coverage validation, section-level complete correction, recheck
bound to current SHA, owner approval after corrected Script recheck and
voice/alignment invalidation through the original ownership boundary.

FIX-03: native manifest + shot/sound/asset ledgers are the frozen baseline,
recursive full-payload locks for approved shots, globals, style, music,
ambience, caption, voice and path-level scope. Voice and caption edits via
Native correction are always prohibited. Original Native validation controls
promotion and missing media remains explicit.

FIX-04: staged lifecycle publication, immutable response, original CLI
validation before promotion, recovery journal and retry, safe rollback guard,
separate native media vs lifecycle token in the V3 UI.

FIX-05: original frozen prompt included in review, source context and
authority fingerprint checks, reviewed target inventory, severity, statuses,
finding IDs, references, supported coverage, recheck resolution accounting.

FIX-06: export real copied MP4/WAV bytes, original Native Task, QA report,
subtitles and optional still contact sheet with SHA-256. Owner must manually
transfer actual files to ChatGPT and attest that action. Studio validates
review source hash and shot/time scope but does not claim to have verified
the model's actual seeing/hearing or creative quality. Preview and Full Film
remain separate selectable scopes.

FIX-07: approved creative directions and Script, voice, word/caption timing,
shot IDs and auxiliary ledgers stay in current artifacts and frozen tasks;
scoped corrections preserve unrelated content and original invalidation.

UI V3 is reused. No LLM API, automatic agent, new DSL, G-Labs R3, provider
redesign or Native Core modifications are part of this PR.

## Deterministic offline regression files (added/modified)

- tests/unit/R2MainFlowAuthorityAndLocks.test.ts — B1–B4 authority, six
  sections and 25 shots, global/auxiliary/voice/caption/identity locks.
- tests/unit/ExternalLifecycle.test.ts — review/Script correction/recheck,
  invalid findings, stale review and idempotent staging.
- tests/unit/R2NativeCorrectionRecovery.test.ts — before journal/staging,
  original Native validator failure, post-publish retry/last-good.
- tests/unit/R2MediaReviewTransfer.test.ts — actual encoded OFFLINE FIXTURE
  files with hash verification, transfer attestation and evidence constraints.
  Black/synthetic MP4 fixture is not evidence of a finished creative video.

## Local verification to run against the final PR HEAD on Windows

From repository root:
1. Confirm PR and installed Core baseline on the exact HEAD.
2. Change directory to studio and run npm ci, npm run typecheck,
   npm run lint, npm run test, npm run build.
3. Run focused suites:
   npx vitest run tests/unit/ExternalLifecycle.test.ts
   tests/unit/R2MainFlowAuthorityAndLocks.test.ts
   tests/unit/R2NativeCorrectionRecovery.test.ts
   tests/unit/R2MediaReviewTransfer.test.ts
4. Run npm run accept:r2, plus original Native CLI sample and full validation
   using an actual project with approved WAV, word timings and local assets.
5. Freeze original (baseline) and corrected Script Task on equivalent
   project inputs, record real UTF-8 byte sizes and SHA-256, and compare
   mandatory creative authority coverage separately from size.
6. Run real manual External ChatGPT Script review/correction/recheck and
   actual MP4/audio preview transfer/inspection, Native correction, rerender,
   approval and full render. Review actual encoded frames with verified
   timestamps and actual sound; do not substitute stills or metadata.

## Honest evidence status when this handoff was written

- GitHub PR source changes: committed on current Draft branch.
- Installed original Core source files: no paths under
  skills/directing-stickman-videos/** changed in PR #2 at inspection time.
- Local typecheck, lint, unit/integration tests and build: NOT_RUN —
  repository checkout / installed dependencies unavailable to this executor.
- Windows acceptance and original Native CLI: NOT_RUN.
- Live Nano, ElevenLabs, actual project media and encoded creative QA: NOT_RUN.
- True before/after frozen Script Task sizes: NOT_MEASURED.
- GitHub CI status at latest inspected commit: no reported statuses.
- Therefore no test PASS, creative PASS, or end-to-end acceptance is asserted.

Keep the PR Draft until all outstanding checks and any discovered failures
are resolved on the exact final commit; do not merge on code-only evidence.
