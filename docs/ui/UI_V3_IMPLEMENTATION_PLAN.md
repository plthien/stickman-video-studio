# Mode B Studio — UI V3 implementation plan (locked baseline)

**Status:** APPROVED UI REFERENCE; IMPLEMENTATION NOT STARTED  
**Repository:** `plthien/stickman-video-studio`  
**Implementation branch:** `feat/mode-b-ui-v3-baseline`  
**Reference:** [Interactive UI V3](./mockups/v3/vertical-stickman-ui-mockup-v3.html)  
**Scope:** Windows desktop, 9:16 video under 5 minutes, External ChatGPT authoring, local VoiceStudio Chatterbox Nano and G-Labs Webhook.  
**Important:** The single-file HTML is a **visual/interaction reference only**. Production UI **MUST NOT** use one giant HTML/TSX file or render that HTML through an iframe.

## Non-negotiable preservation

1. Keep **all upstream Mode B core files byte-for-byte unchanged**: `skills/directing-stickman-videos/**`, including `SKILL.md`, B1–B5 style contracts, `autopilot.mjs`, `autopilot-core.mjs`, `autopilot-render.mjs`, and B5 code-authored route. Preserve existing native `project.json` contract, `doctor/probe/init/captions/validate/preview/approve/render`, caching and QA.
2. Add the desktop application **only in a new `studio/` subtree**; use a main-process CLI adapter to invoke the unchanged Mode B runtime with an explicit command/argument allowlist, `shell:false`, sanitized project paths and captured logs. Stage metadata/task IDs live in the app's DB/sidecars, **not in native `project.json`**.
3. Preserve the separate B5 execution route; show B5 as unsupported/explicitly separate in External JSON mode until its safe code-authoring flow is audited. Never execute ChatGPT-returned code.
4. `main` remains untouched; do not merge or alter other source branches without approval. Do not rely on GitHub Actions: run Windows-local tests, save a test report.

## Locked UI parity

**Navigation order:** Project Setup → Overview → External ChatGPT → Script → Voice & Captions → Storyboard & Images → Video Editor → Render & Export; System Settings/Diagnostics in the system group.

**Video Editor is THE main editing workspace:** scenes/assets left, *portrait preview center*, inspector right, six-track timeline at the bottom (Scenes, Layers, Captions, Narration, SFX, Ambience). Modes: Edit, Native Preview, Approval. At 1280×720 and 1656×790 desktop CSS viewport, **preview and all six timeline tracks must be visible without page scrolling**. Editor is viewport-bound; pane overflow is internal; splitter draggable/keyboard accessible/resettable; QA details in a dialog; other pages remain normally scrollable. Keep V3 visual tokens, spacing, typography, active states, responsive behavior, and dark theme unless later explicitly approved.

## React component/page architecture — required

Suggested structure (adjust naming only when justified; retain equivalent separation):

```text
studio/
  package.json
  src/
    main/
      app.ts                  # Electron window/lifecycle, security
      ipc/                   # constrained typed handlers, no unsafe shell
      services/
        modeBCLI.ts          # original CLI bridge
        tasks.ts             # external authoring reservation/JSON import
        nano.ts              # 127.0.0.1:3901 API adapter
        glabs.ts             # configured G-Labs Webhook adapter
        projects.ts          # project filesystem/state
    preload/index.ts         # narrow typed contextBridge
    renderer/
      app/App.tsx
      app/routes.tsx
      app/layout/
        AppShell.tsx
        Sidebar.tsx
        Topbar.tsx
        PipelineStrip.tsx
      pages/
        ProjectSetupPage.tsx
        OverviewPage.tsx
        ExternalChatGPTPage.tsx
        ScriptPage.tsx
        VoiceCaptionsPage.tsx
        StoryboardImagesPage.tsx
        VideoEditorPage.tsx
        RenderExportPage.tsx
        SystemSettingsPage.tsx
      features/
        external/            # prompt builder, JSON upload, validation, diff, repair
        voice/               # readiness, voice select, WAV, alignment, captions
        storyboard/          # shots, images, references, provider jobs
        editor/
          EditorModeTabs.tsx
          SceneAssetPanel.tsx
          PortraitPreview.tsx
          InspectorPanel.tsx
          EditorTimeline.tsx
          TimelineTrack.tsx
          TimelineSplitter.tsx
          NativePreviewPanel.tsx
          ApprovalPanel.tsx
          QADetailsDialog.tsx
        render/              # native CLI progress, result files, cache
        settings/            # Nano/G-Labs endpoint config, diagnostics
      components/
        ui/                  # Button, Card, Badge, Dialog, Input, Tabs, Toast
        layout/              # shared panels, section headers, empty/error states
      styles/
        tokens.css
        global.css
        editor.css
      types/                 # typed app DTOs and native manifest projections
  tests/
```

**Architecture rules:** Components are presentational where possible; page containers own orchestration; `features/*` owns domain hooks/state; services/IPC own filesystem, providers and CLI; shared UI elements never issue provider calls. No monolithic App.tsx, VideoEditorPage.tsx, or 1-file giant stylesheet. Adopt TypeScript strict mode, typed IPC and accessible controls. Do not ship mock data disguised as real provider/approval success.

