# R2 — Stage-scoped, source-exact External ChatGPT authority

## Authority precedence

1. Installed Mode B Core and selected B1–B4 style contracts (unchanged)
2. MODE_B_EXTERNAL_CHATGPT_CORE_PRESERVING_PLAN_V2.md
3. docs/ui/UI_V3_IMPLEMENTATION_PLAN.md
4. Owner-approved R2 Main Workflow Repair
5. Studio production code and measured evidence

External ChatGPT owns manual creative authoring, review, scoped correction and recheck only.
Studio owns production orchestration, local Nano, ElevenLabs alignment, media, native validation,
rendering and owner approval. There is no Agent or LLM API runtime.

## Four-way disposition matrix

| Original source / responsibility | Script | Native | Studio | Agent-only |
|---|---|---|---|---|
| SKILL.md, Mode B route | KEEP selected Mode B clauses | KEEP Mode B clauses | enforce selected route | A/automatic route |
| Selected B1–B4 reference | KEEP exact creative sections | KEEP complete original | QA and rendering | agent tool dispatch |
| autopilot.md | KEEP independent style settings | KEEP complete original | voice and CLI | terminal/provider automation |
| autopilot-production-qa.md | KEEP planning/opening/motion/caption sections | KEEP complete original | encoded QA and acceptance | automatic tool use |
| autopilot-sound-system.md | KEEP story-led sound/scene script | KEEP complete original | source rights and actual mix | unattended sourcing |
| autopilot-runtime.md | MOVE TO NATIVE | KEEP complete original | original CLI/cache/validator | ChatGPT CLI execution |
| B4 opening/audio direction | KEEP selected exact sections | KEEP complete original | audio/visual evidence checks | unattended voice/provider operations |
| B4 repeatability check | MOVE TO NATIVE | KEEP complete original | production QA | automatic evidence fabrication |
| Provider HTTP, credentials, file system, cache | STUDIO_ONLY | STUDIO_ONLY | KEEP | OMIT |
| Owner approval and creative acceptance | STUDIO_ONLY | STUDIO_ONLY | KEEP manual gate | OMIT |

KEEP preserves literal normative text, not a model-written generic summary.
MOVE TO NATIVE prevents runtime tutorials leaking into a Script Task.
STUDIO_ONLY and AGENT_ONLY never authorize the external model to simulate actual execution.

## Source extraction and fail-closed operation

Implementation: studio/src/main/externalAuthority.ts.
Extraction revisions: `script-author-complete-blocks-v4` for Script → Author; `stage-exact-v2` remains unchanged for Native Author and Script/Native Review, Correct, Recheck and Media Review.

- Script → Author uses source-byte-pinned, version-controlled, inclusive original line
  ranges to extract complete continuous normative blocks (including sub-bullets, numeric
  conditions and style-specific exceptions), grouped under original headings. Sixteen
  mixed-stage cases use exact complete contiguous original sentences, never rewrites,
  with verified line/column bounds. Source hash changes (after normalizing Windows CRLF to original Git line endings), invalid ranges or incomplete sentence boundaries fail closed.
  It retains the B1–B4 creative/continuity rules while deferring provider, CLI,
  actual media timing, Native execution and encoded QA to their existing owners.
- Native and all other operations retain their existing section-level or full-file
  authority extraction and original task contract.
- Native receives the full installed B style, autopilot, runtime, QA and sound
  references, plus the complete B4 opening/audio/repeatability references if selected.
- Every source records installed relative path, original SHA-256, extraction SHA-256,
  extraction revision, applicability and selected heading inventory. Script Author additionally
  records exact original line/column ranges, each contiguous block's literal text,
  and provides all extracted text inline.
- Missing, renamed or empty mandatory selectors fail closed. Frozen original author
  tasks and lifecycle review prompts bind to current source/brief/artifact identity.
