# Brand Intelligence Slice — P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the `brand` slice into the MCP content path (`prepare_brief_context`/`prepare_post_context`) so agents receive brand **identity** (structured + prompt block) and Layer-2 **voice DNA** — without duplicating the Layer-1 voice they already get, and without changing server-side content-generation output.

**Architecture:** Amend `BrandSlice` with a `voiceDnaBlock` (populated ONLY for calibrated profiles — non-calibrated already carry DNA in `voicePromptBlock`). Source the DNA from a new **leaf** `server/voice-dna-layer2.ts` (the two pure render fns moved out of `prompt-assembly.ts`, which then imports them — single source of truth, cycle-safe under the zero ratchet). The MCP handlers fetch the brand slice separately (`buildWorkspaceIntelligence(ws, { slices: ['brand'] })`) and inject `voiceDnaBlock` + `identityPromptBlock` into `prompt_context` (NEVER `voicePromptBlock` — already present via the `seoContext` part of `buildContentGenerationContext`), plus surface structured `brand_identity` + `voice_status` in the payload.

**Base:** `origin/staging` @ `bcae6266e` (includes P1). **Branch:** `brand-slice-p2`. **Audit inputs:** the two P2 audit agents (MCP wiring + cycle-safe DNA path).

---

## Key correctness contracts (do NOT violate)

