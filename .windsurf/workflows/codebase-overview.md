---
description: Understand the asset-dashboard codebase architecture, key files, and how features connect
---

# Codebase Overview

This is an SEO/web analytics platform (hmpsn studio) built with React + Express + TypeScript. It manages client websites via Webflow, Google Search Console, GA4, and SEMRush integrations.

## Architecture

- **Frontend**: React 18 + Vite + TailwindCSS. Entry: `src/App.tsx`. Client portal: `src/components/ClientDashboard.tsx`. Admin tabs are lazy-loaded.
- **Backend**: Express server in `server/index.ts` (~7100 lines). All API endpoints defined here. No database — JSON files on disk via `data/` and per-workspace upload folders.
- **AI**: OpenAI GPT-4o/4o-mini via `server/openai-helpers.ts` (`callOpenAI` wrapper with retry, timeout, token tracking).

## Monetization Model

- **3 tiers**: Free (dashboard only), Growth ($149-249/mo), Premium ($349-499/mo)
- **UX soft-gating**: All tabs visible at every tier; gated content shown as blurred preview + upgrade CTA overlay (`<TierGate>` component)
- **Products**: Content briefs (8 page types), full content (8 page types), schemas, keyword strategies — purchased via Stripe Checkout
- **Trial**: 14-day Growth trial for new workspaces (`initializeNewWorkspaceTrial` in `workspaces.ts`), `checkTrialExpiry` daily job auto-downgrades expired trials to `baseTier`
- **Bundles**: Content Starter ($500/mo), Content Engine ($1,500-2,000/mo), Full Service SEO ($3,000-5,000/mo)
- **Credits**: Prepaid credit packs as alternative to per-item checkout
- **Key docs**: `MONETIZATION.md` (full strategy + specs), `ACTION_PLAN.md` (execution roadmap)

## Key Server Modules

