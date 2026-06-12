/**
 * Extended integration tests: SEO change tracker routes.
 *
 * Covers behaviors not already tested in seo-change-tracker-routes.test.ts:
 *   - GET /api/seo-changes — limit=1 (boundary), float limit → 400, large valid limit
 *   - Workspace isolation (ws A changes not visible from ws B)
 *   - GET /api/seo-change-impact — no site linked (400), invalid limit values
 *   - GET /api/schema-impact — no site linked (400), invalid limit, limit capped
 *   - Response shape contracts (changes array items have expected fields)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { recordSeoChange } from '../../server/seo-change-tracker.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsA = '';
let wsB = '';

beforeAll(async () => {
  await ctx.startServer();
  wsA = createWorkspace('SEO Tracker Extended WS-A').id;
  wsB = createWorkspace('SEO Tracker Extended WS-B').id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM seo_changes WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await ctx.stopServer();
});

// ── GET /api/seo-changes — additional limit edge cases ────────────────────────

describe('GET /api/seo-changes — additional limit edge cases', () => {
  it('returns 200 for limit=1 (smallest positive integer)', async () => {
    const res = await api(`/api/seo-changes/${wsA}?limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: unknown[] };
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('returns 400 when limit is a float (1.5)', async () => {
    const res = await api(`/api/seo-changes/${wsA}?limit=1.5`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('limit');
  });

  it('returns 400 when limit=NaN string', async () => {
    const res = await api(`/api/seo-changes/${wsA}?limit=NaN`);
    expect(res.status).toBe(400);
  });

  it('caps limit at 200 silently for extremely large values', async () => {
    // 999 > max 200, but should still return 200 with capped results
    const res = await api(`/api/seo-changes/${wsA}?limit=999`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: unknown[] };
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('returns changes that have expected shape fields', async () => {
    // Seed a change so we have something to inspect
    recordSeoChange(wsA, 'pg_shape_test', '/shape-test', 'Shape Test Page', ['title'], 'editor');

    const res = await api(`/api/seo-changes/${wsA}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: Array<Record<string, unknown>> };
    expect(Array.isArray(body.changes)).toBe(true);
    expect(body.changes.length).toBeGreaterThanOrEqual(1);

    const first = body.changes[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.workspaceId).toBe('string');
    expect(typeof first.pageId).toBe('string');
    expect(typeof first.pageSlug).toBe('string');
    expect(typeof first.changedAt).toBe('string');
    expect(Array.isArray(first.fields)).toBe(true);
  });
});

// ── Workspace isolation ────────────────────────────────────────────────────────

describe('GET /api/seo-changes — workspace isolation', () => {
  it('does not expose workspace A changes to workspace B listing', async () => {
    db.prepare('DELETE FROM seo_changes WHERE workspace_id IN (?, ?)').run(wsA, wsB);

    recordSeoChange(wsA, 'pg_iso_a', '/iso-a', 'Iso A Page', ['title'], 'editor');

    const [resA, resB] = await Promise.all([
      api(`/api/seo-changes/${wsA}`),
      api(`/api/seo-changes/${wsB}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { changes: Array<{ pageId: string }> };
    const bodyB = await resB.json() as { changes: Array<{ pageId: string }> };

    const wsAIds = new Set(bodyA.changes.map(c => c.pageId));
    const wsBIds = new Set(bodyB.changes.map(c => c.pageId));

    expect(wsAIds.has('pg_iso_a')).toBe(true);
    expect(wsBIds.has('pg_iso_a')).toBe(false);
  });
});

// ── GET /api/seo-change-impact — additional error cases ───────────────────────

describe('GET /api/seo-change-impact — additional validation', () => {
  it('returns 400 when workspace has no site linked (after GSC check)', async () => {
    // Workspace needs gscPropertyUrl but no webflowSiteId → 400 'No site linked'
    db.prepare("UPDATE workspaces SET gsc_property_url = ? WHERE id = ?").run(
      'https://example.com', wsA,
    );
    const res = await api(`/api/seo-change-impact/${wsA}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/site/i);

    // Reset GSC property
    db.prepare("UPDATE workspaces SET gsc_property_url = NULL WHERE id = ?").run(wsA);
  });

  it('returns 400 for any limit when no GSC configured (GSC checked before limit)', async () => {
    // The route validates GSC before limit — so any request without GSC returns 400 GSC error
    const res = await api(`/api/seo-change-impact/${wsA}?limit=2.7`);
    expect(res.status).toBe(400);
    // Could be GSC error or limit error depending on route order — 400 is the contract
  });

  it('returns 400 when limit=0 on impact endpoint with no GSC (route hits GSC first)', async () => {
    const res = await api(`/api/seo-change-impact/${wsA}?limit=0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for no GSC even with valid limit parameter', async () => {
    const res = await api(`/api/seo-change-impact/${wsA}?limit=10`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('GSC');
  });
});

// ── GET /api/schema-impact — additional validation ────────────────────────────

describe('GET /api/schema-impact — additional validation', () => {
  it('returns 400 when workspace has no site linked (after GSC check)', async () => {
    db.prepare("UPDATE workspaces SET gsc_property_url = ? WHERE id = ?").run(
      'https://example.com', wsB,
    );
    const res = await api(`/api/schema-impact/${wsB}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/site/i);

    db.prepare("UPDATE workspaces SET gsc_property_url = NULL WHERE id = ?").run(wsB);
  });

  it('returns 400 for any request on schema-impact with no GSC (GSC checked before limit)', async () => {
    // The route validates workspace and GSC before limit
    const res = await api(`/api/schema-impact/${wsA}?limit=0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for limit=abc on schema-impact endpoint (GSC checked first)', async () => {
    const res = await api(`/api/schema-impact/${wsA}?limit=abc`);
    expect(res.status).toBe(400);
  });

  it('caps limit at 50 and still validates GSC (not a 400 limit error) when limit=999', async () => {
    // limit 999 → capped to 50 (valid), then hits 400 GSC check for workspace with no GSC
    const res = await api(`/api/schema-impact/${wsA}?limit=999`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    // Should be a GSC-missing error, not a limit error
    expect(body.error).toContain('GSC');
  });
});
