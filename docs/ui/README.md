# Mode B Studio — approved UI V3

**UI baseline is LOCKED.** Implement production UI by matching the approved V3 mockup, but never ship the mockup HTML as the app or copy it into a giant JSX component.

## Files

- [UI Mockup V3 (interactive, standalone HTML)](mockups/v3/vertical-stickman-ui-mockup-v3.html)
- [Editor V3 layout acceptance notes](mockups/v3/EDITOR_LAYOUT_NOTES.md)
- [Componentized implementation plan](UI_V3_IMPLEMENTATION_PLAN.md)

To inspect visually, **download** the HTML from GitHub and open in Chrome/Edge; GitHub's normal blob viewer displays source code rather than executing HTML.

## Locked baseline hashes

- HTML SHA-256: `f6a3145d0cc7d0bc8474bd966ca313f4dd1f9acdb928333cc0109e13259a169e`
- HTML Git blob SHA: `2997bde7b56bbf979962e33f1e516c3be881dde7`
- V3 layout notes SHA-256: `675a00563a2994f7a3914c92ec21910e8ebcc9a9023a74a11d7c19fb3dbabc77`

Do not alter these reference files without explicit design approval. Store production source under `studio/`, organized by **pages, features, components and services**. All original `skills/directing-stickman-videos/**` Mode B core remains byte-for-byte unchanged.

## UI navigation and priority

1. Project Setup (first in sidebar and default landing screen)
2. Overview
3. External ChatGPT
4. Script
5. Voice & Captions
6. Storyboard & Images
7. Video Editor (Edit / Native Preview / Approval)
8. Render & Export
9. System Settings & Diagnostics

The Video Editor must fit its portrait preview and six-track timeline within desktop viewports such as **1280×720** and **1656×790** without scrolling the entire page. Timeline has a draggable splitter, and only individual panels may scroll. V3 HTML is a demo: do not confuse its simulated approval, validation or render with real Mode B results.
