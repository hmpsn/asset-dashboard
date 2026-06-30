/**
 * Schema (JSON-LD) MCP action tools — generate / validate / publish.
 *
 * Trust posture (owner decision): `publish_schema` VALIDATES FIRST and REFUSES to
 * publish schema that fails validation. Schema markup is invisible structured data
 * (lower stakes than a post), so a validate-first gate is the right-sized guardrail.
 *
 * Persistence is routed through the same service functions the admin
 * `POST /api/webflow/schema-publish/:siteId` route uses — never raw DB writes:
 *   - generate:  generateSchemaForPage() + upsertPageResultInSnapshot()
 *   - validate:  validateLeanSchema() (structural) + validateForGoogleRichResults() (Google)
 *   - publish:   publishSchemaToLive() — the SHARED domain service the admin route
 *                also calls. It runs the full follow-on set (CMS-field-or-static
 *                publish + recordSchemaPublish + updatePageSchemaInSnapshot +
 *                recordSeoChange + llms.txt regen + rec-regen + updatePageState +
 *                invalidateIntelligenceCache), so the MCP path can no longer drift
 *                from the route and no longer imports anything from server/routes/.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  generateSchemaInputSchema,
  validateSchemaInputSchema,
  publishSchemaInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { SchemaPageSuggestion } from '../../schema/suggestion-types.js';
import type { SchemaPageType } from '../../schema/role-type-registry.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { generateSchemaForPage } from '../../schema-suggester.js';
import { prepareSinglePageSchemaGenerationContext } from '../../schema-generation-context.js';
import { upsertPageResultInSnapshot } from '../../schema-store.js';
import { validateForGoogleRichResults } from '../../schema-validator.js';
import { validateLeanSchema } from '../../schema/validator.js';
import { publishSchemaToLive } from '../../domains/schema/publish-schema-to-live.js';
import { getTokenForSite } from '../../workspaces.js';
import { createLogger } from '../../logger.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-schema-actions');

export const schemaActionTools: Tool[] = [
  {
    name: 'generate_schema',
    description:
      'Generate structured-data (JSON-LD schema) for a page. Returns the unified `@graph` schema plus the validation findings the generator produced. Persists the result to the schema snapshot (the same surface the admin Schema tab reads). Does NOT publish — call validate_schema / publish_schema next.',
    inputSchema: toMcpJsonSchema(generateSchemaInputSchema),
  },
  {
    name: 'validate_schema',
    description:
      'Validate JSON-LD schema against structural rules + Google Rich Results requirements. Provide a page_id (generates fresh then validates) OR a raw schema_json object. Returns { valid, status, errors, warnings, richResults }. Read-only — never publishes.',
    inputSchema: toMcpJsonSchema(validateSchemaInputSchema),
  },
  {
    name: 'publish_schema',
    description:
      "Publish structured-data (JSON-LD schema) to a page on the LIVE site. VALIDATE-FIRST: the freshly-generated schema is validated and publishing is REFUSED if it has errors. On success the schema is written to the page (or its CMS field), recorded for rollback, and the page state is marked live.",
    inputSchema: toMcpJsonSchema(publishSchemaInputSchema),
  },
];

interface ResolvedSite {
  siteId: string;
  token: string | undefined;
}

// Tagged success/error results for the internal helpers. The MCP response type
// (CallToolResult) carries `isError` only optionally, so `'isError' in x` does NOT
// reliably narrow a `Success | McpToolErrorResponse` union at the type level — an
// explicit `ok` discriminant does.
type HelperResult<T> = { ok: true; value: T } | { ok: false; error: McpToolErrorResponse };

/**
 * Resolve a workspace (or the requireWorkspace error response) to its Webflow site
 * id + API token. Surfaces the workspace-not-found error verbatim, and fails when
 * the workspace exists but has no Webflow site linked (schema generation/publishing
 * is impossible without a site). Accepting the union lets the caller pass the
 * requireWorkspace result directly — `'isError' in x` does not reliably narrow a
 * `Workspace | CallToolResult` union because CallToolResult.isError is optional.
 */
function resolveSite(workspace: Workspace | McpToolErrorResponse): HelperResult<ResolvedSite> {
  if ('isError' in workspace && workspace.isError) {
    return { ok: false, error: workspace };
  }
  const ws = workspace as Workspace;
  if (!ws.webflowSiteId) {
    return {
      ok: false,
      error: mcpError(`Workspace ${ws.id} has no linked Webflow site — connect a site before generating or publishing schema.`),
    };
  }
  const siteId = ws.webflowSiteId;
  return { ok: true, value: { siteId, token: getTokenForSite(siteId) || undefined } };
}

