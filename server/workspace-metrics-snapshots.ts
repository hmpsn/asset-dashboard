// server/workspace-metrics-snapshots.ts
//
// Phase 2.5c — weekly metric snapshots per workspace.
//
// Backs the "best week since X" anchors in briefing dataReceipt lines.
// One row per (workspace, snapshot_date) — the briefing cron writes one
// snapshot per workspace per week, recording the metrics that drove that
// week's pulse data. 90-day rolling retention enforced at write time.
//
// All metric fields are nullable on the row: a workspace may have GSC but
// no GA4 for a given week, or audit data may be stale. Null means "not
// measured", not "zero". Anchor computation skips null values.
//
// Migration: server/db/migrations/079-workspace-metrics-snapshots.sql

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { computeROI } from './roi.js';
import { getLatestSnapshot } from './reports.js';
import { getSearchOverview } from './search-console.js';
import { getWorkspace } from './workspaces.js';

const log = createLogger('workspace-metrics-snapshots');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;

/** The metrics captured in a single weekly snapshot. All optional. */
export interface SnapshotMetrics {
  totalClicks?: number | null;
  totalImpressions?: number | null;
  avgPosition?: number | null;
  auditScore?: number | null;
  organicTrafficValue?: number | null;
}

/**
 * A persisted snapshot row. `snapshotDate` is the YYYY-MM-DD Monday UTC
 * key — matches `BriefingDraft.weekOf` so anchors align with briefing rows.
 */
export interface MetricsSnapshot {
  id: number;
  workspaceId: string;
  snapshotDate: string;
  totalClicks: number | null;
  totalImpressions: number | null;
  avgPosition: number | null;
  auditScore: number | null;
  organicTrafficValue: number | null;
  computedAt: number;
}

/** Numeric metric columns the anchor formatter can query. */
export type SnapshotMetricName =
  | 'total_clicks'
  | 'total_impressions'
  | 'avg_position'
  | 'audit_score'
  | 'organic_traffic_value';

interface SnapshotRow {
  id: number;
  workspace_id: string;
  snapshot_date: string;
  total_clicks: number | null;
  total_impressions: number | null;
  avg_position: number | null;
  audit_score: number | null;
  organic_traffic_value: number | null;
  computed_at: number;
}

const stmts = createStmtCache(() => ({
  // INSERT … ON CONFLICT DO UPDATE keeps writes idempotent — if the cron
  // re-runs in the same week (manual generate-now, retry after defer) the
  // row is overwritten with the latest measurements rather than duplicated.
  upsert: db.prepare(`
    INSERT INTO workspace_metrics_snapshots (
      workspace_id, snapshot_date,
      total_clicks, total_impressions, avg_position, audit_score, organic_traffic_value,
      computed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, snapshot_date) DO UPDATE SET
      total_clicks          = excluded.total_clicks,
      total_impressions     = excluded.total_impressions,
      avg_position          = excluded.avg_position,
      audit_score           = excluded.audit_score,
      organic_traffic_value = excluded.organic_traffic_value,
      computed_at           = excluded.computed_at
    RETURNING *
  `),
  // Latest N days of snapshots for a workspace, newest first. Used by the
  // anchor formatter and (eventually) by debugging UIs.
  listRecent: db.prepare(`
    SELECT * FROM workspace_metrics_snapshots
    WHERE workspace_id = ? AND snapshot_date >= ?
    ORDER BY snapshot_date DESC
  `),
  // Find the most recent snapshot date STRICTLY BEFORE which the workspace's
  // current value would be a new high (or new low for avg_position) — i.e.
  // the date that bounds the "best since X" window. Implementation: select
  // the latest snapshot in the retention window whose value beats `current`,
  // then return its date. The anchor's `sinceDate` is that row's date + 1
  // (the next snapshot is the first time current was the best). Caller
  // handles the +1 day arithmetic; this query just returns the comparator row.
  //
  // We return ALL rows in the window so the caller can apply min/max with
  // the right comparator (lower-is-better for avg_position vs higher-is-
  // better for clicks/impressions/score/value). Keeps the SQL simple and
  // correct across metric semantics.
  listInWindow: db.prepare(`
    SELECT * FROM workspace_metrics_snapshots
    WHERE workspace_id = ? AND snapshot_date >= ?
    ORDER BY snapshot_date ASC
  `),
  pruneBefore: db.prepare(`
    DELETE FROM workspace_metrics_snapshots
    WHERE workspace_id = ? AND snapshot_date < ?
  `),
}));

