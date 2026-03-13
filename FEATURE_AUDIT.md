# Asset Dashboard — Feature Audit

A brief value assessment of every feature in the platform, covering what it does, why it matters to the agency, why it matters to clients, and how it creates mutual value.

---

## Admin Dashboard (Internal)

### 1. Workspace Overview
**What it does:** Multi-client dashboard showing health scores, pending requests, approval status, and key metrics at a glance. **Trial/tier badges**: each workspace card displays an amber "Trial · Xd" badge when on a Growth trial (with days remaining) or a blue/violet tier badge (Growth/Premium) for paid workspaces. `/api/workspace-overview` returns `tier`, `isTrial`, and `trialDaysRemaining` computed from `ws.trialEndsAt`.

**Agency value:** One screen answers "which client needs attention right now?" — no digging required. Trial badges surface which clients are about to need an upgrade conversation.

**Client value:** Nothing falls through the cracks. Their site gets attention the moment something changes.

**Mutual:** Turns reactive account management into proactive service. Faster response times; more efficient operations.

---

### 2. Asset Manager
**What it does:** Lists all Webflow site images with sizes, formats, and alt text. One-click compression and re-upload directly to Webflow.

**Agency value:** Turns hours of manual download-compress-reupload into a single click per image.

**Client value:** Faster page loads and better Core Web Vitals without needing to learn image optimization.

**Mutual:** Measurable performance gains (PageSpeed scores) with minimal agency time investment.

---

### 3. Site Health Audit
**What it does:** Per-page SEO audit with 20+ checks: titles, meta descriptions, canonicals, H1s, heading hierarchy, content length, alt text, Open Graph, structured data, HTML size, orphan pages, indexability, and more. Weighted scoring prioritizes high-impact ranking factors. Integrates redirect chain detection and homepage Core Web Vitals inline. Auto-saves snapshots for historical comparison. Scheduled recurring audits with email alerts on score drops. **Auto-restore**: latest audit results load from disk on mount — no data loss between deploys or server restarts. **Error-sorted page list**: pages with the most errors display first so critical issues surface immediately. **Flag for Client**: send specific audit issues to the client request queue with an inline note for review/discussion — for issues that need client approval before the agency can act. **Fix→ routing**: each issue has a Fix button that routes to the appropriate tool (Schema Generator for structured data, SEO Editor for metadata, Content Briefs for thin content, Redirects for chain issues, Performance for speed). **Auto-fix context**: when Fix→ is clicked, the target tool receives the page context — Schema auto-generates for that specific page, SEO Editor auto-expands and scrolls to the page, Content Briefs pre-fills the keyword from the page name. **Traffic Intelligence**: cross-references audit results with GSC clicks/impressions and GA4 pageviews/sessions via `/api/audit-traffic/:siteId`. Each page card displays traffic badges (clicks + views). Toggle between sorting by issues or traffic impact — so high-traffic pages with SEO problems surface first.

**Agency value:** Replaces paid tools for Webflow-specific checks. Catches issues Screaming Frog misses (Webflow API vs. published HTML discrepancies). Historical snapshots track progress over time. Fix→ routing eliminates manual navigation — go from issue to solution in one click. Flag for Client handles issues that need sign-off without disrupting the workflow. Traffic intelligence means you fix the pages that actually get visitors first — not just the ones with the most errors.

**Client value:** A clear health score with specific, actionable recommendations — not a wall of jargon. Flagged issues arrive as structured requests with context and recommendations.

**Mutual:** A shared language for site health. "We improved your score from 72 to 89" is visible in both dashboards. The audit-to-fix pipeline means issues get resolved faster — no context-switching, no lost details between discovery and action. Trust through transparency.

---

### 4. Dead Link Checker
**What it does:** Crawls every page (including CMS via sitemap), extracts all links, and checks for 404s, timeouts, and redirect chains. **Auto-restore**: last scan results persist to disk and load on mount — no data loss between navigation, deploys, or restarts.

**Agency value:** Catches broken links before Google does, including ones buried in CMS collection pages.

**Client value:** No "page not found" experiences for visitors. Protects brand credibility.

**Mutual:** Proactive fixes demonstrate ongoing value — concrete deliverables the client didn't know they needed.

---

### 5. PageSpeed / Performance
**What it does:** Runs Google PageSpeed Insights on key pages. Reports Core Web Vitals (LCP, FID, CLS) with per-page breakdowns and optimization opportunities. Single-page on-demand testing by slug. Homepage CWV wired into the site audit for a unified health picture. **Auto-restore**: bulk and single-page test results persist to disk and load on mount — expensive 30-60s tests survive navigation and deploys.

