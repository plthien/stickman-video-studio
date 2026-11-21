# F24 Windows acceptance checklist — Draft PR #4

**Current status: NOT VERIFIED.** This file is a reproducible checklist, not a PASS report.

## 1. Repository gates

```powershell
git fetch origin
git switch feat/f24-script-analysis-style-bible-identity
git pull --ff-only
cd studio
npm ci
npm run typecheck
npm run lint
npx vitest run tests/unit/IdentityUpstreamContracts.test.ts tests/unit/IdentityReferenceGenerationF24.test.ts tests/unit/IdentityNativeBindingF24.test.ts
npm test
npm run build
```

Also run existing Windows Electron dev and packaged production startup with project switching, G-Labs credentials and a zero-cost sandbox provider.

## 2. Legacy and new-project policy

- [ ] Older projects without `identityPolicy` stay `legacy`, with unchanged Script, Native CLI, gallery and historical paid jobs
- [ ] Newly created projects are `v1`; Script and Voice still work before identity setup, but Native Author/paid images require approved upstream identity
- [ ] Upgrade displays affected assets and does not mutate historical Core `project.json` or reuse legacy approvals
- [ ] UNKNOWN or active paid job blocks policy upgrade and canonical replacement

## 3. Source-grounded upstream

- [ ] Approved Script Author and Correct/Recheck are unchanged
- [ ] Script Analysis freezes exact Script text+authoring SHA; Author/Review/Correct/Recheck envelopes stay separate
- [ ] Reject invented traits, duplicate character IDs, invalid quote/spans, wrong task/revision and forged independent review digest
- [ ] Empty verified cast is valid; no auto-invented reference IDs
- [ ] Style Bible inherits source `char_id`, correct full installed B1–B4 source SHA and separate guidance SHA
- [ ] Source/styled text approval is explicit; no paid LLM API

## 4. Visual references (real file and captured HTTP)

- [ ] Human 1:1 prompt produces a single four-view sheet; group produces one overview; owner checks exact pixels/no printed labels
- [ ] One click causes exactly one 1:1 POST with separate reference-job journal, never a Shot 9:16 job
- [ ] GET-only Sync recovers provider status/result/download. `UNKNOWN` is never automatically retried or changed to free-to-retry `STALE`
- [ ] HTTP DONE and decoded 1:1 PNG remain `VALIDATED` until owner previews and approves
- [ ] Promoted approved media are in project media ledger with verified byte SHA, MIME and honest licensing notes
- [ ] Published approval set binds exact Script/Analysis/Bible/character definition/SHA/rights/owner event
- [ ] Canonical replacement requires preview impact and blocks active/UNKNOWN payment/native mutation

## 5. Native + G-Labs + final publication

- [ ] Native author receives current Style Bible, declared `character_ids` array on every exact image target, typed `continuity_source` DAG
- [ ] Legacy string `asset_needs` is rejected for F24 v1 and still accepted in legacy
- [ ] Same `char_001` across independent Layers yields **identical actual canonical reference image bytes and SHA** in two mock POST payloads
- [ ] Empty refs for a declared character are blocked before POST, including manual fingerprint-less generation bypass
- [ ] B4 style sample remains first; exact ref count ≤8 and JSON payload ≤5,242,880 bytes. Over-budget fails before payment
- [ ] Previous-image link only to an earlier exact APPROVED source; merely VALIDATED source fails; source drift invalidates descendants
- [ ] Owner-edited prompt/references cannot erase canonical image or B1–B4 authority
- [ ] Native Confirm rechecks all fulfilled target jobs/rights/lineage before/after CLI, writes separate SHA-locked receipt without modifying Core manifest schema
- [ ] Native Validate/Preview/Approve/Render and preview reuse reject stale published identity and receipt
- [ ] Canonical switch after published Native keeps old film bytes/history but blocks reuse/render until explicit rebuild

## 6. UI, durability and recovery

- [ ] F25 cards remain 200px wide, 160px thumbnail, click-to-zoom Fit/100%, original Retry/Approve actions
- [ ] Style Bible previews use real media URLs and bounded thumbnails; no unapproved image auto-insert
- [ ] Switching projects does not leak response JSON, reference jobs or authorization
- [ ] Interrupted POST is UNKNOWN; interrupted GET is recoverable without repeat POST
- [ ] Native error/rollback cannot make stale film appear approved
- [ ] No nonrequested checkboxes, queue-another actions or automatic paid generation

## 7. Audit repair regression gates (HEAD-specific; NOT VERIFIED until executed)

- [ ] AUD-01 P0: Register owner candidate while a canonical set is published: current set SHA is unchanged; Approve candidate preserves current set; owner canonical replacement requires impact review and blocks active/UNKNOWN; previous approved set remains in verified immutable history
- [ ] AUD-02 P1: Two actual sequential Native image targets. Before source approval dependent is BLOCKED; after source G-Labs APPROVED, second paid request contains two distinct real PNG/SHA references (canonical+previous); source/right/lineage changes block transitive dependent
- [ ] AUD-03 P1: Frozen Script Analysis Author/Correct prompts contain exact checked-in JSON schema and task-bound JSON envelope; Review/Recheck contain typed review payload, current SHA and exact task identity
- [ ] AUD-04 P1: Sample-only Native Confirm with first image fulfilled and later image missing emits SAMPLE receipt; preview cannot exceed receipt sampleSeconds; full render/unscoped validate refuse SAMPLE certification
- [ ] AUD-05 P1: Native Correct modifying only image-2 changes its target/reference snapshot but preserves image-1 target SHA even though Draft container revision advanced
- [ ] AUD-06 P2: Unspecified narration never invents appearance; approved literal Script Author text or separately owner-approved visual brief is required for 1:1 generation, with provenance hash stored in generated candidate/Approval Set; future definition edits do not automatically replace current canonical set
- [ ] AUD-07 P2: Single batch snapshot of Native identities, canonical bytes/rights and continuity graph across all prepared targets; paid single-target preflight still reads fresh evidence. Benchmark at 200+ images and record Windows CPU/time/memory without ungrounded PASS claim

**Do not merge while any P0/P1 regression remains or execution evidence is absent.**
