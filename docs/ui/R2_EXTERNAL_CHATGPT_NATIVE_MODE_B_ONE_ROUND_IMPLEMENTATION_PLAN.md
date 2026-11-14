# R2 — External ChatGPT + Native Mode B Workflow
## One-round Codex implementation plan

**Repository:** plthien/stickman-video-studio  
**Implementation branch:** feat/r2-external-native-workflow (created from merged main at 5871fd06657c014baeeb3efe405611e61cd496c9)  
**UI baseline:** docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html (LOCKED)  
**Scope:** Windows-local Electron + React + TypeScript. No paid LLM API. R2 implements external authoring handoff, project/media management, original Mode B CLI, real preview/human approval/full render.  
**Execution:** ONE implementation round. Implement, test, repair, commit and push. Keep PR Draft; do not merge.  
**R1 exception:** Owner explicitly deferred the existing Electron Dev/Production smoke-test failures associated with test process cleanup/timeout. Do not silently mark them PASS or spend the R2 round rewriting R1 smoke infrastructure. R2-specific CLI/IPC tests must still run and pass.

## 0. Confirmed native contract (read source before coding)

Primary references:

- skills/directing-stickman-videos/SKILL.md
- skills/directing-stickman-videos/references/mode-execution-boundaries.md
- skills/directing-stickman-videos/references/autopilot.md
- skills/directing-stickman-videos/references/autopilot-runtime.md
- skills/directing-stickman-videos/references/autopilot-production-qa.md
- selected B1/B2/B3/B4 style references
- skills/directing-stickman-videos/scripts/autopilot.mjs
- skills/directing-stickman-videos/scripts/autopilot-core.mjs
- skills/directing-stickman-videos/scripts/autopilot-render.mjs
- skills/directing-stickman-videos/examples/b1/project.json

The original CLI is the **only** B1–B4 validator and renderer. Its commands:

~~~
node scripts/autopilot.mjs doctor
node scripts/autopilot.mjs init DIR --style B1|B2|B3|B4
node scripts/autopilot.mjs probe AUDIO
node scripts/autopilot.mjs captions WORDS.json OUTPUT.json [--lead N]
node scripts/autopilot.mjs validate PROJECT [--seconds N]
node scripts/autopilot.mjs preview PROJECT [--seconds N] [--replace]
node scripts/autopilot.mjs approve PROJECT --note "Real user approval"
node scripts/autopilot.mjs render PROJECT [--replace]
~~~

Notes verified against current code:

- Native project.json remains version: 1, style B1–B4, width/height/fps, voice, captions, shots, SFX and style-specific options. **Do not put UI task metadata or a new timeline language inside it.**
- CLI init creates a 1280×720 scaffold even if UI requests 9:16. After init, the app may transactionally set even portrait dimensions (e.g. 1080×1920) in the *project-local native manifest*, keeping every other generated native field and style constraint. Video length is governed by the imported narration's real duration + allowed lead/tail; UI target duration is a planning target, not permission to stretch voice.
- A 20-second preview can validate only the opening. Preview scope is capped at 60s. The rest of the film must be complete for full render; B4 has additional opening/voice/audio/asset gates.
- Native outputs are project-local output/preview.mp4, output/preview-report.json, output/preview.srt/vtt, contact sheet, output/approval.json, output/film.mp4, output/film.srt/vtt, film-report.json, cache and checkpoint.
- Native approve verifies the exact encoded sample bytes, fingerprint and approved settings. Never forge approval.json, report JSON, fingerprints, or visually mark “approved” from a UI flag. The **actual encoded MP4** must be reviewed by a human before a real approve call.
- B5 is a **separate code-authored path**; do not run it through the B1–B4 manifest flow, execute LLM-returned scripts, or silently relabel it as B1.

## 1. Non-negotiable scope and security

