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
**What it does:** Per-page SEO audit with 20+ checks: titles, meta descriptions, canonicals, H1s, heading hierarchy, content length, alt text, Open Graph, structured data, HTML size, orphan pages, indexability, and more. Weighted scoring prioritizes high-impact ranking factors.

**Agency value:** Replaces paid tools for Webflow-specific checks. Catches issues Screaming Frog misses (Webflow API vs. published HTML discrepancies).

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
**What it does:** Runs Google PageSpeed Insights on key pages. Reports Core Web Vitals (LCP, FID, CLS) with per-page breakdowns and optimization opportunities.

**Agency value:** Performance data directly from Google's own tool. No "but my site feels fast" debates — the numbers are objective.

**Client value:** Faster site = better user experience = more conversions. Performance directly affects their bottom line.

**Mutual:** Quantifiable improvements the agency can point to in monthly reports. Clients see real speed gains.

---

### 6. Schema Suggester
**What it does:** Analyzes every page's content and existing structured data, then suggests appropriate JSON-LD schemas (Organization, FAQ, Service, Article, etc.) with AI-generated markup.

**Agency value:** Schema implementation is time-consuming and error-prone. This generates production-ready JSON-LD in seconds.

**Client value:** Rich snippets in search results (stars, FAQs, breadcrumbs) increase click-through rates significantly.

**Mutual:** High-value SEO deliverable that's visible in search results. Clients see their listings stand out; agency delivers it efficiently.

---

### 7. SEO Strategy (Keyword Mapping)
**What it does:** Maps every page to primary/secondary keywords using GSC data, competitor analysis, and AI. Identifies content gaps, quick wins, and keyword opportunities with volume/difficulty metrics.

**Agency value:** Automates the most labor-intensive part of SEO — the keyword strategy document. Pulls real data instead of guesswork.

**Client value:** A clear roadmap: which pages target which keywords, what content is missing, and where the quick wins are.

**Mutual:** Replaces static PDF strategy decks with a living, data-driven plan both sides can reference and act on.

---

### 8. Content Brief Generator
**What it does:** AI-generates full content briefs from keyword strategy data — suggested titles, outlines, word count targets, internal linking opportunities, competitor analysis, and SEO requirements.

**Agency value:** Briefs that used to take 1-2 hours each are generated in under a minute with real search data baked in.

**Client value:** Professional, research-backed content briefs they can review, approve, or request changes on directly from their portal.

**Mutual:** Streamlines the entire content production pipeline from strategy → brief → review → approval → production.

---

### 9. SEO Editor
**What it does:** Edit page titles, meta descriptions, and OG tags directly through the Webflow API — with AI-powered suggestions based on actual page content and target keywords.

**Agency value:** No more logging into Webflow, finding the page, editing, saving, and publishing. Batch-edit dozens of pages from one screen.

**Client value:** SEO changes happen faster. Optimizations that used to take days are done in minutes.

**Mutual:** Speeds up the most common SEO task (metadata optimization) by 10x. More gets done in less time.

---

### 10. Approval Workflow
**What it does:** Agency proposes SEO changes (titles, descriptions) as batches. Client reviews, approves/rejects, edits, and the approved changes push directly to Webflow via API.

**Agency value:** No more email chains asking "is this title OK?" — structured workflow with clear status tracking.

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
**What it does:** Pulls Google Search Console data — clicks, impressions, CTR, average position — with query-level and page-level breakdowns. Supports 7/28/90/180/365-day ranges.

**Agency value:** GSC data in context alongside all other tools. No more switching between platforms to correlate data.

**Client value:** Understands how their site performs in Google search without needing their own GSC access.

**Mutual:** Single source of truth for organic search performance that both sides reference.

---

### 13. Google Analytics Integration
**What it does:** Full GA4 integration — sessions, users, engagement, traffic sources, top pages, device breakdown, country data, event tracking, conversion summaries, and event explorer with page-level filtering.

**Agency value:** Deep analytics without GA4's clunky interface. Custom event grouping and module-level page filtering tailored per client.

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
**What it does:** Chronological feed of all platform actions — audits run, changes applied, content requested, briefs generated, approvals completed.

**Agency value:** Full audit trail. Know exactly what was done, when, and for which client.

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
**What it does:** Long-running operations (audits, compression, brief generation) run asynchronously with real-time WebSocket progress updates.

**Agency value:** No frozen screens or timeouts. Start an audit and keep working — a toast notification appears when it's done.

**Client value:** Invisible to the client, but ensures their dashboard always loads fast and never hangs.

**Mutual:** Professional, responsive UX that handles heavy operations gracefully.

---

## Client Dashboard (External)

### 18. Client Portal
**What it does:** Password-protected, white-labeled dashboard for each client. Shows curated views of search data, site health, analytics, strategy, content, requests, and approvals. Supports dark/light theme and custom branding.

**Agency value:** Replaces monthly PDF reports and "let me pull up the numbers" calls. Clients self-serve their own data 24/7.

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

## Summary

| Category | Feature Count | Primary Value Driver |
|----------|:---:|---|
| SEO & Technical | 7 | Audit, fix, and optimize faster than manual tools |
| Analytics & Tracking | 4 | Unified data view replaces platform-hopping |
| Content & Strategy | 3 | Strategy → brief → approval → production pipeline |
| Client Communication | 4 | Structured workflows replace email chaos |
| Client Self-Service | 6 | 24/7 data access reduces reporting overhead |

The platform's core thesis: **every feature either saves the agency time or gives the client transparency — and the best features do both.**
