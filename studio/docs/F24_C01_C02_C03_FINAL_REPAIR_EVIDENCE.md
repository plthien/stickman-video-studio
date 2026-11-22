# F24 PR #4 — Final source-audit repair C01/C02/C03

**Branch:** `feat/f24-script-analysis-style-bible-identity`  
**Baseline:** `2aa3b69a7d2e922032d0c5e847320c16646ddec1`  
**Status:** SOURCE REPAIR COMMITTED; runtime quality gates NOT VERIFIED.

## C01 — Native depicted-character cast and pre-paid gate (P1)

Production: `studio/src/main/identity/nativeNeeds.ts`, `continuityGraph.ts`,
`imagePreparation.ts`. The v1 Native Author must declare exactly one typed
asset need per managed image; background, prop, other and object declarations
are NOT exempt from actor attribution.

- Check exact stable `char_###` IDs, approved character labels evidenced by
  literal Script occurrences and source-grounded proper-name/marker aliases
- Unicode NFKC/lowercase and Unicode letter/number/mark boundaries; `Ann`
  never matches `anniversary`; punctuation and multiword names supported
- Two different approved actors with the same name/alias, overlapping aliases,
  negated presence, or possessive object-only reference trigger
  `NATIVE_IDENTITY_*_REVIEW_REQUIRED`, not a guessed binding
- Explicitly depicted approved actors absent from `character_ids` trigger
  `NATIVE_IDENTITY_CHARACTER_CAST_MISSING`; false `asset_kind` triggers
  `NATIVE_IDENTITY_ASSET_KIND_CONFLICT`
- Validate Native asset-needs AND provider-bound mutable creative source
  (`sourceDescription`, `sourceLedger`, and owner-edited `prompt`).
  Immutable B1–B4 style and compiler metadata are excluded from name
  inference; the source declarations and every owner-editable creative input
  remain covered. G-Labs double-preflight reruns target validation prior to POST
- Existing image references are never auto-added, approvals never synthesized,
  UNKNOWN remains a durable billing fence, and legacy Native is unchanged

Tests: `IdentityCastConsistencyC01.test.ts` (explicit actor/cast/Unicode/alias/
ambiguous/legacy cases) and `IdentityNativeBindingF24.test.ts` (owner prompt
changes background into depicted actor; mocked provider POST count zero).

## C02 — Permanent appearance evidence (P1)

Production: `studio/contracts/schemas/identity/script-analysis-v1.schema.json`,
`style-bible-v1.schema.json`, `contracts.ts`, `scriptAnalysis.ts`,
`styleBible.ts`. Adds optional `visual_trait_evidence` to older F24
records; new Author instructions require exact evidence for proposed traits.

Each evidence item identifies the **literal trait**, **exact Script quote/span**
(section, absolute UTF-16 start/end) and **typed relationship**. Existing
approved Script and authoring SHAs remain mandatory.

| Relationship | Deterministic policy | Canonical prompt |
|---|---|---|
| `intrinsic_appearance` | Exact actor within span; explicit physical predicate and conservative body/face cue | Eligible |
| `stable_wardrobe` | Exact actor plus explicit wears/dresses phrase and recurrence (every day/always/etc.) | Eligible |
| `transient_object`, `transient_action`, `scene_state` | The narrator described an object/action/temporary visual state | Rejected as permanent appearance |
| `requires_owner_review` | Source supports some words but not provable permanence or ownership | NOT drawable without explicit owner visual definition |
| Legacy trait without evidence | Still inspectable in Analysis; never silently promoted | `NEEDS_OWNER_DEFINITION` |

**Semantic limitation:** This is a conservative textual consistency gate, not
general natural-language understanding. It does not infer character appearance
from source proximity or run a paid/LLM classifier. Uncommon languages, free
metaphors, implicit clothing and uncertain actor references need an explicit
owner-reviewed `OWNER_BRIEF` / `SCRIPT_AUTHOR` visual definition or a real
owner-approved reference image. The owner addendum retains SHA/provenance.
Changing evidence changes character definition/Style Bible SHA, invalidating
only exact affected references/dependencies. Previously published authority
remains separate during candidate corrections.

Tests: `IdentityVisualEvidenceC02.test.ts` for scar, stable daily wardrobe,
picked-up hat, mere ownership, held club, observed other actor hair, running,
missing evidence, invalid spans, unsupported provider text; existing owner
definition/owner-import tests remain in `IdentityReferenceGenerationF24.test.ts`.

## C03 — Negative P2 Review lifecycle (P2)

Production: `scriptAnalysis.ts`, `identityWorkflow.ts`.

- `approved=true` **requires no findings**. A negative review **requires
  at least one valid P0/P1/P2 finding**. Extra/malformed fields reject
- An imported negative P2 Review or Recheck can freeze Correct; corrected
  `resolved_finding_ids` must match frozen finding IDs exactly, with
  reviewed candidate SHA and independent Review SHA checked
- Correct clears previous Review as authority; Recheck receives original
  findings to independently verify new candidate. No direct approval without
  clean Review/Recheck
- Existing previously frozen Correct envelopes (without new ID field) remain
  accepted only against the original frozen candidate and valid Review lineage
- Failed Recheck leaves Published canonical A unchanged. No Script or Native
  stage envelope substitution

Tests: `IdentityNativeBindingF24.test.ts` C03-01..10, including negative
single/multiple P2, P1/P2, contradictory clean/negative verdict, wrong IDs,
stale artifact SHA, Recheck review evidence, and current published identity.

## Required gates (from studio)

```powershell
npm ci
npm run typecheck
npm run lint
npx vitest run tests/unit/IdentityCastConsistencyC01.test.ts tests/unit/IdentityVisualEvidenceC02.test.ts tests/unit/IdentityUpstreamContracts.test.ts tests/unit/IdentityReferenceGenerationF24.test.ts tests/unit/IdentityNativeBindingF24.test.ts tests/unit/IdentityPublishedSelectionF24.test.tsx tests/unit/R2ExternalTaskIdentity.test.tsx
npm test
npm run build
```

Then Electron dev+packaged smoke, Native SAMPLE/FULL, paid-provider zero-POST
mock, restart and continuity graph tests. Do not merge PR #4 on source-only
evidence.

**Execution status:** NOT VERIFIED. GitHub contents connector can commit
patches, but this runtime's shell cannot resolve `github.com` to clone the
complete Studio checkout; no npm full-repo execution has been claimed.