## Three lean implementation rounds

### R1 — UI parity and local shell (one implementation round)
- Scaffold `studio/` with Electron + React + TypeScript + Vite, Windows local dev launch, secure preload/IPC, app shell/navigation.
- Implement **all nine pages** and reusable components, using V3 as the pixel/behavior reference.
- Video Editor: 3-column pane, 9:16 preview, six-track timeline, selectable shots, frame seek and controls, inspector tabs, 3 modes, movable splitter, QA dialog. Demo media/state must be labeled `Demo`; no false native PASS.
- Project Setup must appear **above** Overview and be the landing page. Build correct desktop responsive behavior; no global horizontal overflow.
- Deliver: local `npm ci`, dev app, build, TypeScript/lint/unit/UI smoke scripts; screenshot parity at 1656×790 and 1280×720.
- **Acceptance:** all 9 pages render, keyboard/navigation/input state works, timeline visible in viewport, no app-console errors, upstream Mode B tree unchanged.

### R2 — Functional External ChatGPT + original Mode B CLI (one implementation round)
- Reuse *patterns* from `plthien/ytb-ai-studio`: immutable prompt snapshot, reserved artifact IDs, precise output schema, copy/export prompt, paste/upload JSON, strict parsing (including duplicate keys/size), project/stage/source binding, dry-run validation, persistent reservation, atomic import, revision/diff, scoped repair.
- **Keep Mode B agent task semantics/input/output:** package the existing B style/production instructions plus current approved source, narration times, shot ledger, images, and native `project.json` schema; no new alternate animation language. Wrapper metadata remains outside native manifest.
- Connect project files and `autopilot.mjs doctor/probe/init/captions/validate/preview/approve/render` from Electron main. Original CLI decides approval validity; the UI may not synthesize approval.
- Voice/caption and storyboard pages can import real local assets, display status and errors, link to editor. Build local task checkpoint/state for crash/resume.
- **Acceptance:** create project → external script/storyboard/manifest task → import/validate → local sample MP4 → review/approve → real full MP4/SRT/VTT; prove bad JSON, stale task and changed sample are rejected without corrupting project.

### R3 — Nano + G-Labs integration and Windows acceptance (one implementation round)
- VoiceStudio **Chatterbox Nano PR #2** adapter over loopback `http://127.0.0.1:3901`, contract `nano_lite_api_v1`: separate readiness from liveness, profile/consent/integrity, speech WAV 24k mono PCM16, response receipt verification, pause/segmentation, definite non-admission vs uncertain POST; import resulting continuous narration unchanged into Mode B. Reference `ytb-ai-studio` Nano consumer; observe B4 Brian-or-explicit-user-override rule.
- G-Labs image adapter: resolve actual installed local API variant (ClipForge PR #2 `/api/openai/generate` vs older `ytb-ai-studio` `/api/image/generate`), NEVER mix them. Stable paid task IDs, read-only reconciliation on uncertain outcome, strict download URL/MIME/size/path validation, reference ordering, 9:16 assets, approved-image reuse. No silent auto-retry.
- Finish real job progress, diagnostics, reconciliation, cancellation, per-shot asset replacement and native cache reuse. Avoid unnecessary video provider functionality.
- **Acceptance:** provider fake deterministic tests + owner-run Windows hardware tests; Nano WAV/headers verified, G-Labs 202→task/status/result→local PNG verified; 3–5-minute 9:16 pipeline renders using unmodified CLI; 1-shot change reuses unrelated cached shots; restart resumes without double submissions.

## Required acceptance/test artifacts
- `scripts/windows-local-acceptance.ps1` or equivalent inside `studio/`: **one command** runs dependency check, lint, types, UI unit tests, deterministic fake Nano/G-Labs contracts, V3 desktop viewport screenshots, and native Mode B smoke tests; exports machine-readable report and failure logs. Do not require GitHub Actions.
- Negative cases: invalid/stale/replayed task JSON; duplicate key; source hash mismatch; unapproved asset; Nano not ready/uncertain; G-Labs uncertain 202; attempted path traversal; rejected B5 code; stale native preview approval; forced restart/resume.
- Before every PR review, verify `git diff --name-only main...HEAD -- skills/directing-stickman-videos/` outputs nothing, then run unchanged Mode B CLI regression tests locally.
- Do not merge until the actual UI matches V3 and full local evidence has been reviewed.

## Implementation references
- V3 HTML mockup: `docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html` (reference only).
- V3 layout rules: `docs/ui/mockups/v3/EDITOR_LAYOUT_NOTES.md`.
- External authoring: `plthien/ytb-ai-studio` → `app/core/external_authoring.py`, `app/services/external_authoring_reservations.py`, `src/features/studio/PromptImportWorkspace.tsx`.
- Nano producer: `plthien/VoiceStudio-GGUF-Lite` PR #2 → `docs/integrations/youtube-studio-nano-api-v1.md` on `feat/chatterbox-turbo-provider`.
- Image provider: `plthien/clipforge` PR #2 → `src/lib/providers/glabs-webhook.ts` on `feat/r2-glabs-webhook-media`.
