# Phase A — Ratified Owner Decisions (Fan-out Prep)

**Ratified:** 2026-07-05 by owner (walked one-by-one) · **Status:** LOCKED — these gate Phase A dispatch.
**Source:** the phase-a-discovery workflow (run `wf_0670b5fb-92d`, 18 surfaces, adversarially verified) — consolidated decision list + completeness critique.

## Before-fan-out decisions (AD-001…AD-007) — all defaults accepted

| # | Decision | RATIFIED ANSWER |
|---|---|---|
| AD-001 | Shell freshness/refresh convention | **One Build Convention for all rebuilt surfaces:** freshness meta ("last updated") + manual Refresh with honest copy, applied uniformly (cockpit, ai-visibility, competitors, links, local-presence, performance, site-audit, asset-manager). Scheduled/cron scanning stays a separate per-surface, individually-flagged follow-up. |
| AD-002 | Verdict headlines | **Server-drafted fields only, never client-composed** (template-first, AI-upgradeable later). Green-lights sn-cockpit-1, sn-engine-2, sn-performance-2 + the site-audit template as the shared pattern. Extends the no-client-verdicts hard floor to narrative headlines. |
| AD-003 | Admin money-frame + provenance | **Approved:** value-at-stake / recovered-so-far dollars via **cron-precomputed** server fields (never compute-on-render — the computeROI snapshot-write trap generalized) + an estimate/measured/actual **basis pill** mirroring the client's. = SB-003, stays wave-1. |
| AD-004 | Insight-graduation bridges | **Deferred wholesale to one C3-era owner-signed cross-surface contract.** No rebuild surface builds an ad-hoc graduation write; surfaces ship parity + a DEF-* row. **Demotes SB-001 (blocker→C3-later).** SB-002 (inbox request → rec/insight mint) is treated as covered by the same rationale — confirm at plan-writing, flagged for visibility. |
| AD-005 | Lane assignment (insights, recommendations) | **Split by half:** client-facing renders ride the **C-lane** (D4's C1→C2→C3, client flags e.g. strategy-the-issue / client-ia-v2); only the operator/admin halves ride the **A-lane** `ui-rebuild-shell` flag. Resolves blocking hole #2. |
| AD-006 | Flag disposition | **The Phase A plan enumerates the full per-flag mapping** — UI-shell flags → rebuild retirement track; backend/phase/tier gates (local-gbp, gbp-auth-*, strategy-the-issue, strategy-competitor-send, the-issue-client-*) stay lifecycle-governed. No surface retires a flag outside the mapping. |
| AD-007 | Missing Parity Ledger rows | **Add the rows before any build PR:** "Workspace Home → Cockpit (+Today)" + the entire absent Global-Ops zone (12+ pages), each with an explicit build-or-cut ticket. Nothing silently dropped. |

## Blocking-hole resolutions (beyond the AD list)

| Hole | RATIFIED ANSWER |
|---|---|
| #1 Meeting Brief ownership | **RETIRED — owner cut 2026-07-05 ("we no longer need the meeting brief").** A deliberate, owner-signed retirement, not a silent drop. Ships as a small cut-ticket: remove Page `brief` via the route-removal checklist, D8 redirect map, retarget/remove its deep-link senders (it was one of the 12+ keyword-hub senders), correct the misattributed Parity Ledger row to "retired by owner." |
| #2 Insights/Recs lane | Resolved by AD-005 (split by half). |
| #3 Site Audit "3→1" scope | **Both readings combined:** Site Audit becomes the ONE triage hub — absorbs Performance-triage (CWV) + Links-triage (broken/internal links) as audit categories (Reading A; Performance and Links survive as dedicated deep workshops) — AND its bundled sub-tools split out: Content Health → Pipeline, AI Search Ready (AEO) → AI Visibility (Reading B). **Sequencing rule:** the out-moves dispatch only after the receiving homes are decided at those surfaces' ticket-cut (ai-visibility Q4, content-pipeline Q6). |

## Effect on the server backlog critical path

- SB-001 (graduation write seam, L) — **off the critical path** (C3-later per AD-004).
- SB-002 (request→signal mint, M) — **deferred under AD-004's rationale**, confirm at plan-writing.
- SB-003 (money-frame projection, M) — **approved, wave-1** (AD-003).
- SB-004 (work-queue classification, L) — remains, but consumers are only cockpit+global-ops → schedule with that wave, not ahead of everything.
- Early items SB-005 (per-page projection), SB-006 (win/early/flat verdict), SB-026 (Webflow redirect-create) — unchanged, wave-1-adjacent.

## Standing instructions for the Phase A plan (from the completeness critique)

1. Per-surface tickets consume the **VERIFIER-adjusted** serverNeed homes/efforts, never the gatherer originals (~6 corrections: sn-brand-ai-1 → ai-context-check.ts; sn-cockpit-3 → outcome-tracking.ts:139 OutcomeProvenance; sn-content-pipeline-2 module fix (-4 refuted); sn-global-ops-5 effort down; sn-schema-3 detection+bridge only; sn-performance-2 verdict already server-side).
2. The remaining **22 per-surface-dispatch decisions** are resolved at each surface's ticket-cut (they gate tickets, not the fan-out).
3. Two provider-payload unknowns get **one live API probe each** before their effort numbers are committed: Webflow v2 list-assets width/height (sn-asset-manager-1), DataForSEO domain-rank/top-3 (sn-competitors-1).
4. Cross-surface contract to pin before wave 1: who mounts InsightsEngine's rec set in the new IA (insights ↔ recommendations, important-hole).
