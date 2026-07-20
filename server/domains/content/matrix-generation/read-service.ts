import { z } from 'zod';
import type {
  ContentMatrix,
  ContentTemplate,
  MatrixCell,
} from '../../../../shared/types/content.js';
import {
  assertContentMatrixGenerationSourceWithinLimits,
  assertContentTemplateGenerationSourceWithinLimits,
  assertMatrixGenerationSerializedPayloadWithinLimit,
  MATRIX_READ_LIMITS,
  MATRIX_GENERATION_SOURCE_LIMITS,
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
  matrixGenerationSerializedBytes,
  matrixGenerationUtf8Bytes,
  type ContentMatrixReadMetadata,
  type ContentMatrixReadCell,
  type ContentMatrixSummary,
  type GetContentMatrixRequest,
  type GetContentMatrixResult,
  type ListContentMatricesRequest,
  type ListContentMatricesResult,
  type MatrixSourceRevision,
  type MatrixGenerationSourceLimitIssue,
  type ResolveMatrixStructuresRequest,
  type ResolveMatrixStructuresResult,
} from '../../../../shared/types/matrix-generation.js';
import { getMatrix } from '../../../content-matrices.js';
import { getPublishedPostPagePathCensus } from '../../../content-posts-db.js';
import { getTemplate } from '../../../content-templates.js';
import db from '../../../db/index.js';
import {
  parseJsonFallback,
  parseJsonSafeArray,
} from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { resolveBaseUrl } from '../../../url-helpers.js';
import { normalizePageUrl, tryResolvePagePath } from '../../../utils/page-address.js';
import { discoverSitemapUrls, listPagesWithCompleteness } from '../../../webflow-pages.js';
import { getWorkspace } from '../../../workspaces.js';
import {
  resolveMatrixStructure,
  type ResolveMatrixStructureInput,
} from './resolver.js';
import { canonicalizeMatrixPath } from './renderer.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  getMatrixGenerationSourceCensus,
  matrixGenerationSourceIsComplete,
  type MatrixGenerationSourceCensus,
} from './source-integrity.js';

const CURSOR_VERSION = 1;

type MatrixReadServiceErrorCode =
  | 'not_found'
  | 'invalid_cursor'
  | 'conflict'
  | 'precondition_failed';

export class MatrixReadServiceError extends Error {
  readonly code: MatrixReadServiceErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: MatrixReadServiceErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super(message);
    this.name = 'MatrixReadServiceError';
    this.code = code;
    this.details = details;
  }
}

function asBoundedReadError(error: MatrixGenerationSourceLimitError): MatrixReadServiceError {
  const firstIssue = error.issues[0];
  const responseBudgetExceeded = error.sourceKind === 'matrix_read_page'
    || error.sourceKind === 'matrix_resolve_response';
  return new MatrixReadServiceError(
    'precondition_failed',
    responseBudgetExceeded
      ? 'The matrix response exceeds the MCP response budget. Request a smaller page or fewer cells.'
      : 'Stored matrix generation sources exceed the bounded generation contract.',
    {
      sourceKind: error.sourceKind,
      fieldPath: firstIssue?.fieldPath ?? null,
      actual: firstIssue?.actual ?? null,
      limit: firstIssue?.limit ?? null,
    },
  );
}

function asSchemaTypeReadError(error: MatrixGenerationSchemaTypeContractError): MatrixReadServiceError {
  return new MatrixReadServiceError(
    'precondition_failed',
    'Stored matrix generation schema types are blank, duplicated, or unnormalized.',
    { fieldPath: error.issues[0]?.fieldPath ?? null },
  );
}

function assertBoundedMatrix(matrix: ContentMatrix): void {
  try {
    assertContentMatrixGenerationSourceWithinLimits(matrix);
  } catch (error) {
    if (error instanceof MatrixGenerationSourceLimitError) throw asBoundedReadError(error);
    if (error instanceof MatrixGenerationSchemaTypeContractError) throw asSchemaTypeReadError(error);
    throw error;
  }
}

function assertBoundedTemplate(template: ContentTemplate | null): void {
  if (!template) return;
  try {
    assertContentTemplateGenerationSourceWithinLimits(template);
  } catch (error) {
    if (error instanceof MatrixGenerationSourceLimitError) throw asBoundedReadError(error);
    if (error instanceof MatrixGenerationSchemaTypeContractError) throw asSchemaTypeReadError(error);
    throw error;
  }
}

function readBoundedTemplate(read: () => ContentTemplate | null): ContentTemplate | null {
  try {
    const template = read();
    assertBoundedTemplate(template);
    return template;
  } catch (error) {
    if (error instanceof MatrixGenerationSourceLimitError) throw asBoundedReadError(error);
    if (error instanceof MatrixGenerationSchemaTypeContractError) throw asSchemaTypeReadError(error);
    throw error;
  }
}

function assertBoundedReadPayload(
  sourceKind: 'matrix_summary' | 'matrix_read_page' | 'matrix_resolve_response',
  fieldPath: string,
  value: unknown,
  limit: number,
): void {
  try {
    assertMatrixGenerationSerializedPayloadWithinLimit(sourceKind, fieldPath, value, limit);
  } catch (error) {
    if (error instanceof MatrixGenerationSourceLimitError) throw asBoundedReadError(error);
    throw error;
  }
}

interface MatrixListCursor {
  version: typeof CURSOR_VERSION;
  kind: 'matrix_list';
  workspaceId: string;
  templateId: string | null;
  updatedAt: string;
  matrixId: string;
}

interface MatrixCellCursor {
  version: typeof CURSOR_VERSION;
  kind: 'matrix_cells';
  matrixId: string;
  matrixRevision: number;
  cellSnapshotFingerprint: string;
  offset: number;
}

type MatrixCursor = MatrixListCursor | MatrixCellCursor;

interface WorkspaceReadIdentity {
  id: string;
}

