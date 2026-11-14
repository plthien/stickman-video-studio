# R2 / PR #2 — ONE-ROUND COMPLETE REPAIR PLAN
**Status:** Owner-approved repair scope. Plan only; no production code changed by this document.
**Repo:** plthien/stickman-video-studio
**Target:** Draft PR #2, branch feat/r2-external-native-workflow → main
**Audited R2 HEAD:** 07b39e72e52d36e505190f76078f98d15b7f39a8
**Base main at audit:** 5871fd06657c014baeeb3efe405611e61cd496c9
**Controlling R2 plan:** docs/ui/R2_EXTERNAL_CHATGPT_NATIVE_MODE_B_ONE_ROUND_IMPLEMENTATION_PLAN.md
**Windows:** local-only Electron, Vite port 5174; no GitHub Actions budget
**Goal:** Finish ALL previously audited defects in ONE implementation round, then run honest local tests and post evidence. DO NOT merge.

## 0. Nonnegotiable preservation and scope

1. **Do not modify ANY file under skills/directing-stickman-videos/**. This includes its scripts, SKILL.md, references, tests, assets, runtime grammar, cache, approval, styles, and previously accepted Windows portability fixes. Treat the original B1–B4 CLI/native project.json as the sole production engine. B5 stays out of R2.
2. **Do not modify VoiceStudio-GGUF-Lite** or the original Mode B producer. R2 is a Studio UI/main-process adapter against the existing branch feat/chatterbox-turbo-provider, not a voice engine rewrite.
3. **Do not implement a new video/creative engine**, Remotion, G-Labs, LLM API, ChatGPT automation, provider-agnostic adapter, or new visual language. User manually takes a Skill-grounded prompt to ChatGPT Web and imports the authored result.
4. Voice is VoiceStudio Chatterbox Nano local at http://127.0.0.1:3901. ElevenLabs is used ONLY for owner-authorized forced alignment of the final WAV to approved text.
5. **Remove the Voice Settings "Contract" field entirely.** No replacement nano_lite_api_v1 textbox, no version-negotiation configuration, no fake "verified contract" badge. Use the actual pinned producer API and validate its real responses. The value "youtube-studio-nano-api-v1" is a document title, not a useful user-facing setting.
6. Keep the approved V3 mockup/reference and 9-page R1 UI shell; repair data integration and truthfulness, not redesign.
7. R1's previously deferred Electron smoke failures are historical; if the same isolated issue remains, label KNOWN_DEFERRED_R1. Do not treat new R2 security/IPC/preview regressions as deferred.
8. Do not turn tests into mocks that mark the real pipeline PASS without an actual native MP4. Never call paid/live external services automatically in automated acceptance.
9. Refresh current PR HEAD before coding; if it has advanced, recheck these findings against latest code. **All WP fixes below must be completed in one round**, with production code and targeted existing/new tests, not another plan.

## 1. Confirmed source locations and defect inventory

- studio/src/main/services.ts — stageContracts/externalPrompt, strictJson, in-memory pending, state revisions, runNative, path guards, inspectWav
- studio/src/main/index.ts — project/IPC, Nano and ElevenLabs handlers, native jobs, studio-media
- studio/src/preload/index.cts — IPC bridge and untrusted renderer boundary
- studio/src/renderer/features/external/ExternalWorkspace.tsx — UI handoff and false FROZEN badge
- studio/src/renderer/features/voice/VoiceWorkspace.tsx — default :8000, default voice, arbitrary text, secret in renderer
- studio/src/renderer/features/settings/SettingsWorkspace.tsx — :8000, hardcoded Contract textbox, disconnected settings state
- studio/src/renderer/features/script/ScriptWorkspace.tsx — six hardcoded demo sections; not bound to imported script
- studio/src/renderer/features/storyboard/StoryboardWorkspace.tsx — six hardcoded demo shots; import not attached to shot/layer
- studio/src/renderer/pages/VideoEditorPage.tsx — still demo-only native timeline
- studio/src/renderer/features/editor/NativePreviewPanel.tsx — unconditional replace:true, no verified native sample artifacts
- studio/src/renderer/features/editor/ApprovalPanel.tsx — UI can approve without verified viewed sample; stale sidecar status
- studio/src/renderer/features/render/RenderWorkspace.tsx — render command only; no report/output verification, fake uniform step DONE
- studio/tests/unit/MainServices.test.ts and studio/tests/ui/r2.spec.ts — shallow/string-only checks, mock bridge
- studio/scripts/windows-r2-acceptance.ps1 — no real end-to-end native acceptance; working-tree-only core diff

Repair IDs map to the source audit:
- **R2-01 P0**: Exported prompt omits actual Skill, selected B-style/QA/sound instructions and source.
- **R2-02 P0**: Import never constructs, stages, validates, and promotes a native B1–B4 project.json candidate.
- **R2-03 P0**: Script, Storyboard, Editor remain demo fixtures after real project/import.
- **R2-04 P1**: Nano URL defaults to :8000 rather than :3901, settings not shared.
- **R2-05 P1**: Nano readiness uses HTTP 200 instead of the actual readiness/voice-profile fields.
- **R2-06 P1**: Wrong Nano header x-nano-execution-receipt, missing canonical receipt/proof/context/frame checks.
- **R2-07 P1**: Writes final narration.wav before validation; broken output can overwrite accepted audio.
- **R2-08 P1**: Missing proper long-form section assembly and resume/uncertain-request handling.
- **R2-09 P1**: Preview silently calls --replace.
- **R2-10 P1**: Approve UI does not enforce explicit review of CURRENT encoded sample.
- **R2-11 P1**: Approved UI label can be stale against original native fingerprint.
- **R2-12 P1**: Renderer-supplied arbitrary project root paths; incomplete symlink/junction/canonicalization protection.
- **R2-13 P1**: No durable, exclusive per-project job lifecycle/cancel/reconcile.
- **R2-14 P1**: ElevenLabs checks only nonempty words; no full timing/coverage/hash/secret safeguards.
- **R2-15 P2**: Remove bogus Settings Contract value; use one real Nano connection setting at :3901.
- **R2-16 P1**: Acceptance tests incorrectly imply production integration success; native core tests NOT_RUN and no MP4 chain evidence.

## 2. Exact work to implement (all in one round)

### FIX-01 — Original Mode B Skill-grounded manual ChatGPT handoff (R2-01)

- Implement frozen, persisted prompt snapshots generated from **actual installed Skill text and the actual selected style/reference text**; bundle those contents (and applicable B common QA/sound policies) because ChatGPT Web cannot read machine-local paths. Do NOT merely print "Style contract: B2".
- Use the original B Agent's creative workflow: source/brief → script and creative direction → approved script → actual Nano audio and ElevenLabs word timings → visual/shot/sound authoring → native v1 manifest. The two manual pause/resume handoffs are transport boundaries, not a replacement for the original production process; do not invent an independent three-stage authoring engine.
- Prompt must include actual project ID, approved script, topic/audience/purpose, ratio, duration target, language, selected style, current verified audio duration/hash, actual word/caption timings when relevant, inventory of existing assets and missing media. Never fabricate media/timestamps or substitute Mode A instructions.
- Store immutable task ID/revision, input hashes, selected exact source/reference snapshots and prompt text under .studio/. Copy, export, and reload return identical frozen bytes. Rebuild creates a new revision and makes old output stale. A task's reported status must reflect true persisted reservation state; replace fake FROZEN badge.
- A narrow outer return envelope may carry project/task/revision/input hash for import safety; native project.json MUST NOT contain this wrapper. State the expected response JSON schema and original native v1 constraints in the prompt. Export code must be deterministic.

### FIX-02 — Complete import/manifest promotion and real creative UI projection (R2-02, R2-03)

- Harden strict JSON input: bounded bytes/depth, correctly nested duplicate keys including escaped forms, forbidden pollution keys, stage + output schema, identity/source hash/revision/style/project binding, unknown fields, path traversal and executable payloads.
- Explicit **Stage → Validate → Diff → Confirm**. Stage is non-destructive, persisted across restart, and associated with exact frozen task. No cross-project, stale/replayed or superseded result may overwrite current data.
- Approved script revisions are persisted and displayed/edited in Script Workspace. Changes must be approved/revisioned; only the approved exact script is fed to TTS. Remove six hardcoded sections from real-project production mode, keep clearly labeled demo only when no native project is opened.
- Authored shot ledger and original project.json payload must be correlated to the actual voice/words and imported assets, and shown in Storyboard/Editor. No six hardcoded shots/timeline for real projects. Import image/SFX by real shot/layer ID with content hash and validated project-relative path.
- For native manifest: strip ONLY outer transport metadata; write a project-local sibling candidate, preserve native B1–B4 version/style/voice/captions/layer grammar, verify media paths and all mandatory fields, run original CLI validate on candidate only when prerequisites exist; if assets absent show WAITING_FOR_MEDIA, never "native PASS". After explicit Diff+Confirm, backup and atomically promote without destroying the last valid project manifest. Reconcile failed interrupted promotion after restart.
- Preserve approved narration and alignment metadata in Studio sidecars, never add fields to original project.json. On script/audio/shot changes invalidate downstream prompt snapshots, alignment if audio/transcript changed, and sample approval via original CLI's real fingerprint rules. Partial scoped repair must touch only selected failed section/shot/field.

### FIX-03 — VoiceStudio Nano: settings cleanup, correct API, safe publication (R2-04..08, R2-15)

- Settings: **DELETE the "Contract" label/Input and its hardcoded youtube-studio-nano-api-v1**. No replacement Contract field, contract picker, compatibility mode, or elaborate version negotiation. Keep only relevant Nano base URL, connection/readiness status, installed profile selection and practical diagnostics.
- Set default Nano base URL to **http://127.0.0.1:3901**. Persist ONE shared connection value accessible in Settings and Voice & Captions; they must not silently diverge after navigation/restart. Restrict endpoint to approved loopback http only; validate host and safe ports/path, no SSRF redirection.
- Read GET /health for liveness and GET /lite/readiness for real readiness. Check response fields rather than HTTP 200; query GET /profiles (and selected profile) to show valid voice IDs and confirmed consent, plus profile integrity as supported. Do not use "default" voice unless a real profile by that ID exists; never silently substitute OS TTS/OmniVoice.
- POST /v1/audio/speech using actual branch's API parameters. Validate input length, selected voice, language/speed and pause support using producer-provided capabilities where needed for correct operation (these are normal API checks, **not UI contract configuration**).
- Use the correct response headers **X-TTS-Execution-Receipt** and **X-TTS-Execution-Proof**, parse bounded unpadded base64url canonical receipt, verify proof and receipt context/voice/binding/input/WAV hash/native frame metadata; account for X-Lite-Audio-S, X-Lite-Speech-S, X-Lite-Pause-S and chunk/span counts where appropriate. Verify returned WAV structure/audio length safely before publishing. A missing/invalid receipt or truncated audio is FAIL, not a success without receipt.
- Stage to unique temporary file, verify, then atomically publish accepted narration and sidecar receipts; never overwrite previous valid narration, native voice path or alignment on a failed request. Successful different WAV invalidates dependent alignment and previews before new authoring. No lost approved audio through a partial failure.
- **Long-form:** Producer branch feat/chatterbox-turbo-provider already ships lite/chatterbox_assembly.py with --manifest/--output/--resume, section IDs and job-v3 exact-byte resume receipts. Use/adapt to that EXISTING owner-installed assembler via a narrowly configured adapter (or another documented source-owned route), do NOT implement a second TTS generator/assembler in Studio. Report truthful NOT_CONFIGURED with fix instructions if owner's local producer runtime/module path is unavailable; allow WAV import without pretending integration succeeded. Never silently retry possible-admission/499/504/transport errors; 422 and proven 429 are nonadmission. Owner action required for uncertain retry.
- Producer source is authoritative and can evolve: verify currently pinned branch at repair time. Its current native segmentation is sentence-aware target **320**, hard **600** characters, max API request 4096. Do not hardcode stale 520 target or implement a competing splitter.

### FIX-04 — ElevenLabs actual forced alignment and privacy (R2-14)

- Official endpoint POST https://api.elevenlabs.io/v1/forced-alignment, multipart file=FINAL actual Nano WAV and text=EXACT approved spoken transcript, with authorizing user action explaining audio upload and potential cost. Strip valid authoring [pause ...] markers from alignment text; do not strip legitimate speech or fabricate missing words.
- Move API key handling to main-process configuration/environment or appropriate secure OS-backed owner setting. **Never store or process the plaintext ElevenLabs key as React component state, export it through preload, put it in project files or logs, or forward it in a renderer-supplied arbitrary HTTP request.** No LLM, transcription, or ElevenLabs TTS fallback.
- Validate that final WAV SHA-256 matches current approved narration bytes and transcript hash matches approved script; require explicit re-alignment after changes. Parse and validate response words/characters/loss; finite start/end, monotonic order, bounded by WAV duration, plausible word coverage and transcript token sequence, highlight uncertain/unmatched words (no invented accuracy thresholds), reject missing/truncated alignment. Actual speech mismatch must block publication for user review.
- Convert only validated ElevenLabs words {text,start,end,loss?} to original native {words:[{word,start,end}]} and invoke existing autopilot.mjs captions [--lead ...] using true WAV alignment. Human review groups captions semantically under selected B-style policy; no guessed WPM/character timings, no automatic "captions PASS" from response nonempty.
- Persist raw provider response safely only if necessary and protected; keep audio+script+alignment hashes and provenance in .studio, not native manifest. Allow importing existing valid aligned words while offline.

### FIX-05 — Original native project/preview/approval/render wiring and recovery (R2-09..13)

- Preserve the original native CLI unchanged. Main-process fixed command/flag allowlist: doctor/probe/init/captions/validate/preview/approve/render. Child spawn shell:false, fixed Skill script, bounded stdout/stderr, timeout/cancel and per-project mutation locks; correctly manage Windows child process tree and consistent recoverable status.
- Validate requested project and root through project ID/opaque trusted handle registered via dialog/open/create; do NOT trust free-form project root supplied by renderer. Verify canonical parent and every existing ancestor to prevent symlink/junction escape; reject UNC/remote/network project roots and out-of-project real paths. Restrict import file types and magic bytes/size; block executable/code and arbitrary paths. Secure studio-media scheme resolves only registered project media and necessary output paths. No shell interpolation/remote URL injection.
- Expose native validate scope and **real preview only after original native command PASS plus actual output/preview.mp4, report, codec/FFprobe/decode, source fingerprint and SHA proof are inspected**. Present actual MP4, audio and contact sheet in preview UI. No fake green badges on mere command exit 0.
- REMOVE unconditional --replace from NativePreviewPanel. Existing sample requires explicit owner confirmation to replace; handle unchanged sample reuse and preserve native cache.
- Before clicking Approve, user must be shown the current verified MP4 and explicitly attest picture/sound review, enter nonempty note and authorize full production. UI cannot prove someone listened; do not pretend. Re-query the original native approval output/fingerprint before displaying APPROVED; stale sidecar fields never confer approval. Changing sample content/voice/captions/global settings must re-gate; changing only later non-sample shots uses original native scope semantics.
- Full render invokes original CLI only when actual prerequisites + original approval permit. After exit 0 verify film.mp4 decode, .srt/.vtt/report/checkpoint and current project identity; show real per-stage statuses and truthful files, not mark every row DONE because the command returned. Preserve native shot cache and resume behavior.
- Persist job lifecycle STARTED/RUNNING/SUCCEEDED/FAILED/INTERRUPTED/UNKNOWN with scoped operation IDs; single active mutating job per project, cancellation and restart reconciliation. Do not resubmit uncertain audio requests automatically. Inspector edits either map to actual native layer/key properties through validated diff/promotion or stay marked READ-ONLY/DEMO.
- Real-project Editor timeline/Storyboard must project current native shot count/duration/identity, not R1's immutable fixture "Why We Procrastinate" scenes. Demo mode remains visibly separate.

### FIX-06 — R2 acceptance: evidence must exercise real pipeline (R2-16)

Targeted tests in studio/ only; no need to add an excessive fixture explosion. Improve existing MainServices/Playwright suites and Windows script:

1. Exact core-tree equality: git diff --name-status BASE_MAIN...HEAD -- skills/directing-stickman-videos/ must be EMPTY; also check worktree and untracked. Report exact HEAD and BASE SHA, not only dirty working tree.
2. Prompt content snapshot contains actual selected B style & Skill content and approved source; task frozen across restart; stage identity/revision/hashes and duplicate/escaped-key/security malformed JSON rejected without mutation; repair only targeted section/shot.
3. Create/open/close/restart genuine native 9:16 B1 and one other selected B style via original init; test UI project state persists and demo content does not leak into production.
4. Nano **mock HTTP integration**, not source-string matches: GET readiness/real profile, generated WAV + correct header receipt/proof/context/frames; wrong receipt, wrong voice, truncated WAV, 422/429/504/lost connection, repeated request and accepted-audio preservation. Test long-form resume against source-owned assembler with mock responses or mark exact tested scope.
5. ElevenLabs **mock HTTP integration**: exact uploaded final WAV + exact approved transcript, secret stays main-only, full word coverage/timing/loss checks, native captions conversion; stale WAV/transcript invalidation and explicit cloud authorization.
6. Native actual-CLI **offline fixture end-to-end**, with real already-local generated test audio/artwork (no paid provider call): project manifest candidate → original native validate → actual 20s preview.mp4 + decode/reports/SRT/VTT → explicit owner-approved fixture note (test fixture only, never simulate real user's consent) → original full render film.mp4 + report + cache reuse. If no native runtime dependency, provision in an isolated temp copy using its existing package-lock and npm ci; if environment cannot run, mark NOT_RUN not PASS.
7. Test UI sample replacement requires confirmation, human review approval action, stale approval after mutation, new project media scheme security, and job collision/cancel/restart consistency.
8. Electron dev/prod smoke on owner Windows, 5174 unchanged; report historical R1 deferred only when demonstrably same issue. Browser tests must not be cited as real IPC/backend proof if they use page.addInitScript mock.
9. Update studio/scripts/windows-r2-acceptance.ps1 to run these deterministically (offline), emit per-gate PASS/FAIL/NOT_RUN plus reason and evidence hash, logs, native media/report metadata, screenshots, final ZIP. Never include credentials or private voices in evidence. No live ElevenLabs charge or real Nano GPU claim from mocks.
10. Separate **CODE_VERIFIED**, **OFFLINE_NATIVE_VERIFIED**, **NANO_OWNER_HARDWARE_NOT_RUN/PASS** and **ELEVENLABS_LIVE_NOT_RUN/PASS**. An end-to-end app verdict cannot be PASS if the mandatory offline-native gate failed/not run; service-live tests remain optional opt-in with transparent status.

## 3. Repair order / atomic delivery

ONE CODEX IMPLEMENTATION ROUND; execute in the following dependency order without asking for another planning round:
1) FIX-01 + FIX-02 — frozen Skill-grounded ChatGPT prompts, validated return and real project projection/manifest promotion.
2) FIX-03 + FIX-04 — correct shared Nano API/long-form ownership, ElevenLabs exact audio alignment and remove Voice Settings Contract.
3) FIX-05 — real native UI and secure lifecycle.
4) FIX-06 — sufficient integration/Windows end-to-end acceptance.
Then run locally available checks, repair within this SAME round, commit, push and update the existing Draft PR #2. Do not merge.

Do not report repaired status merely because a new test string or placeholder appears in source. Every fix must be demonstrated by a behavioral test or genuine native output when relevant.

## 4. Deliverables / gates

- Production code ONLY in studio/** and small supporting docs outside skills/**; original Core unchanged.
- VoiceStudio Settings contains ONE shared localhost URL default 3901 + actual readiness and voice profiles; **NO CONTRACT field at all**. No need for API-version selector or generic version negotiation.
- Two manual ChatGPT pause/resume prompts carry actual original Mode B Skill/style guidance and real source; script approval and actual audio-first visual timing retained.
- Audio actually generated through the selected Nano producer/its existing long-form assembler or an approved imported WAV; correct receipt/proof/format and no premature overwrite.
- ElevenLabs Forced Alignment exactly tied to final approved WAV + text, secure opt-in, genuine verified words to original captions CLI.
- Real native v1 project.json candidate, asset mapping, offline full native QA, true preview/sample approval/full-film export with reuse.
- No stale approval/fake PASS, no arbitrary renderer-controlled file root, no silent --replace, no core changes.
- Acceptance script + logs/ZIP carrying exact HEAD and honest NOT_RUN status.
- Only update Draft PR #2 on feat/r2-external-native-workflow; **no merge**.

## 5. Codex execution & final reporting requirements

Start by fetching current PR HEAD and rereading this file AND the controlling R2 plan. Verify branch/main refs. Implement all FIX-01–FIX-06. Run/install existing tests where possible (typecheck, lint, Vitest, Playwright browser, Electron, original native core, offline native acceptance). Do not require GitHub Actions. Push a self-contained repair commit(s), keep PR Draft. If owner-specific services are unavailable, produce command-by-command Windows owner acceptance procedure and mark live checks NOT_RUN, never fake evidence.

Final message (exact fields):

~~~
R2 PR #2 COMPLETE REPAIR REPORT
BASE_MAIN_SHA:
START_HEAD_SHA:
FINAL_HEAD_SHA:
BRANCH / PR:
FIX-01 (prompt source/freeze):
FIX-02 (import/manifest/real UI):
FIX-03 (Nano + Settings Contract removed):
FIX-04 (ElevenLabs):
FIX-05 (native preview/approval/render/security/jobs):
FIX-06 (acceptance/evidence):
CORE_CHANGED_FILES: 0 / FAIL
VOICE_SETTINGS_CONTRACT_FIELD: ABSENT / FAIL
NANO_DEFAULT_ENDPOINT: http://127.0.0.1:3901
TESTS (install/typecheck/lint/unit/integration/browser/electron/native-core/offline-native):
ACTUAL PREVIEW MP4, FILE SHA, REPORT, SRT/VTT:
ACTUAL FINAL MP4, FILE SHA, REPORT:
NANO REAL GTX1650: PASS / FAIL / NOT_RUN
ELEVENLABS LIVE: PASS / FAIL / NOT_RUN
EVIDENCE ZIP PATH:
P0/P1 REMAINING:
R1 HISTORIC ELECTRON STATUS:
FINAL VERDICT: PASS / PARTIAL / FAIL
~~~

**Do not mark PASS for an item that is not verified in the current revision.**
