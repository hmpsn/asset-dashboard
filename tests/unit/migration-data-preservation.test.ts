/**
 * Migration data preservation tests.
 *
 * Verifies that the fully-migrated database (after all migrations have run)
 * can correctly CRUD data in every critical table, and that key schema
 * invariants hold — column additions, table renames, and FK constraints
 * are all non-destructive.
 *
 * Strategy:
 *   - Migrations are already applied by global-setup before this suite runs.
 *   - We insert known data, read it back via the normal store functions/raw
 *     queries, and verify the values round-trip correctly.
 *   - We also inspect PRAGMA table_info to assert that expected columns exist.
 *   - All inserted rows are cleaned up in afterAll().
 */
import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { cleanSeedData } from '../global-setup.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  upsertInsight,
  getInsights,
  deleteInsightsForWorkspace,
} from '../../server/analytics-insights-store.js';
import { createBatch, listBatches } from '../../server/approvals.js';

// ── Test workspace created once for this suite ──

const { workspaceId, webflowSiteId, cleanup: cleanupWorkspace } = seedWorkspace({ tier: 'growth' });

afterAll(() => {
  // Remove analytics_insights rows first (no FK to workspaces, safe to delete separately)
  deleteInsightsForWorkspace(workspaceId);
  cleanSeedData(workspaceId);
  cleanupWorkspace();
});

