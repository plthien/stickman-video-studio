# R2 — Original Mode B Core + Manual External ChatGPT Web + Nano TTS + ElevenLabs Forced Alignment
## One-round Codex implementation plan

**Repository:** plthien/stickman-video-studio  
**Implementation branch:** feat/r2-external-native-workflow (created from merged main at 5871fd06657c014baeeb3efe405611e61cd496c9)  
**UI baseline:** docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html (LOCKED)  
**Scope:** Preserve the original Mode B creative and native production workflow byte-for-byte. Only replace the AI coding agent's authoring interface with manually copied/exported External ChatGPT Web tasks. Use the owner-selected local Chatterbox Nano TTS service and ElevenLabs Forced Alignment for real voice and word times. No LLM API.  
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

## 0A. Owner-authorized architecture correction — takes precedence

THIS IS NOT A CORE REWRITE. The original Mode B Skill is the AI coding agent's existing production contract. Preserve all files under skills/directing-stickman-videos/**, all creative/style/QA/sound rules, B1–B4 native manifest grammar, unchanged preview/approve/render CLI and cache. The only substituted capability is how the agent performs creative planning: a user manually carries a complete, Skill-grounded prompt to ChatGPT Web and returns the structured response. Do not invent a new Script→Shot Plan→Manifest 3-protocol engine or a parallel creative pipeline.

Source responsibility → R2 handoff:
- Agent script/research/creative-direction → manual ChatGPT Web authoring, using the existing SKILL.md, autopilot, selected B-style instructions and prior approved project material.
- Agent voice synthesis → VoiceStudio-GGUF-Lite branch feat/chatterbox-turbo-provider: local Chatterbox Nano at http://127.0.0.1:3901, normative docs/integrations/youtube-studio-nano-api-v1.md, contract nano_lite_api_v1.
- Agent voice word alignment → ElevenLabs POST https://api.elevenlabs.io/v1/forced-alignment with final WAV + exact spoken transcript, user-authorized.
- Agent caption grouping → original autopilot.mjs captions on verified {words:[{start,end,word}]} + human semantic caption review.
- Agent scene/shot/layer authoring → manual ChatGPT Web handoff AFTER actual narration/word times are available; native project.json remains original v1 without wrapper metadata.
- Agent video validation/preview/approval/render → original CLI unchanged.
- Image creation → import real local images in R2; G-Labs automation may be added in R3 ONLY outside core.

IMPORTANT: Task ID/artifact ID/hash/revision is a minimal Studio-side import/transport envelope, not part of native project.json or a new video-creation stage. Original user approval of the creative script and actual approximately 20-second MP4 sample remain intact. Do not automatically approve.

Nano: GET /health is liveness, GET /lite/readiness is separate. Verify model/capabilities, consent=confirmed, profile integrity binding, actual 24kHz mono PCM16 WAV, execution receipt/proof/frame counts and long-form resume. Use the producer's native segmentation target 520/hard 600 chars (API max 4096) and existing longform assembler rather than building a new voice engine. 422/proven 429 are definite nonadmission; transport loss/499/504 are uncertain, no blind retry. No fallback to OmniVoice, OS TTS, Gemini or ElevenLabs TTS.

ElevenLabs: POST /v1/forced-alignment, multipart file=FINAL actual Nano WAV, text=exact spoken transcript without pause control tags, xi-api-key securely stored only on the Electron main side. API response words use {text,start,end,loss?}; validate ordering, timing bounds, transcript coverage and missing phrases; map exact word.text to native word in {words:[{start,end,word}]} for original CLI captions. No estimated timings, no Speech-to-Text substitution, no auto-charge. Keep audio hash and aligned transcript binding; changes invalidate alignment. Disclose audio upload/cost and require explicit consent. Manual import of existing verified WAV/word timings remains available.

## 1. Non-negotiable scope and security

