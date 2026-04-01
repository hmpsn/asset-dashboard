# Bridge Infrastructure Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three systemic root causes in bridge infrastructure that produced 8+ bugs in PR #118 review, before adding more bridges in Phase 3A Tasks 4–17.

**Architecture:** Three independent fixes: (1) store-layer stale-cleanup protection that doesn't abuse `resolveInsight`, (2) composable score adjustments via a `_scoreAdjustments` map, (3) infrastructure-level broadcast with change-tracking. Each fix is self-contained with its own migration/tests.

**Tech Stack:** SQLite migration, TypeScript, Vitest

---

## Dependency Graph

```
Task 1 (store layer) ──→ Task 3 (migrate bridge call sites)
Task 2 (score adjustments) ──→ Task 3 (migrate bridge call sites)
Task 4 (broadcast infra) is independent
Task 5 (tests) depends on all above
Task 6 (CLAUDE.md rules) depends on all above
```

Tasks 1, 2, and 4 can run in parallel. Task 3 is sequential (depends on 1+2). Task 5 is sequential (depends on all). Task 6 is sequential.

---

### Task 1: Store-layer stale-cleanup immunity via `bridge_source` column

**Problem:** Bridges call `resolveInsight(id, wsId, 'in_progress')` as a hack to protect their insights from `deleteStaleInsightsByType` (which deletes `WHERE resolution_status IS NULL`). This unconditionally overwrites admin resolutions.

**Solution:** Add a `bridge_source` column to `analytics_insights`. When non-null, it marks the insight as bridge-generated. Modify `deleteStaleInsightsByType` to also exclude rows where `bridge_source IS NOT NULL`. Bridges set `bridge_source` on upsert instead of calling `resolveInsight` post-hoc.

**Files:**
- Create: `server/db/migrations/044-insight-bridge-source.sql`
- Modify: `server/analytics-insights-store.ts` (InsightRow, upsert SQL, deleteStaleByType SQL, rowToInsight, UpsertInsightParams)
- Modify: `shared/types/analytics.ts` (AnalyticsInsight interface)

- [ ] **Step 1: Write migration**

```sql
-- 044-insight-bridge-source.sql
-- Add bridge_source column so bridge-generated insights survive stale cleanup
-- without abusing resolution_status. When non-null, deleteStaleInsightsByType skips the row.
ALTER TABLE analytics_insights ADD COLUMN bridge_source TEXT;
```

- [ ] **Step 2: Add `bridgeSource` to shared type**

In `shared/types/analytics.ts`, add to `AnalyticsInsight` interface:

```typescript
  /** When non-null, this insight was created/updated by a bridge. Survives stale cleanup. */
  bridgeSource?: string | null;
```

- [ ] **Step 3: Update InsightRow interface**

In `server/analytics-insights-store.ts`, add to `InsightRow`:

```typescript
  bridge_source: string | null;
```

- [ ] **Step 4: Update rowToInsight mapper**

Add to the `rowToInsight` function:

```typescript
  bridgeSource: row.bridge_source ?? null,
```

- [ ] **Step 5: Update UpsertInsightParams**

Add to `UpsertInsightParams`:

```typescript
  bridgeSource?: string | null;
```

- [ ] **Step 6: Update upsert SQL — add bridge_source to both INSERT and ON CONFLICT UPDATE**

Unlike `resolution_source`, `bridge_source` SHOULD be updated on conflict — when a bridge re-upserts an existing insight, it should refresh the bridge_source tag. Add `bridge_source` to both the INSERT column list and the ON CONFLICT UPDATE SET clause.

Bind it in `upsertInsight()`:

```typescript
bridge_source: params.bridgeSource ?? null,
```

- [ ] **Step 7: Update deleteStaleByType SQL**

Change the `deleteStaleByType` prepared statement from:

```sql
DELETE FROM analytics_insights WHERE workspace_id = ? AND insight_type = ? AND computed_at < ? AND resolution_status IS NULL
```

to:

