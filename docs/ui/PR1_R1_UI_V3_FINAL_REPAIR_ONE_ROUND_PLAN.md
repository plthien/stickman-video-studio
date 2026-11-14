# PR #1 — R1 UI V3 Final Repair Plan (One Round)

**Repository:** `plthien/stickman-video-studio`  
**PR:** https://github.com/plthien/stickman-video-studio/pull/1  
**Branch:** `feat/mode-b-ui-v3-baseline`  
**Last audited HEAD:** `0255663ebd5ea284ef008717a727973fff20a807` (refresh before editing)  
**Status:** Repair plan only; implementation pending.  
**Approved, immutable UI source:** `docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html`  
**R1 contract:** `docs/ui/R1_UI_V3_ONE_ROUND_IMPLEMENTATION_PLAN.md`  
**Additional request:** Change the **development Vite port from 5173 to 5174** everywhere it affects runtime, automation or documentation. The production-build Playwright preview port **4173 is separate** and may remain unchanged.

## 0. Constraints and success criterion

- Implement all fixes below in **one implementation round**; update **existing draft PR #1**, no new PR, no merge, no re-planning phase.
- Preserve original `skills/directing-stickman-videos/**` **byte-for-byte**; do not change native Mode B `project.json`, rendering, QA, approval or caching contracts.
- Preserve all nine React pages and feature/component separation under `studio/`; do not embed/execute the locked one-file HTML as the production UI, do not redesign V3, and do not introduce R2/R3 backend, LLM API, Nano, G-Labs, FFmpeg or a new database.
- Demo data must remain clearly identified; no fake provider readiness, native QA PASS, successful render or accepted import.
- Scope changes mainly to `studio/**`, tests and the acceptance script. Do not modify the locked V3 HTML, layout notes or baseline hashes.
- **Release gate:** all runnable tests must pass, actual Electron evidence from an ordinary Windows desktop must be attached, and UI V3 parity must be reviewed. If the runner lacks the required GUI/Windows capabilities, record `NOT_RUN` and leave the PR in Draft; do not claim full PASS.

## FIX-01 (P1) — Make the test suite executable and meaningful

**Source:** `studio/tests/ui/r1.spec.ts` uses Playwright `.fill()` on `<input type="range">` for `Timeline seek` (e.g. 9.25, 3.75, 29.75). Playwright `fill()` is for editable text-like inputs, not sliders.

**Implementation:** Replace these calls with a reusable slider interaction helper that produces real `input`/`change` updates (or keyboard/mouse interaction). Assert the control's actual value and downstream preview shot/play state, including shot boundaries and end-of-playback. Never silence errors or skip tests to get a green report. Re-run every interaction test and check that selectors match the current Vietnamese UI labels.

**Acceptance:** `npm run test:ui` completes with no slider action errors; seeks 3.75 → S01-A, 4.00 → S01-B, 9.25 → S02-A, 29.75 → final shot; playback through boundaries and at timeline end works. Test results must come from execution, not PR description.

## FIX-02 (P1) — Keep demo state when changing pages

**Source:** `ScriptWorkspace`, `ExternalWorkspace`, `useEditorState` use page-local state, which disappears after route unmount. The action `Keep demo draft` must not appear durable when it disappears on navigation.

**Implementation:** Introduce small **feature-level, app-session state** owners at/above routing (e.g. feature contexts within the existing `AppStateProvider`, without one monolithic global mutable object). Keep these separate:

- Script: section-specific draft, saved baseline/dirty, selected section. Navigation away/back preserves the last approved *demo* draft and unsaved edits; reset selected section affects only that section.
- External: active task tab, prompt preview, imported text and syntax result. Keep prompt preview/copy/export derived from one `activePrompt`, and reset outdated syntax status on text changes.
- Editor: timeline position, current/selected shot, non-scene clip selection, mode, timeline height, inspector edits per shot, inspector tab; pause playback on leaving editor or explicitly communicate playback state. Do not leak timers across unmounted components.
- Distinguish **in-memory session persistence** from disk persistence. Do **not** claim these demo edits survive closing/restarting the app; no project database or native manifest writes in R1.

**Acceptance:** edit Script section A, switch page, return: edit retained; switch sections and reset one without altering another. External tab/JSON retained; Editor shot/inspector/timeline retained and safe after navigation. Include repeat-navigation UI tests.

