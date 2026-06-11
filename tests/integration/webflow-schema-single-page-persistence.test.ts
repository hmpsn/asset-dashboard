// tests/integration/webflow-schema-single-page-persistence.test.ts
//
// W2.3 Bug #1 — single-page generation/regeneration must persist to the snapshot
// so output survives reload (and a SCHEMA_SNAPSHOT_UPDATED refetch does not clobber
// it). The single-page generation route (POST /api/webflow/schema-suggestions/:siteId/page)
// calls upsertPageResultInSnapshot() after generation; the AI call itself runs in the
// server child process and cannot be mocked from here, so this test exercises the
// ACTUAL read path: persist via the store function the route uses → GET the snapshot
// route → assert the page is present with its generated schema.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  upsertPageResultInSnapshot,
  deleteSchemaSnapshot,
  getSchemaSnapshot,
} from '../../server/schema-store.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const SITE_ID = `schema-single-${Date.now()}`;
let workspaceId = '';

function makePageResult(pageId: string, slug: string, name: string): SchemaPageSuggestion {
  return {
    pageId,
    pageTitle: name,
    slug,
    url: `https://example.test${slug === '/' ? '' : slug}`,
    existingSchemas: [],
    suggestedSchemas: [
      { type: 'WebPage', reason: 'generated', priority: 'high', template: { '@context': 'https://schema.org', '@type': 'WebPage', name } },
    ],
  };
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Schema Single Page Persistence WS');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { webflowSiteId: SITE_ID, webflowToken: 'single-page-token' });
}, 30_000);

afterAll(async () => {
  deleteSchemaSnapshot(SITE_ID);
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('single-page schema generation persistence (read path)', () => {
  it('persists a first-page generation when no snapshot exists, and GET snapshot returns it', async () => {
    expect(getSchemaSnapshot(SITE_ID)).toBeNull();

    // Mirrors the route: upsert the generated result.
    upsertPageResultInSnapshot(SITE_ID, workspaceId, makePageResult('page-a', '/services', 'Services'));

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    const page = body.results.find((r: { pageId: string }) => r.pageId === 'page-a');
    expect(page).toBeDefined();
    expect(page.suggestedSchemas[0].template).toMatchObject({ name: 'Services' });
  });

  it('appends a newly-generated page (Add Page) without dropping existing pages', async () => {
    upsertPageResultInSnapshot(SITE_ID, workspaceId, makePageResult('page-b', '/about', 'About'));

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    const body = await res.json();
    const ids = body.results.map((r: { pageId: string }) => r.pageId).sort();
    expect(ids).toContain('page-a');
    expect(ids).toContain('page-b');
  });

  it('replaces a regenerated page result while preserving the others', async () => {
    upsertPageResultInSnapshot(SITE_ID, workspaceId, makePageResult('page-a', '/services', 'Regenerated Services'));

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    const body = await res.json();
    const pageA = body.results.find((r: { pageId: string }) => r.pageId === 'page-a');
    const pageB = body.results.find((r: { pageId: string }) => r.pageId === 'page-b');
    expect(pageA.suggestedSchemas[0].template).toMatchObject({ name: 'Regenerated Services' });
    expect(pageB.suggestedSchemas[0].template).toMatchObject({ name: 'About' });
  });
});
