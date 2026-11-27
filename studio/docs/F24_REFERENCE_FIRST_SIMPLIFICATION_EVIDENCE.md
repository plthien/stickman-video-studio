# F24 Reference-first simplification — implementation evidence

PR: https://github.com/plthien/stickman-video-studio/pull/4
Branch: feat/f24-script-analysis-style-bible-identity
Baseline: fac19aa384b562a72061d60abf04fef0032ead77
Scope: STICKMAN_PR4_REFERENCE_FIRST_SIMPLIFICATION_REPAIR_PLAN.md

## Code changes

- Removed active `EntityKind`/`entity_kind` from TS contracts, Script Analysis and Style Bible schemas, frozen Author prompt, Style Bible runtime, UI and Native Author projection.
- Active schemas are strict with `additionalProperties:false`: retired `entity_kind` is rejected, not optional.
- Canonical new generation defaults to square 1:1 four-view 2×2, with anatomy-neutral camera directions and no automatic new features.
- As of the subsequent RFG repair, all **new** reference requests use one 1:1 square four-view prompt per char_id; no individual/group selector remains. Former group-overview prompts are available only to validate immutable historical jobs.
- New jobs pin only the canonical four-view prompt and SHA. Retired `referenceFormat` exists exclusively in stored historical-job reads. Runtime IPC validates an allowlist and rejects any unknown option before provider probing or paid POST.
- Historical v1 character kind is recognized ONLY by the read-only legacy storage adapter; archived Style Bible hashes and old 2×2/group prompt bytes are recomputed in memory for verification and never rewritten.
- Published Native authority validates the original archived snapshots and preserves `char_id`, canonical media, rights, approval set, source hashes, and exact target-binding behavior. Its active projection strips retired storage-only metadata while retaining the original historical authority snapshot SHA.
- A historical paid reference job can reconcile its original source even during newer candidate review. A simulated frozen UNKNOWN group job checks GET-only sync and byte-exact prompt/SHA, without auto-approval. No implicit job replay, retroactive publication or paid retry.
- Native `asset_kind`, continuous shot/target binding, source evidence and square owner-import/decoder gates are unchanged.

## Historical EK regression matrix (original plan; supplemented by RFG gates)

| IDs | Tests or code paths | Execution |
|---|---|---|
| EK-01/02/03/04 | IdentityReferenceFirstEK, strict new schemas, source scan | NOT VERIFIED |
| EK-05/07/19 | IdentityReferenceFirstEK, IdentityReferenceGenerationF24, four-view/group frozen prompt | NOT VERIFIED |
| EK-06/10/11/12 | legacyStorage, synthetic group published-Native/author-switch fixture, frozen UNKNOWN GET-only job; real historical on-disk receipt comparisons still needed | NOT VERIFIED |
| EK-08/09 | Existing owner import, exact SHA, rights, square decoder gates | NOT VERIFIED |
| EK-13/14/15 | IdentityNativeBindingF24, IdentityCastConsistencyC01, IdentityVisualEvidenceC02 | NOT VERIFIED |
| EK-16/18 | Existing Author and frozen Review/Correct/Recheck lineage | NOT VERIFIED |
| EK-17 | Existing ComprehensiveMainFlow, Core, Gallery and captions regression | NOT VERIFIED |
| EK-20 | Windows typecheck, lint, full Vitest, build, Electron and SAMPLE/FULL smoke | NOT VERIFIED |

## Run on Windows, same branch only

```powershell
git checkout feat/f24-script-analysis-style-bible-identity
git pull --ff-only
cd studio
npm ci
npm run typecheck
npm run lint
npx vitest run tests/unit/IdentityReferenceSingleWorkflowRFG.test.ts tests/unit/IdentityReferenceFirstEK.test.ts tests/unit/IdentityReferenceGenerationF24.test.ts tests/unit/IdentityUpstreamContracts.test.ts tests/unit/IdentityNativeBindingF24.test.ts tests/unit/IdentityCastConsistencyC01.test.ts tests/unit/IdentityVisualEvidenceC02.test.ts
npm test
npm run build
npm run test:ui
```

Then manually exercise Electron dev + packaged smoke and Native SAMPLE/FULL, with simulated/no-cost providers; verify zero unexpected paid POSTs. Capture unchanged published artifact, approval and media hashes before/after on a real frozen historical v1 project and a historical RUNNING/UNKNOWN reference job.

## Limitations

No Windows npm run, complete Electron build, archived project receipt inspection, Native SAMPLE/FULL, or real provider execution could be performed in this GitHub-connected editor. Local shell could not resolve github.com to clone the repository; no GitHub Actions workflow check exists for the new HEAD. No PASS is asserted for unexecuted tests.

MERGE BLOCKED until real Windows and historical replay gates pass.
