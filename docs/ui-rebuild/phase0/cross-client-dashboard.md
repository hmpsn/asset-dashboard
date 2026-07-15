# Phase 0 GATE — The Client-Dashboard Decision

> **Status: OWNER SIGN-OFF REQUIRED before any client-facing build.**
> Read-only audit, branch `ui-rebuild-phase-0` (== post-Reconcile origin/staging HEAD), 2026-07-02.
> Mandate: the rebuild is ADDITIVE-ONLY. Every capability at HEAD must survive unchanged or improved.

---

## 1. What the Rebuild Kit actually says (three artifacts, three different IAs)

The kit does not contain one client-dashboard spec. It contains **three artifacts with divergent IAs plus its own audit that argues against a redesign**. This conflict is the core of the decision.

| Kit artifact | What it proposes | Tab set | State |
|---|---|---|---|
| `Client Dashboard Plan.html` | Pre-build audit + direction ("REVIEW → PLAN · BEFORE FULL-SCALE DESIGN"). 7 issues (A1–A7), admin-source→client-panel map, 3-phase design sequence starting with Overview | **Overview · Performance · Strategy · Inbox** (4) | Direction doc; predates the IA v2 build at HEAD |
| `Client Dashboard Mockup.html` | Hi-fi interactive mockup, dark theme. Overview is fully designed and its own code comment says `// ══ OVERVIEW = THE ISSUE ══` (line ~395): your-turn strip, $-verdict hero ("~$18,400/mo · 4.6× your retainer"), proof panel, export one-pager, content-plan band, ROI band, what-shipped, ask-your-strategist loop | **Overview · Performance · Deep Dive · Inbox · Brand** (5) — but the 4 non-Overview tabs are literal placeholders: *"Building this next — the Overview sets the pattern"* (line ~391) | 1 of 5 tabs designed |
| `mockup/portal.js` (Keywords & Flows prototype, the "Client portal" surface of the 18-surface map) | **Light-theme** client microsite *below the send boundary* (header comment, lines 1–15): "homes are dark operator workbenches; the Portal is the light, curated client microsite". Trust spine VERDICT → VALUE → PROOF as a returnable weekly story (HOOK "since your last visit"), operator-**composed** in the Insights Engine and *sent* to the portal (Surface Model: "Operator composes → client receives — a draft / queue / sent lifecycle, not a dashboard"). Two-way inbox wired to a shared store | Single scrolling page + inbox (no tab shell) | Prototype surface, sample data |
| `Client Surface Sweep.html` (Migration Readiness dim 07) | The kit's own audit of HEAD's client surface. Verdict, verbatim: *"IA v2 — the four-tab shell built around The Issue — is the current, correct design… **The current one already won**… **Finish the cutover. Don't redesign — retire.**"* Lists 5 cracks (CL1–CL5, §4 below) | Endorses HEAD's **Overview · Inbox · Results · Deep Dive (+ Settings)** | Audit; the most recent kit word on this surface |
| `UI Rebuild Handoff Brief.html` | Names this gate: *"Before build begins, produce a client dashboard proposal: either a new client-facing dashboard, or a documented path to reuse / evolve what exists… No client-facing surface is built until this is decided."* | — | The mandate for this document |

