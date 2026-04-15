# Platform Health Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate client-facing crash vectors, surface intelligence data as client UI, fix silent bugs, and close infrastructure gaps — all discovered via full-platform audit on 2026-04-14.

**Architecture:** 7 sequential PRs, front-loaded with client-facing safety and experience. Tasks within each PR are parallelizable where file ownership doesn't overlap. Each PR merges to `staging` before starting the next.

**Tech Stack:** React 19, Express, TypeScript strict, SQLite (better-sqlite3), Zod v3, React Query, WebSocket broadcasts, Pino logging.

**Spec:** `docs/superpowers/specs/2026-04-14-platform-health-sprint-design.md`

---

## Pre-requisites

- [ ] Spec committed: `docs/superpowers/specs/2026-04-14-platform-health-sprint-design.md`
- [ ] Platform audit completed (2026-04-14) — findings embedded in spec
- [ ] Branch created from `staging`: `feature/platform-health-pr1`

---

## Task Dependencies — Full Sprint

```
PR 1: Client-Facing Fixes & Safety
  Sequential:
    Task 1.1 (Migration collision fix)
  Parallel after 1.1:
    Task 1.2 (Public endpoint validation)  ∥  Task 1.3 (ErrorBoundary)  ∥  Task 1.4 (AI call guards)  ∥  Task 1.5 (Stripe config auth)
  Sequential after parallel batch:
    Task 1.6 (Background jobs — touches jobs.ts, ws-events.ts, app.ts)

PR 2: Client Experience Improvements
  Parallel (all independent frontend + hooks):
    Task 2.1 (compositeHealthScore)  ∥  Task 2.2 (weCalledIt)  ∥  Task 2.3 (cannibalizationWarnings)

PR 3: Bug Fixes & Correctness
  Sequential:
    Task 3.1 (PageHealthData type fix)
  Parallel after 3.1:
    Task 3.2 (Auto-resolve audit_finding)  ∥  Task 3.3 (Bridge #12)  ∥  Task 3.4 (Anomaly boost reversal)  ∥  Task 3.5 (Strategy volume threshold)

PR 4: Intelligence & Infrastructure
  Sequential:
    Task 4.4 (Barrel exports — shared/types/index.ts)
  Parallel after 4.4:
    Task 4.1 (portalUsage)  ∥  Task 4.2 (actionBacklog)  ∥  Task 4.3 (Cannibalization prompt)  ∥  Task 4.5 (Dead code)

PR 5: Infrastructure Plans
  Sequential (each modifies CI/config files):
    Task 5.1 (Pre-commit hooks) → Task 5.2 (CI coverage) → Task 5.3 (pr-check audit)

PR 6: Test & Doc Cleanup
  Parallel (all independent):
    Task 6.1 (Skipped tests)  ∥  Task 6.2 (Docs audit)  ∥  Task 6.3 (Empty state CTAs)  ∥  Task 6.4 (Client portal error feedback)  ∥  Task 6.5 (Archive shipped docs)

PR 7: Roadmap Housekeeping
  Sequential (single task):
    Task 7.1 (Mark done + consolidate)
```

---

## PR 1: Client-Facing Fixes & Safety

### Task 1.1 — Migration Collision Fix (Model: sonnet)

**Owns:**
- `server/db/migrations/035-*.sql`, `036-*.sql`, `037-*.sql` (renumbering)

**Must not touch:** Any other migration file, any server module.

**Context:** Three migration number pairs have two files each (035, 036, 037). SQLite runs migrations alphabetically within a number prefix, so the second file MAY have run. We need to verify and renumber.

- [ ] **Step 1: Check which migrations actually ran**

```bash
# Check the migrations tracking table
sqlite3 data/dashboard.db "SELECT name FROM migrations ORDER BY name;"
```

Compare against filesystem. Identify which of the 6 files have run and which haven't.

- [ ] **Step 2: Verify the tables/indexes from potentially-skipped migrations exist**

```bash
# Check schema_validations (from 035-schema-validations.sql)
sqlite3 data/dashboard.db ".schema schema_validations"

# Check llms_txt_cache (from 036-llms-txt-cache.sql)
sqlite3 data/dashboard.db ".schema llms_txt_cache"

# Check llms_txt_freshness (from 037-llms-txt-freshness.sql)
sqlite3 data/dashboard.db ".schema llms_txt_freshness"
```

- [ ] **Step 3: Renumber colliding migrations**

If a migration file hasn't run, rename it to the next available number:
```bash
# Example — adjust based on Step 1 findings:
cd server/db/migrations
mv 035-schema-validations.sql 061-schema-validations.sql
mv 036-llms-txt-cache.sql 062-llms-txt-cache.sql
mv 037-llms-txt-freshness.sql 063-llms-txt-freshness.sql
```

If both files in a pair DID run (SQLite picked them up alphabetically), leave them — the collision is cosmetic, not functional. Document the finding.

- [ ] **Step 4: Verify migration runner handles the renumbered files**

Read `server/db/migrate.ts` to confirm the migration runner uses filename-based tracking (not number parsing). Ensure the renumbered files will run on a fresh DB.

- [ ] **Step 5: Run the dev server to verify migrations apply cleanly**

```bash
npm run dev:server
# Check startup logs for migration errors
```

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/
git commit -m "fix: renumber colliding migrations 035/036/037 to 061/062/063"
```

---

### Task 1.2 — Public Endpoint Validation (Model: sonnet)

**Owns:**
- `server/routes/public-content.ts`
- Create: `server/schemas/public-content.ts`

**Must not touch:** Any other route file, shared types.

**Context:** `public-content.ts` has 17 endpoints, all client-facing, with zero `validate()` middleware. Follow the pattern in `public-portal.ts` which already uses validation. Import `validate` and `z` from `../middleware/validate.js`.

- [ ] **Step 1: Read public-content.ts to inventory all endpoints**

Read the file and list every route handler with its method, path, and expected body/params shape. Note which endpoints are GET (params-only) vs POST/PATCH/DELETE (body + params).

- [ ] **Step 2: Create Zod schemas file**

Create `server/schemas/public-content.ts`:

```typescript
import { z } from '../middleware/validate.js';

export const contentRequestSubmitSchema = z.object({
  // Match the actual req.body shape used by POST /content-request/:workspaceId/submit
  // Read the handler to determine exact fields
});

export const contentRequestDeclineSchema = z.object({
  reason: z.string().optional(),
});

export const contentRequestApproveSchema = z.object({
  // Fields from the approve handler
});

export const contentRequestChangesSchema = z.object({
  changes: z.string(),
});

export const contentRequestUpgradeSchema = z.object({
  tier: z.enum(['growth', 'premium']),
});

export const contentRequestCommentSchema = z.object({
  text: z.string().min(1),
});

