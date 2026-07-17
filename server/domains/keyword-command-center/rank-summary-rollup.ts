import { z } from 'zod';

import type {
  KeywordRankKpiPeriod,
  KeywordRankKpis,
} from '../../../shared/types/keyword-command-center.js';
import db from '../../db/index.js';
import { parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';

interface RankSnapshotRow {
  date: string;
  queries: string;
}

const rankSnapshotQuerySchema = z.object({
  query: z.string().trim().min(1),
  position: z.number().finite(),
  clicks: z.number().finite().optional().default(0),
  impressions: z.number().finite().optional().default(0),
  /** Already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().finite().optional().default(0),
});

const stmts = createStmtCache(() => ({
  listSnapshots: db.prepare<[workspaceId: string]>(
    `SELECT date, queries
       FROM rank_snapshots
      WHERE workspace_id = ?
      ORDER BY date ASC`,
  ),
}));

export const KCC_RANK_KPI_WINDOW_DAYS = 28;
const DAY_MS = 86_400_000;

function shiftIsoDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyPeriod(startDate: string | null, endDate: string | null): KeywordRankKpiPeriod {
  return {
    startDate,
    endDate,
    snapshotDate: null,
    averagePosition: null,
    clicks: null,
    impressions: null,
  };
}

function rollupPeriod(
  workspaceId: string,
  rows: RankSnapshotRow[],
  startDate: string,
  endDate: string,
): KeywordRankKpiPeriod {
  const selected = rows.filter(row => row.date >= startDate && row.date <= endDate).at(-1);
  if (!selected) return emptyPeriod(startDate, endDate);
  const queries = parseJsonSafeArray(selected.queries, rankSnapshotQuerySchema, {
    workspaceId,
    table: 'rank_snapshots',
    field: 'queries',
  });
  if (queries.length === 0) {
    return { ...emptyPeriod(startDate, endDate), snapshotDate: selected.date };
  }
  const impressions = queries.reduce((total, query) => total + (query.impressions ?? 0), 0);
  const clicks = queries.reduce((total, query) => total + (query.clicks ?? 0), 0);
  const averagePosition = impressions > 0
    ? queries.reduce((total, query) => total + query.position * (query.impressions ?? 0), 0) / impressions
    : queries.reduce((total, query) => total + query.position, 0) / queries.length;
  return {
    startDate,
    endDate,
    snapshotDate: selected.date,
    averagePosition: round(averagePosition),
    clicks: round(clicks),
    impressions: round(impressions),
  };
}

function percentDelta(current: number | null, comparison: number | null): number | null {
  if (current == null || comparison == null || comparison === 0) return null;
  return round(((current - comparison) / comparison) * 100);
}

/**
 * Summary-only KCC rank rollup over existing source snapshots.
 *
 * Each stored snapshot already represents a rolling 28-day GSC observation, so
 * each period selects its latest snapshot rather than summing overlapping daily
 * captures. The current window is anchored to the latest stored observation and
 * the comparison window is the immediately preceding equal-length period.
 */
export function buildKeywordRankKpis(workspaceId: string): KeywordRankKpis {
  const rows = stmts().listSnapshots.all(workspaceId) as RankSnapshotRow[];
  const latestDate = rows.at(-1)?.date ?? null;
  if (!latestDate) {
    return {
      windowDays: KCC_RANK_KPI_WINDOW_DAYS,
      currentPeriod: emptyPeriod(null, null),
      comparisonPeriod: emptyPeriod(null, null),
      deltas: { averagePosition: null, clicksPercent: null, impressionsPercent: null },
    };
  }

  const currentEnd = latestDate;
  const currentStart = shiftIsoDate(currentEnd, -(KCC_RANK_KPI_WINDOW_DAYS - 1));
  const comparisonEnd = shiftIsoDate(currentStart, -1);
  const comparisonStart = shiftIsoDate(comparisonEnd, -(KCC_RANK_KPI_WINDOW_DAYS - 1));
  const currentPeriod = rollupPeriod(workspaceId, rows, currentStart, currentEnd);
  const comparisonPeriod = rollupPeriod(workspaceId, rows, comparisonStart, comparisonEnd);
  const averagePosition = currentPeriod.averagePosition != null && comparisonPeriod.averagePosition != null
    ? round(comparisonPeriod.averagePosition - currentPeriod.averagePosition)
    : null;

  return {
    windowDays: KCC_RANK_KPI_WINDOW_DAYS,
    currentPeriod,
    comparisonPeriod,
    deltas: {
      averagePosition,
      clicksPercent: percentDelta(currentPeriod.clicks, comparisonPeriod.clicks),
      impressionsPercent: percentDelta(currentPeriod.impressions, comparisonPeriod.impressions),
    },
  };
}