```sql
DELETE FROM analytics_insights WHERE workspace_id = ? AND insight_type = ? AND computed_at < ? AND resolution_status IS NULL AND bridge_source IS NULL
```

This ensures bridge-generated insights survive stale cleanup regardless of resolution_status.

- [ ] **Step 8: Verify type-check passes**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 9: Commit**

```bash
git add server/db/migrations/044-insight-bridge-source.sql server/analytics-insights-store.ts shared/types/analytics.ts
git commit -m "feat: add bridge_source column for stale-cleanup immunity"
```

---

### Task 2: Composable score adjustments via `_scoreAdjustments` map

**Problem:** Bridge #1 stores `_outcomeBaseScore` and Bridge #10 stores `_anomalyBaseScore` independently. Each computes `impactScore` from its own base, ignoring the other. Last writer wins — scores oscillate.

**Solution:** Replace the independent `_outcomeBaseScore` / `_anomalyBaseScore` fields with a single `_scoreAdjustments` map in the data JSON. Each bridge writes only its own key. Final score = original base + sum(all adjustments). A shared helper function (`applyScoreAdjustment`) handles the read-compute-write pattern.

**Files:**
- Create: `server/insight-score-adjustments.ts`
- Test: `tests/unit/insight-score-adjustments.test.ts`

- [ ] **Step 1: Write failing test for `applyScoreAdjustment`**

```typescript
// tests/unit/insight-score-adjustments.test.ts
import { describe, it, expect } from 'vitest';
import { applyScoreAdjustment, computeAdjustedScore } from '../../server/insight-score-adjustments.js';

describe('applyScoreAdjustment', () => {
  it('applies a single adjustment from original base', () => {
    const data: Record<string, unknown> = {};
    const result = applyScoreAdjustment(data, 50, 'outcome', -10);
    expect(result.adjustedScore).toBe(40);
    expect(result.data._originalBaseScore).toBe(50);
    expect(result.data._scoreAdjustments).toEqual({ outcome: -10 });
  });

  it('preserves existing adjustments from other bridges', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { anomaly: 10 },
    };
    const result = applyScoreAdjustment(data, 60, 'outcome', -10);
    expect(result.data._originalBaseScore).toBe(50); // preserved, not overwritten
    expect(result.data._scoreAdjustments).toEqual({ anomaly: 10, outcome: -10 });
    expect(result.adjustedScore).toBe(50); // 50 + 10 + (-10) = 50
  });

  it('updates an existing adjustment for the same bridge', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10 },
    };
    const result = applyScoreAdjustment(data, 40, 'outcome', -20);
    expect(result.data._scoreAdjustments).toEqual({ outcome: -20 });
    expect(result.adjustedScore).toBe(30); // 50 + (-20) = 30
  });

  it('clamps score to 0-100 range', () => {
    const data: Record<string, unknown> = {};
    const low = applyScoreAdjustment(data, 5, 'outcome', -20);
    expect(low.adjustedScore).toBe(0);

    const high = applyScoreAdjustment({}, 95, 'anomaly', 10);
    expect(high.adjustedScore).toBe(100);
  });

  it('removes adjustment when delta is 0', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10 },
    };
    const result = applyScoreAdjustment(data, 40, 'outcome', 0);
    expect(result.data._scoreAdjustments).toEqual({});
    expect(result.adjustedScore).toBe(50); // back to base
  });
});

describe('computeAdjustedScore', () => {
  it('computes from base + all adjustments', () => {
    const data = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10, anomaly: 10 },
    };
    expect(computeAdjustedScore(data, 50)).toBe(50);
  });

  it('returns currentImpactScore when no adjustments exist', () => {
    expect(computeAdjustedScore({}, 70)).toBe(70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/insight-score-adjustments.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `applyScoreAdjustment`**

```typescript
// server/insight-score-adjustments.ts
/**
 * Composable score adjustment system for bridge-modified insights.
 *
 * Multiple bridges can independently adjust an insight's impactScore without
 * overwriting each other. Each bridge writes a named delta into _scoreAdjustments.
 * Final score = _originalBaseScore + sum(all deltas), clamped to [0, 100].
 *
 * Usage in bridges:
 *   const { data, adjustedScore } = applyScoreAdjustment(insight.data, insight.impactScore, 'outcome', -10);
 *   upsertInsight({ ...insight, data, impactScore: adjustedScore });
 */

