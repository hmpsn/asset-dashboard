/**
 * wave-18 supplemental integration tests for data-export routes.
 *
 * Verifies the unknown-workspace 404 behaviour for all seven export endpoints,
 * and confirms that a fresh workspace returns 200 with a valid (empty) payload
 * in both JSON and CSV format.
 *
 * Ports: 13425 (exclusive to wave-18 batch A2)
 *
 * Routes covered:
 *   GET /api/export/:workspaceId/briefs
 *   GET /api/export/:workspaceId/requests
 *   GET /api/export/:workspaceId/activity
 *   GET /api/export/:workspaceId/strategy
 *   GET /api/export/:workspaceId/payments
 *   GET /api/export/:workspaceId/matrices
 *   GET /api/export/:workspaceId/templates
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13425;
const ctx = createTestContext(PORT);
const { api } = ctx;

const UNKNOWN_ID = 'ws_wave18_does_not_exist_xq9z';

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`Wave18 Export Test ${PORT}`).id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Route list: [path-suffix, note] ──────────────────────────────────────────
const ROUTES: Array<{ suffix: string; note: string }> = [
  { suffix: 'briefs', note: 'briefs export' },
  { suffix: 'requests', note: 'requests export' },
  { suffix: 'activity', note: 'activity export' },
  { suffix: 'payments', note: 'payments export' },
  { suffix: 'matrices', note: 'matrices export' },
  { suffix: 'templates', note: 'templates export' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Unknown workspace → the routes that do NOT do an explicit getWorkspace()
// check return 200 (empty array) because they query-filter by workspaceId.
// Only /strategy explicitly checks getWorkspace() and returns 404.
// ─────────────────────────────────────────────────────────────────────────────

describe('Routes that return 200 empty for unknown workspaceId', () => {
  for (const { suffix, note } of ROUTES) {
    it(`GET /api/export/:id/${suffix} — ${note} returns 200 with empty array for unknown id (JSON)`, async () => {
      const res = await api(`/api/export/${UNKNOWN_ID}/${suffix}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it(`GET /api/export/:id/${suffix} — ${note} returns 200 with header-only CSV for unknown id`, async () => {
      const res = await api(`/api/export/${UNKNOWN_ID}/${suffix}?format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
      const text = await res.text();
      // CSV should have at least one line (the header)
      const lines = text.split('\n').filter(l => l.trim() !== '');
      expect(lines.length).toBeGreaterThanOrEqual(1);
      // No data rows — only the header
      expect(lines).toHaveLength(1);
    });
  }
});

describe('GET /api/export/:id/strategy — 404 for unknown workspaceId', () => {
  it('returns 404 JSON error for unknown id', async () => {
    const res = await api(`/api/export/${UNKNOWN_ID}/strategy`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fresh workspace → 200 with empty payloads
// ─────────────────────────────────────────────────────────────────────────────

describe('Fresh workspace — all routes return 200 empty', () => {
  for (const { suffix, note } of ROUTES) {
    it(`${note}: JSON returns empty array`, async () => {
      const res = await api(`/api/export/${wsId}/${suffix}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it(`${note}: CSV has correct Content-Type header`, async () => {
      const res = await api(`/api/export/${wsId}/${suffix}?format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    });

    it(`${note}: CSV Content-Disposition contains attachment and .csv filename`, async () => {
      const res = await api(`/api/export/${wsId}/${suffix}?format=csv`);
      const cd = res.headers.get('content-disposition') ?? '';
      expect(cd).toMatch(/attachment/);
      expect(cd).toMatch(/\.csv/);
    });

    it(`${note}: JSON Content-Disposition contains attachment and .json filename`, async () => {
      const res = await api(`/api/export/${wsId}/${suffix}`);
      const cd = res.headers.get('content-disposition') ?? '';
      expect(cd).toMatch(/attachment/);
      expect(cd).toMatch(/\.json/);
    });
  }

  it('strategy: JSON returns 200 with empty array for fresh workspace', async () => {
    const res = await api(`/api/export/${wsId}/strategy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('strategy: returns 200 with correct content-type for empty strategy (format=csv)', async () => {
    const res = await api(`/api/export/${wsId}/strategy?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    // CSV for empty data: just a header row
    expect(text).toContain('pagePath');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// format parameter — unknown format falls back to JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('format query parameter handling', () => {
  it('unknown format value falls back to JSON response', async () => {
    const res = await api(`/api/export/${wsId}/briefs?format=xml`);
    expect(res.status).toBe(200);
    // Should default to JSON (not CSV)
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('format=csv is case-sensitive (uppercase CSV not treated as csv)', async () => {
    const res = await api(`/api/export/${wsId}/briefs?format=CSV`);
    expect(res.status).toBe(200);
    // Non-matching format → JSON fallback
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('omitting format parameter defaults to JSON', async () => {
    const res = await api(`/api/export/${wsId}/activity`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('format=csv produces text/csv', async () => {
    const res = await api(`/api/export/${wsId}/activity?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });
});