export const contentRequestFromAuditSchema = z.object({
  // Fields from the from-audit handler
});

export const trackedKeywordsAddSchema = z.object({
  keywords: z.array(z.string().min(1)),
});

export const trackedKeywordsDeleteSchema = z.object({
  keywords: z.array(z.string().min(1)),
});
```

**Important:** Read each handler's `req.body` destructuring to determine exact field names and types. Do NOT guess — cross-reference the actual code. Use `.or(z.literal(''))` for clearable fields per CLAUDE.md conventions.

- [ ] **Step 3: Add validate() middleware to each mutation endpoint**

In `public-content.ts`, add the import and apply to each POST/PATCH/DELETE:

```typescript
import { validate } from '../middleware/validate.js';
import {
  contentRequestSubmitSchema,
  contentRequestDeclineSchema,
  // ... all schemas
} from '../schemas/public-content.js';

// Before:
router.post('/api/public/content-request/:workspaceId/submit', async (req, res) => { ... });

// After:
router.post('/api/public/content-request/:workspaceId/submit', validate(contentRequestSubmitSchema), async (req, res) => { ... });
```

- [ ] **Step 4: Verify typecheck passes**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/public-content.ts server/schemas/public-content.ts
git commit -m "fix: add Zod validation to all public-content mutation endpoints"
```

---

### Task 1.3 — ErrorBoundary on Page-Level Components (Model: haiku)

**Owns:**
- `src/components/PageIntelligence.tsx`
- `src/components/SeoAudit.tsx` (only the ErrorBoundary wrapping — do not modify logic)
- `src/components/AssetBrowser.tsx` (only the ErrorBoundary wrapping)
- `src/components/BrandHub.tsx` (only the ErrorBoundary wrapping)
- `src/components/Styleguide.tsx` (only the ErrorBoundary wrapping)
- `src/components/client/ClientDashboard.tsx` (only the ErrorBoundary wrapping)
- `src/components/client/ClientReports.tsx` (only the ErrorBoundary wrapping)

**Must not touch:** ErrorBoundary.tsx itself, any other component.

**Context:** `ErrorBoundary` is at `src/components/ErrorBoundary.tsx`. It accepts `children`, `fallback?`, and `label?` props. It includes a built-in retry button. Wrap the main return JSX of each component. Client portal pages are highest priority — crashes there affect paying customers.

- [ ] **Step 1: Grep for other page-level components missing ErrorBoundary**

```bash
# Find page-level components in client/ that don't import ErrorBoundary
grep -rL 'ErrorBoundary' src/components/client/ --include='*.tsx' | head -20
```

Add any additional client portal page components to the list.

- [ ] **Step 2: Add ErrorBoundary to client portal pages first**

```tsx
import { ErrorBoundary } from '../ErrorBoundary';

// In the component's return statement, wrap the outermost JSX:
return (
  <ErrorBoundary label="Client Dashboard">
    {/* existing JSX */}
  </ErrorBoundary>
);
```

Apply to `ClientDashboard.tsx` (label: "Client Dashboard") and `ClientReports.tsx` (label: "Client Reports"), plus any others found in Step 1.

- [ ] **Step 3: Add ErrorBoundary to admin pages**

Apply the same pattern to:
- `PageIntelligence.tsx` — `label="Page Intelligence"`
- `SeoAudit.tsx` — `label="SEO Audit"`
- `AssetBrowser.tsx` — `label="Asset Browser"`
- `BrandHub.tsx` — `label="Brand Hub"`
- `Styleguide.tsx` — `label="Style Guide"`

```tsx
import { ErrorBoundary } from './ErrorBoundary';

return (
  <ErrorBoundary label="Page Intelligence">
    {/* existing JSX */}
  </ErrorBoundary>
);
```

- [ ] **Step 4: Verify build passes**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/PageIntelligence.tsx src/components/SeoAudit.tsx src/components/AssetBrowser.tsx src/components/BrandHub.tsx src/components/Styleguide.tsx src/components/client/ClientDashboard.tsx src/components/client/ClientReports.tsx
git commit -m "fix: add ErrorBoundary to page-level components (admin + client portal)"
```

---

### Task 1.4 — Unguarded AI Call Wrapping (Model: sonnet)

**Owns:**
- `server/discovery-ingestion.ts`
- `server/anomaly-detection.ts`

**Must not touch:** Any other server file, AI helper modules.

**Context:** Both files call `callOpenAI()` without try-catch. Wrap each call following patterns from `server/internal-links.ts` (which does it correctly). Use `createLogger()` for error logging. Return graceful fallbacks (empty arrays, skip the operation).

- [ ] **Step 1: Read discovery-ingestion.ts and find bare callOpenAI calls**

Identify line numbers and surrounding context. Determine what the appropriate fallback is for each call (empty result object, skip, etc.).

- [ ] **Step 2: Wrap AI calls in discovery-ingestion.ts**

```typescript
import { createLogger } from './logger.js';
const log = createLogger('discovery-ingestion');

// Before:
const result = await callOpenAI({ ... });