interface ScoreAdjustmentResult {
  /** Updated data object with _originalBaseScore and _scoreAdjustments */
  data: Record<string, unknown>;
  /** Final clamped score: base + sum(adjustments) */
  adjustedScore: number;
}

/**
 * Apply a named score adjustment to an insight's data.
 *
 * @param currentData - The insight's current data JSON (may already contain adjustments)
 * @param currentImpactScore - The insight's current impactScore (used as base if no _originalBaseScore exists)
 * @param bridgeKey - Unique key for this bridge's adjustment (e.g., 'outcome', 'anomaly')
 * @param delta - Score delta to apply (positive = boost, negative = penalty). 0 removes the adjustment.
 */
export function applyScoreAdjustment(
  currentData: Record<string, unknown>,
  currentImpactScore: number,
  bridgeKey: string,
  delta: number,
): ScoreAdjustmentResult {
  // Preserve the original base score — only set it on first adjustment
  const originalBase = (typeof currentData._originalBaseScore === 'number')
    ? currentData._originalBaseScore
    : currentImpactScore;

  // Clone existing adjustments or start fresh
  const existingAdj = (
    currentData._scoreAdjustments != null &&
    typeof currentData._scoreAdjustments === 'object' &&
    !Array.isArray(currentData._scoreAdjustments)
  )
    ? { ...(currentData._scoreAdjustments as Record<string, number>) }
    : {};

  // Set or remove this bridge's adjustment
  if (delta === 0) {
    delete existingAdj[bridgeKey];
  } else {
    existingAdj[bridgeKey] = delta;
  }

  // Compute final score: base + sum(all adjustments)
  const totalDelta = Object.values(existingAdj).reduce((sum, d) => sum + d, 0);
  const adjustedScore = Math.max(0, Math.min(100, originalBase + totalDelta));

  return {
    data: {
      ...currentData,
      _originalBaseScore: originalBase,
      _scoreAdjustments: existingAdj,
    },
    adjustedScore,
  };
}

/**
 * Read-only: compute what the adjusted score would be from existing data.
 * Useful for display or comparison without mutating.
 */