## FIX-03 (P1) — Fresh, honest acceptance evidence

**Source:** PR description still reports 2 Vitest/14 Playwright results from the earlier commit. There are no committed or supplied acceptance results for current HEAD; ordinary-Windows Electron dev/prod smoke and original core regression remain unverified.

**Implementation:** Harden `studio/scripts/windows-r1-acceptance.ps1`:

- Run install, typecheck, lint, unit, production build, Playwright interaction and screenshots; **actually execute** Electron dev and production smoke on an ordinary Windows desktop, or mark each `NOT_RUN` with the exact environmental reason.
- Native Mode B regression: install dependencies in an **isolated temporary copy** or equivalent safe location; do not alter tracked core files. Verify the command exit status and capture logs.
- Produce `results.json` entries with `PASS/FAIL/NOT_RUN`, command, exit code, test count, environment, HEAD SHA, elapsed timing, and relevant evidence paths. Ensure a skipped Electron test cannot be summarized as PASS; fail/NOT_RUN if only tests are skipped.
- A failing step should not erase the logs/results of earlier steps; ideally continue independent diagnostics and return a nonzero overall exit code. Robust cleanup of spawned Vite/Electron processes and temporary core copies; no unsafe cleanup of unrelated paths.
- Attach/export a ZIP containing the machine-readable result, logs and screenshots. Update PR description with results **for the audited repair HEAD**, not inherited results.

**Acceptance:** evidence is reproducible on local Windows with a single PowerShell command, results are truthful, core-source diff is empty, and Electron sandbox is not disabled to make a test PASS. If not executed locally, PR remains Draft/Partial.

## FIX-04 (P2) — Synchronize selected Mode B style throughout UI

**Source:** changing B1/B3/B4 in Project Setup does not update B2-hardcoded text in `PortraitPreview`, `InspectorPanel`, External Storyboard demo prompt and related displays.

**Implementation:** Preserve original Mode B style codes and full names (B1 Minimal Hand-Drawn, B2 Colorful Hand-Drawn, B3 Retro TV, B4 Survival Thriller, with B5 separate/unsupported in JSON handoff). Prefer a single typed project-style ID (`B1|B2|B3|B4`) and presentation mapping; avoid parsing style names for logic. Every contextual page reads the same selected project style. Styling of actual demo art may remain illustrative, but do **not** mislabel B4 as B2 or imply any provider generated a style-specific image. Keep native style authoritative.

**Acceptance:** change style to B3, navigate Project → Editor → External → Overview; all visible labels/prompts show B3, not B2. Change back to B2 and verify. UI remains demo-labeled.

## FIX-05 (P2) — Real V3 visual review, not screenshot existence

**Source:** Playwright currently captures app screenshots and original reference at the same viewport sizes, but does not compare/evaluate their layout.

**Implementation:** Capture **same size, same editor state, same viewport, same font loading** for both real React UI and locked V3 reference at 1280×720, 1440×800, 1600×900 and 1656×790. Produce a side-by-side visual review artifact and small `visual-parity-report.md/json` with concrete comparison findings: left/assets column, center portrait preview, right/inspector, editor toolbar, relative proportions, timeline height, six tracks, color/spacing/typography, overlays. Fix material deviations while keeping component design; document minor intentional differences. Can use a simple image-diff utility if available, but do **not** claim pixel-perfect parity from screenshot existence or an arbitrary similarity percentage.

**Acceptance:** at all four desktop viewports the **portrait preview, playback controls and all six tracks** are in view with **no document-level vertical/horizontal scroll**; no preview taking the entire height. Narrow screens should not overflow horizontally. Review outputs allow the owner to inspect UI against the approved V3.

## FIX-06 (P2) — Timeline clips align with time ruler/playhead

**Source:** the scene clip buttons currently use arbitrary fixed widths by index while shot durations are 4/5/4/6/5/6 seconds; clip boundaries do not represent time and the timeline ruler/playhead cannot be trusted visually.