**Agency value:** Performance data directly from Google's own tool. No "but my site feels fast" debates — the numbers are objective.

**Client value:** Faster site = better user experience = more conversions. Performance directly affects their bottom line.

**Mutual:** Quantifiable improvements the agency can point to in monthly reports. Clients see real speed gains.

---

### 6. Schema Generator
**What it does:** Analyzes every page's content and existing structured data, then generates unified `@graph` JSON-LD schemas (Organization, FAQ, Service, Article, BreadcrumbList, LocalBusiness, etc.) using AI. Validates against Google requirements. Supports **per-page generation** via a searchable page picker — generate for one page without scanning the whole site. Results stream incrementally with real-time progress via WebSocket. Schemas persist to disk and survive deploys (incremental saves every 10s during generation). One-click **Publish to Webflow** injects schema via the Custom Code API — plus **Bulk Publish All** publishes every unpublished schema sequentially with a live progress counter. **Schema Diff View** shows a side-by-side comparison of existing vs. suggested JSON-LD before publishing, so you can see exactly what changes. **Send to Client** creates an approval batch for client review before publishing. **CMS Template Schemas** generate dynamic schemas for collection pages using Webflow's `{{wf {...}}}` template syntax — one schema template auto-populates from CMS fields across all collection items. Prompt engineering enforces strict output: no empty arrays/objects, consistent `@id` naming, omitted empty properties. **Audit Fix→ auto-generation**: when arriving from the Site Health Audit Fix→ button for a schema issue, automatically generates JSON-LD for the specific affected page — no manual page selection needed. **Direct JSON editing**: toggle an Edit button to switch from read-only preview to an editable textarea — modify the generated JSON-LD before copying or publishing. Validates JSON on change with inline error display. Edited schemas are used in copy, single-page publish, and bulk publish flows. **Recommendation flags**: `useRecommendations` hook fetches active AI recommendations per workspace; pages with schema-type recommendations show amber badge counts in the header and expandable recommendation banners (title, insight, traffic at risk, priority) inside the page detail. **workspaceId cost tracking**: AI schema generation calls now pass `workspaceId` through `SchemaContext` to `callOpenAI` for per-workspace token cost attribution.

**Agency value:** Schema implementation is time-consuming and error-prone. This generates production-ready, validated JSON-LD in seconds — per-page or full-site. Direct Webflow publishing eliminates manual copy-paste. CMS templates mean one schema covers hundreds of collection items automatically.

**Client value:** Rich snippets in search results (stars, FAQs, breadcrumbs) increase click-through rates significantly. Client reviews and approves before anything goes live.

**Mutual:** High-value SEO deliverable that's visible in search results. Clients see their listings stand out; agency delivers it efficiently. The approval flow ensures nothing ships without sign-off.

---

### 7. SEO Strategy (Keyword Mapping)
**What it does:** Maps every page to primary/secondary keywords using GSC data, competitor analysis, SEMRush metrics (volume, KD%, intent), and AI. Batched parallel AI processing for large sites. Identifies content gaps, quick wins, low-hanging fruit, and keyword opportunities. Summary dashboard with performance tiers, search intent badges, and sortable/filterable page map. Runs as a background job with real-time progress. Smart page filtering excludes utility pages. **Conversion-aware**: GA4 conversion events and events-by-page data injected into the master synthesis prompt; AI protects "money pages" and references specific conversion events in quickWin rationales. **Audit-aware**: `getAuditTrafficForWorkspace` cross-references SEO audit errors with traffic data; high-traffic pages with issues surfaced as quickWins with specific fix actions. **Page type mapping**: content gap recommendations now include `suggestedPageType` (blog, landing, service, location, product, pillar, resource) — the AI selects the best format for each opportunity based on intent and keyword context. Page type badges (violet) display on content gap cards in both admin and client views.

**Agency value:** Automates the most labor-intensive part of SEO — the keyword strategy document. Pulls real data from GSC + GA4 conversions + SEMRush + audit intelligence instead of guesswork. Batched processing handles 100+ page sites efficiently. Conversion data ensures the strategy never deprioritizes pages that drive revenue. **Large-site safety (March 2026):** Configurable page cap in Strategy Settings (200 / 500 / 1000 / All — default 500). Pages prioritized by path depth + Webflow metadata availability (homepage first, then key service/product pages). HTML body reads limited to 100KB per page via streaming to prevent OOM. Content snippets reduced from 1200→800 chars for capped sites. Prevents exit-134 crashes on 750+ page sites.