**Internal kit conflict (must be resolved by the owner, not by an agent):** the Handoff Brief says the prototype's IA "is a decision, not a sketch," but the prototype's client portal (portal.js), the Plan (4 tabs), the Mockup (5 tabs), and the Sweep (endorses HEAD's 4+1) each show a *different* client IA — and the Sweep explicitly says don't redesign.

---

## 2. What exists at HEAD (the parity inventory — this is what must survive)

### 2.1 Two complete IAs behind one flag

`buildClientDashboardNav()` (`src/components/client/client-dashboard/clientDashboardNav.ts:22-71`) has two full return branches on the `client-ia-v2` flag:

- **Flag OFF (shipping in production today):** 9-destination legacy nav — Insights (`overview`), Performance, Site Health, SEO Strategy (tier-locked on free), Content Plan (paid + cells>0), Inbox (paid), Plans (non-beta, non-external-billing), ROI (paid + strategy), Brand (`clientDashboardNav.ts:56-70`).
- **Flag ON (built, dark, staging-validation):** the owner-**ratified** 4-tab two-speed shell — **Overview · Inbox · Results · Deep Dive · Settings** (`clientDashboardNav.ts:44-52`). Ratified via the client-IA tournament 2026-06-21 (`FEATURE_AUDIT.md:8567`, tournament doc `docs/superpowers/audits/2026-06-21-client-ia-tournament.md`).

`ClientTab` union at HEAD carries both generations: `'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'plans' | 'roi' | 'content-plan' | 'brand' | 'deep-dive' | 'results' | 'settings'` (`src/routes.ts:25`).

### 2.2 The Issue feed (the mockup's Overview, already implemented)

`OverviewTab.tsx:158` — when `strategy-the-issue` is ON, the legacy overview body is superseded by `TheIssueClientPage` (`src/components/client/the-issue/TheIssueClientPage.tsx`), which already implements the Mockup's Overview section-for-section: `IssueVerdictHeadline` ($ verdict + ratio), `OutcomeCountBand`, `IssueExportBar` (one-pager export, provenance-banded money — gate D, `FEATURE_AUDIT.md:8555-8565`), `IssueContentPlanSection` / `IssueAlsoOnPlanSection` (content-plan band with request-this loop), `IssueNextBetsSection`, `IssueYourLeadsSection` (named leads), `StrategyRequestedKeywordTrendSection` + `CompetitorGapsSection` (what's-working), `IssueLoopFooter` + ask-strategist card (`TheIssueClientPage.tsx:288-438`).

