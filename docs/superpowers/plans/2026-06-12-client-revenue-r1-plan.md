# Client Revenue Round 1 — Implementation Plan

> **Spec:** docs/audits/client-dashboard-2026-06/02-significant-changes.md §5 (Health tab → revenue) — UX, data flow, tier placement, risks all specified there. This plan adds the execution layer only.
> **Pricing ground truth (NOT open decisions):** MONETIZATION.md — $20/page meta, $39/page schema, $19/redirect, $50 flat alt-text; Metadata Pack $179/10pg, Schema Pack $299/10pg; **Premium sees no fix prices** (hours-covered framing → work-order flow), so bundle pricing and the Premium content discount never interact on fixes.
> **D-IMPACT — DECIDED 2026-06-12: conservative banded $ ranges.** Monthly ranges (e.g. ~$80–$160/mo) from emvPerWeek×4.33 with conservative band rounding, a display floor (~$25/mo — below it, no impact line), an upper display cap, and the ROI-style (i) methodology popover.
> **Descoped from round 1:** `kwv-one-score-everywhere` (roadmap-flagged KEYSTONE, brainstorm first — own round).
> **Bounded context:** client-portal / monetization. **Platform:** Claude ladder.

## Lanes (3, parallel, exclusive ownership)

### R1-A — Fix catalog + server money paths (Opus)
**Owns:** new `shared/types/fix-catalog.ts`, the Stripe checkout-session builder additions (server/ payments path — locate the existing per-item purchase builder), the `impactBand` projection in the ClientIntelligence/recommendations client payload, related server tests.
**Contracts:**
- Typed const catalog: issue/fix type → { stripe product env key, unit price, bundle family, bundle pack { size, price } } — single object imported by BOTH HealthTab rendering and the server checkout builder (price-display drift is the spec's named risk; a contract test pins client map === server map).
- Bundle math server-side in the checkout session builder per MONETIZATION §233 (1–9 per-page; 10+ → pack suggestion; alt-text always flat). Cart UI mirrors, never computes authoritative totals.
- `impactBand` on the client recommendation projection: banded per owner decision D-IMPACT — **never raw `emvPerWeek`**; the existing leak test (`tests/integration/recommendations-public-emv-leak.test.ts`) stays green and a NEW contract test pins the banding function (floor, rounding, cap).
- Post-purchase fulfillment lands as a work order exactly like existing per-item purchases (read the existing flow; no new fulfillment machinery).
**Tests:** catalog parity contract; checkout-session bundle math (1, 9, 10, 23 items; mixed families; alt-text flat); impactBand unit (floor/band/cap) + leak test still green; FM-2 Stripe-error path.

### R1-B — HealthTab purchase surface (Sonnet)
**Owns:** `src/components/client/health-tab/*` (extract touched sections from the 881-line HealthTabSections per platform-organization — don't grow the god component), cart-summary UI, related component tests. READS: useCart/SeoCart (existing), the catalog + impactBand types from R1-A's shared file (**R1-A commits-first is NOT possible in-batch — the shared catalog shape is pre-declared here**: `FIX_CATALOG: Record<FixType, { label; priceUsd; bundleFamily; pack?: { size; priceUsd } }>` and `impactBand?: { band: 'low'|'medium'|'high'; monthlyRangeUsd?: [number, number] }` on the client recommendation item).
**Contracts:**
- Fixable issue rows: "Fix this — $X" teal CTA → `useCart.add()`; impact line per D-IMPACT with the ROI-style "(i)" methodology treatment; only on fixable types present in the catalog.
- Sticky in-tab cart summary when items present ("3 fixes — $147 · est. +$X/mo"), `--z-sticky`, dismiss-safe.
- Pack suggestion surfaced when a family crosses 10 (mirrors server math; copy per MONETIZATION).
- **Premium tier:** rows show "Covered by your implementation hours — request fix" → existing work-order/request flow; zero prices rendered (TierGate/tier check per existing patterns).
- Four Laws: teal CTAs, blue data, no purple; client-facing narrative tone per ui-vocabulary.
**Tests:** row renders price + adds to cart (Growth); Premium variant renders hours-framing and no prices; sticky summary math mirrors cart; impact line absent below floor; bundle suggestion at threshold.

### R1-C — Pagination enabler (Sonnet)
**Owns:** the unbounded client list endpoints flagged in the audit (approvals, client-actions, requests, content-plan cells, audit-detail pages — verify the list by reading the routes), additive `limit/offset` (or cursor where the table demands) with generous defaults that change NO current client behavior, db-layer LIMIT support where missing, related integration tests. This also clears the W6 carried-forward pagination debt — update that roadmap note when done.
**Contracts:** additive params only; default = current behavior (full list) unless a payload exceeds a sane cap; response gains `pageInfo` only when params are passed (back-compat).
**Tests:** per endpoint — default unchanged shape; limit/offset honored; cap behavior.

## Dependencies
All three lanes parallel. R1-B codes against R1-A's pre-declared shared shapes (the one cross-lane contract — both prompts carry it verbatim). R1-C is independent.

## Verification
Per-lane targeted vitest + typecheck; controller batch checkpoint (full component+unit, pr-check, build); leak test explicitly re-run; review round (logic + compliance) before PR. Manual staging pass: add fixes to cart as a Growth client fixture → Stripe test checkout → work order appears; Premium fixture shows hours-framing.

## Round 2 (queued, not this PR)
`cda-sc4-competitor-gaps`, `cda-sc5-work-feed`, `kwv-striking-distance`, `kwv-client-rank-x-missing-y`; `kwv-one-score-everywhere` keystone brainstorm scheduled separately.
