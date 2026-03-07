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

### Sprint 2: Stripe Payments & Auth Foundation (26-37 hrs)
*Rationale: Monetize content deliverables, establish tier gating, and build user identity. Revenue + infrastructure.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 78 | ~~**Pre-Stripe security hardening**~~ — Helmet security headers (CSP whitelists Stripe), HTTPS enforcement, rate limiting (60/min read, 10/min write, 5/min checkout), input sanitization on content endpoints | Security Audit | 1h | 🔴 P0 | ✅ Shipped — foundation for payment routes |
| 4 | **Stripe integration: content payments** — Stripe Checkout for briefs, posts, schemas, strategies. Webhook handler, payment tracking per workspace. `server/stripe.ts` + `server/payments.ts` | MONETIZATION.md Phase 1 | 5-7h | 🔴 P0 | Direct revenue from existing content pipeline |
| 65 | **Workspace tier field + TierGate component** — Add `tier: free\|growth\|premium` to Workspace. Create `<TierGate>` with blur overlay + upgrade CTA. `GET /api/public/tier/:wsId` | MONETIZATION.md UX Spec | 1-2h | 🔴 P0 | Foundation for all tier gating |
| 66 | **Soft-gate dashboard sections** — Wrap ~10-15 sections in TierGate: Strategy page map, content gaps, brief generation, approve/reject, custom date ranges, chat input after limit | MONETIZATION.md UX Spec | 1.5-2h | 🔴 P0 | Depends on #65 |
| 67 | **AI chatbot rate limiting (free tier)** — Monthly conversation counter in `chat-memory.ts`. 3 convos/month free. Counter in chat header. Disable proactive insights on free tier | MONETIZATION.md UX Spec | 1h | 🔴 P0 | Depends on #65 |
| 5 | **Internal user accounts** — User model, bcrypt, JWT/sessions, login by email, `req.user` on all routes | AUTH_ROADMAP Phase 1 | 6-8h | 🔴 P0 | Everything else in auth depends on this |
| 6 | **Workspace access control** — Restrict workspaces by user, role-based middleware | AUTH_ROADMAP Phase 2 | 3-4h | 🔴 P0 | Required before any team onboarding |
| 7 | **Client user accounts** — Individual client logins, client_admin/member roles, team management UI | AUTH_ROADMAP Phase 4 | 6-8h | 🔴 P0 | Replaces shared passwords, unlocks client team features |

### Sprint 2b: Monetization UX (12-18 hrs)
*Rationale: Maximize conversion from free → paid. Trial drives upgrades, page types expand product catalog, inline pricing reduces friction.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 68 | **14-day Growth trial for new workspaces** — `trialEndsAt` field on Workspace. Auto-resolve tier to growth during trial. Countdown banner at day 10+. Auto-downgrade to free | MONETIZATION.md Trial Strategy | 1-2h | 🔴 P0 | Loss aversion drives more upgrades than gain framing |
| 69 | **Inline price visibility** — Show prices on all purchase buttons (brief $125, post $500, schema $35/pg). Bundle savings callouts. Prices from config, admin per-workspace overrides | MONETIZATION.md Pricing | 2-3h | 🔴 P0 | Reduces checkout friction |
| 70 | **Page-type content briefs** — Expand brief generator: landing page, service page, location page, product page, pillar/hub page, resource/guide. Page-type-specific AI prompts and templates | MONETIZATION.md Products | 3-4h | 🔴 P0 | Expands product catalog from 2 to 8 brief types |
| 71 | **Page type → content opportunity mapping** — Strategy engine recommends page types based on gap signals. Badge on content opportunity cards. Pre-selects type in "Request This Topic" flow | MONETIZATION.md Products | 2-3h | 🟠 P1 | Connects strategy intelligence to product catalog |
| 72 | **Client onboarding welcome flow** — First-login experience explaining tier, features, and trial period. "What's included in your plan" section | ACTION_PLAN #25 | 2-3h | 🔴 P0 | Currently clients land cold on a password prompt |
| 73 | **In-portal pricing/plans page** — Tier comparison in client portal. Bundle cards with feature lists. Stripe subscription checkout links. Upgrade/downgrade flow | MONETIZATION.md Phase 3 | 2-3h | 🟠 P1 | Where upgrade CTAs point to |

### Sprint 3: Data Quality & Dashboard Polish (8-12 hrs)
*Rationale: Clean up recently shipped work, extend to client side, audit primitives.*

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

