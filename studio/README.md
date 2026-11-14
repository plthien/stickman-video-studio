# Mode B Studio · R1 UI V3 (demo only)

This is the component-based React/Electron presentation layer. The original
`skills/directing-stickman-videos/**` Mode B core is not changed or called.

## Start on Windows

```powershell
cd studio
npm ci --no-audit --no-fund
npm run dev
```

- Vite dev server: **http://127.0.0.1:5174** (strict port; 5173 is not used).
- Electron dev launches with Vite through `npm run dev`. An occupied 5174 is an error, not a fallback.
- Production: `npm run build`; Electron loads built `file://` assets.
- Playwright production preview: **http://127.0.0.1:4173**, independent of dev.

## Windows R1 acceptance (no CI required)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-r1-acceptance.ps1
```

The script exports the committed Git HEAD into a new, isolated temporary directory and runs install, typecheck, lint, Vitest, production build, browser
interaction/visual screenshots, **actual** Electron dev/prod GUI smoke, and an
isolated native-core install/test from Git object bytes (to preserve exact file hashes, not Windows CRLF conversions). The original `studio/node_modules` is never deleted or modified during acceptance. Temporary copies are cleaned up afterward. It writes `r1-local-results/results.json`,
logs, four viewport screenshot comparisons, `visual-parity-report.md/json`,
and an evidence ZIP in `studio/`.

Results are `PASS`, `FAIL` or `NOT_RUN`; the overall verdict stays
`PARTIAL` when any test was skipped or the owner has not reviewed the side-by-side
V3 screenshots. After personally inspecting all four sizes and confirming parity,
the owner can rerun with `-VisualReviewAccepted` to record an explicit review
attestation. This flag does not override any failed test. Never use
`--no-sandbox` as an acceptance workaround.

R1 keeps Script, External JSON and Editor state **in memory only while the app
session remains open**. No demo changes are saved to a native manifest or disk.
Provider, native QA, preview, import and rendering actions remain unconnected.

## Windows native core caveats

The native Mode B folder is immutable in R1. Its existing tests include strict
B4/B5 text and media hashes and platform-specific symlink/relative-path checks.
If native tests fail even with Git-object-byte snapshots, record **FAIL** with
the exact TAP counts and logs, not PASS/NOT_RUN. Windows symlink tests can require
Developer Mode or symlink privilege; some source tests may require upstream
portability work. Do not disable these tests, edit locked core resources or
rewrite baseline fingerprints merely to make the R1 UI gate green.

## R1 acceptance: browser preview port conflict

The local *development* Vite server is still fixed at `127.0.0.1:5174`.
When running `windows-r1-acceptance.ps1`, the independent *production preview*
for browser screenshots uses a free temporary localhost port, passed to Playwright
as `R1_PREVIEW_PORT` (also logged in `versions.log`). This prevents a foreign
process listening on the usual default 4173 from blocking every test. Running
Playwright directly without that variable continues to use port 4173 and fails
explicitly on a collision, instead of attaching to an unrelated server.
Electron tests use the separate `playwright.electron.config.ts` configuration
without any browser preview webServer; they launch actual Electron dev/prod.
The Electron dev mode still uses strict 5174, which must be available.

### Persistent native regression failures

When native-core tests are still failing from Git-blob snapshots, inspect the
actual native TAP failures. Known portability issues include B4 prompt hash,
B5 hashed fonts and Windows path separators, strict CRLF-vs-LF heading parsing
and Windows symlink permissions. The R1 acceptance script does not skip these
or change locked assets. Enable Windows Developer Mode only when authorized,
and never change hashes or test expectations to manufacture PASS.
