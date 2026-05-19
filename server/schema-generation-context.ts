import { buildSchemaContext } from './helpers.js';
import { getCachedArchitecture } from './site-architecture.js';
import { getValidation } from './schema-validator.js';
import type { SchemaContext } from './schema-suggester.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';

const log = createLogger('schema-generation-context');

type SchemaContextBundle = Awaited<ReturnType<typeof buildSchemaContext>>;
export async function prepareBulkSchemaGenerationContext(siteId: string): Promise<SchemaContextBundle> {
  const context = await buildSchemaContext(siteId, { includeAnalytics: true });
  const { ctx } = context;

  if (ctx.workspaceId) {
    await attachArchitectureTree(ctx);
  }

  return context;
}

export async function prepareSinglePageSchemaGenerationContext(
  siteId: string,
  pageId: string,
  pageType?: SchemaContext['pageType'],
): Promise<SchemaContextBundle> {
  const context = await buildSchemaContext(siteId, { includeAnalytics: true });
  const { ctx } = context;

  if (pageType) ctx.pageType = pageType;

  if (ctx.workspaceId) {
    const prior = getValidation(ctx.workspaceId, pageId);
    if (Array.isArray(prior?.errors) && prior.errors.length > 0) {
      const validErrors = prior.errors.filter(
        (error): error is { message: string } => typeof (error as { message?: unknown })?.message === 'string',
      );
      if (validErrors.length > 0) ctx._existingErrors = validErrors;
    }
    await attachArchitectureTree(ctx);
  }

  return context;
}

async function attachArchitectureTree(ctx: SchemaContext): Promise<void> {
  if (!ctx.workspaceId) return;
  try {
    const arch = await getCachedArchitecture(ctx.workspaceId);
    ctx._architectureTree = arch.tree;
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId: ctx.workspaceId }, 'Schema generation architecture context unavailable');
    }
  }
}
