# Phase 0 Additive-Parity Ledger — Client Portal (Client-facing zone)

> Surface: the entire client dashboard at `/client/:workspaceId/:tab?` (+ `/client/beta/...`).
> HEAD = branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD). Prototype = `hmpsn studio Design System/mockup/portal.js` (the "Client Portal" view of the hi-fi mockup), read against `Client Dashboard Plan.html` (the rebuild kit's designated client-dashboard decision doc — Handoff Brief §"The client dashboard decision").
> Rule applied: **uncertain = at_risk, never preserved.** The prototype is a single-page curated microsite; most of HEAD's 14-tab depth has no *demonstrated* home there, so this ledger's at_risk list is long by construction — that is the point of Phase 0.

## 0. Route + shell facts at HEAD

- `ClientTab` union (14): `overview | performance | search | health | strategy | analytics | inbox | plans | roi | content-plan | brand | deep-dive | results | settings` — `src/routes.ts:25`
- Inbox sub-filters `decisions | reviews | conversations` via `?tab=`, with legacy aliases `approvals→decisions`, `requests→conversations`, `content→reviews`, `schema-review→reviews` — `src/routes.ts:26-34`; extra inbox aliases `copy→reviews`, `content-plan→decisions`, `completed→all` — `src/components/client/inbox/inbox-filter.ts:9-16`
- `search`/`analytics` are legacy tab aliases resolved to `performance` (as initial sub-tab); unknown tabs fall back to `overview`; `roi` deliberately resolves to itself (NOT results) — `src/lib/client-dashboard-tab.ts:59-64`
- Two nav modes: legacy ~9-item nav vs `client-ia-v2` 4+1 shell (Overview · Inbox · Results · Deep Dive · Settings) — `src/components/client/client-dashboard/clientDashboardNav.ts:43-67`
- Mount: `src/App.tsx:108` → `src/components/ClientDashboard.tsx:91` (shell, 999 lines)
- Client feature flags in play (all default OFF at HEAD): `strategy-the-issue`, `the-issue-client-spine`, `the-issue-client-measured-capture`, `the-issue-client-return-hook`, `the-issue-client-next-bets`, `client-ia-v2`, `client-work-feed` — `shared/types/feature-flags.ts:24,90-115`

## 1. Capability table

Status legend: **preserved** (demonstrated home in portal.js / Client Dashboard Plan, same or better) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only, needs sign-off) · **at_risk** (exists at HEAD, no visible home).

