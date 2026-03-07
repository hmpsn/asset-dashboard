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
**What it does:** Per-page SEO audit with 20+ checks: titles, meta descriptions, canonicals, H1s, heading hierarchy, content length, alt text, Open Graph, structured data, HTML size, orphan pages, indexability, and more. Weighted scoring prioritizes high-impact ranking factors. Integrates redirect chain detection and homepage Core Web Vitals inline. Auto-saves snapshots for historical comparison. Scheduled recurring audits with email alerts on score drops.

**Agency value:** Replaces paid tools for Webflow-specific checks. Catches issues Screaming Frog misses (Webflow API vs. published HTML discrepancies). Historical snapshots track progress over time.

**Client value:** A clear health score with specific, actionable recommendations — not a wall of jargon.

**Mutual:** A shared language for site health. "We improved your score from 72 to 89" is visible in both dashboards. Trust through transparency.

---

### 4. Dead Link Checker
**What it does:** Crawls every page (including CMS via sitemap), extracts all links, and checks for 404s, timeouts, and redirect chains.

**Agency value:** Catches broken links before Google does, including ones buried in CMS collection pages.

**Client value:** No "page not found" experiences for visitors. Protects brand credibility.

**Mutual:** Proactive fixes demonstrate ongoing value — concrete deliverables the client didn't know they needed.

---

### 5. PageSpeed / Performance
**What it does:** Runs Google PageSpeed Insights on key pages. Reports Core Web Vitals (LCP, FID, CLS) with per-page breakdowns and optimization opportunities. Single-page on-demand testing by slug. Homepage CWV wired into the site audit for a unified health picture.

**Agency value:** Performance data directly from Google's own tool. No "but my site feels fast" debates — the numbers are objective.

**Client value:** Faster site = better user experience = more conversions. Performance directly affects their bottom line.

**Mutual:** Quantifiable improvements the agency can point to in monthly reports. Clients see real speed gains.

---

### 6. Schema Generator
**What it does:** Analyzes every page's content and existing structured data, then generates unified `@graph` JSON-LD schemas (Organization, FAQ, Service, Article, BreadcrumbList, LocalBusiness, etc.) using AI. Validates against Google requirements. Supports **per-page generation** via a searchable page picker — generate for one page without scanning the whole site. Results stream incrementally with real-time progress via WebSocket. Schemas persist to disk and survive deploys (incremental saves every 10s during generation). One-click **Publish to Webflow** injects schema via the Custom Code API. **Send to Client** creates an approval batch for client review before publishing. **CMS Template Schemas** generate dynamic schemas for collection pages using Webflow's `{{wf {...}}}` template syntax — one schema template auto-populates from CMS fields across all collection items. Prompt engineering enforces strict output: no empty arrays/objects, consistent `@id` naming, omitted empty properties.

**Agency value:** Schema implementation is time-consuming and error-prone. This generates production-ready, validated JSON-LD in seconds — per-page or full-site. Direct Webflow publishing eliminates manual copy-paste. CMS templates mean one schema covers hundreds of collection items automatically.

**Client value:** Rich snippets in search results (stars, FAQs, breadcrumbs) increase click-through rates significantly. Client reviews and approves before anything goes live.

**Mutual:** High-value SEO deliverable that's visible in search results. Clients see their listings stand out; agency delivers it efficiently. The approval flow ensures nothing ships without sign-off.

---

### 7. SEO Strategy (Keyword Mapping)
**What it does:** Maps every page to primary/secondary keywords using GSC data, competitor analysis, SEMRush metrics (volume, KD%, intent), and AI. Batched parallel AI processing for large sites. Identifies content gaps, quick wins, low-hanging fruit, and keyword opportunities. Summary dashboard with performance tiers, search intent badges, and sortable/filterable page map. Runs as a background job with real-time progress. Smart page filtering excludes utility pages.

**Agency value:** Automates the most labor-intensive part of SEO — the keyword strategy document. Pulls real data from GSC + SEMRush instead of guesswork. Batched processing handles 100+ page sites efficiently.

**Client value:** A clear roadmap: which pages target which keywords, what content is missing, and where the quick wins are. Interactive strategy view with "Request This Topic" buttons.

