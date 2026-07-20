import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ContentMatrix,
  ContentTemplate,
  MatrixCell,
} from '../../shared/types/content.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES,
  contentMatrixGenerationSourceLimitIssues,
  matrixGenerationSerializedBytes,
  type MatrixStructuralResolutionResult,
  type ResolveMatrixStructureSelection,
} from '../../shared/types/matrix-generation.js';
import {
  buildKnownWorkspacePageCensus,
  createContentMatrixReadService,
  getContentMatrix,
  listContentMatrices,
  MatrixReadServiceError,
  resolveMatrixStructures,
  type WorkspaceKnownPageCensusExternalDependencies,
} from '../../server/domains/content/matrix-generation/read-service.js';
import { canonicalGenerationFingerprint } from '../../server/domains/content/matrix-generation/fingerprint.js';
import { resolveMatrixStructure as resolveMatrixStructureDomain } from '../../server/domains/content/matrix-generation/resolver.js';
import { createMatrix } from '../../server/content-matrices.js';
import { savePost } from '../../server/content-posts-db.js';
import { createTemplate } from '../../server/content-templates.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds: string[] = [];

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds.splice(0)) deleteWorkspace(workspaceId);
});

function cell(id: string, revision = 1): MatrixCell {
  return {
    id,
    revision,
    variableValues: { service: id },
    targetKeyword: `${id} keyword`,
    plannedUrl: `/services/${id}`,
    status: 'planned',
  };
}