### A. Shell, routing, chrome

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|---|---|---|---|---|
| 1 | Client route `/client/:workspaceId/:tab?` + beta variant `/client/beta/...` | `src/routes.ts:47-53`, `src/App.tsx:108` | at_risk | — | Prototype has no routing model; portal.js is an operator-canvas view. |
| 2 | 14-tab `ClientTab` IA + `client-ia-v2` 4+1 collapse | `src/routes.ts:25`, `clientDashboardNav.ts:43-67` | at_risk | conflicting proposals | HEAD IA v2 = Overview·Inbox·Results·Deep Dive·Settings; rebuild-kit plan = Overview·Performance·Strategy·Inbox. **Stop-and-ask #1.** |
| 3 | Legacy alias redirects (`search`/`analytics`→performance; inbox aliases incl. retired `schema-review`) | `src/lib/client-dashboard-tab.ts:59-64`, `src/routes.ts:29-34`, `inbox-filter.ts:9-16` | at_risk | — | Old bookmarks/emails must not 404 in the rebuild. |
| 4 | Nav visibility rules: `analyticsClientView`, `seoClientView` (hide vs lock), paid-only Inbox/ROI, contentPlan only when cells exist, `billingMode==='external'` hides Plans | `clientDashboardNav.ts:30-67` | at_risk | — | Admin-controlled per-workspace curation of the client nav. No prototype equivalent. |
| 5 | Dark/light theme toggle, persisted (`dashboard-theme` localStorage) | `ClientDashboard.tsx:93-100`, `ClientHeader.tsx:184-185` | at_risk | — | Prototype fixes the client surface to light-only ("light theme by design"). **Stop-and-ask #2.** |
| 6 | Date-range selector: preset days (28/…/365) + custom range (paid-gated), drives GSC+GA4 | `ClientDashboard.tsx:111-117,197-208`, `ClientHeader.tsx:203-216` | at_risk | — | Portal shows a fixed "last 12 months" story. |
| 7 | Trial countdown banner (≤5 days, dismissible, per-trial localStorage key) + trial-ended banner | `ClientDashboard.tsx:579-589,738-757,769-796` | at_risk | — | Plan folds upgrade moments contextually; trial mechanics unaddressed. |
| 8 | Per-source section error banners + IA v2 single prioritized notice region (errors > trial > tip, `aria-live`) | `ClientDashboard.tsx:158-180,730-810` | at_risk | Build Conventions state matrix | Conventions promise 4 states per surface but the client-portal error aggregation pattern isn't demonstrated. |
| 9 | SeoEducationTip — per-tab first-visit contextual SEO tips | `ClientDashboard.tsx:764,808`; `src/components/client/SeoEducationTip.tsx` | at_risk | — | |
| 10 | "Powered by hmpsn studio" branded header + footer | `ClientDashboard.tsx:986-992` | preserved | portal.js header/footer | portal.js:498-502 (pt-power), 594 (pt-foot). |
| 11 | Real-time WS invalidation — ~45 workspace events keep every client cache fresh | `ClientDashboard.tsx:342-438` | at_risk | — | Prototype is static. Data-flow rule 2 requires this half in any rebuild. |
| 12 | Auth: shared-password gate, per-user email/password login, forgot/reset password flows, Turnstile CAPTCHA, logout, auth-mode detection | `ClientDashboard.tsx:263-283,503-541`; `src/components/client/ClientAuthGate.tsx`; `src/hooks/useClientAuth.ts` | at_risk | — | Zero auth surface in prototype. |
| 13 | EmailCaptureGate for shared-password free-tier visitors (per-workspace localStorage) | `ClientDashboard.tsx:317-332,546-555` | at_risk | — | |
| 14 | ClientOnboardingQuestionnaire (POST `/api/public/onboarding/:id`) + OnboardingWizard welcome tour (per-user seen-key, re-launchable from header) | `ClientDashboard.tsx:936-984`, `ClientHeader.tsx:191` | at_risk | — | |
| 15 | Loading skeleton shell + error state with retry + `ScannerReveal` entrance | `ClientDashboard.tsx:476-500,709` | at_risk | Build Conventions | |
| 16 | Chat widget mounted on every tab (chat-first ordering on content-plan/plans/roi/brand) | `ClientDashboardTabContent.tsx:15-31` | preserved | plan §A2 "continue the conversation" | Ordering nuance not addressed. |

### B. Overview tab — legacy body (flag-OFF)

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 17 | Welcome line + dynamic data-driven subtitle | `OverviewTab.tsx:249-272` | improved | plan "hero verdict" | Plan promotes this to an AI hero verdict (A2/A3). |
| 18 | Data freshness stamps (GSC + GA4 `dataUpdatedAt`) | `OverviewTab.tsx:266-278` | at_risk | — | QW2 PR1 feature (FEATURE_AUDIT §488). |
| 19 | Composite HealthScoreCard w/ breakdown popover | `OverviewTab.tsx:281-285`; FEATURE_AUDIT §495 | at_risk | portal health ring (score only) | Breakdown detail has no home. |
| 20 | Hero StatCards: visitors/clicks/impressions/avg-position + deltas + Site Health ring | `OverviewTab.tsx:288-351` | preserved | portal "vitals" tiles + plan pulse strip | portal.js:418-430. Plan adds one-word verdicts (improved). |
| 21 | Action-needed banner — counts per type, deep links to inbox sections via `?tab=` | `OverviewTab.tsx:356-393` | preserved | plan "Waiting on you" | Explicitly KEEP in plan audit. |
| 22 | #1 Priority card — reconciled top recommendation + "why this is #1" opportunity-component bars | `OverviewTab.tsx:120-133,395-453` | at_risk | — | Ranked-engine agreement with Health tab ordering; no prototype equivalent. |
| 23 | Contextual primary CTA banner (generate brief / fix health / grow traffic) | `OverviewTab.tsx:455-532` | improved | plan contextual upgrade moments | |
| 24 | MonthlyDigest (monthly performance digest) | `OverviewTab.tsx:534-537`; `useMonthlyDigest.ts` | improved | plan "Work in motion" | Plan refactors to work-done-only. |
| 25 | IntelligenceSummaryCard (insights, pipeline, win rate) gated by `siteIntelligenceClientView` | `OverviewTab.tsx:539-544` | at_risk | — | Includes the admin visibility toggle. |
| 26 | OutcomeSummary — measured win-rate scorecard | `OverviewTab.tsx:546-550` | preserved | portal "What we did" moves + value band | portal.js:543-547. |
| 27 | WinsSurface — measured wins ledger | `OverviewTab.tsx:552-556` | preserved | portal climbing-rankings + value band | |
| 28 | PredictionShowcaseCard — "we called it" predictions | `OverviewTab.tsx:558-560` | at_risk | — | |
| 29 | InsightsDigest — unified sentiment-tagged narrative insights feed | `OverviewTab.tsx:566-586` | preserved | plan "Deep insights" story layer | Explicit KEEP. |
| 30 | Empty-state setup guidance (connect GSC/GA4/run audit) | `OverviewTab.tsx:588-620` | at_risk | — | Portal only demos the provable-data happy path. |
| 31 | "Ask your SEO advisor" quick questions + learn-SEO questions | `OverviewTab.tsx:626-657` | preserved | portal conversation + plan A2 | |
| 32 | Content Opportunities preview (top gaps → strategy) | `OverviewTab.tsx:660-687` | improved | portal "Opportunities we spotted" one-tap greenlight | portal.js:568-572. |
| 33 | AgencyWorkFeed (live jobs + narrative history, `client-work-feed` flag) / legacy Recent Work timeline fallback | `OverviewTab.tsx:689-734` | preserved | plan "Work in motion" | Live-jobs (WS `JOB_CREATED/JOB_UPDATED`) realtime aspect not demonstrated → verify. |
| 34 | DiagnosticRootCauseCards — completed client-safe diagnostic summaries | `OverviewTab.tsx:119,353`; FEATURE_AUDIT §534 | at_risk | — | Admin ledger homes diagnostics under the (admin) Insights Engine; client-facing cards unhomed. |