1. Branch from merged main. Never alter locked V3 mockup, the B1–B5 approved style materials, native CLI/renderer/cache/QA, or the six previously owner-authorized Windows portability fixes. Run git diff main...HEAD -- skills/directing-stickman-videos/ and require empty output for R2.
2. Production code in studio/ with existing page/component/feature architecture retained. Reuse R1 UI; wire real state and actions instead of redesigning. No monolithic TSX/service file. Keep Vite dev port **5174**.
3. Do not call an LLM API or automate ChatGPT Web. External ChatGPT = user manually copies/exports prompt, obtains results on ChatGPT Web and imports JSON. Nano communication stays on localhost; the owner-authorized ElevenLabs forced-alignment upload is the ONLY cloud provider call in R2. Keep API secrets out of prompts, renderer and logs.
4. Electron renderer is untrusted. No Node, fs, shell, arbitrary URLs or unrestricted IPC in React. Main-process IPC has typed allowlist and validated DTOs; contextIsolation/sandbox/nodeIntegration settings remain secure.
5. Select project paths through native system dialog; internally use opaque project IDs, not arbitrary renderer-controlled filesystem paths. All import/read/write paths must be canonicalized, confined to the selected project and reviewed allowed external inputs, reject traversal, symlinks/junction escapes, UNC/URL injection, executable files and unapproved overwrite. Avoid unsafe zip extraction.
6. Spawn native commands with executable Node + argv array, shell:false, fixed CLI path and command/flag allowlist; no cmd/powershell interpolation. Capture JSON/stdout/stderr boundedly with safe logs, timeout/cancellation, job state, Windows child process lifecycle and exclusive per-project mutating commands. Do not block Electron main thread.
7. R2 implements the selected Nano producer adapter using its exact source contract and ElevenLabs Forced Alignment. R2 imports existing local artwork; only optional future G-Labs image generation belongs to R3. Missing real media means WAITING_FOR_MEDIA, never a fake success.
8. Use truthful states: scaffold ≠ valid project, JSON syntax valid ≠ accepted artifact, painted UI preview ≠ encoded preview, validate PASS ≠ human approval, render launched ≠ finished MP4.
9. Explicit human input is required before native sample approval. Do not auto-approve after validation or preview and do not silently use --replace.

## 2. R2 work packages (all in one implementation round)

### WP-A — Projects + secure main/preload bridge

- Wire Project Setup “Create/Open/Save” to local filesystem. Choose parent folder via dialog and create a unique project directory **outside the Skill** using the original CLI init with explicit style. Open an existing native project.json without rewriting it. Reject B5 in this flow.
- Store editable UI brief/title/target duration/language and non-native data under a small project-local studio sidecar directory (e.g. .studio/state.json, .studio/external/, .studio/revisions/). Keep versioned, atomic writes (temporary sibling → rename) and a recoverable import checkpoint. No database server or SQLite required for R2.
- Handle portrait project dimensions via safe native manifest patch after init. UI reflects the real manifest style, actual media readiness, ratio, duration and disk path; remove hardcoded demo project ID from production paths/prompts.
- Implement typed, narrow IPC: pick/create/open project; read current project/sidecars; attach local audio/image/word timestamps; create/load prompts; validate/import candidate; run approved CLI operation; subscribe/unsubscribe to job updates; read permitted output media; open permitted result directory. Return stable error codes and diagnostic details, not raw stack traces or secrets.
- Guard project switching while a job runs; single active writing job per project, no concurrent preview/approve/render race. App restart loads the most recent manifest and reconciles output/checkpoint rather than inferring success from previous UI state.

### WP-B — External ChatGPT Web manual agent handoff

- Retain the original Mode B AI agent's input and output semantics, including source/topic, target audience/purpose, selected B style, ratio, language, approved script, creative direction, shot ledger, sound script, actual narration/word times, media and native manifest. Use existing source references as the authoritative directions, not a rewritten house style or new Mode A rules.
- Build a manual copy/export prompt containing ALL required selected-source material (not only local file paths ChatGPT Web cannot access), the actual project context and source, the exact applicable B-style/QA/sound contract, approved upstream material and known available assets. No direct ChatGPT API or web automation.
- Allow a script/creative handoff before actual TTS, and a visual/shot/native-manifest handoff after verified WAV/word alignment. These are practical pause/resume points in the ORIGINAL agent workflow, not two or three new mandatory creative protocols. Scoped repair prompts may target failed sections or shots.
- Script output must preserve approved wording and narrative intent; shot output must be grounded in spoken phrases and REAL word times. Asset requirements may list images not yet generated but must never masquerade as existing local file paths. Only the original B1–B4 project.json syntax may be promoted to native project state; B5 code-authored mode stays separate and unsupported.
- Persist immutable prompt snapshot, project/source/style/ratio/approved-script/WAV/alignment hashes, task ID, revision and import status in .studio sidecars. Output JSON may have a thin transport envelope with those IDs; remove it before native project.json. No alternate animation language.
- Copy/Export frozen prompt, manual JSON paste/file upload, strict bounded JSON parsing (including duplicate keys), identity and source binding, Diff → Confirm, atomic candidate import, repeat/replay rejection, revision-aware scoped repair and crash recovery. Missing real assets cause WAITING_FOR_MEDIA, not NATIVE_VALID.

### WP-C — Nano TTS, ElevenLabs forced alignment, and imported local media