function matrix(
  id: string,
  updatedAt: string,
  overrides: Partial<ContentMatrix> = {},
): ContentMatrix {
  const cells = overrides.cells ?? [cell(`${id}-a`), cell(`${id}-b`)];
  return {
    id,
    workspaceId: 'ws_1',
    revision: 4,
    name: id,
    templateId: 'tpl_1',
    dimensions: [{ variableName: 'service', values: cells.map(item => item.id) }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} service',
    cells,
    stats: {
      total: cells.length,
      planned: cells.length,
      briefGenerated: 0,
      drafted: 0,
      reviewed: 0,
      published: 0,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt,
    ...overrides,
  };
}

function template(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id: 'tpl_1',
    workspaceId: 'ws_1',
    revision: 3,
    generationContractVersion: 1,
    name: 'Service template',
    pageType: 'service',
    variables: [{ name: 'service', label: 'Service' }],
    sections: [],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} service',
    titlePattern: '{service} Service',
    metaDescPattern: 'Learn about {service}.',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function dependencies(matrices: ContentMatrix[]) {
  const byId = new Map(matrices.map(item => [item.id, item]));
  return {
    getWorkspace: vi.fn(() => ({ id: 'ws_1' })),
    listMatrices: vi.fn(() => matrices),
    getMatrix: vi.fn((_workspaceId: string, matrixId: string) => byId.get(matrixId)),
    getTemplate: vi.fn(() => template()),
    getGenerationSourceCensus: vi.fn((_workspaceId: string, matrixId: string) => {
      const source = byId.get(matrixId);
      const sourceTemplate = template();
      return source
        ? {
            matrix: {
              dimensions: {
                isArray: true,
                itemCount: source.dimensions.length,
                fingerprint: canonicalGenerationFingerprint(source.dimensions),
              },
              cells: {
                isArray: true,
                itemCount: source.cells.length,
                fingerprint: canonicalGenerationFingerprint(source.cells),
              },
            },
            template: {
              variables: {
                isArray: true,
                itemCount: sourceTemplate.variables.length,
                fingerprint: canonicalGenerationFingerprint(sourceTemplate.variables),
              },
              sections: {
                isArray: true,
                itemCount: sourceTemplate.sections.length,
                fingerprint: canonicalGenerationFingerprint(sourceTemplate.sections),
              },
              schemaTypes: sourceTemplate.schemaTypes
                ? {
                    isArray: true,
                    itemCount: sourceTemplate.schemaTypes.length,
                    fingerprint: canonicalGenerationFingerprint(sourceTemplate.schemaTypes),
                  }
                : null,
              cmsFieldMap: sourceTemplate.cmsFieldMap
                ? {
                    state: 'object' as const,
                    fingerprint: canonicalGenerationFingerprint(sourceTemplate.cmsFieldMap),
                  }
                : { state: 'absent' as const, fingerprint: null },
            },
          }
        : null;
    }),
    getKnownWorkspacePageCensus: vi.fn(async () => ({
      paths: ['/existing-page'],
      publishedSlugs: [],
      complete: true,
    })),
    getOtherWorkspaceMatrixPlannedUrls: vi.fn((_workspaceId: string, matrixId: string) => (
      {
        items: matrices
          .filter(item => item.id !== matrixId)
          .flatMap(item => item.cells.map(sourceCell => ({
          matrixId: item.id,
          cellId: sourceCell.id,
          plannedUrl: sourceCell.plannedUrl,
          }))),
        complete: true,
      }
    )),
    resolveMatrixStructure: vi.fn((input): MatrixStructuralResolutionResult => ({
      status: 'blocked',
      matrixId: input.matrix.id,
      templateId: input.template.id,
      cellId: input.cell.id,
      sourceRevision: input.expectedSourceRevision,
      blockers: [],
    })),
  };
}

function liveWorkspaceCensusDependencies(
  overrides: Partial<WorkspaceKnownPageCensusExternalDependencies> = {},
): WorkspaceKnownPageCensusExternalDependencies {
  return {
    getWorkspace: () => ({
      id: 'ws_live',
      name: 'Live workspace',
      folder: 'live-workspace',
      createdAt: '2026-07-01T00:00:00.000Z',
      webflowSiteId: 'site_live',
      webflowToken: 'token_live',
      liveDomain: 'example.com',
    }),
    listPagesWithCompleteness: async () => ({
      pages: [{ id: 'page_home', title: 'Home', slug: 'home', publishedPath: '/' }],
      complete: true,
    }),
    resolveBaseUrl: async () => 'https://example.com',
    discoverSitemapUrls: async () => ['https://example.com/'],
    ...overrides,
  };
}

describe('content matrix read service', () => {
  it('returns the authoritative census only through the internal sidecar', async () => {
    const source = matrix('mtx_sidecar', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    const service = createContentMatrixReadService(deps);
    const request = {
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: [{
        cellId: source.cells[0].id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: source.cells[0].revision ?? 0,
        },
      }] as const,
    };

    const internal = await service.resolveMatrixStructuresWithCensus(request);
    expect(internal.pageCensus).toEqual({
      paths: ['/existing-page'],
      publishedSlugs: [],
      complete: true,
    });
    expect(internal.result).not.toHaveProperty('pageCensus');
    expect(deps.getKnownWorkspacePageCensus).toHaveBeenCalledTimes(1);

    deps.getKnownWorkspacePageCensus.mockClear();
    const publicResult = await service.resolveMatrixStructures(request);
    expect(publicResult).not.toHaveProperty('pageCensus');
    expect(JSON.stringify(publicResult)).not.toContain('existing-page');
    expect(deps.getKnownWorkspacePageCensus).toHaveBeenCalledTimes(1);
  });

  it('adds same-site CMS item paths from the complete sitemap census and blocks collisions', async () => {
    const discoverSitemapUrls = vi.fn(async () => [
      'https://www.example.com/services/austin/seo-audits?campaign=ignored#overview',
    ]);
    const pageCensus = await buildKnownWorkspacePageCensus(
      'ws_live_cms_collision',
      liveWorkspaceCensusDependencies({ discoverSitemapUrls }),
    );

    expect(pageCensus).toMatchObject({ complete: true });
    expect(pageCensus.paths).toContain('/services/austin/seo-audits');
    expect(discoverSitemapUrls).toHaveBeenCalledWith(
      'https://example.com',
      {
        requireComplete: true,
        maxDocuments: MATRIX_GENERATION_SOURCE_LIMITS.census.maxSitemapDocuments,
        maxDepth: MATRIX_GENERATION_SOURCE_LIMITS.census.maxSitemapDepth,
        maxDocumentBytes: MATRIX_GENERATION_SOURCE_LIMITS.census.maxSitemapDocumentBytes,
        maxAggregateBytes: MATRIX_GENERATION_SOURCE_LIMITS.census.maxSitemapAggregateBytes,
        maxLocations: MATRIX_GENERATION_SOURCE_LIMITS.census.maxSitemapLocations,
      },
    );

    const sourceCell: MatrixCell = {
      ...cell('seo-audits'),
      variableValues: { service: 'SEO Audits' },
      plannedUrl: '/services/austin/seo-audits',
    };
    const source = matrix('mtx_cms_collision', '2026-07-04T00:00:00.000Z', {
      cells: [sourceCell],
      dimensions: [{ variableName: 'service', values: ['SEO Audits'] }],
      urlPattern: '/services/austin/{service}',
      keywordPattern: '{service} service',
    });
    const sourceTemplate = template({
      urlPattern: '/services/austin/{service}',
      keywordPattern: '{service} service',
    });
    const deps = dependencies([source]);
    deps.getTemplate.mockReturnValue(sourceTemplate);
    deps.getKnownWorkspacePageCensus.mockResolvedValue(pageCensus);
    deps.resolveMatrixStructure.mockImplementation(resolveMatrixStructureDomain);
    const service = createContentMatrixReadService(deps);

    const result = await service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected sitemap collision blocker');
    expect(result.results[0].blockers.map(item => item.id)).toContain('workspace_url_collision');
  });

  it('marks a nonempty but incomplete fresh Webflow page response unavailable', async () => {
    const pageCensus = await buildKnownWorkspacePageCensus(
      'ws_live_partial_pages',
      liveWorkspaceCensusDependencies({
        listPagesWithCompleteness: async () => ({
          pages: [{ id: 'stale_home', title: 'Home', slug: 'home', publishedPath: '/' }],
          complete: false,
        }),
      }),
    );

    expect(pageCensus.paths).toContain('/');
    expect(pageCensus.complete).toBe(false);
  });

  it('fails closed when a page adapter returns more than the bounded Webflow census', async () => {
    const listPagesWithCompleteness = vi.fn(async () => ({
      pages: Array.from(
        { length: MATRIX_GENERATION_SOURCE_LIMITS.census.maxWebflowPages + 1 },
        (_, index) => ({
          id: `page-${index}`,
          title: `Page ${index}`,
          slug: `page-${index}`,
          publishedPath: `/page-${index}`,
        }),
      ),
      complete: true,
    }));
    const pageCensus = await buildKnownWorkspacePageCensus(
      'ws_live_page_budget',
      liveWorkspaceCensusDependencies({ listPagesWithCompleteness }),
    );

    expect(pageCensus.complete).toBe(false);
    expect(pageCensus.paths.length)
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths);
    expect(listPagesWithCompleteness).toHaveBeenCalledWith(
      'site_live',
      'token_live',
      { maxPages: MATRIX_GENERATION_SOURCE_LIMITS.census.maxWebflowPages },
    );
  });

  it('includes a local page saved while external sitemap discovery is in flight', async () => {
    const workspace = createWorkspace(`late local page census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    let releaseSitemap!: (urls: string[]) => void;
    const sitemapGate = new Promise<string[]>((resolve) => {
      releaseSitemap = resolve;
    });
    const discoverSitemapUrls = vi.fn(() => sitemapGate);
    const censusPromise = buildKnownWorkspacePageCensus(
      workspace.id,
      liveWorkspaceCensusDependencies({
        getWorkspace: () => ({
          ...workspace,
          webflowSiteId: 'site_live',
          webflowToken: 'token_live',
          liveDomain: 'example.com',
        }),
        discoverSitemapUrls,
      }),
    );
    await vi.waitFor(() => expect(discoverSitemapUrls).toHaveBeenCalledOnce());
    db.prepare(`
      INSERT INTO page_keywords (
        workspace_id, page_path, page_title, primary_keyword, secondary_keywords
      ) VALUES (?, ?, '', 'late page', '[]')
    `).run(workspace.id, '/late-local-page');
    releaseSitemap(['https://example.com/']);

    await expect(censusPromise).resolves.toMatchObject({
      complete: true,
      paths: expect.arrayContaining(['/late-local-page']),
    });
  });

  it('resolves a bare published CMS slug only through one unique full sitemap path', async () => {
    const workspace = createWorkspace(`published slug census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const now = new Date().toISOString();
    savePost(workspace.id, {
      id: `post_bare_slug_${Date.now()}`,
      workspaceId: workspace.id,
      briefId: 'brief-bare-slug',
      targetKeyword: 'audit guide',
      title: 'Audit guide',
      metaDescription: 'Published audit guide.',
      introduction: '<p>Introduction</p>',
      sections: [],
      conclusion: '<p>Conclusion</p>',
      totalWordCount: 100,
      targetWordCount: 100,
      status: 'approved',
      publishedAt: now,
      publishedSlug: 'audits',
      createdAt: now,
      updatedAt: now,
    });
    const getWorkspace = () => ({
      ...workspace,
      webflowSiteId: 'site_live',
      webflowToken: 'token_live',
      liveDomain: 'example.com',
    });

    const unique = await buildKnownWorkspacePageCensus(
      workspace.id,
      liveWorkspaceCensusDependencies({
        getWorkspace,
        discoverSitemapUrls: async () => [
          'https://example.com/',
          'https://example.com/blog/audits',
        ],
      }),
    );
    expect(unique.complete).toBe(true);
    expect(unique.paths).toContain('/blog/audits');
    expect(unique.paths).not.toContain('/services/audits');
    expect(unique.publishedSlugs).toEqual([]);

    const ambiguous = await buildKnownWorkspacePageCensus(
      workspace.id,
      liveWorkspaceCensusDependencies({
        getWorkspace,
        discoverSitemapUrls: async () => [
          'https://example.com/',
          'https://example.com/blog/audits',
          'https://example.com/services/audits',
        ],
      }),
    );
    expect(ambiguous.complete).toBe(false);
  });

  it('applies the published-path byte preflight to Webflow-linked posts without published_at', async () => {
    const workspace = createWorkspace(`webflow-linked published census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const now = new Date().toISOString();
    const oversizedPublishedPath = `/${'a'.repeat(
      MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes + 1,
    )}`;
    savePost(workspace.id, {
      id: `post_webflow_linked_${Date.now()}`,
      workspaceId: workspace.id,
      briefId: 'brief-webflow-linked',
      targetKeyword: 'linked page',
      title: 'Linked page',
      metaDescription: 'A Webflow-linked page.',
      introduction: '<p>Introduction</p>',
      sections: [],
      conclusion: '<p>Conclusion</p>',
      totalWordCount: 100,
      targetWordCount: 100,
      status: 'approved',
      webflowItemId: 'webflow-item-without-published-at',
      publishedSlug: oversizedPublishedPath,
      createdAt: now,
      updatedAt: now,
    });

    const census = await buildKnownWorkspacePageCensus(
      workspace.id,
      liveWorkspaceCensusDependencies({ getWorkspace: () => workspace }),
    );

    expect(census.complete).toBe(false);
    expect(census.paths).not.toContain(oversizedPublishedPath);
  });

  it('turns unavailable sitemap discovery into a generation preflight blocker', async () => {
    const pageCensus = await buildKnownWorkspacePageCensus(
      'ws_live_missing_sitemap',
      liveWorkspaceCensusDependencies({
        discoverSitemapUrls: async () => {
          throw new Error('sitemap child unavailable');
        },
      }),
    );
    expect(pageCensus.complete).toBe(false);

    const source = matrix('mtx_missing_sitemap', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    deps.getKnownWorkspacePageCensus.mockResolvedValue(pageCensus);
    deps.resolveMatrixStructure.mockImplementation(resolveMatrixStructureDomain);
    const service = createContentMatrixReadService(deps);

    const result = await service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: [{
        cellId: source.cells[0].id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: source.cells[0].revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected incomplete census blocker');
    expect(result.results[0].blockers.map(item => item.id)).toContain('malformed_workspace_url_census');
  });

  it('keyset-pages summaries in updated_at DESC, id ASC order and binds the template filter', () => {
    const matrices = [
      matrix('mtx_c', '2026-07-03T00:00:00.000Z'),
      matrix('mtx_b', '2026-07-04T00:00:00.000Z'),
      matrix('mtx_a', '2026-07-04T00:00:00.000Z'),
      matrix('mtx_other', '2026-07-05T00:00:00.000Z', { templateId: 'tpl_other' }),
    ];
    const service = createContentMatrixReadService(dependencies(matrices));

    const first = service.listContentMatrices({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      limit: 2,
    });

    expect(first.items.map(item => item.id)).toEqual(['mtx_a', 'mtx_b']);
    expect(first.items[0]).not.toHaveProperty('cells');
    expect(first.items[0]).not.toHaveProperty('dimensions');
    expect(first.items[0]).toMatchObject({
      cellCount: 2,
      dimensionCount: 1,
      revision: 4,
      templateRevision: 3,
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = service.listContentMatrices({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second.items.map(item => item.id)).toEqual(['mtx_c']);
    expect(second.nextCursor).toBeNull();

    expect(() => service.listContentMatrices({
      workspaceId: 'ws_1',
      templateId: 'tpl_other',
      cursor: first.nextCursor ?? undefined,
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'invalid_cursor',
    }));

    expect(() => service.listContentMatrices({
      workspaceId: 'ws_2',
      templateId: 'tpl_1',
      cursor: first.nextCursor ?? undefined,
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'invalid_cursor',
    }));
  });

  it('byte-budget paginates many individually valid matrix summaries', () => {
    const matrices = Array.from({ length: 100 }, (_, index) => matrix(
      `mtx_budget_${String(index).padStart(3, '0')}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      {
        urlPattern: `/${'u'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes - 1)}`,
        keywordPattern: 'k'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes),
      },
    ));
    const service = createContentMatrixReadService(dependencies(matrices));
    const first = service.listContentMatrices({
      workspaceId: 'ws_1',
      limit: 100,
    });

    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(100);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(matrixGenerationSerializedBytes(first))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);

    const second = service.listContentMatrices({
      workspaceId: 'ws_1',
      cursor: first.nextCursor ?? undefined,
      limit: 100,
    });
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items[0].id).not.toBe(first.items.at(-1)?.id);
    expect(matrixGenerationSerializedBytes(second))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);
  });

  it('uses the bounded metadata repository in production-shaped dependencies', () => {
    const source = matrix('mtx_1', '2026-07-04T00:00:00.000Z');
    const { cells: _cells, dimensions: _dimensions, ...metadata } = source;
    const deps = {
      ...dependencies([]),
      listMatrices: vi.fn(() => {
        throw new Error('full matrix hydration must not run');
      }),
      listMatrixSummaries: vi.fn(() => [{
        ...metadata,
        cellCount: source.cells.length,
        dimensionCount: source.dimensions.length,
        templateRevision: 3,
      }]),
    };
    const service = createContentMatrixReadService(deps);

    const result = service.listContentMatrices({ workspaceId: 'ws_1' });

    expect(result.items).toHaveLength(1);
    expect(deps.listMatrixSummaries).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      templateId: undefined,
      after: undefined,
      limit: 26,
    });
    expect(deps.listMatrices).not.toHaveBeenCalled();
  });

  it('executes the production metadata projection without hydrating cell rows', () => {
    const workspace = createWorkspace(`matrix read projection ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Projection template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Projection matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits', 'Strategy'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });

    const page = listContentMatrices({ workspaceId: workspace.id, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: sourceMatrix.id,
      templateId: sourceTemplate.id,
      cellCount: 2,
      dimensionCount: 1,
    });
    expect(page.items[0]).not.toHaveProperty('cells');
    expect(page.items[0]).not.toHaveProperty('dimensions');
  });

  it('uses only persisted workspace page paths for collision resolution', async () => {
    const workspace = createWorkspace(`matrix path census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Collision template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Collision matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const sourceCell = sourceMatrix.cells[0];
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO page_elements (
        workspace_id, page_path, catalog_json, source_published_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?)
    `).run(workspace.id, sourceCell.plannedUrl, '{}', now, now);

    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected collision blocker');
    expect(result.results[0].blockers.map(item => item.id)).toContain('workspace_url_collision');
  });

  it('treats an assigned page keyword path as known before metrics arrive', async () => {
    const workspace = createWorkspace(`matrix keyword path census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Keyword collision template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Keyword collision matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const sourceCell = sourceMatrix.cells[0];
    db.prepare(`
      INSERT INTO page_keywords (
        workspace_id, page_path, page_title, primary_keyword, secondary_keywords
      ) VALUES (?, ?, '', 'seo audits', '[]')
    `).run(workspace.id, sourceCell.plannedUrl);

    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected collision blocker');
    expect(result.results[0].blockers.map(item => item.id)).toContain('workspace_url_collision');
  });

  it('blocks a durable published post slug absent from analysis path tables', async () => {
    const workspace = createWorkspace(`matrix published path census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Published collision template',
      pageType: 'service',
      generationContractVersion: 1,
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Published collision matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const sourceCell = sourceMatrix.cells[0];
    const now = new Date().toISOString();
    savePost(workspace.id, {
      id: `post_${Date.now()}`,
      workspaceId: workspace.id,
      briefId: 'brief-published-collision',
      targetKeyword: 'audit guide',
      title: 'Audit guide',
      metaDescription: 'Published audit guide.',
      introduction: '<p>Introduction</p>',
      sections: [],
      conclusion: '<p>Conclusion</p>',
      totalWordCount: 100,
      targetWordCount: 100,
      status: 'approved',
      publishedAt: now,
      publishedSlug: '/services/audits',
      createdAt: now,
      updatedAt: now,
    });

    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected published page collision');
    expect(result.results[0].blockers.map(item => item.id)).toContain('workspace_url_collision');
  });

  it('blocks a planned URL duplicated by a cell in another workspace matrix', async () => {
    const workspace = createWorkspace(`cross matrix collision ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Cross-matrix template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Primary matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const otherMatrix = createMatrix(workspace.id, {
      name: 'Other matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const sourceCell = sourceMatrix.cells[0];

    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected collision blocker');
    const collision = result.results[0].blockers.find(item => item.id === 'planned_url_collision');
    expect(collision?.reason).toContain(otherMatrix.id);
  });

  it('uses valid URL identity from another matrix despite unrelated malformed cell metadata', async () => {
    const workspace = createWorkspace(`cross matrix minimal census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Minimal census template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Minimal census primary',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const otherMatrix = createMatrix(workspace.id, {
      name: 'Minimal census other',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    db.prepare('UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?').run(
      JSON.stringify(otherMatrix.cells.map(item => ({ ...item, status: 'legacy-unknown-status' }))),
      otherMatrix.id,
      workspace.id,
    );

    const sourceCell = sourceMatrix.cells[0];
    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected cross-matrix collision');
    const blockerIds = result.results[0].blockers.map(item => item.id);
    expect(blockerIds).toContain('planned_url_collision');
    expect(blockerIds).not.toContain('malformed_matrix_url_census');
  });

  it('blocks when another matrix contains a skipped malformed collision cell', async () => {
    const workspace = createWorkspace(`cross matrix corrupt census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Corrupt census template',
      pageType: 'service',
      generationContractVersion: 1,
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Primary matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const otherMatrix = createMatrix(workspace.id, {
      name: 'Malformed other matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Strategy'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const { id: _droppedId, ...malformedCollisionCell } = {
      ...otherMatrix.cells[0],
      plannedUrl: sourceMatrix.cells[0].plannedUrl,
    };
    db.prepare('UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?').run(
      JSON.stringify([malformedCollisionCell]),
      otherMatrix.id,
      workspace.id,
    );

    const sourceCell = sourceMatrix.cells[0];
    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected malformed collision census');
    expect(result.results[0].blockers.map(item => item.id)).toContain('malformed_matrix_url_census');
  });

  it('fails closed before materializing an oversized aggregate of other-matrix cells', async () => {
    const workspace = createWorkspace(`bounded other matrix census ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Bounded census template',
      pageType: 'service',
      generationContractVersion: 1,
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Bounded primary matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    const otherMatrix = createMatrix(workspace.id, {
      name: 'Oversized census matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Strategy'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });
    db.prepare('UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?').run(
      JSON.stringify([{
        id: 'oversized-census-cell',
        plannedUrl: `/${'x'.repeat(
          MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes,
        )}`,
      }]),
      otherMatrix.id,
      workspace.id,
    );

    const sourceCell = sourceMatrix.cells[0];
    const result = await resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      }],
    });

    expect(result.results[0].status).toBe('blocked');
    if (result.results[0].status !== 'blocked') throw new Error('Expected bounded census blocker');
    expect(result.results[0].blockers.map(item => item.id))
      .toContain('malformed_matrix_url_census');
  });

  it.each([
    'template section',
    'template schema type',
    'template CMS field map',
    'matrix cell',
  ] as const)('fails closed when a stored %s cannot be hydrated completely', async (corruptSource) => {
    const workspace = createWorkspace(`matrix source integrity ${corruptSource} ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Integrity template',
      pageType: 'service',
      generationContractVersion: 1,
      variables: [{ name: 'service', label: 'Service' }],
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{service}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      titlePattern: '{service} Service',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Integrity matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits', 'Strategy'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    });

    if (corruptSource === 'template section') {
      db.prepare('UPDATE content_templates SET sections = ? WHERE id = ? AND workspace_id = ?').run(
        JSON.stringify([
          ...sourceTemplate.sections,
          {
            ...sourceTemplate.sections[0],
            id: 'locked-proof',
            wordCountTarget: 'not-a-number',
          },
        ]),
        sourceTemplate.id,
        workspace.id,
      );
    } else if (corruptSource === 'template schema type') {
      db.prepare('UPDATE content_templates SET schema_types = ? WHERE id = ? AND workspace_id = ?').run(
        JSON.stringify(['Service', 42]),
        sourceTemplate.id,
        workspace.id,
      );
    } else if (corruptSource === 'template CMS field map') {
      db.prepare('UPDATE content_templates SET cms_field_map = ? WHERE id = ? AND workspace_id = ?').run(
        JSON.stringify({ body: 42 }),
        sourceTemplate.id,
        workspace.id,
      );
    } else {
      db.prepare('UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?').run(
        JSON.stringify(sourceMatrix.cells.map((item, index) => index === 1
          ? {
              ...item,
              status: 'not-a-status',
              plannedUrl: sourceMatrix.cells[0].plannedUrl,
            }
          : item)),
        sourceMatrix.id,
        workspace.id,
      );
    }

    const selectedCell = sourceMatrix.cells[0];
    await expect(resolveMatrixStructures({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
      selections: [{
        cellId: selectedCell.id,
        expectedSourceRevision: {
          matrixRevision: sourceMatrix.revision ?? 0,
          templateRevision: sourceTemplate.revision ?? 0,
          cellRevision: selectedCell.revision ?? 0,
        },
      }],
    })).rejects.toMatchObject({
      code: 'precondition_failed',
      details: expect.objectContaining({
        matrixId: sourceMatrix.id,
        templateId: sourceTemplate.id,
      }),
    });
  });

  it('conflicts when cell data changes without advancing the matrix revision', () => {
    let current = matrix('mtx_1', '2026-07-04T00:00:00.000Z', {
      cells: [cell('cell_a'), cell('cell_b'), cell('cell_c')],
    });
    const deps = dependencies([current]);
    deps.getMatrix.mockImplementation(() => current);
    const service = createContentMatrixReadService(deps);

    const first = service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      limit: 2,
    });
    expect(first.cells.items.map(item => item.id)).toEqual(['cell_a', 'cell_b']);
    expect(first.cells.nextCursor).toEqual(expect.any(String));
    expect(first.matrix).not.toHaveProperty('cells');

    const stableSecondPage = service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      cursor: first.cells.nextCursor ?? undefined,
      limit: 2,
    });
    expect(stableSecondPage.cells.items.map(item => item.id)).toEqual(['cell_c']);

    current = {
      ...current,
      cells: current.cells.map((item, index) => index === 0
        ? { ...item, revision: (item.revision ?? 0) + 1, targetKeyword: 'edited keyword' }
        : item),
    };
    expect(() => service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      cursor: first.cells.nextCursor ?? undefined,
      limit: 2,
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'conflict',
    }));
  });

  it('byte-budget paginates individually valid nested cell projections', () => {
    const cells = Array.from({ length: 20 }, (_, index) => ({
      ...cell(`cell_budget_${index}`),
      keywordCandidates: Array.from({ length: 25 }, (_candidate, candidateIndex) => ({
        keyword: `candidate-${index}-${candidateIndex}`,
        volume: 1,
        difficulty: 1,
        cpc: 1,
        source: 'pattern' as const,
        isRecommended: candidateIndex === 0,
        authorityAssessment: {
          posture: 'authority_unknown' as const,
          note: 'x'.repeat(1_900),
        },
      })),
    }));
    const source = matrix('mtx_cell_budget', '2026-07-04T00:00:00.000Z', { cells });
    const service = createContentMatrixReadService(dependencies([source]));

    const first = service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: source.id,
      limit: 100,
    });
    expect(first.cells.items.length).toBeGreaterThan(0);
    expect(first.cells.items.length).toBeLessThan(cells.length);
    expect(first.cells.nextCursor).toEqual(expect.any(String));
    expect(matrixGenerationSerializedBytes(first))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);

    const second = service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: source.id,
      cursor: first.cells.nextCursor ?? undefined,
      limit: 100,
    });
    expect(second.cells.items[0].id).toBe(cells[first.cells.items.length].id);
    expect(matrixGenerationSerializedBytes(second))
      .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);
  });

  const validSelection = (cellId: string): ResolveMatrixStructureSelection => ({
    cellId,
    expectedSourceRevision: {
      matrixRevision: 4,
      templateRevision: 3,
      cellRevision: 1,
    },
  });

  it.each([
    ['empty selection', []],
    ['duplicate selection', [validSelection('cell_a'), validSelection('cell_a')]],
    ['26 selections', Array.from({ length: 26 }, (_, index) => validSelection(`cell_${index}`))],
  ])('rejects %s before reading any collision census', async (_label, selections) => {
    const source = matrix('mtx_1', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    const service = createContentMatrixReadService(deps);

    await expect(service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: selections as never,
    })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(deps.getKnownWorkspacePageCensus).not.toHaveBeenCalled();
    expect(deps.getOtherWorkspaceMatrixPlannedUrls).not.toHaveBeenCalled();
  });

  it('rejects missing or stale sources before live page census work', async () => {
    const missingDeps = dependencies([]);
    const missingService = createContentMatrixReadService(missingDeps);
    await expect(missingService.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: 'missing',
      selections: [validSelection('cell_a')],
    })).rejects.toMatchObject({ code: 'not_found' });
    expect(missingDeps.getKnownWorkspacePageCensus).not.toHaveBeenCalled();

    const source = matrix('mtx_stale', '2026-07-04T00:00:00.000Z');
    const staleDeps = dependencies([source]);
    const staleService = createContentMatrixReadService(staleDeps);
    await expect(staleService.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: [{
        cellId: source.cells[0].id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: 0,
        },
      }],
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(staleDeps.getKnownWorkspacePageCensus).not.toHaveBeenCalled();
  });

  it('resolves only explicit cell IDs and supplies collision inputs without creating a run', async () => {
    const source = matrix('mtx_1', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    const service = createContentMatrixReadService(deps);
    const selections = [
      {
        cellId: 'mtx_1-b',
        expectedSourceRevision: {
          matrixRevision: 4,
          templateRevision: 3,
          cellRevision: 1,
        },
      },
    ] as const satisfies readonly [ResolveMatrixStructureSelection];

    const result = await service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      selections,
    });

    expect(result.results).toHaveLength(1);
    expect(deps.resolveMatrixStructure).toHaveBeenCalledOnce();
    expect(deps.resolveMatrixStructure).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      matrix: source,
      cell: source.cells[1],
      expectedSourceRevision: selections[0].expectedSourceRevision,
      matrixPlannedUrls: [
        { cellId: 'mtx_1-a', plannedUrl: '/services/mtx_1-a' },
        { cellId: 'mtx_1-b', plannedUrl: '/services/mtx_1-b' },
      ],
      matrixUrlCensusComplete: true,
      knownWorkspacePagePaths: [],
      knownWorkspacePublishedSlugs: [],
      workspaceUrlCensusComplete: true,
    }));
  });

  it('rejects an aggregate resolve response that exceeds the practical MCP budget', async () => {
    const source = matrix('mtx_resolve_budget', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    deps.resolveMatrixStructure.mockImplementation((input): MatrixStructuralResolutionResult => ({
      status: 'blocked',
      matrixId: input.matrix.id,
      templateId: input.template.id,
      cellId: input.cell.id,
      sourceRevision: input.expectedSourceRevision,
      blockers: [{
        id: `large-${input.cell.id}`,
        fieldPath: 'source',
        claim: 'A bounded structural source is available.',
        reason: 'x'.repeat(450_000),
        requirementStage: 'preflight',
        claimKind: 'structural',
        status: 'missing',
        sourceRefs: [],
      }],
    }));
    const service = createContentMatrixReadService(deps);

    await expect(service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: source.cells.map(sourceCell => ({
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      })) as [ResolveMatrixStructureSelection, ResolveMatrixStructureSelection],
    })).rejects.toMatchObject({
      code: 'precondition_failed',
      message: expect.stringContaining('fewer cells'),
    });
  });

  it('snapshots the matrix after awaited page discovery so an intervening edit conflicts', async () => {
    let current = matrix('mtx_race', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([current]);
    deps.getMatrix.mockImplementation(() => current);
    deps.getKnownWorkspacePageCensus.mockImplementation(async () => {
      await Promise.resolve();
      current = { ...current, revision: (current.revision ?? 0) + 1 };
      return { paths: [], publishedSlugs: [], complete: true };
    });
    const service = createContentMatrixReadService(deps);

    await expect(service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: current.id,
      selections: [{
        cellId: current.cells[0].id,
        expectedSourceRevision: {
          matrixRevision: 4,
          templateRevision: 3,
          cellRevision: 1,
        },
      }],
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.resolveMatrixStructure).not.toHaveBeenCalled();
  });

  it('uses the latest sibling census without conflicting on unrelated sibling edits', async () => {
    const current = matrix('mtx_sibling_race', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([current]);
    deps.getMatrix.mockImplementation(() => current);
    deps.getKnownWorkspacePageCensus.mockImplementation(async () => {
      await Promise.resolve();
      current.cells[1] = {
        ...current.cells[1],
        revision: (current.cells[1].revision ?? 0) + 1,
        targetKeyword: 'new sibling research keyword',
        status: 'keyword_validated',
      };
      return { paths: [], publishedSlugs: [], complete: true };
    });
    const service = createContentMatrixReadService(deps);

    await expect(service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: current.id,
      selections: [{
        cellId: current.cells[0].id,
        expectedSourceRevision: {
          matrixRevision: current.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: current.cells[0].revision ?? 0,
        },
      }],
    })).resolves.toMatchObject({ results: [{ cellId: current.cells[0].id }] });
    expect(deps.resolveMatrixStructure).toHaveBeenCalledWith(expect.objectContaining({
      matrix: expect.objectContaining({
        cells: expect.arrayContaining([
          expect.objectContaining({ targetKeyword: 'new sibling research keyword' }),
        ]),
      }),
    }));
  });

  it('indexes external collision sources once and projects only matches per selection', async () => {
    const source = matrix('mtx_indexed_census', '2026-07-04T00:00:00.000Z');
    const deps = dependencies([source]);
    deps.getOtherWorkspaceMatrixPlannedUrls.mockReturnValue({
      complete: true,
      items: [
        { matrixId: 'other', cellId: 'match-a', plannedUrl: source.cells[0].plannedUrl },
        { matrixId: 'other', cellId: 'unrelated', plannedUrl: '/services/unrelated' },
      ],
    });
    deps.getKnownWorkspacePageCensus.mockResolvedValue({
      complete: true,
      paths: [
        source.cells[0].plannedUrl,
        source.cells[1].plannedUrl,
        '/services/unrelated',
      ],
      publishedSlugs: [],
    });
    const service = createContentMatrixReadService(deps);

    await service.resolveMatrixStructures({
      workspaceId: 'ws_1',
      matrixId: source.id,
      selections: source.cells.map(sourceCell => ({
        cellId: sourceCell.id,
        expectedSourceRevision: {
          matrixRevision: source.revision ?? 0,
          templateRevision: template().revision ?? 0,
          cellRevision: sourceCell.revision ?? 0,
        },
      })) as [ResolveMatrixStructureSelection, ResolveMatrixStructureSelection],
    });

    const firstInput = deps.resolveMatrixStructure.mock.calls[0][0];
    const secondInput = deps.resolveMatrixStructure.mock.calls[1][0];
    expect(firstInput.matrixPlannedUrls).toEqual([
      ...source.cells.map(sourceCell => ({
        cellId: sourceCell.id,
        plannedUrl: sourceCell.plannedUrl,
      })),
      {
        cellId: 'matrix:other:cell:match-a',
        plannedUrl: source.cells[0].plannedUrl,
      },
    ]);
    expect(secondInput.matrixPlannedUrls).toEqual(source.cells.map(sourceCell => ({
      cellId: sourceCell.id,
      plannedUrl: sourceCell.plannedUrl,
    })));
    expect(firstInput.knownWorkspacePagePaths).toEqual([source.cells[0].plannedUrl]);
    expect(secondInput.knownWorkspacePagePaths).toEqual([source.cells[1].plannedUrl]);
  });

  it('rejects a gross raw legacy blob before matrix JSON hydration', () => {
    const workspace = createWorkspace(`raw matrix preflight ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Raw preflight template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [],
      urlPattern: '/services/{service}',
      keywordPattern: '{service}',
      titlePattern: '{service}',
      metaDescPattern: 'Learn about {service}.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Raw preflight matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service}',
    });
    const hugeCells = JSON.stringify([
      'x'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxSerializedSourceBytes + 1),
    ]);
    db.prepare(`
      UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?
    `).run(hugeCells, sourceMatrix.id, workspace.id);

    expect(() => getContentMatrix({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'precondition_failed',
      details: expect.objectContaining({ fieldPath: 'cells' }),
    }));
  });

  it('fails closed on raw oversized list scalars and stats without projecting them', () => {
    const workspace = createWorkspace(`raw summary preflight ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Summary preflight template',
      pageType: 'service',
      variables: [],
      sections: [],
      urlPattern: '',
      keywordPattern: '',
      titlePattern: 'Summary',
      metaDescPattern: 'Summary.',
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Summary preflight matrix',
      templateId: sourceTemplate.id,
      dimensions: [],
      urlPattern: '',
      keywordPattern: '',
    });
    db.prepare(`
      UPDATE content_matrices SET stats = ? WHERE id = ? AND workspace_id = ?
    `).run(
      JSON.stringify({ padding: 'x'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes) }),
      sourceMatrix.id,
      workspace.id,
    );
    expect(() => listContentMatrices({ workspaceId: workspace.id }))
      .toThrowError(expect.objectContaining({ code: 'precondition_failed' }));

    db.prepare(`
      UPDATE content_matrices SET stats = ?, name = ? WHERE id = ? AND workspace_id = ?
    `).run(
      JSON.stringify(sourceMatrix.stats),
      'x'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxNameBytes + 1),
      sourceMatrix.id,
      workspace.id,
    );
    expect(() => listContentMatrices({ workspaceId: workspace.id }))
      .toThrowError(expect.objectContaining({ code: 'precondition_failed' }));
  });

  it('caps limit issues before traversing a giant legacy cell collection', () => {
    const source = matrix('mtx_giant_collection', '2026-07-04T00:00:00.000Z', {
      cells: Array(100_000).fill({ malformed: true }) as MatrixCell[],
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
    });
    const issues = contentMatrixGenerationSourceLimitIssues(source);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'array_items_exceeded',
      fieldPath: 'cells',
    });
    expect(issues.length).toBeLessThanOrEqual(MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES);
  });

  it('maps invalid stored schema identifiers to a sanitized read precondition', () => {
    const workspace = createWorkspace(`schema read precondition ${Date.now()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const sourceTemplate = createTemplate(workspace.id, {
      name: 'Schema precondition template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [],
      urlPattern: '/services/{service}',
      keywordPattern: '{service}',
      titlePattern: '{service}',
      metaDescPattern: 'Learn about {service}.',
      schemaTypes: ['Service'],
    });
    const sourceMatrix = createMatrix(workspace.id, {
      name: 'Schema precondition matrix',
      templateId: sourceTemplate.id,
      dimensions: [{ variableName: 'service', values: ['Audits'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service}',
    });
    db.prepare(`
      UPDATE content_templates SET schema_types = ? WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify(['Service', 'Service']), sourceTemplate.id, workspace.id);

    expect(() => getContentMatrix({
      workspaceId: workspace.id,
      matrixId: sourceMatrix.id,
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'precondition_failed',
      message: expect.not.stringContaining('Service'),
    }));
  });

  it('returns a safe not-found error for an unknown matrix', () => {
    const service = createContentMatrixReadService(dependencies([]));
    expect(() => service.getContentMatrix({
      workspaceId: 'ws_1',
      matrixId: 'missing',
    })).toThrowError(expect.objectContaining<Partial<MatrixReadServiceError>>({
      code: 'not_found',
    }));
  });
});