interface MatrixSummaryRow {
  id: string | null;
  workspace_id: string | null;
  revision: number;
  name: string | null;
  template_id: string | null;
  template_revision: number;
  dimension_count: number;
  url_pattern: string | null;
  keyword_pattern: string | null;
  stats_total: number;
  stats_planned: number;
  stats_brief_generated: number;
  stats_drafted: number;
  stats_reviewed: number;
  stats_published: number;
  cell_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface ListMatrixSummariesQuery {
  workspaceId: string;
  templateId?: string;
  after?: Pick<MatrixListCursor, 'updatedAt' | 'matrixId'>;
  /** Repository limit includes the one-row lookahead. */
  limit: number;
}

interface WorkspaceMatrixPlannedUrl {
  matrixId: string;
  cellId: string;
  plannedUrl: string;
}

interface WorkspaceMatrixCellsRow {
  matrix_id: string | null;
  cells: string | null;
  cells_bytes: number;
}

interface WorkspaceMatrixCensusBoundsRow {
  item_count: number;
  aggregate_bytes: number;
}

interface WorkspaceMatrixCensusShapeRow {
  invalid_array_count: number;
  cell_count: number;
}

interface PublishedPostCensusBoundsRow {
  item_count: number;
  aggregate_bytes: number;
}

interface RawGenerationSourceLengthsRow {
  matrix_name_bytes: number;
  matrix_template_id_bytes: number;
  matrix_url_pattern_bytes: number;
  matrix_keyword_pattern_bytes: number;
  matrix_dimensions_bytes: number;
  matrix_cells_bytes: number;
  template_exists: number;
  template_source_bytes: number;
}

interface RawGenerationSourceShapeRow {
  matrix_dimensions_valid: number;
  matrix_dimension_count: number;
  matrix_cells_valid: number;
  matrix_cell_count: number;
  template_exists: number;
  template_variables_valid: number;
  template_variable_count: number;
  template_sections_valid: number;
  template_section_count: number;
  template_schema_types_valid: number;
  template_schema_type_count: number;
  template_cms_field_map_valid: number;
  template_cms_field_count: number;
}

interface WorkspaceMatrixUrlCensus {
  items: WorkspaceMatrixPlannedUrl[];
  complete: boolean;
}

export interface WorkspaceKnownPageCensus {
  paths: string[];
  publishedSlugs: string[];
  complete: boolean;
}

export interface ResolveMatrixStructuresWithCensusResult {
  result: ResolveMatrixStructuresResult;
  pageCensus: WorkspaceKnownPageCensus;
}

export interface WorkspaceKnownPageCensusExternalDependencies {
  getWorkspace: typeof getWorkspace;
  listPagesWithCompleteness: typeof listPagesWithCompleteness;
  resolveBaseUrl: typeof resolveBaseUrl;
  discoverSitemapUrls: typeof discoverSitemapUrls;
}

export interface ContentMatrixReadServiceDependencies {
  getWorkspace(workspaceId: string): WorkspaceReadIdentity | null | undefined;
  /** Test/compatibility seam. Production uses listMatrixSummaries and never hydrates cells. */
  listMatrices?(workspaceId: string): ContentMatrix[];
  listMatrixSummaries?(query: ListMatrixSummariesQuery): ContentMatrixSummary[];
  getMatrix(workspaceId: string, matrixId: string): ContentMatrix | undefined;
  getTemplate(workspaceId: string, templateId: string): ContentTemplate | null;
  /** Production raw-column preflight; runs before JSON hydration. */
  assertRawGenerationSourceBounds?(workspaceId: string, matrixId: string): void;
  getGenerationSourceCensus(
    workspaceId: string,
    matrixId: string,
  ): MatrixGenerationSourceCensus | null;
  getKnownWorkspacePageCensus(workspaceId: string): Promise<WorkspaceKnownPageCensus>;
  getOtherWorkspaceMatrixPlannedUrls(
    workspaceId: string,
    matrixId: string,
  ): WorkspaceMatrixUrlCensus;
  listCurrentEvidenceRequirementIds?(
    workspaceId: string,
    matrixId: string,
    cellId: string,
    templateRevision: number,
  ): string[];
  resolveMatrixStructure(input: ResolveMatrixStructureInput): ReturnType<typeof resolveMatrixStructure>;
}

const matrixUrlCensusCellSchema = z.object({
  id: z.string().trim().min(1),
  plannedUrl: z.string().trim().min(1),
});

const readStmts = createStmtCache(() => ({
  listSummaries: db.prepare(`
    SELECT
      CASE WHEN length(CAST(matrix.id AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxIdBytes}
        THEN matrix.id ELSE NULL END AS id,
      CASE WHEN length(CAST(matrix.workspace_id AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxIdBytes}
        THEN matrix.workspace_id ELSE NULL END AS workspace_id,
      matrix.revision,
      CASE WHEN length(CAST(matrix.name AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxNameBytes}
        THEN matrix.name ELSE NULL END AS name,
      CASE WHEN length(CAST(matrix.template_id AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes}
        THEN matrix.template_id ELSE NULL END AS template_id,
      COALESCE(template.revision, 0) AS template_revision,
      CASE WHEN length(CAST(matrix.dimensions AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxSerializedDefinitionBytes}
        THEN CASE WHEN json_valid(matrix.dimensions) AND json_type(matrix.dimensions) = 'array'
          THEN json_array_length(matrix.dimensions) ELSE -1 END
        ELSE -1
      END AS dimension_count,
      CASE WHEN length(CAST(matrix.url_pattern AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes}
        THEN matrix.url_pattern ELSE NULL END AS url_pattern,
      CASE WHEN length(CAST(matrix.keyword_pattern AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes}
        THEN matrix.keyword_pattern ELSE NULL END AS keyword_pattern,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.total'), -1) ELSE -1 END ELSE -1 END AS stats_total,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.planned'), -1) ELSE -1 END ELSE -1 END AS stats_planned,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.briefGenerated'), -1) ELSE -1 END ELSE -1 END AS stats_brief_generated,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.drafted'), -1) ELSE -1 END ELSE -1 END AS stats_drafted,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.reviewed'), -1) ELSE -1 END ELSE -1 END AS stats_reviewed,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.published'), -1) ELSE -1 END ELSE -1 END AS stats_published,
      CASE WHEN length(CAST(matrix.stats AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.read.maxStoredStatsBytes}
        THEN CASE WHEN json_valid(matrix.stats) AND json_type(matrix.stats) = 'object'
          THEN COALESCE(json_extract(matrix.stats, '$.total'), -1) ELSE -1 END ELSE -1 END AS cell_count,
      CASE WHEN length(CAST(matrix.created_at AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxTimestampBytes}
        THEN matrix.created_at ELSE NULL END AS created_at,
      CASE WHEN length(CAST(matrix.updated_at AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxTimestampBytes}
        THEN matrix.updated_at ELSE NULL END AS updated_at
    FROM content_matrices matrix
    LEFT JOIN content_templates template
      ON template.id = matrix.template_id
     AND template.workspace_id = matrix.workspace_id
    WHERE matrix.workspace_id = @workspace_id
      AND (@template_id IS NULL OR matrix.template_id = @template_id)
      AND (
        @cursor_updated_at IS NULL
        OR matrix.updated_at < @cursor_updated_at
        OR (matrix.updated_at = @cursor_updated_at AND matrix.id > @cursor_matrix_id)
      )
    ORDER BY matrix.updated_at DESC, matrix.id ASC
    LIMIT @limit
  `),
  knownPagePaths: db.prepare(`
    SELECT CASE WHEN length(CAST(page_path AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxPlannedUrlBytes}
      THEN page_path ELSE NULL END AS page_path
    FROM (
    SELECT page_path
      FROM page_keywords
     WHERE workspace_id = ?
       AND page_path <> ''
    UNION
    SELECT page_path
      FROM page_elements
     WHERE workspace_id = ?
       AND page_path <> ''
    ) known_paths
    ORDER BY page_path ASC
    LIMIT ${MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths}
  `),
  knownPagePathCensusBounds: db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(length(CAST(page_path AS BLOB))), 0) AS aggregate_bytes
    FROM (
      SELECT page_path
        FROM page_keywords
       WHERE workspace_id = ?
         AND page_path <> ''
      UNION
      SELECT page_path
        FROM page_elements
       WHERE workspace_id = ?
         AND page_path <> ''
    ) known_paths
  `),
  otherMatrixCells: db.prepare(`
    SELECT
      CASE WHEN length(CAST(matrix.id AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.cell.maxIdBytes}
        THEN matrix.id ELSE NULL END AS matrix_id,
      CASE WHEN length(CAST(matrix.cells AS BLOB)) <= ${MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes}
        THEN matrix.cells ELSE NULL END AS cells,
      length(CAST(matrix.cells AS BLOB)) AS cells_bytes
    FROM content_matrices matrix
    WHERE matrix.workspace_id = @workspace_id
      AND matrix.id <> @matrix_id
    ORDER BY matrix.id ASC
    LIMIT ${MATRIX_GENERATION_SOURCE_LIMITS.census.maxOtherMatrices}
  `),
  otherMatrixCensusBounds: db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(length(CAST(matrix.cells AS BLOB))), 0) AS aggregate_bytes
    FROM content_matrices matrix
    WHERE matrix.workspace_id = @workspace_id
      AND matrix.id <> @matrix_id
  `),
  otherMatrixCensusShape: db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN json_valid(matrix.cells) AND json_type(matrix.cells) = 'array' THEN 0
        ELSE 1
      END), 0) AS invalid_array_count,
      COALESCE(SUM(CASE
        WHEN json_valid(matrix.cells) AND json_type(matrix.cells) = 'array'
          THEN json_array_length(matrix.cells)
        ELSE 0
      END), 0) AS cell_count
    FROM content_matrices matrix
    WHERE matrix.workspace_id = @workspace_id
      AND matrix.id <> @matrix_id
  `),
  publishedPostCensusBounds: db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(length(CAST(COALESCE(published_slug, '') AS BLOB))), 0) AS aggregate_bytes
    FROM content_posts
    WHERE workspace_id = ?
      AND (published_at IS NOT NULL OR webflow_item_id IS NOT NULL)
  `),
  rawGenerationSourceLengths: db.prepare(`
    SELECT
      length(CAST(matrix.name AS BLOB)) AS matrix_name_bytes,
      length(CAST(matrix.template_id AS BLOB)) AS matrix_template_id_bytes,
      length(CAST(matrix.url_pattern AS BLOB)) AS matrix_url_pattern_bytes,
      length(CAST(matrix.keyword_pattern AS BLOB)) AS matrix_keyword_pattern_bytes,
      length(CAST(matrix.dimensions AS BLOB)) AS matrix_dimensions_bytes,
      length(CAST(matrix.cells AS BLOB)) AS matrix_cells_bytes,
      CASE WHEN template.id IS NULL THEN 0 ELSE 1 END AS template_exists,
      CASE WHEN template.id IS NULL THEN 0 ELSE
        length(CAST(template.name AS BLOB))
        + length(CAST(COALESCE(template.description, '') AS BLOB))
        + length(CAST(template.variables AS BLOB))
        + length(CAST(template.sections AS BLOB))
        + length(CAST(template.url_pattern AS BLOB))
        + length(CAST(template.keyword_pattern AS BLOB))
        + length(CAST(COALESCE(template.title_pattern, '') AS BLOB))
        + length(CAST(COALESCE(template.meta_desc_pattern, '') AS BLOB))
        + length(CAST(COALESCE(template.cms_field_map, '') AS BLOB))
        + length(CAST(COALESCE(template.tone_and_style, '') AS BLOB))
        + length(CAST(COALESCE(template.schema_types, '') AS BLOB))
      END AS template_source_bytes
    FROM content_matrices matrix
    LEFT JOIN content_templates template
      ON template.id = matrix.template_id
     AND template.workspace_id = matrix.workspace_id
    WHERE matrix.workspace_id = ?
      AND matrix.id = ?
  `),
  rawGenerationSourceShape: db.prepare(`
    SELECT
      CASE WHEN json_valid(matrix.dimensions) AND json_type(matrix.dimensions) = 'array' THEN 1 ELSE 0 END AS matrix_dimensions_valid,
      CASE WHEN json_valid(matrix.dimensions) AND json_type(matrix.dimensions) = 'array' THEN json_array_length(matrix.dimensions) ELSE 0 END AS matrix_dimension_count,
      CASE WHEN json_valid(matrix.cells) AND json_type(matrix.cells) = 'array' THEN 1 ELSE 0 END AS matrix_cells_valid,
      CASE WHEN json_valid(matrix.cells) AND json_type(matrix.cells) = 'array' THEN json_array_length(matrix.cells) ELSE 0 END AS matrix_cell_count,
      CASE WHEN template.id IS NULL THEN 0 ELSE 1 END AS template_exists,
      CASE WHEN template.id IS NOT NULL AND json_valid(template.variables) AND json_type(template.variables) = 'array' THEN 1 ELSE 0 END AS template_variables_valid,
      CASE WHEN template.id IS NOT NULL AND json_valid(template.variables) AND json_type(template.variables) = 'array' THEN json_array_length(template.variables) ELSE 0 END AS template_variable_count,
      CASE WHEN template.id IS NOT NULL AND json_valid(template.sections) AND json_type(template.sections) = 'array' THEN 1 ELSE 0 END AS template_sections_valid,
      CASE WHEN template.id IS NOT NULL AND json_valid(template.sections) AND json_type(template.sections) = 'array' THEN json_array_length(template.sections) ELSE 0 END AS template_section_count,
      CASE WHEN template.schema_types IS NULL OR (json_valid(template.schema_types) AND json_type(template.schema_types) = 'array') THEN 1 ELSE 0 END AS template_schema_types_valid,
      CASE WHEN template.schema_types IS NOT NULL AND json_valid(template.schema_types) AND json_type(template.schema_types) = 'array' THEN json_array_length(template.schema_types) ELSE 0 END AS template_schema_type_count,
      CASE WHEN template.cms_field_map IS NULL OR (json_valid(template.cms_field_map) AND json_type(template.cms_field_map) = 'object') THEN 1 ELSE 0 END AS template_cms_field_map_valid,
      CASE WHEN template.cms_field_map IS NOT NULL AND json_valid(template.cms_field_map) AND json_type(template.cms_field_map) = 'object'
        THEN (SELECT COUNT(*) FROM json_each(template.cms_field_map)) ELSE 0 END AS template_cms_field_count
    FROM content_matrices matrix
    LEFT JOIN content_templates template
      ON template.id = matrix.template_id
     AND template.workspace_id = matrix.workspace_id
    WHERE matrix.workspace_id = ?
      AND matrix.id = ?
  `),
  listCurrentEvidenceRequirementIds: db.prepare(`
    SELECT requirement_id
    FROM content_matrix_cell_evidence
    WHERE workspace_id = ? AND matrix_id = ? AND cell_id = ?
      AND template_revision = ? AND is_current = 1
    ORDER BY requirement_id
  `),
}));