function rowToSnapshot(row: SnapshotRow): MetricsSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    snapshotDate: row.snapshot_date,
    totalClicks: row.total_clicks,
    totalImpressions: row.total_impressions,
    avgPosition: row.avg_position,
    auditScore: row.audit_score,
    organicTrafficValue: row.organic_traffic_value,
    computedAt: row.computed_at,
  };
}

/**
 * Format a JS Date as YYYY-MM-DD in UTC. Used to derive `snapshot_date`
 * from a `weekOf` ISO date string OR from `Date.now()` when callers don't
 * supply a date. Matches BriefingDraft.weekOf format.
 */
function toDateKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Subtract `days` days from a YYYY-MM-DD key, return YYYY-MM-DD. */
function shiftDateKey(dateKey: string, days: number): string {
  const t = Date.parse(`${dateKey}T00:00:00Z`);
  return toDateKey(new Date(t + days * DAY_MS));
}

export interface RecordSnapshotParams {
  workspaceId: string;
  /** YYYY-MM-DD; defaults to today in UTC. */
  snapshotDate?: string;
  metrics: SnapshotMetrics;
}

/**
 * Persist a snapshot. Idempotent per (workspaceId, snapshotDate) — re-runs
 * within the same date overwrite the row. Returns the persisted row.
 */
export function recordSnapshot(params: RecordSnapshotParams): MetricsSnapshot {
  const date = params.snapshotDate ?? toDateKey(new Date());
  const m = params.metrics;
  const row = stmts().upsert.get(
    params.workspaceId,
    date,
    m.totalClicks ?? null,
    m.totalImpressions ?? null,
    m.avgPosition ?? null,
    m.auditScore ?? null,
    m.organicTrafficValue ?? null,
    Date.now(),
  ) as SnapshotRow;
  return rowToSnapshot(row);
}

/**
 * Return the latest `days` of snapshots for a workspace, newest first.
 * Defaults to 90 days (matches the retention window).
 */
export function getSnapshots(workspaceId: string, days = DEFAULT_RETENTION_DAYS): MetricsSnapshot[] {
  const since = shiftDateKey(toDateKey(new Date()), -days);
  const rows = stmts().listRecent.all(workspaceId, since) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

/**
 * Find the most recent snapshot date BEFORE which the given `current` value
 * would be the best in the window. Returns the date string after which the
 * current value reigns, or `null` when:
 *   - the metric column is null in every row (insufficient data)
 *   - there's no row beating current in the window (current isn't a new best)
 *   - the window has fewer than 2 snapshots (insufficient history for anchor)
 *
 * Comparator depends on the metric: lower-is-better for `avg_position`,
 * higher-is-better for clicks / impressions / audit_score / organic value.
 *
 * Returns `{ sinceDate }` — caller formats the human phrase ("best week
 * since Mar 17") in `briefing-anchors.ts` to keep the SQL layer formatting-
 * agnostic.
 */
export function getBestValueSinceDate(
  workspaceId: string,
  metricName: SnapshotMetricName,
  current: number,
  windowDays = DEFAULT_RETENTION_DAYS,
): { sinceDate: string } | null {
  const since = shiftDateKey(toDateKey(new Date()), -windowDays);
  const rows = stmts().listInWindow.all(workspaceId, since) as SnapshotRow[];

  // Insufficient history: anchor phrasing requires at least one prior reading
  // to compare against. With 0 or 1 rows the user has no "since when" frame.
  if (rows.length < 2) return null;

  const lowerIsBetter = metricName === 'avg_position';
  const beats = (a: number, b: number) => (lowerIsBetter ? a < b : a > b);

  // Walk newest → oldest. The anchor is "best since the most recent row that
  // beats `current`". If no row in the window beats `current`, then `current`
  // is the best across the whole window — but that's only anchor-worthy if
  // there's at least one prior reading. Use the OLDEST row's date as the
  // "since" floor in that case.
  let bestSinceDate: string | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = readMetric(rows[i], metricName);
    if (v == null) continue;
    if (beats(v, current)) {
      // This older snapshot already beat current — anchor is the day AFTER
      // this row's date. Caller computes "best since {sinceDate}" where
      // sinceDate is exclusive (most recently surpassed).
      bestSinceDate = rows[i].snapshot_date;
      break;
    }
  }

  if (bestSinceDate === null) {
    // current is best across the entire window. Anchor since the earliest
    // row's date — meaning "current is the best in the past N weeks of
    // observable data". Skip anchoring if the window is too short to be
    // editorially meaningful (< 4 weeks).
    if (rows.length < 4) return null;
    return { sinceDate: rows[0].snapshot_date };
  }

  return { sinceDate: bestSinceDate };
}