**Client value:** A clear roadmap: which pages target which keywords, what content is missing, and where the quick wins are. Interactive strategy view with "Request This Topic" buttons. Strategy now reflects which pages actually convert, not just which pages rank.

**Mutual:** Replaces static PDF strategy decks with a living, data-driven plan both sides can reference and act on.

---

### 8. Content Brief Generator
**What it does:** AI-generates full content briefs from keyword strategy data — suggested titles, outlines, word count targets, internal linking opportunities, competitor analysis, E-E-A-T guidelines, content checklists, and schema recommendations. Supports **Brief vs. Full Post** service tiers with configurable pricing. Branded HTML export and AI tool export formats. Full client approval workflow: submit topic → generate brief → client reviews → approve/decline/request changes → upgrade to full post. **SEMRush enrichment**: when configured, briefs include real keyword volume, difficulty, CPC, competition data, and related keywords from SEMRush instead of AI-estimated values. **Inline editing**: all key brief fields (title, meta, summary, outline headings/notes/word counts, audience, tone, CTAs, competitor insights, word count target, intent, format) are editable in-place with auto-save on blur. **Improved GSC filtering**: related queries now match any significant keyword word (length > 2) instead of only the first word. **Audit Fix→ pre-fill**: when arriving from the Site Health Audit Fix→ button for thin content issues, the keyword field is automatically pre-filled with the page name (hyphens converted to spaces) so the user can immediately generate a brief. **Page-type briefs**: 7 page types (blog, landing, service, location, product, pillar, resource) with type-specific AI prompt instructions — each type gets tailored guidance for word count, structure, schema, CTAs, outline format, and content approach. `pageType` stored on both `ContentBrief` and `ContentTopicRequest` models. Page type selector in pricing modal and topic submission form. Brief generation endpoint passes `pageType` to the AI prompt. Content request cards show page type badges. **Enhanced AI context pipeline**: brief generation now enriches prompts with multiple data sources run in parallel — knowledge base (`buildKnowledgeBase`), keyword map context (`buildKeywordMapContext`), audience personas (`buildPersonasContext`), reference URL scraping (up to 5 competitor/inspiration URLs scraped and summarized via `web-scraper.ts`), real Google SERP data (top results + People Also Ask questions scraped for the target keyword via `scrapeSerpData`), and GA4 top-performing page content as style examples (highest-engagement pages scraped for tone/structure reference). All new context blocks are injected into the AI prompt for dramatically improved brief relevance and quality. **Reference URLs input**: Advanced Options panel in the generator form accepts competitor/inspiration URLs (one per line) — scraped content informs the AI about existing high-quality content on the topic. **Audience Personas**: workspace-level persona definitions (name, description, pain points, goals, objections, buying stage, preferred content format) managed in Workspace Settings → Features; injected into both brief generation and full post generation prompts so content speaks directly to defined audience segments.

**Agency value:** Briefs that used to take 1-2 hours each are generated in under a minute with real search data baked in. Service tier pricing built in. Inline editing lets the team refine AI output without regenerating. The enriched context pipeline means briefs now incorporate knowledge base, competitor content analysis, real SERP data, audience personas, and top-performing content patterns — producing briefs that rival human strategist output. Quality guardrails ensure briefs avoid corporate buzzwords, provide proper H3 substructure, and use the full sitemap for link suggestions.

**Client value:** Professional, research-backed content briefs they can review, approve, decline, or request changes on directly from their portal. PDF/HTML export available with page type badge in the header. Real SEMRush data grounds the brief in actual market metrics. Persona-aware briefs speak to their actual audience segments.

**Mutual:** Streamlines the entire content production pipeline from strategy → brief → review → approval → production. Pricing transparency builds trust. Editable briefs mean faster iteration; real data means better strategic decisions. The multi-source enrichment pipeline means every brief is informed by competitive intelligence, audience understanding, and actual search landscape data. Brief-level quality rules (case study anonymity, FAQ formatting, industry diversity, section count, buzzword bans) propagate cleaner instructions to downstream post generation.

---

### 9. SEO Editor
**What it does:** Edit page titles, meta descriptions, and OG tags directly through the Webflow API — with AI-powered suggestions based on actual page content and target keywords. **Audit Fix→ auto-expand**: when arriving from the Site Health Audit Fix→ button for metadata issues, the target page automatically expands and scrolls into view so the user can immediately edit. **Recommendation flags**: `useRecommendations` hook surfaces metadata-type recommendations inline per page — amber badge count in the page header and expandable recommendation banners (title, insight, traffic at risk, priority tier) inside the expanded editing section. **Audit-aware AI rewrites**: the `/api/webflow/seo-rewrite` endpoint now looks up the latest audit snapshot for the workspace, finds page-specific issues (title length, missing description, duplicate title/description, thin content, H1 issues), and injects them into the AI prompt so rewrite suggestions directly address known audit findings.