**Mutual:** Replaces static PDF strategy decks with a living, data-driven plan both sides can reference and act on.

---

### 8. Content Brief Generator
**What it does:** AI-generates full content briefs from keyword strategy data — suggested titles, outlines, word count targets, internal linking opportunities, competitor analysis, E-E-A-T guidelines, content checklists, and schema recommendations. Supports **Brief vs. Full Post** service tiers with configurable pricing. Branded HTML export and AI tool export formats. Full client approval workflow: submit topic → generate brief → client reviews → approve/decline/request changes → upgrade to full post.

**Agency value:** Briefs that used to take 1-2 hours each are generated in under a minute with real search data baked in. Service tier pricing built in.

**Client value:** Professional, research-backed content briefs they can review, approve, decline, or request changes on directly from their portal. PDF export available.

**Mutual:** Streamlines the entire content production pipeline from strategy → brief → review → approval → production. Pricing transparency builds trust.

---

### 9. SEO Editor
**What it does:** Edit page titles, meta descriptions, and OG tags directly through the Webflow API — with AI-powered suggestions based on actual page content and target keywords.

**Agency value:** No more logging into Webflow, finding the page, editing, saving, and publishing. Batch-edit dozens of pages from one screen.

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
**What it does:** Full GA4 integration — sessions, users, engagement, traffic sources, top pages, device breakdown, country data, event tracking, conversion summaries, and event explorer with page-level filtering. Click-to-inspect detail popovers on all charts showing date + key metrics per data point.

**Agency value:** Deep analytics without GA4's clunky interface. Custom event grouping and module-level page filtering tailored per client. Interactive charts make data exploration effortless.

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
**What it does:** Client-facing views of GSC and GA4 data with the same time range controls, charts, and breakdowns as the admin side.

**Agency value:** Clients stop asking "how's traffic?" — they can check themselves. Frees up time for actual optimization work.

**Client value:** Ownership of their data in a clean interface. No GA4 login required.

**Mutual:** Self-service data access reduces back-and-forth while keeping the agency positioned as the expert who acts on the data.

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

### 24. AI Search Chat
**What it does:** In-dashboard chat assistant that answers questions about the client's search data, powered by their actual GSC metrics.

**Agency value:** Reduces "what keyword am I ranking for?" support questions. The chat handles basic data queries.

**Client value:** Instant answers about their search performance in plain English.

**Mutual:** Empowers clients to self-serve basic questions while the agency focuses on strategic work.

---

### 25. Redirect Manager
**What it does:** Scans all published pages (static + CMS via sitemap) for redirect chains, 404s, loops, and routing issues. Traces multi-hop redirects and detects broken destinations. **GSC ghost URL detection** identifies old/renamed pages that Google still indexes but no longer exist on the site — catches redirect gaps invisible to a simple crawl. AI-powered **redirect target recommendations** match broken/404 slugs against healthy pages using keyword overlap and path similarity. Review panel with accept/edit target/dismiss workflow. **Export CSV** generates Webflow-compatible redirect rules for import in Settings → Hosting → 301 Redirects. Results persist to disk between deploys.

**Agency value:** Finds redirect problems across the entire site in one scan — including CMS pages. Recommendations eliminate the guesswork of "where should this redirect to?"

**Client value:** No more "page not found" dead ends. Redirect issues are caught and fixed proactively.

**Mutual:** Export CSV → import in Webflow is a fast, repeatable workflow. The agency delivers concrete fixes; the client's visitors never hit dead pages.

---

### 26. Internal Linking Analyzer
**What it does:** Analyzes internal link structure across the site, identifying orphan pages, under-linked content, and opportunities to strengthen topic clusters through better internal linking.

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
**What it does:** Side-by-side SEO comparison between your site and any competitor URL. Runs a full audit on both sites simultaneously, then compares scores, page counts, error/warning ratios, title/description lengths, OG coverage, schema coverage, H1 coverage, and issue distribution. Surfaces **quick wins** — issues the competitor handles well that your site doesn't. Color-coded metric comparisons (green = winning, red = losing) with per-category breakdowns.

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
**What it does:** Analyzes total image weight per page across the entire site. Identifies pages loading the most image data, flags heavy pages (>2MB), and provides per-page breakdowns of image count and total size. Runs as part of the Performance tab alongside PageSpeed Insights.

