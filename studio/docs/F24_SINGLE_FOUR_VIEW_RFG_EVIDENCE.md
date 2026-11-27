# PR #4 — RFG single canonical four-view reference repair

Repository: plthien/stickman-video-studio
Branch: feat/f24-script-analysis-style-bible-identity (existing PR #4; no new branch/PR)
Baseline SHA: 4c7104cd66fdebc9d1816d8e3e7931723def585d

## Production contract

One individual char_id → square 1:1 canonical four-view 2×2 → explicit owner approval → published canonical set → Native binding. Four-view prompt wording is unchanged from the prior default branch. Character Registry has no output-format selector and no individual/group taxonomy. New reference-generation IPC input allows only anchorId, authorized, regenerate, acknowledgeUnknown. An unrecognized key fails before provider calls.

Historical compatibility remains read-only. Journal `referenceFormat` and the retired group/individual strings are allowed only when replaying frozen historical format-aware jobs, and legacy entity kinds are accepted only in legacyStorage. Neither can authorize a new paid POST. Older UNKNOWN paid jobs still use GET-only sync; SHA checks remain strict.

Native keeps asset_kind and multiple character_ids per Shot. The cast-consistency tests verify two independent source-established identities and the distinct canonical-anchor bytes in one target-binding digest; generic crowd words require review instead of creating a synthetic group ID. Previous published group snapshots retain their original source and media SHA. No archived artifact was rewritten by this code change.

## Scope and test traceability

| Gate | Source/tests | Status |
|---|---|---|
| RFG-01/02 | Strict Script Analysis/Style Bible schemas; IdentityReferenceSingleWorkflowRFG | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-03/04 | styleBible single prompt; IdentityUpstreamContracts + IdentityReferenceFirstEK | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-05/06/07 | Renderer/IPC selector removed; strict validateNewReferenceGenerateInput; ReferenceGenerationF24 | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-08/14 | NativeCastConsistencyC01 multi-anchor hash/crowd tests | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-09 | Existing NativeBindingF24 missing canonical/missing cast pre-POST tests | NOT VERIFIED |
| RFG-10/11 | LegacyStorage, archived group Native fixture and snapshot SHA checks | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-12/13 | Frozen group and four-view UNKNOWN jobs, original prompt SHA and GET-only sync tests | PASS (source inspection), NOT VERIFIED (test execution) |
| RFG-15 | Native Core/image gallery untouched; existing cross-functional suites | NOT VERIFIED |

## Local verification commands (Windows checkout, exact PR #4 HEAD)

```powershell
git switch feat/f24-script-analysis-style-bible-identity
git pull --ff-only
cd studio
npm ci
npm run typecheck
npm run lint
npx vitest run tests/unit/IdentityReferenceSingleWorkflowRFG.test.ts tests/unit/IdentityUpstreamContracts.test.ts tests/unit/IdentityReferenceFirstEK.test.ts tests/unit/IdentityReferenceGenerationF24.test.ts tests/unit/IdentityNativeBindingF24.test.ts tests/unit/IdentityCastConsistencyC01.test.ts tests/unit/IdentityVisualEvidenceC02.test.ts
npm test
npm run build
npm run test:ui
```

Then perform Electron development/package smoke, Native SAMPLE/FULL and gallery checks. Compare original published authority/reference/candidate SHA against real historical project bytes before/after. Simulated provider tests should show zero POST for rejected requests and historical GET-only sync.

## Execution limits

Source was inspected and edited through the GitHub connection; the local shell cannot resolve github.com for checkout and has no repository node_modules. GitHub Actions has not provided a completed CI check for this edit. No `npm ci`, `typecheck`, `lint`, `vitest`, Electron or Native full workflow was executed here; do not classify these as PASS. Merge remains blocked pending real execution and historical on-disk receipt verification.
