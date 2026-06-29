# Brand Slice P1 — Pre-Plan Audit

**Date:** 2026-06-29
**Spec:** `docs/designs/2026-06-26-brand-intelligence-slice.md` (P1 only)
**Base:** `origin/staging` @ `cdc660db6` (re-synced; +27 commits since the lift estimate, incl. the zero circular-dep ratchet)
**Method:** 6 parallel read-only audit agents, every claim cited to file:line.

---

## 0. Headline changes vs the design note

The audit found three things the design note (written against an older base) did not account for:

1. **Zero circular-dependency ratchet** (`data/circular-dependency-baseline.json`, server:0/src:0; enforced by `npm run check:circular-deps` → CI `quality` job). A new `brand` slice that reads identity from `brand-identity.ts` would create a **3-node cycle** (`workspace-intelligence → brand-slice → brand-identity → workspace-intelligence`, because `brand-identity.ts:4` imports `buildIntelPrompt` from `workspace-intelligence.js`). **This is the dominant P1 design constraint.**
2. **The "delegating shim" is unnecessary for P1.** `buildEffectiveBrandVoiceBlock` lives in `seo-context-source.ts:121-126`, which imports nothing from the intelligence facade. `brand-slice.ts` can simply **import and call it** for `voicePromptBlock` — no relocation, no shim, no parity risk. (Relocation is a P4 concern.)
3. **`generationQuality` is the precedent**: a slice that is in `INTELLIGENCE_SLICES` but NOT in `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES` and has no formatter case. That is exactly the behavior-neutral P1 shape.

---

## 1. Cycle hazard & resolution (the load-bearing decision)

**Hazard:** `brand-identity.ts` (the BrandDeliverable store) imports `workspace-intelligence.js` (`buildIntelPrompt`, line 4). Reading deliverables through it from inside `server/intelligence/` closes a cycle the zero-ratchet rejects.

**Resolution — read-model extraction (matches existing precedent):** commit `626bc8189` broke the same class of cycle by extracting `voice-profile-read-model.ts` and `content-brief-read-model.ts`. Mirror it:
- **New `server/brand-deliverable-read-model.ts`** — pure reads (`listDeliverables`, `getDeliverable`, `rowToDeliverable`, `rowToVersion`, stmt cache). Imports **only** `db` + `shared/types/brand-engine`. No intelligence imports.
- **`brand-identity.ts`** imports those from the read-model and **re-exports** them for back-compat → external callers (`copy-generation.ts`, `routes/brand-identity.ts`) unchanged.
- **`brand-slice.ts`** reads identity via the read-model, never `brand-identity.ts`.

**Voice** has zero cycle risk: `brand-slice.ts` imports `buildEffectiveBrandVoiceBlock` from `seo-context-source.ts` (Layer 2, clean). `seo-context-slice.ts` keeps calling it unchanged.

**Allowed `brand-slice.ts` imports (leaf only):** `logger`, `errors`, `shared/types/*` (types), `seo-context-source.js` (voice block), `brand-deliverable-read-model.js` (identity). **Never** `brand-identity.ts` / `brandscript.ts` / `voice-calibration.ts`.

**Guarded by:** a new boundary assertion in `tests/contract/cycle-kill-boundaries.test.ts` (mirror the voice-profile case at :204-212) + `npm run check:circular-deps`.

---

## 2. Behavior-neutral P1 boundary (verified)

`formatForPrompt` (`formatters.ts:22-140`) is a **hardcoded if-chain**, and no default slice set requests `brand`:
- content-gen `baseSlices` (`generation-context-builders.ts:124`), recommendation `:138`, AdminChat (`admin-chat-context-builder.ts:59`) — none include `brand`.

**P1 INCLUDES** (registration only): `INTELLIGENCE_SLICES`, `WorkspaceIntelligence.brand?`, `BrandSlice` interface, registry entry, assembler, read-model, tests, docs.
**P1 OMITS (→ behavior-neutral):** the `formatters.ts` `brand` case, `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES`, all `baseSlices` additions, WS events / frontend invalidation / query keys (no mutation, no frontend consumer in P1). All deferred to P2.

**One additive, acceptable caveat:** `get_workspace_intelligence` with no `slices` arg defaults to all of `INTELLIGENCE_SLICES`, so its JSON response gains a `brand` key (read-only, additive — identical to how `eeatAssets` behaves). **Action:** verify no MCP integration/snapshot test asserts the exact slice-key set; update if one does.

---

## 3. The registration lockstep (verified, traced from `eeatAssets`/`generationQuality`)

| # | Site | File:line | Gate |
|---|------|-----------|------|
| 1 | `INTELLIGENCE_SLICES` add `'brand'` | `shared/types/intelligence.ts:27-42` | **typecheck** (registry `satisfies`) |
| 2 | `WorkspaceIntelligence.brand?: BrandSlice` | `shared/types/intelligence.ts:107-134` | typecheck |
| 3 | Define `BrandSlice` interface | `shared/types/intelligence.ts` (new, ~675 region) | typecheck |
| 4 | Registry entry (lazy `import('./brand-slice.js')`) | `server/intelligence/slice-metadata-registry.ts:50+` | **typecheck** + registry-parity test |
| 5 | `sliceModules` array add `'brand-slice'` | `tests/contract/intelligence-facade-cycles.test.ts:12-27` | **test** |
| 6 | Slice table row | `docs/rules/workspace-intelligence.md:41-54` | docs |
| — | `PROMPT_FORMATTABLE` | `intelligence.ts:52-64` | **OMIT in P1** (non-formattable, like generationQuality) |
| — | formatter case | `formatters.ts:62/138/783` | **OMIT in P1** |

