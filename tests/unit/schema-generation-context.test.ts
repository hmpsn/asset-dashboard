import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildSchemaContext: vi.fn(),
  getCachedArchitecture: vi.fn(),
  getValidation: vi.fn(),
  isProgrammingError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../server/helpers.js', () => ({
  buildSchemaContext: mocks.buildSchemaContext,
}));

vi.mock('../../server/site-architecture.js', () => ({
  getCachedArchitecture: mocks.getCachedArchitecture,
}));

vi.mock('../../server/schema-validator.js', () => ({
  getValidation: mocks.getValidation,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: mocks.logWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { prepareBulkSchemaGenerationContext, prepareSinglePageSchemaGenerationContext } =
  await import('../../server/schema-generation-context.js');

function makeContextBundle(overrides: Partial<{ workspaceId: string; pageType: string }> = {}) {
  const ctx: Record<string, unknown> = {
    companyName: 'Acme Corp',
    liveDomain: 'acme.com',
    workspaceId: overrides.workspaceId ?? 'ws_test',
  };
  if (overrides.pageType) ctx.pageType = overrides.pageType;
  return { ctx, siteId: 'site_test' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isProgrammingError.mockReturnValue(false);
  mocks.getValidation.mockReturnValue(null);
  mocks.getCachedArchitecture.mockResolvedValue({ tree: { children: [] } });
  mocks.buildSchemaContext.mockResolvedValue(makeContextBundle());
});

describe('prepareBulkSchemaGenerationContext', () => {
  it('returns context bundle from buildSchemaContext and requests analytics', async () => {
    const bundle = makeContextBundle();
    mocks.buildSchemaContext.mockResolvedValue(bundle);

    const result = await prepareBulkSchemaGenerationContext('site_abc');

    expect(result).toBe(bundle);
    expect(mocks.buildSchemaContext).toHaveBeenCalledWith('site_abc', { includeAnalytics: true });
  });

  it('attaches architecture tree when workspaceId is present', async () => {
    const bundle = makeContextBundle();
    const tree = { children: [{ slug: '/about' }] };
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getCachedArchitecture.mockResolvedValue({ tree });

    await prepareBulkSchemaGenerationContext('site_test');

    expect(bundle.ctx._architectureTree).toBe(tree);
  });

  it('skips architecture lookup when workspaceId is missing', async () => {
    const bundle = makeContextBundle({ workspaceId: '' });
    bundle.ctx.workspaceId = undefined;
    mocks.buildSchemaContext.mockResolvedValue(bundle);

    await prepareBulkSchemaGenerationContext('site_test');

    expect(mocks.getCachedArchitecture).not.toHaveBeenCalled();
  });

  it('degrades gracefully when architecture lookup throws', async () => {
    const bundle = makeContextBundle();
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getCachedArchitecture.mockRejectedValue(new Error('architecture unavailable'));

    await expect(prepareBulkSchemaGenerationContext('site_test')).resolves.toBeDefined();
    expect(bundle.ctx._architectureTree).toBeUndefined();
  });
});

describe('prepareSinglePageSchemaGenerationContext', () => {
  it('applies pageType override and attaches existing validation errors', async () => {
    const bundle = makeContextBundle({ pageType: 'homepage' });
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getValidation.mockReturnValue({ errors: [{ message: 'Missing @type' }, { message: 'Invalid schema' }] });

    const result = await prepareSinglePageSchemaGenerationContext('site_test', 'page_1', 'blog');

    expect(result).toBe(bundle);
    expect(bundle.ctx.pageType).toBe('blog');
    expect(bundle.ctx._existingErrors).toEqual([{ message: 'Missing @type' }, { message: 'Invalid schema' }]);
  });

  it('filters malformed validation errors and leaves pageType untouched without override', async () => {
    const bundle = makeContextBundle({ pageType: 'homepage' });
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getValidation.mockReturnValue({ errors: [{ message: 'Valid' }, { code: 123 }, null, { message: 42 }] });

    await prepareSinglePageSchemaGenerationContext('site_test', 'page_1');

    expect(bundle.ctx.pageType).toBe('homepage');
    expect(bundle.ctx._existingErrors).toEqual([{ message: 'Valid' }]);
  });

  it('degrades gracefully when validation lookup throws runtime error (non-programming)', async () => {
    const bundle = makeContextBundle();
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getValidation.mockImplementation(() => {
      throw new Error('validation store unavailable');
    });
    mocks.isProgrammingError.mockReturnValue(false);

    await expect(prepareSinglePageSchemaGenerationContext('site_test', 'page_1')).resolves.toBeDefined();
    expect(bundle.ctx._existingErrors).toBeUndefined();
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it('logs warning and continues when validation lookup throws programming error', async () => {
    const bundle = makeContextBundle();
    mocks.buildSchemaContext.mockResolvedValue(bundle);
    mocks.getValidation.mockImplementation(() => {
      throw new TypeError('cannot read property');
    });
    mocks.isProgrammingError.mockReturnValue(true);

    await expect(prepareSinglePageSchemaGenerationContext('site_test', 'page_1')).resolves.toBeDefined();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_test', pageId: 'page_1' }),
      'Schema generation validation context unavailable',
    );
  });
});
