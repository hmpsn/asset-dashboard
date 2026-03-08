# hmpsn.studio — Pre-Launch Audit (Beta Readiness)

*Compiled: March 7, 2026*
*Audited by: Revenue, Client Experience, UX/UI, Product Design, and Marketing teams*

---

## Executive Summary

The platform has **49 shipped features** across 75-108 hours of development — an exceptional depth of functionality for a pre-launch product. The core value loop (data → insights → action → revenue) is well-designed and the technical foundation is solid. However, several gaps need attention before beta clients interact with the platform, particularly around **payment flow completion**, **error resilience**, **data safety**, and **first-run experience**.

### Readiness Score by Area

| Area | Score | Top Blocker |
|------|:-----:|-------------|
| Revenue & Strategy | 🟡 7/10 | Self-service upgrades still use mailto; Stripe on test keys |
| Client Experience | 🟡 7/10 | Silent error handling; no guided onboarding wizard |
| UX/UI | 🟢 8/10 | No mobile layout; 3,900-line component needs splitting |
| Product Design | 🟡 6/10 | JSON-on-disk persistence; no backups; no test suite |
| Marketing & Positioning | 🟡 7/10 | No public landing page; strong in-product positioning |

---

## 1. Revenue & Strategy Audit

**Auditor perspective:** *VP of Revenue — focused on conversion funnels, pricing friction, revenue readiness, and growth levers.*

### What's Working Well

- **Monetization architecture is built end-to-end.** Stripe Checkout, 14 product types, webhook handling, payment records, encrypted config — the plumbing is production-grade.
- **14-day Growth trial with loss aversion.** New workspaces auto-provision with Growth features. The downgrade-to-free design (blurred previews of data they previously had access to) is psychologically effective.
- **AI chatbot as revenue engine.** 8 revenue hooks, proactive insights, warm handoff pattern. Every conversation is a potential upsell touchpoint — this is the most differentiated revenue mechanism.
- **Tier gating with soft-gate UX.** Blurred previews + upgrade overlay is the right approach — shows value without hard-blocking.
- **Inline price visibility.** Prices appear on buttons before checkout. No surprise pricing.

### Critical Issues (Fix Before Beta)

1. **🔴 Stripe is on test keys.** The `REMINDER: Switch Stripe to production keys before launch` is still pending. No real payments can be processed. This is your #1 pre-launch blocker.

2. **🔴 Self-service upgrade uses `mailto` links.** The Plans page and all upgrade CTAs point to email — not Stripe subscription checkout. This is the single biggest conversion friction point. Every upgrade requires a manual email exchange instead of an instant click. Sprint B item #88 addresses this.

3. **🟠 No subscription billing.** Stripe is wired for one-time Checkout sessions (briefs, posts), but there's no recurring subscription flow for tier upgrades (Growth @ $149-249/mo, Premium @ $349-499/mo). The monthly recurring revenue engine doesn't exist yet.

4. **🟠 Payment-before-fulfillment gap.** In `confirmPricingAndSubmit()`, the content request is created *before* payment completes. If the client abandons checkout or payment fails, an unpaid content request exists in the system. Consider: create the request in `pending_payment` status and only activate it on webhook confirmation.

5. **🟠 Brief product types all share one Stripe Price ID.** `PRODUCT_MAP` maps 7 brief types (`brief_blog`, `brief_landing`, etc.) all to the same `STRIPE_PRICE_BRIEF` env key, but they have different display prices ($125-$200). Either create separate Stripe prices per type or use Stripe's `unit_amount` override at checkout time.

### Strategic Recommendations

- **Prioritize #88 (self-service upgrade) over credits and usage tracking.** The upgrade CTA is the highest-leverage revenue action — every other monetization feature is downstream of clients being able to pay.
- **Add a "trial ending" email at day 10 and day 13.** The in-dashboard banner exists, but most trial conversions happen via email, not during an active session.
- **Track trial-to-paid conversion rate from day 1.** Even during beta, measure: trial starts → Growth upgrades → Premium upgrades → content purchases. This is your north star metric.
- **Consider a "first brief free" offer.** Let trial users generate one brief at no cost. Once they see the quality, the next purchase has dramatically lower friction.

