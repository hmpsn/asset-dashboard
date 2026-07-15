# Phase 0 Sign-off Pack — UI Rebuild

**Date:** 2026-07-03 · **Branch:** `ui-rebuild-phase-0` (== post-Reconcile `origin/staging` @ `3ee655f68`)
**Status:** ✅ SIGNED OFF 2026-07-03 — owner ratified all defaults. The locked answers live in [PHASE_D_DECISIONS.md](PHASE_D_DECISIONS.md); first execution plan: [F1 tokens](../../superpowers/plans/2026-07-03-ui-rebuild-f1-tokens.md).
**Produced by:** 46-agent audit program across 3 workflow runs (2 usage outages, fully recovered) — 20 surface parity auditors · 4 cross-cutting auditors · 10-persona evaluative panel · 4 UX-craft + 2 strategic-fit auditors · 2 adversarial verifiers (396 claims) · 1 validator (35 claims) · 1 strategist · 1 synthesizer.

---

## 1. The two verdicts

**Parity audit:** the prototype-as-spec under-covers HEAD badly. Across 20 surfaces / ~1,000 enumerated capabilities, **396 at-risk items were adversarially verified CONFIRMED** — real HEAD capabilities with no visible home in the new IA. The additive-only mandate is not currently satisfiable by building "what the mockups show." (Caveat recorded: verification confirmed 100% of claims — evidence is file:line-specific on both sides and spot-checks hold, but finder/verifier independence was weak; treat CONFIRMED as "evidence-checked", and the ledger-as-DoD mechanism in §5 as the real enforcement.)

**Design review:** **"Conditional yes — right build, not yet a safe spec."** All 10 personas: *partially built to my spec*; 8× *matters: a lot*; multi-location operator: **blocker** (no location dimension anywhere); VC + HVAC check-signer: trust-but-not-compelled. The organizing concepts (VERDICT→VALUE→PROOF trust spine, provenance-labelled money, Command Center triage, send boundary, dual-register recommendations) are validated, category-leading wins to protect. But the spec ships **14 CONFIRMED launch-blockers** (full detail: [`docs/superpowers/audits/2026-07-03-ui-rebuild-prototype-persona-audit.md`](../../superpowers/audits/2026-07-03-ui-rebuild-prototype-persona-audit.md)), headlined by:

1. **Two competing client-facing designs ship unresolved** (portal.js story-microsite vs the tabbed Client Dashboard Mockup) — and the one that reads as "the client experience" hardwires a **traffic-led verdict** (portal.js:382-388), the exact pattern clients fire agencies over.
2. **The business is missing from the design** — zero client-side monetization (TierGate/trial/plans/checkout absent from every mockup), no notification spine on either side of the send boundary, ratified two-zone rail unimplemented (`const book = []`).
3. Estimate-dollar heroes with false precision on client-facing surfaces; purple reaching client views; D-DIN-PRO physically lacks tabular numerals; the four-state matrix exists only as prose; keyboard-inaccessible row→drawer in the flagship primitive; the "18-surface map" silently omits ~10 shipped views.

---

## 2. Phase D — the decision batch (owner, one sitting; blocks everything)

