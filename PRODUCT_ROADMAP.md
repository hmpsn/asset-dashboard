# hmpsn.studio — Product Roadmap

> **Q2 2026 (March – May)**
> A client-facing view of what's shipping, what's next, and where we're headed.
> Last updated: March 8, 2026

---

## What's Already Live

Before looking ahead, here's what you have access to today:

| Category | Feature | Status |
|----------|---------|--------|
| **Analytics** | Google Analytics + Search Console dashboards | ✅ Live |
| **Site Health** | Automated SEO audits with issue-level detail | ✅ Live |
| **AI Advisor** | 24/7 AI chat that knows your site, traffic, and strategy | ✅ Live |
| **SEO Strategy** | AI-generated keyword strategy, content gaps, quick wins | ✅ Live |
| **Content Engine** | AI-powered content briefs and full blog posts | ✅ Live |
| **ROI Dashboard** | Organic traffic value tracking in real dollars | ✅ Live |
| **Monthly Digest** | "What happened this month" performance summary | ✅ Live |
| **Self-Service Upgrades** | Upgrade your plan instantly via Stripe | ✅ Live |
| **Onboarding Wizard** | Guided first-run experience tailored to your plan | ✅ Live |
| **Transactional Emails** | Welcome, trial reminders, password reset, monthly reports | ✅ Live |
| **SEO Edit Tracking** | Every edit shows its status — teal for live, purple for in-review, yellow for flagged. No more guessing what's been touched. | ✅ Live |
| **Smart Health Scores** | Suppressed audit issues are excluded from all health scores, recommendations, and AI advice — scores reflect real priorities. | ✅ Live |
| **CMS Sitemap Filtering** | Content editor only shows collection pages that exist in your sitemap, with full URL paths. No more noise from unpublished items. | ✅ Live |

**59 documented features shipped.** Here's what's next.

---

## Month 1 — March 2026
### Theme: *Self-Service & Foundation*

The goal this month is to make the platform fully self-service — any business owner should be able to sign up, connect their site, and start getting value without any manual setup.

| Feature | What It Means For You | Priority |
|---------|----------------------|----------|
| **Self-service Webflow connection** | Connect your Webflow site in one click during onboarding — no manual setup, no waiting on us. We're evaluating Webflow OAuth (App) vs. API token to give you the smoothest experience possible. | 🔴 Critical |
| **Lead gen landing page** | A public-facing page at hmpsn.studio that explains the platform and lets new clients start a free trial. If you know someone who'd benefit, send them here. | ✅ Done |
| **Tier gating overhaul** | Clear feature boundaries between Starter (free), Growth ($249/mo), and Premium ($999/mo). You always see what's available at the next tier — no surprises. | ✅ Done |
| **Production Stripe keys** | Switch from test mode to live payments. This is the final gate before real transactions flow. | 🔴 Critical |

### Also in progress:
- GSC/GA4 self-service OAuth connection (so you can connect Google data without sharing credentials)
- Beta feedback collection from first 3-5 clients

### Recently shipped (March 8):
- **SEO edit tracking** — Every page card in the SEO editor, CMS editor, and audit view now shows its edit status (Live / In Review / Flagged) with colored borders and badges
- **Suppression-aware health scores** — Suppressed issues are excluded from all scores, issue lists, and AI recommendations across 6 data endpoints
- **CMS sitemap filtering** — Collection items filtered by sitemap; full URL paths with parent collection slugs shown
- **Unified Page Edit State** — Full lifecycle tracking per page (issue-detected → in-review → approved → rejected → live) visible across all tools
- **Work order fulfillment** — Stripe-purchased SEO fixes create work orders with admin tracking and client order status view
- **AI recommendations engine** — Traffic-weighted, auto-regenerated after audits, with client email notifications
- **SEO self-service cart** — Clients add recommended fixes to a cart and checkout via Stripe
- **Activity feed for client actions** — Approval/rejection actions logged with actor and context
- **Approval context** — "Why" reasons from audit findings shown on each proposed change
- **Command Center SEO status** — Page state summary pills on all workspace cards
- **Request-to-page linkage** — Client requests linked to specific pages with auto page state updates
- **Prospect onboarding CTA** — One-click "Onboard as Client" from Sales Report to workspace creation
- **Expanded email notifications** — Recommendations ready + audit score improved notifications

---

## Month 2 — April 2026
### Theme: *Prove the Value*

Once clients are in the door, we need to prove ROI fast. This month focuses on content performance tracking, smarter AI, and usage visibility.

