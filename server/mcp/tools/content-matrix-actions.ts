import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import type {
  ContentMatrix,
  ContentTemplate,
  ContentTemplateLibrarySummary,
} from '../../../shared/types/content.js';
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
  ContentTemplateLibraryError,
  getLibraryTemplate,
  instantiateLibraryTemplate,
  listLibraryTemplates,
  promoteTemplateToLibrary,
} from '../../domains/content/template-library.js';
import {
  ContentMatrixPatternRenderError,
  ContentMatrixSourceIntegrityError,
  createMatrix,
  MatrixCellPlannedUrlError,
  MatrixCellRevisionConflictError,
  MatrixCellRevisionRequiredError,
  MatrixTemplateIntegrityError,
  updateMatrixCell,
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
  updateMatrixCellSchema,
} from '../../routes/content-matrices.js';

const log = createLogger('mcp-content-matrix-actions');
const DIRECT_CONTENT_TOOL_NAMES = new Set([
  'list_content_templates',
  'get_content_template',
  'create_content_template',
  'update_content_template',
  'duplicate_content_template',
  'create_content_matrix',
  'update_content_matrix_cell',
  'list_library_templates',
  'get_library_template',
  'promote_template_to_library',
  'instantiate_library_template',
]);

export const CONTENT_MATRIX_GLOBAL_TOOL_NAMES = [
  'list_library_templates',
  'get_library_template',
  'promote_template_to_library',
  'instantiate_library_template',
] as const;

const workspaceIdSchema = z.string().trim().min(1, 'workspace_id is required')
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes)
  .describe('Workspace that owns the content template or matrix.');
const durableIdSchema = z.string().trim().min(1)
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes);
const templateCursorSchema = z.string().trim().min(1).max(2_048)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor must be an opaque base64url token');
const verticalSchema = z.string().trim().min(1).max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'vertical must be a lowercase slug');

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
  template: createTemplateSchema.describe('Content template fields using the same contract as the admin HTTP create route. Pattern variables use one brace pair, for example /{service}-{city}; do not use {{double_braces}}.'),
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

const listLibraryTemplatesInputSchema = z.object({
  vertical: verticalSchema.optional()
    .describe('Optional flat vertical slug, for example dental or saas.'),
  cursor: templateCursorSchema.optional()
    .describe('Opaque cursor bound to the exact vertical filter and library ordering.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Page size; defaults to ${MATRIX_READ_LIMITS.defaultPageSize} and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
}).strict();

const getLibraryTemplateInputSchema = z.object({
  library_template_id: durableIdSchema.describe('Durable studio library template ID.'),
}).strict();

const promoteTemplateToLibraryInputSchema = z.object({
  source_workspace_id: workspaceIdSchema.describe('Workspace that owns the proven source template.'),
  template_id: durableIdSchema.describe('Durable source content template ID.'),
  expected_template_revision: z.number().int().nonnegative()
    .describe('Exact source template revision returned by get_content_template.'),
  vertical: verticalSchema.describe('Flat studio vertical slug, for example dental or saas.'),
}).strict();

const instantiateLibraryTemplateInputSchema = z.object({
  target_workspace_id: workspaceIdSchema.describe('Existing workspace that will own the independent copy.'),
  library_template_id: durableIdSchema.describe('Durable studio library template ID.'),
  name: z.string().trim().min(1).max(MATRIX_GENERATION_SOURCE_LIMITS.template.maxNameBytes)
    .optional().describe('Optional workspace-specific name for the copied template.'),
}).strict();

const createContentMatrixInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  name: createMatrixFieldsSchema.shape.name.describe('Name for the new matrix.'),
  template_id: createMatrixFieldsSchema.shape.templateId.describe('Existing content template to reuse.'),
  dimensions: z.array(boundedDimensionSchema).min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions)
    .describe('Cartesian dimensions using template variableName values exactly.'),
  url_pattern: createMatrixFieldsSchema.shape.urlPattern.optional()
    .describe('Optional URL pattern; defaults to the selected template pattern. Variables use one brace pair, for example /{service}-{city}.'),
  keyword_pattern: createMatrixFieldsSchema.shape.keywordPattern.optional()
    .describe('Optional keyword pattern; defaults to the selected template pattern. Variables use one brace pair, for example {service} in {city}.'),
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

const updateContentMatrixCellInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  matrix_id: durableIdSchema.describe('Durable content matrix ID.'),
  cell_id: durableIdSchema.describe('Durable matrix cell ID returned by get_content_matrix.'),
  patch: z.object({
    target_keyword: updateMatrixCellSchema.shape.targetKeyword.optional()
      .describe('Exact target keyword for this cell, independent of the matrix keyword pattern.'),
    planned_url: updateMatrixCellSchema.shape.plannedUrl.optional()
      .describe('Safe workspace-relative path for this cell; URL validation and workspace matrix collision checks still apply.'),
    variable_values: updateMatrixCellSchema.shape.variableValues.optional()
      .describe('Complete template-variable values for this cell. Object keys remain exact template variable names.'),
    expected_schema_types: updateMatrixCellSchema.shape.expectedSchemaTypes.optional()
      .describe('Exact schema types expected for this cell.'),
  }).strict().refine(patch => Object.keys(patch).length > 0, {
    message: 'patch must include at least one supported field',
  }).describe('Partial targeting override. Only target_keyword, planned_url, variable_values, and expected_schema_types are patchable.'),
  expected_cell_revision: updateMatrixCellSchema.shape.expectedCellRevision
    .describe('Exact cell revision returned by get_content_matrix.'),
}).strict();

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
    description: 'Create a reusable page structure through the same validated template service used by the admin UI. Mark a section optional only when evidence should decide whether it appears; missing section evidence omits it without blocking the page, and at least one section must remain required. Pattern variables use a single brace pair, for example /{service}-{city}; never use {{double_braces}}. This does not create pages, start AI work, or approve content.',
    inputSchema: toMcpJsonSchema(createContentTemplateInputSchema),
  },
  {
    name: 'update_content_template',
    description: 'Revision-safely update one reusable content template through the existing domain service, including evidence-driven optional section markers. Stale writes conflict; no generation or approval occurs.',
    inputSchema: toMcpJsonSchema(updateContentTemplateInputSchema),
  },
  {
    name: 'duplicate_content_template',
    description: 'Duplicate an existing content template as a starting point for a new locked page structure. Does not alter the source template.',
    inputSchema: toMcpJsonSchema(duplicateContentTemplateInputSchema),
  },
  {
    name: 'list_library_templates',
    description: 'Master-key studio read. List bounded immutable template-library summaries, optionally filtered by one vertical slug. Library templates are studio assets, not workspace-owned generation sources.',
    inputSchema: toMcpJsonSchema(listLibraryTemplatesInputSchema),
  },
  {
    name: 'get_library_template',
    description: 'Master-key studio read. Get one complete immutable library template and its exact source provenance. The snapshot cannot generate content until copied into a workspace.',
    inputSchema: toMcpJsonSchema(getLibraryTemplateInputSchema),
  },
  {
    name: 'promote_template_to_library',
    description: 'Master-key studio action. Call only after the human operator explicitly requests promotion of this exact workspace template revision under this vertical. The immutable snapshot never edits the source, starts generation, approves, sends, or publishes.',
    inputSchema: toMcpJsonSchema(promoteTemplateToLibraryInputSchema),
  },
  {
    name: 'instantiate_library_template',
    description: 'Master-key studio action. Copy one immutable library template into an existing workspace as a normal independently editable template with fresh section IDs. There is no live inheritance or later synchronization. This never starts generation or changes human approval gates.',
    inputSchema: toMcpJsonSchema(instantiateLibraryTemplateInputSchema),
  },
  {
    name: 'create_content_matrix',
    description: 'Create a validated Cartesian content matrix directly from an existing template and explicit dimensions, without requiring Page Strategy or a pSEO blueprint. Pattern variables use a single brace pair, for example /{service}-{city}; never use {{double_braces}}. Uses template URL, keyword, and schema defaults when omitted; never starts generation.',
    inputSchema: toMcpJsonSchema(createContentMatrixInputSchema),
  },
  {
    name: 'update_content_matrix_cell',
    description: 'Revision-safely override one materialized matrix cell when its target keyword, URL, variable values, or schema types cannot follow the shared pattern. URL safety and workspace-wide matrix collision checks remain mandatory. This invalidates prior previews but never starts generation, approves, sends, or publishes.',
    inputSchema: toMcpJsonSchema(updateContentMatrixCellInputSchema),
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
  listLibraryTemplates: typeof listLibraryTemplates;
  getLibraryTemplate: typeof getLibraryTemplate;
  promoteTemplateToLibrary: typeof promoteTemplateToLibrary;
  instantiateLibraryTemplate: typeof instantiateLibraryTemplate;
  createMatrix: typeof createMatrix;
  updateMatrixCell: typeof updateMatrixCell;
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
  listLibraryTemplates,
  getLibraryTemplate,
  promoteTemplateToLibrary,
  instantiateLibraryTemplate,
  createMatrix,
  updateMatrixCell,
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

interface LibraryTemplateListCursor {
  kind: 'library_template_list';
  vertical: string | null;
  createdAt: string;
  libraryTemplateId: string;
}

function encodeLibraryTemplateCursor(cursor: LibraryTemplateListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeLibraryTemplateCursor(
  cursor: string,
  vertical: string | undefined,
): LibraryTemplateListCursor {
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== cursor) throw new Error('invalid');
    const value = parseJsonFallback<Partial<LibraryTemplateListCursor>>(
      decoded.toString('utf8'),
      {},
    );
    if (
      value.kind !== 'library_template_list'
      || value.vertical !== (vertical ?? null)
      || typeof value.createdAt !== 'string'
      || typeof value.libraryTemplateId !== 'string'
    ) throw new Error('invalid');
    return value as LibraryTemplateListCursor;
  } catch (error) {
    log.debug({ error, vertical }, 'Library template cursor validation failed');
    throw new MatrixReadServiceError(
      'invalid_cursor',
      'The library template cursor is invalid.',
      {
        field_path: 'cursor',
        constraint: 'must be an opaque cursor returned by list_library_templates for the same vertical filter',
      },
    );
  }
}

