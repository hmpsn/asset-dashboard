# Deep Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an anomaly insight fires, let the admin trigger a structured diagnostic investigation that gathers data from existing infrastructure, probes affected URLs, and uses AI to produce root cause analysis + remediation actions.

**Architecture:** Thin orchestration layer over existing data sources (GSC, GA4, SEMRush, redirect scanner, site architecture) + a new canonical/link probe + single GPT-4.1 synthesis call. Results stored in `diagnostic_reports` table, surfaced as admin report page + client narrative enrichment.

**Tech Stack:** Express routes, SQLite (better-sqlite3), React 19 + React Query, GPT-4.1 via `callOpenAI()`, existing integrations (GSC, GA4, SEMRush, Webflow).

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-12-deep-diagnostics-design.md`
- [x] Pre-plan audit complete: `docs/superpowers/audits/2026-04-12-deep-diagnostics-audit.md`

---

## Task Dependencies

```
Sequential (must run in order):
  Task 1 (Shared Contracts) → Task 2+ (all other tasks)

Parallel after Task 1:
  Task 2 (Store)  ∥  Task 3 (Probe)

Sequential after Tasks 2+3:
  Task 4 (Orchestrator — imports store + probe)

Sequential after Task 4:
  Task 5 (Job Handler + API Routes — imports orchestrator)

Sequential after Task 5:
  Task 7 (Hooks + Insight Card CTA) — hooks must exist before Task 6 imports them

Sequential after Task 7:
  Task 6 (Report Page UI — imports hooks from Task 7)

Sequential after Task 6:
  Task 8 (Integration Wiring + Client Narrative + Verification)
```

---

### Task 1 — Shared Contracts (Model: haiku)

**Owns:**
- `shared/types/diagnostics.ts` (create)
- `shared/types/feature-flags.ts` (modify)
- `shared/types/analytics.ts` (modify)
- `server/db/migrations/057-diagnostic-reports.sql` (create)
- `server/ws-events.ts` (modify)
- `src/routes.ts` (modify)

**Must not touch:** All other files.

- [ ] **Step 1: Create `shared/types/diagnostics.ts`**

```typescript
// ── Deep Diagnostics types ──────────────────────────────────────────

export type DiagnosticStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DiagnosticReport {
  id: string;
  workspaceId: string;
  insightId: string | null;
  anomalyType: string;
  affectedPages: string[];
  status: DiagnosticStatus;
  diagnosticContext: DiagnosticContext;
  rootCauses: RootCause[];
  remediationActions: RemediationAction[];
  adminReport: string;
  clientSummary: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RootCause {
  rank: number;
  title: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  evidence: string[];
}

export interface RemediationAction {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'high' | 'medium' | 'low';
  owner: 'dev' | 'content' | 'seo';
  pageUrls?: string[];
}

export interface DiagnosticContext {
  anomaly: {
    type: string;
    severity: string;
    metric: string;
    currentValue: number;
    expectedValue: number;
    deviationPercent: number;
    firstDetected: string;
  };
  positionHistory: PositionHistoryPoint[];
  queryBreakdown: QueryBreakdownEntry[];
  redirectProbe: RedirectProbeResult;
  internalLinks: InternalLinksResult;
  backlinks: BacklinksResult;
  siteBaselines: SiteBaselines;
  recentActivity: ActivityEntry[];
  concurrentAnomalies: ConcurrentAnomaly[];
  existingInsights: ExistingInsightSummary[];
  periodComparison: PeriodComparisonResult;
  /** Data sources that were unavailable (integration not configured) */
  unavailableSources: { source: string; reason: string }[];
}

export interface PositionHistoryPoint {
  date: string;
  position: number;
  clicks: number;
  impressions: number;
}

export interface QueryBreakdownEntry {
  query: string;
  currentClicks: number;
  previousClicks: number;
  currentPosition: number;
  previousPosition: number;
  impressionChange: number;
}

export interface RedirectProbeResult {
  chain: { url: string; status: number; location: string | null }[];
  finalStatus: number;
  canonical: string | null;
  isSoftFourOhFour: boolean;
}

export interface InternalLinksResult {
  count: number;
  siteMedian: number;
  topLinkingPages: string[];
  deficit: number;
}

export interface BacklinksResult {
  totalBacklinks: number;
  referringDomains: number;
  topDomains: { domain: string; backlinksCount: number }[];
  /** Best-effort — SEMRush domain-level API may not expose per-URL lost links */
  recentlyLost: number;
}

export interface SiteBaselines {
  avgInternalLinks: number;
  medianPosition: number;
  avgBacklinks: number;
}

export interface ActivityEntry {
  date: string;
  action: string;
  details: string;
}

export interface ConcurrentAnomaly {
  type: string;
  page: string;
  severity: string;
}

export interface ExistingInsightSummary {
  type: string;
  severity: string;
  summary: string;
}

export interface PeriodComparisonResult {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

/** Input to the orchestrator — passed from the job handler */
export interface DiagnosticRequest {
  workspaceId: string;
  insightId: string;
  reportId: string;
}
```

- [ ] **Step 2: Add feature flag to `shared/types/feature-flags.ts`**

Add inside the `FEATURE_FLAGS` const, after the last existing entry (before `} as const;`):

```typescript
  // Deep Diagnostics
  'deep-diagnostics': false,
```

- [ ] **Step 3: Add `diagnosticReportId` to `AnomalyDigestData` in `shared/types/analytics.ts`**

Find the `AnomalyDigestData` interface (line ~334) and add the optional field:

```typescript
export interface AnomalyDigestData {
  anomalyType: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviationPercent: number;
  durationDays: number;
  firstDetected: string;
  severity: string;
  /** Set when a deep diagnostic has been run for this anomaly */
  diagnosticReportId?: string;
}
```

- [ ] **Step 4: Add `DIAGNOSTIC_COMPLETE` to `server/ws-events.ts`**

Add inside the `WS_EVENTS` const, after `BRAND_IDENTITY_UPDATED`:

```typescript
  // Deep Diagnostics
  DIAGNOSTIC_COMPLETE: 'diagnostic:complete',
```

- [ ] **Step 5: Create migration `server/db/migrations/057-diagnostic-reports.sql`**

```sql
-- Deep Diagnostics — stores investigation reports triggered by admin from anomaly insights
CREATE TABLE IF NOT EXISTS diagnostic_reports (
  id                   TEXT NOT NULL PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  insight_id           TEXT,
  anomaly_type         TEXT NOT NULL,
  affected_pages       TEXT NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','running','completed','failed')),
  diagnostic_context   TEXT NOT NULL DEFAULT '{}',
  root_causes          TEXT NOT NULL DEFAULT '[]',
  remediation_actions  TEXT NOT NULL DEFAULT '[]',
  admin_report         TEXT NOT NULL DEFAULT '',
  client_summary       TEXT NOT NULL DEFAULT '',
  error_message        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at         TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_workspace
  ON diagnostic_reports(workspace_id, created_at DESC);
```

- [ ] **Step 6: Add `'diagnostics'` to `Page` union in `src/routes.ts`**

Find the `Page` type and add `'diagnostics'` after `'outcomes-overview'`:

```typescript
  | 'outcomes-overview'
  | 'diagnostics';
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — new types compile, no existing code broken.

- [ ] **Step 8: Commit shared contracts**

```bash
git add shared/types/diagnostics.ts shared/types/feature-flags.ts shared/types/analytics.ts server/db/migrations/057-diagnostic-reports.sql server/ws-events.ts src/routes.ts
git commit -m "feat(deep-diagnostics): add shared contracts — types, migration, feature flag, WS event, route"
```

---

### Task 2 — Diagnostic Store (Model: sonnet)

**Owns:**
- `server/diagnostic-store.ts` (create)

**Must not touch:** `shared/types/diagnostics.ts` (owned by Task 1, already committed), all other files.

**Conventions:** Use `createStmtCache()` for prepared statements. Use `parseJsonFallback()` for JSON columns. Row interface uses snake_case, API interface uses camelCase. Use `randomUUID()` for IDs. Follow `analytics-insights-store.ts` patterns.

- [ ] **Step 1: Create `server/diagnostic-store.ts`**

```typescript
/**
 * Diagnostic Reports store — CRUD for deep diagnostic investigation reports.
 * Follows the analytics-insights-store pattern: stmt cache, row mapper, typed CRUD.
 */

import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { DiagnosticReport, DiagnosticStatus, DiagnosticContext, RootCause, RemediationAction } from '../shared/types/diagnostics.js';

// ── Row interface (SQLite shape) ────────────────────────────────────

interface DiagnosticReportRow {
  id: string;
  workspace_id: string;
  insight_id: string | null;
  anomaly_type: string;
  affected_pages: string;
  status: string;
  diagnostic_context: string;
  root_causes: string;
  remediation_actions: string;
  admin_report: string;
  client_summary: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── Stmt cache ──────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO diagnostic_reports (id, workspace_id, insight_id, anomaly_type, affected_pages, status)
    VALUES (@id, @workspace_id, @insight_id, @anomaly_type, @affected_pages, @status)
  `),
  getById: db.prepare(`SELECT * FROM diagnostic_reports WHERE id = ?`),
  listByWorkspace: db.prepare(`
    SELECT * FROM diagnostic_reports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50
  `),
  updateStatus: db.prepare(`
    UPDATE diagnostic_reports SET status = @status, error_message = @error_message WHERE id = @id
  `),
  updateCompleted: db.prepare(`
    UPDATE diagnostic_reports
    SET status = 'completed',
        diagnostic_context = @diagnostic_context,
        root_causes = @root_causes,
        remediation_actions = @remediation_actions,
        admin_report = @admin_report,
        client_summary = @client_summary,
        completed_at = datetime('now')
    WHERE id = @id
  `),
  deleteByWorkspace: db.prepare(`DELETE FROM diagnostic_reports WHERE workspace_id = ?`),
  getByInsightId: db.prepare(`
    SELECT * FROM diagnostic_reports WHERE workspace_id = ? AND insight_id = ? ORDER BY created_at DESC LIMIT 1
  `),
}));