Registry-parity auto-test: `tests/unit/workspace-intelligence.test.ts:156-159` asserts `Object.keys(REGISTRY).sort() === [...INTELLIGENCE_SLICES].sort()` → forces #1+#4 in lockstep.

---

## 4. New / edited files (the complete P1 file set)

**New:**
- `server/brand-deliverable-read-model.ts` — pure deliverable reads (extracted).
- `server/intelligence/brand-slice.ts` — `assembleBrand(workspaceId): Promise<BrandSlice>`.
- `tests/unit/brand-slice.test.ts` — assembly + authority resolution + identity mapping + cold-start.

**Edited:**
- `shared/types/intelligence.ts` — slice registration (#1–3 above).
- `server/intelligence/slice-metadata-registry.ts` — registry entry.
- `server/brand-identity.ts` — import reads from read-model + re-export (back-compat).
- `tests/contract/intelligence-facade-cycles.test.ts` — `sliceModules` += `'brand-slice'`.
- `tests/contract/cycle-kill-boundaries.test.ts` — brand leaf-import boundary assertion.
- `docs/rules/workspace-intelligence.md` — slice table row.

---

## 5. `BrandSlice` interface (B3 hybrid; structured identity + voice block)

```ts
export interface BrandSlice {
  availability: 'ready' | 'no_data';            // match eeatAssets convention
  identity: {                                    // structured (each a single string blob)
    mission?: string; vision?: string; values?: string;
    tagline?: string; elevatorPitch?: string; positioning?: string;
  };
  voice: { status: 'calibrated' | 'legacy' | 'none' };  // P1: metadata only (no structured tone/guardrails — deferred)
  voicePromptBlock: string;     // = buildEffectiveBrandVoiceBlock(workspaceId) (imported, unchanged)
  identityPromptBlock: string;  // formatted once in the assembler from approved identity
}
```

**Identity read rules (verified):** `BrandDeliverable.content` is a single `string`; `status` is binary `'draft'|'approved'` (NOT a state machine); UNIQUE `(workspace_id, deliverable_type)` → one row per type. **Slice surfaces approved-only** content; missing → `''`. `values` is a `string`, not `string[]`.
**Authority guardrail:** prompt consumers inject `voicePromptBlock`/`identityPromptBlock` directly; never re-format the structured fields (CLAUDE.md authority-layered-fields). Use `safeBrandEngineRead` (pr-check enforced) for the reads.

---

## 6. Verification gates (P1 PR must pass all)

```
npm run typecheck            npm run check:circular-deps   ← new hard gate (server 0 / src 0)
npx vite build               npm run verify:feature-flags
npx vitest run               npm run lint:hooks
npm run pr-check             npm run verify:governance
                             npm run verify:style-drift
                             npm run verify:coverage-ratchet
```

---

## 7. Tests to add (template: `tests/unit/client-signals-slice.test.ts` vi.hoisted pattern)

1. `brand-slice.test.ts` — voice authority (calibrated→profile / legacy / none), identity mapping (approved-only, missing→''), `availability` flag, cold-start (no data → `no_data`), and a **parity assertion** `assembleBrand(ws).voicePromptBlock === buildEffectiveBrandVoiceBlock(ws)`.
2. `cycle-kill-boundaries.test.ts` — assert `brand-slice.ts` imports `brand-deliverable-read-model` and **not** `brand-identity`.
3. Registry-parity (`workspace-intelligence.test.ts:156-159`) passes automatically once #1/#4 land.

---

## 8. Prevention / systemic

- The cycle-kill boundary test is the durable guard against a future edit re-introducing the `brand-identity` import.
- Read-model extraction follows the established `*-read-model.ts` pattern (voice-profile, content-brief) — keeps the intelligence layer acyclic by construction.
- No new pr-check rule warranted for P1 (the existing circular-dep + authority-layered-fields rules cover it). A "consumers must not re-format raw brand fields" rule is a candidate for P2 when the structured fields gain prompt consumers.

## 9. Parallelization & model

P1 is a tightly-coupled change (shared contract = `BrandSlice` interface + read-model API), **not** a parallel fan-out. Implement single-agent (the controller, in the worktree), then run an **independent adversarial code review** (per owner's explicit request) before PR. Estimated 13–23h (from the baseline lift estimate); the read-model extraction is the main risk surface.

## 10. Open scope note (non-blocking)

The read-model extraction (`brand-deliverable-read-model.ts` + `brand-identity.ts` re-export) is the one scope item not in the original design note — surfaced by the zero ratchet. It is the idiomatic, precedent-backed resolution and is included in P1. Flagging for owner awareness; proceeding autonomously per the build mandate.