- The original skills/directing-stickman-videos/** tree is never modified.

## PR #2 deterministic Script Author source selection (owner-approved)

Only these three shared references changed. Every listed range is one-based and inclusive.
Complete selected lines preserve original text; entries marked with parentheses below
use source-exact sentence boundaries and provenance including columns. All
B1/B2/B3/B4-specific reference selections, Native Author and lifecycle authority
extraction remain unchanged.

| Source | Previous Script selection | Current Script selection | Deferred from Script (stage) | Creative rules retained |
|---|---|---|---|---|
| `references/autopilot.md` | `[[5,5],[11,15],[17,19],[25,25],[43,43],[49,52]]` | `[[5,5],[11,11],[13,13],[21,21],[25,25],[43,43]]` | B3-only runtime description L17 and shot/keyframe/ref sheet L49–52 → Native; provider catalog execution in L43 and aspect ratio runtime checks in L25 → Studio/Native | Independent B style contracts, user-choice priority, conditional genre/palette, topic/audience/duration/ratio/language, role-based casting |
| `references/autopilot-production-qa.md` | `[[5,9],[19,27],[29,34],[40,42],[44,46],[48,48]]` | `[[9,9],[21,21],[23,24],[27,27],[33,34],[42,42],[48,48]]` | Ledger, word timing, timed SFX mix and sample/encoded QA L7/L25/L27/L31–32/L40/L46/L48 remainder → Native/Studio | Visual meaning and identity, first-30-second hook/body bridge, copy/factual fidelity, non-repetitive compositions, relevant diagrams and semantic one-line B1–B4 subtitle rule |
| `references/autopilot-sound-system.md` | `[[5,7],[18,24],[61,72],[80,80],[84,91]]` | `[[7,7],[18,24],[61,61],[63,63],[72,72]]` | Cue IDs/rights manifest, sound routing/source acquisition, TTS settings and conditional suspense/apocalypse module L84–91 → Native/Studio | Motivated story-led sound, three functional roles, non-simultaneous layers, genre-specific palette without guessing, intentional silence |

The sound system suspense/apocalypse module stays available to Native in the
complete original source but is never injected unconditionally into Script
Author for B1–B4. No genre inference or project schema field is introduced.
Actual accepted WAV timing, audio mixes, approved speech and caption validations
remain downstream responsibilities. Script Author duration guidance does not
provide a guessed WPM.

The presentation renderer omits synthetic file-heading fallbacks and avoids
duplicating an original Markdown heading if its first selected source block
already begins with that heading. It never mutates `blocks[].text`.
The selected source line ranges, the six preexisting style-specific excerpts,
and ten additional owner-authorized shared excerpts retain source/column
provenance and original Git-blob fail-closed identity.

## Workflow, correction scope and media truthfulness

Script: Author → Import candidate → Review → Correct selected IDs → Recheck
→ explicit Owner Approve. Corrected candidates require a matching independent
recheck before approval. Approved script remains separate from the candidate;
approved text changes invalidate dependent narration/alignment/preview.

Native corrections require the complete existing manifest v1 plus shot_ledger,
sound_script and asset_needs arrays. All unlisted shots and global/auxiliary fields
are locked. Voice and captions remain protected even with expanded scope.
A retained last-good manifest stays active until the original native CLI
validates the candidate; a correction journal preserves retriable failures.

Review/Media Review must enumerate actual IDs and coverage. Invalid target IDs,
duplicate findings, bad status/evidence and unsupported media observation are
rejected. Review-package export copies real hash-verified MP4/WAV files rather
than treating a local path in JSON as proof of visual/audio inspection.
Real ChatGPT file transfer and audiovisual observation require separate
human activity; imported creative review never auto-approves a film.

## Measurement and verification policy

Compare actual frozen Script Task byte sizes on identical project inputs before
and after implementation. Prompt size is not a quality proxy. Run local typecheck,
lint, integration/UT, production build, original Native Core preservation/CLI and
Windows acceptance against final HEAD. Mark NOT_RUN/BLOCKED when the runner or real
voice/media/provider is unavailable. Neither this file nor offline fixtures are
a claim of actual encoded video creative acceptance.

Script Author now exposes an explicit four-way requirement inventory in
`compileAuthority().scriptAuthorClassification`: `KEEP_SCRIPT` is a source-path
and exact L-range or L/column-range list; `DEFER_NATIVE` identifies original runtime, render
and final QA boundaries; `STUDIO_ONLY` covers provider/media execution and
owner approval; `AGENT_ONLY` covers automatic tool orchestration. This metadata
does not change Native Author or the other lifecycle contracts.

## Script Author mission and import contract

Script Author produces only ordered spoken narration `sections[].text` plus flexible
`authoring` decisions about premise, characters/identity, continuity, style and
sound/voice intent. It uses the existing `mode-b-script-v1` schema and outer
frozen task identity. Empty audience/purpose permits reasonable creative choices.
Duration is a target, not a fabricated WPM or accepted WAV measurement.
Source-exact extracts remain visible inside the exported prompt; Native's full
`project.json` and CLI/QA contracts remain unchanged. Any original creative
rule requiring actual footage, sound, asset bytes or validation is deferred to
its appropriate Native/Studio execution gate.

## Script Author JSON handoff example (v4)

The exported frozen envelope contains real project/task/revision/input SHA identity
and a small, schema-valid **fictional kite narration example** under
`mode-b-script-v1`. It is explicitly not content to reuse. The exported task
contains neither `REQUIRED_NONEMPTY_ARRAY` nor `REPLACE_WITH_ACTUAL_SECTION_ID`.
Existing Script import validation still rejects those structural placeholders,
invalid section IDs and duplicate section IDs. Native Author's example and all
review/correction task schemas are unchanged.