1. **No double voice.** `context.promptContext` (from `buildContentGenerationContext`) ALREADY contains the Layer-1 voice block (via `seoContext.effectiveBrandVoiceBlock` formatter). So prepare_*_context must inject `voiceDnaBlock` + `identityPromptBlock` ONLY — never `voicePromptBlock`.
2. **DNA is calibrated-only.** `voiceDnaBlock` is non-empty ONLY when `profile.status === 'calibrated'`. For non-calibrated, `buildEffectiveBrandVoiceBlock` already emits DNA+guardrails inside `voicePromptBlock` (which is in `context.promptContext`) → `voiceDnaBlock` must be `''` to avoid duplication.
3. **Cycle ratchet stays zero.** `voice-dna-layer2.ts` imports ONLY types. `brand-slice.ts` must NOT import `voice-calibration.ts` (hard cycle). Guard with the existing cycle-kill boundary test + `npm run check:circular-deps`.
4. **Server-side gen unchanged.** Do NOT add `brand` to `baseSlices` or make it formattable. The brand fetch is a separate `buildWorkspaceIntelligence({slices:['brand']})` call inside the MCP handlers only.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/voice-dna-layer2.ts` | **Create** | Leaf: `voiceDNAToPromptInstructions(dna)`, `guardrailsToPromptInstructions(guardrails)` (moved from prompt-assembly). Imports only `VoiceDNA`/`VoiceGuardrails` types. |
| `server/prompt-assembly.ts` | Modify | Import the two fns from `voice-dna-layer2.js`; delete local copies (keep buildSystemPrompt behavior identical). |
| `shared/types/intelligence.ts` | Modify | Add `voiceDnaBlock: string` to `BrandSlice`. |
| `server/intelligence/brand-slice.ts` | Modify | Compute `voiceDnaBlock` (calibrated-only) via the leaf fns + `profile`. |
| `server/mcp/tools/content-actions.ts` | Modify | `prepare_brief_context`/`prepare_post_context`: fetch brand slice, inject `voiceDnaBlock`+`identityPromptBlock` into `prompt_context`, add `brand_identity`+`voice_status` payload keys, update tool descriptions. |
| `tests/unit/brand-slice.test.ts` | Modify | `voiceDnaBlock` cases (calibrated→populated; non-calibrated→''). |
| `tests/unit/mcp-tools-content.test.ts`, `tests/integration/mcp-tools-content.test.ts` | Modify | Brand payload + prompt-injection assertions; assert voice block NOT duplicated. |
| `docs/rules/workspace-intelligence.md`, `FEATURE_AUDIT.md`, `data/roadmap.json` | Modify | Doc lockstep; mark P2 done. |

---

## Task 1: Extract `voice-dna-layer2.ts` leaf (behavior-preserving)

**Files:** Create `server/voice-dna-layer2.ts`; modify `server/prompt-assembly.ts`.

- [ ] **Step 1:** Read `server/prompt-assembly.ts` lines ~62–124 — copy `voiceDNAToPromptInstructions` and `guardrailsToPromptInstructions` VERBATIM into a new `server/voice-dna-layer2.ts`. The new file imports ONLY `import type { VoiceDNA, VoiceGuardrails } from '../shared/types/brand-engine.js';` (confirm those are the exact type names/path used in prompt-assembly). Export both functions.
- [ ] **Step 2:** In `prompt-assembly.ts`: delete the two local function definitions; add `import { voiceDNAToPromptInstructions, guardrailsToPromptInstructions } from './voice-dna-layer2.js';`. Grep the repo for any OTHER importers of these two names from `prompt-assembly.js` — if found, either keep a re-export in prompt-assembly or repoint them (prefer repoint; note in commit).
- [ ] **Step 3:** Gates: `npm run typecheck`; `npx vitest run` for prompt-assembly + voice tests (`npx vitest run tests/unit/prompt-assembly*.test.ts tests/unit/voice*.test.ts` — adjust to actual filenames); `npm run check:circular-deps` (server 0/0). Expected: all green; buildSystemPrompt behavior byte-identical.
- [ ] **Step 4:** Commit: `refactor: extract voice-dna-layer2 leaf (Layer-2 DNA render, cycle-safe)`.

## Task 2: Add `voiceDnaBlock` to the brand slice (TDD)

**Files:** `shared/types/intelligence.ts`, `server/intelligence/brand-slice.ts`, `tests/unit/brand-slice.test.ts`.

- [ ] **Step 1:** Add to `BrandSlice` (after `voicePromptBlock`): `/** Layer-2 voice DNA + guardrails (semantic rules). Populated ONLY for calibrated profiles — non-calibrated already carry DNA in voicePromptBlock. Inject directly; do not combine with voicePromptBlock. */ voiceDnaBlock: string;`
- [ ] **Step 2: Failing test** — extend `brand-slice.test.ts`: calibrated profile with `voiceDNA`/`guardrails` → `voiceDnaBlock` non-empty + contains a guardrail token; non-calibrated profile → `voiceDnaBlock === ''`. Update the mock for `seo-context-source.js` if needed (no change — DNA fns come from the new leaf, which the test must mock or let run on the mocked profile). Mock `../../server/voice-dna-layer2.js` with pass-through renderers if simpler. Run → FAIL.
- [ ] **Step 3: Implement** in `assembleBrand` (after the `status` derivation): import `{ voiceDNAToPromptInstructions, guardrailsToPromptInstructions } from '../voice-dna-layer2.js';`. Then:
```ts
let voiceDnaBlock = '';
if (profile?.status === 'calibrated') {
  const parts: string[] = [];
  if (profile.voiceDNA) parts.push(voiceDNAToPromptInstructions(profile.voiceDNA));
  if (profile.guardrails) parts.push(guardrailsToPromptInstructions(profile.guardrails));
  if (parts.length) voiceDnaBlock = `\n\nBRAND VOICE RULES (you MUST follow these — do not deviate):\n${parts.join('\n\n')}`;
}
```
  Add `voiceDnaBlock` to the returned object. (Header wording: match the tone of the existing `voicePromptBlock`/`identityPromptBlock` headers.)
- [ ] **Step 4:** Run `npx vitest run tests/unit/brand-slice.test.ts` → PASS. Also `npm run check:circular-deps` (confirm brand-slice still leaf-only; the cycle-kill boundary test must still pass — add a `not.toContain('voice-calibration')` assertion if not already implied).
- [ ] **Step 5:** Commit: `feat(intelligence): add Layer-2 voiceDnaBlock to brand slice (calibrated-only)`.

## Task 3: Wire brand into MCP `prepare_*_context` (TDD)

**Files:** `server/mcp/tools/content-actions.ts`, `tests/{unit,integration}/mcp-tools-content.test.ts`.

- [ ] **Step 1:** Add import (top of file, with existing imports): `import { buildWorkspaceIntelligence } from '../../workspace-intelligence.js';` (confirm exact path/export).
- [ ] **Step 2: Failing tests** — extend the MCP content tests: assert `prepare_brief_context`/`prepare_post_context` payloads include `brand_identity` (object|null) and `voice_status`; when brand data present, `prompt_context` contains the identity block header AND the DNA header (for calibrated) but the voice block appears EXACTLY ONCE (assert no duplicate `BRAND VOICE PROFILE`/`BRAND VOICE & STYLE`). Run → FAIL.
- [ ] **Step 3: Implement** in BOTH handlers, after `buildContentGenerationContext`:
```ts
const brandIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['brand'] });
const brand = brandIntel.brand;
const brandIdentity = brand?.availability === 'ready' ? brand.identity : null;
```
  Then change the `prompt_context` assembly to append the NEW blocks only:
  - brief: `prompt_context: [targetBlock, context.promptContext, brand?.voiceDnaBlock, brand?.identityPromptBlock].filter(Boolean).join('\n\n')`
  - post: `prompt_context: [context.promptContext, brand?.voiceDnaBlock, brand?.identityPromptBlock].filter(Boolean).join('\n\n')`
  Add payload keys (both handlers): `brand_identity: brandIdentity, voice_status: brand?.voice.status ?? 'none',`.
  Update both tool `description`s to mention "brand voice rules and identity".
- [ ] **Step 4:** Run the MCP content tests → PASS.
- [ ] **Step 5:** Commit: `feat(mcp): surface brand identity + voice DNA in prepare_*_context (no voice duplication)`.

## Task 4: Docs lockstep

- [ ] `docs/rules/workspace-intelligence.md` — note `voiceDnaBlock` on the brand row. `FEATURE_AUDIT.md` — update brand slice entry (P2: MCP-exposed). `data/roadmap.json` — mark the P2 item done; `npx tsx scripts/sort-roadmap.ts`. Update the design note's §8 phasing to mark P2 delivered (incl. the voice-DNA expansion). Commit.

## Task 5: Full verification gates (DoD)

- [ ] `npm run typecheck` · `npx vite build` · `npx vitest run` · `npm run pr-check` · `npm run check:circular-deps` · `npm run verify:feature-flags` · `npm run lint:hooks` · `npm run verify:governance` · `npm run verify:style-drift` · `npm run verify:coverage-ratchet`. Distinguish any component-lane flake from a real regression.
- [ ] Independent adversarial review (focus: no double-voice in prompt_context; calibrated-only DNA; cycle-safety; server-side gen unchanged; MCP test adequacy). Fix Critical/Important. Then PR → `staging`.

## Self-review

- Spec coverage: identity to agents ✓, Layer-2 DNA to agents ✓, no voice duplication ✓ (contract #1), calibrated-only DNA ✓ (#2), cycle-safe leaf ✓ (#3), server-side unchanged ✓ (#4).
- Type consistency: `voiceDnaBlock: string` on BrandSlice; assembleBrand returns it; handlers read `brand?.voiceDnaBlock`/`brand?.identityPromptBlock`/`brand?.voice.status`/`brand?.identity`.
- The `prepare_post_context` brand fetch uses `workspaceId` (not the brief's) — correct, brand is workspace-scoped.
