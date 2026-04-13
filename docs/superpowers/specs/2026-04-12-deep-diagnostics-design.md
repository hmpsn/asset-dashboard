# Deep Diagnostics — Design Spec

> **Date:** 2026-04-12
> **Status:** Draft
> **Feature Flag:** `deep-diagnostics`

## Problem

The platform's anomaly detection system catches symptoms — "traffic dropped 93%", "impressions declined 25%" — but doesn't diagnose root causes or produce remediation plans. Today, that investigation is done manually: a human pulls GSC data, checks redirects, counts internal links, analyzes backlinks, and synthesizes findings into a prioritized audit spreadsheet.

This feature automates that investigation. When a significant anomaly fires, the admin can trigger a structured diagnostic that leverages the platform's existing data infrastructure, adds a lightweight HTTP probe layer, and uses AI to synthesize findings into an actionable report.

## Core Concept

**Admin-initiated, not fully automatic.** Anomaly detection runs on its existing 12h cron. When an anomaly surfaces as an `anomaly_digest` insight, the admin sees a "Run Deep Diagnostic" CTA. Clicking it kicks off a structured investigation. The platform gathers data from existing sources, probes the affected URLs for live redirect/canonical status, and sends everything to an AI synthesis call that produces root causes and remediation actions.

Results surface in two places:
- **Admin:** Full technical report in a dedicated detail view (root causes, evidence, prioritized remediation plan)
- **Client (Growth+):** Semi-technical narrative enrichment on the existing anomaly insight card (what happened, why, what's being done)

---

## Architecture

### Approach: Structured Investigation + AI Synthesis

The diagnostic engine is a thin orchestration layer over existing infrastructure, not a new data platform.

**Three layers:**

1. **Data Orchestrator** — determines which existing data sources to query based on anomaly type, runs queries in parallel, packages results into a typed `DiagnosticContext`
2. **HTTP Probe** — the one genuinely new data-gathering piece: live HEAD requests to follow redirect chains and extract canonical tags for affected URLs
3. **AI Synthesis** — single GPT-4.1 call takes all packaged data → produces root cause analysis + prioritized remediation + admin report + client summary

### Why Not Agentic?

An AI agent with tool access could discover novel root causes by following threads, but at unpredictable cost and runtime. The structured approach gives bounded cost (one synthesis call), testable data gathering, and predictable report quality. The module system is extensible — new data sources can be added without changing the synthesis layer.

---

## Trigger Flow

1. Anomaly detection fires (existing 12h cron) → creates `anomaly_digest` insight as today
2. Admin sees the insight card with a **"Run Deep Diagnostic"** CTA (teal button)
3. Admin clicks → `POST /api/jobs` with type `deep-diagnostic`
4. Backend creates a `diagnostic_reports` row (status: `running`) + a job record
5. Orchestrator runs investigation modules in parallel (background)
6. Progress updates via existing jobs polling (`GET /api/jobs/:id`)
7. AI synthesis produces the report
8. `diagnostic_reports` row updated (status: `completed`), job marked `done`
9. `anomaly_digest` insight's `data` JSON gains a `diagnosticReportId` field
10. `broadcastToWorkspace()` with `DIAGNOSTIC_COMPLETE` event
11. Anomaly card in admin feed shows "View Diagnostic Report"
12. Client's insight narrative enriched with `client_summary`

---

## Data Orchestrator

### Existing Infrastructure Used

No new data collectors. The orchestrator pulls from existing sources:

| Data Need | Existing Source | Function/Module |
|---|---|---|
| Position history (90 days daily) | GSC integration | `getPageTrend()` |
| Query-level breakdown | GSC integration | `getQueryPageData()` — returns site-wide; orchestrator filters for affected page(s) |
| Period comparison | GSC integration | `getSearchPeriodComparison()` |
| Internal link structure (hierarchy) | Site architecture | `getCachedArchitecture()` — returns parent-child tree, NOT `<a>` link counts |
| Backlink profile | SEMRush integration | `getBacklinksOverview()` + `getTopReferringDomains()` |
| Redirect chains | Redirect scanner | `scanRedirects()` |
| Page audit issues, schema status | Intelligence assembler | `PageProfileSlice` |
| Site health baselines | Intelligence assembler | `SiteHealthSlice` |
| Content decay status | Content decay engine | Decay analysis data |
| GA4 engagement data | GA4 integration | `getGA4LandingPages()`, `getGA4TopPages()` |

### New: Canonical Probe + Internal Link Counter

`scanRedirects()` already does live HTTP probing for redirect chains (with `redirect: 'manual'`). The new probe module handles two things `scanRedirects()` doesn't:

1. **Canonical tag extraction** — GET request to affected URL, parse `<link rel="canonical">` from HTML head. Detect: canonical mismatches, self-referencing correctness, parameter pollution.

2. **Internal link counting** — `getCachedArchitecture()` returns a parent-child tree (site hierarchy), NOT actual `<a>` link references to a page. The probe fetches the top 20 pages by traffic and counts `<a href>` elements pointing to each affected URL. This gives the actual internal link count that made the copilot article diagnosis possible (<4 links vs site median of 10-21).

Returns: `{ canonical: string | null, selfReferencing: boolean, internalLinkCount: number, topLinkingPages: string[], siteMedianLinks: number }`

### Credential Resolution

The orchestrator must resolve workspace integration credentials before calling data sources:
- **GSC:** `siteId` + `gscSiteUrl` from workspace Google integration config
- **GA4:** `propertyId` from workspace GA4 config
- **SEMRush:** `domain` from workspace settings (cleaned via `cleanDomainForSemrush()`)

If a data source is not configured for the workspace, that module is skipped gracefully and noted in the diagnostic context as `{ available: false, reason: 'not_configured' }`.

### Module Router

Maps anomaly type to which data sources the orchestrator queries:

| Anomaly Type | Data Sources |
|---|---|
| `traffic_drop` | All sources |
| `impressions_drop` | Redirects, canonical probe, position history, traffic comparison |
| `position_decline` | Internal links, backlinks, position history |
| `ctr_drop` | Position history, traffic comparison |
| `bounce_spike` | Redirect probe (soft-404 check), traffic comparison |
| `audit_score_drop` | Redirect scan, canonical probe, internal links |
| `conversion_drop` | Traffic comparison, redirect probe |

### Affected Pages Resolution

For page-level anomalies (`traffic_drop`, `impressions_drop`, `position_decline`, `ctr_drop`, `bounce_spike`), the affected page comes from the `anomaly_digest` insight's `page_id`. For site-level anomalies (`audit_score_drop`, `conversion_drop`), the orchestrator identifies the top 5 most-impacted pages by comparing current vs previous period data and populates `affected_pages` with those. The diagnostic then runs module queries for each affected page.

### Context Enrichment

Beyond the affected page's data, the orchestrator includes:

- **Site-level baselines** — average internal link count, median position, typical backlink profile — so the AI can compare "this page vs normal"
- **Recent workspace activity** — from the operational slice: annotations, activity log, known changes — so the AI can correlate timing with events (migrations, deploys, content changes)
- **Concurrent anomaly clustering** — if multiple anomalies fired in the same timeframe, include that context. "This page dropped AND 4 others in the same URL pattern" is a stronger signal than one page in isolation.
- **Existing insights** — the intelligence engine's current insights for the affected page (decay status, strategy alignment, audit findings) so the AI doesn't rediscover what the platform already knows

### Token Budget

Cap module data to keep AI prompt under ~8K tokens input:
- Position history: last 90 days daily data
- Query breakdown: top 30 queries by impression change
- Internal links: top 20 linking pages + count + site median
- Backlinks: top 20 referring domains + totals
- Redirect chains: full chain (typically short)
- Concurrent anomalies: summary only (type + page + severity)
- Activity log: last 30 days

AI output budget: ~2K tokens.

---

## AI Synthesis

### Model

GPT-4.1 via `callOpenAI()`. This is an analytical/structured-output task, not creative prose — matches the existing AI dispatch pattern where OpenAI handles structured analysis.

### Input

The full `DiagnosticContext` as JSON, plus:
- Anomaly type and severity
- Affected page URL(s)
- Site-level baselines for comparison
- Recent workspace activity for temporal correlation
- Concurrent anomalies for pattern detection

### Output

```typescript
interface DiagnosticSynthesis {
  rootCauses: RootCause[];
  remediationActions: RemediationAction[];
  adminReport: string;
  clientSummary: string;
}
```

### Prompt Design Principles

- Provide all evidence; ask the AI to reason about root causes — don't pre-determine conclusions
- Remediation actions must include priority (P0-P3), effort (low/medium/high), impact (high/medium/low), and owner (dev/content/seo)
- Client summary: outcome-oriented, semi-technical. What happened, why, what's being done. No dev jargon, no action items, no redirect codes.
- Admin report: markdown with sections — Executive Summary, Root Causes, Evidence, Remediation Plan

---

## Data Model

### New Table: `diagnostic_reports`

```sql
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

### Typed Interfaces (`shared/types/diagnostics.ts`)

```typescript
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
  positionHistory: { date: string; position: number; clicks: number; impressions: number }[];
  queryBreakdown: { query: string; currentClicks: number; previousClicks: number; currentPosition: number; previousPosition: number; impressionChange: number }[];
  redirectProbe: {
    chain: { url: string; status: number; location: string | null }[];
    finalStatus: number;
    canonical: string | null;
    isSoftFourOhFour: boolean;
  };
  internalLinks: {
    count: number;
    siteMedian: number;
    topLinkingPages: string[];
    deficit: number;
  };
  backlinks: {
    totalBacklinks: number;
    referringDomains: number;
    topDomains: { domain: string; backlinksCount: number }[];
    recentlyLost: number;  // best-effort — SEMRush domain-level API may not expose per-URL lost links
  };
  siteBaselines: {
    avgInternalLinks: number;
    medianPosition: number;
    avgBacklinks: number;
  };
  recentActivity: { date: string; action: string; details: string }[];
  concurrentAnomalies: { type: string; page: string; severity: string }[];
  existingInsights: { type: string; severity: string; summary: string }[];
  periodComparison: {
    current: { clicks: number; impressions: number; ctr: number; position: number };
    previous: { clicks: number; impressions: number; ctr: number; position: number };
    changePercent: { clicks: number; impressions: number; ctr: number; position: number };
  };
}
```

### Row Interface & Mapper

```typescript
// In server/diagnostic-store.ts
interface DiagnosticReportRow {
  id: string;
  workspace_id: string;
  insight_id: string | null;
  anomaly_type: string;
  affected_pages: string;       // JSON string
  status: string;
  diagnostic_context: string;   // JSON string
  root_causes: string;          // JSON string
  remediation_actions: string;  // JSON string
  admin_report: string;
  client_summary: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}
