import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import type { ContentMatrix, ContentTemplate } from '../../../shared/types/content.js';
import {
  acceptContentTemplateGenerationUpgradeInputSchema,
  createContentMatrixFromPseoPlanInputSchema,
  getContentMatrixGenerationInputSchema,
  getContentMatrixInputSchema,
  getPseoMatrixPlanInputSchema,
  listContentMatricesInputSchema,
  listPseoBlueprintEntriesInputSchema,
  previewContentMatrixGenerationInputSchema,
  resolveContentMatrixEvidenceInputSchema,
  resolveContentMatrixCellsInputSchema,
  retryContentMatrixGenerationInputSchema,
  startContentMatrixGenerationInputSchema,
} from '../../../shared/types/mcp-matrix-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import {
  MatrixGenerationSourceLimitError,
  MatrixGenerationSchemaTypeContractError,
  MATRIX_GENERATION_SOURCE_LIMITS,
  MATRIX_READ_LIMITS,
  type ContentTemplateGenerationUpgradeProposal,
  type PreviewMatrixGenerationResult,
  type ResolveMatrixStructuresResult,
} from '../../../shared/types/matrix-generation.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import {
  ContentTemplateGenerationContractError,
  ContentTemplateRevisionConflictError,
  ContentTemplateRevisionRequiredError,
  ContentTemplateSourceIntegrityError,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../../content-templates.js';
import {
  ContentMatrixPatternRenderError,
  createMatrix,
  MatrixTemplateIntegrityError,
} from '../../content-matrices.js';
import {
  getContentMatrix,
  listContentMatrices,
  MatrixReadServiceError,
  resolveMatrixStructures,
} from '../../domains/content/matrix-generation/read-service.js';
import {
  MatrixGenerationEvidenceError,
  resolveContentMatrixEvidence,
} from '../../domains/content/matrix-generation/evidence.js';
import { previewMatrixGeneration } from '../../domains/content/matrix-generation/preview.js';
import {
  getMatrixGeneration,
  MatrixGenerationBatchNotFoundError,
  MatrixGenerationBatchPreconditionError,
  retryMatrixGeneration,
  startMatrixGeneration,
} from '../../domains/content/matrix-generation/batch-service.js';
import {
  acceptTemplateGenerationUpgrade,
  type AcceptTemplateGenerationUpgradeActionResult,
  TemplateGenerationUpgradeError,
} from '../../domains/content/matrix-generation/upgrade-action.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { ActiveJobResourceConflict } from '../../jobs.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { recordPaidCallOnce } from '../paid-call-counter.js';
import { mcpJsonV1Error, mcpZodValidationError } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';
import { WS_EVENTS } from '../../ws-events.js';
import {
  createMatrixFromPseoPlan,
  getPseoMatrixPlan,
  listPseoBlueprintEntries,
  PseoMatrixBridgeError,
} from '../../domains/content/matrix-generation/pseo-bridge.js';
import { createLogger } from '../../logger.js';
import { parseJsonFallback } from '../../db/json-validation.js';
import {
  createTemplateSchema,
  duplicateTemplateSchema,
  updateTemplateFieldsSchema,
  updateTemplateSchema,
} from '../../routes/content-templates.js';
import {
  boundedDimensionSchema,
  createMatrixFieldsSchema,
  createMatrixSchema,
} from '../../routes/content-matrices.js';

const log = createLogger('mcp-content-matrix-actions');
const DIRECT_CONTENT_TOOL_NAMES = new Set([
  'list_content_templates',
  'get_content_template',
  'create_content_template',
  'update_content_template',
  'duplicate_content_template',
  'create_content_matrix',
]);

const workspaceIdSchema = z.string().trim().min(1, 'workspace_id is required')
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes)
  .describe('Workspace that owns the content template or matrix.');
const durableIdSchema = z.string().trim().min(1)
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes);
const templateCursorSchema = z.string().trim().min(1).max(2_048)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor must be an opaque base64url token');

const listContentTemplatesInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  cursor: templateCursorSchema.optional()
    .describe('Opaque cursor bound to this workspace and template ordering.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Page size; defaults to ${MATRIX_READ_LIMITS.defaultPageSize} and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
}).strict();

const getContentTemplateInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template_id: durableIdSchema.describe('Durable content template ID.'),
}).strict();

const createContentTemplateInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template: createTemplateSchema.describe('Content template fields using the same contract as the admin HTTP create route.'),
  idempotency_key: z.string().trim().min(1).max(200).optional()
    .describe('Optional caller correlation key; template creation itself is not replay-idempotent.'),
}).strict();

const updateTemplatePatchSchema = updateTemplateFieldsSchema.strict();
const updateContentTemplateInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template_id: durableIdSchema.describe('Durable content template ID.'),
  patch: updateTemplatePatchSchema.describe('Partial template fields using the same contract as the admin HTTP update route.'),
  expected_revision: z.number().int().nonnegative()
    .describe('Exact template revision returned by get_content_template.'),
}).strict().superRefine((value, ctx) => {
  const parsed = updateTemplateSchema.safeParse({
    ...value.patch,
    expectedTemplateRevision: value.expected_revision,
  });
  if (parsed.success) return;
  parsed.error.issues.forEach(issue => ctx.addIssue({
    ...issue,
    path: issue.path[0] === 'expectedTemplateRevision'
      ? ['expected_revision', ...issue.path.slice(1)]
      : ['patch', ...issue.path],
  }));
});

const duplicateContentTemplateInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template_id: durableIdSchema.describe('Durable source template ID.'),
  new_name: duplicateTemplateSchema.shape.name.optional()
    .describe('Optional name for the copy; defaults to the existing duplicate convention.'),
}).strict();

const createContentMatrixInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  name: createMatrixFieldsSchema.shape.name.describe('Name for the new matrix.'),
  template_id: createMatrixFieldsSchema.shape.templateId.describe('Existing content template to reuse.'),
  dimensions: z.array(boundedDimensionSchema).min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions)
    .describe('Cartesian dimensions using template variableName values exactly.'),
  url_pattern: createMatrixFieldsSchema.shape.urlPattern.optional()
    .describe('Optional URL pattern; defaults to the selected template pattern.'),
  keyword_pattern: createMatrixFieldsSchema.shape.keywordPattern.optional()
    .describe('Optional keyword pattern; defaults to the selected template pattern.'),
  expected_schema_types: z.array(z.string().trim().min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.template.maxSchemaTypeBytes))
    .max(MATRIX_GENERATION_SOURCE_LIMITS.template.maxSchemaTypes).optional()
    .describe('Optional exact schema types for created cells; defaults to the template schema types.'),
}).strict().superRefine((value, ctx) => {
  const parsed = createMatrixSchema.safeParse({
    name: value.name,
    templateId: value.template_id,
    dimensions: value.dimensions,
    urlPattern: value.url_pattern,
    keywordPattern: value.keyword_pattern,
  });
  if (parsed.success) return;
  parsed.error.issues.forEach(issue => ctx.addIssue({
    ...issue,
    path: issue.path.map(segment => segment === 'templateId'
      ? 'template_id'
      : segment === 'urlPattern'
        ? 'url_pattern'
        : segment === 'keywordPattern'
          ? 'keyword_pattern'
          : segment),
  }));
});

