# Asset Dashboard — Feature Audit

A brief value assessment of every feature in the platform, covering what it does, why it matters to the agency, why it matters to clients, and how it creates mutual value.

---

## Admin Dashboard (Internal)

### 1. Workspace Overview
**What it does:** Multi-client dashboard showing health scores, pending requests, approval status, and key metrics at a glance.

**Agency value:** One screen answers "which client needs attention right now?" — no digging required.

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
**What it does:** Analyzes every page's content and existing structured data, then generates unified `@graph` JSON-LD schemas (Organization, FAQ, Service, Article, BreadcrumbList, LocalBusiness, etc.) using AI. Validates against Google requirements. Supports **per-page generation** via a searchable page picker — generate for one page without scanning the whole site. Results stream incrementally with real-time progress via WebSocket. Schemas persist to disk and survive deploys (incremental saves every 10s during generation). One-click **Publish to Webflow** injects schema via the Custom Code API — plus **Bulk Publish All** publishes every unpublished schema sequentially with a live progress counter. **Schema Diff View** shows a side-by-side comparison of existing vs. suggested JSON-LD before publishing, so you can see exactly what changes. **Send to Client** creates an approval batch for client review before publishing. **CMS Template Schemas** generate dynamic schemas for collection pages using Webflow's `{{wf {...}}}` template syntax — one schema template auto-populates from CMS fields across all collection items. Prompt engineering enforces strict output: no empty arrays/objects, consistent `@id` naming, omitted empty properties. **Audit Fix→ auto-generation**: when arriving from the Site Health Audit Fix→ button for a schema issue, automatically generates JSON-LD for the specific affected page — no manual page selection needed.

**Agency value:** Schema implementation is time-consuming and error-prone. This generates production-ready, validated JSON-LD in seconds — per-page or full-site. Direct Webflow publishing eliminates manual copy-paste. CMS templates mean one schema covers hundreds of collection items automatically.

**Client value:** Rich snippets in search results (stars, FAQs, breadcrumbs) increase click-through rates significantly. Client reviews and approves before anything goes live.

**Mutual:** High-value SEO deliverable that's visible in search results. Clients see their listings stand out; agency delivers it efficiently. The approval flow ensures nothing ships without sign-off.

---

### 7. SEO Strategy (Keyword Mapping)
**What it does:** Maps every page to primary/secondary keywords using GSC data, competitor analysis, SEMRush metrics (volume, KD%, intent), and AI. Batched parallel AI processing for large sites. Identifies content gaps, quick wins, low-hanging fruit, and keyword opportunities. Summary dashboard with performance tiers, search intent badges, and sortable/filterable page map. Runs as a background job with real-time progress. Smart page filtering excludes utility pages. **Conversion-aware**: GA4 conversion events and events-by-page data injected into the master synthesis prompt; AI protects "money pages" and references specific conversion events in quickWin rationales. **Audit-aware**: `getAuditTrafficForWorkspace` cross-references SEO audit errors with traffic data; high-traffic pages with issues surfaced as quickWins with specific fix actions.

**Agency value:** Automates the most labor-intensive part of SEO — the keyword strategy document. Pulls real data from GSC + GA4 conversions + SEMRush + audit intelligence instead of guesswork. Batched processing handles 100+ page sites efficiently. Conversion data ensures the strategy never deprioritizes pages that drive revenue.

**Client value:** A clear roadmap: which pages target which keywords, what content is missing, and where the quick wins are. Interactive strategy view with "Request This Topic" buttons. Strategy now reflects which pages actually convert, not just which pages rank.

**Mutual:** Replaces static PDF strategy decks with a living, data-driven plan both sides can reference and act on.

---

### 8. Content Brief Generator
**What it does:** AI-generates full content briefs from keyword strategy data — suggested titles, outlines, word count targets, internal linking opportunities, competitor analysis, E-E-A-T guidelines, content checklists, and schema recommendations. Supports **Brief vs. Full Post** service tiers with configurable pricing. Branded HTML export and AI tool export formats. Full client approval workflow: submit topic → generate brief → client reviews → approve/decline/request changes → upgrade to full post. **SEMRush enrichment**: when configured, briefs include real keyword volume, difficulty, CPC, competition data, and related keywords from SEMRush instead of AI-estimated values. **Inline editing**: all key brief fields (title, meta, summary, outline headings/notes/word counts, audience, tone, CTAs, competitor insights, word count target, intent, format) are editable in-place with auto-save on blur. **Improved GSC filtering**: related queries now match any significant keyword word (length > 2) instead of only the first word. **Audit Fix→ pre-fill**: when arriving from the Site Health Audit Fix→ button for thin content issues, the keyword field is automatically pre-filled with the page name (hyphens converted to spaces) so the user can immediately generate a brief.