function listCurrentEvidenceRequirementIds(
  workspaceId: string,
  matrixId: string,
  cellId: string,
  templateRevision: number,
): string[] {
  return (readStmts().listCurrentEvidenceRequirementIds.all(
    workspaceId,
    matrixId,
    cellId,
    templateRevision,
  ) as Array<{ requirement_id: string }>).map(row => row.requirement_id);
}

function rowToMatrixSummary(row: MatrixSummaryRow): ContentMatrixSummary {
  const scalarFieldsAreBounded = row.id !== null
    && row.workspace_id !== null
    && row.name !== null
    && row.template_id !== null
    && row.url_pattern !== null
    && row.keyword_pattern !== null
    && row.created_at !== null
    && row.updated_at !== null;
  const counts = [
    row.dimension_count,
    row.cell_count,
    row.stats_total,
    row.stats_planned,
    row.stats_brief_generated,
    row.stats_drafted,
    row.stats_reviewed,
    row.stats_published,
  ];
  if (!scalarFieldsAreBounded || counts.some(value => !Number.isInteger(value) || value < 0)) {
    throw new MatrixReadServiceError(
      'precondition_failed',
      'Stored matrix summary fields exceed the bounded read contract.',
    );
  }
  const summary: ContentMatrixSummary = {
    id: row.id!,
    workspaceId: row.workspace_id!,
    revision: row.revision ?? 0,
    name: row.name!,
    templateId: row.template_id!,
    templateRevision: row.template_revision ?? 0,
    dimensionCount: row.dimension_count,
    urlPattern: row.url_pattern!,
    keywordPattern: row.keyword_pattern!,
    stats: {
      total: row.stats_total,
      planned: row.stats_planned,
      briefGenerated: row.stats_brief_generated,
      drafted: row.stats_drafted,
      reviewed: row.stats_reviewed,
      published: row.stats_published,
    },
    cellCount: row.cell_count,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
  assertBoundedMatrixSummary(summary);
  return summary;
}

function assertBoundedMatrixSummary(summary: ContentMatrixSummary): void {
  const matrixLimits = MATRIX_GENERATION_SOURCE_LIMITS.matrix;
  const issues = [
    ['name', matrixGenerationUtf8Bytes(summary.name), matrixLimits.maxNameBytes],
    ['templateId', matrixGenerationUtf8Bytes(summary.templateId), matrixLimits.maxTemplateIdBytes],
    ['urlPattern', matrixGenerationUtf8Bytes(summary.urlPattern), matrixLimits.maxPatternBytes],
    ['keywordPattern', matrixGenerationUtf8Bytes(summary.keywordPattern), matrixLimits.maxPatternBytes],
  ] as const;
  const stringIssue = issues.find(([, actual, limit]) => actual > limit);
  if (stringIssue) {
    throw asBoundedReadError(new MatrixGenerationSourceLimitError('matrix_summary', [{
      code: 'string_bytes_exceeded',
      fieldPath: stringIssue[0],
      actual: stringIssue[1],
      limit: stringIssue[2],
    }]));
  }
  if (summary.dimensionCount > matrixLimits.maxDimensions) {
    throw asBoundedReadError(new MatrixGenerationSourceLimitError('matrix_summary', [{
      code: 'array_items_exceeded',
      fieldPath: 'dimensionCount',
      actual: summary.dimensionCount,
      limit: matrixLimits.maxDimensions,
    }]));
  }
  if (summary.cellCount > matrixLimits.maxGeneratedCells) {
    throw asBoundedReadError(new MatrixGenerationSourceLimitError('matrix_summary', [{
      code: 'array_items_exceeded',
      fieldPath: 'cellCount',
      actual: summary.cellCount,
      limit: matrixLimits.maxGeneratedCells,
    }]));
  }
  assertBoundedReadPayload(
    'matrix_summary',
    'summary',
    summary,
    MATRIX_GENERATION_SOURCE_LIMITS.read.maxSummaryBytes,
  );
}

function listMatrixSummaries(query: ListMatrixSummariesQuery): ContentMatrixSummary[] {
  const rows = readStmts().listSummaries.all({
    workspace_id: query.workspaceId,
    template_id: query.templateId ?? null,
    cursor_updated_at: query.after?.updatedAt ?? null,
    cursor_matrix_id: query.after?.matrixId ?? null,
    limit: query.limit,
  }) as MatrixSummaryRow[];
  return rows.map(rowToMatrixSummary);
}

function encodeCursor(cursor: MatrixCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== cursor) {
      throw new Error('non-canonical cursor');
    }
    const parsed = parseJsonFallback<unknown>(decoded.toString('utf8'), null);
    if (!isRecord(parsed)) throw new Error('cursor payload is not an object');
    return parsed;
  } catch { // catch-ok - malformed opaque cursor input is a normal validation failure.
    throw new MatrixReadServiceError(
      'invalid_cursor',
      'The cursor is invalid. Start again without a cursor.',
    );
  }
}

