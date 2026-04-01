# Intelligence Module Ownership Map

> **Purpose:** Shows which files feed which intelligence slice, enabling quick answers to "what does the outcome engine own?" or "what feeds the content pipeline?"
> **Last updated:** April 1 2026
> **Related:** [Unified Workspace Intelligence Spec](specs/unified-workspace-intelligence.md)

---

## How to Read This Map

Each intelligence slice is a "column" of the platform brain. Files can appear under multiple slices when they cross boundaries. The **primary** slice is listed first; secondary slices are noted with →.

**File types:**
- 📦 **Data store** — CRUD operations, DB queries, prepared statements
- 🤖 **AI caller** — Calls OpenAI/Anthropic APIs
- ⏰ **Background job** — Cron/scheduler, runs unattended
- 🔧 **Utility** — Pure logic, computation, helpers
- 🌐 **External integration** — Third-party API wrapper
- 🖥️ **Route** — Express HTTP handler
- ⚛️ **Hook** — React Query frontend hook

---

## 1. seoContext — Strategy, Brand Voice & Search Intelligence

> *"What is this workspace's SEO strategy, who are they targeting, and what's their search landscape?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `seo-context.ts` | 🔧 | Builds SEO context blocks (strategy + brand voice + personas + knowledge) for all AI prompts. 26 callers. 5-min TTL cache. |
| `keyword-strategy.ts` | 📦 | Workspace keyword strategy: targets, gaps, declined keywords, persona mapping |
| `page-keywords.ts` | 📦 | Keyword → page assignments; cannibalization prevention lookups |
| `keyword-recommendations.ts` | 🤖 | Smart keyword recommendations via SEMRush + AI business relevance scoring |
| `keyword-metrics-cache.ts` | 📦 | Caches SEMRush/DataForSEO keyword metrics (volume, difficulty, CPC) |
| `rank-tracking.ts` | 📦 | Daily keyword position snapshots (180-day max) with pinning for priority tracking |
| `workspaces.ts` | 📦 | Workspace settings including `businessProfile` (industry, goals, target audience) |
| `semrush.ts` | 🌐 | SEMRush API: keyword data, backlinks, SERP features |

### Routes

| File | Purpose |
|------|---------|
| `routes/keyword-strategy.ts` | Keyword strategy CRUD + signals endpoint |
| `routes/backlinks.ts` | Backlink profile data from SEMRush |
| `routes/webflow-keywords.ts` | Page keyword assignments + cannibalization checks |
| `routes/webflow-seo.ts` | SEO field editing (title, meta, H1) + AI rewrite |
| `routes/webflow-analysis.ts` | Page-level SEO analysis |
| `routes/semrush.ts` | SEMRush data proxy (keyword metrics, related keywords) |
| `routes/rank-tracking.ts` | Keyword rank tracking CRUD + history |
| `routes/settings.ts` | Workspace settings (includes brand voice, business profile) |
| `routes/brand-docs.ts` | Brand document CRUD (knowledge base) |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useKeywordStrategy()` | `hooks/admin/useKeywordStrategy.ts` | `/api/webflow/keyword-strategy/:wsId` |
| `useSeoEditor()` | `hooks/admin/useSeoEditor.ts` | `/api/webflow/pages/:siteId` |
| `useIntelligenceSignals()` | `hooks/admin/useIntelligenceSignals.ts` | `/api/webflow/keyword-strategy/:wsId/signals` |
| `useClientStrategy()` | `hooks/client/useClientQueries.ts` | `/api/public/seo-strategy/:wsId` |

---

## 2. insights — Analytics Intelligence

> *"What patterns exist in the data? What's improving, declining, or anomalous?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `analytics-intelligence.ts` | 🤖 | Core insight computation: dedupes GSC/GA4, computes gaps/cannibalization/attribution |
| `analytics-insights-store.ts` | 📦 | Insight CRUD with type+pageId deduplication; digest rollups |
| `insight-enrichment.ts` | 🔧 | Resolves page titles, checks strategy alignment, links pipeline status, computes impact scores |
| `insight-feedback.ts` | 📦 | User dismissals/confirmations; acceptance rate feeds future severity |
| `insight-narrative.ts` | 🤖 | Converts raw insights to human-readable narrative text |
| `anomaly-detection.ts` | ⏰ | Detects per-page traffic/ranking anomalies (20% drops, 30% spikes) |

→ Also feeds: **pageProfile** (page-specific insights), **siteHealth** (anomaly counts)

### External Data Sources

| File | Type | Purpose |
|------|------|---------|
| `search-console.ts` | 🌐 | GSC API: queries, pages, trends, period comparisons |
| `google-analytics.ts` | 🌐 | GA4 API: users, sessions, pageviews, conversions |
| `analytics-data.ts` | 🔧 | Unified analytics data aggregation layer |

| `competitor-schema.ts` | 🌐 | Crawls competitor websites, extracts JSON-LD schemas for competitive coverage comparison |

→ Also feeds: **pageProfile** (page-specific insights), **siteHealth** (anomaly counts)

### Routes

| File | Purpose |
|------|---------|
| `routes/insights.ts` | Insight CRUD + narrative generation |
| `routes/anomalies.ts` | Anomaly feed + dismissal |
| `routes/public-analytics.ts` | Client-facing search analytics + insight chat |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useInsightFeed()` | `hooks/admin/useInsightFeed.ts` | `/api/insights/:wsId` |
| `useActionQueue()` | `hooks/admin/useActionQueue.ts` | `/api/insights/:wsId/queue` |
| `useClientInsights()` | `hooks/client/useClientQueries.ts` | `/api/public/insights/:wsId/narrative` |
| `useClientRawInsights()` | `hooks/client/useClientQueries.ts` | `/api/public/insights/:wsId` |