```

Row mapper follows `rowToInsight()` pattern: snake_case → camelCase, JSON columns parsed via `parseJsonFallback()`.

### Relationship to Insights

When a diagnostic completes, the `anomaly_digest` insight's `data` JSON gains a `diagnosticReportId` field. The UI checks for this field to determine whether to show "Run Diagnostic" vs "View Report."

---

## Async Execution

Uses the existing jobs system (`server/jobs.ts`).

```
POST /api/jobs { type: 'deep-diagnostic', params: { workspaceId, insightId } }
  → Creates job (returns jobId) + creates diagnostic_reports row
  → Background: orchestrator gathers data → AI synthesis → saves report
  → Updates job status (running → done/error)
  → Polls: GET /api/jobs/:id

GET /api/workspaces/:workspaceId/diagnostics
  → List diagnostic reports for workspace

GET /api/workspaces/:workspaceId/diagnostics/:reportId
  → Full diagnostic report detail
```

### WebSocket Broadcast

On completion: `broadcastToWorkspace(workspaceId, 'DIAGNOSTIC_COMPLETE', { reportId, insightId })`.

Frontend handler via `useWorkspaceEvents`: invalidates `admin-diagnostics` and `admin-insights` query keys.

---

## Admin UI

### Insight Card Enhancement

The existing `anomaly_digest` insight card gains conditional rendering based on diagnostic state:

| State | Card Treatment |
|---|---|
| No diagnostic | Teal "Run Deep Diagnostic" button |
| Running | Spinner + status text (polled via jobs system) |
| Completed | Teal "View Diagnostic Report" link |
| Failed | "Diagnostic failed" with retry button |

### Report Detail View

New route: `diagnostics` added to `Page` union. URL: `/ws/:workspaceId/diagnostics?report=:reportId`.

The existing router uses `/ws/:workspaceId/:tab?` — report ID is passed as a query param, not a nested route segment. The diagnostics tab shows a report list by default; when `?report=` is present, it renders the detail view. This matches how other tabs handle sub-navigation (internal state, not nested routes).

Follows the MeetingBrief page pattern:

- **PageHeader** — "Deep Diagnostic: [page title or anomaly summary]" + timestamp + re-run button
- **At-a-Glance Strip** — 4-5 key metrics using `StatCard` / `CompactStatBar`: position change, traffic change, internal link count, backlink count, redirect status
- **Root Causes** — `SectionCard` per root cause, ranked by confidence. Each shows: title, confidence badge (high/medium/low), explanation, evidence bullets
- **Remediation Plan** — card list of actions with priority badge (P0-P3), effort/impact indicators, owner tag (dev/content/seo). Sortable by priority.
- **Raw Evidence** — collapsible accordion sections for position history chart, query breakdown table, redirect chain details, internal link list, backlink profile. Progressive disclosure.

### Color Rules

- CTAs and interactive elements: teal (Three Laws — action)
- Data metrics (position, traffic, link counts): blue (Three Laws — data)
- Priority badges: P0=red, P1=amber, P2=blue, P3=zinc
- Confidence badges: high=green, medium=amber, low=zinc
- No purple (this is data + actions, not admin AI)

---

## Client UI

No new client page. The diagnostic enriches the existing insight feed.

### Narrative Enrichment

When a diagnostic completes, the client's corresponding anomaly insight gets upgraded with the `client_summary`:

**Before:** "Traffic to your top-performing page dropped significantly this week."

**After:** "Your top-performing article lost 93% of its visibility after recent site changes. The root cause is a collapse in internal linking — the page went from a well-connected position to being nearly orphaned. Your team has identified the issue and is restoring link structure. Expected recovery: 2-4 weeks after fixes are applied."

### Implementation

- `client_summary` injected into the `anomaly_digest` insight's client-facing narrative via the existing `ClientInsight` → `InsightsDigest` rendering path
- No new component — existing card renders a richer narrative when a diagnostic is attached

### Tier Gating

- **Free:** Basic anomaly notification ("traffic dropped")
- **Growth+:** Enriched narrative with root cause and remediation status
- **Premium:** Same as Growth (full technical report stays admin-only)

---

## Feature Flag

`deep-diagnostics` added to `shared/types/feature-flags.ts`. Gates:
- The "Run Deep Diagnostic" CTA on anomaly insight cards
- The `deep-diagnostic` job type
- The `/api/workspaces/:workspaceId/diagnostics` endpoints
- The diagnostic report detail route

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `shared/types/diagnostics.ts` | `DiagnosticReport`, `RootCause`, `RemediationAction`, `DiagnosticContext`, `DiagnosticStatus` |
| `server/db/migrations/057-diagnostic-reports.sql` | Table creation |
| `server/diagnostic-store.ts` | Row interface, stmt cache, CRUD, row mapper |
| `server/diagnostic-orchestrator.ts` | Module router, parallel data gathering, context assembly, AI synthesis dispatch |
| `server/diagnostic-probe.ts` | Canonical tag extraction + internal link counting (redirect chains handled by existing `scanRedirects()`) |
| `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx` | Full report detail view |
| `src/components/admin/DiagnosticReport/RootCauseCard.tsx` | Individual root cause display |
| `src/components/admin/DiagnosticReport/RemediationPlan.tsx` | Prioritized action list |
| `src/components/admin/DiagnosticReport/EvidenceAccordion.tsx` | Collapsible raw data sections |
| `src/hooks/admin/useDiagnostics.ts` | React Query hooks for diagnostic CRUD + polling |

### Modified Files

| File | Change |
|---|---|
| `shared/types/feature-flags.ts` | Add `'deep-diagnostics': false` |
| `shared/types/analytics.ts` | Add `diagnosticReportId?: string` to `AnomalyDigestData` |
| `src/routes.ts` | Add `'diagnostics'` to `Page` union |
| `server/routes/jobs.ts` | Add `deep-diagnostic` job type handler |
| Anomaly insight card component | Conditional CTA rendering based on diagnostic state |
| Client `InsightsDigest` | Render enriched narrative when diagnostic summary present |
| `server/ws-events.ts` | Add `DIAGNOSTIC_COMPLETE` event type |

---

## What This Doesn't Do (Explicit Scope Boundaries)

- **No automatic triggering** — admin decides which anomalies warrant investigation
- **No historical position tracking beyond GSC's 90-day window** — uses existing `getPageTrend()` data
- **No per-URL backlink data** — SEMRush provides domain-level only; sufficient for diagnostic context
- **No remediation execution** — the report tells you what to fix, it doesn't fix it
- **No recurring diagnostics** — one-shot investigation per anomaly. Re-run available manually.