function decodeMatrixListCursor(
  cursor: string,
  workspaceId: string,
  templateId: string | undefined,
): MatrixListCursor {
  const parsed = decodeCursor(cursor);
  const expectedTemplateId = templateId ?? null;
  if (
    parsed.version !== CURSOR_VERSION
    || parsed.kind !== 'matrix_list'
    || parsed.workspaceId !== workspaceId
    || parsed.templateId !== expectedTemplateId
    || typeof parsed.updatedAt !== 'string'
    || parsed.updatedAt.length === 0
    || typeof parsed.matrixId !== 'string'
    || parsed.matrixId.length === 0
  ) {
    throw new MatrixReadServiceError(
      'invalid_cursor',
      'The cursor does not belong to this matrix list query.',
    );
  }
  return {
    version: CURSOR_VERSION,
    kind: 'matrix_list',
    workspaceId,
    templateId: expectedTemplateId,
    updatedAt: parsed.updatedAt,
    matrixId: parsed.matrixId,
  };
}

function decodeMatrixCellCursor(
  cursor: string,
  matrixId: string,
  matrixRevision: number,
  cellSnapshotFingerprint: string,
): MatrixCellCursor {
  const parsed = decodeCursor(cursor);
  if (
    parsed.version !== CURSOR_VERSION
    || parsed.kind !== 'matrix_cells'
    || parsed.matrixId !== matrixId
    || typeof parsed.matrixRevision !== 'number'
    || !Number.isInteger(parsed.matrixRevision)
    || typeof parsed.cellSnapshotFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.cellSnapshotFingerprint)
    || typeof parsed.offset !== 'number'
    || !Number.isInteger(parsed.offset)
    || parsed.offset < 0
  ) {
    throw new MatrixReadServiceError(
      'invalid_cursor',
      'The cursor does not belong to this matrix cell query.',
    );
  }
  if (
    parsed.matrixRevision !== matrixRevision
    || parsed.cellSnapshotFingerprint !== cellSnapshotFingerprint
  ) {
    throw new MatrixReadServiceError(
      'conflict',
      'The matrix cells changed after this cursor was issued. Re-read the matrix from the first page.',
      { expectedRevision: parsed.matrixRevision, currentRevision: matrixRevision },
    );
  }
  return {
    version: CURSOR_VERSION,
    kind: 'matrix_cells',
    matrixId,
    matrixRevision,
    cellSnapshotFingerprint,
    offset: parsed.offset,
  };
}

function pageSize(limit: number | undefined): number {
  const resolved = limit ?? MATRIX_READ_LIMITS.defaultPageSize;
  if (
    !Number.isInteger(resolved)
    || resolved < 1
    || resolved > MATRIX_READ_LIMITS.maxPageSize
  ) {
    throw new MatrixReadServiceError(
      'precondition_failed',
      `Page size must be between 1 and ${MATRIX_READ_LIMITS.maxPageSize}.`,
    );
  }
  return resolved;
}

function assertResolveSelections(
  selections: ResolveMatrixStructuresRequest['selections'],
): void {
  if (
    !Array.isArray(selections)
    || selections.length < 1
    || selections.length > MATRIX_READ_LIMITS.maxResolveSelection
  ) {
    throw new MatrixReadServiceError(
      'precondition_failed',
      `Structural resolution requires 1 to ${MATRIX_READ_LIMITS.maxResolveSelection} cells.`,
    );
  }
  const cellIds = new Set<string>();
  for (const selection of selections as readonly unknown[]) {
    if (
      !isRecord(selection)
      || typeof selection.cellId !== 'string'
      || selection.cellId.trim().length === 0
    ) {
      throw new MatrixReadServiceError(
        'precondition_failed',
        'Structural resolution requires durable non-empty cell IDs.',
      );
    }
    if (cellIds.has(selection.cellId)) {
      throw new MatrixReadServiceError(
        'precondition_failed',
        'Structural resolution requires unique cell IDs.',
      );
    }
    cellIds.add(selection.cellId);
  }
}

type RevisionedContentMatrix = Omit<ContentMatrix, 'revision' | 'cells'> & {
  revision: number;
  cells: ContentMatrixReadCell[];
};

function normalizedMatrix(matrix: ContentMatrix): RevisionedContentMatrix {
  return {
    ...matrix,
    revision: matrix.revision ?? 0,
    cells: matrix.cells.map(item => ({ ...item, revision: item.revision ?? 0 })),
  };
}

function matrixMetadata(matrix: ContentMatrix): ContentMatrixReadMetadata {
  const normalized = normalizedMatrix(matrix);
  const { cells, ...metadata } = normalized;
  return { ...metadata, cellCount: cells.length };
}

function matrixSummary(
  matrix: ContentMatrix,
  template: ContentTemplate | null,
): ContentMatrixSummary {
  const { dimensions, ...metadata } = matrixMetadata(matrix);
  return {
    ...metadata,
    dimensionCount: dimensions.length,
    templateRevision: template?.revision ?? 0,
  };
}

function compareMatrices(left: ContentMatrix, right: ContentMatrix): number {
  const timestampOrder = right.updatedAt.localeCompare(left.updatedAt);
  return timestampOrder !== 0 ? timestampOrder : left.id.localeCompare(right.id);
}

function isAfterListCursor(matrix: ContentMatrix, cursor: MatrixListCursor): boolean {
  return matrix.updatedAt < cursor.updatedAt
    || (matrix.updatedAt === cursor.updatedAt && matrix.id > cursor.matrixId);
}