---

## 3. learnings — Outcome Intelligence Engine

> *"What have we done, what worked, and what should we do differently next time?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `outcome-tracking.ts` | 📦 | Action recording: tracks content published, schema added, SEO edits, etc. with baseline snapshots |
| `outcome-measurement.ts` | ⏰ | Scores actions by comparing baseline vs current GSC metrics at 7/30/60/90 day checkpoints |
| `workspace-learnings.ts` | 📦 | Aggregates outcomes by action type (content/strategy/technical) with confidence + trend signals |
| `outcome-playbooks.ts` | 🔧 | Detects optimization patterns from outcome history (e.g., "refresh underperforming pages") |
| `outcome-scoring-defaults.ts` | 🔧 | Per-action-type scoring thresholds (clicks, position, impressions) |
| `outcome-crons.ts` | ⏰ | Daily cron: orchestrates measurement runs across all workspaces |
| `outcome-backfill.ts` | ⏰ | Backfill script for historical actions missing outcome scores |
| `roi-attribution.ts` | 📦 | Per-action click gains — direct evidence of "was this worth doing?" |
| `roi.ts` | 🔧 | Organic traffic value calculations: GSC clicks × CPC + content attribution |

→ Also feeds: **pageProfile** (per-page outcomes), **clientSignals** (ROI data)

### Routes