// ── Row mapper ──────────────────────────────────────────────────────

function rowToReport(row: DiagnosticReportRow): DiagnosticReport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    insightId: row.insight_id,
    anomalyType: row.anomaly_type,
    affectedPages: parseJsonFallback<string[]>(row.affected_pages, []),
    status: row.status as DiagnosticStatus,
    diagnosticContext: parseJsonFallback<DiagnosticContext>(row.diagnostic_context, {} as DiagnosticContext),
    rootCauses: parseJsonFallback<RootCause[]>(row.root_causes, []),
    remediationActions: parseJsonFallback<RemediationAction[]>(row.remediation_actions, []),
    adminReport: row.admin_report,
    clientSummary: row.client_summary,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function createDiagnosticReport(
  workspaceId: string,
  insightId: string,
  anomalyType: string,
  affectedPages: string[],
): DiagnosticReport {
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    insight_id: insightId,
    anomaly_type: anomalyType,
    affected_pages: JSON.stringify(affectedPages),
    status: 'running',
  });
  return getDiagnosticReport(id)!;
}

export function getDiagnosticReport(id: string): DiagnosticReport | null {
  const row = stmts().getById.get(id) as DiagnosticReportRow | undefined;
  return row ? rowToReport(row) : null;
}

export function listDiagnosticReports(workspaceId: string): DiagnosticReport[] {
  const rows = stmts().listByWorkspace.all(workspaceId) as DiagnosticReportRow[];
  return rows.map(rowToReport);
}

export function getReportForInsight(workspaceId: string, insightId: string): DiagnosticReport | null {
  const row = stmts().getByInsightId.get(workspaceId, insightId) as DiagnosticReportRow | undefined;
  return row ? rowToReport(row) : null;
}

export function markDiagnosticFailed(id: string, errorMessage: string): void {
  stmts().updateStatus.run({ id, status: 'failed', error_message: errorMessage });
}

export function completeDiagnosticReport(
  id: string,
  result: {
    diagnosticContext: DiagnosticContext;
    rootCauses: RootCause[];
    remediationActions: RemediationAction[];
    adminReport: string;
    clientSummary: string;
  },
): DiagnosticReport | null {
  stmts().updateCompleted.run({
    id,
    diagnostic_context: JSON.stringify(result.diagnosticContext),
    root_causes: JSON.stringify(result.rootCauses),
    remediation_actions: JSON.stringify(result.remediationActions),
    admin_report: result.adminReport,
    client_summary: result.clientSummary,
  });
  return getDiagnosticReport(id);
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/diagnostic-store.ts
git commit -m "feat(deep-diagnostics): add diagnostic store — CRUD, row mapper, stmt cache"
```

---

### Task 3 — Diagnostic Probe (Model: sonnet)

**Owns:**
- `server/diagnostic-probe.ts` (create)

**Must not touch:** All other files.

**Purpose:** Two things `scanRedirects()` doesn't do: (1) canonical tag extraction, (2) internal link counting by crawling top pages and counting `<a href>` references to the target URL.

- [ ] **Step 1: Create `server/diagnostic-probe.ts`**

```typescript
/**
 * Diagnostic Probe — canonical tag extraction + internal link counting.
 *
 * Redirect chain detection is handled by the existing scanRedirects() in redirect-scanner.ts.
 * This module covers the two things scanRedirects() doesn't:
 * 1. Parse <link rel="canonical"> from target page
 * 2. Crawl top pages to count <a href> references to the target URL
 */

import { createLogger } from './logger.js';
import type { InternalLinksResult } from '../shared/types/diagnostics.js';

const log = createLogger('diagnostic-probe');

const PROBE_TIMEOUT_MS = 10_000;
const MAX_PAGES_TO_CRAWL = 20;

// ── Canonical Probe ─────────────────────────────────────────────────

export interface CanonicalProbeResult {
  canonical: string | null;
  selfReferencing: boolean;
  statusCode: number;
  error: string | null;
}

/**
 * Fetch a URL and extract the <link rel="canonical"> tag from the HTML head.
 * Returns null canonical if the page can't be reached or has no canonical tag.
 */
export async function probeCanonical(url: string): Promise<CanonicalProbeResult> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'User-Agent': 'hmpsn-diagnostic-probe/1.0' },
    });

    const html = await res.text();
    const canonical = extractCanonical(html);
    const normalizedUrl = normalizeUrl(url);
    const normalizedCanonical = canonical ? normalizeUrl(canonical) : null;

    return {
      canonical,
      selfReferencing: normalizedCanonical === normalizedUrl,
      statusCode: res.status,
      error: null,
    };
  } catch (err) {
    log.warn({ err, url }, 'Canonical probe failed');
    return { canonical: null, selfReferencing: false, statusCode: 0, error: (err as Error).message };
  }
}

function extractCanonical(html: string): string | null {
  // Match <link rel="canonical" href="..."> in any attribute order
  const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return match?.[1] ?? null;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url.replace(/\/$/, '');
  }
}

// ── Internal Link Counter ───────────────────────────────────────────

/**
 * Crawl a set of pages and count how many contain <a href> links to the target URL.
 * Returns the count, the linking pages, and the deficit vs site median.
 *
 * @param targetPath - The path of the page we're investigating (e.g., "/blog/copilot-article")
 * @param pagesToCrawl - Full URLs of pages to check for links (top pages by traffic)
 * @param liveDomain - The live domain (e.g., "https://www.faros.ai")
 */
export async function countInternalLinks(
  targetPath: string,
  pagesToCrawl: string[],
  liveDomain: string,
): Promise<InternalLinksResult> {
  const pages = pagesToCrawl.slice(0, MAX_PAGES_TO_CRAWL);
  const linkingPages: string[] = [];
  const allLinkCounts: number[] = [];

  const results = await Promise.allSettled(
    pages.map(async (pageUrl) => {
      try {
        const res = await fetch(pageUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          headers: { 'User-Agent': 'hmpsn-diagnostic-probe/1.0' },
        });
        const html = await res.text();
        const { linksToTarget, totalInternalLinks } = countLinksInPage(html, targetPath, liveDomain);
        allLinkCounts.push(totalInternalLinks);
        if (linksToTarget > 0) {
          linkingPages.push(pageUrl);
        }
      } catch (err) {
        log.debug({ err, pageUrl }, 'Failed to crawl page for link counting');
      }
    }),
  );

  const count = linkingPages.length;
  const siteMedian = computeMedian(allLinkCounts);
  const deficit = Math.max(0, siteMedian - count);

  log.info({ targetPath, count, siteMedian, deficit, crawled: pages.length }, 'Internal link count complete');

  return { count, siteMedian, topLinkingPages: linkingPages, deficit };
}