function listLibraryTemplateSummaries(
  vertical: string | undefined,
  cursor: string | undefined,
  requestedLimit: number | undefined,
  dependencies: ContentMatrixActionDependencies,
): { items: ContentTemplateLibrarySummary[]; nextCursor: string | null } {
  const limit = requestedLimit ?? MATRIX_READ_LIMITS.defaultPageSize;
  const decoded = cursor ? decodeLibraryTemplateCursor(cursor, vertical) : undefined;
  const result = dependencies.listLibraryTemplates({
    vertical,
    cursor: decoded ? {
      createdAt: decoded.createdAt,
      id: decoded.libraryTemplateId,
    } : undefined,
    limit,
  });
  const last = result.items.at(-1);
  return {
    items: result.items,
    nextCursor: result.hasMore && last ? encodeLibraryTemplateCursor({
      kind: 'library_template_list',
      vertical: vertical ?? null,
      createdAt: last.createdAt,
      libraryTemplateId: last.id,
    }) : null,
  };
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
  action: 'template_created' | 'template_updated' | 'template_duplicated'
    | 'template_instantiated' | 'matrix_created',
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
          : action === 'template_instantiated'
            ? 'Instantiated studio content template'
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

function directContentCellNotFoundError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'The requested content matrix cell was not found in this workspace matrix.',
    retryable: false,
    details: {
      field_path: 'cell_id',
      constraint: 'must identify an existing cell in the selected workspace matrix',
    },
  });
}

