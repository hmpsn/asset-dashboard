# Design Note — Unified Brand Intelligence Slice (additive rollout)

> **Status:** P1 + P2 BUILT (2026-06-29). P3–P5 remain. See §8 phasing.
> **Date:** 2026-06-26 · **Author:** owner + Claude (audit follow-up)
> **Origin:** [2026-06-26 MCP surface audit](../audits/2026-06-26-mcp-surface-audit.md) → brand-coverage discussion.
> **Decision owner:** Joshua. Decisions below marked **[DECIDED]** / **[OPEN]**.

---

## 1. Problem

The platform has a rich brand layer — **voice** (voice profile / calibration) and **identity** (mission, vision, values, tagline, positioning, etc., stored as `BrandDeliverable`s) — but it is fragmented and partially dark to the AI:

1. **No brand slice exists.** The intelligence engine has 14 slices (`INTELLIGENCE_SLICES`, `shared/types/intelligence.ts:27`); none is brand. Brand *voice* is not a slice — it's a single field, `effectiveBrandVoiceBlock`, embedded in the `seoContext` slice (built by `server/intelligence/seo-context-source.ts:121 buildEffectiveBrandVoiceBlock`).
2. **Brand identity is wired into nothing.** Mission/values/tagline/positioning live in the `BrandDeliverable` store (`server/brand-identity.ts`: `listDeliverables`, `getDeliverable`, `updateDeliverableContent`; route `server/routes/brand-identity.ts`) and are read by **zero** intelligence slices → invisible to MCP, AdminChat, **and** content generation.
3. **Voice DNA does not reach the MCP/agent content path (verified).** Voice reaches generation in two layers:
   - **Layer 1** — voice *samples* / legacy block via `effectiveBrandVoiceBlock` inside the intelligence `promptContext`.
   - **Layer 2** — voice *DNA + guardrails*, injected into the **system message** by `buildSystemPrompt()` (`server/prompt-assembly.ts`) only when the profile is calibrated.
   - Server-side generation (`content-brief.ts`, `content-posts-ai.ts`) calls `buildSystemPrompt` → gets both layers. **The MCP path does not:** `prepare_brief_context` / `prepare_post_context` return `context.promptContext` only (`server/mcp/tools/content-actions.ts:648`), and an external agent never calls `buildSystemPrompt`. So agents get **Layer 1 only** — no voice DNA, and for a *calibrated-without-samples* workspace, effectively no voice at all. Stacked with #2, an agent generating brand content via MCP is close to brand-blind.

**Net:** an agent (or scheduled fleet) generating content through the MCP cannot see the brand's mission/values, and cannot see the distilled voice DNA. This is a content-quality gap, not just an access gap.

## 2. Goals / Non-goals

**Goals**
- One coherent **`brand` intelligence slice** that carries identity + voice as the single source of brand context.
- Close the agent-facing gaps: the MCP content path and a future brand MCP read tool get complete brand context **without** depending on `buildSystemPrompt`.
- **Additive / phased rollout** — zero immediate blast radius; no big-bang move of `effectiveBrandVoiceBlock`.

**Non-goals (this design)**
- No change to the *server-side* generation prompt assembly (it already gets full voice).
- No new brand **write** MCP tool in phase 1 (tracked as a later, separate decision — see §7).
- No change to the voice-calibration UX or the `BrandDeliverable` admin feature itself.

## 3. Decisions