function countLinksInPage(
  html: string,
  targetPath: string,
  liveDomain: string,
): { linksToTarget: number; totalInternalLinks: number } {
  // Match all <a href="..."> tags
  const hrefRegex = /<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let linksToTarget = 0;
  let totalInternalLinks = 0;
  const normalizedTarget = targetPath.replace(/\/$/, '');

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // Check if internal link (relative path or same domain)
    if (href.startsWith('/') || href.startsWith(liveDomain)) {
      totalInternalLinks++;
      const path = href.startsWith('/') ? href : new URL(href).pathname;
      if (path.replace(/\/$/, '') === normalizedTarget) {
        linksToTarget++;
      }
    }
  }

  return { linksToTarget, totalInternalLinks };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/diagnostic-probe.ts
git commit -m "feat(deep-diagnostics): add diagnostic probe — canonical extraction + internal link counter"
```

---

### Task 4 — Diagnostic Orchestrator (Model: opus)

**Owns:**
- `server/diagnostic-orchestrator.ts` (create)

**Must not touch:** `server/diagnostic-store.ts` (Task 2), `server/diagnostic-probe.ts` (Task 3), shared types (Task 1).

**May read/import from:** `server/search-console.ts`, `server/google-analytics.ts`, `server/semrush.ts`, `server/redirect-scanner.ts`, `server/site-architecture.ts`, `server/workspace-intelligence.ts`, `server/workspaces.ts`, `server/activity-log.ts`, `server/anomaly-detection.ts`, `server/analytics-insights-store.ts`, `server/openai-helpers.ts`, `server/diagnostic-store.ts`, `server/diagnostic-probe.ts`.

**Key conventions:**
- GSC functions need `siteId` (= workspace `webflowSiteId`) + `gscSiteUrl` (= workspace `gscPropertyUrl`)
- GA4 functions need `propertyId` (= workspace `ga4PropertyId`)
- SEMRush functions need `domain` (= workspace `liveDomain`, cleaned via `cleanDomainForSemrush()`)
- Use `callOpenAI()` for AI synthesis — analytical task, not creative prose
- `getWorkspace(workspaceId)` returns workspace with credential fields

- [ ] **Step 1: Create `server/diagnostic-orchestrator.ts`**

This is the largest file. It contains:
1. Module router (anomaly type → data source list)
2. Credential resolution
3. Parallel data gathering from existing sources
4. AI synthesis prompt
5. Report completion

```typescript
/**
 * Diagnostic Orchestrator — gathers data from existing infrastructure,
 * probes affected URLs, and synthesizes findings via AI into a diagnostic report.
 *
 * This is a thin orchestration layer, not a new data platform.
 * All data comes from existing modules: GSC, GA4, SEMRush, redirect-scanner,
 * site-architecture, workspace-intelligence, plus the new diagnostic-probe.
 */

import { createLogger } from './logger.js';
import { getWorkspace } from './workspaces.js';
import { getPageTrend, getQueryPageData, getSearchPeriodComparison } from './search-console.js';
import { getGA4LandingPages } from './google-analytics.js';
import { getBacklinksOverview, getTopReferringDomains } from './semrush.js';
import { scanRedirects } from './redirect-scanner.js';
import { getCachedArchitecture } from './site-architecture.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { getInsights } from './analytics-insights-store.js';
import db from './db/index.js';
import { callOpenAI } from './openai-helpers.js';
import { probeCanonical, countInternalLinks } from './diagnostic-probe.js';
import {
  completeDiagnosticReport,
  markDiagnosticFailed,
  getDiagnosticReport,
} from './diagnostic-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { updateJob } from './jobs.js';
import type {
  DiagnosticContext,
  DiagnosticRequest,
  RootCause,
  RemediationAction,
  PositionHistoryPoint,
  QueryBreakdownEntry,
  RedirectProbeResult,
  InternalLinksResult,
  BacklinksResult,
  SiteBaselines,
  ActivityEntry,
  ConcurrentAnomaly,
  ExistingInsightSummary,
  PeriodComparisonResult,
} from '../shared/types/diagnostics.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../shared/types/analytics.js';

const log = createLogger('diagnostic-orchestrator');

// ── Module Router ───────────────────────────────────────────────────

type DataModule =
  | 'positionHistory'
  | 'queryBreakdown'
  | 'periodComparison'
  | 'redirects'
  | 'canonical'
  | 'internalLinks'
  | 'backlinks'
  | 'ga4';

const MODULE_ROUTER: Record<string, DataModule[]> = {
  traffic_drop: ['positionHistory', 'queryBreakdown', 'periodComparison', 'redirects', 'canonical', 'internalLinks', 'backlinks', 'ga4'],
  impressions_drop: ['positionHistory', 'periodComparison', 'redirects', 'canonical'],
  position_decline: ['positionHistory', 'internalLinks', 'backlinks'],
  ctr_drop: ['positionHistory', 'periodComparison'],
  bounce_spike: ['redirects', 'periodComparison'],
  audit_score_drop: ['redirects', 'canonical', 'internalLinks'],
  conversion_drop: ['periodComparison', 'redirects'],
};

// ── Credential Resolution ───────────────────────────────────────────

interface ResolvedCredentials {
  siteId: string | null;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  liveDomain: string | null;
}

function resolveCredentials(workspaceId: string): ResolvedCredentials {
  const ws = getWorkspace(workspaceId);
  return {
    siteId: ws?.webflowSiteId ?? null,
    gscSiteUrl: ws?.gscPropertyUrl ?? null,
    ga4PropertyId: ws?.ga4PropertyId ?? null,
    liveDomain: ws?.liveDomain ?? null,
  };
}

// ── Main Orchestrator ───────────────────────────────────────────────

export async function runDiagnostic(request: DiagnosticRequest, jobId: string): Promise<void> {
  const { workspaceId, insightId, reportId } = request;

  try {
    // 1. Resolve the anomaly insight to get anomaly data + affected pages
    const insights = getInsights(workspaceId);
    const anomalyInsight = insights.find((i) => i.id === insightId);
    if (!anomalyInsight) {
      markDiagnosticFailed(reportId, 'Anomaly insight not found');
      updateJob(jobId, { status: 'error', message: 'Anomaly insight not found' });
      return;
    }

    const anomalyData = anomalyInsight.data as AnomalyDigestData;
    const anomalyType = anomalyData.anomalyType;
    const affectedPagePath = anomalyInsight.pageId;

    // 2. Resolve credentials
    const creds = resolveCredentials(workspaceId);
    const modules = MODULE_ROUTER[anomalyType] ?? MODULE_ROUTER.traffic_drop;

    updateJob(jobId, { status: 'running', message: 'Gathering diagnostic data...' });

    // 3. Gather data in parallel
    const context = await gatherDiagnosticContext(
      workspaceId,
      anomalyInsight,
      anomalyData,
      affectedPagePath,
      creds,
      modules,
      jobId,
    );

    // 4. AI synthesis
    updateJob(jobId, { status: 'running', message: 'Analyzing findings...' });
    const synthesis = await synthesizeFindings(context, anomalyType);

    // 5. Save completed report
    const report = completeDiagnosticReport(reportId, {
      diagnosticContext: context,
      rootCauses: synthesis.rootCauses,
      remediationActions: synthesis.remediationActions,
      adminReport: synthesis.adminReport,
      clientSummary: synthesis.clientSummary,
    });

    // 6. Stamp the anomaly insight with the reportId so client narrative enrichment picks it up
    try {
      const insight = getInsights(workspaceId).find((i) => i.id === insightId);
      if (insight) {
        const updatedData = { ...(insight.data as AnomalyDigestData), diagnosticReportId: reportId };
        db.prepare('UPDATE analytics_insights SET data = ? WHERE id = ?').run(JSON.stringify(updatedData), insightId);
      }
    } catch (stampErr) {
      log.warn({ err: stampErr }, 'Failed to stamp diagnosticReportId on insight — non-fatal');
    }

    // 7. Update job, broadcast, log activity
    updateJob(jobId, { status: 'done', message: 'Diagnostic complete', result: { reportId } });
    broadcastToWorkspace(workspaceId, WS_EVENTS.DIAGNOSTIC_COMPLETE, { reportId, insightId });
    addActivity(workspaceId, 'diagnostic_completed', `Deep diagnostic completed`,
      `Found ${synthesis.rootCauses.length} root cause(s), ${synthesis.remediationActions.length} remediation action(s)`);

    log.info({ workspaceId, reportId, rootCauses: synthesis.rootCauses.length }, 'Diagnostic completed');
  } catch (err) {
    log.error({ err, workspaceId, reportId }, 'Diagnostic orchestrator failed');
    markDiagnosticFailed(reportId, (err as Error).message);
    updateJob(jobId, { status: 'error', message: `Diagnostic failed: ${(err as Error).message}` });
  }
}

