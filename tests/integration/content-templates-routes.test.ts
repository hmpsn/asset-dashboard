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
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { createTemplate } from '../../server/content-templates.js';
import { createContentTemplateGenerationUpgradeProposal } from '../../server/domains/content/matrix-generation/template-upgrade.js';
import type { ContentTemplate } from '../../shared/types/content.js';
import { MATRIX_GENERATION_CONTRACT_VERSION } from '../../shared/types/matrix-generation.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Templates Test');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_templates WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('Content Templates — CRUD', () => {
  let templateId = '';
  let templateRevision = 0;

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

  it('rejects a claimed generation-ready template without explicit block contracts', async () => {
    const res = await postJson(`/api/content-templates/${testWsId}`, {
      name: 'Incomplete generation template',
      generationContractVersion: 1,
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: 'Body',
        guidance: 'Write the body.',
        wordCountTarget: 300,
        order: 0,
      }],
    });
    expect(res.status).toBe(400);

    const contradictory = await postJson(`/api/content-templates/${testWsId}`, {
      name: 'Contradictory generation template',
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      urlPattern: '/faq',
      keywordPattern: 'frequently asked questions',
      titlePattern: 'Frequently Asked Questions',
      metaDescPattern: 'Answers to frequently asked questions.',
      sections: [{
        id: 'faq',
        name: 'FAQ',
        headingTemplate: 'Questions',
        guidance: 'Answer common questions.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'faq',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
    });
    expect(contradictory.status).toBe(400);
    expect((await contradictory.json()).error).toContain('invalid_aeo_contract');
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
        {
          id: 's1',
          name: 'hero',
          headingTemplate: '{service} in {city}',
          guidance: 'Write intro',
          wordCountTarget: 150,
          order: 0,
          generationRole: 'body',
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 's2',
          name: 'faq',
          headingTemplate: 'FAQ',
          guidance: 'Common questions',
          wordCountTarget: 200,
          order: 1,
          generationRole: 'faq',
          aeoContract: { modes: ['faq', 'paa'], required: true },
          ctaContract: { role: 'none', required: false },
        },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
      titlePattern: '{service} in {city}',
      metaDescPattern: 'Explore {service} options in {city}.',
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^tpl_/);
    expect(body.name).toBe('Service × Location');
    expect(body.workspaceId).toBe(testWsId);
    expect(body.variables).toHaveLength(2);
    expect(body.sections).toHaveLength(2);
    expect(body.urlPattern).toBe('/services/{city}/{service}');
    expect(body.revision).toBe(1);
    expect(body.generationContractVersion).toBe(MATRIX_GENERATION_CONTRACT_VERSION);
    templateId = body.id;
    templateRevision = body.revision;
  });

  it('rejects a v1 template whose page type cannot enter generation', async () => {
    const res = await postJson(`/api/content-templates/${testWsId}`, {
      name: 'Unsupported provider template',
      pageType: 'provider-profile',
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      titlePattern: '{provider}',
      metaDescPattern: 'Learn about {provider}.',
      urlPattern: '/providers/{provider}',
      keywordPattern: '{provider}',
      variables: [{ name: 'provider', label: 'Provider' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{provider}',
        guidance: 'Describe the provider.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('unsupported_page_type');
  });

  it('returns exact field paths for malformed direct-v1 patterns', async () => {
    const valid = {
      name: 'Pattern validation template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Describe the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service}',
      titlePattern: '{service}',
      metaDescPattern: 'Learn about {service}.',
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    };
    const cases = [
      ['urlPattern', 'https://example.com/{service}'],
      ['keywordPattern', '{unknown}'],
      ['titlePattern', '{service'],
      ['metaDescPattern', '{{service}}'],
    ] as const;

    for (const [fieldPath, value] of cases) {
      const res = await postJson(`/api/content-templates/${testWsId}`, {
        ...valid,
        [fieldPath]: value,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain(`${fieldPath}:`);
      expect(body.errors[0].path).toBe(fieldPath);
    }
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
        expectedTemplateRevision: templateRevision,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Service × Location (v2)');
    expect(body.toneAndStyle).toBe('Professional and informative');
    expect(body.revision).toBe(2);
    templateRevision = body.revision;
    // Unchanged fields should persist
    expect(body.variables).toHaveLength(2);
    expect(body.sections).toHaveLength(2);
  });

  it('preserves a future raw page type when the editor PUTs its projected full DTO', async () => {
    const future = createTemplate(testWsId, {
      name: 'Future page template',
      pageType: 'service',
      variables: [],
      sections: [],
      urlPattern: '/future',
      keywordPattern: 'future',
    });
    db.prepare(`
      UPDATE content_templates
         SET page_type = 'future_service', generation_contract_version = 2
       WHERE id = ? AND workspace_id = ?
    `).run(future.id, testWsId);

    const getResponse = await api(`/api/content-templates/${testWsId}/${future.id}`);
    expect(getResponse.status).toBe(200);
    const projected = await getResponse.json() as ContentTemplate;
    expect(projected).toMatchObject({ pageType: 'custom', revision: future.revision });

    const saveResponse = await ctx.api(`/api/content-templates/${testWsId}/${future.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...projected,
        name: 'Future page template renamed in editor',
        expectedTemplateRevision: projected.revision,
      }),
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toMatchObject({
      name: 'Future page template renamed in editor',
      pageType: 'custom',
      revision: future.revision,
    });
    expect(db.prepare(`
      SELECT page_type, revision FROM content_templates WHERE id = ? AND workspace_id = ?
    `).get(future.id, testWsId)).toEqual({
      page_type: 'future_service',
      revision: future.revision,
    });

    const replaceResponse = await ctx.api(`/api/content-templates/${testWsId}/${future.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageType: 'service',
        expectedTemplateRevision: future.revision,
      }),
    });
    expect(replaceResponse.status).toBe(200);
    expect(await replaceResponse.json()).toMatchObject({
      pageType: 'service',
      revision: future.revision + 1,
    });
    expect((db.prepare(`
      SELECT page_type FROM content_templates WHERE id = ? AND workspace_id = ?
    `).get(future.id, testWsId) as { page_type: string }).page_type).toBe('service');

    db.prepare('DELETE FROM content_templates WHERE id = ? AND workspace_id = ?').run(
      future.id,
      testWsId,
    );
  });

  it('requires CAS for generation-effective edits and rejects stale revisions', async () => {
    const missing = await ctx.api(`/api/content-templates/${testWsId}/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titlePattern: '{service} near {city}' }),
    });
    expect(missing.status).toBe(400);

    const stale = await ctx.api(`/api/content-templates/${testWsId}/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titlePattern: '{service} near {city}',
        expectedTemplateRevision: templateRevision - 1,
      }),
    });
    expect(stale.status).toBe(409);
  });

  it('rejects a contractless direct update to a v1 template without changing it', async () => {
    const res = await ctx.api(`/api/content-templates/${testWsId}/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections: [{
          id: 'contractless',
          name: 'Contractless',
          headingTemplate: 'Contractless',
          guidance: 'This must not persist.',
          wordCountTarget: 100,
          order: 0,
        }],
        expectedTemplateRevision: templateRevision,
      }),
    });
    expect(res.status).toBe(400);

    const current = await api(`/api/content-templates/${testWsId}/${templateId}`);
    expect(await current.json()).toMatchObject({
      revision: templateRevision,
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [{ id: 's1' }, { id: 's2' }],
    });

    const clearedMetadata = await ctx.api(`/api/content-templates/${testWsId}/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titlePattern: '',
        metaDescPattern: '',
        expectedTemplateRevision: templateRevision,
      }),
    });
    expect(clearedMetadata.status).toBe(400);
    expect((await clearedMetadata.json()).error).toContain('missing_title_pattern');
  });

  it('rejects as a no-op, accepts once, and safely replays the exact generation upgrade', async () => {
    const legacy = createTemplate(testWsId, {
      name: 'Legacy service template',
      pageType: 'service',
      variables: [
        { name: 'city', label: 'City' },
        { name: 'service', label: 'Service' },
      ],
      sections: [
        { id: 'legacy-hero', name: 'hero', headingTemplate: '{service} in {city}', guidance: 'Write intro', wordCountTarget: 150, order: 0 },
        { id: 'legacy-faq', name: 'faq', headingTemplate: 'FAQ', guidance: 'Common questions', wordCountTarget: 200, order: 1 },
      ],
      urlPattern: '/legacy/{city}/{service}',
      keywordPattern: '{service} in {city}',
      titlePattern: '{service} in {city}',
      metaDescPattern: 'Learn about {service} in {city}.',
    });
    const legacyUpdate = await ctx.api(`/api/content-templates/${testWsId}/${legacy.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Legacy service template (edited)' }),
    });
    expect(legacyUpdate.status).toBe(200);
    const current = await legacyUpdate.json() as ContentTemplate;
    expect(current.generationContractVersion).toBeUndefined();

    const proposed = createContentTemplateGenerationUpgradeProposal(current);
    expect(proposed.status).toBe('proposal');
    if (proposed.status !== 'proposal') throw new Error('Expected upgrade proposal');
    const request = {
      expectedTemplateRevision: proposed.proposal.expectedTemplateRevision,
      proposalFingerprint: proposed.proposal.proposalFingerprint,
      idempotencyKey: 'http-template-upgrade',
    };

    const rejected = await postJson(
      `/api/content-templates/${testWsId}/${legacy.id}/accept-generation-upgrade`,
      { ...request, decision: 'reject' },
    );
    expect(rejected.status).toBe(200);
    const rejectedBody = await rejected.json();
    expect(rejectedBody).toMatchObject({
      status: 'rejected',
      replayed: false,
      template: { revision: current.revision },
    });
    expect(rejectedBody.template).not.toHaveProperty('generationContractVersion');

    const accepted = await postJson(
      `/api/content-templates/${testWsId}/${legacy.id}/accept-generation-upgrade`,
      { ...request, decision: 'accept' },
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json();
    expect(acceptedBody).toMatchObject({
      status: 'accepted',
      replayed: false,
      template: { generationContractVersion: 1 },
    });
    expect(acceptedBody.template.sections.length).toBeGreaterThan(0);
    expect(acceptedBody.template.sections.every((section: { generationRole?: string }) => ( // every-ok -- non-empty asserted above
      typeof section.generationRole === 'string'
    ))).toBe(true);
    const acceptedRevision = acceptedBody.template.revision;

    const replayed = await postJson(
      `/api/content-templates/${testWsId}/${legacy.id}/accept-generation-upgrade`,
      { ...request, decision: 'accept' },
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toMatchObject({
      status: 'accepted',
      replayed: true,
      template: { revision: acceptedRevision },
    });

    const conflicting = await postJson(
      `/api/content-templates/${testWsId}/${legacy.id}/accept-generation-upgrade`,
      { ...request, proposalFingerprint: 'b'.repeat(64), decision: 'accept' },
    );
    expect(conflicting.status).toBe(409);
    db.prepare('DELETE FROM content_templates WHERE id = ? AND workspace_id = ?').run(
      legacy.id,
      testWsId,
    );
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
