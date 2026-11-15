# R2 / PR #2 — COMPREHENSIVE MAIN FLOW AUDIT & ONE-ROUND REPAIR

Status: AUDIT FINDINGS + IMPLEMENTATION PLAN, NOT IMPLEMENTED.
Source of truth: inspected repository code on GitHub at HEAD \`9e8f70e3659b7d1214c03247450013c9277528e0\` (2026-11-15).
Repository: \`plthien/stickman-video-studio\`; branch: \`feat/r2-external-native-workflow\`; PR #2 DRAFT; base main \`5871fd06657c014baeeb3efe405611e61cd496c9\`.
Authoritative original Mode B CLI: \`skills/directing-stickman-videos/scripts/autopilot.mjs\` and \`autopilot-core.mjs\`; **NO changes** to \`skills/directing-stickman-videos/**\`.
Owner: Code + focused behavioral UT ONLY; owner will execute E2E on Windows. No paid live provider, no Electron Playwright, no real video E2E in the implementation round.
Prior V4/V5/final-three plans remain regression history, NOT simultaneous independent implementation scopes. This is one frozen repair scope; new findings must come with a reproducible source or failing-test witness and be classified separately rather than silently changing acceptance criteria.

## A. Method and limitations

Audited the main-process entrypoints and the full flow: Core project init; project.state/readState; External script/native freeze/stage/confirm; Nano/longform/imported WAV acceptance; ElevenLabs/offline WORDS; Core captions and owner caption revision; image/SFX import/fulfillment; scoped sample/full native validation; original preview, approval and full render; renderer state, app state, project switching and error screens.
Read original Mode B CLI validate/preview/approve/render, report layout and output artifact paths. Reviewed old and latest UT sources, including V4/V5, final-two, final-three, mock alignment and data fixtures.

**What was NOT verified:** No actual current checkout or Windows npm run logs for HEAD above, no live Nano/ElevenLabs, no actual end-to-end preview rendered by original Core, no claim of regression tests PASS. GitHub commit had 0 check runs at the time of audit. Source review proves the implementation paths described below, not that every listed race has been observed live; deferred UT must reproduce them.

**Verified completed work to preserve:** original Core unchanged; no tracked standalone sample project under studio; production demo script/scene/preview fallback removed; Caption Review and source URLs introduced; original native probe/FFmpeg decode and matched Core fingerprints; effective preview duration normalized; real caption revision readiness in snapshot. Do NOT refactor those again without a focused failing test.

## B. ONE audit issue register (7 issues: 3 P0 + 4 P1)

### MF-01 — P0, native operation lock is acquired AFTER asynchronous preflight

**Source proof**: \`studio/src/main/nativeJobs.ts\` checks \`active.has(root)\` at the start, but calls \`await verifyPreviewEvidence()\` in preview reuse / approve / render before \`active.set(root,{id,controller})\`. Two requests can both pass guard, then overwrite \`latest.json\`, output/checkpoint, preview or approval artifact and each other's rollback backups. Preview reuse can also return \`reused:true\` based on evidence that changed during verification.

**Repair**:
- Acquire a canonical-project-key single-operation lock SYNCHRONOUSLY before first await, including the reused-preview path; make one top-level try/finally release it on success, failure, cancellation, exceptions in backup/preflight and errors in verifier.
- Preserve current cancelJob semantics and original process cancellation. Reject a second mutating native command with an exact BUSY code; never allow two active handles for one root.
- Capture source identity before verification and recheck after verification, including the reuse return path. Validate owner input and saved approval against fresh source, not solely preflight snapshot.
- No new native CLI and no Electron job infrastructure.

**UT-MF01**: two concurrent preview/approve/render calls while first verifier deferred -> only one may proceed; reuse while media changes -> no reused success; cancel during preflight releases lock; verifier/backup failure releases lock; subsequent legitimate call succeeds.

### MF-02 — P0, late verification awaits still permit stale state overwrite

**Source proof**: \`nativeJobs.ts\` reads \`fresh=readState(root)\` and checks source/task after \`await runner\`, then \`await verifyPreviewEvidence\` or \`await verifyFilmEvidence\`; afterward it writes the PRE-await \`fresh\` object. An independent import or metadata change occurring during post-run decode/validate may be lost. Rollback must also not restore unrelated current state. Existing \`ExternalTasks.confirmImportOnce\` addressed a similar race only for one earlier await.

**Repair**:
- After EVERY last async boundary and before success publication, reread **latest** state; compare exact project/task identity, approved creative/audio/words/caption/media evidence and relevant output/report/current Core fingerprint. Reject changed prerequisites as STALE; preserve independent imports/settings.
- Apply ONLY owned keys (preview, approval, render, job record) to latest state. No bulk writes of an earlier snapshot. If source validation itself triggers a side-effect (e.g. caption invalidation), reconcile it first.
- Ensure failure after output render, verification, state or journal publication preserves last-good project and historical artifacts; never rollback unowned concurrent updates. Design transaction order so \`SUCCEEDED\` is never persisted before required state/evidence commits.
- Cover \`preview\`, \`approve\`, \`render\`, reuse path and invalidation. Keep original CLI as validator/renderer.

**UT-MF02**: deferred post-run verification + import unassigned media -> media and imports survive; defer verification + approved script/WAV/WORDS/assigned asset change -> rejects without success; output/report mutation while verifying -> no false PASS; failure after state commit restores ONLY job-owned fields, preserves concurrent changes and recovery.

### MF-03 — P0, ElevenLabs/WORDS alignment publishes an old snapshot after async captions generation

**Source proof**: \`studio/src/main/alignment.ts\` \`publishAlignment()\` reads state before \`await runProcess(...,'captions',...)\`, then unconditionally sets alignment and \`writeState(root,state)\`. Independent imports/revisions occurring meanwhile are overwritten. \`alignWithElevenLabs()\` also awaits a remote response before it calls \`publishAlignment()\` and does not pin/compare all current transcript/WAV identity at the return boundary; \`publishAlignment()\` does not explicitly require supplied \`transcript === alignmentText(state.approvedScript.text)\` and original source revision.

**Repair**:
- Pin exact approved script text/hash/revision, spoken transcript, accepted WAV bytes/hash and approved profile/source at operation start; validate after remote return and again after original Core captions subprocess.
- If a dependency changed -> STALE/RETRY_REQUIRED; DO NOT publish generated captions and DO NOT automatically retry paid API requests.
- Read latest state after last await; merge ONLY alignment and dependent invalidation fields, preserving unrelated imported media, job metadata, project settings.
- Publish WORDS+Core-generated cues+state atomically or via rollback/recoverable journal: failure leaves previous valid alignment/captions/approval intact; orphan diagnostic temp file cannot become accepted.
- Same rule for owner-imported WORDS route and ElevenLabs; original Core \`captions\` command remains sole grouping engine.

**UT-MF03**: hold provider response then change approved script/WAV/profile => reject stale response; hold Core captions runner then import asset or change project metadata => no loss; hold Core captions then change script => reject; injected captions error/write failure retains accepted previous alignment; approved exact source succeeds, no paid call.

### MF-04 — P1, pending media fulfillment is half-committed across two files

**Source proof**: \`externalTasks.ts\` \`fulfillMedia()\` writes \`.studio/external/pending.json\` before \`.studio/state.json\`. If the second write fails/crashes, pending journal already claims a fulfillment but state.media lacks bound entry. \`pendingResult()\` then fails \`verifiedMedia\`, and attempting identical fulfillments sees \`previous\` and cannot repair the inconsistent pair by normal workflow.

**Repair**:
- Commit pending.fulfillments and state.media via a bounded backup+rollback or a narrowly recoverable write-ahead journal; no silent reset, no fake mapping.
- On reopened mixed/partial state, surface \`RECOVERY_REQUIRED\` with deterministic safe resume/reconcile only when actual file/rights/hash/target match approved pending references; otherwise owner review/rebuild, no target substitution.
- Keep stageImport/confirmImport exact task identity, rights and SHA restrictions; no invented layer ID.

**UT-MF04**: injected failure between pending and state write; crash/reopen from half-applied journal; idempotent same binding; wrong mapped target or changed asset hash fails; unrelated previous mappings remain intact.

### MF-05 — P1, project creation can strand a half-initialized folder

**Source proof**: \`studio/src/main/index.ts\` executes original \`init target\` which creates a directory, then separately rewrites \`project.json\`, creates \`.studio/state.json\` and updates recent-projects. If any step after init errors, user may be left with an existing target directory but missing valid Studio state. Retrying Create rejects an existing folder; Open invokes readState and fails. No explicit transaction/recovery.

**Repair**:
- Extract production Create helper into a testable main-process service. Stage a project in a same-parent temporary directory, call ORIGINAL Core init on stage path, validate manifest, build complete Studio state and only then atomically publish intended final directory; verify final project identity/path.
- Handle failure at init/manifest/state/recent update boundary without deleting ANY pre-existing user directory or overwriting existing data. If recent-project list fails after project creation, return a truthful created-with-warning/recoverable result rather than falsely reporting total failure or deleting genuine data.
- Never auto-hydrate an orphan folder with fabricated project values. Provide explicit recovery instructions for already existing incomplete folders.

**UT-MF05**: Core init error, project write error, state write error, recent JSON failure, retry after failed staging, existing real project untouched, no orphan directory or fake success.

### MF-06 — P1, registered caption revision corruption is masked as unreviewed and can block recovery

**Source proof**: \`captionReview.ts getCaptionReview()\` sets \`approved=null\` when registered revision file is missing or has wrong SHA, without differentiating a never-created review. \`projectSnapshot.ts\` throws when a registered review resolves to no approved cues. Direct Voice Caption Review UI can therefore show REVIEW REQUIRED for corrupt registered approval; opening the project may fail before user reaches repair controls. \`invalidateTimingDependents\` also writes state as a side effect of an ostensibly read-only review call.

**Repair**:
- Distinguish NEVER_CREATED/REVIEW_REQUIRED, STALE_TIMING, CORRUPT_REGISTERED_REVIEW and VERIFIED with exact source/error codes. Registered corruption must NEVER silently become "no review".
- Preserve full project identity and access to explicit recovery UI if review is stale/corrupt; block native freeze/preview/approve/render until owner revises. A recoverable stale caption must not permanently prevent opening the project, and it must not produce green evidence.
- Make getter side-effect-free or isolate explicit invalidation transaction, with re-read state and downstream status verification; do not invalidate in an unrelated read without a traceable state update.
- \`approvedCaptionCues\` remains authoritative for exact word timings/text, no synthetic cues.

**UT-MF06**: first-time no review => NOT_READY; registered deleted/changed revision => BLOCKED (not an unreviewed fallback); changed lead/trim => STALE_REVIEW and project recoverable; owner reapproves then verified; no premature native prompt/caption success.

### MF-07 — P1, project switching/async UI callbacks can display or persist another project's data

**Source proof**:
- \`AppState.tsx\`: on native ID/endpoint change, debounced \`setNanoEndpoint(id,...).then(setNativeRaw)\` can return after a user has switched to a different project and replace the UI state with the old project's snapshot. It also writes settings automatically on project switch.
- \`ProjectForm.tsx\`: Open Project rehydrates title/topic/style/language but not \`duration\`; target duration from previous project remains in local form. Create Project does not pass form duration to \`createProject\` although IPC accepts targetDuration.
- \`VoiceWorkspace.tsx\`: selected \`voice\` is initialized once from native?.nano?.profileId and is not reset when project ID/profile changes; may generate using prior project's profile.
- \`ExternalWorkspace.tsx\`: JSON/pending review state is session-local and not completely project-keyed; old task response can remain visible after switch, although strict envelope validation should block acceptance.

**Repair**:
- Project-key or request-epoch guard ALL async callbacks updating UI state. A result from project A must never replace project B; no hidden endpoint write during simple open unless user explicitly modifies endpoint.
- Rehydrate ALL editable project form fields including duration; pass targetDuration from Create. Reset/scope selected voice profile, External JSON/pending and operation banners on switch; previous project data must never be represented as current.
- Keep strict backend project ID/task/asset checks even if UI incorrectly submits an old ID.
- Do not introduce fallback sample data to keep UI populated; empty/new project states are legitimate.

**UT-MF07**: delayed setNanoEndpoint A response after switch to B cannot replace B; Create persists duration; Open updates duration; selected voice A does not carry into B; copied Native/Script task A not presented as B; previous preview/report/approval badge cannot appear for B.

## C. Bounded implementation sequence and shared invariants

WP-A (MF-01 + MF-02): Native job lock and source-verified state commit; fix all async windows in that module, including preview reuse and rollback.
WP-B (MF-03 + MF-06): Alignment and caption approval source integrity, recoverable fail-closed semantics; shared rules for external NATIVE freeze.
WP-C (MF-04 + MF-05): Exact local persistence/journaling for asset fulfillment and project creation, atomic commit, last-good files preserved.
WP-D (MF-07): Project-bound UI input/async state; no cross-project visibility or mutations.
WP-E: Focused UT, full related regression and honest evidence capture; NO E2E run.

**Mandatory invariants across all work packages**:
1. Never report PASS from mock data; all runtime success requires current on-disk source and original Core evidence. Unit fixtures under studio/tests/** are okay but never production fallbacks.
2. NEVER change original Mode B Core, original skill references/assets, producer VoiceStudio, approved WAV/WORDS by silent coercion, no Contract Settings field, no paid/live calls. No LLM API, Remotion, G-Labs or new renderer/caption engine.
3. Do not delete/move/overwrite real user projects or preexisting accepted media on failed repair. No blind reset of pending/approval/voice data.
4. Project-local task/source identity, SHA, rights, cue word timestamps and owner approval remain immutable except explicit review/revision.
5. Source changes during async process -> STALE/BLOCKED and no success. Independent unrelated changes -> survive. No catch-and-null on expected registered artifacts.
6. Owner E2E remains NOT_RUN_BY_OWNER_REQUEST. Current GitHub CI has no check runs; must use local UT/typecheck/lint/build logs from exact final HEAD.

## D. Acceptance and UT coverage matrix

Deliver focused UT using **real temporary files, original Core scaffold on project creation, injected deferred Promise around actual subprocess boundary, file-hash/commit failure injection**. Never mock business functions themselves.

**Core asynchronous matrix** (cross source and operation):
- A: normal success; B: concurrent independent import; C: changed script/voice/WORDS/approved cues/mapped media; D: cancellation; E: timeout; F: subprocess/decoder failure; G: failure after file write / before state commit; H: restart/recovery. Record separate assertion for every relevant command.
- No fake MP4 success test: existing real local FFmpeg fixture with probe/decoding is acceptable in UT; original Core runtime rendering remains owner E2E.

Minimum test IDs / acceptance:
- MF01-1...5 early per-project lock and preview reuse, busy, cancel/preflight fail, release.
- MF02-1...5 stale write prevention on post-run preview and render, independent change preservation, stale input/output rejection, rollback-only-owned fields.
- MF03-1...6 remote alignment stale script/WAV, Core captions race, success with exact transcript, failure recovery, and no silent paid retry.
- MF04-1...4 pending/state transaction rollback, crash repair, idempotency and mismatch.
- MF05-1...5 staged Core init, fault injection each create step, preexisting directory preservation, explicit recovery.
- MF06-1...5 review status variants, fail-closed freeze, recovery via new owner approval, no read-side-effect.
- MF07-1...5 cross-project async response, form duration, voice profile, External task and preview stale UI.

**35 focused test behaviors** (5+5+6+4+5+5+5). Group/table-drive as appropriate; do not game test names or counts. Existing regression suites (23 V4 behaviors + 10 final-two + 15 V5 + 20 final-three + Nano golden, longform, offline WAV/WORDS, ElevenLabs, native approval) MUST remain passing. Do not disable/change them just to match the new code. Keep tests narrowly runnable on Windows without live calls. Historical R1 Electron/browser fixture tests are outside owner-requested UT-only acceptance; do not present them as Main Flow evidence.

**Quality gates** from \`studio/\`:
\`\`\`
npm run typecheck
npm run lint
npm test
npm run build
\`\`\`
All PASS with raw logs at final HEAD; if impossible, report NOT_RUN/PARTIAL rather than asserting PASS. Check \`git diff main...HEAD -- skills/directing-stickman-videos/\` empty; no voice producer changes, no project samples in production. PR #2 remains DRAFT and unmerged.

## E. Implementation and reporting

1. REFRESH HEAD. Reinspect any new commits vs audited \`9e8f70e\`. Capture baseline SHA and Core untouched.
2. Implement WP-A through WP-D in **ONE ROUND**. Do not stop after a new audit/plan. Repair compilation and UT failures in the same round. Avoid new platform architecture; small owned helpers/testable services allowed.
3. Save changed source and UT to existing PR #2 branch; no merge.
4. Complete WP-E test execution and report with exact commit/head and evidence (or explicit NOT_RUN).
5. Owner runs E2E later. A unit-only verdict never claims verified Windows production output.

**Required final report:**
R2 PR#2 COMPREHENSIVE MAIN FLOW REPAIR
AUDITED_HEAD: 9e8f70e3659b7d1214c03247450013c9277528e0
START_HEAD_SHA:
FINAL_HEAD_SHA:
MF01..MF07: PASS/FAIL, actual changed files, UT IDs, evidence
UT-MF01..MF07:
ORIGINAL CORE DIFF:
REMAINING P0/P1 (source evidence only):
TYPECHECK / LINT / UNIT / BUILD: exact command logs
OWNER E2E: NOT_RUN_BY_REQUEST
NANO / ELEVENLABS LIVE: NOT_RUN_BY_REQUEST
PR DRAFT/NOT_MERGED:
VERDICT: CODE_UNIT_VERIFIED / PARTIAL / FAIL

**Stop redefining this repair as successive "final two/three issues". Fix the shared lifecycle, publication and provenance invariants together. Never invent PASS.**