function directContentDomainError(error: unknown): CallToolResult | null {
  if (error instanceof ContentTemplateLibraryError) {
    return mcpJsonV1Error({
      code: error.code === 'not_found'
        ? MCP_TOOL_ERROR_CODES.NOT_FOUND
        : error.code === 'conflict'
          ? MCP_TOOL_ERROR_CODES.CONFLICT
          : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
      message: error.message,
      retryable: error.code === 'conflict',
      details: {
        field_path: error.fieldPath,
        constraint: error.constraint,
        ...(error.actualRevision === undefined
          ? {}
          : { actual_revision: error.actualRevision }),
      },
    });
  }
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
  if (error instanceof MatrixCellRevisionConflictError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The content matrix cell changed since it was read.',
      retryable: true,
      details: {
        field_path: 'expected_cell_revision',
        constraint: 'must equal the current cell revision',
        expected_revision: error.expectedRevision,
        actual_revision: error.actualRevision,
      },
    });
  }
  if (error instanceof MatrixCellRevisionRequiredError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'expected_cell_revision is required for a matrix cell write.',
      retryable: false,
      details: {
        field_path: 'expected_cell_revision',
        constraint: 'is required',
      },
    });
  }
  if (error instanceof MatrixCellPlannedUrlError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: error.message,
      retryable: false,
      details: {
        field_path: 'patch.planned_url',
        constraint: error.code === 'planned_url_collision'
          ? 'must be unique across all content matrix cells in this workspace'
          : `must be a safe workspace-relative path (${error.code})`,
        ...(error.conflictingMatrixId
          ? { conflicting_matrix_id: error.conflictingMatrixId }
          : {}),
        ...(error.conflictingCellId
          ? { conflicting_cell_id: error.conflictingCellId }
          : {}),
      },
    });
  }
  if (error instanceof ContentMatrixSourceIntegrityError) {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
      message: 'The stored content matrix source is malformed and cannot be safely rewritten.',
      retryable: false,
      details: {
        field_path: 'matrix_id',
        constraint: 'must reference a complete valid matrix source',
      },
    });
  }
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

      if (name === 'list_library_templates') {
        const parsed = listLibraryTemplatesInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        return mcpSuccess(toMcpPayload(listLibraryTemplateSummaries(
          parsed.data.vertical,
          parsed.data.cursor,
          parsed.data.limit,
          dependencies,
        )));
      }

      if (name === 'get_library_template') {
        const parsed = getLibraryTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.getLibraryTemplate(parsed.data.library_template_id);
        if (!template) {
          return mcpJsonV1Error({
            code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
            message: 'The requested library template was not found.',
            retryable: false,
            details: {
              field_path: 'library_template_id',
              constraint: 'must identify an existing studio library template',
            },
          });
        }
        return mcpSuccess(toMcpPayload({ template }));
      }

      if (name === 'promote_template_to_library') {
        const parsed = promoteTemplateToLibraryInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const result = dependencies.promoteTemplateToLibrary({
          sourceWorkspaceId: parsed.data.source_workspace_id,
          templateId: parsed.data.template_id,
          expectedTemplateRevision: parsed.data.expected_template_revision,
          vertical: parsed.data.vertical,
        });
        if (!result.replayed) {
          runPseoPostCommitEffect(
            parsed.data.source_workspace_id,
            'record-template-library-promotion',
            () => {
              dependencies.addActivity(
                parsed.data.source_workspace_id,
                'content_updated',
                `Promoted content template "${result.template.name}" to the ${result.template.vertical} studio library`,
                undefined,
                { source: 'mcp-chat', action: 'template_promoted_to_library',
                  templateId: parsed.data.template_id,
                  libraryTemplateId: result.template.id,
                  sourceRevision: parsed.data.expected_template_revision,
                },
              );
            },
          );
        }
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'instantiate_library_template') {
        const parsed = instantiateLibraryTemplateInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const template = dependencies.instantiateLibraryTemplate({
          targetWorkspaceId: parsed.data.target_workspace_id,
          libraryTemplateId: parsed.data.library_template_id,
          name: parsed.data.name,
        });
        runContentPlanPostCommitEffects(
          parsed.data.target_workspace_id,
          'template_instantiated',
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

      if (name === 'update_content_matrix_cell') {
        const parsed = updateContentMatrixCellInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const updates = {
          ...(parsed.data.patch.target_keyword !== undefined
            ? { targetKeyword: parsed.data.patch.target_keyword }
            : {}),
          ...(parsed.data.patch.planned_url !== undefined
            ? { plannedUrl: parsed.data.patch.planned_url }
            : {}),
          ...(parsed.data.patch.variable_values !== undefined
            ? { variableValues: parsed.data.patch.variable_values }
            : {}),
          ...(parsed.data.patch.expected_schema_types !== undefined
            ? { expectedSchemaTypes: parsed.data.patch.expected_schema_types }
            : {}),
        };
        const matrix = dependencies.updateMatrixCell(
          parsed.data.workspace_id,
          parsed.data.matrix_id,
          parsed.data.cell_id,
          updates,
          {
            expectedCellRevision: parsed.data.expected_cell_revision,
            requireExpectedCellRevision: true,
          },
        );
        if (!matrix) return directContentCellNotFoundError();
        const cell = matrix.cells.find(item => item.id === parsed.data.cell_id);
        if (!cell) return directContentCellNotFoundError();
        if ((cell.revision ?? 0) !== parsed.data.expected_cell_revision) {
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
                matrixId: matrix.id,
                cellId: cell.id,
                action: 'matrix_cell_updated',
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
                `Updated content plan page "${cell.targetKeyword}"`,
                undefined,
                {
                  source: 'mcp-chat',
                  matrixId: matrix.id,
                  cellId: cell.id,
                  action: 'matrix_cell_updated',
                  changedFields: Object.keys(parsed.data.patch).sort(),
                },
              );
            },
          );
        }
        return mcpSuccess(toMcpPayload({ matrixId: matrix.id, cell }));
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
