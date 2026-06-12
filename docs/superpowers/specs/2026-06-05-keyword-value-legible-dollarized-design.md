# Legible + Dollarized Keyword Value — Design

**Date:** 2026-06-05
**Owner:** analytics-intelligence
**Status:** Design approved (decisions locked); ready for implementation plan
**Baseline:** staging `f896d7bc` (post score-consolidation keystone)
**Roadmap:** `sprint-keyword-value-amplification-2026-06-05` — items `kwv-real-cpc`, `kwv-value-breakdown`, `kwv-dollar-value`

---

## 1. Goal

Make the keyword value score **legible** (plain-language "why this is worth it") and **dollarized** ("$/mo, and the upside if you move it up") on the surfaces clients and the agency already use — building on the consolidated value model, **reusing existing pipelines**, and creating **no new dollar engine, no new client tab, and no merge** with the recommendation breakdown.

## 2. Locked decisions (owner-approved)

| # | Decision | Detail |
|---|----------|--------|
| D1 | **Client-first, admin too** | Priority is the client `StrategyKeywordDrawer`; the admin Hub `KeywordDetailDrawer` gets the same breakdown + $. |
| D2 | **One dollar definition: realized + uplift** | `$/mo = clicks × cpc` (exactly ROIDashboard's `trafficValue`), upside = `Δclicks-if-moved-up × cpc`. Intent stays in the value SCORE, never in the $. No intent-weighted EMV at the $ layer (that stays internal). |
| D3 | **Ride existing pipelines** | No new endpoint/hook. ROIDashboard via its existing `/api/public/roi` query; the drawers via the existing keyword-strategy / KCC serialization. |
| D4 | **Keyword-value breakdown ≠ OV breakdown** | The Layer-1 keyword-value components render on the *keyword* surfaces; OV's 7-component recommendation breakdown stays on the `#1 priority` card. They coexist (distinct layers), no reconciliation/merge. |
| D5 | **Reuse, don't duplicate** | One `keywordDollarValue` formula + one `keywordValueReasons` formula, each defined once and called by every consumer. |

## 3. Two shared helpers (the "define once" core)

Both pure, server-side, unit-tested. They are the anti-duplication guarantee.

**`keywordValueReasons(components, raw): string[]`** — plain-language reasons from the Layer-1 `KeywordValueComponents` (`commercialValue/demand/winnability/localMultiplier/intent`, shipped in PR #1102, `server/scoring/keyword-value-score.ts:166`). Mirrors OV's `evidence`-string pattern. Ordered by contribution. Examples:
- intent + cpc → `"Commercial intent · $9 CPC"` (or `"Transactional intent"` when no cpc)
- winnability → `"Winnable · KD 24"`
- demand → `"Strong demand · 2,400/mo"`
- local (only when `localMultiplier > 1`) → `"Local boost ×1.5"`

**`keywordDollarValue({ clicks, cpc, currentPosition, impressions, ctrCurve }): { currentMonthly, upsideMonthly }`** — THE single dollar definition:
- `currentMonthly = (clicks ?? 0) × (cpc ?? 0)` (identical to `roi.ts` `value = clicks * cpc`).
- `upsideMonthly = max(0, (impressions ?? 0) × (ctrAt(target) − ctrAt(currentPosition))) × (cpc ?? 0)`, where `target = currentPosition ≤ 3 ? max(1, currentPosition−1) : 3` (matching `opportunity-value.ts` `targetPosition`). Reuses the exported `ctrAt`/`buildCtrCurve` (`server/scoring/ctr-curve.ts`).
- **No `intentWeight`** — realized dollars only (D2).

Home: a small `server/scoring/keyword-value-money.ts` (the $ helper) + `keywordValueReasons` alongside the components in `keyword-value-score.ts`. Both consumed by `roi.ts`, the KCC builder, and the client strategy builder — one definition, many callers.

## 4. Phasing — one spec, 3 PRs

### PR 1 — `kwv-real-cpc` (foundation: accurate content-gap score input)

Content-gap value scores use `CPC_UNKNOWN` (0.5) because `ContentGap` has no `cpc`. The enrichment loop already has real CPC on the domain-hit (`keyword-strategy-enrichment.ts:437-440`) and API (`:449-456`) paths — the sibling `pageMap` branch already populates `pm.cpc` (`:330/355/403`); the content-gap branch just drops it. **DB column + mapper lockstep (one commit):**
- Migration: `ALTER TABLE content_gaps ADD COLUMN cpc REAL;` (new migration file).
- Types: `cpc?: number` on `ContentGap` (`shared/types/workspace.ts:76-106`) and `StrategyContentGap` (`keyword-strategy-ai-synthesis.ts:65-93`).
- Mapper (`server/content-gaps.ts`): `cpc` on `ContentGapRow` + `rowToModel` + `modelToParams` + the UPSERT column lists.
- Enrichment populate (`keyword-strategy-enrichment.ts`): `cg.cpc = domainHit.cpc` (`~:440`) and `cg.cpc = m.cpc` (`~:456`).
- Pass `cpc: cg.cpc` (not `undefined`) into `computeKeywordValueScore` at `:599`.
- Public serialization: add `cpc` to the content-gap field list in `server/routes/public-content.ts` only if content-gap cpc is client-exposed (else admin-only).

Effect: content-gap `commercialValue` reflects real CPC. Changes content-gap scores on next strategy gen (verify on staging after regen). Tests: round-trip `listContentGaps` with cpc; a content gap with a real cpc scores differently from the 0.5 proxy.

### PR 2 — `kwv-value-breakdown` (the "why it's worth it" reasons)

- **`keywordValueReasons`** helper (§3) + unit tests.
- **Reasons are computed SERVER-side** (one helper, from the value components) and **serialized** onto the keyword data — a peer field `valueReasons?: string[]` alongside `explanation`:
  - Admin KCC: build in `finalizeDraftRow` (`server/keyword-command-center.ts:1279-1344`) from the row's value components (the Hub already computes `valueScore`; expose its components via `computeKeywordValueComponents` and pass through `keywordValueReasons`). Add `valueReasons?: string[]` to `KeywordCommandCenterRow` (`shared/types/keyword-command-center.ts`).
  - Client strategy: the client `buildKeywordRow` (`StrategyTab.tsx:558-626`) is a *renderer* of server data — so build `valueReasons` in the **server keyword-strategy serialization** that produces the strategy rows' `explanation`/`opportunityScore` (the same place the value score is known), serialize it through, and have the client `buildKeywordRow` attach it onto `StrategyKeywordTableRow` (`strategyKeywordDisplay.ts:18-42`, add `valueReasons?: string[]`). The exact server serialization function is a **plan-time grounding** (see §7 stale-grounding guard) — do NOT compute reasons client-side (it would re-derive the components off the score's source of truth).
- **Render** (no new component — extend existing sections):
  - Client `StrategyKeywordDrawer.tsx` "See the numbers" / "Why it's in the strategy" — render `valueReasons` as muted reason rows (reuse the OverviewTab evidence-row pattern; **blue for data**, Four Laws).
  - Admin Hub `KeywordDetailDrawer.tsx` — a "Why this score" section.
- Tier/boundary: reasons carry no $; safe for all tiers. Tests: reasons content for each component; rendered in both drawers; absent when no components (gated keyword).

### PR 3 — `kwv-dollar-value` (the per-keyword $ + portfolio "revenue at stake")

- **`keywordDollarValue`** helper (§3) + unit tests (current = clicks×cpc; upside via ctrAt; matches a `roi.ts` per-page `trafficValue` for the same inputs).
- **CPC join onto the keyword surfaces** (the only missing input): `cpc` is on `page_keywords` + ROI but not yet on `StrategyKeywordTableRow` or `KeywordCommandCenterRow`. Join it from `page_keywords` in the two builders (the same source ROI uses). *(KCC `metrics.cpc` already exists on the type — populate it in `populateDraftRows` from page_keywords; strategy row gets `cpc` in `buildKeywordRow`.)*
- **Per-keyword $ on the drawers**: `currentMonthly` + `upsideMonthly` rendered in `StrategyKeywordDrawer` (a "Revenue potential" block) and the Hub drawer — **emerald for $/success** (`scoreColor`/existing ROI styling), reusing ROIDashboard's `fmtMoney`.
- **ROIDashboard "Revenue at stake"**: extend `ROIData` (`shared/types/roi.ts`) with a portfolio `revenueAtStake` (Σ `upsideMonthly` over tracked keywords) computed in `computeROI` (`server/roi.ts`) reusing the SAME helper, rendered as a 4th hero `StatCard` in `ROIDashboard.tsx:109-144`. No endpoint change (rides `/api/public/roi`).
- Tier/boundary: ROIDashboard is Growth+ tier-gated and already shows realized $ (`clicks×cpc`); the per-keyword realized $ is the same class — no new exposure. The intent-weighted EMV (`opportunity-value.ts`) stays internal (already stripped at the public boundary).
- Tests: helper math; `revenueAtStake` rollup; per-keyword $ rendered; ROIDashboard hero stat; byte-check that `currentMonthly` equals ROIDashboard's per-page `trafficValue` for matching inputs (one $ definition).

## 5. Anti-duplication guardrails (explicit non-goals)

- **One $ formula** — `keywordDollarValue`; `roi.ts` realized value and the per-keyword $ share the `clicks × cpc` definition. No second dollar engine; no contradictory $ for the same keyword/page.
- **One reasons formula** — `keywordValueReasons`; do not hand-roll reason strings per surface.
- **No merge with OV** — the keyword-value breakdown is distinct from OV's `OpportunityComponent` recommendation breakdown (D4). Do not touch the OverviewTab "Why this is #1" render.
- **No new endpoint, no new client keyword tab** — extend existing rows/queries/drawers/ROIDashboard.
- **No EMV/ROI/calibration math changes** — the value SCORE and the OV model are untouched; this is display + the realized-$ helper + the content-gap cpc input.

## 6. Testing strategy

- **Unit:** `keywordValueReasons` (per-component strings, ordering, local-only-when->1, no-cpc fallback); `keywordDollarValue` (current=clicks×cpc, upside via ctrAt target rule, 0-floor, missing-data → 0); the `currentMonthly` == `roi.ts trafficValue` equivalence (one definition).
- **Integration:** PR 1 content_gaps cpc round-trip + score delta; PR 3 `computeROI` `revenueAtStake` rollup.
- **Component:** the reasons render in both drawers; the per-keyword $ block renders; the ROIDashboard "Revenue at stake" hero stat; tier-gating preserved.
- **Gates:** typecheck/build/`pr-check` (incl. the score-color + Four-Laws rules — $ = emerald, data = blue)/coverage-ratchet; the touched suites green.

## 7. Risks & non-goals

- **CPC sparsity** — `cpc` is often absent (providers coerce to 0); the $ helper floors to 0 (no $ shown when cpc unknown). The reasons still render (intent/winnability/demand don't need cpc). Acceptable.
- **CPC join cost (PR 3)** — joining cpc onto the two keyword builders is the main new wiring; it reuses the page_keywords source ROI already reads.
- **real-cpc blast radius** — PR 1 shifts content-gap scores (verify on staging after a strategy regen, like the consolidation).
- **Non-goals:** the OV breakdown render, the EMV/ROI math, striking-distance/momentum/insights items (separate roadmap items), a new keyword tab or dashboard.
- **Stale-grounding guard:** the file:line refs here are from staging `f896d7bc`; the plan must re-confirm exact functions/lines at execution — specifically the server keyword-strategy serialization that feeds `StrategyKeywordTableRow` (the precise function that attaches `explanation`/`opportunityScore`), the `page_keywords` cpc-join points in both keyword builders, and the content-gap public-serialization field list.

## 8. For owner review

This is a self-contained track (3 PRs) building on the consolidated value model. One thing to confirm during spec review: whether the **per-keyword $ should be client-visible** (D2 says yes — it's the same realized `clicks×cpc` ROIDashboard already shows Growth+ clients) or admin-only first. The spec assumes client-visible behind the existing Growth+ tier gate.
