# Portal Cleanup & Deferred Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock dark-launched features (Brand tab, smart placeholders), backfill missing activity logging on 5 public-portal endpoints, eliminate all actionable hardcoded studio name strings (15 instances across 8 files), close an already-fixed anomaly bug, audit and type all `Record<string,unknown>` data contracts, and add incremental strategy update mode.

**Architecture:** Tasks 1–4 are isolated, mechanical changes with no shared file ownership — they run fully in parallel. Tasks 5–6 are larger independent features that can also run in parallel with each other and with 1–4. No new tables for Tasks 1–4. Task 6 requires one new column on workspaces. All infrastructure for Tasks 1–4 already exists.

**Tech Stack:** TypeScript, Express, React 19, `@tanstack/react-query`, Zod v3, SQLite via better-sqlite3, Vitest

---

## Parallelization Dependency Graph

```
[START]
  ├─── Task 1 (FeatureFlagSettings) ─────────────────────────────► [DONE]
  ├─── Task 2 (addActivity backfill) ─────────────────────────────► [DONE]
  ├─── Task 3 (hardcoded strings, 8 server files) ────────────────► [DONE]
  ├─── Task 4 (close roadmap #532, data/roadmap.json only) ───────► [DONE]
  ├─── Task 5 (typed contracts, shared/types + server/) ──────────► [DONE]
  └─── Task 6 (incremental strategy, keyword-strategy.ts + UI) ───► [DONE]
                                                                      │
                                                              [Post-tasks gate]
```

**All tasks are independent.** No task depends on output from another. File ownership is exclusive — no two tasks touch the same file. Dispatch Tasks 1–4 as parallel agents in a single batch; Tasks 5–6 can join that batch or run as a second batch if context is constrained.

**File ownership map (exclusive — no overlaps):**

| Task | Files owned |
|------|------------|
| 1 | `src/components/FeatureFlagSettings.tsx` |
| 2 | `server/activity-log.ts`, `server/routes/public-portal.ts` |
| 3 | `server/web-scraper.ts`, `server/routes/webflow-seo.ts`, `server/routes/jobs.ts`, `server/brief-export-html.ts`, `server/post-export-html.ts`, `server/sales-report-html.ts`, `server/email-templates.ts`, `server/routes/public-analytics.ts` |
| 4 | `data/roadmap.json` only |
| 5 | `shared/types/analytics.ts`, `server/analytics-intelligence.ts`, `server/analytics-insights-store.ts` (and any additional files found during discovery) |
| 6 | `server/routes/keyword-strategy.ts`, `server/workspaces.ts`, `src/components/client/KeywordStrategy.tsx` (or equivalent strategy UI component), `tests/integration/keyword-strategy-incremental.test.ts` |

---

## Model Assignments

| Task | Recommended Model | Reasoning |
|------|------------------|-----------|
| Task 1 — Feature flag labels | **Haiku** | Pure string additions to two constants, no logic |
| Task 2 — addActivity backfill | **Sonnet** | Must read handler context to place calls correctly, add new type values |
| Task 3 — Hardcoded strings | **Haiku** | Mechanical import + substitution across 8 files |
| Task 4 — Close roadmap item | **Haiku** | JSON field update only, zero code |
| Task 5 — Typed data contracts | **Sonnet** | Must understand existing insight data shapes to define correct interfaces |
| Task 6 — Incremental strategy | **Sonnet** | Non-trivial logic: page filtering, keyword preservation, new DB column |

---

## Systemic Improvements

**pr-check rule — already exists but scope was incomplete:**
`scripts/pr-check.ts` already has a rule checking for hardcoded `hmpsn.studio`. However, the audit found 3 additional bot User-Agent strings in `routes/webflow-seo.ts:880` and `routes/jobs.ts:699` that the rule may not catch if it only searches `server/*.ts` and not `server/routes/*.ts`. After Task 3 is merged, verify the pr-check rule covers all `server/routes/` files.

**Test coverage additions (per task):**
- Task 1: FeatureFlagSettings rendering test — assert new group and labels appear
- Task 2: Integration test on each mutated endpoint — assert activity row is written to DB
- Task 3: Vitest unit test — import each fixed file, assert no literal `hmpsn.studio` string in output
- Task 6: Integration test — assert incremental mode skips pages with recent `analysis_generated_at`

**Shared infrastructure:**
No new shared utilities needed for Tasks 1–4. Task 6 may introduce `getPagesNeedingAnalysis()` as a reusable helper if multiple strategy entry points call it.

---

## Task 1 — Add PIE Group 3 flags to FeatureFlagSettings

**Model: Haiku**

**Why:** `smart-placeholders`, `client-brand-section`, and `seo-editor-unified` were added to `shared/types/feature-flags.ts` in PIE Group 3 but were never added to `FLAG_GROUPS` or `FLAG_LABELS` in `FeatureFlagSettings.tsx`. They fall into the "Other" bucket with raw key strings as labels. The admin can't identify what they are, which means the Brand tab (`client-brand-section`) can't be enabled from the UI.

**Verified by pre-plan audit:** `grep -n "smart-placeholders\|client-brand-section\|seo-editor-unified" src/components/FeatureFlagSettings.tsx` returns no results — confirmed absent from both `FLAG_GROUPS` and `FLAG_LABELS`.

**Files:** `src/components/FeatureFlagSettings.tsx`

- [ ] **Step 1: Write failing test — assert new group renders**

