# Phase 0 Functionality Ledger — Site Audit (3→1 merge)

- **Surface:** Site Audit · zone: Search & Site Health · nav id (prototype): `audit`
- **HEAD routes covered:** `Page` values `seo-audit` (src/routes.ts:5, navRegistry.tsx:125) and `page-intelligence` (src/routes.ts:7, navRegistry.tsx:139), plus the non-nav public report routes (`/report/:id`, `/report/audit/:siteId`).
- **Prototype views read:** `hmpsn studio Design System/mockup/audit.js` (Site Audit), `mockup/sitehealth.js` (book-level Site Health roll-up — NEW), `mockup/editor.js` Research mode (Page Intelligence's proposed home, lines 930–1010).
- **Audited at HEAD:** branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD). Read-only; no git commands run.

## What "3→1" means (verified, two readings — see Open Question Q1)

The Handoff Brief tags Site Audit "3→1" without naming the three. Evidence for each reading:

- **Reading A (prototype's own comment):** `audit.js:1-7` — "Absorbs **Performance** (Core Web Vitals is a category) and **Links** (broken/internal-link issues are categories)". I.e. the three HEAD site-health triage layers (seo-audit + performance CWV + links dead-links) merge at the *triage* level, while Performance (`performance.js`) and Links (`links.js`) survive as dedicated deep workshops. HEAD already half-does this: `SeoAudit.tsx:576-578` (CWV card inline) and `SeoAudit.tsx:613-619` (dead-link panel inline).
- **Reading B (sub-tab redistribution):** HEAD `SeoAudit` is itself 3 tools in one page — Site Audit + Content Health (`ContentDecay`, SeoAudit.tsx:353-363) + AI Search Ready (`AeoReview`, SeoAudit.tsx:364-374). The mockup's own state comment `audit.js:237` (`subTab='audit'; // audit | health | aeo | history`) shows health/aeo were planned then split out; the Parity Ledger's Site Audit note confirms: "Content Health + AI Search Ready split out to their proper homes" (Pipeline → Content Health tab; AI Visibility → AeoReview).

Both are decisions the prototype embodies; the merge ticket needs the owner to confirm which framing is the spec (Q1).

## Capability table — `seo-audit` (SeoAudit + src/components/audit/*)

Status legend: **preserved** (obvious home, same or better) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only) · **at_risk** (exists at HEAD, no visible home in the prototype).

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | Run SEO audit as background job (non-cancellable) with live progress % + message | src/hooks/admin/useSeoAuditWorkflow.ts:82-94; SeoAudit.tsx:410-438 | preserved | Site Audit — "Re-run audit" (audit.js:518,656) | Mockup shows toast only; progress UI owed by state kit |
| 2 | "Include dead link scan" opt-out checkbox (`skipLinkCheck`) | SeoAudit.tsx:399-404; useSeoAuditWorkflow.ts:39,87 | at_risk | — | Not in mockup's re-run flow |
| 3 | Auto-restore latest audit snapshot on mount (survives deploys) | useSeoAuditWorkflow.ts:130-138; server/routes/reports.ts:252 | preserved | Site Audit (implied by "Last crawl 6h ago" header, audit.js:565) | |
| 4 | Attach to already-running / recently-completed audit job on remount | useSeoAuditWorkflow.ts:117-128 | preserved | Site Audit + background-job platform | Behavior contract, not visual |
| 5 | Empty state (never run) with check list description + CTA | SeoAudit.tsx:379-408 | preserved | Site Audit empty state (owed by state matrix) | |
| 6 | Error state with retry | SeoAudit.tsx:441-452 | preserved | Site Audit error state | |
| 7 | Post-run NextSteps card ("Review top issues") | SeoAudit.tsx:491-506 | improved | audit.js hero narrative headline ("X critical issues are bleeding rankings — fix those first", audit.js:602-605) | Narrative replaces card |
| 8 | Site Score stat w/ delta vs previous + score bar | SeoAudit.tsx:508-522 | improved | Score ring hero (audit.js:373-380, 599-613) | |
| 9 | Pages Scanned / Errors / Warnings / Info stat cards, click-to-filter by severity | SeoAudit.tsx:523-526 | at_risk (filter half) | Pills exist (audit.js:606-611) but are not filters | Severity *sort* exists (audit.js:512); severity *filter* does not — see Q5 |
| 10 | Broken Links stat card → deep-link `links?tab=dead-links` | SeoAudit.tsx:527-538 | improved | Dead-link panel + "Manage in Links" (audit.js:489) | |
| 11 | Contextual "Quick fixes →" chips routed by finding type (SEO Editor / Redirects / Schema / Performance) | SeoAudit.tsx:542-570 | improved | Per-issue cross-links: "Fix in Asset Manager", "Generate in Schema" (audit.js:451-453) | Mockup covers schema+assets; editor/redirect/perf equivalents via Fix actions + Links deep-link |
| 12 | CWV summary card — mobile **and** desktop, CrUX field pass/fail + Lighthouse lab score, LCP/INP/CLS ratings | SeoAudit.tsx:576-578; src/components/audit/CwvSummaryCard.tsx:9-60; types.ts:32-51 | preserved (split) | CWV strip in Site Audit (audit.js:382-399, single strategy) + full mobile/desktop in Performance (`performance.js`, per Parity Ledger row) | Mockup audit strip shows one field-data set; dual-strategy detail lives in Performance |
| 13 | Site-wide issues section (robots/sitemap/SSL/duplicates/orphans/indexability…) w/ AI suggestion display | SeoAudit.tsx:581-610; server/seo-audit.ts:184-250 | preserved | Issue rows under categories (Indexability etc., audit.js:251-258) | Taxonomy differs — Q2 |
| 14 | 20+ per-page checks, weighted scoring, noindex pages excluded from site score | server/seo-audit.ts:222-223; FEATURE_AUDIT.md:1689 | preserved | Site Audit issue engine (data layer unchanged — UI re-presents) | |
| 15 | noindex badge on page rows + inline explanation when expanded | SeoAudit.tsx:747,767-772 | at_risk | — | Not shown in mockup |
| 16 | Search box over pages + issues | SeoAudit.tsx:78,463-468; AuditFilters.tsx:42-51 | at_risk | — | audit.js has no search input |
| 17 | Category filter pills (content/technical/social/performance/accessibility) | AuditFilters.tsx:120-142; types.ts:8,86-92 | improved | Category cards w/ per-category score + click-to-isolate (audit.js:576-586,638) | New 6-cat taxonomy (index/onpage/perf/schema/links/mobile) ≠ HEAD 5-cat — Q2 |
| 18 | Per-category *scores* | — (mockup-only; HEAD has no per-category score) | new_proposed | Category grid (audit.js:265,576-586) | Needs server-side category scoring — data ticket |
| 19 | Sort: issues-severity vs traffic-impact (GSC clicks + GA4 pageviews via `/api/audit-traffic/:siteId`) | SeoAudit.tsx:469-484,95; useAdminSeo.ts:9-13; server/routes/misc.ts:72; AuditBatchActions.tsx:55-75 | preserved | Severity/Traffic sort toggle (audit.js:511-514,591-595) | |
| 20 | "Showing X of Y pages" + clear-filters | AuditBatchActions.tsx:36,50-54 | preserved | Filter readout in card header (audit.js:627) | |
| 21 | Per-issue row: severity, category badge, check code, recommendation, current value | AuditIssueRow.tsx:73-89 | improved | Expandable issue-type rows → affected pages (audit.js:457-473,436-455) | Mockup pivots page-first → issue-first with per-page detail; both severities+counts carried |
| 22 | Per-page traffic badges (clicks/views 28d) on affected rows | SeoAudit.tsx:753-757 | preserved | `au-ptraf` badges (audit.js:440,148) | |
| 23 | Editable AI suggested fix (inline edit, "(edited)" marker, char count) | AuditIssueRow.tsx:91-148; SeoAudit.tsx:89,134 | preserved | contenteditable AI suggestion block w/ char count (audit.js:404-415,642) | |
| 24 | Apply AI fix → writes to Webflow page SEO/OG fields (`PUT /api/webflow/pages/:pageId/seo`) | SeoAudit.tsx:131-156 | preserved | "Accept AI fix" per page (audit.js:422-424,643) | |
| 25 | Bulk Accept All — background job, WS progress (`BULK_OPERATION_PROGRESS/COMPLETE`), cancel, sessionStorage recovery, error banner | AuditFilters.tsx:71-97; BulkAcceptPanel.tsx:44-80; SeoAudit.tsx:236-246,637-651 | preserved | Bulk accept bar "Accept all N" (audit.js:499-507,649-652) | Job/WS/recovery semantics must carry over — behavior contract |
| 26 | Fix → routes issue to owning tool with `fixContext` (seo-editor / seo-schema / links / seo-briefs / performance) | AuditIssueRow.tsx:186-199; types.ts:94-112 | preserved | Per-issue/page action cluster + cross-links (audit.js:417-434,451-453) | fixContext receiver contract must be re-wired per destination |
| 27 | "Page" → Page Intelligence deep-dive (auto-expands target page) | AuditIssueRow.tsx:201-210; PageIntelligence.tsx:113-126 | preserved (retargeted) | → SEO Editor Research mode (editor.js:1516; Parity Ledger PI row) | Retarget to editor Research; keep auto-focus behavior |
| 28 | Send to Client w/ optional note → creates approval batch (`POST /api/approvals/:ws`) | SeoAudit.tsx:170-196; AuditIssueRow.tsx:150-181,300-308 | preserved (note at_risk) | "Send to client" per page (audit.js:426-428,644) | Mockup has no note field — carry the inline note |
| 29 | Add to Tasks (single issue → `POST /api/requests`) | SeoAudit.tsx:198-208 | preserved | "Create task" per page (audit.js:429-431,645) | |
| 30 | Batch add to tasks: All / Errors-only / Filtered (`POST /api/requests/batch`) | SeoAudit.tsx:210-233; AuditBatchActions.tsx:89-119 | at_risk | — | Mockup has only per-page Create task — Q4 |
| 31 | Suppress issue (check+pageSlug), suppress pattern (`prefix/*`), server-persisted per workspace | SeoAudit.tsx:103-129; server/routes/workspaces.ts:548-614 | preserved | Ignore / "Ignore all prefix/*" (audit.js:432,446,646-647) | |
| 32 | Suppressed-count strip + clear-all (incl. pattern unsuppress loop) | AuditBatchActions.tsx:37-49; SeoAudit.tsx:692-703 | preserved | Suppressed strip + "Clear all" (audit.js:493-497,648) | |
| 33 | Suppression-aware effective scores (client recompute + server-side on all 6 exit points) | SeoAudit.tsx:291-294 (applyClientSuppressions); FEATURE_AUDIT.md:2882 | preserved | Data-layer contract — carries regardless of UI | |
| 34 | Dead-link panel: status code, internal/external badges, found-on + anchor text | DeadLinkPanel.tsx:83-108; types.ts:53-61 | preserved | Dead-link panel (audit.js:475-491) | |
| 35 | Dead link → "Fix in SEO Editor" (internal links, w/ fixContext) | DeadLinkPanel.tsx:117-131 | preserved | "Fix link" (audit.js:483,653) routes to Links workshop | |
| 36 | Inline Add/Edit Redirect per dead link (best-effort save via redirects API) + queued count | DeadLinkPanel.tsx:40-54,132-188 | preserved (moved) | Links → Redirects tab w/ CSV (links.js per Parity Ledger) | Confirm audit→links deep-link carries the specific URL |
| 37 | Export dead links CSV (incl. queued redirect targets) | DeadLinkPanel.tsx:22-38 | preserved (moved) | Links → Redirects CSV export (Parity Ledger Links row) | |
| 38 | Scheduled audits: interval (1/7/14/30d), score-drop alert threshold, enable/disable/update, last-run display | ScheduledAuditSettings.tsx:31-45,70-133; server/routes/audit-schedules.ts:17-33; server/scheduled-audits.ts:20-102 | at_risk | audit.js:654 Schedule → toast "(Settings panel)" — placeholder, no real home | Q3 — config UI needs a named home |
| 39 | Scheduled-audit email alerts on score drop + client audit-complete email | server/scheduled-audits.ts:8 (notifyAuditAlert, notifyClientAuditComplete) | preserved | Server behavior — unaffected by UI rebuild | |
| 40 | Post-audit server side effects: snapshot auto-save, `AUDIT_COMPLETE` broadcast, auto-regen recommendations, client recommendation/audit emails, auto-resolve `audit_finding` insights | server/seo-audit-background-job.ts:50-177; server/scheduled-audits.ts:146-177 | preserved | Server behavior; frontend must keep a `useWorkspaceEvents`/registry invalidation for AUDIT_COMPLETE (src/hooks/useWsInvalidation.ts:33; src/lib/wsInvalidation.ts:184) | Data-flow rule #2 |
| 41 | Save & Share → snapshot + public share URL `/report/:id`, copy + open banner | SeoAudit.tsx:248-278,653-675; server/routes/reports.ts:224,313-320 | preserved | "Export & share" (audit.js:517,655: "shareable client link copied") | Public no-auth share endpoint is intentional (reports.ts:320) |
| 42 | Export HTML report (branded, printable) + CSV (pages + site-wide + CWV rows + AI suggestions) | AuditReportExport.tsx:11-60; SeoAudit.tsx:819-835 | preserved | "Export & share" toast claims "HTML + CSV saved" (audit.js:655) | |
| 43 | History sub-tab: latest score + delta, total audits, error trend, score trend chart, snapshot list w/ per-snapshot copy-link + open report, refresh | AuditHistory.tsx:37-161; ScoreTrendChart.tsx; server/routes/reports.ts:264 | preserved | History sub-tab w/ sparkline + snapshot rows + View (audit.js:523-555) | Per-snapshot share-link copy not shown — minor |
| 44 | Latest-report permalink `/report/audit/:siteId` | AuditHistory.tsx:82-104; server/routes/reports.ts:337 | preserved | Part of export/share cluster | |
| 45 | Action Items per snapshot: add w/ title/desc/priority, status cycle planned→in-progress→completed, delete, progress bar (`/api/reports/snapshot/:id/actions` CRUD) | ActionItemsPanel.tsx:43-84; server/routes/reports.ts:278-306 | at_risk | — | Absent from mockup History — Q4 |
| 46 | Guide sub-tab (SeoAuditGuide workflow doc) | SeoAudit.tsx:52,331-339,351; audit/SeoAuditGuide.tsx | at_risk | — | Mockup has no guide; other surfaces (Schema) kept a Workflow Guide — assume pattern carries, needs confirmation |
| 47 | `?sub=` deep link (audit/history/aeo-review/content-decay/guide) — receiver reads searchParams | SeoAudit.tsx:72-76 | preserved (retargeted) | Senders exist: ContentPipeline.tsx:220, WorkspaceHome.tsx:241,547 (`?sub=content-decay`) | Migration must retarget these to Pipeline's Content Health tab in the same change that moves it |
| 48 | Content Health sub-tool (ContentDecay, lazy) | SeoAudit.tsx:43,353-363 | preserved (moved) | Content Pipeline → Content Health tab (Parity Ledger Pipeline row, `pipeline.js`) | Owned by Pipeline surface auditor |
| 49 | AI Search Ready sub-tool (AeoReview, lazy) | SeoAudit.tsx:42,364-374 | preserved (moved) | AI Visibility (`aivis.js`; Parity Ledger Brand & AI tools: AeoReview → AI Visibility) | Owned by AI Visibility surface auditor |
| 50 | Unified page edit-state: per-page tracked-status border + StatusBadge + summary bar (live/in-review/approved/rejected/issue-detected/fix-proposed) | SeoAudit.tsx:98,711-721,730-752; src/hooks/usePageEditStates | preserved | Per-page status badges live/review/proposed/approved (audit.js:401-402,444) | Mockup badge set is smaller (4 vs 6 states) — keep full state machine semantics |
| 51 | Audit graduation to Insights Engine ("plumbing stays plumbing until it earns a story") | — (mockup-only) | new_proposed | audit.js:632; sitehealth.js:150 | Framing/flow decision; interacts with existing auto-regen recommendations (#40) |
| 52 | Book-level cross-client Site Health roll-up: issue-type totals, per-client matrix, isolate-by-type, "Open cockpit", batch-fix across clients | — (mockup-only; no HEAD cross-workspace audit aggregation) | new_proposed | sitehealth.js:75-151 | Needs new backend (cross-workspace issue aggregation + batch-fix jobs) — Q10 |

## Capability table — `page-intelligence` (PageIntelligence + src/components/page-intelligence/*)

Parity Ledger routes this whole surface to **SEO Editor → Research mode** (editor.js Edit ⇄ Research toggle, editor.js:1516), *not* into Site Audit. It is enumerated here because the assignment names it; the SEO Editor auditor owns the receiving surface (Q11 boundary note).

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| P1 | Tabs: Pages / Architecture / Guide | PageIntelligence.tsx:58,227-235 | preserved (split) | Pages → Editor Research; Architecture → Links 4th tab (Parity Ledger "Site Architecture" row: moved); Guide → ? | Guide home unconfirmed |
| P2 | Unified page list (Webflow pages ⋈ strategy pageMap via `usePageJoin`) w/ search + multi-key sort asc/desc | PageIntelligence.tsx:60-66,84-87,135-141 | preserved | Editor master table (Edit mode) + Research master-detail (editor.js:1516-1523) | |
| P3 | Stats header: page count, CMS count, with-strategy count, analyzed count | PageIntelligence.tsx:144-146,247-252 | preserved | Editor header sub-counts (editor.js:1329) | |
| P4 | Per-page AI analysis (fetch page HTML → content-score endpoint) | usePageIntelligenceAnalysis.ts:54-90 (`/api/webflow/page-html/:siteId`, `/api/webflow/content-score`) | preserved | Research mode per-page intelligence (editor.js:968-1007) | |
| P5 | Bulk "Analyze All" / "Analyze Remaining" as cancellable background job w/ progress + error banner | usePageIntelligenceAnalysis.ts:27-52; PageIntelligencePagesHeader.tsx:90-103 | at_risk | — | Research mode is one-page-at-a-time in mockup — Q7 |
| P6 | Persisted analyses hydrate from strategy pageMap; session analyses overlay | PageIntelligence.tsx:128-132 (buildEffectiveAnalyses); PageIntelligencePersistedAnalysisSummary.tsx | preserved | Research mode reads persisted per-page intelligence | Verify persistence read path in build |
| P7 | Analysis display: optimization score + bar, search intent + confidence, difficulty, keyword-placement checks (Title/Meta/Content/URL) | PageIntelligenceAnalysisSection.tsx:58-107 | preserved (partial) | Research scorebox + kwMatch inTitle/inDesc (editor.js:957-958,975-976) | Mockup shows title/desc placement only; intent-confidence + difficulty not drawn — carry full field set |
| P8 | Content gaps, recommendations, missing trust signals per page | PageIntelligenceAnalysisSection.tsx:109-140; FEATURE_AUDIT.md:1052 (missingTrustSignals feeds E-E-A-T autofill) | preserved | Research "Content gaps" + "Recommendations" lists (editor.js:993-996) | `missingTrustSignals` also feeds E-E-A-T autofill — data contract must survive |
| P9 | Fix Queue: score × traffic priority ranking w/ expand-page action | PageIntelligence.tsx:148-149; PageIntelligencePagesHeader.tsx:142-150; pageIntelligenceData.ts (buildFixQueue) | improved | Research fix-priority chip (High priority / Worth a pass / In good shape — editor.js:970-972) + Edit-mode "needs work" counts | Queue *list* view collapses into per-page chip; confirm triage list isn't needed |
| P10 | Edit page↔keyword mapping: primary + secondary keywords → `PATCH` strategy pageMap | usePageIntelligenceKeywordEditing.ts:23-54 (keywords.patchStrategy) | at_risk (secondary) | Research "Target keyword" assign/change (editor.js:984-991) | Mockup edits a single target keyword; **secondaryKeywords editing has no visible home** — Q6 |
| P11 | Track keyword → rank-tracking add; live refresh on `RANK_TRACKING_UPDATED` / `STRATEGY_UPDATED` WS events | usePageIntelligenceKeywordTracking.ts:9-56 | preserved | Research "Track" button → Keywords (editor.js:991,1595) | |
| P12 | Generate SEO copy (AI title/meta/H1) + copy-to-clipboard | usePageIntelligenceSeoCopy.ts:15-38 (keywords.seoCopy) | preserved | Editor "AI assist → Generate optimized set" (editor.js:951-953,960-962) | Editor version writes into fields — improvement |
| P13 | Local SEO visibility panel (mode=page) + per-keyword local visibility badges in page detail | PageIntelligence.tsx:38-55,272-276; PageIntelligencePageDetails.tsx:88-95 | at_risk | — | editor.js Research shows no local visibility; Keywords "rank lenses" + Local Presence cover keyword-scoped views, but the *page-scoped* local read has no confirmed home — Q8 |
| P14 | Hand-offs: Open SEO Editor / Create Brief (autoGenerate, carries analysis payload: keyword, intent, score, issues, recs, gaps) / Add Schema | PageIntelligence.tsx:160-202 | preserved | Research action row: Create brief / Add schema / View traffic (editor.js:997-1000) | Brief hand-off must keep the rich fixContext payload, not just the keyword |
| P15 | fixContext receiver: auto-expand target page (from Site Audit "Page" button) | PageIntelligence.tsx:107-126 | preserved (retargeted) | Editor Research must accept the equivalent deep-link | Two-halves contract — receiver work lands with the merge |
| P16 | Loading / error states w/ retry | PageIntelligence.tsx:204-221 | preserved | State kit | |
| P17 | Architecture tab (SiteArchitecture: URL tree, schema coverage, gaps, orphans, depth) | PageIntelligence.tsx:25,237-241 | preserved (moved) | Links → Architecture tab (Parity Ledger: "moved"; links.js SiteArchitecture chip `present`) | Owned by Links surface auditor |
| P18 | Page Intelligence Guide | PageIntelligence.tsx:243; PageIntelligenceGuide.tsx | at_risk | — | Same question as #46 |

## Adjacent capabilities noted (owned elsewhere, dependencies flagged)

- **Client HealthTab / public consumers** — the client dashboard renders the same audit shape (incl. "view by fix type" grouping, FEATURE_AUDIT.md:1689) and `GET /api/public/audit-traffic/:workspaceId` (server/routes/public-portal.ts:324). Any category-taxonomy or shape change (Q2) hits the client read path; the client-dashboard decision is itself Phase-0-gated.
- **Diagnostics** — the Parity Ledger contains a stale `gap` row ("Diagnostics has no home", Admin group) **and** a later `improved` row (`DiagnosticReportPage · diagnostics` → Insights Engine → Deep diagnostic, `diagnostics.js`). Resolved by the second row; the stale gap row should be cleaned. Owned by the Insights Engine auditor.
- **Recommendations auto-regen + client emails on audit complete** (server/seo-audit-background-job.ts:87-177) — server behavior that must not be orphaned if run-audit entry points move.

## Parity Ledger reconciliation (this surface)

- **Site Audit row:** status `improved`; all 8 nested sub-tools marked `present` (Issues table, AI fix→Webflow, Bulk accept/task/send, LinkChecker, CWV summary→Performance, AssetAudit→Asset Manager, Schema issues→Schema deep-link, History/export/share). **No Gap/Partial rows for Site Audit remain.** This audit's at_risk items above (#2, 9, 15, 16, 30, 38, 45, 46) are *finer-grained than the ledger's sub-tool rows* — they are the nested layer below the nested layer and are not contradicted by the ledger, just invisible to it.
- **Page Intelligence row:** status `improved` → SEO Editor Research mode. No Gap/Partial. My finer-grained at_risk items: P5 (bulk analyze), P10 (secondary keywords), P13 (page-scoped local visibility), P18 (guide).
- **Unresolved for this surface:** none at ledger row granularity; 12 at_risk capabilities at the sub-row granularity, all queued as stop-and-ask.

## Prototype coverage notes

**audit.js demonstrates:** score-ring hero with narrative verdict; crawl-stats eyebrow; 6 category cards with per-category scores + click-isolate; CWV field-data strip; severity/traffic sort; Schedule / Export & share / Re-run utility bar; purple bulk-accept bar; dead-link panel (status/type/found-on/anchor, fix, manage-in-Links); suppressed strip + clear-all; expandable issue rows → affected pages with traffic badges, 4-state status badges, contenteditable AI suggestion with char count, per-page action cluster (Accept AI fix / Send to client / Create task / Ignore / Ignore pattern), Asset Manager + Schema cross-links; History sub-tab (sparkline + snapshot rows + View); graduation note → Insights Engine. States shown: populated + per-category-clean + all-resolved-pages; empty/loading/error implied by state kit only.

**audit.js omits (HEAD has):** search box; severity filter; batch add-to-tasks; snapshot action items; scheduled-audit config form; skip-dead-link-scan toggle; noindex handling; flag-note field; mobile/desktop dual CWV; per-snapshot share links; guide.

**audit.js proposes (HEAD lacks):** per-category scores; issue-first (vs page-first) primary pivot; graduation rule; the whole sitehealth.js book-level roll-up (issue-type totals × client matrix, isolate, batch-fix across clients, open-cockpit hand-off).

**editor.js Research mode demonstrates (for PI):** fix-priority chip; target-keyword assign/change/track; content gaps; recommendations; Create brief / Add schema / View traffic; AI-assist copy generation; on-page score box; read-only manual-URL variant. Omits: bulk analyze, secondary keywords, intent-confidence/difficulty display, local visibility, fix-queue list.

## Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Category model | Keep HEAD's 5 `CheckCategory` values, restyle as category cards without per-category scores | 6-category model (index/onpage/perf/schema/links/mobile) w/ server-side category mapping + per-category scoring | Quick win diverges visually from prototype; full version is a data ticket (client HealthTab + CSV export + suppressions all key on `check`/`category`) |
| Issue-first pivot | Keep page-first list restyled with DS components | Issue-type-first rows with affected-pages expansion (audit.js model) | Quick win misses the prototype's core triage improvement; full version must re-map suppressions/filters/batch actions onto issue-type grouping |
| Book-level Site Health (sitehealth.js) | Read-only matrix computed from each workspace's latest snapshot (existing `/api/reports/:siteId/latest`) | Cross-workspace aggregation store + "batch fix N issues across M clients" background job | Quick win's N-per-workspace fetch is slow at book scale; full version needs new job infra + write-safety review (bulk Webflow writes across clients) |
| CWV in audit | Keep CwvSummaryCard (dual strategy) inside Site Audit | Single field-data strip in audit + full dual-strategy detail in Performance with cross-link | Quick win double-homes CWV (drift risk); full version must keep the audit CSV/HTML export CWV rows working |
| Dead links | Keep DeadLinkPanel inline w/ deep-link to Links | Slim summary in audit; redirect creation + CSV move wholly into Links Redirects tab | Quick win duplicates redirect UI in two homes; full version must pass the specific broken URL through the deep-link (two-halves contract) |
| PI → Editor Research merge | Mount existing PI detail panel (analysis section + hand-offs) inside an Editor drawer | Full master-detail Research mode per editor.js, incl. keyword assign, AI assist writing into live fields | Quick win ships two visual languages in one surface; full version risks dropping P5/P10/P13 if built strictly to the mockup |
| History | Restyle AuditHistory + ScoreTrendChart | Add snapshot diff "View" (mockup implies snapshot inspection) + keep action items | Quick win fine; full needs a snapshot-detail view HEAD only has via public report page |

## Open questions (stop-and-ask — owner sign-off required)

1. **Which three screens does "Site Audit 3→1" merge?** Reading A: seo-audit + Performance-triage + Links-triage absorbed as categories (audit.js:1-7) with Performance/Links remaining as workshops. Reading B: redistribution of SeoAudit's three sub-tools (Audit / Content Health / AEO). Both are half-true; the merge ticket scope depends on the answer.
2. **Category taxonomy migration:** HEAD `CheckCategory` = content/technical/social/performance/accessibility (audit/types.ts:8) vs mockup CATS = index/onpage/perf/schema/links/mobile (audit.js:251-258). Server mapping or UI-only regrouping? Client HealthTab, CSV export, and suppression keys all touch it.
3. **Scheduled-audit config home:** audit.js:654 stubs Schedule as a toast "(Settings panel)". Where does the real form (interval, score-drop threshold, enable/disable — ScheduledAuditSettings.tsx + `/api/audit-schedules`) live?
4. **Snapshot Action Items + batch add-to-tasks:** both absent from the prototype (ActionItemsPanel.tsx; AuditBatchActions.tsx:89-119). Keep in Site Audit, fold into Requests/Inbox, or retire deliberately?
5. **Severity filter + search:** mockup has severity *sort* but no severity *filter* and no search box (HEAD: SeoAudit.tsx:79,524-526; AuditFilters.tsx:42-51). Confirm both are added to the rebuilt toolbar (additive) rather than dropped.
6. **Secondary keywords editing** (usePageIntelligenceKeywordEditing.ts:40-43 writes `secondaryKeywords` to pageMap): editor.js Research shows only one target keyword. Where do secondaries live — Editor Research, Keywords drawer, or retired?
7. **Bulk page analysis** (cancellable background job, usePageIntelligenceAnalysis.ts:27-52): Research mode is one-page-at-a-time. Does bulk analyze get a home (Editor toolbar? Keywords?) or is it deliberately cut?
8. **Page-scoped local visibility** (LocalSeoVisibilityPanel mode="page" + per-keyword badges, PageIntelligence.tsx:272-276): confirm Keywords' local rank lenses / Local Presence fully replace the page-scoped read, or add it to Editor Research.
9. **Guides:** SeoAuditGuide + PageIntelligenceGuide have no prototype home (Schema kept a Workflow Guide per the Parity Ledger). Pattern decision: guides per surface, one help center, or cut?
10. **sitehealth.js book-level roll-up + cross-client batch fix** is new functionality with no HEAD backend (no cross-workspace audit aggregation, no cross-client bulk-fix job). Sign off scope + sequencing (read-only matrix first?).
11. **Audit boundary:** Page Intelligence lands in SEO Editor (another auditor's surface). This ledger enumerates it (assignment named it); confirm the SEO Editor surface ticket adopts rows P1–P18 as acceptance criteria so nothing falls between the two tickets.
12. **`?sub=content-decay` senders** (ContentPipeline.tsx:220; WorkspaceHome.tsx:241,547) must be retargeted in the same change that moves Content Health to Pipeline — flagging so the deep-link two-halves contract isn't broken mid-migration.