export function computeAdjustedScore(
  data: Record<string, unknown>,
  currentImpactScore: number,
): number {
  if (typeof data._originalBaseScore !== 'number') return currentImpactScore;
  const adj = data._scoreAdjustments as Record<string, number> | undefined;
  if (!adj || typeof adj !== 'object') return currentImpactScore;
  const totalDelta = Object.values(adj).reduce((sum, d) => sum + d, 0);
  return Math.max(0, Math.min(100, data._originalBaseScore + totalDelta));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/insight-score-adjustments.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/insight-score-adjustments.ts tests/unit/insight-score-adjustments.test.ts
git commit -m "feat: composable score adjustment system for bridge-modified insights"
```

---

### Task 3: Migrate existing bridge call sites to new infrastructure

**Problem:** Bridges #1, #10, #12, #15 all use the old patterns (resolveInsight hack, independent base scores, manual broadcast tracking). Migrate them to use the new infrastructure from Tasks 1 and 2.

**Files:**
- Modify: `server/outcome-tracking.ts` (Bridge #1)
- Modify: `server/anomaly-detection.ts` (Bridge #10)
- Modify: `server/scheduled-audits.ts` (Bridges #12, #15)

- [ ] **Step 1: Migrate Bridge #12 (scheduled-audits.ts, page-level)**

Replace the `resolveInsight` hack with `bridgeSource` on upsert. Remove the `resolveInsight` call entirely.

Change the `upsertInsight` call at lines 162–174 to include `bridgeSource`:

```typescript
        const insight = upsertInsight({
          workspaceId: ws.id,
          insightType: 'audit_finding',
          pageId: page.pageId,
          pageTitle: page.page,
          severity: pageIssues.some(i => i.severity === 'error') ? 'critical' : 'warning',
          data: {
            scope: 'page',
            issueCount: pageIssues.length,
            issueMessages: pageIssues.map(i => i.message).join('; '),
            source: 'bridge_12_audit_page_health',
          },
          impactScore: pageIssues.some(i => i.severity === 'error') ? 80 : 50,
          bridgeSource: 'bridge_12_audit_page_health',
        });
```

Delete lines 176–182 (the `resolveInsight` call and its comment). Also remove `resolveInsight` from the import at line 144 (keep `upsertInsight` and `getInsights`).

Also fix the dedup check at line 157 — currently `resolutionStatus !== 'resolved'` lets resolved insights fall through and get un-resolved. Change to skip ANY existing non-resolved insight (the current behavior), but no longer need to worry about the resolveInsight overwrite since we removed it:

The dedup check stays the same (`i.resolutionStatus !== 'resolved'`), which means: if the admin resolved it, we re-create it (data refresh). If it's unresolved or in_progress, we skip it (dedup). This is the correct behavior now that we're not calling resolveInsight afterward.

- [ ] **Step 2: Migrate Bridge #15 (scheduled-audits.ts, site-level)**

Same pattern — add `bridgeSource`, remove `resolveInsight` call.

Change the `upsertInsight` call at lines 201–214 to include `bridgeSource`:

```typescript
        const insight = upsertInsight({
          workspaceId: ws.id,
          insightType: 'audit_finding',
          pageId: null,
          severity: score < 50 ? 'critical' : 'warning',
          data: {
            scope: 'site',
            issueCount: totalIssues,
            issueMessages: `Audit found ${totalIssues} total issues across the site. Overall health score: ${score}/100.`,
            siteScore: score,
            source: 'bridge_15_audit_site_health',
          },
          impactScore: Math.max(0, 100 - score),
          bridgeSource: 'bridge_15_audit_site_health',
        });
```

Delete lines 216–221 (the `resolveInsight` call and its comment). Also remove `resolveInsight` from the import at line 195.

- [ ] **Step 3: Migrate Bridge #1 (outcome-tracking.ts) to composable scores**

Replace the `_outcomeBaseScore` pattern with `applyScoreAdjustment`.

Add import at top of file:

```typescript
import { applyScoreAdjustment } from './insight-score-adjustments.js';
```

Replace the score adjustment block (lines 322–345) with:

```typescript
          for (const insight of nonResolved) {
            const scoreDelta = pageScoreMap.get(insight.pageId ?? '') ?? 0;
            if (scoreDelta !== 0) {
              const dataObj = (insight.data ?? {}) as Record<string, unknown>;
              const { data: newData, adjustedScore } = applyScoreAdjustment(
                dataObj, insight.impactScore ?? 50, 'outcome', scoreDelta,
              );
              if (adjustedScore !== insight.impactScore) {
                upsertInsight({
                  workspaceId: insight.workspaceId,
                  pageId: insight.pageId,
                  insightType: insight.insightType,
                  data: newData,
                  severity: insight.severity,
                  pageTitle: insight.pageTitle,
                  strategyKeyword: insight.strategyKeyword,
                  strategyAlignment: insight.strategyAlignment,
                  auditIssues: insight.auditIssues,
                  pipelineStatus: insight.pipelineStatus,
                  anomalyLinked: insight.anomalyLinked,
                  impactScore: adjustedScore,
                  domain: insight.domain,
                });
                modified++;
              }
            }
          }
```

- [ ] **Step 4: Migrate Bridge #10 (anomaly-detection.ts) to composable scores**

Same pattern. Add import:

```typescript
import { applyScoreAdjustment } from './insight-score-adjustments.js';
```

Replace the score adjustment block (lines 634–656) with:

```typescript
              const dataObj = (insight.data ?? {}) as Record<string, unknown>;
              const { data: newData, adjustedScore } = applyScoreAdjustment(
                dataObj, insight.impactScore ?? 50, 'anomaly', 10,
              );
              if (adjustedScore !== insight.impactScore) {
                updateInsight({
                  workspaceId: insight.workspaceId,
                  pageId: insight.pageId,
                  insightType: insight.insightType,
                  data: newData,
                  severity: insight.severity,
                  pageTitle: insight.pageTitle,
                  strategyKeyword: insight.strategyKeyword,
                  strategyAlignment: insight.strategyAlignment,
                  auditIssues: insight.auditIssues,
                  pipelineStatus: insight.pipelineStatus,
                  anomalyLinked: true,
                  impactScore: adjustedScore,
                  domain: insight.domain,
                });
                modified++;
              }
```

- [ ] **Step 5: Type-check and verify**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 6: Commit**

```bash
git add server/outcome-tracking.ts server/anomaly-detection.ts server/scheduled-audits.ts
git commit -m "refactor: migrate bridges to bridgeSource + composable score adjustments"
```

---

### Task 4: Infrastructure-level broadcast via `executeBridge` return value

**Problem:** Every bridge reimplements "track changes, broadcast conditionally." We've fixed this same bug 3 times.

**Solution:** Change `executeBridge` and `fireBridge` to accept a callback that returns `number` (modified count). The infrastructure broadcasts `INSIGHT_BRIDGE_UPDATED` automatically when `count > 0`. Bridge callbacks no longer handle their own broadcasts.

**Files:**
- Modify: `server/bridge-infrastructure.ts` (executeBridge, fireBridge, debounceBridge signatures)
- Modify: `server/outcome-tracking.ts` (Bridge #1 — remove manual broadcast)
- Modify: `server/anomaly-detection.ts` (Bridge #10 — remove manual broadcast)
- Modify: `server/scheduled-audits.ts` (Bridges #12, #15 — remove manual broadcast)

- [ ] **Step 1: Add `BridgeResult` type and update `executeBridge`**

In `server/bridge-infrastructure.ts`, add a result type and update the function:

```typescript
export interface BridgeResult {
  /** Number of insights/records modified. When > 0, infrastructure broadcasts automatically. */
  modified: number;
}
```

Change `executeBridge` signature:

```typescript
export async function executeBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: () => Promise<BridgeResult | void> | BridgeResult | void,
  opts?: BridgeOptions,
): Promise<void> {
```

After the `await Promise.race(...)` block resolves successfully (inside the try, after the existing `log.info`), add auto-broadcast logic:

```typescript
    // Auto-broadcast when bridge reports modifications
    if (result && typeof result === 'object' && 'modified' in result && result.modified > 0) {
      try {
        const { broadcastToWorkspace } = await import('./broadcast.js');
        const { WS_EVENTS } = await import('./ws-events.js');
        broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, { bridge: flag });
      } catch (bcErr) {
        log.warn({ flag, workspaceId, err: bcErr }, 'Bridge auto-broadcast failed');
      }
    }