| File | Purpose |
|------|---------|
| `routes/outcomes.ts` | Outcome CRUD + scorecards + learnings + playbooks |
| `routes/revenue.ts` | ROI + revenue attribution data |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useOutcomeLearnings()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/learnings` |
| `useOutcomeScorecard()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/scorecard` |
| `useOutcomeActions()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/actions` |
| `useOutcomePlaybooks()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/playbooks` |
| `useOutcomeTimeline()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/timeline` |
| `useOutcomeTopWins()` | `hooks/admin/useOutcomes.ts` | `/api/outcomes/:wsId/top-wins` |
| `useClientOutcomeSummary()` | `hooks/client/useClientQueries.ts` | `/api/public/outcomes/:wsId/summary` |
| `useClientOutcomeWins()` | `hooks/client/useClientQueries.ts` | `/api/public/outcomes/:wsId/wins` |

---

## 4. contentPipeline — Content Generation & Publishing Workflow

> *"What content exists, what's in progress, what gaps remain, and what's decaying?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `content-brief.ts` | 🤖📦 | Brief generation (AI) + CRUD: keyword target, outline, word count targets |
| `content-posts.ts` | 🤖 | Main content generation orchestrator |
| `content-posts-ai.ts` | 🤖 | AI generation logic: voice context → intro → sections → conclusion |
| `content-posts-db.ts` | 📦 | Generated post CRUD with version history |
| `content-matrices.ts` | 📦 | Content matrix (keyword target planning grid) + cell status tracking |
| `content-templates.ts` | 📦 | Reusable content section templates (hero, CTA, FAQ, etc.) |
| `content-requests.ts` | 📦 | Client content requests with attachments + notes |
| `content-subscriptions.ts` | 📦 | Monthly recurring content generation commitments |
| `content-decay.ts` | ⏰ | Identifies decaying pages (30%+ click drop in 60d) + generates refresh recommendations |
| `content-calendar-intelligence.ts` | 🔧 | Publication timing suggestions + keyword gap analysis |
| `cannibalization-detection.ts` | 🔧 | Keyword overlap detection between cells/pages (high/medium/low severity) |
| `suggested-briefs-store.ts` | 📦 | AI-suggested briefs with keyword-hash deduplication |
| `content-image.ts` | 🔧 | Image optimization for content |
| `brief-export-html.ts` | 🔧 | Brief → HTML export for client download |
| `html-to-richtext.ts` | 🔧 | HTML → Webflow Rich Text converter for CMS publishing |
| `schema-plan.ts` | 🤖 | Schema deployment planning (planned vs deployed types) |
| `schema-suggester.ts` | 🤖 | AI schema suggestions per page |
| `schema-store.ts` | 📦 | Schema markup CRUD |
| `schema-queue.ts` | 📦 | Schema deployment queue |
| `post-export-html.ts` | 🔧 | Renders branded HTML pages for blog posts (PDF export) |
| `processor.ts` | ⏰ | Asset upload watcher: generates alt text, uploads to Webflow, tracks metadata |

→ Also feeds: **pageProfile** (per-page content status), **siteHealth** (schema errors)

### Routes

| File | Purpose |
|------|---------|
| `routes/content-briefs.ts` | Brief CRUD + AI generation + suggested briefs |
| `routes/content-posts.ts` | Post CRUD + AI generation + versioning |
| `routes/content-matrices.ts` | Matrix CRUD + cell management |
| `routes/content-requests.ts` | Client requests + payment flow |
| `routes/content-subscriptions.ts` | Subscription management |
| `routes/content-decay.ts` | Decay analysis + refresh recommendations |
| `routes/content-publish.ts` | Webflow CMS publishing |
| `routes/content-templates.ts` | Template CRUD |
| `routes/content-plan-review.ts` | Content plan AI review |
| `routes/suggested-briefs.ts` | AI-suggested briefs CRUD |
| `routes/public-content.ts` | Client-facing content views |
| `routes/webflow-schema.ts` | Schema markup CRUD + suggestions |
| `routes/webflow-cms.ts` | Webflow CMS collection operations |
| `routes/webflow-cms-images.ts` | CMS image management |
| `routes/webflow-alt-text.ts` | AI alt-text generation |
| `routes/webflow-organize.ts` | Page organization + URL structure |
| `routes/rewrite-chat.ts` | AI content rewrite chat |
| `routes/llms-txt.ts` | LLMs.txt generation |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useContentPipeline()` | `hooks/admin/useContentPipeline.ts` | Briefs + posts + matrices + decay (4 calls) |
| `useContentCalendar()` | `hooks/admin/useContentCalendar.ts` | Briefs + posts + requests + matrices (4 calls) |
| `useAdminBriefsList()` | `hooks/admin/useAdminBriefs.ts` | `/api/content-briefs/:wsId` |
| `useAdminPostsList()` | `hooks/admin/useAdminPosts.ts` | `/api/content-posts/:wsId` |
| `useAiSuggestedBriefs()` | `hooks/admin/useAiSuggestedBriefs.ts` | `/api/content-briefs/:wsId/suggested` |
| `useClientContentPlan()` | `hooks/client/useClientQueries.ts` | `/api/public/content-plan/:wsId` |

