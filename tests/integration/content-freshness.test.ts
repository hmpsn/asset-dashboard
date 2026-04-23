import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const PORT = 13341;
const STALE_DATE = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

const ctx = createTestContext(PORT);

describe('content freshness detection', () => {
  let seed: ReturnType<typeof seedWorkspace>;

  beforeAll(async () => {
    await ctx.startServer();
    seed = seedWorkspace({ tier: 'growth', clientPassword: '' });
    db.prepare(`
      INSERT OR REPLACE INTO page_keywords
        (workspace_id, page_path, page_title, primary_keyword, secondary_keywords,
         impressions, clicks, analysis_generated_at)
      VALUES (?, '/stale-page', 'Stale Page', 'stale keyword', '[]', 500, 30, ?)
    `).run(seed.workspaceId, STALE_DATE);
  }, 30_000);

  afterAll(() => {
    seed?.cleanup();
    ctx.stopServer();
  });

  it('GET /api/public/insights/:workspaceId returns array (freshness schema accepted)', async () => {
    const res = await ctx.api(`/api/public/insights/${seed.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