// ── Data Gathering ──────────────────────────────────────────────────

async function gatherDiagnosticContext(
  workspaceId: string,
  insight: AnalyticsInsight,
  anomalyData: AnomalyDigestData,
  affectedPagePath: string | null,
  creds: ResolvedCredentials,
  modules: DataModule[],
  jobId: string,
): Promise<DiagnosticContext> {
  const unavailableSources: { source: string; reason: string }[] = [];
  const hasGsc = !!(creds.siteId && creds.gscSiteUrl);
  const hasGa4 = !!creds.ga4PropertyId;
  const hasDomain = !!creds.liveDomain;

  // Run all data modules in parallel
  const [
    positionHistory,
    queryBreakdown,
    periodComparison,
    redirectProbe,
    canonicalResult,
    internalLinks,
    backlinks,
    intelligence,
  ] = await Promise.all([
    // Position history
    modules.includes('positionHistory') && hasGsc && affectedPagePath
      ? getPageTrend(creds.siteId!, creds.gscSiteUrl!, affectedPagePath, 90).catch((e) => {
          log.warn({ err: e }, 'Position history fetch failed');
          unavailableSources.push({ source: 'positionHistory', reason: e.message });
          return [] as PositionHistoryPoint[];
        })
      : ((!hasGsc && modules.includes('positionHistory'))
          ? (unavailableSources.push({ source: 'positionHistory', reason: 'GSC not configured' }), Promise.resolve([]))
          : Promise.resolve([])),

    // Query breakdown (site-wide, filtered to affected page below)
    modules.includes('queryBreakdown') && hasGsc
      ? getQueryPageData(creds.siteId!, creds.gscSiteUrl!, 90, { maxRows: 500 }).catch((e) => {
          log.warn({ err: e }, 'Query breakdown fetch failed');
          unavailableSources.push({ source: 'queryBreakdown', reason: e.message });
          return [];
        })
      : ((!hasGsc && modules.includes('queryBreakdown'))
          ? (unavailableSources.push({ source: 'queryBreakdown', reason: 'GSC not configured' }), Promise.resolve([]))
          : Promise.resolve([])),

    // Period comparison
    modules.includes('periodComparison') && hasGsc
      ? getSearchPeriodComparison(creds.siteId!, creds.gscSiteUrl!, 28).catch((e) => {
          log.warn({ err: e }, 'Period comparison fetch failed');
          unavailableSources.push({ source: 'periodComparison', reason: e.message });
          return null;
        })
      : ((!hasGsc && modules.includes('periodComparison'))
          ? (unavailableSources.push({ source: 'periodComparison', reason: 'GSC not configured' }), Promise.resolve(null))
          : Promise.resolve(null)),

    // Redirect scan
    modules.includes('redirects') && creds.siteId
      ? scanRedirects(creds.siteId, workspaceId, creds.liveDomain ?? undefined).catch((e) => {
          log.warn({ err: e }, 'Redirect scan failed');
          unavailableSources.push({ source: 'redirects', reason: e.message });
          return null;
        })
      : Promise.resolve(null),

    // Canonical probe
    modules.includes('canonical') && affectedPagePath && hasDomain
      ? probeCanonical(`${creds.liveDomain}${affectedPagePath}`).catch((e) => {
          log.warn({ err: e }, 'Canonical probe failed');
          unavailableSources.push({ source: 'canonical', reason: e.message });
          return null;
        })
      : Promise.resolve(null),

    // Internal link counting
    modules.includes('internalLinks') && affectedPagePath && hasDomain && hasGsc
      ? (async () => {
          try {
            // Get top pages by traffic to use as crawl targets
            const topPages = await getGA4LandingPages(creds.ga4PropertyId ?? '', 28, 20).catch(() => []);
            const crawlUrls = topPages.length > 0
              ? topPages.map((p) => `${creds.liveDomain}${p.landingPage}`)
              : []; // Fallback: no pages to crawl
            if (crawlUrls.length === 0) return { count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 };
            return countInternalLinks(affectedPagePath, crawlUrls, creds.liveDomain!);
          } catch (e) {
            log.warn({ err: e }, 'Internal link counting failed');
            unavailableSources.push({ source: 'internalLinks', reason: (e as Error).message });
            return { count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 };
          }
        })()
      : Promise.resolve({ count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 }),

    // Backlinks
    modules.includes('backlinks') && hasDomain
      ? (async () => {
          try {
            const [overview, domains] = await Promise.all([
              getBacklinksOverview(creds.liveDomain!, workspaceId),
              getTopReferringDomains(creds.liveDomain!, workspaceId, 20),
            ]);
            return {
              totalBacklinks: overview?.totalBacklinks ?? 0,
              referringDomains: overview?.referringDomains ?? 0,
              topDomains: domains.map((d) => ({ domain: d.domain, backlinksCount: d.backlinksCount })),
              recentlyLost: 0, // SEMRush domain-level API doesn't expose this
            } as BacklinksResult;
          } catch (e) {
            log.warn({ err: e }, 'Backlinks fetch failed');
            unavailableSources.push({ source: 'backlinks', reason: (e as Error).message });
            return { totalBacklinks: 0, referringDomains: 0, topDomains: [], recentlyLost: 0 };
          }
        })()
      : Promise.resolve({ totalBacklinks: 0, referringDomains: 0, topDomains: [], recentlyLost: 0 }),

    // Intelligence (for existing insights + baselines)
    buildWorkspaceIntelligence(workspaceId, { pagePath: affectedPagePath ?? undefined }).catch((e) => {
      log.warn({ err: e }, 'Intelligence assembly failed');
      return null;
    }),
  ]);

  // Filter query breakdown to affected page
  const filteredQueries: QueryBreakdownEntry[] = affectedPagePath
    ? (queryBreakdown as Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>)
        .filter((q) => q.page?.includes(affectedPagePath))
        .slice(0, 30)
        .map((q) => ({
          query: q.query,
          currentClicks: q.clicks,
          previousClicks: 0, // single-period data
          currentPosition: q.position,
          previousPosition: 0,
          impressionChange: 0,
        }))
    : [];

  // Build redirect probe result from scan
  const redirectResult: RedirectProbeResult = (() => {
    if (!redirectProbe || !affectedPagePath) return { chain: [], finalStatus: 200, canonical: canonicalResult?.canonical ?? null, isSoftFourOhFour: false };
    const affectedChain = (redirectProbe as { chains: Array<{ originalUrl: string; hops: Array<{ url: string; statusCode: number; location: string | null }>; finalUrl: string }> }).chains
      ?.find((c) => c.originalUrl?.includes(affectedPagePath));
    if (!affectedChain) return { chain: [], finalStatus: 200, canonical: canonicalResult?.canonical ?? null, isSoftFourOhFour: false };
    const lastHop = affectedChain.hops?.[affectedChain.hops.length - 1];
    const isSoftFourOhFour = affectedChain.finalUrl === '/' || affectedChain.finalUrl?.endsWith('.com/') || affectedChain.finalUrl?.endsWith('.com');
    return {
      chain: affectedChain.hops?.map((h) => ({ url: h.url, status: h.statusCode, location: h.location })) ?? [],
      finalStatus: lastHop?.statusCode ?? 200,
      canonical: canonicalResult?.canonical ?? null,
      isSoftFourOhFour,
    };
  })();

  // Extract site baselines from intelligence
  const siteBaselines: SiteBaselines = {
    avgInternalLinks: (internalLinks as InternalLinksResult).siteMedian,
    medianPosition: intelligence?.seoContext?.rankTracking?.avgPosition ?? 0,
    avgBacklinks: (backlinks as BacklinksResult).totalBacklinks,
  };

  // Recent activity from intelligence
  const recentActivity: ActivityEntry[] = (intelligence?.operational?.recentActivity ?? [])
    .slice(0, 20)
    .map((a: { date?: string; createdAt?: string; type?: string; action?: string; title?: string; description?: string; details?: string }) => ({
      date: a.date ?? a.createdAt ?? '',
      action: a.type ?? a.action ?? '',
      details: a.title ?? a.description ?? a.details ?? '',
    }));

  // Concurrent anomalies from intelligence
  const allInsights = getInsights(workspaceId);
  const concurrentAnomalies: ConcurrentAnomaly[] = allInsights
    .filter((i) => i.insightType === 'anomaly_digest' && i.id !== insight.id)
    .slice(0, 10)
    .map((i) => ({
      type: (i.data as AnomalyDigestData).anomalyType ?? 'unknown',
      page: i.pageId ?? 'site-level',
      severity: i.severity,
    }));

  // Existing insights for affected page
  const existingInsights: ExistingInsightSummary[] = allInsights
    .filter((i) => i.pageId === affectedPagePath && i.insightType !== 'anomaly_digest')
    .slice(0, 10)
    .map((i) => ({
      type: i.insightType,
      severity: i.severity,
      summary: i.pageTitle ?? i.insightType,
    }));

  // Period comparison
  const periodCompResult: PeriodComparisonResult = periodComparison
    ? {
        current: (periodComparison as { current: { clicks: number; impressions: number; ctr: number; position: number } }).current,
        previous: (periodComparison as { previous: { clicks: number; impressions: number; ctr: number; position: number } }).previous,
        changePercent: (periodComparison as { changePercent: { clicks: number; impressions: number; ctr: number; position: number } }).changePercent,
      }
    : { current: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, previous: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, changePercent: { clicks: 0, impressions: 0, ctr: 0, position: 0 } };

  return {
    anomaly: {
      type: anomalyData.anomalyType,
      severity: anomalyData.severity,
      metric: anomalyData.metric,
      currentValue: anomalyData.currentValue,
      expectedValue: anomalyData.expectedValue,
      deviationPercent: anomalyData.deviationPercent,
      firstDetected: anomalyData.firstDetected,
    },
    positionHistory: (positionHistory as PositionHistoryPoint[]).slice(-90),
    queryBreakdown: filteredQueries,
    redirectProbe: redirectResult,
    internalLinks: internalLinks as InternalLinksResult,
    backlinks: backlinks as BacklinksResult,
    siteBaselines,
    recentActivity,
    concurrentAnomalies,
    existingInsights,
    periodComparison: periodCompResult,
    unavailableSources,
  };
}