```

Note: The existing `Promise.race` pattern needs adjustment since `fn` now returns a value. The race result needs to be captured:

```typescript
    const result = fn();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      // Async bridge — race against timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      let timedOut = false;
      const cleanup = () => clearTimeout(timeoutId);
      let bridgeResult: BridgeResult | void;
      await Promise.race([
        (result as Promise<BridgeResult | void>).then(
          (v) => { cleanup(); bridgeResult = v; },
          (e: unknown) => { cleanup(); if (!timedOut) throw e; },
        ),
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Bridge ${flag} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      // Auto-broadcast
      if (bridgeResult && bridgeResult.modified > 0) {
        try {
          const { broadcastToWorkspace } = await import('./broadcast.js');
          const { WS_EVENTS } = await import('./ws-events.js');
          broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, { bridge: flag });
        } catch (bcErr) {
          log.warn({ flag, workspaceId, err: bcErr }, 'Bridge auto-broadcast failed');
        }
      }
    } else if (result && typeof result === 'object' && 'modified' in result) {
      // Sync bridge that returned BridgeResult
      if ((result as BridgeResult).modified > 0) {
        const { broadcastToWorkspace } = await import('./broadcast.js');
        const { WS_EVENTS } = await import('./ws-events.js');
        broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, { bridge: flag });
      }
    }
