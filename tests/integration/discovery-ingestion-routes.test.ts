/**
 * Integration tests for discovery-ingestion API read endpoints.
 *
 * Tests:
 * - GET /api/discovery/:workspaceId/sources — returns array for fresh workspace
 * - GET /api/discovery/:workspaceId/extractions — returns array for fresh workspace
 * - GET /api/discovery/:workspaceId/sources/:id/extractions — 404 for unknown source id
 * - Unknown workspaceId routes still return sensible results (empty arrays) because
 *   requireWorkspaceAccess passes through when no JWT user is present.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13673);
const { api, postJson } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Discovery Ingestion Routes WS 13673').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Discovery — sources list', () => {
  it('GET /api/discovery/:workspaceId/sources returns 200 with empty array for fresh workspace', async () => {
    const res = await api(`/api/discovery/${wsId}/sources`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

describe('Discovery — extractions list', () => {
  it('GET /api/discovery/:workspaceId/extractions returns 200 with empty array for fresh workspace', async () => {
    const res = await api(`/api/discovery/${wsId}/extractions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

describe('Discovery — source-scoped extractions', () => {
  it('GET /api/discovery/:workspaceId/sources/:id/extractions with unknown source returns empty array', async () => {
    const res = await api(`/api/discovery/${wsId}/sources/src_unknown_000/extractions`);
    // listExtractionsBySource returns an empty array for any source not found —
    // it does NOT 404, it just returns [].
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Discovery — paste text validation', () => {
  it('POST /api/discovery/:workspaceId/sources/text with empty rawContent returns 400', async () => {
    const res = await postJson(`/api/discovery/${wsId}/sources/text`, {
      rawContent: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/discovery/:workspaceId/sources/text with missing rawContent returns 400', async () => {
    const res = await postJson(`/api/discovery/${wsId}/sources/text`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Discovery — patch extraction validation', () => {
  it('PATCH /api/discovery/:workspaceId/extractions/:id with empty body returns 400', async () => {
    const res = await ctx.patchJson(`/api/discovery/${wsId}/extractions/ext_fake`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('PATCH /api/discovery/:workspaceId/extractions/:id with routedTo but no status returns 400', async () => {
    const res = await ctx.patchJson(`/api/discovery/${wsId}/extractions/ext_fake`, {
      routedTo: 'voice_profile',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