| Module | Purpose |
|--------|---------|
| `server/index.ts` | All Express routes, chat endpoints, strategy generation |
| `server/workspaces.ts` | Workspace CRUD, `Workspace` interface, `KeywordStrategy` types, `seoEditTracking` (per-page edit status) |
| `server/seo-context.ts` | `buildSeoContext()`, `buildKeywordMapContext()`, `buildKnowledgeBase()`, `RICH_BLOCKS_PROMPT` — shared AI prompt builders + multi-modal chat instructions |
| `server/chat-memory.ts` | Chat session persistence, `addMessage`, `buildConversationContext`, `generateSessionSummary` |
| `server/activity-log.ts` | Activity logging, `addActivity`, `ActivityType` union (includes `anomaly_detected`, `anomaly_positive`) |
| `server/anomaly-detection.ts` | AI anomaly detection: compares current vs previous 28-day period for GSC, GA4, audit. Configurable thresholds. AI summaries via gpt-4o-mini. Scheduler (12h) + manual trigger. File storage in `.anomalies.json` |
| `server/monthly-report.ts` | `gatherMonthlyData`, auto-report scheduler, `generateReportHTML`. Trial banner: `isTrial`/`trialDaysRemaining` threaded to email template |
| `server/email-templates.ts` | HTML email builders: `renderMonthlyReport` (with trial banner), `renderApprovalReminder`, `renderAnomalyAlert`, etc. 16 event types including `anomaly_alert` |
| `server/content-brief.ts` | AI content brief generation with SEMRush/GSC enrichment, 7 page-type-specific prompts. `brief-export-html.ts` renders branded HTML/PDF with page type badge |
| `server/content-requests.ts` | Content topic request CRUD, `ContentTopicRequest` interface (includes `pageType`, `serviceType`) |
| `server/seo-audit.ts` | Site health audit engine. `applySuppressionsToAudit()` in index.ts filters suppressed issues and recalculates scores |
| `server/reports.ts` | Audit snapshot persistence, `getLatestSnapshot` |
| `server/google-analytics.ts` | GA4 API: overview, landing pages, organic, conversions, events, period comparison, new vs returning. Exports `CustomDateRange` type; all functions accept optional `dateRange` param |
| `server/search-console.ts` | GSC API: queries, pages, devices, countries, period comparison, `getPageTrend` (per-page daily data with URL filter). All functions accept optional `dateRange?: CustomDateRange` param |
| `server/semrush.ts` | SEMRush API: keyword overview, domain organic, keyword gaps, related keywords |
| `server/openai-helpers.ts` | `callOpenAI` with retry/backoff/timeout, `parseAIJson`, token usage tracking |
| `server/schema-suggester.ts` | JSON-LD schema generation per page |
| `server/rank-tracking.ts` | Keyword position tracking over time |
| `server/stripe.ts` | Stripe SDK setup (lazy init from config), product config (14 types), checkout session creation, webhook handler (checkout.session.completed, payment_intent.payment_failed) |
| `server/stripe-config.ts` | Encrypted on-disk persistence for Stripe keys + product Price IDs. AES-256-GCM encryption. Falls back to env vars for CI/Docker. |
| `server/constants.ts` | `STUDIO_NAME` constant — single source of truth for studio/agency name in all server-side copy (emails, request notes, submittedBy). Future: per-workspace override for agency resale |
| `server/payments.ts` | Payment record CRUD (JSON on disk), per-workspace payment history, lookup by session ID |
| `server/users.ts` | Internal user model (owner/admin/member), bcrypt hashing (12 rounds), CRUD, `verifyPassword`, JSON-on-disk persistence in `auth/users.json` |
| `server/auth.ts` | JWT sign/verify (7-day expiry), Express middleware: `requireAuth`, `requireRole`, `requireWorkspaceAccess`, `optionalAuth`. Augments `Express.Request` with `user` and `jwtPayload` |
| `server/client-users.ts` | Client user model (client_owner/client_member), per-workspace accounts, bcrypt hashing, JWT (24h expiry), CRUD, `verifyClientPassword`, `signClientToken`/`verifyClientToken` |

## Key Frontend Components