/**
 * The publishable JSON-LD for a generated page result is the first suggested
 * schema's `template` (the unified `@graph`). Mirrors the admin frontend's
 * `page.suggestedSchemas[0].template` publish source.
 */
function extractSchemaJson(result: SchemaPageSuggestion): Record<string, unknown> | null {
  const template = result.suggestedSchemas?.[0]?.template;
  if (!template || typeof template !== 'object') return null;
  return template;
}

interface ValidationSummary {
  valid: boolean;
  status: 'valid' | 'warnings' | 'errors';
  errors: Array<{ type: string; field?: string; message: string }>;
  warnings: Array<{ type: string; field?: string; message: string }>;
  richResults: string[];
}

/**
 * Run BOTH validators (structural lean + Google rich results) and fold them into
 * one summary. `valid` is false if EITHER produces an error — matching the admin
 * publish gate, which rejects on structural errors OR Google-validation errors.
 */
function validateSchema(schema: Record<string, unknown>): ValidationSummary {
  const structural = validateLeanSchema(schema, 'WebPage');
  const structuralErrors = structural.filter(f => f.severity === 'error');
  const structuralWarnings = structural.filter(f => f.severity === 'warning');

  const google = validateForGoogleRichResults(schema);

  const errors = [
    ...structuralErrors.map(f => ({ type: f.type, field: f.field, message: f.message })),
    ...google.errors.map(e => ({ type: e.type, field: e.field, message: e.message })),
  ];
  const warnings = [
    ...structuralWarnings.map(f => ({ type: f.type, field: f.field, message: f.message })),
    ...google.warnings.map(e => ({ type: e.type, field: e.field, message: e.message })),
  ];

  const valid = errors.length === 0;
  const status: ValidationSummary['status'] = errors.length > 0
    ? 'errors'
    : warnings.length > 0 ? 'warnings' : 'valid';

  return { valid, status, errors, warnings, richResults: google.richResults };
}

interface GeneratedSchema {
  result: SchemaPageSuggestion;
  schema: Record<string, unknown>;
}

/**
 * Generate the page schema (persisting the result to the snapshot) and return the
 * generated result + its publishable JSON-LD. Fails on not-found / no-publishable
 * schema. `pageTypeHint` only STEERS auto-detection; unknown values are ignored
 * server-side (cast to SchemaPageType — a steering hint, not a validated enum).
 */
async function generateAndPersist(
  workspaceId: string,
  siteId: string,
  token: string | undefined,
  pageId: string,
  pageTypeHint: string | undefined,
): Promise<HelperResult<GeneratedSchema>> {
  const { ctx } = await prepareSinglePageSchemaGenerationContext(
    siteId,
    pageId,
    pageTypeHint as SchemaPageType | undefined,
  );
  const result = await generateSchemaForPage(siteId, pageId, token, ctx);
  if (!result) return { ok: false, error: mcpError(`Page not found for schema generation: ${pageId}`) };

  const schema = extractSchemaJson(result);
  if (!schema) {
    return {
      ok: false,
      error: mcpError(`No schema could be generated for page ${pageId} — the page has no eligible schema content.`),
    };
  }

  // Persist the freshly-generated result so it survives reload and a snapshot
  // refetch does not clobber it — same call the admin single-page route makes.
  upsertPageResultInSnapshot(siteId, workspaceId, result);
  return { ok: true, value: { result, schema } };
}

async function handleGenerateSchema(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = generateSchemaInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, page_id: pageId, page_type: pageType } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const site = resolveSite(workspace);
  if (!site.ok) return site.error;

  try {
    const generated = await generateAndPersist(workspaceId, site.value.siteId, site.value.token, pageId, pageType);
    if (!generated.ok) return generated.error;
    const { result, schema } = generated.value;

    // Generation persists a snapshot row that the admin Schema tab + intelligence read.
    broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
      siteId: site.value.siteId,
      action: 'generated',
      pageId,
    });
    addActivity(
      workspaceId,
      'schema_generated',
      `Generated schema for page ${pageId.slice(0, 8)}…`,
      result.pageTitle || result.publishedPath || undefined,
      { source: 'mcp-chat', siteId: site.value.siteId, pageId, action: 'mcp_schema_generated' },
    );

    const validation = validateSchema(schema);
    return mcpSuccess({
      ok: true,
      page_id: pageId,
      page_title: result.pageTitle,
      published_path: result.publishedPath ?? null,
      schema,
      validation,
      dashboard_url: buildDashboardUrl(workspaceId, 'schema'),
    });
  } catch (err) {
    log.error({ err, workspaceId, pageId }, 'generate_schema failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Schema generation failed: ${message}`);
  }
}

