# Client Revenue Round 2 — Implementation Plan

> **Specs:** docs/audits/client-dashboard-2026-06/02-significant-changes.md — §1 (agency-at-work feed), §3 (competitor benchmarking) — plus kwv roadmap notes (striking-distance, rank-x-missing-y) and the R1 cart rails for content-in-cart.
> **Branch:** feat/client-revenue-r2, stacked on feat/client-revenue-r1 (#1219, green; cart lane depends on its rails). Diff collapses when R1 merges.
> **TIER-COUPLING NOTE:** the owner's tier-model rediscussion (roadmap: `tier-model-rediscussion`, brainstorm-gated) is pending. Lanes R2-A and R2-E keep tier touchpoints THIN — gate via the existing `TierGate`/tier-check mechanism and express the discount as checkout config, so the brainstorm can re-map with config-level changes.
> **Platform:** Claude ladder. **Bounded context:** client-portal / analytics-intelligence.

## Lanes (5, parallel, exclusive ownership)

### R2-A — Competitor keyword gaps (Premium surface) (Opus)
Spec §3. Client-facing competitor benchmarking: per-keyword "you vs them" using the EXISTING gap stores (`keyword_gaps` table, migrations 088-090) and competitor rank evidence — read what the admin Strategy/CompetitiveIntel already computes and PROJECT it client-safe (no raw provider dumps; respect the client-insight framing rules: narrative, no admin jargon, no purple). Surface: a section/tab in the client portal per the spec's placement (read §3's UX). Gate behind `TierGate` (premium) — one mechanism, thin. Server: a public route projecting gap + benchmark data (leak-check any money/EMV fields per the established strip pattern). Tests incl. the actual public read path + tier-gating.
**Owns:** new client component(s) under src/components/client/, the public route + projection, related tests.

### R2-B — "Agency at work" feed (Sonnet)
Spec §1. Client-visible activity feed with narrative framing: CLIENT_VISIBLE_TYPES activity + in-progress jobs ("Your metadata fixes are in progress") — read §1 fully for the framing/grouping rules and what's deliberately excluded. Server: public endpoint over the activity log (paginated via the R1-C helper!) + running-jobs projection (labels via getBackgroundJobLabel). Client: feed component placed per spec. Both Data Flow halves for live updates (existing activity/job events → central invalidation).
**Owns:** the public feed route/projection, new client feed component(s), related tests.

### R2-C — Striking-distance keywords (Sonnet)
kwv note: the page-2 nudge list — positions 11–20, value-ranked, the classic agency easy-wins artifact. Admin-first: a Hub segment or Strategy section (read where positions live — tracked keyword rows carry position; the value score exists). Each row: keyword, position, value, the page, and a next-action (existing deep links: brief from gap / view in hub). Server: derive from existing rank+value data (no new provider calls).
**Owns:** the admin surface addition (Hub segment or strategy component — your judgment after reading both), any server derivation, tests.

### R2-D — Client "You rank for X, missing Y" per-page cards (Sonnet)
kwv note: per-page cards on the client Strategy tab pairing what a page ranks for vs the gaps it's missing — sources: page keywords (table) + keyword gaps per page. Client-safe projection (banded/labeled value, not raw scores — follow the briefing projection patterns), narrative copy. Respect the client Strategy tab's existing structure.
**Owns:** the client strategy card component(s), the projection addition (public route or existing payload extension), tests.

### R2-E — Content in the cart + Premium content discount (Opus)
Owner-approved scoping (roadmap `cda-content-in-cart`). Briefs/posts become cart-addable ALONGSIDE the existing Buy-now flow (additive — never add a step to one-click purchase):
- Extend the cart item model for content context (keyword/pageSlug/brief params — read what single-purchase checkout sends today and mirror it per-item).
- Server checkout builder: content line items priced from the existing content products; **family dispatch in the webhook** — one session can yield work orders (fixes) AND content requests (briefs/posts) via the existing single-purchase fulfillment paths; FM-2 per family.
- **Premium 10% content discount** (absorbs cda-sc4-content-discount): applied at checkout-build time to content items only, expressed as a single config constant (tier rediscussion may re-map); display original-strikethrough-discounted per MONETIZATION §261 in cart + purchase CTAs.
- Tier wrinkle handled: Premium carts CAN hold priced content while fix rows stay hours-covered (fixes never enter a Premium cart — R1 behavior unchanged).
- "Add to cart" affordances on the existing brief/post purchase surfaces (find them — content purchase CTAs in the client portal).
**Owns:** src/components/client/useCart.tsx + SeoCart.tsx (extension), server/stripe.ts + routes/stripe.ts (content families), the content purchase CTA surfaces, shared cart-item type, tests (incl. mixed-basket checkout integration + discount math + FM-2).

## Dependencies
All five parallel. R2-E builds on R1's cart code (this branch stacks on R1). R2-A/B/D all add client-portal surfaces — DISTINCT components/tabs; ownership above is exclusive; any shared client nav/registration file goes to whichever lane needs it first with the others reporting NEEDS_CONTEXT.

## Verification
Per-lane targeted vitest + typecheck; batch checkpoint (full component+unit, pr-check, build); money-path review (opus) + compliance review before PR; R1's leak/parity tests stay green. Manual staging: mixed basket (2 fixes + 1 brief) → one checkout → work order AND content request; Premium sees content discount but no fix prices; competitor gaps invisible to Growth.
