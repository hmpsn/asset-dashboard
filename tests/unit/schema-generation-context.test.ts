/**
 * Wave 25 — Unit tests for server/schema-generation-context.ts
 *
 * The module exports:
 *   - prepareBulkSchemaGenerationContext(siteId): calls buildSchemaContext, attaches architecture
 *   - prepareSinglePageSchemaGenerationContext(siteId, pageId, pageType?): also attaches prior validation errors
 *
 * Tests verify:
 *   - context is returned from buildSchemaContext
 *   - architecture tree is attached when workspaceId is present
 *   - architecture errors are swallowed when workspaceId is present but getCachedArchitecture throws
 *   - prior validation errors are attached for single-page context
 *   - pageType override is applied when provided
 *   - no architecture attachment when workspaceId is absent
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockBuildSchemaContext = vi.fn();
const mockGetCachedArchitecture = vi.fn();
const mockGetValidation = vi.fn();

vi.mock('../../server/helpers.js', () => ({
  buildSchemaContext: mockBuildSchemaContext,
}));

vi.mock('../../server/site-architecture.js', () => ({
  getCachedArchitecture: mockGetCachedArchitecture,
}));

vi.mock('../../server/schema-validator.js', () => ({
  getValidation: mockGetValidation,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Lazy import after mocks ────────────────────────────────────────────────────

let prepareBulkSchemaGenerationContext: (siteId: string) => Promise<unknown>;
let prepareSinglePageSchemaGenerationContext: (
  siteId: string,
  pageId: string,
  pageType?: string,
) => Promise<unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const mod = await import('../../server/schema-generation-context.js');
  prepareBulkSchemaGenerationContext = mod.prepareBulkSchemaGenerationContext;
  prepareSinglePageSchemaGenerationContext = mod.prepareSinglePageSchemaGenerationContext;
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeContextBundle(overrides: Partial<{ workspaceId: string; pageType: string }> = {}) {
  const ctx: Record<string, unknown> = {
    companyName: 'Acme Corp',
    liveDomain: 'acme.com',
    workspaceId: overrides.workspaceId ?? 'ws_test',
  };
  if (overrides.pageType) ctx.pageType = overrides.pageType;
  return { ctx, siteId: 'site_test' };
}

// ── prepareBulkSchemaGenerationContext ─────────────────────────────────────────

describe('prepareBulkSchemaGenerationContext', () => {
  it('returns the bundle from buildSchemaContext', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetCachedArchitecture.mockResolvedValue({ tree: { children: [] } });

    const result = await prepareBulkSchemaGenerationContext('site_test');
    expect(result).toBe(bundle);
  });

  it('calls buildSchemaContext with siteId and includeAnalytics: true', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareBulkSchemaGenerationContext('site_abc');
    expect(mockBuildSchemaContext).toHaveBeenCalledWith('site_abc', { includeAnalytics: true });
  });

  it('attaches architecture tree to ctx when workspaceId is present', async () => {
    const bundle = makeContextBundle();
    const tree = { children: [{ slug: '/about' }] };
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetCachedArchitecture.mockResolvedValue({ tree });

    await prepareBulkSchemaGenerationContext('site_test');
    expect(bundle.ctx._architectureTree).toBe(tree);
  });

  it('silently skips architecture when getCachedArchitecture throws a programming error', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    // TypeError is treated as a programming error by isProgrammingError()
    mockGetCachedArchitecture.mockRejectedValue(new TypeError('cannot read property'));

    // Should not throw
    await expect(prepareBulkSchemaGenerationContext('site_test')).resolves.toBeDefined();
    expect(bundle.ctx._architectureTree).toBeUndefined();
  });

  it('does not call getCachedArchitecture when workspaceId is absent', async () => {
    const bundle = makeContextBundle({ workspaceId: '' });
    bundle.ctx.workspaceId = undefined; // simulate no workspace
    mockBuildSchemaContext.mockResolvedValue(bundle);

    await prepareBulkSchemaGenerationContext('site_test');
    expect(mockGetCachedArchitecture).not.toHaveBeenCalled();
  });
});

// ── prepareSinglePageSchemaGenerationContext ───────────────────────────────────

describe('prepareSinglePageSchemaGenerationContext', () => {
  it('returns the bundle from buildSchemaContext', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue(null);
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    const result = await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');
    expect(result).toBe(bundle);
  });

  it('applies pageType override when provided', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue(null);
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1', 'blog');
    expect(bundle.ctx.pageType).toBe('blog');
  });

  it('does not override pageType when not provided', async () => {
    const bundle = makeContextBundle({ pageType: 'homepage' });
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue(null);
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');
    // pageType should remain from context, not overwritten
    expect(bundle.ctx.pageType).toBe('homepage');
  });

  it('attaches prior validation errors when present', async () => {
    const bundle = makeContextBundle();
    const errors = [{ message: 'Missing @type' }, { message: 'Invalid schema' }];
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue({ errors });
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');
    expect(bundle.ctx._existingErrors).toEqual(errors);
  });

  it('does not attach _existingErrors when validation has no errors', async () => {
    const bundle = makeContextBundle();
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue({ errors: [] });
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');
    expect(bundle.ctx._existingErrors).toBeUndefined();
  });

  it('filters out error objects missing a message string', async () => {
    const bundle = makeContextBundle();
    // mix of valid and invalid error shapes
    const errors = [{ message: 'Valid error' }, { code: 123 }, null, { message: 42 }];
    mockBuildSchemaContext.mockResolvedValue(bundle);
    mockGetValidation.mockReturnValue({ errors });
    mockGetCachedArchitecture.mockResolvedValue({ tree: {} });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');
    expect(bundle.ctx._existingErrors).toEqual([{ message: 'Valid error' }]);
  });
});