// ── AI Synthesis ────────────────────────────────────────────────────

interface SynthesisResult {
  rootCauses: RootCause[];
  remediationActions: RemediationAction[];
  adminReport: string;
  clientSummary: string;
}

async function synthesizeFindings(context: DiagnosticContext, anomalyType: string): Promise<SynthesisResult> {
  const systemPrompt = `You are an expert SEO diagnostician. You are given structured data from a deep investigation into why a website page experienced a significant anomaly (${anomalyType}). Your job is to:

1. Identify the most likely root causes, ranked by confidence
2. Propose specific remediation actions with priorities (P0 = ship this week, P1 = this sprint, P2 = backlog, P3 = nice to have)
3. Write a technical admin report in markdown
4. Write a semi-technical client summary (2-3 sentences, no dev jargon)

Respond with ONLY valid JSON matching this exact schema:
{
  "rootCauses": [{ "rank": 1, "title": "string", "confidence": "high|medium|low", "explanation": "string", "evidence": ["string"] }],
  "remediationActions": [{ "priority": "P0|P1|P2|P3", "title": "string", "description": "string", "effort": "low|medium|high", "impact": "high|medium|low", "owner": "dev|content|seo", "pageUrls": ["string"] }],
  "adminReport": "markdown string with sections: ## Executive Summary, ## Root Causes, ## Evidence, ## Remediation Plan",
  "clientSummary": "2-3 sentence semi-technical summary. Explain what happened, why, and what is being done. No redirect codes, no dev jargon. Frame as: your team identified the issue and is fixing it."
}

Rules for root causes:
- Use the evidence from ALL data sources — position history, query breakdown, redirect chains, internal links, backlinks, recent activity
- Compare page data against site baselines to spot anomalies
- Look for temporal correlation between recent activity and the anomaly's first detected date
- If concurrent anomalies exist, check for patterns (same URL path prefix, same anomaly type)
- High confidence = multiple evidence sources converge on the same cause
- If data is unavailable for a source, note it but don't let it prevent a diagnosis

Rules for remediation:
- Each action must have exactly one owner: dev, content, or seo
- P0 actions should be things that can be done in < 1 day
- Include specific page URLs when relevant
- Order by priority then impact`;

  const result = await callOpenAI({
    model: 'gpt-4.1',
    systemPrompt,
    userPrompt: JSON.stringify(context),
    maxTokens: 3000,
    temperature: 0.3,
    responseFormat: 'json',
  });

  try {
    const parsed = JSON.parse(result) as SynthesisResult;
    // Validate structure
    if (!Array.isArray(parsed.rootCauses) || !Array.isArray(parsed.remediationActions)) {
      throw new Error('Invalid synthesis structure');
    }
    return parsed;
  } catch (err) {
    log.error({ err, result: result.slice(0, 200) }, 'Failed to parse AI synthesis');
    return {
      rootCauses: [{ rank: 1, title: 'Analysis inconclusive', confidence: 'low', explanation: 'The AI synthesis failed to produce structured output. Manual investigation recommended.', evidence: [] }],
      remediationActions: [],
      adminReport: '## Analysis Inconclusive\n\nThe AI synthesis step failed. Please review the raw diagnostic context for manual analysis.',
      clientSummary: 'We detected a significant change in your site performance and are investigating. Your team will follow up with specific findings.',
    };
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. Note: some imported functions may need type adjustments at integration time — the `callOpenAI` signature may differ slightly. Check `server/openai-helpers.ts` for the exact interface and adjust the call accordingly.

- [ ] **Step 3: Commit**

```bash
git add server/diagnostic-orchestrator.ts
git commit -m "feat(deep-diagnostics): add orchestrator — module router, data gathering, AI synthesis"
```

---

### Task 5 — Job Handler + API Routes + API Client (Model: sonnet)

**Owns:**
- `server/routes/jobs.ts` (modify — add `deep-diagnostic` case)
- `server/routes/diagnostics.ts` (create)
- `src/api/diagnostics.ts` (create)
- `src/api/index.ts` (modify — add export)

**Must not touch:** `server/diagnostic-orchestrator.ts` (Task 4), `server/diagnostic-store.ts` (Task 2), shared types (Task 1).

**Conventions:** Check `hasActiveJob()` before creating a new job. Use `isFeatureEnabled('deep-diagnostics')` to gate endpoints. Literal routes before param routes in Express. Use `requireWorkspaceAccess` middleware. Use `validate()` with Zod for request validation.

- [ ] **Step 1: Add `deep-diagnostic` job case to `server/routes/jobs.ts`**

Add a new case inside the `switch (type)` block (after the last existing case, before the `default:`):

```typescript
      case 'deep-diagnostic': {
        const workspaceId = params.workspaceId as string;
        const insightId = params.insightId as string;
        if (!workspaceId || !insightId) return res.status(400).json({ error: 'workspaceId and insightId required' });

        if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Deep diagnostics feature not enabled' });

        const activeJob = hasActiveJob('deep-diagnostic', workspaceId);
        if (activeJob) return res.status(409).json({ error: 'A diagnostic is already running for this workspace', jobId: activeJob.id });

        // Get anomaly data to determine affected pages
        const anomalyInsight = getInsights(workspaceId).find((i: AnalyticsInsight) => i.id === insightId);
        if (!anomalyInsight) return res.status(404).json({ error: 'Anomaly insight not found' });

        const anomalyData = anomalyInsight.data as AnomalyDigestData;
        const affectedPages = anomalyInsight.pageId ? [anomalyInsight.pageId] : [];

        // Create report + job
        const report = createDiagnosticReport(workspaceId, insightId, anomalyData.anomalyType, affectedPages);
        const job = createJob('deep-diagnostic', { message: 'Starting deep diagnostic...', workspaceId });
        res.json({ jobId: job.id, reportId: report.id });

        // Fire and forget
        (async () => {
          try {
            await runDiagnostic({ workspaceId, insightId, reportId: report.id }, job.id);
          } catch (err) {
            jobLog.error({ err }, 'Deep diagnostic failed');
            markDiagnosticFailed(report.id, (err as Error).message);
            updateJob(job.id, { status: 'error', message: 'Deep diagnostic failed' });
          }
        })();
        break;
      }
```

Add the necessary imports at the top of the file:

```typescript
import { isFeatureEnabled } from '../feature-flags.js';
import { getInsights } from '../analytics-insights-store.js';
import { createDiagnosticReport, markDiagnosticFailed } from '../diagnostic-store.js';
import { runDiagnostic } from '../diagnostic-orchestrator.js';
import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
```

- [ ] **Step 2: Create `server/routes/diagnostics.ts`**

```typescript
/**
 * Diagnostic report routes — list and detail endpoints.
 * The job creation endpoint is in jobs.ts (POST /api/jobs with type 'deep-diagnostic').
 */

import { Router } from 'express';
import { requireWorkspaceAccess } from '../middleware/workspace-access.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { listDiagnosticReports, getDiagnosticReport, getReportForInsight } from '../diagnostic-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:diagnostics');
const router = Router();

// List diagnostic reports for a workspace
router.get('/api/workspaces/:workspaceId/diagnostics', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Feature not enabled' });
  const reports = listDiagnosticReports(req.params.workspaceId);
  res.json({ reports });
});

// Get a specific diagnostic report
router.get('/api/workspaces/:workspaceId/diagnostics/:reportId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Feature not enabled' });
  const report = getDiagnosticReport(req.params.reportId);
  if (!report || report.workspaceId !== req.params.workspaceId) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.json({ report });
});

// Get diagnostic report for a specific insight (used by insight card to check state)
router.get('/api/workspaces/:workspaceId/diagnostics/by-insight/:insightId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.json({ report: null });
  const report = getReportForInsight(req.params.workspaceId, req.params.insightId);
  res.json({ report });
});

export default router;
```

- [ ] **Step 3: Register diagnostics routes in `server/app.ts`**

Add the import and registration. Find where other route modules are imported and `app.use()`'d:

```typescript
import diagnosticsRoutes from './routes/diagnostics.js';
```

And register it (before any catch-all or param routes):

```typescript
app.use(diagnosticsRoutes);
```

- [ ] **Step 4: Create `src/api/diagnostics.ts`**

```typescript
import { get, post } from './client.js';
import type { DiagnosticReport } from '../../shared/types/diagnostics.js';

export const diagnostics = {
  list: (workspaceId: string) =>
    get<{ reports: DiagnosticReport[] }>(`/api/workspaces/${workspaceId}/diagnostics`),

  get: (workspaceId: string, reportId: string) =>
    get<{ report: DiagnosticReport }>(`/api/workspaces/${workspaceId}/diagnostics/${reportId}`),

  getForInsight: (workspaceId: string, insightId: string) =>
    get<{ report: DiagnosticReport | null }>(`/api/workspaces/${workspaceId}/diagnostics/by-insight/${insightId}`),

  run: (workspaceId: string, insightId: string) =>
    post<{ jobId: string; reportId: string }>('/api/jobs', { type: 'deep-diagnostic', params: { workspaceId, insightId } }),
};
```

- [ ] **Step 5: Export from `src/api/index.ts`**

Add the export:

```typescript
export { diagnostics } from './diagnostics.js';
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/jobs.ts server/routes/diagnostics.ts server/app.ts src/api/diagnostics.ts src/api/index.ts
git commit -m "feat(deep-diagnostics): add job handler, API routes, and frontend API client"
```

---

### Task 6 — Admin Report Page UI (Model: sonnet)

**Owns:**
- `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx` (create)
- `src/components/admin/DiagnosticReport/RootCauseCard.tsx` (create)
- `src/components/admin/DiagnosticReport/RemediationPlan.tsx` (create)
- `src/components/admin/DiagnosticReport/EvidenceAccordion.tsx` (create)

**Must not touch:** `src/App.tsx` (Task 8), `src/components/layout/Sidebar.tsx` (Task 8), `src/hooks/` (Task 7).

**Conventions:** Use UI primitives (`SectionCard`, `StatCard`, `Badge`, `PageHeader`, `Skeleton`, `EmptyState`). Follow Three Laws of Color. Follow MeetingBriefPage component structure. No purple.

- [ ] **Step 1: Create `src/components/admin/DiagnosticReport/RootCauseCard.tsx`**

```tsx
import { SectionCard } from '../../ui/SectionCard.js';
import { Badge } from '../../ui/Badge.js';
import type { RootCause } from '../../../../shared/types/diagnostics.js';

const CONFIDENCE_COLORS = {
  high: 'bg-emerald-500/10 text-emerald-400',
  medium: 'bg-amber-500/10 text-amber-400',
  low: 'bg-zinc-500/10 text-zinc-400',
} as const;

interface Props {
  cause: RootCause;
}

export function RootCauseCard({ cause }: Props) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">#{cause.rank}</span>
          <h3 className="text-sm font-semibold text-zinc-100">{cause.title}</h3>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${CONFIDENCE_COLORS[cause.confidence]}`}>
          {cause.confidence}
        </span>
      </div>
      <p className="text-sm text-zinc-400 mb-3">{cause.explanation}</p>
      {cause.evidence.length > 0 && (
        <ul className="space-y-1">
          {cause.evidence.map((e, i) => (
            <li key={i} className="text-xs text-zinc-500 flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">-</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: Create `src/components/admin/DiagnosticReport/RemediationPlan.tsx`**

```tsx
import { SectionCard } from '../../ui/SectionCard.js';
import type { RemediationAction } from '../../../../shared/types/diagnostics.js';

const PRIORITY_COLORS = {
  P0: 'bg-red-500/10 text-red-400',
  P1: 'bg-amber-500/10 text-amber-400',
  P2: 'bg-blue-500/10 text-blue-400',
  P3: 'bg-zinc-500/10 text-zinc-400',
} as const;

const EFFORT_LABELS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' } as const;
const IMPACT_LABELS = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' } as const;
const OWNER_LABELS = { dev: 'Dev', content: 'Content', seo: 'SEO' } as const;

interface Props {
  actions: RemediationAction[];
}

export function RemediationPlan({ actions }: Props) {
  const sorted = [...actions].sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return order[a.priority] - order[b.priority];
  });

  return (
    <div className="space-y-2">
      {sorted.map((action, i) => (
        <SectionCard key={i}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLORS[action.priority]}`}>
                {action.priority}
              </span>
              <h4 className="text-sm font-medium text-zinc-200">{action.title}</h4>
            </div>
            <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">
              {OWNER_LABELS[action.owner]}
            </span>
          </div>
          <p className="text-sm text-zinc-400 mb-2">{action.description}</p>
          <div className="flex gap-3 text-xs text-zinc-500">
            <span>{EFFORT_LABELS[action.effort]}</span>
            <span className="text-zinc-700">|</span>
            <span>{IMPACT_LABELS[action.impact]}</span>
          </div>
          {action.pageUrls && action.pageUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {action.pageUrls.map((url) => (
                <span key={url} className="text-xs bg-zinc-800/50 text-blue-400 px-2 py-0.5 rounded font-mono truncate max-w-[200px]">
                  {url}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/admin/DiagnosticReport/EvidenceAccordion.tsx`**

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SectionCard } from '../../ui/SectionCard.js';
import type { DiagnosticContext } from '../../../../shared/types/diagnostics.js';

interface Props {
  context: DiagnosticContext;
}

interface AccordionSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionSection({ title, children, defaultOpen = false }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full py-3 px-1 text-left text-sm font-medium text-zinc-300 hover:text-zinc-100">
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
        {title}
      </button>
      {open && <div className="pb-4 px-1">{children}</div>}
    </div>
  );
}

export function EvidenceAccordion({ context }: Props) {
  return (
    <SectionCard>
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Raw Evidence</h3>

      {context.positionHistory.length > 0 && (
        <AccordionSection title={`Position History (${context.positionHistory.length} days)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1 pr-4">Date</th>
                <th className="text-right py-1 pr-4">Position</th>
                <th className="text-right py-1 pr-4">Clicks</th>
                <th className="text-right py-1">Impressions</th>
              </tr></thead>
              <tbody>
                {context.positionHistory.slice(-30).map((p) => (
                  <tr key={p.date} className="text-zinc-400 border-b border-zinc-900">
                    <td className="py-1 pr-4 font-mono">{p.date}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{p.position.toFixed(1)}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{p.clicks}</td>
                    <td className="text-right py-1 text-blue-400">{p.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      )}

      {context.queryBreakdown.length > 0 && (
        <AccordionSection title={`Query Breakdown (${context.queryBreakdown.length} queries)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1 pr-4">Query</th>
                <th className="text-right py-1 pr-4">Clicks</th>
                <th className="text-right py-1">Position</th>
              </tr></thead>
              <tbody>
                {context.queryBreakdown.map((q) => (
                  <tr key={q.query} className="text-zinc-400 border-b border-zinc-900">
                    <td className="py-1 pr-4 font-mono truncate max-w-[200px]">{q.query}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{q.currentClicks}</td>
                    <td className="text-right py-1 text-blue-400">{q.currentPosition.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      )}

      {context.redirectProbe.chain.length > 0 && (
        <AccordionSection title={`Redirect Chain (${context.redirectProbe.chain.length} hops)`}>
          <div className="space-y-1">
            {context.redirectProbe.chain.map((hop, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-mono px-1.5 py-0.5 rounded ${hop.status === 301 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  {hop.status}
                </span>
                <span className="text-zinc-400 font-mono truncate">{hop.url}</span>
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.internalLinks.count > 0 && (
        <AccordionSection title={`Internal Links (${context.internalLinks.count} found, median: ${context.internalLinks.siteMedian})`}>
          <div className="space-y-1">
            {context.internalLinks.topLinkingPages.map((page) => (
              <div key={page} className="text-xs text-blue-400 font-mono truncate">{page}</div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.backlinks.totalBacklinks > 0 && (
        <AccordionSection title={`Backlinks (${context.backlinks.totalBacklinks} total, ${context.backlinks.referringDomains} domains)`}>
          <div className="space-y-1">
            {context.backlinks.topDomains.map((d) => (
              <div key={d.domain} className="flex justify-between text-xs">
                <span className="text-zinc-400">{d.domain}</span>
                <span className="text-blue-400">{d.backlinksCount} links</span>
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.unavailableSources.length > 0 && (
        <AccordionSection title={`Unavailable Sources (${context.unavailableSources.length})`}>
          <div className="space-y-1">
            {context.unavailableSources.map((s) => (
              <div key={s.source} className="text-xs text-zinc-500">
                <span className="font-medium">{s.source}</span>: {s.reason}
              </div>
            ))}
          </div>
        </AccordionSection>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Create `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx`**

```tsx
import { useSearchParams } from 'react-router-dom';
import { Activity, RefreshCw } from 'lucide-react';
import { SectionCard } from '../../ui/SectionCard.js';
import { StatCard } from '../../ui/StatCard.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { PageHeader } from '../../ui/PageHeader.js';
import { RootCauseCard } from './RootCauseCard.js';
import { RemediationPlan } from './RemediationPlan.js';
import { EvidenceAccordion } from './EvidenceAccordion.js';
import { useDiagnosticReport, useDiagnosticsList } from '../../../hooks/admin/useDiagnostics.js';
import type { DiagnosticReport } from '../../../../shared/types/diagnostics.js';

interface Props {
  workspaceId: string;
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

function ReportDetail({ report }: { report: DiagnosticReport }) {
  const ctx = report.diagnosticContext;
  const posChange = ctx.periodComparison.changePercent;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Deep Diagnostic: ${report.affectedPages[0] ?? report.anomalyType}`}
        subtitle={`Completed ${new Date(report.completedAt ?? report.createdAt).toLocaleDateString()}`}
        icon={Activity}
      />

      {/* At-a-Glance Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Traffic Change" value={`${posChange.clicks > 0 ? '+' : ''}${posChange.clicks.toFixed(0)}%`} />
        <StatCard label="Internal Links" value={String(ctx.internalLinks.count)} subtitle={`Site median: ${ctx.internalLinks.siteMedian}`} />
        <StatCard label="Backlinks" value={String(ctx.backlinks.totalBacklinks)} subtitle={`${ctx.backlinks.referringDomains} domains`} />
        <StatCard label="Root Causes" value={String(report.rootCauses.length)} subtitle={`${report.remediationActions.length} actions`} />
      </div>

      {/* Root Causes */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Root Causes</h2>
        <div className="space-y-2">
          {report.rootCauses.map((cause) => (
            <RootCauseCard key={cause.rank} cause={cause} />
          ))}
        </div>
      </div>

      {/* Remediation Plan */}
      {report.remediationActions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Remediation Plan</h2>
          <RemediationPlan actions={report.remediationActions} />
        </div>
      )}

      {/* Raw Evidence */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Evidence</h2>
        <EvidenceAccordion context={ctx} />
      </div>
    </div>
  );
}

export function DiagnosticReportPage({ workspaceId }: Props) {
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get('report');

  // If a specific report is requested, show detail view
  if (reportId) {
    return <DiagnosticReportDetail workspaceId={workspaceId} reportId={reportId} />;
  }

  // Otherwise show report list
  return <DiagnosticReportList workspaceId={workspaceId} />;
}

function DiagnosticReportDetail({ workspaceId, reportId }: { workspaceId: string; reportId: string }) {
  const { data, isLoading, isError } = useDiagnosticReport(workspaceId, reportId);

  if (isLoading) return <SectionCard><ReportSkeleton /></SectionCard>;
  if (isError || !data?.report) return <SectionCard><EmptyState title="Report not found" description="This diagnostic report could not be loaded." icon={Activity} /></SectionCard>;

  return <ReportDetail report={data.report} />;
}

function DiagnosticReportList({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useDiagnosticsList(workspaceId);

  if (isLoading) return <SectionCard><ReportSkeleton /></SectionCard>;

  const reports = data?.reports ?? [];
  if (reports.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          title="No diagnostics yet"
          description="Run a deep diagnostic from an anomaly insight to investigate root causes."
          icon={Activity}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Diagnostic Reports" icon={Activity} />
      {reports.map((r) => (
        <a key={r.id} href={`?report=${r.id}`} className="block">
          <SectionCard>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{r.affectedPages[0] ?? r.anomalyType}</h3>
                <p className="text-xs text-zinc-500">{r.anomalyType} - {new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : r.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {r.status}
              </span>
            </div>
          </SectionCard>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (hooks referenced here will be created in Task 7 — if importing them causes errors, add placeholder types and fix during Task 8 integration).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/DiagnosticReport/
git commit -m "feat(deep-diagnostics): add admin report page — root causes, remediation plan, evidence accordion"
```

---

### Task 7 — Hooks + Insight Card CTA + Client Narrative (Model: sonnet)

**Owns:**
- `src/hooks/admin/useDiagnostics.ts` (create)
- `src/components/insights/InsightFeedItem.tsx` (modify — add diagnostic CTA)
- `src/components/client/InsightsDigest.tsx` (modify — enrich anomaly narrative)

**Must not touch:** `src/components/admin/DiagnosticReport/` (Task 6), `src/api/diagnostics.ts` (Task 5).

**Conventions:** Use `useQuery`/`useMutation` with `queryKeys.admin.*` prefix. Follow `useAdminMeetingBrief.ts` pattern. Use `useWorkspaceEvents` for WS event handling. Use `isFeatureEnabled` on frontend for CTA gating.

- [ ] **Step 1: Create `src/hooks/admin/useDiagnostics.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics } from '../../api/index.js';
import { jobs } from '../../api/index.js';

const DIAGNOSTICS_KEYS = {
  list: (workspaceId: string) => ['admin-diagnostics', workspaceId] as const,
  detail: (workspaceId: string, reportId: string) => ['admin-diagnostics', workspaceId, reportId] as const,
  forInsight: (workspaceId: string, insightId: string) => ['admin-diagnostic-for-insight', workspaceId, insightId] as const,
};

export function useDiagnosticsList(workspaceId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.list(workspaceId),
    queryFn: () => diagnostics.list(workspaceId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}

export function useDiagnosticReport(workspaceId: string, reportId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.detail(workspaceId, reportId),
    queryFn: () => diagnostics.get(workspaceId, reportId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && !!reportId,
  });
}

export function useDiagnosticForInsight(workspaceId: string, insightId: string) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEYS.forInsight(workspaceId, insightId),
    queryFn: () => diagnostics.getForInsight(workspaceId, insightId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && !!insightId,
  });
}

export function useRunDiagnostic(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (insightId: string) => diagnostics.run(workspaceId, insightId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DIAGNOSTICS_KEYS.list(workspaceId) });
    },
  });
}
```

- [ ] **Step 2: Add diagnostic CTA to `src/components/insights/InsightFeedItem.tsx`**

This component renders insight cards in the admin feed. For `anomaly_digest` insights, add a conditional "Run Deep Diagnostic" / "View Report" CTA. Read the file first to see the current structure, then add:

After the existing expand/collapse section and before the closing `</div>` of the card, add a conditional footer for anomaly_digest insights:

```tsx
{insight.type === 'anomaly_digest' && (
  <DiagnosticCTA workspaceId={insight.workspaceId} insightId={insight.id} />
)}
```

Create the `DiagnosticCTA` inline component (can be in the same file or extracted):

```tsx
import { useDiagnosticForInsight, useRunDiagnostic } from '../../hooks/admin/useDiagnostics.js';
import { Loader2, FileSearch } from 'lucide-react';

function DiagnosticCTA({ workspaceId, insightId }: { workspaceId: string; insightId: string }) {
  const { data } = useDiagnosticForInsight(workspaceId, insightId);
  const { mutate: run, isPending } = useRunDiagnostic(workspaceId);
  const report = data?.report;

  if (report?.status === 'completed') {
    return (
      <a href={`/ws/${workspaceId}/diagnostics?report=${report.id}`}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300">
        <FileSearch className="w-3.5 h-3.5" />
        View Diagnostic Report
      </a>
    );
  }

  if (report?.status === 'running' || isPending) {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Analyzing...
      </div>
    );
  }

  if (report?.status === 'failed') {
    return (
      <button onClick={() => run(insightId)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300">
        <FileSearch className="w-3.5 h-3.5" />
        Retry Diagnostic
      </button>
    );
  }

  return (
    <button onClick={() => run(insightId)}
      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300">
      <FileSearch className="w-3.5 h-3.5" />
      Run Deep Diagnostic
    </button>
  );
}
```

- [ ] **Step 3: (Moved to Task 8)** Client narrative enrichment is wired in Task 8 alongside integration, since it requires both server-side and client-side changes.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/admin/useDiagnostics.ts src/components/insights/InsightFeedItem.tsx
git commit -m "feat(deep-diagnostics): add hooks, insight card CTA, and client narrative enrichment"
```

---

### Task 8 — Integration Wiring + Client Narrative + Verification (Model: opus)

**Owns:**
- `src/App.tsx` (modify — add diagnostics tab rendering)
- `src/components/layout/Sidebar.tsx` (modify — add diagnostics nav item)
- `server/routes/public-portal.ts` (modify — enrich anomaly narrative with diagnostic client summary)
- `src/components/client/InsightsDigest.tsx` (modify — render enriched narrative when diagnostic summary present)
- Wire WebSocket event handlers
- All verification

**Must not touch:** Files owned by Tasks 2-7 (except `InsightsDigest.tsx` which was deferred from Task 7).

- [ ] **Step 1: Add diagnostics tab to Sidebar**

In `src/components/layout/Sidebar.tsx`, find the ADMIN nav group in `buildNavGroups()` and add:

```typescript
{ id: 'diagnostics' as Page, label: 'Diagnostics', icon: Activity, desc: 'Deep diagnostic investigation reports', hidden: !isFeatureEnabled('deep-diagnostics') },
```

Import `Activity` from `lucide-react` if not already imported.

- [ ] **Step 2: Add diagnostics route to `src/App.tsx`**

Add lazy import at the top with the other lazy components:

```typescript
const DiagnosticReportPage = lazy(() => import('./components/admin/DiagnosticReport/DiagnosticReportPage.js').then(m => ({ default: m.DiagnosticReportPage })));
```

Add rendering case in `renderContent()`:

```typescript
if (tab === 'diagnostics') return <DiagnosticReportPage key={`diagnostics-${selected.id}`} workspaceId={selected.id} />;
```

- [ ] **Step 3: Add WebSocket event handler for DIAGNOSTIC_COMPLETE**

In whichever component manages workspace-scoped events (likely near the `useWorkspaceEvents` call in the admin dashboard), add:

```typescript
'diagnostic:complete': () => {
  qc.invalidateQueries({ queryKey: ['admin-diagnostics'] });
  qc.invalidateQueries({ queryKey: ['admin-diagnostic-for-insight'] });
  qc.invalidateQueries({ queryKey: ['admin-insights'] });
},
```

- [ ] **Step 4: Enrich client anomaly narrative with diagnostic summary**

In `server/routes/public-portal.ts`, find the endpoint that serves client-facing insights (likely `GET /api/public/workspace/:id` or a dedicated insights endpoint). Where `anomaly_digest` insights are serialized for the client, check if a completed diagnostic report exists and inject the `clientSummary` into the insight's narrative/impact field.

Read the file first to find the exact serialization path, then add:

```typescript
// After serializing anomaly_digest insights for client response:
import { getReportForInsight } from '../diagnostic-store.js';

// Inside the insight mapping/serialization loop for anomaly_digest type:
if (insight.insightType === 'anomaly_digest' && insight.data?.diagnosticReportId) {
  const report = getReportForInsight(workspaceId, insight.id);
  if (report?.status === 'completed' && report.clientSummary) {
    // Replace the generic narrative with the diagnostic client summary
    insight.narrative = report.clientSummary;
  }
}
```

The exact integration point depends on how the public portal serializes insights — read the file and adapt.

- [ ] **Step 5: Add tier gating for enriched client narrative**

In `src/components/client/InsightsDigest.tsx`, the enriched narrative should only show for Growth+ tier. In the `mapServerInsights()` function or where anomaly_digest cards are rendered, wrap the enriched narrative behind a tier check:

```tsx
// If the insight has an enriched narrative (from diagnostic), only show for Growth+
// The server already gates the enriched narrative to Growth+ workspaces via the
// public portal serialization. If the workspace is Free tier, the server sends
// the default generic narrative. No client-side tier check needed — the server
// handles it. Just ensure the component renders whatever narrative the server provides.
```

If the server-side gating is insufficient (i.e., the narrative is always sent regardless of tier), add the gate in the public portal serialization:

```typescript
// In public-portal.ts, only inject diagnostic summary for Growth+ workspaces
const workspace = getWorkspace(workspaceId);
const isGrowthPlus = workspace?.tier !== 'free';
if (isGrowthPlus && report?.clientSummary) {
  insight.narrative = report.clientSummary;
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors.

- [ ] **Step 7: Run build**

Run: `npx vite build`
Expected: PASS — production build succeeds.

- [ ] **Step 8: Run tests**

Run: `npx vitest run`
Expected: PASS — full test suite green (no existing tests broken).

- [ ] **Step 9: Run pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: PASS — zero violations.

- [ ] **Step 10: Update FEATURE_AUDIT.md**

Add entry for Deep Diagnostics:

```markdown
### Deep Diagnostics
- **Status:** Implemented (dark-launched behind `deep-diagnostics` flag)
- **Trigger:** Admin clicks "Run Deep Diagnostic" on anomaly_digest insight cards
- **Backend:** Orchestrator gathers data from GSC, GA4, SEMRush, redirect scanner, site architecture; canonical probe + internal link counter; GPT-4.1 synthesis
- **Admin UI:** Report detail page at `/ws/:workspaceId/diagnostics?report=:id` — root causes, remediation plan, raw evidence
- **Client UI:** Enriched anomaly narrative with diagnostic client summary (Growth+ tier)
- **Storage:** `diagnostic_reports` table, integrated with existing jobs system
```

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx src/components/client/InsightsDigest.tsx server/routes/public-portal.ts FEATURE_AUDIT.md
git commit -m "feat(deep-diagnostics): wire integration — sidebar, routing, client narrative, WS events, feature audit"
```

---

## Systemic Improvements

### Shared utilities
- `diagnostic-probe.ts` internal link counter could be reused for future link audit features
- The module router pattern (anomaly type → data sources) is extensible — new data sources can be added by modifying the `MODULE_ROUTER` map

### pr-check rules to add
- Ensure `diagnostic-orchestrator.ts` doesn't import from `@anthropic-ai/sdk` (analytical task = OpenAI, not Anthropic)
- Ensure no `purple` classes in `src/components/admin/DiagnosticReport/`

### New tests required
- Integration test: `POST /api/jobs` with `deep-diagnostic` type — verify job creation + report row creation
- Unit test: `diagnostic-probe.ts` — mock `fetch`, verify canonical extraction and internal link counting
- Unit test: `diagnostic-store.ts` — CRUD operations against test DB

---

## Verification Strategy

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — production build succeeds
- [ ] `npx vitest run` — full test suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] `grep -r "purple" src/components/admin/DiagnosticReport/` — zero matches
- [ ] `FEATURE_AUDIT.md` updated
- [ ] Manual smoke test: enable `deep-diagnostics` flag, trigger diagnostic from anomaly insight, verify report renders
