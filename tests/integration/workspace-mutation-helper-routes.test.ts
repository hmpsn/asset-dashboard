/**
 * Integration smoke tests: workspace mutation helper via content-template and
 * content-matrix CRUD routes.
 *
 * server/routes/workspace-mutation-helper.ts is a re-export barrel (not a route
 * file), so these tests exercise the mutation-helper lifecycle indirectly through
 * the two highest-traffic consumers: content-templates and content-matrices.
 *
 * Scenarios:
 *   Content Templates:
 *     - List → 200 empty array
 *     - Create valid → 201 with id
 *     - Create missing name → 400
 *     - Get by id → 200
 *     - Get unknown id → 404
 *     - Update valid → 200
 *     - Update unknown → 404
 *     - Duplicate → 201 new id
 *     - Delete → 200 { ok: true }
 *     - Delete unknown → 404
 *   Content Matrices:
 *     - Create valid → 201
 *     - Create missing name → 400
 *     - Create missing templateId → 400
 *     - List → 200
 *     - Get by id → 200
 *     - Get unknown → 404
 *     - Update valid → 200
 *     - Delete → 200 { ok: true }
 *     - Delete unknown → 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';
let wsBId = '';

function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Mutation Helper Routes WS-A').id;
  wsBId = createWorkspace('Mutation Helper Routes WS-B').id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_templates WHERE workspace_id IN (?, ?)').run(wsId, wsBId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id IN (?, ?)').run(wsId, wsBId);
  deleteWorkspace(wsId);
  deleteWorkspace(wsBId);
  await ctx.stopServer();
});

// ── Content Templates ──────────────────────────────────────────────────────────

describe('content-templates via workspace-mutation-helper', () => {
  it('GET /api/content-templates/:workspaceId returns 200 with empty array initially', async () => {
    const res = await api(`/api/content-templates/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('POST creates a template and returns 201 with id', async () => {
    const res = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Service Page Template',
      pageType: 'service',
      sections: [],
      variables: [],
      urlPattern: '/services/{slug}',
      keywordPattern: '{slug} services',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; name: string };
    expect(body.id).toMatch(/^tpl_/);
    expect(body.name).toBe('Service Page Template');
  });

  it('POST with missing name returns 400', async () => {
    const res = await postJson(`/api/content-templates/${wsId}`, {
      pageType: 'blog',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/name/i);
  });

  it('GET /api/content-templates/:workspaceId/:templateId returns 200 for existing template', async () => {
    const created = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Get By Id Template',
      pageType: 'location',
      sections: [],
      variables: [],
      urlPattern: '/location/{slug}',
      keywordPattern: '{slug}',
    });
    const { id } = await created.json() as { id: string };

    const res = await api(`/api/content-templates/${wsId}/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; name: string };
    expect(body.id).toBe(id);
    expect(body.name).toBe('Get By Id Template');
  });

  it('GET /api/content-templates/:workspaceId/:templateId returns 404 for unknown id', async () => {
    const res = await api(`/api/content-templates/${wsId}/tpl_does_not_exist_999`);
    expect(res.status).toBe(404);
  });

  it('PUT /api/content-templates/:workspaceId/:templateId updates and returns 200', async () => {
    const created = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Before Update',
      pageType: 'faq',
      sections: [],
      variables: [],
      urlPattern: '/faq/{slug}',
      keywordPattern: '{slug} faq',
    });
    const { id } = await created.json() as { id: string };

    const res = await putJson(`/api/content-templates/${wsId}/${id}`, {
      name: 'After Update',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; name: string };
    expect(body.name).toBe('After Update');
  });

  it('PUT on unknown template returns 404', async () => {
    const res = await putJson(`/api/content-templates/${wsId}/tpl_ghost_999`, {
      name: 'Ghost',
    });
    expect(res.status).toBe(404);
  });

  it('POST /duplicate creates a copy with a new id', async () => {
    const original = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Original',
      pageType: 'service',
      sections: [],
      variables: [],
      urlPattern: '/orig/{slug}',
      keywordPattern: 'orig {slug}',
    });
    const { id: origId } = await original.json() as { id: string };

    const res = await postJson(`/api/content-templates/${wsId}/${origId}/duplicate`, {
      name: 'Copy of Original',
    });
    expect(res.status).toBe(201);
    const copy = await res.json() as { id: string; name: string };
    expect(copy.id).not.toBe(origId);
    expect(copy.id).toMatch(/^tpl_/);
  });

  it('DELETE removes the template and returns { ok: true }', async () => {
    const created = await postJson(`/api/content-templates/${wsId}`, {
      name: 'To Be Deleted',
      pageType: 'landing',
      sections: [],
      variables: [],
      urlPattern: '/delete-me',
      keywordPattern: 'delete me',
    });
    const { id } = await created.json() as { id: string };

    const delRes = await del(`/api/content-templates/${wsId}/${id}`);
    expect(delRes.status).toBe(200);
    const body = await delRes.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Confirm gone
    const getRes = await api(`/api/content-templates/${wsId}/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE on unknown template returns 404', async () => {
    const res = await del(`/api/content-templates/${wsId}/tpl_ghost_delete_999`);
    expect(res.status).toBe(404);
  });
});

// ── Content Matrices ───────────────────────────────────────────────────────────

describe('content-matrices via workspace-mutation-helper', () => {
  it('POST creates a matrix and returns 201', async () => {
    const res = await postJson(`/api/content-matrices/${wsId}`, {
      name: 'City Matrix',
      templateId: 'tpl_city',
      dimensions: [{ variableName: 'city', values: ['Austin', 'Dallas'] }],
      urlPattern: '/city/{city}',
      keywordPattern: '{city} seo',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; name: string; cells: unknown[] };
    expect(body.id).toMatch(/^mtx_/);
    expect(body.name).toBe('City Matrix');
    expect(Array.isArray(body.cells)).toBe(true);
  });

  it('POST matrix with missing name returns 400', async () => {
    const res = await postJson(`/api/content-matrices/${wsId}`, {
      templateId: 'tpl_abc',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/name/i);
  });

  it('POST matrix with missing templateId returns 400', async () => {
    const res = await postJson(`/api/content-matrices/${wsId}`, {
      name: 'No Template Matrix',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/templateId/i);
  });

  it('GET /api/content-matrices/:workspaceId returns 200 with matrices array', async () => {
    const res = await api(`/api/content-matrices/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/content-matrices/:workspaceId/:matrixId returns 200 for existing matrix', async () => {
    const created = await postJson(`/api/content-matrices/${wsId}`, {
      name: 'Get By Id Matrix',
      templateId: 'tpl_service',
      dimensions: [{ variableName: 'service', values: ['SEO'] }],
      urlPattern: '/service/{service}',
      keywordPattern: '{service}',
    });
    const { id } = await created.json() as { id: string };

    const res = await api(`/api/content-matrices/${wsId}/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe(id);
  });

  it('GET /api/content-matrices/:workspaceId/:matrixId returns 404 for unknown id', async () => {
    const res = await api(`/api/content-matrices/${wsId}/mtx_ghost_999`);
    expect(res.status).toBe(404);
  });

  it('PUT updates a matrix and returns 200', async () => {
    const created = await postJson(`/api/content-matrices/${wsId}`, {
      name: 'Before Matrix Update',
      templateId: 'tpl_update',
      dimensions: [],
      urlPattern: '/update/{x}',
      keywordPattern: 'update {x}',
    });
    const { id } = await created.json() as { id: string };

    const res = await putJson(`/api/content-matrices/${wsId}/${id}`, {
      name: 'After Matrix Update',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string };
    expect(body.name).toBe('After Matrix Update');
  });

  it('DELETE removes the matrix and returns { ok: true }', async () => {
    const created = await postJson(`/api/content-matrices/${wsId}`, {
      name: 'Delete Me Matrix',
      templateId: 'tpl_del',
      dimensions: [{ variableName: 'x', values: ['a'] }],
      urlPattern: '/del/{x}',
      keywordPattern: 'del {x}',
    });
    const { id } = await created.json() as { id: string };

    const delRes = await del(`/api/content-matrices/${wsId}/${id}`);
    expect(delRes.status).toBe(200);
    const body = await delRes.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    const getRes = await api(`/api/content-matrices/${wsId}/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE on unknown matrix returns 404', async () => {
    const res = await del(`/api/content-matrices/${wsId}/mtx_ghost_del_999`);
    expect(res.status).toBe(404);
  });
});