1. Branch from merged main. Never alter locked V3 mockup, the B1–B5 approved style materials, native CLI/renderer/cache/QA, or the six previously owner-authorized Windows portability fixes. Run git diff main...HEAD -- skills/directing-stickman-videos/ and require empty output for R2.
2. Production code in studio/ with existing page/component/feature architecture retained. Reuse R1 UI; wire real state and actions instead of redesigning. No monolithic TSX/service file. Keep Vite dev port **5174**.
3. Do not call OpenAI/DeepSeek/other LLM APIs, automate the ChatGPT browser, or ship secrets into exported prompts. External ChatGPT = copy/export prompt → user manually runs it in ChatGPT Web → paste/import JSON. No remote provider HTTP work in R2.
4. Electron renderer is untrusted. No Node, fs, shell, arbitrary URLs or unrestricted IPC in React. Main-process IPC has typed allowlist and validated DTOs; contextIsolation/sandbox/nodeIntegration settings remain secure.
5. Select project paths through native system dialog; internally use opaque project IDs, not arbitrary renderer-controlled filesystem paths. All import/read/write paths must be canonicalized, confined to the selected project and reviewed allowed external inputs, reject traversal, symlinks/junction escapes, UNC/URL injection, executable files and unapproved overwrite. Avoid unsafe zip extraction.
6. Spawn native commands with executable Node + argv array, shell:false, fixed CLI path and command/flag allowlist; no cmd/powershell interpolation. Capture JSON/stdout/stderr boundedly with safe logs, timeout/cancellation, job state, Windows child process lifecycle and exclusive per-project mutating commands. Do not block Electron main thread.
7. R2 neither implements Nano or G-Labs nor guesses their API. Import already-created local narration and images. R3 owns voice/image generation. Missing media means WAITING_FOR_MEDIA, never a fake success.
8. Use truthful states: scaffold ≠ valid project, JSON syntax valid ≠ accepted artifact, painted UI preview ≠ encoded preview, validate PASS ≠ human approval, render launched ≠ finished MP4.
9. Explicit human input is required before native sample approval. Do not auto-approve after validation or preview and do not silently use --replace.

## 2. R2 work packages (all in one implementation round)

### WP-A — Projects + secure main/preload bridge

- Wire Project Setup “Create/Open/Save” to local filesystem. Choose parent folder via dialog and create a unique project directory **outside the Skill** using the original CLI init with explicit style. Open an existing native project.json without rewriting it. Reject B5 in this flow.
- Store editable UI brief/title/target duration/language and non-native data under a small project-local studio sidecar directory (e.g. .studio/state.json, .studio/external/, .studio/revisions/). Keep versioned, atomic writes (temporary sibling → rename) and a recoverable import checkpoint. No database server or SQLite required for R2.
- Handle portrait project dimensions via safe native manifest patch after init. UI reflects the real manifest style, actual media readiness, ratio, duration and disk path; remove hardcoded demo project ID from production paths/prompts.
- Implement typed, narrow IPC: pick/create/open project; read current project/sidecars; attach local audio/image/word timestamps; create/load prompts; validate/import candidate; run approved CLI operation; subscribe/unsubscribe to job updates; read permitted output media; open permitted result directory. Return stable error codes and diagnostic details, not raw stack traces or secrets.
- Guard project switching while a job runs; single active writing job per project, no concurrent preview/approve/render race. App restart loads the most recent manifest and reconciles output/checkpoint rather than inferring success from previous UI state.

### WP-B — External ChatGPT authoring handoff