---

## 5. siteHealth — Technical SEO & Performance

> *"Is the site technically sound? What's broken, slow, or missing?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `seo-audit.ts` | 🤖 | Full site audit with AI-powered issue analysis |
| `audit-page.ts` | 🔧 | Per-page HTML parsing + SEO/AEO issue detection |
| `seo-audit-html.ts` | 🔧 | HTML extraction utilities (tags, links, structure) |
| `reports.ts` | 📦 | Audit snapshot CRUD: site-wide scores + per-page issues + performance |
| `site-architecture.ts` | 🔧 | URL tree from existing/planned pages with gap analysis |
| `redirect-scanner.ts` | 🔧 | Redirect chain detection, 404s, target recommendations |
| `link-checker.ts` | 🔧 | Dead link detection: extracts + checks URLs |
| `performance-store.ts` | 📦 | PageSpeed/PageWeight/LinkChecker/CompetitorCompare snapshots |
| `aeo-page-review.ts` | 🤖 | Answer Engine Optimization: author, dates, FAQ schema checks |
| `schema-validator.ts` | 🔧 | Structured data (JSON-LD) schema.org compliance validation |
| `external-detection.ts` | 🔧 | External vs internal link classification |
| `seo-change-tracker.ts` | 📦 | Tracks SEO edits over time (title, meta, H1 changes) |
| `scheduled-audits.ts` | ⏰ | Automated audit scheduling cron |
| `seo-suggestions.ts` | 🤖 | AI-powered SEO improvement suggestions per page |
| `pagespeed.ts` | 🌐 | Fetches PageSpeed Insights + CrUX field data for Core Web Vitals + Lighthouse scores |
| `redirect-store.ts` | 📦 | Persistent storage for redirect scan results |

### Routes

| File | Purpose |
|------|---------|
| `routes/aeo-review.ts` | AEO review operations |
| `routes/audit-schedules.ts` | Audit schedule management |
| `routes/competitor-schema.ts` | Competitor schema analysis |
| `routes/webflow-audit.ts` | Site audit execution + results |
| `routes/webflow-pagespeed.ts` | PageSpeed/CWV data |
| `routes/site-architecture.ts` | Site architecture visualization |
| `routes/seo-change-tracker.ts` | SEO edit history |
| `routes/reports.ts` | Audit report snapshots |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useAuditSummary()` | `hooks/client/useClientQueries.ts` | `/api/public/audit-summary/:wsId` |
| `useAuditSeo()` hooks | `hooks/admin/useAuditSeo.ts` | Audit traffic, suppressions, schedules, schema |
| `usePageEditStates()` | `hooks/admin/usePageEditStates.ts` | `/api/workspaces/:wsId/page-states` |
| `useHealthCheck()` | `hooks/admin/useHealthCheck.ts` | `/api/health` |

---

## 6. clientSignals — Client Engagement & Health

> *"How engaged is this client? Are they at risk? What do they care about?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `churn-signals.ts` | ⏰ | Daily detection of at-risk clients (8 signal types: no login, chat dropoff, payment failed, etc.) |
| `feedback.ts` | 📦 | Client feedback CRUD (bug/feature/general) with team replies |
| `client-users.ts` | 📦 | Client portal user management + session tokens |
| `approvals.ts` | 📦 | Content/schema approval workflows — approval rate + response time patterns |
| `monthly-digest.ts` | 🤖 | Monthly email digest: activity + insights + recommendations |
| `monthly-report.ts` | 🔧 | Monthly PDF report: traffic + rankings + recommendations |
| `requests.ts` | 📦 | Client portal service requests with notes + attachments |
| `chat-memory.ts` | 📦 | Persistent AI conversation history with cross-session summaries |

→ Also consumes: **learnings** (ROI data), **insights** (for narratives), **operational** (activity patterns)

### Routes

| File | Purpose |
|------|---------|
| `routes/churn-signals.ts` | Churn signal feed + dismissal |
| `routes/feedback.ts` | Feedback CRUD |
| `routes/approvals.ts` | Approval workflow management |
| `routes/public-auth.ts` | Client authentication |
| `routes/public-feedback.ts` | Client-facing feedback |
| `routes/public-portal.ts` | Client portal data |
| `routes/public-chat.ts` | Client-facing AI chat |
| `routes/public-requests.ts` | Client service requests |
| `routes/requests.ts` | Admin-side service request management |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useClientAuth()` | `hooks/useClientAuth.ts` | `/api/public/auth/:wsId` |
| `useClientData()` | `hooks/useClientData.ts` | Aggregates all client data |
| `useChat()` | `hooks/useChat.ts` | `/api/public/search-chat/:wsId` |

