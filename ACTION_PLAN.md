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

### Sprint 1: AI Chatbot as Revenue Engine (10-13 hrs)
*Rationale: Fastest path to visible client value and upsell potential. No dependencies. Can ship independently.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 1 | **Client AI: Full dashboard context** — Feed audit, strategy, ranks, content pipeline, approvals, activity, annotations, GSC comparison, GA4 organic data into chatbot | AI_CHATBOT_ROADMAP Phase 1 | 3-4h | 🔴 P0 | All data already loaded in state — just needs to be passed |
| 2 | **Client AI: Global knowledge base** — SEO fundamentals, industry benchmarks, common client questions, per-workspace business context | AI_CHATBOT_ROADMAP Phase 2 | 4-5h | 🔴 P0 | Transforms chatbot from data-reader to advisor |
| 3 | **Client AI: Sales engine behavior** — Opportunity detection, soft upsell prompts, action deep-links, service-aware responses | AI_CHATBOT_ROADMAP Phase 3 | 3-4h | 🔴 P0 | This is where the chatbot pays for itself |

### Sprint 2: Authentication Foundation (15-20 hrs)
*Rationale: Blocks team scaling and client professionalism. Do after Sprint 1 because the chatbot delivers immediate value while auth is infrastructure.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 4 | **Internal user accounts** — User model, bcrypt, JWT/sessions, login by email, `req.user` on all routes | AUTH_ROADMAP Phase 1 | 6-8h | 🔴 P0 | Everything else in auth depends on this |
| 5 | **Workspace access control** — Restrict workspaces by user, role-based middleware | AUTH_ROADMAP Phase 2 | 3-4h | 🔴 P0 | Required before any team onboarding |
| 6 | **Client user accounts** — Individual client logins, client_admin/member roles, team management UI | AUTH_ROADMAP Phase 4 | 6-8h | 🔴 P0 | Replaces shared passwords, unlocks client team features |

### Sprint 3: Data Quality & Dashboard Polish (8-12 hrs)
*Rationale: Clean up recently shipped work, extend to client side, audit primitives.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 7 | **Admin Search Console: primitives audit** — Verify new panels use shared UI primitives (SectionCard, DataList, etc.) per /use-primitives workflow | Memory/Roadmap | 1-2h | 🟠 P1 | Technical debt from rapid shipping |
| 8 | **Client dashboard: simplified search data** — Add "dumbed down" GSC data to client portal: traffic growth direction, top pages (plain language), device split, period comparison as simple "up/down" indicators | Memory/Roadmap | 3-4h | 🟠 P1 | Client-facing value; no jargon |
| 9 | **Admin GA4 dashboard upgrade** — Add landing pages, organic overview, period comparison, new vs returning users panels | Memory/Roadmap | 3-4h | 🟠 P1 | Mirror what we did for Search Console |
| 10 | **Client dashboard: simplified analytics data** — Simplified GA4 organic overview, new vs returning, landing pages for client portal | Memory/Roadmap | 2-3h | 🟠 P1 | Depends on #9 for admin-side data |

### Sprint 4: Intelligence Upgrades (6-9 hrs)
*Rationale: Cross-pollinate data across tools for smarter recommendations.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 11 | **SEO Audit Intelligence** — Cross-reference audit findings with GSC/GA4 performance data. "This page has a missing meta description AND gets 500 impressions/month — fix this first" | Memory/Roadmap | 3-4h | 🟠 P1 | High impact: prioritizes audit fixes by actual traffic |
| 12 | **Content brief enrichment** — Inject real GSC queries + GA4 landing page performance into AI brief generation | Memory/Roadmap | 1-2h | 🟠 P1 | Quick win: better briefs with data already available |
| 13 | **Monthly report enrichment** — Period comparison data in auto-generated report narratives | Memory/Roadmap | 1h | 🟡 P2 | Small effort, nice polish |
| 14 | **AI chatbot: conversation memory** — Session history, cross-session summaries, client preferences | AI_CHATBOT_ROADMAP Phase 4 | 3-4h | 🟡 P2 | Nice but not critical yet |

### Sprint 5: Team & Permissions (7-9 hrs)
*Rationale: Only needed when actually hiring/contracting. Do when the need arises.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 15 | **Internal team management** — Invite, manage, assign workspaces, disable accounts | AUTH_ROADMAP Phase 3 | 4-5h | 🟡 P2 | When you hire someone |
| 16 | **Permission-based feature access** — Fine-grained: client_member view-only on approvals, admin member can't delete workspaces | AUTH_ROADMAP Phase 5 | 3-4h | 🟡 P2 | When a client asks "can my intern see but not approve?" |

