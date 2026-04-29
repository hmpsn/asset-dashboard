/**
 * Integration tests for PR 2 — CMS pageId normalisation and migration 076.
 *
 * Verifies:
 *  1. toCmsPageId produces the canonical format (cms-{path-with-dashes}, no double-dash).
 *  2. Migration 076 collapses cms--* legacy rows to cms-* across the 4 affected tables,
 *     including pre-dedupe of collisions where both cms--{x} and cms-{x} already exist.
 *  3. Migration is idempotent (safe to re-run).
 *
 * Port: 13331 (informational — this test goes directly to DB, no HTTP server)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { toCmsPageId } from '../../server/webflow-pages.js';
import db from '../../server/db/index.js';

const MIGRATION_076_SQL = readFileSync(
  resolve(__dirname, '../../server/db/migrations/076-normalise-cms-page-ids.sql'),
  'utf8',
);

let ws: ReturnType<typeof seedWorkspace>;
let testSiteId: string;

beforeAll(() => {
  ws = seedWorkspace();
  testSiteId = `pr2-test-site-${ws.workspaceId}`;
});

afterAll(() => {
  // FK cascade is OFF in tests — explicitly clean up rows seeded into the 4 tables.
  db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ?`).run(ws.workspaceId);
  db.prepare(`DELETE FROM schema_page_types WHERE site_id = ?`).run(testSiteId);
  db.prepare(`DELETE FROM schema_publish_history WHERE workspace_id = ?`).run(ws.workspaceId);
  db.prepare(`DELETE FROM seo_changes WHERE workspace_id = ?`).run(ws.workspaceId);
  ws.cleanup();
});

describe('toCmsPageId canonical format', () => {
  it('produces no double-dash for /-prefixed paths', () => {
    expect(toCmsPageId('/blog/my-post')).toBe('cms-blog-my-post');
    expect(toCmsPageId('/blog/my-post')).not.toContain('--');
  });

  it('handles bare paths (no leading slash)', () => {
    expect(toCmsPageId('blog/my-post')).toBe('cms-blog-my-post');
  });
});

describe('migration 076: cms-- → cms- normalisation', () => {
  it('schema_validations: pre-dedupe keeps newer row on collision', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES
        (?, ?, 'cms--blog-collide', 'valid',    '[]', '[]', '[]', '2026-04-01 10:00:00'),
        (?, ?, 'cms-blog-collide',  'warnings', '[]', '[]', '[]', '2026-04-25 10:00:00')
    `).run(`${baseId}-old`, ws.workspaceId, `${baseId}-new`, ws.workspaceId);

    db.exec(MIGRATION_076_SQL);

    const rows = db.prepare(
      `SELECT id, page_id, status FROM schema_validations WHERE workspace_id = ? AND page_id = 'cms-blog-collide'`,
    ).all(ws.workspaceId) as Array<{ id: string; page_id: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`${baseId}-new`);
    expect(rows[0].status).toBe('warnings');
  });

  it('schema_validations: lone cms-- rows normalise without dropping', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES (?, ?, 'cms--lone-page', 'valid', '[]', '[]', '[]', datetime('now'))
    `).run(`${baseId}-lone`, ws.workspaceId);

    db.exec(MIGRATION_076_SQL);

    const row = db.prepare(
      `SELECT page_id FROM schema_validations WHERE id = ?`,
    ).get(`${baseId}-lone`) as { page_id: string } | undefined;
    expect(row?.page_id).toBe('cms-lone-page');
  });

  it('schema_validations: legacy schema-suggester format (cms-{slug-with-slashes}) normalises to canonical', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES (?, ?, 'cms-blog/legacy-suggester', 'valid', '[]', '[]', '[]', datetime('now'))
    `).run(`${baseId}-suggester`, ws.workspaceId);

    db.exec(MIGRATION_076_SQL);

    const row = db.prepare(
      `SELECT page_id FROM schema_validations WHERE id = ?`,
    ).get(`${baseId}-suggester`) as { page_id: string } | undefined;
    expect(row?.page_id).toBe('cms-blog-legacy-suggester');
  });

  it('schema_validations: 3-way collision (cms--, cms-with-slashes, cms-canonical) keeps newest', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES
        (?, ?, 'cms--three-way',     'valid',    '[]', '[]', '[]', '2026-04-01 10:00:00'),
        (?, ?, 'cms-three/way',      'warnings', '[]', '[]', '[]', '2026-04-15 10:00:00'),
        (?, ?, 'cms-three-way',      'errors',   '[]', '[]', '[]', '2026-04-25 10:00:00')
    `).run(
      `${baseId}-3w-old`, ws.workspaceId,
      `${baseId}-3w-mid`, ws.workspaceId,
      `${baseId}-3w-new`, ws.workspaceId,
    );

    db.exec(MIGRATION_076_SQL);

    const rows = db.prepare(
      `SELECT id, page_id, status FROM schema_validations WHERE workspace_id = ? AND page_id = 'cms-three-way'`,
    ).all(ws.workspaceId) as Array<{ id: string; page_id: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`${baseId}-3w-new`);
    expect(rows[0].status).toBe('errors');
  });

  it('schema_publish_history: plain UPDATE normalises rows (no collision risk)', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM schema_publish_history WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO schema_publish_history (id, site_id, page_id, workspace_id, schema_json)
      VALUES
        (?, ?, 'cms--blog-history', ?, '{}'),
        (?, ?, 'cms--about-history', ?, '{}')
    `).run(`${baseId}-h1`, testSiteId, ws.workspaceId, `${baseId}-h2`, testSiteId, ws.workspaceId);

    db.exec(MIGRATION_076_SQL);

    const rows = db.prepare(
      `SELECT id, page_id FROM schema_publish_history WHERE workspace_id = ? ORDER BY id`,
    ).all(ws.workspaceId) as Array<{ id: string; page_id: string }>;
    expect(rows.map(r => r.page_id).sort()).toEqual(['cms-about-history', 'cms-blog-history']);
  });

  it('schema_page_types: pre-dedupe keeps newer row on collision', () => {
    db.prepare(`DELETE FROM schema_page_types WHERE site_id = ?`).run(testSiteId);
    db.prepare(`
      INSERT INTO schema_page_types (site_id, page_id, page_type, updated_at)
      VALUES
        (?, 'cms--landing', 'LandingPage', '2026-04-01 10:00:00'),
        (?, 'cms-landing',  'BlogPosting', '2026-04-25 10:00:00')
    `).run(testSiteId, testSiteId);

    db.exec(MIGRATION_076_SQL);

    const rows = db.prepare(
      `SELECT page_id, page_type FROM schema_page_types WHERE site_id = ?`,
    ).all(testSiteId) as Array<{ page_id: string; page_type: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].page_id).toBe('cms-landing');
    expect(rows[0].page_type).toBe('BlogPosting'); // newer row's value won
  });

  it('seo_changes: plain UPDATE normalises rows', () => {
    const baseId = `pr2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM seo_changes WHERE workspace_id = ?`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO seo_changes (id, workspace_id, page_id, page_slug, page_title, fields, source, changed_at)
      VALUES (?, ?, 'cms--blog-change', 'blog-change', 'Blog Change', '[]', 'test', datetime('now'))
    `).run(`${baseId}-c1`, ws.workspaceId);

    db.exec(MIGRATION_076_SQL);

    const row = db.prepare(`SELECT page_id FROM seo_changes WHERE id = ?`).get(`${baseId}-c1`) as { page_id: string } | undefined;
    expect(row?.page_id).toBe('cms-blog-change');
  });

  it('migration is idempotent — re-running leaves rows unchanged', () => {
    // After all prior tests, no cms-- rows should remain in any of the 4 tables.
    db.exec(MIGRATION_076_SQL);

    const cmsValidations = db.prepare(`SELECT COUNT(*) as n FROM schema_validations WHERE page_id LIKE 'cms--%'`).get() as { n: number };
    const cmsPageTypes = db.prepare(`SELECT COUNT(*) as n FROM schema_page_types WHERE page_id LIKE 'cms--%'`).get() as { n: number };
    const cmsPublishHistory = db.prepare(`SELECT COUNT(*) as n FROM schema_publish_history WHERE page_id LIKE 'cms--%'`).get() as { n: number };
    const cmsSeoChanges = db.prepare(`SELECT COUNT(*) as n FROM seo_changes WHERE page_id LIKE 'cms--%'`).get() as { n: number };
    expect(cmsValidations.n).toBe(0);
    expect(cmsPageTypes.n).toBe(0);
    expect(cmsPublishHistory.n).toBe(0);
    expect(cmsSeoChanges.n).toBe(0);
  });
});

describe('_existingErrors lookup by toCmsPageId key', () => {
  it('schema_validations row written with toCmsPageId() key is findable via the same key', () => {
    const cmsPath = '/blog/existing-errors-test';
    const cmsKey = toCmsPageId(cmsPath);
    expect(cmsKey).toBe('cms-blog-existing-errors-test');

    db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ? AND page_id = ?`).run(ws.workspaceId, cmsKey);
    db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES (?, ?, ?, 'errors', '[]', ?, '[]', datetime('now'))
    `).run(
      `pr2-errs-${ws.workspaceId}`,
      ws.workspaceId,
      cmsKey,
      JSON.stringify([
        { type: 'MissingField', message: 'Missing required @type' },
        { type: 'InvalidValue', message: 'Invalid datePublished format' },
      ]),
    );

    // Build the same lookup map schema-suggester builds via getValidations() and look up by cmsKey.
    const rows = db.prepare(
      `SELECT page_id, errors FROM schema_validations WHERE workspace_id = ? AND page_id = ?`,
    ).all(ws.workspaceId, cmsKey) as Array<{ page_id: string; errors: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].page_id).toBe(cmsKey);

    // Mirror the filter applied in schema-suggester before injection into the prompt.
    const parsed = JSON.parse(rows[0].errors) as unknown[];
    const validated = parsed.filter(
      (e): e is { message: string } => typeof (e as { message?: unknown })?.message === 'string',
    );
    expect(validated.map(e => e.message)).toEqual([
      'Missing required @type',
      'Invalid datePublished format',
    ]);
  });
});