async function handleValidateSchema(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = validateSchemaInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, page_id: pageId, schema_json: schemaJson, page_type: pageType } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  // Raw-object path: validate exactly what the caller passed (no site/generation needed).
  if (schemaJson) {
    const validation = validateSchema(schemaJson);
    return mcpSuccess({
      ok: true,
      source: 'schema_json',
      validation,
      dashboard_url: buildDashboardUrl(workspaceId, 'schema'),
    });
  }

  // page_id path: generate fresh, then validate (the refine guarantees pageId is set here).
  const site = resolveSite(workspace);
  if (!site.ok) return site.error;

  try {
    const generated = await generateAndPersist(workspaceId, site.value.siteId, site.value.token, pageId!, pageType);
    if (!generated.ok) return generated.error;

    broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
      siteId: site.value.siteId,
      action: 'generated',
      pageId: pageId!,
    });

    const validation = validateSchema(generated.value.schema);
    return mcpSuccess({
      ok: true,
      source: 'page_id',
      page_id: pageId,
      schema: generated.value.schema,
      validation,
      dashboard_url: buildDashboardUrl(workspaceId, 'schema'),
    });
  } catch (err) {
    log.error({ err, workspaceId, pageId }, 'validate_schema failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Schema validation failed: ${message}`);
  }
}

async function handlePublishSchema(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = publishSchemaInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, page_id: pageId, page_type: pageType, publish_after: publishAfter } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const site = resolveSite(workspace);
  if (!site.ok) return site.error;
  const { siteId, token } = site.value;

  try {
    const generated = await generateAndPersist(workspaceId, siteId, token, pageId, pageType);
    if (!generated.ok) return generated.error;
    const { result, schema } = generated.value;

    // ── VALIDATE-FIRST GUARD (owner decision) ──
    // Refuse to publish schema that fails validation. The publish service functions
    // below are NEVER called when validation has errors.
    const validation = validateSchema(schema);
    if (!validation.valid) {
      return mcpError(
        `Schema validation failed — not publishing. Fix these ${validation.errors.length} error(s) and retry: ${
          validation.errors.map(e => `${e.type}${e.field ? `.${e.field}` : ''}: ${e.message}`).join('; ')
        }`,
      );
    }

    // ── PUBLISH TO LIVE (shared domain service) ──
    // publishSchemaToLive performs CMS-field-first then static-page custom-code
    // publish AND runs the full canonical follow-on set (recordSchemaPublish +
    // updatePageSchemaInSnapshot + recordSeoChange + llms.txt regen + rec-regen +
    // updatePageState(live) + invalidateIntelligenceCache + the published
    // SCHEMA_SNAPSHOT_UPDATED broadcast + activity log). Using it closes the
    // parity gap: the MCP path now fires recordSeoChange + llms.txt + rec-regen,
    // which the old inline reimplementation omitted.
    const publishResult = await publishSchemaToLive({
      siteId,
      pageId,
      schema,
      workspaceId,
      token,
      pageTitle: result.pageTitle || undefined,
      publishedPath: result.publishedPath || undefined,
      publishAfter: publishAfter ?? false,
    });

    if (!publishResult.ok) {
      if (publishResult.kind === 'cms-blocked' || publishResult.kind === 'cms-failed') {
        return mcpError(`Schema publish failed (CMS field): ${publishResult.message}`);
      }
      if (publishResult.kind === 'manual-required') {
        return mcpError(
          `Schema could not be published automatically: ${publishResult.message} (manual action required in Webflow).`,
        );
      }
      return mcpError(`Schema publish failed: ${publishResult.message}`);
    }

    // The service emits a generic 'schema-publish' activity; add the MCP-tagged
    // activity so chat-driven publishes are attributable to the MCP surface
    // (pr-check requires addActivity({ source: 'mcp-chat' }) in tool write paths).
    addActivity(
      workspaceId,
      'schema_published',
      `Published schema to page ${pageId.slice(0, 8)}…`,
      publishResult.deliveryMessage,
      { source: 'mcp-chat', siteId, pageId, mode: publishResult.mode, action: 'mcp_schema_published' },
    );

    return mcpSuccess({
      ok: true,
      page_id: pageId,
      published: true,
      mode: publishResult.mode,
      delivery_status: publishResult.deliveryStatus,
      published_to_live: publishAfter ?? false,
      validation,
      dashboard_url: buildDashboardUrl(workspaceId, 'schema'),
    });
  } catch (err) {
    log.error({ err, workspaceId, pageId }, 'publish_schema failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Schema publish failed: ${message}`);
  }
}

export async function handleSchemaActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'generate_schema') return handleGenerateSchema(args);
  if (name === 'validate_schema') return handleValidateSchema(args);
  if (name === 'publish_schema') return handlePublishSchema(args);
  return mcpError(`Unknown schema action tool: ${name}`);
}
