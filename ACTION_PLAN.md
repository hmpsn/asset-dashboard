# Asset Dashboard — Unified Action Plan

A prioritized execution plan compiled from all roadmap documents, the feature audit, and new feature proposals. Everything the platform could or should do next, in the order it should be tackled.

*Sources: AUTH_ROADMAP.md, AI_CHATBOT_ROADMAP.md, FEATURE_AUDIT.md (Future Additions), GSC/GA4 improvement roadmap*

---

## Priority Framework

Each item is scored on three axes:

- **Revenue impact** — Does this directly help close, retain, or upsell clients?
- **Operational leverage** — Does this save meaningful time or reduce risk?
- **Foundation dependency** — Do other items depend on this being done first?

Priority tiers:
- 🔴 **P0 — Do now** — High impact, blocks other work, or quick win
- 🟠 **P1 — Do next** — High value, no blockers
- 🟡 **P2 — Do soon** — Medium value, can wait for the right moment
- 🟢 **P3 — Backlog** — Nice to have, do when time allows
- ⚪ **P4 — Someday** — Low urgency, revisit quarterly

---

## Execution Order

### ~~Sprint 1: AI Chatbot as Revenue Engine~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Status |
|---|------|--------|:----:|:--------:|-------|
| 1 | ~~**Client AI: Full dashboard context**~~ | AI_CHATBOT_ROADMAP Phase 1 | 3-4h | 🔴 P0 | ✅ Shipped — 10+ data sources wired into client askAi() |
| 2 | ~~**Client AI: Global knowledge base**~~ | AI_CHATBOT_ROADMAP Phase 2 | 4-5h | 🔴 P0 | ✅ Shipped — knowledgeBase field + knowledge-docs/ folder, injected into both chatbots |
| 3 | ~~**Client AI: Sales engine behavior**~~ | AI_CHATBOT_ROADMAP Phase 3 | 3-4h | 🔴 P0 | ✅ Shipped — 8 revenue hooks, Insights Engine branding, warm handoff pattern |
| 3a | ~~**Admin AI chat panel**~~ | Sprint 1 addition | 2-3h | 🔴 P0 | ✅ Shipped — /api/admin-chat endpoint + AdminChat.tsx with internal analyst persona |
| 3b | ~~**GA4 admin dashboard upgrade**~~ | Memory/Roadmap | 3-4h | � P1 | ✅ Shipped — sparklines, period comparison, organic, new vs returning, conversions |

### ~~Sprint 2: Stripe Payments & Auth Foundation~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 78 | ~~**Pre-Stripe security hardening**~~ — Helmet security headers (CSP whitelists Stripe), HTTPS enforcement, rate limiting (60/min read, 10/min write, 5/min checkout), input sanitization on content endpoints | Security Audit | 1h | 🔴 P0 | ✅ Shipped — foundation for payment routes |
| 4 | ~~**Stripe integration: content payments**~~ — Stripe Checkout for briefs, posts, schemas, strategies. Webhook handler, payment tracking per workspace. `server/stripe.ts` + `server/payments.ts` | MONETIZATION.md Phase 1 | 5-7h | 🔴 P0 | ✅ Shipped — 14 products, checkout redirect, webhook, payment records, success/cancel toast |
| 79 | ~~**Stripe admin settings in Command Center**~~ — `StripeSettings.tsx`: encrypted key storage (AES-256-GCM), product Price ID mapping, enable/disable products. `stripe-config.ts` persistence. Lazy SDK init. Zero env vars needed. | Sprint 2 addition | 2h | 🔴 P0 | ✅ Shipped — full admin UI, encrypted config, env var fallback for CI/Docker |
| 65 | **Workspace tier field + TierGate component** — Add `tier: free\|growth\|premium` to Workspace. Create `<TierGate>` with blur overlay + upgrade CTA. `GET /api/public/tier/:wsId` | MONETIZATION.md UX Spec | 1-2h | 🔴 P0 | Foundation for all tier gating |
| 66 | **Soft-gate dashboard sections** — Wrap ~10-15 sections in TierGate: Strategy page map, content gaps, brief generation, approve/reject, custom date ranges, chat input after limit | MONETIZATION.md UX Spec | 1.5-2h | 🔴 P0 | Depends on #65 |
| 67 | **AI chatbot rate limiting (free tier)** — Monthly conversation counter in `chat-memory.ts`. 3 convos/month free. Counter in chat header. Disable proactive insights on free tier | MONETIZATION.md UX Spec | 1h | 🔴 P0 | Depends on #65 |
| 5 | **Internal user accounts** — User model, bcrypt, JWT/sessions, login by email, `req.user` on all routes | AUTH_ROADMAP Phase 1 | 6-8h | 🔴 P0 | Everything else in auth depends on this |
| 6 | **Workspace access control** — Restrict workspaces by user, role-based middleware | AUTH_ROADMAP Phase 2 | 3-4h | 🔴 P0 | Required before any team onboarding |
| 7 | **Client user accounts** — Individual client logins, client_admin/member roles, team management UI | AUTH_ROADMAP Phase 4 | 6-8h | 🔴 P0 | Replaces shared passwords, unlocks client team features |