function readMetric(row: SnapshotRow, name: SnapshotMetricName): number | null {
  switch (name) {
    case 'total_clicks':          return row.total_clicks;
    case 'total_impressions':     return row.total_impressions;
    case 'avg_position':          return row.avg_position;
    case 'audit_score':           return row.audit_score;
    case 'organic_traffic_value': return row.organic_traffic_value;
  }
}

/**
 * Drop snapshots older than `retentionDays` for a workspace. Called at the
 * end of `recordSnapshot` flow (or on a separate sweep) to keep the table
 * bounded. 90 days = 12-13 snapshots per workspace at weekly cadence.
 */
export function pruneOld(workspaceId: string, retentionDays = DEFAULT_RETENTION_DAYS): number {
  const cutoff = shiftDateKey(toDateKey(new Date()), -retentionDays);
  const result = stmts().pruneBefore.run(workspaceId, cutoff);
  if (result.changes > 0) {
    log.info({ workspaceId, deletedRows: result.changes, retentionDays }, 'pruned old snapshots');
  }
  return result.changes;
}

/**
 * Cron-orchestrated snapshot. Pulls the metrics that drove this week's
 * briefing pulse data — GSC overview, audit snapshot score, ROI traffic
 * value — and persists a single row keyed on (workspaceId, weekOf).
 *
 * Invoked by `briefing-cron.ts` at the end of a successful generation. All
 * collectors are individually try/catch'd: a missing GSC connection or a
 * failing ROI computation shouldn't block snapshot persistence — null
 * fields are fine and anchor computation skips them.
 *
 * @param workspaceId  the workspace
 * @param weekOf       YYYY-MM-DD of the briefing week (used as snapshot_date)
 * @returns the persisted snapshot, or null when the workspace can't be found
 */
export async function recordWeeklyBriefingSnapshot(
  workspaceId: string,
  weekOf: string,
): Promise<MetricsSnapshot | null> {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    log.warn({ workspaceId }, 'recordWeeklyBriefingSnapshot: workspace not found');
    return null;
  }

  const metrics: SnapshotMetrics = {
    totalClicks: null,
    totalImpressions: null,
    avgPosition: null,
    auditScore: null,
    organicTrafficValue: null,
  };

  // GSC overview (28-day window matches the client Pulse strip default —
  // anchors compare like to like). Skip silently when GSC isn't connected
  // OR when there's no webflowSiteId (token lookup uses webflowSiteId, not
  // workspaceId — a Devin-flagged bug from the original 2.5c diff that
  // would have silently nulled every GSC metric capture). Mirror the
  // guard pattern used by routes/workspace-home.ts and admin-chat-context.
  if (ws.webflowSiteId && ws.gscPropertyUrl) {
    try {
      const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, 28);
      metrics.totalClicks = overview.totalClicks;
      metrics.totalImpressions = overview.totalImpressions;
      metrics.avgPosition = overview.avgPosition;
    } catch (err) {
      log.warn({ workspaceId, err: String(err) }, 'snapshot: GSC unavailable');
    }
  }

  // Audit score from the latest snapshot. Survives stale audits — the
  // anchor formatter just uses what's most recent at briefing time.
  if (ws.webflowSiteId) {
    try {
      const audit = getLatestSnapshot(ws.webflowSiteId);
      if (audit) metrics.auditScore = audit.audit.siteScore;
    } catch (err) {
      log.warn({ workspaceId, err: String(err) }, 'snapshot: audit unavailable');
    }
  }

  // ROI traffic value — the dollar-equivalent organic traffic. Already
  // stored in roi_snapshots historically, but mirroring it here keeps
  // anchor queries on a single table.
  try {
    const roi = computeROI(workspaceId);
    if (roi) metrics.organicTrafficValue = roi.organicTrafficValue;
  } catch (err) {
    log.warn({ workspaceId, err: String(err) }, 'snapshot: ROI unavailable');
  }

  const snapshot = recordSnapshot({ workspaceId, snapshotDate: weekOf, metrics });

  // Opportunistic prune — keeps the table bounded without a separate cron.
  // 90-day retention = 12-13 snapshots per workspace. Pruning is cheap
  // (single DELETE WHERE) and rarely deletes anything most weeks.
  pruneOld(workspaceId);

  log.info(
    {
      workspaceId,
      weekOf,
      hasClicks: metrics.totalClicks != null,
      hasAuditScore: metrics.auditScore != null,
      hasROI: metrics.organicTrafficValue != null,
    },
    'snapshot recorded',
  );

  return snapshot;
}
