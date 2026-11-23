# PR #4 — Final audit repair AUD-01/02/03

PR: https://github.com/plthien/stickman-video-studio/pull/4  
Branch: `feat/f24-script-analysis-style-bible-identity` (existing, no new branch or PR)  
Audited baseline: `8632abe7453a49a33ea8e992280298ca45a9345e`  
Owner-provided status before this repair: local tests/build reportedly passed.  
Current repair quality gates: **NOT VERIFIED** until tests are run against the final repair HEAD.

## Source repair — exact production functions

| Finding | Production function(s) | Source changes |
|---|---|---|
| AUD-01 / P1 | `directlyAttributedAppearance`, `validateTraitEvidence`, `verifiedVisualTraits` in `scriptAnalysis.ts`; `compileStyleBible` in `styleBible.ts` | Check exact UTF-16 source quote/span, same actor occurrence, clause boundaries, another actor's catalog occurrence or independent predicate, and a directly owned body/wardrobe relationship; unsupported traits remain owner-review only. The catalog is supplied to the drawable-trait projection, not merely a string match. |
| AUD-02 / P1 | `assertNativeCastConsistency`, `assertNoUnboundVisibleSubjects` in `nativeNeeds.ts`; `verifyCreativeSources` in `continuityGraph.ts`; `compileImageJobSpecs`, `withUpstreamIdentity` in `imagePreparation.ts` | Verify unbound visible subjects whether or not other actors are already declared; inspect asset_needs content, Shot description, source-ledger visible-state/action, owner creative text, and final target preflight. Keep compiler-owned B1–B4 style out of subject detection. Unresolved cast returns BLOCKED, retains approved reference paths in preflight evidence, and directs owner to existing Native Review/Correct. |
| AUD-03 / P2 | `likelyNounModifier`, `detectPublishedCharacterMentions` in `nativeNeeds.ts` | Avoid automatic alias match when a single-word name occurs in a likely quantity + noun construction. Keep explicit char_id, genuine actor predicates, Unicode/multiword source aliases, shared-alias collision and negation gates. No permanent name blacklist or new entity taxonomy. |

## Source tests added

- `IdentityVisualEvidenceC02.test.ts`: AUD01-01/01b/01c/01d, AUD01-02–07; paired actors, same-sentence named predicate, unlisted second subject, valid scar/recurring wardrobe, transient object, non-promotion and UTF-16 quote/span/section tampering.
- `IdentityCastConsistencyC01.test.ts`: AUD02-01–06, AUD02-09 and AUD03-01–07; extra visible person/robot beside recognized cast, complete/incomplete cast, scenery negatives, incidental narration/props, quantity-like alias, canonical ID, Unicode and multiword alias, collision and negative-cast checks.
- `IdentityNativeBindingF24.test.ts`: AUD02-07/08 owner-edited prompt and Shot ledger preflight; mocked G-Labs provider is asserted to receive zero paid POST, blocked jobs retain the published reference paths. A quantity-like scene ledger is checked as a positive case.
- Existing `IdentityReferenceSingleWorkflowRFG`, `IdentityReferenceGenerationF24`, `IdentityUpstreamContracts` and Native Core/gallery tests were not removed or weakened.

## Finding matrix

| ID | Severity | Static production and regression inspection | Actual Vitest execution |
|---|---|---|---|
| AUD-01 | P1 | PASS — source fixes and tests committed | NOT VERIFIED |
| AUD-02 | P1 | PASS — source, paid preflight and tests committed | NOT VERIFIED |
| AUD-03 | P2 | PASS — source and tests committed | NOT VERIFIED |

**PASS above means only code inspection**, not runtime correctness. No assertion of tests passing is made without execution. The prior baseline was reported locally passing by the owner, but does not validate this new HEAD.

## Billing and lineage invariants

- `glabs.ts` calls `assertPreparedImageRequest` before provider configuration or POST; it calls `prepareNativeImageTarget` again and rejects `state==='BLOCKED'` with the original reason.
- Existing canonical `character_ids`, `asset_kind`, reference-set SHA, rights/media bytes, continuity references and job UNKNOWN fence are not modified by this repair. A BLOCKED job can display pinned canonical paths but is not submitted.
- Single square 1:1 four-view reference generation and historical read-only group/job compatibility remain unchanged.
- No paid request was executed by this code-editing session. Mocked paid-provider test cases were authored; their runtime result remains NOT VERIFIED.

## Windows quality gates

```powershell
git switch feat/f24-script-analysis-style-bible-identity
git pull --ff-only
cd studio
npm ci
npm run typecheck
npm run lint
npx vitest run `
  tests/unit/IdentityVisualEvidenceC02.test.ts `
  tests/unit/IdentityCastConsistencyC01.test.ts `
  tests/unit/IdentityNativeBindingF24.test.ts `
  tests/unit/IdentityUpstreamContracts.test.ts `
  tests/unit/IdentityReferenceSingleWorkflowRFG.test.ts `
  tests/unit/IdentityReferenceGenerationF24.test.ts
npm test
npm run build
```

Also verify Electron dev/package smoke, Native Author → Review → Correct → Recheck, owner reference approval/publish, historical reference/job SHA and UNKNOWN GET-only recovery. No real paid provider request is authorized.

## Execution constraints and merge recommendation

The code edits were made through connected GitHub source and pushed to PR #4. The local execution shell cannot resolve `github.com` to clone this repository; it has no checkout or `node_modules` for this project. No completed GitHub Actions run is associated with the repair commit. Therefore `npm ci`, typecheck, lint, Vitest, full build, Electron/package, real historical archive comparisons and Native SAMPLE/FULL remain **NOT VERIFIED** here.

**Do not merge based only on these static findings.** Final acceptance requires actual Windows quality-gate evidence and no failures on final HEAD.