**Agency value:** Pinpoints which pages need image optimization first. Pairs with the Asset Manager's compression tool for a complete workflow.

**Client value:** Faster pages for visitors. Heavy pages are identified and fixed before they hurt bounce rates.

**Mutual:** Data-driven prioritization — optimize the heaviest pages first for maximum performance impact.

---

### 32. Unified Design System
**What it does:** Consistent teal/zinc color palette across all admin and client dashboard components. All inline CSS variable references replaced with Tailwind utility classes. Unified card backgrounds, sidebar styling, workspace selector, and button treatments. **Accessibility pass**: minimum `text-[11px]` font size enforced (was `text-[8px]` in some places), improved contrast ratios, `aria-label` attributes on all icon-only buttons. **Selective type size bump**: `text-[11px]`/`text-xs` → 13.5px, `text-sm` → 15.5px for improved readability. **MetricRing** background tracks use muted score-colored fills (15% opacity) instead of flat gray. **Global cursor-pointer** rule ensures all interactive elements show pointer cursor. **SectionCard** headings bumped to `font-semibold text-zinc-200`, **PageHeader** titles to `text-zinc-100`. Theme-aware `scoreColor()` returns WCAG-compliant colors in light mode.

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

## Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 12 | Audit, fix, and optimize faster than manual tools |
| Analytics & Tracking | 5 | Unified data view replaces platform-hopping |
| Content & Strategy | 3 | Strategy → brief → approval → production pipeline |
| Client Communication | 4 | Structured workflows replace email chaos |
| Client Self-Service | 6 | 24/7 data access reduces reporting overhead |
| Platform & UX | 4 | Design system, styleguide, cross-linking, sales tooling |

**34 features** across the platform. The core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**

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
- **Schema diff view**: Show what changed between existing and suggested schema before publishing.
- **Auto-schedule**: Re-generate schemas on a cadence (e.g., weekly) and flag pages where content changed but schema is stale.
- **Bulk publish all**: One-click to publish all generated schemas at once (currently per-page).

### Redirect Manager Enhancements
- ~~GSC ghost URL detection~~: ✅ Shipped — Identifies old/renamed pages Google still indexes but no longer exist on site.
- **Webflow Enterprise API**: The 301 Redirects API is Enterprise-only. If/when Enterprise access is available, push accepted rules directly via API instead of CSV export.
- **Historical comparison**: Track redirect status over time — detect new 404s since last scan.
- **Google Search Console 404 import**: Pull crawl errors from GSC to seed the redirect scanner with known broken URLs.

### Site Audit Enhancements
- ~~Redirect + CWV integration~~: ✅ Shipped — Redirect chains and homepage Core Web Vitals wired into audit.
- ~~Contextual cross-link tips~~: ✅ Shipped — Audit results suggest SEO Editor, Redirects, Schema, Performance based on findings.
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
- **Custom date range picker**: Replace preset buttons (7d/28d/90d) with a full calendar date range selector.
- **White-label email templates**: Branded email notifications matching the client portal theme.

### Content Pipeline
- ~~Service tiers~~: ✅ Shipped — Brief vs. Full Post with configurable pricing.
- ~~E-E-A-T guidelines~~: ✅ Shipped — Content briefs include E-E-A-T, content checklists, schema recs.
- **Content calendar**: Visual calendar view of content in production with due dates.
- **Writer assignment**: Assign content pieces to specific writers with notifications.

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
- **Current bundle**: 929KB minified (206KB gzip). Approaching the recommended 500KB threshold for initial load.
- **Code-splitting**: Use dynamic `import()` for tab-level components (Search Console, Analytics, SEO Audit, etc.) so only the active tab's code is loaded.
- **Route-based splitting**: Lazy-load `/styleguide`, `/client/:id`, and admin routes as separate chunks.
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

Current feature count: **34**. Last updated: March 2026.