- Preserve existing External ChatGPT page, Script and Storyboard pages. Implement an explicit handoff for **Script → Shot Plan → Native Manifest (B1–B4)**. Optionally provide a Captions/Words import helper, but do not invent voice alignment or word timestamps.
- Each Build Prompt creates a **persistent reservation** with immutable: task ID / artifact ID, project ID, stage, revision, selected B style/ratio, source snapshot hashes, approved upstream artifact hashes, native contract version and exact prompt text. Show prompt versions. Copy/Export must use the exact frozen prompt (not recompute it on tab switch). Rebuild warns that older reservations become stale; raw drafts may be retained for comparison.
- Prompt packages include the user's actual source/brief, correct B-style reference and applicable native runtime rules, approved script/shot context, available media ledger (relative filename + hash + dimensions/duration), narration timing and actual aligned captions if available. No references to unrelated A-style prompt contracts. Never invent known media/word timestamps.
- Define small, documented **authoring sidecar schemas** for Script and Shot Plan, with stable section/shot IDs and source traceability. These are intermediate planning artifacts only, not an alternate native animation grammar.
- The Native Manifest task must return a **version:1 B1–B4 project.json payload in the original native fields** (with any required task/identity binding kept in the outer import envelope and project-local sidecar, never written to project.json). Require explicit shot timing, local asset references, layer types/keys/motion and real captions as supported by native. Do not treat a high-level prose storyboard as renderable JSON.
- User can paste UTF-8 JSON or select a .json file. Strict max byte size, max depth, reject duplicate object keys (JSON.parse alone is insufficient), nonobject root, unknown stage, wrong project/task/artifact/revision/style/source hashes, replay, stale reservation, unsupported properties, executable/code payload and unexpected external paths. Preserve structured errors with JSON paths and repairable messages.
- Implement **Validate/Dry run → Diff → Confirm Import**. Parser/schema/contract failures do not modify project files. On successful import, stage new artifacts in sidecars. For native manifest promotion, create a sibling candidate file **inside the project directory** (so relative media paths resolve exactly as native), validate its structural and media reference policy, call original native validate when prerequisites exist, then atomically back up and promote only after explicit user confirmation. Mark incomplete candidate WAITING_FOR_MEDIA instead of claiming native VALID or overwriting the working manifest.
- Scoped Repair regenerates a prompt for exactly failed fields/shot IDs, binds to the approved upstream revision and preserves other accepted sections/shots. Older or superseded output must never overwrite newer data. On change, invalidate affected downstream task reservations and native sample approval through the original native fingerprint rules; never manually forge the approval state.
- Persist all task reservations/import decisions/revisions across app restart and expose recovery/status in UI. Idempotent re-import of identical completed task should return existing result without duplicate mutation.

### WP-C — Import genuine local media and captions

- Voice & Captions page: select/import local narration (WAV; optionally existing common FFprobe-supported audio formats), copy to a project-owned safe relative path, compute SHA-256, execute the native probe command and display real codec/duration. No resampling/stretching or fake waveform playback. User can preview the **actual file** when supported.
- Accept aligned WORDS.json of {words:[{start,end,word}]} originating from real alignment, inspect ordering/time bounds, call native captions WORDS OUTPUT [--lead N], and stage/merge generated native caption cues. Also allow manual native caption JSON edits with timestamp validation; do not synthesize time alignment from text alone. Native B1–B4 one-line caption policy remains authoritative.
- Storyboard & Images: select/import local PNG/JPEG and optional referenced rights-cleared SFX/ambience files; verify content signatures, size/dimensions, source rights note/hash, map by stable shot/layer ID, and report missing images and image-dimension/ratio problems. This is asset import, not image generation.
- Never silently change native caption/voice metadata, override selected B4 Brian identity or insert B1 pose atlas into B2/B3/B4. B4 alternate voice requires explicit user_override and B4 opening/audio QA still applies.
- Missing actual voice, aligned captions or images must block the corresponding native preview/render action with actionable details. Do not generate silent audio, dummy captions, fake art, or unapproved fallback assets.

### WP-D — Native runtime + Video Editor/Approval/Render wiring

