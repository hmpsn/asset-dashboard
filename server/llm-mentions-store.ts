/**
 * llm-mentions-store — time-series store for the `llm_mention_snapshots` table
 * (SEO Decision Engine P8, migration 155).
 *
 * The AI-visibility trend IS the before/after AEO proof — each refresh writes a
 * dated snapshot per (workspace, date, platform). `mentions` /
 * `ai_search_volume` / `share_of_voice` are NULLable; readers treat absent as 0
 * (NEVER invented). `competitor_brands` and `source_domains` are JSON array
 * columns parsed through parseJsonSafeArray (never bare JSON.parse).
 *
 * rowToLlmMentionSnapshot maps NULL columns to `undefined` (NEVER `null` / `0`)
 * and aligns its in-memory shape with LlmMentionCompetitor / LlmMentionSource
 * from server/seo-data-provider.ts.
 */
import { z } from 'zod';

import db from './db/index.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── SQLite row shape (mirrors migration 155) ──

export interface LlmMentionSnapshotRow {
  workspace_id: string;
  snapshot_date: string;
  platform: string;
  domain: string | null;
  mentions: number | null;
  ai_search_volume: number | null;
  share_of_voice: number | null;
  competitor_brands: string;
  source_domains: string;
  fetched_at: string;
}

/** In-memory shape: NULL numerics → `undefined` (never `0`); JSON arrays decoded. */
export interface LlmMentionSnapshot {
  workspaceId: string;
  snapshotDate: string;
  platform: string;
  domain?: string;
  mentions?: number;
  aiSearchVolume?: number;
  shareOfVoice?: number;
  /** Co-mentioned brands — aligns with LlmMentionCompetitor. */
  competitors: { name: string; mentions: number; aiSearchVolume?: number }[];
  /** Cited source domains — aligns with LlmMentionSource. */
  sourceDomains: { domain: string; mentions: number }[];
  fetchedAt: string;
}

// ── Per-item Zod schemas for the two JSON array columns ──

const competitorSchema = z.object({
  name: z.string(),
  mentions: z.number(),
  aiSearchVolume: z.number().optional(),
});
const sourceDomainSchema = z.object({
  domain: z.string(),
  mentions: z.number(),
});