- Integrate only the selected local Nano producer branch, without modifying VoiceStudio or Mode B Core. Connect to 127.0.0.1:3901, verify nano_lite_api_v1 model/pause/speed capability, profile consent and reference integrity, and distinguish readiness from liveness.
- Generate from the exact user-approved script via /v1/audio/speech or the existing producer long-form assembly/resume route; keep section WAV proofs, verify final actual 24000Hz mono PCM16 WAV, receipt/hash/frame counts, and store provenance outside native manifest. Handle errors/uncertain POST without automatic repeat. Allow import of an existing approved WAV as a fallback, without fake success.
- ElevenLabs Forced Alignment exclusively aligns the final real WAV to the exact spoken text; require user action and consent for cloud upload and charges. Hold xi-api-key outside renderer/exports/logs. Validate response words {text,start,end,loss?}, timeline monotonicity and transcript completeness, map to original CLI words {start,end,word}; preserve WAV/script hashes, detect missing phrases.
- Call original autopilot.mjs captions WORDS.json OUTPUT.json with actual aligned words. Let the user review and repair semantic cues under original B-style single-line policies. Do not derive timestamps from WPM/character counts or ask ChatGPT to invent timings.
- Import/attach already-existing PNG/JPEG artwork and owner-approved licensed SFX/ambience, bound to real project-owned safe paths; record media checksum and missing assets. G-Labs automation is not part of R2, and no project may claim render-ready while assets are missing. Preserve the original B4 Brian/voice override contract and original style audio/QA rules.

### WP-D — UNCHANGED native runtime + Video Editor/Approval/Render wiring

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
2. Freeze/export a Skill-grounded manual ChatGPT Web task; reload preserves exact text, rebuild invalidates old task; project/source/style/revision mismatch or replay rejected; no parallel creative schema.
3. Duplicate JSON key, oversized/deep JSON, unknown fields, prototype-pollution key, traversal/UNC/symlink/junction, unsupported B5/code payload rejected without file changes.
4. Original agent handoff: approved script → Nano audio → ElevenLabs actual word timing → ChatGPT visual/shot/native authoring; diff/confirm and failed candidates preserve original manifest/approvals.
5. Nano contract fake verification plus actual 24k WAV evidence tier; ElevenLabs forced-alignment fake contract plus user-triggered live tier; exact text/audio hash and word mapping; original probe/captions/validate; missing assets report WAITING_FOR_MEDIA.
6. Using a **genuine local fixture**, native preview produces an actual MP4 + report/SRT/VTT/contact sheet; app can play it without treating the draft frame as encoded output.
7. Approve only after explicit human action and note; original native approve invoked. Changed sample media/shot/voice blocks stale approval and render.
8. Native full render only with required media/shot coverage + valid approval, output MP4/report verified; retain cache and verify unrelated shot cache reuse after a scoped change.
9. App restart during/recovery after job: no duplicate conflicting render, checkpoint status reconciled; cancellation does not mark outputs successful.
10. No change to Native Core or approved V3 reference. No LLM/G-Labs calls; Nano loopback and explicit user-authorized ElevenLabs alignment only. No secrets leaked to renderer, no shell injection or unexpected filesystem writes.

**C1 supporting tests:**

- IPC contract/arg allowlist, Nano readiness/proof/cancel/uncertain response, ElevenLabs privacy/credential/word-alignment mismatch, job event cleanup/cancel and Windows path/case handling.
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
- User can manually hand off the original Mode B agent authoring instructions through ChatGPT Web, preserve script approval, generate/import local Nano WAV, align real words using ElevenLabs, then import native B1–B4 project.json authoring without changing original creative/production core.
- Native scoped preview, explicit human approval and full render work through the original CLI; video, sidecars, QA and cache are the real native artifacts.
- Stale/duplicate/replayed JSON, unsafe paths, missing assets and changed preview are rejected safely with recoverable errors.
- 9-page V3 UI and 5174 dev settings remain intact; tests/evidence are honest about the previously deferred R1 Electron smoke.
- No fake PASS, no new mode/manifest/render engine, no LLM/G-Labs API calls. Nano loopback and owner-authorized ElevenLabs Forced Alignment are the only production service integrations in R2.

Final report:

~~~
R2 IMPLEMENTATION REPORT
BASE_MAIN_SHA:
BRANCH / HEAD / DRAFT_PR:
WP-A Projects+IPC:
WP-B Manual External ChatGPT authoring handoff:
WP-C Nano TTS + ElevenLabs actual word alignment + local media:
WP-D Native preview/approval/render:
WP-E Tests/evidence:
C0 / C1 PASS-FAIL-NOT_RUN:
Electron R1 deferred status:
Core diff:
Actual sample MP4/SRT/VTT/report evidence:
Known blockers:
R2 VERDICT: PASS / PARTIAL / FAIL
~~~
