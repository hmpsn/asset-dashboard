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

### Sprint 2: Stripe Payments & Auth Foundation (20-28 hrs)
*Rationale: Monetize content deliverables and establish user identity. Revenue + infrastructure.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 4 | **Stripe integration: content payments** — Accept payments for content briefs, full blog posts, and keyword strategies. Stripe Checkout or Payment Links, webhook for fulfillment status, payment tracking per workspace | User Priority | 5-7h | 🔴 P0 | Direct revenue from existing content pipeline |
| 5 | **Internal user accounts** — User model, bcrypt, JWT/sessions, login by email, `req.user` on all routes | AUTH_ROADMAP Phase 1 | 6-8h | 🔴 P0 | Everything else in auth depends on this |
| 6 | **Workspace access control** — Restrict workspaces by user, role-based middleware | AUTH_ROADMAP Phase 2 | 3-4h | 🔴 P0 | Required before any team onboarding |
| 7 | **Client user accounts** — Individual client logins, client_admin/member roles, team management UI | AUTH_ROADMAP Phase 4 | 6-8h | 🔴 P0 | Replaces shared passwords, unlocks client team features |

### Sprint 3: Data Quality & Dashboard Polish (8-12 hrs)
*Rationale: Clean up recently shipped work, extend to client side, audit primitives.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 8 | **Admin Search Console: primitives audit** — Verify new panels use shared UI primitives (SectionCard, DataList, etc.) per /use-primitives workflow | Memory/Roadmap | 1-2h | 🟠 P1 | Technical debt from rapid shipping |
| 9 | **Client dashboard: simplified search data** — Add "dumbed down" GSC data to client portal: traffic growth direction, top pages (plain language), device split, period comparison as simple "up/down" indicators | Memory/Roadmap | 3-4h | 🟠 P1 | Client-facing value; no jargon |
| 10 | **Admin GA4 dashboard upgrade** — Add landing pages, organic overview, period comparison, new vs returning users panels | Memory/Roadmap | 3-4h | 🟠 P1 | Mirror what we did for Search Console |
| 11 | **Client dashboard: simplified analytics data** — Simplified GA4 organic overview, new vs returning, landing pages for client portal | Memory/Roadmap | 2-3h | 🟠 P1 | Depends on #10 for admin-side data |

### Sprint 4: Intelligence Upgrades (6-9 hrs)
*Rationale: Cross-pollinate data across tools for smarter recommendations.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 12 | **SEO Audit Intelligence** — Cross-reference audit findings with GSC/GA4 performance data. "This page has a missing meta description AND gets 500 impressions/month — fix this first" | Memory/Roadmap | 3-4h | 🟠 P1 | High impact: prioritizes audit fixes by actual traffic |
| 13 | **Content brief enrichment** — Inject real GSC queries + GA4 landing page performance into AI brief generation | Memory/Roadmap | 1-2h | 🟠 P1 | Quick win: better briefs with data already available |
| 14 | **Monthly report enrichment** — Period comparison data in auto-generated report narratives | Memory/Roadmap | 1h | 🟡 P2 | Small effort, nice polish |
| 15 | **AI chatbot: conversation memory** — Session history, cross-session summaries, client preferences | AI_CHATBOT_ROADMAP Phase 4 | 3-4h | 🟡 P2 | Nice but not critical yet |

### Sprint 5: Team & Permissions (7-9 hrs)
*Rationale: Only needed when actually hiring/contracting. Do when the need arises.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 16 | **Internal team management** — Invite, manage, assign workspaces, disable accounts | AUTH_ROADMAP Phase 3 | 4-5h | 🟡 P2 | When you hire someone |
| 17 | **Permission-based feature access** — Fine-grained: client_member view-only on approvals, admin member can't delete workspaces | AUTH_ROADMAP Phase 5 | 3-4h | 🟡 P2 | When a client asks "can my intern see but not approve?" |

### Sprint 6: Platform Polish (10-15 hrs)
*Rationale: Quality-of-life improvements. Do in batches between major features.*

| # | Item | Source | Est. | Priority | Notes |
|---|------|--------|:----:|:--------:|-------|
| 18 | **AI chatbot: proactive insights** — Auto-surface 2-3 contextual insights on dashboard load, trigger-based suggestions | AI_CHATBOT_ROADMAP Phase 5 | 4-5h | 🟡 P2 | Makes chatbot feel alive |
| 19 | **Custom date range picker** — Replace preset buttons (7d/28d/90d) with full calendar selector | FEATURE_AUDIT | 2-3h | 🟡 P2 | Long-requested UX improvement |
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
| 🔴 P0 — Do now | 9 items (#1-7, #25-26) | 38-51h |
| 🟠 P1 — Do next | 8 items (#8-13, #27-30) | 20-30h |
| 🟡 P2 — Do soon | 12 items (#14-15, #18-19, #31-37) | 28-40h |
| 🟢 P3 — Backlog | 13 items (#20-24, #38-44) | 32-46h |
| ⚪ P4 — Someday | 8 items (#45-52) | 19-26h |
| **Total** | **52 items** | **137-193h** |

### Critical path (first 3 sprints)

```
Sprint 1: AI Chatbot Revenue Engine        →  10-13 hrs  →  Immediate client value
Sprint 2: Stripe Payments + Auth Foundation →  20-28 hrs  →  Revenue + user identity
Sprint 3: Data Quality + Dashboard          →   8-12 hrs  →  Polish + client-facing data
                                               ─────────
                                               38-53 hrs total for the critical path
```

### Recommended execution cadence

- **Sprints 1-2**: Back to back, full focus. Revenue engine + monetization + auth foundation.
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
| 2026-03-07 | Stripe payments added as P0 in Sprint 2 | Accept payments for briefs, blog posts, keyword strategies — direct revenue from existing pipeline |
| 2026-03-07 | Roadmap moved to server-side JSON | Items managed via API, no code changes needed to add/reorder/update items |
| 2026-03-07 | 18 missing items added from FEATURE_AUDIT + ACTION_PLAN | 34 → 52 total items; comprehensive coverage of all planned features |
| | | |

---

*Compiled: March 7, 2026*
*Last updated: March 7, 2026*
*Next review: After Sprint 1 completion*
*Total items tracked: 52*
*Data source: Server-side roadmap.json (managed via /api/roadmap)*