### ~~Sprint 2b: Monetization UX~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 68 | **14-day Growth trial for new workspaces** — `trialEndsAt` field on Workspace. Auto-resolve tier to growth during trial. Countdown banner at day 10+. Auto-downgrade to free | MONETIZATION.md Trial Strategy | 1-2h | 🔴 P0 | Loss aversion drives more upgrades than gain framing |
| 69 | **Inline price visibility** — Show prices on all purchase buttons (brief $125, post $500, schema $35/pg). Bundle savings callouts. Prices from config, admin per-workspace overrides | MONETIZATION.md Pricing | 2-3h | 🔴 P0 | Reduces checkout friction |
| 70 | **Page-type content briefs** — Expand brief generator: landing page, service page, location page, product page, pillar/hub page, resource/guide. Page-type-specific AI prompts and templates | MONETIZATION.md Products | 3-4h | 🔴 P0 | Expands product catalog from 2 to 8 brief types |
| 71 | **Page type → content opportunity mapping** — Strategy engine recommends page types based on gap signals. Badge on content opportunity cards. Pre-selects type in "Request This Topic" flow | MONETIZATION.md Products | 2-3h | 🟠 P1 | Connects strategy intelligence to product catalog |
| 72 | **Client onboarding welcome flow** — First-login experience explaining tier, features, and trial period. "What's included in your plan" section | ACTION_PLAN #25 | 2-3h | 🔴 P0 | Currently clients land cold on a password prompt |
| 73 | **In-portal pricing/plans page** — Tier comparison in client portal. Bundle cards with feature lists. Stripe subscription checkout links. Upgrade/downgrade flow | MONETIZATION.md Phase 3 | 2-3h | 🟠 P1 | Where upgrade CTAs point to |

### ~~Sprint 3: Data Quality & Dashboard Polish~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 8 | **Admin Search Console: primitives audit** — Verify new panels use shared UI primitives (SectionCard, DataList, etc.) per /use-primitives workflow | Memory/Roadmap | 1-2h | 🟠 P1 | Technical debt from rapid shipping |
| 9 | **Client dashboard: simplified search data** — Add "dumbed down" GSC data to client portal: traffic growth direction, top pages (plain language), device split, period comparison as simple "up/down" indicators | Memory/Roadmap | 3-4h | 🟠 P1 | Client-facing value; no jargon |
| 10 | ~~**Admin GA4 dashboard upgrade**~~ | Memory/Roadmap | 3-4h | 🟠 P1 | ✅ Shipped in Sprint 1 |
| 11 | **Client dashboard: simplified analytics data** — Simplified GA4 organic overview, new vs returning, landing pages for client portal | Memory/Roadmap | 2-3h | 🟠 P1 | Depends on #10 for admin-side data |