---

## 7. pageProfile — Per-Page Intelligence

> *"For this specific page: what's its performance, health, content status, and optimization history?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `rank-tracking.ts` | 📦 | Per-page keyword position tracking with 180-day history |
| `roi-attribution.ts` | 📦 | Per-action before/after metrics for specific pages |
| `content-decay.ts` | ⏰ | Per-page decay detection (30%+ click drop) |
| `anomaly-detection.ts` | ⏰ | Per-page traffic/ranking anomaly detection |
| `seo-change-tracker.ts` | 📦 | Per-page SEO edit history (title, meta, H1) |
| `site-architecture.ts` | 🔧 | Page position in URL tree (hub/spoke, orphan detection) |
| `performance-store.ts` | 📦 | Per-page CWV/PageSpeed snapshots |
| `recommendations.ts` | 📦 | Per-page optimization recommendations (fix_now/fix_soon/fix_later) |

→ Cross-references: **insights** (page-filtered), **learnings** (page actions), **contentPipeline** (brief/post status), **siteHealth** (audit issues)

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useRecommendations()` | `hooks/admin/useRecommendations.ts` | `/api/public/recommendations/:wsId` |
| `useClientLatestRanks()` | `hooks/client/useClientQueries.ts` | `/api/public/rank-tracking/:wsId/latest` |
| `useClientRankHistory()` | `hooks/client/useClientQueries.ts` | `/api/public/rank-tracking/:wsId/history` |

---

## 8. operational — Jobs, Activity & Platform Health

> *"What's happening right now? What's queued? What ran recently?"*

### Server Modules

| File | Type | Purpose |
|------|------|---------|
| `activity-log.ts` | 📦 | Per-workspace activity feed (500 max) with real-time WebSocket broadcast |
| `analytics-annotations.ts` | 📦 | Date-labeled annotations linked to analytics events |
| `jobs.ts` | ⏰ | Background job processor: audits, decay analysis, recommendations, anomalies |
| `usage-tracking.ts` | 📦 | AI usage log: minutes saved per feature, call counts |
| `approval-reminders.ts` | ⏰ | Automated reminders for stalled approvals |
| `trial-reminders.ts` | ⏰ | Growth trial expiration reminders |
| `backup.ts` | ⏰ | Automated database backup cron |
| `startup.ts` | 🔧 | Server initialization: migration runner, cron scheduling |
| `annotations.ts` | 📦 | Timeline annotations (labels, dates, descriptions) |
| `work-orders.ts` | 📦 | Work orders linked to payments with status tracking + completion metadata |
| `storage-stats.ts` | 🔧 | Directory size scanning + pruning utilities for data retention |

### Routes

| File | Purpose |
|------|---------|
| `routes/activity.ts` | Activity feed |
| `routes/annotations.ts` | Annotation CRUD |
| `routes/jobs.ts` | Background job management |
| `routes/ai-stats.ts` | AI usage statistics |
| `routes/health.ts` | Health check endpoint |
| `routes/work-orders.ts` | Work order management |
| `routes/data-export.ts` | Data export (CSV, JSON) |
| `routes/workspace-home.ts` | Workspace home dashboard aggregation |
| `routes/workspace-badges.ts` | Workspace achievement badges |
| `routes/roadmap.ts` | Feature roadmap status |

### Frontend Hooks

| Hook | File | API Endpoint |
|------|------|-------------|
| `useWorkspaceOverview()` | `hooks/admin/useWorkspaceOverview.ts` | Overview + activity + anomalies + presence + feedback + time-saved |
| `useAnalyticsAnnotations()` | `hooks/admin/useAnalyticsAnnotations.ts` | `/api/annotations/:wsId` |
| `useAnomalyAlerts()` | `hooks/admin/useAnomalyAlerts.ts` | `/api/anomalies/:wsId` |
| `useBackgroundTasks()` | `hooks/admin/useBackgroundTasks.ts` | `/api/jobs` |
| `useClientActivity()` | `hooks/client/useClientQueries.ts` | `/api/public/activity/:wsId` |
| `useClientApprovals()` | `hooks/client/useClientQueries.ts` | `/api/public/approvals/:wsId` |

---

## Cross-Cutting Infrastructure

> *Files that serve all slices — not owned by any one column.*

### Intelligence Layer Core

| File | Purpose |
|------|---------|
| `workspace-intelligence.ts` | Central orchestrator: `buildWorkspaceIntelligence()` + `formatForPrompt()` |
| `workspace-data.ts` | Shared data accessors: `getWorkspacePages()`, `getContentPipelineSummary()` |
| `intelligence-cache.ts` | LRU cache + single-flight dedup for intelligence assembly |
| `bridge-infrastructure.ts` | `fireBridge()`, `withWorkspaceLock()`, `debouncedOutcomeReweight()`, per-bridge flags |
| `seo-data-provider.ts` | Abstract provider interface for SEMRush/DataForSEO |

### Platform Infrastructure

| File | Purpose |
|------|---------|
| `app.ts` | Express app setup, route registration, middleware |
| `index.ts` | Main server entry point: Sentry, migrations, DB, app, websocket, schedulers |
| `auth.ts` | JWT verification + auth middleware |
| `middleware.ts` | Rate limiting, admin token verification, multer uploads |
| `broadcast.ts` | WebSocket broadcast (global + workspace-scoped) |
| `websocket.ts` | WebSocket connection management |
| `ws-events.ts` | WebSocket event type definitions |
| `logger.ts` | Pino structured JSON logging |
| `sentry.ts` | Error monitoring integration |
| `feature-flags.ts` | Feature flag CRUD with DB overrides |
| `constants.ts` | Platform constants (STUDIO_NAME, etc.) |
| `helpers.ts` | URL normalization, JSON parsing, slug generation |
| `data-dir.ts` | Single source of truth for all data directory paths |
| `jwt-config.ts` | JWT signing configuration + secret management |
| `api-cache.ts` | In-memory TTL cache for GSC/GA4 API responses (15-min default) |
| `test-deduplication.ts` | Test script for AI dedup verification (dev only) |

### Database

| File | Purpose |
|------|---------|
| `db/index.ts` | SQLite singleton (WAL mode, foreign keys, migrations) |
| `db/stmt-cache.ts` | Prepared statement lazy-initialization pattern |
| `db/json-validation.ts` | Safe JSON parsing with typed fallbacks |
| `db/outcome-mappers.ts` | Row → object mapping for outcome records |

### Email

| File | Purpose |
|------|---------|
| `email.ts` | Nodemailer SMTP sending |
| `email-queue.ts` | Persistent email batching queue |
| `email-templates.ts` | HTML template rendering for all email types |
| `email-throttle.ts` | Rate limiting by email category |

### External Integrations

| File | Purpose |
|------|---------|
| `webflow.ts` | Webflow API client (sites, pages, collections) |
| `webflow-pages.ts` | Webflow page listing + content fetching |
| `webflow-client.ts` | Webflow API authentication |
| `webflow-cms.ts` | Webflow CMS operations |
| `webflow-assets.ts` | Webflow asset management |
| `google-auth.ts` | Google OAuth2 token management |
| `anthropic-helpers.ts` | Claude API wrapper |
| `openai-helpers.ts` | OpenAI API wrapper |
| `stripe.ts` | Stripe webhook handling |
| `stripe-config.ts` | Stripe configuration (AES-256-GCM encrypted) |
| `web-scraper.ts` | HTML page scraping for audits |

### AI Utilities

| File | Purpose |
|------|---------|
| `ai.ts` | Shared AI helper functions |
| `ai-context-check.ts` | SEO context consistency validation |
| `ai-deduplication.ts` | Deduplication for repeated AI generations |
| `admin-chat-context.ts` | 947-line context assembler with 15-category question classifier (35 data sources) |
| `alttext.ts` | AI alt-text generation |
| `internal-links.ts` | AI internal link suggestions |
| `llms-txt-generator.ts` | LLMs.txt page summary generation |

### Payments, Auth & Admin

| File | Purpose |
|------|---------|
| `payments.ts` | Stripe payment record CRUD |
| `users.ts` | Multi-user account management (JWT auth) |
| `sales-audit.ts` | Sales prospect audit generation |
| `sales-report-html.ts` | Sales report HTML rendering |

### Infrastructure Routes

| File | Purpose |
|------|---------|
| `routes/auth.ts` | Authentication (JWT login/logout/session) |
| `routes/users.ts` | Multi-user account management |
| `routes/workspaces.ts` | Workspace CRUD |
| `routes/google.ts` | Google OAuth flow + token management |
| `routes/stripe.ts` | Stripe webhooks + checkout sessions |
| `routes/features.ts` | Feature flag management |
| `routes/intelligence.ts` | Unified intelligence API endpoint |
| `routes/webflow.ts` | Core Webflow site operations |
| `routes/ai.ts` | Generic AI operations |
| `routes/misc.ts` | Smart image naming + miscellaneous AI utilities |
| `routes/recommendations.ts` | Per-page recommendations |

---

## Cross-Slice Data Flow

Files that bridge multiple slices — important for understanding dependencies:

```
seoContext ←──── keyword-strategy.ts ────→ contentPipeline (keyword targets)
                                          pageProfile (page assignments)

