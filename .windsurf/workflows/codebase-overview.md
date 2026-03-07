---
description: Understand the asset-dashboard codebase architecture, key files, and how features connect
---

# Codebase Overview

This is an SEO/web analytics platform (hmpsn studio) built with React + Express + TypeScript. It manages client websites via Webflow, Google Search Console, GA4, and SEMRush integrations.

## Architecture

- **Frontend**: React 18 + Vite + TailwindCSS. Entry: `src/App.tsx`. Client portal: `src/components/ClientDashboard.tsx`. Admin tabs are lazy-loaded.
- **Backend**: Express server in `server/index.ts` (~6000 lines). All API endpoints defined here. No database — JSON files on disk via `data/` and per-workspace upload folders.
- **AI**: OpenAI GPT-4o/4o-mini via `server/openai-helpers.ts` (`callOpenAI` wrapper with retry, timeout, token tracking).

## Monetization Model

- **3 tiers**: Free (dashboard only), Growth ($149-249/mo), Premium ($349-499/mo)
- **UX soft-gating**: All tabs visible at every tier; gated content shown as blurred preview + upgrade CTA overlay (`<TierGate>` component)
- **Products**: Content briefs (8 page types), full content (8 page types), schemas, keyword strategies — purchased via Stripe Checkout
- **Trial**: 14-day Growth trial for new workspaces, auto-downgrade to Free
- **Bundles**: Content Starter ($500/mo), Content Engine ($1,500-2,000/mo), Full Service SEO ($3,000-5,000/mo)
- **Credits**: Prepaid credit packs as alternative to per-item checkout
- **Key docs**: `MONETIZATION.md` (full strategy + specs), `ACTION_PLAN.md` (execution roadmap)

## Key Server Modules

| Module | Purpose |
|--------|---------|
| `server/index.ts` | All Express routes, chat endpoints, strategy generation |
| `server/workspaces.ts` | Workspace CRUD, `Workspace` interface, `KeywordStrategy` types |
| `server/seo-context.ts` | `buildSeoContext()`, `buildKeywordMapContext()`, `buildKnowledgeBase()` — shared AI prompt builders |
| `server/chat-memory.ts` | Chat session persistence, `addMessage`, `buildConversationContext`, `generateSessionSummary` |
| `server/activity-log.ts` | Activity logging, `addActivity`, `ActivityType` union |
| `server/monthly-report.ts` | `gatherMonthlyData`, auto-report scheduler, `generateReportHTML` |
| `server/email-templates.ts` | HTML email builders: `renderMonthlyReport`, `renderApprovalReminder`, etc. |
| `server/content-brief.ts` | AI content brief generation with SEMRush/GSC enrichment |
| `server/seo-audit.ts` | Site health audit engine |
| `server/reports.ts` | Audit snapshot persistence, `getLatestSnapshot` |
| `server/google-analytics.ts` | GA4 API: overview, landing pages, organic, conversions, events, period comparison, new vs returning. Exports `CustomDateRange` type; all functions accept optional `dateRange` param |
| `server/search-console.ts` | GSC API: queries, pages, devices, countries, period comparison. All functions accept optional `dateRange?: CustomDateRange` param |
| `server/semrush.ts` | SEMRush API: keyword overview, domain organic, keyword gaps, related keywords |
| `server/openai-helpers.ts` | `callOpenAI` with retry/backoff/timeout, `parseAIJson`, token usage tracking |
| `server/schema-suggester.ts` | JSON-LD schema generation per page |
| `server/rank-tracking.ts` | Keyword position tracking over time |
| `server/stripe.ts` | Stripe SDK setup, product config (14 types), checkout session creation, webhook handler (checkout.session.completed, payment_intent.payment_failed) |
| `server/payments.ts` | Payment record CRUD (JSON on disk), per-workspace payment history, lookup by session ID |

## Key Frontend Components

| Component | Purpose |
|-----------|---------|
| `src/App.tsx` | Router, workspace selector, admin tabs (lazy-loaded) |
| `src/components/ClientDashboard.tsx` | Full client portal with chat (proactive insights greeting), custom date range picker, analytics snapshots, approvals, requests |
| `src/components/AdminChat.tsx` | Floating admin chat panel with conversation memory + history UI |
| `src/components/SeoStrategy.tsx` | Keyword strategy viewer/generator |
| `src/components/SeoAudit.tsx` | Site health audit viewer |

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
- Supports 8 page types: blog post, landing page, service page, location page, product page, pillar/hub page, resource/guide *(page-type-specific prompts planned)*

## Security Layer

- **Helmet**: Security headers on all responses. CSP whitelists `js.stripe.com`, `api.stripe.com`, `hooks.stripe.com` in production. Disabled in dev for Vite HMR.
- **HTTPS enforcement**: 301 redirect for non-HTTPS in production. Trusts `X-Forwarded-Proto` from proxy (Render/Heroku).
- **Rate limiting**: In-memory per-IP+path. 3 tiers: 60 req/min on all public routes, 10/min on writes (POST/PATCH/DELETE), 5/min on checkout (pre-wired).
- **Auth**: Admin — `APP_PASSWORD` env → HMAC token in httpOnly cookie. Client — per-workspace password → HMAC session cookie. Both use timing-safe compare.
- **Session enforcement**: `/api/public/*` routes check client session cookie for password-protected workspaces.
- **Input sanitization**: `sanitizeString()` (trim, length limit, strip control chars) + `validateEnum()` on all content request write endpoints.
- **CORS**: Configurable via `ALLOWED_ORIGINS` env var. Defaults to allow-all in dev.

## Data Flow Patterns

1. **Cached helpers**: `getAuditTrafficForWorkspace` caches GSC+GA4 traffic per workspace for 5 min
2. **Shared context builders**: `buildSeoContext`, `buildKeywordMapContext`, `buildKnowledgeBase` in `seo-context.ts` — used by chat, briefs, schema
3. **Activity logging**: `addActivity(workspaceId, type, title, detail)` — all major actions logged
4. **Chat memory**: `addMessage` → `buildConversationContext` → `generateSessionSummary` (auto after 6+ msgs)

## Documentation

- `FEATURE_AUDIT.md` — Comprehensive feature inventory (42 features) with agency/client/mutual value
- `MONETIZATION.md` — Full monetization strategy: tiers, products (8 page types), bundles, UX soft-gating spec, trial strategy, inline pricing, ROI dashboard, churn signals, credits system, white-label resale, Stripe integration spec
- `ACTION_PLAN.md` — Prioritized execution plan, 66 items across 10 sprints, decision log
- `AI_CHATBOT_ROADMAP.md` — Chatbot phases, shipped and planned
- `AUTH_ROADMAP.md` — Authentication/authorization phases
- `DESIGN_SYSTEM.md` — UI primitives and design tokens
- `data/roadmap.json` — Sprint-level tracking with item statuses (66 items, managed via /api/roadmap)