```

- [ ] **Step 2: Update `debounceBridge` callback type**

Change the callback type in `debounceBridge`:

```typescript
export function debounceBridge(
  flag: FeatureFlagKey,
  delayMs: number,
): (workspaceId: string, fn: () => Promise<BridgeResult | void> | BridgeResult | void) => void {
```

And update the pending map type:

```typescript
  const pending = new Map<string, () => Promise<BridgeResult | void> | BridgeResult | void>();
```

- [ ] **Step 3: Migrate Bridge #1 — return modified count, remove manual broadcast**

In `server/outcome-tracking.ts`, the `debouncedOutcomeReweight` callback should return `{ modified: modifiedCount }` and remove the manual broadcast block:

```typescript
      debouncedOutcomeReweight(workspaceId, async () => {
        const modifiedCount = await withWorkspaceLock(workspaceId, async () => {
          // ... existing lock body unchanged ...
          return modified;
        });
        return { modified: modifiedCount };
      });
```

Delete the `if (modifiedCount > 0) { ... broadcast ... }` block (lines 352–356).

- [ ] **Step 4: Migrate Bridge #10 — return modified count, remove manual broadcast**

In `server/anomaly-detection.ts`:

```typescript
        debouncedAnomalyBoost(ws.id, async () => {
          let modified = 0;
          await withWorkspaceLock(ws.id, async () => {
            // ... existing lock body unchanged ...
          });
          return { modified };
        });
```

Delete the `if (modified > 0) { ... broadcast ... }` block (lines 661–665).

- [ ] **Step 5: Migrate Bridges #12 and #15 — return modified count, remove manual broadcast**

Bridge #12 in `server/scheduled-audits.ts`:

```typescript
    fireBridge('bridge-audit-page-health', ws.id, async () => {
      // ... existing body ...
      // At end, instead of manual broadcast:
      return { modified: created };
    });
```

Delete the `if (created > 0) { broadcastToWorkspace(...) }` block.

Bridge #15:

```typescript
    fireBridge('bridge-audit-site-health', ws.id, async () => {
      // ... existing body ...
      if (totalIssues > 0 && score < 70) {
        // ... upsert ...
        return { modified: 1 };
      }
      return { modified: 0 };
    });
```

Delete the manual `broadcastToWorkspace` call inside the if block.

Also remove the `broadcastToWorkspace` and `WS_EVENTS` imports from `scheduled-audits.ts` if no other code in the file uses them (check first — there may be other broadcast calls).

- [ ] **Step 6: Type-check and verify**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 7: Commit**

```bash
git add server/bridge-infrastructure.ts server/outcome-tracking.ts server/anomaly-detection.ts server/scheduled-audits.ts
git commit -m "refactor: auto-broadcast from bridge infrastructure, remove manual broadcast boilerplate"
```

---

### Task 5: Tests for all three fixes

**Files:**
- Modify: `tests/bridge-wiring.test.ts` (update source scans)
- Create: `tests/unit/bridge-infrastructure.test.ts` (broadcast auto-fire test)
- Modify: `tests/unit/insight-score-adjustments.test.ts` (already created in Task 2)

- [ ] **Step 1: Update bridge-wiring source scan tests**

Update `tests/bridge-wiring.test.ts`:

- Bridge #12 and #15 tests: verify `bridgeSource` appears in scheduled-audits.ts, verify `resolveInsight` does NOT appear in the bridge sections
- Bridge #1 and #10 tests: verify `applyScoreAdjustment` appears, verify `_outcomeBaseScore` / `_anomalyBaseScore` do NOT appear

```typescript
describe('Bridge infrastructure: bridgeSource pattern', () => {
  it('Bridge #12 uses bridgeSource instead of resolveInsight hack', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8');
    expect(src).toContain("bridgeSource: 'bridge_12_audit_page_health'");
    // The resolveInsight('in_progress') hack should be gone
    const bridge12Section = src.slice(src.indexOf('Bridge #12'), src.indexOf('Bridge #15'));
    expect(bridge12Section).not.toContain("resolveInsight(insight.id");
  });

  it('Bridge #15 uses bridgeSource instead of resolveInsight hack', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8');
    expect(src).toContain("bridgeSource: 'bridge_15_audit_site_health'");
    const bridge15Section = src.slice(src.indexOf('Bridge #15'));
    expect(bridge15Section).not.toContain("resolveInsight(insight.id");
  });
});