**Agency value:** No more logging into Webflow, finding the page, editing, saving, and publishing. Batch-edit dozens of pages from one screen. Fix→ from audit eliminates the search step entirely.

**Client value:** SEO changes happen faster. Optimizations that used to take days are done in minutes.

**Mutual:** Speeds up the most common SEO task (metadata optimization) by 10x. More gets done in less time.

---

### 10. Approval Workflow
**What it does:** Agency proposes SEO changes (titles, descriptions, schemas) as batches. Client reviews, approves/rejects, edits, and the approved changes push directly to Webflow via API. Schema approvals show JSON-LD previews with @graph type badges. Supports both metadata and structured data changes in a single workflow.

**Agency value:** No more email chains asking "is this title OK?" — structured workflow with clear status tracking. Schema changes go through the same flow.

**Client value:** Full control over what goes live on their site. Can see proposed vs. current values and suggest edits.

**Mutual:** Eliminates the approval bottleneck. Both sides have visibility into what's pending, what's approved, and what's been applied.

---

### 11. Rank Tracker
**What it does:** Track specific keyword positions over time using Google Search Console data. Pin priority keywords, capture snapshots, and visualize trends.

**Agency value:** Shows the direct impact of SEO work over time. "Your target keyword moved from position 18 to position 6."

**Client value:** Proof that the SEO investment is working, tracked against the keywords they actually care about.

**Mutual:** Aligns both parties on which keywords matter and provides objective measurement of progress.

---

### 12. Search Console Integration
**What it does:** Pulls Google Search Console data — clicks, impressions, CTR, average position — with query-level and page-level breakdowns. Supports 7d/28d/90d/6mo/16mo date ranges with sparkline mini-charts and full performance trend charts. **Insights tab** automatically identifies low-hanging fruit (positions 5-20 with impressions), top performers, CTR opportunities (page 1 but <3% CTR), high-impression/low-click queries, and branded vs. non-branded query breakdown. **AI Search Chat** (GPT-4o) answers natural language questions about the client's actual search data with quick-question presets. Contextual cross-link tips guide users to Strategy and SEO Editor based on findings.

**Agency value:** GSC data in context alongside all other tools. The insights tab surfaces the exact queries worth optimizing — no manual spreadsheet analysis. AI chat handles "which keywords am I ranking for?" questions.

**Client value:** Understands how their site performs in Google search without needing their own GSC access. AI chat answers questions in plain English.

**Mutual:** Single source of truth for organic search performance. Insights → Strategy → Editor workflow keeps both sides aligned on priorities.

---

### 13. Google Analytics Integration
**What it does:** Full GA4 integration — sessions, users, engagement, traffic sources, top pages, device breakdown, country data, event tracking, conversion summaries, and event explorer with page-level filtering. Click-to-inspect detail popovers on all charts showing date + key metrics per data point. **Admin GA4 dashboard** includes sparklines, period comparison (current vs previous with delta indicators), new vs returning user segments, organic overview (organic share of total traffic), organic landing pages, key events/conversions summary, richer sortable tables, and traffic health insights.

**Agency value:** Deep analytics without GA4's clunky interface. Custom event grouping and module-level page filtering tailored per client. Interactive charts make data exploration effortless. Admin view surfaces period-over-period changes, organic performance, and conversion data at a glance.

**Client value:** Clean, curated analytics view showing the metrics that matter to their business — not the overwhelming GA4 default.

**Mutual:** Configurable event groups and display names let the agency present analytics in the client's language ("Form Submissions" not "generate_lead").

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
**What it does:** Exposes the keyword strategy, page mapping, quick wins, content gaps, and competitor analysis to the client — with "Request This Topic" buttons on content opportunities.

**Agency value:** Strategy becomes a conversion tool. Clients see opportunities and request content directly — no sales pitch needed.

**Client value:** Full visibility into the SEO roadmap. Understands what's being targeted, why, and what the next moves are.