Flag stack (`shared/types/feature-flags.ts:89-115`, all **default false**, group "The Issue (Client)" `:480`): `strategy-the-issue`, `the-issue-client-spine`, `the-issue-client-measured-capture` (measured provenance + Webflow forms polling ingest, `FEATURE_AUDIT.md:8420-8438`), `the-issue-client-return-hook` (weekly event-gated email pull-back — the kit portal's "reason to return," already built server-side, `FEATURE_AUDIT.md:8471-8484`), `the-issue-client-next-bets`, `client-ia-v2`.

**Build state:** The Issue client P0–P1c and Client IA v2 P1–P4 are **COMPLETE on staging behind dark flags**; the only remaining step recorded is "owner validates flag-ON on staging → release to main; P5 (multi-location) deferred" (`FEATURE_AUDIT.md:8567`).

### 2.3 The IA v2 tabs are slot-compositions of the legacy panels (not duplicates)

- `DeepDiveTab` (`src/components/client/DeepDiveTab.tsx:33-41`) is slot-based: `analyticsSlot` = PerformanceTab (GSC+GA4), `healthSlot` = HealthTab, `rankingsSlot` = StrategyTab, optional `contentPlanSlot` = ContentPlanTab (default-collapsed "Content roadmap" `<details>`, P3 re-home). Sub-tab deep-links via `?sub=`.
- `ResultsTab` (`ResultsTab.tsx:15-21`) = `ROIDashboard` in evergreen mode.
- `SettingsTab` = Brand + conditional Plans slots (`FEATURE_AUDIT.md:8529`).
- Legacy `roi` deliberately resolves to itself, NOT aliased to `results` (flag-OFF ROI must keep working — `FEATURE_AUDIT.md:8530`).

**Consequence for the rebuild:** you cannot "keep IA v2 and delete the legacy panels" — the legacy panels ARE the content of the new shell ("five legacy panels in a trench coat," Client Surface Sweep §02).

### 2.4 Shell chrome and capabilities that must survive regardless of option

All in `src/components/ClientDashboard.tsx` (999 lines) unless noted:

| Capability | Evidence |
|---|---|
| Client auth: dual-mode (shared workspace password + per-user client JWT), Turnstile CAPTCHA, forgot/reset flows | `ClientAuthGate.tsx:10-47` |
| Inbox sub-routing `?tab=decisions\|reviews\|conversations` + legacy alias map (approvals→decisions, requests→conversations, content/copy→reviews, content-plan→decisions) | `src/components/client/inbox/inbox-filter.ts:3-27` |
| Inbox item machinery: `UnifiedInbox`, `DecisionCard`/`DecisionDetailModal` (bulk approve), `ApprovalBatchCard`, `InlineApprovalCard`, `GbpReviewResponseApprovalCard`, `ProjectedReviewModal` → ContentTab solo-mode deep editor, `SchemaReviewModal` (mounted inside Inbox > Reviews), `PriorityStrip`, `SubmitRequestChooserModal` | `src/components/client/inbox/`, `src/components/client/` |
| TierGate soft-gating + `UpgradeModal` + trial banners (dismissable, localStorage-keyed) + 14-day Growth trial countdown | `ClientDashboard.tsx:579-751` |
| Monetization: `PlansTab` (Stripe Checkout), `SeoCartDrawer` per-item purchases, `PricingConfirmationModal`, external-billing / betaMode suppression | `ClientDashboard.tsx:665-674` |
| `ClientChatWidget` (AI advisor; chat API bubbled up for cross-component open) | `ClientDashboard.tsx:290-305` |
| Onboarding: `OnboardingWizard`, `ClientOnboardingQuestionnaire`, `EmailCaptureGate` | `ClientDashboard.tsx:548` etc. |
| Theme: client-side dark/light toggle persisted to localStorage (`dashboard-theme`), default **dark**; light = `.dashboard-light` class | `ClientDashboard.tsx:93-99,673` |
| Beta mode variant route `/client/beta/:workspaceId/:tab?` | `src/routes.ts:47-48` |
| Money-provenance authority: `outcomeProvenance.ts` — single provenance→render contract; band-unless-`actual_reconciled` (`shared/format-money.ts`) | `src/components/client/the-issue/outcomeProvenance.ts`; `FEATURE_AUDIT.md:8555-8564`; Client Surface Sweep §04 calls it "a model… extend this contract; do not touch it" |
| Per-workspace client-view toggles: `seoClientView`, `analyticsClientView` hide strategy/performance entirely (not lock — absent) | `clientDashboardNav.ts:33-40,57-59` |
| Monthly digest, glossary, education tips, data snapshots, diagnostic root-cause cards, work feed (`client-work-feed` flag), briefing (`client-briefing-v2`) | `src/components/client/` listing; `shared/types/feature-flags.ts:465` |

### 2.5 Known cracks at HEAD (Client Surface Sweep CL1–CL5 — verified against code)

1. **CL1 (blocking):** `client-ia-v2` read independently at 3 sites — `clientDashboardNav.ts`, `OverviewTab.tsx:151`, `TheIssueClientPage.tsx` — a load-bearing permanent fork, drifting.
2. **CL2 (blocking):** ROI (month-over-month) vs Results (evergreen) — two live panels, same story, resolver keeps both.
3. **CL3:** orphaned tab components still shipping — `SearchTab`/`AnalyticsTab` (dead aliases → performance), `RequestsTab`, `SchemaReviewTab`, `ContentTab` unwired from both navs (ContentTab is still reached via Inbox solo-mode).
4. **CL4:** `*Tab` naming + `ClientTab` union imply 12+ destinations; v2 clients see 4(+1). `chatFirstTabs` hard-codes ids a v2 client can't reach.
5. **CL5:** home surface differs by flag state + URL fallback.

---

## 3. The options

### Option A — Build the new client dashboard per the kit (Plan/Mockup/portal.js)

Take the kit's client artifacts as the spec: a fresh client surface built from the 59-component design system, light-theme portal presentation, weekly-story hook, operator-composed value band.

- **What's preserved:** nothing automatically. Every row of §2.4 must be deliberately re-homed; the Mockup designs only 1 of its 5 tabs, so Inbox (the most machinery-dense surface: decisions/reviews/conversations, bulk approve, GBP reviews, schema review, content solo-mode editor), Performance, Deep Dive, and Brand would be designed *and* built from placeholders. Auth, Stripe/cart, chat, onboarding, trial/tier gating, beta mode have no home in any kit client artifact — all stop-and-ask re-homes.
- **Effort:** largest of the three by a wide margin. Also duplicates work: the Mockup's Overview is functionally what `TheIssueClientPage` already implements (the mockup's own comment: "OVERVIEW = THE ISSUE").
- **Risk:** highest parity risk — exactly the "losing a function by omission" hard-stop the mandate forbids, multiplied across ~17 tab components and the shell chrome. portal.js additionally implies a **workflow change** (operator composes → send boundary → client receives), which is a platform/product change, not a UI rebuild, and is out of the additive-parity mandate unless the owner explicitly scopes it in.
- **Migration/flag strategy:** would need a new master flag (e.g. `client-portal-v3`) beside the existing 6-flag Issue/IA-v2 stack — a *third* client IA generation in code while the second is still dark. Directly worsens CL1.
- **Client sees during transition:** legacy 9-tab dashboard (flags off) until the new surface is complete; then a hard visual+IA switch.
- **Owner's own prior direction (memory, 2026-07-02):** the P2 rebuild is "a design/IA project first — lock IA + action-taxonomy + design-system before JSX; incremental-behind-flags not big-bang." Option A as a big-bang contradicts the "incremental" half unless phased per-tab — at which point it converges on Option C.