**Implementation:** Build one deterministic demo time scale for the whole 30-second scene fixture. Derive scene clip offset and width from cumulative start/duration, with the same content coordinate system for ruler and playhead; scroll horizontally together; keep track labels fixed or offset consistently. Non-scene tracks may use explicit demo start/duration metadata (no invented production timing); never auto-select an unrelated scene when clicking them. Keep six tracks, existing keyboard/separator/accessibility, and viewport fit. If zoom is visual-only, label it as such or remove the misleading active control.

**Acceptance:** A=0–4, B=4–9, C=9–13 boundaries align with ruler and moving playhead, including at 4.00, 9.00 and 30.00 seconds; clip selection and seek are tested. No regression in height/scroll behavior.

## FIX-07 (P1 — explicit owner request) — Change dev port **5173 → 5174**

**Required updates, verified against repository HEAD:**

- `studio/package.json`: `dev:web` runs Vite on **127.0.0.1:5174** with `--strictPort`; `dev:electron` waits for **http://127.0.0.1:5174**.
- `studio/vite.config.ts`: explicitly set `server.host`, `server.port = 5174`, `server.strictPort = true` (and use matching CLI settings if retained).
- `studio/scripts/start-electron-dev.mjs`: set `VITE_DEV_SERVER_URL = http://127.0.0.1:5174`; keep same port in startup output and error handling.
- `studio/tests/ui/electron.spec.ts`: use port **5174** in smoke and readiness checks. Run the **actual `npm run dev`** from a clean state (no existing `studio/dist/`) and verify Project Setup renders in Electron using localhost:5174, not merely a separately launched Vite server.
- Search repository-owned runtime scripts/config/docs/tests for all remaining `5173` references and update those representing **R1 dev server**. Do not modify locked mockup content solely to search-and-replace text. Verify that 5173 is never accessed and dev startup fails explicitly if **5174** is occupied (no implicit fallback to another port).
- **Do not confuse dev server port with Playwright production preview `4173`**: keep preview port 4173 unless there is an actual conflict. The production desktop shell must still load local 0file:0 output, without requiring a dev server.

**Acceptance:** from clean `studio/`, `npm ci` then `npm run dev` opens the UI through **http://127.0.0.1:5174**, production build/Electron loads `file://`, and Playwright UI preview remains on 4173. Tests/launcher no longer reference 5173 for the dev pathway.

## Testing matrix and final required evidence

| Check | Must verify |
|---|---|
| T01 | TypeScript typecheck, lint, unit tests, production build |
| T02 | 9 pages/routes and Project Setup default |
| T03 | Playwright slider seek (range-compatible), scene transitions, playback end |
| T04 | Script / External / Editor state retained across routes |
| T05 | Style B1/B2/B3/B4 propagated across pages |
| T06 | Clip widths/time ruler/playhead align at known boundaries |
| T07 | Responsive editor layout at 1280×720, 1440×800, 1600×900, 1656×790 |
| T08 | Side-by-side reference comparison and documented findings |
| T09 | `npm run dev` on 5174 from clean install with no dist, real Electron GUI smoke on Windows |
| T10 | Electron production smoke, preload bridge, sandbox, context isolation and no Node access |
| T11 | Native Mode B tests run from isolated copy or explicit NOT_RUN with reason |
| T12 | `git diff main...HEAD -- skills/directing-stickman-videos/` empty |

**Evidence folder:** `studio/r1-local-results/` containing `results.json`, `versions.log`, `install.log`, `typecheck.log`, `lint.log`, `test.log`, `build.log`, `browser.log`, `electron-dev.log`, `electron-prod.log`, `native-core-tests.log`, `core-preservation.log`, `screenshots/`, `visual-parity-report.md` (plus ZIP export). Name the verified repair commit in the report.

## Delivery

1. Refresh PR #1 branch HEAD; implement FIX-01 through FIX-07 in **one round**; self-audit and fix issues before ending.
2. Commit/push only on `feat/mode-b-ui-v3-baseline`, update existing **Draft PR #1** (no merge).
3. Report fix status for each ID, commit SHA, actual executed tests and PASS/FAIL/NOT_RUN (with counts), exact evidence paths, remaining blockers, and **final R1 verdict**. No invented evidence.

**Stop condition:** R1 may be called PASS only after accepted visual parity, actual Windows Electron dev/prod smoke, complete test suite, and unchanged native Mode B Core are verified. Otherwise report PARTIAL honestly.