**Mutual:** Turns strategy from a one-time deliverable into an ongoing, interactive growth plan. Content gaps become revenue.

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
**What it does:** Internal-only floating chat panel ("Admin Insights") with an expert analyst persona — direct, technical, no-fluff. Auto-fetches workspace data (GSC, GA4 overview/comparison/organic/new-vs-returning/conversions/landing pages, site audit) when opened. Server-side keyword strategy and keyword map context injected. Purple/violet theme distinguishes it from client chatbot. 5 admin-specific quick questions (status report, ROI actions, page attention, period comparison, client communication). Only visible when a workspace is selected and OpenAI is configured. **Conversation memory**: full parity with client chat — persistent sessions via `sessionId`, `addMessage`, `buildConversationContext`; cross-session summaries injected into system prompt; auto-summarize after 6+ messages. **Chat history UI**: New Chat button (+ icon), Chat History panel listing past admin conversations with message counts and dates, click to resume any session. **Audit traffic intelligence**: cached `getAuditTrafficForWorkspace` injects top 8 high-traffic pages with SEO errors into admin system prompt for prioritized recommendations. **Chat activity logging**: first admin chat exchange logged to activity log.

**Agency value:** Instant technical analysis without digging through dashboards. Cross-references data sources for non-obvious insights. Suggests how to frame findings for client communication. Conversation memory enables multi-session analysis without losing context. Audit traffic intelligence automatically prioritizes fixes by real visitor impact.

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
**What it does:** Consistent teal/zinc color palette across all admin and client dashboard components. All inline CSS variable references replaced with Tailwind utility classes. Unified card backgrounds, sidebar styling, workspace selector, and button treatments. **Accessibility pass**: minimum `text-[11px]` font size enforced (was `text-[8px]` in some places), improved contrast ratios, `aria-label` attributes on all icon-only buttons. **Selective type size bump**: `text-[11px]`/`text-xs` → 13.5px, `text-sm` → 15.5px for improved readability. **MetricRing** background tracks use muted score-colored fills (15% opacity) instead of flat gray. **Global cursor-pointer** rule ensures all interactive elements show pointer cursor. **SectionCard** headings bumped to `font-semibold text-zinc-200`, **PageHeader** titles to `text-zinc-100`. Theme-aware `scoreColor()` returns WCAG-compliant colors in light mode. **Standardized typography hierarchy** across all 8 client dashboard tabs: page titles use `text-xl font-semibold text-zinc-100`, subtitles use `text-sm text-zinc-500`, section headers use `text-sm font-semibold text-zinc-200`. Every tab (Overview, Search, Analytics, Site Health, Strategy, Content, Requests, Approvals) now has a consistent page-level title.

**Agency value:** Professional, cohesive appearance across every screen. No visual inconsistencies that undermine credibility.

**Client value:** A polished, accessible interface that works well on all devices and for users with visual impairments.

**Mutual:** A design system that scales — new features automatically inherit consistent styling without manual polish.

---

### 33. Component Styleguide
**What it does:** Dedicated `/styleguide` route showcasing every UI primitive and pattern in one place — color palette, typography scale, MetricRings, StatCards, CompactStatBar, Badges, EmptyState, TabBar, DateRangeSelector, DataList, PageHeader, SectionCard, Line/Area Charts (single + dual trend), ChartPointDetail popovers, data tables, modals/dialogs, toast notifications (global + inline), form inputs (text, search, textarea, select, segmented toggle), loading states (page/inline/button/typing), progress bars (segmented, severity, bulk), and sidebar navigation. Includes a dark/light theme toggle for visual verification.

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

### 36. Roadmap Dashboard
**What it does:** Interactive admin-side roadmap tracker with 34 items across 7 prioritized sprints. Each item shows title, effort estimate, source document, priority tier (P0–P4), and a click-to-cycle status toggle (pending → in_progress → done). Status persists to server via `/api/roadmap-status`. Priority filter dropdown. Overall + per-sprint progress bars. Collapsible sprint sections.

**Agency value:** A single place to see what's next, what's in progress, and what's done — without digging through markdown files. Status tracking survives sessions.

**Client value:** N/A — internal agency tool.

