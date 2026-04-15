# Deep Diagnostics Pre-Plan Audit

**Date:** 2026-04-12
**Spec:** `docs/superpowers/specs/2026-04-12-deep-diagnostics-design.md`
**Total verifications:** 22 functions, types, and patterns checked

## Verification Results

### Functions — All Confirmed

| Function | File | Signature Match | Notes |
|----------|------|----------------|-------|
| `getPageTrend()` | `server/search-console.ts:375` | **Params differ** | Needs `siteId`, `gscSiteUrl`, `pageUrl`, `days=90` — spec updated to note credential resolution |
| `getQueryPageData()` | `server/search-console.ts:192` | **Returns site-wide** | Needs `siteId`, `gscSiteUrl`, `days=90`, `opts?` — orchestrator must filter for affected pages |
| `getSearchPeriodComparison()` | `server/search-console.ts:551` | ✓ Match | Needs `siteId`, `gscSiteUrl`, `days=28` |
| `getCachedArchitecture()` | `server/site-architecture.ts:275` | **Tree only** | Returns `SiteNode` tree (parent-child hierarchy), NOT `<a>` link counts — spec updated with new probe module |
| `getBacklinksOverview()` | `server/semrush.ts:703` | ✓ Match | Takes `domain` string + `workspaceId` — domain-level only as expected |
| `getTopReferringDomains()` | `server/semrush.ts:773` | **Field name** | Returns `backlinksCount` not `backlinks` — spec fixed |
| `scanRedirects()` | `server/redirect-scanner.ts:210` | **Already probes** | Does live HTTP fetch with `redirect: 'manual'` — spec updated to avoid duplicate probe |
| `getGA4LandingPages()` | `server/google-analytics.ts:514` | ✓ Match | Needs `propertyId` — supports `organicOnly` filter |
| `getGA4TopPages()` | `server/google-analytics.ts:208` | ✓ Match | Needs `propertyId` |
| `callOpenAI()` | `server/openai-helpers.ts` | ✓ Match | Standard AI dispatch |
| `broadcastToWorkspace()` | `server/broadcast.ts:31` | ✓ Match | `(workspaceId, event, data) => void` |
| `parseJsonFallback()` | `server/db/json-validation.ts:90` | ✓ Match | `<T>(raw, fallback: T) => T` |
| `createStmtCache()` | `server/db/stmt-cache.ts:13` | ✓ Match | `<T>(build: () => T) => () => T` |

### Types — All Confirmed & Extensible

| Type | File | Extensible | Notes |
|------|------|-----------|-------|
| `AnomalyDigestData` | `shared/types/analytics.ts:334` | ✓ | Can add optional `diagnosticReportId` field |
| `InsightType` union | `shared/types/analytics.ts:189` | ✓ | `anomaly_digest` is a member |
| `InsightDataMap` | `shared/types/analytics.ts:386` | ✓ | Maps `anomaly_digest` → `AnomalyDigestData` |
| `FeatureFlagKey` | `shared/types/feature-flags.ts` | ✓ | Derived via `keyof typeof FEATURE_FLAGS` — add entry to const |
| `Page` union | `src/routes.ts` | ✓ | Simple string union — add `'diagnostics'` |

### Infrastructure — All Confirmed

| Pattern | File | Status | Notes |
|---------|------|--------|-------|
| Jobs system | `server/jobs.ts` | ✓ Match | `createJob`, `updateJob`, `getJob` all exist with expected signatures |
| Job types | `server/routes/jobs.ts` | ✓ Extensible | Switch statement — add `'deep-diagnostic'` case |
| `WS_EVENTS` | `server/ws-events.ts` | ✓ Extensible | Const object + `keyof typeof` pattern — add `DIAGNOSTIC_COMPLETE` |
| `useWorkspaceEvents` | `src/hooks/useWorkspaceEvents.ts` | ✓ Match | `(workspaceId, handlers: Record<string, EventHandler>)` |
| `InsightsDigest` | `src/components/client/InsightsDigest.tsx` | ✓ Has mapping | `anomaly_digest` → Shield icon, "View analytics" → performance tab |
| Migration numbering | `server/db/migrations/` | ✓ | Latest is `056-brand-identity-unique.sql` — next is `057` |

## Issues Found & Fixed in Spec

### 1. Internal Link Counting Gap (CRITICAL)

**Problem:** Spec assumed `getCachedArchitecture()` provides internal link counts to a page. It actually returns a tree of parent-child relationships (site hierarchy), not which pages contain `<a>` links to the target.

**Fix:** Added internal link counting to the new probe module (`diagnostic-probe.ts`). The probe fetches top-20 pages by traffic and counts `<a href>` elements pointing to each affected URL. This gives the actual link count that made the copilot article diagnosis possible.

### 2. Redundant Redirect Probing (MODERATE)

**Problem:** Spec proposed a new HTTP probe for redirect chains, but `scanRedirects()` already does live HTTP probing with `redirect: 'manual'`.

**Fix:** Narrowed `diagnostic-probe.ts` scope to canonical tag extraction + internal link counting only. Redirect chains use existing `scanRedirects()`.

### 3. Missing Credential Resolution Step (MODERATE)

**Problem:** Spec didn't mention that GSC, GA4, and SEMRush functions require workspace-specific credentials (`siteId`, `gscSiteUrl`, `propertyId`, `domain`).

