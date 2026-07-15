/**
 * M4 pSEO bridge integration coverage.
 *
 * Exercises the real HTTP and MCP boundaries against one durable blueprint
 * entry. Matrix materialization must be atomic, idempotent, workspace-scoped,
 * collision-safe, and separate from paid generation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createMcpApiKey, revokeMcpApiKey } from '../../server/mcp/api-keys.js';
import { createMatrix, getMatrix, listMatrices } from '../../server/content-matrices.js';
import { createTemplate, updateTemplate } from '../../server/content-templates.js';
import { addEntry, createBlueprint, getEntry } from '../../server/page-strategy.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const MASTER_KEY = 'pseo-matrix-bridge-master-key';
const ctx = createEphemeralTestContext(import.meta.url, {
  env: { MCP_API_KEY: MASTER_KEY },
});

let workspaceA: ReturnType<typeof seedWorkspace>;
let workspaceB: ReturnType<typeof seedWorkspace>;
let workspaceKeyId = '';
let workspaceKey = '';

function makeWorkspaceLocalOnly(workspaceId: string): void {
  db.prepare(`
    UPDATE workspaces
       SET webflow_site_id = NULL,
           webflow_token = NULL,
           live_domain = NULL
     WHERE id = ?
  `).run(workspaceId);
}

function cleanupWorkspaceArtifacts(workspaceId: string): void {
  db.prepare('DELETE FROM content_matrix_generation_runs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_templates WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(workspaceId);
}

async function mcpPost(body: unknown, token: string): Promise<Response> {
  return ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  token = MASTER_KEY,
): Promise<{ isError?: boolean; payload: Record<string, unknown> }> {
  await mcpPost({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'pseo-bridge-test', version: '1.0' },
    },
    id: 0,
  }, token);
  const response = await mcpPost({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  }, token);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  };
  const text = body.result?.content?.find(item => item.type === 'text')?.text ?? '{}';
  return {
    isError: body.result?.isError,
    payload: JSON.parse(text) as Record<string, unknown>,
  };
}

function createCollectionPlan(
  workspaceId: string,
  suffix: string,
  options: {
    urlPattern?: string;
    keywordPattern?: string;
    isCollection?: boolean;
  } = {},
) {
  const template = createTemplate(workspaceId, {
    name: `Location template ${suffix}`,
    pageType: 'location',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'location', label: 'Location' },
    ],
    sections: [],
    urlPattern: options.urlPattern ?? `/locations/${suffix}/{location}/{service}`,
    keywordPattern: options.keywordPattern ?? `{service} in {location} ${suffix}`,
    titlePattern: `{service} in {location}`,
    metaDescPattern: `Learn about {service} in {location}.`,
  });
  const blueprint = createBlueprint({
    workspaceId,
    name: `pSEO blueprint ${suffix}`,
  });
  const entry = addEntry(workspaceId, blueprint.id, {
    name: `Service locations ${suffix}`,
    pageType: 'location',
    isCollection: options.isCollection ?? true,
    templateId: template.id,
  });
  if (!entry) throw new Error('Expected blueprint entry');
  return { template, blueprint, entry };
}

const httpDimensions = [
  { variableName: 'service', values: ['Wash and Fold', 'Dry Cleaning'] },
  { variableName: 'location', values: ['Austin', 'Round Rock'] },
];

const mcpDimensions = [
  { variable_name: 'service', values: ['Wash and Fold', 'Dry Cleaning'] },
  { variable_name: 'location', values: ['Austin', 'Round Rock'] },
];

function httpExpectedSource(plan: ReturnType<typeof createCollectionPlan>) {
  return {
    entryUpdatedAt: plan.entry.updatedAt,
    templateId: plan.template.id,
    templateRevision: plan.template.revision ?? 0,
  };
}

function mcpExpectedSource(plan: ReturnType<typeof createCollectionPlan>) {
  return {
    entry_updated_at: plan.entry.updatedAt,
    template_id: plan.template.id,
    template_revision: plan.template.revision ?? 0,
  };
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceA = seedWorkspace();
  workspaceB = seedWorkspace();
  makeWorkspaceLocalOnly(workspaceA.workspaceId);
  makeWorkspaceLocalOnly(workspaceB.workspaceId);
  const createdKey = createMcpApiKey(workspaceA.workspaceId, 'pSEO bridge integration');
  workspaceKeyId = createdKey.id;
  workspaceKey = createdKey.plaintextKeyOnceShown;
}, 30_000);

afterAll(async () => {
  if (workspaceKeyId) revokeMcpApiKey(workspaceKeyId);
  if (workspaceA) cleanupWorkspaceArtifacts(workspaceA.workspaceId);
  if (workspaceB) cleanupWorkspaceArtifacts(workspaceB.workspaceId);
  workspaceA?.cleanup();
  workspaceB?.cleanup();
  await ctx.stopServer();
});

describe('pSEO blueprint-to-matrix materialization', () => {
  it('creates one exact Cartesian matrix over HTTP and replays the same source through MCP', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'happy');
    const path = `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`;

    const createdResponse = await ctx.postJson(path, {
      expectedSourceRevision: httpExpectedSource(plan),
      dimensions: httpDimensions,
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      replayed: boolean;
      source: {
        workspaceId: string;
        blueprintId: string;
        entryId: string;
        entryUpdatedAt: string;
        templateId: string;
        templateRevision: number;
        matrixId: string;
      };
      matrix: { id: string; revision: number; templateRevision: number; cellCount: number };
    };
    expect(created).toMatchObject({
      replayed: false,
      source: {
        workspaceId: workspaceA.workspaceId,
        blueprintId: plan.blueprint.id,
        entryId: plan.entry.id,
        entryUpdatedAt: expect.any(String),
        templateId: plan.template.id,
        templateRevision: 1,
        matrixId: created.matrix.id,
      },
      matrix: {
        revision: 1,
        templateRevision: 1,
        cellCount: 4,
      },
    });

    const matrix = getMatrix(workspaceA.workspaceId, created.matrix.id);
    expect(matrix?.cells).toHaveLength(4);
    expect(matrix?.cells.map(cell => cell.variableValues)).toEqual([
      { service: 'Wash and Fold', location: 'Austin' },
      { service: 'Wash and Fold', location: 'Round Rock' },
      { service: 'Dry Cleaning', location: 'Austin' },
      { service: 'Dry Cleaning', location: 'Round Rock' },
    ]);
    expect(getEntry(workspaceA.workspaceId, plan.blueprint.id, plan.entry.id)?.matrixId)
      .toBe(created.matrix.id);

    const replay = await callTool('create_content_matrix_from_pseo_plan', {
      workspace_id: workspaceA.workspaceId,
      blueprint_id: plan.blueprint.id,
      entry_id: plan.entry.id,
      expected_source_revision: mcpExpectedSource(plan),
      dimensions: mcpDimensions,
    }, workspaceKey);
    expect(replay.isError).toBeFalsy();
    expect(replay.payload).toMatchObject({
      replayed: true,
      source: {
        workspace_id: workspaceA.workspaceId,
        blueprint_id: plan.blueprint.id,
        entry_id: plan.entry.id,
        entry_updated_at: expect.any(String),
        template_id: plan.template.id,
        template_revision: 1,
        matrix_id: created.matrix.id,
      },
      matrix: { id: created.matrix.id, cell_count: 4 },
    });
    expect(listMatrices(workspaceA.workspaceId).filter(item => item.id === created.matrix.id))
      .toHaveLength(1);
    const runCount = db.prepare(`
      SELECT COUNT(*) AS count
        FROM content_matrix_generation_runs
       WHERE workspace_id = ? AND matrix_id = ?
    `).get(workspaceA.workspaceId, created.matrix.id) as { count: number };
    expect(runCount.count).toBe(0);
  });

  it('creates through MCP with durable key attribution and HTTP replays without duplicate activity', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'mcp-origin');
    const readablePlan = await callTool('get_pseo_matrix_plan', {
      workspace_id: workspaceA.workspaceId,
      blueprint_id: plan.blueprint.id,
      entry_id: plan.entry.id,
    }, workspaceKey);
    expect(readablePlan.isError).toBeFalsy();
    expect(readablePlan.payload).toMatchObject({
      source: {
        entry_updated_at: plan.entry.updatedAt,
        template_id: plan.template.id,
        template_revision: 1,
      },
      template: {
        variables: [
          { name: 'service', label: 'Service' },
          { name: 'location', label: 'Location' },
        ],
      },
    });
    const source = readablePlan.payload.source as {
      entry_updated_at: string;
      template_id: string;
      template_revision: number;
    };
    const created = await callTool('create_content_matrix_from_pseo_plan', {
      workspace_id: workspaceA.workspaceId,
      blueprint_id: plan.blueprint.id,
      entry_id: plan.entry.id,
      expected_source_revision: {
        entry_updated_at: source.entry_updated_at,
        template_id: source.template_id,
        template_revision: source.template_revision,
      },
      dimensions: mcpDimensions,
    }, workspaceKey);
    expect(created.isError).toBeFalsy();
    expect(created.payload).toMatchObject({ replayed: false });

    const activity = db.prepare(`
      SELECT metadata
        FROM activity_log
       WHERE workspace_id = ?
         AND json_extract(metadata, '$.action') = 'pseo_matrix_created'
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1
    `).get(workspaceA.workspaceId) as { metadata: string } | undefined;
    expect(activity).toBeDefined();
    const metadata = JSON.parse(activity?.metadata ?? '{}') as {
      mcpCaller?: { toolName?: string; caller?: { keyId?: string; keyLabel?: string } };
    };
    expect(metadata.mcpCaller).toMatchObject({
      toolName: 'create_content_matrix_from_pseo_plan',
      caller: { keyId: workspaceKeyId, keyLabel: 'pSEO bridge integration' },
    });

    const beforeReplayCount = db.prepare(`
      SELECT COUNT(*) AS count
        FROM activity_log
       WHERE workspace_id = ?
         AND json_extract(metadata, '$.action') = 'pseo_matrix_created'
    `).get(workspaceA.workspaceId) as { count: number };
    const replayResponse = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: httpDimensions,
      },
    );
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({ replayed: true });
    const afterReplayCount = db.prepare(`
      SELECT COUNT(*) AS count
        FROM activity_log
       WHERE workspace_id = ?
         AND json_extract(metadata, '$.action') = 'pseo_matrix_created'
    `).get(workspaceA.workspaceId) as { count: number };
    expect(afterReplayCount.count).toBe(beforeReplayCount.count);
  });

  it('rejects incomplete collection dimensions without creating or linking a matrix', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'missing-location');
    const before = listMatrices(workspaceA.workspaceId).length;
    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: [{ variableName: 'service', values: ['Wash and Fold'] }],
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/dimension|location/i),
    });
    expect(listMatrices(workspaceA.workspaceId)).toHaveLength(before);
    expect(getEntry(workspaceA.workspaceId, plan.blueprint.id, plan.entry.id)?.matrixId)
      .toBeUndefined();
  });

  it('rolls back the new matrix and source link when a planned URL collides', async () => {
    const existingTemplate = createTemplate(workspaceA.workspaceId, {
      name: 'Existing collision template',
      pageType: 'location',
      variables: [
        { name: 'service', label: 'Service' },
        { name: 'location', label: 'Location' },
      ],
      sections: [],
      urlPattern: '/collision/{location}/{service}',
      keywordPattern: 'existing {service} {location}',
    });
    createMatrix(workspaceA.workspaceId, {
      name: 'Existing collision matrix',
      templateId: existingTemplate.id,
      dimensions: [
        { variableName: 'service', values: ['Laundry'] },
        { variableName: 'location', values: ['Austin'] },
      ],
      urlPattern: existingTemplate.urlPattern,
      keywordPattern: existingTemplate.keywordPattern,
    });
    const plan = createCollectionPlan(workspaceA.workspaceId, 'url-collision', {
      urlPattern: '/collision/{location}/{service}',
      keywordPattern: 'new {service} {location}',
    });
    const before = listMatrices(workspaceA.workspaceId).length;

    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: [
          { variableName: 'service', values: ['Laundry'] },
          { variableName: 'location', values: ['Austin'] },
        ],
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/URL|collision/i),
    });
    expect(listMatrices(workspaceA.workspaceId)).toHaveLength(before);
    expect(getEntry(workspaceA.workspaceId, plan.blueprint.id, plan.entry.id)?.matrixId)
      .toBeUndefined();
  });

  it('rolls back exact keyword cannibalization even when the planned URL is unique', async () => {
    const existingTemplate = createTemplate(workspaceA.workspaceId, {
      name: 'Existing keyword template',
      pageType: 'location',
      variables: [
        { name: 'service', label: 'Service' },
        { name: 'location', label: 'Location' },
      ],
      sections: [],
      urlPattern: '/existing-keyword/{location}/{service}',
      keywordPattern: 'shared laundry target',
    });
    createMatrix(workspaceA.workspaceId, {
      name: 'Existing keyword matrix',
      templateId: existingTemplate.id,
      dimensions: [
        { variableName: 'service', values: ['Laundry'] },
        { variableName: 'location', values: ['Austin'] },
      ],
      urlPattern: existingTemplate.urlPattern,
      keywordPattern: existingTemplate.keywordPattern,
    });
    const plan = createCollectionPlan(workspaceA.workspaceId, 'keyword-collision', {
      urlPattern: '/new-keyword/{location}/{service}',
      keywordPattern: 'shared laundry target',
    });
    const before = listMatrices(workspaceA.workspaceId).length;

    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: [
          { variableName: 'service', values: ['Laundry'] },
          { variableName: 'location', values: ['Austin'] },
        ],
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/cannibalization|keyword/i),
    });
    expect(listMatrices(workspaceA.workspaceId)).toHaveLength(before);
    expect(getEntry(workspaceA.workspaceId, plan.blueprint.id, plan.entry.id)?.matrixId)
      .toBeUndefined();
  });

  it('rejects a stale linked-template revision before creating a matrix', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'stale-source');
    const staleSource = httpExpectedSource(plan);
    const updated = updateTemplate(
      workspaceA.workspaceId,
      plan.template.id,
      { keywordPattern: '{service} near {location} stale-source' },
      { expectedTemplateRevision: plan.template.revision ?? 0 },
    );
    expect(updated?.revision).toBe(2);

    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      { expectedSourceRevision: staleSource, dimensions: httpDimensions },
    );

    expect(response.status).toBe(409);
    expect(getEntry(workspaceA.workspaceId, plan.blueprint.id, plan.entry.id)?.matrixId)
      .toBeUndefined();
  });

  it('materializes the legal 2,500-cell maximum without pairwise conflict allocation', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'max-grid');
    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: [
          {
            variableName: 'service',
            values: Array.from({ length: 50 }, (_, index) => `Service ${index + 1}`),
          },
          {
            variableName: 'location',
            values: Array.from({ length: 50 }, (_, index) => `Location ${index + 1}`),
          },
        ],
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      replayed: false,
      matrix: { cellCount: 2_500 },
    });
  });

  it('rejects workspace-A requests that smuggle workspace-B blueprint IDs', async () => {
    const foreignPlan = createCollectionPlan(workspaceB.workspaceId, 'foreign-source');
    const mcpResult = await callTool('get_pseo_matrix_plan', {
      workspace_id: workspaceA.workspaceId,
      blueprint_id: foreignPlan.blueprint.id,
      entry_id: foreignPlan.entry.id,
    }, workspaceKey);
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.payload).toMatchObject({ code: 'not_found', retryable: false });

    const httpResult = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${foreignPlan.blueprint.id}/entries/${foreignPlan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(foreignPlan),
        dimensions: httpDimensions,
      },
    );
    expect(httpResult.status).toBe(404);
    expect(getEntry(
      workspaceB.workspaceId,
      foreignPlan.blueprint.id,
      foreignPlan.entry.id,
    )?.matrixId).toBeUndefined();
  });

  it('rejects non-collection entries and cross-workspace MCP calls', async () => {
    const plan = createCollectionPlan(workspaceA.workspaceId, 'not-collection', {
      isCollection: false,
    });
    const response = await ctx.postJson(
      `/api/page-strategy/${workspaceA.workspaceId}/${plan.blueprint.id}/entries/${plan.entry.id}/content-matrix`,
      {
        expectedSourceRevision: httpExpectedSource(plan),
        dimensions: httpDimensions,
      },
    );
    expect(response.status).toBe(422);

    const forbidden = await callTool('create_content_matrix_from_pseo_plan', {
      workspace_id: workspaceB.workspaceId,
      blueprint_id: plan.blueprint.id,
      entry_id: plan.entry.id,
      expected_source_revision: mcpExpectedSource(plan),
      dimensions: mcpDimensions,
    }, workspaceKey);
    expect(forbidden.isError).toBe(true);
    expect(forbidden.payload).toMatchObject({ code: 'forbidden', retryable: false });
  });
});