---

## 2. Client Experience Audit

**Auditor perspective:** *Head of Customer Success — focused on onboarding, friction, clarity, time-to-value, and support load.*

### What's Working Well

- **Multi-auth flexibility.** Supports shared password, individual client accounts, and smart login detection. The tabbed login (email vs. shared password) handles the transition gracefully.
- **Per-user welcome modal.** Each team member sees the onboarding flow on their own first visit — not just once per workspace.
- **Content pipeline flow.** Strategy → Request Topic → Brief → Review → Approve/Decline → Full Post. The lifecycle is complete and both sides can track it.
- **AI Insights Engine.** Proactive insights on chat open, conversation memory, cross-session summaries. This is the highest-value client touchpoint.
- **Tab state in URL.** `?tab=strategy` means clients can bookmark and share specific views.
- **Monthly report emails with traffic trends and chat summaries.** Automated re-engagement without agency effort.

### Critical Issues (Fix Before Beta)

1. **🔴 Silent error handling throughout.** The client dashboard has 15+ instances of `catch { /* skip */ }` — when API calls fail, the client sees... nothing. No error message, no retry prompt, no indication that data is missing. For beta clients, this will read as "the platform is broken" when it's actually "GA4 isn't connected" or "the server timed out."

   **Fix:** Replace silent catches with contextual inline error states: "Unable to load analytics data — try refreshing" or "Search Console isn't connected yet — ask your team to set it up."

2. **🔴 No guided onboarding wizard.** The welcome modal shows tier info and feature highlights, but doesn't guide the client through their first actions. Sprint C item #25 addresses this. For beta, at minimum add a "Getting Started" checklist to the Overview tab: ✅ Dashboard access, ⬜ Review site health, ⬜ Explore your SEO strategy, ⬜ Ask the AI a question.

3. **🟠 No "forgot password" flow for client users.** Individual client accounts support email+password login, but there's no password reset mechanism. The only recovery path is "ask the agency admin to reset your password in Workspace Settings." This will generate support tickets.

4. **🟠 No email verification on client user creation.** Admin creates a client user with email + password, but there's no verification email sent to confirm the email is correct or to deliver the initial credentials. The admin has to communicate credentials out-of-band (Slack, email, etc.).

5. **🟠 12+ parallel API calls on dashboard load.** `loadDashboardData()` fires 12+ fetch calls simultaneously. On slow connections or if any external API (GA4, GSC) is degraded, the initial load experience suffers. Consider progressive loading: show the overview skeleton immediately, then waterfall secondary data in priority order.

6. **🟡 Approval workflow: "applied" is terminal.** Once approved changes are applied to Webflow, there's no undo or rollback. For beta clients unfamiliar with the system, an accidental "approve all" could push unwanted changes. Consider adding a confirmation step: "Apply 8 SEO changes to your live site?"

### Quick Wins for Beta

- Add a toast or inline message when no data is available for a section (instead of showing nothing)
- Add a "Copy client login link" shortcut to the workspace overview cards (currently only in Workspace Settings)
- Show a "Last updated" timestamp on the Overview tab so clients know data is fresh
- Add placeholder text to the AI chat input: "Ask me about your traffic, rankings, or content strategy..."

---

## 3. UX/UI Audit

**Auditor perspective:** *Senior Product Designer — focused on consistency, responsiveness, interactions, visual hierarchy, and accessibility.*

### What's Working Well

- **Design system is exceptionally well-documented.** `BRAND_DESIGN_LANGUAGE.md` is a canonical reference with color decision trees, per-component color maps, and AI prompting guidelines. This is production-grade design governance.
- **Shared UI primitives.** `StatCard`, `SectionCard`, `PageHeader`, `Badge`, `MetricRing`, `TierGate`, `EmptyState`, `TabBar`, `DateRangeSelector`, `DataList` — consistent building blocks across 43 components.
- **Color system is disciplined.** Teal for actions, blue for data, purple for admin AI only. The Three Laws of Color are enforced.
- **Light/dark mode.** Both admin and client dashboards support theme switching with WCAG-aware color overrides.
- **Component styleguide at `/styleguide`.** Every primitive is visible and testable in one place.
- **Code splitting.** 72% initial bundle reduction (929KB → 256KB) via lazy loading.