// After:
let result;
try {
  result = await callOpenAI({ ... });
} catch (err) {
  log.error({ err }, 'AI extraction failed — skipping');
  return { extractions: [] }; // or appropriate fallback
}
```

- [ ] **Step 3: Read anomaly-detection.ts and find bare callOpenAI calls**

Same investigation.

- [ ] **Step 4: Wrap AI calls in anomaly-detection.ts**

Same pattern — try-catch with logger and graceful fallback.

- [ ] **Step 5: Verify no bare callOpenAI calls remain**

```bash
# In these two files, every callOpenAI should be inside a try block
grep -n 'callOpenAI' server/discovery-ingestion.ts server/anomaly-detection.ts
```

Manually verify each occurrence is inside a try-catch.

- [ ] **Step 6: Commit**

```bash
git add server/discovery-ingestion.ts server/anomaly-detection.ts
git commit -m "fix: guard callOpenAI with try-catch in discovery-ingestion and anomaly-detection"
```

---

### Task 1.5 — Stripe Config Endpoint Authentication (Model: sonnet)

**Owns:**
- `server/routes/stripe.ts` (auth middleware only)

**Must not touch:** Stripe business logic, webhook handlers, other routes.

**Context:** `server/routes/stripe.ts` has 4 endpoints for Stripe config management (`GET/POST/DELETE /api/stripe/config/*`) with zero auth middleware. These can read/write secret keys without authentication. Per CLAUDE.md Auth Conventions, admin routes use HMAC token (`x-auth-token`), NOT `requireAuth` (which is JWT-only).

- [ ] **Step 1: Read stripe.ts and app.ts to understand auth coverage**

Read `server/routes/stripe.ts` to identify the 4 config endpoints. Then read the global auth middleware in `server/app.ts` to check if the `APP_PASSWORD` gate already covers `/api/stripe/` routes.

- [ ] **Step 2: Add authentication to config endpoints**

If the global `APP_PASSWORD` gate in `app.ts` exempts Stripe routes (check for path exemptions):

```typescript
// Option A: If exempted from global gate, add explicit signedInOnly middleware
import { signedInOnly } from '../middleware/auth.js';

router.get('/api/stripe/config', signedInOnly, async (req, res) => { ... });
router.post('/api/stripe/config/keys', signedInOnly, async (req, res) => { ... });
router.post('/api/stripe/config/products', signedInOnly, async (req, res) => { ... });
router.delete('/api/stripe/config', signedInOnly, async (req, res) => { ... });
```

Read `app.ts` to determine the correct middleware function name. Do NOT use `requireAuth` — that's JWT-only and will break admin HMAC auth.

- [ ] **Step 3: Verify unauthenticated requests are rejected**

```bash
# Start dev server and test without auth header
curl -s http://localhost:3000/api/stripe/config | head -5
# Should return 401, not Stripe config data
```

- [ ] **Step 4: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/stripe.ts
git commit -m "fix: add authentication to Stripe config endpoints"
```

---

### Task 1.6 — Background Job Conversions (Model: opus)

**Owns:**
- `server/routes/webflow-seo.ts` (new bulk job endpoints)
- `server/ws-events.ts` (new event constants)
- `src/components/SeoEditor.tsx` (replace loops with job API calls)
- `src/components/SeoAudit.tsx` (replace loop with job API call)

**Must not touch:** `server/jobs.ts` (use existing API), `server/routes/jobs.ts`, other components.

**Context:** The existing job infrastructure (`server/jobs.ts`) provides `createJob(type, opts?)`, `updateJob()`, `getJob()`, `isJobCancelled()`. Read `server/jobs.ts` to confirm the exact `createJob` signature and opts shape before writing code. WebSocket events broadcast progress. Three frontend loops need conversion:

1. `SeoEditor.tsx` ~lines 390-397: bulk analyze (sequential `for` over pages, calls `analyzePage()`)
2. `SeoEditor.tsx` ~lines 490-504: bulk rewrite (batched with CONCURRENCY=3, calls `aiRewrite()`)
3. `SeoAudit.tsx` ~lines 332-336: accept-all (sequential `for`, calls `acceptSuggestion()`)

- [ ] **Step 1: Add WS event constants**

In `server/ws-events.ts`, add:

```typescript
// Bulk Operations
BULK_OPERATION_PROGRESS: 'bulk-operation:progress',
BULK_OPERATION_COMPLETE: 'bulk-operation:complete',
BULK_OPERATION_FAILED: 'bulk-operation:failed',
```

- [ ] **Step 2: Create bulk operation endpoints in webflow-seo.ts**

Add three new POST endpoints:

```typescript
// POST /api/seo/:workspaceId/bulk-analyze
router.post('/api/seo/:workspaceId/bulk-analyze', validate(bulkAnalyzeSchema), async (req, res) => {
  const { workspaceId } = req.params;
  const { pageIds } = req.body;
  // Note: createJob(type, opts?) — read server/jobs.ts for exact opts shape
  const job = createJob('bulk-seo-analyze', { workspaceId, pageIds });

  // Run in background
  (async () => {
    for (let i = 0; i < pageIds.length; i++) {
      if (isJobCancelled(job.id)) break;
      try {
        await analyzePage(workspaceId, pageIds[i]); // call existing logic
        updateJob(job.id, { progress: { done: i + 1, total: pageIds.length } });
        broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_PROGRESS, {
          jobId: job.id, type: 'bulk-seo-analyze', done: i + 1, total: pageIds.length,
        });
      } catch (err) {
        log.error({ err, pageId: pageIds[i] }, 'Bulk analyze failed for page');
      }
    }
    updateJob(job.id, { status: 'completed' });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_COMPLETE, {
      jobId: job.id, type: 'bulk-seo-analyze',
    });
  })().catch(err => {
    log.error({ err }, 'Bulk analyze job failed');
    updateJob(job.id, { status: 'failed', error: err.message });
    broadcastToWorkspace(workspaceId, WS_EVENTS.BULK_OPERATION_FAILED, {
      jobId: job.id, type: 'bulk-seo-analyze', error: err.message,
    });
  });

  res.json({ jobId: job.id });
});
```

Create similar endpoints for `bulk-rewrite` and `bulk-accept-fixes`. Read the existing loop code in each component to understand exactly which server function to call per iteration.

- [ ] **Step 3: Add Zod schemas for the bulk endpoints**

```typescript
const bulkAnalyzeSchema = z.object({
  pageIds: z.array(z.string()).min(1),
});

const bulkRewriteSchema = z.object({
  pageIds: z.array(z.string()).min(1),
  field: z.string(),
});

const bulkAcceptFixesSchema = z.object({
  fixes: z.array(z.object({
    pageId: z.string(),
    issue: z.string(),
  })).min(1),
});
```

- [ ] **Step 4: Update SeoEditor.tsx — replace bulk analyze loop** (file is at `src/components/SeoEditor.tsx`, NOT admin/)

Replace the `analyzeAllPages()` function. Instead of a `for` loop, call the new endpoint and listen for WebSocket progress:

```tsx
const analyzeAllPages = async () => {
  const toAnalyze = pages.filter(p => !p.analyzed);
  const res = await fetch(`/api/seo/${workspaceId}/bulk-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify({ pageIds: toAnalyze.map(p => p.id) }),
  });
  const { jobId } = await res.json();
  setBulkJobId(jobId);
  // Progress comes via WS event handler (already set up via useWorkspaceEvents)
};
```

Add a `useWorkspaceEvents` handler for `BULK_OPERATION_PROGRESS` and `BULK_OPERATION_COMPLETE` that updates the UI progress state.

- [ ] **Step 5: Update SeoEditor.tsx — replace bulk rewrite loop** (same file: `src/components/SeoEditor.tsx`)

Same pattern as Step 4 for the `bulkAiRewrite()` function.

- [ ] **Step 6: Update SeoAudit.tsx — replace accept-all loop** (file is at `src/components/SeoAudit.tsx`, NOT admin/)

Same pattern for `acceptAllSuggestions()`.

- [ ] **Step 7: Test manually**

Start dev server, trigger each bulk operation, verify:
- Job starts and returns jobId
- Progress updates arrive via WebSocket
- Navigation away doesn't cancel the operation
- Cancellation via UI works (calls `cancelJob()`)

- [ ] **Step 8: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 9: Commit**

```bash
git add server/ws-events.ts server/routes/webflow-seo.ts src/components/SeoEditor.tsx src/components/SeoAudit.tsx
git commit -m "feat: convert SEO bulk operations to server-side background jobs"
```

---

### PR 1 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

After PR 1 passes:
- `scaled-code-review` (multi-agent work, 10+ files)
- Fix any issues found
- Merge to `staging`, verify on staging deploy
- Create branch `feature/platform-health-pr2` from `staging`

---

## PR 2: Client Experience Improvements

### Task 2.1 — compositeHealthScore Dashboard (Model: opus)

**Owns:**
- Create: `src/components/admin/WorkspaceHealthBadge.tsx`
- Create: `src/components/client/HealthScoreCard.tsx`
- Modify: `src/components/WorkspaceHome.tsx` (add health badge to workspace list)
- Modify: `src/components/client/OverviewTab.tsx` (add health score card)

**Must not touch:** `server/workspace-intelligence.ts`, shared types, other admin components.

**Context:**
- `compositeHealthScore` is already assembled by `assembleClientSignals()` in `server/workspace-intelligence.ts`
- Type: `CompositeHealthScore` from `shared/types/intelligence.ts` — `{ score: number; components: { churn, roi, engagement }; computedAt: string }`
- Admin hook: `useWorkspaceIntelligence(workspaceId, ['clientSignals'])` returns data with `clientSignals.compositeHealthScore`
- Client hook: `useClientIntelligence(workspaceId)` returns intelligence data
- Use `MetricRing` from `src/components/ui/MetricRing.tsx` — props: `{ score, size?, strokeWidth?, className?, noAnimation? }`
- Colors: blue for data metrics (Three Laws). Use `scoreColor()` from `src/components/ui/constants.ts`

- [ ] **Step 1: Create WorkspaceHealthBadge.tsx for admin workspace list**

```tsx
import { MetricRingSvg } from '../ui/MetricRing';
import { scoreColor } from '../ui/constants';

interface WorkspaceHealthBadgeProps {
  score: number | null | undefined;
  size?: number;
}

export function WorkspaceHealthBadge({ score, size = 32 }: WorkspaceHealthBadgeProps) {
  if (score == null) return null;
  return (
    <div className="flex items-center gap-1.5" title={`Health: ${Math.round(score)}/100`}>
      <MetricRingSvg score={score} size={size} strokeWidth={3} />
      <span className={`text-xs font-medium ${scoreColor(score)}`}>
        {Math.round(score)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create HealthScoreCard.tsx for client dashboard**

```tsx
import { MetricRing } from '../ui/MetricRing';
import { SectionCard } from '../ui/SectionCard';
import { scoreColor } from '../ui/constants';
import type { CompositeHealthScore } from 'shared/types/intelligence';

interface HealthScoreCardProps {
  healthScore: CompositeHealthScore | null | undefined;
}

export function HealthScoreCard({ healthScore }: HealthScoreCardProps) {
  if (!healthScore) return null;

  const { score, components } = healthScore;
  const labels = [
    { name: 'Churn Risk', value: components.churn.score, weight: '40%' },
    { name: 'ROI Trend', value: components.roi.score, weight: '30%' },
    { name: 'Engagement', value: components.engagement.score, weight: '30%' },
  ];

  return (
    <SectionCard title="SEO Health Score">
      <div className="flex items-center gap-6">
        <MetricRing score={score} size={100} />
        <div className="flex-1 space-y-2">
          {labels.map(l => (
            <div key={l.name} className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">{l.name} ({l.weight})</span>
              <span className={scoreColor(l.value)}>{Math.round(l.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: Wire WorkspaceHealthBadge into admin workspace list**

In `WorkspaceHome.tsx`, find the workspace list rendering. Add the health badge next to each workspace name. Use the intelligence hook to fetch health data.

- [ ] **Step 4: Wire HealthScoreCard into client OverviewTab**

In `src/components/client/OverviewTab.tsx`, import and render `HealthScoreCard` at the top of the overview. Use `useClientIntelligence(workspaceId)` to get the data.

- [ ] **Step 5: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/WorkspaceHealthBadge.tsx src/components/client/HealthScoreCard.tsx src/components/WorkspaceHome.tsx src/components/client/OverviewTab.tsx
git commit -m "feat: add compositeHealthScore to admin workspace list and client overview"
```

---

### Task 2.2 — weCalledIt Prediction Showcase Card (Model: opus)

**Owns:**
- Create: `src/components/client/PredictionShowcaseCard.tsx`
- Modify: `src/components/client/OverviewTab.tsx` (add card)

**Must not touch:** Server files, shared types, other components.

**Context:**
- `learnings.weCalledIt` is assembled by `assembleLearnings()` in workspace-intelligence.ts
- Type: `WeCalledItEntry[]` — `{ actionId, prediction, outcome, score, pageUrl, measuredAt }`
- Client hook: `useClientIntelligence(workspaceId)` — access via `data.learnings.weCalledIt`
- Use narrative language. No purple. No admin jargon. `EmptyState` from `src/components/ui/EmptyState.tsx` — props: `{ icon, title, description?, action?, className? }`

- [ ] **Step 1: Create PredictionShowcaseCard.tsx**

```tsx
import { TrendingUp, Trophy } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import type { WeCalledItEntry } from 'shared/types/intelligence';

interface PredictionShowcaseCardProps {
  predictions: WeCalledItEntry[] | undefined;
}

export function PredictionShowcaseCard({ predictions }: PredictionShowcaseCardProps) {
  if (!predictions || predictions.length === 0) {
    return (
      <SectionCard title="Predictions That Came True">
        <EmptyState
          icon={Trophy}
          title="Building your prediction track record"
          description="As our strategy recommendations play out, we'll showcase the wins here."
        />
      </SectionCard>
    );
  }

  // Show top 5 strongest predictions
  const top = predictions.slice(0, 5);

  return (
    <SectionCard title="Predictions That Came True">
      <div className="space-y-3">
        {top.map(p => (
          <div key={p.actionId} className="flex items-start gap-3 p-3 rounded-lg bg-teal-500/5 border border-teal-500/10">
            <TrendingUp className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-200">{p.prediction}</div>
              <div className="text-xs text-teal-400 mt-1">{p.outcome}</div>
              <div className="text-[11px] text-zinc-500 mt-1">
                Measured {new Date(p.measuredAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Wire into OverviewTab.tsx**

```tsx
import { PredictionShowcaseCard } from './PredictionShowcaseCard';
// In the render, after HealthScoreCard:
<PredictionShowcaseCard predictions={intelligence?.learnings?.weCalledIt} />
```

- [ ] **Step 3: Verify — no purple, no admin language**

```bash
grep -n 'purple' src/components/client/PredictionShowcaseCard.tsx
# Should return nothing
```

- [ ] **Step 4: Commit**

```bash
git add src/components/client/PredictionShowcaseCard.tsx src/components/client/OverviewTab.tsx
git commit -m "feat: add weCalledIt prediction showcase card to client dashboard"
```

---

### Task 2.3 — cannibalizationWarnings Frontend Alerts (Model: opus)

**Owns:**
- Create: `src/components/admin/CannibalizationAlert.tsx`
- Modify: `src/components/ContentPipeline.tsx` (add alert rendering)

**Must not touch:** Server files, shared types, other components.

**Context:**
- `contentPipeline.cannibalizationWarnings` assembled by `assembleContentPipeline()` in workspace-intelligence.ts
- Type: `CannibalizationWarning[]` — `{ keyword: string; pages: string[]; severity: 'low' | 'medium' | 'high' }`
- Admin hook: `useWorkspaceIntelligence(workspaceId, ['contentPipeline'])`
- Gate premium features with `TierGate` from `src/components/ui/TierGate.tsx` — props: `{ tier, required, feature, children, compact? }`

- [ ] **Step 1: Create CannibalizationAlert.tsx**

```tsx
import { AlertTriangle } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { TierGate } from '../ui/TierGate';
import type { CannibalizationWarning } from 'shared/types/intelligence';

interface CannibalizationAlertProps {
  warnings: CannibalizationWarning[] | undefined;
  tier: string;
  workspaceId: string;
}

export function CannibalizationAlert({ warnings, tier, workspaceId }: CannibalizationAlertProps) {
  if (!warnings || warnings.length === 0) return null;

  const severityColor = {
    high: 'text-red-400 bg-red-500/10 border-red-500/20',
    medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    low: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  };

  return (
    <TierGate tier={tier as 'free' | 'growth' | 'premium'} required="growth" feature="Keyword Cannibalization Alerts">
      <SectionCard title="Keyword Cannibalization Detected" className="border-amber-500/20">
        <div className="space-y-2">
          {warnings.map(w => (
            <div key={w.keyword} className={`flex items-start gap-3 p-3 rounded-lg border ${severityColor[w.severity]}`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">"{w.keyword}" targeted by {w.pages.length} pages</div>
                <div className="text-xs text-zinc-400 mt-1">
                  {w.pages.map(p => p.replace(/^https?:\/\/[^/]+/, '')).join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </TierGate>
  );
}
```

- [ ] **Step 2: Wire into ContentPipeline.tsx**

Import and render at the top of the content pipeline view, before the main content. Use the intelligence hook to get the data.

- [ ] **Step 3: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/CannibalizationAlert.tsx src/components/ContentPipeline.tsx
git commit -m "feat: add cannibalization warning alerts to content pipeline dashboard"
```

---

### PR 2 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Update `FEATURE_AUDIT.md` with entries for compositeHealthScore dashboard, weCalledIt card, and cannibalizationWarnings alerts. Update `BRAND_DESIGN_LANGUAGE.md` if any new color patterns were used.

After PR 2 passes:
- `scaled-code-review`
- Fix issues
- Merge to `staging`

---

## PR 3: Bug Fixes & Correctness

### Task 3.1 — PageHealthData Type Fix (Model: haiku)

**Owns:** `server/reports.ts`
**Must not touch:** Shared types, other server files.

- [ ] **Step 1: Read reports.ts line ~197 and understand the `as never` cast**

Determine what type the value actually is and what it should be.

- [ ] **Step 2: Fix the type assertion**

Replace `as never` with the correct type. If the value is a conditional spread, use proper type narrowing instead of casting.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/reports.ts
git commit -m "fix: remove as never type escape hatch in reports.ts PageHealthData"
```

---

### Task 3.2 — Auto-Resolve audit_finding Insights (Model: sonnet)

**Owns:**
- `server/routes/webflow-seo.ts` (audit completion handler)
- Create: `tests/integration/audit-insight-resolution.test.ts`

**Must not touch:** `server/analytics-insights-store.ts`, bridge infrastructure, other route files.

**Context:**
- `resolveInsight(id, workspaceId, 'resolved', note?, resolutionSource?)` from `server/analytics-insights-store.ts`
- Insights have type `audit_finding`. When an audit re-runs and the finding is absent, the insight should auto-resolve.
- `addActivity()` for logging. `broadcastToWorkspace()` with `WS_EVENTS.INSIGHT_RESOLVED`.

- [ ] **Step 1: Read the audit completion handler**

Find where audit results are processed in `webflow-seo.ts`. Identify where new audit_finding insights are upserted.

- [ ] **Step 2: After upserting new findings, resolve stale ones**

```typescript
// After upserting current findings, find and resolve old ones no longer present
const currentPageIds = newFindings.map(f => f.pageId);
const existingInsights = getInsightsByType(workspaceId, 'audit_finding');
for (const insight of existingInsights) {
  if (!currentPageIds.includes(insight.pageId)) {
    resolveInsight(insight.id, workspaceId, 'resolved', 'Issue no longer detected in latest audit', 'auto-resolve');
    addActivity(workspaceId, 'insight_auto_resolved', `Auto-resolved: ${insight.pageTitle || insight.pageId}`);
  }
}
```

Read the actual code to determine exact function names and data shapes.

- [ ] **Step 3: Write integration test**

Create `tests/integration/audit-insight-resolution.test.ts` (port: 13320):

```typescript
import { createTestContext } from './helpers';

const ctx = createTestContext(13320);

describe('Audit insight auto-resolution', () => {
  // Test that after an audit re-run, stale findings are resolved
});
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npx vitest run tests/integration/audit-insight-resolution.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/webflow-seo.ts tests/integration/audit-insight-resolution.test.ts
git commit -m "feat: auto-resolve audit_finding insights when issues no longer detected"
```

---

### Task 3.3 — Bridge #12: Refresh audit_finding Data (Model: sonnet)

**Owns:**
- `server/routes/webflow-seo.ts` (bridge trigger call)

**Must not touch:** `server/bridge-infrastructure.ts`, `server/insight-score-adjustments.ts`.

**Context:** Bridge authoring rules (docs/rules/bridge-authoring.md):
1. Pass `bridgeSource` for stale-cleanup immunity
2. Use `applyScoreAdjustment()` for score changes
3. Return `{ modified: N }`, never manually broadcast
4. Never call `resolveInsight()` unless the bridge's purpose is resolution management

`executeBridge(flag, workspaceId, fn)` auto-broadcasts when `modified > 0`.

- [ ] **Step 1: Read existing bridge registrations for pattern reference**

Look at how other bridges are triggered in the codebase (grep for `executeBridge` or `fireBridge`).

- [ ] **Step 2: Add bridge trigger after audit completion**

```typescript
import { fireBridge } from '../bridge-infrastructure.js';

// After audit completes and findings are upserted:
fireBridge('bridge-audit-page-health', workspaceId, async () => {
  // Re-compute page health from fresh audit data
  // Return { modified: N }
});
```

Read existing bridge callbacks for the `bridge-audit-page-health` flag to understand what the callback should do.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/webflow-seo.ts
git commit -m "fix: trigger bridge-audit-page-health after audit completion to refresh stale data"
```

---

### Task 3.4 — Anomaly Boost Reversal (Model: opus)

**Owns:**
- `server/anomaly-detection.ts` (reversal logic)
- Create: `tests/integration/anomaly-boost-reversal.test.ts`

**Must not touch:** `server/insight-score-adjustments.ts` (use existing API), `server/bridge-infrastructure.ts`.

**Context:**
- `applyScoreAdjustment(data, currentScore, bridgeKey, delta)` returns `{ data, adjustedScore }`
- When an anomaly resolves, pass a negative `delta` equal to the original boost to reverse it
- Existing bridge flag: `bridge-anomaly-boost`
- `computeAdjustedScore(data, currentScore)` re-derives the score from stored adjustments

- [ ] **Step 1: Read anomaly-detection.ts to find where boosts are applied**

Find the code that calls `applyScoreAdjustment()` with a positive delta when anomalies are detected.

- [ ] **Step 2: Add reversal logic when anomalies resolve**

When an anomaly is no longer detected (resolved), call `applyScoreAdjustment()` with the negative of the original boost:

```typescript
// When anomaly resolves:
const { data: updatedData, adjustedScore } = applyScoreAdjustment(
  insight.data,
  insight.impactScore,
  'anomaly-boost',
  -originalDelta, // negative to reverse
);
```

- [ ] **Step 3: Write test**

Create `tests/integration/anomaly-boost-reversal.test.ts` (port: 13321):

Test that:
1. An anomaly applies a boost
2. When anomaly resolves, the boost is reversed
3. The final score matches the pre-anomaly score

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npx vitest run tests/integration/anomaly-boost-reversal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/anomaly-detection.ts tests/integration/anomaly-boost-reversal.test.ts
git commit -m "fix: reverse anomaly score boosts when anomalies resolve"
```

---

### Task 3.5 — Strategy Cards Volume Threshold (Model: sonnet)

**Owns:**
- `src/components/KeywordStrategy.tsx` (or `src/components/admin/KeywordStrategy.tsx`)
- Verify actual path first

**Must not touch:** Server endpoints, shared types.

- [ ] **Step 1: Find strategy card rendering code**

Read the component and locate where keyword cards are filtered/rendered. Identify any existing volume filtering.

- [ ] **Step 2: Add volume threshold filter**

```tsx
const VOLUME_THRESHOLD = 10; // Minimum monthly search volume

const filteredCards = strategyCards.filter(card =>
  (card.searchVolume ?? 0) >= VOLUME_THRESHOLD
);
```

Use the filtered list for rendering instead of the raw list.

- [ ] **Step 3: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/KeywordStrategy.tsx
git commit -m "fix: filter strategy cards below minimum search volume threshold"
```

---

### PR 3 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

After PR 3: `scaled-code-review`, merge to `staging`.

---

## PR 4: Intelligence & Infrastructure

### Task 4.4 — Barrel Export Completion (Model: haiku)

**Owns:** `shared/types/index.ts`
**Must not touch:** Any individual type file.

This runs first because other tasks may benefit from clean imports.

- [ ] **Step 1: Add missing re-exports**

```typescript
// Add to shared/types/index.ts:
export type * from './brand-engine.ts';
export type * from './outcome-tracking.ts';
export type * from './copy-pipeline.ts';
export type * from './diagnostics.ts';
export type * from './page-strategy.ts';
export type * from './feature-flags.ts';
export type * from './features.ts';
export type * from './narrative.ts';
export type * from './cms-images.ts';
```

- [ ] **Step 2: Verify no name collisions**

```bash
npm run typecheck
```

If collisions occur, use selective re-exports instead of `export type *`.

- [ ] **Step 3: Commit**

```bash
git add shared/types/index.ts
git commit -m "fix: complete barrel export for 9 missing type files in shared/types"
```

---

### Task 4.1 — Wire portalUsage (Model: sonnet)

**Owns:** `server/workspace-intelligence.ts` (portalUsage section only, ~lines 1080-1110)
**Must not touch:** Other slices, shared types, frontend.

- [ ] **Step 1: Read the existing portalUsage code**

Read workspace-intelligence.ts around lines 1080-1110. Understand the current state — the earlier audit found mixed signals (partial implementation vs hardcoded null). Determine what data sources are available.

- [ ] **Step 2: Wire portal activity data**

Query the activity log for client portal events (types starting with `client_`). Compute:
- `recentSessions`: count of distinct days with client activity in last 30 days
- `lastActive`: most recent client activity timestamp

```typescript
// Replace portalUsage: null with real data
const clientActivities = getRecentClientActivities(workspaceId, 30);
const portalUsage = clientActivities.length > 0 ? {
  recentSessions: new Set(clientActivities.map(a => a.createdAt.split('T')[0])).size,
  lastActive: clientActivities[0].createdAt,
} : null;
```

Read `server/activity-log.ts` to find the actual function for querying activities with type filters.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/workspace-intelligence.ts
git commit -m "feat: wire portalUsage from client activity log data"
```

---

### Task 4.2 — actionBacklog Escalation (Model: sonnet)

**Owns:**
- `server/outcome-crons.ts` (add threshold check)

**Must not touch:** Other cron files, intelligence assembler.

- [ ] **Step 1: Read outcome-crons.ts to understand existing structure**

Find where `runMeasure()` or `runArchive()` complete. Determine where a threshold check fits naturally.

- [ ] **Step 2: Add backlog threshold check**

After measurement runs complete, check pending action count:

```typescript
const ACTION_BACKLOG_THRESHOLD = 20;
const ACTION_AGE_THRESHOLD_DAYS = 14;

// After measurement completes:
const pendingCount = getPendingActionsCount(workspaceId);
const oldestAge = getOldestPendingActionAge(workspaceId);

if (pendingCount > ACTION_BACKLOG_THRESHOLD || oldestAge > ACTION_AGE_THRESHOLD_DAYS) {
  log.warn({ workspaceId, pendingCount, oldestAge }, 'Action backlog exceeds threshold');
  // Use existing notification infrastructure to alert admin
  addActivity(workspaceId, 'action_backlog_alert',
    `Action backlog: ${pendingCount} pending items, oldest ${oldestAge} days`
  );
}
```

Read the file to determine exact function names for querying pending actions.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/outcome-crons.ts
git commit -m "feat: add action backlog threshold alerts in outcome crons"
```

---

### Task 4.3 — SEO Audit Cannibalization Prompt (Model: sonnet)

**Owns:** `server/seo-audit.ts` (or wherever audit prompts are constructed)
**Must not touch:** Intelligence assembler, other prompt files.

- [ ] **Step 1: Read the audit prompt construction**

Find where the SEO audit system prompt is built. Identify how page context is injected.

- [ ] **Step 2: Add cannibalization context to prompt**

```typescript
// Check if the page's keyword is cannibalized
const intelligence = await buildWorkspaceIntelligence(workspaceId, { sections: ['contentPipeline'] });
const warnings = intelligence?.contentPipeline?.cannibalizationWarnings || [];
const pageWarning = warnings.find(w => w.keyword === targetKeyword);

if (pageWarning) {
  promptSections.push(`
IMPORTANT: The keyword "${pageWarning.keyword}" is also targeted by ${pageWarning.pages.length - 1} other page(s):
${pageWarning.pages.filter(p => p !== pageUrl).join('\n')}

When auditing this page, consider recommending keyword consolidation or differentiation rather than just meta tag optimizations. Competing pages dilute ranking authority.
`);
}
```

Read the actual code to determine function signatures and variable names.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/seo-audit.ts
git commit -m "feat: inject cannibalization context into SEO audit prompt"
```

---

### Task 4.5 — Dead Code Removal (Model: haiku)

**Owns:** `server/test-deduplication.ts`

- [ ] **Step 1: Verify no imports**

```bash
grep -r 'test-deduplication' server/ src/ shared/
```

Should return only the file itself.

- [ ] **Step 2: Delete the file**

```bash
rm server/test-deduplication.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/test-deduplication.ts
git commit -m "chore: remove dead test-deduplication.ts script"
```

---

### PR 4 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

After PR 4: `scaled-code-review`, merge to `staging`.

---

## PR 5: Infrastructure Plans

These tasks execute existing plans. Each task references its plan document — the implementer should read the full plan.

### Task 5.1 — Pre-commit Hooks (Model: sonnet)

**Plan:** `docs/superpowers/plans/2026-04-11-pre-commit-hooks.md`

**Owns:** `package.json`, `.husky/`, new scripts.
**Must not touch:** Source code, existing scripts.

Follow the existing plan exactly. Key steps:
- [ ] Install husky v9
- [ ] Create `.husky/pre-commit` with typecheck + pr-check
- [ ] Test with a deliberate violation
- [ ] Commit

---

### Task 5.2 — CI Coverage Thresholds (Model: sonnet)

**Plan:** `docs/superpowers/plans/2026-04-11-coverage-thresholds.md`

**Owns:** `vite.config.ts` (coverage section), CI config files.
**Must not touch:** Source code, test files.

Follow the existing plan. Key steps:
- [ ] Install `@vitest/coverage-v8`
- [ ] Configure thresholds in `vite.config.ts`
- [ ] Add CI job for coverage reporting
- [ ] Commit

---

### Task 5.3 — pr-check Audit PR A (Model: opus)

**Plan:** `docs/superpowers/plans/2026-04-10-pr-check-audit-and-backfill.md`

**Owns:** `scripts/pr-check.ts`, `docs/rules/automated-rules.md`.
**Must not touch:** Application source code (this PR only adds rules, not fixes).

Follow the existing plan for PR A scope only. Key steps:
- [ ] Add 11 new pr-check rules
- [ ] Regenerate automated-rules.md
- [ ] Run full-scan to inventory violations (document, don't fix)
- [ ] Commit

---

### PR 5 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

---

## PR 6: Test & Doc Cleanup

### Task 6.1 — Fix Skipped Tests (Model: sonnet)

**Owns:** `tests/integration/health-routes.test.ts`
**Must not touch:** Server health endpoints, other test files.

- [ ] **Step 1: Read the skipped tests and the commit reference**

Read tests/integration/health-routes.test.ts, particularly lines 45-72 with `.skip()`. Understand what "async storage refactor" was needed (reference commit 365a02a1).

- [ ] **Step 2: Implement the fix**

Based on the skip reason, either:
- Refactor the tests to use the current async storage API
- Remove the skip if the underlying issue was fixed in a subsequent commit

- [ ] **Step 3: Run the tests**

```bash
npx vitest run tests/integration/health-routes.test.ts --reporter=verbose
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/health-routes.test.ts
git commit -m "fix: unskip 4 health-routes integration tests after async storage refactor"
```

---

### Task 6.2 — Docs/Rules Audit (Model: opus)

**Owns:** All files in `docs/rules/`
**Must not touch:** Source code, CLAUDE.md.

- [ ] **Step 1: List all files in docs/rules/**

```bash
ls -la docs/rules/
```

- [ ] **Step 2: For each file, verify:**
- File paths referenced in the doc still exist
- Type names referenced still exist in shared/types/
- Function names referenced still exist in the codebase
- Rules described are still accurate

- [ ] **Step 3: Fix stale references**

Update file paths, type names, and function names. Remove rules that no longer apply. Add notes for rules that could become pr-check rules.

- [ ] **Step 4: Commit**

```bash
git add docs/rules/
git commit -m "docs: audit and update docs/rules for staleness and accuracy"
```

---

### Task 6.3 — Empty State CTAs (Model: sonnet)

**Owns:** Multiple component files (25+ EmptyState usages)
**Must not touch:** EmptyState.tsx itself.

- [ ] **Step 1: Find all EmptyState usages without action props**

```bash
grep -rn '<EmptyState' src/components/ | grep -v 'action='
```

- [ ] **Step 2: For each usage, add an appropriate CTA**

Each EmptyState should have an `action` prop with a button that guides the user to the next logical step. Examples:
- Empty audit results → "Run an audit"
- Empty keyword strategy → "Generate strategy"
- Empty content briefs → "Create a brief"

- [ ] **Step 3: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "fix: add action CTAs to 25+ EmptyState components"
```

---

### Task 6.4 — Client Portal Error Feedback (Model: sonnet)

**Owns:** `src/components/client/*.tsx` (error handling patterns only)
**Must not touch:** Server endpoints, component logic, admin components.

**Context:** Multiple client portal components use `.catch(err => log.warn(...))` without updating UI state. Users see infinite spinners when API calls fail. This is a UX degradation for paying customers.

- [ ] **Step 1: Audit client components for silent error swallowing**

```bash
grep -rn '\.catch' src/components/client/ --include='*.tsx' | grep -v 'setState\|setError\|setLoading'
```

List every `.catch()` handler that only logs without updating UI state.

- [ ] **Step 2: For each handler, add error state updates**

Pattern:
```tsx
// Before:
.catch(err => log.warn(err));

// After:
.catch(err => {
  log.warn(err);
  setLoading(false);
  setError('Something went wrong. Please try again.');
});
```

If the component doesn't have an error state, add one:
```tsx
const [error, setError] = useState<string | null>(null);
```

And render inline:
```tsx
{error && (
  <div className="text-sm text-red-400 mt-2">
    {error}
    <button onClick={retry} className="ml-2 text-teal-400 underline">Retry</button>
  </div>
)}
```

- [ ] **Step 3: Verify build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/client/
git commit -m "fix: replace silent .catch() handlers with user-facing error states in client portal"
```

---

### Task 6.5 — Archive Shipped Docs (Model: haiku)

**Owns:** `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/audits/`
**Must not touch:** Active reference files, source code.

- [ ] **Step 1: Create archive directory**

```bash
mkdir -p docs/superpowers/archive/specs docs/superpowers/archive/plans docs/superpowers/archive/audits
```

- [ ] **Step 2: Move shipped specs**

```bash
cd docs/superpowers
mv specs/2026-03-26-brandscript-engine-design.md archive/specs/
mv specs/2026-03-27-copy-pipeline-design.md archive/specs/
mv specs/2026-03-27-page-strategy-engine-design.md archive/specs/
mv specs/2026-03-28-analytics-hub-redesign.md archive/specs/
mv specs/2026-03-28-dashboard-visual-polish-design.md archive/specs/
mv specs/2026-03-29-light-mode-audit-design.md archive/specs/
mv specs/2026-04-12-admin-ux-restructure-design.md archive/specs/
mv specs/2026-04-12-deep-diagnostics-design.md archive/specs/
mv specs/2026-04-13-admin-ux-pr3-shared-ux-design.md archive/specs/
```

- [ ] **Step 3: Move shipped plans**

```bash
mv plans/2026-03-26-brandscript-engine.md archive/plans/
mv plans/2026-03-27-copy-pipeline.md archive/plans/
mv plans/2026-03-27-page-strategy-engine.md archive/plans/
mv plans/2026-03-28-analytics-hub-redesign.md archive/plans/
mv plans/2026-03-28-dashboard-visual-polish.md archive/plans/
mv plans/2026-03-29-light-mode-audit.md archive/plans/
mv plans/2026-04-12-admin-ux-restructure.md archive/plans/
mv plans/2026-04-12-deep-diagnostics.md archive/plans/
mv plans/2026-04-13-admin-ux-pr3-shared-ux.md archive/plans/
```

- [ ] **Step 4: Move completed audits**

```bash
mv audits/2026-03-29-light-mode-and-polish-audit.md archive/audits/
mv audits/2026-03-31-intelligence-phase2-bridge-audit.md archive/audits/
mv audits/2026-04-11-page-strategy-engine-audit.md archive/audits/
mv audits/2026-04-12-admin-ux-restructure-audit.md archive/audits/
mv audits/2026-04-12-copy-pipeline-audit.md archive/audits/
mv audits/2026-04-12-deep-diagnostics-audit.md archive/audits/
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/
git commit -m "chore: archive 9 shipped specs, 9 shipped plans, 6 completed audits"
```

---

### PR 6 Verification

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

---

## PR 7: Roadmap Housekeeping

### Task 7.1 — Mark Done + Consolidate (Model: haiku)

**Owns:** `data/roadmap.json`, `docs/superpowers/intelligence-backlog.md`
**Must not touch:** Source code.

- [ ] **Step 1: Mark 6 items done in roadmap.json**

Update these items from `"status": "pending"` to `"status": "done"` with notes:
- #583 (line ~689): `"notes": "Verified correct — client_signal properly mapped to 'internal' category"`
- #580 (line ~662): `"notes": "No as never escape hatches remaining in anomaly-detection.ts or reports.ts"`
- #581 (line ~671): `"notes": "No as unknown casts remaining in workspaces.ts keyword strategy code"`
- #584 (line ~698): `"notes": "No type casts remaining on applyScoreAdjustment call sites"`
- #574 (line ~4007): `"notes": "No bare JSON.parse in work-orders.ts, recommendations.ts, or reports.ts"`
- #366 (line ~3962): `"notes": "Dedicated page_edit_states table created — no longer JSON blob"`

- [ ] **Step 2: Add new roadmap entries for items from audit**

Add items to the current sprint or backlog:
- Migration collision fix (if not already done in PR 1)
- Public endpoint validation
- ErrorBoundary additions
- Background job conversions
- compositeHealthScore dashboard
- weCalledIt card
- cannibalizationWarnings alerts
- portalUsage wiring
- actionBacklog escalation

- [ ] **Step 3: Sort roadmap**

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 4: Update intelligence-backlog.md**

Mark completed items, remove items that were added to roadmap to avoid dual-tracking.

- [ ] **Step 5: Update FEATURE_AUDIT.md**

Add entries for all client-facing features shipped in this sprint.

- [ ] **Step 6: Commit**

```bash
git add data/roadmap.json docs/superpowers/intelligence-backlog.md FEATURE_AUDIT.md
git commit -m "docs: roadmap housekeeping — mark 6 done, consolidate scattered items, update audit"
```

---

## Systemic Improvements

### Shared utilities to extract
- None required — all fixes use existing infrastructure (`validate()`, `ErrorBoundary`, `createJob()`, `applyScoreAdjustment()`)

### pr-check rules to add
- **Migration number uniqueness** — detect duplicate migration number prefixes (prevent future collisions)
- Part of Task 5.3 (pr-check audit PR A) which adds 11 new rules from the existing plan

### New tests required
- `tests/integration/audit-insight-resolution.test.ts` (port 13320) — Task 3.2
- `tests/integration/anomaly-boost-reversal.test.ts` (port 13321) — Task 3.4

---

## Verification Strategy

### Per-PR verification
Every PR runs this gate before merge:
```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

### Code review
- PRs with 10+ files changed: `scaled-code-review`
- Smaller PRs: `requesting-code-review`
- All bugs found during review: fix before merge

### Staging verification
All PRs merge to `staging` first. Verify on staging deploy before `staging` → `main`.

### Client-facing verification (PR 2)
After PR 2 merges to staging:
- Verify compositeHealthScore renders on admin workspace list
- Verify HealthScoreCard renders on client overview tab
- Verify PredictionShowcaseCard renders (or shows empty state)
- Verify CannibalizationAlert renders on content pipeline (or is hidden when no warnings)
- Verify TierGate blocks free-tier users from cannibalization alerts

### Background job verification (PR 1, Task 1.6)
After PR 1 merges to staging:
- Trigger bulk SEO analyze — verify job runs server-side
- Navigate away during bulk operation — verify it continues
- Cancel a bulk operation — verify it stops
- Check WebSocket progress events arrive in real-time
