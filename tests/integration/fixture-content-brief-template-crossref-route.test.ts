import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMatrix } from '../../server/content-matrices.js';
import { createTemplate, deleteTemplate } from '../../server/content-templates.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let seeded: SeededFullWorkspace | null = null;
let foreignAuth: SeededAuth | null = null;

describe('Fixture content brief template-crossref route', () => {
  beforeAll(async () => {
    await ctx.startServer();
    seeded = seedWorkspace();
    foreignAuth = await seedAuthData();
  }, 25_000);

  afterAll(async () => {
    try {
      seeded?.cleanup();
      foreignAuth?.cleanup();
    } finally {
      await ctx.stopServer();
    }
  });

  it('GET /api/content-briefs/:workspaceId/template-crossref without keyword returns 400', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref`);
    expect(res.status).toBe(400);

    const body = await res.json() as { error?: string };
    expect(typeof body.error).toBe('string');
  });

  it('rejects malformed identifier/query variants with consistent 400 shape', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const whitespaceRes = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref?keyword=%20%20%20`);
    expect(whitespaceRes.status).toBe(400);
    await expect(whitespaceRes.json()).resolves.toEqual({ error: 'keyword query param required' });

    const repeatedKeyRes = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref?keyword=alpha&keyword=beta`);
    expect(repeatedKeyRes.status).toBe(400);
    await expect(repeatedKeyRes.json()).resolves.toEqual({ error: 'keyword query param required' });
  });

  it('enforces workspace isolation for JWT users from other workspaces', async () => {
    expect(seeded).toBeTruthy();
    expect(foreignAuth).toBeTruthy();
    if (!seeded || !foreignAuth) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref?keyword=service`, {
      headers: { Authorization: `Bearer ${foreignAuth.adminToken}` },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'You do not have access to this workspace' });
  });

  it('returns consistent null when cross-reference records are absent or stale', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const template = createTemplate(seeded.workspaceId, {
      name: 'Fixture Orphan Crossref Template',
      pageType: 'service',
      sections: [],
      urlPattern: '/services/orphan',
      keywordPattern: 'orphan template keyword',
    });

    createMatrix(seeded.workspaceId, {
      name: 'Fixture Orphan Crossref Matrix',
      templateId: template.id,
      dimensions: [{ id: 'dim-city', name: 'City', variableName: 'city', values: ['Austin'] }],
      urlPattern: '/services/austin',
      keywordPattern: 'orphan template keyword',
    });

    expect(deleteTemplate(seeded.workspaceId, template.id)).toBe(true);

    const staleRefRes = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref?keyword=orphan%20template%20keyword`);
    expect(staleRefRes.status).toBe(200);
    await expect(staleRefRes.json()).resolves.toBeNull();

    const staleRefRepeatRes = await api(`/api/content-briefs/${seeded.workspaceId}/template-crossref?keyword=orphan%20template%20keyword`);
    expect(staleRefRepeatRes.status).toBe(200);
    await expect(staleRefRepeatRes.json()).resolves.toBeNull();

    const unknownWorkspaceRes = await api('/api/content-briefs/ws_nonexistent_fixture_xref/template-crossref?keyword=orphan%20template%20keyword');
    expect(unknownWorkspaceRes.status).toBe(200);
    await expect(unknownWorkspaceRes.json()).resolves.toBeNull();
  });
});