| Component | Purpose |
|-----------|---------|
| `src/App.tsx` | Router, workspace selector, admin tabs (lazy-loaded). Each SEO sub-tool routes directly (no SeoAudit pass-through). |
| `src/components/ClientDashboard.tsx` | Full client portal with smart login gate (auth-mode detection, email+password or shared password with tab toggle), user menu (avatar+logout), chat, date picker. **Tab order follows narrative arc** (see §Client UX Narrative below): Insights → Performance → Health → Strategy → Inbox → Plans → ROI. Per-user welcome modal, auto-populated submittedBy via STUDIO_NAME |
| `src/components/AdminChat.tsx` | Floating admin chat panel with conversation memory + history UI |
| `src/components/StripeSettings.tsx` | Stripe admin settings in Command Center: API keys (masked), product Price ID mapping, connection status |
| `src/components/SeoStrategy.tsx` | Keyword strategy viewer/generator |
| `src/components/SeoAudit.tsx` | Site health audit viewer (core audit only — sub-tools route directly from App.tsx since #131), edit tracking badges |
| `src/components/SeoEditor.tsx` | Page-level SEO field editor with AI rewrite, approval workflow, edit tracking (teal=live, purple=in-review, yellow=flagged) |
| `src/components/CmsEditor.tsx` | CMS collection item SEO editor with sitemap filtering, parent slug display, edit tracking |
| `src/components/ChatPanel.tsx` | Shared chat UI: message bubbles, loading dots, input bar, quick questions, teal/purple accent theming. Used by SearchConsole; AdminChat and ClientDashboard can adopt incrementally (#133) |
| `src/components/ContentPerformance.tsx` | Per-published-post GSC+GA4 performance tracker (#31). Summary cards, sortable expandable table, per-post trend charts. Lazy-loaded under SEO > Content Perf in sidebar. |
| `src/components/AnomalyAlerts.tsx` | Anomaly detection UI (#33). Severity-colored cards (critical/warning/positive), expand/collapse, AI summary banner, dismiss/acknowledge. Wired into WorkspaceHome (admin, isAdmin=true) and ClientDashboard overview. |
| `src/components/ChatBlocks.tsx` | Rich chat block renderers (#22): `MetricBlock`, `ChartBlock`, `DataTableBlock`, `SparklineBlock`. Rendered by `RenderMarkdown` when fenced code blocks use `metric`, `chart`, `datatable`, `sparkline` language tags. |
| `src/constants.ts` | `STUDIO_NAME` constant — single source of truth for studio/agency name in all client-facing copy. Imported by all client components that display team/studio references. Future: per-workspace override for agency resale |

## AI-Powered Features & Their Data Sources

### Client Chat (`/api/public/search-chat/:workspaceId`)
- GSC, GA4, site health, strategy, rankings, activity, approvals, requests
- Period comparison data (search + GA4), organic overview, new vs returning
- Audit traffic intelligence (high-traffic pages with SEO errors)
- Conversation memory via `chat-memory.ts`
- Proactive insights: `fetchProactiveInsight()` auto-sends 2-3 data-driven greeting bullets on chat open via `buildChatContext()` helper

### Admin Chat (`/api/admin-chat`)
- Same data as client chat + keyword strategy context + keyword map
- Internal analyst persona (unfiltered, technical)
- Audit traffic intelligence
- Conversation memory (full parity with client)

### Strategy Generation (`/api/webflow/keyword-strategy/:workspaceId`)
- Sitemap crawl + page content fetch
- GSC: query+page data (90d), device/country breakdown, period comparison
- GA4: organic landing pages, organic overview, conversions, events by page
- SEMRush: domain keywords, keyword gaps, related keywords
- Audit: high-traffic pages with SEO errors
- Batched AI analysis (parallel page batches + master synthesis)

### Content Briefs (`generateBrief` in `content-brief.ts`)
- GSC related queries, SEMRush metrics + related keywords
- Keyword strategy context (`buildSeoContext`), brand voice, keyword map
- 7 page types with type-specific AI prompts: blog, landing, service, location, product, pillar, resource
- `PAGE_TYPE_PROMPTS` dict provides tailored word count, structure, schema, CTA, and outline guidance per type
- `pageType` stored on `ContentBrief` and `ContentTopicRequest` models

## Security Layer

- **Helmet**: Security headers on all responses. CSP whitelists `js.stripe.com`, `api.stripe.com`, `hooks.stripe.com` in production. Disabled in dev for Vite HMR.
- **HTTPS enforcement**: 301 redirect for non-HTTPS in production. Trusts `X-Forwarded-Proto` from proxy (Render/Heroku).
- **Rate limiting**: In-memory per-IP+path. 3 tiers: 60 req/min on all public routes, 10/min on writes (POST/PATCH/DELETE), 5/min on checkout/login.
- **Auth (dual system, backward compatible)**:
  - **Legacy admin**: `APP_PASSWORD` env → HMAC token in httpOnly cookie. Global middleware gates all `/api` routes.
  - **Internal user JWT**: `server/auth.ts` — bcrypt + JWT (7-day expiry). `optionalAuth` runs globally to populate `req.user`. Global middleware accepts JWT tokens alongside legacy `APP_PASSWORD`.
  - **Client user JWT**: `server/client-users.ts` — per-workspace bcrypt + JWT (24h expiry). Stored in `client_user_token_<wsId>` cookie.
  - **Client shared password**: per-workspace `clientPassword` → HMAC session cookie (legacy, still supported alongside client user JWT).
- **Middleware stack**: `optionalAuth` (global) → `requireAuth` → `requireRole(…)` → `requireWorkspaceAccess(paramName)`. Workspace access soft-enforces for JWT users; passes through for legacy auth.
- **Session enforcement**: `/api/public/*` routes check client session cookie OR client user JWT for password-protected workspaces.
- **Input sanitization**: `sanitizeString()` (trim, length limit, strip control chars) + `validateEnum()` on all content request write endpoints.
- **CORS**: Configurable via `ALLOWED_ORIGINS` env var. Defaults to allow-all in dev.

## Data Flow Patterns

1. **Cached helpers**: `getAuditTrafficForWorkspace` caches GSC+GA4 traffic per workspace for 5 min
2. **Shared context builders**: `buildSeoContext`, `buildKeywordMapContext`, `buildKnowledgeBase` in `seo-context.ts` — used by chat, briefs, schema
3. **Activity logging**: `addActivity(workspaceId, type, title, detail)` — all major actions logged
4. **Chat memory**: `addMessage` → `buildConversationContext` → `generateSessionSummary` (auto after 6+ msgs)
8. **Content performance** (#31): `handleContentPerformance(wsId)` batch-fetches GSC pages + GA4 landing pages (2 API calls), cross-references with delivered/published content requests. Per-post trend via `getPageTrend()`. Endpoints: `/api/content-performance/:wsId` (admin+public), `/api/content-performance/:wsId/:requestId/trend`
9. **Shared data-fetching hooks** (#132): Module-level cached hooks in `src/hooks/` — `useAuditSummary(wsId)`, `useSearchData(wsId, days)`, `useGA4Overview(wsId, days)`. 60s stale window, same pattern as `usePageEditStates`. Wired into WorkspaceHome; ClientDashboard can adopt incrementally.
5. **Audit suppressions**: `applySuppressionsToAudit()` filters suppressed issues + recalculates scores. Applied to all 7 data exit points (audit-summary, audit-detail, reports/latest, workspace-overview, admin/client/strategy chat)
6. **SEO edit tracking**: `trackSeoEdit(wsId, pageId, status)` with priority guard (won't downgrade live→flagged). Auto-wired into save, approval, audit flows. CRUD endpoints at `/api/workspaces/:id/seo-edit-tracking`
7. **CMS sitemap filtering**: `/api/webflow/cms-seo/:siteId` fetches sitemap.xml to filter collection items. Falls back to all items if sitemap unavailable
10. **Anomaly detection** (#33): `anomaly-detection.ts` compares current vs previous 28-day GSC (clicks, impressions, CTR, position) + GA4 (users, sessions, bounce, conversions) + audit score snapshots. Configurable thresholds, dedup, AI summaries. Scheduled every 12h. API: `/api/anomalies[/:workspaceId]` (list), `/api/anomalies/:id/dismiss`, `/api/anomalies/:id/acknowledge`, `/api/anomalies/scan` (trigger). Public: `/api/public/anomalies/:workspaceId`
11. **WebSocket real-time updates** (#139): `broadcastToWorkspace(wsId, event, data)` sends scoped events to subscribed clients. Broadcast callbacks: `initActivityBroadcast` (auto on every `addActivity`), `initAnomalyBroadcast` (on new anomalies), `initStripeBroadcast` (tier upgrades via Stripe). Frontend: `useWorkspaceEvents(wsId, handlers)` hook. Events: `activity:new`, `approval:update`, `approval:applied`, `request:created/update`, `content-request:created/update`, `audit:complete`, `anomalies:update`, `workspace:updated`. The `workspace:updated` event fires on admin workspace edits (tier, settings, feature toggles) and Stripe tier upgrades — client dashboard refetches `/api/public/workspace/:id` on receipt. **Rule**: Every write endpoint exists in both admin (`/api/...`) and client (`/api/public/...`) — both must call `broadcastToWorkspace` with the same event name or the other side won't update in real-time. See `wiring-patterns.md` §11 for checklist.
12. **Email notifications for anomalies**: `notifyAnomalyAlert()` in `email.ts` — admin gets all critical+warning anomalies, client gets critical-only. Uses queue-based email system with branded `anomaly_alert` template (severity badges, AI summary banner)
13. **Multi-modal chat** (#22): `RICH_BLOCKS_PROMPT` in `seo-context.ts` teaches AI to emit fenced code blocks (`metric`, `chart`, `datatable`, `sparkline`) with JSON payloads. `RenderMarkdown` in `helpers.tsx` parses these and renders `ChatBlocks.tsx` components. Injected into all 3 chat system prompts.
14. **Admin UX overhaul** (#160-165):
    - **Collapsible sidebar groups** (#160): `App.tsx` — `navGroups` with `collapsedGroups` state (localStorage-persisted Set), `toggleGroup` callback, auto-expand on tab change, badge aggregation on collapsed groups, `ChevronRight` rotation indicator.
    - **Command center enhancements** (#161): `WorkspaceOverview.tsx` — fetches `/api/anomalies`, anomaly aggregation per workspace, priority-sorted attention items (anomalies > requests > approvals > content > work orders > rejected > health > setup), workspace card anomaly badges (red/amber), dynamic features-shipped count.
    - **WorkspaceHome extraction** (#162): `WorkspaceHome.tsx` (471→301 lines) + 4 sub-components in `src/components/workspace-home/`: `SeoWorkStatus`, `ActivityFeed`, `RankingsSnapshot`, `ActiveRequestsAnnotations`. Barrel export via `index.ts`.
    - **Notification bell** (#163): `NotificationBell.tsx` — dropdown panel in sidebar utility bar. Aggregates anomalies, requests, approvals, content briefs, work orders, churn signals per workspace. Red badge dot, clickable items navigate to workspace+tool, 5-min polling.
    - **Command palette** (#164): `CommandPalette.tsx` — ⌘K/Ctrl+K toggle. Fuzzy search across 20 nav items + workspaces + quick actions. Recent items (localStorage, last 5). Full keyboard nav (arrows, Enter, Escape). Grouped display when browsing, flat when searching.
    - **Breadcrumb bar** (#165): `App.tsx` — persistent `Command Center / [Workspace] / [Tool]` breadcrumb above content. Hover workspace name for quick-switch dropdown. `TAB_LABELS` map for display names.
15. **Client overview declutter** (#172): Removed AnomalyAlerts banner, AI Hero Insight full-width banner, and MonthlySummary from `OverviewTab.tsx`. InsightsDigest is now the single source of analytical insight. Recent Work timeline in sidebar filtered to `WORK_TYPES` set (audit_completed, request_resolved, approval_applied, seo_updated, images_optimized, links_fixed, content_updated) — excludes anomaly_detected, anomaly_positive, note, and chat entries. AnomalyAlerts component still used on admin side (WorkspaceHome). Final overview layout: Welcome → Action banner → Key metrics → InsightsDigest (left) + Ask AI + Recent Work (right).
16. **Studio name constant** (`STUDIO_NAME`): All client-facing and server-side copy referencing the studio/agency name MUST use `STUDIO_NAME` from `src/constants.ts` (client) or `server/constants.ts` (server). Never hardcode "your team", "Web Team", "SEO team", "our team", or "hmpsn studio" as string literals. In JSX, use `{STUDIO_NAME}`; in template literals, use `` `text ${STUDIO_NAME} text` ``; in object properties, use the constant directly. **Common bug**: `${STUDIO_NAME}` inside JSX text or single-quoted strings won't interpolate — must use backtick template literals or JSX expressions.
17. **Recommendation auto-resolve**: `generateRecommendations()` in `recommendations.ts` — on regeneration (triggered after each audit), cross-references new recs with existing by `source` key. Preserves `in_progress`/`completed`/`dismissed` statuses. Auto-marks `completed` any old pending/in_progress recs whose source issue is no longer detected. Insight text prepended with "✓ Auto-resolved". Summary counts exclude completed/dismissed from active totals.

## Client UX Narrative

The client dashboard follows a **"why, then how"** narrative arc. Every tab, feature, and piece of copy should guide the client through a logical story — not dump data on them.

### Tab Order (enforced in `ClientDashboard.tsx` NAV array)

| Order | Tab | Narrative Role |
|-------|-----|---------------|
| 1 | **Insights** (overview) | "Here's the big picture" — headline metrics, AI digest, action banners |
| 2 | **Performance** | "Here's how traffic is trending" — establishes context with real data |
| 3 | **Site Health** | "Here's what's broken" — diagnosis, page-by-page issues |
| 4 | **SEO Strategy** | "Here's the plan" — keyword targets, content gaps, growth opportunities |
| 5 | **Inbox** | "Let's act on it together" — approvals, requests, content collaboration |
| 6 | **Plans** | Pricing & upgrade options (hidden in beta) |
| 7 | **ROI** | Value proof — traffic value, ad spend equivalent (hidden in beta) |

### Principle: Diagnosis → Plan → Action

When adding new client-facing features, ask: **where does this fit in the narrative?**

- **Data / metrics** → early tabs (Performance, Health) — establish the "why"
- **Recommendations / strategy** → middle (Strategy) — present the plan
- **Collaboration / actions** → later (Inbox) — enable the "how"
- **Value proof** → end (ROI) — reinforce why the engagement matters

Never present the plan before the diagnosis. Never ask for action before explaining why.

### Copy Tone

All client-facing copy should:
- Lead with **what matters to the client**, not what the tool does
- Use `STUDIO_NAME` (never hardcode team names) — see `data-flow.md` Rule 8
- Be **plain English** — no jargon unless the client's tier implies SEO literacy
- Frame hmpsn studio as a **collaborative partner**, not a vendor

## Development Enforcement

- `.windsurf/rules/data-flow.md` — **MANDATORY rules** for data flow consistency: broadcast patterns, delete pre-read, external module callbacks, public API safety, activity logging. Read before any write endpoint work.
- `.windsurf/workflows/new-feature-checklist.md` — Pre/during/post implementation checklist for every feature or modification. Covers server broadcasts, frontend handlers, docs, and common pitfalls.
- `server/ws-events.ts` — Single source of truth for all WebSocket event names. New events MUST be registered here.

## Documentation

- `FEATURE_AUDIT.md` — Comprehensive feature inventory (52 features) with agency/client/mutual value
- `MONETIZATION.md` — Full monetization strategy: tiers, products (8 page types), bundles, UX soft-gating spec, trial strategy, inline pricing, ROI dashboard, churn signals, credits system, white-label resale, Stripe integration spec
- `ACTION_PLAN.md` — Prioritized execution plan, 67 items across 10 sprints, decision log
- `AI_CHATBOT_ROADMAP.md` — Chatbot phases, shipped and planned
- `AUTH_ROADMAP.md` — Authentication/authorization phases (Phases 1, 2, 4 shipped)
- `DESIGN_SYSTEM.md` — UI primitives, component specs, typography, spacing, Tailwind classes
- `BRAND_DESIGN_LANGUAGE.md` — Color rules (Three Laws), per-component color map, admin vs client rules, AI prompting guidelines. **Read before any UI work.**
- `ADMIN_UX_AUDIT.md` — Comprehensive admin dashboard UX audit: 12 proposed changes across 3 priority tiers (P0: sidebar collapse, command center, extraction; P1: notification bell, ⌘K, breadcrumb; P2: onboarding, tooltips, freshness, nav, chat, theme)
- `data/roadmap.json` — Sprint-level tracking with item statuses across 19 sprints (5 active + backlog + 13 archived), managed via /api/roadmap. 80+ features shipped total.