### ~~Sprint 4: Intelligence Upgrades~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Status |
|---|------|--------|:----:|:--------:|-------|
| 12 | ~~**SEO Audit Intelligence**~~ | Memory/Roadmap | 3-4h | 🟠 P1 | ✅ Shipped — `/api/audit-traffic/:siteId` + traffic badges on audit page cards + sort by traffic toggle |
| 13 | **Content brief enrichment** — Inject GA4 landing page performance into brief generation for existing-page refreshes | Memory/Roadmap | 1-2h | 🟠 P1 | Partially done — briefs use GSC queries + SEMRush; GA4 page performance not yet wired |
| 14 | ~~**Monthly report enrichment**~~ | Memory/Roadmap | 1h | 🟡 P2 | ✅ Shipped — Traffic trends + chat topic summaries in email template |
| 15 | ~~**AI chatbot: conversation memory**~~ | AI_CHATBOT_ROADMAP Phase 4 | 3-4h | 🟡 P2 | ✅ Shipped — Both client + admin chat: sessions, history UI, cross-session summaries, auto-summarize |

### ~~Sprint 4b: Intelligence Wiring~~ ✅ SHIPPED
*Shipped: March 7, 2026*

| # | Item | Source | Est. | Priority | Status |
|---|------|--------|:----:|:--------:|-------|
| 58 | ~~**Admin chat: conversation memory**~~ | Intelligence Wiring | 30m | 🔴 P0 | ✅ Shipped — Full parity with client chat |
| 59 | ~~**Client chat: comparison data**~~ | Intelligence Wiring | 15m | 🔴 P0 | ✅ Shipped — Period comparison + organic data in AI context |
| 60 | ~~**Chat activity logging**~~ | Intelligence Wiring | 30m | 🔴 P0 | ✅ Shipped — `chat_session` activity type, first exchange logged |
| 61 | ~~**Audit traffic in chatbot**~~ | Intelligence Wiring | 45m | 🟠 P1 | ✅ Shipped — Cached helper + high-traffic error pages in both chat prompts |
| 62 | ~~**Monthly report: chat topics**~~ | Intelligence Wiring | 30m | � P1 | ✅ Shipped — "Topics You Asked About" section from session summaries |
| 63 | ~~**Strategy: conversion data**~~ | Intelligence Wiring | 30m | 🟠 P1 | ✅ Shipped — GA4 conversions + events by page + audit errors in strategy prompt |

### ~~Sprint 5–6 + Backlog: Reorganized into Sprints A–E~~ (see below)
*All remaining work has been reorganized as of March 7, 2026. See new sprint structure.*

---

## Current Execution Plan (Sprints A–E)

*Reorganized: March 7, 2026. Old numbered sprints (1–6) archived in `data/roadmap.json`. New lettered sprints reflect current priorities.*

### Sprint A: Quick Wins (3-5 hrs)
*No-brainer items: one-line changes, inject existing data, small guards. Ship in a single session.*

| # | Item | Est. | Priority | Notes |
|---|------|:----:|:--------:|-------|
| 90 | **Schema generator → gpt-4o upgrade** | 15m | � P0 | One-line model change in schema-suggester.ts |
| 91 | **SEO audit AI → gpt-4o-mini cost savings** | 15m | � P0 | One-line model change for cost savings |
| 87 | **Content brief: GA4 page performance injection** | 1-2h | � P0 | Inject existing GA4 data into brief generation prompt |
| 50 | **Concurrent background job limits** | 1-2h | � P1 | In-memory lock to prevent duplicate audits/crawls |

### Sprint B: Revenue Engine (13-18 hrs)
*Direct revenue impact: justify retainer with ROI data, prevent churn, enable self-service upgrades, unlock prepaid revenue.*

| # | Item | Est. | Priority | Notes |
|---|------|:----:|:--------:|-------|
| 74 | **ROI dashboard (Premium)** | 3-4h | 🔴 P0 | GSC clicks × SEMRush CPC = organic traffic value in dollars. Biggest retention tool. |
| 88 | **Self-service tier upgrade via Stripe** | 3-4h | � P0 | Replace mailto CTAs with Stripe subscription checkout. Biggest conversion friction point. |
| 75 | **Churn prevention signals** | 2-3h | 🔴 P0 | Background job: no-login, chat drop-off, score drops. Alerts in Command Center. |
| 77 | **Usage tracking + limits** | 2-3h | 🟠 P1 | Per-workspace monthly usage. "3 of 4 briefs remaining" indicators. |
| 76 | **Credits system** | 2-3h | � P1 | Prepaid credit packs. Purchase via Stripe. Admin can grant credits. |

