# Mode B Studio UI Mockup V3 — Video Editor layout optimization

## Problem observed
At a 1656 × 790 CSS viewport, V2 allocated a fixed 465 px minimum viewport and a 426 px portrait preview, pushing the six-track timeline below the visible window. Users had to scroll the entire page.

## Implemented in V3
- On desktop editor view only (width >= 1101 px, height >= 620 px), use a viewport-bound, non-scrolling workspace. Other UI pages retain their existing scroll behavior.
- Collapse the redundant pipeline strip and long page intro **inside the Editor only**; keep the top bar and sidebar.
- Three-column editor: Scenes & Assets / 9:16 Preview / Inspector. These panes have internal overflow where needed.
- Pin the six-track timeline to the bottom of the editor with a default height of 244 px; scene/caption/narration/SFX/ambience are simultaneously visible at the tested desktop viewport.
- Add a draggable separator between preview workbench and timeline, with arrow-key resizing (focused splitter) and double-click / Home to reset.
- Keep original Edit, Native Preview and Approval modes; add a QA Details dialog to access longer native-preview/approval explanations without pushing the timeline off screen.
- Responsive fallback retains vertical scroll for narrow/mobile screens where fitting every panel would make controls unusable.
- Mockup only. It does not call FFmpeg, VoiceStudio or G-Labs, and does not modify Mode B core.

## Desktop Playwright checks
- 1656 × 790: workbench y=138–515, timeline y=536–780; entire timeline fits.
- 1600 × 900, 1440 × 800, 1280 × 720: timeline fits within viewport.
- Native Preview, Approval, Edit mode: timeline remains visible.
- Timeline splitter drag/reset tested; QA Details dialog opens/closes.
- 1050 × 850 and 390 × 844 responsive layouts: no page-level horizontal overflow.
- All nine UI views load without JavaScript errors.