### Option B — Reuse/evolve the existing shell: finish the cutover (Client Surface Sweep's recommendation)

Validate and flip the existing flags, then retire the legacy branch. No new design work.

- **Steps (from the Sweep §05, all verified feasible against HEAD):** owner validates flag-ON on staging (the recorded next step, `FEATURE_AUDIT.md:8567`) → flip `client-ia-v2` + the Issue flags → delete the flag-OFF nav branch and the 3 flag-read forks (CL1) → fold ROI's month-over-month stat into Results, alias `roi → results`, retire `ROIDashboard` standalone (CL2) → delete true orphans (CL3) → rename slot-panels `*Tab` → `*Section`, trim `ClientTab` + `chatFirstTabs` (CL4/CL5) → route all client money through `outcomeProvenance.ts`.
- **What's preserved:** everything, by construction — IA v2 is a re-parenting of the legacy panels, and the flag-OFF path stays byte-identical until the flip. This is the parity-safest option.
- **Effort:** small-to-moderate (flag flip + validation + a retire/rename wave). Most of it is deletion.
- **Risk:** low functional risk; known caveat from memory: client `useFeatureFlag` resolves **global** flags only — per-workspace pilot of the client UI is not possible; the flip is global (only configured workspaces show real data). Flag-ON real-render smoke on staging is mandatory (CLAUDE.md UI rule 13; this exact surface crashed once on a flag flip).
- **Migration/flag strategy:** already in place — this *is* the documented flag lifecycle (`client-ia-v2` removalCondition: "Remove once client IA v2… is validated on staging and shipped as the default," `feature-flags.ts:442-455`).
- **Client sees during transition:** the ratified 4-tab shell with The Issue overview — a one-time IA change, visually continuous with today (same tokens/components).
- **What it does NOT deliver:** the rebuild-kit visual language (light portal, DIN Pro/Inter type system, 59-component assembly, boundary tokens). Option B alone leaves the client surface as the only surface *not* rebuilt to the new system — a permanent style fork against the 17 rebuilt admin surfaces.

### Option C — Hybrid (recommended): finish the cutover first, then re-skin the won IA with the design system, additively

Sequence B's cutover as the parity foundation, then treat the kit's client artifacts as a **presentation and enhancement layer** on the existing IA — not a new IA.