### Sprint C: Client Value & Retention (13-18 hrs)
*Keep clients engaged, prove value, reduce churn. Each feature adds a reason to stay.*

| # | Item | Est. | Priority | Notes |
|---|------|:----:|:--------:|-------|
| 25 | **Client onboarding wizard** | 2-3h | � P0 | Guided first-time experience. Reduces early drop-off. |
| 30 | **"What happened this month" summary** | 2-3h | � P0 | AI-synthesized monthly summary. Overview + email. |
| 31 | **Content performance tracker** | 3-4h | 🟠 P1 | Track GSC/GA4 per published post. Proves content ROI. |
| 33 | **AI anomaly detection** | 4-5h | � P1 | Flag traffic/conversion anomalies. Proactive value. |
| 29 | **Automated competitive monitoring** | 3-4h | � P2 | Monthly competitor audit. Shows you're watching the landscape. |

### Sprint D: Platform Scale & Integrations (12-18 hrs)
*Expand reach: white-label for resale revenue, webhooks for automation, multi-modal chat.*

| # | Item | Est. | Priority | Notes |
|---|------|:----:|:--------:|-------|
| 27 | **White-label domain support** | 4-6h | � P0 | CNAME + branding. Agency resale tiers ($299-999/mo). New revenue stream. |
| 26 | **Webhook / Zapier triggers** | 3-4h | � P1 | Fire on key events. Enables automation integrations. |
| 22 | **AI chatbot: multi-modal responses** | 3-4h | � P1 | Inline charts, data tables in chat. Differentiator. |
| 52 | **Responsive mobile layout** | 4-6h | � P2 | Required for white-label clients on mobile. |

### Sprint E: Team, Workflow & Polish (16-22 hrs)
*Internal team features (when hiring), content workflow, quality-of-life.*

| # | Item | Est. | Priority | Notes |
|---|------|:----:|:--------:|-------|
| 16 | **Internal team management** | 4-5h | 🟠 P1 | Invite, manage, assign workspaces. When hiring/contracting. |
| 17 | **Permission-based feature access** | 3-4h | � P1 | client_member view-only, member can't delete workspaces. |
| 23 | **Writer assignment** | 2-3h | 🟡 P2 | Assign briefs to writers. Track who's working on what. |
| 21 | **Content calendar** | 3-4h | 🟡 P2 | Visual calendar of content pipeline with due dates. |
| 20 | **Notification preferences** | 2-3h | � P3 | Per-user email settings, digest frequency, in-app bell. |

### Backlog (60+ hrs)
*Revisit quarterly. See `data/roadmap.json` for full item list (19 items).*

---

## Summary View

### Shipped work

| Sprint | Items | Hours | Status |
|--------|:-----:|:-----:|--------|
| Sprint 1: AI Chatbot Revenue Engine | 8 | 10-13h | ✅ Shipped |
| Sprint 2: Stripe Payments & Auth | 9 | 26-37h | ✅ Shipped |
| Sprint 2b: Monetization UX | 6 | 12-18h | ✅ Shipped |
| Sprint 2c: Client UX & Polish | 7 | 4-6h | ✅ Shipped |
| Sprint 3: Data Quality & Dashboard | 5 | 8-12h | ✅ Shipped |
| Sprint 4/4b: Intelligence | 10 | 9-14h | ✅ Shipped |
| Sprint 6 (partial): Platform Polish | 3 | 6-8h | ✅ Shipped |
| **Total shipped** | **48** | **75-108h** | |

### Remaining work