Create `tests/component/FeatureFlagSettings.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FeatureFlagSettings } from '../../src/components/FeatureFlagSettings';

// Mock the flags API hook
vi.mock('../../src/hooks/admin/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
  useToggleFeatureFlag: () => ({ mutate: vi.fn() }),
}));

describe('FeatureFlagSettings — PIE Group 3 flags', () => {
  it('renders Platform Intelligence Enhancements group header', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText('Platform Intelligence Enhancements')).toBeInTheDocument();
  });

  it('renders human-readable label for client-brand-section', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/Brand tab/i)).toBeInTheDocument();
  });

  it('renders human-readable label for smart-placeholders', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/Smart placeholders/i)).toBeInTheDocument();
  });

  it('renders human-readable label for seo-editor-unified', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/SEO editor.*merged/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/component/FeatureFlagSettings.test.tsx 2>&1 | tail -15
```

Expected: FAIL — "Platform Intelligence Enhancements" not found.

- [ ] **Step 3: Add the "Platform Intelligence Enhancements" group to FLAG_GROUPS**

In `src/components/FeatureFlagSettings.tsx`, find the `FLAG_GROUPS` constant. Add after the last group entry (look for the group ending with the workspace intelligence bridges):

```typescript
  {
    label: 'Platform Intelligence Enhancements',
    keys: ['smart-placeholders', 'client-brand-section', 'seo-editor-unified'],
  },
```

- [ ] **Step 4: Add human-readable labels to FLAG_LABELS**

In the same file, find `FLAG_LABELS` and add after the last entry:

```typescript
  // Platform Intelligence Enhancements
  'smart-placeholders':   'Smart placeholders (admin chips + client ghost text)',
  'client-brand-section': 'Client portal — Brand tab (business profile)',
  'seo-editor-unified':   'SEO editor — merged static + CMS with collection filter',
```

- [ ] **Step 5: Run test to verify it passes**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/component/FeatureFlagSettings.test.tsx 2>&1 | tail -10
```

Expected: PASS — all 4 assertions green.

- [ ] **Step 6: Compile check**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/FeatureFlagSettings.tsx tests/component/FeatureFlagSettings.test.tsx
git commit -m "feat(flags): add PIE Group 3 flags to FeatureFlagSettings groups and labels"
```

---

## Task 2 — Backfill addActivity() on 5 public-portal mutation endpoints

**Model: Sonnet**

**Why:** Five client-portal mutation endpoints have zero activity logging, giving admins no visibility into client engagement. `addActivity` is already imported at `server/routes/public-portal.ts:21`. Four new `ActivityType` values are needed in the union.

**Verified by pre-plan audit:** Exact insertion points confirmed with surrounding line context:
- Line ~179: onboarding endpoint — before `res.json({ ok: true, ... })`
- Line ~382: single keyword feedback — after `log.info(...)` logging `"${status} feedback on keyword: "${kw}"...`
- Line ~422: bulk keyword feedback — after `log.info(...)` logging `${keywords.length} keywords`
- Line ~499: business priorities — after `log.info(...)` logging `${clean.length} business priorities`
- Line ~588: content gap vote — before `res.json({ ok: true })`

**Files:** `server/activity-log.ts`, `server/routes/public-portal.ts`

### Step 2a — Add ActivityType values

- [ ] **Step 1: Write failing test — assert new activity types are valid**

Add to an existing activity test file (check `tests/unit/activity.test.ts` or create it):

```typescript
import { describe, it, expect } from 'vitest';

// Validates that the ActivityType union includes the new portal types.
// If a type is removed from the union, this test will fail at compile time.
describe('ActivityType — public portal types', () => {
  it('accepts client_onboarding_submitted', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_onboarding_submitted';
    expect(type).toBe('client_onboarding_submitted');
  });

  it('accepts client_keyword_feedback', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_keyword_feedback';
    expect(type).toBe('client_keyword_feedback');
  });

  it('accepts client_priorities_updated', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_priorities_updated';
    expect(type).toBe('client_priorities_updated');
  });

  it('accepts client_content_gap_vote', () => {
    const type: import('../../server/activity-log.js').ActivityType = 'client_content_gap_vote';
    expect(type).toBe('client_content_gap_vote');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/activity.test.ts 2>&1 | tail -15
```

Expected: TypeScript compile error — types not in union.

- [ ] **Step 3: Add 4 new types to ActivityType union in `server/activity-log.ts`**

Find the line ending `| 'client_profile_updated';` and extend it:

```typescript
  | 'client_profile_updated'
  | 'client_onboarding_submitted'
  | 'client_keyword_feedback'
  | 'client_priorities_updated'
  | 'client_content_gap_vote';
```

> These are admin-only visibility events. Do **NOT** add to `CLIENT_VISIBLE_TYPES` — clients don't need to see their own portal interactions as feed items.

- [ ] **Step 4: Run type tests to verify they pass**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/activity.test.ts 2>&1 | tail -10
```

Expected: PASS.

### Step 2b — Write failing integration tests for each endpoint

- [ ] **Step 5: Write integration tests**

Create `tests/integration/public-portal-activity.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers';
import Database from 'better-sqlite3';

const { api, postJson, cleanup, dbPath } = createTestContext(13310);