### Critical Issues

1. **🔴 No responsive/mobile layout.** The sidebar is fixed at 200px, content assumes desktop width. Mobile visitors see a broken layout. For beta, add a `<meta name="viewport">` check and at minimum show a "Best experienced on desktop" interstitial on mobile, or collapse the sidebar to a bottom nav. Sprint D item #52 covers the full solution.

2. **🟠 `ClientDashboard.tsx` is 3,954 lines with ~90 `useState` hooks.** This is the largest component in the codebase by a wide margin. It handles auth, data loading, 9 tabs, chat, payments, approvals, requests, content, and more. This creates:
   - Re-render performance issues (any state change re-renders the entire tree)
   - Difficult debugging and maintenance
   - High cognitive load for future development

   **Recommendation:** Extract tab content into separate components (`<ClientSearchTab>`, `<ClientAnalyticsTab>`, `<ClientContentTab>`, etc.) and lift shared state into a context provider or use `useReducer`.

3. **🟠 Unused state variables creating lint noise.**
   - `requestingTopic` — declared but never read
   - `searchDevices` — declared but never read
   - `upgradingReqId` — assigned but never used

   These are low-priority but signal dead code that could confuse future contributors.

4. **🟡 No skeleton loaders.** The loading state is a single spinner (`ChunkFallback`). Modern UX practice is to show content-shaped skeletons that match the layout, reducing perceived load time.

5. **🟡 Toast notifications use manual `setTimeout` cleanup.** Every toast requires `setTimeout(() => setToast(null), 5000)` at the call site. The `ToastProvider` exists on the admin side but the client dashboard manages its own toast state. Unify to auto-dismissing toasts.

6. **🟡 No focus traps in modals.** The welcome modal, pricing modal, and Stripe payment modal don't trap keyboard focus. A client tabbing through the page can interact with elements behind the modal overlay.

### Accessibility Notes

- ✅ Minimum 12px font size enforced
- ✅ Color + icon for severity (never color alone)
- ✅ `aria-label` on icon-only buttons
- ⚠️ Focus indicators not verified on all interactive elements
- ⚠️ Keyboard navigation not tested end-to-end
- ⚠️ Screen reader testing not performed

---

## 4. Product Design Audit

**Auditor perspective:** *Staff Engineer / Technical Product Manager — focused on architecture, scalability, data safety, reliability, and technical debt.*

### What's Working Well

- **Feature depth is remarkable.** 49 features with deep integrations across GSC, GA4, Webflow, OpenAI, SEMRush, and Stripe. The cross-referencing (audit traffic → strategy, GA4 → briefs, chatbot → everything) creates compounding intelligence.
- **Background job system with WebSocket progress, cancellation, and incremental persistence.** Heavy operations are well-handled.
- **Security hardening is in place.** Helmet, HTTPS enforcement, 3-tier rate limiting, CORS lockdown, input sanitization, HMAC client auth, encrypted Stripe config.
- **Lazy SDK initialization for Stripe.** Picks up key changes without restart.
- **`hasActiveJob` guards.** Prevents duplicate resource-intensive operations.

### Critical Issues (Fix Before Beta)

1. **🔴 JSON-on-disk persistence is a single point of failure.** All data (workspaces, payments, content requests, activity logs, chat sessions, audit results) lives in JSON files on disk. This means:
   - **No concurrent write safety.** Two simultaneous API requests writing to `.workspaces.json` can corrupt data (read-modify-write race).
   - **No backup mechanism.** A disk failure or bad deploy loses everything.
   - **No query capability.** Every read loads the entire file.
   - **Single-server limitation.** Cannot horizontally scale.

   **For beta:** This is acceptable if you have a backup strategy. Add a daily cron or background job that copies `/var/data/asset-dashboard/` to cloud storage (S3, GCS). Consider adding a `readConfig`/`writeConfig` lock mechanism (simple mutex) to prevent concurrent write corruption.

