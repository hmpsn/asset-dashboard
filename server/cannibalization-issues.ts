/**
 * cannibalization-issues — CRUD for the cannibalization_issues table.
 *
 * Normalizes keywordStrategy.cannibalization[] out of the workspace JSON blob
 * into indexed SQLite rows.
 */
import { z } from 'zod';
import db from './db/index.js';
import type { CannibalizationItem } from '../shared/types/workspace.js';
import { createLogger } from './logger.js';
import { parseJsonFallback, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('cannibalization-issues');

interface CannibalizationIssueRow {
  workspace_id: string;
  keyword: string;
  pages_json: string;
  severity: string;
  recommendation: string;
  canonical_path: string | null;
  canonical_url: string | null;
  action: string | null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const pageSchema = z.object({
  path: z.string(),
  position: z.number().optional(),
  impressions: z.number().optional(),
  clicks: z.number().optional(),
  source: z.enum(['keyword_map', 'gsc']),
});

type CannibalizationPage = z.infer<typeof pageSchema>;
const actionValues: NonNullable<CannibalizationItem['action']>[] = ['canonical_tag', 'redirect_301', 'differentiate', 'noindex'];

function normalizePage(raw: unknown): CannibalizationPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const path = nonEmptyString(candidate.path);
  const source = candidate.source === 'keyword_map' || candidate.source === 'gsc'
    ? candidate.source
    : null;
  if (!path || !source) return null;

  const normalized: CannibalizationPage = { path, source };
  const position = finiteNumber(candidate.position);
  const impressions = finiteNumber(candidate.impressions);
  const clicks = finiteNumber(candidate.clicks);
  if (position != null) normalized.position = position;
  if (impressions != null) normalized.impressions = impressions;
  if (clicks != null) normalized.clicks = clicks;
  return normalized;
}

export function normalizeCannibalizationIssue(raw: unknown): CannibalizationItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keyword = nonEmptyString(candidate.keyword);
  const severity = candidate.severity === 'high' || candidate.severity === 'medium' || candidate.severity === 'low'
    ? candidate.severity
    : null;
  const recommendation = nonEmptyString(candidate.recommendation);
  const pages = Array.isArray(candidate.pages)
    ? candidate.pages
      .map(page => normalizePage(page))
      .filter((page): page is CannibalizationPage => page != null)
    : [];
  if (!keyword || !severity || !recommendation || pages.length === 0) return null;
  const issue: CannibalizationItem = {
    keyword,
    pages,
    severity,
    recommendation,
  };
  const canonicalPath = nonEmptyString(candidate.canonicalPath);
  const canonicalUrl = nonEmptyString(candidate.canonicalUrl);
  const action = typeof candidate.action === 'string' && (actionValues as readonly string[]).includes(candidate.action)
    ? candidate.action as CannibalizationItem['action']
    : undefined;
  if (canonicalPath) issue.canonicalPath = canonicalPath;
  if (canonicalUrl) issue.canonicalUrl = canonicalUrl;
  if (action) issue.action = action;
  return issue;
}

function rowToModel(row: CannibalizationIssueRow): CannibalizationItem {
  const severity = row.severity === 'high' || row.severity === 'medium' || row.severity === 'low'
    ? row.severity
    : 'medium';
  const issue: CannibalizationItem = {
    keyword: row.keyword,
    pages: parseJsonSafeArray(row.pages_json, pageSchema, {
      table: 'cannibalization_issues',
      field: 'pages_json',
    }),
    severity,
    recommendation: row.recommendation,
  };
  if (row.canonical_path) issue.canonicalPath = row.canonical_path;
  if (row.canonical_url) issue.canonicalUrl = row.canonical_url;
  if (row.action && (actionValues as readonly string[]).includes(row.action)) {
    issue.action = row.action as CannibalizationItem['action'];
  }
  return issue;
}