### Sprint 5: Revenue Intelligence (10-14 hrs)
*Rationale: Features that directly retain clients and increase lifetime value. ROI dashboard justifies retainer; churn signals prevent loss; credits increase prepaid revenue.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 74 | **ROI dashboard (Premium)** — Organic traffic value in dollars (GSC clicks × SEMRush CPC). Ad spend equivalent. Content ROI. Growth trend. Blurred soft-gate for free/growth | MONETIZATION.md ROI Spec | 3-4h | 🟠 P1 | Single most powerful retention tool |
| 75 | **Churn prevention signals** — Daily background job: no-login 14d, chat drop-off, no requests 30d, health score drop, trial ending, payment failed. Positive signals: traffic up 20%+, high engagement | MONETIZATION.md Churn Spec | 2-3h | 🟠 P1 | Extends Command Center "Needs Attention" |
| 76 | **Credits system** — Prepaid credit packs ($500/5cr, $900/10cr, $1600/20cr). Per-product credit costs. Purchase via Stripe. Admin can grant credits | MONETIZATION.md Credits Spec | 2-3h | 🟡 P2 | Cash flow positive, reduces checkout friction |
| 77 | **Usage tracking + limits** — Track AI convos, briefs, strategies per workspace per month. Usage indicators ("3 of 4 briefs remaining"). Overage prompts. Admin usage dashboard | MONETIZATION.md Phase 4 | 2-3h | 🟡 P2 | Required for bundle enforcement |

### Sprint 5b: Team & Permissions (7-9 hrs)
*Rationale: Only needed when actually hiring/contracting. Do when the need arises.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 16 | **Internal team management** — Invite, manage, assign workspaces, disable accounts | AUTH_ROADMAP Phase 3 | 4-5h | 🟡 P2 | When you hire someone |
| 17 | **Permission-based feature access** — Fine-grained: client_member view-only on approvals, admin member can't delete workspaces | AUTH_ROADMAP Phase 5 | 3-4h | 🟡 P2 | When a client asks "can my intern see but not approve?" |

### Sprint 6: Platform Polish (10-15 hrs)
*Rationale: Quality-of-life improvements. Do in batches between major features.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 18 | ~~**AI chatbot: proactive insights**~~ | AI_CHATBOT_ROADMAP Phase 5 | 4-5h | 🟡 P2 | ✅ Shipped — Auto-greeting with 2-3 data-driven insights on chat open, quick question follow-ups |
| 19 | ~~**Custom date range picker**~~ | FEATURE_AUDIT | 2-3h | 🟡 P2 | ✅ Shipped — Preset buttons + Custom calendar popover; backend: all GSC + GA4 routes accept startDate/endDate |
| 20 | **Notification preferences** — Per-user email settings, digest frequency, in-app notification bell | AUTH_ROADMAP Phase 6 | 2-3h | 🟢 P3 | After user accounts exist |
| 21 | **Content calendar** — Visual calendar view of content in production with due dates | FEATURE_AUDIT | 3-4h | 🟢 P3 | Nice visualization, not blocking |