- **[DECIDED]** Unified `brand` slice (voice + identity), **not** a net-new identity-only slice. Rationale: solves fragmentation *and* the voice-DNA-to-agent gap; matches how the owner reasons about brand.
- **[DECIDED]** **Additive rollout via delegating shim** — the new slice becomes canonical; `seoContext.effectiveBrandVoiceBlock` is kept as a thin shim that delegates to the brand source, so the ~7 existing consumers keep working untouched. Consumers migrate opportunistically; shim retired last.
- **[DECIDED]** **Hybrid representation (option B3):** structured fields for reasoning/UI/MCP-read **plus** single source-resolved prompt blocks for injection. Structured-only would violate the authority-layered-fields rule for voice; block-only loses the MCP/agent reasoning value. (See §5.) **Motivating use case:** an agent injects the resolved block as the *default* brand voice for a general page, but reaches into individual structured fields when a page's job demands emphasis — e.g. an About/Story page pulling **mission + vision + values** forward, or a product page leaning on **positioning + differentiators**. The block gives consistency; the fields give page-type-aware control.
- **[OPEN]** Should voice DNA be exposed as structured fields (`tone[]`, `guardrails[]`) in addition to the prompt block, or only as the block in phase 1? Leaning: structured identity now, structured voice metadata only if a near-term consumer needs it (avoid speculative surface).

## 4. Slice contract

Add `'brand'` to `INTELLIGENCE_SLICES` (`shared/types/intelligence.ts`) and `PROMPT_FORMATTABLE_INTELLIGENCE_SLICES`. Define `BrandSlice` in `shared/types/intelligence.ts` (or a `shared/types/brand-*.ts` imported there).

```ts
export interface BrandSlice {
  // ── Structured (for agent reasoning, UI, MCP read) ──
  identity: {
    mission?: string;
    vision?: string;
    values?: string;          // RESOLVED: string (BrandDeliverable.content is one string blob), not string[]
    tagline?: string;
    elevatorPitch?: string;
    positioning?: string;
    // …extend to the DeliverableType set as needed (brand-engine.ts:182)
  };
  voice: {
    status: 'calibrated' | 'legacy' | 'none';
    // [OPEN] tone?: string[]; guardrails?: string[]; samplesPresent?: boolean;
  };

  // ── Resolved prompt-injection forms (authority applied once, in the source) ──
  /** The single blessed voice block. seoContext.effectiveBrandVoiceBlock delegates to this. */
  voicePromptBlock: string;
  /** Pre-formatted identity block for prompt injection. */
  identityPromptBlock: string;
}
```