describe('Bridge infrastructure: composable score adjustments', () => {
  it('Bridge #1 uses applyScoreAdjustment instead of _outcomeBaseScore', () => {
    const src = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8');
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_outcomeBaseScore');
  });

  it('Bridge #10 uses applyScoreAdjustment instead of _anomalyBaseScore', () => {
    const src = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8');
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_anomalyBaseScore');
  });
});

describe('Bridge infrastructure: auto-broadcast', () => {
  it('no bridge callback manually imports broadcastToWorkspace', () => {
    // Bridge callbacks should return { modified: N } and let infrastructure broadcast
    const outcomeTrackingSrc = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8');
    const anomalyDetectionSrc = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8');

    // Check that the bridge callback sections don't contain manual broadcast imports
    // (Other parts of these files may still use broadcastToWorkspace for non-bridge purposes)
    const bridge1Section = outcomeTrackingSrc.slice(
      outcomeTrackingSrc.indexOf('Bridge #1'),
      outcomeTrackingSrc.indexOf('return rowToActionOutcome'),
    );
    expect(bridge1Section).not.toContain('broadcastToWorkspace');
    expect(bridge1Section).toContain('return { modified');

    const bridge10Section = anomalyDetectionSrc.slice(
      anomalyDetectionSrc.indexOf('Bridge #10'),
      anomalyDetectionSrc.indexOf('} catch (err)'),
    );
    expect(bridge10Section).not.toContain('broadcastToWorkspace');
    expect(bridge10Section).toContain('return { modified');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add tests/bridge-wiring.test.ts
git commit -m "test: add bridge infrastructure hardening verification tests"
```

---

### Task 6: Update CLAUDE.md with bridge authoring rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add bridge authoring rules to Code Conventions section**

Add after the existing "Feedback loop completeness" rule:

```markdown
- **Bridge authoring rules** — all bridges must follow these patterns. Violations produce recurring bugs:
  1. **Stale-cleanup immunity**: pass `bridgeSource: '<bridge_flag>'` to `upsertInsight()`. Never call `resolveInsight('in_progress')` as a cleanup-protection hack — it overwrites admin resolutions.
  2. **Score adjustments**: use `applyScoreAdjustment()` from `server/insight-score-adjustments.ts`. Never store independent `_*BaseScore` fields — they don't compose across bridges.
  3. **Broadcast**: return `{ modified: N }` from bridge callbacks. Never manually import/call `broadcastToWorkspace` inside a bridge — `executeBridge` handles it automatically.
  4. **Resolution respect**: never call `resolveInsight()` inside a bridge callback unless the bridge's explicit purpose is resolution management.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add bridge authoring rules to CLAUDE.md"
```

---

## Verification

After all tasks:

```bash
npx tsc --noEmit --skipLibCheck    # zero errors
npx vite build                      # builds
npx vitest run                      # all tests pass
```

Grep verifications:

```bash
# No resolveInsight('in_progress') hack remaining in bridge contexts
grep -n "resolveInsight.*in_progress" server/scheduled-audits.ts  # should be empty

# No independent base scores remaining
grep -n "_outcomeBaseScore\|_anomalyBaseScore" server/  # should be empty

# No manual broadcastToWorkspace inside bridge callbacks
# (manual check — some files may still use broadcast for non-bridge purposes)
```