/** A NULL column maps to `undefined` (omitted by JSON.stringify) — never `null` / `0`. */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/** Map a raw DB row back to the in-memory LlmMentionSnapshot. */
export function rowToLlmMentionSnapshot(row: LlmMentionSnapshotRow): LlmMentionSnapshot {
  return {
    workspaceId: row.workspace_id,
    snapshotDate: row.snapshot_date,
    platform: row.platform,
    domain: nullToUndefined(row.domain),
    mentions: nullToUndefined(row.mentions),
    aiSearchVolume: nullToUndefined(row.ai_search_volume),
    shareOfVoice: nullToUndefined(row.share_of_voice),
    competitors: parseJsonSafeArray(row.competitor_brands, competitorSchema, {
      workspaceId: row.workspace_id,
      table: 'llm_mention_snapshots',
      field: 'competitor_brands',
    }),
    sourceDomains: parseJsonSafeArray(row.source_domains, sourceDomainSchema, {
      workspaceId: row.workspace_id,
      table: 'llm_mention_snapshots',
      field: 'source_domains',
    }),
    fetchedAt: row.fetched_at,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO llm_mention_snapshots (
      workspace_id, snapshot_date, platform, domain, mentions,
      ai_search_volume, share_of_voice, competitor_brands, source_domains, fetched_at
    ) VALUES (
      @workspace_id, @snapshot_date, @platform, @domain, @mentions,
      @ai_search_volume, @share_of_voice, @competitor_brands, @source_domains, @fetched_at
    )
    ON CONFLICT(workspace_id, snapshot_date, platform) DO UPDATE SET
      domain = excluded.domain,
      mentions = excluded.mentions,
      ai_search_volume = excluded.ai_search_volume,
      share_of_voice = excluded.share_of_voice,
      competitor_brands = excluded.competitor_brands,
      source_domains = excluded.source_domains,
      fetched_at = excluded.fetched_at
  `),
  latestAny: db.prepare<[workspaceId: string]>(`
    SELECT * FROM llm_mention_snapshots
    WHERE workspace_id = ?
    ORDER BY snapshot_date DESC
    LIMIT 1
  `),
  latestByPlatform: db.prepare<[workspaceId: string, platform: string]>(`
    SELECT * FROM llm_mention_snapshots
    WHERE workspace_id = ? AND platform = ?
    ORDER BY snapshot_date DESC
    LIMIT 1
  `),
  trendAny: db.prepare<[workspaceId: string]>(`
    SELECT * FROM llm_mention_snapshots
    WHERE workspace_id = ?
    ORDER BY snapshot_date ASC
  `),
  trendByPlatform: db.prepare<[workspaceId: string, platform: string]>(`
    SELECT * FROM llm_mention_snapshots
    WHERE workspace_id = ? AND platform = ?
    ORDER BY snapshot_date ASC
  `),
}));

// ── Public API ──

interface StoreLlmMentionInput {
  domain?: string;
  mentions?: number;
  aiSearchVolume?: number;
  shareOfVoice?: number;
  competitors: { name: string; mentions: number; aiSearchVolume?: number }[];
  sourceDomains: { domain: string; mentions: number }[];
}

/** undefined/null in-memory → SQL NULL. */
function toNullableNumber(value: number | null | undefined): number | null {
  return value == null ? null : value;
}
function toNullableText(value: string | null | undefined): string | null {
  return value == null ? null : value;
}

/**
 * Upsert one LLM-mention snapshot for a (workspace, date, platform). Re-running
 * for the same key UPDATES in place (no duplicate rows). Runs in a single
 * transaction (multi-step write must be transactional). The two JSON arrays are
 * stringified; null/undefined numerics map to SQL NULL (readers treat as 0,
 * never invented).
 */
export function storeLlmMentionSnapshot(
  workspaceId: string,
  snapshotDate: string,
  platform: string,
  data: StoreLlmMentionInput,
): void {
  const run = db.transaction(() => {
    stmts().upsert.run({
      workspace_id: workspaceId,
      snapshot_date: snapshotDate,
      platform,
      domain: toNullableText(data.domain),
      mentions: toNullableNumber(data.mentions),
      ai_search_volume: toNullableNumber(data.aiSearchVolume),
      share_of_voice: toNullableNumber(data.shareOfVoice),
      competitor_brands: JSON.stringify(data.competitors ?? []),
      source_domains: JSON.stringify(data.sourceDomains ?? []),
      fetched_at: new Date().toISOString(),
    });
  });
  run();
}

/**
 * The most recent snapshot for a workspace (max snapshot_date), optionally
 * scoped to one platform. Workspace-scoped.
 */
export function getLatestLlmMentions(
  workspaceId: string,
  platform?: string,
): LlmMentionSnapshot | undefined {
  const row = platform
    ? (stmts().latestByPlatform.get(workspaceId, platform) as LlmMentionSnapshotRow | undefined)
    : (stmts().latestAny.get(workspaceId) as LlmMentionSnapshotRow | undefined);
  return row ? rowToLlmMentionSnapshot(row) : undefined;
}

/**
 * Full snapshot history for a workspace, date-ASCENDING (for charting),
 * optionally scoped to one platform. Workspace-scoped.
 */
export function getLlmMentionsTrend(
  workspaceId: string,
  platform?: string,
): LlmMentionSnapshot[] {
  const rows = platform
    ? (stmts().trendByPlatform.all(workspaceId, platform) as LlmMentionSnapshotRow[])
    : (stmts().trendAny.all(workspaceId) as LlmMentionSnapshotRow[]);
  return rows.map(rowToLlmMentionSnapshot);
}