**Authority guardrail (mandatory):** prompt consumers inject `voicePromptBlock` / `identityPromptBlock` directly. They MUST NOT re-format the structured `voice`/`identity` fields into prompt text — that would bypass the calibrated→samples→legacy authority chain (CLAUDE.md "Authority-layered fields"; the PR #167 double-voice bug). No generic `formatBrandForPrompt(raw)` helper ships alongside the resolved blocks.

## 5. Source / assembler

`server/intelligence/brand-source.ts` (mirrors `seo-context-source.ts`) exporting `assembleBrand(workspaceId): BrandSlice`:
- **identity** ← `listDeliverables(workspaceId)` / `getDeliverable` from `server/brand-identity.ts`, mapped by `deliverableType`. Use only `status: 'approved'` deliverables for prompt blocks? **[OPEN]** (draft vs approved policy).
- **voicePromptBlock** ← move/relocate the body of `buildEffectiveBrandVoiceBlock` here (authority: calibrated profile → voice samples; else legacy brandVoice + brand-docs; else empty). `voice.status` derived from the same resolution.
- **identityPromptBlock** ← formatted once here from the structured identity.
- Register in `server/workspace-intelligence.ts` facade + `slice-metadata-registry.ts`.

**Shim:** `seo-context-source.ts:buildEffectiveBrandVoiceBlock` becomes a 1-line delegate to the brand source (or `seoContext`'s assembler reads `assembleBrand().voicePromptBlock`). `seoContext.effectiveBrandVoiceBlock` stays populated and identical → existing consumers unaffected.

## 6. Consumer migration (the ~7, opportunistic)

Direct readers of `effectiveBrandVoiceBlock` / `buildSeoPromptBlocks().brandVoiceBlock` today (keep working via shim; migrate to `brand` slice when each is next touched):
- `server/internal-links.ts:306`
- `server/webflow-bulk-alt-background-job.ts:52`
- `server/webflow-bulk-seo-fix-background-job.ts:97`
- `server/intelligence/page-assist-context-builder.ts:127`
- `server/copy-generation.ts:517`
- `server/intelligence/formatters.ts:78,297` (seoContext formatter)
- `server/intelligence/generation-context-builders.ts:171` (`buildSeoPromptBlocks`)

Retire the shim only after the last consumer moves.

## 7. MCP wiring (the actual payoff)

- **Phase A (read into agent generation):** `prepare_brief_context` / `prepare_post_context` (`content-actions.ts`) expose BOTH (a) the resolved `voicePromptBlock` + `identityPromptBlock` appended to `prompt_context` (the default brand voice for any page) AND (b) the **structured `identity` fields** in the returned payload, so the agent can selectively emphasize per page type (About page → mission/vision/values forward; product page → positioning/differentiators). This is what closes the agent voice-DNA + identity gap. Requires `buildContentGenerationContext` to request the `brand` slice and the MCP tool to surface the structured fields alongside `prompt_context`.
- **Phase B (new read tool):** `get_brand_identity(workspace_id)` — wraps `listDeliverables`/`getDeliverable`, returns the **structured** identity for inspection. Small lift.
- **Phase C (write, separate decision):** `update_brand_deliverable` — wraps `updateDeliverableContent`, already transaction-safe + versioned (`DeliverableVersion`). **Correction (verified 2026-06-26):** `BrandDeliverable` is a simple **two-state** store (`status: 'draft' | 'approved'`, `brand-engine.ts:189`) — NOT a state-machine store. Do NOT wire `getDeliverableTransitions` (that belongs to the unrelated client-facing `ClientDeliverable`). Full write-tool discipline (route-through-service + `addActivity({source:'mcp-chat'})` + `broadcastToWorkspace` + tests); `update_brief` in `content-actions.ts` is the 1:1 template. **Not in scope for phase 1.**

## 8. Phasing

| Phase | Scope | Lift | Unlocks |
|---|---|---|---|
| **P1** ✅ delivered | `brand` slice + `assembleBrand` source + delegating shim; identity structured + both prompt blocks; facade/registry wiring; tests | M | Brand visible to AdminChat + content-gen context; foundation |
| **P2** ✅ delivered | Point MCP `prepare_*_context` at the brand slice (+ Layer-2 `voiceDnaBlock` from the new `voice-dna-layer2.ts` leaf) | S | **Agents get full voice + identity** (closes the verified gap) |
| **P3** | `get_brand_identity` MCP read tool | S | Agent/inspection read of structured identity |
| **P4** | Opportunistic consumer migration → retire shim | S (spread) | Removes the two-homes-for-voice debt |
| **P5** *(separate)* | `update_brand_deliverable` write tool | M | Agent-authored brand identity w/ versioning |

Each phase is one PR (phase-per-PR rule). P2 is where the value lands — do not stall before it.

**P2 as delivered (2026-06-29):** Implemented as MCP-only wiring per §7 Phase A — NOT a formatter/`baseSlices`/`PROMPT_FORMATTABLE` change (server-side generation already gets full voice via `buildSystemPrompt`; only the external MCP/agent path was brand-blind). The two Layer-2 renderers (`voiceDNAToPromptInstructions`, `guardrailsToPromptInstructions`) were moved verbatim from `prompt-assembly.ts` into a new cycle-safe types-only leaf `server/voice-dna-layer2.ts` (single source of truth; `prompt-assembly` re-exports them — `buildSystemPrompt` output byte-identical). `BrandSlice` gained `voiceDnaBlock` (calibrated-only). `prepare_brief_context`/`prepare_post_context` fetch the brand slice separately and append **only** `voiceDnaBlock` + `identityPromptBlock` (never `voicePromptBlock` — already inside `context.promptContext` via `seoContext`; double-voice guard), plus surface structured `brand_identity` + `voice_status` payload keys. Plan: `docs/superpowers/plans/2026-06-29-brand-slice-p2.md`.

## 8a. Lift estimate (baseline — 2026-06-26)

Grounded against HEAD `271a019e5` (10-agent estimate + adversarial completeness/claim check; calibrated for solo founder + heavy AI-assisted coding). **Baseline only** — a full `pre-plan-audit` precedes the real plan (slices are being actively decomposed on staging, so the consumer graph is a snapshot).

| Phase | Size | Hours | PRs | Note |
|---|---|---|---|---|
| **P1** slice + source + shim + identity + blocks | M | 13–23h | 1 | Foundation; shim-parity test is the guard |
| **P2** MCP `prepare_*_context` wiring | S | 6–9h | 1 | **The payoff** |
| **P3** `get_brand_identity` read tool | S | 4–7h | 1 | Cheap, high-value |
| **P4** consumer migration + retire shim | L | 12–22h | 1 | Riskiest (silent voice loss); deferrable |
| **P5** `update_brand_deliverable` write tool | M | 5–8h | 1 | Independent |

**Full P1–P5: ~40–69h / 5 PRs. MVP (P1+P2): ~19–32h / 2 PRs** — delivers the entire stated payoff (agents get full brand voice + identity via MCP). +P3 for ~4–7h. P4/P5 are not MVP; the shim lets P4's debt be carried indefinitely.

**Dominant cost drivers:** (1) slice-registration lockstep — ~7 mechanically-forced sites incl. a second cold-start voice read at `formatters.ts:79`; (2) shim parity + P4 retirement across **6** `effectiveBrandVoiceBlock` + **11** `brandVoiceBlock` readers and **~42** test files (silent voice loss is invisible to `tsc`); (3) the two `prepare_*` handlers diverge (`filter+join` vs direct return) and both must surface structured identity; (4) per-PR tax from the documented-flaky full vitest run + mandatory doc lockstep.

## 9. Testing / verification

- Contract test: `'brand'` present in `INTELLIGENCE_SLICES`, formattable list, and slice-metadata registry (mirror existing slice contract tests).
- Unit: `assembleBrand` authority resolution (calibrated-with-samples / calibrated-no-samples / legacy / none) and identity mapping.
- **Shim parity test:** `seoContext.effectiveBrandVoiceBlock === assembleBrand().voicePromptBlock` for representative fixtures — guarantees zero behavior change for the 7 consumers.
- Integration: `prepare_brief_context` output `prompt_context` includes brand identity + voice for a calibrated fixture workspace (the regression that proves P2).
- Gates: `npm run typecheck`, `npx vite build`, `npx vitest run`, `npx tsx scripts/pr-check.ts`, `npm run verify:platform:quick`.

## 10. Open questions (decide before P1 code)

1. **[OPEN]** Structured voice metadata (`tone[]`/`guardrails[]`) in P1, or block-only + `voice.status`? (Leaning block-only first.)
2. **[OPEN]** Draft vs approved `BrandDeliverable`s in the prompt blocks — approved-only, or all with a marker?
3. **[RESOLVED 2026-06-26]** `values` is a **`string`**, not `string[]` — `BrandDeliverable.content` is a single string column (`brand-engine.ts:195`); each `deliverableType` (incl. `values`) stores one content blob. So `identity.values?: string`.
4. **[OPEN]** Net-new `brand-source.ts` vs extending `seo-context-source.ts` — leaning separate file for ownership clarity.

## 11. References
- Audit: `docs/audits/2026-06-26-mcp-surface-audit.md`
- Slices: `shared/types/intelligence.ts:27`; `docs/rules/workspace-intelligence.md`
- Voice authority: `server/intelligence/seo-context-source.ts:121`; `server/intelligence/formatters.ts:284`; `server/prompt-assembly.ts` (Layer 2)
- Brand identity store: `server/brand-identity.ts`; `shared/types/brand-engine.ts:180`; route `server/routes/brand-identity.ts`
- MCP content path: `server/mcp/tools/content-actions.ts:627`
- Authority-layered-fields rule + intelligence-wiring rule: `CLAUDE.md` (Code Conventions / Data Flow Rules)