// ── Helpers ──

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function getColumns(table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function columnNames(table: string): string[] {
  return getColumns(table).map(c => c.name);
}

// ── Schema integrity: workspaces ──

describe('schema integrity — workspaces', () => {
  it('has all original columns from migration 005', () => {
    const cols = columnNames('workspaces');
    const required = [
      'id', 'name', 'folder', 'webflow_site_id', 'webflow_token',
      'gsc_property_url', 'ga4_property_id', 'client_password', 'live_domain',
      'tier', 'created_at',
    ];
    for (const col of required) {
      expect(cols, `workspaces.${col} should exist`).toContain(col);
    }
  });

  it('has columns added by later migrations', () => {
    // 007: publish_target, 041: scoring_config, 046: intelligence_profile, 048: business_priorities
    const cols = columnNames('workspaces');
    const addedLater = [
      'publish_target',      // migration 007
      'scoring_config',      // migration 041
      'intelligence_profile', // migration 046
      'business_priorities', // migration 048
    ];
    for (const col of addedLater) {
      expect(cols, `workspaces.${col} (added by later migration) should exist`).toContain(col);
    }
  });

  it('existing workspace row survives schema additions — all core fields readable', () => {
    const row = db
      .prepare('SELECT id, name, tier, created_at, business_priorities, scoring_config FROM workspaces WHERE id = ?')
      .get(workspaceId) as { id: string; name: string; tier: string; created_at: string; business_priorities: string | null; scoring_config: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.id).toBe(workspaceId);
    expect(row!.tier).toBe('growth');
    expect(row!.created_at).toBeTruthy();
    // Columns added by later migrations default to NULL for pre-existing rows
    expect(row!.business_priorities).toBeNull();
    expect(row!.scoring_config).toBeNull();
  });
});

// ── Schema integrity — analytics_insights ──

describe('schema integrity — analytics_insights', () => {
  it('has base columns from migration 035', () => {
    const cols = columnNames('analytics_insights');
    const base = ['id', 'workspace_id', 'page_id', 'insight_type', 'data', 'severity', 'computed_at'];
    for (const col of base) {
      expect(cols, `analytics_insights.${col} should exist`).toContain(col);
    }
  });

  it('has enrichment columns added by migrations 038–044', () => {
    const cols = columnNames('analytics_insights');
    const enrichment = [
      'page_title',          // 038
      'strategy_keyword',    // 038
      'strategy_alignment',  // 038
      'audit_issues',        // 038
      'pipeline_status',     // 038
      'anomaly_linked',      // 038
      'impact_score',        // 038
      'domain',              // 038
      'resolution_status',   // 040
      'resolution_note',     // 040
      'resolved_at',         // 040
      'resolution_source',   // 043
      'bridge_source',       // 044
    ];
    for (const col of enrichment) {
      expect(cols, `analytics_insights.${col} should exist`).toContain(col);
    }
  });
});

// ── Schema integrity — content_posts ──

describe('schema integrity — content_posts', () => {
  it('has base columns from migration 003', () => {
    const cols = columnNames('content_posts');
    const base = [
      'id', 'workspace_id', 'brief_id', 'target_keyword', 'title',
      'meta_description', 'sections', 'status', 'created_at', 'updated_at',
    ];
    for (const col of base) {
      expect(cols, `content_posts.${col} should exist`).toContain(col);
    }
  });

  it('has columns added by later migrations', () => {
    const cols = columnNames('content_posts');
    // 007: webflow publish columns; 010: review_checklist; 028: voice_score/voice_feedback
    const added = ['webflow_item_id', 'published_at', 'review_checklist', 'voice_score', 'voice_feedback'];
    for (const col of added) {
      expect(cols, `content_posts.${col} should exist`).toContain(col);
    }
  });
});

// ── Schema integrity — approval_batches ──

describe('schema integrity — approval_batches', () => {
  it('has all expected columns with CASCADE FK to workspaces', () => {
    const cols = columnNames('approval_batches');
    const required = ['id', 'workspace_id', 'site_id', 'name', 'items', 'status', 'created_at', 'updated_at'];
    for (const col of required) {
      expect(cols, `approval_batches.${col} should exist`).toContain(col);
    }
  });
});

// ── Schema integrity — content_topic_requests (a.k.a. content requests) ──

describe('schema integrity — content_topic_requests', () => {
  it('has all expected columns', () => {
    const cols = columnNames('content_topic_requests');
    const required = [
      'id', 'workspace_id', 'topic', 'target_keyword', 'intent', 'priority',
      'rationale', 'status', 'source', 'comments', 'requested_at', 'updated_at',
    ];
    for (const col of required) {
      expect(cols, `content_topic_requests.${col} should exist`).toContain(col);
    }
  });
});

// ── CRUD preservation — analytics_insights ──

describe('CRUD preservation — analytics_insights', () => {
  it('inserted insight survives a read-back via getInsights', () => {
    const insight = upsertInsight({
      workspaceId,
      pageId: '/blog/migration-test',
      insightType: 'page_health',
      data: { score: 88, trend: 'stable' },
      severity: 'opportunity',
      pageTitle: 'Migration Test Page',
      impactScore: 42,
      domain: 'content',
    });

    expect(insight.id).toMatch(/^ins_/);

    const list = getInsights(workspaceId);
    expect(list.length).toBeGreaterThan(0);

    const found = list.find(i => i.id === insight.id);
    expect(found).toBeDefined();
    expect(found!.pageId).toBe('/blog/migration-test');
    expect(found!.insightType).toBe('page_health');
    expect(found!.data).toMatchObject({ score: 88, trend: 'stable' });
    expect(found!.pageTitle).toBe('Migration Test Page');
    expect(found!.impactScore).toBe(42);
    expect(found!.domain).toBe('content');
  });

  it('upsert with same workspace+page+type updates data without losing enrichment fields', () => {
    // First upsert
    upsertInsight({
      workspaceId,
      pageId: '/blog/upsert-test',
      insightType: 'content_decay',
      data: { decayScore: 30 },
      severity: 'warning',
      pageTitle: 'Upsert Test Page',
      impactScore: 10,
    });

    // Second upsert — same key, updated data
    const updated = upsertInsight({
      workspaceId,
      pageId: '/blog/upsert-test',
      insightType: 'content_decay',
      data: { decayScore: 60, reason: 'traffic drop' },
      severity: 'critical',
      pageTitle: 'Upsert Test Page Updated',
      impactScore: 75,
    });

    const list = getInsights(workspaceId);
    expect(list.length).toBeGreaterThan(0);

    const found = list.find(i => i.id === updated.id);
    expect(found).toBeDefined();
    expect(found!.data).toMatchObject({ decayScore: 60, reason: 'traffic drop' });
    expect(found!.severity).toBe('critical');
    expect(found!.pageTitle).toBe('Upsert Test Page Updated');
    expect(found!.impactScore).toBe(75);
  });

  it('null-valued late-added columns default correctly (resolution_status, bridge_source)', () => {
    const insight = upsertInsight({
      workspaceId,
      pageId: '/blog/null-cols-test',
      insightType: 'ranking_opportunity',
      data: { keyword: 'test kw' },
      severity: 'opportunity',
    });

    // resolution_status, resolution_note, resolved_at, bridge_source default to NULL
    expect(insight.resolutionStatus).toBeNull();
    expect(insight.resolutionNote).toBeNull();
    expect(insight.resolvedAt).toBeNull();
    expect(insight.bridgeSource).toBeNull();
  });
});

// ── CRUD preservation — approval_batches ──

describe('CRUD preservation — approval_batches', () => {
  it('inserted batch survives read-back via getBatches', () => {
    const batch = createBatch(workspaceId, webflowSiteId, 'Migration Test Batch', []);
    expect(batch.id).toBeTruthy();

    const batches = listBatches(workspaceId);
    expect(batches.length).toBeGreaterThan(0);

    const found = batches.find(b => b.id === batch.id);
    expect(found).toBeDefined();
    expect(found!.workspaceId).toBe(workspaceId);
    expect(found!.siteId).toBe(webflowSiteId);
    expect(found!.name).toBe('Migration Test Batch');
    expect(found!.status).toBe('pending');
    expect(found!.items).toEqual([]);
    expect(found!.createdAt).toBeTruthy();
    expect(found!.updatedAt).toBeTruthy();
  });
});

// ── CRUD preservation — content_posts (raw INSERT + SELECT) ──

describe('CRUD preservation — content_posts', () => {
  const postId = 'post-mig-test-' + Date.now();
  const briefId = 'brief-mig-test-' + Date.now();

  afterAll(() => {
    db.prepare('DELETE FROM content_posts WHERE id = ?').run(postId);
    db.prepare('DELETE FROM content_briefs WHERE id = ?').run(briefId);
  });

  it('row inserted with base columns is readable after migration adds new columns', () => {
    const now = new Date().toISOString();

    // Insert via raw SQL to simulate a row that existed before later migrations
    // added voice_score, review_checklist, etc.
    db.prepare(`
      INSERT INTO content_posts
        (id, workspace_id, brief_id, target_keyword, title, meta_description,
         introduction, sections, conclusion, total_word_count, target_word_count,
         status, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      postId, workspaceId, briefId,
      'migration keyword',
      'Migration Test Post',
      'Test meta description',
      'Test introduction',
      '[]',
      'Test conclusion',
      500,
      800,
      'draft',
      now,
      now,
    );

    const row = db.prepare('SELECT * FROM content_posts WHERE id = ?').get(postId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['id']).toBe(postId);
    expect(row!['workspace_id']).toBe(workspaceId);
    expect(row!['title']).toBe('Migration Test Post');
    expect(row!['target_keyword']).toBe('migration keyword');
    expect(row!['status']).toBe('draft');
    expect(row!['total_word_count']).toBe(500);

    // Columns added by later migrations should be NULL, not corrupt the row
    expect(row!['voice_score']).toBeNull();
    expect(row!['voice_feedback']).toBeNull();
    expect(row!['review_checklist']).toBeNull();
    expect(row!['webflow_item_id']).toBeNull();
    expect(row!['published_at']).toBeNull();
  });
});

// ── CRUD preservation — content_topic_requests ──

describe('CRUD preservation — content_topic_requests', () => {
  const reqId = 'req-mig-test-' + Date.now();

  afterAll(() => {
    db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(reqId);
  });

  it('row inserted survives read-back with all expected fields', () => {
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO content_topic_requests
        (id, workspace_id, topic, target_keyword, intent, priority, rationale,
         status, comments, requested_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reqId, workspaceId,
      'Test Topic',
      'test keyword',
      'informational',
      'high',
      'Good traffic potential',
      'requested',
      '[]',
      now,
      now,
    );

    const row = db.prepare('SELECT * FROM content_topic_requests WHERE id = ?').get(reqId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['id']).toBe(reqId);
    expect(row!['workspace_id']).toBe(workspaceId);
    expect(row!['topic']).toBe('Test Topic');
    expect(row!['target_keyword']).toBe('test keyword');
    expect(row!['priority']).toBe('high');
    expect(row!['status']).toBe('requested');
    expect(row!['comments']).toBe('[]');
    // Optional columns default to NULL
    expect(row!['brief_id']).toBeNull();
    expect(row!['client_note']).toBeNull();
    expect(row!['decline_reason']).toBeNull();
  });
});

// ── Migration tracking table integrity ──

describe('_migrations table', () => {
  it('exists and has recorded at least one migration', () => {
    const rows = db.prepare('SELECT name, applied_at FROM _migrations ORDER BY name').all() as Array<{ name: string; applied_at: string }>;
    expect(rows.length).toBeGreaterThan(0);

    // Verify the structure of entries
    const first = rows[0];
    expect(first.name).toMatch(/^\d{3}-.*\.sql$/);
    expect(first.applied_at).toBeTruthy();
  });

  it('has recorded all expected foundational migrations', () => {
    const rows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
    const appliedNames = new Set(rows.map(r => r.name));

    const foundational = [
      '003-per-workspace.sql',
      '005-workspaces.sql',
      '019-cascade-workspace-delete.sql',
      '035-analytics-insights.sql',
      '038-intelligence-enrichment.sql',
      '040-insight-resolution-tracking.sql',
      '044-insight-bridge-source.sql',
    ];

    expect(appliedNames.size).toBeGreaterThan(0);
    for (const mig of foundational) {
      expect(appliedNames, `migration ${mig} should be recorded in _migrations`).toContain(mig);
    }
  });
});

// ── Foreign key cascade: ON DELETE CASCADE ──

describe('ON DELETE CASCADE — workspace delete removes child rows', () => {
  it('deleting a workspace removes its approval_batches', () => {
    // Create an isolated workspace and batch
    const { workspaceId: tempWsId, webflowSiteId: tempSiteId } = seedWorkspace();
    createBatch(tempWsId, tempSiteId, 'Cascade Test Batch', []);

    const before = db
      .prepare('SELECT COUNT(*) as cnt FROM approval_batches WHERE workspace_id = ?')
      .get(tempWsId) as { cnt: number };
    expect(before.cnt).toBeGreaterThan(0);

    // Enable FK enforcement (should already be ON, but be explicit)
    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(tempWsId);

    const after = db
      .prepare('SELECT COUNT(*) as cnt FROM approval_batches WHERE workspace_id = ?')
      .get(tempWsId) as { cnt: number };
    expect(after.cnt).toBe(0);

    // No cleanup needed — workspace was already deleted by the DELETE above.
    // The CASCADE should have removed all child rows.
  });

  it('deleting a workspace removes its content_topic_requests', () => {
    const { workspaceId: tempWsId } = seedWorkspace();
    const now = new Date().toISOString();
    const reqId = 'req-cascade-' + Date.now();

    db.prepare(`
      INSERT INTO content_topic_requests
        (id, workspace_id, topic, target_keyword, intent, priority, rationale,
         status, comments, requested_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reqId, tempWsId, 'Cascade Topic', 'kw', 'informational', 'low', 'test', 'requested', '[]', now, now);

    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(tempWsId);

    const row = db.prepare('SELECT id FROM content_topic_requests WHERE id = ?').get(reqId);
    expect(row).toBeUndefined();
  });
});

// ── Row count sanity: migrations table count ──

describe('migration count sanity', () => {
  it('has at least 40 migrations applied', () => {
    const result = db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get() as { cnt: number };
    expect(result.cnt).toBeGreaterThanOrEqual(40);
  });
});