function sourceRevision(matrix: ContentMatrix, template: ContentTemplate | null, cell: MatrixCell): MatrixSourceRevision {
  return {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: template?.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
}

function generationSnapshotFingerprint(
  matrix: RevisionedContentMatrix,
  template: ContentTemplate | null,
  selections: ResolveMatrixStructuresRequest['selections'],
): string {
  const selectedCells = selections.map((selection) => {
    const cell = matrix.cells.find(item => item.id === selection.cellId);
    return cell
      ? {
          id: cell.id,
          revision: cell.revision,
          variableValues: cell.variableValues,
          targetKeyword: cell.targetKeyword,
          customKeyword: cell.customKeyword,
          recommendedKeyword: cell.recommendedKeyword,
          plannedUrl: cell.plannedUrl,
          keywordValidation: cell.keywordValidation,
          expectedSchemaTypes: cell.expectedSchemaTypes,
        }
      : { id: selection.cellId, missing: true };
  });
  return canonicalGenerationFingerprint({
    matrix: {
      revision: matrix.revision,
      templateId: matrix.templateId,
      dimensions: matrix.dimensions,
      urlPattern: matrix.urlPattern,
      keywordPattern: matrix.keywordPattern,
    },
    selectedCells,
    template: template
      ? {
          revision: template.revision ?? 0,
          pageType: template.pageType,
          variables: template.variables,
          sections: template.sections,
          urlPattern: template.urlPattern,
          keywordPattern: template.keywordPattern,
          titlePattern: template.titlePattern,
          metaDescPattern: template.metaDescPattern,
          cmsFieldMap: template.cmsFieldMap,
          toneAndStyle: template.toneAndStyle,
          schemaTypes: template.schemaTypes,
          generationContractVersion: template.generationContractVersion,
        }
      : null,
  });
}

function validateSelectionSnapshot(
  matrix: RevisionedContentMatrix,
  template: ContentTemplate | null,
  selections: ResolveMatrixStructuresRequest['selections'],
): Map<string, ContentMatrixReadCell> {
  const cellsById = new Map(matrix.cells.map(cell => [cell.id, cell]));
  for (const selection of selections) {
    const selectedCell = cellsById.get(selection.cellId);
    if (!selectedCell) {
      throw new MatrixReadServiceError('not_found', 'Content matrix cell not found.');
    }
    assertSourceRevision(
      selection.expectedSourceRevision,
      sourceRevision(matrix, template, selectedCell),
    );
  }
  return cellsById;
}

function assertSourceRevision(
  expected: MatrixSourceRevision,
  current: MatrixSourceRevision,
): void {
  if (
    expected.matrixRevision !== current.matrixRevision
    || expected.templateRevision !== current.templateRevision
    || expected.cellRevision !== current.cellRevision
  ) {
    throw new MatrixReadServiceError(
      'conflict',
      'The matrix source changed. Re-read the matrix and resolve the cell again.',
      {
        expectedMatrixRevision: expected.matrixRevision,
        currentMatrixRevision: current.matrixRevision,
        expectedTemplateRevision: expected.templateRevision,
        currentTemplateRevision: current.templateRevision,
        expectedCellRevision: expected.cellRevision,
        currentCellRevision: current.cellRevision,
      },
    );
  }
}

const defaultWorkspaceKnownPageCensusExternalDependencies: WorkspaceKnownPageCensusExternalDependencies = {
  getWorkspace,
  listPagesWithCompleteness,
  resolveBaseUrl,
  discoverSitemapUrls,
};

function canonicalSiteHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export async function buildKnownWorkspacePageCensus(
  workspaceId: string,
  externalDependencies: WorkspaceKnownPageCensusExternalDependencies = defaultWorkspaceKnownPageCensusExternalDependencies,
): Promise<WorkspaceKnownPageCensus> {
  const limits = MATRIX_GENERATION_SOURCE_LIMITS.census;
  const paths = new Set<string>();
  const publishedSlugs: string[] = [];
  const workspace = externalDependencies.getWorkspace(workspaceId);
  let complete = workspace != null;
  let aggregatePathBytes = 0;
  let sitemapPaths: Set<string> | null = null;
  let sitemapPathsByLeaf: Map<string, string[]> | null = null;

  const addKnownPath = (value: string): string | null => {
    const canonicalPath = canonicalizeMatrixPath(value);
    if (canonicalPath === null) {
      complete = false;
      return null;
    }
    if (paths.has(canonicalPath)) return canonicalPath;
    const pathBytes = matrixGenerationUtf8Bytes(canonicalPath);
    if (
      paths.size >= limits.maxWorkspacePaths
      || aggregatePathBytes + pathBytes > limits.maxAggregatePathBytes
    ) {
      complete = false;
      return null;
    }
    paths.add(canonicalPath);
    aggregatePathBytes += pathBytes;
    return canonicalPath;
  };

  if (workspace?.webflowSiteId) {
    try {
      const livePageCensus = await externalDependencies.listPagesWithCompleteness(
        workspace.webflowSiteId,
        workspace.webflowToken,
        { maxPages: limits.maxWebflowPages },
      );
      // A configured Webflow site always has at least its homepage. Fresh page
      // discovery must also report that every advertised page was retrieved;
      // cached stale-on-error data is deliberately not accepted here.
      if (
        !livePageCensus.complete
        || livePageCensus.pages.length === 0
        || livePageCensus.pages.length > limits.maxWebflowPages
      ) complete = false;
      for (const page of livePageCensus.pages.slice(0, limits.maxWebflowPages)) {
        const path = tryResolvePagePath(page);
        if (path) addKnownPath(path);
        else complete = false;
      }
    } catch { // catch-ok: collision-sensitive generation fails closed below.
      complete = false;
    }
  }

  if (workspace?.webflowSiteId || workspace?.liveDomain) {
    let baseUrl = '';
    try {
      baseUrl = await externalDependencies.resolveBaseUrl(
        workspace,
        workspace.webflowToken,
      );
    } catch { // catch-ok: collision-sensitive generation fails closed below.
      complete = false;
    }

    if (!baseUrl) {
      complete = false;
    } else {
      let base: URL | null = null;
      try {
        base = new URL(baseUrl);
      } catch { // catch-ok: an invalid configured base URL fails closed.
        complete = false;
      }

      if (
        base
        && (base.protocol === 'http:' || base.protocol === 'https:')
        && !base.username
        && !base.password
      ) {
        try {
          const sitemapUrls = await externalDependencies.discoverSitemapUrls(baseUrl, {
            requireComplete: true,
            maxDocuments: limits.maxSitemapDocuments,
            maxDepth: limits.maxSitemapDepth,
            maxDocumentBytes: limits.maxSitemapDocumentBytes,
            maxAggregateBytes: limits.maxSitemapAggregateBytes,
            maxLocations: limits.maxSitemapLocations,
          });
          // A live Webflow sitemap includes at least the homepage. Empty output
          // therefore means discovery was unavailable or incomplete.
          if (
            sitemapUrls.length === 0
            || sitemapUrls.length > limits.maxSitemapLocations
          ) complete = false;
          const baseHostname = canonicalSiteHostname(base);
          sitemapPaths = new Set<string>();
          sitemapPathsByLeaf = new Map<string, string[]>();
          let returnedSitemapUrlBytes = 0;
          for (const sitemapUrl of sitemapUrls.slice(0, limits.maxSitemapLocations)) {
            returnedSitemapUrlBytes += matrixGenerationUtf8Bytes(sitemapUrl);
            if (returnedSitemapUrlBytes > limits.maxSitemapAggregateBytes) {
              complete = false;
              break;
            }
            try {
              const parsed = new URL(sitemapUrl, base);
              const isWebUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
              const isSameSite = canonicalSiteHostname(parsed) === baseHostname;
              if (!isWebUrl || !isSameSite || parsed.username || parsed.password) {
                complete = false;
                continue;
              }
              const sitemapPath = normalizePageUrl(parsed.pathname);
              const canonicalPath = addKnownPath(sitemapPath);
              if (canonicalPath === null) continue;
              sitemapPaths.add(canonicalPath);
              const segments = canonicalPath.split('/').filter(Boolean);
              const leaf = segments.at(-1);
              if (leaf) {
                const matches = sitemapPathsByLeaf.get(leaf) ?? [];
                if (!matches.includes(canonicalPath)) matches.push(canonicalPath);
                sitemapPathsByLeaf.set(leaf, matches);
              }
            } catch { // catch-ok: a malformed sitemap URL fails the authoritative census.
              complete = false;
            }
          }
        } catch { // catch-ok: strict discovery failure blocks generation below.
          // Strict sitemap discovery throws if any child sitemap is missing or
          // malformed, so partial sitemap indexes cannot authorize paid work.
          complete = false;
        }
      } else if (base) {
        complete = false;
      }
    }
  }

  // Local durable sources are read only after the final external await. A page
  // or published post saved while Webflow/sitemap discovery is in flight must
  // be included in the authoritative no-await collision boundary below.
  const localPathBounds = readStmts().knownPagePathCensusBounds.get(
    workspaceId,
    workspaceId,
  ) as PublishedPostCensusBoundsRow | undefined;
  const localPathBoundsAreSafe = Boolean(localPathBounds)
    && Number.isInteger(localPathBounds?.item_count)
    && localPathBounds!.item_count >= 0
    && localPathBounds!.item_count <= limits.maxWorkspacePaths
    && Number.isInteger(localPathBounds?.aggregate_bytes)
    && localPathBounds!.aggregate_bytes >= 0
    && localPathBounds!.aggregate_bytes <= limits.maxAggregatePathBytes;
  if (!localPathBoundsAreSafe) {
    complete = false;
  } else {
    const rows = readStmts().knownPagePaths.all(
      workspaceId,
      workspaceId,
    ) as Array<{ page_path: string | null }>;
    if (rows.length !== localPathBounds!.item_count) complete = false;
    for (const row of rows) {
      if (row.page_path === null) complete = false;
      else addKnownPath(row.page_path);
    }
  }

  const publishedBounds = readStmts().publishedPostCensusBounds.get(
    workspaceId,
  ) as PublishedPostCensusBoundsRow | undefined;
  const publishedBoundsAreSafe = Boolean(publishedBounds)
    && Number.isInteger(publishedBounds?.item_count)
    && publishedBounds!.item_count >= 0
    && publishedBounds!.item_count <= limits.maxWorkspacePaths
    && Number.isInteger(publishedBounds?.aggregate_bytes)
    && publishedBounds!.aggregate_bytes >= 0
    && publishedBounds!.aggregate_bytes <= limits.maxAggregatePathBytes;
  const publishedPageCensus = publishedBoundsAreSafe
    ? getPublishedPostPagePathCensus(workspaceId)
    : null;
  if (!publishedBoundsAreSafe) complete = false;
  for (const publishedPath of publishedPageCensus?.paths ?? []) addKnownPath(publishedPath);

  let publishedPathsComplete = publishedPageCensus?.complete ?? false;
  if (
    publishedPageCensus
    &&
    !publishedPathsComplete
    && publishedPageCensus.validCount === publishedPageCensus.totalCount
    && publishedPageCensus.unresolvedSlugs.size > 0
    && sitemapPaths !== null
    && sitemapPathsByLeaf !== null
  ) {
    publishedPathsComplete = true;
    for (const unresolvedSlug of publishedPageCensus.unresolvedSlugs) {
      const matches = sitemapPathsByLeaf.get(unresolvedSlug.toLowerCase()) ?? [];
      if (matches.length !== 1) {
        publishedPathsComplete = false;
        continue;
      }
      addKnownPath(matches[0]);
    }
  }
  if (!publishedPathsComplete) complete = false;

  return {
    paths: [...paths].sort(),
    publishedSlugs: publishedSlugs.sort(),
    complete,
  };
}

function assertGenerationSourceArrayIntegrity(
  census: MatrixGenerationSourceCensus | null,
  matrix: ContentMatrix,
  template: ContentTemplate | null,
): void {
  const {
    matrixComplete: matrixArraysAreComplete,
    templateComplete: templateArraysAreComplete,
  } = matrixGenerationSourceIsComplete(census, matrix, template);

  if (matrixArraysAreComplete && templateArraysAreComplete) return;
  throw new MatrixReadServiceError(
    'precondition_failed',
    'Stored matrix generation sources failed their complete-array integrity census.',
    {
      matrixId: matrix.id,
      templateId: matrix.templateId,
      matrixArraysComplete: matrixArraysAreComplete,
      templateArraysComplete: templateArraysAreComplete,
    },
  );
}

function defaultOtherWorkspaceMatrixPlannedUrls(
  workspaceId: string,
  matrixId: string,
): WorkspaceMatrixUrlCensus {
  const limits = MATRIX_GENERATION_SOURCE_LIMITS.census;
  const query = {
    workspace_id: workspaceId,
    matrix_id: matrixId,
  };
  const bounds = readStmts().otherMatrixCensusBounds.get(
    query,
  ) as WorkspaceMatrixCensusBoundsRow | undefined;
  if (
    !bounds
    || !Number.isInteger(bounds.item_count)
    || bounds.item_count < 0
    || bounds.item_count > limits.maxOtherMatrices
    || !Number.isInteger(bounds.aggregate_bytes)
    || bounds.aggregate_bytes < 0
    || bounds.aggregate_bytes > limits.maxAggregatePathBytes
  ) {
    return { items: [], complete: false };
  }

  // JSON functions run only after the raw aggregate byte preflight above. This
  // prevents a compact-but-enormous array from reaching per-item JS parsing.
  const shape = readStmts().otherMatrixCensusShape.get(
    query,
  ) as WorkspaceMatrixCensusShapeRow | undefined;
  if (
    !shape
    || shape.invalid_array_count !== 0
    || !Number.isInteger(shape.cell_count)
    || shape.cell_count < 0
    || shape.cell_count > limits.maxMatrixCandidates
  ) {
    return { items: [], complete: false };
  }

  const rows = readStmts().otherMatrixCells.all({
    ...query,
  }) as WorkspaceMatrixCellsRow[];
  const items: WorkspaceMatrixPlannedUrl[] = [];
  let complete = rows.length === bounds.item_count;
  let projectedBytes = 0;
  const invalidStoredCells = Symbol('invalid-stored-matrix-cells');
  for (const row of rows) {
    if (
      row.matrix_id === null
      || row.cells === null
      || !Number.isInteger(row.cells_bytes)
      || row.cells_bytes < 0
    ) {
      complete = false;
      continue;
    }
    const rawCells = parseJsonFallback<unknown>(row.cells, invalidStoredCells);
    const cells = parseJsonSafeArray(row.cells, matrixUrlCensusCellSchema, {
      workspaceId,
      table: 'content_matrices',
      field: 'cells',
    });
    if (!Array.isArray(rawCells) || rawCells.length !== cells.length) complete = false;
    for (const cell of cells) {
      const itemBytes = matrixGenerationUtf8Bytes(row.matrix_id)
        + matrixGenerationUtf8Bytes(cell.id)
        + matrixGenerationUtf8Bytes(cell.plannedUrl);
      if (projectedBytes + itemBytes > limits.maxAggregatePathBytes) {
        complete = false;
        break;
      }
      projectedBytes += itemBytes;
      items.push({
        matrixId: row.matrix_id,
        cellId: cell.id,
        plannedUrl: cell.plannedUrl,
      });
    }
    if (!complete && projectedBytes >= limits.maxAggregatePathBytes) break;
  }
  return { items, complete };
}

function assertRawGenerationSourceBounds(workspaceId: string, matrixId: string): void {
  const lengths = readStmts().rawGenerationSourceLengths.get(
    workspaceId,
    matrixId,
  ) as RawGenerationSourceLengthsRow | undefined;
  if (!lengths) return;
  const matrixLimits = MATRIX_GENERATION_SOURCE_LIMITS.matrix;
  const templateLimits = MATRIX_GENERATION_SOURCE_LIMITS.template;
  const byteCandidates = [
    { code: 'string_bytes_exceeded' as const, fieldPath: 'name', actual: lengths.matrix_name_bytes, limit: matrixLimits.maxNameBytes },
    { code: 'string_bytes_exceeded' as const, fieldPath: 'templateId', actual: lengths.matrix_template_id_bytes, limit: matrixLimits.maxTemplateIdBytes },
    { code: 'string_bytes_exceeded' as const, fieldPath: 'urlPattern', actual: lengths.matrix_url_pattern_bytes, limit: matrixLimits.maxPatternBytes },
    { code: 'string_bytes_exceeded' as const, fieldPath: 'keywordPattern', actual: lengths.matrix_keyword_pattern_bytes, limit: matrixLimits.maxPatternBytes },
    { code: 'serialized_bytes_exceeded' as const, fieldPath: 'dimensions', actual: lengths.matrix_dimensions_bytes, limit: matrixLimits.maxSerializedDefinitionBytes },
    { code: 'serialized_bytes_exceeded' as const, fieldPath: 'cells', actual: lengths.matrix_cells_bytes, limit: matrixLimits.maxSerializedSourceBytes },
    ...(lengths.template_exists === 1
      ? [{
          code: 'serialized_bytes_exceeded' as const,
          fieldPath: 'templateSource',
          actual: lengths.template_source_bytes,
          limit: templateLimits.maxSerializedSourceBytes,
        }]
      : []),
  ];
  const byteExceeded = byteCandidates.find(candidate => candidate.actual > candidate.limit);
  if (byteExceeded) {
    throw asBoundedReadError(new MatrixGenerationSourceLimitError('matrix', [byteExceeded]));
  }

  // JSON functions run only after the cheap byte ceiling proves every blob is
  // bounded. This prevents a gross legacy row from forcing repeated huge parses.
  const row = readStmts().rawGenerationSourceShape.get(
    workspaceId,
    matrixId,
  ) as RawGenerationSourceShapeRow | undefined;
  if (!row) return;
  const invalidField = [
    ['dimensions', row.matrix_dimensions_valid],
    ['cells', row.matrix_cells_valid],
    ...(row.template_exists === 1
      ? [
          ['template.variables', row.template_variables_valid],
          ['template.sections', row.template_sections_valid],
          ['template.schemaTypes', row.template_schema_types_valid],
          ['template.cmsFieldMap', row.template_cms_field_map_valid],
        ] as Array<[string, number]>
      : []),
  ].find(([, valid]) => valid !== 1);
  if (invalidField) {
    throw new MatrixReadServiceError(
      'precondition_failed',
      'Stored matrix generation sources failed raw JSON source preflight.',
      { fieldPath: invalidField[0] },
    );
  }

  const candidates: MatrixGenerationSourceLimitIssue[] = [
    { code: 'array_items_exceeded', fieldPath: 'dimensions', actual: row.matrix_dimension_count, limit: matrixLimits.maxDimensions },
    { code: 'array_items_exceeded', fieldPath: 'cells', actual: row.matrix_cell_count, limit: matrixLimits.maxGeneratedCells },
  ];
  if (row.template_exists === 1) {
    candidates.push(
      { code: 'array_items_exceeded', fieldPath: 'template.variables', actual: row.template_variable_count, limit: templateLimits.maxVariables },
      { code: 'array_items_exceeded', fieldPath: 'template.sections', actual: row.template_section_count, limit: templateLimits.maxSections },
      { code: 'array_items_exceeded', fieldPath: 'template.schemaTypes', actual: row.template_schema_type_count, limit: templateLimits.maxSchemaTypes },
      { code: 'record_entries_exceeded', fieldPath: 'template.cmsFieldMap', actual: row.template_cms_field_count, limit: templateLimits.maxCmsFieldMappings },
    );
  }
  const exceeded = candidates.find(candidate => candidate.actual > candidate.limit);
  if (exceeded) {
    throw asBoundedReadError(new MatrixGenerationSourceLimitError('matrix', [exceeded]));
  }
}

const defaultDependencies: ContentMatrixReadServiceDependencies = {
  getWorkspace,
  listMatrixSummaries,
  getMatrix,
  getTemplate,
  assertRawGenerationSourceBounds,
  getGenerationSourceCensus: getMatrixGenerationSourceCensus,
  getKnownWorkspacePageCensus: buildKnownWorkspacePageCensus,
  getOtherWorkspaceMatrixPlannedUrls: defaultOtherWorkspaceMatrixPlannedUrls,
  listCurrentEvidenceRequirementIds,
  resolveMatrixStructure,
};

export function createContentMatrixReadService(
  dependencies: ContentMatrixReadServiceDependencies = defaultDependencies,
) {
  function requireWorkspace(workspaceId: string): void {
    if (!dependencies.getWorkspace(workspaceId)) {
      throw new MatrixReadServiceError('not_found', 'Workspace not found.');
    }
  }

  function listContentMatrices(
    request: ListContentMatricesRequest,
  ): ListContentMatricesResult {
    requireWorkspace(request.workspaceId);
    const limit = pageSize(request.limit);
    const cursor = request.cursor
      ? decodeMatrixListCursor(request.cursor, request.workspaceId, request.templateId)
      : null;
    const summaries = dependencies.listMatrixSummaries
      ? dependencies.listMatrixSummaries({
          workspaceId: request.workspaceId,
          templateId: request.templateId,
          after: cursor
            ? { updatedAt: cursor.updatedAt, matrixId: cursor.matrixId }
            : undefined,
          limit: limit + 1,
        })
      : (dependencies.listMatrices?.(request.workspaceId) ?? [])
          .filter(item => request.templateId === undefined || item.templateId === request.templateId)
          .map((item) => {
            assertBoundedMatrix(item);
            return normalizedMatrix(item);
          })
          .sort(compareMatrices)
          .filter(item => cursor === null || isAfterListCursor(item, cursor))
          .map(item => matrixSummary(
            item,
            readBoundedTemplate(
              () => dependencies.getTemplate(request.workspaceId, item.templateId),
            ),
          ));
    summaries.forEach(assertBoundedMatrixSummary);
    const items: ContentMatrixSummary[] = [];
    for (const candidate of summaries.slice(0, limit)) {
      const tentativeItems = [...items, candidate];
      const tentativeLast = tentativeItems.at(-1);
      const tentativeResponse: ListContentMatricesResult = {
        items: tentativeItems,
        nextCursor: summaries.length > tentativeItems.length && tentativeLast
          ? encodeCursor({
              version: CURSOR_VERSION,
              kind: 'matrix_list',
              workspaceId: request.workspaceId,
              templateId: request.templateId ?? null,
              updatedAt: tentativeLast.updatedAt,
              matrixId: tentativeLast.id,
            })
          : null,
      };
      if (
        matrixGenerationSerializedBytes(tentativeResponse)
          > MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes
      ) {
        if (items.length === 0) {
          assertBoundedReadPayload(
            'matrix_read_page',
            'listResponse',
            tentativeResponse,
            MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes,
          );
        }
        break;
      }
      items.push(candidate);
    }
    const last = items.at(-1);
    const result: ListContentMatricesResult = {
      items,
      nextCursor: summaries.length > items.length && last
        ? encodeCursor({
            version: CURSOR_VERSION,
            kind: 'matrix_list',
            workspaceId: request.workspaceId,
            templateId: request.templateId ?? null,
            updatedAt: last.updatedAt,
            matrixId: last.id,
          })
        : null,
    };
    assertBoundedReadPayload(
      'matrix_read_page',
      'listResponse',
      result,
      MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes,
    );
    return result;
  }

  function getContentMatrix(request: GetContentMatrixRequest): GetContentMatrixResult {
    requireWorkspace(request.workspaceId);
    dependencies.assertRawGenerationSourceBounds?.(request.workspaceId, request.matrixId);
    const stored = dependencies.getMatrix(request.workspaceId, request.matrixId);
    if (!stored) throw new MatrixReadServiceError('not_found', 'Content matrix not found.');
    assertBoundedMatrix(stored);
    const matrix = normalizedMatrix(stored);
    const matrixRevision = matrix.revision ?? 0;
    const cellSnapshotFingerprint = canonicalGenerationFingerprint(matrix.cells);
    const limit = pageSize(request.limit);
    const offset = request.cursor
      ? decodeMatrixCellCursor(
          request.cursor,
          matrix.id,
          matrixRevision,
          cellSnapshotFingerprint,
        ).offset
      : 0;
    const template = readBoundedTemplate(
      () => dependencies.getTemplate(request.workspaceId, matrix.templateId),
    );
    assertGenerationSourceArrayIntegrity(
      dependencies.getGenerationSourceCensus(request.workspaceId, matrix.id),
      matrix,
      template,
    );
    const metadata = matrixMetadata(matrix);
    assertBoundedReadPayload(
      'matrix_read_page',
      'matrix',
      metadata,
      MATRIX_GENERATION_SOURCE_LIMITS.read.maxMatrixMetadataBytes,
    );
    const items: ContentMatrixReadCell[] = [];
    const candidateCells = matrix.cells.slice(offset, offset + limit);
    for (const candidate of candidateCells) {
      const tentativeItems = [...items, candidate];
      const tentativeNextOffset = offset + tentativeItems.length;
      const tentativeResult: GetContentMatrixResult = {
        matrix: metadata,
        templateRevision: template?.revision ?? 0,
        cells: {
          items: tentativeItems,
          nextCursor: tentativeNextOffset < matrix.cells.length
            ? encodeCursor({
                version: CURSOR_VERSION,
                kind: 'matrix_cells',
                matrixId: matrix.id,
                matrixRevision,
                cellSnapshotFingerprint,
                offset: tentativeNextOffset,
              })
            : null,
        },
      };
      if (
        matrixGenerationSerializedBytes(tentativeResult)
          > MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes
      ) {
        if (items.length === 0) {
          assertBoundedReadPayload(
            'matrix_read_page',
            'matrixReadResponse',
            tentativeResult,
            MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes,
          );
        }
        break;
      }
      items.push(candidate);
    }
    const nextOffset = offset + items.length;
    const result: GetContentMatrixResult = {
      matrix: metadata,
      templateRevision: template?.revision ?? 0,
      cells: {
        items,
        nextCursor: nextOffset < matrix.cells.length
          ? encodeCursor({
              version: CURSOR_VERSION,
              kind: 'matrix_cells',
              matrixId: matrix.id,
              matrixRevision,
              cellSnapshotFingerprint,
              offset: nextOffset,
            })
          : null,
      },
    };
    assertBoundedReadPayload(
      'matrix_read_page',
      'matrixReadResponse',
      result,
      MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes,
    );
    return result;
  }

  async function resolveMatrixStructuresWithCensus(
    request: ResolveMatrixStructuresRequest,
  ): Promise<ResolveMatrixStructuresWithCensusResult> {
    assertResolveSelections(request.selections);
    requireWorkspace(request.workspaceId);

    // Reject missing/stale/unbounded source selections before the live URL
    // census. This keeps invalid requests deterministic and network-free.
    dependencies.assertRawGenerationSourceBounds?.(request.workspaceId, request.matrixId);
    const initialStored = dependencies.getMatrix(request.workspaceId, request.matrixId);
    if (!initialStored) throw new MatrixReadServiceError('not_found', 'Content matrix not found.');
    assertBoundedMatrix(initialStored);
    const initialMatrix = normalizedMatrix(initialStored);
    const initialTemplate = readBoundedTemplate(
      () => dependencies.getTemplate(request.workspaceId, initialMatrix.templateId),
    );
    assertGenerationSourceArrayIntegrity(
      dependencies.getGenerationSourceCensus(request.workspaceId, initialMatrix.id),
      initialMatrix,
      initialTemplate,
    );
    validateSelectionSnapshot(initialMatrix, initialTemplate, request.selections);
    const initialFingerprint = generationSnapshotFingerprint(
      initialMatrix,
      initialTemplate,
      request.selections,
    );

    const knownWorkspacePageCensus = await dependencies.getKnownWorkspacePageCensus(
      request.workspaceId,
    );

    // Re-read after the only await and require the exact initial generation
    // snapshot. There is deliberately no await after this authoritative check.
    dependencies.assertRawGenerationSourceBounds?.(request.workspaceId, request.matrixId);
    const stored = dependencies.getMatrix(request.workspaceId, request.matrixId);
    if (!stored) {
      throw new MatrixReadServiceError(
        'conflict',
        'The matrix source changed during URL discovery. Re-read and resolve again.',
      );
    }
    assertBoundedMatrix(stored);
    const matrix = normalizedMatrix(stored);
    const template = readBoundedTemplate(
      () => dependencies.getTemplate(request.workspaceId, matrix.templateId),
    );
    assertGenerationSourceArrayIntegrity(
      dependencies.getGenerationSourceCensus(request.workspaceId, matrix.id),
      matrix,
      template,
    );
    if (generationSnapshotFingerprint(matrix, template, request.selections) !== initialFingerprint) {
      throw new MatrixReadServiceError(
        'conflict',
        'The matrix source changed during URL discovery. Re-read and resolve again.',
      );
    }
    const cellsById = validateSelectionSnapshot(matrix, template, request.selections);
    const otherMatrixUrlCensus = dependencies.getOtherWorkspaceMatrixPlannedUrls(
      request.workspaceId,
      matrix.id,
    );
    const ownMatrixPlannedUrls = matrix.cells.map(item => ({
        cellId: item.id,
        plannedUrl: item.plannedUrl,
    }));
    const otherMatrixUrlsByCanonicalPath = new Map<string, Array<{
      cellId: string;
      plannedUrl: string;
    }>>();
    const seenOtherMatrixCellIds = new Set<string>();
    let matrixUrlCensusComplete = otherMatrixUrlCensus.complete
      && Array.isArray(otherMatrixUrlCensus.items);
    const otherMatrixItems = Array.isArray(otherMatrixUrlCensus.items)
      ? otherMatrixUrlCensus.items
      : [];
    if (otherMatrixItems.length > MATRIX_GENERATION_SOURCE_LIMITS.census.maxMatrixCandidates) {
      matrixUrlCensusComplete = false;
    }
    let otherMatrixProjectedBytes = 0;
    for (const item of otherMatrixItems.slice(
      0,
      MATRIX_GENERATION_SOURCE_LIMITS.census.maxMatrixCandidates,
    )) {
      if (
        !item
        || typeof item.matrixId !== 'string'
        || typeof item.cellId !== 'string'
        || typeof item.plannedUrl !== 'string'
      ) {
        matrixUrlCensusComplete = false;
        continue;
      }
      const cellId = `matrix:${item.matrixId}:cell:${item.cellId}`;
      otherMatrixProjectedBytes += matrixGenerationUtf8Bytes(cellId)
        + matrixGenerationUtf8Bytes(item.plannedUrl);
      if (
        otherMatrixProjectedBytes
        > MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes
      ) {
        matrixUrlCensusComplete = false;
        break;
      }
      const canonicalPath = canonicalizeMatrixPath(item.plannedUrl);
      if (seenOtherMatrixCellIds.has(cellId) || canonicalPath === null) {
        matrixUrlCensusComplete = false;
        continue;
      }
      seenOtherMatrixCellIds.add(cellId);
      const matches = otherMatrixUrlsByCanonicalPath.get(canonicalPath) ?? [];
      matches.push({ cellId, plannedUrl: item.plannedUrl });
      otherMatrixUrlsByCanonicalPath.set(canonicalPath, matches);
    }

    const workspacePathsByCanonicalPath = new Map<string, string[]>();
    let workspaceUrlCensusComplete = knownWorkspacePageCensus.complete
      && Array.isArray(knownWorkspacePageCensus.paths)
      && Array.isArray(knownWorkspacePageCensus.publishedSlugs);
    const knownWorkspacePaths = Array.isArray(knownWorkspacePageCensus.paths)
      ? knownWorkspacePageCensus.paths
      : [];
    if (knownWorkspacePaths.length > MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths) {
      workspaceUrlCensusComplete = false;
    }
    let workspacePathBytes = 0;
    for (const path of knownWorkspacePaths.slice(
      0,
      MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths,
    )) {
      workspacePathBytes += typeof path === 'string' ? matrixGenerationUtf8Bytes(path) : 0;
      if (workspacePathBytes > MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes) {
        workspaceUrlCensusComplete = false;
        break;
      }
      const canonicalPath = typeof path === 'string' ? canonicalizeMatrixPath(path) : null;
      if (canonicalPath === null) {
        workspaceUrlCensusComplete = false;
        continue;
      }
      const matches = workspacePathsByCanonicalPath.get(canonicalPath) ?? [];
      if (!matches.includes(path)) matches.push(path);
      workspacePathsByCanonicalPath.set(canonicalPath, matches);
    }

    const publishedPathsByCanonicalPath = new Map<string, string[]>();
    const knownPublishedPaths = Array.isArray(knownWorkspacePageCensus.publishedSlugs)
      ? knownWorkspacePageCensus.publishedSlugs
      : [];
    if (knownPublishedPaths.length > MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths) {
      workspaceUrlCensusComplete = false;
    }
    let publishedPathBytes = workspacePathBytes;
    for (const path of knownPublishedPaths.slice(
      0,
      MATRIX_GENERATION_SOURCE_LIMITS.census.maxWorkspacePaths,
    )) {
      publishedPathBytes += typeof path === 'string' ? matrixGenerationUtf8Bytes(path) : 0;
      if (publishedPathBytes > MATRIX_GENERATION_SOURCE_LIMITS.census.maxAggregatePathBytes) {
        workspaceUrlCensusComplete = false;
        break;
      }
      const canonicalPath = typeof path === 'string'
        ? canonicalizeMatrixPath(normalizePageUrl(path))
        : null;
      if (canonicalPath === null) {
        workspaceUrlCensusComplete = false;
        continue;
      }
      const matches = publishedPathsByCanonicalPath.get(canonicalPath) ?? [];
      if (!matches.includes(path)) matches.push(path);
      publishedPathsByCanonicalPath.set(canonicalPath, matches);
    }

    const results = request.selections.map((selection) => {
      const cell = cellsById.get(selection.cellId);
      if (!cell) throw new MatrixReadServiceError('conflict', 'Selected cell changed during resolution.');
      const currentRevision = sourceRevision(matrix, template, cell);
      const selectedCanonicalPath = canonicalizeMatrixPath(cell.plannedUrl);

      if (!template) {
        return {
          status: 'blocked' as const,
          matrixId: matrix.id,
          templateId: matrix.templateId,
          cellId: cell.id,
          sourceRevision: currentRevision,
          blockers: [{
            id: `matrix:${matrix.id}:template:missing`,
            fieldPath: 'templateId',
            claim: 'The matrix references an available workspace content template.',
            reason: 'The referenced template is missing or belongs to another workspace.',
            requirementStage: 'preflight' as const,
            claimKind: 'structural' as const,
            status: 'missing' as const,
            sourceRefs: [] as [],
          }],
        };
      }

      return dependencies.resolveMatrixStructure({
        workspaceId: request.workspaceId,
        matrix,
        template,
        cell,
        expectedSourceRevision: selection.expectedSourceRevision,
        matrixPlannedUrls: [
          ...ownMatrixPlannedUrls,
          ...(selectedCanonicalPath === null
            ? []
            : otherMatrixUrlsByCanonicalPath.get(selectedCanonicalPath) ?? []),
        ],
        matrixUrlCensusComplete,
        knownWorkspacePagePaths: selectedCanonicalPath === null
          ? []
          : workspacePathsByCanonicalPath.get(selectedCanonicalPath) ?? [],
        knownWorkspacePublishedSlugs: selectedCanonicalPath === null
          ? []
          : publishedPathsByCanonicalPath.get(selectedCanonicalPath) ?? [],
        workspaceUrlCensusComplete,
        currentEvidenceRequirementIds: dependencies.listCurrentEvidenceRequirementIds?.(
          request.workspaceId,
          matrix.id,
          cell.id,
          currentRevision.templateRevision,
        ) ?? [],
      });
    });
    results.forEach((result, index) => assertBoundedReadPayload(
      'matrix_resolve_response',
      `results[${index}]`,
      result,
      MATRIX_GENERATION_SOURCE_LIMITS.read.maxStructuralTargetBytes,
    ));
    const response: ResolveMatrixStructuresResult = { results };
    assertBoundedReadPayload(
      'matrix_resolve_response',
      'resolveResponse',
      response,
      MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes,
    );
    return { result: response, pageCensus: knownWorkspacePageCensus };
  }

  async function resolveMatrixStructures(
    request: ResolveMatrixStructuresRequest,
  ): Promise<ResolveMatrixStructuresResult> {
    return (await resolveMatrixStructuresWithCensus(request)).result;
  }

  return {
    listContentMatrices,
    getContentMatrix,
    resolveMatrixStructures,
    resolveMatrixStructuresWithCensus,
  };
}

const contentMatrixReadService = createContentMatrixReadService();

export const listContentMatrices = contentMatrixReadService.listContentMatrices;
export const getContentMatrix = contentMatrixReadService.getContentMatrix;
export const resolveMatrixStructures = contentMatrixReadService.resolveMatrixStructures;
export const resolveMatrixStructuresWithCensus =
  contentMatrixReadService.resolveMatrixStructuresWithCensus;