### Backlog: Advanced Features (80+ hrs total)
*Revisit quarterly. Do when a specific client need or sales opportunity justifies it.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 22 | **AI chatbot: multi-modal responses** — Inline charts, data tables, "show me" commands, email/export | AI_CHATBOT_ROADMAP Phase 6 | 3-4h | 🟢 P3 | Polish |
| 23 | **Writer assignment** — Assign content to specific writers with notifications | FEATURE_AUDIT | 2-3h | 🟢 P3 | When content volume justifies it |
| 24 | **Multi-competitor analysis** — Compare against 2-3 competitors simultaneously | FEATURE_AUDIT | 3-4h | 🟢 P3 | Sales tool enhancement |
| 25 | **Client onboarding wizard** — Guided first-time experience for new clients | ACTION_PLAN | 2-3h | 🔴 P0 | Currently clients land cold on a password prompt |
| 26 | **Webhook / Zapier triggers** — Fire webhooks on key events | ACTION_PLAN | 3-4h | 🔴 P0 | Low effort, high perceived value for enterprise-ish clients |
| 27 | **White-label domain support** — CNAME + reverse proxy for client portals | ACTION_PLAN | 2-3h | 🟠 P1 | Massively increases perceived value for larger clients |
| 28 | **ROI calculator / value dashboard** — Show dollar value of organic traffic | ACTION_PLAN | 3-4h | 🟠 P1 | Powerful retention tool |
| 29 | **Automated competitive monitoring** — Monthly competitor audit, alert on improvements | ACTION_PLAN | 3-4h | 🟠 P1 | Creates urgency for ongoing work |
| 30 | **"What happened this month" summary** — Auto-generated plain-English monthly summary | ACTION_PLAN | 2-3h | 🟠 P1 | Replaces the monthly report call |
| 31 | **Content performance tracker** — Track GSC/GA4 performance per published post | ACTION_PLAN | 3-4h | 🟡 P2 | Proves content ROI |
| 32 | **Shared notes / wiki per workspace** — Team-internal notes about a client | ACTION_PLAN | 2-3h | 🟡 P2 | Valuable when team grows |
| 33 | **AI anomaly detection** — Background job to flag traffic/conversion anomalies | ACTION_PLAN | 4-5h | 🟡 P2 | Proactive monitoring |
| 34 | **Client NPS survey** — Periodic in-dashboard satisfaction survey | ACTION_PLAN | 2h | 🟡 P2 | Simple churn risk signal |
| 35 | **Content delivery attachments** — Attach Google Docs or uploaded files to completed requests | FEATURE_AUDIT | 2-3h | 🟡 P2 | Content pipeline completion |
| 36 | **GSC 404 import for redirect scanner** — Pull crawl errors from GSC to seed scanner | FEATURE_AUDIT | 2-3h | 🟡 P2 | Better redirect coverage |
| 37 | **Audit historical trend charts** — Track audit score over time per-page | FEATURE_AUDIT | 3-4h | 🟡 P2 | Nice for ongoing monitoring |
| 38 | **Schema auto-schedule** — Re-generate schemas on cadence, flag stale pages | FEATURE_AUDIT | 2-3h | 🟢 P3 | Automation |
| 39 | **Competitor historical comparisons** — Track competitor gap over time | FEATURE_AUDIT | 3-4h | 🟢 P3 | Deeper competitive analysis |
| 40 | **Competitor keyword overlap** — Show shared keywords and where you win/lose | FEATURE_AUDIT | 3-4h | 🟢 P3 | Competitive insight |
| 41 | **Historical redirect comparison** — Track redirect status over time, detect new 404s | FEATURE_AUDIT | 2-3h | 🟢 P3 | Nice for ongoing monitoring |
| 42 | **Full-site PageSpeed scan** — Multi-page PSI scan as background job | FEATURE_AUDIT | 3-4h | 🟢 P3 | Expensive API calls, niche use |
| 43 | **Accessibility audit expansion** — WCAG contrast, ARIA, heading order, form labels | FEATURE_AUDIT | 3-4h | 🟢 P3 | Differentiation for accessibility-conscious clients |
| 44 | **WCAG AA full compliance** — Focus indicators, keyboard nav for all interactive elements | FEATURE_AUDIT | 3-4h | 🟢 P3 | Full accessibility |
| 45 | **GSC Phase 4: URL Inspection API** — Per-URL indexing status, crawl info | Memory/Roadmap | 3-4h | ⚪ P4 | API access may require verification |
| 46 | **GA4 Phase 4: Exit pages + attribution** — Exit pages, first-touch attribution | Memory/Roadmap | 3-4h | ⚪ P4 | Advanced analytics |
| 47 | **Webflow Enterprise API: 301 redirects** — Push rules via API (Enterprise-only) | FEATURE_AUDIT | 1-2h | ⚪ P4 | Blocked by Enterprise access |
| 48 | **Sales report: branded PDF export** — Downloadable prospect reports with agency branding | FEATURE_AUDIT | 3-4h | ⚪ P4 | Sales tool polish |
| 49 | **Sales report: email delivery** — Send reports directly to prospects | FEATURE_AUDIT | 2h | ⚪ P4 | Depends on #48 |
| 50 | **Concurrent background job limits** — Prevent duplicate audits on same site | FEATURE_AUDIT | 1-2h | ⚪ P4 | Edge case protection |
| 51 | **Heavy dependency audit / tree-shaking** — Verify Lucide tree-shaking, audit chart libs | FEATURE_AUDIT | 2h | ⚪ P4 | Performance micro-optimization |
| 52 | **Responsive mobile layout** — Sidebar → bottom nav, stacked cards on small screens | FEATURE_AUDIT | 4-6h | ⚪ P4 | Large effort, admin is desktop-primary |

---

## Summary View

### By effort bucket

| Bucket | Items | Total Hours |
|--------|:-----:|:-----------:|
| 🔴 P0 — Do now | 16 items (#1-7, #25-26, #65-70, #72, #78) | 55-76h |
| 🟠 P1 — Do next | 12 items (#8-13, #27-30, #71, #73-75) | 30-44h |
| 🟡 P2 — Do soon | 14 items (#14-17, #18-19, #31-37, #76-77) | 33-48h |
| 🟢 P3 — Backlog | 13 items (#20-24, #38-44) | 32-46h |
| ⚪ P4 — Someday | 8 items (#45-52) | 19-26h |
| **Total** | **66 items** | **169-240h** |

### Critical path (first 4 sprints)

```
Sprint 1:  AI Chatbot Revenue Engine  ✅     →  10-13 hrs  →  Shipped
Sprint 2:  Stripe + Tiers + Auth              →  26-37 hrs  →  Revenue + tier gating + identity
Sprint 2b: Monetization UX                    →  12-18 hrs  →  Trial, pricing, page types, onboarding
Sprint 3:  Data Quality + Dashboard  ✅       →   8-12 hrs  →  Shipped
                                                 ─────────
                                                 56-80 hrs total for the critical path
```

### Recommended execution cadence

- **Sprint 1**: ✅ Shipped.
- **Sprint 2**: Security hardening shipped. Stripe next. Tier gating + auth can interleave.
- **Sprint 2b**: Immediately after Sprint 2. Trial + pricing + page types maximize conversion.
- **Sprint 3**: ✅ Shipped.
- **Sprint 4/4b**: ✅ Shipped.
- **Sprint 5**: Revenue Intelligence — do after first paying clients are live.
- **Sprint 5b+**: Pull from backlog as needs arise.

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
| | | |

---

*Compiled: March 7, 2026*
*Last updated: March 7, 2026 (Monetization strategy: tiers, trial, page types, ROI, churn, credits wired into roadmap)*
*Next review: During Sprint 2 (Stripe integration)*
*Total items tracked: 66*
*Data source: Server-side roadmap.json (managed via /api/roadmap)*