- Main-process ModeBCLI service supports exactly doctor/probe/init/captions/validate/preview/approve/render, resolves the CLI from the installed repo rather than copying/rewriting it, uses cwd of the original Skill, passes args and allowed env deterministically, persists job events and error codes, captures report/CLI stdout safely. Do not run B5's code path.
- After media readiness, Native Validate supports scoped “--seconds N” and full-film; report true native errors/warnings. Native Preview calls the original preview at a chosen 1–60s scope (default 20s), consumes output/preview-report.json and video **only after checking file existence, decode/probe, expected project, fingerprint and SHA-256**. Show the **actual video** in the Editor, using a safe read-only project-owned media URL/stream registered in Electron main; never use a fake CSS character as “real preview”. Support standard playback/seek on real MP4, caption review and QA report; keep the draft illustration clearly labeled separately.
- Approval panel stays disabled until a real current preview exists and is reviewed. Human must explicitly inspect picture/audio and enter a nonempty approval note. UI calls **original approve PROJECT --note**, then reads original output/approval.json. Changing sample audio/images/shots/settings makes original gate fail; UI must reflect the new invalid/stale state, not retain “Approved”.
- Render & Export page calls original render after approved preview and full native validation with complete late shots/media. Stream native job logs/progress, show busy/cancel/retry with truthful states; respect existing cache/lock/checkpoint and only ask for --replace after clear confirmation. Display verified output/film.mp4, .srt, .vtt, film-report.json and cache_hits.
- Editors must not write unsupported synthetic values into the native manifest. Any Inspector edits in R2 need an explicit mapping to actual supported native layer/key properties, revision/diff review, validation and dirty/fingerprint invalidation. Fields not safely mapped remain demo/read-only, never pretend changes are persisted.
- Keep the six-track 9:16 Editor fit-to-viewport layout and approved V3 UI, including its split Edit / Native Preview / Approval modes. Use real project duration in production mode, not the 30-second demo timeline model. A preview only covers its scoped duration; do not misrepresent incomplete later sections as previewed/approved.
- On restart, reconcile sidecars and native output facts. Never call an unverified stale job PASS; report INTERRUPTED/RECOVERABLE and allow user-driven rerun with original CLI caching.

### WP-E — Windows local tests, security and evidence

Use deterministic small local fixtures; no paid API or network dependency. Continue to reuse existing R1 CSS/components, adding only R2 services/hooks/views/tests.

**C0 critical automated cases:**

1. Create B1 9:16 project via original init, confirm actual project.json version/style/dimensions and project outside Skill; open/reopen maintains state.
2. Freeze/export task prompt; identical prompt on reload; rebuild invalidates old task; task ID/source/project/stage/revision mismatch or replay rejected.
3. Duplicate JSON key, oversized/deep JSON, unknown fields, prototype-pollution key, traversal/UNC/symlink/junction, unsupported B5/code payload rejected without file changes.
4. Script → Shot Plan → native manifest import; diff and explicit confirm; failed candidate leaves original manifest and approvals unchanged.
5. Import local audio/image + aligned words, native probe/captions and scoped validate; missing media reports WAITING_FOR_MEDIA.
6. Using a **genuine local fixture**, native preview produces an actual MP4 + report/SRT/VTT/contact sheet; app can play it without treating the draft frame as encoded output.
7. Approve only after explicit human action and note; original native approve invoked. Changed sample media/shot/voice blocks stale approval and render.
8. Native full render only with required media/shot coverage + valid approval, output MP4/report verified; retain cache and verify unrelated shot cache reuse after a scoped change.
9. App restart during/recovery after job: no duplicate conflicting render, checkpoint status reconciled; cancellation does not mark outputs successful.
10. No change to Native Core or approved V3 reference. No API calls, no secrets leaked to renderer, no shell injection or unexpected filesystem writes.

**C1 supporting tests:**

- IPC contract/arg allowlist, job event cleanup/cancel and Windows path/case handling.
- Reservation/revision/diff/scoped repair, JSON parser edge cases, atomic transaction rollback/recovery.
- 9:16 Editor playback/timeline responsive at 1280×720 and 1656×790, all six tracks visible.
- File/protocol range-serve local MP4 safely, stale media URL and cross-project requests denied.
- B2/B3 conditional schema/style validation and B4 explicit voice/visual/audio gates; B5 remains separate blocked.
- Renderer dev remains on port 5174; no new R1 Electron startup regressions.

