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

The script runs install, typecheck, lint, Vitest, production build, browser
interaction/visual screenshots, **actual** Electron dev/prod GUI smoke, and an
isolated native-core install/test. It writes `r1-local-results/results.json`,
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