| Feature | What It Means For You | Priority |
|---------|----------------------|----------|
| **Content performance tracker** | See exactly how each blog post or page performs after publishing — clicks, impressions, and keyword rankings over time. Know which content is working and which needs attention. | 🟡 High |
| **AI anomaly detection** | The platform watches your traffic 24/7 and alerts you when something significant changes — a traffic spike, a ranking drop, a conversion shift. You'll know before you even log in. | 🟡 High |
| **Usage tracking & limits** | Clear visibility into your plan usage: "You've used 3 of 4 briefs this month." No surprise bills. Transparent limits with upgrade prompts when you're getting close. | 🟡 High |
| **AI chat: inline charts & tables** | When you ask your AI advisor about traffic trends or keyword performance, it responds with visual charts and data tables — not just text. Makes conversations more actionable. | 🟢 Medium |

### Value unlocked:
- Every piece of content you purchase has a performance trail proving its ROI
- Proactive alerts mean you never miss a traffic problem or opportunity
- The AI advisor becomes more visual and actionable

---

## Month 3 — May 2026
### Theme: *Scale & Partnerships*

With the core platform proven, we expand into managed services (strategy & implementation hours) and start building for scale.

| Feature | What It Means For You | Priority |
|---------|----------------------|----------|
| **Strategy & implementation hours** | Premium clients get 3 hours/month of hands-on SEO work — meta tag updates, schema implementation, redirect setup, content publishing, audit fixes. Additional hours available in blocks ($200/hr ad-hoc, $175/hr for 5-hr blocks, $150/hr for 10-hr blocks). All scoped to SEO execution. | 🟡 High |
| **Competitor monitoring** | Automated monthly competitor audits. See when competitors gain keywords, publish new content, or improve their technical SEO. Stay one step ahead without lifting a finger. | 🟢 Medium |
| **Responsive mobile layout** | Full dashboard experience on your phone. Check your SEO performance, approve changes, and chat with your AI advisor from anywhere. | 🟢 Medium |
| **Webhook / Zapier integration** | Connect your dashboard to your existing tools. Get notified in Slack when an audit completes, push content requests to your project management tool, or trigger workflows when payments come in. | 🟢 Medium |

### Value unlocked:
- Premium becomes a true managed SEO partnership with dedicated hours
- Competitive intelligence runs on autopilot
- Access your dashboard from any device
- Platform connects to your existing workflow

---

## On the Horizon (Q3 2026+)

These are bigger initiatives we're actively designing. Timing depends on demand and feedback from clients like you.

| Feature | What It Means | Status |
|---------|--------------|--------|
| **White-label for agencies** | Other web agencies can license the platform under their own brand. If you know an agency that would benefit, let us know — early partners get preferred pricing. | Designing |
| **Content calendar** | Visual calendar view of your content pipeline with due dates, writer assignments, and publication schedule. Bird's-eye view of your content strategy. | Planned |
| **Full-site PageSpeed scans** | Automated performance audits across every page, not just individual checks. Core Web Vitals monitoring with historical trends. | Planned |
| **Accessibility auditing** | WCAG AA compliance checking — contrast ratios, ARIA labels, heading structure, form labels. Stay ahead of accessibility requirements. | Planned |
| **Advanced analytics** | Exit page analysis, attribution modeling, conversion path tracking. Deeper insight into how traffic becomes revenue. | Planned |
| **NPS surveys** | Periodic in-dashboard satisfaction surveys so we can continuously improve based on your feedback. | Planned |

---

## How We Prioritize

We ship based on three criteria:

1. **Client value** — Does this directly help you grow traffic or understand your site better?
2. **Revenue impact** — Does this help justify the platform's cost and prove ROI?
3. **Platform health** — Does this make the platform faster, more reliable, or easier to use?

Features that hit all three ship first. Everything else goes in the backlog until demand warrants it.

---

## Your Voice Matters

As a beta client, you have outsized influence on what we build next. If something on this roadmap excites you — or if something's missing — tell us. The AI advisor is always listening, or just reply to any email from us.

**Current platform stats:**
- 59 features shipped
- 16 vision features planned (see FEATURE_VISION.md)
- 3-tier pricing live (Starter / Growth / Premium)
- AI advisor available 24/7

---

*This roadmap is a living document. Features and timelines may shift based on client feedback and technical discoveries. We'd rather ship the right thing late than the wrong thing on time.*

*— hmpsn.studio team*