2. **🔴 `JWT_SECRET` has a hardcoded dev fallback.**
   ```typescript
   const JWT_SECRET = process.env.JWT_SECRET || 'hmpsn-studio-dev-secret-change-in-prod';
   ```
   If `JWT_SECRET` isn't set in the production environment, all JWTs are signed with a known secret. **Verify this is set on Render before beta.**

3. **🔴 No automated test suite.** Zero unit tests, integration tests, or end-to-end tests. For a platform handling payments and client data, this is a significant risk. At minimum before beta:
   - Add smoke tests for critical API endpoints (auth, payments, workspace CRUD)
   - Add a build verification step that confirms `tsc --noEmit` passes

4. **🟠 `clientPassword` storage.** In `workspaces.ts`, `clientPassword` is stored as a plain field. Verify it's hashed (bcrypt) before storage, not stored in plaintext. Client user passwords use bcrypt (confirmed in `client-users.ts`), but the legacy shared password path should be verified.

5. **🟠 Vite 8.0.0-beta in production.** `package.json` pins `vite: ^8.0.0-beta.13`. Running a beta build tool in production adds risk of undiscovered bugs. Consider pinning to the latest stable Vite 7.x if any issues arise, or at minimum lock the exact version.

6. **🟠 No graceful shutdown.** If the server receives SIGTERM (Render deploy, restart), in-flight background jobs are lost. Jobs are in-memory only. Consider:
   - Listening for SIGTERM and completing active requests
   - Saving job state to disk on shutdown
   - Restoring pending jobs on startup

7. **🟡 `readConfig()` reads the full file on every call.** `workspaces.ts` calls `readConfig()` (which reads + parses the entire JSON file) on every workspace lookup. For 5-20 workspaces this is fine, but it's called on nearly every API request. Consider an in-memory cache with file-watch invalidation (you already have `chokidar` as a dependency).

### Technical Debt Register

| Item | Severity | Impact |
|------|----------|--------|
| ClientDashboard.tsx: 3,954 lines, ~90 useState | Medium | Maintenance, performance |
| No database — JSON on disk | High | Data safety, scalability |
| No test suite | High | Regression risk |
| No CI/CD pipeline | Medium | Deploy confidence |
| Lint warnings in ClientDashboard.tsx | Low | Code hygiene |
| useEffect dependency warnings | Low | Potential stale closures |

---

## 5. Marketing & Positioning Audit

**Auditor perspective:** *Head of Marketing / Growth — focused on positioning, messaging, differentiation, beta launch readiness, and go-to-market.*

### What's Working Well

- **Brand identity is clear and differentiated.** "SEO strategy, made visible" is a strong tagline. The positioning as a transparent, data-driven client portal (not just another SEO tool) is compelling.
- **The product IS the marketing.** The Sales Report feature (prospect audit for any URL) is a built-in lead generation tool. Run an audit during a sales call → close the deal with their own data.
- **Monthly report emails as passive marketing.** Every report reinforces agency value, includes chat topic summaries, and surfaces trial urgency. This is excellent retention marketing on autopilot.
- **AI chatbot as a marketing channel.** Revenue hooks in the chatbot naturally surface services. "Your clicks dropped 8% — want me to create a brief for that?" is marketing disguised as advice.
- **Trial design leverages loss aversion.** The 14-day Growth trial → downgrade with blurred previews is a well-known SaaS conversion pattern.

### Critical Issues

1. **🔴 No public-facing marketing site.** The codebase has no landing page, marketing site, or public-facing explanation of what the platform does. For beta, you need at minimum:
   - A `/` route (or separate domain) with a value proposition, feature highlights, and a "Request Beta Access" CTA
   - Or: a simple Notion/Carrd/Webflow landing page that links to the platform

   Without this, there's no way for prospects to self-discover the platform or understand its value before getting access.

2. **🔴 No onboarding email sequence.** When a client workspace is created and they get dashboard access, there's no welcome email, no "here's how to get started" guide, no drip campaign. The welcome modal is the only touchpoint, and it's easily dismissed.

   **For beta:** Send a welcome email when a client user is created, with: login link, what they can do, and a "reply to this email with questions" CTA.

3. **🟠 No social proof in the platform.** The client portal has no testimonials, case study references, or "trusted by X agencies" signals. For beta clients who are evaluating the platform, social proof reduces uncertainty.