### Sprint 6: Platform Polish (10-15 hrs)
*Rationale: Quality-of-life improvements. Do in batches between major features.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 17 | **AI chatbot: proactive insights** — Auto-surface 2-3 contextual insights on dashboard load, trigger-based suggestions | AI_CHATBOT_ROADMAP Phase 5 | 4-5h | 🟡 P2 | Makes chatbot feel alive |
| 18 | **Custom date range picker** — Replace preset buttons (7d/28d/90d) with full calendar selector | FEATURE_AUDIT | 2-3h | 🟡 P2 | Long-requested UX improvement |
| 19 | **Notification preferences** — Per-user email settings, digest frequency, in-app notification bell | AUTH_ROADMAP Phase 6 | 2-3h | 🟢 P3 | After user accounts exist |
| 20 | **Content calendar** — Visual calendar of content in production with due dates | FEATURE_AUDIT | 3-4h | 🟢 P3 | Nice visualization, not blocking |

### Backlog: Advanced Features (20-30 hrs total)
*Revisit quarterly. Do when a specific client need or sales opportunity justifies it.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 21 | **AI chatbot: multi-modal responses** — Inline charts, data tables, "show me" commands, email/export | AI_CHATBOT_ROADMAP Phase 6 | 3-4h | 🟢 P3 | Polish |
| 22 | **Writer assignment** — Assign content to specific writers with notifications | FEATURE_AUDIT | 2-3h | 🟢 P3 | When content volume justifies it |
| 23 | **Multi-competitor analysis** — Compare against 2-3 competitors simultaneously | FEATURE_AUDIT | 3-4h | 🟢 P3 | Sales tool enhancement |
| 24 | **Historical redirect comparison** — Track redirect status over time, detect new 404s | FEATURE_AUDIT | 2-3h | 🟢 P3 | Nice for ongoing monitoring |
| 25 | **Full-site PageSpeed** — Multi-page PSI scan as background job | FEATURE_AUDIT | 3-4h | 🟢 P3 | Expensive API calls, niche use |
| 26 | **Accessibility audit expansion** — WCAG contrast, ARIA, heading order, form labels | FEATURE_AUDIT | 3-4h | 🟢 P3 | Differentiation for accessibility-conscious clients |
| 27 | **GSC Phase 4: URL Inspection API** — Per-URL indexing status, crawl info | Memory/Roadmap | 3-4h | ⚪ P4 | API access may require verification |
| 28 | **GSC Phase 4: Sitemaps API** — Sitemap submission status, coverage | Memory/Roadmap | 2-3h | ⚪ P4 | Niche |
| 29 | **GA4 Phase 4: Exit pages, first-touch attribution** | Memory/Roadmap | 3-4h | ⚪ P4 | Advanced analytics |
| 30 | **Webflow Enterprise API: 301 redirects** — Push rules via API (Enterprise-only) | FEATURE_AUDIT | 1-2h | ⚪ P4 | Blocked by Enterprise access |
| 31 | **Sales report: branded PDF export** — Downloadable prospect reports with agency branding | FEATURE_AUDIT | 3-4h | ⚪ P4 | Sales tool polish |
| 32 | **Sales report: email delivery** — Send reports directly to prospects | FEATURE_AUDIT | 2h | ⚪ P4 | Depends on #31 |
| 33 | **Concurrent background job limits** — Prevent duplicate audits on same site | FEATURE_AUDIT | 1-2h | ⚪ P4 | Edge case protection |
| 34 | **Heavy dependency audit / tree-shaking** — Verify Lucide tree-shaking, audit chart libs | FEATURE_AUDIT | 2h | ⚪ P4 | Performance micro-optimization |
| 35 | **Responsive mobile layout** — Sidebar → bottom nav, stacked cards on small screens | FEATURE_AUDIT | 4-6h | ⚪ P4 | Large effort, admin is desktop-primary |

---

## New Feature Proposals (Not Previously Considered)

These emerged from analyzing the full platform and identifying gaps:

### 🔴 P0 — High conviction