function modelToParams(workspaceId: string, issue: CannibalizationItem) {
  return {
    workspace_id: workspaceId,
    keyword: issue.keyword,
    pages_json: JSON.stringify(issue.pages),
    severity: issue.severity,
    recommendation: issue.recommendation,
    canonical_path: issue.canonicalPath ?? null,
    canonical_url: issue.canonicalUrl ?? null,
    action: issue.action ?? null,
  };
}

function dedupeByKeyword(issues: CannibalizationItem[]): CannibalizationItem[] {
  const byKeyword = new Map<string, CannibalizationItem>();
  for (const issue of issues) {
    byKeyword.set(issue.keyword.toLowerCase(), issue);
  }
  return [...byKeyword.values()];
}

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    `SELECT * FROM cannibalization_issues
     WHERE workspace_id = ?
     ORDER BY CASE severity
       WHEN 'high' THEN 0
       WHEN 'medium' THEN 1
       ELSE 2
     END, keyword ASC`,
  ),
  insert: db.prepare(`
    INSERT INTO cannibalization_issues (
      workspace_id, keyword, pages_json, severity, recommendation,
      canonical_path, canonical_url, action
    ) VALUES (
      @workspace_id, @keyword, @pages_json, @severity, @recommendation,
      @canonical_path, @canonical_url, @action
    )
  `),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM cannibalization_issues WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM cannibalization_issues WHERE workspace_id = ?',
  ),
}));

export function listCannibalizationIssues(workspaceId: string): CannibalizationItem[] {
  const rows = stmts().listByWs.all(workspaceId) as CannibalizationIssueRow[];
  return rows.map(rowToModel);
}

export function replaceAllCannibalizationIssues(workspaceId: string, issues: CannibalizationItem[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const normalized = issues
      .map(issue => normalizeCannibalizationIssue(issue))
      .filter((issue): issue is CannibalizationItem => issue != null);
    if (normalized.length !== issues.length) {
      log.warn({ workspaceId, total: issues.length, kept: normalized.length }, 'Skipping invalid cannibalization payload(s)');
    }
    const deduped = dedupeByKeyword(normalized);
    const insert = stmts().insert;
    for (const issue of deduped) {
      insert.run(modelToParams(workspaceId, issue));
    }
  });
  run();
}

export function deleteAllCannibalizationIssues(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

export function countCannibalizationIssues(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Migrate keywordStrategy.cannibalization from the workspace JSON blob into
 * cannibalization_issues.
 *
 * Idempotent — skips workspaces that already have cannibalization_issues rows.
 */
export function migrateFromJsonBlob(): void {
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const cannibalization = strategy.cannibalization;
      if (!Array.isArray(cannibalization) || cannibalization.length === 0) continue;

      const normalized = dedupeByKeyword(
        cannibalization
          .map(issue => normalizeCannibalizationIssue(issue))
          .filter((issue): issue is CannibalizationItem => issue != null),
      );
      if (normalized.length === 0) continue;

      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' | 'concurrent-update' => {
        if (countCannibalizationIssues(row.id) > 0) return 'already-migrated';
        const strategyWithoutCannibalization = { ...strategy };
        delete strategyWithoutCannibalization.cannibalization;
        const write = db.prepare(`
          UPDATE workspaces
          SET keyword_strategy = ?
          WHERE id = ? AND keyword_strategy = ?
        `).run(JSON.stringify(strategyWithoutCannibalization), row.id, row.keyword_strategy);
        if (write.changes === 0) return 'concurrent-update';
        const insert = stmts().insert;
        for (const issue of normalized) {
          insert.run(modelToParams(row.id, issue));
        }
        return 'migrated';
      });

      const outcome = migrateOne();
      if (outcome === 'already-migrated') {
        skipped++;
        continue;
      }
      if (outcome === 'concurrent-update') {
        skipped++;
        log.warn({ workspaceId: row.id }, 'Skipped cannibalization blob cleanup due to concurrent keyword_strategy update');
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.id, issues: normalized.length }, 'Migrated cannibalization to cannibalization_issues table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate cannibalization');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'cannibalization migration complete');
  }
}