**Mutual:** Keeps development focused and accountable. No lost context between work sessions.

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
**What it does:** `server/recommendations.ts` generates traffic-weighted, prioritized SEO recommendations per workspace using audit data, GSC traffic, and AI analysis. Status-tracked (active → dismissed → completed). Auto-regenerated after every audit run. Client-facing `FixRecommendations.tsx` surfaces recommendations with severity badges and "Fix →" routing to appropriate tools. `InsightsEngine` on WorkspaceHome shows prioritized recommendations grouped by urgency. Recommendation flags appear in SEO Editor and Schema Generator via `useRecommendations` hook.

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
**What it does:** Split `server/index.ts` from ~8,300 lines into ~450 lines + 46 Express Router files in `server/routes/` + 3 shared modules (`broadcast.ts`, `helpers.ts`, `middleware.ts`). Each route file owns one domain (e.g., `auth.ts`, `webflow.ts`, `content-briefs.ts`, `public-portal.ts`). Shared middleware (`middleware.ts`) is the single source of truth for rate limiting, session signing, file upload, and auth helpers. `helpers.ts` extracts pure functions (sanitize, validate, date parsing, audit traffic). `broadcast.ts` provides a singleton WebSocket broadcast pattern so route files can emit events without importing the WS server directly. Index.ts retains only: Express setup, Helmet/CORS/cookie-parser, Stripe webhook (raw body), WebSocket server, route mounting, and startup initialization. **Extended decomposition (March 2026):** `webflow.ts` route split into 6 focused sub-routes (`webflow-alt-text.ts`, `webflow-audit.ts`, `webflow-cms.ts`, `webflow-keywords.ts`, `webflow-organize.ts`, `webflow.ts` core). `seo-audit.ts` decomposed: per-page check logic extracted to `audit-page.ts`, HTML report rendering to `seo-audit-html.ts`.

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

## Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 12 | Audit, fix, and optimize faster than manual tools |
| Analytics & Tracking | 5 | Unified data view replaces platform-hopping |
| Content & Strategy | 6 | Strategy → brief → AI post generation → review → delivery pipeline |
| Client Communication | 8 | Structured workflows + automated reports + expanded notifications + feedback widget |
| Client Self-Service | 10 | 24/7 data access, onboarding, plans, cart, order tracking |
| AI & Intelligence | 5 | Full-spectrum AI advisor + revenue engine + knowledge base + recommendations engine + context completeness |
| Auth & Access Control | 3 | Internal user accounts, workspace ACL, client user accounts |
| Security | 1 | Helmet, HTTPS, rate limiting, input sanitization |
| Monetization | 1 | Stripe Checkout, admin settings, payment tracking, trials, encrypted config |
| Platform & UX | 10 | Design system, styleguide, cross-linking, sales tooling, roadmap, cockpit, workspace home, page state model, work orders, request linkage |
| Data Architecture | 3 | PageEditState model, cross-store writes, activity feed for client actions |
| Architecture | 2 | Server refactor (46 route modules + 3 shared modules), frontend component decomposition |

**65 features** across the platform. The core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**

---

## Future Additions

Items to revisit as budget/tier upgrades allow or when priorities shift.

### OpenAI Model Upgrades
- ~~All models upgraded to GPT-4.1 series~~: ✅ Shipped (March 10, 2026) — gpt-4o → gpt-4.1, gpt-4o-mini → gpt-4.1-mini across all endpoints (SEO rewrite, content briefs, content posts, schema, audit, anomaly detection, chat memory, strategy, keyword analysis, seo-copy, internal links). Alt text generation uses gpt-4.1-nano for cost savings on trivial tasks. Brand name context injected into all AI prompts that generate client-facing copy.

### Schema Generator Enhancements
- ~~Bulk publish~~: ✅ Shipped — Publish to Webflow per-page via Custom Code API.
- ~~Per-page generation~~: ✅ Shipped — Page picker lets you generate for a single page.
- ~~Persistence~~: ✅ Shipped — Incremental disk saves every 10s during generation.
- ~~Client review flow~~: ✅ Shipped — Send to Client creates an approval batch.
- ~~CMS template schemas~~: ✅ Shipped — Dynamic schemas for collection pages using Webflow `{{wf}}` template syntax.
- ~~Prompt tightening~~: ✅ Shipped — No empty arrays/objects, consistent `@id`, omit empty properties.
- ~~Schema diff view~~: ✅ Shipped — Side-by-side comparison of existing vs. suggested JSON-LD with toggle button. Shows full existing schema JSON extracted from published HTML.
- **Auto-schedule**: Re-generate schemas on a cadence (e.g., weekly) and flag pages where content changed but schema is stale.
- ~~Bulk publish all~~: ✅ Shipped — One-click "Publish All" button with sequential publishing and live progress counter.

### Redirect Manager Enhancements
- ~~GSC ghost URL detection~~: ✅ Shipped — Identifies old/renamed pages Google still indexes but no longer exist on site.
- **Webflow Enterprise API**: The 301 Redirects API is Enterprise-only. If/when Enterprise access is available, push accepted rules directly via API instead of CSV export.
- **Historical comparison**: Track redirect status over time — detect new 404s since last scan.
- **Google Search Console 404 import**: Pull crawl errors from GSC to seed the redirect scanner with known broken URLs.

