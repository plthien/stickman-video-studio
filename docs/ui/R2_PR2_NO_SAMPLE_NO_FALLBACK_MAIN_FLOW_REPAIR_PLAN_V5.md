# R2 PR #2 — FINAL NO-SAMPLE / NO-FALLBACK REPAIR PLAN V5

**OWNER DIRECTIVE: ONE IMPLEMENTATION ROUND, CODE + FOCUSED UNIT TESTS.**
Repo: plthien/stickman-video-studio. PR: #2, branch: feat/r2-external-native-workflow; keep DRAFT, no merge.
Audited HEAD: ecd22c801e1e7ac141885749e7b2fd870d91c19d (refresh before editing).
Owner runs Windows E2E; Codex must NOT run/create Electron GUI E2E, GPU/live Nano, paid ElevenLabs tests or investigate 44 historic Core test failures unless an actual new production regression demands it.

## 0. Exact source findings and deletion scope

Recursive Git tree at audited HEAD has NO checked-in complete sample project folder or sample project.json under studio/. Previous repairs removed runtime demo narratives, shots, simulated stickman/preview, fake VB-0024/03:42, fake 28% readiness and UI demo Inspector. DO NOT assert a sample project directory was deleted if none existed. Original Core resources, B-style references and historical examples under skills/directing-stickman-videos/** MUST NOT be touched.

Remaining source-grounded defects:
- NF-01 P0: studio/src/main/externalTasks.ts projectContext() catches failure of approvedCaptionCues(root) and silently supplies approved_caption_cues: null; freezeTask('native') only checks whether state.alignment exists. Native ChatGPT prompt may be frozen despite corrupt/missing/unapproved captions.
- NF-02 P0: studio/src/main/nativeJobs.ts sourceFingerprint() hashes persisted voice/media metadata rather than current WAV/WORDS/approved cues/actual referenced asset file bytes. A previously verified preview/report can be reused even after file contents change outside state. Also badge states may come from stale native.preview/native.render.
- NF-03 P0: nativeJobs.ts captures state before asynchronous original CLI run, writes the old object after preview/approve/render, risking loss of unrelated imports or accepted revisions made during the operation.
- NF-04 P1: studio/src/main/services.ts projectSnapshot() invents SHOT-N IDs, fallback native shot titles, narration duration from scene duration, and coercive numeric values from incomplete manifests; reconcileJobSafe() masks corrupt existing job evidence with an invented UNKNOWN status.
- NF-05 P1: studio/src/renderer/features/voice/VoiceWorkspace.tsx suppresses caption-review errors in an effect; cancelled importWav/importWords return null but act() shows success. studio/src/renderer/features/storyboard/StoryboardWorkspace.tsx suppresses pendingMedia errors by setting pending to null. NativePreviewPanel.tsx and RenderWorkspace.tsx trust previously saved statuses and may retain stale playback/status on project switch.
- NF-06 P1: externalTasks.ts frozen prompt includes plausible sample creative payload: Script section-01 text 'Exact approved wording', plus native manifest with empty shots and captions. It is a JSON response SHAPE example, not a checked-in project folder, but it can be copied as if real authoring. Replace with clearly structural schema/instructions and prevent importing unedited placeholders as actual output.
- NF-07 P1: need a full production-only provenance sweep, removal of any remaining reachable demo/fallback branches, and correction of tests that previously assumed demo data. Preserve test-only fixtures solely under studio/tests/**; old studio/scripts/r2-offline-native.mjs sine fixture is TEST-ONLY and must not be used as application input or called owner-live E2E.
- NF-08 P1: studio/src/main/index.ts now sets actual voice.path on original init; Nano short, VoiceStudio long-form and WAV import write narration.wav bytes, update original project voice path, then state in separate operations. An error between those writes can leave a partially accepted new WAV and state/manifest inconsistent. All three accepted-audio paths need one rollback-safe publication boundary.

## 1. Non-negotiable interpretation of NO FALLBACK

Production has EXACT states:
- EMPTY or NOT_READY: valid new project has never produced the data. No demo content generated or loaded.
- RUNNING: actual operation in flight; cannot represent COMPLETE.
- CANCELLED: user cancelled chooser/action; unchanged project state, no success toast or accepted media.
- ERROR or BLOCKED: data that is expected/registered is corrupted, stale, missing, failed or inaccessible. Show the real failure code and reason; do not turn it into empty array/null/default or a success badge.
- VERIFIED: required bytes, approval, input hashes, original Core evidence and current project identity actually pass.

Legitimate defaults for INPUT CONFIG ONLY (e.g. the explicit initial selected B1 style, localhost Nano port 3901, a UI placeholder) are allowed. No sample project, fake narration, invented WORDS/captions, substitute scene, synthetic art/MP4, fake success, implicit remote API fallback, hidden uncertain Nano retry, automatic task approval, or source repair by mutating last-good data.

No destructive removal of real user project folders, .studio data, original WAV/MP4, assets, or backups. Original Core and VoiceStudio producer code are immutable. Manual two-stage External ChatGPT, B1–B4, Nano golden-fixture logic and ElevenLabs authorization are preserved.

## 2. WP-1 — Remove remaining fake project/data and make projection strict (NF-04, NF-06, NF-07)

- Inspect EVERY production file under studio/src/** and any runtime-packaged assets/scripts for demo/sample/fixture/mock/fallback and default values in persisted-output paths, not only labels. Produce a runtime provenance inventory for every workspace: source, legitimately empty state, required proof, and error representation.
- No production imports of studio/tests/**, mockups, offline sine-wave/video fixture generators, or any external example project. Do not remove isolated UT fixtures or original Core references.
- Replace the frozen response exemplar with a strictly structural format guide and actual task identity. Never include a plausible spoken script 'Exact approved wording', made-up shots, captions or native source paths. The current envelope and approved creative requirements still apply; reject unchanged template/placeholder as a real response.
- In projectSnapshot, validate nonempty original native shots and timing; never manufacture missing canonical shot IDs/timestamps/durations, nor treat corrupted registered voice/caption/media as EMPTY. Preserve valid intentionally empty original Core init scaffold.
- No job file means NOT_RUN; malformed existing job file means ERROR with exact evidence path, not {status:'UNKNOWN'}. Do not invent QA status or a replacement job.
- Do not show a picture or music when actual native media is not produced. An explicitly empty frame/blocked panel is fine.

Mandatory tests: new project empty; corrupt nonempty manifest fails; invalid shot ID/time cannot be silently repaired; bad job JSON fails; no fake authoring payload; no production test fixture dependency; old demo labels never appear from production code.

## 3. WP-2 — Never freeze native creative task with invalid captions (NF-01)

- Refactor projectContext for stage-specific evidence. SCRIPT handoff legitimately works without WAV/WORDS/captions. NATIVE handoff requires exact approved script, actual accepted WAV bytes and SHA, approved WORDS file with correct audio+script SHA and a current owner-reviewed caption revision with verifiable file hash and actual cue list.
- Remove swallow-and-null around approvedCaptionCues during native freeze. If previously registered captions are corrupt, missing, stale or unreviewed, throw an actionable ERROR/REVIEW_REQUIRED and do NOT issue FROZEN prompt or change previously valid task.
- stageImport and confirmImport must recompute the same current dependencies before promotion, preserve last-good manifest and pending recovery on failure. Do not fabricate word timing or derive captions from an old project.
- Tests: SCRIPT freeze without voice valid; NATIVE freeze with missing review blocked; changed WAV/WORDS/cue hash blocked; good approved cues and exact narration binding pass; invalid prompt never exported as ready.

## 4. WP-3 — Current verified preview/render only; no stale or overwritten state (NF-02, NF-03)

- One reusable CURRENT SOURCE EVIDENCE function: read/hash real project.json, accepted WAV bytes, current WORDS/caption revision files, voice lead/tail/trim config, and only actually referenced image/SFX/audio files; check valid project-local paths/rights. Keep unrelated unassigned imported assets independent.
- At preview reuse, preview run, approval, render and reopen projection, compare CURRENT evidence with the evidence that produced the output. Verify report/output SHA and actual original Core proof; any file mutation or registered missing evidence -> STALE/BLOCKED, no reused PASS, no automatic delete or overwrite of old MP4.
- Native jobs currently read state before await runProcess. After CLI returns, reread fresh project state, check exact project/task/manifest/source evidence and operation identity, then merge ONLY native-job-owned preview/approval/render fields. Concurrent unassigned asset import must survive. Changed script, WAV, cues or mapped assets must cause reject and revalidation, not stale success.
- Preserve last-good state on failure and release operation lock on all error paths, including initial job log write errors. No native renderer rewrite and no added Electron process-tree framework.
- On project switch, old preview URL, PASS/COMPLETE badges, approval and render UI should clear or re-derive from current verified evidence. A persisted boolean/status is not enough.
- Tests: defer mocked original CLI with controllable Promise; independent media update preserved; source byte mutation without state change blocks preview reuse/approval/render; malformed MP4/report/contact sheet/stale fingerprint blocks; original approved output remains untouched after failure.

## 5. WP-4 — Transactional accepted narration, no half-published WAV (NF-08)

- Keep existing producer receipt and authorized import checks. All THREE paths — Nano short, producer long-form, imported owner WAV — must share a narrow atomic acceptance helper: verify new PCM bytes, stage files, recheck approved script/profile identity, update native project voice.path while preserving name/id/user_override/lead/tail/trim_start, publish matching Studio voice state, and invalidate downstream dependencies ONLY on successful commit.
- If any write fails after staging, restore previous WAV, original project.json and .studio/state.json; preserve old approval if previously accepted project was not actually changed. No partial new voice label or false success toast. No direct edits to original Skill.
- Test failure injection at each file/manifest/state commit boundary; real temp dir before/after SHA, no paid or GPU calls. Test original Core init voice.path, Nano short mock, owner assembler mock and WAV import paths with B4 metadata.

## 6. WP-5 — UI and handler strict error/cancel semantics (NF-05)

- VoiceWorkspace: captionReview failure must show ERROR and detail, not setReview(null) as if no alignment. Clear old success on project change. Missing review is NOT_READY only when never created; missing/corrupt expected review is ERROR.
- Dialog cancellation from import WAV/WORDS returns CANCELLED without showNotice(success), without state mutation and without marking stages verified. Explicitly handle null in act(), and avoid mixing return types that could hide cancellation.
- Storyboard: no pending journal is legitimate EMPTY; a corrupt/unreadable existing pending journal is ERROR, not setPending(null) silently. Media may remain pending for review with no fake MAPPED badge.
- External: frozen-task/JSON validation/confirm failure clearly shows error, keeps previous valid artifact but never displays success or permits stale confirm. Native prompt error cannot be copied/exported as ready.
- Preview/Render: only current verified project source/report gives PASS/COMPLETE; mediaUrl fetch/URL failure must clear stale video player and report ERROR. Keep old render report historical, never claim it is current if source changed.
- Keep UI layout; no full Electron redesign. React service/handler UT cover cancelled import, broken cue, corrupt pending, broken preview media URL, cross-project badge reset and correct recovery after explicit repair.

## 7. Test plan — CODEX UT only, OWNER E2E later

Use source-own original Core init scaffold bytes as baseline for project/voice-path unit boundaries, NOT a test fixture that pretends native path already matches accepted WAV. All tests run against real temp on-disk project/state files; injected original CLI runner only for simulating completion/failure, not mocking whole business service.

Mandatory independent behavioral cases:
UT-NF01: empty Core init yields no project sample, script, voice, scenes, timeline, preview or false progress.
UT-NF02: malformed registered state/job/project cannot silently become empty, placeholder or fabricated canonical ID.
UT-NF03: SCRIPT freeze without voice works, NATIVE freeze without approved real cues fails.
UT-NF04: changed WAV/WORDS/cue bytes makes native prompt or import STALE.
UT-NF05: unedited fake 'Exact approved wording' template/empty native manifest cannot be accepted as production creative output.
UT-NF06: current WAV/cue/image bytes must agree with preview/report before reuse/approve/render; byte tampering blocks.
UT-NF07: concurrent native run preserves unrelated valid asset imports and refuses changes to its true dependencies.
UT-NF08: corrupt MP4/report/job receipt fails with no 'VERIFIED' status.
UT-NF09: user cancels WAV/WORDS import -> no success, no changed state; no pending journal is legitimate EMPTY.
UT-NF10: corrupt pending journal / caption review failure becomes visible ERROR.
UT-NF11: atomic accepted-audio commit for short/long-form/imported WAV, with exact original native voice.path and retained B4 fields.
UT-NF12: failures injected after each WAV/manifest/state write restore last-good bytes and do not invent approved state.
UT-NF13: opening a second empty project clears old native video URL/approval and PASS statuses.
UT-NF14: production contains no runtime sample asset/project import or fake sample output, while fixtures remain isolated in studio/tests/**.
UT-NF15: complete recovery: after correcting genuinely missing/invalid data, operation may become VERIFIED only after actual evidence and explicit human approval.

Run existing Nano golden, long-form mock, ElevenLabs alignment, 23 V4 cases and 10 final-two-issue cases; do not weaken assertions or reintroduce demo to pass old tests. Legacy R1 browser tests originally asserting six demo scenes are historical and do not define R2 Main Flow correctness.

## 8. Quality and completion gates (all mandatory)

G0: refreshed source HEAD, no concurrent work overwritten; produce runtime provenance inventory.
G1: zero production sample projects/data/fallback paths. Test fixtures only in tests/**, Core references untouched.
G2: all missing/corrupt required artifacts ERROR/BLOCKED; genuinely uncreated stages EMPTY/NOT_READY; cancellation CANCELLED.
G3: native task cannot freeze with null/unreviewed approved captions.
G4: preview/reuse/approve/render cannot use old evidence when current source WAV/WORDS/media differs.
G5: async native jobs do not overwrite fresh state; accepted voice publication atomic/rollback-safe across three paths.
G6: test cases UT-NF01..15, all relevant prior UT and provider golden regression PASS.
G7: run in studio/: npm run typecheck; npm run lint; npm test; npm run build. Attach exact results + HEAD, never invent PASS if tools unavailable.
G8: original Core changed files=0, producer untouched, Settings Contract absent, no LLM API, no Remotion/new renderer.
G9: no deletion of user's actual projects, accepted audio or project output; PR stays Draft, no merge.
G10: E2E, Electron GUI, GPU live and paid ElevenLabs are NOT_RUN_BY_OWNER_REQUEST.

ALL gates PASS => CODE_UNIT_VERIFIED; otherwise PARTIAL or FAIL. Unit verification never means owner E2E passed.

## 9. One-round Codex instructions

1. Fetch current PR #2 branch/HEAD and read this V5 plus current exact modules and original Core init/captions/validate/preview/approve/render behavior.
2. Implement WP-1 through WP-5 in one implementation round. Remove unused runtime demo data; do not delete tests, Core examples or user projects.
3. Add focused UT and repair all failures within the SAME round. Keep production workflow manual External ChatGPT -> approved script -> VoiceStudio/imported WAV -> real aligned WORDS -> owner-reviewed captions -> native manifest/media -> scoped preview -> human approval -> final render.
4. Run all G7 commands, record honest test evidence, commit and push to feat/r2-external-native-workflow, keep PR #2 DRAFT, DO NOT MERGE.
5. Final Codex report:
START_HEAD_SHA:
FINAL_HEAD_SHA:
RUNTIME_SAMPLE_PROJECTS_FOUND/DELETED:
RUNTIME_FALLBACK_PATHS_REMOVED:
WP1..WP5:
UT-NF01..UT-NF15:
EXISTING_REGRESSION_UT:
TYPECHECK / LINT / TEST / BUILD:
CORE_CHANGED_FILES:
USER_PROJECT_DATA_DELETED: 0
OWNER_E2E: NOT_RUN_BY_REQUEST
NANO/ELEVENLABS_LIVE: NOT_RUN_BY_REQUEST
REMAINING_P0 / P1:
VERDICT: CODE_UNIT_VERIFIED | PARTIAL | FAIL

**Do not treat missing or corrupt evidence as proof of success. Do not insert demo data as fallback.**