| # | Feature | Est. | Rationale |
|---|---------|:----:|-----------|
| 36 | **Client onboarding wizard** | 2-3h | Guided first-time experience for new clients: connect workspace → set password → tour dashboard. Currently clients land cold on a password prompt. A proper onboarding flow increases activation and reduces support questions. |
| 37 | **Webhook / Zapier triggers** | 3-4h | Fire webhooks on key events (new request, approval completed, audit score drop, content delivered). Lets clients wire into their own tools (Slack, project management, CRM). Low effort, high perceived value for enterprise-ish clients. |

### 🟠 P1 — Strong additions

| # | Feature | Est. | Rationale |
|---|---------|:----:|-----------|
| 38 | **White-label domain support** | 2-3h | Let client portals live on `dashboard.clientdomain.com` instead of your domain. A CNAME + reverse proxy setup. Massively increases perceived value for larger clients and justifies higher retainers. |
| 39 | **ROI calculator / value dashboard** | 3-4h | "Your organic traffic is worth $X,XXX/month in equivalent ad spend." Use GSC data + average CPC from SEMRush to show dollar value. Powerful retention tool — clients see the monetary value of your work. |
| 40 | **Automated competitive monitoring** | 3-4h | Run competitor audit on a schedule (monthly), track their score over time, alert when they improve. "Your competitor just improved their site score — here's what changed." Creates urgency for ongoing work. |
| 41 | **Client dashboard: "What happened this month" summary** | 2-3h | Auto-generated plain-English monthly summary: "Your traffic grew 15%, we fixed 8 SEO issues, and published 2 new blog posts." Replaces the monthly report call for many clients. |

### 🟡 P2 — Worth exploring

| # | Feature | Est. | Rationale |
|---|---------|:----:|-----------|
| 42 | **Content performance tracker** | 3-4h | After a blog post is published, track its GSC/GA4 performance over time. "Blog post X is now ranking #4 for 'target keyword' and driving 200 visits/month." Proves content ROI. |
| 43 | **Shared notes / internal wiki per workspace** | 2-3h | Team-internal notes about a client (brand guidelines, contact preferences, quirks, meeting notes). Valuable when team grows. |
| 44 | **AI-powered anomaly detection** | 4-5h | Background job that compares current week vs previous weeks and flags anomalies: sudden traffic drops, new 404 spikes, conversion rate changes. Alerts via email. Proactive monitoring without manual checking. |
| 45 | **Client NPS / satisfaction survey** | 2h | Periodic in-dashboard survey: "How satisfied are you with your web team? (1-10)". Simple signal for churn risk. Low effort. |

---

## Summary View

### By effort bucket

| Bucket | Items | Total Hours |
|--------|:-----:|:-----------:|
| 🔴 P0 — Do now | 8 items (#1-6, #36-37) | 30-42h |
| 🟠 P1 — Do next | 8 items (#7-12, #38-41) | 20-30h |
| 🟡 P2 — Do soon | 8 items (#13-18, #42-43) | 20-28h |
| 🟢 P3 — Backlog | 7 items (#19-23, #44-45) | 16-24h |
| ⚪ P4 — Someday | 12 items (#24-35) | 30-42h |
| **Total** | **43 items** | **116-166h** |

### Critical path (first 3 sprints)

```
Sprint 1: AI Chatbot Revenue Engine    →  10-13 hrs  →  Immediate client value
Sprint 2: Authentication Foundation    →  15-20 hrs  →  Team scaling + professionalism
Sprint 3: Data Quality + Dashboard     →   8-12 hrs  →  Polish + client-facing data
                                          ─────────
                                          33-45 hrs total for the critical path
```

### Recommended execution cadence

- **Sprints 1-2**: Back to back, full focus. These are the platform's two biggest gaps.
- **Sprint 3**: Interleave with client work. Items are independent and can be cherry-picked.
- **Sprint 4+**: Pull from the backlog as needs arise. No fixed schedule.

---

## Decision Log

Track key decisions here as they're made:

| Date | Decision | Context |
|------|----------|---------|
| 2026-03-07 | AI chatbot upgrade prioritized over auth | Faster to ship, no dependencies, immediate revenue potential |
| 2026-03-07 | Auth roadmap: start with internal accounts, then client | Internal accounts are the foundation; client accounts are the value |
| 2026-03-07 | Client onboarding wizard added as P0 | Currently clients land cold — high-friction first experience |
| | | |

---

*Compiled: March 7, 2026*
*Next review: After Sprint 1 completion*
*Total items tracked: 45*