| Sprint | Items | Hours | Focus |
|--------|:-----:|:-----:|-------|
| A: Quick Wins | 4 | 3-5h | One-line changes, data injection, guards |
| B: Revenue Engine | 5 | 13-18h | ROI dashboard, self-service upgrades, churn prevention |
| C: Client Value & Retention | 5 | 13-18h | Onboarding, monthly summaries, content tracking |
| D: Platform Scale & Integrations | 4 | 12-18h | White-label, webhooks, multi-modal chat, mobile |
| E: Team, Workflow & Polish | 5 | 16-22h | Team management, permissions, content calendar |
| Backlog | 19 | 60+h | Revisit quarterly |
| **Total remaining** | **42** | **117-141h** | |

### Execution cadence

```
Sprint A:  Quick Wins            →   3-5 hrs   →  Ship in one session
Sprint B:  Revenue Engine        →  13-18 hrs  →  ROI + upgrades + churn prevention
Sprint C:  Client Retention      →  13-18 hrs  →  Onboarding + monthly insights + tracking
Sprint D:  Platform Scale        →  12-18 hrs  →  White-label + webhooks + mobile
Sprint E:  Team & Polish         →  16-22 hrs  →  When hiring/scaling
                                    ─────────
                                    57-81 hrs for Sprints A-D (revenue-focused)
```

---

## Decision Log

Track key decisions here as they're made:

| Date | Decision | Context |
|------|----------|---------|
| 2026-03-07 | AI chatbot upgrade prioritized over auth | Faster to ship, no dependencies, immediate revenue potential |
| 2026-03-07 | Auth roadmap: start with internal accounts, then client | Internal accounts are the foundation; client accounts are the value |
| 2026-03-07 | Client onboarding wizard added as P0 | Currently clients land cold — high-friction first experience |
| 2026-03-07 | Stripe payments added as P0 in Sprint 2 | Accept payments for briefs, blog posts, keyword strategies — direct revenue from existing pipeline |
| 2026-03-07 | Roadmap moved to server-side JSON | Items managed via API, no code changes needed to add/reorder/update items |
| 2026-03-07 | 18 missing items added from FEATURE_AUDIT + ACTION_PLAN | 34 → 52 total items; comprehensive coverage of all planned features |
| 2026-03-07 | Sprint 1 shipped: full chatbot revenue engine | All 5 items (context, knowledge base, sales engine, admin chat, GA4 upgrade) shipped same day |
| 2026-03-07 | Audit pipeline: error sort + flag + Fix→ + auto-fix | Pages sorted by errors, Flag for Client workflow, Fix→ routes to tools with auto-generation context |
| 2026-03-07 | Workspace Home Dashboard added | Per-workspace landing page with parallel-fetched audit/search/GA4/ranks/requests/activity data |
| 2026-03-07 | Sidebar restructured | Icon-only bottom bar, Command Center button, grouped nav (Analytics, Site Health, SEO, Manage) |
| 2026-03-07 | Sprint 6 items #18 + #19 shipped | Proactive insights (auto-greeting on chat open) + custom date range picker (calendar popover + full backend startDate/endDate support) |
| 2026-03-07 | Typography hierarchy standardized | All 8 client dashboard tabs now use consistent page title (text-xl), subtitle (text-sm), section header (text-sm semibold) sizing. Added page titles to Search, Analytics, Site Health tabs. |
| 2026-03-07 | Monetization strategy formalized | MONETIZATION.md: 3-tier model (Free/Growth/Premium), product pricing (briefs, posts, schemas, strategy), 3 bundles, Stripe integration spec. Phase 1: Stripe checkout for deliverables. |
| 2026-03-07 | UX soft-gating approach chosen (Option A) | Blurred preview + upgrade CTA overlay. All tabs stay visible; gated content shown but not accessible. More effective than hiding features. |
| 2026-03-07 | 14-day Growth trial strategy added | Loss aversion > gain framing. New workspaces get 14 days of Growth, then auto-downgrade. Countdown banner at day 10+. |
| 2026-03-07 | Page-type content products expanded | 8 brief types + 8 full content types: blog, landing, service, location, product, pillar, resource/guide. Mapped to strategy engine content opportunities. |
| 2026-03-07 | Revenue Intelligence sprint added | ROI dashboard (Premium), churn prevention signals, credits system, usage tracking. Sprint 5 in roadmap. |
| 2026-03-07 | 13 new items added to roadmap | 52 → 65 total items. New sprints: 2b (Monetization UX), 5 (Revenue Intelligence). Items #65-77. |
| 2026-03-07 | Pre-Stripe security hardening shipped | Helmet (CSP for Stripe domains), HTTPS enforcement, 3-tier rate limiting on public routes, input sanitization on all content endpoints. Item #78. |
| 2026-03-07 | Stripe integration shipped | server/stripe.ts + server/payments.ts. 14 product types, Stripe Checkout redirect, webhook handler (checkout.session.completed + payment_intent.payment_failed), payment record persistence, frontend success/cancel detection. Item #4. |
| 2026-03-07 | Stripe admin settings shipped | StripeSettings.tsx in Command Center. Encrypted on-disk config (AES-256-GCM) via stripe-config.ts. Lazy SDK init picks up new keys without restart. Product Price ID mapping with enable/disable. Zero env vars required — env vars still work as fallback for CI/Docker. Item #79. |
| 2026-03-07 | Sprint 2, 2b, 2c all shipped | Full Stripe payments, tier gating, trial, page-type briefs, client user accounts, welcome flow, plans page. 30 items across 3 sprints. |
| 2026-03-07 | Design system unified | Comprehensive UI/UX audit: all violet/indigo/blue-CTA → teal. BRAND_DESIGN_LANGUAGE.md created with Three Laws of Color, per-component color map, AI prompting guidelines. |
| 2026-03-07 | .windsurfrules created | Global rules file with session protocol, file map, design enforcement, mandatory doc updates, quality gates. Loaded at start of every Cascade session. |
| 2026-03-07 | Roadmap reorganized into Sprints A–E | 48 items shipped, 42 remaining. Old numbered sprints archived. New structure: Quick Wins → Revenue Engine → Client Retention → Platform Scale → Team & Polish. Prioritized by: easy wins first, then revenue/robustness. |
| 2026-03-08 | Platform architecture audit completed | PLATFORM_AUDIT.md: 49 issues identified across 18 admin + 11 client screens, 13 data stores. SEO_DATA_FLOW.md: full data flow mapping. |
| 2026-03-08 | Data flow unification plan created | IMPLEMENTATION_ROADMAP.md: 6 sprints to unify all data flows via PageEditState model. |
| 2026-03-08 | Sprint 0 shipped: Foundation | PageEditState interface, updatePageState() helper, usePageEditStates() hook, all 8 write endpoints wired. |
| 2026-03-08 | Sprint 1 shipped: SEO Edit Pipeline | Audit → page state, approval → page state, client approve/reject → page state + activity log. |
| 2026-03-08 | Sprint 2 shipped: Content Pipeline | Content delivery → page state, approval reason field from audit context. |
| 2026-03-08 | Sprint 3 shipped: Self-Service Fulfillment | WorkOrder model, Stripe webhook → work order creation, SeoCart + FixRecommendations, OrderStatus client view. |
| 2026-03-08 | Sprint 4 shipped: Recommendations Unification | recommendations.ts engine, auto-regeneration after audits, FixRecommendations client view, recommendation flags in editors. |
| 2026-03-08 | Sprint 5 shipped: Cross-Tool Polish | WorkspaceHome SEO status, activity feed for client actions, approval context, apply confirmation dialog, Command Center page states, request pageId linkage, prospect onboarding CTA, recommendations_ready + audit_improved email notifications. |

---

*Compiled: March 7, 2026*
*Last updated: March 8, 2026 (Data flow unification complete: 6 sprints shipped, 59 features total)*
*Next up: Sprint A — Quick Wins (3-5 hrs)*
*Total items tracked: 90+ (48 original + 6 unification sprints shipped, remaining per Sprints A–E)*
*Data source: Server-side `data/roadmap.json` (managed via /api/roadmap)*