**Fix:** Added "Credential Resolution" section to spec. Orchestrator resolves credentials from workspace config first. Missing integrations are skipped gracefully with `{ available: false, reason: 'not_configured' }`.

### 4. Field Name Mismatch (MINOR)

**Problem:** `ReferringDomain` type uses `backlinksCount`, spec used `backlinks`.

**Fix:** Updated `DiagnosticContext.backlinks.topDomains` to use `backlinksCount`.

### 5. Site-Wide Query Data (MINOR)

**Problem:** `getQueryPageData()` returns ALL query-page combinations site-wide, not filtered per page.

**Fix:** Added note that orchestrator must filter results for affected page(s).

## Existing Coverage

- **Redirect scanning:** Full live HTTP probing exists via `scanRedirects()`
- **Backlink data:** Domain-level via SEMRush — no per-URL gaps for diagnostic purposes
- **Position history:** 90-day daily via `getPageTrend()` — sufficient for cliff detection
- **Period comparison:** Built-in via `getSearchPeriodComparison()`
- **Site architecture:** Tree structure via `getCachedArchitecture()` — supplements link counting
- **Audit issues:** Available through intelligence assembler's `PageProfileSlice`
- **Jobs system:** Fully functional async pattern with polling
- **WebSocket broadcasts:** Standard pattern for real-time UI updates

## Infrastructure Recommendations

### 1. Prevention: pr-check rule

Add a rule to `scripts/pr-check.ts` ensuring new diagnostic modules export a typed `ModuleResult` interface — prevents untyped data from reaching the AI synthesis step.

### 2. Testing

- Integration test for the orchestrator: mock all data sources, verify `DiagnosticContext` assembly
- Integration test for the jobs flow: POST → poll → verify report stored
- Unit test for the HTTP probe: mock `fetch`, verify redirect chain parsing + canonical extraction + internal link counting
- Unit test for credential resolution: verify graceful skip when integration not configured

### 3. Rate Limiting

The diagnostic triggers multiple API calls (GSC, GA4, SEMRush, HTTP probes). Should use the existing `aiLimiter` on the job endpoint to prevent abuse, and implement per-workspace concurrency limits (max 1 diagnostic running per workspace).

## Parallelization Strategy

### Phase 0 — Shared Contracts (sequential, must commit before any parallel work)

1. `shared/types/diagnostics.ts` — all type definitions
2. `shared/types/feature-flags.ts` — add `'deep-diagnostics': false`
3. `shared/types/analytics.ts` — add `diagnosticReportId?: string` to `AnomalyDigestData`
4. `server/db/migrations/057-diagnostic-reports.sql` — table creation
5. `server/ws-events.ts` — add `DIAGNOSTIC_COMPLETE` event
6. `src/routes.ts` — add `'diagnostics'` to `Page` union

### Phase 1 — Backend Core (parallel, 3 agents)

**Agent 1: Store + Probe** (Sonnet)
- `server/diagnostic-store.ts` — CRUD, row mapper, stmt cache
- `server/diagnostic-probe.ts` — canonical extraction + internal link counting
- Owns: these 2 files exclusively

**Agent 2: Orchestrator + AI Synthesis** (Sonnet)
- `server/diagnostic-orchestrator.ts` — module router, parallel data gathering, context assembly, AI prompt + synthesis
- Owns: this 1 file exclusively

**Agent 3: Job Handler + Routes** (Sonnet)
- `server/routes/jobs.ts` — add `deep-diagnostic` case
- New diagnostic API routes (list + detail endpoints)
- Owns: route files only

### Phase 2 — Frontend (parallel, 2 agents)

**Agent 4: Report Page** (Sonnet)
- `src/components/admin/DiagnosticReport/DiagnosticReportPage.tsx`
- `src/components/admin/DiagnosticReport/RootCauseCard.tsx`
- `src/components/admin/DiagnosticReport/RemediationPlan.tsx`
- `src/components/admin/DiagnosticReport/EvidenceAccordion.tsx`
- Owns: `DiagnosticReport/` directory exclusively

**Agent 5: Hooks + Insight Card Enhancement** (Sonnet)
- `src/hooks/admin/useDiagnostics.ts` — React Query hooks
- Anomaly insight card modifications (conditional CTA)
- Client `InsightsDigest` narrative enrichment
- Owns: hook file + insight card modifications

### Phase 3 — Integration + Verification (sequential, Opus)

- Wire workspace events handler
- End-to-end smoke test
- Typecheck + build + pr-check

## Model Assignments

| Task Type | Recommended Model | Reasoning |
|-----------|------------------|-----------|
| Shared contracts (types, migration, flag) | Haiku | Mechanical — copy from spec |
| Store module (CRUD, stmt cache, mapper) | Sonnet | Follows established patterns, needs consistency |
| HTTP probe (fetch, HTML parsing) | Sonnet | Logic required for redirect/canonical/link parsing |
| Orchestrator (data gathering, context assembly) | Sonnet | Needs to read multiple module interfaces correctly |
| AI synthesis prompt | Opus | Prompt engineering requires judgment |
| Job handler + routes | Sonnet | Follows established pattern |
| React components | Sonnet | UI layout with existing primitives |
| Hooks | Sonnet | React Query patterns |
| Integration wiring + verification | Opus | Full-context judgment for correctness |