### C. The Issue (flag `strategy-the-issue`) — reimagined Overview

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 35 | Evergreen narrated status headline + "curated by your strategist" byline | `TheIssueClientPage.tsx:9-21,52` | improved | portal HOOK | Portal adds "since your last visit" framing. |
| 36 | Dollar/outcome verdict (ROI `outcomeVerdict`) + typed outcome count band (measured-capture flag) | `TheIssueClientPage.tsx:97-101`, `OverviewTab.tsx:154-213` | improved | portal VALUE band | Portal adds "agency estimate" basis tag + recovered/protected framing. |
| 37 | Content plan hero + "Request this" greenlight (content REQUEST, not generation) | `TheIssueClientPage.tsx:12,20`, `IssueContentPlanSection.tsx` | improved | portal recs one-tap greenlight → pipeline graduation | portal.js:604-620 `addRec`. |
| 38 | Next-bets $-forecast band (`the-issue-client-next-bets`) | `TheIssueClientPage.tsx:113-115`, `nextBetsForecast.ts` | at_risk | portal "What's next" (no $ forecast) | Forecast math itself unhomed. |
| 39 | Also-on-your-plan compact non-content moves | `IssueAlsoOnPlanSection.tsx` | preserved | portal "What we did"/"What's next" | |
| 40 | Compressed proof band (CompactStatBar + collapsed ROIDashboard + methodology) | `TheIssueClientPage.tsx:14-15` | preserved | portal PROOF spine | |
| 41 | Requested-keyword rank trend (client-requested keywords tracked) | `StrategyRequestedKeywordTrendSection.tsx`; FEATURE_AUDIT §484 | at_risk | — | Portal "climbing" list is not request-scoped. |
| 42 | Competitor snapshot (CompetitorGapsSection) gated by `segmentProfile.showCompetitorAuthority` | `TheIssueClientPage.tsx:17,74` | at_risk | — | Admin ledger homes competitors admin-side only. |
| 43 | Your-leads section — client's own captured leads (`GET /api/public/export/:id/my-leads`) | `IssueYourLeadsSection.tsx:5,24-25`, `useClientMyLeads.ts` | improved | portal bonus leads tile (provable-only) | Portal demotes to single tile shown only when provable — matches HEAD's honest degrade. |
| 44 | One-pager export bar — server-rendered print-optimized one-pager (`GET /api/public/export/:id/one-pager`), segment-aware framing | `IssueExportBar.tsx:3-47` | at_risk | — | Only client-portal export capability at HEAD; no prototype home. |
| 45 | Loop footer (greenlit / discussing) | `IssueLoopFooter.tsx` | preserved | portal conversation store round-trip | |
| 46 | Admin previewMode (read-only, decision controls suppressed) | `TheIssueClientPage.tsx:23-24,87-88` | improved | portal ribbon + full-screen "view as client" | portal.js:213-228,606-611. |
| 47 | Act-on recommendation greenlight + keyword relevant/not-relevant feedback from cards | `TheIssueClientPage.tsx:87-97`, `useActOnRecommendation.ts` | preserved | portal approve/greenlight actions | Server 409s generic respond for rec type — greenlight is canonical (`UnifiedInbox.tsx:549-556`). |
| 48 | Segment-profile-driven slot inserts (resolved `ResolvedSegmentProfile`) | `TheIssueClientPage.tsx:101-102`, `OverviewTab.tsx:214-216` | at_risk | — | Authority-layered field; per-segment framing incl. exportProfile copy. |

