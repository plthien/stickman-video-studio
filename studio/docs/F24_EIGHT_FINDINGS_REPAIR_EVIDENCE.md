# PR #4 — Eight-finding repair evidence (source-verified, execution unverified)

**PR:** https://github.com/plthien/stickman-video-studio/pull/4  
**Branch:** `feat/f24-script-analysis-style-bible-identity`  
**Audited baseline:** `4fd5ed7826aa30bca566cf5b3d61c61a7d9830f5`  
**Merge readiness:** NOT READY until required Windows quality gates execute successfully.

## Findings

| ID | Production repair | Regression evidence | Execution |
|---|---|---|---|
| A01 | `publishedAuthority` is a digest-checked immutable snapshot separate from Candidate Analysis; Native and current published reference lookup use last-good; Publish is explicit | `IdentityNativeBindingF24.test.ts` A01-01/02/03/04/05/07/08/09/10 + scoped-key test | NOT VERIFIED |
| A02 | `isManagedNativeImagePath` excludes original Core `@b1/` built-ins; Gallery, Native asset needs, binding and final receipt use the same `nativeImageTargetsFromManifest` inventory; duplicate explicit image layer IDs reject | `IdentityNativeBindingF24.test.ts` A02; `IdentityUpstreamContracts.test.ts` nested Core/managed | NOT VERIFIED |
| A03 | Image prompt excludes unchecked description, role, label, aliases; visual readiness requires source-verified appearance; validator attributes visual traits to correct character in source context, not any global substring | `IdentityUpstreamContracts.test.ts` A03, owner definition tests | NOT VERIFIED |
| A04 | `asset_kind` required in JSON schema and TS contract. character/pose require nonempty canonical cast; no Correct downgrade to empty-cast background | `IdentityUpstreamContracts.test.ts` A04; `IdentityNativeBindingF24.test.ts` correction downgrade | NOT VERIFIED |
| A05 | Published candidate selected first, explicit eligible owner choice overrides it, no latest-approved override; project-switch clears session and guards snapshot; impact bound to exact choices+revision | `IdentityPublishedSelectionF24.test.tsx` | NOT VERIFIED |
| B01 | `new Set<string>(changed)` preserves type safety and runtime character membership validation | `IdentityUpstreamContracts.test.ts` targeted binding SHA | NOT VERIFIED |
| B02 | `entry():ScriptCharacter` and `analysis():ScriptAnalysis` preserve `char_${string}` types in original fixture | Original upstream unit tests | NOT VERIFIED |
| B03 | FileReader load/loadend accepts once and atomically patches Import JSON after session/revision check; malformed JSON doesn't mutate editor; no automatic Stage/Confirm | `R2ExternalTaskIdentity.test.tsx`: original actual FileReader, loadend-only, both completion events, malformed, delayed project change | NOT VERIFIED |

## Published/candidate authority invariant

- New Author/Correct imports are candidates only. They cannot revoke a previously **published** identity or canonical reference set
- Review negative, Recheck failure or abandoned candidate still keep the published record active for Native/G-Labs
- Current publish action atomically snapshots independently reviewed Analysis, approved Bible and owner-reviewed reference set with a content digest
- Legacy F24 journal migration reads only existing complete approved records; no authority is fabricated from history or old image bytes
- Changing a character does not change an unrelated target's scoped reference binding SHA; global identity receipts still require explicit Native re-confirmation before full render
- Paid POST is never triggered by Review, import, impact preview, or reopening a project

## Quality gates to execute (from `studio`)

```powershell
npm ci
npm run typecheck
npm run lint
npx vitest run tests/unit/IdentityUpstreamContracts.test.ts tests/unit/IdentityReferenceGenerationF24.test.ts tests/unit/IdentityNativeBindingF24.test.ts tests/unit/IdentityPublishedSelectionF24.test.tsx tests/unit/R2ExternalTaskIdentity.test.tsx
npm test
npm run build
```

**Execution status:** NOT VERIFIED. Connector can inspect/commit GitHub files, but the session's local shell cannot resolve `github.com` to clone the full repository. No claim of TypeScript, Vitest, Vite, Electron or Native CLI success is made here.

**Owner's previous baseline (before these patches):** 615 tests PASS, 1 FAIL in 56 files; build FAILED with 9 TypeScript errors. Those baseline results are not results for this HEAD. Keep PR Draft until fresh evidence covers all mandatory gates, including Windows Electron and sample/full Native.

## Follow-up: Windows owner full-suite log, 2026-11-22

Owner supplied the *pre-follow-up* execution transcript:
- `npm test` / Vitest: **53 files passed / 4 failed** of 57; **625 tests passed / 4 failed** of 629; overall wall duration 189.61s
- `R2ExternalTaskIdentity.test.tsx`: actual JSDOM FileReader import left `Import JSON` empty; the mocked `onloadend`-only and both-events test paths had passed
- `ComprehensiveMainFlow.test.ts MF01-1`, `R3AutoCaptions.test.ts AC03`, and `VoicePlayback.test.ts PB-01/02`: **timeout at 15,000 ms** under the concurrent full suite; *individual functional failure NOT established*
- `npm run build`: blocked before Vite/Electron build by **TS1005** at `IdentityUpstreamContracts.test.ts:214`, malformed indexed `typeof` expression

Follow-up source changes on the same PR:
- Corrected invalid `as typeof duplicated.shots[0].layers[number]` in test fixture without weakening the duplicate-ID assertion. Isolated equivalent source snippet compiled via global `tsc --strict --noEmit --target ES2022 --lib es2022,dom` with exit code 0; **this is not repository typecheck**.
- R2 file picker no longer clears its selected input before FileReader consumes the File. Selection is cleared exactly once when read completes, guarded against project switch and later file selections. Tests now cover delayed read, onload/onloadend deduplication, malformed JSON, and stale project/session reads. No validation or staging on file selection.
- Vitest 3 worker contention control: `minWorkers:1,maxWorkers:3`, `testTimeout` unchanged at 15,000 ms. This is a resource-concurrency mitigation, **not a claim that MF01/AC03/PB timeouts are fixed**. Repeat isolated tests and full suite to confirm.

### Fresh Windows verification commands

```powershell
cd studio
npm run typecheck
npm run lint
npx vitest run tests/unit/R2ExternalTaskIdentity.test.tsx --maxWorkers=1
npx vitest run tests/unit/ComprehensiveMainFlow.test.ts tests/unit/R3AutoCaptions.test.ts tests/unit/VoicePlayback.test.ts --maxWorkers=1
npx vitest run tests/unit/IdentityUpstreamContracts.test.ts --maxWorkers=1
npm test
npm run build
```

If a test fails in isolation, investigate the production path separately; if it fails only under full suite, collect timing, active worker count, event logs and I/O pressure. Avoid increasing timeouts blindly or weakening assertions.

**Post-follow-up execution state: NOT VERIFIED. Do not mark PASS or merge based on the prior log.**