**Agency value:** Briefs that used to take 1-2 hours each are generated in under a minute with real search data baked in. Service tier pricing built in. Inline editing lets the team refine AI output without regenerating.

**Client value:** Professional, research-backed content briefs they can review, approve, decline, or request changes on directly from their portal. PDF export available. Real SEMRush data grounds the brief in actual market metrics.

**Mutual:** Streamlines the entire content production pipeline from strategy → brief → review → approval → production. Pricing transparency builds trust. Editable briefs mean faster iteration; real data means better strategic decisions.

---

### 9. SEO Editor
**What it does:** Edit page titles, meta descriptions, and OG tags directly through the Webflow API — with AI-powered suggestions based on actual page content and target keywords. **Audit Fix→ auto-expand**: when arriving from the Site Health Audit Fix→ button for metadata issues, the target page automatically expands and scrolls into view so the user can immediately edit.

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
**What it does:** Clients can request content topics (from strategy recommendations or their own ideas), review AI-generated briefs, approve/decline, request changes, upgrade from brief to full post, and track production status with comments.

**Agency value:** Structured content pipeline replaces scattered email threads. Every request has a status, every brief has a review trail.

**Client value:** Control over content direction. Can approve, edit, or decline before any writing begins. Transparent pricing.

**Mutual:** The entire content lifecycle — from idea to published post — lives in one place both sides can track.

---

### 22. Client Request System
**What it does:** Clients submit requests (bug reports, change requests, new features) with categories, file attachments, and threaded notes. Team responds with status updates.

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
**What it does:** Per-workspace knowledge base that feeds business context into both AI chatbots. Two input methods: inline `knowledgeBase` text field (editable in Workspace Settings → Features) and a `knowledge-docs/` folder for longer `.txt`/`.md` documents (up to 6000 chars). `buildKnowledgeBase()` in `seo-context.ts` reads both sources and injects into system prompts for client and admin chatbots.

**Agency value:** One place to store everything the AI needs to know about a client — industry, services, differentiators, common questions, target audience. Shared across both chatbot personas.

**Client value:** AI responses are tailored to their specific business instead of generic advice.

**Mutual:** Knowledge base makes both chatbots dramatically more useful with minimal ongoing maintenance.

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

### 29. Competitor SEO Analysis
**What it does:** Side-by-side SEO comparison between your site and any competitor URL. Runs a full audit on both sites simultaneously, then compares scores, page counts, error/warning ratios, title/description lengths, OG coverage, schema coverage, H1 coverage, and issue distribution. Surfaces **quick wins** — issues the competitor handles well that your site doesn't. Color-coded metric comparisons (green = winning, red = losing) with per-category breakdowns. **Auto-restore**: comparison results persist to disk — the most recent comparison for your site loads on mount, pre-filling the competitor URL.

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
**What it does:** Per-workspace landing page that loads as the default tab when selecting a workspace. Parallel-fetches and displays: **site health audit** score with delta, **Search Console** overview (clicks, impressions, CTR, position), **GA4** overview (users, sessions, pageviews) with period-over-period comparison, **rank tracking** summary (top keywords with position changes), **active requests** with status counts, **content pipeline** status, **recent activity** feed, and **annotations** timeline. All data loads in parallel with a 15-second timeout per endpoint and graceful fallback — sections with no data simply don't render. Uses shared UI primitives (StatCard, SectionCard, PageHeader, Badge).

**Agency value:** One screen per client shows everything that matters — health, traffic, rankings, requests, and activity — without clicking into individual tools. Instant context when switching between clients.

**Client value:** N/A — admin-only view (clients have their own portal).

**Mutual:** Eliminates the "let me pull up the data" delay. Every workspace conversation starts from a position of full awareness.

### 42. Security Hardening
**What it does:** Pre-payment security layer across the Express server. **Helmet** adds security headers on all responses (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, CSP whitelisting Stripe domains in production). **HTTPS enforcement** redirects all HTTP traffic to HTTPS in production via `X-Forwarded-Proto` proxy trust. **3-tier rate limiting** on all public API routes: 60 req/min general reads, 10/min writes (POST/PATCH/DELETE), 5/min checkout (pre-wired for Stripe). **Input sanitization** via `sanitizeString()` (trim, length cap, control character stripping) and `validateEnum()` applied to all content request write endpoints. **Stripe webhook placeholder** marks the correct mount point before `express.json()` for raw body parsing.

**Agency value:** Production-grade security posture before accepting payments. Prevents abuse of public APIs, protects against XSS/clickjacking, and ensures Stripe integration has a secure foundation.