### D. Performance tab (+ legacy search/analytics aliases)

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 49 | Search/Analytics sub-tab bar + smart default + `initialSubTab` deep link | `PerformanceTab.tsx:45-114` | at_risk | plan merges Search+Analytics | Deep-link contract not demonstrated. |
| 50 | SearchTab: GSC overview, comparison deltas, trend chart w/ timeline annotations, rank history, latest ranks, insight buckets (low-hanging/top/ctr-opps/high-imp-low-click), glossary | `PerformanceTab.tsx:116-129`, `SearchTab.tsx`, `ClientDashboard.tsx:462-473` | preserved | plan Performance (search health, traffic story w/ annotation markers, rank movers) | |
| 51 | AnalyticsTab: GA4 overview/trend/devices/pages/sources/organic/landing-pages/new-vs-returning/conversions/events + DataSnapshots + takeaway line | `PerformanceTab.tsx:131-149`, `AnalyticsTab.tsx`, `DataSnapshots.tsx` | at_risk | — | Plan/portal show one trend chart; the deep GA4 breakdown tables have no visible home. |
| 52 | Free-tier TierGate on Performance ("locked" state → Plans) | `PerformanceTab.tsx:73-89` | preserved | plan keeps TierGate teasers | |
| 53 | Performance empty state (no GSC/GA4 connected) | `PerformanceTab.tsx:91-99` | at_risk | — | |

### E. Site Health tab

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 54 | Full audit detail: header, score summary, audit diff (what changed), page-speed section, top fixes, site-wide issues, all-pages list w/ severity filter (incl. `?severity=` URL param), audit history | `HealthTab.tsx:63-95`, `ClientDashboard.tsx:633` | at_risk | plan "Site vitals" = single score + top issues, collapsed | Deep per-page detail, diff and history reduced away — confirm intentional. |
| 55 | Fix economics: impact bands per check, "Fix this $X" vs "covered by hours" tier framing, request-fix, hidePrices for external billing | `HealthTab.tsx:32-39`, `buildImpactBandsByCheck.ts`, `health-tab/FixableIssueRow.tsx` | at_risk | — | |
| 56 | Add-fix-to-cart + HealthCartSummary + SeoCartDrawer (qty, remove, clear, premium content discount, Stripe cart checkout `/api/stripe/cart-checkout`) | `HealthTab.tsx:93`, `SeoCart.tsx:36-75`, `useCart.tsx` | at_risk | — | Whole purchase path unhomed. **Stop-and-ask #3 (monetization).** |
| 57 | Action-plan slot: InsightsEngine client recommendations embedded in Health | `ClientDashboard.tsx:633-639`, `InsightsEngine.tsx` | at_risk | — | |
| 58 | Health summary-only + empty state w/ "Request a health check" | `HealthTab.tsx:98-131` | at_risk | — | |