### Site Audit Enhancements
- ~~Redirect + CWV integration~~: ✅ Shipped — Redirect chains and homepage Core Web Vitals wired into audit.
- ~~Contextual cross-link tips~~: ✅ Shipped — Audit results suggest SEO Editor, Redirects, Schema, Performance based on findings.
- ~~Auto-restore after deploys~~: ✅ Shipped — Admin SeoAudit loads latest persisted snapshot from disk on mount when no in-memory job exists. No data loss between deploys.
- ~~Error-sorted page list~~: ✅ Shipped — Pages sorted by error count descending so critical pages surface first.
- ~~Flag for Client~~: ✅ Shipped — Send specific audit issues to client request queue with inline note for review/discussion.
- ~~Fix→ routing~~: ✅ Shipped — Each issue maps to the appropriate tool (Schema, SEO Editor, Briefs, Redirects, Performance) with a one-click Fix button.
- ~~Auto-fix context~~: ✅ Shipped — Fix→ passes page context to target tools: Schema auto-generates, SEO Editor auto-expands, Briefs pre-fill keyword.
- ~~Traffic intelligence~~: ✅ Shipped — `/api/audit-traffic/:siteId` cross-references GSC clicks/impressions and GA4 pageviews/sessions per page. Traffic badges on page cards. Sort by traffic impact toggle.
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
- ~~Merged Links tab~~: ✅ Shipped (March 2026) — Redirects + Internal Links merged into single Links tab (`LinksPanel.tsx`) with sub-tab navigation.
- ~~Header request widget~~: ✅ Shipped (March 2026) — Requests moved from sidebar to header bar as badge widget with pending count indicator. NotificationBell also moved to header.
- ~~Command palette sync~~: ✅ Shipped (March 2026) — CommandPalette.tsx updated to match new sidebar structure.
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
**What it does:** Admin-facing AI usage monitoring panel in the Command Center. `GET /api/ai/usage` returns per-feature token consumption with timestamps, model used, and estimated cost. Dashboard shows: total tokens consumed, estimated cost, per-feature breakdown (briefs, posts, chat, schema, strategy, etc.), and SEMRush credit usage tracking via `server/usage-tracking.ts` (daily limit checks, increment/reset). Filterable by workspace and date range.

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

**1. AEO Trust Audit (8 new checks in `seo-audit.ts`):** Per-page checks for author/reviewer attribution (meta tag, Person schema, byline classes, "reviewed by" patterns), last-updated date detection (dateModified schema, visible date text, `<time>` elements), answer-first content structure (flags generic intros after H1 — "Welcome to…", "Are you looking for…"), FAQ content without FAQPage schema, hidden content behind accordions/tabs/collapsed sections (>500 chars behind display:none/aria-hidden), citation/reference density (two-tier: zero external citations AND links without authority domains like .gov/.edu/pubmed/ADA/NIH), dark pattern detection (autoplay media, aggressive modal overlays). Site-wide check for missing trust pages (/about, /contact) with healthcare recommendations (/editorial-policy, /corrections, /medical-review-board).

**2. Schema Suggester Expansion (`schema-suggester.ts`):** Healthcare schema types (MedicalBusiness, Dentist, Physician, MedicalProcedure with procedureType/howPerformed/preparation/followup), HowTo for procedural content, Dataset schema for data-heavy pages, author + reviewedBy Person with credentials on all Article/BlogPosting schemas, sameAs entity linking on Organization (Google Business, LinkedIn, Yelp, association profiles — only from actual page content, never fabricated). **Knowledge Base integration:** `buildSchemaContext()` in `helpers.ts` now reads workspace `knowledgeBase` field + `knowledge-docs/` folder files (truncated to 4000 chars) and injects into the schema AI prompt as BUSINESS KNOWLEDGE BASE. Schema AI can now use staff credentials, locations, social profiles, and association memberships from the KB to enrich Organization, Physician, LocalBusiness, and sameAs schemas — without needing that data on every page's HTML.

**3. Content Brief & Writing Rules Enhancement (`content-brief.ts`, `content-posts.ts`):** AEO rules block in brief generation prompt (answer-first layout, citation density targets, definition block guidance, comparison table requirements, FAQ quality rules, author/date checklist items). Three new AEO-optimized page types: provider-profile (Physician schema, credential-forward, encyclopedic), procedure-guide (MedicalProcedure schema, citation-dense, definition blocks, comparison tables, indications/contraindications/costs/risks/alternatives), pricing-page (Dataset schema, methodology section required, measurable fields only). Citation-worthy writing rules added to WRITING_QUALITY_RULES: claim discipline, evidence framing, encyclopedic neutral tone for medical content, definition block pattern, comparison content rules.