export const contentMatrixActionTools: Tool[] = [
  {
    name: 'list_content_templates',
    description: 'List bounded content-template summaries without returning full sections or CMS field maps. Ordered by most recently updated, then stable template ID.',
    inputSchema: toMcpJsonSchema(listContentTemplatesInputSchema),
  },
  {
    name: 'get_content_template',
    description: 'Read one complete content template, including variables, ordered sections, generation/AEO/CTA contracts, patterns, CMS mapping, and revision.',
    inputSchema: toMcpJsonSchema(getContentTemplateInputSchema),
  },
  {
    name: 'create_content_template',
    description: 'Create a reusable page structure through the same validated template service used by the admin UI. This does not create pages, start AI work, or approve content.',
    inputSchema: toMcpJsonSchema(createContentTemplateInputSchema),
  },
  {
    name: 'update_content_template',
    description: 'Revision-safely update one reusable content template through the existing domain service. Stale writes conflict; no generation or approval occurs.',
    inputSchema: toMcpJsonSchema(updateContentTemplateInputSchema),
  },
  {
    name: 'duplicate_content_template',
    description: 'Duplicate an existing content template as a starting point for a new locked page structure. Does not alter the source template.',
    inputSchema: toMcpJsonSchema(duplicateContentTemplateInputSchema),
  },
  {
    name: 'create_content_matrix',
    description: 'Create a validated Cartesian content matrix directly from an existing template and explicit dimensions, without requiring Page Strategy or a pSEO blueprint. Uses template URL, keyword, and schema defaults when omitted; never starts generation.',
    inputSchema: toMcpJsonSchema(createContentMatrixInputSchema),
  },
  {
    name: 'list_pseo_blueprint_entries',
    description:
      'List bounded collection entries created by Page Strategy (server/blueprint-generator.ts), including durable blueprint_id, entry_id, linked template_id, and linked matrix_id. An empty items array means Page Strategy has not produced collection entries for this workspace; it is not an error. Read-only.',
    inputSchema: toMcpJsonSchema(listPseoBlueprintEntriesInputSchema),
  },
  {
    name: 'list_content_matrices',
    description:
      'List a workspace\'s content matrices as bounded summaries ordered by most recently updated, then stable matrix ID. Optionally filter by template_id. This read never returns cell blobs, calls AI, or creates a generation run.',
    inputSchema: toMcpJsonSchema(listContentMatricesInputSchema),
  },
  {
    name: 'get_content_matrix',
    description:
      'Get one content matrix\'s metadata and a bounded page of cells. The opaque cursor is tied to the matrix revision and exact cell snapshot, so a cell-only edit returns a conflict instead of mixing snapshots. Read-only; no AI or artifact writes.',
    inputSchema: toMcpJsonSchema(getContentMatrixInputSchema),
  },
  {
    name: 'resolve_content_matrix_cells',
    description:
      'Deterministically resolve up to 25 explicitly selected matrix cells from exact matrix/template/cell revisions. Returns structural targets, typed blockers, or fingerprint references to de-duplicated legacy-template upgrade proposals. Does not resolve voice, estimate paid work, call AI, create runs, or write artifacts.',
    inputSchema: toMcpJsonSchema(resolveContentMatrixCellsInputSchema),
  },
  {
    name: 'accept_content_template_generation_upgrade',
    description:
      'Accept or reject the exact deterministic generation-contract upgrade proposed for a legacy content template. Acceptance uses the expected template revision, proposal fingerprint, and idempotency key for a version-conditional write; rejection is a no-op.',
    inputSchema: toMcpJsonSchema(acceptContentTemplateGenerationUpgradeInputSchema),
  },
  {
    name: 'preview_content_matrix_generation',
    description:
      'Preview explicitly selected matrix cells for generation readiness without paid work. Resolves current source revisions, finalized voice, page-type-approved identity, evidence requirements, linked artifact revisions, effective input fingerprints, and bounded call/token/cost estimates.',
    inputSchema: toMcpJsonSchema(previewContentMatrixGenerationInputSchema),
  },
  {
    name: 'resolve_content_matrix_evidence',
    description:
      'Resolve one stable matrix-cell evidence requirement with a typed value and factual source. The version-conditional mutation advances only that cell revision, invalidating the prior preview; re-preview before any generation start.',
    inputSchema: toMcpJsonSchema(resolveContentMatrixEvidenceInputSchema),
  },
  {
    name: 'start_content_matrix_generation',
    description:
      '[Paid API] Start one bounded background generation run for explicitly previewed matrix cells. Requires exact source revisions, preview fingerprints, caller-accepted budget ceilings, and an idempotency key. Produces review-ready drafts only; never approves or publishes.',
    inputSchema: toMcpJsonSchema(startContentMatrixGenerationInputSchema),
  },
  {
    name: 'get_content_matrix_generation',
    description:
      'Read one durable matrix generation run and a cursor-paged set of per-cell outcomes, audit findings, artifact IDs, and human approval evidence.',
    inputSchema: toMcpJsonSchema(getContentMatrixGenerationInputSchema),
  },
  {
    name: 'retry_content_matrix_generation',
    description:
      '[Paid API] Resume explicitly selected failed or needs-attention matrix items from exact run, item, source, artifact, and reusable-checkpoint revisions. Does not replace approved work and never publishes.',
    inputSchema: toMcpJsonSchema(retryContentMatrixGenerationInputSchema),
  },
  {
    name: 'get_pseo_matrix_plan',
    description:
      'Read one collection blueprint entry, its linked template variables, and exact source authority for safe matrix materialization. Bounded and read-only; never creates a matrix or starts generation.',
    inputSchema: toMcpJsonSchema(getPseoMatrixPlanInputSchema),
  },
  {
    name: 'create_content_matrix_from_pseo_plan',
    description:
      'Materialize a validated matrix from one Page Strategy collection entry. This is the blueprint-linked convenience route; use create_content_matrix when a reusable template and dimensions are already known. Records the source link and never previews, starts generation, approves, sends, or publishes.',
    inputSchema: toMcpJsonSchema(createContentMatrixFromPseoPlanInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface ContentMatrixActionDependencies {
  listTemplates: typeof listTemplates;
  getTemplate: typeof getTemplate;
  createTemplate: typeof createTemplate;
  updateTemplate: typeof updateTemplate;
  duplicateTemplate: typeof duplicateTemplate;
  createMatrix: typeof createMatrix;
  listPseoBlueprintEntries: typeof listPseoBlueprintEntries;
  listContentMatrices: typeof listContentMatrices;
  getContentMatrix: typeof getContentMatrix;
  resolveMatrixStructures: typeof resolveMatrixStructures;
  previewMatrixGeneration: typeof previewMatrixGeneration;
  resolveContentMatrixEvidence: typeof resolveContentMatrixEvidence;
  startMatrixGeneration: typeof startMatrixGeneration;
  getMatrixGeneration: typeof getMatrixGeneration;
  retryMatrixGeneration: typeof retryMatrixGeneration;
  getPseoMatrixPlan: typeof getPseoMatrixPlan;
  createMatrixFromPseoPlan: typeof createMatrixFromPseoPlan;
  acceptTemplateGenerationUpgrade: (
    request: Parameters<typeof acceptTemplateGenerationUpgrade>[0],
  ) => MaybePromise<ReturnType<typeof acceptTemplateGenerationUpgrade>>;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateContentPipelineIntelligence: typeof invalidateContentPipelineIntelligence;
  recordPaidCallOnce: typeof recordPaidCallOnce;
}

const defaultDependencies: ContentMatrixActionDependencies = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  createMatrix,
  listPseoBlueprintEntries,
  listContentMatrices,
  getContentMatrix,
  resolveMatrixStructures,
  previewMatrixGeneration,
  resolveContentMatrixEvidence,
  startMatrixGeneration,
  getMatrixGeneration,
  retryMatrixGeneration,
  getPseoMatrixPlan,
  createMatrixFromPseoPlan,
  acceptTemplateGenerationUpgrade,
  addActivity,
  broadcastToWorkspace,
  invalidateContentPipelineIntelligence,
  recordPaidCallOnce,
};

function snakeCaseKey(key: string): string {
  return key.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`);
}

const IDENTITY_KEYED_MAP_FIELDS = new Set([
  'variableValues',
  'slugSubstitutions',
  'proseSubstitutions',
  'cmsFieldMap',
]);

function toMcpPayload(value: unknown, preserveObjectKeys = false): unknown {
  if (Array.isArray(value)) return value.map(item => toMcpPayload(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      preserveObjectKeys ? key : snakeCaseKey(key),
      toMcpPayload(child, preserveObjectKeys || IDENTITY_KEYED_MAP_FIELDS.has(key)),
    ]),
  );
}

interface TemplateListCursor {
  kind: 'template_list';
  workspaceId: string;
  updatedAt: string;
  templateId: string;
}

function encodeTemplateCursor(cursor: TemplateListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeTemplateCursor(cursor: string, workspaceId: string): TemplateListCursor {
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== cursor) throw new Error('invalid');
    const value = parseJsonFallback<Partial<TemplateListCursor>>(
      decoded.toString('utf8'),
      {},
    );
    if (
      value.kind !== 'template_list'
      || value.workspaceId !== workspaceId
      || typeof value.updatedAt !== 'string'
      || typeof value.templateId !== 'string'
    ) throw new Error('invalid');
    return value as TemplateListCursor;
  } catch (error) {
    log.debug({ error, workspaceId }, 'Template cursor validation failed');
    throw new MatrixReadServiceError(
      'invalid_cursor',
      'The template cursor is invalid.',
      {
        field_path: 'cursor',
        constraint: 'must be an opaque cursor returned by list_content_templates for this workspace',
      },
    );
  }
}

function listTemplateSummaries(
  workspaceId: string,
  cursor: string | undefined,
  limit: number | undefined,
  dependencies: ContentMatrixActionDependencies,
) {
  const pageSize = limit ?? MATRIX_READ_LIMITS.defaultPageSize;
  const after = cursor ? decodeTemplateCursor(cursor, workspaceId) : null;
  const ordered = [...dependencies.listTemplates(workspaceId)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const remaining = after
    ? ordered.filter(template => template.updatedAt < after.updatedAt
      || (template.updatedAt === after.updatedAt && template.id > after.templateId))
    : ordered;
  const page = remaining.slice(0, pageSize + 1);
  const hasMore = page.length > pageSize;
  const items = page.slice(0, pageSize).map(template => ({
    id: template.id,
    workspaceId: template.workspaceId,
    revision: template.revision ?? 0,
    name: template.name,
    description: template.description ?? null,
    pageType: template.pageType,
    variableCount: template.variables.length,
    sectionCount: template.sections.length,
    urlPattern: template.urlPattern,
    keywordPattern: template.keywordPattern,
    generationContractVersion: template.generationContractVersion ?? null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeTemplateCursor({
      kind: 'template_list',
      workspaceId,
      updatedAt: last.updatedAt,
      templateId: last.id,
    }) : null,
  };
}

function projectCreatedMatrix(matrix: ContentMatrix) {
  const { cells: _cells, ...metadata } = matrix;
  return { matrix: metadata, materializedCellCount: matrix.cells.length };
}

function runContentPlanPostCommitEffects(
  workspaceId: string,
  action: 'template_created' | 'template_updated' | 'template_duplicated' | 'matrix_created',
  resource: ContentTemplate | ContentMatrix,
  dependencies: ContentMatrixActionDependencies,
): void {
  runPseoPostCommitEffect(workspaceId, 'invalidate-content-pipeline-intelligence', () => {
    dependencies.invalidateContentPipelineIntelligence(workspaceId);
  });
  runPseoPostCommitEffect(workspaceId, 'broadcast-content-updated', () => {
    dependencies.broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      domain: 'content-plan',
      ...(action === 'matrix_created' ? { matrixId: resource.id } : { templateId: resource.id }),
      action,
    });
  });
  runPseoPostCommitEffect(workspaceId, 'record-activity', () => {
    const verb = action === 'template_created'
      ? 'Created content template'
      : action === 'template_updated'
        ? 'Updated content template'
        : action === 'template_duplicated'
          ? 'Duplicated content template'
          : 'Created content matrix';
    dependencies.addActivity(
      workspaceId,
      'content_updated',
      `${verb} "${resource.name}"`,
      action === 'matrix_created'
        ? `${(resource as ContentMatrix).cells.length} planned page${(resource as ContentMatrix).cells.length === 1 ? '' : 's'}`
        : undefined,
      { source: 'mcp-chat', resourceId: resource.id, action },
    );
  });
}

function paidMatrixCommandSuccess<T extends { jobId: string }>(
  result: T,
  workspaceId: string,
  dependencies: ContentMatrixActionDependencies,
): CallToolResult {
  const eventKey = `mcp:matrix-generation:accepted-command:${result.jobId}`;
  const warning = dependencies.recordPaidCallOnce(eventKey, 1, workspaceId).warning;
  return mcpSuccess(toMcpPayload({
    ...result,
    ...(warning ? { warning } : {}),
  }));
}

function projectResolveResult(result: ResolveMatrixStructuresResult): {
  results: Array<
    | Exclude<ResolveMatrixStructuresResult['results'][number], { status: 'upgrade_required' }>
    | (Omit<
        Extract<ResolveMatrixStructuresResult['results'][number], { status: 'upgrade_required' }>,
        'proposal'
      > & { proposalFingerprint: string })
  >;
  upgradeProposals: ContentTemplateGenerationUpgradeProposal[];
} {
  const upgradeProposals = new Map<string, ContentTemplateGenerationUpgradeProposal>();
  const results = result.results.map(item => {
    if (item.status !== 'upgrade_required') return item;
    upgradeProposals.set(item.proposal.proposalFingerprint, item.proposal);
    const { proposal, ...identity } = item;
    return {
      ...identity,
      proposalFingerprint: proposal.proposalFingerprint,
    };
  });
  return { results, upgradeProposals: [...upgradeProposals.values()] };
}

function projectPreviewResult(result: PreviewMatrixGenerationResult) {
  const upgradeProposals = new Map<string, ContentTemplateGenerationUpgradeProposal>();
  const results = result.results.map(item => {
    if (item.status !== 'upgrade_required') return item;
    upgradeProposals.set(item.proposal.proposalFingerprint, item.proposal);
    const { proposal, ...identity } = item;
    return { ...identity, proposalFingerprint: proposal.proposalFingerprint };
  });
  return {
    results,
    estimatedBatchBudget: result.estimatedBatchBudget,
    upgradeProposals: [...upgradeProposals.values()],
  };
}

function mcpAttribution(context: McpToolExecutionContext) {
  if (context.caller.kind === 'workspace_key') {
    return {
      actorType: 'mcp' as const,
      actorId: context.caller.keyId,
      actorLabel: context.caller.keyLabel,
    };
  }
  return {
    actorType: 'mcp' as const,
    actorId: 'mcp:master-key',
    actorLabel: 'MCP master key',
  };
}

function projectTemplateUpgradeResult(result: AcceptTemplateGenerationUpgradeActionResult) {
  return {
    status: result.status,
    templateId: result.template.id,
    templateRevision: result.template.revision ?? 0,
    generationContractVersion: result.template.generationContractVersion ?? null,
    proposalFingerprint: result.proposalFingerprint,
    replayed: result.replayed,
  };
}

function validationError(error?: z.ZodError): CallToolResult {
  return error ? mcpZodValidationError(error) : mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message: 'The tool input is invalid.',
    retryable: false,
  });
}

function directContentNotFoundError(resource: 'template' | 'matrix'): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: `The requested content ${resource} was not found in this workspace.`,
    retryable: false,
    details: {
      field_path: resource === 'template' ? 'template_id' : 'matrix_id',
      constraint: `must identify an existing content ${resource} in this workspace`,
    },
  });
}

function directContentDomainError(error: unknown): CallToolResult | null {
  if (error instanceof ContentTemplateRevisionConflictError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: error.message,
      retryable: true,
      details: {
        field_path: 'expected_revision',
        constraint: 'must equal the current template revision',
        expected_revision: error.expectedRevision,
        actual_revision: error.actualRevision,
      },
    });
  }
  if (
    error instanceof ContentTemplateRevisionRequiredError
    || error instanceof ContentTemplateGenerationContractError
    || error instanceof ContentTemplateSourceIntegrityError
  ) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
      message: error.message,
      retryable: false,
      details: {
        field_path: error instanceof ContentTemplateRevisionRequiredError
          ? 'expected_revision'
          : 'template',
        constraint: error.message,
      },
    });
  }
  if (error instanceof MatrixTemplateIntegrityError) return directContentNotFoundError('template');
  if (error instanceof ContentMatrixPatternRenderError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: error.message,
      retryable: false,
      details: { field_path: snakeCaseKey(error.field), constraint: error.message },
    });
  }
  if (error instanceof MatrixGenerationSourceLimitError) {
    const issue = error.issues[0];
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: issue
        ? `Invalid ${issue.fieldPath}: value exceeds the ${issue.limit} limit.`
        : error.message,
      retryable: false,
      details: {
        field_path: issue?.fieldPath ?? 'input',
        constraint: issue ? `must not exceed ${issue.limit}` : error.message,
        actual: issue?.actual ?? null,
        limit: issue?.limit ?? null,
      },
    });
  }
  if (error instanceof MatrixGenerationSchemaTypeContractError) {
    const issue = error.issues[0];
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: error.message,
      retryable: false,
      details: {
        field_path: issue?.fieldPath ?? 'expected_schema_types',
        constraint: issue?.code ?? 'schema types must be non-blank, unique, and normalized',
      },
    });
  }
  return null;
}

function readServiceError(error: MatrixReadServiceError): CallToolResult {
  const code = error.code === 'not_found'
    ? MCP_TOOL_ERROR_CODES.NOT_FOUND
    : error.code === 'conflict'
      ? MCP_TOOL_ERROR_CODES.CONFLICT
      : error.code === 'precondition_failed'
        ? MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED
        : MCP_TOOL_ERROR_CODES.VALIDATION_FAILED;
  const message = error.code === 'not_found'
    ? 'The requested matrix resource was not found.'
    : error.code === 'conflict'
      ? 'The matrix source changed. Re-read it and retry with current revisions.'
      : error.code === 'precondition_failed'
        ? 'The matrix operation prerequisites are not satisfied.'
        : 'The cursor is invalid for this query.';
  return mcpJsonV1Error({
    code,
    message,
    retryable: error.code === 'conflict',
    ...(error.details ? { details: error.details } : {}),
  });
}

function upgradeServiceError(error: TemplateGenerationUpgradeError): CallToolResult {
  if (error.code === 'not_found') {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'The requested content template was not found.',
      retryable: false,
    });
  }
  if (error.code === 'conflict') {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The template or upgrade proposal changed. Resolve it again before retrying.',
      retryable: true,
    });
  }
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The template cannot accept this generation upgrade.',
    retryable: false,
  });
}

function generationSourceLimitError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The stored generation source exceeds the bounded generation contract.',
    retryable: false,
  });
}

function pseoBridgeError(error: PseoMatrixBridgeError): CallToolResult {
  const code = error.code === 'not_found'
    ? MCP_TOOL_ERROR_CODES.NOT_FOUND
    : error.code === 'conflict'
      ? MCP_TOOL_ERROR_CODES.CONFLICT
      : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED;
  const message = error.code === 'not_found'
    ? 'The requested pSEO blueprint source was not found.'
    : error.code === 'conflict'
      ? 'The linked pSEO matrix source changed. Re-read the blueprint entry and matrix before retrying.'
      : 'The pSEO plan does not satisfy matrix materialization preflight.';
  return mcpJsonV1Error({
    code,
    message,
    retryable: error.code === 'conflict',
    details: { reason: error.reason },
  });
}

function runPseoPostCommitEffect(
  workspaceId: string,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (error) {
    log.warn({ error, workspaceId, effect }, 'pSEO matrix post-commit effect failed');
  }
}

function unknownToolError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'Unknown content matrix tool: the requested tool does not exist.',
    retryable: false,
  });
}

export function createContentMatrixActionHandler(
  dependencies: ContentMatrixActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'list_content_templates') {
        const parsed = listContentTemplatesInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        return mcpSuccess(toMcpPayload(listTemplateSummaries(
          parsed.data.workspace_id,
          parsed.data.cursor,
          parsed.data.limit,
          dependencies,
        )));
      }

      if (name === 'get_content_template') {
        const parsed = getContentTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.getTemplate(parsed.data.workspace_id, parsed.data.template_id);
        if (!template) return directContentNotFoundError('template');
        return mcpSuccess(toMcpPayload(template));
      }

      if (name === 'create_content_template') {
        const parsed = createContentTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.createTemplate(parsed.data.workspace_id, parsed.data.template);
        runContentPlanPostCommitEffects(
          parsed.data.workspace_id,
          'template_created',
          template,
          dependencies,
        );
        return mcpSuccess(toMcpPayload({ template }));
      }

      if (name === 'update_content_template') {
        const parsed = updateContentTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.updateTemplate(
          parsed.data.workspace_id,
          parsed.data.template_id,
          parsed.data.patch,
          { expectedTemplateRevision: parsed.data.expected_revision },
        );
        if (!template) return directContentNotFoundError('template');
        runContentPlanPostCommitEffects(
          parsed.data.workspace_id,
          'template_updated',
          template,
          dependencies,
        );
        return mcpSuccess(toMcpPayload({ template }));
      }

      if (name === 'duplicate_content_template') {
        const parsed = duplicateContentTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.duplicateTemplate(
          parsed.data.workspace_id,
          parsed.data.template_id,
          parsed.data.new_name,
        );
        if (!template) return directContentNotFoundError('template');
        runContentPlanPostCommitEffects(
          parsed.data.workspace_id,
          'template_duplicated',
          template,
          dependencies,
        );
        return mcpSuccess(toMcpPayload({ template }));
      }

      if (name === 'create_content_matrix') {
        const parsed = createContentMatrixInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.getTemplate(parsed.data.workspace_id, parsed.data.template_id);
        if (!template) return directContentNotFoundError('template');
        const matrix = dependencies.createMatrix(parsed.data.workspace_id, {
          name: parsed.data.name,
          templateId: parsed.data.template_id,
          dimensions: parsed.data.dimensions,
          urlPattern: parsed.data.url_pattern ?? template.urlPattern,
          keywordPattern: parsed.data.keyword_pattern ?? template.keywordPattern,
          expectedSchemaTypes: parsed.data.expected_schema_types,
        }, { validateTemplate: true });
        runContentPlanPostCommitEffects(
          parsed.data.workspace_id,
          'matrix_created',
          matrix,
          dependencies,
        );
        return mcpSuccess(toMcpPayload(projectCreatedMatrix(matrix)));
      }

      if (name === 'list_pseo_blueprint_entries') {
        const parsed = listPseoBlueprintEntriesInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = dependencies.listPseoBlueprintEntries({
          workspaceId: parsed.data.workspace_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'list_content_matrices') {
        const parsed = listContentMatricesInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = dependencies.listContentMatrices({
          workspaceId: parsed.data.workspace_id,
          templateId: parsed.data.template_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'get_content_matrix') {
        const parsed = getContentMatrixInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = dependencies.getContentMatrix({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'resolve_content_matrix_cells') {
        const parsed = resolveContentMatrixCellsInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.resolveMatrixStructures({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
        });
        return mcpSuccess(toMcpPayload(projectResolveResult(result)));
      }

      if (name === 'accept_content_template_generation_upgrade') {
        const parsed = acceptContentTemplateGenerationUpgradeInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = await dependencies.acceptTemplateGenerationUpgrade({
          workspaceId: parsed.data.workspace_id,
          templateId: parsed.data.template_id,
          expectedTemplateRevision: parsed.data.expected_template_revision,
          proposalFingerprint: parsed.data.proposal_fingerprint,
          decision: parsed.data.decision,
          idempotencyKey: parsed.data.idempotency_key,
        });
        if (result.status === 'accepted' && !result.replayed) {
          dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id);
          dependencies.broadcastToWorkspace(
            parsed.data.workspace_id,
            WS_EVENTS.CONTENT_UPDATED,
            {
              domain: 'content-plan',
              templateId: result.template.id,
              action: 'template_generation_upgrade_accepted',
            },
          );
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Upgraded content template "${result.template.name}" for generation`,
            undefined,
            {
              source: 'mcp-chat',
              templateId: result.template.id,
              action: 'template_generation_upgrade_accepted',
            },
          );
        }
        return mcpSuccess(toMcpPayload(projectTemplateUpgradeResult(result)));
      }

      if (name === 'preview_content_matrix_generation') {
        const parsed = previewContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.previewMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
        });
        return mcpSuccess(toMcpPayload(projectPreviewResult(result)));
      }

      if (name === 'resolve_content_matrix_evidence') {
        const parsed = resolveContentMatrixEvidenceInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = await dependencies.resolveContentMatrixEvidence({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          cellId: parsed.data.cell_id,
          requirementId: parsed.data.requirement_id,
          value: parsed.data.value,
          sourceRef: {
            sourceType: parsed.data.source_ref.source_type,
            sourceId: parsed.data.source_ref.source_id,
            sourceRevision: parsed.data.source_ref.source_revision,
            fieldPath: parsed.data.source_ref.field_path,
            label: parsed.data.source_ref.label,
            uri: parsed.data.source_ref.uri,
            capturedAt: parsed.data.source_ref.captured_at,
          },
          resolvedBy: mcpAttribution(context),
          expectedSourceRevision: {
            matrixRevision: parsed.data.expected_source_revision.matrix_revision,
            templateRevision: parsed.data.expected_source_revision.template_revision,
            cellRevision: parsed.data.expected_source_revision.cell_revision,
          },
          expectedArtifactRevisions: {
            brief: {
              artifactType: 'content_brief',
              artifactId: parsed.data.expected_artifact_revisions.brief.artifact_id,
              generationRevision: parsed.data.expected_artifact_revisions.brief.generation_revision,
            },
            post: {
              artifactType: 'generated_post',
              artifactId: parsed.data.expected_artifact_revisions.post.artifact_id,
              generationRevision: parsed.data.expected_artifact_revisions.post.generation_revision,
            },
          },
          idempotencyKey: parsed.data.idempotency_key,
        });
        if (result.created) {
          dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id);
          dependencies.broadcastToWorkspace(
            parsed.data.workspace_id,
            WS_EVENTS.CONTENT_UPDATED,
            {
              domain: 'content-plan',
              matrixId: parsed.data.matrix_id,
              cellId: parsed.data.cell_id,
              requirementId: parsed.data.requirement_id,
              action: 'matrix_generation_evidence_resolved',
            },
          );
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            'Resolved content-matrix generation evidence',
            undefined,
            {
              source: 'mcp-chat',
              matrixId: parsed.data.matrix_id,
              cellId: parsed.data.cell_id,
              requirementId: parsed.data.requirement_id,
              action: 'matrix_generation_evidence_resolved',
            },
          );
        }
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'start_content_matrix_generation') {
        const parsed = startContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
          expectedPreviewFingerprint: selection.expected_preview_fingerprint,
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.startMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
          acceptedBudget: {
            maxProviderCalls: parsed.data.accepted_budget.max_provider_calls,
            maxInputTokens: parsed.data.accepted_budget.max_input_tokens,
            maxOutputTokens: parsed.data.accepted_budget.max_output_tokens,
            maxEstimatedUsd: parsed.data.accepted_budget.max_estimated_usd,
            maxConcurrency: parsed.data.accepted_budget.max_concurrency,
          },
          idempotencyKey: parsed.data.idempotency_key,
          createdBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        if (!result.existing) {
          dependencies.broadcastToWorkspace(parsed.data.workspace_id, WS_EVENTS.CONTENT_UPDATED, {
            domain: 'content-plan',
            matrixId: parsed.data.matrix_id,
            runId: result.run.id,
            action: 'matrix_generation_started',
          });
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Started generation for ${result.run.selections.length} matrix pages`,
            undefined,
            {
              source: 'mcp-chat',
              matrixId: parsed.data.matrix_id,
              runId: result.run.id,
              jobId: result.jobId,
              action: 'matrix_generation_started',
            },
          );
        }
        return paidMatrixCommandSuccess({
          ...result,
          dashboardUrl: `/ws/${encodeURIComponent(parsed.data.workspace_id)}/content-pipeline?tab=planner&matrix=${encodeURIComponent(parsed.data.matrix_id)}&run=${encodeURIComponent(result.run.id)}`,
        }, parsed.data.workspace_id, dependencies);
      }

      if (name === 'get_content_matrix_generation') {
        const parsed = getContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        return mcpSuccess(toMcpPayload(dependencies.getMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        })));
      }

      if (name === 'retry_content_matrix_generation') {
        const parsed = retryContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const items = parsed.data.items.map(item => ({
          itemId: item.item_id,
          expectedItemRevision: item.expected_item_revision,
          sourceRevision: {
            matrixRevision: item.source_revision.matrix_revision,
            templateRevision: item.source_revision.template_revision,
            cellRevision: item.source_revision.cell_revision,
          },
          expectedArtifactRevisions: {
            brief: {
              artifactType: 'content_brief' as const,
              artifactId: item.expected_artifact_revisions.brief.artifact_id,
              generationRevision: item.expected_artifact_revisions.brief.generation_revision,
            },
            post: {
              artifactType: 'generated_post' as const,
              artifactId: item.expected_artifact_revisions.post.artifact_id,
              generationRevision: item.expected_artifact_revisions.post.generation_revision,
            },
          },
          reusableCheckpointFingerprint: item.reusable_checkpoint_fingerprint,
        }));
        const first = items[0];
        if (!first) return validationError();
        const result = dependencies.retryMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          expectedRunRevision: parsed.data.expected_run_revision,
          items: [first, ...items.slice(1)],
          idempotencyKey: parsed.data.idempotency_key,
          mode: 'resume',
          requestedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        if (!result.existing) {
          dependencies.broadcastToWorkspace(parsed.data.workspace_id, WS_EVENTS.CONTENT_UPDATED, {
            domain: 'content-plan',
            runId: parsed.data.run_id,
            action: 'matrix_generation_retry_started',
          });
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Retried ${items.length} matrix generation items`,
            undefined,
            {
              source: 'mcp-chat',
              runId: parsed.data.run_id,
              jobId: result.jobId,
              action: 'matrix_generation_retry_started',
            },
          );
        }
        return paidMatrixCommandSuccess(result, parsed.data.workspace_id, dependencies);
      }

      if (name === 'get_pseo_matrix_plan') {
        const parsed = getPseoMatrixPlanInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        return mcpSuccess(toMcpPayload(await dependencies.getPseoMatrixPlan({
          workspaceId: parsed.data.workspace_id,
          blueprintId: parsed.data.blueprint_id,
          entryId: parsed.data.entry_id,
        })));
      }

      if (name === 'create_content_matrix_from_pseo_plan') {
        const parsed = createContentMatrixFromPseoPlanInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = await dependencies.createMatrixFromPseoPlan({
          workspaceId: parsed.data.workspace_id,
          blueprintId: parsed.data.blueprint_id,
          entryId: parsed.data.entry_id,
          expectedSourceRevision: {
            entryUpdatedAt: parsed.data.expected_source_revision.entry_updated_at,
            templateId: parsed.data.expected_source_revision.template_id,
            templateRevision: parsed.data.expected_source_revision.template_revision,
          },
          dimensions: parsed.data.dimensions.map(dimension => ({
            variableName: dimension.variable_name,
            values: dimension.values,
          })),
        });
        if (!result.replayed) {
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'invalidate-content-pipeline-intelligence',
            () => dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'broadcast-content-updated',
            () => dependencies.broadcastToWorkspace(
              parsed.data.workspace_id,
              WS_EVENTS.CONTENT_UPDATED,
              {
                domain: 'content-plan',
                matrixId: result.matrix.id,
                blueprintId: result.source.blueprintId,
                entryId: result.source.entryId,
                action: 'pseo_matrix_created',
              },
            ),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'broadcast-blueprint-updated',
            () => dependencies.broadcastToWorkspace(
              parsed.data.workspace_id,
              WS_EVENTS.BLUEPRINT_UPDATED,
              {
                blueprintId: result.source.blueprintId,
                entryId: result.source.entryId,
                matrixId: result.matrix.id,
                action: 'entries_updated',
              },
            ),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'record-activity',
            () => {
              dependencies.addActivity(
                parsed.data.workspace_id,
                'content_updated',
                `Created content matrix "${result.matrix.name}" from the page blueprint`,
                `${result.matrix.cellCount} planned page${result.matrix.cellCount === 1 ? '' : 's'}`,
                {
                  source: 'mcp-chat',
                  blueprintId: result.source.blueprintId,
                  entryId: result.source.entryId,
                  matrixId: result.matrix.id,
                  action: 'pseo_matrix_created',
                },
              );
            },
          );
        }
        return mcpSuccess(toMcpPayload(result));
      }

      return unknownToolError();
    } catch (error) {
      const directError = DIRECT_CONTENT_TOOL_NAMES.has(name)
        ? directContentDomainError(error)
        : null;
      if (directError) return directError;
      if (error instanceof MatrixReadServiceError) return readServiceError(error);
      if (error instanceof PseoMatrixBridgeError) return pseoBridgeError(error);
      if (error instanceof TemplateGenerationUpgradeError) return upgradeServiceError(error);
      if (error instanceof MatrixGenerationEvidenceError) {
        return mcpJsonV1Error({
          code: error.code === 'not_found'
            ? MCP_TOOL_ERROR_CODES.NOT_FOUND
            : error.code === 'conflict' || error.code === 'idempotency_conflict'
              ? MCP_TOOL_ERROR_CODES.CONFLICT
              : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
          message: error.message,
          retryable: error.code === 'conflict',
        });
      }
      if (error instanceof MatrixGenerationSourceLimitError) return generationSourceLimitError();
      if (error instanceof MatrixGenerationBatchNotFoundError) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
          message: error.message,
          retryable: false,
        });
      }
      if (error instanceof MatrixGenerationBatchPreconditionError) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
          message: error.message,
          retryable: true,
        });
      }
      if (error instanceof ActiveJobResourceConflict) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.CONFLICT,
          message: error.message,
          retryable: true,
          details: { active_job_id: error.jobId },
        });
      }
      throw error;
    }
  };
}

export const handleContentMatrixActionTool = createContentMatrixActionHandler();