1. **Cutover (== Option B, steps above).** Parity locked; one IA in code; the fork deleted. This is a prerequisite for any safe re-skin — re-skinning two live IAs doubles the work and the risk.
2. **Re-skin the 4-tab shell** with the rebuild kit: tokens, type system, the 59 components, per-surface template fields 1–9 from the Handoff Brief. The shell already renders both themes (`.dashboard-light` exists at `ClientDashboard.tsx:673`); whether the client surface becomes light-by-default (portal.js's position) is an owner call, not a technical constraint. IA and flows do not change — this is exactly the "re-presentation, not reduction" the kit mandates.
3. **Adopt the portal's additive ideas where they're not already built,** each as its own flagged, phase-per-PR increment: the "since your last visit" return hook already exists as the weekly email (`the-issue-client-return-hook`) — its on-dashboard rendering is a small additive band; the operator-staged VALUE band maps onto the existing verdict + `outcomeVerdict` substrate; the Mockup's extra tabs (Performance, Brand as top-level) are **rejected by default** in favor of the ratified 4-tab set unless the owner overrules (§5 Q2).
- **What's preserved:** everything (inherits B), plus the design-system convergence A wanted.
- **Effort:** B + a bounded re-skin wave (the client shell is 1 of the 18 surfaces; the components exist; the hard part per the Handoff Brief is wiring, and the wiring already exists here).
- **Risk:** low-moderate; the re-skin is behind the normal per-surface CI gates (tokens-only lint, both themes, four states, a11y, visual regression).
- **Client sees during transition:** one IA change at cutover (B), then a visual refresh landing with the platform-wide rebuild — no third IA migration.

---

## 4. Recommendation

**Option C**, with Option B's cutover as its first, independently-shippable stage.

Rationale, in order of force:
1. **The kit's own most recent audit says so.** Client Surface Sweep: "The current one already won… Finish the cutover. Don't redesign — retire." An agent choosing Option A would be overruling the kit with the kit.
2. **The Mockup's Overview is already built.** Its own source labels the Overview "THE ISSUE"; `TheIssueClientPage` implements it section-for-section. Option A re-buys what HEAD already owns, dark behind flags, P1–P4 complete.
3. **Parity mandate.** Option A maximizes omission risk across ~17 tab components + shell chrome; Option B/C preserve by construction.
4. **The owner already ratified this IA** (tournament, 2026-06-21) and already directed "incremental-behind-flags, not big-bang" for the rebuild.
5. **What A uniquely offers** (design-system visual language, portal presentation, return-hook surfacing) is fully captured by C's stages 2–3 at a fraction of the risk.

---

## 5. Sign-off questions (owner must answer before any client-facing build)

**Q1 — THE GATE. Which option?** A (new dashboard per kit) / **B (finish cutover, no re-skin)** / **C (cutover → design-system re-skin → additive portal ideas) ← recommended**. No client-facing surface is built until this is answered.

**Q2 — Tab set conflict.** The ratified HEAD IA is **Overview · Inbox · Results · Deep Dive (+ Settings)**; the kit Mockup shows **Overview · Performance · Deep Dive · Inbox · Brand**; the kit Plan shows **Overview · Performance · Strategy · Inbox**. Default under C: keep the ratified set (Performance stays folded in Deep Dive › Analytics; Brand stays folded in Settings). Confirm, or name the set you want.

**Q3 — Theme.** portal.js is light-by-design ("bright trust surface"); HEAD's client default is dark with a client-side toggle (`ClientDashboard.tsx:93-99`). Should the client surface become light-by-default (admin stays dark), keep dark-default + toggle, or follow the platform toggle?

**Q4 — The send-boundary model.** portal.js/Surface Model describe an operator-composes → send → client-receives lifecycle ("not a dashboard"). That is a workflow/product change beyond UI parity. In scope for this rebuild (as a later flagged phase), or explicitly out of scope?

**Q5 — Cutover pre-work.** Flipping `client-ia-v2`/Issue flags is **global** (client `useFeatureFlag` cannot do per-workspace pilots). Confirm: staging flag-ON validation (the recorded pending step) → global flip → legacy-branch retirement, accepting that all client workspaces move to the new IA at once.

**Q6 — ROI → Results merge (CL2).** Folding month-over-month into evergreen Results and retiring the standalone ROI panel changes what a bookmarked `?tab=roi` client sees. Approve the alias + retirement?

**Q7 — Deferred items.** IA v2 P5 (multi-location) and the "landing-in-shell polish" deferral (`FEATURE_AUDIT.md:8536`) — schedule inside this rebuild or keep deferred?

---

## Appendix — evidence index

- Kit: `hmpsn studio Design System/Client Dashboard Plan.html`, `Client Dashboard Mockup.html` (TABS at line ~364; placeholder map ~383; "OVERVIEW = THE ISSUE" ~395), `mockup/portal.js:1-15` (light microsite, send boundary), `Client Surface Sweep.html` (dim 07; CL1–CL5; "Finish the cutover"), `UI Rebuild Handoff Brief.html` (Phase 0 gate text), `Surface Model.html` (graduation path, `/acme/portal`).
- HEAD: `src/routes.ts:25,47-48`; `src/components/client/client-dashboard/clientDashboardNav.ts:22-101`; `src/components/ClientDashboard.tsx:93-99,138-140,548-751`; `src/components/client/OverviewTab.tsx:135-244`; `src/components/client/the-issue/TheIssueClientPage.tsx:9-17,288-438`; `src/components/client/DeepDiveTab.tsx:33-41`; `src/components/client/ResultsTab.tsx:15-21`; `src/components/client/inbox/inbox-filter.ts:3-27`; `src/components/client/ClientAuthGate.tsx:10-47`; `shared/types/feature-flags.ts:89-115,364-455,476-480`; `FEATURE_AUDIT.md:8396-8567` (entries 529–532, 598–601).