**4. AEO Recommendation Engine (`recommendations.ts`):** All 8 AEO audit checks now flow into the existing Recommendation Engine as a dedicated `aeo` RecType. Custom insight text generators for each AEO check explain *why* each issue matters for AI visibility (with traffic-aware variants showing clicks at risk). `aeo-author`, `aeo-answer-first`, and `aeo-trust-pages` added to CRITICAL_CHECKS — these become "Fix Now" recommendations on high-traffic pages. AEO product mapping enables purchasable fix upsells: `aeo_page_review` ($99) and `aeo_site_review` ($499, 5+ pages).

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
**What it does:** Systematic extraction of large monolithic components into focused sub-modules. **SeoAudit.tsx**: extracted `ScoreTrendChart`, `ActionItemsPanel`, `AuditHistory`, and shared `types.ts` into `src/components/audit/`. **ContentBriefs.tsx**: extracted `BriefDetail` into `src/components/briefs/`. **SchemaSuggester.tsx**: extracted `CmsTemplatePanel` into `src/components/schema/`. **KeywordStrategy.tsx**: extracted `SeoCopyPanel` into `src/components/strategy/`. **AssetBrowser.tsx**: extracted `OrganizePreview` into `src/components/assets/`. **WorkspaceSettings.tsx**: extracted `ConnectionsTab`, `FeaturesTab`, `ClientDashboardTab` into `src/components/settings/`. **WorkspaceHome**: extracted `ActiveRequestsAnnotations`, `ActivityFeed`, `RankingsSnapshot`, `SeoWorkStatus` into `src/components/workspace-home/`. **Client dashboard**: extracted `useContentRequests` hook for Content tab API logic. **UX improvements shipped alongside**: skeleton/shimmer loading states (`Skeleton.tsx` UI primitive), mobile-friendly date picker popover, Chat/FeedbackWidget overlap fix on mobile, centralized number formatting utilities, sequential batch approve (race condition fix), and strategy generation error handling with user-facing error messages.

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
**What it does:** Tracks `durationMs` on every `callOpenAI()` invocation. `getTimeSaved()` in `openai-helpers.ts` maps each AI feature to a human-equivalent time estimate (e.g., content brief = 150 min, keyword strategy = 240 min, schema generation = 60 min). New endpoint `GET /api/ai/time-saved?workspaceId=&since=` returns `totalHoursSaved`, `operationCount`, and per-feature breakdown. The Command Center (WorkspaceOverview) shows an "Hours Saved" StatCard with purple Clock icon displaying total hours and AI operation count for the current month.

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

## Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 15 | Audit, fix, and optimize faster than manual tools + AEO trust signals + change impact tracking + content decay detection |
| Analytics & Tracking | 7 | Unified data view replaces platform-hopping + AI time-saved tracking |
| Content & Strategy | 9 | Strategy → brief → AI post generation → review → delivery pipeline + audit-to-request + not-yet-ranking action plan |
| Client Communication | 10 | Structured workflows + automated reports + expanded notifications + feedback widget + email capture funnel + audit completion email |
| Client Self-Service | 14 | 24/7 data access, onboarding, plans, cart, order tracking, glossary, questionnaire, ROI upgrade prompts, shareable report permalinks |
| AI & Intelligence | 7 | Full-spectrum AI advisor + revenue engine + knowledge base + recommendations engine + context completeness + usage dashboard + AEO page review |
| Auth & Access Control | 3 | Internal user accounts, workspace ACL, client user accounts |
| Security | 2 | Helmet, HTTPS, rate limiting, input sanitization, Turnstile CAPTCHA, credential stuffing protection |
| Monetization | 2 | Stripe Checkout + Subscriptions, admin settings, payment tracking, trials, encrypted config, billing portal |
| Platform & UX | 17 | Design system, styleguide, cross-linking, sales tooling, roadmap, cockpit, workspace home, page state model, work orders, request linkage, admin UX overhaul, landing page, mobile guard, Recharts, portal OG/favicon, sidebar color accents, AI Usage standalone page |
| Data Architecture | 3 | PageEditState model, cross-store writes, activity feed for client actions |
| Architecture | 5 | Server refactor (48 route modules + 3 shared modules), frontend component decomposition, React Router, typed API client, shared types |
| Infrastructure | 5 | Structured logging (Pino), Sentry error monitoring, CI/CD pipeline, graceful shutdown, off-site backups (S3), E2E tests |

**107 features** across the platform. The core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**

Current feature count: **107**. Last updated: March 2026 (Devin infrastructure sprint: structured logging, Sentry, CI/CD, graceful shutdown, S3 backups, API hardening, React Router, typed API client, shared types, E2E tests).
