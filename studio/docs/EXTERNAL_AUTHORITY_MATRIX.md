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
Extraction revisions: `script-author-source-exact-v3` for Script → Author; `stage-exact-v2` remains unchanged for Native Author and Script/Native Review, Correct, Recheck and Media Review.

- Script → Author uses version-controlled, fail-closed selectors for literal complete source
  requirement lines at exact original line locations (L-number), grouped under their
  original headings. It retains the selected B1–B4 creative rules, narrative/continuity,
  planned visual feasibility, story-led sound and applicable opening rules while deferring
  native execution, media timing, provider, CLI and encoded QA operations.
- Native and all other operations retain their existing section-level or full-file
  authority extraction and original task contract.
- Native receives the full installed B style, autopilot, runtime, QA and sound
  references, plus the complete B4 opening/audio/repeatability references if selected.
- Every source records installed relative path, original SHA-256, extraction SHA-256,
  extraction revision, applicability and selected heading inventory. Script Author additionally
  records exact original line locations and provides all extracted text inline.
- Missing, renamed or empty mandatory selectors fail closed. Frozen original author
  tasks and lifecycle review prompts bind to current source/brief/artifact identity.
- The original skills/directing-stickman-videos/** tree is never modified.

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
