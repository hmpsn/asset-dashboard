// tests/integration/mcp-local-seo.test.ts
// Verify MCP get_workspace_intelligence surfaces the full localSeo slice to
// external MCP consumers (full candidate list — no sampling).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { handleIntelligenceTool } from '../../server/mcp/tools/intelligence.js';
import { updateLocalSeoConfiguration } from '../../server/local-seo.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE } from '../../shared/types/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import { vi } from 'vitest';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  setFlagOverride('local-seo-visibility', true);
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      keywords_per_refresh INTEGER
    );
    CREATE TABLE IF NOT EXISTS local_seo_markets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      city TEXT NOT NULL,
      state_or_region TEXT,
      country TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      provider_location_code INTEGER,
      provider_location_name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'needs_review',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Defensive: if a prior test created the settings table without the new
  // column, add it now. Ignore the duplicate-column error.
  try {
    db.exec(`ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
  workspaceId = createWorkspace(`MCP Local SEO ${randomUUID().slice(0, 6)}`).id;
  updateWorkspace(workspaceId, {
    name: 'MCP local SEO test',
    liveDomain: 'https://swish.example.com',
    businessProfile: {
      address: { street: '100 Service St', city: 'Austin', region: 'TX', country: 'US', postalCode: '78701' },
      serviceAreas: ['Austin'],
    },
  } as never);
  updateLocalSeoConfiguration(workspaceId, {
    posture: LOCAL_SEO_POSTURE.LOCAL,
    markets: [
      { label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
    ],
  }, true);
  upsertPageKeyword(workspaceId, {
    pagePath: '/services/emergency-plumbing',
    pageTitle: 'Emergency Plumbing',
    primaryKeyword: 'emergency plumbing',
    secondaryKeywords: [],
    searchIntent: 'commercial',
  });
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
  setFlagOverride('local-seo-visibility', null);
});

describe('MCP get_workspace_intelligence — localSeo slice', () => {
  it('accepts slices: ["localSeo"] and returns the full slice', async () => {
    const res = await handleIntelligenceTool('get_workspace_intelligence', {
      workspaceId,
      slices: ['localSeo'],
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.localSeo).toBeDefined();
    expect(body.localSeo.markets.length).toBe(1);
    expect(body.localSeo.enabled).toBe(true);
    expect(Array.isArray(body.localSeo.candidates)).toBe(true);
    expect(typeof body.localSeo.effectiveLocalSeoBlock).toBe('string');
  });

  it('returns localSeo by default when no slices arg provided', async () => {
    const res = await handleIntelligenceTool('get_workspace_intelligence', { workspaceId });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    // localSeo should be included in the default ALL slices set
    expect(body.localSeo).toBeDefined();
  });

  it('ignores invalid slice names and still serves the request', async () => {
    const res = await handleIntelligenceTool('get_workspace_intelligence', {
      workspaceId,
      slices: ['localSeo', 'notARealSlice'],
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.localSeo).toBeDefined();
  });
});