4. **🟠 The Sales Report is hidden.** The prospect audit tool is one of the strongest sales features, but it's tucked behind the admin sidebar bottom bar. Consider making it more prominent — or creating a public-facing version where prospects can run a limited audit on their own site (lead gen).

5. **🟡 No viral loops.** There's no mechanism for the platform to spread organically:
   - No "Share your dashboard" public link
   - No "Powered by hmpsn.studio" footer on client dashboards
   - No referral program
   - No embeddable widgets (health score badge, traffic widget)

   **For beta:** Add a subtle "Powered by hmpsn.studio" link in the client dashboard footer. It's free distribution.

### Beta Launch Checklist (Marketing)

| Item | Status | Priority |
|------|--------|----------|
| Public landing page with beta signup | ❌ Not built | P0 |
| Welcome email for new client users | ❌ Not built | P0 |
| "Powered by" footer on client dashboards | ❌ Not built | P1 |
| Case study template for first beta wins | ❌ Not built | P1 |
| Trial expiry email sequence (day 10, 13, 14) | ⚠️ In-dashboard only | P1 |
| Sales Report as lead gen tool | ✅ Built (admin-only) | P2 (publicize later) |
| Monthly report emails | ✅ Automated | — |
| AI chatbot revenue hooks | ✅ Active | — |

---

## Cross-Cutting: Beta Launch Blockers (Prioritized)

These are the items that should be resolved before any real client uses the platform:

### Must-Fix (P0)

| # | Item | Audit | Est. |
|---|------|-------|:----:|
| 1 | **Switch Stripe to production keys** | Revenue | 15min |
| 2 | **Verify `JWT_SECRET` is set in production env** | Product | 5min |
| 3 | **Verify `clientPassword` is hashed, not plaintext** | Product | 15min |
| 4 | **Replace silent `catch { /* skip */ }` with inline error states** in ClientDashboard | Client Exp | 2-3h |
| 5 | **Add daily data backup job** (copy `/var/data/` to cloud storage) | Product | 1-2h |
| 6 | **Add mobile viewport interstitial** ("Best on desktop" or basic responsive) | UX/UI | 30min |

### Should-Fix (P1)

| # | Item | Audit | Est. |
|---|------|-------|:----:|
| 7 | **Self-service tier upgrade via Stripe** (replace mailto) | Revenue | 3-4h |
| 8 | **"Forgot password" flow for client users** | Client Exp | 1-2h |
| 9 | **Welcome email on client user creation** | Marketing | 1-2h |
| 10 | **Payment status: pending_payment state** (don't create request before payment) | Revenue | 1h |
| 11 | **Add "Powered by hmpsn.studio" footer** to client dashboard | Marketing | 15min |
| 12 | **Trial expiry emails** (day 10 + day 13) | Revenue | 1-2h |

### Nice-to-Have (P2)

| # | Item | Audit | Est. |
|---|------|-------|:----:|
| 13 | Split `ClientDashboard.tsx` into tab components | UX/UI | 3-4h |
| 14 | Add skeleton loaders for progressive loading | UX/UI | 2h |
| 15 | Public landing page with beta signup | Marketing | 2-4h |
| 16 | Workspace readConfig() in-memory cache | Product | 1h |
| 17 | Basic smoke tests for critical endpoints | Product | 2-3h |
| 18 | Getting Started checklist on Overview tab | Client Exp | 1-2h |

---

## Summary

**The platform is impressively deep for a pre-launch product.** The 49-feature depth, cross-tool intelligence, and monetization architecture put it well ahead of most beta launches. The core risks are:

1. **Operational** — JSON-on-disk without backups, no test suite
2. **Conversion** — Self-service payment flow incomplete (mailto gap)
3. **Resilience** — Silent errors in the client dashboard
4. **Marketing** — No public-facing entry point for discovery

The P0 items above can be resolved in a single focused session (~4-6 hours). The P1 items represent the Sprint B work already planned. With those addressed, the platform is ready for a controlled beta with 3-5 agency clients.

---

*Last updated: March 7, 2026*
*Next action: Resolve P0 blockers → controlled beta launch*