insights  ←──── anomaly-detection.ts ───→ siteHealth (anomaly counts)
                                          pageProfile (page anomalies)

learnings ←──── outcome-tracking.ts ────→ pageProfile (page actions)
                                          clientSignals (ROI data)
                                          operational (pending measurements)

contentPipeline ← content-decay.ts ────→ pageProfile (decay per page)
                                          insights (decay insights)

siteHealth ←─── reports.ts ─────────────→ pageProfile (per-page audit issues)
                                          insights (audit-based insights)

clientSignals ←─ churn-signals.ts ──────→ operational (at-risk alerts)
                                          learnings (engagement → retention)
```

---

## Intelligence Layer Connection Status

| Slice | Phase 1-2 Status | Phase 3A Target |
|-------|-----------------|-----------------|
| **seoContext** | ✅ Assembled from `buildSeoContext()` | Add rank tracking, backlinks, SERP features, businessProfile, strategy history |
| **insights** | ✅ Assembled from `analytics-insights-store` | Already complete — minor enrichment additions |
| **learnings** | ✅ Assembled from `workspace-learnings` | Add ROI attribution, WeCalledItEntry |
| **contentPipeline** | ⚠️ API returns data but slice assembler stubbed | Wire 15+ modules, add subscriptions + schema deployment |
| **siteHealth** | ⚠️ API returns data but slice assembler stubbed | Wire 10+ modules, add performance + link health + change velocity |
| **pageProfile** | ❌ Stubbed | Wire 8+ modules (cross-slice page-filtered queries) |
| **clientSignals** | ❌ Stubbed | Wire 7+ modules, compute composite health score |
| **operational** | ❌ Stubbed | Wire 8+ modules, add time-saved + recommendation queue |