describe('public-portal addActivity backfill', () => {
  let workspaceId: string;
  let db: InstanceType<typeof Database>;

  beforeAll(async () => {
    const res = await postJson('/api/workspaces', { name: 'Portal Activity Test' });
    const ws = await res.json();
    workspaceId = ws.id;
    db = new Database(dbPath);
  });

  afterAll(async () => {
    db.close();
    await cleanup();
  });

  function getActivity(type: string) {
    return db.prepare(`SELECT * FROM activity_log WHERE workspace_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`)
      .get(workspaceId, type);
  }

  it('POST /api/public/onboarding/:id writes client_onboarding_submitted', async () => {
    await postJson(`/api/public/onboarding/${workspaceId}`, {
      goals: ['more traffic'],
    });
    const row = getActivity('client_onboarding_submitted');
    expect(row).toBeTruthy();
  });

  it('POST /api/public/keyword-feedback/:id writes client_keyword_feedback (single)', async () => {
    await postJson(`/api/public/keyword-feedback/${workspaceId}`, {
      keyword: 'test keyword', status: 'approved',
    });
    const row = getActivity('client_keyword_feedback');
    expect(row).toBeTruthy();
  });

  it('POST /api/public/keyword-feedback/:id/bulk writes client_keyword_feedback (bulk)', async () => {
    await postJson(`/api/public/keyword-feedback/${workspaceId}/bulk`, {
      keywords: [{ keyword: 'seo tips', status: 'approved' }],
    });
    const row = getActivity('client_keyword_feedback');
    expect(row).toBeTruthy();
  });

  it('POST /api/public/business-priorities/:id writes client_priorities_updated', async () => {
    await postJson(`/api/public/business-priorities/${workspaceId}`, {
      priorities: ['grow organic traffic'],
    });
    const row = getActivity('client_priorities_updated');
    expect(row).toBeTruthy();
  });

  it('POST /api/public/content-gap-vote/:id writes client_content_gap_vote', async () => {
    await postJson(`/api/public/content-gap-vote/${workspaceId}`, {
      keyword: 'seo tools', vote: 'up',
    });
    const row = getActivity('client_content_gap_vote');
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run integration tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/integration/public-portal-activity.test.ts 2>&1 | tail -20
```

Expected: all 5 tests fail (no activity rows written yet).

### Step 2c — Wire addActivity into each endpoint

- [ ] **Step 7: POST /api/public/onboarding/:id (line ~179)**

After `updateWorkspace(ws.id, { onboardingCompleted: true, ... })` and immediately before `res.json({ ok: true, ... })`:

```typescript
addActivity(wsId, 'client_onboarding_submitted', 'Client completed onboarding questionnaire', 'Via client portal');
```

- [ ] **Step 8: POST /api/public/keyword-feedback/:workspaceId — single (line ~382)**

Find: `log.info(\`Client keyword feedback: "${kw}" → ${status} for workspace ${ws.id}\`);`

Add immediately after that `log.info` line:

```typescript
addActivity(wsId, 'client_keyword_feedback', `Client gave ${status} feedback on keyword: ${kw}`, 'Via client portal');
```

- [ ] **Step 9: POST /api/public/keyword-feedback/:workspaceId/bulk (line ~422)**

Find: `log.info(\`Client bulk keyword feedback: ${keywords.length} keywords for workspace ${ws.id}\`);`

Add immediately after:

```typescript
addActivity(wsId, 'client_keyword_feedback', `Client gave bulk keyword feedback (${keywords.length} keywords)`, 'Via client portal');
```

- [ ] **Step 10: POST /api/public/business-priorities/:workspaceId (line ~499)**

Find: `log.info(\`Client submitted ${clean.length} business priorities for workspace ${wsId}\`);`

Add immediately after:

```typescript
addActivity(wsId, 'client_priorities_updated', `Client updated business priorities (${clean.length} items)`, 'Via client portal');
```

- [ ] **Step 11: POST /api/public/content-gap-vote/:workspaceId (line ~588)**

Find `res.json({ ok: true });` at the end of this handler. Add before it:

```typescript
addActivity(wsId, 'client_content_gap_vote', `Client voted ${vote} on keyword: ${kw}`, 'Via client portal');
```

> `vote === 'none'` (vote removal) is still worth logging. It reads naturally: "Client voted none on keyword: ..." = client removed their vote.

- [ ] **Step 12: Run integration tests to verify they pass**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/integration/public-portal-activity.test.ts 2>&1 | tail -10
```

Expected: all 5 PASS.

- [ ] **Step 13: Full compile check**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add server/activity-log.ts server/routes/public-portal.ts tests/unit/activity.test.ts tests/integration/public-portal-activity.test.ts
git commit -m "feat(activity): backfill addActivity() on 5 public-portal mutation endpoints (#535)"
```

---

## Task 3 — Replace all actionable hardcoded 'hmpsn.studio' strings with constants

**Model: Haiku**

**Why:** `server/constants.ts` exports `STUDIO_NAME`, `STUDIO_URL`, and `STUDIO_BOT_UA` for exactly this purpose. The pre-plan audit found **15 actionable instances across 8 server files** that still use the raw string. The existing `pr-check.ts` rule catches these but they haven't been cleaned up yet.

**Verified by pre-plan audit — full actionable list:**

| File | Line(s) | Fix |
|------|---------|-----|
| `server/web-scraper.ts` | 31 | `STUDIO_BOT_UA` (User-Agent const) |
| `server/routes/webflow-seo.ts` | 880 | `STUDIO_BOT_UA` (User-Agent string) |
| `server/routes/jobs.ts` | 699 | `STUDIO_BOT_UA` (User-Agent string) |
| `server/brief-export-html.ts` | 56 (title), 62 (meta), 193 (span), 341 (footer link) | `STUDIO_NAME` + `STUDIO_URL` |
| `server/post-export-html.ts` | 50 (title), 56 (meta), 151 (span), 218 (footer link) | `STUDIO_NAME` + `STUDIO_URL` |
| `server/sales-report-html.ts` | 230 (plain text), 342 (footer link) | `STUDIO_NAME` + `STUDIO_URL` |
| `server/email-templates.ts` | 54 (alt text), 55 (fallback) | `STUDIO_NAME` |
| `server/routes/public-analytics.ts` | 244 (teamName var), 329 (system prompt), 361 (system prompt) | `STUDIO_NAME` |

**SAFE (do not touch — verified correct to leave as-is):**
`index.html` (page title/meta), `tests/` fixtures, `src/components/LandingPage.tsx` alt text, `src/components/Styleguide.tsx` design system copy, `src/components/LoginScreen.tsx` alt, `src/components/ClientDashboard.tsx` img alt + footer, `src/constants.ts` (definition), `server/constants.ts` (definition), `scripts/pr-check.ts` (rule description), `scripts/sync-staging-db.ts` (PROD_URL default), `server/email.ts` (comment), `server/admin-chat-context.ts` (system prompt inline).

**Files:** `server/web-scraper.ts`, `server/routes/webflow-seo.ts`, `server/routes/jobs.ts`, `server/brief-export-html.ts`, `server/post-export-html.ts`, `server/sales-report-html.ts`, `server/email-templates.ts`, `server/routes/public-analytics.ts`

- [ ] **Step 1: Write failing test — assert no literal hmpsn.studio in output**

Create `tests/unit/no-hardcoded-studio-strings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Files that must NOT contain literal 'hmpsn.studio' (other than import paths or comments)
const FILES_TO_CHECK = [
  'server/web-scraper.ts',
  'server/routes/webflow-seo.ts',
  'server/routes/jobs.ts',
  'server/brief-export-html.ts',
  'server/post-export-html.ts',
  'server/sales-report-html.ts',
  'server/email-templates.ts',
  'server/routes/public-analytics.ts',
];

// Pattern: literal hmpsn.studio NOT inside a comment line
const LITERAL_PATTERN = /^(?!\s*\/\/).*hmpsn\.studio/m;

describe('No hardcoded studio strings', () => {
  for (const file of FILES_TO_CHECK) {
    it(`${file} — no literal hmpsn.studio`, () => {
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(LITERAL_PATTERN.test(content)).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/no-hardcoded-studio-strings.test.ts 2>&1 | tail -20
```

Expected: 8 failures, one per file.

- [ ] **Step 3: Fix server/web-scraper.ts**

Add import at top (with existing imports):
```typescript
import { STUDIO_BOT_UA } from './constants.js';
```

Find and replace the USER_AGENT assignment (line ~31):
```typescript
// BEFORE:
const USER_AGENT = 'Mozilla/5.0 (compatible; HmpsnStudioBot/1.0; +https://hmpsn.studio)';
// AFTER:
const USER_AGENT = STUDIO_BOT_UA;
```

- [ ] **Step 4: Fix server/routes/webflow-seo.ts**

Add import at top (with existing imports from `../constants.js`):
```typescript
import { STUDIO_BOT_UA } from '../constants.js';
```

Find the User-Agent string at line ~880 and replace the literal with `STUDIO_BOT_UA`. The surrounding context should look like:
```typescript
'User-Agent': STUDIO_BOT_UA,
```

- [ ] **Step 5: Fix server/routes/jobs.ts**

Same pattern as Step 4. Add:
```typescript
import { STUDIO_BOT_UA } from '../constants.js';
```
Replace the User-Agent string at line ~699 with `STUDIO_BOT_UA`.

- [ ] **Step 6: Fix server/brief-export-html.ts (4 occurrences)**

Add import at top:
```typescript
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
```

These files use template literals throughout. Replace:
- Line ~56 (page title): `hmpsn.studio — ...` → `${STUDIO_NAME} — ...`
- Line ~62 (meta content): `content="hmpsn.studio..."` → `` content="${STUDIO_NAME}..." ``
- Line ~193 (span text): `>hmpsn studio<` or `>hmpsn.studio<` → `>${STUDIO_NAME}<`
- Line ~341 (footer link): `href="https://hmpsn.studio"...>hmpsn.studio<` → `` href="${STUDIO_URL}"...>${STUDIO_NAME}< ``

- [ ] **Step 7: Fix server/post-export-html.ts (4 occurrences)**

Same pattern as Step 6. Add imports and replace:
- Line ~50 (page title): → `${STUDIO_NAME}`
- Line ~56 (meta content): → `${STUDIO_NAME}`
- Line ~151 (span text): → `${STUDIO_NAME}`
- Line ~218 (footer link): → `href="${STUDIO_URL}"...>${STUDIO_NAME}<`

- [ ] **Step 8: Fix server/sales-report-html.ts (2 occurrences)**

Add imports:
```typescript
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
```

- Line ~230 (plain text "Prepared by hmpsn.studio"): → `Prepared by ${STUDIO_NAME}`
- Line ~342 (footer link): → `href="${STUDIO_URL}"...>${STUDIO_NAME}<`

- [ ] **Step 9: Fix server/email-templates.ts (2 occurrences)**

Add import:
```typescript
import { STUDIO_NAME } from './constants.js';
```

- Line ~54 (alt text in img tag): → `alt="${STUDIO_NAME}"`
- Line ~55 (fallback plain text): → `${STUDIO_NAME}`

- [ ] **Step 10: Fix server/routes/public-analytics.ts (3 occurrences)**

Add import at top (with existing imports from `../constants.js`):
```typescript
import { STUDIO_NAME } from '../constants.js';
```

- Line ~244 (`const teamName = 'hmpsn.studio'` local variable): → `const teamName = STUDIO_NAME;`
- Line ~329 (system prompt string): replace `hmpsn.studio` with `${STUDIO_NAME}`
- Line ~361 (system prompt string): replace `hmpsn.studio` with `${STUDIO_NAME}`

- [ ] **Step 11: Run tests to verify they pass**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/no-hardcoded-studio-strings.test.ts 2>&1 | tail -10
```

Expected: all 8 PASS.

- [ ] **Step 12: Verify no actionable occurrences remain**

```bash
grep -rn "hmpsn\.studio" server/ --include="*.ts" | grep -v "constants\.ts\|email\.ts:.*comment\|pr-check"
```

Expected: only `server/constants.ts` (the definition itself) remains. No routes, templates, or export files.

- [ ] **Step 13: Run pr-check to confirm rule now passes**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsx scripts/pr-check.ts 2>&1 | grep -i "hmpsn\|studio\|hardcoded"
```

Expected: no violations reported for hardcoded studio name.

- [ ] **Step 14: Compile check**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add server/web-scraper.ts server/routes/webflow-seo.ts server/routes/jobs.ts \
        server/brief-export-html.ts server/post-export-html.ts server/sales-report-html.ts \
        server/email-templates.ts server/routes/public-analytics.ts \
        tests/unit/no-hardcoded-studio-strings.test.ts
git commit -m "fix: replace all hardcoded hmpsn.studio strings with STUDIO_NAME/STUDIO_URL/STUDIO_BOT_UA constants (#531)"
```

---

## Task 4 — Close anomaly-detection FK bug (already fixed)

**Model: Haiku**

**Why:** Roadmap item #532 describes a bug where `recordScanTime()` inserted a sentinel row with `workspace_id='__system__'`, violating the FK constraint on the `anomalies` table. Migration `045-anomaly-scan-tracker.sql` already fixed this by creating a dedicated `anomaly_scan_tracker` singleton table and deleting the old fake row. The code in `server/anomaly-detection.ts` already uses this table. This task is purely verification + roadmap closure — zero code changes.

**Files:** `data/roadmap.json` only

- [ ] **Step 1: Verify migration 045 exists and contains the fix**

```bash
cat server/db/migrations/045-anomaly-scan-tracker.sql
```

Expected: file exists, creates `anomaly_scan_tracker (id TEXT PRIMARY KEY DEFAULT 'singleton', last_scan_at TEXT NOT NULL)`, includes `DELETE FROM anomalies WHERE id = '__last_scan__'`.

- [ ] **Step 2: Verify recordScanTime() uses the new table (not the anomalies table)**

```bash
grep -n "recordScanTime\|__system__\|__last_scan__\|anomaly_scan_tracker" server/anomaly-detection.ts
```

Expected: `recordScanTime` writes to `anomaly_scan_tracker`. No `__system__` workspace_id writes present. A `__last_scan__` filter in `listAnomalies()` may still exist as a vestigial guard — that's harmless.

- [ ] **Step 3: Close roadmap item in data/roadmap.json**

Find item with `"id": 532`. Change `"status": "pending"` to `"status": "done"`. Add notes field:

```json
"notes": "Already fixed in migration 045-anomaly-scan-tracker.sql. Dedicated anomaly_scan_tracker singleton table replaces the fake sentinel row. listAnomalies() __last_scan__ filter is vestigial but harmless."
```

- [ ] **Step 4: Sort roadmap**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 5: Commit**

```bash
git add data/roadmap.json
git commit -m "chore: close roadmap #532 — anomaly scan tracker FK bug was fixed in migration 045"
```

---

## Task 5 — Typed data contracts audit (replace Record<string, unknown>)

**Model: Sonnet**

**Goal:** Find and replace `Record<string, unknown>` used as JSON column types or cross-layer data shapes with typed interfaces in `shared/types/`. Eliminates silent field-name bugs at schema boundaries.

**Verified by pre-plan audit:** 380+ matches exist across the codebase. Highest concentration:
- `server/analytics-intelligence.ts` — insight `data` field (the most impactful target)
- `server/analytics-insights-store.ts` — insight storage interface
- Various route handlers and hook response shapes

**Approach:** Tackle the insight `data` field first (it's the most impactful). Then workspace config JSON columns. One logical group per commit.

**Files owned:** `shared/types/analytics.ts`, `server/analytics-intelligence.ts`, `server/analytics-insights-store.ts` (and any additional files found during discovery)

### Step 5a — Discovery

- [ ] **Step 1: Run full audit**

```bash
grep -rn "Record<string, unknown>" server/ shared/ src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|dist" | sort > /tmp/record-audit.txt
wc -l /tmp/record-audit.txt
cat /tmp/record-audit.txt
```

Save this output — it's the full prioritized work list.

- [ ] **Step 2: Categorize findings**

For each match, classify as:
- **A: JSON column store** — `data: Record<string, unknown>` on a DB row interface → needs typed interface
- **B: Cross-layer payload** — in API response or broadcast payload → needs typed interface
- **C: Legitimate catch-all** — middleware, generic utilities, test helpers → leave as-is

Only A and B need fixing.

### Step 5b — Priority target: insight data field

- [ ] **Step 3: Write failing tests — assert insight data types**

Create `tests/unit/insight-data-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// These are compile-time tests — they verify the InsightDataMap is correctly typed.
// If an InsightType is removed or renamed, these fail at tsc time.
describe('InsightDataMap — typed data contracts', () => {
  it('page_speed entry has typed data shape (not Record<string,unknown>)', () => {
    // Import the type and verify a known field exists on it
    type PageSpeedData = import('../../shared/types/analytics.js').InsightDataMap['page_speed'];
    const data: PageSpeedData = { score: 85, lcp: 1.2, fid: 50, cls: 0.05 };
    expect(data.score).toBe(85);
  });

  it('keyword_opportunity entry has typed data shape', () => {
    type KwData = import('../../shared/types/analytics.js').InsightDataMap['keyword_opportunity'];
    const data: KwData = { keyword: 'seo tools', volume: 1200, difficulty: 45 };
    expect(data.keyword).toBe('seo tools');
  });
});
```

> Note: The actual field names depend on what's currently in `InsightDataMap`. Read `shared/types/analytics.ts` before writing these tests — adjust field names to match existing types. If `InsightDataMap` entries are currently typed as `Record<string, unknown>`, these tests will fail at compile time.

- [ ] **Step 4: Run tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/insight-data-types.test.ts 2>&1 | tail -15
```

Expected: TypeScript errors for unresolved property access on `Record<string, unknown>`.

- [ ] **Step 5: Read existing InsightDataMap and identify untyped entries**

```bash
grep -n "InsightDataMap\|Record<string" shared/types/analytics.ts | head -30
```

For each entry that is `Record<string, unknown>`, identify all call sites that construct that insight type:

```bash
grep -rn "type: 'page_speed'\|type: 'keyword_opportunity'" server/ --include="*.ts"
```

Use the actual field names from call sites to define the typed interface.

- [ ] **Step 6: Add typed interfaces for each untyped InsightDataMap entry**

Pattern (repeat for each insight type):

```typescript
// In shared/types/analytics.ts — add the interface:
export interface PageSpeedInsightData {
  score: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  previousScore?: number;
}

// In InsightDataMap — replace Record<string, unknown>:
export type InsightDataMap = {
  page_speed: PageSpeedInsightData;
  keyword_opportunity: KeywordOpportunityInsightData;
  // ... etc
};
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/unit/insight-data-types.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 8: Add JSDoc unit-of-measure annotations where needed**

Per CLAUDE.md: any percentage field must be annotated:

```typescript
/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
changePct?: number;
```

Search for any numeric field named `*Pct`, `*Rate`, `*Percent` in the new interfaces and add the annotation.

- [ ] **Step 9: Full compile + test suite**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck && npx vitest run 2>&1 | tail -20
```

Expected: zero errors, all tests pass.

- [ ] **Step 10: Update Zod schemas in server/schemas/insight-schemas.ts**

**CLAUDE.md requirement:** "adding a value to InsightType requires all four of these: (1) InsightType union, (2) typed XData interface + InsightDataMap entry — never `Record<string,unknown>`, (3) Zod schema in `server/schemas/`, (4) frontend renderer case." For each `InsightDataMap` entry you typed in Step 6, update the corresponding Zod schema in `server/schemas/insight-schemas.ts` so `parseJsonSafe` validates the new shape correctly.

Pattern:
```typescript
// BEFORE — if existing schema used z.record(z.unknown()) or z.any():
export const pageSpeedInsightDataSchema = z.record(z.unknown());

// AFTER — must match the TypeScript interface exactly:
export const pageSpeedInsightDataSchema = z.object({
  score: z.number(),
  lcp: z.number().optional(),
  fid: z.number().optional(),
  cls: z.number().optional(),
  previousScore: z.number().optional(),
});
```

Run grep to find all schemas that need updating:
```bash
grep -n "z\.record\|z\.unknown\|z\.any()" server/schemas/insight-schemas.ts
```

- [ ] **Step 11: Full compile + test suite**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck && npx vitest run 2>&1 | tail -20
```

Expected: zero errors, all tests pass.

- [ ] **Step 12: Update roadmap and commit**

Mark roadmap item `522` as `"done"`. Run `npx tsx scripts/sort-roadmap.ts`.

```bash
git add shared/types/analytics.ts server/analytics-intelligence.ts server/analytics-insights-store.ts \
        server/schemas/insight-schemas.ts \
        tests/unit/insight-data-types.test.ts data/roadmap.json
git commit -m "refactor(types): replace Record<string,unknown> with typed interfaces for insight data shapes (#522)"
```

> If additional areas were typed (workspace config, etc.), add those files to the commit.

---

## Task 6 — Incremental strategy updates (re-analyze changed pages only)

**Model: Sonnet**

**Goal:** Add a `mode: 'incremental'` option to the keyword strategy trigger that only re-analyzes pages where `analysis_generated_at` is stale (> 7 days old) or missing. Preserves existing keyword assignments for fresh pages. Reduces SEMRush API calls 50–70% on subsequent runs.

**Verified by pre-plan audit:**
- `page_keywords` table has `analysis_generated_at` column — confirmed in migration 024
- `replaceAllPageKeywords()` is called at lines 1742 and 1925 in `server/routes/keyword-strategy.ts` — both must be guarded
- `competitorLastFetchedAt` field does NOT yet exist on `Workspace` — must be added to workspaces table/interface
- Frontend trigger is `POST /api/webflow/keyword-strategy/{wsId}` with SSE streaming

**Files owned:** `server/routes/keyword-strategy.ts`, `server/workspaces.ts`, strategy UI component (find with: `grep -rn "Regenerate\|generateStrategy\|triggerStrategy" src/components/ --include="*.tsx" -l`), `tests/integration/keyword-strategy-incremental.test.ts`

### Step 6a — Server: incremental mode

- [ ] **Step 1: Locate exact strategy entry point and current mode handling**

```bash
grep -n "mode\|incremental\|full\|generateStrategy\|replaceAllPage" server/routes/keyword-strategy.ts | head -30
```

```bash
grep -rn "Regenerate\|keyword.strategy\|triggerStrategy" src/components/ --include="*.tsx" -l
```

Note the exact handler, Zod schema name, and where `replaceAllPageKeywords` is called (lines 1742 and 1925).

- [ ] **Step 2: Write failing integration tests**

Create `tests/integration/keyword-strategy-incremental.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers';
import Database from 'better-sqlite3';

const { postJson, cleanup, dbPath } = createTestContext(13315);

describe('Incremental strategy mode', () => {
  let workspaceId: string;
  let db: InstanceType<typeof Database>;

  beforeAll(async () => {
    const res = await postJson('/api/workspaces', { name: 'Incremental Strategy Test' });
    const ws = await res.json();
    workspaceId = ws.id;
    db = new Database(dbPath);
  });

  afterAll(async () => {
    db.close();
    await cleanup();
  });

  it('incremental mode: pages with recent analysis_generated_at are excluded from re-analysis batch', async () => {
    // Seed a page with analysis_generated_at = now (fresh)
    const recentDate = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO page_keywords (workspace_id, page_path, primary_keyword, analysis_generated_at)
      VALUES (?, '/fresh-page', 'existing keyword', ?)`).run(workspaceId, recentDate);

    // Trigger incremental strategy
    const res = await postJson(`/api/webflow/keyword-strategy/${workspaceId}`, { mode: 'incremental' });
    expect(res.ok).toBe(true);

    // Fresh page's keyword must be preserved
    const row = db.prepare(`SELECT primary_keyword FROM page_keywords WHERE workspace_id = ? AND page_path = ?`)
      .get(workspaceId, '/fresh-page') as { primary_keyword: string } | undefined;
    expect(row?.primary_keyword).toBe('existing keyword');
  });

  it('incremental mode: pages with stale analysis_generated_at (8 days ago) ARE included', async () => {
    // Seed a page with analysis_generated_at = 8 days ago (stale)
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT OR REPLACE INTO page_keywords (workspace_id, page_path, primary_keyword, analysis_generated_at)
      VALUES (?, '/stale-page', 'old keyword', ?)`).run(workspaceId, staleDate);

    // After incremental run, analysis_generated_at on this page should be updated
    const res = await postJson(`/api/webflow/keyword-strategy/${workspaceId}`, { mode: 'incremental' });
    expect(res.ok).toBe(true);

    const row = db.prepare(`SELECT analysis_generated_at FROM page_keywords WHERE workspace_id = ? AND page_path = ?`)
      .get(workspaceId, '/stale-page') as { analysis_generated_at: string } | undefined;
    // Timestamp should be updated (more recent than staleDate)
    if (row) {
      expect(new Date(row.analysis_generated_at) > new Date(staleDate)).toBe(true);
    }
  });

  it('full mode: analyzes all pages regardless of analysis_generated_at', async () => {
    // Seed a fresh page
    const recentDate = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO page_keywords (workspace_id, page_path, primary_keyword, analysis_generated_at)
      VALUES (?, '/fresh-page-full', 'recent keyword', ?)`).run(workspaceId, recentDate);

    // Full mode should still replace all keywords
    const res = await postJson(`/api/webflow/keyword-strategy/${workspaceId}`, { mode: 'full' });
    expect(res.ok).toBe(true);
    // (fresh page's analysis_generated_at gets updated on full run)
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/integration/keyword-strategy-incremental.test.ts 2>&1 | tail -20
```

Expected: tests fail (no `mode` param accepted yet, no incremental filtering).

- [ ] **Step 4: Add `mode` to strategy trigger Zod schema**

In `server/routes/keyword-strategy.ts`, find the request validation schema for the strategy trigger (the POST to `/keyword-strategy/:workspaceId`). Add `mode`:

```typescript
const strategyTriggerSchema = z.object({
  // ... keep all existing fields ...
  mode: z.enum(['full', 'incremental']).default('full'),
});
```

- [ ] **Step 5: Add `competitorLastFetchedAt` to Workspace**

First check if it exists:
```bash
grep -n "competitorLastFetchedAt" server/workspaces.ts
```

If absent, add the field in `server/workspaces.ts`:
1. Add `competitorLastFetchedAt?: string | null` to the `Workspace` interface
2. Add `competitor_last_fetched_at TEXT` to the workspaces table schema (check if a migration is needed or if this can be an `ALTER TABLE` in a new migration file: `server/db/migrations/047-workspace-competitor-fetch.sql`)
3. Add the column to the `rowToWorkspace()` mapper: `competitorLastFetchedAt: row.competitor_last_fetched_at ?? null`
4. Update `getWorkspace()` SELECT to include the new column (or verify it uses `SELECT *`)

- [ ] **Step 6: Implement page filtering helper**

In `server/routes/keyword-strategy.ts`, add near the top of the file (before the route handlers):

```typescript
const INCREMENTAL_THRESHOLD_DAYS = 7;
const COMPETITOR_CACHE_DAYS = 7;

function getPagesNeedingAnalysis(
  allPages: PageForAnalysis[],
  mode: 'full' | 'incremental',
): { toAnalyze: PageForAnalysis[]; toPreserve: PageForAnalysis[] } {
  if (mode === 'full') {
    return { toAnalyze: allPages, toPreserve: [] };
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INCREMENTAL_THRESHOLD_DAYS);
  const cutoffIso = cutoff.toISOString();

  const toAnalyze: PageForAnalysis[] = [];
  const toPreserve: PageForAnalysis[] = [];
  for (const page of allPages) {
    if (!page.analysisGeneratedAt || page.analysisGeneratedAt < cutoffIso) {
      toAnalyze.push(page);
    } else {
      toPreserve.push(page);
    }
  }
  return { toAnalyze, toPreserve };
}

function shouldFetchCompetitorData(ws: Workspace): boolean {
  if (!ws.competitorLastFetchedAt) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPETITOR_CACHE_DAYS);
  return new Date(ws.competitorLastFetchedAt) < cutoff;
}
```

- [ ] **Step 7: Guard replaceAllPageKeywords at lines 1742 and 1925**

At each call site of `replaceAllPageKeywords()`, replace the call with mode-aware logic.

**CLAUDE.md requirement:** "Multi-step DB mutations must use `db.transaction()`." The incremental path loops over pages and calls `upsertPageKeywordsForPage` for each — this is a multi-row write that must be wrapped in a transaction to prevent partial-write state.

```typescript
import { db } from '../db/index.js'; // verify exact db import path used in this file

// BEFORE:
replaceAllPageKeywords(workspaceId, allKeywords);

// AFTER:
if (mode === 'full') {
  replaceAllPageKeywords(workspaceId, allKeywords); // already handles its own transaction
} else {
  // Incremental: only upsert keywords for re-analyzed pages, wrapped in a transaction
  // to prevent partial writes if the operation is interrupted.
  const doIncrementalUpdate = db.transaction(() => {
    for (const [pageId, keywords] of analyzedKeywordsByPage) {
      upsertPageKeywordsForPage(workspaceId, pageId, keywords);
    }
  });
  doIncrementalUpdate();
  // Pages in toPreserve are untouched — their existing rows remain
}
```

> Check what `upsertPageKeywordsForPage` is called in the existing codebase. If it doesn't exist, look for the underlying insert/update pattern used for individual pages and extract it.

- [ ] **Step 8: Persist competitorLastFetchedAt after competitor fetch**

Find where competitor data is fetched. After a successful fetch, update the workspace:

```typescript
await updateWorkspace(workspaceId, { competitorLastFetchedAt: new Date().toISOString() });
```

- [ ] **Step 9: Run integration tests to verify they pass**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx vitest run tests/integration/keyword-strategy-incremental.test.ts 2>&1 | tail -15
```

Expected: all 3 PASS.

### Step 6b — Frontend: "Update changed pages" button

- [ ] **Step 10: Locate the strategy trigger component**

```bash
grep -rn "Regenerate\|keyword-strategy\|triggerStrategy\|mode.*full\|mode.*incremental" src/components/ --include="*.tsx" -l
```

Open the identified component.

- [ ] **Step 11: Add "Update changed pages" button**

Find the existing "Regenerate Strategy" button. Add a secondary button adjacent to it:

```tsx
<button
  onClick={() => triggerStrategy({ mode: 'incremental' })}
  disabled={isGenerating}
  title="Re-analyzes only pages modified in the last 7 days. Faster and lower cost than a full regeneration."
  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-50"
>
  Update changed pages
</button>
```

Ensure `triggerStrategy` passes `mode` to the POST endpoint. If the mutation hook doesn't accept `mode` yet, update the hook to pass it through.

- [ ] **Step 12: Full compile + test suite**

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck && npx vitest run 2>&1 | tail -20
```

Expected: zero TypeScript errors, all tests pass.

- [ ] **Step 13: Update roadmap, FEATURE_AUDIT, and commit**

Mark roadmap item `376` as `"done"`. Run `npx tsx scripts/sort-roadmap.ts`.

Update `FEATURE_AUDIT.md` — add/update entry for incremental keyword strategy mode.

```bash
git add server/routes/keyword-strategy.ts server/workspaces.ts \
        server/db/migrations/047-workspace-competitor-fetch.sql \
        src/components/ \
        tests/integration/keyword-strategy-incremental.test.ts \
        data/roadmap.json FEATURE_AUDIT.md
git commit -m "feat(strategy): add incremental update mode — re-analyze only stale pages, cache competitor data (#376)"
```

---

## Post-tasks quality gates

Run after all parallel tasks complete and diffs are reviewed:

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes (not just new tests)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (hardcoded strings rule should now pass for all 8 files)
- [ ] No `violet` or `indigo` introduced in `src/components/`
- [ ] `FEATURE_AUDIT.md` updated — Task 2 (addActivity backfill on 5 portal endpoints) + Task 6 (incremental strategy)
- [ ] `data/features.json` — Task 1 enables the **Brand tab** which is client-impactful; add/update its entry. Task 6 (incremental strategy) is an operational improvement — add if considered sales-relevant.
- [ ] `data/roadmap.json` updated — items #531, #532, #535, #376, #522 all marked `"done"`
- [ ] `npx tsx scripts/sort-roadmap.ts` run after roadmap updates
- [ ] Invoke `superpowers:requesting-code-review` on final diff before opening PR
- [ ] PR targets **`staging`** first — never merge directly to `main`. Verify on staging deploy before merging `staging → main`.

---

## Diff review checklist (after parallel batch completes)

Before merging:

```bash
# Check for duplicate imports introduced by parallel agents
git diff HEAD -- server/routes/public-portal.ts server/activity-log.ts | grep "^+.*import"
git diff HEAD -- server/routes/webflow-seo.ts server/routes/jobs.ts | grep "^+.*import"

# Verify no agent accidentally touched a shared file it didn't own
git diff HEAD --name-only | sort

# Quick smoke test
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx tsc --noEmit --skipLibCheck && npx vitest run 2>&1 | tail -5
```
