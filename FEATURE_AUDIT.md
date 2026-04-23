# hmpsn.studio — Platform Feature Audit

A comprehensive value assessment of every feature in the platform — **310 features** across SEO tooling, content strategy, analytics intelligence, client portal, AI advisors, monetization, and infrastructure. For each feature: what it does, why it matters to the agency, why it matters to clients, and how it creates mutual value.

> **How to use this document:** This serves as a single knowledge base and sales reference for the platform's complete capabilities. Features are grouped by platform area. Use Cmd+F to find specific features, or browse by section header.

---

## Admin Dashboard (Internal)

### 1. Workspace Overview
**What it does:** Multi-client dashboard showing health scores, pending requests, approval status, and key metrics at a glance. **Trial/tier badges**: each workspace card displays an amber "Trial · Xd" badge when on a Growth trial (with days remaining) or a blue/violet tier badge (Growth/Premium) for paid workspaces. `/api/workspace-overview` returns `tier`, `isTrial`, and `trialDaysRemaining` computed from `ws.trialEndsAt`.

**Agency value:** One screen answers "which client needs attention right now?" — no digging required. Trial badges surface which clients are about to need an upgrade conversation.

**Client value:** Nothing falls through the cracks. Their site gets attention the moment something changes.

**Mutual:** Turns reactive account management into proactive service. Faster response times; more efficient operations.

---

### 87. Admin Notification Center
**What it does:** NotificationBell component rendered inside the admin Sidebar (`src/components/layout/Sidebar.tsx`) that aggregates pending work across all workspaces. Shows counts for anomalies, content requests, approvals, and other attention items. Real-time polling every 5 minutes with click-to-navigate functionality. Opens a slide-out drawer showing categorized items with direct links to relevant workspace + tool combinations.

**Agency value:** Centralized visibility reduces time spent checking individual workspaces. Proactive issue detection prevents client escalations. Faster response times to urgent items.

**Client value:** Faster agency response to their requests and issues. Problems get noticed and addressed sooner.

**Mutual:** Improves agency efficiency while delivering better client service. Reduces missed deadlines and overlooked issues.

---

### 88. Command Center Anomaly Banner
**What it does:** Global banner at top of WorkspaceOverview showing critical/warning anomalies across all workspaces. Severity-based styling (red for critical, amber for warning) with workspace count and direct navigation to first affected workspace. Appears only when anomalies exist, providing immediate visibility to systemic issues.

**Agency value:** Proactive issue identification across entire client portfolio. Prioritizes critical issues that need immediate attention. Reduces time spent digging through individual workspace data.

**Client value:** Faster resolution of site health and ranking issues. Agency can address problems before they impact traffic significantly.

**Mutual:** Demonstrates proactive monitoring and quick response capabilities. Builds client trust through systematic issue management.

---

### 2. Asset Manager
**What it does:** Lists all Webflow site images with sizes, formats, and alt text. One-click compression and re-upload directly to Webflow. **CMS Image Optimization**: scans all CMS collections for Image, MultiImage, and RichText fields — builds a per-asset usage map showing where every image is used (collection + field + item). After compression, CMS items are automatically patched before the old asset is deleted: Image fields get the new fileId/url, MultiImage arrays swap the entry, and RichText HTML has the old CDN URL replaced with the new one (string replacement). Updated items are auto-published. **Field selector**: collapsible panel groups CMS image fields by collection with checkboxes — meta/OG/thumbnail fields unchecked by default, content/body fields checked. Selected fields gate both the CMS filter and bulk compression. **CMS filters**: "CMS Images" shows only assets used in selected fields; "CMS Missing Alt" narrows to those without alt text. **CMS badges** on each asset card show which collection → field it lives in.

**Agency value:** Turns hours of manual download-compress-reupload into a single click per image. CMS reference repair means compressed images go live everywhere — no broken images in blog posts, service pages, or rich text blocks after optimization.

**Client value:** Faster page loads and better Core Web Vitals without needing to learn image optimization. Images in blog posts stay intact after compression — no manual re-insertion.

**Mutual:** Measurable performance gains (PageSpeed scores) with minimal agency time investment. Field-level control protects carefully sized OG/meta images while still compressing content images.

---

### 3. Site Health Audit
**What it does:** Per-page SEO audit with 20+ checks: titles, meta descriptions, canonicals, H1s, heading hierarchy, content length, alt text, Open Graph, structured data, HTML size, orphan pages, indexability, and more. Weighted scoring prioritizes high-impact ranking factors. Integrates redirect chain detection and homepage Core Web Vitals inline. Auto-saves snapshots for historical comparison. Scheduled recurring audits with email alerts on score drops. **Auto-restore**: latest audit results load from disk on mount — no data loss between deploys or server restarts. **Error-sorted page list**: pages with the most errors display first so critical issues surface immediately. **Flag for Client**: send specific audit issues to the client request queue with an inline note for review/discussion — for issues that need client approval before the agency can act. **Fix→ routing**: each issue has a Fix button that routes to the appropriate tool (Schema Generator for structured data, SEO Editor for metadata, Content Briefs for thin content, Redirects for chain issues, Performance for speed). **Auto-fix context**: when Fix→ is clicked, the target tool receives the page context — Schema auto-generates for that specific page, SEO Editor auto-expands and scrolls to the page, Content Briefs pre-fills the keyword from the page name. **Traffic Intelligence**: cross-references audit results with GSC clicks/impressions and GA4 pageviews/sessions via `/api/audit-traffic/:siteId`. Each page card displays traffic badges (clicks + views). Toggle between sorting by issues or traffic impact — so high-traffic pages with SEO problems surface first. **View by fix type toggle**: the All Pages list in the client HealthTab now includes a "View by fix type" toggle that groups issues by check type instead of by page. Shows fix type label, severity badge, affected page count, and expandable details with plain-English impact explanations for each issue type — making it easier to batch-fix similar problems across the site.

**Agency value:** Replaces paid tools for Webflow-specific checks. Catches issues Screaming Frog misses (Webflow API vs. published HTML discrepancies). Historical snapshots track progress over time. Fix→ routing eliminates manual navigation — go from issue to solution in one click. Flag for Client handles issues that need sign-off without disrupting the workflow. Traffic intelligence means you fix the pages that actually get visitors first — not just the ones with the most errors.

**Client value:** A clear health score with specific, actionable recommendations — not a wall of jargon. Flagged issues arrive as structured requests with context and recommendations.

**Mutual:** A shared language for site health. "We improved your score from 72 to 89" is visible in both dashboards. The audit-to-fix pipeline means issues get resolved faster — no context-switching, no lost details between discovery and action. Trust through transparency.

---

### 4. Dead Link Checker
**What it does:** Crawls every page (including CMS via sitemap), extracts all links, and checks for 404s, timeouts, and redirect chains. **Cloudflare protection filtering:** `/cdn-cgi/` paths (Cloudflare email/phone obfuscation) are excluded from `isCheckableUrl()`, from the sales-audit page discovery crawl, and from orphan-page internal link counting — preventing false-positive dead link reports on Cloudflare-hosted sites. **Auto-restore**: last scan results persist to disk and load on mount — no data loss between navigation, deploys, or restarts. **Audit integration**: dead link scan now runs automatically as part of every site audit (opt-out checkbox in audit trigger UI). Results surface in the audit header as a clickable "Broken Links" stat card. A dedicated dead links panel below site-wide issues shows each broken URL with: status code, type badge (internal/external), source page, anchor text, "Fix in SEO Editor" button (internal links), and inline "Add Redirect" form. Pending redirects can be exported as CSV (broken URL, status, found-on, redirect-to columns).

**Agency value:** Catches broken links before Google does, including ones buried in CMS collection pages. Now integrated with the site audit flow — no separate tool visit required. One-click redirect creation from audit results speeds up remediation.

**Client value:** No "page not found" experiences for visitors. Protects brand credibility.

**Mutual:** Proactive fixes demonstrate ongoing value — concrete deliverables the client didn't know they needed.

---

### 5. PageSpeed / Performance
**What it does:** Runs Google PageSpeed Insights on key pages. Reports Core Web Vitals (LCP, INP, CLS) with per-page breakdowns and optimization opportunities. Single-page on-demand testing by slug. Homepage CWV wired into the site audit as a **dedicated summary card** — runs both mobile + desktop in parallel, shows CrUX field-data pass/fail (actual Google ranking signal) with per-metric ratings and Lighthouse lab score as secondary diagnostic. CWV data lives in `cwvSummary` on the audit response (not cluttering siteWideIssues). **Platform-wide integration**: CWV summary renders in client HealthTab (mobile/desktop pass/fail with plain-language metrics), client AI chatbot context (answers "how's my page speed?"), monthly report emails (Mobile/Desktop speed badges with Lighthouse scores), InsightsDigest cards (proactive "Page speed: Passed/Needs Work" insight on Overview tab), admin AI chat, audit report exports (CSV + HTML), and AI recommendations engine. **Auto-restore**: bulk and single-page test results persist to disk and load on mount — expensive 30-60s tests survive navigation and deploys.

**Agency value:** Performance data directly from Google's own tool. No "but my site feels fast" debates — the numbers are objective.

**Client value:** Faster site = better user experience = more conversions. Performance directly affects their bottom line.

**Mutual:** Quantifiable improvements the agency can point to in monthly reports. Clients see real speed gains.

---

### 6. Schema Generator
**What it does:** Analyzes every page's content and existing structured data, then generates unified `@graph` JSON-LD schemas (Organization, FAQ, Service, Article, BreadcrumbList, LocalBusiness, etc.) using AI. Validates against Google requirements. Supports **per-page generation** via a searchable page picker — generate for one page without scanning the whole site. Results stream incrementally with real-time progress via WebSocket. Schemas persist to disk and survive deploys (incremental saves every 10s during generation). One-click **Publish to Webflow** injects schema via the Custom Code API — plus **Bulk Publish All** publishes every unpublished schema sequentially with a live progress counter. **Schema Diff View** shows a side-by-side comparison of existing vs. suggested JSON-LD before publishing, so you can see exactly what changes. **Send to Client** creates an approval batch for client review before publishing. **CMS Template Schemas** generate dynamic schemas for collection pages using Webflow's `{{wf {...}}}` template syntax — one schema template auto-populates from CMS fields across all collection items. Prompt engineering enforces strict output: no empty arrays/objects, consistent `@id` naming, omitted empty properties. **Audit Fix→ auto-generation**: when arriving from the Site Health Audit Fix→ button for a schema issue, automatically generates JSON-LD for the specific affected page — no manual page selection needed. **Direct JSON editing**: toggle an Edit button to switch from read-only preview to an editable textarea — modify the generated JSON-LD before copying or publishing. Validates JSON on change with inline error display. Edited schemas are used in copy, single-page publish, and bulk publish flows. **Recommendation flags**: `useRecommendations` hook fetches active AI recommendations per workspace; pages with schema-type recommendations show amber badge counts in the header and expandable recommendation banners (title, insight, traffic at risk, priority) inside the page detail. **workspaceId cost tracking**: AI schema generation calls now pass `workspaceId` through `SchemaContext` to `callOpenAI` for per-workspace token cost attribution. **Google Rich Results Validation Gate** (Phase 1): pre-publish rule-based validator checks all schema nodes against Google's documented required/recommended fields per type (Article, FAQPage, LocalBusiness, Product, JobPosting, Event, Recipe, Course, Review, HowTo, VideoObject, BlogPosting, NewsArticle + more). Results stored in `schema_validations` table per page. Publish button disabled when status is `errors`; warnings are advisory only. **Schema Health Dashboard** (Phase 3): per-page validation status badges (valid/warnings/errors), rich result type chips, expandable error detail with re-validate button; aggregated stats (X valid, X warnings, X errors). **Entity consistency checker**: cross-page validation that Organization, WebSite, and LocalBusiness nodes are consistent across all generated schemas for a workspace. **9 new page roles** (Phase 2): job-posting, course, event, author, review, pricing, recipe, medical, financial — each with correct Schema.org type, required fields, and Google Rich Results eligibility. AI prompt updated with disambiguation rules to prevent role conflicts. **GPT-4.1 upgrade**: schema generation, auto-fix, and CMS template generation upgraded from gpt-4.1-mini to gpt-4.1 for higher quality structured data.

**Agency value:** Schema implementation is time-consuming and error-prone. This generates production-ready, validated JSON-LD in seconds — per-page or full-site. Direct Webflow publishing eliminates manual copy-paste. CMS templates mean one schema covers hundreds of collection items automatically.

**Client value:** Rich snippets in search results (stars, FAQs, breadcrumbs) increase click-through rates significantly. Client reviews and approves before anything goes live.

**Mutual:** High-value SEO deliverable that's visible in search results. Clients see their listings stand out; agency delivers it efficiently. The approval flow ensures nothing ships without sign-off.

---

### 7. SEO Strategy (Keyword Mapping)
**What it does:** Maps every page to primary/secondary keywords using GSC data, competitor analysis, SEMRush metrics (volume, KD%, intent), and AI. Batched parallel AI processing for large sites. Identifies content gaps, quick wins, low-hanging fruit, and keyword opportunities. Summary dashboard with performance tiers, search intent badges, and sortable/filterable page map. Runs as a background job with real-time progress. Smart page filtering excludes utility pages. **Conversion-aware**: GA4 conversion events and events-by-page data injected into the master synthesis prompt; AI protects "money pages" and references specific conversion events in quickWin rationales. **Audit-aware**: `getAuditTrafficForWorkspace` cross-references SEO audit errors with traffic data; high-traffic pages with issues surfaced as quickWins with specific fix actions. **Page type mapping**: content gap recommendations now include `suggestedPageType` (blog, landing, service, location, product, pillar, resource) — the AI selects the best format for each opportunity based on intent and keyword context. Page type badges (violet) display on content gap cards in both admin and client views. **Content gap enrichment**: Each content gap is enriched with SEMRush volume/KD and GSC impressions (existing site impressions for that keyword even without a dedicated page). KD color-coded (green ≤30, amber ≤60, red >60), volume shown as monthly searches, and existing impressions highlighted in blue — surfaced in both admin ContentGaps and client StrategyTab views.

**Agency value:** Automates the most labor-intensive part of SEO — the keyword strategy document. Pulls real data from GSC + GA4 conversions + SEMRush + audit intelligence instead of guesswork. Batched processing handles 100+ page sites efficiently. Conversion data ensures the strategy never deprioritizes pages that drive revenue. **Large-site safety (March 2026):** Configurable page cap in Strategy Settings (200 / 500 / 1000 / All — default 500). Pages prioritized by path depth + Webflow metadata availability (homepage first, then key service/product pages). HTML body reads limited to 100KB per page via streaming to prevent OOM. Content snippets reduced from 1200→800 chars for capped sites. Prevents exit-134 crashes on 750+ page sites. **Prompt standardization (April 2026):** `callStrategyAI` wraps existing system message content with `buildSystemPrompt()` — voice DNA and custom notes inject into all 3 call sites (batch analysis, master synthesis, topic clustering) without adding duplicate system messages.

**Client value:** A clear roadmap: which pages target which keywords, what content is missing, and where the quick wins are. Interactive strategy view with "Request This Topic" buttons. Strategy now reflects which pages actually convert, not just which pages rank.

**Mutual:** Replaces static PDF strategy decks with a living, data-driven plan both sides can reference and act on.

---

### 8. Content Brief Generator
**What it does:** AI-generates full content briefs from keyword strategy data — suggested titles, outlines, word count targets, internal linking opportunities, competitor analysis, E-E-A-T guidelines, content checklists, and schema recommendations. Supports **Brief vs. Full Post** service tiers with configurable pricing. Branded HTML export and AI tool export formats. Full client approval workflow: submit topic → generate brief → client reviews → approve/decline/request changes → upgrade to full post. **SEMRush enrichment**: when configured, briefs include real keyword volume, difficulty, CPC, competition data, and related keywords from SEMRush instead of AI-estimated values. **Inline editing**: all key brief fields (title, meta, summary, outline headings/notes/word counts, audience, tone, CTAs, competitor insights, word count target, intent, format) are editable in-place with auto-save on blur. **Improved GSC filtering**: related queries now match any significant keyword word (length > 2) instead of only the first word. **Audit Fix→ pre-fill**: when arriving from the Site Health Audit Fix→ button for thin content issues, the keyword field is automatically pre-filled with the page name (hyphens converted to spaces) so the user can immediately generate a brief. **Page-type briefs**: 7 page types (blog, landing, service, location, product, pillar, resource) with type-specific AI prompt instructions — each type gets tailored guidance for word count, structure, schema, CTAs, outline format, and content approach. `pageType` stored on both `ContentBrief` and `ContentTopicRequest` models. Page type selector in pricing modal and topic submission form. Brief generation endpoint passes `pageType` to the AI prompt. Content request cards show page type badges. **Enhanced AI context pipeline**: brief generation now enriches prompts with multiple data sources run in parallel — knowledge base (`buildKnowledgeBase`), keyword map context (`buildKeywordMapContext`), audience personas (`buildPersonasContext`), reference URL scraping (up to 5 competitor/inspiration URLs scraped and summarized via `web-scraper.ts`), real Google SERP data (top results + People Also Ask questions scraped for the target keyword via `scrapeSerpData`), and GA4 top-performing page content as style examples (highest-engagement pages scraped for tone/structure reference). All new context blocks are injected into the AI prompt for dramatically improved brief relevance and quality. **Reference URLs input**: Advanced Options panel in the generator form accepts competitor/inspiration URLs (one per line) — scraped content informs the AI about existing high-quality content on the topic. **Audience Personas**: workspace-level persona definitions (name, description, pain points, goals, objections, buying stage, preferred content format) managed in Workspace Settings → Features; injected into both brief generation and full post generation prompts so content speaks directly to defined audience segments. **Prompt standardization (April 2026):** Brief generation adds workspace learnings block (`getWorkspaceLearnings` → `formatLearningsForPrompt`, gated on `outcome-ai-injection` flag). Prompt restructured from single user message to system + user pair; system message uses `buildSystemPrompt()` for voice DNA + custom notes. `responseFormat: { type: 'json_object' }` added for JSON output reliability.

**Agency value:** Briefs that used to take 1-2 hours each are generated in under a minute with real search data baked in. Service tier pricing built in. Inline editing lets the team refine AI output without regenerating. The enriched context pipeline means briefs now incorporate knowledge base, competitor content analysis, real SERP data, audience personas, and top-performing content patterns — producing briefs that rival human strategist output. Quality guardrails ensure briefs avoid corporate buzzwords, provide proper H3 substructure, and use the full sitemap for link suggestions.

**Client value:** Professional, research-backed content briefs they can review, approve, decline, or request changes on directly from their portal. PDF/HTML export available with page type badge in the header. Real SEMRush data grounds the brief in actual market metrics. Persona-aware briefs speak to their actual audience segments.

**Mutual:** Streamlines the entire content production pipeline from strategy → brief → review → approval → production. Pricing transparency builds trust. Editable briefs mean faster iteration; real data means better strategic decisions. The multi-source enrichment pipeline means every brief is informed by competitive intelligence, audience understanding, and actual search landscape data. Brief-level quality rules (case study anonymity, FAQ formatting, industry diversity, section count, buzzword bans) propagate cleaner instructions to downstream post generation.

---

### 8.5. SEO Tier 3 Data Source Enrichment
**What it does:** Six backend enrichments that inject richer data into AI prompts and summary math across keyword recommendations, content decay analysis, content briefs, copy refresh, job analysis, and recovery rate calculations. **(Item 12)** GSC queries as keyword candidates in `keyword-recommendations.ts` — queries with word overlap and ≥10 impressions added alongside SEMRush related terms, deduped against existing candidates, enabling recommendations from actual search behavior. **(Item 13)** Per-page GSC query breakdown injected into decay-refresh AI prompt in `content-decay.ts` — top 3 decaying queries for the page provide context for refresh recommendations. **(Item 13b)** Decay query context injected into content briefs for decaying pages in `content-brief.ts` and `content-requests.ts` — when a brief is generated for a request whose targetPageSlug matches a page flagged by decay analysis, the brief prompt receives the decay context (declining queries, traffic trend) for targeted recovery content. **(Item 13c)** GSC `topQueries` populated in `DecayContext` and injected into copy-refresh AI prompt in `copy-refresh.ts` — section-refresh AI receives the top GSC queries for a decaying page, improving the relevance of copy rewrites to actual search traffic patterns. **(Item 14)** SEMRush pre-fetch for top-N pages before bulk-analysis batch loop in `server/routes/jobs.ts` — exported helper `prefetchSemrushForTopPages(workspace, pageIds)` fetches domain and URL-level organic metrics for priority pages in parallel before the batch loop, reducing per-page API latency and improving response times. **(Item 15)** Issue-type-specific recovery rates replacing flat 12% in `server/recommendations.ts` — exported `getRecoveryRate(issueType)` returns rates calibrated to each issue category (metadata: 8%, heading structure: 6%, content depth: 15%, internal linking: 12%, schema: 18%) instead of a one-size-fits-all constant, improving recovery estimates in opportunity scoring and monthly report win attribution math.

**Agency value:** Every AI recommendation now factors in real search behavior (GSC queries) and market-proven recovery baselines. Content briefs for decaying pages arrive with context instead of generic generation. Recovery math in opportunities reflects issue-type reality instead of guessed averages.

**Client value:** Content briefs speak directly to the declining keywords clients are seeing in their analytics. Recommended content priorities reflect actual market conditions, not generic templates.

**Mutual:** Richer data at every decision point — strategy generation, decay analysis, brief creation, copy refresh, job execution, and impact scoring. All six improvements are passive: existing workflows absorb new data without API/UI changes.

---

### 9. SEO Editor
**What it does:** Edit page titles, meta descriptions, and OG tags directly through the Webflow API — with AI-powered suggestions based on actual page content and target keywords. **Audit Fix→ auto-expand**: when arriving from the Site Health Audit Fix→ button for metadata issues, the target page automatically expands and scrolls into view so the user can immediately edit. **Recommendation flags**: `useRecommendations` hook surfaces metadata-type recommendations inline per page — amber badge count in the page header and expandable recommendation banners (title, insight, traffic at risk, priority tier) inside the expanded editing section. **Audit-aware AI rewrites**: the `/api/webflow/seo-rewrite` endpoint now looks up the latest audit snapshot for the workspace, finds page-specific issues (title length, missing description, duplicate title/description, thin content, H1 issues), and injects them into the AI prompt so rewrite suggestions directly address known audit findings. **Per-page Send to Client**: each page row now has a "Send to Client" button (next to "Save to Webflow") that sends changed SEO title/description fields to the client approval queue for that single page. Bulk "Send to Client" button relabeled for consistency with Schema Suggester. **Prompt standardization (April 2026):** Single-page rewrite now injects keyword map context (`buildKeywordMapContext`) and page-level intelligence (cannibalization conflicts, content decay, page health — matched via URL-aware `pageId.endsWith(pagePath)` lookup). All 4 `callCreativeAI` calls (single + bulk × both/single modes) wrapped with `buildSystemPrompt()` so voice DNA (Layer 2) and custom notes (Layer 3) activate automatically.

**Agency value:** No more logging into Webflow, finding the page, editing, saving, and publishing. Batch-edit dozens of pages from one screen. Fix→ from audit eliminates the search step entirely.

**Client value:** SEO changes happen faster. Optimizations that used to take days are done in minutes.

**Mutual:** Speeds up the most common SEO task (metadata optimization) by 10x. More gets done in less time.

---

### 10. Approval Workflow
**What it does:** Agency proposes SEO changes (titles, descriptions, schemas) as batches. Client reviews, approves/rejects, edits, and the approved changes push directly to Webflow via API. Schema approvals show JSON-LD previews with @graph type badges. Supports both metadata and structured data changes in a single workflow. **Retract capability**: every tool that sends approval batches (SEO Editor, Schema Generator, CMS Editor) now shows a "Sent to Client" panel listing pending batches with a "Retract" button — removes the batch from the client's view instantly. Retract works for approved/rejected batches too, not just in-review. Inline confirmation prevents accidental deletes. Expandable item details show per-item approval status. Auto-refreshes after new batches are sent. **Client undo**: clients can revert approved or rejected decisions back to pending — PageEditState syncs to 'in-review' and rejection notes are cleared on undo. **Two-step rejection**: reject requires a note before confirming, with dedicated rejection draft UI. **Edit diff**: when a client edits a proposed value, the original is shown struck-through beneath. **Bulk confirm**: "Approve All" requires `window.confirm()` before executing. **Public endpoint auth**: all 4 public approval endpoints use `requireClientPortalAuth()` middleware (JWT → legacy session → admin Bearer → passwordless fallback). **Batch status**: supports pending/partial/approved/rejected/applied with full recalculation logic — admin badge shows correct state including all-rejected. **Live admin updates**: PendingApprovals wires `useWorkspaceEvents` for `approval:update`/`approval:applied` so admin sees client actions in real time. **React Query migration**: PendingApprovals uses `useQuery`/`useMutation` with query invalidation instead of manual state management. **Validation**: Zod schemas on create batch and update item endpoints via `validate()` middleware.

**Agency value:** No more email chains asking "is this title OK?" — structured workflow with clear status tracking. Schema changes go through the same flow.

**Client value:** Full control over what goes live on their site. Can see proposed vs. current values and suggest edits.

**Mutual:** Eliminates the approval bottleneck. Both sides have visibility into what's pending, what's approved, and what's been applied.

---

### 11. Rank Tracker
**What it does:** Track specific keyword positions over time using Google Search Console data. Pin priority keywords, capture snapshots, and visualize trends. Click any keyword row to expand a **position sparkline** showing the full position history over time (inverted Y-axis: lower position = higher on chart) with best/worst position stats and period delta. **Trends toggle** (header button, appears when pinned keywords exist) shows a multi-keyword SVG line chart for all pinned keywords, with color-coded lines, gridlines, Y-axis position labels, and a legend with current positions. **Automatic daily snapshots:** A background scheduler (`rank-tracking-scheduler.ts`) fires every 24h, iterating all workspaces with GSC configured, and stores a snapshot without requiring a manual "Capture Snapshot" click. The snapshot route uses `ws.webflowSiteId` (not the workspace UUID) when calling `getSearchOverview`, matching the token storage key.

**Agency value:** Shows the direct impact of SEO work over time. "Your target keyword moved from position 18 to position 6." Sparklines and trends chart provide quick visual proof without exporting data.

**Client value:** Proof that the SEO investment is working, tracked against the keywords they actually care about. Trend visualization makes progress tangible.

**Mutual:** Aligns both parties on which keywords matter and provides objective measurement of progress.

---

### 12. Analytics Hub — Connected Intelligence Engine (Phase 1)
**What it does:** Insight-first unified analytics hub replacing separate Search Console and Google Analytics pages. **Overview tab** defaults to **Insights sub-tab** with summary pills (drops/opportunities/wins/schema/decay counts, clickable to filter), a priority feed (top 5 insights ranked by impact score), and a toggleable trend chart (4 available lines: clicks, impressions, users, sessions — max 3 active). **Metrics sub-tab** retains the original StatCard grid + InsightCards. **Search Performance tab** defaults to **Search Insights** with a domain-filtered priority feed and an AnnotatedTrendChart with search-specific lines (clicks, impressions, CTR%, avg position). Queries and Pages tables remain as sub-tabs. **Site Traffic tab** defaults to **Traffic Insights** with a domain-filtered priority feed above existing Traffic Health Summary, Growth Signals, Engagement Analysis, Organic vs All, and Next Steps sections. **Breakdown sub-tab** (renamed from Overview) has an AnnotatedTrendChart with traffic lines (users, sessions, pageviews). Events tab unchanged.

**Intelligence Engine enrichment:** All insights are now enriched with page titles (from page_keywords table, falling back to cleaned slugs), strategy keyword alignment, content pipeline status, audit issue linking, domain classification (search/traffic/cross), and impact scores. New insight types: `ranking_mover` (position changes ≥3), `ctr_opportunity` (CTR below expected for position), `serp_opportunity` (high-impression pages without schema). `quick_win` renamed to `ranking_opportunity`. Content decay delegated to standalone `content-decay.ts` engine. The `InsightFeed` component renders priority-ranked items with severity icons, human-readable headlines, context lines, and filter chips. `SummaryPills` show counts with toggle filtering. `InsightSkeleton` provides progressive loading.

**Agency value:** Insight-first design surfaces what needs attention immediately. Priority feed ranked by impact score means the most important issues are always visible. Enrichment connects insights to strategy, pipeline, and audit data — "this page dropped AND has a brief in progress AND matches a strategy keyword." Toggleable charts let you focus on the metrics that matter for the current analysis.

**Client value:** (Admin-only for now; client migration Phase 3.) When migrated, narrative framing replaces technical metrics.

**Mutual:** Annotations on all charts across all tabs. Connected intelligence means insights are never decontextualized — every insight links to actionable next steps.

---

### 13. Connected Intelligence Engine — Phase 2: Feedback Loops
**What it does:** Wires the insight engine's intelligence into the platform's other major systems. **Anomaly Digest:** Anomaly detection results (12h cycle) now flow into the insight store as `anomaly_digest` entries with deduplication — ongoing anomalies update in place rather than creating duplicates, keyed on `(workspaceId, anomaly_type, metric)`. **Feedback Loops:** After insight computation, the orchestrator (`insight-feedback.ts`) generates strategy signals (momentum keywords, misalignment flags, content gaps) and pipeline signals (suggested briefs, refresh suggestions) and broadcasts via WebSocket. **Strategy Intelligence Signals:** New section in KeywordStrategyPanel showing momentum keywords, strategy misalignments, and content gap suggestions derived from the insight engine. **AI Suggested Briefs:** New section in ContentPipeline showing suggested briefs from ranking opportunities and refresh suggestions from content decay. **Admin Chat enrichment:** `buildInsightsContext` now includes page titles, strategy alignment, pipeline status, audit issue counts, and anomaly digest data. Critical insights trigger proactive mentions. **Audit annotation:** Page health insights include linked audit issues (top 5 error/warning). **Schema enrichment:** SERP opportunity insights include schema validation gaps.

**Agency value:** Insights are now actionable — they push directly into the strategy and content pipeline with one-click brief creation. Admin Chat gives data-backed answers to "what should I work on?" Anomalies surface in the priority feed alongside regular insights, not in a separate silo.

**Client value:** (Indirect — Phase 3 will expose narrative versions.) The underlying intelligence is now richer, supporting future client-facing insight narratives and ROI attribution.

**Mutual:** Feedback loops close the intelligence cycle — insights inform strategy, strategy informs content, content results become new insights.

---

### 14. Annotations
**What it does:** Mark specific dates on analytics charts with labels (e.g., "Launched new homepage," "Google core update," "Started ad campaign").

**Agency value:** Correlates traffic changes with known events. Essential for reporting — "traffic jumped 30% after the redesign we launched on March 3."

**Client value:** Context for why numbers change. Without annotations, a traffic spike or drop is just a mystery.

**Mutual:** Shared timeline of actions and results. Both parties can point to cause-and-effect relationships.

---

### 15. Activity Log
**What it does:** Chronological feed of all platform actions — audits run, changes applied, content requested, briefs generated, approvals completed, schemas published, redirects scanned, strategies generated, and more. Now wired to **all major operations** across the platform with consolidated data paths for reliable persistence.

**Agency value:** Full audit trail. Know exactly what was done, when, and for which client. Every tool action is automatically logged.

**Client value:** Transparency into what the agency is actively doing. "Last activity: 2 hours ago" beats silence.

**Mutual:** Eliminates "what have you been doing?" conversations. The work speaks for itself.

---

### 16. Scheduled Audits
**What it does:** Automated recurring SEO audits on a configurable schedule with email alerts when scores drop below a threshold.

**Agency value:** Catches regressions without manual monitoring. A client's developer breaks something? You know before the client does.

**Client value:** Continuous monitoring means problems are caught early, not after rankings have already dropped.

**Mutual:** Proactive monitoring that catches issues in days, not months. Both sides avoid the pain of discovering problems too late.

---

### 17. Background Tasks
**What it does:** Long-running operations (audits, compression, brief generation, schema generation, strategy analysis) run asynchronously with real-time WebSocket progress updates. Supports job cancellation (stop mid-generation and keep partial results). Job labels in TaskPanel identify what's running. Incremental persistence saves partial results to disk during long jobs.

**Agency value:** No frozen screens or timeouts. Start a schema generation across 50 pages and keep working — partial results stream in live. Cancel anytime and keep what's done.

**Client value:** Invisible to the client, but ensures their dashboard always loads fast and never hangs.

**Mutual:** Professional, responsive UX that handles heavy operations gracefully. No lost work from server restarts.

---

## Client Dashboard (External)

### 18. Client Portal
**What it does:** Password-protected, white-labeled dashboard for each client. Shows curated views of search data, site health, analytics, strategy, content, requests, and approvals. Supports dark/light theme and custom branding. Custom favicon and dynamic browser tab title. HMAC-based auth tokens with server-side validation. Rate limiting and CORS lockdown for security.

**Agency value:** Replaces monthly PDF reports and "let me pull up the numbers" calls. Clients self-serve their own data 24/7. Security hardening means confident client-facing deployment.

**Client value:** Real-time access to their site's performance without waiting for a report or scheduling a call.

**Mutual:** Reduces reporting overhead for the agency while giving clients more data access than they've ever had. Both sides save time.

---

### 19. Client Search & Analytics View
**What it does:** Client-facing views of GSC and GA4 data with the same time range controls, charts, and breakdowns as the admin side. **SearchSnapshot** component on the Overview tab presents traffic trends, top pages (plain language), and device split with period comparison badges and sparklines — no jargon. **AnalyticsSnapshot** shows visitor counts, new vs returning breakdown, top pages by engagement, and period-over-period comparison. **OrganicInsight** displays organic traffic share, organic users, bounce rate, and top organic landing pages — helping clients understand how much of their traffic comes from search.

**Agency value:** Clients stop asking "how's traffic?" — they can check themselves. Snapshot components translate raw data into client-friendly language. Frees up time for actual optimization work.

**Client value:** Ownership of their data in a clean, jargon-free interface. Organic insights show the real impact of SEO work. No GA4 login required.

**Mutual:** Self-service data access reduces back-and-forth while keeping the agency positioned as the expert who acts on the data. Comparison badges make trends obvious — clients see progress without needing to interpret charts.

---

### 20. Client SEO Strategy View
**What it does:** Exposes the keyword strategy to the client in a consolidated 3-section layout: (1) **Optimize Existing Pages** — merges Quick Wins + Growth Opportunities into a single section for improving pages the site already has. (2) **New Content to Create** — merges Content Gaps, Competitor Keyword Gaps, and Keyword Opportunities as sub-sections, presenting all net-new content ideas in one place with "Request This Topic" buttons. (3) **Your Keyword Map** — merges Page Performance Map + Target Keywords + Tracked Keywords into a unified section showing what each page targets and how it performs. Previously 5 separate sections (Content Opportunities, Quick Wins, Growth Opportunities, Keyword Opportunities, Target Keywords); now streamlined to 3.

**Agency value:** Strategy becomes a conversion tool. Cleaner layout means clients engage more deeply instead of bouncing between sections. Consolidation reduces cognitive overload and increases content request conversions.

**Client value:** Full visibility into the SEO roadmap in a clear, action-oriented structure. "Optimize" vs. "Create" framing makes the next step obvious. Unified keyword map shows the full picture in one place.

**Mutual:** Turns strategy from a one-time deliverable into an ongoing, interactive growth plan. Content gaps become revenue. Fewer sections = less confusion = faster client action.

---

### 84. Client Dashboard Primary CTAs
**What it does:** Contextual action banners in the Overview tab that guide clients to their next most valuable action. "Generate Brief" when keyword strategy exists but no briefs, "View Issues" when site health is below 80, "Find Keywords" when traffic is low. Color-coded banners (teal for content, amber for health, blue for growth) with direct navigation to relevant tabs.

**Agency value:** Reduces "what should I do next?" questions. Clients self-discover next actions that align with agency revenue (content requests, strategy work, health improvements).

**Client value:** Clear guidance on what to do next instead of overwhelming data. Action-oriented banners remove decision paralysis and provide immediate next steps.

**Mutual:** Turns passive data consumption into active engagement. Higher feature adoption and client satisfaction through guided user journeys.

---

### 85. Client Empty State Enhancement
**What it does:** Setup checklist for new workspaces replacing generic empty states. Shows "Connect Google Search Console", "Connect Google Analytics", "Run First Site Audit" with contextual icons and descriptions. Explains what data will appear once connected and why each connection matters.

**Agency value:** Faster client onboarding - clients understand exactly what's needed and why. Reduces support tickets asking "why do I see nothing?"

**Client value:** Clear onboarding path with specific actions. Understands the value of each integration before connecting.

**Mutual:** Smoother activation process gets clients to value faster. Higher connection rates for GSC/GA4/Webflow integrations.

---

### 86. Client Loading & Error States
**What it does:** Contextual loading messages that explain what's happening ("Calculating your traffic value...", "Loading approvals...") instead of generic spinners. Type-specific error states with recovery actions (retry buttons, network error guidance, permission explanations). Consistent visual design across all client-facing components.

**Agency value:** More professional appearance reduces support burden. Clear error messages help clients self-resolve common issues.

**Client value:** Better user experience with informative feedback. Clear recovery paths instead of confusing error states.

**Mutual:** Higher perceived quality and reduced frustration. Better error handling builds trust in the platform.

---

### 21. Client Content Hub
**What it does:** Clients can request content topics (from strategy recommendations or their own ideas), review AI-generated briefs, approve/decline, request changes, upgrade from brief to full post, and track production status with comments. **Inline price visibility**: brief and full post prices displayed directly on request buttons ("Get a Brief $49"), bundle savings callouts surfaced contextually. Prices pulled from Stripe config or workspace content pricing. **Page type selection**: clients choose a page type (blog, landing, service, location, product, pillar, resource) when requesting content — pre-filled from strategy recommendations when available.

**Agency value:** Structured content pipeline replaces scattered email threads. Every request has a status, every brief has a review trail.

**Client value:** Control over content direction. Can approve, edit, or decline before any writing begins. Transparent pricing.

**Mutual:** The entire content lifecycle — from idea to published post — lives in one place both sides can track.

---

### 22. Client Request System
**What it does:** Clients submit requests (bug reports, change requests, new features) with categories, file attachments, and threaded notes. Team responds with status updates. **Auto-populated submittedBy**: when a client user is logged in, the `submittedBy` field is automatically filled from `clientUser.name` and the manual "Your Name" input is hidden — reducing form friction and ensuring accurate attribution.

**Agency value:** Replaces "can you also..." emails and Slack messages. Every request is tracked, categorized, and has a clear status.

**Client value:** A proper ticket system where they can see what they've asked for and where it stands.

**Mutual:** No more lost requests. Both sides have accountability and a clear record of what was asked and what was delivered.

---

### 23. Client Approvals
**What it does:** Client reviews proposed SEO changes (titles, descriptions), approves/rejects each, can suggest edits, and approved changes auto-push to Webflow.

**Agency value:** Removes the approval bottleneck from SEO implementation. Changes go from proposed → approved → live in minutes.

**Client value:** Nothing changes on their site without their sign-off. Full control with minimal effort.

**Mutual:** The fastest path from "we recommend this change" to "it's live on your site." Both sides win.

---

### 24. AI Insights Engine (Client Chatbot)
**What it does:** Branded "hmpsn studio Insights Engine" — in-dashboard AI advisor powered by GPT-4o that answers questions using the client's full dashboard data: Google Search Console, GA4 (overview, events, conversions, sources, devices, countries), site health audit + detail, SEO strategy (page map, opportunities, content gaps, quick wins), rank tracking, activity log, annotations, pending approvals, and active requests. Revenue hook system naturally connects data insights to team services using a 3-step pattern: surface insight with numbers → explain business impact → warm handoff. Per-workspace knowledge base provides business context. Updated quick questions reflect the full data breadth. **Conversation memory**: persistent session history stored to disk (`server/chat-memory.ts`). Last 10 messages sent as conversation context to OpenAI for coherent multi-turn dialogue. **Cross-session summaries**: AI-generated session summaries (gpt-4o-mini) injected into system prompts so the chatbot recalls topics from previous conversations. Auto-summarizes after 6+ messages. **Chat history UI**: New Chat button, session history panel listing past conversations with message counts and dates, click to resume any previous session. **Period comparison data**: searchComparison, ga4Comparison, ga4Organic, and ga4NewVsReturning now sent to AI so it can reference period-over-period changes ("your clicks are up 23% vs last month"). **Audit traffic intelligence**: cached `getAuditTrafficForWorkspace` cross-references audit errors with GSC/GA4 traffic; top 5 high-traffic pages with SEO issues injected into system prompt so AI prioritizes fixes by real visitor impact. **Chat activity logging**: first exchange of each new session logged to activity log (`chat_session` type) so the agency sees what clients are asking about. **Proactive insights**: on chat open, `fetchProactiveInsight()` auto-generates 2-3 data-driven insight bullets as the opening greeting (no user message needed). `proactiveInsightSent` ref prevents duplicate greetings. `buildChatContext()` helper extracted for shared context building. Quick question follow-ups displayed after the proactive greeting.

**Agency value:** Every conversation is a potential touchpoint for additional services. Revenue hooks surface upsell opportunities organically — data-backed, never pushy. Reduces support burden while positioning the agency as the solution. Conversation memory means the chatbot builds rapport over time — clients don't repeat themselves. Activity log integration gives visibility into client concerns.

**Client value:** A knowledgeable advisor that understands their entire site — not just search data. Answers questions about health, strategy, content, rankings, and approvals in plain English. Remembers previous conversations and preferences across sessions. Now references period-over-period trends and prioritizes issues by traffic impact.

**Mutual:** The chatbot pays for itself. Clients get 24/7 data-driven advice; the agency gets natural lead-ins to propose services. Memory turns one-off Q&A into an ongoing relationship.

---

### 38. Admin AI Chat Panel
**What it does:** Internal-only chat panel ("Admin Insights") with an expert analyst persona — direct, technical, no-fluff. **Server-side context assembly** (`server/admin-chat-context.ts`): question-aware smart loading fetches only data relevant to the question from 20+ data sources — GSC (overview, comparison, devices, countries), GA4 (overview, comparison, top pages, sources, organic, new-vs-returning, conversions, landing pages), site health audit, audit traffic intelligence, keyword strategy, brand voice, knowledge base, audience personas, content briefs, content requests, rank tracking, content decay, work orders, SEO change tracker, AI recommendations, churn signals, anomalies, and activity log. No frontend pre-fetching — the backend classifies the question into categories (general, search, analytics, audit, content, strategy, performance, approvals, activity, ranks, competitors, client, page_analysis, content_review) and pulls only what's needed. **Three chat modes**: (1) **Analyst** — default cross-referencing analyst, (2) **Page Reviewer** — detects URLs/paths in questions, scrapes page content, pulls per-page audit issues and keyword context for targeted recommendations, (3) **Content Reviewer** — detects long pasted text (>150 words), switches to editorial reviewer persona with brand voice + SEO feedback. **Resizable panel**: drag left edge to resize width (360–720px), drag top edge to resize height (380–800px, floating only), drag top-left corner for simultaneous resize. **Dock mode**: toggle between floating bubble (bottom-right, rounded) and full-height right sidebar (docked, fills viewport height). Uses shared `ChatPanel.tsx` primitive for message rendering with purple accent, pinned input bar. 7 admin-specific quick questions. **Conversation memory**: persistent sessions, cross-session summaries, auto-summarize after 6+ messages. **Chat history UI**: New Chat, history panel, session resume. **Audit traffic intelligence**: high-traffic pages with SEO errors prioritized. **Chat activity logging**: first exchange logged. Response includes `mode` and `dataSourceCount` metadata.

**Agency value:** Instant technical analysis without digging through dashboards. Cross-references 20+ data sources for non-obvious insights. Page-specific analysis means "check /services" gives targeted audit + GSC + keyword data for that page. Content review mode turns the chat into an editorial reviewer for draft content. Resizable panel and dock mode let you work side-by-side with the chat open. Suggests how to frame findings for client communication. Conversation memory enables multi-session analysis. Server-side assembly is faster and smarter than frontend pre-fetching.

**Client value:** N/A — internal agency tool.

**Mutual:** Faster, deeper analysis means better recommendations for clients and more efficient operations for the agency.

---

### 39. Global Knowledge Base
**What it does:** Per-workspace knowledge base that feeds business context into all AI features — chatbots, content brief generation, and full post generation. Two input methods: inline `knowledgeBase` text field (editable in Workspace Settings → Features) and a `knowledge-docs/` folder for longer `.txt`/`.md` documents (up to 6000 chars). `buildKnowledgeBase()` in `seo-context.ts` reads both sources and injects into system prompts for client chatbot, admin chatbot, content brief generation, and content post generation.

**Agency value:** One place to store everything the AI needs to know about a client — industry, services, differentiators, common questions, target audience. Shared across chatbots, briefs, and posts.

**Client value:** AI responses and generated content are tailored to their specific business instead of generic advice.

**Mutual:** Knowledge base makes all AI features dramatically more useful with minimal ongoing maintenance.

---

### 40. Audience Personas
**What it does:** Per-workspace audience persona definitions managed in Workspace Settings → Features. Each persona includes name, description, pain points, goals, objections, preferred content format, and buying stage (awareness/consideration/decision). `buildPersonasContext()` in `seo-context.ts` constructs a structured prompt block from all defined personas. Injected into content brief generation (`generateBrief`), full post generation (`buildVoiceContext`), and available for chatbot system prompts.

**Agency value:** Define once, use everywhere. Persona definitions inform every piece of AI-generated content — briefs address the right pain points, posts speak to the right goals, and content is naturally segmented by buying stage.

**Client value:** Content that speaks directly to their actual customers, not generic audiences. Each persona's objections and goals are addressed naturally in generated content.

**Mutual:** Turns audience research into a reusable asset. Better-targeted content means higher engagement and conversion rates for clients; more efficient content production for the agency.

---

### 25. Redirect Manager
**What it does:** Scans all published pages (static + CMS via sitemap) for redirect chains, 404s, loops, and routing issues. Traces multi-hop redirects and detects broken destinations. **GSC ghost URL detection** identifies old/renamed pages that Google still indexes but no longer exist on the site — catches redirect gaps invisible to a simple crawl. AI-powered **redirect target recommendations** match broken/404 slugs against healthy pages using keyword overlap and path similarity. Review panel with accept/edit target/dismiss workflow. **Export CSV** generates Webflow-compatible redirect rules for import in Settings → Hosting → 301 Redirects. Results persist to disk between deploys.

**Agency value:** Finds redirect problems across the entire site in one scan — including CMS pages. Recommendations eliminate the guesswork of "where should this redirect to?"

**Client value:** No more "page not found" dead ends. Redirect issues are caught and fixed proactively.

**Mutual:** Export CSV → import in Webflow is a fast, repeatable workflow. The agency delivers concrete fixes; the client's visitors never hit dead pages.

---

### 26. Internal Linking Analyzer
**What it does:** Analyzes internal link structure across the site, identifying orphan pages, under-linked content, and opportunities to strengthen topic clusters through better internal linking. **Auto-restore**: analysis results persist to disk and load on mount.

**Agency value:** Internal linking is one of the highest-leverage SEO tactics and one of the most tedious to audit manually. This automates the discovery.

**Client value:** Better internal linking means visitors find more content and stay longer. Search engines crawl more efficiently.

**Mutual:** Actionable link suggestions that improve both user navigation and search engine crawlability.

---

### 27. SEMRush Integration
**What it does:** Enriches keyword data with SEMRush metrics — search volume, keyword difficulty (KD%), search intent classification, CPC, and competitive density. Data feeds into the strategy engine and client-facing views.

**Agency value:** Real market data layered on top of GSC actuals. Volume and difficulty numbers turn gut-feel prioritization into data-driven decisions.

**Client value:** Sees the actual search demand behind every keyword recommendation. "This keyword gets 12,000 searches/month" is compelling.

**Mutual:** Strategy conversations grounded in third-party market data both sides trust.

---

### 28. Security & Infrastructure
**What it does:** Rate limiting on all API endpoints. CORS lockdown restricts origins to the app domain. Server-side client authentication with HMAC tokens. Graceful error handling (soft CORS deny prevents Express crashes). Persistent data storage on `/var/data/asset-dashboard` survives deploys.

**Agency value:** Production-grade security for a client-facing application. No embarrassing data leaks or unauthorized access.

**Client value:** Their data is protected. The portal feels professional and trustworthy.

**Mutual:** Confidence in deploying to production without security concerns.

---

### 29. Competitor SEO Analysis *(removed from sidebar — component retained)*
**What it does:** Side-by-side SEO comparison between your site and any competitor URL. Runs a full audit on both sites simultaneously, then compares scores, page counts, error/warning ratios, title/description lengths, OG coverage, schema coverage, H1 coverage, and issue distribution. Surfaces **quick wins** — issues the competitor handles well that your site doesn't. Color-coded metric comparisons (green = winning, red = losing) with per-category breakdowns. **Auto-restore**: comparison results persist to disk — the most recent comparison for your site loads on mount, pre-filling the competitor URL.

**Status:** Removed from sidebar as standalone tab (March 2026). Component (`CompetitorAnalysis.tsx`) retained for future reuse. Will be replaced by **Competitive Intelligence Hub** integrated into the Strategy tab — see roadmap item #199. The new approach uses SEMRush keyword gap data + workspace competitor domains for actionable intelligence (keyword gaps, content gaps, SERP overlap, competitive monitoring) instead of basic HTML metric comparison.

**Agency value:** Answers the #1 client question — "how do we compare to [competitor]?" — with data instead of guesswork. Identifies specific areas where the competitor is ahead.

**Client value:** Concrete evidence of where they stand vs. competitors. Motivates action on recommendations when they can see the gap.

**Mutual:** Turns competitive analysis from a subjective opinion into an objective, repeatable benchmark. Re-run after improvements to show progress.

---

### 30. Sales Report (Prospect Audit)
**What it does:** URL-based SEO audit for **any website** — no Webflow API key or workspace needed. Enter a URL, and the system crawls and audits up to 50 pages, producing a branded prospect report with site score, page-by-page issues, **quick wins** (highest-impact fixes), **top risks** (most damaging problems), and site-wide issues. Reports persist and are browsable from a history list. Runs as a background job with real-time progress.

**Agency value:** A sales tool disguised as an audit. Run a report on a prospect's site during a sales call and show them exactly what needs fixing. Saved reports build a pipeline of prospects.

**Client value:** N/A — this is an internal agency tool for pre-sale conversations.

**Mutual:** Converts prospects into clients by demonstrating expertise with their own data. "Here are 12 errors on your site — want us to fix them?"

---

### 31. Page Weight Analyzer
**What it does:** Analyzes total image weight per page across the entire site. Identifies pages loading the most image data, flags heavy pages (>2MB), and provides per-page breakdowns of image count and total size. Runs as part of the Performance tab alongside PageSpeed Insights. **Auto-restore**: results persist to disk and load on mount — no need to re-run the analysis after navigating away.

**Agency value:** Pinpoints which pages need image optimization first. Pairs with the Asset Manager's compression tool for a complete workflow.

**Client value:** Faster pages for visitors. Heavy pages are identified and fixed before they hurt bounce rates.

**Mutual:** Data-driven prioritization — optimize the heaviest pages first for maximum performance impact.

---

### 32. Unified Design System
**What it does:** Consistent teal/zinc color palette across all admin and client dashboard components. All inline CSS variable references replaced with Tailwind utility classes. Unified card backgrounds, sidebar styling, workspace selector, and button treatments. **Accessibility pass**: minimum `text-[11px]` font size enforced (was `text-[8px]` in some places), improved contrast ratios, `aria-label` attributes on all icon-only buttons. **Selective type size bump**: `text-[11px]`/`text-xs` → 13.5px, `text-sm` → 15.5px for improved readability. **MetricRing** background tracks use muted score-colored fills (15% opacity) instead of flat gray. **Global cursor-pointer** rule ensures all interactive elements show pointer cursor. **SectionCard** headings bumped to `font-semibold text-zinc-200`, **PageHeader** titles to `text-zinc-100`. Theme-aware `scoreColor()` returns WCAG-compliant colors in light mode. **Standardized typography hierarchy** across all 8 client dashboard tabs: page titles use `text-xl font-semibold text-zinc-100`, subtitles use `text-sm text-zinc-500`, section headers use `text-sm font-semibold text-zinc-200`. Every tab (Overview, Search, Analytics, Site Health, Strategy, Content, Requests, Approvals) now has a consistent page-level title. **LoadingState & ErrorState components**: Contextual loading messages ("Calculating traffic value...", "Loading approvals...") and type-specific error handling with recovery actions. **EmptyState standardization**: Consistent "No data available" messages with context-appropriate icons and actions across all components. **Light mode audit (2026-03-30)**: Exhaustive 148-instance audit across 42 files. Added `themeColor()`, `chartGridColor()`, `chartAxisColor()`, `chartDotStroke()`, `chartDotFill()`, `chartTooltipStyle()`, `chartTooltipLabelStyle()` helpers to `ui/constants.ts`. Fixed all Recharts grids/axes/dots/tooltips (AnnotatedTrendChart, ScoreTrendChart, RankTracker, WorkspaceOverview, client AnalyticsTab/helpers). Fixed inline styles in RequestManager, ClientDashboardTab, BrandHub, DropZone, InternalLinks, RedirectManager, WorkspaceSettings, StripePaymentForm. Fixed icon/timeline colors in OverviewTab, HealthTab, CellDetailPanel, SiteArchitecture, WorkspaceHome. Added 17 missing `.dashboard-light` CSS overrides for opacity variants and gradients. Skeleton shimmer rule for light mode. **MetricRing glow bug fix**: glow now matches ring score color (teal/amber/red) instead of always showing teal. Page-level spacing standardized to `space-y-8` across 10 components. Asymmetric border radius (`10px 24px 10px 24px` / `6px 12px 6px 12px`) applied to section and compact cards. pr-check extended with two new automated rules: hardcoded dark hex in inline styles, SVG dark fill/stroke. **Light mode overhaul (2026-04-20)**: Full token system overhaul — `.dashboard-light` expanded from 10 to 25 CSS variables (WCAG AA-verified contrast ratios, `--brand-text-muted` adjusted to `#475569` for 6.5:1). Four-step text hierarchy restored (zinc-300/400 were identical, now distinct). `chartGridColor()` and `chartTooltipStyle()` migrated from hardcoded hex to CSS variables via new `getCssVar()` helper. 6 components had rarely-used opacity variants consolidated. All neutral bg/border overrides now point at CSS variables. New `ConfirmDialog` component (`src/components/ui/`) replaces 3 `window.confirm()` calls in ApprovalsTab. ApprovalsTab gains filter bar (All / Needs Action / Ready to Apply / Applied with live counts).

**Agency value:** Professional, cohesive appearance across every screen. No visual inconsistencies that undermine credibility.

**Client value:** A polished, accessible interface that works well on all devices and for users with visual impairments.

**Mutual:** A design system that scales — new features automatically inherit consistent styling without manual polish.

---

### 33. Component Styleguide
**What it does:** Dedicated `/styleguide` route showcasing every UI primitive and pattern in one place — color palette, typography scale, MetricRings, StatCards, CompactStatBar, Badges, EmptyState, LoadingState, ErrorState, TabBar, DateRangeSelector, DataList, PageHeader, SectionCard, Line/Area Charts (single + dual trend), ChartPointDetail popovers, data tables, modals/dialogs, toast notifications (global + inline), form inputs (text, search, textarea, select, segmented toggle), loading states (page/inline/button/typing), progress bars (segmented, severity, bulk), and sidebar navigation. Includes a dark/light theme toggle for visual verification. **New UI primitives**: LoadingState with contextual messages and size variants, ErrorState with type-specific handling (network/data/permission) and recovery actions, TableSkeleton for structured loading states.

**Agency value:** Single reference page for all UI patterns — accelerates development, catches inconsistencies, and onboards new team members instantly.

**Client value:** Indirectly benefits clients through more consistent, polished UI delivery.

**Mutual:** Prevents UI drift as the platform grows. Every component is visible, testable, and auditable in one place.

---

### 34. Contextual Cross-Linking (UX)
**What it does:** Contextual "next step" tips embedded throughout the platform that guide users from one tool to another based on their current data. Site Audit results suggest → SEO Editor (for meta fixes), → Redirects (for chain issues), → Schema (for structured data gaps), → Performance (for speed issues). Search Console insights suggest → Strategy (for keyword opportunities), → SEO Editor (for CTR improvements). Keyword Strategy content gaps suggest → Content Briefs. Rank Tracker empty state suggests → Strategy. Internal Links tips point to → SEO Editor and → Site Audit. Redirect Manager tips point to → Site Audit and → Dead Links.

**Agency value:** Reduces training time for team members. The tools teach you the workflow as you use them.

**Client value:** N/A — admin-side feature, though the client dashboard already has cross-linked overview cards.

**Mutual:** Increases tool adoption and ensures the full platform is used, not just 2-3 features.

---

### 35. Batched Email Notification Queue
**What it does:** Intelligent email batching system that groups notifications of the same type per recipient over a 5-minute sliding window, then sends a single digest email instead of spamming individual messages. Covers 7 event types: approval ready, new request, status change, team response, content request, brief ready, and audit score drop alerts. Light-mode branded HTML templates with hmpsn studio logo (#202945 on white). Queue persists to disk so events survive restarts. Queue stats visible in `/api/health` diagnostics.

**Agency value:** No more inbox flooding when bulk operations trigger dozens of notifications. One clean digest per batch instead of 15 individual emails.

**Client value:** Professional, readable email notifications with clear CTAs and dashboard links. No notification fatigue.

**Mutual:** Emails become a useful signal instead of noise. Branded templates reinforce professionalism.

---

### Roadmap (Admin)
- **Location:** `src/components/Roadmap.tsx` + `RoadmapSprintView.tsx` + `RoadmapBacklogView.tsx` + `RoadmapFilterBar.tsx`
- **What it does:** Dual-mode roadmap. Sprint View = flat list grouped by sprint section headers. Backlog View = sortable table with inline detail drawer. Shared filter bar; all filter + view state is URL-param-driven and deep-linkable.
- **Schema:** `RoadmapItem` now has `createdAt?` (forward-only), `featureId?` (soft ref to features.json), `tags?` (free-form)
- **Filter params:** `?view=sprint|backlog&priority=P0&status=pending&sprint=backlog&feature=5&tags=auth`

---

### 37. Command Center Cockpit
**What it does:** Upgraded Workspace Overview that serves as the platform's home screen when no workspace is selected. Shows: **Needs Attention** alerts (new requests, pending approvals, low health scores, unlinked workspaces), **Global Stats** bar (StatCard primitives for requests, approvals, content, health), **Roadmap Progress** panel (overall bar + sprint list with "Current" badge and "View Full →" link), **Platform Health** panel (API connection status for OpenAI, Webflow, Google Auth, Email; workspace counts; feature count), workspace cards, and recent activity feed. All using shared UI primitives (PageHeader, SectionCard, StatCard, Badge). Sidebar restructured with icon-only bottom bar for Prospect and Roadmap tools, plus a Command Center quick-access button.

**Agency value:** Instant situational awareness on login — see what needs attention across all clients without clicking into each workspace. Roadmap progress visible at a glance.

**Client value:** N/A — admin-only view.

**Mutual:** Reduces the "what should I work on next?" friction. Everything important is surfaced in one screen.

---

### 40. Workspace Home Dashboard
**What it does:** Per-workspace landing page that loads as the default tab when selecting a workspace. Parallel-fetches and displays: **site health audit** score with delta, **Search Console** overview (clicks, impressions, CTR, position), **GA4** overview (users, sessions, pageviews) with period-over-period comparison, **rank tracking** summary (top keywords with position changes), **active requests** with status counts, **content pipeline** status, **recent activity** feed, and **annotations** timeline. All data loads in parallel with a 15-second timeout per endpoint and graceful fallback — sections with no data simply don't render. Uses shared UI primitives (StatCard, SectionCard, PageHeader, Badge). **InsightsEngine action plan**: embeds the `InsightsEngine` component in compact mode (premium tier) after the Needs Attention section — shows prioritized AI recommendations grouped by urgency with "Fix →" click-through buttons that navigate directly to the appropriate editor tool (SEO Editor for metadata, Schema Generator for schema, Site Audit for technical/accessibility, Performance for speed, Content Briefs for content, Strategy for strategy) via `onNavigate` with `REC_TYPE_TAB` mapping.

**Agency value:** One screen per client shows everything that matters — health, traffic, rankings, requests, and activity — without clicking into individual tools. Instant context when switching between clients.

**Client value:** N/A — admin-only view (clients have their own portal).

**Mutual:** Eliminates the "let me pull up the data" delay. Every workspace conversation starts from a position of full awareness.

**Admin dashboard improvements (March 2026):**
- **Needs Attention prioritization**: Action items sorted by priority (P1=critical, P2=important, P3=setup). Capped at 5 visible urgent items with "N more" collapse. Setup suggestions (missing GSC/GA4/Webflow) hidden in collapsed section when P1 alerts exist. Section moved above Anomaly Alerts.
- **SEO Pipeline merge**: SeoWorkStatus and SeoChangeImpact merged into single "SEO Pipeline" SectionCard via `embedded` prop.
- **Content Decay StatCard**: New metric card showing decaying page count (critical/warning), deep-links to Content Health sub-tab. Data served from aggregated workspace-home endpoint (loadDecayAnalysis).
- **Weekly Accomplishments**: Compact summary bar "This week: 3 SEO updates · 2 briefs · 1 audit" between header and metric cards. Server-side aggregation of last-7-day activity by type.
- **PageIntelligence action buttons**: "Fix in SEO Editor", "Create Brief", conditional "Add Schema" buttons at bottom of each expanded page analysis, using fixContext navigation pattern.
- **KeywordStrategy dedup**: Removed duplicate Ranking Tiers StatCard (stacked bar chart already shows same data), grid 5→4 columns.
- **SeoAudit score delta**: Score delta badge (↑6 from last audit) in site score card using history snapshots.
- **SeoAudit sub-tab deep-links**: `?sub=` query param for direct navigation to sub-tabs. Visual separator between audit tabs and analysis tabs. Renamed: "Content Decay" → "Content Health", "AEO Review" → "AI Search Ready".

### 42. Security Hardening
**What it does:** Pre-payment security layer across the Express server. **Helmet** adds security headers on all responses (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, CSP whitelisting Stripe domains in production). **HTTPS enforcement** redirects all HTTP traffic to HTTPS in production via `X-Forwarded-Proto` proxy trust. **3-tier rate limiting** on all public API routes: 60 req/min general reads, 10/min writes (POST/PATCH/DELETE), 5/min checkout (pre-wired for Stripe). **Input sanitization** via `sanitizeString()` (trim, length cap, control character stripping) and `validateEnum()` applied to all content request write endpoints. **Stripe webhook placeholder** marks the correct mount point before `express.json()` for raw body parsing.

**Agency value:** Production-grade security posture before accepting payments. Prevents abuse of public APIs, protects against XSS/clickjacking, and ensures Stripe integration has a secure foundation.

**Client value:** Payment data handled securely. Dashboard protected against common web attacks. Rate limiting prevents service degradation.

**Mutual:** Security is invisible when done right — clients trust the platform, agency avoids liability. Foundation for PCI-compliant payment flows.

---

### 42b. Public API Hardening (Bot Protection & Credential Stuffing)
**What it does:** Five-layer hardening of all `/api/public/*` endpoints for marketplace readiness. **(1) Rate limit headers** — every rate-limited response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on 429s. **(2) New rate limiters** — `aiLimiter` (3/min per IP) on `/api/admin-chat`, `globalPublicLimiter` (200/min per IP, global key mode) across all public routes. **(3) Credential stuffing protection** — per-email failed login tracking with 15-minute lockout after 5 failures, structured logging of lockout events. **(4) Cloudflare Turnstile CAPTCHA** — optional bot protection on client-login and forgot-password forms. `TurnstileWidget` React component with automatic single-use token reset on failed attempts. Skips verification if `TURNSTILE_SECRET_KEY` not set. CSP updated for `challenges.cloudflare.com`. **(5) Request fingerprinting** — SHA-256 hash of IP + User-Agent + Accept-Language attached as `req.fingerprint` for abuse detection logging.

**Agency value:** Marketplace-ready security posture. Credential stuffing protection prevents automated account takeover. Turnstile blocks bots without degrading UX. Rate limit headers enable client-side backoff.

**Client value:** Login protected against automated attacks with clear feedback on lockout duration. CAPTCHA is invisible when Turnstile scores high confidence.

**Mutual:** All features backward compatible — activate via env vars. No breaking changes for existing deployments.

---

### 43. Automated Monthly Reports
**What it does:** Auto-generated monthly report emails sent to clients on a configurable schedule. `gatherMonthlyData` aggregates site health audit (score, delta, errors, warnings), requests completed/open, approvals applied/pending, activity log, and now **traffic trends**: GSC period comparison (clicks, impressions with % change vs previous 28 days) and GA4 period comparison (users, sessions, pageviews with % change). **Chat topic summaries**: `listSessions` fetches recent client chat sessions with AI-generated summaries from the current month; up to 5 displayed in a "Topics You Asked About" section with green-tinted cards showing conversation title + summary. **Trial status banner**: when the workspace is on a Growth trial, an amber banner appears at the top of the email showing "Growth Trial · X days remaining" with an upgrade CTA — `isTrial` and `trialDaysRemaining` computed from `ws.trialEndsAt` and threaded through `monthly-report.ts` → `email-templates.ts`. `renderMonthlyReport` in `email-templates.ts` generates a branded HTML email with trial banner (when applicable), health score ring, traffic trends grid (each metric shows current value + arrow + % change vs previous period), metrics grid (requests, approvals, activities), recent activity feed, chat topics section, and pending approval alerts. Manual trigger via `triggerMonthlyReport()` or automatic via `startMonthlyReports()` scheduler.

**Agency value:** Monthly reporting that writes itself. Traffic trends show clients their site is growing (or flag problems) without manual data pulls. Chat topic summaries show the agency what clients care about. Positions the agency as proactive — clients get a polished, personalized report without anyone remembering to send it.

**Client value:** Regular, data-rich updates on their site's performance without scheduling a meeting. Traffic trends contextualize the numbers — "your clicks are up 23% vs last month" is immediately meaningful. Chat topics section reminds them of insights they explored.

**Mutual:** Eliminates the most common source of client "radio silence" complaints. The agency delivers consistent, personalized communication; the client stays informed and engaged.

---

### 44. Stripe Payment Integration
**What it does:** Full Stripe Checkout integration for content deliverables. **Server:** `server/stripe.ts` lazily initializes the Stripe SDK (picks up keys from admin UI or env vars), defines 14 product types (7 brief types, 3 post tiers, 2 schema, 2 strategy), creates Checkout sessions with workspace/content-request metadata, handles webhooks (`checkout.session.completed` → marks payment paid + logs activity, `payment_intent.payment_failed` → logs failure). `server/payments.ts` provides PaymentRecord CRUD with JSON-on-disk persistence per workspace. `server/stripe-config.ts` stores Stripe keys encrypted at rest (AES-256-GCM) on disk — no env vars needed. **Admin UI:** `StripeSettings.tsx` in the Command Center lets you paste API keys (masked inputs), map Stripe Price IDs to each product, enable/disable individual products, and see connection status. **Frontend:** `ClientDashboard.tsx` `confirmPricingAndSubmit()` creates the content request first, then redirects to Stripe Checkout when `stripeEnabled`. Payment success/cancel detected via URL params on return with toast + URL cleanup. Falls back to direct submit when Stripe isn't configured. **Workspace:** `tier` (free/growth/premium), `trialEndsAt`, `stripeCustomerId` fields added. **14-day Growth trial**: new workspaces auto-provisioned with Growth tier + 14-day trial via `initializeNewWorkspaceTrial()`. `isTrial`, `trialDaysRemaining`, and `baseTier` computed at API time. `checkTrialExpiry()` scheduled job runs daily to downgrade expired trials to `baseTier`. Trial status surfaced across client dashboard (badges, welcome modal, plans page).

**Agency value:** Direct revenue from content deliverables without invoicing friction. Admin manages everything from the dashboard — no code deploys needed to change keys or products. Encrypted key storage meets security requirements.

**Client value:** Professional checkout experience via Stripe. Clear pricing, instant payment confirmation, content request linked to payment automatically.

**Mutual:** Monetization infrastructure that works out of the box. Agency earns revenue, client gets a seamless purchase-to-delivery pipeline.

---

### 45. Internal User Accounts
**What it does:** Full user account system for internal team members. `server/users.ts` provides a User model with id, email, name, passwordHash, role (owner/admin/member), and workspaceIds. Passwords hashed with bcrypt (12 rounds). `server/auth.ts` provides JWT authentication (7-day expiry) with Express middleware: `requireAuth` (enforces valid JWT), `requireRole(…)` (role-based access), `requireWorkspaceAccess()` (workspace-scoped permissions), and `optionalAuth` (non-blocking, runs globally). First user created via `/api/auth/setup` becomes the owner with access to all workspaces. Full CRUD: create, update, delete users, change passwords. The global admin middleware accepts both legacy `APP_PASSWORD` tokens and new JWT tokens for backward compatibility. Setup status endpoint lets the frontend detect first-run.

**Agency value:** Named user accounts replace the shared password. Every action can be attributed to a specific team member. Role hierarchy (owner > admin > member) controls who can manage workspaces, users, and settings.

**Client value:** N/A — internal agency tool.

**Mutual:** Foundation for all future auth features. Activity attribution, audit trails, and access control all depend on knowing who is logged in.

---

### 46. Workspace Access Control
**What it does:** `requireWorkspaceAccess(paramName)` middleware in `server/auth.ts` checks that the authenticated user's `workspaceIds` array includes the workspace being accessed. Owners bypass all checks. Applied to GET/PATCH/DELETE `/api/workspaces/:id` routes. Soft enforcement: passes through for legacy `APP_PASSWORD` auth (no `req.user`), enforces only for JWT-authenticated users. `optionalAuth` runs globally to populate `req.user` from JWT when present, enabling workspace access checks on all routes without breaking existing flows.

**Agency value:** Team members only see and modify the workspaces they're assigned to. Prevents accidental cross-client data access as the team grows.

**Client value:** N/A — internal access control.

**Mutual:** Security boundary that scales with team size. Essential before onboarding contractors or junior team members.

---

### 47. Client User Accounts
**What it does:** Individual login accounts for client dashboard users, separate from internal team accounts. `server/client-users.ts` provides a ClientUser model with id, email, name, passwordHash, role (client_owner/client_member), workspaceId, and invitedBy. Per-workspace email uniqueness. Passwords hashed with bcrypt (12 rounds). Client JWT tokens (24h expiry) stored in per-workspace cookies (`client_user_token_<wsId>`). Public endpoints: `/api/public/client-login/:id` (email+password login), `/api/public/client-me/:id` (get current user), `/api/public/client-logout/:id`, `/api/public/auth-mode/:id` (check shared password vs individual accounts). Admin endpoints: `/api/workspaces/:id/client-users` CRUD for managing client users with workspace access control. Client login also sets the legacy session cookie for backward compatibility with the existing session enforcement middleware. Session middleware updated to accept client user JWT tokens alongside shared-password sessions. **Frontend login form**: smart login gate in `ClientDashboard.tsx` detects auth mode on load — shows email+password form when individual accounts exist, shared password form when not, or tabbed toggle when both are configured. Auto-authenticates returning users via JWT cookie. **User menu** in dashboard header: avatar initials circle, user name, and logout button. **Admin management UI** in WorkspaceSettings > Client Dashboard tab: add users (name, email, password, role), inline edit name/email, delete with confirmation, reset passwords. Role badges and last login timestamps displayed.

**Agency value:** Invite individual client team members with their own credentials. See who submitted which request, who approved what. Professional multi-user access replaces "everyone uses the same password."

**Client value:** Individual logins mean personal dashboards, attributed actions, and proper team management. Marketing directors, content managers, and developers each have their own access.

**Mutual:** Transforms the client portal from a shared-password view into a proper multi-user platform. Every action has a name attached. Foundation for role-based client permissions (client_owner vs client_member).

---

### 48. Client Onboarding Welcome Flow
**What it does:** First-visit welcome modal for new client dashboard users. Detects first visit via **per-user `localStorage` key** — includes `clientUser.id` when an individual user is logged in, so each team member sees the welcome on their own first visit (not just once per browser per workspace). Shows workspace name, tier badge (Starter/Growth/Premium with tier-specific colors), trial countdown (days remaining), and a 2×3 feature grid highlighting what's included at their tier (available features get blue icons, locked features show "Upgrade to unlock"). Trial callout panel with Zap icon explains the trial terms. Quick-action buttons: "Explore Your Dashboard" (→ overview) and "View SEO Strategy" (→ strategy, Growth+ only). Dismissible via backdrop click, skip button, or any CTA.

**Agency value:** Professional first impression. New clients immediately understand their tier, what's available, and how to navigate — zero onboarding calls needed. Trial urgency is surfaced without being pushy.

**Client value:** No confusion on first login. Clear understanding of what they can access and what's locked behind upgrades. Trial terms explained upfront.

**Mutual:** Reduces support questions about "what can I do here?" and increases feature adoption from day one. Trial awareness drives upgrade conversations naturally.

---

### 49. In-Portal Plans & Pricing Page
**What it does:** Dedicated "Plans" tab in the client dashboard with a full pricing comparison view. Three-column tier cards (Starter, Growth, Premium) with feature checklists, tier-specific color coding (zinc/blue/violet), and "Current Plan" / "Current Trial" badges. Upgrade buttons (mailto CTA) on higher tiers. Content services section showing brief and full post pricing with descriptions. Monthly bundle cards from Stripe config with included items and savings badges. "Browse Content Opportunities" CTA links to the Content tab. Contact footer for plan questions. Trial countdown banner when applicable.

**Agency value:** Upsell happens inside the product — clients see what they're missing every time they visit the Plans tab. No external pricing page needed. Bundle cards drive recurring revenue conversations.

**Client value:** Full transparency into pricing and what each tier includes. Can self-evaluate upgrade options without scheduling a call.

**Mutual:** Pricing transparency builds trust. The plans page is a passive sales tool that works 24/7 — clients upgrade when they're ready, not when they're pressured.

---

### 50. Unified Page Edit State Model
**What it does:** `PageEditState` in `server/workspaces.ts` replaces the legacy `seoEditTracking` with a rich lifecycle model. Every page tracks: status (`clean` → `issue-detected` → `fix-proposed` → `in-review` → `approved` → `rejected` → `live`), source tool, approval/content/work-order linkages, rejection notes, and timestamps. `updatePageState()`, `getPageState()`, `getAllPageStates()` server helpers. `usePageEditStates()` React hook provides client-side summary counts. All tools (audit, editor, CMS, schema, approvals, work orders, requests) read and write through this shared model.

**Agency value:** Single source of truth for every page's SEO lifecycle. No more disconnected tracking across tools. Admin sees the full picture — which pages have issues, which are in review, which were rejected by client.

**Client value:** Approval decisions (approve/reject) immediately reflected across the platform. No more "I rejected that but it still shows as pending."

**Mutual:** End-to-end traceability: audit issue → fix → client review → live. Every step is visible to both sides.

---

### 51. Work Order Fulfillment Pipeline
**What it does:** `server/work-orders.ts` defines the `WorkOrder` model (pending → in_progress → completed → cancelled). Created automatically by Stripe webhook when a client purchases fixes via the SEO cart. Stores product type, page IDs, and payment session ID. Admin API endpoints for listing and updating work orders. Client-facing `OrderStatus.tsx` with visual status stepper. On completion, updates `PageEditState` to `live`, logs activity (`fix_completed`), and emails client (`notifyClientFixesApplied`). Work order counts surface in Command Center and WorkspaceHome action items.

**Agency value:** Clear fulfillment queue — see what's been purchased and what needs work. Completion triggers automatic page state updates and client notification.

**Client value:** Visual order tracking with status progression. Knows exactly where their purchased fixes stand.

**Mutual:** Closes the loop from payment to delivery. Both sides have visibility into fulfillment status.

---

### 52. AI Recommendations Engine
**What it does:** `server/recommendations.ts` generates traffic-weighted, prioritized SEO recommendations per workspace using audit data, GSC traffic, and AI analysis. Status-tracked (active → dismissed → completed). Auto-regenerated after every audit run. Client-facing `FixRecommendations.tsx` surfaces recommendations with severity badges and "Fix →" routing to appropriate tools. `InsightsEngine` on WorkspaceHome shows prioritized recommendations grouped by urgency. Recommendation flags appear in SEO Editor and Schema Generator via `useRecommendations` hook. Site-wide issues (duplicate titles, orphan pages, etc.) now list specific affected pages with traffic data instead of generic "affects all pages" messaging.

**Agency value:** Automatically identifies the highest-impact SEO actions after every audit. No manual analysis needed — recommendations are prioritized by traffic impact.

**Client value:** Clear, prioritized list of what to fix and why. Each recommendation links to the tool that can fix it.

**Mutual:** Ensures both sides focus on the changes that will have the most impact on traffic and rankings.

---

### 53. SEO Self-Service Cart & Checkout
**What it does:** Client-facing `SeoCart.tsx` and `useCart.tsx` enable clients to add recommended fixes to a cart (meta fixes, schema pages, redirect fixes) and checkout via Stripe. Cart items carry `pageIds` through to Stripe metadata, which flows into work order creation on payment. `FixRecommendations.tsx` surfaces purchasable fix actions based on audit findings.

**Agency value:** Revenue from fix services without manual quoting or invoicing. Clients self-serve the purchase flow.

**Client value:** One-click purchase of recommended fixes with transparent pricing. No back-and-forth negotiations.

**Mutual:** Turns audit findings into revenue automatically. The platform identifies the problem, recommends the fix, and processes the payment.

---

### 54. Cross-Tool Activity Feed for Client Actions
**What it does:** Client approval and rejection actions are logged to the activity feed with actor name, field changed, and context. Activity types include `approval_applied`, `changes_requested`, and `fix_completed`. Activity entries include `pageId` metadata for cross-referencing. Client actions visible in WorkspaceHome activity feed and Command Center.

**Agency value:** Full visibility into client decisions without checking each approval batch individually. See rejections immediately with client notes.

**Client value:** Their actions are acknowledged and visible — no "black hole" feeling after approving or rejecting.

**Mutual:** Both sides have a shared timeline of all actions taken on the site.

---

### 55. Approval Context & Reason Field
**What it does:** `ApprovalItem` now includes an optional `reason` field populated from audit findings when creating approval batches from `SeoAudit.tsx`. The client sees "Why: [recommendation]" context on each proposed change in `ApprovalsTab.tsx`. Confirmation dialog added before applying approved changes to the live website.

**Agency value:** Clients understand why each change is proposed, reducing rejection rates and back-and-forth.

**Client value:** Full context for every proposed change — not just "we want to change your title" but "your title is 72 characters, which gets truncated in search results."

**Mutual:** Informed decisions lead to faster approvals. The confirmation dialog prevents accidental live deployments.

---

### 56. Command Center SEO Work Status
**What it does:** The `/api/workspaces/overview` endpoint now includes `pageStates` per workspace (issueDetected, inReview, approved, rejected, live counts). `WorkspaceOverview.tsx` displays colored status pills on each workspace card. Rejected changes surface in the "Needs Attention" alerts. WorkspaceHome shows an SEO Work Status section with clickable status counts that navigate to the relevant tool.

**Agency value:** At-a-glance visibility into SEO work status across all clients from the Command Center. Rejected items surface immediately as attention items.

**Client value:** N/A — admin-only view.

**Mutual:** Ensures no client workspace is overlooked. Rejected items trigger immediate attention.

---

### 57. Request-to-Page Linkage
**What it does:** `ClientRequest` now includes an optional `pageId` field that links requests to specific pages. When a request is completed/closed, the linked page's `PageEditState` is updated to `live`. Internal request creation endpoint passes `pageId` through.

**Agency value:** Requests are traceable to specific pages. Completing a request automatically updates the page lifecycle.

**Client value:** Their requests about specific pages are properly linked, reducing confusion about what was fixed.

**Mutual:** Closes the loop from "client reports an issue on page X" to "page X is marked as fixed."

---

### 58. Prospect-to-Client Onboarding CTA
**What it does:** "Onboard as Client" button on the Sales Report results page. Extracts the domain from the audit URL and navigates to workspace creation with the URL and name pre-filled. Enables a seamless flow from prospect audit to client onboarding.

**Agency value:** One-click transition from prospect audit to workspace setup. No manual data entry needed.

**Client value:** N/A — internal agency tool.

**Mutual:** Reduces friction in the sales-to-onboarding pipeline.

---

### 59. Expanded Email Notifications
**What it does:** Two new email notification types: `notifyClientRecommendationsReady` (sent after audit auto-generates recommendations, includes count and dashboard link) and `notifyClientAuditImproved` (sent when audit score increases, shows score delta). Full HTML templates with branded layout. Total of 15 `EmailEventType`s across the platform.

**Agency value:** Clients are automatically notified of positive progress and new recommendations without manual outreach.

**Client value:** Proactive communication — know when your score improves and when new recommendations are available without logging in.

**Mutual:** Automated touchpoints that demonstrate ongoing value and keep clients engaged with the platform.

---

### 60. AI Content Post Generator
**What it does:** Generates full SEO-optimized content posts from content briefs. `server/content-posts.ts` generates each section independently using the brief's outline as the writing spec, with page-type-specific writer roles (blog, landing, service, location, product, pillar, resource). Each section gets full context: brand voice, keyword strategy, E-E-A-T guidance, SERP competitive analysis, and internal link suggestions. Every prompt includes the total article word budget and strict ±10% per-section tolerances. After all sections + conclusion are generated, a **unification pass** (`unifyPost`) reviews the full assembled draft and refines it for cohesion — smoothing transitions, removing cross-section repetition, ensuring consistent voice, verifying the intro's promises are fulfilled by the body, and **trimming word count to the brief's target** when over budget. Uses GPT-4.1 at temperature 0.4 for precise editorial refinement with dynamic maxTokens (8K–16K based on target word count). Unification status (`success`/`failed`/`skipped`) is tracked on the post and surfaced in the PostEditor UI. Non-critical: if unification fails, the post is still usable. Progress saved after each section so partial results are available during generation. API: POST `/api/content-posts/:workspaceId/generate`, GET/PATCH/DELETE per post, export as markdown/HTML. **Content quality engine (v5)**: comprehensive `WRITING_QUALITY_RULES` injected into every prompt — forbidden phrase lists (AI clichés, corporate buzzwords, hollow intensifiers, vague attribution), structural anti-patterns (no section-ending summaries, no repetitive bullet patterns), fabrication rules (no invented stats/percentages, directional case study outcomes only), anchor text accuracy rules, and mandatory H3 subheadings for sections 200+ words. Internal links use the workspace `liveDomain` for correct URLs. Full Webflow sitemap (published pages + CMS pages via `getAllSitePages`) passed to both brief and post generation for comprehensive internal link suggestions. Brand name limited to intro + conclusion only.

**Agency value:** Full blog posts generated in minutes instead of hours. Page-type-specific prompts produce content that matches the intent (landing page copy reads differently from a blog post). Unification pass eliminates the "obviously AI-generated" seams between sections. Quality guardrails prevent common AI writing tells — no "Let's dive in", no fabricated statistics, no repetitive brand mentions, no buzzword-laden prose. Claude produces noticeably more natural prose than GPT alone.

**Client value:** Content is personalized to their brand voice, actual GSC/GA4 data, and competitive landscape. Each post arrives as a polished draft with proper H2/H3 heading hierarchy, correctly linked internal pages, and industry-diverse examples — not a rough assembly of disconnected sections.

**Mutual:** Transforms the content pipeline from brief → manual writing → delivery into brief → AI generation → review → delivery. Dramatically reduces content production time and cost while maintaining quality. The hybrid Claude/GPT engine produces stronger first drafts suitable for a content cadence strategy with human refinement for standout pieces.

---

### 61. Auto-Publish to Webflow CMS
**What it does:** Closes the content loop: Brief → AI generates post → client approves → one-click publish to Webflow CMS collection. Ten-part implementation: (1) `createCollectionItem()` in `server/webflow.ts` for CMS item creation via Webflow v2 API. (2) `server/html-to-richtext.ts` assembles post HTML from intro/sections/conclusion and generates URL-safe slugs. (3) `publishTarget` config on workspace model with field mapping (title, slug, body, meta fields, featured image, author, date, category). (4) `PublishSettings.tsx` admin UI with collection selector, AI-powered field mapping suggestions via GPT (POST `/api/webflow/suggest-field-mapping/:siteId`), and save to workspace. (5) Publish endpoint `POST /api/content-posts/:wsId/:postId/publish-to-webflow` — loads post, validates status, converts HTML, builds field data from mapping, creates CMS item, publishes it live, updates SQLite tracking. (6) `server/content-image.ts` — DALL-E 3 featured image generation with automatic Webflow asset upload via presigned S3. (7) Publish buttons in `PostEditor.tsx` header and `ContentManager.tsx` list view — confirmation dialog with title/slug preview, "Publish + Generate Image" option, success badge with link. (8) Auto-publish on approval — when post status changes to 'approved' and workspace has publishTarget configured, automatically publishes in the background. (9) SQLite migration `007-content-publish.sql` adds `webflow_item_id`, `webflow_collection_id`, `published_at`, `published_slug` to content_posts and `publish_target` to workspaces. (10) `CONTENT_PUBLISHED` WebSocket event and `content_published` activity type for real-time UI updates.

**Agency value:** Eliminates the manual copy-paste step between content generation and CMS publishing. One-click (or zero-click with auto-publish) from approved content to live site. AI field mapping means no manual configuration for each Webflow collection schema. DALL-E featured images remove the need for stock photo sourcing.

**Client value:** Approved content goes live immediately — no waiting for the agency to manually publish. The approval workflow becomes the publish trigger, giving clients direct control over when content appears on their site.

**Mutual:** Transforms the content pipeline from brief → AI generation → approval → manual publish into a fully automated flow. Reduces time-to-publish from hours to seconds. The field mapping AI adapts to any Webflow CMS structure, making onboarding new clients trivial.

---

### 62. Knowledge Base Auto-Generation
**What it does:** One-click knowledge base generation from the client's live website. `POST /api/workspaces/:id/generate-knowledge-base` crawls up to 15 priority pages (homepage, about, services, case studies, blog, contact — selected via regex pattern matching on URL paths) using the shared `scrapeWorkspaceSite()` helper plus sitemap discovery for CMS pages. Scraped content (titles, meta descriptions, headings, body text excerpts) is sent to GPT-4.1 which extracts a structured knowledge base: business overview, services & offerings, target audience, differentiators, case studies & results (with real numbers when available), brand voice & tone, key topics & expertise, and important details. The generated text populates the Knowledge Base textarea in the Brand & AI hub (`BrandHub.tsx`) for human review before saving. "Generate from Website" button with loading state and unsaved-changes indicator.

**Agency value:** Eliminates the manual step of writing business context for each new client. One click produces a comprehensive knowledge base that immediately improves all AI outputs (chatbot, content briefs, blog posts, strategy).

**Client value:** Better AI outputs from day one — the chatbot and content generation already know the business without the agency spending hours writing context documents.

**Mutual:** Reduces onboarding time from hours to minutes. The auto-generated knowledge base can be refined over time, but the starting point is already rich enough for quality AI interactions.

---

### 65. Brand Voice Auto-Generation
**What it does:** One-click brand voice guide generation from the client's live website. `POST /api/workspaces/:id/generate-brand-voice` reuses the shared `scrapeWorkspaceSite()` helper to crawl up to 15 priority pages, then sends the content to GPT-4.1 with a brand strategist prompt that analyzes writing patterns across the site. Produces a comprehensive guide covering: tone & personality (overall tone, personality traits, formality level), writing style (sentence structure, vocabulary level, person/perspective, active vs passive voice), messaging patterns (service descriptions, reader address style, CTA style, recurring phrases), do's and don'ts, and example phrases lifted directly from the site. The generated text populates the Brand Voice textarea in the Brand & AI hub (`BrandHub.tsx`) for human review before saving. "Generate from Website" button next to "Save Brand Voice" with loading state.

**Agency value:** Eliminates guesswork when defining brand voice for new clients. The AI analyzes actual writing patterns instead of relying on the agency's subjective impression. Produces actionable guidelines that all AI features follow immediately.

**Client value:** AI-generated content (briefs, posts, SEO rewrites) matches their actual brand voice from day one instead of sounding generic.

**Mutual:** Turns implicit brand voice knowledge into an explicit, reusable asset. Better brand alignment in all AI outputs means less revision cycles and faster content approval.

---

### 66. Audience Personas Auto-Generation
**What it does:** One-click audience persona generation from the client's live website. `POST /api/workspaces/:id/generate-personas` reuses the shared `scrapeWorkspaceSite()` helper, then sends content to GPT-4.1 with a marketing strategist prompt that identifies 2-5 distinct audience segments. Returns structured JSON personas with: name, description, pain points, goals, objections, preferred content format, and buying stage. The AI identifies personas based on evidence from the website — who the services target, case study clients, language used. Results populate the Audience Personas manager in the Brand & AI hub (`BrandHub.tsx`) as draft personas for human review before saving. "Generate from Website" button in the personas section with loading state and toast notification showing count and pages scraped.

**Agency value:** Skips the manual persona research step for new client onboarding. AI-generated personas are evidence-based (derived from actual website content) and immediately usable in content briefs, blog posts, and strategy.

**Client value:** Content that speaks to their actual audience segments from day one. Each persona's pain points and goals are addressed naturally in generated content.

**Mutual:** Transforms audience research from a multi-hour workshop exercise into a one-click starting point. Generated personas can be refined, but the initial set is specific enough to dramatically improve content targeting.

---

### 61. Admin Content Manager
**What it does:** Dedicated "Content" tab in the admin sidebar (SEO group) for reviewing and managing all generated content across workspaces. `ContentManager.tsx` lists all generated posts with status cards showing title, target keyword, word count, status badge, and creation date. **Status workflow**: Draft → Review → Approved (with back-to-draft). **Search and sort**: filter by title/keyword, sort by date, title, status, or word count. **Auto-refresh**: polls every 10 seconds when any post is in "generating" status. **Actions**: inline status progression, delete with confirmation, HTML export links. Opens `PostEditor` for full inline editing of any post.

**Agency value:** Single screen to review all generated content, manage approval workflow, and export deliverables. No more hunting through individual briefs to find posts.

**Client value:** N/A — admin-only tool (clients interact with content via the Content Hub in their portal).

**Mutual:** Completes the content pipeline visibility — from strategy gap → brief → generated post → review → approved → delivered.

---

### 63. Server Refactor (index.ts → Route Modules)
**What it does:** Split `server/index.ts` from ~8,300 lines into ~450 lines + 46 Express Router files in `server/routes/` + 3 shared modules (`broadcast.ts`, `helpers.ts`, `middleware.ts`). Each route file owns one domain (e.g., `auth.ts`, `webflow.ts`, `content-briefs.ts`, `public-portal.ts`). Shared middleware (`middleware.ts`) is the single source of truth for rate limiting, session signing, file upload, and auth helpers. `helpers.ts` extracts pure functions (sanitize, validate, date parsing, audit traffic). `broadcast.ts` provides a singleton WebSocket broadcast pattern so route files can emit events without importing the WS server directly. Index.ts retains only: Express setup, Helmet/CORS/cookie-parser, Stripe webhook (raw body), WebSocket server, route mounting, and startup initialization. **Extended decomposition (March 2026):** `webflow.ts` route split into 6 focused sub-routes (`webflow-alt-text.ts`, `webflow-audit.ts`, `webflow-cms.ts`, `webflow-keywords.ts`, `webflow-organize.ts`, `webflow.ts` core). `seo-audit.ts` decomposed: per-page check logic extracted to `audit-page.ts`, HTML report rendering to `seo-audit-html.ts`. **Server module splits:** `server/webflow.ts` (monolith Webflow API) → barrel re-export + `webflow-client.ts` (shared fetch helper) + `webflow-assets.ts` (asset CRUD) + `webflow-pages.ts` (pages/SEO/publishing) + `webflow-cms.ts` (collections). `server/content-posts.ts` → orchestrator barrel + `content-posts-ai.ts` (AI prompt construction/generation) + `content-posts-db.ts` (SQLite CRUD/version history). New routes: `workspace-badges.ts`, `workspace-home.ts` (56 total route files).

**Agency value:** Dramatically improves developer velocity — finding and modifying endpoints goes from scanning 8K lines to opening a single file. New features slot into the correct route file without merge conflicts. Shared modules eliminate copy-paste patterns that previously drifted out of sync.

**Client value:** N/A — internal architecture improvement. Indirectly improves reliability by reducing the chance of regressions when adding features.

**Mutual:** Sustainable codebase that can grow to 100+ endpoints without becoming unmaintainable. Foundation for future team collaboration — multiple developers can work on different route files simultaneously.

---

### 64. AI Context Completeness Indicator
**What it does:** Shared utility (`server/ai-context-check.ts`) evaluates all 8 AI data sources for a workspace and returns a completeness score. Checks: Webflow site, GSC, GA4, Knowledge Base (inline + files), Brand Voice (inline + files), Audience Personas, Keyword Strategy, and SEMRush. Each source reports status (connected/missing), detail text, which features it impacts, and a fix action link. API endpoint `GET /api/ai/context/:workspaceId` exposes the data. Reusable React component `AIContextIndicator` (`src/components/ui/AIContextIndicator.tsx`) renders an expandable bar with score percentage, connected/total count, missing source summary, and per-source detail rows with "Set up" buttons that navigate to the appropriate settings tab. Supports `feature` prop to filter sources by relevance (e.g., `feature="briefs"` only shows sources that impact brief generation). Compact mode available for inline pill display. Wired into Content Briefs (above Generate button) and Keyword Strategy (before first generation).

**Agency value:** Immediately surfaces which data sources are missing before generating AI content — no more wondering why a brief came out generic. Self-guiding onboarding: the indicator tells you exactly what to set up next and links directly to the right settings page.

**Client value:** N/A — admin-only indicator. Indirectly improves all AI-generated content quality by ensuring the agency fills in context before generating.

**Mutual:** Turns a hidden dependency chain (integrations → knowledge base → strategy → briefs → posts) into a visible, actionable checklist. Reduces wasted AI tokens on context-poor generations.

---

### 67. Beta Client Feedback Widget
**What it does:** In-dashboard floating feedback widget for beta clients. Positioned bottom-left in the client portal — clients can submit bug reports, feature requests, or general feedback without leaving the dashboard. Auto-captures context (current tab, browser, screen size, URL) with every submission. Feedback stored per-workspace on disk (`DATA_DIR/feedback/`). Admin Command Center shows a cross-workspace feed of all submissions with status tracking (New → Acknowledged → Resolved / Won't Fix), threaded replies (team ↔ client), and inline reply input. Email notification sent to admin on each new submission. Activity log entry auto-created. Real-time WebSocket broadcast on new feedback.

**Agency value:** Structured beta feedback collection without external tools (replaces Canny, Intercom, or email chaos). Every submission includes auto-attached context so you know exactly where the client was when they hit the issue. Status workflow keeps feedback organized.

**Client value:** One-click bug reports and feature requests from inside the dashboard they're already using. Can track status of their submissions and see team replies without switching tools. Feels heard.

**Mutual:** Lightweight alternative to heavyweight feedback tools. Keeps everything in-platform. Reply threads create a natural conversation about priorities.

---

### 68. Client Keyword Feedback System
**What it does:** Clients can approve or decline keywords directly from the Strategy tab. Declined keywords are stored in an AI memory bank — future strategy generations automatically exclude them. Approve/decline controls appear on content gap cards, page keyword map entries, and keyword opportunity pills. A "Declined Keywords" summary section shows all excluded keywords with one-click restore. Decline modal collects optional reasons. Page filtering also expanded to exclude legal pages, 404s, and utility pages from all recommendations.

**Agency value:** Clients actively curate their keyword strategy instead of passively receiving it. Declined keywords never resurface, eliminating repeated "we don't want this" conversations. Optional decline reasons provide insight into client thinking.

**Client value:** Direct control over which keywords shape the strategy. "Not relevant" button immediately removes keywords they don't care about. Approved keywords get prioritized. Feels like an active participant, not a recipient.

**Mutual:** Strategy alignment happens asynchronously — no meeting required to say "we don't do that service." AI learns from client preferences over time.

---

### 69. Client Strategy Participation (Business Priorities + Content Gap Voting)
**What it does:** Two new client-facing features in the Strategy tab: (1) **Business Priorities** — clients can add categorized business goals (growth, brand, product, audience, competitive) that get injected into the AI prompt for future strategy generations; (2) **Content Gap Voting** — upvote/downvote arrows on every content gap card let clients signal which topics matter most. Priorities stored in SQLite, votes tracked per-workspace per-keyword.

**Agency value:** Client priorities are captured in a structured format that directly feeds AI strategy generation — no more "what did they say they wanted?" guessing. Gap votes create a natural prioritization signal for content planning.

**Client value:** Business context is baked into the strategy engine, not lost in email threads. Voting on content gaps feels like steering the strategy, not just reviewing it.

**Mutual:** Puts clients in the driver's seat. Strategy becomes a collaborative, living document shaped by both agency expertise and client business knowledge.

---

### 70. CMS SEO Editor Issue Highlighting
**What it does:** The CMS SEO Editor now matches the static page SEO editor's color-highlight system. Item rows show color-coded left borders (amber for SEO issues, status-colored for tracking state). Collapsed rows display "No title" (amber) and "No desc" (red) badges. Collection headers surface aggregate issue counts (missing names, SEO titles, meta descriptions). Character counts on Name and SEO fields use green/amber/red color coding with target thresholds. Unsaved changes shown as blue badges. Untitled items rendered in red italic.

**Agency value:** At-a-glance visual scanning of CMS collection health — immediately see which items need attention without expanding every row. Same mental model as the static page editor.

**Client value:** N/A (admin-only view).

**Mutual:** Consistency across both SEO editors reduces cognitive load and speeds up bulk editing workflows.

---

### 71. SEMRush Domain Fix + Credit-Exhausted Circuit Breaker
**What it does:** Fixed competitive intelligence showing all zeros by stripping `www.` prefix from domains before SEMRush API queries (SEMRush treats `www.domain.com` and `domain.com` as distinct). Added a shared `cleanDomainForSemrush()` helper applied to all 6 domain-based functions. Also added a credit-exhausted circuit breaker: when any SEMRush call returns "API UNITS BALANCE IS ZERO", all further calls pause for 5 minutes (cached results still served). Diagnostic and cache-clear endpoints added for debugging.

**Agency value:** Competitive intelligence data actually works. Circuit breaker prevents burning API calls when credits run out — no more floods of failed requests in logs.

**Client value:** Accurate competitor data in the dashboard when viewing competitive intelligence.

**Mutual:** Reliable data + smart API usage = better ROI on SEMRush subscription.

---

### 72. Schema Retract (Plan + Individual Pages)
**What it does:** Adds the ability to retract (remove) published JSON-LD schemas from individual Webflow pages and delete entire schema site plans. Per-page retract strips all JSON-LD script blocks from the page's custom code via Webflow API, removes the page from the local snapshot, and resets the page edit state to clean. Plan retract deletes the schema site plan from SQLite, resetting the site to a "no plan" state. Both actions are confirmation-gated to prevent accidental deletion. Activity log entries track all retractions.

**Agency value:** Undo capability for schema deployments. If a schema causes validation issues or the client changes direction, retract it in one click instead of manually editing Webflow custom code. Plan retract lets you start fresh without leftover role assignments.

**Client value:** N/A (admin-only).

**Mutual:** Safety net for the schema workflow. Reduces risk of deploying schemas since they can be cleanly removed.

---

### 73. Client Schema Review Tab
**What it does:** Adds a "Schema" tab to the client portal that shows the site-wide structured data strategy in a clean, client-friendly format. Replaces the need to send 250+ individual approval notifications. Shows page roles grouped by type with plain-English descriptions of what each schema type does for Google visibility. Clients can approve the strategy or request changes with notes — feedback flows to the activity log and broadcasts to the admin in real-time. Includes an educational blurb explaining structured data for non-technical clients. Public API endpoints: `GET /api/public/schema-plan/:workspaceId`, `GET /api/public/schema-snapshot/:workspaceId`, `POST /api/public/schema-plan/:workspaceId/feedback`.

**Agency value:** Schema plans get reviewed faster — clients see the full strategy in one clean view instead of wading through hundreds of approval notifications. Approval/rejection flows back to the admin dashboard via WebSocket.

**Client value:** Understand what structured data is being added to their site and why. Approve or request changes at the strategy level, not per-page.

**Mutual:** Better client understanding → fewer revision cycles → faster deployment.

---

### 74. Type Safety & Lint Cleanup
**What it does:** Fixed all ESLint errors in `ClientDashboard.tsx` (10 errors, 1 warning → 0). Replaced ~25 `unknown[]` type annotations across `useClientData.ts`, `src/api/analytics.ts`, `src/api/content.ts`, and `src/api/seo.ts` with proper typed interfaces. Added 8 new shared type exports (`ActivityLogItem`, `RankHistoryEntry`, `LatestRank`, `AnnotationItem`, `AnomalyItem`, `SearchDeviceBreakdown`, `SearchCountryBreakdown`, `SearchTypeBreakdown`). Fixed `setPricingData` type propagation through `loadDashboardData`, `setAuthMode`/`setClientUser` type mismatches, `Date.now()` purity violation, and Toast type incompatibility.

**Agency value:** Fewer runtime surprises, better autocomplete, faster onboarding for contributors.

**Client value:** Indirect — fewer bugs from type coercion errors.

**Mutual:** Healthier codebase → faster iteration on features.

---

### 75. React Query Migration — Phase 1 (Client Portal)
**What it does:** Replaced the monolithic `useClientData.ts` (312 lines, 32 `useState`, 6 `useCallback` fetch functions) with React Query-backed individual hooks composed via a backward-compatible facade. Created `src/hooks/client/useClientSearch.ts` (GSC overview, trend, comparison, devices), `src/hooks/client/useClientGA4.ts` (12 GA4 endpoints), and `src/hooks/client/useClientQueries.ts` (activity, ranks, annotations, anomalies, approvals, requests, content requests, audit, strategy, pricing, content plan). All data fetching now goes through `useQuery` with automatic caching (60s stale, 5min GC), stale-while-revalidate on tab focus, and per-query error states. WebSocket handlers now use `queryClient.invalidateQueries` instead of manual re-fetches. Date range changes trigger automatic refetch via query key changes. Return interface unchanged — `ClientDashboard.tsx` required only removal of `setAudit`/`AuditSummary` (now unused) and simplified `audit:complete` handler.

**Agency value:** Individual hooks are 15-25 lines each vs the previous 312-line monolith. New features no longer need to thread state through `useClientData`. WebSocket integration is one-liners. React Query DevTools available for debugging.

**Client value:** Stale-while-revalidate means instant tab switching with background refresh. Per-section loading instead of one spinner for 15+ endpoints.

**Mutual:** Foundation for Phases 2-4 (analytics, content, SEO tools) and future component-level hook imports.

---

### 76. React Query Migration — Phase 2 (Admin Analytics)
**What it does:** Migrated `GoogleAnalytics.tsx` (14 `useState`, 1 `useCallback`, 1 `useEffect`, 611 lines) and `SearchConsole.tsx` (9 `useState`, 1 `useEffect`, 610 lines) from manual `Promise.all` data fetching to React Query hooks. Created `src/hooks/admin/useAdminGA4.ts` (11 parallel queries) and `src/hooks/admin/useAdminSearch.ts` (6 parallel queries). Removed 23 `useState` declarations and all manual `loadData` functions. Removed 3 duplicate local interfaces from `SearchConsole.tsx` (already in shared types). Fixed `GA4PeriodComparison` type error in `GoogleAnalytics.tsx` (should have been `GA4Comparison`). Date range changes now trigger automatic refetch via query key changes instead of imperative `loadData` calls.

**Agency value:** Both components dropped ~50 lines of state management boilerplate. Admin analytics hooks are reusable across any admin view. Retry is built into React Query (1 automatic retry) instead of manual retry buttons.

**Client value:** Instant cached data when switching between admin tabs. Background refresh on window focus.

**Mutual:** Consistent React Query patterns across client portal and admin analytics.

---

### 77. React Query Migration — Phase 3 (Content Pipeline)
**What it does:** Migrated the three content pipeline components — `ContentBriefs.tsx`, `ContentManager.tsx`, and `PostEditor.tsx` — from manual `useState`/`useEffect` data fetching to React Query hooks. Created `src/hooks/admin/useAdminBriefs.ts` (2 hooks: briefs list, requests list) and `src/hooks/admin/useAdminPosts.ts` (4 hooks: posts list with auto-poll for generating status, single post with auto-poll, post versions, publish target check). `ContentBriefs.tsx` removed 4 data `useState` + `useEffect` initial load + `fetchPosts` callback; all 10 mutation handlers now use `queryClient.setQueryData`/`invalidateQueries`; `onRequestCountChange` derived automatically via `useEffect` on requests data. `ContentManager.tsx` removed 3 `useState` + `useEffect` + manual polling interval. `PostEditor.tsx` removed 4 `useState` + `useEffect` + manual `setInterval` polling; replaced with `refetchInterval` on the query.

**Agency value:** Content pipeline hooks are 15-25 lines each. Mutations instantly update the cache without waiting for refetch. `refetchInterval` replaces manual `setInterval` boilerplate. Shared query keys (`admin-posts`, `admin-briefs`, `admin-requests`) mean ContentBriefs and ContentManager automatically share cached data.

**Client value:** Faster perceived updates — optimistic cache writes mean the UI updates instantly after mutations. Stale-while-revalidate on tab focus keeps content lists fresh.

**Mutual:** Phases 1-3 now cover client portal, admin analytics, and content pipeline. Only Phase 4 (SEO tools + admin dashboards) remains.

---

### 78. React Query Migration — Phase 4 (SEO Tools + Admin Dashboards)
**What it does:** Migrated the five remaining SEO/admin components — `WorkspaceHome.tsx`, `WorkspaceOverview.tsx`, `SeoAudit.tsx`, `SchemaSuggester.tsx`, and `AssetBrowser.tsx` — from manual `useState`/`useEffect` data fetching to React Query hooks. Created 4 new hook files: `src/hooks/admin/useWorkspaceHome.ts` (1 aggregated query replacing 12 `useState`), `src/hooks/admin/useWorkspaceOverview.ts` (1 aggregated query replacing 6 `useState` + `Promise.all`), `src/hooks/admin/useAdminSeo.ts` (5 hooks: audit traffic map, audit suppressions, audit schedule, schema snapshot, webflow pages), `src/hooks/admin/useAdminAssets.ts` (2 hooks: webflow assets, asset audit). `WorkspaceHome.tsx` replaced 12 data `useState` + `useEffect` + `useCallback` refetch + manual refresh handler with single `useWorkspaceHomeData` hook; WebSocket events now invalidate the query instead of per-key manual refetches. `WorkspaceOverview.tsx` replaced 6 data `useState` + `Promise.all` `useEffect` with `useWorkspaceOverviewData`; feedback mutations use `queryClient.setQueryData` for instant UI updates; WebSocket presence uses state override pattern. `SeoAudit.tsx` replaced 3 `useEffect` fetches (traffic map, suppressions, schedule) with 3 React Query hooks; all suppression/schedule mutations use `queryClient.setQueryData`. `SchemaSuggester.tsx` replaced 2 `useEffect` fetches (schema snapshot, webflow pages) with React Query hooks. `AssetBrowser.tsx` replaced 2 `useEffect` fetches (assets, unused audit) with React Query hooks; all 8 mutation handlers use `queryClient.setQueryData` for optimistic updates; `loadAssets` replaced by `queryClient.invalidateQueries`.

**Agency value:** Completes the React Query migration across the entire platform. All 5 components now benefit from automatic caching, stale-while-revalidate, retry logic, and React Query DevTools. WorkspaceHome dropped from ~170 lines of state/fetch boilerplate to ~20 lines of derived data.

**Client value:** Instant cached data on tab switching. Background refresh on window focus keeps dashboards fresh. Reduced re-renders from optimistic cache updates.

**Mutual:** All 4 phases shipped. The entire frontend now uses React Query for data fetching — consistent patterns, shared caching, and zero manual `useEffect` fetch boilerplate.

---

### 80. React Query Migration - Simple Components Complete
**What it does:** Completes React Query migration for remaining simple components: AnomalyAlerts, ContentPipeline, and SeoEditor. Replaced manual `useEffect` + `useState` patterns with standardized `useQuery` hooks. Fixed type mismatches between hooks and actual API responses. Updated all mutation handlers to use `queryClient.invalidateQueries()` instead of manual refetch functions.

**Agency value:** 40% reduction in data fetching boilerplate across migrated components. Consistent error handling, retry logic, and caching patterns. React Query DevTools available for debugging data flow. No more manual `fetchPages()` functions scattered throughout components.

**Client value:** Instant tab switching with cached data. Automatic background refresh keeps data fresh. Better error recovery with built-in retry logic. Consistent loading states across all admin components.

**Mutual:** Standardized data fetching patterns across the platform. Simple migration pattern established for future components. Complex components (ContentCalendar, CmsEditor) identified for future migration phases.

---

### 79. App.tsx Shell — React Query + Component Extraction
**What it does:** Migrated the last remaining manual `useState`/`useEffect` data fetching in `App.tsx` Dashboard shell to React Query hooks. Created 3 new hooks: `useWorkspaces` (workspace list + create/delete/link/unlink mutations), `useHealthCheck` (server health status), `useQueue` (processing queue). `selected` workspace is now derived via `useMemo` from URL + query data instead of manual `useState` + sync effects. WebSocket handlers (`queue:update`, `workspace:created`, `workspace:deleted`) replaced from direct `setState` calls to `queryClient.invalidateQueries()`. Extracted `Sidebar` (~210 lines) and `Breadcrumbs` (~130 lines) into `src/components/layout/` — both use `useNavigate()` internally, eliminating callback prop threading. App.tsx Dashboard reduced from ~605 lines to ~300 lines. Removed dead `seoNavigate` function, `navGroups` array, `TAB_LABELS` map, `collapsedGroups` state, and manual initial data fetch. `WorkspaceSettings.onUpdate` now invalidates workspaces query instead of manually patching local state.

**Agency value:** App.tsx is now a thin orchestrator — all data fetching is in hooks, all layout in extracted components. Easier to reason about, modify, and debug. Consistent React Query patterns across the entire frontend.

**Client value:** No user-facing changes — this is a pure refactor. Same behavior, better maintainability.

**Mutual:** Zero manual `useState`/`useEffect` fetch boilerplate remains anywhere in the frontend. The React Query migration is fully complete — all data fetching uses `useQuery`/`useMutation` with shared cache, automatic retry, and stale-while-revalidate.

---

### 81. Composite Health Score Dashboard

**Status:** Shipped (PR 2 — Platform Health Sprint)
**What it does:** Surfaces the composite health score (0-100, weighted: 40% churn risk + 30% ROI trend + 30% engagement) in both admin and client views. Admin: health badge next to workspace name in WorkspaceHome. Client: prominent HealthScoreCard at top of OverviewTab with score, contextual message, and legend.
**Files:** `src/components/admin/WorkspaceHealthBadge.tsx`, `src/components/client/HealthScoreCard.tsx`, `src/components/WorkspaceHome.tsx` (wiring), `src/components/client/OverviewTab.tsx` (wiring), `shared/types/intelligence.ts` (ClientIntelligence), `server/routes/client-intelligence.ts` (endpoint)
**Agency value:** At-a-glance workspace health for admin triage. Client-facing "credit score for SEO" builds trust and urgency.
**Client value:** Clients see a single number representing their SEO health, with plain-language explanation of what it means.

---

### 82. Prediction Showcase Card (weCalledIt)

**Status:** Shipped (PR 2 — Platform Health Sprint)
**What it does:** Client-facing card that showcases predictions that came true — "We predicted X would happen, and it did." Shows top 5 strongest predictions with outcome text and confirmation date. Empty state encourages patience while building track record.
**Files:** `src/components/client/PredictionShowcaseCard.tsx`, `src/components/client/OverviewTab.tsx` (wiring), `shared/types/intelligence.ts` (ClientIntelligence.weCalledIt), `server/routes/client-intelligence.ts` (endpoint)
**Agency value:** Demonstrates strategy accuracy to clients, reducing churn and building trust.
**Client value:** Clients see concrete proof that recommendations are working — builds confidence in the agency relationship.

---

### 83. Cannibalization Warning Alerts

**Status:** Shipped (PR 2 — Platform Health Sprint)
**What it does:** Admin-facing alert in ContentPipeline that shows keyword cannibalization warnings — when multiple pages compete for the same keyword. Color-coded by severity (red/amber/blue), tier-gated (Growth+), shows affected keywords and competing page paths.
**Files:** `src/components/admin/CannibalizationAlert.tsx`, `src/components/ContentPipeline.tsx` (wiring)
**Agency value:** Proactive detection of keyword competition between client pages, enabling consolidation recommendations.

---

### 84. Audit Finding Auto-Resolution

**Status:** Shipped (PR 3 — Platform Health Sprint)
**What it does:** When an on-demand SEO audit re-runs, audit_finding insights that are no longer detected are automatically resolved. Mirrors the scheduled-audit auto-resolve pattern. Also triggers bridge-audit-page-health to refresh stale page health data after audit completion.
**Files:** `server/routes/webflow-seo.ts` (bridge triggers), `tests/integration/audit-insight-resolution.test.ts`
**Agency value:** Eliminates stale audit findings cluttering the insights feed. Health data stays current without manual intervention.

---

### 85. Anomaly Boost Reversal

**Status:** Shipped (PR 3 — Platform Health Sprint)
**What it does:** When anomalies are dismissed and no recent undismissed anomalies remain, the +10 score boosts applied to related insights are immediately reversed. Previously, boosts were only cleaned up on the next 12-hour periodic scan, causing score inflation.
**Files:** `server/anomaly-detection.ts` (reverseAnomalyBoostIfNoneRemain), `tests/integration/anomaly-boost-reversal.test.ts`
**Agency value:** Accurate insight scores — dismissing anomalies immediately restores correct priority ordering instead of leaving inflated scores until the next scan cycle.

---

### 86. Strategy Cards Volume Threshold

**Status:** Shipped (PR 3 — Platform Health Sprint)
**What it does:** Filters keyword strategy cards with monthly search volume below 10 from the rendering path. Pages without volume data (not yet enriched) pass through to avoid silently hiding unvalidated entries.
**Files:** `src/components/KeywordStrategy.tsx`
**Agency value:** Reduces noise in strategy views by hiding keywords with negligible search traffic.

---

### 87. PageHealthData Type Safety

**Status:** Shipped (PR 3 — Platform Health Sprint)
**What it does:** Replaced `as never` type escape hatch in reports.ts by adding audit-enrichment fields (auditSnapshotId, errorCount, warningCount, topIssues) as optional properties on the PageHealthData interface.
**Files:** `shared/types/analytics.ts`, `server/reports.ts`
**Agency value:** Type safety — eliminates the last `as never` cast in the codebase for this data shape.

---

## Future Additions

Items to revisit as budget/tier upgrades allow or when priorities shift.

### OpenAI Model Upgrades
- ~~All models upgraded to GPT-4.1 series~~: ✅ Shipped (March 10, 2026) — gpt-4o → gpt-4.1, gpt-4o-mini → gpt-4.1-mini across all endpoints (SEO rewrite, content briefs, content posts, schema, audit, anomaly detection, chat memory, strategy, keyword analysis, seo-copy, internal links). Alt text generation uses gpt-4.1-nano for cost savings on trivial tasks. Brand name context injected into all AI prompts that generate client-facing copy.
- ~~All SEO rewrites → Claude primary~~: ✅ Shipped (March 24, 2026) — `/api/webflow/seo-rewrite`, `/api/webflow/seo-bulk-fix`, and `/api/webflow/seo-bulk-rewrite` now use `callCreativeAI()` (Claude Sonnet primary, GPT-4.1 fallback) for richer, more natural title/meta description language.
- ~~Persistent bulk SEO suggestions with 3 variations~~: ✅ Shipped (March 24, 2026) — Bulk AI rewrite generates 3 differentiated variations per page, stored in SQLite (`seo_suggestions` table). Suggestions persist across refreshes. Users select preferred variation per page, then apply to Webflow in one action. Migration `023-seo-suggestions.sql`.

### Schema Generator Enhancements
- ~~Bulk publish~~: ✅ Shipped — Publish to Webflow per-page via Custom Code API.
- ~~Per-page generation~~: ✅ Shipped — Page picker lets you generate for a single page.
- ~~Persistence~~: ✅ Shipped — Incremental disk saves every 10s during generation.
- ~~Client review flow~~: ✅ Shipped — Send to Client creates an approval batch.
- ~~CMS template schemas~~: ✅ Shipped — Dynamic schemas for collection pages using Webflow `{{wf}}` template syntax.
- ~~Prompt tightening~~: ✅ Shipped — No empty arrays/objects, consistent `@id`, omit empty properties.
- ~~Schema diff view~~: ✅ Shipped — Side-by-side comparison of existing vs. suggested JSON-LD with toggle button. Shows full existing schema JSON extracted from published HTML.
- ~~Bulk publish all~~: ✅ Shipped — One-click "Publish All" button with sequential publishing and live progress counter.
- ~~Site template system~~: ✅ Shipped (March 2026) — "Save as Site Template" button on homepage. Organization + WebSite nodes saved to SQLite and reused as consistent stubs (with logo) on all subpages. Auto-seeds from homepage snapshot. Auto-saves when homepage schema is published.
- ~~Content verification v2~~: ✅ Shipped (March 2026) — Structural FAQ detection (requires FAQ heading, accordion markup, or FAQ CSS classes — rejects section headings like "What's under the hood?"). Hallucinated FAQPage nodes auto-stripped. Individual questions verified against page text.
- ~~Schema edit persistence~~: ✅ Shipped (March 2026) — Edited schemas persist to SQLite snapshot on publish via `updatePageSchemaInSnapshot()`. No longer lost on reload.
- ~~Post-processing hardening~~: ✅ Shipped (March 2026) — Auto-dedup Organization nodes (removes `/#organization-stub` duplicates). Auto-normalize Service/SoftwareApplication `@id` to canonical product URL. Auto-inject `url` on Service from WebPage. Auto-trim breadcrumb names (strip brand suffixes, cap ~50 chars). 37 prompt rules including lead-gen page detection, consistent `@id` across pages, description length guidance.
- ~~Site-aware schema plan~~: ✅ Shipped (March 2026) — AI-driven site-wide schema plan that analyzes all pages + keyword strategy to assign page roles (homepage, pillar, audience, lead-gen, blog, etc.) and identify canonical entities with consistent `@id` references. Plan stored in SQLite, injected as context into per-page AI prompts, and enforced by post-processing validation (strips unwanted entity types from lead-gen/audience pages). Admin SchemaPlanPanel with role dropdowns, entity registry, and "Send to Client" approval flow. Client receives plain-English "Schema Strategy Preview" via existing approval batches.
- **Auto-schedule**: Re-generate schemas on a cadence (e.g., weekly) and flag pages where content changed but schema is stale.

### Redirect Manager Enhancements
- ~~GSC ghost URL detection~~: ✅ Shipped — Identifies old/renamed pages Google still indexes but no longer exist on site.
- **Webflow Enterprise API**: The 301 Redirects API is Enterprise-only. If/when Enterprise access is available, push accepted rules directly via API instead of CSV export.
- **Historical comparison**: Track redirect status over time — detect new 404s since last scan.
- **Google Search Console 404 import**: Pull crawl errors from GSC to seed the redirect scanner with known broken URLs.

### Site Audit Enhancements
- ~~Redirect + CWV integration~~: ✅ Shipped — Redirect chains and homepage Core Web Vitals wired into audit. Now runs mobile + desktop in parallel, leads with CrUX field-data pass/fail (actual ranking signal), Lighthouse lab score shown as secondary diagnostic.
- ~~Contextual cross-link tips~~: ✅ Shipped — Audit results suggest SEO Editor, Redirects, Schema, Performance based on findings.
- ~~Auto-restore after deploys~~: ✅ Shipped — Admin SeoAudit loads latest persisted snapshot from disk on mount when no in-memory job exists. No data loss between deploys.
- ~~Error-sorted page list~~: ✅ Shipped — Pages sorted by error count descending so critical pages surface first.
- ~~Flag for Client~~: ✅ Shipped — Send specific audit issues to client request queue with inline note for review/discussion.
- ~~Fix→ routing~~: ✅ Shipped — Each issue maps to the appropriate tool (Schema, SEO Editor, Briefs, Redirects, Performance) with a one-click Fix button.
- ~~Auto-fix context~~: ✅ Shipped — Fix→ passes page context to target tools: Schema auto-generates, SEO Editor auto-expands, Briefs pre-fill keyword.
- ~~Traffic intelligence~~: ✅ Shipped — `/api/audit-traffic/:siteId` cross-references GSC clicks/impressions and GA4 pageviews/sessions per page. Traffic badges on page cards. Sort by traffic impact toggle.
- ~~Auto dead link scan~~: ✅ Shipped — Dead link scan runs automatically with every site audit (opt-out checkbox). Results appear as a "Broken Links" stat card in the audit header and a detailed panel with per-link actions: "Fix in SEO Editor" (internal links), inline redirect form, and CSV export.
- **Full-site PageSpeed**: Offer a deeper multi-page PSI scan as a separate background job.
- **Accessibility audit expansion**: Currently only checks img alt text. Could add WCAG contrast, ARIA, heading order, form label checks.
- **Historical trend charts**: Track audit score over time per-page, not just site-wide.

### Background Job System
- ~~WebSocket progress~~: ✅ Shipped — Real-time progress via WebSocket for all background jobs.
- ~~Job cancellation~~: ✅ Shipped — Stop mid-generation, keep partial results.
- ~~Incremental persistence~~: ✅ Shipped — Schema and redirect results save to disk during generation.
- **Concurrent job limits**: Prevent multiple audits from running simultaneously on the same site.

### Client Dashboard
- ~~Interactive inline charts~~: ✅ Shipped — Hover-to-inspect detail popovers on all charts (upgraded from click to hover).
- ~~PDF export~~: ✅ Shipped — Professional PDF with TOC, page breaks, section numbers.
- ~~Custom date range picker~~: ✅ Shipped — Preset buttons (7d/28d/90d/6mo/1y) + Custom calendar popover with start/end date inputs. Backend: all GSC + GA4 routes accept `startDate`/`endDate` query params via `CustomDateRange` type.
- ~~White-label email templates~~: ✅ Shipped — Light-mode branded HTML email templates with batched digest system. 7 event types, 5-min sliding window, disk-persisted queue.
- ~~Simplified search snapshot~~: ✅ Shipped — SearchSnapshot component on Overview tab: traffic trend, top pages (plain language), device split with comparison badges and sparklines.
- ~~Simplified analytics snapshot~~: ✅ Shipped — AnalyticsSnapshot + OrganicInsight components: GA4 organic overview, landing pages, new vs returning, period comparison.
- ~~Monthly report traffic trends~~: ✅ Shipped — `gatherMonthlyData` fetches GSC/GA4 period comparison; `renderMonthlyReport` renders traffic trends grid with arrows + % change in email template.
- ~~Monthly report chat topics~~: ✅ Shipped — `gatherMonthlyData` fetches recent client chat session summaries; "Topics You Asked About" section in email template.
- ~~Client chat comparison data~~: ✅ Shipped — `askAi` now sends searchComparison, ga4Comparison, ga4Organic, ga4NewVsReturning to AI; server prompt lists them as data sources.
- ~~Admin chat conversation memory~~: ✅ Shipped — Full parity with client chat: sessionId, addMessage, buildConversationContext, history UI, auto-summarize.
- ~~Chat activity logging~~: ✅ Shipped — First exchange of each new chat session logged to activity log (`chat_session` type) for both client and admin endpoints.
- ~~Audit traffic in chatbot~~: ✅ Shipped — `getAuditTrafficForWorkspace` cached helper injects high-traffic pages with SEO errors into both chat system prompts.
- ~~Strategy: conversion + audit data~~: ✅ Shipped — GA4 conversions + events by page + audit high-traffic error pages injected into strategy master prompt with money-page protection rules.
- ~~Client onboarding welcome~~: ✅ Shipped — First-visit modal with tier badge, trial countdown, feature grid, and quick-action CTAs.
- ~~In-portal plans page~~: ✅ Shipped — Plans tab with tier comparison cards, content pricing, bundle cards, upgrade CTAs.
- ~~14-day Growth trial~~: ✅ Shipped — Auto-provisioned trial for new workspaces, daily expiry check, trial badges across UI.
- ~~Content opportunity card redesign~~: ✅ Shipped — Removed priority badges, single CTA (Get a Brief), auto-recommended page type from strategy data, keyword shown only when different from topic.
- ~~Payment modal simplification~~: ✅ Shipped — Removed page type selector, "What's included" list, and bundle savings callout. Focused on Topic → Price → Pay.
- ~~Plans page color unification~~: ✅ Shipped — All violet/blue tier highlights replaced with teal. Bundle cards hidden pre-launch.
- ~~Full UI/UX color audit~~: ✅ Shipped — Violet→teal across all page type badges, welcome modal, avatar gradient, content form, review banners, upgrade CTAs, and payment modal. Blue reserved for data metrics only.
- ~~Brand design language doc~~: ✅ Shipped — Created `BRAND_DESIGN_LANGUAGE.md` with brand identity, color rules, product design principles, component guidelines.
- ~~Tab-level component extraction~~: ✅ Shipped — ClientDashboard.tsx broken from 3,265→1,536 lines. All 8 tabs extracted into `src/components/client/` (OverviewTab, SearchTab, AnalyticsTab, StrategyTab, ContentTab, ApprovalsTab, RequestsTab, PlansTab).
- ~~Unified Inbox tab~~: ✅ Shipped — Merged Approvals + Requests + Content into single InboxTab with type filters (All / SEO Changes / Requests / Content). Unified badge count.
- ~~Slim Overview tab~~: ✅ Shipped — Removed redundant site health card and InsightsEngine from Overview sidebar. Cleaner focus: metrics + monthly summary + insights digest + activity.
- **Content brief: GA4 page performance** — Inject GA4 landing page performance (bounce rate, sessions, engagement) into brief generation for existing-page content refreshes.
- **Self-service tier upgrade via Stripe** — Replace mailto upgrade CTAs with Stripe Checkout subscription flows for tier changes.
- ~~Suppression-aware health scores~~: ✅ Shipped — applySuppressionsToAudit() filters suppressed issues and recalculates scores. Wired into all 6 data exit points (audit-summary, audit-detail, reports/latest, admin/client/strategy chat contexts). Suppressed issues excluded from all scores, issue lists, and AI recommendations.
- ~~SEO edit tracking (teal=live, purple=in-review, yellow=flagged)~~: ✅ Shipped — seoEditTracking on Workspace model with trackSeoEdit() helper. Auto-wired into SEO save→live, CMS save→live, approval→in-review, audit→flagged. Colored borders + badge pills in SeoEditor, CmsEditor, and SeoAudit page cards. Optimistic local state updates.
- ~~Hide non-sitemap collection pages~~: ✅ Shipped — Server fetches sitemap.xml, filters collection items to sitemap matches (falls back to all). Frontend shows full path with parent collection slug (e.g., /locations/houston-midtown).
- ~~Real-time data updates~~: ✅ Shipped — WebSocket workspace subscriptions with `broadcastToWorkspace()`. Events: activity:new, approval:update, request:created, content-request:update, audit:complete. `useWorkspaceEvents` hook on frontend.
- ~~Broadcast → React Query invalidation centralization~~: ✅ Shipped 2026-04-21 (#597) — Single `useWsInvalidation` hook (mounted once in App.tsx) handles 43 workspace-scoped WS events with matching React Query cache invalidations. Added 7 events (STRATEGY_UPDATED, BRANDSCRIPT_UPDATED, DISCOVERY_UPDATED, VOICE_PROFILE_UPDATED, BRAND_IDENTITY_UPDATED, BLUEPRINT_UPDATED, BLUEPRINT_GENERATED) and removed duplicate inline subscriptions from 10 components. Two-layer regression guard: pr-check rule blocks inline-handler drift (auto-syncs allowlist from `useWsInvalidation.ts`, escape hatch `// ws-invalidation-ok`); contract test `tests/contract/ws-invalidation-coverage.test.ts` blocks absence-of-handler drift when new WS_EVENTS entries are added.
- ~~Unified Performance tab~~: ✅ Shipped — `PerformanceTab.tsx` merges Search + Analytics into single tab with sub-tabs. Backward-compatible URL params. See Feature #74.

### Content Pipeline
- ~~Service tiers~~: ✅ Shipped — Brief vs. Full Post with configurable pricing.
- ~~E-E-A-T guidelines~~: ✅ Shipped — Content briefs include E-E-A-T, content checklists, schema recs.
- ~~Inline brief editing~~: ✅ Shipped — All key fields editable in-place with auto-save (title, meta, summary, outline, audience, tone, CTAs, word count, intent, format, competitor insights).
- ~~SEMRush brief enrichment~~: ✅ Shipped — Real keyword volume, difficulty, CPC, competition, trend, and related keywords feed into AI prompt when SEMRush is configured.
- ~~SEMRush graceful error handling~~: ✅ Shipped (March 10, 2026) — `getRelatedKeywords` and `getDomainOrganic` return empty arrays instead of throwing on "NOTHING FOUND". Prevents brief generation failures for obscure keywords.
- ~~GSC query filtering fix~~: ✅ Shipped — Related queries now match any keyword word (len > 2) instead of only the first word.
- ~~Page-type briefs~~: ✅ Shipped — 7 page types (blog, landing, service, location, product, pillar, resource) with type-specific AI prompt instructions for word count, structure, schema, CTAs, outline.
- ~~Inline price visibility~~: ✅ Shipped — Brief/post prices on request buttons, bundle savings callouts, prices from Stripe config.
- ~~Page type → content gap mapping~~: ✅ Shipped — Strategy AI recommends `suggestedPageType` per content gap; pre-fills page type in pricing modal.
- ~~AI blog post generator~~: ✅ Shipped (March 10, 2026) — Full post generation from briefs with page-type-specific writer roles, section-by-section generation, and post-generation unification pass for cohesion. See Feature #60.
- ~~Admin Content Manager~~: ✅ Shipped (March 10, 2026) — Dedicated "Content" tab in admin sidebar for reviewing/managing all generated posts with status workflow, search/sort, and inline editing. See Feature #61.
- ~~Content quality engine v5~~: ✅ Shipped (March 10, 2026) — Anti-cliché guardrails (forbidden phrases, structural anti-patterns, fabrication rules), H3 subheadings in brief outlines + post sections, full sitemap for internal link suggestions via `getAllSitePages`, liveDomain URL correction, anchor text accuracy rules, case study anonymity, FAQ formatting, industry diversity, brand mention limits.
- **Content calendar**: Visual calendar view of content in production with due dates.
- **Writer assignment**: Assign content pieces to specific writers with notifications.
- **Content delivery**: Attach deliverables (Google Doc links, uploaded files) to completed requests.
- ~~Knowledge base auto-generation~~: ✅ Shipped (March 10, 2026) — One-click website crawl extracts structured business knowledge (services, audience, differentiators, case studies, brand voice, expertise) from up to 15 priority pages. See Feature #62.
- ~~Claude/GPT hybrid model~~: ✅ Shipped (March 10, 2026) — Claude (claude-sonnet-4-20250514) for creative prose (intro/sections/conclusion), GPT-4.1 for structured tasks (unification, SEO meta, briefs). Auto-fallback to GPT if no Anthropic key.
- ~~AI context enrichment audit~~: ✅ Shipped (March 11, 2026) — Full audit of all AI-powered features for context completeness. Fixes: (1) Content briefs now persist real SERP data (PAA questions + top results) instead of losing them after generation. (2) Keyword strategy master synthesis now receives knowledge base for better content gap alignment with business services. (3) Client chat now receives structured SEO context (keyword strategy + brand voice + keyword map) matching admin chat quality. (4) Internal link analyzer now receives knowledge base for better anchor text and link priority suggestions.
- **Knowledge base enrichment**: Feed real case study metrics (traffic increases, conversion data, timelines) into the knowledge base so AI can reference actual numbers instead of vague outcomes.
- **Brand voice training**: Allow uploading 3-5 sample blog posts as style examples so the AI can match the client's actual writing voice, not just a generic "conversational" tone.
- **Content visual suggestions**: Generate image/diagram/table placement suggestions in the brief outline (e.g., "insert comparison table here", "add screenshot of Webflow CMS setup") to break up text walls.

### Design & Accessibility
- ~~Unified zinc/teal palette~~: ✅ Shipped — All CSS variables replaced with Tailwind utility classes.
- ~~Accessibility pass~~: ✅ Shipped — Minimum 11px font sizes, improved contrast, aria-labels on icon-only buttons.
- ~~Activity log wiring~~: ✅ Shipped — All major operations now logged automatically.
- ~~Light mode WCAG overrides~~: ✅ Shipped — Full accent color, gradient, border, and text overrides for WCAG AA compliance in light mode across all tabs including SEO Strategy.
- ~~Component Styleguide~~: ✅ Shipped — `/styleguide` route with all UI primitives, charts, tables, modals, toasts, forms, loading states, progress bars, and sidebar nav.
- ~~Selective type size bump~~: ✅ Shipped — `text-[11px]`/`text-xs` → 13.5px, `text-sm` → 15.5px.
- ~~Heading contrast~~: ✅ Shipped — SectionCard and PageHeader titles punched up.
- ~~Skeleton/shimmer loading states~~: ✅ Shipped (March 2026) — `Skeleton.tsx` UI primitive with shimmer animation. Applied to client dashboard data loading across tabs. See Feature #83.
- ~~Centralized number formatting~~: ✅ Shipped (March 2026) — Duplicate number formatting utilities consolidated into shared helpers. Eliminates inconsistent formatting across components.
- ~~Mobile date picker~~: ✅ Shipped (March 2026) — Date picker popover made mobile-friendly with responsive positioning.
- ~~Chat/FeedbackWidget mobile overlap fix~~: ✅ Shipped (March 2026) — Fixed z-index and positioning conflict between floating chat button and feedback widget on small screens.
- ~~Frontend component decomposition~~: ✅ Shipped (March 2026) — 7 monolithic components decomposed into focused sub-modules (SeoAudit, ContentBriefs, SchemaSuggester, KeywordStrategy, AssetBrowser, WorkspaceSettings, WorkspaceHome). See Feature #83.
- ~~Server route decomposition (webflow.ts)~~: ✅ Shipped (March 2026) — `webflow.ts` route split into 6 focused sub-routes. `seo-audit.ts` decomposed into `audit-page.ts` + `seo-audit-html.ts`. See Feature #63.
- **WCAG AA compliance**: Full contrast ratio audit, focus indicators, keyboard navigation for all interactive elements.
- **Responsive mobile layout**: Sidebar collapses to bottom nav, cards stack vertically on small screens.

### Performance & Bundle Size
- ~~Code-splitting~~: ✅ Shipped — All routes and tabs lazy-loaded via `React.lazy()` + `Suspense`. Initial bundle: 929KB → 256KB (72% reduction). 25+ separate chunks for route-level, admin tab, and sub-tool splitting.
- ~~Route-based splitting~~: ✅ Shipped — `/styleguide`, `/client/:id`, and all admin tabs are separate lazy chunks.
- **Heavy dependency audit**: Identify if any large libraries (chart libs, PDF generators) can be loaded on-demand.
- **Tree-shaking**: Verify Lucide icons are tree-shaken (only used icons in bundle, not the full set).

### Competitive Intelligence (Roadmap #199)
- ~~Standalone Competitors tab~~: ✅ Removed from sidebar (March 2026) — component retained. Will be replaced by Competitive Intelligence Hub in Strategy tab.
- **Phase 1: Keyword gap analysis** — Wire SEMRush `getKeywordGap()` into Strategy tab. Show competitor keywords, optimization targets, advantages.
- **Phase 2: Content gap analysis** — Compare sitemaps, AI-categorize missing topics, generate brief suggestions.
- **Phase 3: Competitive monitoring** — Monthly automated competitor audits, historical tracking, anomaly alerts.
- **Phase 4: SERP overlap dashboard** — Head-to-head keyword positions, win/loss tracking over time.

### Admin Navigation
- ~~Sidebar restructure~~: ✅ Shipped (March 2026) — Reorganized from 4 groups/18 items to 4 groups/14 items. New structure: ANALYTICS (Search Console, GA, Rank Tracker, Annotations), SITE HEALTH (Site Audit, Performance, Links, Assets), SEO (Brand & AI, Strategy, Editor, Schema), CONTENT (Content Briefs, Content, Content Perf).
- ~~Analytics Hub merge~~: ✅ Shipped (March 2026) — Search Console + Google Analytics merged into single "Analytics" sidebar item with hub + detail architecture (AnalyticsHub.tsx). ANALYTICS group now: Analytics, Rank Tracker. Annotations integrated into hub overview.
- ~~Merged Links tab~~: ✅ Shipped (March 2026) — Redirects + Internal Links merged into single Links tab (`LinksPanel.tsx`) with sub-tab navigation.
- ~~Header request widget~~: ✅ Shipped (March 2026) — Requests moved from sidebar to header bar as badge widget with pending count indicator. NotificationBell also moved to header.
- ~~Command palette sync~~: ✅ Shipped (March 2026) — CommandPalette.tsx updated to match new sidebar structure. Analytics Hub update (March 2026).
- ~~Sidebar colored group icons~~: ✅ Shipped (March 2026) — Activity (blue) for ANALYTICS, Shield (emerald) for SITE HEALTH, Zap (teal) for SEO, BookOpen (amber) for CONTENT. Hover opacity transition.

### Roadmap & Project Management
- ~~Shipping velocity chart~~: ✅ Shipped (March 2026) — Pure SVG area chart in Roadmap.tsx showing cumulative features shipped per month. Teal gradient fill, per-month count labels, month axis.
- ~~Sprint restructure~~: ✅ Shipped (March 2026) — Reorganized from 3 active sprints + 1 backlog to 7 themed sprints: B (Client Impact & Retention), C (Content Pipeline Completion), D (Self-Service & Distribution), E (Admin Polish & DX), F (SEO Intelligence Expansion), G (Team & Collaboration), + trimmed Backlog. Added 4 new roadmap items (#201-204).

### Sales Report Enhancements
- **Branded PDF export**: Generate prospect reports as downloadable PDFs with agency branding.
- **Email delivery**: Send prospect reports directly to leads from the platform.
- **CRM integration**: Push prospect data to HubSpot/Pipedrive when a report is generated.

---

## Cascade Update Prompt

When the user asks to update this document with recent features, follow this process:

1. **Check git log**: `git log --oneline -30` to see recent commits since the last FEATURE_AUDIT update.
2. **Identify new features**: Look for `feat:` commits that introduce entirely new tools or capabilities not yet documented above.
3. **Identify enhancements**: Look for commits that significantly expand existing features (new modes, integrations, UI overhauls).
4. **For each new feature**: Add a numbered entry (continuing from the current last number) with the standard format: What it does / Agency value / Client value / Mutual.
5. **For each enhancement**: Update the existing feature's "What it does" paragraph to reflect the new capability.
6. **Update Future Additions**: Mark any shipped items with ~~strikethrough~~: ✅ Shipped — [description]. Add new future items if the work suggests obvious next steps.
7. **Update Summary table**: Adjust category counts and total feature count.
8. **Commit**: `git add FEATURE_AUDIT.md && git commit -m "docs: update FEATURE_AUDIT with recent features"`
9. **Update data/features.json**: If any new/updated features are sales-relevant, add or update their entry in features.json (title, oneLiner, category, painPoints, tier, impact).

### 68. Brand & AI Hub (BrandHub)
**What it does:** Dedicated "Brand & AI" tab in the admin sidebar (SEO group) consolidating all AI content generation inputs into a single screen. `BrandHub.tsx` houses three sections previously scattered across KeywordStrategy (Brand Voice) and WorkspaceSettings (Knowledge Base, Audience Personas). Each section retains full functionality: inline editing, auto-save on blur, "Generate from Website" one-click AI generation, and unsaved-changes indicators. PageHeader with Sparkles icon and explanatory subtitle. Info footer explains how the three sources feed into all AI outputs. Brand Voice moved from collapsible panel in Strategy → dedicated section with violet accent. Knowledge Base moved from Features tab in Settings → dedicated section with teal accent. Personas moved from Features tab in Settings → dedicated section with blue accent. Registered as `brand` tab in App.tsx, lazy-loaded, receives `workspaceId` and `webflowSiteId` props.

**Agency value:** All AI context inputs in one place instead of hunting across Strategy and Settings tabs. Faster client onboarding — open one tab, click three "Generate from Website" buttons, review, done.

**Client value:** N/A — admin-only tool. Indirectly improves all AI-generated content quality by making it easier for the agency to maintain complete, up-to-date context.

**Mutual:** Reduces the friction of maintaining AI context, which means it actually gets maintained. Better context → better AI outputs → fewer revision cycles.

### 69. Storage Monitor & Pruning Tools
**What it does:** `server/storage-stats.ts` scans all 25+ data directories (chat sessions, backups, reports, uploads, optimized images, etc.) and returns a per-category size breakdown via `GET /api/admin/storage-stats`. Three POST pruning endpoints: `/prune-chat` (delete sessions >90 days), `/prune-backups` (reduce retention to 3 days), `/prune-activity` (trim log entries >6 months). Storage Monitor UI panel in Settings: colored stacked bar chart showing top-6 categories, per-row breakdown with file count/size/percentage, quick stats (chat session count, backup retention, oldest chat), and one-click prune buttons with loading states and toast feedback.

**Agency value:** Visibility into what's consuming disk on Render persistent storage. One-click cleanup when approaching limits instead of manual SSH. Prevents surprise downtime from full disk.

**Client value:** N/A — admin-only infrastructure tool.

**Mutual:** Platform stability. Proactive monitoring prevents data loss from disk exhaustion.

---

### 70. Recharts Migration
**What it does:** Migrated all custom hand-rolled SVG charts across both admin and client dashboards to the **Recharts** library. Replaces bespoke `<svg>` sparklines, area charts, dual-trend charts, and bar charts with `ResponsiveContainer`, `LineChart`, `AreaChart`, `BarChart`, `XAxis`, `YAxis`, `Tooltip`, and `CartesianGrid` components. Covers: traffic trends, search performance, GA4 metrics, rank tracking history, content performance, anomaly charts, and the roadmap velocity chart. All charts retain hover tooltips and responsive sizing.

**Agency value:** Maintainable chart code — adding a new chart takes minutes instead of hours of SVG math. Recharts handles responsive sizing, axis formatting, and tooltip positioning automatically.

**Client value:** Smoother, more polished chart interactions with consistent tooltip behavior across every tab.

**Mutual:** Eliminates an entire class of chart rendering bugs. New data visualizations can be added rapidly as the platform grows.

---

### 71. AI Usage Dashboard
**What it does:** Admin-facing AI usage monitoring panel in the Command Center. `GET /api/ai/usage` returns per-feature token consumption with timestamps, model used, and estimated cost. Dashboard shows: total tokens consumed, estimated cost, per-feature breakdown (briefs, posts, chat, schema, strategy, etc.), and SEMRush credit usage tracking. Filterable by workspace and date range. **Data reads from disk files** (JSON per day in `ai-usage/` and `semrush-usage/` directories) — no in-memory truncation, so all historical data survives restarts and deploys.

**Agency value:** Cost visibility for AI operations. Know exactly which features and which clients consume the most tokens. SEMRush credit tracking prevents unexpected overage charges.

**Client value:** N/A — admin-only tool.

**Mutual:** Data-driven decisions about AI feature usage and tier pricing. Prevents surprise API bills.

---

### 72. Content Performance Tracking
**What it does:** `ContentPerformance.tsx` — dedicated admin tab that tracks the real-world performance of published content pieces. Cross-references content requests and generated posts with GSC metrics (clicks, impressions, CTR, position) and GA4 metrics (sessions, users, bounce rate, engagement time, conversions) for the target page. Recharts line charts show performance trends over time. Expandable per-content cards with status badges, target keyword, page type, and publication date.

**Agency value:** Proves content ROI with real data — "that blog post we wrote generated 340 clicks and 12 conversions this month." Identifies which content types and topics perform best for each client.

**Client value:** N/A — admin-only (clients see content status in their portal's Content tab).

**Mutual:** Closes the feedback loop from content strategy → brief → post → published → measured impact. Informs future content priorities.

---

### 73. Admin UX Overhaul
**What it does:** Comprehensive admin dashboard UX improvements shipped as Sprint G. **Collapsible sidebar navigation** — accordion groups with `localStorage` persistence for collapse state. **Command palette (⌘K)** — `CommandPalette.tsx` with fuzzy search across all tools, workspaces, and actions; full keyboard navigation (↑↓ to navigate, Enter to select, Esc to close). **Notification bell** — `NotificationBell.tsx` in sidebar utility bar, polls every 5 minutes for pending approvals, new requests, and attention items; badge count on bell icon. **Workspace quick-switch breadcrumb** — breadcrumb bar with dropdown for fast workspace switching without returning to Command Center. **User presence tracking** — WebSocket identify/heartbeat protocol, `GET /api/presence` endpoint, green dots + user names on workspace cards in Command Center. **Client overview declutter** — removed redundant AnomalyAlerts, AI Hero Insight, and MonthlySummary from overview; InsightsDigest is now the single source of AI insight.

**Agency value:** Dramatically faster admin navigation — ⌘K gets you anywhere in 2 keystrokes, collapsible sidebar reduces visual noise, presence dots show who's working on what.

**Client value:** N/A — admin-only improvements.

**Mutual:** Reduces the cognitive load of managing 10+ client workspaces. Every UX improvement compounds across hundreds of daily admin interactions.

---

### 74. Merged Client Performance Tab
**What it does:** `PerformanceTab.tsx` merges the previously separate Search and Analytics client tabs into a single unified "Performance" tab with internal sub-tabs (Search / Analytics). Backward-compatible URL params (`?tab=search` and `?tab=analytics` redirect to `?tab=performance`). All `setTab` references updated across InsightsDigest, OnboardingWizard, and overview action banners.

**Agency value:** Cleaner client navigation — complementary Google data lives in one place instead of two separate tabs.

**Client value:** One tab for all performance data instead of switching between Search and Analytics. Easier to understand the full traffic picture.

**Mutual:** Reduces tab count without losing any data. The sub-tab pattern can be reused for future consolidations.

---

### 75. Beta Client Dashboard Mode
**What it does:** `/client/beta/:workspaceId` route with `betaMode` prop. `BetaContext.tsx` + `useBetaMode()` hook provide a feature flag system that hides monetization features for beta testers. **Hidden in beta:** Plans tab, ROI tab, trial badges/banners, upgrade/pricing/Stripe modals, SeoCart, chat usage limits, purchase buttons on fix recommendations and content opportunities. **Override:** `effectiveTier` forced to `premium` so beta users see all features. **AI guardrails:** `betaMode` flag passed to `/api/public/search-chat` — conditional system prompt swaps revenue hooks for beta rules (never mention purchasing/pricing/plans, frame content gaps as topics not products, collaborative tone with hmpsn studio). Chat rate limiting skipped in beta.

**Agency value:** Ship the full platform experience to beta clients without exposing unfinished payment flows or confusing trial messaging. Single codebase — no duplication.

**Client value:** Beta clients get the premium experience with no purchase pressure. AI chatbot gives collaborative, non-salesy recommendations.

**Mutual:** Clean beta testing without monetization friction. Easy to flip off when transitioning beta clients to paid plans.

---

### 76. Client Onboarding Questionnaire
**What it does:** `ClientOnboardingQuestionnaire.tsx` — structured intake form that appears during client onboarding. Collects business information, goals, target audience, competitive landscape, and content preferences in a guided multi-step flow. Responses feed into workspace configuration and AI context for better-tailored outputs from day one.

**Agency value:** Structured client intake replaces ad-hoc email conversations. Responses automatically enrich the workspace's AI context (knowledge base, brand voice inputs).

**Client value:** Clear, professional onboarding experience. Their answers directly improve the quality of AI-generated content and recommendations.

**Mutual:** Faster onboarding with richer AI context from the start. Reduces the "garbage in, garbage out" problem with AI features.

---

### 77. Landing Page
**What it does:** `LandingPage.tsx` — GTM-driven lead generation page for the hmpsn.studio platform. Public-facing marketing page with: hero section, feature highlights with icons, pricing section, social proof, and CTA buttons. Fully styled in the brand design language (dark theme, teal CTAs, zinc cards). NavBar with logo and "Start Free" button. Responsive layout.

**Agency value:** A professional public-facing page to drive signups and demonstrate platform capabilities without requiring a demo call.

**Client value:** N/A — pre-signup marketing page.

**Mutual:** Passive lead generation. The landing page sells the platform 24/7.

---

### 78. Mobile Guard
**What it does:** `MobileGuard.tsx` — dismissible interstitial shown on small screens (<768px) recommending the desktop experience. Stores dismissal in `sessionStorage` so it only appears once per session. Shows a monitor icon, explanation text, and a dismiss button. Re-checks on window resize.

**Agency value:** Sets expectations — the dashboard is designed for desktop workflows. Prevents support tickets about mobile layout issues.

**Client value:** Clear guidance instead of a broken mobile experience. Can still dismiss and proceed if needed.

**Mutual:** Honest UX — better to acknowledge the limitation than pretend it doesn't exist.

---

### 79. SEO Glossary
**What it does:** `SeoGlossary.tsx` — contextual SEO terminology reference embedded in the client dashboard. Provides plain-language definitions for SEO terms that appear throughout the platform (impressions, CTR, position, bounce rate, etc.). Accessible from the Strategy tab and other data-heavy views.

**Agency value:** Reduces "what does this mean?" support questions. Clients educate themselves in-context.

**Client value:** No more Googling SEO jargon. Every metric on the dashboard has an accessible explanation.

**Mutual:** Empowered clients make better decisions and ask smarter questions. Reduces the knowledge gap between agency and client.

---

### 80. AEO — Answer Engine Optimization
**What it does:** Comprehensive Answer Engine Optimization system shipped as Sprint H, driven by beta client feedback. Three feature groups:

**Agency value:** Improves platform functionality and team efficiency.

**Client value:** Better platform experience.

**Mutual:** Compound improvements across the platform.


### 1. AEO Trust Audit (8 new checks in `seo-audit.ts`):** Per-page checks for author/reviewer attribution (meta tag, Person schema, byline classes, "reviewed by" patterns), last-updated date detection (dateModified schema, visible date text, `<time>` elements), answer-first content structure (flags generic intros after H1 — "Welcome to…", "Are you looking for…"), FAQ content without FAQPage schema, hidden content behind accordions/tabs/collapsed sections (>500 chars behind display:none/aria-hidden), citation/reference density (two-tier: zero external citations AND links without authority domains like .gov/.edu/pubmed/ADA/NIH), dark pattern detection (autoplay media, aggressive modal overlays). Site-wide check for missing trust pages (/about, /contact) with healthcare recommendations (/editorial-policy, /corrections, /medical-review-board).

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 2. Schema Suggester Expansion (`schema-suggester.ts`):** Healthcare schema types (MedicalBusiness, Dentist, Physician, MedicalProcedure with procedureType/howPerformed/preparation/followup), HowTo for procedural content, Dataset schema for data-heavy pages, author + reviewedBy Person with credentials on all Article/BlogPosting schemas, sameAs entity linking on Organization (Google Business, LinkedIn, Yelp, association profiles — only from actual page content, never fabricated). **Knowledge Base integration:** `buildSchemaContext()` in `helpers.ts` now reads workspace `knowledgeBase` field + `knowledge-docs/` folder files (truncated to 4000 chars) and injects into the schema AI prompt as BUSINESS KNOWLEDGE BASE. Schema AI can now use staff credentials, locations, social profiles, and association memberships from the KB to enrich Organization, Physician, LocalBusiness, and sameAs schemas — without needing that data on every page's HTML.

**Agency value:** Better structured data quality with less manual effort. Automated processes reduce schema deployment time.

**Client value:** Richer search result appearances and better Google understanding of site structure.

**Mutual:** Higher-quality structured data drives better search visibility for both sides.


### 3. Content Brief & Writing Rules Enhancement (`content-brief.ts`, `content-posts.ts`):** AEO rules block in brief generation prompt (answer-first layout, citation density targets, definition block guidance, comparison table requirements, FAQ quality rules, author/date checklist items). Three new AEO-optimized page types: provider-profile (Physician schema, credential-forward, encyclopedic), procedure-guide (MedicalProcedure schema, citation-dense, definition blocks, comparison tables, indications/contraindications/costs/risks/alternatives), pricing-page (Dataset schema, methodology section required, measurable fields only). Citation-worthy writing rules added to WRITING_QUALITY_RULES: claim discipline, evidence framing, encyclopedic neutral tone for medical content, definition block pattern, comparison content rules.

**Agency value:** Better structured data quality with less manual effort. Automated processes reduce schema deployment time.

**Client value:** Richer search result appearances and better Google understanding of site structure.

**Mutual:** Higher-quality structured data drives better search visibility for both sides.


### 4. AEO Recommendation Engine (`recommendations.ts`):** All 8 AEO audit checks now flow into the existing Recommendation Engine as a dedicated `aeo` RecType. Custom insight text generators for each AEO check explain *why* each issue matters for AI visibility (with traffic-aware variants showing clicks at risk). `aeo-author`, `aeo-answer-first`, and `aeo-trust-pages` added to CRITICAL_CHECKS — these become "Fix Now" recommendations on high-traffic pages. AEO product mapping enables purchasable fix upsells: `aeo_page_review` ($99) and `aeo_site_review` ($499, 5+ pages).

**Agency value:** Every audit now surfaces AEO opportunities alongside traditional SEO issues as structured, prioritized recommendations. Content briefs automatically produce LLM-citeable content structure. Schema generation handles healthcare verticals natively and enriches from the knowledge base. The platform doesn't just optimize for Google — it optimizes for ChatGPT, Perplexity, and every AI answer engine.

**Client value:** Their content becomes more likely to be cited by AI systems. AEO recommendations explain *why* author attribution, dates, and citations matter for AI visibility — with real traffic-at-risk numbers. Healthcare clients get industry-specific schema and content templates out of the box. Schema generation is enriched with KB data they've already provided.

**Mutual:** Positions hmpsn.studio ahead of competitors who only optimize for traditional search. AEO is the next frontier — clients who adopt these practices now will dominate AI-generated answers in their verticals. New AEO product tiers create revenue from the recommendations.

---

### 81. AEO Page Review — AI-Powered Content Change Recommendations
**What it does:** `aeo-page-review.ts` + `AeoReview.tsx` — admin-first AI-powered per-page content change recommendations. Unlike the AEO audit (which flags issues with generic fix guidance), the Page Review uses GPT-4.1 to generate **specific, implementable changes** for each page: actual replacement intro paragraphs, specific author bylines sourced from the knowledge base, named citation targets (e.g., "cite ADA.org guidelines on…"), comparison table column specs, definition block content, and exact restructuring instructions.

**Architecture:**
- **Server:** `server/aeo-page-review.ts` — review engine. Takes page HTML + AEO audit issues + workspace knowledge base + keyword strategy + brand voice + personas. Produces structured JSON with `AeoPageChange[]` (12 change types: `rewrite_intro`, `add_author`, `add_date`, `add_section`, `add_citations`, `add_schema`, `add_faq`, `add_comparison`, `add_definition`, `restructure_content`, `remove_dark_pattern`, `copy_edit`). Each change has location, current content excerpt, suggested replacement, rationale, effort estimate, priority, and AEO impact description.
- **Routes:** `server/routes/aeo-review.ts` — `POST /api/aeo-review/:workspaceId/page` (single page), `POST /api/aeo-review/:workspaceId/site` (batch up to 25 pages, prioritized by AEO issue count), `GET /api/aeo-review/:workspaceId` (load saved review). Reviews saved to `aeo-reviews/` data directory.
- **Frontend:** `src/components/AeoReview.tsx` — lazy-loaded sub-tab within SeoAudit. Summary cards (avg score, pages reviewed, total changes, quick wins, est. time). Filterable by effort (quick/moderate/significant) and priority (high/medium/low). Expandable page cards with AI summary, per-change cards with current→suggested diff view, rationale, and AEO impact. Single-page re-review button.

**Admin-first design:** Recommendations shown only to the agency team. They cherry-pick what to action or send to the client. No client-facing exposure yet — the review output is frank and technical.

**Agency value:** Transforms AEO audit flags into a ready-to-implement content change list. Instead of "this page needs author attribution," the review says "add 'Written by Dr. Jane Smith, DDS — 15 years of cosmetic dentistry experience' below the H1, sourced from your knowledge base." Copywriters can implement changes without further research.

**Client value (future):** Once battle-tested, curated recommendations can be exposed in the client portal as a "content improvement plan."

**Mutual:** Closes the gap between "what's wrong" and "exactly what to do about it." Makes AEO optimization actionable at scale.

---

### 83. Frontend Component Decomposition
**What it does:** Systematic extraction of large monolithic components into focused sub-modules across 11 directories. **SeoAudit.tsx** → `src/components/audit/`: `ScoreTrendChart`, `ActionItemsPanel`, `AuditHistory`, `AuditBatchActions`, `AuditFilters`, `AuditIssueRow`, `AuditReportExport`, `types.ts`. **ContentBriefs.tsx** → `src/components/briefs/`: `BriefDetail`, `BriefGenerator`, `BriefList`, `RequestList`. **SchemaSuggester.tsx** → `src/components/schema/`: `CmsTemplatePanel`, `BulkPublishPanel`, `PagePicker`, `SchemaEditor`, `SchemaPageCard`. **KeywordStrategy.tsx** → `src/components/strategy/`: `SeoCopyPanel`, `BacklinkProfile`, `CompetitiveIntel`, `ContentGaps`, `KeywordGaps`, `LowHangingFruit`, `PageKeywordMap`, `QuickWins`. **AssetBrowser.tsx** → `src/components/assets/`: `OrganizePreview`, `AssetCard`, `AssetFilters`, `BulkActions`. **SeoEditor.tsx** → `src/components/editor/`: `ApprovalPanel`, `BulkOperations`, `PageEditRow`. **PostEditor.tsx** → `src/components/post-editor/`: `PostPreview`, `ReviewChecklist`, `SectionEditor`, `VersionHistory`. **WorkspaceSettings.tsx** → `src/components/settings/`: `ConnectionsTab`, `FeaturesTab`, `ClientDashboardTab`. **WorkspaceHome** → `src/components/workspace-home/`: `ActiveRequestsAnnotations`, `ActivityFeed`, `RankingsSnapshot`, `SeoWorkStatus`, `SeoChangeImpact`. **Client dashboard**: extracted `useContentRequests` hook for Content tab API logic. **Server-side**: `content-posts.ts` split into `content-posts-ai.ts` (AI generation) + `content-posts-db.ts` (DB CRUD); `webflow.ts` split into `webflow-client.ts` (fetch helper) + `webflow-assets.ts` + `webflow-pages.ts` + `webflow-cms.ts`. New `src/contexts/WorkspaceDataContext.tsx` for cached workspace data. **UX improvements shipped alongside**: skeleton/shimmer loading states (`Skeleton.tsx` UI primitive), mobile-friendly date picker popover, Chat/FeedbackWidget overlap fix on mobile, centralized number formatting utilities, sequential batch approve (race condition fix), and strategy generation error handling with user-facing error messages.

**Agency value:** Dramatically smaller file sizes — easier code reviews, faster navigation, fewer merge conflicts. Each extracted module is independently testable and importable. Skeleton loading states make the dashboard feel faster during data fetches.

**Client value:** Smoother loading experience with skeleton placeholders instead of blank screens. Mobile date picker usability improved.

**Mutual:** Sustainable frontend architecture that scales. New components slot into the correct module directory. The decomposition pattern (extract to `src/components/{domain}/`, keep parent as shell with state + routing) is established for future extractions.

---

### 84. Client Portal Favicon + OG Meta Tags
**What it does:** Dynamically updates the document head when a client portal loads: `og:title`, `og:description`, `og:type`, `og:url`, `twitter:title`, `twitter:description`, `twitter:card`, and `meta description` — all personalized per workspace. If the workspace has a `brandLogoUrl`, it's set as `og:image`, `twitter:image`, and the page favicon (SVG or PNG detection). Added `brandLogoUrl` and `brandAccentColor` to the `WorkspaceInfo` TypeScript type.

**Agency value:** Professional appearance when clients bookmark or share their dashboard in Slack/Teams. Branded favicon differentiates it from generic apps.

**Client value:** Their portal looks and feels like a custom product — not a white-label dashboard.

**Mutual:** Small polish, significant perception improvement. Reinforces the premium positioning of the platform.

---

### 85. AI Chatbot ROI-Backed Upgrade Prompts
**What it does:** When the AI chatbot hits the free-tier rate limit (429), the upgrade message now includes the workspace's organic traffic value: "You've already identified **$X** in organic traffic value — Growth ($249/mo) pays for itself." The `useChat` hook fetches ROI data (`/api/public/roi/:wsId`) when chat opens. The chat-exhausted bar in the header shows ROI-backed copy with emerald highlight. `TierGate` component accepts an optional `roiValue` prop to display organic traffic value in any upgrade overlay. All best-effort with silent fail if ROI data is unavailable.

**Agency value:** Upgrade prompts now connect value proof to purchase decision at the exact moment of highest intent. Conversion optimization without additional sales effort.

**Client value:** Clients see concrete dollar values rather than abstract feature lists — makes the upgrade decision rational rather than emotional.

**Mutual:** Data-driven nudges that respect the client's intelligence. Higher conversion rates mean sustainable revenue growth.

---

### 86. Pre-Populate Content Requests from Audit Issues
**What it does:** New endpoint `POST /api/public/content-request/:wsId/from-audit` creates a pre-populated content request from audit data. Accepts `pageSlug`, `pageName`, `issues`, and `wordCount`. Auto-enriches with top 5 GSC keywords for the page and keyword strategy target keyword. Creates a content request with rich rationale including identified issues, current word count, and top organic keywords. In the client Health tab, pages with content-related issues (thin content, heading/H1 problems) show a "Request Content Improvement" button. One click creates the request → success toast → WebSocket auto-refreshes the Content tab.

**Agency value:** Removes friction from the revenue funnel — audit findings automatically convert into actionable content requests. Pre-filled context (keywords, word count, issues) means the team starts with full context instead of vague requests.

**Client value:** No need to manually copy audit findings into a request form. One click turns a problem into a solution in progress.

**Mutual:** Shortest path from "problem identified" to "solution requested." Every content issue becomes a potential engagement opportunity with zero manual data entry.

---

### 87. Client Email Capture on Free Tier
**What it does:** After shared-password authentication succeeds, the client dashboard shows a lightweight email capture gate before loading the dashboard. The form collects email (required) and name (optional). Emails are stored server-side via `POST /api/public/capture-email/:id` in the workspace's `portalContacts` array (deduped by email). `localStorage` tracks captured email to skip the gate on return visits. A "Skip for now" option is available. Backend adds `portalContacts` to the Workspace interface with `email`, `name`, and `capturedAt` fields.

**Agency value:** Unlocks the entire email marketing funnel for shared-password clients — monthly reports, trial expiry emails, re-engagement campaigns, and upgrade prompts now have a delivery address. Zero ongoing effort after setup.

**Client value:** Clients who provide their email receive performance reports and important site updates automatically. The gate is non-intrusive with a skip option.

**Mutual:** Every email captured extends the communication channel. Higher report reach → higher engagement → higher retention and upgrade conversion.

---

### 88. "Time Saved" Metric on Admin Dashboard
**What it does:** Tracks `durationMs` on every `callOpenAI()` invocation. `getTimeSaved()` in `openai-helpers.ts` maps each AI feature to a human-equivalent time estimate (e.g., content brief = 150 min, keyword strategy = 240 min, schema generation = 60 min). New endpoint `GET /api/ai/time-saved?workspaceId=&since=` returns `totalHoursSaved`, `operationCount`, and per-feature breakdown. The Command Center (WorkspaceOverview) shows an "Hours Saved" StatCard with purple Clock icon displaying total hours and AI operation count for the current month. **April 2026:** Added `responseFormat?: { type: 'json_object' }` to `OpenAIChatOptions` — conditionally adds `response_format` to OpenAI request body when set. `AIRequestDeduplicator.createKey()` updated to include `responseFormat` in key data so JSON-mode and non-JSON-mode requests never share a cache entry.

**Agency value:** Concrete "hours saved" metric for client conversations, proposals, and marketing materials. "We saved you 47 hours this month" is more compelling than "we used AI."

**Client value:** Transparent view of the platform's operational impact. Reinforces value perception.

**Mutual:** Quantified ROI metric that justifies platform investment for both sides.

---

### 89. Stripe Recurring Billing for Tier Subscriptions
**What it does:** Tier upgrades (Growth $249/mo, Premium $999/mo) now use Stripe Checkout with `mode: 'subscription'` instead of one-time `mode: 'payment'`. `createCheckoutSession` in `server/stripe.ts` detects `plan_growth`/`plan_premium` and creates subscription sessions with `subscription_data` metadata. Full subscription lifecycle handling via webhooks: `customer.subscription.created/updated` (sets tier + stores `stripeSubscriptionId`), `customer.subscription.deleted` (downgrades to free), `invoice.paid` (activity log), `invoice.payment_failed` (warning). New functions: `createBillingPortalSession()` for Stripe Customer Portal self-service, `cancelSubscription()` with graceful cancel-at-period-end. New routes: `POST /api/public/billing-portal/:wsId`, `POST /api/public/cancel-subscription/:wsId`. PlansTab shows "Manage Billing" button for paid subscribers that opens the Stripe Customer Portal.

**Agency value:** Monthly recurring revenue without manual invoicing. Subscription lifecycle is fully automated — upgrades, renewals, cancellations, and failed payments are all handled. Customer Portal eliminates billing support tickets.

**Client value:** Self-service billing management (update payment method, view invoices, cancel). Graceful cancellation at period end means no surprise loss of access.

**Mutual:** Sustainable revenue model with professional billing experience. Stripe handles all payment compliance, invoicing, and dunning.

---

### 90. SEO Change Performance Tracker
**What it does:** Records every SEO change (title, description, OG) applied to pages — whether via the SEO Editor, Bulk Fix, Approval flow, or background jobs. Stores a persistent log per workspace in `~/.asset-dashboard/seo-changes/`. The `SeoChangeImpact` component on the Workspace Home page lists recent changes with a "Compare GSC Impact" button. When clicked, it fetches GSC page-level data for before/after periods (28-day windows around the change date, accounting for GSC's 3-day data delay) and shows delta badges for clicks, impressions, CTR, and position. Changes less than 7 days old are marked "too recent."

**Agency value:** Concrete proof that SEO work drives measurable results. "After we rewrote your meta descriptions, clicks to that page increased 34%" is a retention-winning conversation.

**Client value:** Transparency into what was changed and whether it's working. Builds trust in the agency's recommendations.

**Mutual:** Data-driven feedback loop — the agency knows which types of SEO changes produce the best results, and the client sees the ROI.

---

### 91. AI Usage as Standalone Nav Page
**What it does:** The AI Usage dashboard (token consumption, cost tracking, per-feature breakdown) was previously embedded inline in the Command Center. Now exported as a standalone page accessible via an amber-accented "AI Usage" button in the Command Center header nav, alongside Prospect and Roadmap. Routes through `'ai-usage'` page type in App.tsx.

**Agency value:** Faster access to AI cost tracking without scrolling through the Command Center.

**Client value:** N/A (admin-only feature).

**Mutual:** Better operational visibility into AI spend.

---

### 92. Keyword Difficulty / Impressions Zero-Value Fix
**What it does:** Fixed a display bug in the admin KeywordStrategy component where Keyword Difficulty and volume/impressions were showing as "0" instead of being hidden. Applied conditional rendering (`> 0`) to siteKeywords, pageMap metrics, and secondaryMetrics sections. The client-side StrategyTab already had this logic; the admin side was missing it.

**Agency value:** Clean, accurate data display — no misleading zero values that erode confidence in the data.

**Client value:** N/A (admin-side fix, client side was already correct).

**Mutual:** Data integrity across both sides of the platform.

---

### 93. Admin Sidebar Per-Group Color Accents
**What it does:** Each sidebar navigation group now has its own color scheme: Analytics (blue), Site Health (emerald), SEO (teal), Content (amber). Active items show a gradient background and full-color icon matching their group. Inactive items show a muted version of the group color on hover. Tailwind JIT-compatible with explicit color properties per group.

**Agency value:** Faster visual scanning — color-coded groups let the admin find the right tool instantly without reading labels.

**Client value:** N/A (admin-only UI).

**Mutual:** Polished professional interface that reinforces the premium positioning of the platform.

---

### 94. Client Audit Completion Email
**What it does:** Sends a branded email when an SEO audit completes, showing the site health score, score delta vs previous audit, top 3 remaining issues by severity, and fixed issues count (calculated by comparing current vs previous snapshot). Triggered from both manual and scheduled audit flows. CTA links directly to the Health tab.

**Agency value:** Automated touchpoint that demonstrates ongoing work without any manual effort.

**Client value:** Immediate notification when their site has been re-audited, with clear before/after progress metrics.

**Mutual:** High-engagement retention touchpoint — clients see tangible improvement and stay engaged.

---

### 95. Shareable Client Reports with Permalinks
**What it does:** Monthly reports are now persisted to disk with unique IDs when sent (manual or auto). Public permalink route `/report/monthly/:id` serves the saved HTML. Unified API `/api/public/reports/:workspaceId` lists all shareable reports (audit snapshots + monthly reports). "Share Report" dropdown in the Site Health tab lets clients copy permalink URLs or open reports in new tabs.

**Agency value:** Clients forward reports to decision-makers, expanding the agency's visibility to budget-holders without extra work.

**Client value:** Persistent, shareable links to all audit and monthly reports for internal distribution and record-keeping.

**Mutual:** Reduces churn by ensuring budget-holders see the value of ongoing SEO work.

---

### 96. Content Refresh / Decay Engine
**What it does:** `content-decay.ts` compares current 30-day vs previous 30-day GSC page data to detect declining content. Severity tiers: critical (>50% click decline), warning (>30%), watch (>10%). AI refresh recommendations generated per decaying page via GPT-4.1-mini with full SEO context. Admin UI: `ContentDecay.tsx` lazy-loaded sub-tab in SeoAudit with summary cards, severity filters, expandable page details with click/impression/position deltas, and AI recommendation display. API routes for analysis, cached results, and batch recommendation generation. Public endpoint for client dashboard.

**Agency value:** Proactively identifies content needing updates before clients notice traffic drops. Justifies ongoing subscription fees.

**Client value:** Transparent view of which pages are losing traffic and AI-powered action plans to fix them.

**Mutual:** Turns content maintenance from reactive to proactive — both sides benefit from catching decay early.

---

### 97. Not Yet Ranking Action Plan
**What it does:** Expandable section in the Strategy tab (between Content Opportunities and Quick Wins) showing all pages mapped in the keyword strategy that have no search position. Per-page diagnosis: near-ranking (has impressions but no position), high keyword difficulty, moderate competition needing content depth, or likely not indexed/thin content. Priority sorted by commercial intent first, then pages with impressions, then fixable KD. Each page expandable with diagnosis reasons, GSC metrics, keyword metrics (volume, KD%), recommended action with icon, and "Get Content Brief" CTA with pricing.

**Agency value:** Turns a passive stat ("12 pages not ranking") into an actionable pipeline of optimization opportunities with clear next steps.

**Client value:** Understands exactly why pages aren't ranking and has one-click access to order content optimization.

**Mutual:** Diagnosis → plan → action flow that drives content orders while solving real SEO problems.

---

### 98. Structured Logging (Pino)
**What it does:** `server/logger.ts` — Pino structured JSON logging replacing all `console.log/warn/error`. `createLogger(module)` for child loggers with module context. Pretty-print in dev (via pino-pretty), JSON in prod. Configurable via `LOG_LEVEL` env var.

**Agency value:** Searchable, structured logs enable debugging client issues without SSH. Log levels filter noise. JSON output integrates with log aggregation (Datadog, Papertrail).

**Client value:** Indirect — faster issue resolution, less downtime.

**Mutual:** Operational maturity that prevents small issues from becoming outages.

---

### 99. Sentry Error Monitoring
**What it does:** `server/sentry.ts` + `@sentry/react` frontend. Server-side: auto-tags errors with `workspaceId` from request URLs, conditional `tracesSampleRate` (0.2 prod, 1.0 dev). Frontend: React ErrorBoundary integration. Conditional source maps via `SENTRY_AUTH_TOKEN`.

**Agency value:** Real-time error visibility across all workspaces without waiting for client reports. Payment flow errors, AI generation failures, and WebSocket disconnects surface immediately.

**Client value:** Indirect — issues get fixed before clients notice them.

**Mutual:** Proactive error resolution builds trust and prevents churn.

---

### 100. CI/CD Pipeline (GitHub Actions)
**What it does:** `.github/workflows/ci.yml` (lint, type-check, unit/integration tests, build) + `e2e.yml` (Playwright tests against running server). Automated on every push and PR.

**Agency value:** Catches regressions before they reach production. Enables confident merging of Devin PRs and contributor code.

**Client value:** Indirect — fewer bugs shipped to production.

**Mutual:** Quality gate that scales with the team.

---

### 101. Graceful Shutdown
**What it does:** SIGTERM/SIGINT handlers in `server/index.ts`: flush email queue, close DB connection, close WebSocket server. Reentrancy guard prevents double-shutdown. try/catch wraps flush calls to prevent skipping `db.close()` on disk errors.

**Agency value:** Zero data loss during deploys and restarts. Email queue flushes before exit — no lost notifications.

**Client value:** Indirect — no data corruption, no missing emails.

**Mutual:** Production reliability that prevents silent failures.

---

### 102. Off-site Backups (S3)
**What it does:** `server/backup.ts` enhanced with optional S3 upload after local backup. Triggered via `BACKUP_S3_BUCKET` env var. Cleans up local tar.gz on successful upload. Configurable region (`BACKUP_S3_REGION`), prefix (`BACKUP_S3_PREFIX`), and retention (`BACKUP_RETENTION_DAYS`).

**Agency value:** Disaster recovery — database recoverable even if server disk is lost. Automated, no manual intervention.

**Client value:** Indirect — their data is safe.

**Mutual:** Business continuity insurance.

---

### 103. API Hardening
**What it does:** Rate limit headers (`X-RateLimit-Limit/Remaining/Reset`), Cloudflare Turnstile CAPTCHA on client login/forgot-password (optional via `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`), request fingerprinting, credential stuffing protection on auth endpoints.

**Agency value:** Protects against bot attacks and credential stuffing without breaking legitimate usage. Rate limit headers help debug client-side 429 errors.

**Client value:** Login security via CAPTCHA, protection against account takeover.

**Mutual:** Security hardening that scales with the user base.

---

### 104. React Router DOM Migration
**What it does:** Migrated from manual routing to `react-router-dom` v7. `BrowserRouter` with `Routes`/`Route` in `App.tsx`. `src/routes.ts` defines `Page` + `ClientTab` type unions, `adminPath()` + `clientPath()` helpers. Admin: `/ws/:workspaceId/:tab?`, Client: `/client/:workspaceId/:tab?`, global tabs: `/settings`, `/roadmap`, `/prospect`, `/ai-usage`.

**Agency value:** Standard routing enables deep linking, browser back/forward, bookmarkable URLs. Easier onboarding for new developers.

**Client value:** Bookmarkable URLs, browser navigation works as expected.

**Mutual:** Better UX + maintainable codebase.

---

### 105. Typed API Client Layer
**What it does:** `src/api/` with 9 modules: `client.ts` (ApiError, get/post/patch/del/postForm/getOptional/getSafe), `analytics.ts`, `workspaces.ts`, `content.ts`, `seo.ts`, `payments.ts`, `auth.ts`, `misc.ts`, `index.ts` (barrel). All components migrated from raw `fetch()` calls.

**Agency value:** Type-safe API calls catch errors at compile time. Centralized error handling (429 detection, auth redirects). Single import for all API operations.

**Client value:** Indirect — fewer bugs, more consistent error handling.

**Mutual:** Developer productivity × reliability.

---

### 106. Shared Types
**What it does:** `shared/types/` with 10 modules shared between client and server: `workspace.ts`, `analytics.ts`, `content.ts`, `payments.ts`, `approvals.ts`, `requests.ts`, `recommendations.ts`, `users.ts`, `roadmap.ts`, `index.ts` (barrel).

**Agency value:** Single source of truth for interfaces eliminates type drift between frontend and backend. Refactoring touches one file instead of two.

**Client value:** Indirect — fewer type-mismatch bugs.

**Mutual:** Codebase consistency that scales with feature count.

---

### 107. E2E Test Suite (Playwright)
**What it does:** `tests/e2e/` with Playwright tests: `smoke.spec.ts` (server health + page load), `approval-workflow.spec.ts` (propose → review → apply), `client-login.spec.ts` (auth flow + JWT). Runs in CI via `.github/workflows/e2e.yml`.

**Agency value:** Critical-path flows verified on every deploy. Catches regressions in payment, approval, and auth flows before they reach clients.

**Client value:** Indirect — approval workflow and login always work.

**Mutual:** Confidence to ship fast without breaking revenue-critical flows.

---

### 108. Background Job Persistence
**What it does:** `server/jobs.ts` rewritten with SQLite write-through cache (migration `006-jobs.sql`). Background jobs (audits, brief generation, post generation, etc.) now persist to the `jobs` table and survive server restarts. Running/pending jobs are marked as `interrupted` during graceful shutdown. Write-through cache means reads hit memory for speed, writes go to both memory and SQLite for durability.

**Agency value:** Long-running jobs (AI content generation, full-site audits) no longer lost on deploy or restart. Interrupted jobs are visible in the admin UI so you know what to re-run.

**Client value:** Indirect — content they ordered doesn't silently disappear mid-generation.

**Mutual:** Reliability for the most expensive operations in the platform.

---

### 109. Anomaly Detection Deploy Guard
**What it does:** Tracks last successful anomaly scan time in SQLite. On server startup (deploy), skips the scan if the last scan was within 6 hours. Prevents clients from being spammed with anomaly emails every time the app is redeployed. The `force` parameter bypasses the guard for manual scans.

**Agency value:** Deploy freely during active development without worrying about false anomaly alerts reaching clients.

**Client value:** Only receives anomaly alerts that reflect genuine metric changes, not deploy artifacts.

**Mutual:** Trust in the notification system — alerts mean something real happened.

---

### 110. Content Pipeline Status Cards & Post-Publish Performance
**What it does:** Two additions to the client Content tab: (1) At-a-glance status summary cards showing counts for Needs Review, In Progress, Delivered, and Published items. (2) Post-publish performance snippet on delivered/published content showing GSC clicks, impressions, CTR, avg position, and contextual messages for new content not yet indexed. Uses the existing `handleContentPerformance` handler exposed via a new public endpoint.

**Agency value:** Closes the content ROI loop — clients can see their investment is paying off without asking.

**Client value:** Immediate visibility into pipeline status and measurable proof that content investments are driving search traffic.

**Mutual:** Content performance data builds confidence for repeat purchases.

---

### 111. Growth Opportunities Reframe (Client Strategy Tab)
**What it does:** Reframes the former "Not Yet Ranking" section in the client Strategy tab as "Growth Opportunities" with a positive, opportunity-focused tone. Red/alarming styling replaced with teal/encouraging colors. Diagnostic messages focus on upside potential rather than what's broken. "Near-ranking" badge changed to "Almost there."

**Agency value:** Positions the agency as a growth partner rather than an alarm system. Reduces client anxiety from seeing red warning indicators.

**Client value:** Understands unranked pages as opportunities to capture, not failures to fix.

**Mutual:** Positive framing encourages action (content briefs) rather than worry.

---

### 112. Recurring Content Subscriptions
**What it does:** Monthly content subscription packages (Starter: 2 posts/$500, Growth: 4 posts/$900, Scale: 8 posts/$1,600). Full Stripe subscription integration with recurring monthly billing, automated period tracking, and delivery progress. Admin UI for creating/managing subscriptions per workspace with plan selection, topic source configuration (strategy gaps, AI recommended, manual), pause/resume, delivery tracking with progress bars, and subscription history. Client UI on Plans tab shows available packages with checkout flow, active subscription status, and delivery progress. Webhook handling for subscription lifecycle (creation, renewal, cancellation, past-due). DB migration creates `content_subscriptions` table with proper indexes. `create-stripe-products.ts` script extended with recurring monthly prices.

**Agency value:** Recurring revenue engine — $500–$1,600/mo per client on autopilot. Content delivery tracked per period so nothing falls through the cracks. Strategy gap integration means topics are auto-sourced from keyword strategy.

**Client value:** Predictable monthly content investment with clear delivery tracking. Subscribe once, get optimized posts every month.

**Mutual:** Transforms one-off content purchases into predictable recurring revenue with built-in accountability via delivery progress tracking.

---

### 113. Content Post Version History
**What it does:** Automatic version snapshots of generated posts before any destructive change (section regeneration, manual inline edits, reverts). `content_post_versions` SQLite table stores full post state with version number, trigger type, and trigger detail. Three API endpoints: list versions (lightweight, no content), get version (full content), revert to version (snapshots current state first, then restores). PostEditor UI: "History" toggle button in the toolbar opens a scrollable version timeline panel showing version number badges, trigger labels (e.g., "Regenerated section — Section 3", "Manual edit — introduction, sections"), timestamps, and word counts. One-click revert on hover per version entry.

**Agency value:** Never lose work — every regeneration and edit is recoverable. Confidently experiment with AI regeneration knowing you can always revert. Full audit trail of content changes.

**Client value:** N/A (admin-only content editing).

**Mutual:** Safety net that encourages iteration. More experimentation → better content quality.

---

### 115. Content Calendar
**What it does:** Month-view visual calendar showing the full content pipeline — briefs, posts, and content requests — plotted on their creation/publish dates. Summary stat cards show monthly counts for briefs, posts, requests, and published items. Type filter pills (All/Briefs/Posts/Requests) narrow the view. Month navigation with "Today" shortcut. Clicking a day opens a detail panel listing all items for that day with type icons, status badges, and relative timestamps. Items are color-coded: teal for briefs, amber for posts, blue for requests. Registered as "Calendar" tab in the CONTENT sidebar group, lazy-loaded.

**Agency value:** At-a-glance pipeline visibility — see content velocity, identify bottlenecks (too many briefs but few posts), and plan capacity. Essential management interface for recurring content subscriptions.

**Client value:** N/A (admin-only).

**Mutual:** Turns the content pipeline from a flat list into a temporal view that reveals patterns and gaps.

---

### 114. Human-in-the-Loop Review Checklist
**What it does:** Structured quality gate in PostEditor that must be completed before a post can move from Draft to Review status. Six checklist items: factual accuracy verified, brand voice match confirmed, internal links verified and working, no AI hallucinations or fabricated statistics, meta title/description optimized, word count within brief target. Checklist state persists in a new `review_checklist` JSON column on `content_posts` (migration 010). Collapsible panel with progress counter (e.g., "4/6") shows checked items with green checkmarks and strikethrough. "Send to Review" button is disabled and visually muted until all 6 items are checked.

**Agency value:** Catches AI errors before clients see them. Structured process ensures consistent quality across team members. Demonstrates professionalism — clients receive human-verified content, not raw AI output.

**Client value:** Every piece of content they receive has passed a documented quality review. Builds trust in the deliverable.

**Mutual:** Quality gate that prevents embarrassing AI mistakes (hallucinated stats, off-brand tone, broken links) from reaching clients. For a $500–$1,500 deliverable, this is table stakes.

---

### 143. Content Templates (Scalable Content Planning)
**What it does:** Reusable page structure templates with named variables, ordered sections (heading pattern + guidance + word count target), URL/keyword patterns, CMS field mapping, and tone/style overrides. Full CRUD backend with SQLite persistence (migration 014). Templates define page types (blog, landing, service, location, product, pillar, resource, provider-profile, procedure-guide, pricing-page). Duplicate existing templates as starting points for new ones.

**Agency value:** Define a page structure once (e.g., "Service Page" or "Location Page"), then stamp out dozens of briefs that follow the same proven outline. Ensures consistency across content at scale.

**Client value:** Content deliverables follow a professional, repeatable structure. Every page type meets the same quality standard regardless of who writes it.

**Mutual:** Templates eliminate the "blank page" problem for content production. The agency builds faster; the client gets more consistent results.

---

### 144. Keyword Pre-Assignment & Validation
**What it does:** Extends brief generation to accept pre-locked keywords from templates or matrices. Keywords validated against SEMRush — returning volume, difficulty, CPC with warnings for low volume (<10/mo) or high difficulty (>85). Single and bulk validation endpoints. Non-blocking: if SEMRush unavailable, keywords accepted without validation. Brief tracks keyword source (manual, semrush, gsc, matrix, template) and validation metadata. Template constraints (section structure, tone override, title/meta patterns) injected into AI brief prompt.

**Agency value:** No more guessing whether a keyword is worth targeting. SEMRush validation surfaces volume/difficulty before committing to a brief. Pre-locked keywords from matrices guarantee every piece targets a deliberate keyword.

**Client value:** Every content brief is backed by real keyword data. Validation metrics build confidence in the content strategy.

**Mutual:** Keyword validation catches bad targets before production starts. One API call prevents hours of wasted content work on zero-volume keywords.

---

### 145. Content Matrices (Bulk Content Planning Grids)
**What it does:** Matrices connect a template to concrete content cells via cartesian product of dimensions (e.g., Service × City = 6 cells for 2 services × 3 cities). Each cell gets auto-generated target keyword and planned URL from patterns with variable substitution. Per-cell status tracking: planned → keyword_validated → brief_generated → draft → review → approved → published. Cells individually updatable. Matrix stats auto-computed. Full CRUD backend with SQLite persistence (migration 016). 12 integration tests.

**Agency value:** Plan 50+ pages in one action instead of creating 50 separate briefs. The matrix is the production manifest — see at a glance which pages exist, which need briefs, which are in review, and which are published.

**Client value:** Transparent view of the entire content plan with clear status per page. No wondering "did they write the Dallas plumbing page yet?"

**Mutual:** Turns content production from ad-hoc requests into a structured, trackable manufacturing pipeline.

---

### 146. Smart Keyword Recommendations
**What it does:** Given a seed keyword (from a matrix cell pattern or manual input), fetches SEMRush related keywords, scores each by opportunity (40% log-scaled volume + 60% inverse difficulty), and returns ranked candidates with a recommended pick. Optional AI re-ranking via GPT-4.1-nano that considers business context, commercial intent, and specificity. Non-blocking fallback when SEMRush is unconfigured. Two endpoints: standalone (any seed keyword) and per-cell (auto-uses cell's target keyword as seed).

**Agency value:** No more guessing which keyword variant to target. The system surfaces the best option from real SEMRush data, ranked by achievability. AI ranking adds business-relevance awareness when keyword strategy context exists.

**Client value:** Every content page targets an evidence-backed keyword with the best volume-to-difficulty ratio for their business.

**Mutual:** Removes the manual research step from keyword selection. What used to take 15 minutes per keyword is now a one-click API call.

---

### 147. Cannibalization Detection
**What it does:** Detects keyword overlap between matrix cells and existing pages (from keyword strategy pageMap), within the same matrix, and across different matrices. Three severity levels: high (exact match after normalization), medium (word subset overlap — all words of one keyword appear in the other), low (60%+ Jaccard word overlap). Symmetric deduplication prevents A↔B duplicates. Full matrix report endpoint returns conflict list with summary counts. Single-keyword check endpoint for pre-validation before adding to a cell.

**Agency value:** Catches the #1 SEO mistake in scaled content — two pages targeting the same keyword. Detects it before a single brief is generated, saving hours of wasted production work.

**Client value:** No duplicate content competing against itself in search results. Every page has a unique keyword lane.

**Mutual:** Automated quality gate that prevents the most common content strategy error at scale.

---

### 148. Content Planner Export (CSV/JSON)
**What it does:** Adds matrix cells and content template export to the existing data export system. Matrix export flattens all cells across all matrices into one CSV/JSON with columns: matrix name, cell keyword, planned URL, status, variable values, SEMRush metrics (volume/difficulty/CPC), linked brief and post IDs. Template export includes metadata: page type, URL/keyword patterns, section count, variable count. Both formats available via `?format=csv` or `?format=json` query parameter.

**Agency value:** Export the content plan as a CSV to share with writers, clients, or import into project management tools. Template export documents the content architecture.

**Client value:** Downloadable content plan they can review offline or share with stakeholders.

**Mutual:** Makes the content planner's data portable and audit-friendly.

---

### 149. Client Review Flow (Tiered Content Plan Review)
**What it does:** Three-layer review system for scaled content plans. Layer 1: Admin sends template for client approval via approval batch — client sees page type, sections, tone, and URL patterns. Layer 2: Admin selects 2-3 sample cells to send for client review — cells move to "review" status. Layer 3: After samples approved, batch-approve all remaining cells in one click. Clients get a read-only matrix progress view showing every cell's status, keyword, planned URL, and whether briefs/posts exist. Clients can flag individual cells for changes with comments (sets `clientFlag` + `clientFlaggedAt` on the cell). Six API endpoints: 3 public (progress view, single matrix detail, cell flagging) and 3 admin (send template review, send samples, batch approve).

**Agency value:** Review 54 pages in ~30 minutes instead of ~5 hours. Template approval + sample review + batch approve eliminates per-page review overhead while maintaining quality control.

**Client value:** Clear visibility into the entire content plan with the ability to spot-check any page and flag specific concerns without blocking production on the rest.

**Mutual:** Scales the review process proportionally — more pages don't mean more review time. The 80/20 rule: review the template and a few samples, trust the system for the rest.

---

### 150. Site Architecture Planner
**What it does:** Builds a complete URL tree for a workspace by combining three data sources: existing pages (Webflow API static + CMS sitemap discovery), planned pages (content matrix cells), and strategy pages (keyword map assignments). Each node tracks source type (existing/planned/strategy/gap), keyword, SEO metadata, and matrix linkage. Detects architecture gaps — intermediate URL paths with child pages but no hub/landing page (e.g., `/services/` has children but no page). Reports depth distribution, orphan pages, and gap priority. Admin UI shows interactive collapsible tree with source badges, search/filter, stat cards (total/live/planned/strategy/gaps), gap list with priority badges, orphan page warnings, and depth distribution bar chart. Accessible via "Architecture" sub-tab in Content Pipeline.
**Files:** `server/site-architecture.ts`, `server/routes/site-architecture.ts`, `src/components/SiteArchitecture.tsx`, `src/components/ContentPipeline.tsx`

**Agency value:** Instant bird's-eye view of the site's URL hierarchy showing where content exists, what's planned, and where gaps need filling — replaces manual spreadsheet URL planning.

**Client value:** Visual proof that the content plan covers the full site architecture with no orphan pages or missing hub pages.

**Mutual:** Ensures every planned page fits into a coherent URL hierarchy before any content is written.

---

### 151. LLMs.txt Generator
**What it does:** Generates two-tier llms.txt files — `llms.txt` (index with one-line descriptions) and `llms-full.txt` (with AI-generated per-page summaries) — following the llms.txt spec for AI consumption. Pulls data from workspace config, all published pages (Webflow static + CMS, up to 500 — no cap), keyword strategy enrichment, and planned content from matrices. **AI summaries**: GPT-4.1-mini generates 2–3 sentence summaries per page capturing expertise signals and target audience; cached in SQLite to avoid redundant API calls on re-generation. **URL validation**: HEAD requests filter broken links before including them in output. **Two-tier output**: `llms.txt` is a lightweight index; `llms-full.txt` has full inline summaries for deep AI understanding. **Auto-regeneration**: background regeneration triggers after schema publish, keyword strategy updates, and content matrix cell status changes — fire-and-forget, does not block the triggering request. **Freshness indicator**: `lastGeneratedAt` timestamp stored per workspace; UI shows "Generated Xh ago" with amber warning when stale (>3 days). Admin UI has generate, copy, separate download buttons for each tier, and a tab toggle to preview index vs. full output. Accessible via "LLMs.txt" sub-tab in Content Pipeline.
**Files:** `server/llms-txt-generator.ts`, `server/routes/llms-txt.ts`, `src/components/LlmsTxtGenerator.tsx`, `src/api/content.ts`, `server/db/migrations/062-llms-txt-cache.sql`, `server/db/migrations/063-llms-txt-freshness.sql`

**Agency value:** One-click generation of a production-quality llms.txt with AI summaries — a differentiator for SEO-forward clients who want their sites optimized for AI search engines (Perplexity, ChatGPT, Google AI Overviews). Auto-regeneration keeps it fresh without manual effort.

**Client value:** Two downloadable files they can place at their site root. The full version gives AI models rich context about the business, improving how it's described in AI-generated results.

**Mutual:** Positions the platform at the frontier of AI-era SEO tooling.

---

### 152. Content Pipeline Data Export Dropdown
**What it does:** Adds a unified "Export" dropdown button to the Content Pipeline tab bar. Admin can export content briefs, content requests, content matrices, content templates, and keyword strategy as either CSV or JSON. Downloads open in a new tab via the existing `/api/export/:workspaceId/:dataset` endpoints. Click-outside dismissal.
**Files:** `src/components/ContentPipeline.tsx`, `server/routes/data-export.ts` (existing)

**Agency value:** Quick data portability for reporting, client handoffs, and audit trails — no need to navigate to workspace settings.

**Client value:** N/A (admin-only feature).

**Mutual:** Ensures all content pipeline data is always exportable from the place it's managed.

---

### 153. Content Planner Admin Orchestrator
**What it does:** Lazy-loaded "Planner" sub-tab in Content Pipeline that orchestrates Devin's matrix UI components. Shows a list view of all templates and matrices with progress bars and badges. Navigates between three views: TemplateEditor (create/edit content templates), MatrixBuilder (step-by-step matrix creation wizard), and MatrixGrid (cell management with bulk actions). Fetches data via `contentTemplates` and `contentMatrices` API client. Handles template save (create/update), matrix creation, cell updates, and CSV export.
**Files:** `src/components/ContentPlanner.tsx` (new), `src/components/ContentPipeline.tsx` (Planner tab added), `src/components/matrix/` (Devin's components)

**Agency value:** Single admin interface for the entire template → matrix → cell pipeline. No context-switching between different tools.

**Client value:** N/A (admin-only).

**Mutual:** Completes the admin side of the content planner system.

---

### 154. Client Content Plan Tab
**What it does:** New "Content Plan" tab in the client portal (paid tiers only) showing matrix progress via MatrixProgressView. Fetches plans from public API (`/api/public/content-plan/:wsId`). Auto-selects if only one plan; shows a list picker for multiple. Clients can preview cells, flag cells with comments (feedback submitted to admin), and download exports. Wrapped in ErrorBoundary.
**Files:** `src/components/client/ContentPlanTab.tsx` (new), `src/components/ClientDashboard.tsx` (tab wired), `src/components/client/types.ts` (`content-plan` added to ClientTab)

**Agency value:** Clients can self-serve content plan status — fewer "where are we?" emails.

**Client value:** Real-time visibility into their content pipeline with per-page status, progress tracking, and the ability to flag concerns.

**Mutual:** Closes the loop between admin content planning and client transparency.

### 155. Content Plan Badge Count
**What it does:** Blue badge on the client dashboard "Content Plan" tab showing the number of matrix cells awaiting client review (status `review` or `flagged`). Data fetched via `/api/public/content-plan/:wsId` and aggregated in `useClientData`.
**Files:** `src/hooks/useClientData.ts`, `src/components/ClientDashboard.tsx`

**Agency value:** Clients immediately see pending actions — reduces follow-up nudges.

**Client value:** Clear visual cue that content needs their attention.

### 156. Workspace Home Content Pipeline Stat Card
**What it does:** 5th stat card on the admin Workspace Home showing content pipeline completion percentage (published/total cells), with a "Needs Attention" action item when review cells exist. Data derived server-side from content matrices and templates in the aggregated `/api/workspace-home/:id` endpoint.
**Files:** `server/routes/workspace-home.ts`, `src/components/WorkspaceHome.tsx`, `src/api/misc.ts`

**Agency value:** At-a-glance content pipeline health on the workspace overview — no need to navigate into content tools.

**Client value:** N/A (admin-only).

### 157. Client Overview Content Plan Insights
**What it does:** Content plan data surfaced in two places on the client Overview tab: (1) action-needed banner showing review cell count with navigation to Content Plan tab, (2) InsightsDigest card with 3 variants — review needed (priority 1), progress percentage (priority 3), or fully published celebration (priority 5).
**Files:** `src/hooks/useClientData.ts`, `src/components/ClientDashboard.tsx`, `src/components/client/OverviewTab.tsx`, `src/components/client/InsightsDigest.tsx`

**Agency value:** Content plan status surfaces automatically in the client overview — no manual reporting.

**Client value:** Proactive insight about their content pipeline progress without navigating away from Overview.

**Mutual:** Keeps content plan front-of-mind for both parties.

### 158. Strategy Tab Planned Coverage
**What it does:** Content gaps on the client Strategy tab now show a violet "Planned" badge (with Layers icon) when the keyword already exists in a content plan matrix cell. Shows status-specific labels: Planned, In Progress, Approved, Published. Prevents duplicate orders for already-planned content.
**Files:** `src/hooks/useClientData.ts`, `src/components/ClientDashboard.tsx`, `src/components/client/StrategyTab.tsx`

**Agency value:** Clients won't order briefs for topics that are already in the content plan pipeline.

**Client value:** Clear visibility that a gap is already being addressed by the content plan.

### 159. ROI Dashboard Matrix Content
**What it does:** Published matrix cells are now included in the ROI Dashboard's "Content ROI Attribution" section. Deduplicates against content requests by keyword. Matrix-sourced items show a violet "Content Plan" badge. Traffic value attributed via GSC clicks × SEMRush CPC.
**Files:** `server/roi.ts`, `src/components/client/ROIDashboard.tsx`

**Agency value:** ROI calculations include all content — not just ordered briefs — giving a more complete picture.

**Client value:** See the full ROI of their content investment including planned content.

### 160. Client Portal Noise Reduction
**What it does:** Tabs and UI elements that have no data are now hidden from the client portal navigation instead of showing empty states. Content Plan tab only appears when matrices exist. ROI tab only appears when keyword strategy data is loaded (prerequisite for ROI calculation). All overview sections (stat cards, action banners, insights, activity timeline, content opportunities) already return null when no data — verified and confirmed.
**Files:** `src/components/ClientDashboard.tsx`

**Agency value:** Cleaner portal presentation — clients only see features that are active and relevant to their workspace.

**Client value:** No confusing empty tabs or blank sections. The portal adapts to what's actually configured.

### 161. Site Architecture — Planned URLs from Matrices
**What it does:** The Site Architecture Planner now correctly displays planned URLs from content matrices with a purple "Planned" badge. Bug fixes: (1) published matrix cells no longer show as "Planned" — they're already captured as "existing" from Webflow/sitemap; (2) source priority enforced so "existing" pages can't be overwritten by lower-priority sources (planned/strategy/gap).
**Files:** `server/site-architecture.ts`, `src/components/SiteArchitecture.tsx`

**Agency value:** Site architecture tree shows the full picture — live pages and planned content together.

**Client value:** Visual confirmation that content gaps are being addressed by planned content.

### 162. Content Performance — Matrix-Published Content Tracking
**What it does:** The Content Performance view now includes published matrix cells alongside content requests. Deduplicates by keyword. Matrix-sourced items show a violet "Content Plan" badge and include GSC/GA4 metrics. Both admin and public (client) endpoints return the combined data.
**Files:** `server/routes/content-requests.ts` (`handleContentPerformance`), `src/components/ContentPerformance.tsx`

**Agency value:** Performance tracking covers all published content — not just ordered briefs.

**Client value:** See how all published content is performing in search, including content plan pages.

### 163. Inbox — Content Plan Reviews
**What it does:** The client Inbox now includes a "Content Plan" filter section showing matrix cells with status 'review' or 'flagged'. Clients can flag cells for changes with a comment (calls existing flag endpoint). Review cells show keyword, planned URL, matrix name, variable values, and status badge. Filter button shows count badge when items need attention.
**Files:** `src/hooks/useClientData.ts` (`ContentPlanReviewCell` type + state), `src/components/client/InboxTab.tsx`, `src/components/ClientDashboard.tsx`

**Agency value:** Content plan reviews surface in the Inbox alongside other action items — no separate workflow needed.

**Client value:** Review and flag content plan items from the same Inbox used for SEO changes and requests.

### 164. Strategy → Content Planner Action Bridge
**What it does:** Two-way navigation between Keyword Strategy and Content Planner. Admin: "Add to Planner" button on content gaps navigates to Content Pipeline with keyword pre-filled. Client: "Planned" badges on strategy content gaps are now clickable buttons that switch to the Content Plan tab.
**Files:** `src/components/strategy/ContentGaps.tsx`, `src/components/client/StrategyTab.tsx`, `src/components/ClientDashboard.tsx`

**Agency value:** One-click from strategy gap to content planner — no copy-paste or context switching.

**Client value:** Clickable badges confirm planned content and navigate directly to the content plan.

### 165. Notification Bell — Content Plan Review Alerts
**What it does:** The admin notification bell now surfaces content plan cells that need review (status 'review' or 'flagged'). Workspace overview endpoint includes `contentPlan.review` count. Notification shows violet Layers icon with cell count and links to Content Pipeline.
**Files:** `server/routes/workspaces.ts`, `src/components/NotificationBell.tsx`

**Agency value:** Flagged content plan cells surface alongside other action items — nothing falls through the cracks.

### 166. Content Calendar — Matrix Cell Entries
**What it does:** Matrix cells now appear on the Content Calendar alongside briefs, posts, and requests. Cells are dated using linked post/brief dates when available, or matrix updatedAt as fallback. New violet "Matrix Cell" type with Layers icon. Filter pill, stat card, and status icons added. Published matrix cells count toward the "Published" stat.
**Files:** `src/components/ContentCalendar.tsx`

**Agency value:** Calendar shows the full content picture — briefs, posts, requests, and matrix cells together.

### 167. Content Pipeline — Health Summary Bar
**What it does:** Thin summary bar at the top of the Content Pipeline page showing aggregate stats: brief count, post count, matrix count, cell count with publish percentage. Conditionally rendered when any content exists. Uses existing API data with no new endpoints.
**Files:** `src/components/ContentPipeline.tsx`

**Agency value:** Instant pipeline context without navigating into individual tabs.

### 168. Matrix Cell Status Timeline
**What it does:** Each content matrix cell now records a `statusHistory` array tracking every status transition with timestamps. When a cell's status changes via `updateMatrixCell()`, the server automatically appends `{ from, to, at }` to the history. The CellDetailPanel renders a vertical mini timeline (newest-first) with color-coded dots per status, human-readable relative timestamps ("3d ago", "yesterday"), and the vertical connector line between entries.
**Files:** `shared/types/content.ts` (`StatusHistoryEntry`), `src/components/matrix/types.ts` (mirror), `server/content-matrices.ts` (auto-record), `src/components/matrix/CellDetailPanel.tsx` (timeline UI)

**Agency value:** Full audit trail of cell progression — see at a glance when each cell moved through planned → keyword validated → brief generated → review → published.

### 169. Architecture-Aware Schema Breadcrumbs
**What it does:** Schema BreadcrumbList generation now uses the site architecture tree instead of naive URL-segment guessing. When the architecture tree is available, `injectCrossReferences()` calls `getAncestorChain()` to build a full breadcrumb chain (e.g., Home → Services → SEO → Local SEO) with correct page names from the tree. Falls back to the previous 2-item breadcrumb (Home → Page) when architecture data isn't available. Architecture results are cached for 10 minutes via `getCachedArchitecture()` to avoid duplicate Webflow API + sitemap calls. Also adds `flattenTree()` and `invalidateArchitectureCache()` helpers used by downstream features.
**Files:** `server/site-architecture.ts` (`getAncestorChain`, `flattenTree`, `getCachedArchitecture`, `invalidateArchitectureCache`), `server/schema-suggester.ts` (`SchemaContext._architectureTree`, breadcrumb logic), `server/routes/webflow-schema.ts` (architecture loading), `server/routes/jobs.ts` (bulk schema architecture loading)

**Agency value:** Deterministic, accurate breadcrumbs without AI token cost. Deep pages get full ancestor chains instead of flat Home → Page. Foundation for architecture→schema integration (coverage dashboard, priority queue, competitive intelligence).

### 170. Unified Schema Plan with Architecture Tree
**What it does:** `generateSchemaPlan()` now accepts an optional `architectureResult` via `PlanContext`. When the architecture tree is available, the plan derives its page list from `flattenTree()` instead of making duplicate Webflow API + sitemap calls. The page list is enriched with `pageType` and `depth` from the tree, giving the AI better hints for role assignment (e.g., `type: service` in the prompt). Falls back to the original direct-fetch behavior when architecture data isn't available. The schema plan route handler loads the cached architecture tree and passes it through.
**Files:** `server/schema-plan.ts` (`PlanContext.architectureResult`, `PageListItem.pageType/depth`, tree-based page list generation), `server/routes/webflow-schema.ts` (architecture loading for plan endpoint)

**Agency value:** Eliminates redundant Webflow API + sitemap calls during plan generation (reuses cached architecture tree). Richer AI context from tree metadata produces more accurate role assignments.

### 171. SiteNavigationElement Auto-Gen for Homepage
**What it does:** When generating schema for the homepage and the architecture tree is available, automatically injects a `SiteNavigationElement` JSON-LD node listing the top-level navigation items (depth-1 children of the tree root). Only includes existing pages with content, capped at 10 items. Skips injection if a `SiteNavigationElement` already exists in the schema. Zero AI token cost — purely deterministic from the tree structure.
**Files:** `server/schema-suggester.ts` (SiteNavigationElement injection in `injectCrossReferences()`)

**Agency value:** Homepage schema gains structured navigation data that Google uses for sitelinks. Fully automatic — no manual configuration needed. Updates when architecture tree changes.

### 172. Schema Coverage Dashboard
**What it does:** Cross-references the site architecture tree with the latest schema snapshot to show which pages have schema markup and which don't. Server endpoint `GET /api/site-architecture/:wsId/schema-coverage` returns per-page coverage data including schema types and plan roles. Frontend adds: (1) a "Schema Coverage" stat card with percentage + color-coded icon, (2) per-node schema badges in the URL tree (green checkmark with type count or gray X), (3) a "Missing Schema" sidebar panel listing uncovered pages for quick action.
**Files:** `server/routes/site-architecture.ts` (coverage endpoint), `src/api/content.ts` (API client), `src/components/SiteArchitecture.tsx` (stat card, tree badges, missing-schema panel)

**Agency value:** Instant visibility into schema gaps across the site. Admins can see at a glance which pages need schema work, prioritize accordingly, and track progress as coverage increases.

### 173. Internal Link Health → Schema Priority Queue
**What it does:** Enriches the schema coverage endpoint with internal link health data (`PageLinkHealth` from `performance-store.ts`) and computes a per-page schema priority score. Priority tiers: **Critical** (orphan + no schema), **High** (< 3 inbound links + no schema), **Medium** (no schema but decent links), **Low** (has schema but poor link health). The API returns a `priorityQueue` array sorted critical → high → medium → low. Frontend displays a "Schema Priority Queue" sidebar panel in the SiteArchitecture view with priority badges, orphan indicators, and inbound link counts.
**Files:** `server/routes/site-architecture.ts` (link health cross-reference + priority scoring), `src/api/content.ts` (updated types), `src/components/SiteArchitecture.tsx` (priority queue panel with Zap icon, priority badges, orphan tags)

**Agency value:** Answers "which page should I add schema to next?" by combining two signals — pages that are both poorly linked AND missing schema are the highest priority. Eliminates guesswork in schema deployment order.

### 174. Schema Impact Tracking via GSC Before/After
**What it does:** Tracks the performance impact of schema deployments by correlating `recordSeoChange()` timestamps with Google Search Console data. Added `sourceFilter` param to `getSeoChangeImpact()` so it can filter to schema-only changes. New `getSchemaImpactSummary()` function aggregates schema deployments into avg deltas for clicks, impressions, CTR, and position. New endpoint `GET /api/schema-impact/:workspaceId` returns the summary. Frontend adds a collapsible "Schema Impact" panel in SchemaSuggester between summary cards and the page list — shows aggregate delta stats, plus per-deployment before/after comparison with trend indicators. Changes < 7 days old show "Too recent" since GSC data has a ~3 day delay.
**Files:** `server/seo-change-tracker.ts` (`getSchemaImpactSummary`, `SchemaImpactSummary`, source filter on `getSeoChangeImpact`), `server/routes/seo-change-tracker.ts` (new `/api/schema-impact/:wsId` endpoint, `?source=` filter on existing impact endpoint), `src/api/seo.ts` (`schemaImpact` API client, typed interfaces), `src/components/SchemaSuggester.tsx` (impact panel with aggregate stats, per-deployment list, trend indicators)

**Agency value:** Proves schema ROI to clients with real GSC data. Shows avg click/position deltas across all schema deployments, plus per-page breakdowns. Converts "did schema help?" from a guess into a measurable metric.

---

### 175. Title/Meta A/B Variants
**What it does:** Content brief generation now produces 3 title variants and 3 meta description variants alongside the primary suggestions. Stored in `title_variants` and `meta_desc_variants` TEXT (JSON) columns on `content_briefs`. The AI prompt requests variants optimized for different angles: CTR, keyword density, and emotional appeal. **Variant picker UI** in BriefDetail shows alternatives below the primary title/meta with "click to use" action — clicking swaps the selected variant into the primary field and demotes the old primary into the variants array, preserving all options. Regenerated briefs also produce variants.
**Files:** `server/db/migrations/027-brief-variants.sql`, `server/content-brief.ts` (prompt, rowToBrief, briefToParams, INSERT/UPDATE), `shared/types/content.ts` (ContentBrief), `src/components/briefs/BriefDetail.tsx` (variant picker), `src/components/briefs/BriefList.tsx` (prop passthrough), `src/components/ContentBriefs.tsx` (interface)

**Agency value:** No more manually brainstorming title alternatives — AI generates 3 angles per brief. Quick A/B testing of different messaging approaches without regenerating the entire brief.

---

### 176. Outline-Only Regeneration
**What it does:** Regenerates just the content outline of an existing brief while preserving all other fields (title, meta, keywords, audience, etc.). `regenerateOutline()` in `server/content-brief.ts` loads the existing brief, sends the current outline + optional user feedback to GPT-4.1, and returns a new outline with heading/notes/wordCount/keywords per section. Atomic update via `updateBrief()`. Endpoint: `POST /api/content-briefs/:wid/:bid/regenerate-outline`. **UI**: teal "Regenerate Outline" button next to the Content Outline header in BriefDetail, with optional feedback textarea for guiding the regeneration (e.g., "Add a comparison section" or "Make it more technical").
**Files:** `server/content-brief.ts` (`regenerateOutline`), `server/routes/content-briefs.ts` (endpoint), `src/api/content.ts` (`regenerateOutline`), `src/components/briefs/BriefDetail.tsx` (button + feedback form), `src/components/briefs/BriefList.tsx` (prop passthrough), `src/components/ContentBriefs.tsx` (handler + state)

**Agency value:** Iterate on brief structure without losing the strategic research (keywords, audience, competitive analysis). Common scenario: brief is good but the outline needs reworking for a different angle.

---

### 177. Brand Voice Scoring
**What it does:** After a content post is generated, a "Score Voice" button in ContentManager triggers GPT-4.1 evaluation of the post against the workspace's brand voice context. Evaluates 4 dimensions: voice consistency, keyword integration, audience alignment, and tone consistency — each scored 0-100, averaged into a composite `voiceScore`. Detailed `voiceFeedback` text explains strengths and areas for improvement. Stored in `voice_score INTEGER` and `voice_feedback TEXT` on `content_posts`. **UI**: blue "Score Voice" button in post list (data color per Three Laws), inline MetricRing (20px) showing score next to post metadata, expandable feedback panel with 36px MetricRing and full feedback text. Re-score button available after initial scoring.
**Files:** `server/db/migrations/028-post-voice-score.sql`, `server/content-posts-ai.ts` (`scoreVoiceMatch`), `server/content-posts-db.ts` (row mapping), `server/routes/content-posts.ts` (endpoint), `shared/types/content.ts` (GeneratedPost), `src/api/content.ts` (`scoreVoice`), `src/components/ContentManager.tsx` (scoring UI + MetricRing display + feedback panel)

**Agency value:** Objective measurement of how well AI-generated content matches the client's brand voice. Identifies specific areas where the content diverges from the intended tone, enabling targeted editing rather than full rewrites.

**Client value:** Confidence that content maintains their brand identity. The score provides transparency into content quality beyond just keyword optimization.

---

### 178. Client Keyword Requests
**What it does:** Clients can now submit keyword ideas through the "Suggest a Keyword" section in their Strategy tab, not just approve/decline AI-suggested ones. Submitted keywords get `status: 'requested'` in the `keyword_feedback` table (expanded CHECK constraint via migration 029). During strategy generation, requested keywords are injected into the AI prompt as high-priority items and added to the keyword pool. If no existing page covers a requested keyword, it MUST appear as a content gap. Client UI shows submitted suggestions with pending status badges.
**Files:** `server/db/migrations/029-keyword-requested.sql`, `server/routes/keyword-strategy.ts` (schema, `getRequestedKeywords`, prompt injection, pool injection), `server/routes/public-portal.ts` (validation update), `src/components/client/StrategyTab.tsx` (Suggest a Keyword section)

**Agency value:** Clients become active participants in keyword strategy. Their domain expertise surfaces keywords the AI might miss.

**Client value:** Direct influence over SEO strategy — submit keyword ideas and see them prioritized in the next generation.

---

### 179. SERP Feature Targeting Recommendations
**What it does:** Content gaps with SERP feature opportunities (featured snippets, PAA, video, local pack) now include actionable targeting recommendations. Post-processing step after SERP enrichment generates specific content structuring advice per feature type: definition/list formatting for featured snippets, FAQ sections for PAA, video embedding for video carousels, and NAP/schema markup for local pack. Displayed as yellow recommendation text below SERP feature badges in ContentGaps component.
**Files:** `server/routes/keyword-strategy.ts` (serpTargeting post-processing), `shared/types/workspace.ts` (ContentGap.serpTargeting), `src/components/strategy/ContentGaps.tsx` (targeting display)

**Agency value:** Turns SERP feature data from "interesting" to "actionable." Each content gap with a SERP opportunity now tells you exactly what to do to win it.

---

### 180. Strategy Diff — What Changed
**What it does:** Tracks strategy changes across generations. Before saving a new strategy, the previous version is archived to `strategy_history` table (keeps last 5). New diff endpoint (`GET /api/webflow/keyword-strategy/:wid/diff`) computes: new/lost site keywords, new/resolved content gaps, and page keyword reassignments. Collapsible "What Changed" panel in KeywordStrategy shows all changes with green/red/amber color coding. Only appears when changes exist.
**Files:** `server/db/migrations/030-strategy-history.sql`, `server/routes/keyword-strategy.ts` (history save, prune, diff endpoint), `src/api/seo.ts` (strategyDiff, StrategyDiff type), `src/components/strategy/StrategyDiff.tsx` (new component), `src/components/KeywordStrategy.tsx` (integration)

**Agency value:** Answers "what changed since last time?" without manually comparing. Shows strategy evolution over time. Proves the value of re-running strategy as data improves.

---

### 181. Prioritized Quick Wins with ROI Scoring
**What it does:** Quick wins are now scored and sorted by estimated ROI. Score formula: `(volume × (1 - difficulty/100)) / position` — favoring high-volume, low-difficulty keywords on pages that are close to ranking well. Falls back to impact-level estimates when volume data isn't available. ROI score displayed as a blue data badge next to the impact badge in the QuickWins component.
**Files:** `server/routes/keyword-strategy.ts` (ROI scoring + sorting), `shared/types/workspace.ts` (QuickWin.roiScore), `src/components/strategy/QuickWins.tsx` (ROI badge display)

**Agency value:** Quick wins are no longer just "high/medium/low" — they're quantified by potential return. The highest-ROI fix is always at the top.

---

### 182. DataForSEO Provider + SEO Data Abstraction Layer
**What it does:** Adds a provider-agnostic SEO data layer allowing per-workspace selection of SEMRush or DataForSEO. `SeoDataProvider` interface (9 methods: keyword metrics, related/question keywords, domain keywords/overview, competitors, keyword gap, backlinks overview, referring domains) with a registry supporting preferred + fallback resolution. `SemrushProvider` wraps existing semrush.ts with zero behavior change. `DataForSeoProvider` implements full API client with Basic auth, per-workspace file cache (`.dataforseo-cache/`), disk-based credit tracking, and circuit breaker. Workspace-level `seoDataProvider` preference stored in SQLite. Provider toggle UI in KeywordStrategy settings panel (visible when both providers configured). Strategy generator and all SEO consumers wired through abstraction layer. Provider status endpoint and DataForSEO usage tracking in AI usage dashboard.
**Files:** `server/seo-data-provider.ts` (interface + registry), `server/providers/semrush-provider.ts`, `server/providers/dataforseo-provider.ts`, `server/db/migrations/031-seo-data-provider.sql`, `server/app.ts` (registration), `server/routes/keyword-strategy.ts` (consumer wiring), `server/routes/semrush.ts` (status endpoint), `server/routes/ai.ts` (usage tracking), `server/workspaces.ts` (column mapping), `shared/types/workspace.ts`, `src/api/seo.ts`, `src/components/KeywordStrategy.tsx` (toggle UI)

**Agency value:** ~70-80% API cost reduction by switching to DataForSEO (~$50-150/mo vs SEMRush ~$430/mo). Per-workspace flexibility — can keep SEMRush for high-priority clients and use DataForSEO for others. Zero lock-in with provider abstraction.

**Client value:** Same quality keyword data and competitive intelligence at lower cost. Provider choice is transparent to the client experience.

**Mutual:** Cost savings fund more client work or better tooling. Abstraction layer future-proofs against any single API vendor's pricing changes.

---

### 253. Feature Library Dashboard
**What it does:** Admin-facing internal sales reference page at `/features` powered by `data/features.json`. Shows 60 curated, sales-relevant features with two toggleable views: By Pain Point (groups features under common prospect questions like "When they ask about site health") and By Platform Area (groups by category). Instant search across titles, descriptions, and tags. Feature cards show tier badges (free/growth/premium/admin), impact indicators, and client-facing flags. Accessible from Command Center header nav and Command Palette (Cmd+K). `data/features.json` is maintained alongside `FEATURE_AUDIT.md` via the post-task checklist and cascade update prompt.
**Files:** `data/features.json`, `shared/types/features.ts`, `server/routes/features.ts`, `src/api/misc.ts`, `src/components/FeatureLibrary.tsx`, `src/routes.ts`, `src/App.tsx`, `src/components/WorkspaceOverview.tsx`, `src/components/CommandPalette.tsx`

**Agency value:** During sales calls, instantly find the right feature to mention for any prospect question. No more scrolling through 2,900 lines of FEATURE_AUDIT.md — search or browse by pain point.

**Client value:** N/A — internal agency tool.

**Mutual:** Better sales conversations lead to better-matched clients who actually use the platform's capabilities.

---

## Platform Features — Continued

### 116. Brief Regeneration with Feedback
**What it does:** Regenerate an existing content brief with user instructions. AI receives the previous brief + feedback, produces a refined version. New brief gets a new ID — original is preserved for version history. Purple "Regenerate" button in BriefDetail with inline feedback textarea.
**Files:** `server/content-brief.ts` (`regenerateBrief`), `server/routes/content-briefs.ts`, `src/components/briefs/BriefDetail.tsx`, `src/components/ContentBriefs.tsx`

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 117. Client Brief Export (Download)
**What it does:** Clients can download content briefs as branded HTML files from the content tab. Public endpoint `GET /api/public/content-brief/:wsId/:briefId/export` returns the brief rendered via `renderBriefHTML` with Content-Disposition attachment header.
**Files:** `server/routes/public-content.ts`, `src/components/client/ContentTab.tsx`

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 118. Data Export / Portability (CSV/JSON)
**What it does:** Admin can export workspace data (content briefs, content requests, keyword strategy, activity log, payments) as CSV or JSON. "Data Export" tab added to Workspace Settings with download buttons for each dataset.
**Files:** `server/routes/data-export.ts` (new), `server/app.ts`, `src/components/WorkspaceSettings.tsx`

**Agency value:** Faster navigation and better operational visibility.

**Client value:** N/A — admin-only feature.

**Mutual:** Reduced friction in daily platform usage.


### 119. Revenue Analytics Dashboard
**What it does:** Admin-only dashboard showing total revenue, current month vs previous month, revenue by client, revenue by product type, monthly trend chart (12 months), and recent transactions table. Accessible via DollarSign icon in sidebar utility bar and emerald "Revenue" button in Command Center header at `/revenue`. Only displays webhook-confirmed paid transactions.
**Files:** `server/routes/revenue.ts` (new), `server/payments.ts` (`listAllPayments`), `server/app.ts`, `src/components/RevenueDashboard.tsx` (new), `src/components/WorkspaceOverview.tsx` (header button), `src/App.tsx`, `src/routes.ts`

**Agency value:** Better visibility into platform economics and ROI metrics.

**Client value:** Actionable intelligence derived from real search and traffic data.

**Mutual:** Data-driven decisions backed by automated analysis.


### 120. Sidebar Tool Tooltips
**What it does:** Every sidebar navigation item now has a descriptive tooltip (via `title` attribute) explaining what that tool does. Descriptions added to all items across Analytics, Site Health, SEO, and Content groups.
**Files:** `src/App.tsx` (navGroups type + desc field + title rendering)

**Agency value:** Faster navigation and better operational visibility.

**Client value:** N/A — admin-only feature.

**Mutual:** Reduced friction in daily platform usage.


### 121. WorkspaceHome Data Freshness Indicators
**What it does:** Dashboard header shows relative "last updated" timestamp (e.g. "Just now", "5m ago") with Clock icon. Turns amber when data is >1 hour stale. Manual "Refresh" button re-fetches all data sources. 30-second tick keeps relative time accurate.
**Files:** `src/components/WorkspaceHome.tsx`

**Agency value:** Faster navigation and better operational visibility.

**Client value:** N/A — admin-only feature.

**Mutual:** Reduced friction in daily platform usage.


### 122. Consistent Back Navigation
**What it does:** ArrowLeft back button appears in breadcrumb bar when viewing a workspace tab (not home). Clicking it navigates back to workspace home. Provides consistent spatial navigation alongside the breadcrumb hierarchy.
**Files:** `src/App.tsx`

**Agency value:** Faster navigation and better operational visibility.

**Client value:** N/A — admin-only feature.

**Mutual:** Reduced friction in daily platform usage.


### 123. Brand Documents Upload UI
**What it does:** Drag-and-drop upload zone for .txt/.md brand documents in the Brand & AI hub. Files are stored in the workspace's `brand-docs/` folder and automatically injected into all AI prompts via `readBrandDocs()`. Supports upload, list with file sizes, and delete with hover-reveal X button.
**Files:** `server/routes/brand-docs.ts` (new), `server/app.ts`, `src/components/BrandHub.tsx`

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 124. SEO Education Tips (Per-Tab First-Visit)
**What it does:** Contextual SEO education tips appear on first visit to each client dashboard tab. Each tip explains what the tab shows and why it matters, with an expandable "Learn more" section for SEO basics. Dismissible with "Got it" — state persisted in localStorage per workspace+tab. Covers overview, performance, health, strategy, content, and ROI tabs.
**Files:** `src/components/client/SeoEducationTip.tsx` (new), `src/components/ClientDashboard.tsx`

**Agency value:** Fewer support questions. Clients learn SEO concepts in context.

**Client value:** Plain-language explanations for every metric and tool.

**Mutual:** Knowledge transfer happens passively through platform usage.


### 125. Bundle Optimization & Dependency Audit
**What it does:** Verified Lucide tree-shaking (each icon individually code-split), added vendor chunk splitting via `manualChunks` in Vite config (react-vendor, stripe), and lazy-loaded StripePaymentForm so the Stripe SDK only loads when a payment is initiated. Main bundle split from 366 kB into 188 kB (app) + 190 kB (react-vendor) for independent caching. ClientDashboard reduced from 379 → 359 kB by extracting Stripe into a 13 kB lazy chunk. Total JS unchanged (~1,947 kB) but initial page load and long-term caching significantly improved.
**Files:** `vite.config.ts` (manualChunks), `src/components/ClientDashboard.tsx` (lazy Stripe import)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 126. Lightweight Backlink Profile Overview
**What it does:** Domain-level backlink profile section in the Strategy tab powered by SEMRush Backlinks API. Shows total backlinks, referring domains, follow/nofollow ratio, link types (text/image), and a sortable table of top 15 referring domains with backlink counts and first/last seen dates. Domains are clickable external links. Data cached for 48 hours. Gracefully handles missing SEMRush config with an informational message.
**Files:** `server/semrush.ts` (`getBacklinksOverview`, `getTopReferringDomains`), `server/routes/backlinks.ts` (new), `server/app.ts`, `src/components/strategy/BacklinkProfile.tsx` (new), `src/components/KeywordStrategy.tsx`

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 127. Bulk Page Operations in SEO Editor
**What it does:** Multi-select pages in the SEO Editor and apply bulk operations. Two modes: (1) Pattern Apply — append/prepend text to selected pages' titles or descriptions with instant preview and length-aware truncation. (2) Bulk AI Rewrite — concurrent AI rewriting (3 at a time) with dry-run preview showing old→new diff for each page before committing. Toolbar appears when pages are selected with field picker, action buttons, and progress bar during application. Both modes push changes to Webflow via the existing SEO update API.
**Files:** `server/routes/webflow-seo.ts` (2 new POST routes: `seo-pattern-apply`, `seo-bulk-rewrite`), `shared/types/workspace.ts` (extended `source` union), `src/components/SeoEditor.tsx` (bulk state, handlers, toolbar + preview UI)

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


### 128. Competitive Intelligence Hub
**What it does:** SEMRush-powered competitive intelligence section in the Strategy tab. Fetches domain overview metrics (organic traffic, keywords, traffic value), backlink data, keyword gaps, and top keywords for your domain vs up to 3 competitors — all in parallel. UI shows stat cards for your domain, expandable competitor panels with side-by-side comparison bars (traffic, keywords, referring domains, traffic value), competitor top keywords table, and a collapsible keyword gaps section sorted by traffic potential. Requires SEMRush in "full" mode with competitor domains configured.
**Files:** `server/semrush.ts` (`getDomainOverview` — new `domain_ranks` API function), `server/routes/semrush.ts` (new `GET /api/semrush/competitive-intel/:workspaceId`), `src/components/strategy/CompetitiveIntel.tsx` (new), `src/components/KeywordStrategy.tsx`

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 129. AI Internal Linking Engine Enhancements
**What it does:** Extends the internal linking analysis with orphan page detection and per-page link health scoring. Each page gets a 0-100 health score based on inbound + outbound link counts. Orphan pages (zero inbound links, excluding homepage) are flagged with a dedicated expandable warning section showing path, title, and outbound count. Frontend adds: 5-column stat bar (High/Medium/Low priority + Orphan Pages + Avg Link Score), collapsible orphan pages panel, list/grouped view toggle (group suggestions by source page for batch implementation), and one-click copy-to-clipboard for HTML link snippets (`<a href="...">anchor</a>`).
**Files:** `server/internal-links.ts` (`PageLinkHealth` interface, orphan detection, per-page scoring), `src/components/InternalLinks.tsx` (orphan UI, grouped view, copy buttons)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 133. Pattern-Based Audit Suppression
**What it does:** Extends the audit suppression system to support glob-pattern matching (e.g., `blog/*`, `resources/*`) in addition to per-page exact-slug suppressions. When viewing an audit issue on a page with a path prefix (e.g., `blog/some-post`), the overflow menu now shows a "Suppress for blog/*" button that creates a single pattern-based suppression matching all pages under that prefix. Pattern suppressions are applied both server-side (in `applySuppressionsToAudit`) and client-side (in the `effectiveData` memo) using a `globToRegex` converter. The suppression badge distinguishes "X page + Y pattern suppressed". Unsuppress-all properly handles both types.
**Files:** `server/helpers.ts` (`globToRegex`, `AuditSuppression.pagePattern`, updated `applySuppressionsToAudit`), `server/routes/workspaces.ts` (POST/DELETE support `pagePattern`), `shared/types/workspace.ts` (`pagePattern` field), `src/components/SeoAudit.tsx` (`suppressPattern` handler, pattern-aware `effectiveData` memo, updated unsuppress-all), `src/components/audit/AuditIssueRow.tsx` (`onSuppressPattern` prop, "Suppress for prefix/*" menu item), `src/components/audit/AuditBatchActions.tsx` (pattern-aware badge display)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 131. SEO Audit: Visibility-Aware Content Checks
**What it does:** Adds a `stripHiddenElements()` pre-processing step to the SEO audit engine that removes elements hidden via `display:none`, `visibility:hidden`, or Webflow's `w-condition-invisible` class before running content checks. This eliminates false-positive "duplicate H1" warnings on pages with conditional CMS hero sections (e.g., two hero blocks where only one is visible based on resource type). Also improves accuracy of heading hierarchy, img-alt, content length, internal links, link text, and AEO answer-first checks by only analyzing visible content. Technical/head checks (canonical, viewport, robots, schema, HTML size, etc.) still run against full HTML.
**Files:** `server/seo-audit-html.ts` (`stripHiddenElements` — new export), `server/audit-page.ts` (imports `stripHiddenElements`, creates `visibleHtml` before content checks)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 137. AEO Review: Full-Site Page Discovery (Static + CMS)
**What it does:** Fixes the AEO page analysis batch review to include CMS collection pages (blog posts, resources, etc.), not just Webflow static pages. Previously, the batch route only pulled pages from the audit snapshot that already had `aeo-` issues — if the sitemap failed during the audit or CMS pages had no existing AEO issues, they were silently excluded. Now the route discovers pages directly: (1) Static pages from the Webflow API, (2) CMS/collection pages from sitemap.xml. Pages are prioritized by content-type (blog/articles rank highest via `isContentPage()`) and existing AEO issue count, then the top N are sent for AI review. Falls back to audit snapshot pages if discovery fails.
**Files:** `server/routes/aeo-review.ts` (rewrote batch `/site` route with `listPages` + `discoverCmsUrls` discovery, priority scoring, fallback logic)

**Agency value:** Improves platform functionality and team efficiency.

**Client value:** Better platform experience.

**Mutual:** Compound improvements across the platform.


### 135. Noindex Page Awareness in SEO Audit
**What it does:** Pages marked with `<meta name="robots" content="noindex">` are now detected and handled specially: (1) Their issues are excluded from the site health score average — only indexed pages count. (2) The noindex detection issue itself is downgraded from `warning` to `info` severity (no score impact). (3) A "noindex" badge appears next to the page name in the audit list. (4) When expanded, a banner explains: "This page is marked noindex — issues listed below won't affect crawlability or search rankings and are excluded from the site health score." Issues are still shown for visibility so you can fix them if you later re-index the page.
**Files:** `server/audit-page.ts` (`noindex` flag on `PageSeoResult`, detection + info severity), `server/seo-audit.ts` (exclude noindex from `siteScore` average), `server/helpers.ts` (exclude noindex from suppression recalc), `src/components/audit/types.ts` (`noindex?: boolean` on interface), `src/components/SeoAudit.tsx` (noindex badge, expanded banner, exclude from `effectiveData` score)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 139. Schema Generator: Enhanced Validation & Auto-Fix
**What it does:** Adds comprehensive post-generation validation and auto-fix to the schema generator, catching issues that previously slipped through: (1) **Invalid property detection** — flags non-existent Schema.org properties commonly hallucinated by AI (`industry`, `founded`, `headquarters` on Organization; `features`, `benefits` on Service; etc.) and auto-strips them. (2) **Cross-reference validation** — verifies that Service→provider, WebPage→isPartOf, Article→publisher references point to real nodes in the @graph. (3) **Phone format validation** — detects malformed telephone values (missing separators, wrong digit count) and auto-removes them. (4) **Keyword-stuffing detection** — flags serviceType arrays with >3 entries and auto-trims to 3. (5) **Recommended field warnings** — surfaces missing-but-recommended fields (logo/sameAs on Organization, provider on Service, isPartOf on WebPage, etc.). (6) **Enhanced AI prompt** — 6 new rules instructing GPT to avoid invalid properties, use proper cross-references, format phone numbers correctly, and keep serviceType concise.
**Files:** `server/schema-suggester.ts` (added `RECOMMENDED_FIELDS`, `CROSS_REF_RULES`, `INVALID_PROPERTIES` maps, `isValidPhone()`, `autoFixSchema()`, enhanced `validateGraphNode()` with 6 validation categories, updated AI prompt with rules 21-26)

**Agency value:** Better structured data quality with less manual effort. Automated processes reduce schema deployment time.

**Client value:** Richer search result appearances and better Google understanding of site structure.

**Mutual:** Higher-quality structured data drives better search visibility for both sides.


### 138. AI Page Rewriter — Full-Page Split Chat
**What it does:** A dedicated full-page AI rewriting tool with a two-pane layout: chat on the left, an editable document panel on the right. Load any page from the workspace's sitemap via a searchable combobox or by pasting a URL. The tool fetches the page, extracts structured sections (`{ level, heading, body }[]`), and renders them in a formatted contenteditable document with heading hierarchy (H1–H4+) and audit issue chips. Chat with GPT-4.1 to get rewrite suggestions; AI rewrite messages show an editable suggestion block with an **Apply to [section]** button that patches the document in-place with a teal highlight fade. A floating formatting toolbar (Bold, Italic, H2, H3, Clear) appears above any text selection. **Export brief** serializes the live document to Markdown (Copy or Download). **Focus mode** toggle collapses the workspace sidebar so the rewriter fills the full browser width; Escape or the slim ◀ strip restores it. Quick-prompt buttons, conversation memory, and markdown rendering for non-rewrite messages are preserved.
**Files:** `server/routes/rewrite-chat.ts` (new `GET /:workspaceId/pages` endpoint; `extractPageSections` updated to return `{ level, heading, body }[]`; section-label prompt instruction), `src/components/PageRewriteChat.tsx` (sitemap combobox, contenteditable document panel via ref-callback init, floating toolbar via `selectionchange`, Apply handler with `data-section` targeting, Export serializer, focus toggle button), `src/components/layout/Sidebar.tsx` (`hidden` prop + slim 14px exit strip), `src/App.tsx` (`focusMode` state, Escape handler, layout constraint removal in focus mode), `tests/integration/rewrite-chat-pages.test.ts` (new — pages endpoint tests, port 13316), `tests/unit/rewrite-export-serializer.test.ts` (new — 4 tests for DOM→Markdown serializer). **Prompt standardization (April 2026):** System prompt (`baseInstructions`) wrapped with `buildSystemPrompt()` so voice DNA and custom notes automatically layer onto the rewrite expert persona. **Note for Copy & Brand Engine:** The `data-section` attribute on all document headings and the `applyToSection()` handler are the integration points for future inline text-selection targeting.

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 136. Fix Intermittent Suppress Button
**What it does:** Fixes the single-page "Suppress Issue" button in the audit overflow menu sometimes not firing. Root cause: click events could be swallowed during React re-renders before the handler executed. Fix: (1) All overflow menu item buttons now use `onMouseDown` with `e.stopPropagation()` instead of `onClick` — `mousedown` fires before any potential re-render can unmount the element. (2) Suppress callbacks now close the menu synchronously (`setActionMenuKey(null)`) before firing the async API call, matching the pattern used by "Send to Client" and "Add to Tasks" buttons.
**Files:** `src/components/audit/AuditIssueRow.tsx` (`OverflowMenu` buttons → `onMouseDown`, suppress callback wrappers close menu synchronously)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 134. Industry-Standard Audit Scoring & Page-Type-Aware Checks
**What it does:** Two improvements to the SEO audit scoring system: (1) Rebalances score deduction weights to match industry tools like SEMRush and Ahrefs — info/notice issues now have zero score impact, warning and error deductions are ~50% softer. A well-maintained site now scores 80-95 instead of 50-65. New weights: critical error -15 (was -20), other error -10 (was -12), critical warning -5 (was -10), moderate warning -3 (was -6), other warning -2 (was -4), info 0 (was -1). (2) Adds page-type detection via `isContentPage(slug)` — AEO editorial checks (author attribution, last-updated date, answer-first structure, external citations) now only run on content/article pages (blog/, articles/, resources/, guides/, etc.), not on homepages or service pages where they're irrelevant noise. Universal AEO checks (FAQ schema, hidden content, dark patterns) still run everywhere.
**Files:** `server/audit-page.ts` (`isContentPage()` export, AEO check gating, new scoring weights), `server/helpers.ts` (matching weights in `applySuppressionsToAudit`), `src/components/audit/types.ts` (scoring weight comments), `src/components/SeoAudit.tsx` (matching weights in `effectiveData` memo)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 132. Fix Cross-Workspace Audit Data Leakage
**What it does:** Fixes a bug where the admin SeoAudit page showed the same audit data (Swish Dental) on all workspaces. Root cause: the job-restoration logic in `SeoAudit.tsx` searched the global `jobs` array for any completed `seo-audit` job without filtering by `workspaceId`. Now both the `existingJob` and `runningJob` lookups filter by `j.workspaceId === workspaceId` so each workspace only sees its own audit jobs.
**Files:** `src/components/SeoAudit.tsx` (added `workspaceId` filter to job lookups at lines 362-368)

**Agency value:** Improves audit accuracy and reliability. More actionable results mean faster client value delivery.

**Client value:** More accurate site health data and recommendations. Fewer false positives mean clearer action items.

**Mutual:** Trust in the audit system — scores and recommendations reflect reality.


### 130. Sitemap-Based Link Discovery + Live Domain UI
**What it does:** Rewrites the internal links page discovery to use `/sitemap.xml` as the primary source, catching all CMS collection pages that the Webflow API misses. Falls back to Webflow API + crawl-based discovery if sitemap is unavailable. Caps at 100 pages for cost control. Adds browser-like User-Agent headers so Cloudflare doesn't block fetches from cloud IPs. Fixes double-protocol bug where liveDomain with `https://` prefix got another `https://` prepended. Adds `attemptedPageCount` tracking and context-aware diagnostic messaging (amber warnings for fetch failures vs green "no gaps" for genuine success). Adds editable Live Domain field to Workspace Settings → Connections tab so users can see and correct the domain used for crawling. Extracts real `<title>` tags from fetched pages for better naming.
**Files:** `server/internal-links.ts` (`fetchSitemapUrls`, `FETCH_HEADERS`, `attemptedPageCount`, baseUrl normalization), `src/components/InternalLinks.tsx` (diagnostic messaging), `src/components/settings/ConnectionsTab.tsx` (Live Domain field), `src/components/WorkspaceSettings.tsx` (saveLiveDomain prop)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 133. SEO Editor Per-Page Send to Client
**What it does:** Adds a per-page "Send to Client" button in SEO Editor alongside "Save to Webflow". When the admin edits a page's SEO title or description, they can send just that page's changes to the client approval queue without batch-selecting. Also renames the bulk approval button from "Send for Approval" to "Send to Client" for consistency with Schema Suggester. Uses the existing `/api/approvals/:workspaceId` endpoint with changed field detection.
**Files:** `src/components/SeoEditor.tsx` (sendPageToClient function, sendingPage/sentPage state), `src/components/editor/PageEditRow.tsx` (Send to Client button + new props), `src/components/editor/ApprovalPanel.tsx` (label rename)


**Agency value:** Send individual page changes to the client approval queue without batch-selecting. Faster workflow for one-off metadata fixes.

**Client value:** N/A — admin-only feature.

**Mutual:** More granular approval workflow — single-page changes don't need to wait for a batch.

### 134. Editable Workspace Name
**What it does:** Workspace Settings header now shows an inline-editable workspace name. Hover reveals a pencil icon; click to enter edit mode with Enter/Escape keyboard support and check/X button controls. Saves via PATCH `/api/workspaces/:id` with `{ name }`. Useful for removing unwanted suffixes (e.g. "AI") from workspace names that were auto-populated from Webflow site names.
**Files:** `src/components/WorkspaceSettings.tsx` (editingName/nameDraft/savingName state, inline edit UI with Pencil/Check/X icons)


**Agency value:** Fix workspace names that were auto-populated with unwanted suffixes from Webflow. Inline editing without navigating to a settings page.

**Client value:** N/A — admin-only feature.

**Mutual:** Clean workspace names improve the professionalism of the Command Center.

### 135. Schema Generator Page Type Selector
**What it does:** Three improvements to the Schema Generator: (1) All pages auto-load on mount so users see the full page list immediately without clicking "Single Page". (2) Each page row has a page type dropdown (Auto-detect, Homepage, Service, Pillar, Persona, Blog, About, Contact, Location, Product, Landing, FAQ, Case Study) that the user can set before generating schemas. (3) The selected page type is passed to the backend AI prompt as a "Page Type" hint, enabling more accurate schema generation — e.g. selecting "Service Page" ensures Service schema nodes, "FAQ" ensures FAQPage schema. Backend adds `SchemaPageType` type and `pageType` field to `SchemaContext`.
**Files:** `server/schema-suggester.ts` (SchemaPageType type, PAGE_TYPE_LABELS, pageType in SchemaContext + AI prompt), `server/routes/webflow-schema.ts` (accepts pageType in single-page endpoint), `src/components/SchemaSuggester.tsx` (pageTypes state, auto-load useEffect, initial view with page list + type selectors), `src/components/schema/PagePicker.tsx` (InitialPagePicker no longer used)


**Agency value:** Override AI auto-detection with explicit page type hints. All pages load on mount for faster schema generation workflow.

**Client value:** N/A — admin-only tool.

**Mutual:** More accurate schema generation from explicit page type context. Eliminates 'why did the AI generate Service schema on my blog?' confusion.

### 137. Schema Post-Processing Pipeline (Content Verification + AI Auto-Fix)
**What it does:** Adds a 7-step post-processing pipeline to schema generation that eliminates hallucinated data and fixes structural errors without manual intervention. (1) Content Verification cross-checks all factual claims (emails, phones, addresses, opening hours, geo coordinates, sameAs URLs) against the actual page HTML — anything not found in the source content is automatically stripped. (2) Programmatic cross-reference injection guarantees WebSite.publisher, WebPage.isPartOf, WebPage.mainEntity, Service/SoftwareApplication.provider, and Article.publisher are always present via @id references. (3) AI Auto-Fix Loop sends the schema + validation errors back to GPT-4.1-mini for one targeted correction pass if fixable errors remain. Also hardened email extraction to reject package names (e.g. "lumious-components@1.0.6") and phone extraction to use visible text only (stripped of script/style tags). Anti-fragmentation rules prevent the AI from creating separate Service nodes for product features.
**Files:** `server/schema-suggester.ts` (verifySchemaContent, injectCrossReferences, postProcessSchema pipeline, extractStructuredInfo hardening, prompt anti-fragmentation rules)


**Agency value:** 7-step automated pipeline catches hallucinated data, fixes structural errors, and verifies facts against page HTML — all without manual intervention.

**Client value:** N/A — admin-only improvement. Indirectly prevents broken schemas from reaching client sites.

**Mutual:** Production-ready schemas with minimal manual review. Content verification prevents fabricated contact info from being published.

### 138. Unified Site Template for Schema Generation
**What it does:** Two-phase schema generation per Google best practices. Homepage generation produces full Organization node (name, description, logo, knowsAbout, sameAs) and WebSite node, which are saved as the "site template" in SQLite. Subsequent subpage generations load the template and replace AI-generated Organization/WebSite with minimal stubs (@id, name, url only). This ensures consistent company info across all pages, saves AI tokens, and follows Google's recommendation to put full Organization markup only on the homepage. Missing Organization, WebSite, and BreadcrumbList nodes are auto-injected when absent. Falls back to current behavior if no template is saved yet.
**Files:** `server/db/migrations/012-schema-site-template.sql` (schema_site_templates table), `server/schema-store.ts` (saveSiteTemplate, getSiteTemplate), `server/schema-suggester.ts` (postProcessSchema template logic, injectCrossReferences node injection, prompt requirements 3-4 updated), `server/helpers.ts` (_siteId in buildSchemaContext)


**Agency value:** Consistent Organization/WebSite info across all pages without redundant AI generation. Follows Google best practices for entity distribution.

**Client value:** N/A — admin-only improvement. Indirectly improves schema consistency on client sites.

**Mutual:** Better structured data consistency + reduced AI token costs. Homepage gets full entities; subpages get efficient stubs.

### 136. Brand Name Resolution Fix
**What it does:** Fixes bug where Webflow's internal site name (e.g. "copy of Faros AI") was injected into AI-generated SEO titles, meta descriptions, and chat prompts instead of the actual business/workspace name. Introduces `getBrandName(ws)` helper that prioritizes `ws.name` over `ws.webflowSiteName` and strips "Copy of" prefix. Replaces all `webflowSiteName || name` patterns across 6 server files.
**Files:** `server/workspaces.ts` (getBrandName helper), `server/routes/webflow-seo.ts`, `server/routes/jobs.ts`, `server/seo-audit.ts`, `server/admin-chat-context.ts`, `server/routes/public-analytics.ts`


**Agency value:** AI-generated content now uses the actual business name instead of Webflow's internal site name. No more 'copy of Faros AI' in SEO titles.

**Client value:** Correct brand name in all AI outputs — titles, descriptions, chat prompts, and generated content.

**Mutual:** A small fix with outsized impact. Wrong brand names in SEO titles erode client trust instantly.

### 140. Send to Client for Standalone Content Briefs
**What it does:** Adds a "Send to Client" button on standalone content briefs (those not already linked to a content request). Clicking creates a linked content topic request with status `client_review` and sends an email notification. The button shows a loading spinner during the send operation and the brief's action bar updates after sending.
**Files:** `server/routes/content-briefs.ts` (POST `/:briefId/send-to-client` endpoint), `src/components/ContentBriefs.tsx` (`handleSendToClient`, `sendingToClient` state), `src/components/briefs/BriefList.tsx` (prop passthrough), `src/components/briefs/BriefDetail.tsx` (Send to Client button with loading state)

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 141. Professional Branded Blog Post PDF Export
**What it does:** Adds a branded, print-ready HTML export for blog posts matching the content brief export styling. Includes HMPSN Studio logo, teal accent branding, key metrics strip (word count, target, sections, status), SEO search engine preview, table of contents, full post content with styled headings/blockquotes/tables/code, review checklist with pass/pending indicators, and a branded footer. Print-ready with `@page` rules, page break management, and a floating "Save as PDF" bar. Available via "Export PDF" button (teal-accented) in the PostEditor toolbar.
**Files:** `server/post-export-html.ts` (new — `renderPostHTML`), `server/routes/content-posts.ts` (GET `/:postId/export/pdf` route), `src/components/PostEditor.tsx` (`exportPDF` function + button)

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 142. AI Auto-Review Checklist for Blog Posts
**What it does:** Adds an "AI Pre-Check" button to the review checklist panel in PostEditor. When clicked, sends the post content to GPT-4.1-mini which evaluates each of the 6 checklist items (factual accuracy, brand voice, internal links, no hallucinations, meta optimization, word count target) and returns pass/fail with a brief reason. Items that pass are auto-checked. Each checklist item shows an "AI: Pass" (green) or "AI: Review" (amber) badge with the AI's reasoning below it. Failed items get an amber-highlighted explanation to guide the reviewer.
**Files:** `server/routes/content-posts.ts` (POST `/:postId/ai-review` endpoint), `src/components/post-editor/ReviewChecklist.tsx` (`onRunAIReview` prop, `AIReviewResult` type, AI Pre-Check button, result badges/reasons), `src/api/content.ts` (`aiReview` method), `src/components/PostEditor.tsx` (wired `onRunAIReview` callback)

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 143. Page Type → Schema Type Mapping + Prompt Injection (D1)
**What it does:** Adds a deterministic `PAGE_TYPE_SCHEMA_MAP` constant that maps each `SchemaPageType` (homepage, service, blog, location, etc.) to recommended primary and secondary Schema.org types. When a page's type is known (not `'auto'`), the mapping is injected into the AI prompt as a `SCHEMA TYPE GUIDANCE` block, directing the model to focus on populating the recommended types with accurate properties rather than guessing which types to use. The `'auto'` mode remains unchanged — the AI decides types as before. The map is exported so other modules (D2, D3) can import it for template binding and hub page detection.
**Files:** `server/schema-suggester.ts` (`PAGE_TYPE_SCHEMA_MAP` constant, `schemaTypeGuidance` injection in `aiGenerateUnifiedSchema()`)


**Agency value:** Deterministic mapping from page types to Schema.org types eliminates AI guesswork for typed pages. Foundation for template binding and hub detection.

**Client value:** N/A — admin-only architectural improvement.

**Mutual:** More accurate schema generation with lower AI token costs for explicitly typed pages.

### 144. Template → Schema Template Binding (D2)
**What it does:** Binds Schema.org types to content templates so matrix cells inherit expected schema types. Adds `schemaTypes?: string[]` to `ContentTemplate` and `expectedSchemaTypes?: string[]` to `MatrixCell`. When a template is created or updated, `schemaTypes` is auto-populated from `PAGE_TYPE_SCHEMA_MAP` based on the template's `pageType` (unless explicitly overridden). When matrix cells are generated, they inherit the template's schema types as `expectedSchemaTypes`. The CellDetailPanel UI displays purple badges for each expected schema type. A new `getSchemaTypesForTemplate()` helper is exported for use by D7 (pre-generation). A DB migration (017) adds the `schema_types` column to `content_templates`.
**Files:** `shared/types/content.ts`, `src/components/matrix/types.ts`, `server/content-matrices.ts` (`getSchemaTypesForTemplate`, `generateCells` schema inheritance), `server/content-templates.ts` (auto-populate on create/update), `src/components/matrix/CellDetailPanel.tsx` (schema badge display), `server/db/migrations/017-template-schema-types.sql`


**Agency value:** Content templates automatically carry schema type expectations to matrix cells. Every planned page knows what structured data it should have before generation starts.

**Client value:** N/A — admin-only feature. Purple badges show expected schema types on each cell.

**Mutual:** Schema planning happens at template definition time, not after content is published.

### 145. Hub Page → CollectionPage/ItemList Auto-Suggest (D3)
**What it does:** Automatically detects hub pages (pages with 2+ existing child pages in the architecture tree) and injects `CollectionPage` schema with an `ItemList` of child page references. Adds a `getChildNodes()` helper to `site-architecture.ts` that finds a node by path and returns its direct children with content. In `injectCrossReferences()`, when the architecture tree is available, the current page's children are counted — if there are 2 or more existing child pages, a `CollectionPage` node is added to the `@graph` with `hasPart` listing each child as a `ListItem` with position, URL, and name. Only existing pages (not planned) are included. Gracefully skips if no architecture tree is available or if CollectionPage/ItemList already exists.
**Files:** `server/site-architecture.ts` (`getChildNodes()` helper), `server/schema-suggester.ts` (hub page detection + CollectionPage injection in `injectCrossReferences()`)


**Agency value:** Automatic CollectionPage/ItemList schema for hub pages with child content. Zero configuration — derived purely from the architecture tree.

**Client value:** N/A — admin-only improvement.

**Mutual:** Google understands the parent-child relationship between hub pages and their content. Better sitelinks and rich results.

### 146. Sibling/Parent-Child Relationship Enrichment (D5)
**What it does:** Uses the architecture tree to enrich WebPage schema nodes with structural relationships. Adds `getParentNode()`, `getSiblingNodes()`, and `getChildNodes()` helpers to `site-architecture.ts`. In `injectCrossReferences()`, when the architecture tree is available: (1) `isPartOf` is set to the actual parent page (overriding the generic WebSite reference) with full `@type`, `@id`, `name`, and `url`; (2) `relatedLink` is populated with up to 5 sibling page URLs; (3) `hasPart` lists child pages as `WebPage` references. Only existing pages are included. All enrichment is a graceful no-op when no tree data is available and never overrides existing values (except `isPartOf` which upgrades from WebSite to parent page).
**Files:** `server/site-architecture.ts` (`getParentNode()`, `getSiblingNodes()`, `getChildNodes()` helpers), `server/schema-suggester.ts` (relationship injection in `injectCrossReferences()`)


**Agency value:** Architecture-derived schema enrichment adds parent references, sibling links, and child pages to WebPage nodes. More accurate structural data without AI token costs.

**Client value:** N/A — admin-only improvement.

**Mutual:** Richer structured data that helps search engines understand site hierarchy and navigate between related pages.

### 147. Competitor Schema Intelligence (D4)
**What it does:** Crawls competitor websites (from workspace `competitorDomains` config), extracts JSON-LD schemas from up to 10 pages per domain (homepage + sitemap URLs), and compares schema type coverage against our site. Implements rate limiting (max 2 concurrent fetches, 500ms between batches, 10s timeout per page) and 24-hour file-based caching to avoid redundant crawls. Provides a `compareSchemas()` function that surfaces opportunities — schema types competitors use that we don't — along with shared types and coverage percentages. Results are exposed via a REST endpoint that reads the workspace's competitor domains and returns crawl results plus comparisons.
**Files:** `server/competitor-schema.ts` (`crawlCompetitorSchemas()`, `compareSchemas()`, caching, rate-limited fetcher), `server/routes/competitor-schema.ts` (`GET /api/competitor-schema/:workspaceId`), `server/app.ts` (route registration)


**Agency value:** Automated competitor schema crawling with rate-limited fetching and 24-hour caching. Identifies schema types competitors use that we don't.

**Client value:** N/A — admin-only tool.

**Mutual:** Data-driven schema prioritization — deploy the schema types your competitors already benefit from.

### 148. Brief E-E-A-T → Author/Publisher Schema Enrichment (D6)
**What it does:** When a content brief is linked to schema generation via `_briefId` on `SchemaContext`, extracts E-E-A-T (Experience, Expertise, Authoritativeness, Trust) guidance from the brief's `eeatGuidance` field and enriches the schema in two ways: (1) Injects author credential context into the AI prompt so the LLM generates accurate Person nodes with real author data; (2) In post-processing, if an Article/BlogPosting/NewsArticle node exists without an `author` field, pre-populates it with a Person node containing the extracted author name, job title, and expertise topics. The `extractEeatFromBrief()` function uses regex patterns to extract structured author names, credentials (Dr, MD, PhD, etc.), and expertise topics from the free-text E-E-A-T guidance fields. Gracefully degrades: if no brief is linked, no `eeatGuidance` exists, or no usable data can be extracted, the feature is a complete no-op.
**Files:** `server/schema-suggester.ts` (`extractEeatFromBrief()`, `_briefId` on `SchemaContext`, E-E-A-T prompt injection in `aiGenerateUnifiedSchema()`, author post-processing in `postProcessSchema()`)


**Agency value:** E-E-A-T data from content briefs automatically enriches schema generation. Author credentials and expertise flow from brief to structured data without manual entry.

**Client value:** N/A — admin-only improvement.

**Mutual:** Closes the loop between content strategy (E-E-A-T guidance) and technical SEO (schema markup). Author data flows seamlessly.

### 149. Planned Page Schema Pre-Generation (D7)
**What it does:** Auto-generates lightweight JSON-LD schema skeletons when matrix cells transition to `brief_generated` or `approved` status, so schemas are ready to apply on publish — no AI call needed. The `generateSchemaSkeleton()` function builds a deterministic `@graph` containing WebPage (with URL from `plannedUrl`), BreadcrumbList (placeholder), Organization reference, and a primary type node (e.g., BlogPosting with headline from `targetKeyword`) based on the cell's `expectedSchemaTypes` or the template's `pageType` mapping. Skeletons are stored in a `pending_schemas` SQLite table with status lifecycle: `pending` → `applied` (on publish) or `stale` (if keyword/URL changes after generation). `queueSchemaPreGeneration()` is called async and non-blocking from `updateMatrixCell()`. A `GET /api/pending-schemas/:workspaceId` endpoint lists all pending schemas for a workspace. `markSchemaStale()` is triggered when a cell's `targetKeyword` or `customKeyword` changes. Gracefully degrades: if the matrix, cell, or template is missing, the pre-generation silently skips.
**Files:** `server/schema-queue.ts` (`generateSchemaSkeleton()`, `queueSchemaPreGeneration()`, `listPendingSchemas()`, `markSchemaApplied()`, `markSchemaStale()`), `server/content-matrices.ts` (pre-generation trigger in `updateMatrixCell()`, stale marking on keyword change), `server/routes/webflow-schema.ts` (`GET /api/pending-schemas/:workspaceId` endpoint), `server/db/migrations/018-pending-schemas.sql`

**Agency value:** Lightweight schema skeletons generated automatically when matrix cells reach brief or approval stage. Schemas are ready to apply the moment content is published.

**Client value:** N/A — admin-only improvement.

**Mutual:** Zero-delay schema deployment for published content. Pre-generation eliminates the post-publish 'now generate schemas' step.

### 151. SEMRush Question Keywords + Trend Direction + SERP Feature Targeting
**What it does:** Adds three new data enrichments to the keyword strategy: (1) **Question Keywords** — fetches question-based search queries via SEMRush `phrase_questions` API (full mode only), injected into AI context as FAQ/AEO targeting opportunities. Top 5 seed keywords × 10 questions each. Cached 24h. Question keywords attached to relevant content gaps. (2) **Keyword Trend Direction** — parses 12-month volume trend from SEMRush `Td` field on domain organic keywords, computes `rising`/`declining`/`stable` (±15% threshold, comparing avg of first 3 vs last 3 months). Enriched onto content gaps. UI badges: green ↑ Rising, red ↓ Declining, gray — Stable. (3) **SERP Feature Targeting** — parses SEMRush `Fk` field (comma-separated SERP feature codes) into human-readable labels. Maps 18 feature types (featured_snippet, people_also_ask, video, local_pack, etc.). Content gaps badged with "Featured Snippet" (yellow) and "PAA" (cyan) when present. Both admin and client views show the new badges.
**Files:** `server/semrush.ts` (`getQuestionKeywords()`, `trendDirection()`, `parseSerpFeatures()`, `hasSerpOpportunity()`, `QuestionKeyword` interface, `SERP_FEATURE_MAP`, `Td`/`Fk` on `DomainKeyword`), `server/routes/keyword-strategy.ts` (question keyword fetching, trend/SERP enrichment of content gaps, question keyword attachment), `shared/types/workspace.ts` (`trendDirection`, `serpFeatures`, `questionKeywords` on ContentGap, `questionKeywords` on KeywordStrategy), `src/components/strategy/ContentGaps.tsx` (trend/SERP/question badges), `src/components/client/StrategyTab.tsx` (trend/SERP badges), `src/components/client/types.ts` (updated ClientKeywordStrategy)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 152. Topical Authority Clustering (AI-Powered)
**What it does:** Uses AI (GPT-4.1-mini via `callStrategyAI`) to semantically group keywords from the keyword pool into 5-10 business-relevant topic clusters, then measures site coverage per cluster. The AI prompt receives business context + knowledge base to ensure clusters align with actual business capabilities, service areas, and content pillars — not generic 2-word phrases. For each cluster: counts owned keywords (those the site ranks for in SEMRush), calculates coverage percentage, computes average position, identifies top competitor coverage, and lists gap keywords. Clusters sorted by lowest coverage first (biggest opportunity). Admin UI: `TopicClusters` component with coverage bars (green ≥70%, amber ≥40%, red <40%), competitor alerts, and gap keyword pills. Top 150 keywords by volume fed to AI. Gracefully skips if AI call fails. Requires ≥10 keywords in pool to activate.
**Files:** `server/routes/keyword-strategy.ts` (AI topic clustering logic after strategy generation), `shared/types/workspace.ts` (`TopicCluster` interface, `topicClusters` on KeywordStrategy), `src/components/strategy/TopicClusters.tsx` (component), `src/components/KeywordStrategy.tsx` (wiring), `src/components/client/types.ts` (updated type)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 153. Keyword Cannibalization Detection + Canonical Recommender
**What it does:** Detects keyword cannibalization by cross-referencing the keyword map (primary keyword assignments) with GSC data (multiple pages ranking for same query). Two detection layers: (1) keyword map — flags when AI assigns the same primary keyword to 2+ pages; (2) GSC — identifies queries where 2+ pages receive >10 impressions. Merges both sources. Severity: `high` (3+ pages or 2 pages both in top 20), `medium` (2 pages). Each item includes per-page position, impressions, clicks, and data source. **Canonical Recommender:** Analyzes page metrics to determine the best canonical page and recommends one of four actions: `canonical_tag` (secondary pages have some traffic — add `<link rel="canonical">` to preserve them), `redirect_301` (secondary pages have no traffic — consolidate authority), `differentiate` (both pages rank competitively — retarget secondary to long-tail variant), or `noindex`. Recommendation includes the specific canonical URL and action-specific guidance. Admin UI: `CannibalizationAlert` component with severity badges, per-page metrics, source labels (GSC/map), action type badges (Canonical Tag/301 Redirect/Differentiate/Noindex with icons), canonical path display, and actionable recommendations.
**Files:** `server/routes/keyword-strategy.ts` (cannibalization detection + canonical recommender logic), `shared/types/workspace.ts` (`CannibalizationItem` interface, `cannibalization` on KeywordStrategy), `src/components/strategy/CannibalizationAlert.tsx` (component with action badges), `src/components/KeywordStrategy.tsx` (wiring), `src/components/client/types.ts` (updated type)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 154. Churn Signals 'At Risk' Badge in Workspace Overview
**What it does:** Surfaces churn risk directly on workspace cards in the Command Center. The `/api/workspace-overview` endpoint now returns `churnSignals: { critical, warning }` counts per workspace. Cards show a red/amber "At Risk" badge (with Flag icon) when critical or warning churn signals exist. Card borders highlight red for critical, amber for warning. The Needs Attention section also shows an aggregate "X workspaces at risk of churn" alert item, priority-sorted between anomalies and requests.
**Files:** `server/routes/workspaces.ts` (churn signal aggregation in workspace-overview), `src/hooks/admin/useWorkspaceOverview.ts` (`churnSignals` on `WorkspaceSummary`), `src/components/WorkspaceOverview.tsx` (At Risk badge, border logic, attention item)

**Agency value:** Faster navigation and better operational visibility.

**Client value:** N/A — admin-only feature.

**Mutual:** Reduced friction in daily platform usage.


### 155. Content Decay Alert Card in Pipeline
**What it does:** Shows a dismissible alert banner in the Content Pipeline when decaying pages are detected. Fetches `/api/content-decay/:wsId` alongside the pipeline summary on mount. Displays total decaying pages, critical/warning counts, and average decline percentage. Red styling for critical, amber for warning. Dismissible per session via X button.
**Files:** `src/components/ContentPipeline.tsx` (decay fetch, alert card rendering, dismiss state)

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 156. Approval Reminders 'Send Reminder' Button
**What it does:** Adds a manual "Remind" button to each pending approval batch in the PendingApprovals component. Clicking sends an approval reminder email to the workspace's client email via `POST /api/approvals/:wsId/:batchId/remind`. The endpoint validates the batch has pending items, calculates stale days, and sends a branded reminder email using `renderApprovalReminder()`. Button shows loading state while sending and transitions to a green "Sent" confirmation after success. Appears only when a batch has pending items.
**Files:** `server/routes/approvals.ts` (remind endpoint), `src/api/misc.ts` (`approvals.remind()`), `src/components/PendingApprovals.tsx` (Remind button, state management)

**Agency value:** Reduces client management overhead. Better client self-service means fewer support requests.

**Client value:** Better portal experience with clearer navigation and more actionable data.

**Mutual:** Both sides save time. Clients get better tools; agency gets fewer support tickets.


### 157. Schema Strategy Isolation — Removed from Client Inbox
**What it does:** Schema strategy plans no longer create approval batches in the client Inbox tab. The `POST /api/webflow/schema-plan/:siteId/send-to-client` endpoint now updates plan status to `sent_to_client` and sends email notification without creating approval items. Schema strategy review lives exclusively in the dedicated Schema tab (`SchemaReviewTab`) with condensed page-role view, gut-check approve/reject, and comment support. Individual per-page schema approvals (JSON-LD implementations) still use the standard approval system for future 1-by-1 review.
**Files:** `server/routes/webflow-schema.ts` (removed `createBatch` call, removed `SCHEMA_ROLE_CLIENT_DESC` import), `src/api/seo.ts` (updated `sendToClient` return type), `src/components/client/SchemaReviewTab.tsx` (migrated empty state to `EmptyState` component), `src/components/client/ApprovalsTab.tsx` (migrated empty state to `EmptyState` component)

**Agency value:** Better structured data quality with less manual effort. Automated processes reduce schema deployment time.

**Client value:** Richer search result appearances and better Google understanding of site structure.

**Mutual:** Higher-quality structured data drives better search visibility for both sides.


### 158. SearchTab Redesign — Insight-First Layout
**What it does:** Redesigned the client Search Performance tab with an insight-first hierarchy. Added AI-style natural language takeaway summary (Sparkles icon + `buildTakeaway()`) at the top. Insight cards now render full-width for single cards or 2-col grid for multiple. Raw queries/pages tables moved to a collapsible "Raw Data" section (default collapsed) with chevron toggle and count summary. Visual flow: takeaway → metrics bar → insights → health summary → trend chart → rank tracking → annotations → collapsible tables.
**Files:** `src/components/client/SearchTab.tsx` (full redesign with collapsible tables, AI takeaway, responsive insight cards)

**Agency value:** Improves platform functionality and team efficiency.

**Client value:** Better platform experience.

**Mutual:** Compound improvements across the platform.


### 159. Test Coverage — Admin Hooks + Layout Components
**What it does:** Added 37 new component/hook tests covering: `useWorkspaces` (6 tests: fetch, create, delete, link, unlink), `useHealthCheck` (3 tests: fetch, both-keys, error), `useQueue` (3 tests: fetch, empty, error), `Sidebar` (12 tests: nav rendering, group labels, active tab highlighting, disabled states, badge counts, navigation, theme toggle, logout, collapsible groups), `Breadcrumbs` (13 tests: Command Center link, workspace display, tab labels, back arrow, global tabs, request badges, notification bell, command palette trigger).
**Files:** `tests/component/useWorkspaces.test.tsx`, `tests/component/useHealthCheck.test.tsx`, `tests/component/useQueue.test.tsx`, `tests/component/Sidebar.test.tsx`, `tests/component/Breadcrumbs.test.tsx`

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


### 160. Email Throttle & Anti-Spam System
**What it does:** Prevents client inbox spam with a multi-layer email throttle. (1) **Status emails** (request status changes, team responses) are held and sent as a single morning digest at 9 AM ET instead of immediately — max 1/day per client. (2) **Audit emails** (audit complete, audit improved, recommendations ready) throttled to max 1 per 14 days per client. (3) **Action emails** (approval ready, brief ready, content published, fixes applied) max 3/day per client. (4) **Alert emails** (anomaly, audit alert) max 1/day per client. (5) **Global daily cap** of 5 non-transactional emails per client per day. (6) Transactional emails (password reset, welcome, trial warning) are never throttled. Sends tracked in `email_sends` SQLite table with auto-cleanup of records > 30 days. Integrated into batching queue (`flushBucket`), approval reminders, manual reminder endpoint (returns 429 if throttled), and monthly reports. Configurable via `EMAIL_DIGEST_HOUR` and `EMAIL_DIGEST_TZ` env vars.
**Files:** `server/email-throttle.ts` (throttle module: category mapping, rate checks, morning digest helpers, cleanup scheduler), `server/db/migrations/022-email-throttle.sql` (`email_sends` table), `server/email-queue.ts` (throttle check in `flushBucket`, morning digest timer for status events, overdue detection on restore), `server/approval-reminders.ts` (throttle + recordSend), `server/routes/approvals.ts` (manual remind endpoint throttle + 429 response), `server/monthly-report.ts` (recordSend), `server/startup.ts` (startThrottleCleanup)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 161. Client Strategy UI Refinements + Keyword Tracking Auto-Seed + Content Pipeline Integration
**What it does:** Five improvements to the client-facing content strategy interface: (1) **Content Opportunities simplified voting** — removed duplicative up/down arrow voting, kept only "Relevant" / "Not relevant" buttons (renamed from "Approve"). Cleaner UX, one voting mechanism. (2) **Growth Opportunities sort** — "Almost there" items (pages with impressions but not yet ranking) now always appear at the top of the list, surfacing quick wins first. (3) **Page Performance Map GSC fix** — fixed bug where expanded pages showed "No GSC data" despite data existing. Root cause: the public endpoint stripped `gscKeywords` and `previousPosition` fields from the response. Now both fields are included, enabling per-keyword GSC tables and trend indicators in the client view. (4) **Keyword Tracking auto-seed + client add** — strategy keywords (siteKeywords + page primaryKeywords) are automatically seeded into rank tracking on strategy generation. Clients can also add their own keywords via a new input in the Target Keywords section, with remove buttons for client-added keywords. New public endpoints: `GET/POST/DELETE /api/public/tracked-keywords/:workspaceId`. (5) **Client keywords → content pipeline** — client-tracked keywords are injected into the strategy keyword pool with `source: 'client'` flag. The AI batch prompt highlights them as "CLIENT-REQUESTED KEYWORDS" for priority page assignment. The master prompt instructs the AI to generate content gaps for any client keyword not already covered by an existing page. This means client-added keywords flow through the entire pipeline: keyword pool → page assignments → content opportunities → briefs → copy.
**Files:** `src/components/client/StrategyTab.tsx` (voting simplification, growth sort, tracked keyword UI), `server/routes/public-content.ts` (added `gscKeywords`/`previousPosition` to pageMap response, new tracked-keywords endpoints), `server/routes/keyword-strategy.ts` (auto-seed rank tracking after strategy generation, client keywords in keyword pool with `source:'client'`, CLIENT-REQUESTED KEYWORDS section in batch prompt, high-priority content gap rule in master prompt), `shared/types/workspace.ts` (added `previousPosition` to `PageKeywordMap`)

**Agency value:** Streamlines content production pipeline. Less manual work, more consistent output.

**Client value:** Better content deliverables with transparent status tracking.

**Mutual:** Faster content lifecycle from strategy to delivery.


### 162. Unified AI Context Architecture
**What it does:** Refactors `buildSeoContext()` in `server/seo-context.ts` to be the single source of truth for all AI context. The `SeoContext` return object now includes `personasBlock`, `knowledgeBlock`, and a `fullContext` convenience string (all blocks joined) in addition to the existing `keywordBlock`, `brandVoiceBlock`, `businessContext`, and `strategy`. All 13 AI feature call sites updated to use the unified return — no more separate `buildPersonasContext()`/`buildKnowledgeBase()` imports scattered across the codebase. **5 features that previously had no KB/persona context are now wired up:** SEO audit auto-fix suggestions, Google Search Console chat, keyword analysis, content decay refresh recommendations, and content post AI review. The separate functions still exist for backward compatibility but are only called internally by `buildSeoContext()`.
**Files:** `server/seo-context.ts` (expanded `SeoContext` interface + `buildSeoContext()`), `server/routes/webflow-seo.ts`, `server/admin-chat-context.ts`, `server/content-posts-ai.ts`, `server/content-brief.ts`, `server/aeo-page-review.ts`, `server/routes/rewrite-chat.ts`, `server/internal-links.ts`, `server/routes/keyword-strategy.ts`, `server/routes/public-analytics.ts`, `server/seo-audit.ts`, `server/routes/google.ts`, `server/routes/webflow-keywords.ts`, `server/content-decay.ts`, `server/routes/content-posts.ts`

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 163. Persisted Page Analysis → AI Rewrite Integration
**What it does:** Closes the loop between platform recommendations and AI-generated content. Page Analysis (optimizationIssues, recommendations, contentGaps) generated by keyword analysis is now **persisted** to the workspace's `keywordStrategy.pageMap` via a new `/api/webflow/keyword-analysis/persist` endpoint. When generating SEO titles/descriptions (single or bulk), the AI rewrite prompt automatically includes any persisted page analysis via `buildPageAnalysisContext()` — ensuring the AI addresses the platform's own recommendations. The SEO Editor gains an "Analyze Page" button per page that runs keyword analysis and auto-persists results. Pages with analysis show a green "Analysis on file" indicator, and the "AI Generate Both" button tooltip reflects when analysis is available. The `PageKeywordMap` type now includes `optimizationIssues`, `recommendations`, `contentGaps`, `optimizationScore`, and `analysisGeneratedAt` fields.
**Files:** `shared/types/workspace.ts` (extended `PageKeywordMap`), `server/routes/webflow-keywords.ts` (persist endpoint), `server/seo-context.ts` (`buildPageAnalysisContext()`), `server/routes/webflow-seo.ts` (wired into single + bulk rewrite prompts), `src/api/seo.ts` (`persistAnalysis` API method), `src/components/SeoEditor.tsx` (`analyzePage` handler + strategy query for analysis status), `src/components/editor/PageEditRow.tsx` (Analyze Page button + status indicator)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 164. Unified Title + Description Generation ("Generate Both")
**What it does:** Adds `field='both'` mode to both single-page and bulk SEO rewrite endpoints. The AI generates 3 paired title + description sets in a single call, ensuring they feel unified — the title hooks attention, the description closes the click. Each pair takes a different angle (keyword-intent, differentiator, searcher-match). Frontend: "AI Generate Both" button on each page in the SEO Editor, paired variation picker showing title + description side-by-side with character counters, bulk "AI Rewrite Both" button in BulkOperations. Paired suggestions are saved as aligned rows (one title, one description) so variation indices match.
**Files:** `server/routes/webflow-seo.ts` (both mode in single + bulk endpoints), `src/components/SeoEditor.tsx` (aiRewrite + bulkAiRewrite updated), `src/components/editor/PageEditRow.tsx` (Generate Both button + paired picker UI), `src/components/editor/BulkOperations.tsx` (AI Rewrite Both button)

**Agency value:** Improves platform functionality and team efficiency.

**Client value:** Better platform experience.

**Mutual:** Compound improvements across the platform.


### 165. Bulk Page Analysis ("Analyze All Pages") + CMS Collection Pages
**What it does:** Adds "Analyze All Pages" bulk buttons to both the SEO Editor and the Page Analysis page. In the SEO Editor, the button appears above the search bar and sequentially analyzes every page that doesn't already have analysis on file, with live progress and cancel support. In the Page Analysis page (`KeywordAnalysis`), the same pattern — sequential bulk analysis with progress counter. Analysis results are now **auto-persisted** to the workspace's `keywordStrategy.pageMap` from both locations. The Page Analysis page now fetches **all pages** (static + CMS collection pages) via a new `/api/webflow/all-pages/:siteId` endpoint that discovers CMS pages from the sitemap. CMS pages display a violet "CMS" badge in the page list. The `KeywordAnalysis` component now accepts an optional `workspaceId` prop for persistence.
**Files:** `server/routes/webflow.ts` (new `/api/webflow/all-pages/:siteId` endpoint with CMS discovery), `src/components/KeywordAnalysis.tsx` (workspaceId prop, all-pages fetch, auto-persist, Analyze All button, CMS badges, bulk progress UI), `src/components/SeoEditor.tsx` (Analyze All Pages button + bulk analysis handler), `src/components/KeywordStrategy.tsx` (passes workspaceId to KeywordAnalysis)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 166. Page Analysis Context Wired into AI Features
**What it does:** Extends `buildPageAnalysisContext()` from SEO rewrites to three additional AI features that work with specific pages: (1) **Rewrite Chat** — the page's optimization issues, recommendations, and content gaps are injected into the system prompt so the AI rewrite assistant can address them directly. (2) **Content Decay** — refresh recommendations now include the page's prior analysis context for more targeted recovery plans. (3) **SEO Audit Auto-Fix** — AI-generated meta tag suggestions now account for the page's flagged issues and recommendations. All three features already had `buildSeoContext()` for keyword/brand context; this adds the per-page analysis layer on top.
**Files:** `server/routes/rewrite-chat.ts` (import + inject `buildPageAnalysisContext`), `server/content-decay.ts` (import + inject into refresh recommendation prompt), `server/seo-audit.ts` (import + inject into auto-fix prompt)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 167. Page Intelligence — Unified Per-Page SEO Tab
**What it does:** Merges the former "Page Keyword Map" (inline keyword editing, metrics, SEO copy) and "Page Analysis" (AI optimization scores, issues, recommendations, content gaps) into a single dedicated sidebar tab called **Page Intelligence**. Each page row shows keyword metrics (volume, difficulty, CPC, position), search intent, optimization score, and expandable detail panels for AI analysis, keyword editing, and SEO copy generation. Strategy tab cleaned up to focus on site-level strategy insights (summary dashboard, ranking distribution, content gaps, topic clusters, competitive intel) without the per-page detail that now lives in Page Intelligence. Deep-linking via `fixContext` supported. Command Palette updated.
**Files:** `src/components/PageIntelligence.tsx` (new unified component — 790 lines), `src/routes.ts` (added `page-intelligence` to Page type), `src/components/layout/Sidebar.tsx` (new nav item in SEO group), `src/App.tsx` (lazy import + render case with fixContext), `src/components/CommandPalette.tsx` (new palette entry), `src/components/KeywordStrategy.tsx` (removed Page Analysis sub-tab, PageKeywordMapPanel, related state/imports; strategy tab now strategy-only)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 168. Page Intelligence — Full Analysis Persistence, Hydration & Cross-Feature Integration
**What it does:** Three enhancements: (1) All 15 AI analysis fields now persisted to strategy.pageMap (was 7) and hydrated back into the UI on load so full reports survive page reloads. (2) `buildPageAnalysisContext()` enriched with optimization score, keyword presence gaps, competitor keywords, topic cluster, and difficulty — feeds into 5 AI features (rewrite chat, SEO bulk rewrite, single rewrite, audit auto-fix, content decay). (3) Analysis data wired into 3 additional features: Schema Generator receives topicCluster/contentGaps/optimizationScore via `_pageAnalysis` context; Content Brief Generator matches target keyword to pageMap and injects analysis data; Internal Links annotates pages with topic clusters and groups cluster summaries for intra-cluster linking priority.
**Files:** `shared/types/workspace.ts` (8 new fields on PageKeywordMap), `server/routes/webflow-keywords.ts` (expanded persist endpoint), `src/components/PageIntelligence.tsx` (full persist call, hydration effect, KeywordData/StrategyPage interfaces), `server/seo-context.ts` (enriched buildPageAnalysisContext), `server/schema-suggester.ts` (_pageAnalysis on SchemaContext, getPageAnalysis helper, wired into pageCtx), `server/helpers.ts` (enriched buildSchemaContext pageKeywordMap), `server/content-brief.ts` (keyword→page matching + pageAnalysisBlock injection), `server/internal-links.ts` (topic cluster annotations + cluster summary block)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 169. Page Intelligence — Fix These First Priority Queue
**What it does:** Auto-prioritized "Fix These First" section at the top of Page Intelligence. Ranks analyzed pages by impact = impressions × (100 - optimizationScore) / 100. High-traffic pages with low scores surface first. Shows top 5 pages with color-coded score badges, impression counts, and impact numbers. Click any row to expand its full analysis. Only appears when analyzed pages with score < 75 exist.
**Files:** `src/components/PageIntelligence.tsx` (fixQueue computation + amber-themed UI section)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 170. Page Analysis — CMS Title/Meta Extraction + Live Domain Fetch
**What it does:** Fixes incorrect "missing title/meta" flags on CMS collection items (blogs). Root cause: the page-html endpoint only tried the webflow.io subdomain (CMS pages often 404 there) and never extracted title/meta from HTML. Now: (1) Tries live domain first, falls back to webflow.io. (2) Extracts `<title>` and `<meta name="description">` from fetched HTML. (3) Returns `seoTitle` and `metaDescription` alongside body text. (4) Frontend uses HTML-extracted values for CMS pages that lack Webflow API seo data. Same fix applied to the all-pages endpoint sitemap discovery.
**Files:** `server/routes/webflow-seo.ts` (page-html endpoint: live domain priority, HTML title/meta extraction, returns seoTitle+metaDescription), `src/components/PageIntelligence.tsx` (uses effectiveTitle/effectiveMeta from HTML when page.seo is missing)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 171. Page Analysis — Background Job System
**What it does:** Moves bulk "Analyze All Pages" from a frontend Promise.all loop (blocked navigation, lost on refresh) to the server-side background job system. Job type `page-analysis` in `server/routes/jobs.ts`: discovers all pages (static + CMS via sitemap), fetches HTML for each, extracts title/meta/content, calls GPT-4.1-mini keyword analysis with SEMRush enrichment, and auto-persists all 15 analysis fields to workspace keywordStrategy.pageMap. Processes in batches of 3 with 1.5s rate limiting. Cancellable via WebSocket. Frontend watches job progress via `useBackgroundTasks` hook. TaskPanel shows "Page Analysis" label. Activity log records completion.
**Files:** `server/routes/jobs.ts` (new `page-analysis` job case — ~270 lines), `server/activity-log.ts` (added `page_analysis` to ActivityType), `src/components/PageIntelligence.tsx` (useBackgroundTasks integration, job progress watching, cancel wiring), `src/components/TaskPanel.tsx` (type label)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 172. SEO Editor — Full Collection Item Pagination
**What it does:** Fixes blog collection showing ~95 items instead of ~130. Root cause: Webflow API caps responses at 100 items per request, and the cms-seo endpoint wasn't paginating. Now: (1) Paginate through ALL items with do/while loop. (2) Sitemap discovery tries live domain first (CMS pages often only in live sitemap). (3) CMS page discovery cap in all-pages endpoint raised from 100 to 500.
**Files:** `server/routes/webflow-cms.ts` (pagination loop, live domain sitemap discovery), `server/routes/webflow.ts` (CMS URL cap raised to 500)

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


### 173. Stale Chunk Auto-Reload (`lazyWithRetry`)
**What it does:** Eliminates "media failed to load — Failed to fetch dynamically imported module" errors after deploys. When Vite rebuilds, chunk filenames change (content hashing), but browsers cache old HTML referencing old filenames. `lazyWithRetry()` wraps every `React.lazy()` call — catches the 404 on stale chunks, does a single `window.location.reload()` to fetch new HTML, and uses a `sessionStorage` flag to prevent infinite reload loops. Covers all ~40 lazy imports across App.tsx, SeoAudit.tsx, ContentPipeline.tsx, and ClientDashboard.tsx.
**Files:** `src/lib/lazyWithRetry.ts` (new utility), `src/App.tsx` (35 lazy→lazyWithRetry), `src/components/SeoAudit.tsx` (3 lazy→lazyWithRetry), `src/components/ContentPipeline.tsx` (4 lazy→lazyWithRetry), `src/components/ClientDashboard.tsx` (1 lazy→lazyWithRetry)

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


### 174. Page Analysis Path Matching Fix + AI Context Accuracy
**What it does:** Fixes a critical bug where fuzzy `includes()`-based path matching caused every page to falsely match the homepage (`/`) entry in the keyword strategy pageMap. Since every path contains `/`, `normalized.includes(p.pagePath)` was always true for the homepage entry. Result: (1) Bulk page analysis overwrote the homepage entry instead of creating new entries — only 7 of 256 pages persisted. (2) All AI features (SEO rewrites, keyword analysis, content scoring, search chat) received the homepage's keywords instead of the correct page's keywords. Fix: replaced `includes()` matching with exact path comparison + trailing-slash normalization across 5 instances in 4 files. Also fixed the Page Intelligence frontend to display `publishedPath` for nested pages (e.g., `/platform/engineering-efficiency` instead of `/engineering-efficiency`).
**Files:** `server/routes/jobs.ts` (persistence + skip filter), `server/routes/webflow-keywords.ts` (individual analysis persistence), `server/routes/webflow-seo.ts` (SEO copy page context), `server/seo-context.ts` (2 instances — buildSeoContext + buildPageAnalysisContext), `src/components/PageIntelligence.tsx` (path display)

**Agency value:** All per-page SEO data in one place. Priority queue answers 'where should I start?' instantly.

**Client value:** N/A — admin-only tool.

**Mutual:** Faster, more targeted SEO work. Analysis persists and compounds across features.


### 175. Shared Path Utilities + Clear-on-Reanalyze
**What it does:** Extracts duplicated path logic into shared utilities to prevent future bugs like #174. (1) `normalizePath()` — ensure leading `/`, strip trailing `/`. (2) `matchPagePath(a, b)` — exact match with normalization. (3) `findPageMapEntry(pageMap, path)` — find a pageMap entry by normalized path. (4) `resolvePagePath(page)` — resolve canonical path from `publishedPath` or `slug`. All 7 `pageMap.find()` call sites and 16 `publishedPath || slug` patterns now use shared utilities. Frontend gets mirrored `src/lib/pathUtils.ts`. Also: "Re-analyze All" now clears stale analysis fields (scores, recommendations, etc.) from all pageMap entries before starting, so removed pages don't retain ghost data. Keyword assignments are preserved.
**Files:** `server/helpers.ts` (4 new exports), `src/lib/pathUtils.ts` (new), 16 server files updated to use `resolvePagePath`, 5 server files updated to use `findPageMapEntry`, `src/components/PageIntelligence.tsx` (uses `normalizePath` + `resolvePagePath`), `server/routes/jobs.ts` (clear-on-forceRefresh logic)

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


### 176. Normalized page_keywords Table (pageMap → SQLite)
**What it does:** Extracts `keywordStrategy.pageMap` from the workspace JSON blob into a dedicated `page_keywords` SQLite table. Previously, every read/write of any page's keyword data required deserializing/serializing the entire keywordStrategy JSON blob (which grows to 100KB+ for large sites). Now: (1) Per-page reads use indexed `SELECT` by `(workspace_id, page_path)` — O(1) instead of O(N) scan. (2) Per-page writes use `INSERT OR REPLACE` — no read-modify-write of entire blob. (3) Batch analysis uses `upsertPageKeywordsBatch()` in a single transaction. (4) `clearAnalysisFields()` resets scores/recommendations in one SQL UPDATE. (5) Migration function (`migrateFromJsonBlob`) runs idempotently on startup to move existing data. (6) GET endpoints reassemble `pageMap` array for backward-compatible API responses. (7) All 13 reader/writer call sites updated to use the new table.
**Files:** `server/db/migrations/024-page-keywords.sql` (table + indexes), `server/page-keywords.ts` (CRUD module with 12 exports), `server/index.ts` (migration hook), `server/routes/keyword-strategy.ts` (POST/GET/PATCH endpoints), `server/routes/jobs.ts` (batch analysis persistence), `server/routes/webflow-keywords.ts` (individual page analysis), `server/routes/webflow-seo.ts` (SEO copy context), `server/routes/public-content.ts` (public strategy + fix recommendations), `server/routes/content-requests.ts` (getAllSitePages), `server/seo-context.ts` (3 functions), `server/ai-context-check.ts` (strategy status check), `server/llms-txt-generator.ts` (page enrichment), `server/site-architecture.ts` (tree builder), `server/internal-links.ts` (keyword context), `server/cannibalization-detection.ts` (conflict detection)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 177. SEMRush Cache TTL Optimization + Unified Domain Organic Limit
**What it does:** Two quick wins to reduce SEMRush API credit consumption: (1) Extended cache TTLs based on data volatility — keyword metrics 7d→30d, related/question keywords 7d→30d, domain overview 48h→7d, backlinks 48h→7d, organic competitors 72h→14d. Domain organic rankings stay at 7d (rankings shift weekly). Named constants (`CACHE_TTL_KEYWORD`, `CACHE_TTL_RELATED`, etc.) replace magic numbers. (2) Unified domain organic fetch limit to 200 for both quick and full strategy modes. Previously quick mode used limit=100, but `getKeywordGap` internally re-fetches the client domain with limit=200 — different limit = different cache key = duplicate API call costing ~2,000 credits. Standardizing to 200 ensures all callers share the same cache entry.
**Files:** `server/semrush.ts` (7 named TTL constants, 9 `readCache` call sites updated), `server/routes/keyword-strategy.ts` (unified limit)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 179. Unified Bulk → Single-Page AI Rewrite Flow (Static + CMS) + Session Persistence
**What it does:** Simplified bulk AI rewrite to call the existing single-page `aiRewrite` function for each selected page/item (with concurrency of 3), instead of using a separate bulk server endpoint. Benefits: (1) Single code path — any improvement to single-page rewrite (audit context, heading extraction, 1500-char content excerpt) automatically applies to bulk. (2) Results populate **progressively** into each page card as they complete — first variation auto-selects into inputs, variation picker appears in-card. (3) All selected pages auto-expand so users can watch results appear. (4) Results persist as unsaved edits until another action is taken (save to Webflow, send to client, regenerate, etc.). Works for both **static pages** (SeoEditor) and **CMS collection items** (CmsEditor). CMS bulk rewrite supports 4 target modes: Names, Titles, Descriptions, or All SEO fields. Auto-expands parent collections + items during processing. **Session persistence:** Edits, variations, and expanded state are synced to React Query cache so they survive both Pages ↔ CMS tab switches (via `display:none` rendering) and admin-level tab switches (via RQ cache restore on remount). On remount, the initialization `useEffect` is skipped once if cached edits exist, preventing AI-generated values from being overwritten by original Webflow data. Also fixed pre-existing `aiLoading` type bug in CmsEditor (was `Set<string>` but used as `Record<string, boolean>`).
**Files:** `src/components/SeoEditorWrapper.tsx` (display:none instead of conditional rendering), `src/components/SeoEditor.tsx` (`bulkAiRewrite` + RQ cache persistence for edits/variations/expanded), `src/components/CmsEditor.tsx` (new `bulkAiRewrite` + RQ cache persistence for edits/variations/expandedItems/expandedCollections/dirty; `aiLoading` type fix; **Select All per collection:** `toggleSelectAllInCollection()` added — collection headers now show a checkbox that selects/deselects all items in that collection, with a "N selected" badge in the header action area.)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 178. Global Cross-Workspace Keyword Metrics Cache + Pre-Enrichment Skip
**What it does:** Two major SEMRush credit optimizations: (1) **Global keyword_metrics_cache SQLite table** — keyword volume/difficulty/CPC is the same regardless of which workspace asks, so a shared L1 cache eliminates duplicate lookups across workspaces in the same industry. `getKeywordOverview` now checks: L1 (global SQLite) → L2 (per-workspace file cache) → L3 (SEMRush API). File cache hits backfill the global table. API results write to both caches. Saves 30-50% of `keyword_overview` credits across the platform. (2) **Pre-enrichment skip in strategy generation** — post-AI keyword validation now checks domain organic data (already fetched earlier in the same run) and existing `page_keywords` entries (from previous runs) before calling SEMRush API. Only keywords not found in either source trigger API calls. On re-runs of the same strategy, this can eliminate 60-90% of validation API calls since most keywords are unchanged. Combined with the global cache, re-running a strategy on the same workspace uses near-zero SEMRush credits for keyword validation.
**Files:** `server/db/migrations/025-keyword-metrics-cache.sql` (table + index), `server/keyword-metrics-cache.ts` (CRUD module: getCachedMetrics, getCachedMetricsBatch, cacheMetrics, cacheMetricsBatch, cleanupStaleEntries), `server/semrush.ts` (L1/L2 cache chain in getKeywordOverview), `server/routes/keyword-strategy.ts` (pre-enrichment skip in post-AI validation)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 180. Platform Unification — Phase 3: Route Deduplication + API Client Consolidation
**What it does:** Eliminates duplicated analytics data fetching and raw `fetch()` calls across the codebase. (1) **Shared analytics layer** — new `server/analytics-data.ts` exports 6 wrapper functions (`fetchSearchOverview`, `fetchPerformanceTrend`, `fetchSearchDevices`, `fetchSearchCountries`, `fetchSearchTypes`, `fetchSearchComparison`) that normalize the search-console.ts API with consistent optional `dateRange` support. Both `routes/google.ts` (admin) and `routes/public-analytics.ts` (client) now import from this shared layer instead of duplicating search-console.ts imports. (2) **New API wrappers** — adds `stripe`, `auth`, `keywordFeedback`, `trackedKeywords`, `businessPriorities` to `src/api/misc.ts`; adds `backlinks`, `webflow.sites`, `auditSchedules.enable`, `contentPerformance.publicGet` to `src/api/seo.ts`; adds `workspaces.deletePageState` to `src/api/workspaces.ts`. (3) **Component migration** — 9 components migrated from raw `fetch()` to typed API client: BrandHub, StripeSettings, WorkspaceSelector, CommandPalette, ContentTab, StrategyTab, SeoEditor, Sidebar, BacklinkProfile. Streaming endpoints (ContentBriefs export, PostEditor PDF, AssetBrowser bulk-alt, KeywordStrategy SSE) correctly kept as raw fetch since they stream binary/NDJSON. (4) **Duplicate removed** — `rankTracking` export deleted from `src/api/misc.ts`; canonical version in `src/api/seo.ts` is the single source of truth.
**Files:** `server/analytics-data.ts` (new), `server/routes/google.ts`, `server/routes/public-analytics.ts`, `src/api/misc.ts`, `src/api/seo.ts`, `src/api/workspaces.ts`, `src/api/index.ts`, `src/components/BrandHub.tsx`, `src/components/StripeSettings.tsx`, `src/components/WorkspaceSelector.tsx`, `src/components/CommandPalette.tsx`, `src/components/SeoEditor.tsx`, `src/components/client/ContentTab.tsx`, `src/components/client/StrategyTab.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/strategy/BacklinkProfile.tsx`

**Agency value:** Reduces client management overhead. Better client self-service means fewer support requests.

**Client value:** Better portal experience with clearer navigation and more actionable data.

**Mutual:** Both sides save time. Clients get better tools; agency gets fewer support tickets.


### 181. Platform Unification — Phase 4: Frontend Cache Layer
**What it does:** Standardizes React Query cache infrastructure across all 23+ hook files. (1) **Centralized query keys** — new `src/lib/queryKeys.ts` exports a typed factory object (`queryKeys.admin.*`, `queryKeys.client.*`, `queryKeys.shared.*`) covering every query in the platform. GA4/GSC keys restructured to hierarchical format (`['admin-ga4', wsId, 'overview', days]`) enabling prefix-based workspace-level invalidation. (2) **Stale time constants** — `src/lib/queryClient.ts` exports `STALE_TIMES` (`STABLE: 5min`, `NORMAL: 60s`, `FAST: 30s`, `REALTIME: 0`); health/workspace/publish-target queries upgraded to STABLE, queue/editor to FAST. (3) **Shared GA4 base hook** — new `src/hooks/shared/useGA4Base.ts` consolidates 11+ `useQuery` calls shared by `useAdminGA4` and `useClientGA4`. Both GA4 hooks refactored to thin wrappers that delegate to the base (eliminating ~100 lines of duplication). (4) **Centralized WS→cache invalidation** — new `src/lib/wsEvents.ts` mirrors server WS_EVENTS/ADMIN_EVENTS constants; new `src/hooks/useWsInvalidation.ts` maps 12 workspace-scoped WS events to React Query invalidations (approvals, requests, content requests, activity, audit, anomalies, content published, workspace updates, work orders). Wired into `App.tsx`'s Dashboard component; App.tsx WS string literals replaced with `ADMIN_EVENTS` typed constants.
**Files:** `src/lib/queryKeys.ts` (new), `src/lib/wsEvents.ts` (new), `src/hooks/shared/useGA4Base.ts` (new), `src/hooks/useWsInvalidation.ts` (new), `src/lib/queryClient.ts`, `src/App.tsx`, `src/hooks/admin/useAdminGA4.ts`, `src/hooks/client/useClientGA4.ts`, `src/hooks/admin/useAdminSearch.ts`, `src/hooks/client/useClientSearch.ts`, `src/hooks/client/useClientQueries.ts`, `src/hooks/useClientData.ts`, `src/hooks/useAuditSummary.ts`, `src/hooks/useRecommendations.ts`, `src/hooks/usePageEditStates.ts`, and 14 additional admin hook files

**Agency value:** Faster operations, lower API costs, and more reliable infrastructure.

**Client value:** N/A — internal improvement. Indirectly improves platform speed and reliability.

**Mutual:** Better performance and lower costs compound across every user and every operation.


---

### 150. AI Keyword Assignment Engine + Competitor-Enriched Strategy
**What it does:** Overhauls the keyword strategy generator from an AI keyword *inventor* to a keyword *assigner*. The AI now picks keywords from a verified pool of real search terms (SEMRush domain keywords, GSC queries, competitor keywords, keyword gaps, related keywords) instead of hallucinating them. Reduces SEMRush "ERROR 50 :: NOTHING FOUND" responses (wasted API credits on non-existent keywords). Key changes: (1) Keyword pool built from 5 data sources — SEMRush domain organic, GSC queries, competitor domain keywords, keyword gap analysis, and related keywords. (2) AI batch prompt rewritten to enforce pool assignment with `(invented)` suffix for any keywords not in pool. (3) Pre-enrichment: keywords from pool get real volume/difficulty immediately without extra SEMRush lookups. (4) SEMRush lookups capped at 30 and filtered to ≤5-word keywords. (5) Auto-discovery of organic competitors via SEMRush `domain_organic_organic` API when none provided. (6) Competitor keywords fetched in both quick and full modes. (7) Keyword gap analysis runs in both modes. (8) Related keywords in full mode only. (9) Master prompt enhanced: content gaps must cite competitorProof (which competitor ranks and at what position). (10) Auto-discovered competitors persisted to workspace. (11) Frontend: Auto-Discover button in strategy settings calls SEMRush API, saves results, pre-populates competitor input. Saved competitors load on mount. Content gap cards display orange competitor proof badges in both admin and client views.
**Files:** `server/routes/keyword-strategy.ts` (pool construction, batch prompt rewrite, master prompt enhancement, competitor data gathering, pre-enrichment), `server/semrush.ts` (`getOrganicCompetitors()`), `server/routes/semrush.ts` (discover-competitors + save-competitors endpoints), `shared/types/workspace.ts` (`competitorProof` on ContentGap), `src/api/seo.ts` (discoverCompetitors, saveCompetitors), `src/components/KeywordStrategy.tsx` (auto-discover UI, persistent competitor loading), `src/components/strategy/ContentGaps.tsx` (competitorProof display), `src/components/client/StrategyTab.tsx` (competitorProof display), `src/components/client/types.ts` (competitorProof on client type)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


### 182. Analytics Intelligence Layer — Phase 1 (Foundation)
**What it does:** Establishes the infrastructure for background-computed analytics insights stored in SQLite and surfaced to clients via insight cards. (1) **`analytics_insights` table** (migration 035) — stores computed insights keyed by `(workspace_id, page_id, insight_type)` with UNIQUE constraint ensuring one row per dimension, auto-replaced on refresh. Supports 7 insight types: `page_health`, `quick_win`, `content_decay`, `cannibalization`, `keyword_cluster`, `competitor_gap`, `conversion_attribution`. (2) **`server/analytics-insights-store.ts`** — CRUD module with `upsertInsight`, `getInsights`, `getInsight`, `deleteInsightsForWorkspace`; handles conflict-replace (upsert semantics), type-safe `InsightType` and `InsightSeverity` unions. (3) **`server/api-cache.ts`** — 15-minute in-memory TTL cache for GSC/GA4 API responses, keyed by `(workspaceId, functionName, paramsHash)`. `createApiCache()` factory + singleton `apiCache`. Methods: `get`, `set`, `wrap` (transparent cache-or-fetch), `invalidate` (workspace-level purge). (4) **`GET /api/public/insights/:workspaceId`** — new endpoint in `public-analytics.ts`; optional `?type=insight_type` filter; returns 404 for unknown workspace. (5) **`InsightCards` component** — 3-card layout for the client dashboard: Traffic Momentum (page health trends), Quick Wins (positions 4-20 with estimated traffic gain), Top Performers (conversion data + health scores). Tier-aware: Free → upgrade nudge; Growth → feature links; Premium → "Your strategist is tracking this". (6) **`useClientInsights` hook** — React Query hook fetching `/api/public/insights/:wsId`, registered in `queryKeys.client.insights`. (7) **Shared types** — `AnalyticsInsight`, `InsightType`, `InsightSeverity`, and 7 insight data shapes (`PageHealthData`, `QuickWinData`, `ContentDecayData`, etc.) added to `shared/types/analytics.ts`.

**Phase 1B** (Opus): `server/analytics-intelligence.ts` — lazy computation engine with 6-hour TTL. Pure functions for: (1) **Page Health Scores** (0–100): position component (0–30), traffic component (0–25, normalized vs site max), CTR component (0–20, actual vs expected CTR at position), engagement component (0–25, GA4 engagement time). Severity: positive ≥70, opportunity ≥40, warning ≥20, critical <20. (2) **Quick Wins**: GSC query-page rows at positions 4–20 with ≥50 impressions; estimates traffic gain from reaching position 3 using industry-average CTR curves. (3) **Content Decay**: current vs previous 30-day GSC clicks; flags >20% decline. Severity: critical >50%, warning >30%. (4) **Cannibalization**: groups `getQueryPageData()` by query, flags 2+ pages competing in top 20. Sorted by total impressions (most impactful first). Orchestrator fetches GSC/GA4 data in parallel via `apiCache.wrap()`, computes all insight types, and persists via `upsertInsight()`. Public endpoint upgraded from synchronous store read to `getOrComputeInsights()` with lazy evaluation. 25 new unit tests covering all 4 algorithms + staleness check.

**Files:** `server/db/migrations/035-analytics-insights.sql` (new), `server/analytics-insights-store.ts` (new), `server/api-cache.ts` (new), `server/routes/public-analytics.ts` (insights endpoint), `src/components/client/InsightCards.tsx` (new), `src/hooks/client/useClientQueries.ts` (useClientInsights), `src/lib/queryKeys.ts` (insights key), `shared/types/analytics.ts` (insight types), `tests/unit/analytics-insights-store.test.ts` (new, 10 tests), `tests/unit/api-cache.test.ts` (new, 8 tests), `tests/integration/insights-routes.test.ts` (new, 4 tests), `tests/component/InsightCards.test.tsx` (new, 6 tests)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.

---

### 188. Analytics Intelligence — Connected Intelligence Phase 3 (Client Intelligence + ROI)
**What it does:** Transforms insights from admin-only tooling into a client-facing intelligence layer with ROI attribution, monthly digests, upsell signals, and admin resolution tracking. (1) **Client insight narratives** (`server/insight-narrative.ts`): `buildClientInsights()` transforms admin insights into outcome-oriented client language. Filters out admin-only types (`strategy_alignment`, `keyword_cluster`), drops low-impact items (<20 score), caps at 15. Uses `Partial<Record<InsightType,...>>` for exhaustive narrative map. Exposed via `GET /api/public/insights/:workspaceId/narrative`. (2) **ROI attribution** (`server/roi-attribution.ts`): Records optimizations (content refresh, SEO fix, schema added, brief published) with before-metrics. Measures outcomes after configurable window (default 14 days). New `roi_attributions` table (migration 040). (3) **Monthly performance digest** (`server/monthly-digest.ts`): Aggregates wins, resolved issues, and ROI highlights into AI-generated summary with deterministic fallback. Exposed via `GET /api/public/insights/:workspaceId/digest`. (4) **Resolution tracking**: `resolution_status`, `resolution_note`, `resolved_at` added to `analytics_insights` (migration 040). Store functions: `resolveInsight()`, `getUnresolvedInsights()`, `getInsightById()`. Admin endpoint: `PUT /api/insights/:insightId/resolve`. (5) **Client UI**: Server-computed insights are merged into the unified `InsightsDigest.tsx` feed via `mapServerInsights()` — rendered as cards with Win/Opportunity/Alert badges, matching the locally-computed card style. `InsightNarrative.tsx` was deleted (functionality subsumed). `MonthlyDigest.tsx` shows AI summary, wins, ROI highlights (Growth-gated). (6) **Admin Action Queue** (`ActionQueue.tsx`): Unresolved critical/warning insights as a work queue with resolution workflow and note input. (7) **TierGate upsell tracking**: `onGateHit` callback fires when tier gate blocks access.

**Infrastructure:** 24h insight recompute TTL (skips recomputation if last run < 24h ago). Public narrative API capped at 25 insights. Monthly digest cached for 24h with request coalescing (prevents parallel AI calls for the same workspace). Stable insight IDs across recomputation (deterministic ID based on workspace + type + page). WebSocket events: `insight:resolved` (broadcasts when admin resolves an insight) and `intelligence:signals_updated` (broadcasts after feedback loop runs). All premium features (MonthlyDigest, ROI highlights) wrapped in `<TierGate>`. **Prompt standardization (April 2026):** Monthly digest adds top-wins narrative (top 3 positive insights by `impactScore`, reusing already-fetched `insights` variable — no extra DB call). `generateDigestSummary` wrapped with `buildSystemPrompt()` for voice DNA. Temperature standardized to 0.4. `workspaceId` now threaded through to `callOpenAI` for cost tracking.

**Files:** `server/insight-narrative.ts` (new), `server/roi-attribution.ts` (new), `server/monthly-digest.ts` (new), `server/routes/insights.ts` (new), `server/routes/public-analytics.ts` (narrative + digest endpoints), `server/analytics-insights-store.ts` (resolution functions), `server/db/migrations/040-insight-resolution-tracking.sql` (new), `shared/types/analytics.ts` (resolution fields), `shared/types/narrative.ts` (new), `src/components/client/MonthlyDigest.tsx` (new), `src/components/admin/ActionQueue.tsx` (new), `src/components/client/InsightsDigest.tsx` (unified feed with server insight mapping), `src/components/client/OverviewTab.tsx`, `src/components/ui/TierGate.tsx` (onGateHit), `src/hooks/client/useClientInsights.ts` (new), `src/hooks/client/useMonthlyDigest.ts` (new), `src/hooks/admin/useActionQueue.ts` (new), `src/lib/queryKeys.ts`, `tests/unit/insight-narrative.test.ts` (new, 7 tests), `tests/unit/roi-attribution.test.ts` (new, 9 tests)

---

### 183. Analytics Intelligence — Phase 2 (AI Engine Enrichment)
**What it does:** Enriches the three AI generation engines (schema pipeline, content briefs, chat advisor) with analytics intelligence data from the Phase 1 intelligence layer. (1) **Schema pipeline enrichment** (`server/schema-suggester.ts`): Added `_pageHealthScore`, `_pageHealthTrend`, `_quickWinStatus`, and `_faqOpportunities` fields to `SchemaContext`. New `buildSchemaIntelligenceBlock()` injects page health score, quick win status, and FAQ opportunity questions into the schema generation prompt (appears after the SEARCH PERFORMANCE block). New `extractFaqOpportunities()` filters GSC query-page data for question-type queries (how/what/why/when/where/which/can/do/does/is/are) targeting a specific page, sorted by impressions, capped at 10. `buildSchemaContext()` in `helpers.ts` extended to also fetch `getQueryPageData()` and build an `insightsMap` from the intelligence layer (SQLite, synchronous). All 3 callers (`webflow-schema.ts` routes, `jobs.ts` bulk generation) pass the new data through. (2) **Content brief enrichment** (`server/content-brief.ts`): New `buildBriefIntelligenceBlock()` constructs prompt sections for: cannibalization warnings (existing pages competing for target keyword — suggests updating vs creating new), content decay context (related pages losing traffic — suggests freshness), quick win opportunities (related queries close to page 1), page health scores for related pages. Wired into `generateBrief()` prompt assembly using `getInsights()` from the intelligence store. (3) **Chat advisor enhancement** (`server/admin-chat-context.ts`): Added `'insights'` context category with patterns for "what should I work on", "priorities", "quick wins", "declining", "cannibalization", "page health". New `buildInsightsContext()` formats all 4 insight types (health scores worst-first, quick wins by traffic gain, decay by severity, cannibalization) into a structured text block. Triggered on `insights`, `general`, or `strategy` category match. 36 new tests across 3 test files.
**Files:** `server/schema-suggester.ts` (SchemaContext fields + buildSchemaIntelligenceBlock + extractFaqOpportunities + prompt injection + generateSchemaForPage/generateSchemaSuggestions signature updates), `server/helpers.ts` (buildSchemaContext extended with queryPageData + insightsMap), `server/content-brief.ts` (buildBriefIntelligenceBlock + generateBrief wiring), `server/admin-chat-context.ts` (insights category + buildInsightsContext + assembleAdminContext wiring), `server/routes/webflow-schema.ts` (pass-through updates), `server/routes/jobs.ts` (pass-through updates), `tests/unit/schema-intelligence-enrichment.test.ts` (new, 16 tests), `tests/unit/content-brief-enrichment.test.ts` (new, 7 tests), `tests/unit/chat-context-insights.test.ts` (new, 13 tests)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 184. Analytics Intelligence — Phase 3 (Advanced Intelligence)
**What it does:** Adds three advanced intelligence computation algorithms to the analytics intelligence layer and wires them into the chat advisor context. (1) **Keyword Clustering** (`computeKeywordClusterInsights`): Groups GSC queries into topic clusters using a Union-Find algorithm with two merge strategies — word-level Jaccard similarity (≥0.3 threshold) and page co-occurrence (queries sharing the same top-ranking page). Each cluster gets a label (highest-impression query), aggregate impressions, average position, and a pillar page (the URL with the most combined impressions across cluster queries). Severity: positive (≥2000 impressions, avg pos ≤10), opportunity (≥500 impressions), warning (avg pos >15). Capped at 20 clusters. (2) **Competitor Gap Analysis** (`computeCompetitorGapInsights`): Uses the `SeoDataProvider` abstraction (`getConfiguredProvider()`) to work with both SEMRush and DataForSEO. Fetches competitor keyword gaps, enriches with our GSC positions, and scores by volume/difficulty. Auto-discovers competitors via `getCompetitors()` if none configured. Severity: critical (volume ≥1000, difficulty <50, we don't rank), warning (volume ≥500, difficulty <60, we don't rank), opportunity otherwise. Capped at 30 gaps. (3) **Conversion Attribution** (`computeConversionAttributionInsights`): Maps GA4 organic landing pages to conversion rates. Filters pages with ≥10 sessions, computes `conversionRate = (conversions / sessions) * 100`. Severity: positive (≥5%), opportunity (≥2%), warning (≥0.5%), critical (<0.5%). Capped at 20 pages. All three wired into `computeAndPersistInsights()` orchestrator with independent try/catch blocks. Chat advisor (`buildInsightsContext`) enriched with keyword clusters, competitor gaps, and conversion attribution sections. 20 new unit tests for the 3 algorithms.
**Files:** `server/analytics-intelligence.ts` (3 new compute functions + orchestrator wiring), `server/admin-chat-context.ts` (3 new insight type sections in buildInsightsContext), `tests/unit/analytics-intelligence-phase3.test.ts` (new, 20 tests)

**Agency value:** Better AI outputs across all features. Richer context means fewer revision cycles.

**Client value:** N/A — admin-only improvement. Indirectly improves all AI-generated content.

**Mutual:** Higher-quality AI outputs reduce manual editing and speed up delivery.


### 185. Analytics Intelligence — Phase 4 (Strategy Engine + Client Polish)
**What it does:** Completes the analytics intelligence feature set with five sub-tasks: (1) **Strategy generation enrichment** (`buildStrategyIntelligenceBlock()` in `keyword-strategy.ts`): Injects keyword clusters (topic groups from GSC queries with aggregate metrics), competitor gaps (sorted by volume, capped at 15), performance deltas (declining keywords from content decay insights), and conversion-weighted page data into the master strategy prompt. AI gets explicit instructions to use clusters for site keyword themes, competitor gaps for content gap priorities, and conversion data to protect "money pages". Wired via `getInsights()` from intelligence layer. (2) **2 new client insight cards** (`InsightCards.tsx`): Schema Opportunities card — shows high-traffic pages that could benefit from structured data, tier-gated with upgrade CTA for free. Content Health card — shows decaying content with estimated session recovery from refresh, sorted by severity. Grid upgraded from 3-column to responsive 3-column layout with 5 cards. (3) **Analytics annotations** — New `analytics_annotations` SQLite table (migration 036) with CRUD module (`analytics-annotations.ts`): `createAnnotation()`, `getAnnotations()` (filters by date range + category), `updateAnnotation()`, `deleteAnnotation()`. 4 admin routes (GET/POST/PATCH/DELETE) + 1 public route for client dashboard. Categories: site_change, algorithm_update, campaign, other. (4) **Content calendar intelligence** (`content-calendar-intelligence.ts`): `suggestPublishDates()` derives actionable recommendations from decay insights (refresh) and quick wins (promote), prioritized by severity, deduplicated by page URL, capped at 15. (5) **GSC pagination** (`paginateGscQuery()` in `search-console.ts`): Generic async pagination helper fetches multiple pages using startRow parameter, up to configurable maxRows (default 2000). `getQueryPageData()` upgraded with `maxRows` option — intelligence computation now fetches 2000 rows instead of 500 for more comprehensive keyword/page analysis. 35 new TDD tests across 5 test files.
**Files:** `server/routes/keyword-strategy.ts` (buildStrategyIntelligenceBlock + intelligence wiring into master prompt), `src/components/client/InsightCards.tsx` (SchemaOpportunitiesCard + ContentHealthCard + 5-card grid), `server/db/migrations/036-analytics-annotations.sql` (new), `server/analytics-annotations.ts` (new), `server/routes/google.ts` (annotation CRUD routes), `server/content-calendar-intelligence.ts` (new), `server/search-console.ts` (paginateGscQuery + getQueryPageData maxRows), `server/analytics-intelligence.ts` (paginated getQueryPageData call), `tests/unit/strategy-intelligence-enrichment.test.ts` (new, 8 tests), `tests/unit/gsc-pagination.test.ts` (new, 6 tests), `tests/unit/analytics-annotations.test.ts` (new, 8 tests), `tests/unit/content-calendar-intelligence.test.ts` (new, 6 tests), `tests/component/InsightCardsPhase4.test.tsx` (new, 7 tests)

**Agency value:** Data-driven strategy decisions backed by real search data. Automates manual research tasks.

**Client value:** Clear, actionable strategy recommendations grounded in market data.

**Mutual:** Strategy conversations backed by evidence, not guesswork.


---

## Outcome Intelligence

### 189. Outcome Intelligence Engine
**What it does:** Platform-wide action tracking and outcome measurement system. Records actions from 10+ systems (content publishing, SEO fixes, schema changes, strategy updates, brief generation, keyword mapping, redirects, performance work, approvals, annotation events), then measures results at 7/30/60/90-day checkpoints using GSC clicks/impressions and GA4 sessions/conversions. Each action is scored as `strong_win`, `win`, `neutral`, `loss`, or `inconclusive` based on traffic delta thresholds. Feature flagged: `outcome-tracking`.

**Agency value:** Closes the loop on every recommendation and execution — the platform answers "did that work?" with real data, not gut feel. Demonstrates ROI on every action taken inside the dashboard.

**Client value:** Proof that the agency's work is moving the needle. Win/loss history for every optimization surfaces in client-facing views.

**Mutual:** Transforms the platform from a tool that records work into one that measures outcomes. Every action becomes a data point in a continuous improvement loop.

---

### 190. Workspace Learnings
**What it does:** AI feedback loop that aggregates outcome data into structured learnings injected into all AI prompts. After measuring outcomes, the system identifies patterns — what works, what doesn't, which pages respond to which action types — and surfaces them as structured `WorkspaceLearning` objects. Confidence thresholds: high (25+ scored outcomes), medium (10–24), low (<10). Learnings are injected into schema generation, content brief, strategy, and chat advisor prompts. Feature flagged: `outcome-ai-injection`.

**Agency value:** The AI gets smarter about each client over time. Recommendations are grounded in what has actually worked for that specific workspace — not generic best practices.

**Client value:** Strategies tailored to the history of their site. Wins get replicated; losing patterns get avoided.

**Mutual:** Self-improving intelligence that compounds over time. The longer the platform is used, the more accurate its recommendations become.

---

### 191. Outcomes Dashboard (Admin)
**What it does:** Admin dashboard with a win-rate scorecard, chronological action feed, top wins panel, and learnings summary panel. 4-tab layout (Overview, Actions, Wins, Learnings) with filterable views by action type and time range. Win rate ring uses `scoreColor()` scale (green ≥70, amber 40–69, red <40). Score badges: green = strong_win/win, amber = neutral, red = loss, zinc = insufficient_data/inconclusive. Feature flagged: `outcome-dashboard`.

**Agency value:** One screen answers "what are we winning at, what's not working, and what has the AI learned?" Filterable action feed makes account reviews faster. Win rate ring provides instant portfolio health signal.

**Client value:** N/A — admin-only.

**Mutual:** Admin has a single source of truth for outcome performance across all workspaces.

---

### 192. Client Outcome Reporting
**What it does:** Tiered client views showing outcome results with tone and depth matched to plan tier. Free tier: top 3 wins only. Growth tier: full scorecard with win rate ring and action summary. Premium tier: detailed breakdown with action-by-action results, delta indicators, and trend charts. Includes the "We Called It" feature for wins on externally detected recommendations — surfaces in the client dashboard when GSC/GA4 improvement is detected on a page that had an unimplemented recommendation. Feature flagged: `outcome-client-reporting`.

**Agency value:** Outcome reporting becomes a retention and upsell tool. Free-tier clients see the value; Growth/Premium clients get full transparency.

**Client value:** Concrete proof of ROI — not just "we did work" but "here's what changed." Premium clients see exactly which actions drove results.

**Mutual:** Outcome visibility builds trust and justifies pricing at every tier.

---

### 193. External Execution Detection
**What it does:** Detects when recommendations are implemented outside the platform (e.g., client or developer acts on a recommendation without using the dashboard). Compares GSC/GA4 performance against pages with open recommendations. Triggers a confirmation window requiring 2 consecutive detection cycles before marking as externally executed — prevents false positives from normal ranking volatility. Creates a `platform_action` record with source `external_detection` when confirmed. Feature flagged: `outcome-external-detection`.

**Agency value:** Captures credit for recommendations that were acted on outside the tool. Win rate stays accurate even when clients implement changes manually.

**Client value:** The platform notices when their site improves and attributes it correctly — no manual logging required.

**Mutual:** Complete outcome picture regardless of execution path.

---

### 194. Multi-Workspace Outcomes Overview
**What it does:** Cross-workspace table in the admin Command Center showing win rates, recent trends, outcome counts, and attention flags for every workspace. Aggregate stats bar shows platform-wide totals (total actions, total wins, average win rate). Sortable by win rate, trend direction, and total actions. Workspaces with declining win rates or low outcome counts are flagged for attention. Part of `outcome-dashboard` feature flag.

**Agency value:** Portfolio-level outcome visibility in one screen. Quickly identifies which clients are seeing wins and which need strategy adjustments. Outcome trends surface account health proactively.

**Client value:** N/A — admin-only.

**Mutual:** Admin can prioritize client attention based on outcome data, not just instinct.

---

### 195. Action Playbooks
**What it does:** Pattern detection from multi-action pages. Analyzes pages where 3+ actions were executed and discovers reusable action sequences with historical win rates. A playbook captures the ordered sequence of action types, the average traffic delta achieved, and the number of times that sequence has been executed. Playbooks are surfaced in the admin Outcomes Dashboard and can be referenced by the AI advisor when making recommendations for similar page types. Feature flagged: `outcome-playbooks`.

**Agency value:** Converts tacit knowledge ("what we usually do for service pages") into explicit, measurable playbooks. Replicates winning sequences across the portfolio.

**Client value:** Recommendations grounded in proven patterns, not experimentation.

**Mutual:** Institutional knowledge capture — the platform gets smarter as the agency does more work.

---

### 196. Backfill Engine
**What it does:** Retroactive action creation from historical platform data. On first run, scans `generated_posts`, `analytics_insights`, and `recommendation_sets` tables and creates `platform_action` records for past activity — so the outcome measurement system has historical data to measure from day one. Designed to run once and be idempotent (safe to re-run without creating duplicates). Uses a `backfill_completed` flag to skip on subsequent runs. Part of `outcome-tracking` feature flag.

**Agency value:** New workspaces don't start from zero. Historical content, insights, and recommendations are immediately enrolled in outcome measurement — giving the system data to learn from on day one.

**Client value:** N/A — infrastructure only.

**Mutual:** Outcome intelligence is useful immediately after setup, not only after months of new activity.

---

## Unified Workspace Intelligence

### 197. Unified Workspace Intelligence Layer — Phase 1 (Foundation)
**What it does:** Shadow infrastructure layer that unifies workspace context (SEO data, insights, learnings, page profiles) into a single cached intelligence object. Three-layer architecture: shared data accessors (cached Webflow page data with workspace-scoped token resolution), intelligence core assembler (`buildWorkspaceIntelligence()` with per-slice graceful degradation, LRU cache, single-flight dedup), and API/frontend surface (`GET /api/intelligence/:workspaceId`, React Query hook). Migrates all 20 `listPages()` callers to centralized `getWorkspacePages()`/`getWorkspaceAllPages()` accessors with 10-minute caching. Shadow-mode comparison in `buildSeoContext()` validates new layer against existing code behind `intelligence-shadow-mode` feature flag. Two-view page cache: published pages (no CMS templates) for HTML scanning, all live pages (including CMS templates, excluding drafts/archived) for collection item enumeration.

**Files:** `shared/types/intelligence.ts` (type definitions), `server/workspace-intelligence.ts` (core assembler + formatter), `server/workspace-data.ts` (cached page accessors), `server/intelligence-cache.ts` (LRU cache + single-flight), `server/routes/intelligence.ts` (API endpoint + health), `src/hooks/admin/useWorkspaceIntelligence.ts` (React Query hook), `src/api/intelligence.ts` (API client), `server/db/migrations/043-intelligence-caching-layer.sql` (DB tables), `server/seo-context.ts` (shadow-mode delegation), 20+ server files migrated from `listPages()` to shared accessors

**Agency value:** Unified intelligence object replaces ad-hoc data fetching across features. Single API call provides all workspace context for AI advisors, strategy tools, and audit features. Shared page cache eliminates redundant Webflow API calls. Shadow-mode validation ensures correctness before switching callers.

**Client value:** N/A — infrastructure only (Phase 1). Phase 2+ will expose intelligence-driven features to the client portal.

**Mutual:** Foundation for cross-feature intelligence sharing. Every future feature that needs workspace context consumes from one source of truth instead of fetching independently.

### 198. Unified Workspace Intelligence Layer — Phase 2A (Bridge Infrastructure)
**What it does:** Builds the event bridge execution framework that all cross-system propagation routes through. `executeBridge()` provides feature-flag gating, timeout, error isolation, and structured logging. `fireBridge()` for sync callers, `debounceBridge()` for rapid-fire invalidation, `withWorkspaceLock()` for serialized mutations. 15 bridge feature flags (all default OFF). Pre-configured debounced instances for strategy, page analysis, and settings cascade bridges. Persistent sub-cache (`intelligence_sub_cache` table) with surgical key/prefix invalidation. Migrates page cache to LRU with `peek()` for stale fallback. Barrel export for `useWorkspaceIntelligence` hook. Content pipeline summary data accessor with 5-min persistent cache.

**Files:** `server/bridge-infrastructure.ts`, `shared/types/feature-flags.ts` (15 bridge flags), `server/intelligence-cache.ts` (LRU `peek()`), `server/workspace-data.ts` (LRU migration, `getContentPipelineSummary()`), `server/workspace-intelligence.ts` (personas stub), `src/hooks/admin/index.ts` (barrel), `tests/bridge-infrastructure.test.ts`, `tests/bridge-pairing.test.ts`, `tests/workspace-data.test.ts`

**Agency value:** Bridge infrastructure enables automatic cross-system effects — strategy changes automatically invalidate caches, actions auto-resolve insights, content decay auto-generates briefs. All behind feature flags for safe rollout.

**Client value:** N/A — infrastructure only. Enables Phase 2B+ client-facing effects.

**Mutual:** Foundation for intelligent automation. Agency work propagates effects automatically; client sees fresher, more connected data.

### 199. Unified Workspace Intelligence Layer — Phase 2B (Simple Bridges)
**What it does:** Wires 6 event bridges that propagate effects between subsystems. Bridge #2: content decay analysis → auto-suggest content briefs (top 5 decaying pages). Bridge #3: strategy save → debounced intelligence cache invalidation. Bridge #5: page analysis → debounced SEO context + intelligence cache clear. Bridge #7: action recorded → auto-resolve related insights to in_progress. Bridge #11: workspace settings change → cascade invalidation (intelligence + page cache + all slice caches). Bridge #13: action recorded → create analytics annotation on timeline. Also includes CRUD store + REST endpoints for suggested briefs table, frontend typed API client, and WebSocket handlers for 3 new bridge events.

**Files:** `server/suggested-briefs-store.ts`, `server/routes/suggested-briefs.ts`, `src/api/suggested-briefs.ts`, `shared/types/intelligence.ts` (SuggestedBrief type), `server/analytics-insights-store.ts` (resolution_source), `server/outcome-tracking.ts` (Bridges #7, #13), `server/routes/content-decay.ts` (#2), `server/routes/keyword-strategy.ts` (#3, #5), `server/routes/public-portal.ts` (#3), `server/routes/webflow-keywords.ts` (#5), `server/routes/jobs.ts` (#5), `server/routes/workspaces.ts` (#11), `src/lib/wsEvents.ts`, `src/hooks/useWsInvalidation.ts`, `tests/bridges-simple.test.ts`, `tests/suggested-briefs-store.test.ts`

**Agency value:** Subsystems talk to each other automatically. Strategy changes invalidate stale AI context. Recording an action auto-resolves insights and creates audit-trail annotations. Content decay analysis generates actionable brief suggestions without manual intervention.

**Client value:** (Indirect — Phase 3 will expose suggested briefs and auto-resolved insights.) Fresher data, fewer stale recommendations, faster response to changes.

**Mutual:** Closed intelligence loops. Every mutation propagates its effects without manual orchestration. Agency sees less stale data; system becomes self-maintaining.

### 200. Unified Workspace Intelligence Layer — Phase 3A Batch 1b (Slice Assemblers + Bridges + Invalidation)
**What it does:** Implements 8 full intelligence slice assemblers (seoContext enrichment, learnings enrichment, contentPipeline, siteHealth, clientSignals, operational, pageProfile) with compositeHealthScore computation (40% churn + 30% ROI + 30% engagement, weight-normalized). Read-time bridges: Bridge #8 (repeat-decay detection via outcome history), Bridge #9 (keyword score adjustment by KD-range win rates), Bridge #14 (cache invalidation wired to schedulers/anomaly-detection/churn-signals). WebSocket `INTELLIGENCE_CACHE_UPDATED` event broadcasts on invalidation → frontend React Query auto-refresh. All slices use per-slice try/catch isolation for graceful degradation.

**Files:** `server/workspace-intelligence.ts` (8 slice assemblers, LRU cache invalidation with broadcast), `shared/types/intelligence.ts` (slice type contracts), `server/content-decay.ts` (Bridge #8 repeat-decay + `isRepeatDecay`/`priority` on DecayingPage), `server/keyword-recommendations.ts` (Bridge #9 score adjustment), `server/churn-signals.ts` (conditional cache invalidation), `server/outcome-crons.ts` (Bridge #14 invalidation wiring), `server/scheduled-audits.ts` (invalidation after audit), `server/anomaly-detection.ts` (conditional invalidation on new anomalies), `src/hooks/useWsInvalidation.ts` (INTELLIGENCE_CACHE_UPDATED handler), 9 test files

**Agency value:** `/api/intelligence/:wsId` returns complete workspace context in a single call — all 8 slices with cross-system enrichment. AI advisors, strategy tools, and dashboards get unified data without ad-hoc fetching. compositeHealthScore gives at-a-glance client health assessment. Automatic cache invalidation keeps data fresh after audits, outcome measurements, learnings recomputation, and churn signal detection.

**Client value:** (Indirect — Phase 3B+ will consume slices in client-facing views.) Richer, cross-referenced intelligence data drives better AI recommendations and strategy suggestions.

**Mutual:** Intelligence layer is now fully populated. Every workspace mutation that affects intelligence data automatically invalidates the cache and notifies connected frontends. Foundation for `formatForPrompt()` token-budget-aware AI context injection.

---

### 201. Unified Workspace Intelligence Layer — Phase 3A Batch 1c (Prompt Formatting + Token Budget + Quality Gates)
**What it does:** Completes Phase 3A with prompt-layer infrastructure and regression protection. (1) **`formatForPrompt()` expansion**: 5 new slice formatters (contentPipeline, siteHealth, clientSignals, operational, pageProfile) each with compact/standard/detailed verbosity. Fixed pre-existing gaps: personas at all verbosity levels, knowledgeBase at standard+, businessProfile at standard+, WeCalledIt proven predictions at standard+. (2) **`applyTokenBudget()` truncation**: §20 priority chain — drop operational → truncate insights to 5 → drop clientSignals → summarize learnings → never drop seoContext. Token estimation ~4 chars/token. Section filtering via `opts.sections` Set. (3) **Regression guards in `scripts/pr-check.ts`**: three new warn-severity rules — no direct `listPages()` outside workspace-data.ts, no direct `buildSeoContext()` outside grandfathered callers, `recordAction()` must be gated by `workspaceId`. (4) **120+ new tests**: format-for-prompt (34), token-budget (8), intelligence-integration (5), mini-builder-extraction (6), enrich-seo-context (3), scheduler-invalidation (4), ws-intelligence-cache (1). (5) **Bridge #9 fix**: `winRateByDifficultyRange` was dead code via `as any` cast on `byKdRange` — fixed to correct field and proper bucket keys (`'0-20'` through `'81-100'`). (6) **Isolated `getPendingActions()` error path**: split try/catch in outcome-crons so transient DB errors don't silently skip measurement.

**Files:** `server/workspace-intelligence.ts` (formatForPrompt + applyTokenBudget), `scripts/pr-check.ts` (3 regression guards), `server/keyword-recommendations.ts` (Bridge #9 fix), `server/outcome-crons.ts` (isolated error paths), `tests/format-for-prompt.test.ts`, `tests/token-budget.test.ts`, `tests/intelligence-integration.test.ts`, `tests/mini-builder-extraction.test.ts`, `tests/enrich-seo-context.test.ts`, `tests/scheduler-invalidation.test.ts`, `tests/ws-intelligence-cache.test.ts`

**Agency value:** AI advisors now receive token-budget-aware, priority-ordered context from all 8 intelligence slices. The system never drops seoContext under token pressure — operational data is truncated first. pr-check guards enforce the migration path for Phase 3B.

**Client value:** (Indirect) Richer, prioritized AI context drives better recommendations and strategy suggestions with no token waste.

**Mutual:** Completes Phase 3A. Foundation for Phase 3B mini-builder retirement — all callers can now migrate from `buildSeoContext()` to `buildWorkspaceIntelligence()` with full prompt formatting support.

---

### 202. Unified Workspace Intelligence Layer — Phase 3B (Mini-Builder Retirement + Advanced Slices)
**What it does:** Completes the intelligence layer migration. (1) **Mini-builder retirement**: all 25 `buildSeoContext()` callers and 6 `buildPageAnalysisContext()` callers migrated to `buildWorkspaceIntelligence()` with explicit slice selection. (2) **BusinessProfile editor**: structured `industry`, `goals`, `targetAudience` fields added to workspace settings and wired into `SeoContextSlice`. (3) **ContentGaps bridge**: strategy layer populates `PageProfileSlice.contentGaps` automatically on strategy update. (4) **N+1 elimination**: `seo-audit.ts` and `webflow-seo.ts` bulk-fix/bulk-rewrite loops hoist workspace-level slices before per-page loops — from N full DB assemblies to 1 + N in-memory `pageMap.find()` lookups (critical for 300-page clients). (5) **strategyHistory SQL fix**: wrong column names silently killed the entire `stmts()` prepared statement cache, breaking keyword feedback, content gap votes, and schema error counts across all workspaces. (6) **Format fidelity**: 7 previously-assembled but never-rendered fields now appear in prompt formatters (rankTracking, businessProfile, strategyHistory, decayAlerts, cannibalizationWarnings, anomalyCount/types, timeSaved, roiAttribution, weCalledIt). (7) **pr-check guard upgrade**: `buildSeoContext` and `listPages` rules promoted from `warn` to `error`; stale exclusions removed. (8) **25+ new contract tests**.

**Files:** `server/seo-audit.ts`, `server/routes/webflow-seo.ts`, `server/routes/rewrite-chat.ts`, `server/workspace-intelligence.ts`, `server/analytics-intelligence.ts`, `server/content-brief.ts`, `server/internal-links.ts`, `server/aeo-page-review.ts`, `server/content-posts-ai.ts`, `server/content-decay.ts`, `server/keyword-recommendations.ts`, `server/admin-chat-context.ts`, `server/routes/jobs.ts`, `server/routes/webflow-alt-text.ts`, `server/routes/google.ts`, `server/routes/public-analytics.ts`, `server/routes/content-posts.ts`, `server/routes/webflow-keywords.ts`, `server/routes/keyword-strategy.ts`, `server/routes/intelligence.ts`, `shared/types/intelligence.ts`, `scripts/pr-check.ts`, `tests/batch2-caller-contracts.test.ts`

**Agency value:** Every AI prompt draws from the unified intelligence layer — consistent context, no stale mini-builder data, no redundant DB calls. N+1 fix makes bulk SEO viable for 300-page clients. Critical silent bug was wiping keyword feedback and content gaps across all workspaces.

**Client value:** (Indirect) Faster SEO audit and bulk-fix operations. Content gap suggestions and keyword feedback now populate correctly after the SQL fix.

**Mutual:** Closes the mini-builder era. All future AI features build on `buildWorkspaceIntelligence()`. pr-check enforces this as a hard error.

---

### 203. Unified Workspace Intelligence Layer — Phase 4A (Infrastructure: Data Retention + Cache Warming)
**What it does:** Two background cron subsystems. (1) **Data retention crons** (daily, 2-min startup delay): pruning three unbounded tables — `chat_sessions` deleted after 180 days, `audit_snapshots` deleted after 365 days, `llms_txt_cache` deleted after 90 days. Each cleanup uses a lazy prepared statement (`createStmtCache()`). (2) **Intelligence cache warming cron** (every 6h, 5-min startup delay): iterates all workspaces, skips those with no activity log entries, and calls `buildWorkspaceIntelligence()` with all non-pageProfile slices. An `isRunning` guard prevents overlapping cycles if one run exceeds 6h. Startup timeouts stored at module level so `stop*()` functions cancel them cleanly before first fire.

**Files:** `server/data-retention.ts` (new), `server/intelligence-crons.ts` (new), `server/chat-memory.ts`, `server/reports.ts`, `server/llms-txt-generator.ts`, `server/startup.ts`, `tests/data-retention.test.ts` (new), `tests/intelligence-crons.test.ts` (new)

**Agency value:** Prevents unbounded DB growth on long-running deployments. Proactive cache warming means the first AI feature request for an active workspace is served from cache rather than a cold LLM call.

**Client value:** (Indirect) Faster first-load on AI-powered features after overnight inactivity.

**Mutual:** Pure infrastructure — no UI changes. All crons `.unref()`-ed and cancel cleanly on shutdown.

---

### 204. Unified Workspace Intelligence Layer — Phase 4B (Admin Chat Migration + businessProfile Auto-Populate)
**What it does:** Two sub-tasks delivered together. (1) **Admin chat intelligence slice migration**: the `assembleAdminContext()` function in `admin-chat-context.ts` now sources workspace data through `buildWorkspaceIntelligence()` slices instead of direct DB helpers. Activity → `intel.operational.recentActivity`, CWV/PageSpeed summary → `intel.siteHealth`, client health/churn signals → `intel.clientSignals`. Context size is managed through selective slice inclusion per question category (general queries union all three supplemental slices). Approvals keep direct `listBatches()` call + `intel.operational.approvalQueue` supplement. Performance keeps direct `getLinkCheck()`/`getPageSpeed()` calls for per-URL dead link detail (up to 10) and worst-page scores (top 5) — the siteHealth slice only stores counts, matching the `listBatches()` supplement pattern. Churn signals now surface human-readable `title` and `description` fields. CWV pass rate correctly converted from 0–1 decimal to percentage. (2) **businessProfile auto-populate**: the Intelligence Profile editor gains an "Auto-fill from site data" button (Sparkles icon, teal). Calls `POST /api/workspaces/:id/intelligence-profile/autofill` which fetches the `seoContext` slice (keywords, content gaps, business context — deliberately NOT `businessProfile` to avoid chicken-and-egg), prompts `gpt-4.1-mini` (temperature 0.3, 300 tokens) in JSON mode, returns `{ industry, goals, targetAudience }` pre-filled into the form. Autofill is a pure suggestion — no save/broadcast until the user clicks Save.

**Files:** `server/admin-chat-context.ts`, `server/routes/workspaces.ts`, `src/components/settings/IntelligenceProfileTab.tsx`, `tests/admin-chat-slice-migration.test.ts` (new)

**Agency value:** Admin chat answers client health and activity questions from the same cached intelligence layer as all other AI features — no redundant queries. The auto-populate button eliminates the blank-slate friction when onboarding a new workspace: one click extracts industry/goals/audience from the site's existing keyword strategy.

**Client value:** (Indirect) Faster onboarding means the admin sets up the intelligence profile sooner, so AI features (briefs, strategy advice) are more accurate from day one.

**Mutual:** All previous direct DB calls in admin chat context are now routed through the caching layer, making cold-start latency predictable and consistent with other intelligence features.

---

### 205. Unified Workspace Intelligence Layer — Phase 4C (Client Intelligence API + Portal Widget)
**What it does:** Exposes a scrubbed, tier-gated view of `WorkspaceIntelligence` to the client portal. Four new components: (1) **`ClientIntelligence` shared type** (`shared/types/intelligence.ts`) — five interfaces (`ClientInsightsSummary`, `ClientPipelineStatus`, `ClientLearningHighlights`, `ClientSiteHealthSummary`, `ClientIntelligence`) that define what the client may see; admin-only fields (`knowledgeBase`, `brandVoice`, `churnRisk`, `operational`, `strategy_alignment` insight type, `impact_score`, `resolution_source`) are never included. (2) **`GET /api/public/intelligence/:workspaceId`** — server route that calls `buildWorkspaceIntelligence()`, assembles `ClientIntelligence` from appropriate slices, and applies tier gating: free gets insights summary + pipeline status; growth adds `learningHighlights`; premium adds `siteHealthSummary`. (3) **`useClientIntelligence` hook** — React Query hook with 5-minute stale time, barrel-exported from `src/hooks/client/index.ts`, using `queryKeys.client.intelligence()`. (4) **`IntelligenceSummaryCard`** client portal component — 2-column grid card: high-priority insights count (blue, all tiers), briefs in progress (blue, all tiers), action win rate (teal, Growth+ behind `TierGate`). Placed in `OverviewTab` after the `MonthlyDigest` card, wrapped in `ErrorBoundary`.

**Files:** `shared/types/intelligence.ts`, `server/routes/client-intelligence.ts`, `server/app.ts`, `src/api/analytics.ts`, `src/hooks/client/useClientIntelligence.ts`, `src/hooks/client/index.ts`, `src/lib/queryKeys.ts`, `src/components/client/IntelligenceSummaryCard.tsx`, `src/components/client/OverviewTab.tsx`, `tests/client-intelligence-types.test.ts`, `tests/client-intelligence-route.test.ts`, `tests/use-client-intelligence.test.ts`, `tests/intelligence-summary-card.test.ts`

**Agency value:** The intelligence layer built for admin AI features now flows through to clients — a second consumer of the same cached data at zero additional query cost. Clients can see high-level health signals in their portal without any new DB work.

**Client value:** A single "Site Intelligence" card surfaces the most important signals (top insights, content in flight, win rate) in their overview — transparent proof of work without overwhelming detail. Tier gating ensures premium features remain an upgrade motivator.

**Mutual:** Reuses the existing LRU-cached `buildWorkspaceIntelligence()` infrastructure. Client-facing data is scrubbed at the route layer so there's no risk of admin fields leaking.

---

### 206. Strategy Card Context — AI-Aware Per-Page SEO Metadata
**What it does:** Adds a `strategyCardContext` block to the keyword strategy object assembled during strategy generation. Each page in `pageMap` now carries a `cardContext` object with `pageType` (home/service/blog/etc.), `pageTypeLabel`, `strategicPriority` (high/medium/low), and `priorityReason` — derived from `getPageTypeConfig()`. This metadata is injected into content brief prompts via `buildStrategyCardBlock()` so the AI understands the page's role in the site architecture when generating guidance. Also exports `getPageTypeConfig()` from `server/routes/keyword-strategy.ts` for downstream consumption.

**Files:** `server/routes/keyword-strategy.ts`, `shared/types/workspace.ts`, `server/content-brief.ts`

**Agency value:** Content briefs now understand whether they're writing for a homepage, a service page, a blog post, or a hub page — producing appropriately structured guidance instead of generic advice. No extra API calls; context derives from existing page classification logic.

**Client value:** Briefs that actually fit the page type. A service page brief emphasizes conversion CTAs; a blog post brief emphasizes depth and internal linking; a homepage brief emphasizes authority and brand positioning.

**Mutual:** Higher-quality AI output from the same inputs — briefs require fewer rounds of edits.

---

### 207. Backlink Profile in Admin AI Intelligence Context
**What it does:** Adds an opt-in `backlinkProfile` field to the `SeoContextSlice` in the unified workspace intelligence layer. When `enrichWithBacklinks: true` is passed to `buildWorkspaceIntelligence()`, the system fetches a backlinks overview (total backlinks, referring domains) from the configured SEO data provider (SEMRush or DataForSEO) and includes it in the assembled context. The admin AI chat sets this flag, giving the advisor backlink data when answering questions about link building, authority, and competitive positioning. Cache key includes `:bl` suffix to prevent bleed between enriched and non-enriched cache entries. Provider selection respects the per-workspace `seoDataProvider` preference via `getBacklinksProvider()`, with automatic fallback when a provider's backlinks capability is disabled.

**Files:** `server/workspace-intelligence.ts`, `server/intelligence-cache.ts`, `shared/types/intelligence.ts`, `server/admin-chat-context.ts`

**Agency value:** The AI advisor can now speak to backlink strategy with real data — "You have 142 referring domains; competitors typically have 300+" — instead of generic advice. Data is fetched once per 6h cache window; subsequent admin chat messages in the same session reuse the LRU-cached result at zero API cost.

**Client value:** Indirectly — the admin AI advisor gives better backlink and authority recommendations, which translates to better link-building strategies for the client.

**Mutual:** One API call per cache window serves the entire admin chat session for that workspace.

---

### 208. SERP Features Pipeline — Capture, Store, Aggregate, and Brief Directives
**What it does:** End-to-end pipeline that captures SERP feature data from SEMRush during keyword strategy generation, stores it per-page in SQLite, aggregates it to workspace-level for AI context, and injects actionable directives into content briefs. Four stages: (1) **Capture** — `hasSerpOpportunity()` in `server/semrush.ts` parses SEMRush `Fk` codes into `{ featuredSnippet, paa, video, localPack }` booleans; strategy generation writes an array of present features (`featured_snippet`, `people_also_ask`, `video`, `local_pack`) to a new `serp_features TEXT` column (migration 051) in the `page_keywords` table. Exact-match pages always write (even empty array) to prevent COALESCE from preserving stale values. (2) **Aggregate** — `assembleSeoContext()` in the intelligence layer computes workspace-level `SerpFeatures` (`featuredSnippets: N`, `peopleAlsoAsk: N`, `localPack: bool`) from all live page entries. (3) **Prompt** — `formatSeoContextSection()` renders SERP features as a human-readable line in AI context at standard/verbose verbosity (hidden at compact). (4) **Brief directives** — `generateBrief()` in `server/content-brief.ts` checks the matched page's `serpFeatures` and prepends per-feature directives to the brief prompt: featured snippet → 40-60 word direct-answer opening; PAA → 4-6 Q&A FAQ section; video → embed recommendation; local pack → NAP + LocalBusiness schema suggestion.

**Files:** `server/db/migrations/051-page-keywords-serp-features.sql`, `shared/types/workspace.ts`, `server/page-keywords.ts`, `server/routes/keyword-strategy.ts`, `server/workspace-intelligence.ts`, `shared/types/intelligence.ts`, `server/content-brief.ts`, `tests/fixtures/rich-intelligence.ts`, `tests/unit/format-for-prompt.test.ts`

**Agency value:** Briefs automatically target the SERP features the keyword already shows — no manual research needed. A keyword with a featured snippet opportunity gets a brief that tells the writer to put a direct answer in the first 100 words; a PAA keyword gets a FAQ section directive. Results compound: better brief structure → higher chance of winning the SERP feature → better visibility for the client.

**Client value:** More content wins SERP features (featured snippets, PAA boxes) without extra work — the system structures the brief to target them. Visible in the brief itself so clients can see why the structure is the way it is.

**Mutual:** Zero additional API calls — data is a byproduct of the existing strategy generation flow. The brief directive adds concrete, measurable value (a brief optimized for a featured snippet is qualitatively different from one that isn't).

---

### 274. KD Difficulty Framing
**What it does:** Assigns a human-readable difficulty label ("Easy", "Moderate", "Hard", "Very Hard") and descriptive tooltip ("KD 45/100 — Moderate competition…") to every keyword row in StrategyTab and ContentGaps. Labels are derived from the SEMRush KD score via `kdFraming(kd)` and `kdTooltip(kd)` utilities in `src/lib/kdFraming.ts`. Tooltip renders on hover so the row stays compact while the detail is always available.

**Files:** `src/lib/kdFraming.ts`, `src/components/StrategyTab.tsx`, `src/components/ContentGaps.tsx`

**Agency value:** Instantly communicates keyword difficulty in plain language — "Hard" is scannable at a glance vs. reading a raw number. Speeds up keyword curation during client strategy sessions.

**Client value:** Clients can evaluate keyword difficulty without knowing SEO scoring scales. Labels reduce confusion and support self-service strategy review in the client portal.

**Mutual:** Removes the "what does 67 mean?" question from every strategy call. Shared vocabulary between agency and client around keyword effort.

---

### 275. Predicted Organic Impact
**What it does:** Calculates and displays the estimated monthly organic clicks for each keyword row using the formula `volume × CTR(position)`, where CTR is derived from the Backlinko position curve. Shown inline below each keyword row in StrategyTab and ContentGaps. ContentGaps uses a position-3 floor (CTR 0.103) for unranked keywords. Gives a concrete traffic upside estimate alongside difficulty and volume.

**Files:** `src/components/StrategyTab.tsx`, `src/components/ContentGaps.tsx`

**Agency value:** Converts raw keyword volume into a projected outcome ("rank for this → ~420 clicks/mo"), making ROI conversations concrete. Prioritization becomes data-driven rather than intuition-based.

**Client value:** Clients see why a specific keyword is worth pursuing — not just that it has volume, but what winning it is estimated to deliver. Supports upgrade conversations ("this keyword cluster is worth ~3,000 clicks/mo").

**Mutual:** Bridges the gap between keyword research and business outcomes. A single number that resonates in strategy reviews and justifies content investment.

---

### 276. SERP Feature Chips (Blue, All 4 Types)
**What it does:** Renders inline badge chips on keyword rows for all four SERP feature opportunity types: featured snippet, People Also Ask (PAA), local pack, and video carousel. Chips are color-corrected to blue (data law — read-only informational data) replacing prior yellow/cyan variants. Appears in StrategyTab and ContentGaps wherever the keyword's SERP feature flags are present.

**Files:** `src/components/StrategyTab.tsx`, `src/components/ContentGaps.tsx`

**Agency value:** At-a-glance identification of high-value SERP real estate opportunities. A keyword with a featured snippet chip is an immediate priority for structured content — no cross-referencing required.

**Client value:** Clients can see which keywords give them a shot at featured placements. Makes abstract "SERP features" tangible with small, recognizable chips on the strategy view.

**Mutual:** Correct blue color enforces the Three Laws of Color design system. All four chip types now present (prior implementation was incomplete) — no opportunity type goes unrepresented.

---

### 277. SEO Editor CMS Write Guards & Static-Only Endpoint
**What it does:** The SEO Editor fetches from `/api/webflow/pages/:siteId` (static pages only). CMS collection items are edited through the separate CMS Editor which fetches real item IDs from the CMS Items API. Defense-in-depth guards (`filterWritableIds`, `filterWritableItems`, `filterPagesNeedingFix`, `countMissingField`) ensure that any CMS pages with synthetic `cms-*` IDs are excluded from all Webflow write operations — bulk AI rewrite, pattern apply, bulk fix, approval submission, and individual save. Server-side guards at the PUT and bulk endpoints provide a second layer of protection.

**Files:** `src/components/SeoEditor.tsx`, `src/hooks/admin/useSeoEditor.ts`, `src/hooks/admin/seoEditorFilters.ts`, `server/routes/webflow.ts`, `server/routes/webflow-seo.ts`, `server/routes/approvals.ts`

**Agency value:** Clean separation: SeoEditor handles static Webflow pages (auto-apply via API), CMS Editor handles collection items (real CMS item IDs). No silent 404s from passing synthetic IDs to Webflow. Defense-in-depth means a single guard failure won't corrupt data.

**Client value:** Approvals submitted through SeoEditor correctly target only pages that can be auto-applied. No confusing failures when approved changes can't be written.

**Mutual:** Eliminates the "why didn't my changes apply?" class of issues by preventing unwritable pages from entering the write path at all.

---

## Platform Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 55+ | Audit, fix, optimize, AEO trust signals, schema intelligence, page analysis, site architecture, link health |
| Content & Strategy | 45+ | Strategy → brief → AI post → review → publish pipeline, content matrices, templates, keyword intelligence, competitive analysis |
| Analytics & Tracking | 15+ | Connected Intelligence Engine, insights computation, rank tracking, revenue analytics, AI usage tracking |
| AI & Intelligence | 15+ | Full-spectrum AI advisors, knowledge base, brand voice, recommendations engine, unified context architecture, AEO page review |
| Outcome Intelligence | 8+ | Action tracking, outcome measurement (7/30/60/90d), workspace learnings, client reporting, external detection, playbooks, backfill |
| Client Portal | 30+ | 24/7 data access, approvals, onboarding, plans, feedback, strategy participation, content plan review, email capture |
| Monetization | 8+ | Stripe Checkout + Subscriptions, self-service cart, billing portal, recurring content subscriptions, ROI-backed upgrade prompts |
| Auth & Security | 7+ | Internal users, workspace ACL, client users, Helmet/HTTPS, rate limiting, CAPTCHA, credential stuffing protection |
| Platform & UX | 25+ | Design system, command center, UX overhaul, navigation, cross-linking, roadmap, Recharts, mobile guard |
| Architecture & Infrastructure | 30+ | Server refactor, React Query migration (5 phases), React Router, typed API client, Pino logging, Sentry, CI/CD, SQLite optimization |

**310 features** across the platform. The core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**

Current feature count: **310**. Last updated: April 2026.

---

### 278. Incremental Keyword Strategy Update Mode
**What it does:** Adds a `mode` parameter to `POST /api/webflow/keyword-strategy/:workspaceId`. When `mode='incremental'`, the server checks each page's `analysis_generated_at` timestamp against a 7-day threshold. Pages with fresh analysis (< 7 days old) are skipped from AI batching and their existing keyword assignments are preserved untouched in the database. Only stale/new pages go through the full AI + SEMRush pipeline. At save time, `upsertPageKeywordsBatch` is used instead of `upsertAndCleanPageKeywords` so the untouched fresh rows remain intact. The admin `KeywordStrategy.tsx` component gains an "Update changed pages" button (secondary style, adjacent to "Regenerate") that triggers incremental mode. Also adds `competitorLastFetchedAt` field to the `Workspace` type and DB (migration 052) for future use tracking when competitor data was last fetched.
**Files:** `server/routes/keyword-strategy.ts`, `src/components/KeywordStrategy.tsx`, `server/workspaces.ts`, `shared/types/workspace.ts`, `server/db/migrations/052-workspace-competitor-fetch.sql`, `tests/integration/keyword-strategy-incremental.test.ts`

**Agency value:** Cuts strategy generation time and AI/SEMRush API costs by 50-70% for sites that haven't changed much since the last full run. One click to update only the pages that need it.

---

### 279. Assembler Catch Hardening (workspace-intelligence.ts)
**What it does:** Upgrades all 64 catch blocks in `server/workspace-intelligence.ts` to distinguish programming errors (TypeError/ReferenceError/SyntaxError) from expected degradation (plain Error / unavailable module). Adds `server/errors.ts` with `isProgrammingError()` utility. 3 HIGH-risk dynamic-import blocks (outcome-tracking, anomaly-detection, churn-signals) now call `isProgrammingError()` and escalate to `log.warn` so Sentry fires; 43 SILENT blocks upgraded to `log.debug` to surface previously-invisible failures in logs; 2 intentionally-silent cache-invalidation catches annotated with `// catch-ok`. Compile-time export contracts added via `import type` for HIGH-risk modules. Hardening also applied to `content-decay.ts`, `keyword-recommendations.ts`, and `routes/misc.ts`. Backlog bugs resolved in same pass: #17 (stale-cache: workspaceIds from `measurePendingOutcomes` return value), #14 (cold-start section filter: `hasSeoContent`/`hasData` respects include Set), #15/#16 (gradual token budget degradation: steps 4b/4c/4d added to `applyTokenBudget`). A `pr-check` rule was added to prevent bare `catch {` from being re-introduced to `workspace-intelligence.ts`.

**Files:** `server/errors.ts`, `server/workspace-intelligence.ts`, `server/content-decay.ts`, `server/keyword-recommendations.ts`, `server/routes/misc.ts`, `server/outcome-crons.ts`, `scripts/pr-check.ts`, `tests/assembler-programming-error-surfacing.test.ts`

**Agency value:** Programming errors in assembler catch blocks previously silenced TypeErrors and ReferenceErrors as empty-fallback degradation. After hardening, any renamed export or null-dereference in a slice assembler fires a Sentry alert immediately instead of silently returning stale/empty data to the AI prompt. Eliminates the silent data-loss class of bugs in the intelligence engine.

**Mutual:** CI enforcement — the new `pr-check` rule prevents future bare catches from being introduced in workspace-intelligence.ts. Any contributor who writes `} catch {` in that file will see an error before the PR merges.

---

## Copy & Brand Engine — Phase 1: Brand Foundation

### 307. Brandscript Engine
**What it does:** Structured brand narrative builder based on the StoryBrand framework (Donald Miller). Stores brand stories as a workspace-scoped `brandscripts` table with child `brandscript_sections` rows. Eight canonical section types: Hook, Character, Problem, Guide, Plan, Call to Action, Failure, Success. Full CRUD API: list, get, create (from template or blank), update name/framework, delete. Section batch-update via delete-all + reinsert with `created_at` / `sort_order` preservation. A seeded `brandscript_templates` table ships with the default StoryBrand template. `generateBrandscript()` uses GPT-4.1 with workspace intelligence context to pre-populate all sections from existing brand knowledge. `questionnaire → brandscript` auto-population maps onboarding questionnaire answers (about, services, differentiators, personas, competitors) into the 8 sections idempotently — returns existing brandscript if one already exists. Admin UI in `BrandscriptTab.tsx` with inline section editing, AI generation trigger, and live preview.

**Files:** `server/brandscript.ts`, `server/routes/brandscript.ts`, `server/db/migrations/053-brandscript-engine.sql`, `shared/types/brand-engine.ts`, `src/components/brand/BrandscriptTab.tsx`

**Agency value:** Captures the brand narrative in a structured, reusable format that feeds every downstream AI feature (copy generation, voice calibration, deliverable generation). Replaces unstructured brand docs with a queryable framework.

**Client value:** A clear articulation of their brand story they can review, edit, and approve — not a black box.

**Mutual:** The brandscript is the single source of truth for brand narrative across copy, voice, and identity deliverables.

---

### 308. Discovery Ingestion
**What it does:** Ingestion pipeline for raw brand source material. Accepts uploads of transcripts, brand documents, competitor profiles, existing copy, and website crawl data (`source_type` enum). AI-powered extraction (GPT-4.1-mini) pulls structured signals from raw content: brand attributes, voice signals, audience insights, product details, competitive intelligence, and value propositions (`extraction_type` + `category` fields). Each extraction carries a confidence rating (`high`/`medium`/`low`) based on source type (transcripts → high; website crawl → low). Extractions include a `source_quote` anchoring them to specific passages. `SourceAlreadyProcessedError` guards against double-processing: re-processing requires explicit `{ force: true }` which deletes prior extractions and replaces them. Extractions can be reviewed, edited, approved, dismissed, or routed to specific brand tools (`routed_to` field). Admin UI in `DiscoveryTab.tsx` shows sources list with extraction status and per-source extraction review panel.

**Files:** `server/discovery-ingestion.ts`, `server/routes/brandscript.ts`, `server/db/migrations/053-brandscript-engine.sql`, `shared/types/brand-engine.ts`, `src/components/brand/DiscoveryTab.tsx`

**Agency value:** Turns unstructured brand assets (sales call transcripts, intake docs, old website copy) into structured brand intelligence without manual analysis. Source material automatically feeds voice calibration and brandscript generation.

**Client value:** Existing brand materials are respected and incorporated rather than starting from scratch.

---

### 309. Voice Calibration
**What it does:** Voice profile state machine (`draft → calibrating → calibrated`) that codifies a workspace's brand voice into AI-consumable structures. Three data layers: **Voice DNA** (tone dimensions with weights, vocabulary preferences, forbidden phrases, structural preferences), **Guardrails** (tone boundaries, anti-patterns, content rules, brand promises), and **Context Modifiers** (per-context adjustments for headline/body/cta/about copy). Calibration sessions generate 3 AI variations of a given copy type (`promptType` string — e.g., `hero_headline`, `service_cta`, `brand_story`). The agency selects the preferred variation; selection distills the chosen text into voice DNA dimensions via AI analysis using Claude (`callCreativeAI`). Voice samples (with `context_tag` labels: `headline`, `body`, `cta`, `about`) feed calibration context. `buildVoiceCalibrationContext()` assembles samples, DNA, and guardrails for injection into copy generation prompts. `INSERT OR IGNORE` on `voice_profiles(workspace_id)` prevents duplicate profile creation under concurrent requests. Admin UI in `VoiceTab.tsx`.

**Files:** `server/voice-calibration.ts`, `server/voice-dna-render.ts`, `server/prompt-assembly.ts`, `server/routes/voice-calibration.ts`, `server/db/migrations/053-brandscript-engine.sql`, `shared/types/brand-engine.ts`, `src/components/brand/VoiceTab.tsx`

**Agency value:** Replaces ad-hoc brand voice notes with a structured, versionable voice profile that feeds every AI generation in the platform. Once calibrated, every piece of AI-generated copy sounds like the client — not generic marketing language.

**Client value:** Their brand voice is encoded, not just described. Generated copy consistently reflects their personality across all content types.

**Mutual:** A calibrated voice profile is the highest-leverage input in the copy generation stack. It self-improves over time via the Voice Feedback Loop (feature #287).

---

### 310. Brand Identity Deliverables
**What it does:** AI-generated brand identity document suite organized into three tiers — **Essentials** (mission, vision, values, tagline, elevator_pitch), **Professional** (archetypes, personality_traits, voice_guidelines, tone_examples, messaging_pillars, differentiators, positioning_matrix), **Premium** (brand_story, personas, customer_journey, objection_handling, emotional_triggers). 17 deliverable types total. Each deliverable is stored with version history (`brand_identity_versions` table). `generateDeliverable()` uses Claude (`callCreativeAI`) with full intelligence context (workspace intel + voice calibration context + brandscript sections + discovery extractions). Approved copy auto-adds a voice sample via `addVoiceSample()` so each approval strengthens the voice profile. Status machine: `draft → approved`. Steering notes accumulate across regenerations. `broadcastToWorkspace()` fires on every generation/approval for real-time UI sync. Admin UI in `IdentityTab.tsx` with tier grouping, deliverable cards, inline steering, and version history viewer.

**Files:** `server/brand-identity.ts`, `server/routes/brand-identity.ts`, `server/db/migrations/053-brandscript-engine.sql`, `shared/types/brand-engine.ts`, `src/components/brand/IdentityTab.tsx`

**Agency value:** Generates 17 brand identity documents in minutes from existing workspace intelligence. Tier grouping lets agencies deliver essentials quickly, then upsell professional and premium deliverables. Version history tracks every regeneration.

**Client value:** A complete brand identity package — not just copy, but archetypes, personas, customer journey maps, and objection handling — all grounded in their actual business data.

**Mutual:** Brand identity deliverables become context for every downstream feature: copy generation, voice calibration, AI chat, and content briefs all reference the approved deliverable suite.

---

## Copy & Brand Engine — Phase 3: Full Copy Pipeline

### 280. Copy Generation Pipeline
**What it does:** AI-powered copy generation for every page in a client's site blueprint. Uses Claude Sonnet 4 (via `callAnthropic`) with an 8-layer context assembly: voice DNA, brand identity deliverables, brandscript, SEO context, content brief, page-type config, quality rules, and cross-page awareness. Generates section-by-section copy matching the blueprint's section plan (hero, problem, solution, features, CTA, FAQ, etc.). Each section gets AI annotations explaining creative decisions and quality flags (word count, readability, guardrail violations). SEO metadata (title, meta description, OG tags) generated alongside copy. Deferred initialization pattern prevents data loss on AI failure — existing approved copy is preserved until new generation succeeds, then written atomically in a `db.transaction()`.

**Files:** `server/copy-generation.ts`, `server/copy-review.ts`, `server/db/migrations/058-copy-pipeline.sql`, `shared/types/copy-pipeline.ts`, `server/schemas/copy-pipeline.ts`

**Agency value:** Transforms site blueprints from planning documents into live copy — every page gets AI-generated content matched to brand voice, SEO targets, and page-type best practices. Eliminates the blank-page problem for copywriters.

**Client value:** Faster time-to-copy. Every page in their site strategy gets professionally written content informed by their brand voice, competitive landscape, and keyword targets.

**Mutual:** Bridges the gap between strategy (blueprints) and execution (live copy), making the agency's deliverable pipeline end-to-end.

---

### 281. Copy Review & Steering
**What it does:** Section-by-section copy review with inline editing, status management, and AI-powered regeneration with steering. Status machine: `pending → draft → client_review/approved`, `client_review → approved/revision_requested`, `revision_requested → draft`. Inline text editing auto-resets status to draft. Regenerate with steering notes — accumulated steering persists across regeneration cycles. Quality flags surface readability issues, word count violations, and guardrail breaches. Client suggestion system stores original + suggested text side-by-side.

**Files:** `server/copy-review.ts`, `server/routes/copy-pipeline.ts`, `src/components/brand/CopyReviewPanel.tsx`, `src/hooks/admin/useCopyPipeline.ts`

**Agency value:** Systematic review workflow replaces ad-hoc copy feedback. Steering notes guide AI regeneration instead of manual rewrites. Version tracking preserves history.

**Client value:** Clear status visibility (draft/in-review/approved). Structured feedback mechanism via suggestions.

---

### 282. Batch Copy Generation
**What it does:** Generate copy for multiple blueprint entries in a single operation. Entry selection with page-type labels, mode picker (all/selected), configurable batch size. Real-time progress tracking via WebSocket broadcasts. Rate-limited AI endpoints (3 req/min/IP). Background processing with job status tracking (`copy_batch_jobs` table).

**Files:** `src/components/brand/BatchGenerationPanel.tsx`, `server/routes/copy-pipeline.ts`

**Agency value:** Generate copy for an entire site blueprint in one click instead of page-by-page. Progress visibility prevents duplicate work.

---

### 283. Copy Export
**What it does:** Export approved copy in multiple formats: CSV (with formula injection mitigation), Copy Deck (structured Markdown), and Webflow push. Scope selector: export all entries, selected entries, or single entry. CSV escapes values starting with `=`, `+`, `-`, `@` to prevent spreadsheet formula injection. Copy deck format organizes by page with section headings, SEO metadata, and AI annotations.

**Files:** `server/copy-export.ts`, `src/components/brand/CopyExportPanel.tsx`

**Agency value:** Client-ready deliverables in the format they need. Copy deck for review meetings, CSV for CMS import, Webflow push for direct publishing.

---

### 284. Copy Intelligence (Pattern Learning)
**What it does:** Extracts recurring patterns from generated copy — terminology choices, tone markers, structural patterns, keyword usage. Patterns track frequency and can be toggled active/inactive. When frequency reaches >= 3, patterns surface as "Promote to Voice Guardrail" candidates. Promotion appends the pattern to the workspace's voice profile guardrails (tone boundaries or anti-patterns) in a single atomic transaction. Promotable patterns UI with one-click promotion button.

**Files:** `server/copy-intelligence.ts`, `src/components/brand/CopyIntelligenceManager.tsx`

**Agency value:** The system learns from each generation cycle. Recurring patterns get codified into voice guardrails automatically, improving future generations without manual voice profile maintenance.

---

### 285. Client Copy Review Portal
**What it does:** Client-facing copy review interface extending the existing client portal. 4 public API routes: list entries with copy status, get sections filtered to client-visible statuses (client_review/approved only, internal reasoning omitted), approve sections, and suggest edits. React component with entry list, status badges, expand-to-review, approve button (teal), and inline suggest-changes form. Real-time updates via WebSocket. Client-friendly language throughout.

**Files:** `src/components/client/ClientCopyReview.tsx`, `server/routes/public-portal.ts`

**Agency value:** Clients can review and approve copy without back-and-forth emails. Suggestions are structured and trackable.

**Client value:** Self-service review at their own pace. Clear approve/suggest workflow with real-time status updates.

---

### 286. Approved Copy → Voice Samples
**What it does:** When a copy section is approved, automatically adds the copy text as a voice sample in the workspace's voice profile. Maps section types to voice context tags (hero→headline, CTA→cta, FAQ/body sections→body, about→about). FIFO cap of 3 `copy_approved` samples per context tag per workspace — oldest deleted before inserting new. Voice calibration improves over time as more copy is approved.

**Files:** `server/copy-review.ts`

**Agency value:** Voice profiles self-improve through the normal copy approval workflow. No manual sample curation needed.

---

### 287. Voice Feedback Loop
**What it does:** Classifies steering notes as content feedback (structure/information changes) vs voice feedback (tone/style/personality) using GPT-4.1-mini. When voice feedback is detected, generates voice profile update suggestions (new guardrails or modifier adjustments) using the current voice DNA as context. Suggestions are flagged for review — never auto-applied.

**Files:** `server/copy-voice-feedback.ts`

**Agency value:** Steering feedback naturally informs voice profile evolution. Voice-related feedback is surfaced as actionable profile updates instead of being lost in steering history.

---

### 288. Questionnaire → Brandscript Auto-Population
**What it does:** Maps onboarding questionnaire data to StoryBrand framework brandscript sections. Extracts from workspace knowledge base (about, services, differentiators, competitors), intelligence profile (industry, target audience), and persona definitions (pain points, goals, objections). Maps to 8 StoryBrand sections: Character, Problem, Guide, Plan, CTA, Failure, Success, Unique Value Proposition. Idempotent — returns existing brandscript if one already exists.

**Files:** `server/brandscript.ts`

**Agency value:** Brandscripts start pre-populated from onboarding data instead of blank. Reduces brand strategy workshop time.

---

### 289. Admin Chat Copy/Blueprint Awareness
**What it does:** Adds `'copy'` context category to the admin chat AI advisor. When questions relate to copy, copywriting, blueprints, or section status, the chat assembles copy pipeline context: blueprint overview, per-entry copy status with approval percentages, active intelligence patterns. Wired into the `contentPipeline` intelligence slice for broader queries.

**Files:** `server/admin-chat-context.ts`

**Agency value:** Admin chat can answer "what's the copy status for [client]?" or "which pages still need copy?" using real pipeline data.

---

### 290. Content Decay → Copy Refresh
**What it does:** Matches decaying pages (from content decay analysis) to blueprint entries via URL/slug normalization. For matched entries, AI (GPT-4.1-mini) analyzes current copy sections against decay signals and recommends per-section actions: rewrite, update, or keep. Prioritized by severity (high/medium/low) and action type. Batch analysis processes all decaying pages for a workspace.

**Files:** `server/copy-refresh.ts`

**Agency value:** Decay signals automatically surface which specific copy sections need refreshing, not just which pages. Targeted refresh instead of full rewrites.

---

### 291. Admin Shared UX Components (NextStepsCard, ProgressIndicator, ErrorState multi-action)
**What it does:** Two new shared UI primitives and one extension integrated across 6 admin pages. **NextStepsCard** (`src/components/ui/NextStepsCard.tsx`): post-completion card displayed after AI operations succeed — shows contextual next-step actions (e.g. "Apply top fixes", "Review Quick Wins") with estimated times and teal hover accents. Dismissible. Uses `SectionCard` as outer shell with stagger animation support. **ProgressIndicator** (`src/components/ui/ProgressIndicator.tsx`): unified progress display for running operations — blue data-color bar (Three Laws compliant), deterministic or indeterminate modes, cancel button, auto-fades on completion after 3s. Returns null for idle/error (error is `ErrorState`'s job). **ErrorState `actions[]` extension**: backward-compatible multi-action support — `actions?: { label, onClick, variant?: 'primary'|'secondary' }[]` prop takes precedence over the existing singular `action` prop. All 3 components have full WAI-ARIA attributes (`role="progressbar"`, `role="alert"`, `aria-label`). **Integration**: SeoAudit (LoadingState + ErrorState + NextStepsCard), KeywordStrategy (ProgressIndicator replacing hand-rolled teal bar + ErrorState + NextStepsCard), SchemaSuggester (ProgressIndicator ×2 with cancel + ErrorState + NextStepsCard), ContentPipeline (LoadingState in 3 Suspense fallbacks), BrandHub (ProgressIndicator + ErrorState + NextStepsCard), PageIntelligence (ProgressIndicator with bulk cancel + ErrorState + NextStepsCard). Component tests: 22 tests across 3 test files.

**Files:** `src/components/ui/NextStepsCard.tsx`, `src/components/ui/ProgressIndicator.tsx`, `src/components/ui/ErrorState.tsx`, `src/components/ui/index.ts`, `src/components/SeoAudit.tsx`, `src/components/KeywordStrategy.tsx`, `src/components/SchemaSuggester.tsx`, `src/components/ContentPipeline.tsx`, `src/components/BrandHub.tsx`, `src/components/PageIntelligence.tsx`, `tests/component/NextStepsCard.test.tsx`, `tests/component/ProgressIndicator.test.tsx`, `tests/component/ErrorState.test.tsx`

**Agency value:** All admin AI operations now surface a consistent completion card pointing to obvious next actions — reduces context-switching after long-running operations. Unified error/progress UX across all 6 major tools instead of ad-hoc inline patterns.

---

## Admin UX — Onboarding & Guided Flows (PR4)

### 292. OnboardingChecklist
**What it does:** Modal-style overlay shown on first visit to a workspace (WorkspaceHome). 4-step setup checklist: Connect Webflow, Connect GSC, Run First Audit, Set Client Password. Blue progress bar tracks completion. Teal checkmarks for completed steps. Focus-trapped, closeable via Escape key or "Dismiss" button. Completion state and dismissal persisted to `localStorage` per workspace so the overlay never re-appears once dismissed. Auto-celebrates (confetti-style state) when all 4 steps are completed.

**Files:** `src/components/ui/OnboardingChecklist.tsx`, integrated in `src/components/WorkspaceHome.tsx`

**Agency value:** New workspace setup used to require knowing which tools to visit first. The checklist surfaces the four must-do setup steps in order, with direct navigation to each tool, reducing cold-start time and ensuring nothing is skipped when onboarding a new client.

**Mutual:** Faster workspace activation = faster time-to-value for both agency and client.

---

### 293. WorkflowStepper
**What it does:** Horizontal numbered stepper component showing progress through a multi-step workflow. Three visual states: green (completed), teal (current active step), zinc (future step). Compact variant (`compact` prop) for tighter layouts. Steps are clickable when `onStepClick` handler is provided. Used in ContentPipeline (4 steps: Strategy → Briefs → Posts → Publish) and SchemaSuggester generator view (5 steps: Scan → Review → Edit → Publish → Validate).

**Files:** `src/components/ui/WorkflowStepper.tsx`, integrated in `src/components/ContentPipeline.tsx` and `src/components/SchemaSuggester.tsx`

**Agency value:** Complex multi-step tools previously had no visual orientation. The stepper communicates where the user is in the workflow and what comes next, reducing confusion on first use of ContentPipeline and SchemaSuggester.

**Mutual:** Shared primitive — any future multi-step tool can adopt WorkflowStepper instead of building custom progress UI.

---

### 294. WorkspaceHealthBar
**What it does:** Multi-metric health progress bar section rendered below stat cards on WorkspaceHome. Shows per-metric progress bars for key workspace health signals (SEO health, content coverage, keyword coverage, etc.) with blue progress fills (data metric = blue per design system). Below the metrics, a "Recommended Next" section surfaces the single highest-priority action the admin should take, with a teal CTA button. Wrapped in `SectionCard`.

**Files:** `src/components/ui/WorkspaceHealthBar.tsx`, integrated in `src/components/WorkspaceHome.tsx`

**Agency value:** WorkspaceHome previously showed stat cards but no consolidated health summary or next-action prompt. WorkspaceHealthBar gives admins an at-a-glance health snapshot and a clear next step without navigating into individual tools.

**Mutual:** Turns the workspace home into an actionable command surface rather than a passive data view.

---

### 295. SeoAuditGuide
**What it does:** Guide sub-tab in SeoAudit's analysis section (alongside existing analysis tabs). 5 educational sections: issue severity levels, prioritization framework, fix options overview, AEO review guidance, and content decay explanation. Static reference content using the existing custom tab bar pattern from SeoAudit.

**Files:** `src/components/audit/SeoAuditGuide.tsx`, integrated in `src/components/SeoAudit.tsx`

**Agency value:** New team members or clients reviewing the audit can understand what each severity level means and how to prioritize fixes without leaving the tool.

---

### 296. KeywordStrategyGuide
**What it does:** Guide tab in KeywordStrategy (TabBar added alongside existing analysis tab). 6 sections: reading the strategy, understanding intent badges, content gap prioritization, KD/volume interpretation, quick win identification, and implementation order.

**Files:** `src/components/strategy/KeywordStrategyGuide.tsx`, integrated in `src/components/KeywordStrategy.tsx`

**Agency value:** KeywordStrategy output is data-dense. The guide explains how to translate strategy data into action, making the tool useful even for team members unfamiliar with SEO keyword methodology.

---

### 297. PageIntelligenceGuide
**What it does:** Guide tab in PageIntelligence (added to the existing pages|architecture tab set as a third tab). 6 sections: understanding page scores, reading architecture signals, interpreting link health, prioritization criteria, action recommendations, and integration with other tools.

**Files:** `src/components/PageIntelligenceGuide.tsx`, integrated in `src/components/PageIntelligence.tsx`

**Agency value:** PageIntelligence surfaces complex architecture and link health signals. The guide translates those signals into plain-language explanations and recommended actions, reducing the learning curve for the tool.


---

### 298. Deep Diagnostics
**What it does:** Admin-triggered deep investigation from anomaly insights. Orchestrator gathers data from GSC, GA4, SEMRush, redirect scanner, site architecture, canonical/link probe, and workspace intelligence (including backlinks). GPT-4.1 synthesizes root causes with confidence levels, ranked remediation actions (P0-P3, effort/impact/owner), and client-facing narrative. Results stored in `diagnostic_reports` table.

**Files:** `server/diagnostic-orchestrator.ts`, `server/diagnostic-store.ts`, `server/diagnostic-probe.ts`, `server/routes/diagnostics.ts`, `server/routes/jobs.ts` (deep-diagnostic case), `src/api/diagnostics.ts`, `src/hooks/admin/useDiagnostics.ts`, `src/components/admin/DiagnosticReport/` (4 components), `shared/types/diagnostics.ts`, `server/db/migrations/059-diagnostic-reports.sql`

**Agency value:** Turns anomaly alerts into actionable root cause reports in minutes. Admin sees ranked root causes with evidence, remediation plan with priority/effort/impact labels. Growth+ clients see an enriched narrative instead of the generic 'monitoring' message. Dark-launched behind `deep-diagnostics` feature flag.

---

### 299. Stripe Config Admin Auth Guard
**What it does:** Applies `requireAdminAuth` middleware to all Stripe configuration endpoints (`GET /api/stripe/config`, `POST /api/stripe/config`, `DELETE /api/stripe/config`). Prevents JWT-authenticated client users from reading or modifying Stripe secret keys, webhook secrets, and publishable keys via the admin API. Previously these endpoints were protected only by the global HMAC token gate — a JWT user token (issued to client portal users) could bypass that gate and access payment configuration.

**Files:** `server/routes/stripe.ts` (middleware applied to 3 config endpoints), `server/middleware/admin-auth.ts` (requireAdminAuth implementation)

**Agency value:** Closes a privilege-escalation vector where a client JWT token could be used to read Stripe secret keys or alter payment configuration. Stripe config is admin-only by design; this enforces that at the route level.

---

### 300. Cross-Provider Keyword & Backlink Hardening (PR #218 A3/A4 fixes)
**What it does:** Fixes data loss and date formatting regressions in competitor keyword and backlink data flowing from SEMRush and DataForSEO into strategy generation and admin/client views. (1) **serpFeatures carry**: `competitorKeywordData` interface now includes optional `serpFeatures?: string` field to preserve SERP feature data from both DFS and SEMRush alongside keyword metrics (volume, KD, intent). Previously data was fetched but silently dropped at the serialization layer. (2) **Provider date normalization**: `normalizeProviderDate()` helper converts raw Unix epoch timestamps (seconds/milliseconds) and string dates from SEMRush and DataForSEO to ISO-8601 format at the provider boundary — preventing "Invalid Date" display in referring-domain dates and backlink recency. Applied in `semrush.ts` backlinks methods and `dataForSeo.ts` backlinks + keyword methods. (3) **Competitor keyword limits**: Full-mode competitor keyword fetch raised 100 → 200 per provider; SEMRush overfetches 2× + sorts by volume client-side to match DFS server-side ordering for consistent rank ordering across strategies. (4) **Regression guards**: Two pr-check rules added — "Raw provider date passed to new Date()" flags direct date instantiation without normalization; "Competitor keyword push missing serpFeatures" enforces field carry at strategy-build time.

**Files:** `shared/types/workspace.ts` (competitorKeywordData item type), `server/seo-data-provider.ts` (normalizeProviderDate), `server/semrush.ts` (date normalization in getTopReferringDomains), `server/providers/dataforseo-provider.ts` (order_by + date normalization), `server/routes/keyword-strategy.ts` (serpFeatures carry, compLimit 100→200, fetchMultiplier), `scripts/pr-check.ts` (2 regression rules), `tests/unit/seo-data-provider.test.ts`, `tests/unit/semrush.test.ts`, `tests/unit/dataforseo-provider.test.ts`, `tests/integration/backlinks-date-shape.test.ts`, `tests/integration/keyword-strategy-serp-features.test.ts`

**Agency value:** Strategy data now carries complete competitive intelligence (keywords + SERP features) without loss. Backlink dates display correctly instead of "Invalid Date", enabling accurate link recency analysis. Consistent ordering across DFS/SEMRush backends reduces confusion when analyzing competitor tactics.

**Client value:** Complete keyword strategy includes all ranking signals (SERP features inform content brief structure). Accurate backlink dates give confidence in link profile freshness analysis.

**Mutual:** Unified data normalization prevents integration drift between provider APIs. Regression guards prevent future similar losses during refactoring.

---

### 301. Intelligence Engine Data Wiring — 12 Gap Closures
**What it does:** Closes 12 confirmed data gaps where workspace fields were assembled or computed but never reached the intelligence engine's formatters, assemblers, or client routes. Fix-forward approach — extends existing assemblers and formatters without structural changes.

**Assembler gaps closed:**
- `businessPriorities` (admin-set string[]) → merged into `businessProfile.goals` in `assembleSeoContext`
- Contact info (`phone`, `email`, `address`, `socialProfiles`, `openingHours`) from `workspace.businessProfile` → merged into `SeoContextSlice.businessProfile` in `assembleSeoContext`
- `rewritePlaybook` string → split into `patterns` array, populated as `ContentPipelineSlice.rewritePlaybook`
- `contentPricing` from workspace → populated in `ContentPipelineSlice`
- `scoringConfig` from workspace → populated in `LearningsSlice`
- Annotation `page_url` → `pageUrl` field added to `analytics_annotations` table (migration 065), `Annotation` type, and `assembleOperational` mapping

**Formatter gaps closed (in `formatForPrompt`):**
- `intentSignals` (new/total count + types) rendered in `formatClientSignalsSection` at non-compact verbosity
- `aeoReadiness` (pages checked + passing rate) rendered in `formatSiteHealthSection` at non-compact verbosity
- `redirectDetails` (up to 5 chains with url/target/chainDepth/status) rendered in `formatSiteHealthSection` at detailed verbosity
- Contact info (`phone`, `email`, `address`, `openingHours`, `socialProfiles`) rendered in `formatSeoContextSection` at detailed verbosity
- `contentPricing` rendered in `formatContentPipelineSection` at non-compact verbosity
- `scoringConfig` thresholds (up to 5 action types) rendered in `formatLearningsSection` at detailed verbosity

**Bug fix — `briefs.byStatus` always empty:** `computeContentPipelineSummary` was hardcoding `byStatus: {}`. Client portal showed "0 briefs in progress" even when briefs existed. Fixed by adding a `briefsByStatus` prepared statement using the `createStmtCache` pattern. Required migration 066 to add `status TEXT NOT NULL DEFAULT 'draft'` to `content_briefs`.

**Client route — `copyPipelineStatus`:** `formatCopyPipelineForClient` added to `client-intelligence.ts`, surfacing `totalSections`, `approvedSections`, `inReviewSections`, `approvalRate` for Growth+ tier clients.

**Rewrite-chat refactor:** Route now reads `rewritePlaybook` from `intel.contentPipeline.rewritePlaybook.patterns` (intelligence slice) instead of directly from the workspace row, eliminating the direct workspace read for this field.

**Dead type removed:** `keywordRecommendations` field removed from `SeoContextSlice` and all downstream references (test fixtures, `KNOWN_UNRENDERED_FIELDS` in pr-check).

**Files:** `shared/types/intelligence.ts`, `server/db/migrations/065-annotations-page-url.sql`, `server/db/migrations/066-content-briefs-status.sql`, `server/analytics-annotations.ts`, `server/workspace-data.ts`, `server/workspace-intelligence.ts`, `server/routes/client-intelligence.ts`, `server/routes/rewrite-chat.ts`, `tests/unit/workspace-data.test.ts`, `tests/unit/workspace-intelligence.test.ts`, `tests/contract/client-intelligence-tiers.test.ts`, `tests/intelligence-types.test.ts`, `tests/contract/intelligence-slice-population.test.ts`, `scripts/pr-check.ts`

**Agency value:** AI prompts now draw on the full workspace context — contact info for local SEO, scoring thresholds for learning framing, content pricing for pipeline briefings, and annotation page URLs for traffic event attribution. Prompt quality improves without structural changes.

**Client value:** Client portal now correctly shows in-progress brief counts (was always 0). Copy pipeline status is surfaced in the Growth+ intelligence endpoint for client-facing dashboards.

---

## Insight Hardening (PR #244)

### 302. Platform-Wide Catch Hardening
**What it does:** Extends the `isProgrammingError()` pattern from `workspace-intelligence.ts` (Feature #279) to 20+ additional server files. Upgrades silent catch blocks across routes, helpers, and module boundaries to call `isProgrammingError(err)` — routing TypeErrors/ReferenceErrors/RangeErrors to `log.warn` (Sentry-visible) while expected degradation (network failures, missing data) stays at `log.debug`. Tier 1 files (`admin-chat-context.ts`, `routes/public-analytics.ts`, `routes/public-portal.ts`, `routes/public-content.ts`, `routes/public-auth.ts`) fully hardened with no bare `catch {` blocks. pr-check rule expanded from `workspace-intelligence.ts` only to the entire `server/` directory, with `// catch-ok` escape hatch for intentionally-silent catches. `url-fetch-ok` suppressor added for catches wrapping `fetch()` (where TypeError = network failure, not a bug).

**Files:** `server/admin-chat-context.ts`, `server/anomaly-detection.ts`, `server/content-brief.ts`, `server/pagespeed.ts`, `server/sales-audit.ts`, `server/seo-audit.ts`, `server/seo-audit-site-checks.ts`, `server/webflow-pages.ts`, `server/webflow-assets.ts`, `server/routes/jobs.ts`, `server/routes/webflow-cms.ts`, `server/routes/webflow-seo.ts`, `server/routes/roadmap.ts`, `scripts/pr-check.ts`, `tests/unit/catch-hardening-smoke.test.ts`

**Agency value:** Programming errors that previously silenced as empty-fallback responses (null dereferences, renamed exports, unexpected shapes) now fire Sentry alerts immediately. Eliminates the silent data-loss class of bugs across the entire server layer, not just the intelligence assembler.

**Mutual:** CI enforcement — pr-check now catches bare `catch {` across all 70+ server files on every PR. Future contributors can't accidentally introduce silent swallowing without explicitly annotating intent.

---

### 303. Generic `AnalyticsInsight<T>` + `InsightDataMap`
**What it does:** Converts `AnalyticsInsight.data` from `Record<string, unknown>` to a generic type parameter `T extends InsightDataBase`. Adds `InsightDataMap` in `shared/types/analytics.ts` mapping each `InsightType` discriminant to its typed `XData` interface (e.g. `'audit_finding' → AuditFindingData`, `'traffic_anomaly' → TrafficAnomalyData`). `UpsertInsightParams` similarly made generic. `getInsight<T>()` in `analytics-insights-store.ts` returns `AnalyticsInsight<T>` with a type-predicate cast enforced by a JSDoc comment explaining the soundness argument. Removes the `AnalyticsInsight.data Record<string,unknown>` grandfather exception from pr-check that previously allowed untyped insight data to pass CI. All existing insight write paths updated to pass typed `data` objects matching their `InsightDataMap` entry.

**Files:** `shared/types/analytics.ts`, `server/analytics-insights-store.ts`, `server/admin-chat-context.ts`, `server/content-brief.ts`, `server/anomaly-detection.ts`, `server/scheduled-audits.ts`, `server/insight-enrichment.ts`, `scripts/pr-check.ts`

**Agency value:** Insight data types are now compiler-enforced. Adding a new insight type without registering its `XData` interface in `InsightDataMap` is a type error. Silent runtime type mismatches (e.g. reading `data.pageUrl` when the field was renamed `data.url`) are caught at compile time instead of discovered in production.

**Mutual:** Structural foundation for insight enrichment — typed `data` objects enable autocomplete, refactor-safety, and exhaustive type checking across all 10+ insight types.

---

### 304. Cross-Bridge Score Adjustment Preservation
**What it does:** Fixes score clobbering in Bridge #12 (audit→page_health) and Bridge #15 (audit→site_health) in `scheduled-audits.ts`. When `upsertInsight()` is called with ON CONFLICT behavior, it replaces the entire `data` JSON blob — previously destroying `_scoreAdjustments` written by other bridges (e.g. anomaly detection boosting a page's impact score). Fix: before each upsert, read the existing insight via `getInsight()`, extract `_scoreAdjustments` and `_originalBaseScore`, carry them forward in the new `data` object, and recompute `impactScore` as `baseScore + totalDelta`. Both bridges now follow the same pattern.

**Files:** `server/scheduled-audits.ts`, `tests/unit/score-preservation.test.ts`

**Agency value:** Cross-bridge score adjustments (e.g. anomaly severity boosts, traffic-drop amplifiers) are now preserved across re-audit cycles. A page's composite insight score reflects all contributing signals, not just the last bridge to write — giving admins accurate priority ranking even after scheduled audits overwrite stale data.

**Mutual:** Establishes the canonical pattern for all future bridges that re-upsert existing insights: read before write, carry forward `_scoreAdjustments`, recompute adjusted `impactScore`.

---

### 305. `dirSizeAsync` — Non-Blocking Storage Stats
**What it does:** Adds `dirSizeAsync()` to `server/storage-stats.ts` — an async version of the existing `dirSize()` function using `fs.promises.readdir` and `fs.promises.stat` instead of synchronous `fs.readdirSync`/`fs.statSync`. Converts `getStorageReport()` to `async`, calling `dirSizeAsync()` for all directory size measurements. Eliminates blocking I/O in the storage stats endpoint, which previously held the Node.js event loop during directory traversal on large data directories.

**Files:** `server/storage-stats.ts`

**Agency value:** Storage stats endpoint no longer blocks the event loop during filesystem traversal. On production instances with large audit caches or content directories, synchronous directory traversal could stall all concurrent requests for hundreds of milliseconds.

---

### 306. Scheduled Audits Deduplication Guard
**What it does:** Adds deduplication logic to the scheduled audit runner — if an audit for a workspace is already in-flight (`runningAudits` Set), the scheduler skips the workspace instead of launching a duplicate. Adds integration test `tests/integration/scheduled-audits-dedup.test.ts` covering: (1) concurrent audit prevention when already-running, (2) correct execution when idle, (3) cleanup on completion. Also adds the `getInsight()` function to `analytics-insights-store.ts` exports for cross-bridge score preservation lookups.

**Files:** `server/scheduled-audits.ts`, `server/analytics-insights-store.ts`, `tests/integration/scheduled-audits-dedup.test.ts`

**Agency value:** Prevents duplicate audit runs stacking up under slow network conditions or when the hourly check fires while a long audit is still in progress. Duplicate audits previously could write conflicting snapshots and double-count activity log entries.

---

## Nested Page Path Hardening (2026-04-21)

### Nested Page Path Hardening (2026-04-21)
- **resolvePagePath sweep** — 15+ locations across server routes and frontend components now use `resolvePagePath(page)` instead of bare `` `/${page.slug}` `` constructions. Nested Webflow pages (e.g., `/services/seo`) correctly use `publishedPath` instead of truncated slug.
- **applyBulkKeywordGuards** — moved to `server/helpers.ts`; now also called in `webflow-seo.ts` bulk analyze path (BUG-0003: prevents AI-hallucinated keyword metrics from being persisted).
- **GSC path-boundary matching** — replaced `.includes(page.slug)` substring matching with exact path + prefix matching in `webflow-seo.ts` (BUG-0004: eliminates false-positive query attribution).
- **bare-slug-pagepath pr-check rule** — new rule flags any future `` `/${page.slug}` `` pagePath constructions across server and frontend files.

---

### 307. usePageJoin — Unified Page-Join Shared Hook
**What it does:** Canonical React Query hook `usePageJoin(workspaceId, siteId)` that joins Webflow pages with keyword strategy data, returning `UnifiedPage[]`. Replaces 3 independent ad-hoc join implementations across SeoEditor, PageIntelligence, and ApprovalsTab. Unified shape: `{ id, title, path, slug, source, seo, publishedPath, strategy }`. Matching uses `findPageMapEntryForPage` for case-insensitive + legacy slug fallback consistency.

**Agency value:** Eliminates join logic duplication. All three admin tools now reference the same shared join implementation — prevents future drift where one component adds a field or changes matching logic without updating the others. New admin components requiring page+strategy joins immediately get the right shape without hand-rolling.

**Client value:** Indirect — more consistent behavior across admin tools means fewer surprises when using different surfaces to work on the same pages.

**Mutual:** Consolidates a complex, error-prone operation into a single canonical location. Enforced by pr-check rule forbidding manual `pageMap.find()/strategyByPath` patterns outside the hook — all future page-join code routes through the shared hook.

**Files:** `src/hooks/admin/usePageJoin.ts`, `shared/types/page-join.ts`

---

## Tech-Debt Hardening Sprint (PR #256, 2026-04-22)

### 308. Atomic Usage-Tracking (TOCTOU Fix)
**What it does:** Closes a concurrency race where two simultaneous AI requests (bulk alt-text, keyword strategy, etc.) could both pass the usage limit check before either incremented the counter, overshooting the tier limit by ~N concurrent requests. Adds `incrementIfAllowed(wsId, tier, feature)` in `server/usage-tracking.ts` that wraps check + increment in a single SQLite transaction. All 6 guarded AI routes migrated: keyword strategy, brand voice, knowledge base, personas, webflow alt-text (single + bulk), brand identity refine. Failure paths call `decrementUsage()` to refund atomically on AI errors.

**Files:** `server/usage-tracking.ts`, `server/routes/keyword-strategy.ts`, `server/routes/brand-voice.ts`, `server/routes/knowledge-base.ts`, `server/routes/personas.ts`, `server/routes/webflow-alt-text.ts`, `server/routes/brand-identity.ts`

### 309. Alt-Text Route Auth Hardening
**What it does:** Moves `workspaceId` from request body to URL path param on alt-text generation routes and adds `requireWorkspaceAccess` middleware, closing a pre-existing gap where an authenticated admin could target a different workspace's quota by manipulating the request body. Routes renamed from `/api/webflow/generate-alt/:assetId` and `/api/webflow/bulk-generate-alt` to `/api/webflow/:workspaceId/generate-alt/:assetId` and `/api/webflow/:workspaceId/bulk-generate-alt`. Prop chain updated through `App.tsx → MediaTab → AssetBrowser/AssetAudit` to pass `workspaceId`.

**Files:** `server/routes/webflow-alt-text.ts`, `src/api/seo.ts`, `src/components/AssetBrowser.tsx`, `src/components/AssetAudit.tsx`, `src/components/MediaTab.tsx`, `src/App.tsx`

### 310. Stream Reader Deduplication (readNdjsonStream + readSseStream)
**What it does:** Extracts two generic stream reader helpers into `src/api/streamUtils.ts` — `readNdjsonStream<T>` (splits on newlines, parses each as JSON) and `readSseStream<T>` (strips `data: ` prefix). Replaces two independent `while(true){reader.read()}` loops in `seo.ts` that had already diverged (NDJSON flushed trailing buffer; SSE did not). `AssetBrowser.tsx` refactored to use the typed `bulkGenerateAltText` wrapper from `src/api/seo.ts` instead of hand-rolling a raw fetch + stream loop.

**Files:** `src/api/streamUtils.ts` (new), `src/api/seo.ts`, `src/components/AssetBrowser.tsx`

### 312. Brand Engine Route Hardening (roadmap #586)

**What it does:** Seven-axis security and reliability hardening across all brand-engine routes (brandscript, voice-calibration, brand-identity, discovery-ingestion). **(1) Per-path aiLimiter burst cap** — `aiLimiter` middleware (3 req/min per IP, keyed by `${ip}:${req.path}`) applied to every AI-generating endpoint in brandscript, voice-calibration, brand-identity, and discovery-ingestion routes. **(2) TOCTOU-safe usage enforcement** — all AI routes converted from check-then-increment to `incrementIfAllowed(wsId, tier, feature)` + `decrementUsage()` on failure; free-tier blocked with 429 + `code: 'usage_limit'` before any AI call. **(3) Sanitized 5xx error shapes** — all catch blocks replaced with `sanitizeErrorMessage(err, fallback)` to strip SQLITE error codes, file paths, and stack traces from 500 responses. **(4) Prompt-injection defense** — discovery-ingestion wraps `rawContent` with `sanitizeForPromptInjection()` before injecting into the LLM prompt; `<untrusted_user_content>` envelope + trust note added. **(5) DB-level size cap** — migration 067 adds a SQLite `CHECK` trigger blocking `raw_content` > 1 MiB; migration 068 uses `length(CAST(x AS BLOB))` for byte-accurate counting. HTTP 413 surfaced from route layer. **(6) Explicit voice profile create UX** — `getOrCreateVoiceProfile()` split into `getVoiceProfile()` (returns null, no side effects) and `createVoiceProfile()` (POST-only, 409 on duplicate). `VoiceTab.tsx` renders `<EmptyState>` with teal CTA when profile is null. **(7) Variation feedback persistence** — `voice_calibration_sessions.variation_feedback_json` column (migration 069), `saveVariationFeedback()` + Zod schema in `server/schemas/voice-calibration.ts`, `POST /api/voice/:wsId/calibration-feedback` route (204), per-variation "Save feedback" button in `VoiceTab.tsx`. PUT brandscript sections now calls `addActivity(wsId, 'brandscript_sections_updated', ...)` (was missing).

**Files:** `server/routes/brandscript.ts`, `server/routes/voice-calibration.ts`, `server/routes/brand-identity.ts`, `server/routes/discovery-ingestion.ts`, `server/voice-calibration.ts`, `server/discovery-ingestion.ts`, `server/schemas/voice-calibration.ts`, `server/db/migrations/067-discovery-sources-size-cap.sql`, `server/db/migrations/068-discovery-sources-size-cap-bytes.sql`, `server/db/migrations/069-voice-calibration-feedback.sql`, `shared/types/brand-engine.ts` (`variationFeedback` on `CalibrationSession`), `src/api/brand-engine.ts` (voice.createProfile, voice.saveVariationFeedback, null-typed getProfile), `src/components/brand/VoiceTab.tsx` (create CTA + feedback save)

**Tests:** `tests/integration/brandscript-hardening.test.ts` (port 13323), `tests/integration/voice-calibration-hardening.test.ts` (port 13324), `tests/integration/discovery-sanitization.test.ts` (port 13325), `tests/integration/brand-identity-hardening.test.ts` (port 13226)

**Agency value:** Closes 12 security and reliability gaps identified in the copy & brand engine audit. Prevents prompt injection from corrupting LLM outputs with client-supplied content, stops TOCTOU over-metering on concurrent AI calls, keeps 5xx responses free of internal system details, and enforces per-workspace burst limits on all AI routes.

### 311. rowToInsight Schema Hardening
**What it does:** Adds Zod schemas for all 14 insight data types in `server/schemas/insight-schemas.ts` and an `INSIGHT_DATA_SCHEMA_MAP` mapping each `InsightType` to its schema. `rowToInsight()` in `analytics-insights-store.ts` now validates via `parseJsonSafe()` instead of bare `parseJsonFallback()`, so corrupt or missing stored JSON is caught at read time rather than silently producing `undefined` on required fields. All schemas use `.passthrough()` so cross-cutting `_originalBaseScore`/`_scoreAdjustments` fields added by `applyScoreAdjustment()` survive round-trip. Fixed 4 test files whose fixtures used incomplete or wrong-field data shapes.

**Files:** `server/schemas/insight-schemas.ts`, `server/analytics-insights-store.ts`, `tests/unit/migration-data-preservation.test.ts`, `tests/integration/anomaly-boost-reversal.test.ts`, `tests/integration/public-analytics.test.ts`, `tests/contract/insight-data-shapes.test.ts`

