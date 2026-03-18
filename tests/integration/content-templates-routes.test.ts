/**
 * Integration tests for content-templates API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-templates/:workspaceId (list)
 * - POST /api/content-templates/:workspaceId (create)
 * - GET /api/content-templates/:workspaceId/:templateId (get)
 * - PUT /api/content-templates/:workspaceId/:templateId (update)
 * - POST /api/content-templates/:workspaceId/:templateId/duplicate (duplicate)
 * - DELETE /api/content-templates/:workspaceId/:templateId (delete)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13240);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Templates Test');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Content Templates — CRUD', () => {
  let templateId = '';

  it('GET /api/content-templates/:wsId returns empty array initially', async () => {
    const res = await api(`/api/content-templates/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('POST without name returns 400', async () => {
    const res = await postJson(`/api/content-templates/${testWsId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('name');
  });

  it('POST creates a template', async () => {
    const res = await postJson(`/api/content-templates/${testWsId}`, {
      name: 'Service × Location',
      description: 'Service pages for each city',
      pageType: 'service',
      variables: [
        { name: 'city', label: 'City' },
        { name: 'service', label: 'Service' },
      ],
      sections: [
        { id: 's1', name: 'hero', headingTemplate: '{service} in {city}', guidance: 'Write intro', wordCountTarget: 150, order: 0 },
        { id: 's2', name: 'faq', headingTemplate: 'FAQ', guidance: 'Common questions', wordCountTarget: 200, order: 1 },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^tpl_/);
    expect(body.name).toBe('Service × Location');
    expect(body.workspaceId).toBe(testWsId);
    expect(body.variables).toHaveLength(2);
    expect(body.sections).toHaveLength(2);
    expect(body.urlPattern).toBe('/services/{city}/{service}');
    templateId = body.id;
  });

  it('GET returns the created template in list', async () => {
    const res = await api(`/api/content-templates/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(templateId);
  });

  it('GET by ID returns the template', async () => {
    const res = await api(`/api/content-templates/${testWsId}/${templateId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(templateId);
    expect(body.pageType).toBe('service');
    expect(body.keywordPattern).toBe('{service} in {city}');
  });

  it('GET by non-existent ID returns 404', async () => {
    const res = await api(`/api/content-templates/${testWsId}/tpl_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('PUT updates the template', async () => {
    const res = await ctx.api(`/api/content-templates/${testWsId}/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Service × Location (v2)',
        description: 'Updated description',
        toneAndStyle: 'Professional and informative',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Service × Location (v2)');
    expect(body.toneAndStyle).toBe('Professional and informative');
    // Unchanged fields should persist
    expect(body.variables).toHaveLength(2);
    expect(body.sections).toHaveLength(2);
  });

  it('POST duplicate creates a copy', async () => {
    const res = await postJson(`/api/content-templates/${testWsId}/${templateId}/duplicate`, {
      name: 'Service × Location Copy',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).not.toBe(templateId);
    expect(body.name).toBe('Service × Location Copy');
    expect(body.variables).toHaveLength(2);
    expect(body.sections).toHaveLength(2);

    // Clean up the copy
    const delRes = await del(`/api/content-templates/${testWsId}/${body.id}`);
    expect(delRes.status).toBe(200);
  });

  it('DELETE removes the template', async () => {
    const res = await del(`/api/content-templates/${testWsId}/${templateId}`);
    expect(res.status).toBe(200);

    const listRes = await api(`/api/content-templates/${testWsId}`);
    const list = await listRes.json();
    expect(list.length).toBe(0);
  });

  it('DELETE non-existent returns 404', async () => {
    const res = await del(`/api/content-templates/${testWsId}/tpl_nonexistent`);
    expect(res.status).toBe(404);
  });
});
