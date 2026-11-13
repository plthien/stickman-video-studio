# R1 UI V3 visual parity review

Reviewed against the locked `mockups/v3/vertical-stickman-ui-mockup-v3.html` on 2026-11-13. The automated verdict remains **PENDING_OWNER_VISUAL_REVIEW**; this document does not grant owner approval or claim pixel-perfect parity.

## Geometry evidence

The comparison uses the first shot at time zero after fonts load. Each run writes app, reference, and side-by-side PNGs to `studio/r1-local-results/screenshots/`.

| Viewport | Toolbar app / V3 | Left column app / V3 | Center app / V3 | Inspector app / V3 | Timeline app / V3 |
| --- | --- | --- | --- | --- | --- |
| 1280×720 | 36 / 36 px | 190×320 / 190×329 | 554×320 / 557×329 | 252×320 / 255×329 | 1016×244 / 1020×244 |
| 1440×800 | 36 / 36 px | 190×400 / 190×385 | 714×400 / 711×385 | 252×400 / 255×385 | 1176×244 / 1174×244 |
| 1600×900 | 36 / 36 px | 190×500 / 190×485 | 874×500 / 871×485 | 252×500 / 255×485 | 1336×244 / 1334×244 |
| 1656×790 | 36 / 36 px | 190×390 / 190×375 | 930×390 / 927×375 | 252×390 / 255×375 | 1392×244 / 1390×244 |

At all four viewports the portrait preview, playback controls, splitter, and all six tracks are visible without document-level horizontal or vertical scrolling. The 30-second ruler, clips, and playhead now share one responsive percentage scale; 26 px/s remains the minimum density when the timeline must scroll.

## Parity changes

- Reduced the editor mode toolbar from 54px to the locked V3 36px and separated the page/shot context into a compact row.
- Matched the desktop sidebar to 236px, restored the project context card and workspace/system grouping, and retained functional numbered navigation.
- Reproduced the V3 Layer/Caption/Audio inspector group. Caption and Audio are disabled with R1 explanations; the controlled Layer/Motion/Style group remains available below it.
- Densified the timeline tracks, added the V3-style timing footer, and made the complete time scale consume available width without changing temporal state or clip boundaries.

## Remaining intentional differences

- React uses the existing CSS/SVG fixture art and shot IDs rather than copying the reference's richer inline illustration. It remains explicitly illustrative and cannot be mistaken for generated media.
- Workbench height differs by -9px at 1280×720 and +15px at the three taller viewports. Timeline height and horizontal column geometry are within 0–4px; forcing identical height would either waste available preview space or compromise the viewport-bound layout.
- Inspector Caption/Audio controls and native/provider actions stay disabled because R1 has no corresponding backend. This accessibility and truthfulness constraint takes precedence over decorative interactivity.
- The React panel surface uses the established R1 gradient, while the locked mockup uses a flatter surface with inner padding. Borders, hierarchy, typography family, and mint/nav active states remain aligned.

All nine routes and the approved V3 reference remain unchanged in structure and source respectively.