~150 stop-and-asks were consolidated; **8 are Tier-1 blocking** (defaults are the auditors' recommendations; full table in [STRATEGY.md §1](STRATEGY.md)):

| # | Decision | Default recommendation |
|---|---|---|
| D1 | Design-system integration path | **Option C — port/merge under HEAD conventions; kit `.d.ts` = prop floor, HEAD props always win** |
| D2 | Rebuild root path | In-place-behind-flags with `@ds-rebuilt` file markers as lint scope |
| D3 | Page Intelligence's single home | SEO Editor Research mode (ledger's answer) — confirm; this bounds the pilot |
| D4 | Client dashboard gate | **Option C — finish cutover → re-skin ratified 4-tab IA → additive portal ideas** (+ Q2–Q7 below) |
| D5 | Icon system | ~~lucide-react (HEAD)~~ **REVERSED 2026-07-03 → Font Awesome Sharp Regular, self-hosted; `<Icon name>`; lucide is the migration bridge only (PHASE_D_DECISIONS D5, PR #1475)** |
| D6 | Canonical action-color word | Pick "mint" or "teal" (same hex) — updates CLAUDE.md/BRAND_DESIGN_LANGUAGE/pr-check in the tokens PR |
| D7 | Rule severity on rebuild-scoped code | Error from day one |
| D8 | URL scheme + redirect map policy | Redirect map is a required deliverable per consolidation |

**Client-dashboard sub-questions (D4, from [cross-client-dashboard.md §5](cross-client-dashboard.md)):**
- **Q2 tab set:** keep ratified Overview·Inbox·Results·Deep Dive (+Settings)? (kit mockups show two other sets)
- **Q3 theme:** client surface light-by-default (portal.js position) vs HEAD dark-default+toggle?
- **Q4 send-boundary model:** operator-composes→send→client-receives lifecycle — in scope (later flagged phase) or out?
- **Q5 cutover mechanics:** staging flag-ON validation → **global** flip (client `useFeatureFlag` can't per-workspace pilot) → legacy retirement. Confirm.
- **Q6 ROI→Results merge** (retire `?tab=roi` with alias). Approve?
- **Q7 deferred items:** IA v2 P5 multi-location + landing-polish — schedule in this rebuild or keep deferred?

Tier-2 questions (~140) attach to their surface tickets as dispatch blockers — they do not block Phase D.

---

## 3. Build sequence (approved shape, pending D-batch)

`D → F → P → A ∥ C → Z` — full detail in [STRATEGY.md](STRATEGY.md):

- **F Foundations** (sequential spine, ~3 PRs): F1 tokens (21+ missing families, both themes) → F2 consistency gates seeded against the kit Reference Screen → F3 ~16 net-new primitives (2–3 agents, exclusive ownership) → F4 shell wired to existing `navRegistry.tsx` → F5 rolling HEAD-primitive fold-in. *The Handoff Brief's "the pieces are done" is true only as specs — this construction cost is budgeted explicitly so the pilot doesn't silently absorb it.*
- **P Pilot:** Keywords end-to-end (ledger → build → every gate green → PR) — validates conventions + CI gates before any fan-out.
- **A Admin fan-out:** 5 coupling-based lanes, phase-per-PR, staging-first, **starting at 2 concurrent lanes** (sized to owner review capacity, not agent count).
- **C Client-facing** (gated on D4): C1 cutover → C2 re-skin → C3 additive portal ideas, strictly staged.
- **Z Closeout:** compat-layer retirement, route/flag lifecycle, full-platform verification.

---

## 4. Trade-offs & deferred tracking

**14 quick-win/upgrade-later trade-offs** ratified with explicit upgrade triggers ([STRATEGY.md §2](STRATEGY.md)) — headline policy: **T1 carry-over-then-reskin is the default for machinery-dense components** (zero capability loss; visual inconsistency becomes scheduled, expiring debt). Hard floors that are NOT tradeable: client-side money math (T3), fabricated numbers (AI 96%, fake 4-engine coverage), dropping exports, a11y-broken overlays, deleting flagged capability paths without a named home.

**Deferred ledger:** `data/ui-rebuild-deferred-ledger.json` + `verify:deferred-ledger` CI step (schema-validated; expiry → CI failure; scheduled ⇒ roadmap item must exist). Every PR that ships a trade-off adds its `DEF-*` row in the same PR. Ships in F2.

**Consistency auditor:** mechanized layer (adherence lint + new pr-check rules scoped to `@ds-rebuilt` files, error severity) + 3-tier agentic layer matching the Reconcile review cadence (per-PR sweep → per-lane consistency sweep → phase-gate holistic review with Fable judgment seats). Design: [cross-consistency.md](cross-consistency.md); ships in F2.

---

## 5. How the 396 at-risk items get closed (the mandate's enforcement)

Every surface ledger (`surfaces/*.md`) becomes its ticket's **DoD checklist**: each row must be marked preserved / improved / new / ledgered-deferral before that surface PR merges. Phase gates walk the ledgers. At-risk items by surface: Global&Ops 55 · Schema 34 · Keywords 28 · Content Pipeline 27 · Engine 26 · Client portal 24 · Asset Manager 22 · Recommendations 21 · SEO Editor 20 · Search&Traffic 20 · remainder ≤15 each.

## 6. Top success practices & risks

Full lists: [STRATEGY.md §5–6](STRATEGY.md). The five that most bear on how we work: (1) Phase D in one sitting before any code; (2) budget F1–F4 explicitly; (3) ledger-as-DoD per surface; (4) serialize barrier-file merges (`routes.ts`, `navRegistry.tsx`, `tokens.css`, `wsInvalidation.ts`, `queryKeys.ts`, `shared/types/*`) through one owner; (5) flag-ON real-browser smoke per surface — green gates prove correctness, not function. Top risks: R1 capability-loss-by-omission (the hard-stop class), R2 kit-adopted-as-is, R3 decision debt, R4 a third client-IA generation in code.

---

## Document index

| Doc | What it is |
|---|---|
| [STRATEGY.md](STRATEGY.md) | Build sequence, D1–D8, T1–T14, deferred design, consistency design, success practices, risk register |
| [cross-client-dashboard.md](cross-client-dashboard.md) | The D4 gate: options A/B/C + Q1–Q7 |
| [cross-design-system.md](cross-design-system.md) | Kit→production integration paths, token drift, component mapping |
| [cross-platform.md](cross-platform.md) | Nav/URL/theming/data-layer contracts the rebuild must preserve |
| [cross-consistency.md](cross-consistency.md) | Consistency machinery + deferred-ledger design |
| [surfaces/*.md](surfaces/) | 20 per-surface capability ledgers (the DoD checklists) |
| [design-review/](design-review/) | Digest, 4 craft audits, 2 strategic-fit audits |
| [../../superpowers/audits/2026-07-03-ui-rebuild-prototype-persona-audit.md](../../superpowers/audits/2026-07-03-ui-rebuild-prototype-persona-audit.md) | Advisory persona audit: 14 launch-blockers, 10 verdicts, ranked recommendations |
| [checkpoints/](checkpoints/) | Raw structured outputs + verified verdicts (396 + 35) |