**Client value:** Payment data handled securely. Dashboard protected against common web attacks. Rate limiting prevents service degradation.

**Mutual:** Security is invisible when done right — clients trust the platform, agency avoids liability. Foundation for PCI-compliant payment flows.

---

### 43. Automated Monthly Reports
**What it does:** Auto-generated monthly report emails sent to clients on a configurable schedule. `gatherMonthlyData` aggregates site health audit (score, delta, errors, warnings), requests completed/open, approvals applied/pending, activity log, and now **traffic trends**: GSC period comparison (clicks, impressions with % change vs previous 28 days) and GA4 period comparison (users, sessions, pageviews with % change). **Chat topic summaries**: `listSessions` fetches recent client chat sessions with AI-generated summaries from the current month; up to 5 displayed in a "Topics You Asked About" section with green-tinted cards showing conversation title + summary. `renderMonthlyReport` in `email-templates.ts` generates a branded HTML email with a health score ring, traffic trends grid (each metric shows current value + arrow + % change vs previous period), metrics grid (requests, approvals, activities), recent activity feed, chat topics section, and pending approval alerts. Manual trigger via `triggerMonthlyReport()` or automatic via `startMonthlyReports()` scheduler.

**Agency value:** Monthly reporting that writes itself. Traffic trends show clients their site is growing (or flag problems) without manual data pulls. Chat topic summaries show the agency what clients care about. Positions the agency as proactive — clients get a polished, personalized report without anyone remembering to send it.

**Client value:** Regular, data-rich updates on their site's performance without scheduling a meeting. Traffic trends contextualize the numbers — "your clicks are up 23% vs last month" is immediately meaningful. Chat topics section reminds them of insights they explored.

**Mutual:** Eliminates the most common source of client "radio silence" complaints. The agency delivers consistent, personalized communication; the client stays informed and engaged.

---

### 44. Stripe Payment Integration
**What it does:** Full Stripe Checkout integration for content deliverables. **Server:** `server/stripe.ts` lazily initializes the Stripe SDK (picks up keys from admin UI or env vars), defines 14 product types (7 brief types, 3 post tiers, 2 schema, 2 strategy), creates Checkout sessions with workspace/content-request metadata, handles webhooks (`checkout.session.completed` → marks payment paid + logs activity, `payment_intent.payment_failed` → logs failure). `server/payments.ts` provides PaymentRecord CRUD with JSON-on-disk persistence per workspace. `server/stripe-config.ts` stores Stripe keys encrypted at rest (AES-256-GCM) on disk — no env vars needed. **Admin UI:** `StripeSettings.tsx` in the Command Center lets you paste API keys (masked inputs), map Stripe Price IDs to each product, enable/disable individual products, and see connection status. **Frontend:** `ClientDashboard.tsx` `confirmPricingAndSubmit()` creates the content request first, then redirects to Stripe Checkout when `stripeEnabled`. Payment success/cancel detected via URL params on return with toast + URL cleanup. Falls back to direct submit when Stripe isn't configured. **Workspace:** `tier` (free/growth/premium), `trialEndsAt`, `stripeCustomerId` fields added.

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
**What it does:** Individual login accounts for client dashboard users, separate from internal team accounts. `server/client-users.ts` provides a ClientUser model with id, email, name, passwordHash, role (client_owner/client_member), workspaceId, and invitedBy. Per-workspace email uniqueness. Passwords hashed with bcrypt (12 rounds). Client JWT tokens (24h expiry) stored in per-workspace cookies (`client_user_token_<wsId>`). Public endpoints: `/api/public/client-login/:id` (email+password login), `/api/public/client-me/:id` (get current user), `/api/public/client-logout/:id`, `/api/public/auth-mode/:id` (check shared password vs individual accounts). Admin endpoints: `/api/workspaces/:id/client-users` CRUD for managing client users with workspace access control. Client login also sets the legacy session cookie for backward compatibility with the existing session enforcement middleware. Session middleware updated to accept client user JWT tokens alongside shared-password sessions.

**Agency value:** Invite individual client team members with their own credentials. See who submitted which request, who approved what. Professional multi-user access replaces "everyone uses the same password."

**Client value:** Individual logins mean personal dashboards, attributed actions, and proper team management. Marketing directors, content managers, and developers each have their own access.

**Mutual:** Transforms the client portal from a shared-password view into a proper multi-user platform. Every action has a name attached. Foundation for role-based client permissions (client_owner vs client_member).

---

## Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 12 | Audit, fix, and optimize faster than manual tools |
| Analytics & Tracking | 5 | Unified data view replaces platform-hopping |
| Content & Strategy | 3 | Strategy → brief → approval → production pipeline |
| Client Communication | 6 | Structured workflows + automated reports replace email chaos |
| Client Self-Service | 6 | 24/7 data access reduces reporting overhead |
| AI & Intelligence | 3 | Full-spectrum AI advisor + revenue engine + knowledge base + memory |
| Auth & Access Control | 3 | Internal user accounts, workspace ACL, client user accounts |
| Security | 1 | Helmet, HTTPS, rate limiting, input sanitization |
| Monetization | 1 | Stripe Checkout, admin settings, payment tracking, encrypted config |
| Platform & UX | 7 | Design system, styleguide, cross-linking, sales tooling, roadmap, cockpit, workspace home |

**47 features** across the platform. The core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**

---

## Future Additions

Items to revisit as budget/tier upgrades allow or when priorities shift.

### OpenAI Tier Upgrade
- **Schema Generator → gpt-4o**: Currently using `gpt-4o-mini` due to 30K TPM limit on the current org tier. Once spend pushes to the next tier (200K+ TPM on gpt-4o), switch back for marginally richer schema output. One-line change in `server/schema-suggester.ts`.
- **SEO Audit AI → gpt-4o-mini savings**: The audit's AI recommendations (title/meta fixes) currently use gpt-4o. Could switch to mini to save cost with minimal quality loss since it's structured output.

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
- **Content brief: GA4 page performance** — Inject GA4 landing page performance (bounce rate, sessions, engagement) into brief generation for existing-page content refreshes.

### Content Pipeline
- ~~Service tiers~~: ✅ Shipped — Brief vs. Full Post with configurable pricing.
- ~~E-E-A-T guidelines~~: ✅ Shipped — Content briefs include E-E-A-T, content checklists, schema recs.
- ~~Inline brief editing~~: ✅ Shipped — All key fields editable in-place with auto-save (title, meta, summary, outline, audience, tone, CTAs, word count, intent, format, competitor insights).
- ~~SEMRush brief enrichment~~: ✅ Shipped — Real keyword volume, difficulty, CPC, competition, trend, and related keywords feed into AI prompt when SEMRush is configured.
- ~~GSC query filtering fix~~: ✅ Shipped — Related queries now match any keyword word (len > 2) instead of only the first word.
- **Content calendar**: Visual calendar view of content in production with due dates.
- **Writer assignment**: Assign content pieces to specific writers with notifications.
- **Content delivery**: Attach deliverables (Google Doc links, uploaded files) to completed requests.

### Design & Accessibility
- ~~Unified zinc/teal palette~~: ✅ Shipped — All CSS variables replaced with Tailwind utility classes.
- ~~Accessibility pass~~: ✅ Shipped — Minimum 11px font sizes, improved contrast, aria-labels on icon-only buttons.
- ~~Activity log wiring~~: ✅ Shipped — All major operations now logged automatically.
- ~~Light mode WCAG overrides~~: ✅ Shipped — Full accent color, gradient, border, and text overrides for WCAG AA compliance in light mode across all tabs including SEO Strategy.
- ~~Component Styleguide~~: ✅ Shipped — `/styleguide` route with all UI primitives, charts, tables, modals, toasts, forms, loading states, progress bars, and sidebar nav.
- ~~Selective type size bump~~: ✅ Shipped — `text-[11px]`/`text-xs` → 13.5px, `text-sm` → 15.5px.
- ~~Heading contrast~~: ✅ Shipped — SectionCard and PageHeader titles punched up.
- **WCAG AA compliance**: Full contrast ratio audit, focus indicators, keyboard navigation for all interactive elements.
- **Responsive mobile layout**: Sidebar collapses to bottom nav, cards stack vertically on small screens.

### Performance & Bundle Size
- ~~Code-splitting~~: ✅ Shipped — All routes and tabs lazy-loaded via `React.lazy()` + `Suspense`. Initial bundle: 929KB → 256KB (72% reduction). 25+ separate chunks for route-level, admin tab, and sub-tool splitting.
- ~~Route-based splitting~~: ✅ Shipped — `/styleguide`, `/client/:id`, and all admin tabs are separate lazy chunks.
- **Heavy dependency audit**: Identify if any large libraries (chart libs, PDF generators) can be loaded on-demand.
- **Tree-shaking**: Verify Lucide icons are tree-shaken (only used icons in bundle, not the full set).

### Competitor Analysis Enhancements
- **Historical comparisons**: Track how you vs. competitor gap changes over time.
- **Multi-competitor**: Compare against 2-3 competitors simultaneously.
- **Keyword overlap**: Show which keywords both sites rank for and where you're winning/losing.

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

Current feature count: **47**. Last updated: March 7, 2026.
