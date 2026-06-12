import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixCell, ContentTemplate } from '../../shared/types/content.js';

const mocks = vi.hoisted(() => {
  const insertRun = vi.fn();
  const selectByWorkspaceAll = vi.fn(() => []);
  const selectByCellIdGet = vi.fn();
  const updateStatusRun = vi.fn();
  const markStaleByCellIdRun = vi.fn();

  return {
    logWarn: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),

    getMatrix: vi.fn(),
    getSchemaTypesForTemplate: vi.fn((pageType: string) => {
      if (pageType === 'service') return ['Service', 'BreadcrumbList'];
      return ['WebPage', 'BreadcrumbList'];
    }),
    getWorkspace: vi.fn(),
    getTemplate: vi.fn(),
    parseJsonFallback: vi.fn((raw: string, fallback: unknown) => {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }),

    insertRun,
    selectByWorkspaceAll,
    selectByCellIdGet,
    updateStatusRun,
    markStaleByCellIdRun,
  };
});

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: mocks.logWarn,
    info: mocks.logInfo,
    error: mocks.logError,
    debug: vi.fn(),
  }),
}));

vi.mock('../../server/content-matrices.js', () => ({
  getMatrix: mocks.getMatrix,
  getSchemaTypesForTemplate: mocks.getSchemaTypesForTemplate,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/content-templates.js', () => ({
  getTemplate: mocks.getTemplate,
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: mocks.parseJsonFallback,
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: () => () => ({
    insert: { run: mocks.insertRun },
    selectByWorkspace: { all: mocks.selectByWorkspaceAll },
    selectByCellId: { get: mocks.selectByCellIdGet },
    updateStatus: { run: mocks.updateStatusRun },
    markStaleByCellId: { run: mocks.markStaleByCellIdRun },
  }),
}));

vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn() },
}));

const makeCell = (overrides: Partial<MatrixCell> = {}): MatrixCell => ({
  id: 'cell_1',
  variableValues: {},
  targetKeyword: 'Austin SEO services',
  plannedUrl: '/services/seo-austin',
  status: 'planned',
  ...overrides,
});

const makeTemplate = (overrides: Partial<ContentTemplate> = {}): ContentTemplate => ({
  id: 'tpl_1',
  workspaceId: 'ws_1',
  name: 'Service Template',
  pageType: 'service',
  variables: [],
  sections: [],
  urlPattern: '/services/{service}',
  keywordPattern: '{service}',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

async function loadModule() {
  vi.resetModules();
  return import('../../server/schema-queue.js');
}

describe('schema-queue behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateSchemaSkeleton chooses template schema type and links mainEntity', async () => {
    const { generateSchemaSkeleton } = await loadModule();

    const skeleton = generateSchemaSkeleton(
      makeCell({ expectedSchemaTypes: undefined }),
      makeTemplate({ pageType: 'service' }),
      'https://agency.example',
    );

    const graph = skeleton['@graph'] as Array<Record<string, unknown>>;
    const webPage = graph.find(n => n['@type'] === 'WebPage');
    const serviceNode = graph.find(n => n['@type'] === 'Service');

    expect(serviceNode).toBeDefined();
    expect((serviceNode as Record<string, unknown>)['provider']).toEqual({
      '@id': 'https://agency.example/#organization',
    });
    expect((webPage as Record<string, unknown>)['mainEntity']).toEqual({
      '@id': (serviceNode as Record<string, unknown>)['@id'],
    });
  });

  it('queueSchemaPreGeneration exits early when matrix or cell is missing', async () => {
    const { queueSchemaPreGeneration } = await loadModule();

    mocks.getMatrix.mockReturnValue(null);
    await queueSchemaPreGeneration('ws_1', 'matrix_1', 'cell_1');

    mocks.getMatrix.mockReturnValue({ id: 'matrix_1', templateId: 'tpl_1', cells: [] });
    await queueSchemaPreGeneration('ws_1', 'matrix_1', 'cell_1');

    expect(mocks.insertRun).not.toHaveBeenCalled();
    expect(mocks.markStaleByCellIdRun).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledTimes(2);
  });

  it('queueSchemaPreGeneration marks previous pending rows stale before each retry insert', async () => {
    const { queueSchemaPreGeneration } = await loadModule();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_717_171_717_171);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    mocks.getMatrix.mockReturnValue({
      id: 'matrix_1',
      templateId: 'tpl_1',
      cells: [makeCell({ id: 'cell_1', plannedUrl: 'services/seo-austin' })],
    });
    mocks.getTemplate.mockReturnValue(makeTemplate());
    mocks.getWorkspace.mockReturnValue({ id: 'ws_1', liveDomain: 'client.example' });

    await queueSchemaPreGeneration('ws_1', 'matrix_1', 'cell_1');
    await queueSchemaPreGeneration('ws_1', 'matrix_1', 'cell_1');

    expect(mocks.markStaleByCellIdRun).toHaveBeenCalledTimes(2);
    expect(mocks.insertRun).toHaveBeenCalledTimes(2);

    const payload = mocks.insertRun.mock.calls[0][0] as Record<string, unknown>;
    const parsedSchema = JSON.parse(String(payload.schema_json)) as { '@graph': Array<Record<string, unknown>> };
    const webPage = parsedSchema['@graph'].find(n => n['@type'] === 'WebPage');

    expect(payload.status).toBe('pending');
    expect(webPage?.url).toBe('https://client.example/services/seo-austin');

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it('listPendingSchemas excludes stale/applied rows and degrades malformed schema payloads', async () => {
    const { listPendingSchemas } = await loadModule();

    mocks.selectByWorkspaceAll.mockReturnValue([
      {
        id: 'ps_pending',
        workspace_id: 'ws_1',
        matrix_id: 'matrix_1',
        cell_id: 'cell_1',
        schema_json: JSON.stringify({
          '@graph': [
            { '@type': 'WebPage', url: 'https://client.example/services/seo-austin' },
            { '@type': 'Service' },
          ],
        }),
        status: 'pending',
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'ps_corrupt',
        workspace_id: 'ws_1',
        matrix_id: 'matrix_1',
        cell_id: 'cell_2',
        schema_json: '{bad json',
        status: 'pending',
        created_at: '2026-05-02T00:00:00.000Z',
        updated_at: '2026-05-02T00:00:00.000Z',
      },
    ]);

    const rows = listPendingSchemas('ws_1');

    expect(rows).toEqual([
      {
        cellId: 'cell_1',
        plannedUrl: 'https://client.example/services/seo-austin',
        schemaTypes: ['WebPage', 'Service'],
        status: 'pending',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        cellId: 'cell_2',
        plannedUrl: '',
        schemaTypes: [],
        status: 'pending',
        createdAt: '2026-05-02T00:00:00.000Z',
      },
    ]);
  });

  // markSchemaApplied was removed in W6.3 — no callers and no UI for the endpoint.
  // The markSchemaStale path is still tested via the queueSchemaPreGeneration test above.
  it('markSchemaStale marks all pending schemas for a cell as stale', async () => {
    const { markSchemaStale } = await loadModule();

    markSchemaStale('ws_1', 'cell_1');
    expect(mocks.markStaleByCellIdRun).toHaveBeenCalledWith(
      expect.objectContaining({ cell_id: 'cell_1', workspace_id: 'ws_1' }),
    );
  });
});