### F. SEO Strategy tab

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 59 | Command-center layout: Orient header + interior tabs w/ URL param mapping | `StrategyTab.tsx:66,127-143,923-930`; FEATURE_AUDIT §521 | at_risk | plan rebuilds Strategy differently | |
| 60 | Snapshot, refresh summary, next steps, business priorities, page improvements, page-rank stories sections | `StrategyTab.tsx:709-819` | at_risk | plan "what we're targeting" (partial) | |
| 61 | Keywords table (role/opportunity/next-move framing) behind growth TierGate + keyword drawer w/ evidence | `StrategyTab.tsx:819-837,887-906` | at_risk | plan strategy-native metrics | Table plausible; drawer/evidence undemonstrated. |
| 62 | Client keyword feedback: validate/decline w/ reason modal, declined-keywords section, feedback summary card | `StrategyTab.tsx:191-192,740,868-926`, `useStrategyKeywordFeedback.ts` | preserved | admin ledger `ClientKeywordFeedback` panel (Keywords) receives it | Admin receive-side is built in mockup; the client *send* surface itself is only implied (portal decline is absent) — treat send-side as verify. |
| 63 | Page↔keyword map section | `StrategyPageKeywordMapSection.tsx`, `PageKeywordMapContent.tsx` | at_risk | — | Admin ledger itself flags "Verify the page↔keyword mapping surface is fully represented." |
| 64 | Content opportunities w/ request-content + pricing confirmation | `StrategyTab.tsx:780-804` | improved | portal recs greenlight | Pricing step unhomed (see #56/#73). |
| 65 | Strategy empty state ("being prepared") + free-tier lock | `StrategyTab.tsx:356`, `clientDashboardNav.ts:38-39` | at_risk | — | |

### G. Inbox tab (UnifiedInbox)

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 66 | Unified deliverables inbox (`GET /api/public/deliverables/:id`) w/ filters all/decisions/reviews/conversations, `?tab=` deep link + legacy aliases | `InboxTab.tsx:55-83`, `useUnifiedInbox.ts:7-8`, `inbox-filter.ts` | preserved | plan Inbox "unified queue + filter pills" | Explicit KEEP. |
| 67 | PriorityStrip — single prioritized "needs your attention" list w/ scroll-to | `UnifiedInbox.tsx:328,528-542,653-656` | preserved | plan priority sort | |
| 68 | Respond: Approve / Request changes / Decline w/ note; approve w/ flagged items held for team; per-item edited values (title/description) | `UnifiedInbox.tsx:459-490` | preserved (core) / at_risk (granular) | portal approve/request-change | Portal only demos plan-level approve + free-text request; per-item flag/edit and hold-back have no home. |
| 69 | Ready-to-publish: client applies approved batch to live site w/ partial-failure retry semantics | `UnifiedInbox.tsx:491-527`, `useApplyDeliverable` | at_risk | — | FM-2-guarded apply loop; nothing like it in prototype. |
| 70 | GBP review-response approval card | `UnifiedInbox.tsx:556-560`, `GbpReviewResponseApprovalCard.tsx` | at_risk | admin ledger Local Presence "AI draft → client approval → publish" | Pipeline exists admin-side in mockup; the client approval card surface is undemonstrated. |
| 71 | Work orders: read-only OrderTrackStepper + conversation thread + comments (WS `WORK_ORDER_COMMENT`) | `UnifiedInbox.tsx:129-204,429-431`, `useWorkOrderConversation.ts` | preserved (status) / at_risk (thread) | plan status chips | Threaded conversation + explicit closed state (FEATURE_AUDIT §477) undemonstrated. |
| 72 | Conversations: request threads w/ notes, file attachments (`notes-with-files`), on-hold reason surfacing, team-note badges | `RequestsTab.tsx:45-138` | preserved (threads) / at_risk (attachments) | portal conversation compose | File upload has no prototype home. |
| 73 | Submit request chooser: general request vs content topic (routes to pricing confirmation w/ `source:'client'`) | `SubmitRequestChooserModal.tsx:37-85`, `SubmitRequestForm.tsx` | preserved | portal request/compose + recs | Pricing confirmation leg unhomed. |
| 74 | Projected review modal — post review (`PostReviewCard`/ContentTab) and website-copy review (`ClientCopyReview`) branched by type | `UnifiedInbox.tsx:798-806`, `ProjectedReviewModal.tsx` | at_risk | — | Full content review UX (brief/post/copy) has no client home in prototype. |
| 75 | Schema review modal — approve / request changes on schema plan (`/api/public/schema-plan/:id/feedback`) + snapshot summary | `SchemaReviewModal.tsx`, `SchemaReviewTab.tsx:59-302` | at_risk | admin Schema "send to client" implies it | Client review surface undemonstrated. |
| 76 | DecisionCard / DeliverableDetailModal bulk decision flow + InlineApprovalCard w/ shared decision-renderers | `UnifiedInbox.tsx:8,543-556`, `decision-renderers.tsx` | preserved (concept) | portal approve | Bulk per-item detail view at_risk-adjacent; verify in build. |
| 77 | Inbox empty states per filter | `UnifiedInbox.tsx:645-699` | preserved | plan "Empty states — all filters" | Explicit in plan. |

### H. Content Plan tab

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 78 | Content plan matrix review: plans list, MatrixProgressView, per-cell preview + flag w/ comment (optimistic update) | `ContentPlanTab.tsx:18-80`, `MatrixProgressView.tsx` | at_risk | IA v2 folds under Deep Dive→Rankings as collapsed section (`ClientDashboard.tsx:894-898`) | No prototype home at all. |

### I. Plans / billing / monetization

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 79 | Plans tab: 3-tier cards, current/trial state, upgrade checkout (`/api/public/upgrade-checkout/:id`) | `PlansTab.tsx:30-60,152-232` | at_risk | plan: "Plans & ROI stop being standing tabs" — contextual upgrade math | The *flows* (checkout, plan compare) need an explicit home. **Stop-and-ask #3.** |
| 80 | Billing portal (`/api/public/billing-portal/:id`) | `PlansTab.tsx:65-68` | at_risk | — | Account-management necessity; no home. |
| 81 | UpgradeModal + free-tier ROI teaser | `ClientDashboard.tsx:917-924`, `PlansTab.tsx:369-370` | improved | plan value-math-at-the-ceiling | |
| 82 | PricingConfirmationModal + per-item content purchases + external-billing bypass path | `ClientDashboard.tsx:926-934,566-577`, `usePayments.ts` | at_risk | — | |
| 83 | External billing mode: hides Plans/trial/upgrade/cart across the portal | `ClientDashboard.tsx:566-577,674,906,918` | at_risk | — | |
| 84 | Beta mode (`/client/beta/...`): effective tier premium, billing UI hidden | `ClientDashboard.tsx:91,560`, `BetaContext.tsx` | at_risk | — | |

### J. ROI / Results / Deep Dive / Settings / Brand

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 85 | ROIDashboard: traffic-value model, outcome-verdict lead-value frame, methodology disclosure, TierGate | `ROIDashboard.tsx:84-200` | improved | portal VALUE band w/ provenance basis tags | |
| 86 | Results tab: evergreen ROIDashboard variant (dateless); `?tab=roi` bookmarks keep dated variant | `ResultsTab.tsx:15-21`, `client-dashboard-tab.ts:51-57` | preserved | portal is evergreen | Dated (MoM) variant's survival = verify. |
| 87 | Deep Dive tab: Analytics/Rankings sub-tabs w/ `?sub=` deep link, health pinned under analytics, collapsed content roadmap | `DeepDiveTab.tsx:41-91` | at_risk | — | Competes with the rebuild-kit 4-tab plan (stop-and-ask #1). |
| 88 | Settings tab: Brand + Plans slots grouped | `SettingsTab.tsx:25-41` | at_risk | — | |
| 89 | Brand tab: business profile (NAP: phone/email/address) view + client-side EDIT (PATCH `/api/public/workspaces/:id/business-profile`) | `BrandTab.tsx:26-140`, `ClientDashboard.tsx:651-663` | at_risk | plan "Brand foundation" is a read-only trust panel | Client *edit* capability has no home. |

### K. AI chat

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 90 | Client AI chat: useChat w/ full data deps + server-grounded `currentTab` hint (E4) | `ClientChatWidget.tsx:39-84`, `ClientDashboard.tsx:291-302`; FEATURE_AUDIT §483 | preserved | plan A2 hero verdict + "continue the conversation" | |
| 91 | Chat usage limits (free/growth counter, remaining/limit, upgrade prompt w/ ROI value) | `ClientChatWidget.tsx:93,118,322-323`, `useClientChatUsage.ts` | at_risk | — | Monetization guardrail. |
| 92 | Chat history + quick questions + ServiceInterestCTA | `ClientChatWidget.tsx:141,218-299` | at_risk | — | |

### L. Cross-cutting

| # | Capability | Evidence | Status | Home | Notes |
|---|---|---|---|---|---|
| 93 | TierGate soft-gating pattern across tabs (teaser + Learn more → Plans) | `PerformanceTab.tsx:73-89`, `StrategyTab.tsx:819`, `ROIDashboard.tsx:100-117` | preserved | plan keeps TierGate teasers | |
| 94 | Admin per-workspace client-view toggles (`analyticsClientView`, `seoClientView`, `siteIntelligenceClientView`, `eventConfig` pinned outcome nouns) | `clientDashboardNav.ts:38,55`, `OverviewTab.tsx:540`, `ClientDashboard.tsx:459-460` | at_risk | admin Workspace-settings row ("Client dashboard config") is `improved` in admin ledger | The *effect* on the client render must be re-verified in the rebuild. |
| 95 | Inbox badge counts in header (pending approvals + reviews + team notes + copy reviews) + IA v2 aggregate badge | `ClientDashboard.tsx:557-558`, `ClientHeader.tsx:87-94,120` | preserved | plan status visibility | |
| 96 | Rate/number integrity rules (no emvPerWeek client-side; opportunity score not ROI) | `OverviewTab.tsx:411-414` | preserved | kit rule "never change a client-facing number" | Contract, must carry. |

### Prototype-only functionality (new_proposed — needs owner sign-off)

| # | Capability | Prototype evidence | Notes |
|---|---|---|---|
| N1 | Operator-curated "staged value" model — the portal renders only what the operator composes in the (admin) Insights Engine, below an explicit send boundary | portal.js:1-13 header comment | A new curation contract between admin and client surfaces; HEAD's client portal reads live data directly. Changes the data-ownership model — sign-off required. |
| N2 | "Since your last visit" return hook w/ lastVisit tracking + change chips | portal.js:46-59,235-241,507-511 | HEAD's `the-issue-client-return-hook` covers export+leads, not visit-delta narration. Requires last-visit tracking infra. |
| N3 | "Revenue protected / defending" framing variant for declining accounts (dir:-1 path) | portal.js:271-297,387-391 | HEAD verdict has no defensive framing branch. |
| N4 | Client full-screen microsite framing (light-only, brand-colored avatar header) as a distinct product surface | portal.js:33-44,213-228 | Conflicts with HEAD theme toggle (see #5). |

## 2. Prototype coverage notes

`portal.js` demonstrates (≈ the trust spine): branded header, HOOK (since-last-visit), VALUE band (recovered-$ w/ "agency estimate" tag, page-one rankings, guides published), PROOF (impressions/clicks tiles + sparklines, climbing rankings, 12-mo traffic chart, "what we did" moves w/ provenance, health ring + fixes, what's next w/ status chips), opportunities w/ one-tap greenlight → pipeline graduation, provable-only leads tile, two-way conversation (approve plan / request change / compose → shared store → admin inbox), admin ribbon + full-screen view-as-client.

It **omits** (by design — it's a curated one-pager): all tabbed depth, auth, billing/monetization, cart, chat AI, content plan matrices, schema/post/copy review, work-order threads, GA4 breakdowns, audit detail, keyword feedback loops, date ranges, onboarding, education, empty/locked states, real-time updates. The `Client Dashboard Plan.html` (the kit's decision doc) proposes a 4-tab Overview·Performance·Strategy·Inbox IA that absorbs some of this depth, but it is explicitly "the skeleton we'd design against, not final layout," and it **conflicts with HEAD's already-built `client-ia-v2` shell** (Overview·Inbox·Results·Deep Dive·Settings).

## 3. Parity Ledger reconciliation

The `Platform Parity Ledger.html` is titled "MIGRATION PARITY AUDIT · **ADMIN SURFACES**" and is built from `navRegistry.tsx` (admin nav). **It contains no client-portal rows at all** — the client surface was never reconciled there. Findings:

- **No Gap/Partial rows exist for this surface** — not because it's covered, but because it's absent. This document is the missing client-side ledger.
- Tangential admin rows that touch this surface: `Requests → Inbox (moved)` is the *admin* request manager; `ClientKeywordFeedback (present, Keywords · feedback panel)` is the admin receive-side of client keyword feedback (#62); `Local Presence` includes the governed GBP review pipeline whose client-approval leg is #70; `Workspace Settings (improved)` lists "Client dashboard config" (#94); `Strategy → Insights Engine (improved)` notes "Verify the page↔keyword mapping surface is fully represented" (#63); `Diagnostics` (admin) is a `gap` — its client-safe summaries (#34) inherit that uncertainty.
- **Resolution status:** none of these resolve for the client zone until the client-dashboard decision (Handoff Brief Phase 0 gate) is signed off and a client parity ledger (this file) is worked into the mockup the way the admin one was.

## 4. Trade-offs — quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Client IA | Keep HEAD's `client-ia-v2` 4+1 shell (already built, flag-gated, tested) and re-skin with the design system | Rebuild to the kit's Overview·Performance·Strategy·Inbox IA with the portal trust-spine Overview | Two-IA drift; the kit's Overview thesis (verdict-first) is only partially expressed by IA v2; sunk-cost lock-in |
| Overview | Ship The Issue page (flags ON) as the new Overview — it already implements verdict→plan→proof | Portal.js trust-spine w/ operator-curated staged value + since-last-visit hook | Quick win keeps live-data reads (no curation boundary); return-hook narration and defending-mode framing missing |
| Value band / ROI | Reuse ROIDashboard outcomeVerdict + provenance labels inline | Operator-staged value w/ "agency estimate" basis tags + protected/recovered variants (N1/N3) | Estimates render without the explicit basis-tag trust device the prototype leads with |
| Inbox | Keep UnifiedInbox as-is (filters, respond, apply, threads) and restyle | Rebuild per plan w/ status chips everywhere + per-filter empty states | Low — UnifiedInbox is the strongest carry-over candidate; risk is only visual inconsistency |
| Conversation | Wire portal's approve/request/compose to existing requests + deliverable respond APIs | Full shared-store thread w/ promotable-request graduation into admin Insights Engine | Quick win loses the "request graduates to a strategy signal" loop the prototype sells |
| Deep data (GA4 tables, audit detail, keyword drawer) | Fold behind a "full report" progressive-disclosure reveal (The Issue already has the pattern) | Redesigned deep-dive surfaces per section | Burying may be *intended* (plan A5) — but silently dropping tables = capability loss; must be disclosure, not deletion |
| Billing/monetization (Plans, cart, chat limits, pricing modals) | Keep existing tabs/drawers unrestyled behind the new shell temporarily | Contextual "upgrade math at the ceiling" per plan §04 | Quick win contradicts the new IA; full version has no designed flows yet for checkout/billing-portal/cart — revenue path must never 404 |
| Auth/onboarding | Reuse ClientAuthGate/EmailCaptureGate/wizards unchanged (they're outside the visual redesign) | Redesign auth + onboarding to the light microsite language | Minimal — but light-theme decision (#5) affects these screens too |

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Which 4-tab IA wins?** HEAD's built `client-ia-v2` (Overview·Inbox·Results·Deep Dive·Settings) vs the rebuild kit's plan (Overview·Performance·Strategy·Inbox). They disagree on where Strategy, Performance, Results and Settings live. The Handoff Brief mandates this exact decision ("client dashboard decision — before build").
2. **Client theme:** prototype is light-only by design; HEAD ships a persisted dark/light toggle (dark default). Keep the toggle, or adopt light-only for clients?
3. **Monetization surfaces:** plan says "Plans & ROI stop being standing tabs" — where do upgrade checkout, billing portal, SEO cart, per-item pricing confirmation, chat usage limits, and trial banners live in the new IA? None have designed homes; all are revenue paths.
4. **Curation boundary (N1):** does the rebuilt portal render live data (HEAD model) or operator-staged value below a send boundary (prototype model)? This changes the data contract for the VALUE band and "what we did."
5. **Deep-detail surfaces with no home:** GA4 breakdown tables (#51), full audit detail/history/severity filter (#54), content-plan matrix review (#78), schema/post/copy review modals (#74/#75), work-order threads w/ attachments (#71/#72), keyword drawer + page↔keyword map (#61/#63), one-pager export (#44), business-profile client edit (#89). Progressive disclosure, relocation, or explicit cut — each needs a named decision.
6. **Per-workspace client-view toggles (#94)** — carried as-is into the new nav model?
7. **Legacy deep-link compatibility (#3):** must the rebuild honor all existing aliases (`?tab=roi`, `schema-review`, `approvals`, `severity=`, `?sub=`) — recommended yes; emails and bookmarks reference them.
8. **`roi` (dated, MoM) vs `results` (evergreen):** the prototype is evergreen-only; does the dated ROI variant survive (currently reachable via `?tab=roi` bookmarks)?
9. **New prototype functionality N1–N4** (staged value, since-last-visit hook, defending framing, full-screen microsite): approve as build tickets or defer?

---
*Phase 0 audit · read-only · evidence verified at HEAD on branch `ui-rebuild-phase-0` · 96 capabilities + 4 prototype-only proposals.*