Create studio/scripts/windows-r2-acceptance.ps1 producing r2-local-results/results.json, logs, project fixture/report metadata, screenshots/video metadata, and ZIP. Test typecheck, lint, Vitest, build, Playwright browser plus deterministic node/integration CLI tests and original native core tests. Keep fixtures/resources small and use isolated temporary project directories. No GitHub Actions requirement.

**Historical deferred R1 gate:** Electron graphical Dev/Production smoke had FAIL at R1 merge. Record it as KNOWN_DEFERRED_R1 when it remains the *same isolated problem*, not PASS and not a fresh R2 regression. Do not block delivery of R2's independently verified CLI/IPC functionality solely on that previously waived gate. Any **new** Electron security, project-dialog, native media or R2 IPC failure is a genuine R2 FAIL and must be fixed; report whether end-to-end GUI was actually exercised.

## 3. Proposed component/service boundaries

Keep the existing pages. Add only as needed, for example:

~~~
studio/src/
  main/
    ipc/
      projectHandlers.ts
      externalHandlers.ts
      nativeHandlers.ts
      mediaHandlers.ts
    services/
      projectStore.ts           # folder lifecycle + project/sidecar revisions
      externalTasks.ts          # frozen tasks, prompt/import/diff/scoped repair
      strictJson.ts             # bounded parsing, duplicate key rejection
      nativeManifest.ts         # native v1 validation + atomic promotion
      mediaImport.ts            # local audio/image/caption/file checks
      modeBCLI.ts              # spawn original CLI, allowlist, stdout/report
      nativeJobs.ts             # durable progress/cancel/reconcile
      secureMedia.ts            # read-only project-owned encoded media
  preload/
    index.cts                   # extend typed contextBridge only
  renderer/
    features/
      project/                  # real create/open/readiness
      external/                 # frozen task prompt/JSON validate/diff/import
      script/                   # approved script revisions
      voice/                    # import & probe / actual captions
      storyboard/               # asset attachment & shot ledger
      editor/                   # real preview, approval, native timeline projection
      render/                   # native progress/report/export
    types/
      ipc.ts                    # typed request/response events
studio/tests/
  unit/
  integration/
  ui/
studio/scripts/windows-r2-acceptance.ps1
~~~

No server framework, no separate React app, no database migration, no extra video engine. No assumption that demo R1 state is authoritative; replace demo fixture data with a real project projection when a project is opened, with a clearly separate Demo mode when not.

## 4. Completion / delivery

One round only: refresh merged main before editing; implement WP-A to WP-E, run available local checks, self-repair, commit and push to feat/r2-external-native-workflow; open/update **Draft PR #2** targeting main (do not merge). If PR #2 number is occupied, use the actual next PR number and report it rather than assuming.

**Definition of done:**

- A real 9:16 project can be created/opened without rewriting Native Core.
- User can generate immutable project-specific prompts, use ChatGPT Web manually, import real strict-validated Script/Shot Plan/Native Manifest artifacts and attach actual local media/alignment.
- Native scoped preview, explicit human approval and full render work through the original CLI; video, sidecars, QA and cache are the real native artifacts.
- Stale/duplicate/replayed JSON, unsafe paths, missing assets and changed preview are rejected safely with recoverable errors.
- 9-page V3 UI and 5174 dev settings remain intact; tests/evidence are honest about the previously deferred R1 Electron smoke.
- No fake PASS, no new mode/manifest/render engine, no Nano/G-Labs API calls.

Final report:

~~~
R2 IMPLEMENTATION REPORT
BASE_MAIN_SHA:
BRANCH / HEAD / DRAFT_PR:
WP-A Projects+IPC:
WP-B External tasks:
WP-C Local media/captions:
WP-D Native preview/approval/render:
WP-E Tests/evidence:
C0 / C1 PASS-FAIL-NOT_RUN:
Electron R1 deferred status:
Core diff:
Actual sample MP4/SRT/VTT/report evidence:
Known blockers:
R2 VERDICT: PASS / PARTIAL / FAIL
~~~
