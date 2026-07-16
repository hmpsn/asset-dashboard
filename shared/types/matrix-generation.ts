import type { GenerationProvenance } from './ai-execution.js';
import {
  TEMPLATE_SECTION_GENERATION_ROLES,
  type BriefPageType,
  type ContentMatrix,
  type ContentTemplate,
  type MatrixCell,
  type TemplateAeoContract,
  type TemplateCtaContract,
  type TemplateSectionGenerationRole,
} from './content.js';
import type { McpToolExecutionContext } from './mcp-runtime.js';
import type {
  ApprovedBrandDeliverableRef,
  FinalizedVoiceSnapshotRef,
} from './brand-generation.js';
import {
  GENERATION_RUN_STATUSES,
  type GenerationAuditReport,
  type GenerationAutomaticRevisionCount,
  type GenerationEvidenceRequirement,
  type GenerationEvidenceResolution,
  type GenerationEvidenceSourceRef,
  type GenerationEvidenceValue,
  type GenerationRunCounts,
  type GenerationRunStatus,
  type GenerationSanitizedError,
  type GenerationHumanReviewerAttribution,
  type GenerationOperatorAttribution,
  type GenerationResolverAttribution,
} from './generation-evidence.js';

export interface MatrixSourceRevision {
  matrixRevision: number;
  templateRevision: number;
  cellRevision: number;
}

export const MATRIX_GENERATION_CONTRACT_VERSION = 1;

export const MATRIX_READ_LIMITS = {
  defaultPageSize: 25,
  maxPageSize: 100,
  maxResolveSelection: 25,
} as const;

/**
 * Hard source-envelope limits shared by every matrix/template write and MCP read.
 * These bounds are intentionally generous for a service-by-location program while
 * preventing one stored row from expanding into unbounded memory, tool output, or
 * paid-generation input.
 */
export const MATRIX_GENERATION_SOURCE_LIMITS = {
  matrix: {
    maxNameBytes: 256,
    maxTemplateIdBytes: 200,
    maxDimensions: 8,
    maxDimensionNameBytes: 64,
    maxValuesPerDimension: 250,
    maxDimensionValueBytes: 256,
    maxGeneratedCells: 2_500,
    maxPatternBytes: 4_096,
    maxSerializedDefinitionBytes: 512 * 1_024,
    maxSerializedSourceBytes: 16 * 1_024 * 1_024,
  },
  template: {
    maxNameBytes: 256,
    maxDescriptionBytes: 4_096,
    maxVariables: 32,
    maxVariableNameBytes: 64,
    maxVariableLabelBytes: 256,
    maxVariableDescriptionBytes: 2_048,
    maxSections: 40,
    maxSectionIdBytes: 200,
    maxSectionNameBytes: 256,
    maxHeadingTemplateBytes: 2_048,
    maxGuidanceBytes: 12_000,
    maxSectionNoteBytes: 4_096,
    maxSectionWordCountTarget: 5_000,
    maxTotalWordCountTarget: 50_000,
    maxPatternBytes: 4_096,
    maxToneAndStyleBytes: 12_000,
    maxCmsFieldMappings: 80,
    maxCmsFieldKeyBytes: 200,
    maxCmsFieldValueBytes: 512,
    maxSchemaTypes: 32,
    maxSchemaTypeBytes: 200,
    maxSerializedSourceBytes: 1 * 1_024 * 1_024,
  },
  cell: {
    maxIdBytes: 200,
    maxVariableValues: 8,
    maxVariableNameBytes: 64,
    maxVariableValueBytes: 256,
    maxKeywordBytes: 512,
    maxPlannedUrlBytes: 2_048,
    maxArtifactIdBytes: 200,
    maxStatusHistoryEntries: 128,
    maxTimestampBytes: 64,
    maxKeywordCandidates: 50,
    maxAuthorityNoteBytes: 2_048,
    maxClientFlagBytes: 4_096,
    maxExpectedSchemaTypes: 32,
    maxSchemaTypeBytes: 200,
    maxSerializedSourceBytes: 64 * 1_024,
  },
  read: {
    maxStoredStatsBytes: 4 * 1_024,
    maxSummaryBytes: 16 * 1_024,
    maxMatrixMetadataBytes: 640 * 1_024,
    maxStructuralTargetBytes: 640 * 1_024,
    /** Practical MCP/model-context ceiling; list/get paginate by bytes below it. */
    maxResponseBytes: 768 * 1_024,
  },
  census: {
    maxOtherMatrices: 1_000,
    maxMatrixCandidates: 10_000,
    maxWorkspacePaths: 10_000,
    maxAggregatePathBytes: 4 * 1_024 * 1_024,
    maxWebflowPages: 10_000,
    maxSitemapDocuments: 64,
    maxSitemapDepth: 4,
    maxSitemapDocumentBytes: 1 * 1_024 * 1_024,
    maxSitemapAggregateBytes: 4 * 1_024 * 1_024,
    maxSitemapLocations: 10_000,
  },
} as const;

export const MATRIX_GENERATION_SOURCE_LIMIT_ISSUE_CODES = [
  'string_bytes_exceeded',
  'array_items_exceeded',
  'record_entries_exceeded',
  'generated_cells_exceeded',
  'word_count_exceeded',
  'serialized_bytes_exceeded',
] as const;

export const MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES = 16;

export type MatrixGenerationSourceLimitIssueCode =
  (typeof MATRIX_GENERATION_SOURCE_LIMIT_ISSUE_CODES)[number];

export interface MatrixGenerationSourceLimitIssue {
  code: MatrixGenerationSourceLimitIssueCode;
  fieldPath: string;
  actual: number;
  limit: number;
}

export type MatrixGenerationSourceKind =
  | 'matrix_definition'
  | 'matrix'
  | 'template'
  | 'cell'
  | 'matrix_summary'
  | 'matrix_read_page'
  | 'matrix_resolve_response';

/** Typed, deterministic contract failure. No source content is echoed. */
export class MatrixGenerationSourceLimitError extends Error {
  readonly code = 'generation_source_limit_exceeded' as const;
  readonly sourceKind: MatrixGenerationSourceKind;
  readonly issues: readonly MatrixGenerationSourceLimitIssue[];

  constructor(
    sourceKind: MatrixGenerationSourceKind,
    issues: readonly MatrixGenerationSourceLimitIssue[],
  ) {
    const paths = [...new Set(issues.map(issue => issue.fieldPath))].slice(0, 5);
    super(`Matrix generation ${sourceKind} exceeds bounded source limits: ${paths.join(', ')}`);
    this.name = 'MatrixGenerationSourceLimitError';
    this.sourceKind = sourceKind;
    this.issues = issues;
  }
}

export type MatrixGenerationSchemaTypeIssueCode =
  | 'blank_schema_type'
  | 'duplicate_schema_type'
  | 'unnormalized_schema_type';

export interface MatrixGenerationSchemaTypeIssue {
  code: MatrixGenerationSchemaTypeIssueCode;
  fieldPath: string;
}

export class MatrixGenerationSchemaTypeContractError extends Error {
  readonly code = 'invalid_generation_schema_types' as const;
  readonly issues: readonly MatrixGenerationSchemaTypeIssue[];

  constructor(issues: readonly MatrixGenerationSchemaTypeIssue[]) {
    super(`Matrix generation schema types are invalid: ${issues.map(issue => issue.fieldPath).join(', ')}`);
    this.name = 'MatrixGenerationSchemaTypeContractError';
    this.issues = issues;
  }
}

/** Trims identifiers and rejects blank or duplicate normalized values. */
export function normalizeMatrixGenerationSchemaTypes(
  values: readonly string[],
  fieldPath = 'schemaTypes',
): string[] {
  const maxItems = MATRIX_GENERATION_SOURCE_LIMITS.template.maxSchemaTypes;
  if (values.length > maxItems) {
    throw new MatrixGenerationSourceLimitError('template', [{
      code: 'array_items_exceeded',
      fieldPath,
      actual: values.length,
      limit: maxItems,
    }]);
  }
  const issues: MatrixGenerationSchemaTypeIssue[] = [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const candidate = value.trim();
    if (candidate.length === 0) {
      if (issues.length < MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES) {
        issues.push({ code: 'blank_schema_type', fieldPath: `${fieldPath}[${index}]` });
      }
      return;
    }
    if (seen.has(candidate)) {
      if (issues.length < MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES) {
        issues.push({ code: 'duplicate_schema_type', fieldPath: `${fieldPath}[${index}]` });
      }
      return;
    }
    seen.add(candidate);
    normalized.push(candidate);
  });
  if (issues.length > 0) throw new MatrixGenerationSchemaTypeContractError(issues);
  return normalized;
}

function assertNormalizedMatrixGenerationSchemaTypes(
  values: readonly string[],
  fieldPath: string,
): void {
  const normalized = normalizeMatrixGenerationSchemaTypes(values, fieldPath);
  const issues = values.flatMap((value, index) => (
    value === normalized[index]
      ? []
      : [{
          code: 'unnormalized_schema_type' as const,
          fieldPath: `${fieldPath}[${index}]`,
        }]
  ));
  if (issues.length > 0) throw new MatrixGenerationSchemaTypeContractError(issues);
}

const sourceTextEncoder = new TextEncoder();

export function matrixGenerationUtf8Bytes(value: string): number {
  return sourceTextEncoder.encode(value).byteLength;
}

export function matrixGenerationSerializedBytes(value: unknown): number {
  try {
    return matrixGenerationUtf8Bytes(JSON.stringify(value) ?? 'null');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function addStringLimitIssue(
  issues: MatrixGenerationSourceLimitIssue[],
  fieldPath: string,
  value: string | undefined,
  limit: number,
): void {
  if (value === undefined) return;
  const actual = matrixGenerationUtf8Bytes(value);
  if (actual > limit) {
    pushSourceLimitIssue(issues, { code: 'string_bytes_exceeded', fieldPath, actual, limit });
  }
}

function pushSourceLimitIssue(
  issues: MatrixGenerationSourceLimitIssue[],
  issue: MatrixGenerationSourceLimitIssue,
): void {
  if (issues.length < MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES) issues.push(issue);
}

function addCollectionLimitIssue(
  issues: MatrixGenerationSourceLimitIssue[],
  code: 'array_items_exceeded' | 'record_entries_exceeded',
  fieldPath: string,
  actual: number,
  limit: number,
): void {
  if (actual > limit) pushSourceLimitIssue(issues, { code, fieldPath, actual, limit });
}

function addSerializedLimitIssue(
  issues: MatrixGenerationSourceLimitIssue[],
  fieldPath: string,
  value: unknown,
  limit: number,
): void {
  const actual = matrixGenerationSerializedBytes(value);
  if (actual > limit) {
    pushSourceLimitIssue(
      issues,
      { code: 'serialized_bytes_exceeded', fieldPath, actual, limit },
    );
  }
}

function countRecordEntriesUpTo<T>(record: Readonly<Record<string, T>>, limit: number): number {
  let count = 0;
  for (const _key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, _key)) continue;
    count += 1;
    if (count > limit) return count;
  }
  return count;
}

export interface MatrixGenerationDefinitionSource {
  name?: string;
  templateId?: string;
  dimensions: ContentMatrix['dimensions'];
  urlPattern: string;
  keywordPattern: string;
  expectedSchemaTypes?: string[];
}

export function matrixGenerationDefinitionLimitIssues(
  source: MatrixGenerationDefinitionSource,
): MatrixGenerationSourceLimitIssue[] {
  const limits = MATRIX_GENERATION_SOURCE_LIMITS.matrix;
  const issues: MatrixGenerationSourceLimitIssue[] = [];
  addStringLimitIssue(issues, 'name', source.name, limits.maxNameBytes);
  addStringLimitIssue(issues, 'templateId', source.templateId, limits.maxTemplateIdBytes);
  addStringLimitIssue(issues, 'urlPattern', source.urlPattern, limits.maxPatternBytes);
  addStringLimitIssue(issues, 'keywordPattern', source.keywordPattern, limits.maxPatternBytes);
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    'dimensions',
    source.dimensions.length,
    limits.maxDimensions,
  );
  if (source.expectedSchemaTypes !== undefined) {
    addCollectionLimitIssue(
      issues,
      'array_items_exceeded',
      'expectedSchemaTypes',
      source.expectedSchemaTypes.length,
      MATRIX_GENERATION_SOURCE_LIMITS.cell.maxExpectedSchemaTypes,
    );
  }
  if (issues.length > 0) return issues;

  let generatedCellCount = source.dimensions.length === 0 ? 0 : 1;
  source.dimensions.forEach((dimension, dimensionIndex) => {
    addStringLimitIssue(
      issues,
      `dimensions[${dimensionIndex}].variableName`,
      dimension.variableName,
      limits.maxDimensionNameBytes,
    );
    addCollectionLimitIssue(
      issues,
      'array_items_exceeded',
      `dimensions[${dimensionIndex}].values`,
      dimension.values.length,
      limits.maxValuesPerDimension,
    );
    if (dimension.values.length <= limits.maxValuesPerDimension) {
      dimension.values.forEach((value, valueIndex) => {
      addStringLimitIssue(
        issues,
        `dimensions[${dimensionIndex}].values[${valueIndex}]`,
        value,
        limits.maxDimensionValueBytes,
      );
      });
    }
    if (generatedCellCount <= limits.maxGeneratedCells) {
      generatedCellCount *= dimension.values.length;
    }
  });
  if (generatedCellCount > limits.maxGeneratedCells) {
    pushSourceLimitIssue(issues, {
      code: 'generated_cells_exceeded',
      fieldPath: 'dimensions',
      actual: generatedCellCount,
      limit: limits.maxGeneratedCells,
    });
  }
  if (source.expectedSchemaTypes !== undefined) {
    source.expectedSchemaTypes.forEach((schemaType, index) => addStringLimitIssue(
      issues,
      `expectedSchemaTypes[${index}]`,
      schemaType,
      MATRIX_GENERATION_SOURCE_LIMITS.cell.maxSchemaTypeBytes,
    ));
  }
  if (issues.length > 0) return issues;
  addSerializedLimitIssue(
    issues,
    'matrixDefinition',
    source,
    limits.maxSerializedDefinitionBytes,
  );
  return issues;
}

export function assertMatrixGenerationDefinitionWithinLimits(
  source: MatrixGenerationDefinitionSource,
): void {
  const issues = matrixGenerationDefinitionLimitIssues(source);
  if (issues.length > 0) {
    throw new MatrixGenerationSourceLimitError('matrix_definition', issues);
  }
  if (source.expectedSchemaTypes) {
    assertNormalizedMatrixGenerationSchemaTypes(source.expectedSchemaTypes, 'expectedSchemaTypes');
  }
}

export function matrixCellGenerationSourceLimitIssues(
  cell: MatrixCell,
  fieldPrefix = 'cell',
): MatrixGenerationSourceLimitIssue[] {
  const limits = MATRIX_GENERATION_SOURCE_LIMITS.cell;
  const issues: MatrixGenerationSourceLimitIssue[] = [];
  const variableValueCount = countRecordEntriesUpTo(cell.variableValues, limits.maxVariableValues);
  const statusHistory = cell.statusHistory ?? [];
  const candidates = cell.keywordCandidates ?? [];
  const schemaTypes = cell.expectedSchemaTypes ?? [];
  addCollectionLimitIssue(
    issues,
    'record_entries_exceeded',
    `${fieldPrefix}.variableValues`,
    variableValueCount,
    limits.maxVariableValues,
  );
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    `${fieldPrefix}.statusHistory`,
    statusHistory.length,
    limits.maxStatusHistoryEntries,
  );
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    `${fieldPrefix}.keywordCandidates`,
    candidates.length,
    limits.maxKeywordCandidates,
  );
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    `${fieldPrefix}.expectedSchemaTypes`,
    schemaTypes.length,
    limits.maxExpectedSchemaTypes,
  );
  if (issues.length > 0) return issues;
  addStringLimitIssue(issues, `${fieldPrefix}.id`, cell.id, limits.maxIdBytes);
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.targetKeyword`,
    cell.targetKeyword,
    limits.maxKeywordBytes,
  );
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.customKeyword`,
    cell.customKeyword,
    limits.maxKeywordBytes,
  );
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.recommendedKeyword`,
    cell.recommendedKeyword,
    limits.maxKeywordBytes,
  );
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.plannedUrl`,
    cell.plannedUrl,
    limits.maxPlannedUrlBytes,
  );
  addStringLimitIssue(issues, `${fieldPrefix}.briefId`, cell.briefId, limits.maxArtifactIdBytes);
  addStringLimitIssue(issues, `${fieldPrefix}.postId`, cell.postId, limits.maxArtifactIdBytes);
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.clientFlag`,
    cell.clientFlag,
    limits.maxClientFlagBytes,
  );
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.clientFlaggedAt`,
    cell.clientFlaggedAt,
    limits.maxTimestampBytes,
  );

  const variableValues = Object.entries(cell.variableValues);
  variableValues.forEach(([name, value], index) => {
    addStringLimitIssue(
      issues,
      `${fieldPrefix}.variableValues[${index}].name`,
      name,
      limits.maxVariableNameBytes,
    );
    addStringLimitIssue(
      issues,
      `${fieldPrefix}.variableValues[${index}].value`,
      value,
      limits.maxVariableValueBytes,
    );
  });

  statusHistory.forEach((entry, index) => addStringLimitIssue(
    issues,
    `${fieldPrefix}.statusHistory[${index}].at`,
    entry.at,
    limits.maxTimestampBytes,
  ));
  addStringLimitIssue(
    issues,
    `${fieldPrefix}.keywordValidation.validatedAt`,
    cell.keywordValidation?.validatedAt,
    limits.maxTimestampBytes,
  );

  candidates.forEach((candidate, index) => {
    addStringLimitIssue(
      issues,
      `${fieldPrefix}.keywordCandidates[${index}].keyword`,
      candidate.keyword,
      limits.maxKeywordBytes,
    );
    addStringLimitIssue(
      issues,
      `${fieldPrefix}.keywordCandidates[${index}].authorityAssessment.note`,
      candidate.authorityAssessment?.note,
      limits.maxAuthorityNoteBytes,
    );
  });

  schemaTypes.forEach((schemaType, index) => addStringLimitIssue(
    issues,
    `${fieldPrefix}.expectedSchemaTypes[${index}]`,
    schemaType,
    limits.maxSchemaTypeBytes,
  ));
  if (issues.length > 0) return issues;
  addSerializedLimitIssue(issues, fieldPrefix, cell, limits.maxSerializedSourceBytes);
  return issues;
}

export function assertMatrixCellGenerationSourceWithinLimits(cell: MatrixCell): void {
  const issues = matrixCellGenerationSourceLimitIssues(cell);
  if (issues.length > 0) throw new MatrixGenerationSourceLimitError('cell', issues);
  if (cell.expectedSchemaTypes) {
    assertNormalizedMatrixGenerationSchemaTypes(cell.expectedSchemaTypes, 'expectedSchemaTypes');
  }
}

export function contentMatrixGenerationSourceLimitIssues(
  matrix: ContentMatrix,
): MatrixGenerationSourceLimitIssue[] {
  const issues = matrixGenerationDefinitionLimitIssues({
    name: matrix.name,
    templateId: matrix.templateId,
    dimensions: matrix.dimensions,
    urlPattern: matrix.urlPattern,
    keywordPattern: matrix.keywordPattern,
  });
  const cellLimit = MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells;
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    'cells',
    matrix.cells.length,
    cellLimit,
  );
  if (issues.length > 0) return issues;

  let serializedBytes = matrixGenerationSerializedBytes({
    name: matrix.name,
    templateId: matrix.templateId,
    dimensions: matrix.dimensions,
    urlPattern: matrix.urlPattern,
    keywordPattern: matrix.keywordPattern,
  }) + 16;
  for (let index = 0; index < matrix.cells.length; index += 1) {
    const cell = matrix.cells[index];
    issues.push(...matrixCellGenerationSourceLimitIssues(cell, `cells[${index}]`));
    if (issues.length > MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES) {
      issues.length = MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES;
    }
    if (issues.length >= MATRIX_GENERATION_MAX_REPORTED_LIMIT_ISSUES) break;
    serializedBytes += matrixGenerationSerializedBytes(cell) + 1;
    if (serializedBytes > MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxSerializedSourceBytes) {
      pushSourceLimitIssue(issues, {
        code: 'serialized_bytes_exceeded',
        fieldPath: 'matrixSource',
        actual: serializedBytes,
        limit: MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxSerializedSourceBytes,
      });
      break;
    }
  }
  return issues;
}

export function assertContentMatrixGenerationSourceWithinLimits(matrix: ContentMatrix): void {
  const issues = contentMatrixGenerationSourceLimitIssues(matrix);
  if (issues.length > 0) throw new MatrixGenerationSourceLimitError('matrix', issues);
  matrix.cells.forEach((cell, index) => {
    if (cell.expectedSchemaTypes) {
      assertNormalizedMatrixGenerationSchemaTypes(
        cell.expectedSchemaTypes,
        `cells[${index}].expectedSchemaTypes`,
      );
    }
  });
}

export function contentTemplateGenerationSourceLimitIssues(
  template: ContentTemplate,
): MatrixGenerationSourceLimitIssue[] {
  const limits = MATRIX_GENERATION_SOURCE_LIMITS.template;
  const issues: MatrixGenerationSourceLimitIssue[] = [];
  const cmsFieldCount = countRecordEntriesUpTo(
    template.cmsFieldMap ?? {},
    limits.maxCmsFieldMappings,
  );
  const schemaTypes = template.schemaTypes ?? [];
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    'variables',
    template.variables.length,
    limits.maxVariables,
  );
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    'sections',
    template.sections.length,
    limits.maxSections,
  );
  addCollectionLimitIssue(
    issues,
    'record_entries_exceeded',
    'cmsFieldMap',
    cmsFieldCount,
    limits.maxCmsFieldMappings,
  );
  addCollectionLimitIssue(
    issues,
    'array_items_exceeded',
    'schemaTypes',
    schemaTypes.length,
    limits.maxSchemaTypes,
  );
  if (issues.length > 0) return issues;
  addStringLimitIssue(issues, 'name', template.name, limits.maxNameBytes);
  addStringLimitIssue(issues, 'description', template.description, limits.maxDescriptionBytes);
  addStringLimitIssue(issues, 'urlPattern', template.urlPattern, limits.maxPatternBytes);
  addStringLimitIssue(issues, 'keywordPattern', template.keywordPattern, limits.maxPatternBytes);
  addStringLimitIssue(issues, 'titlePattern', template.titlePattern, limits.maxPatternBytes);
  addStringLimitIssue(issues, 'metaDescPattern', template.metaDescPattern, limits.maxPatternBytes);
  addStringLimitIssue(
    issues,
    'toneAndStyle',
    template.toneAndStyle,
    limits.maxToneAndStyleBytes,
  );

  template.variables.forEach((variable, index) => {
    addStringLimitIssue(
      issues,
      `variables[${index}].name`,
      variable.name,
      limits.maxVariableNameBytes,
    );
    addStringLimitIssue(
      issues,
      `variables[${index}].label`,
      variable.label,
      limits.maxVariableLabelBytes,
    );
    addStringLimitIssue(
      issues,
      `variables[${index}].description`,
      variable.description,
      limits.maxVariableDescriptionBytes,
    );
  });

  let totalWordCountTarget = 0;
  template.sections.forEach((section, index) => {
    addStringLimitIssue(issues, `sections[${index}].id`, section.id, limits.maxSectionIdBytes);
    addStringLimitIssue(
      issues,
      `sections[${index}].name`,
      section.name,
      limits.maxSectionNameBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].headingTemplate`,
      section.headingTemplate,
      limits.maxHeadingTemplateBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].guidance`,
      section.guidance,
      limits.maxGuidanceBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].cmsFieldSlug`,
      section.cmsFieldSlug,
      limits.maxCmsFieldKeyBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].narrativeRole`,
      section.narrativeRole,
      limits.maxSectionNoteBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].brandNote`,
      section.brandNote,
      limits.maxSectionNoteBytes,
    );
    addStringLimitIssue(
      issues,
      `sections[${index}].seoNote`,
      section.seoNote,
      limits.maxSectionNoteBytes,
    );
    if (section.wordCountTarget > limits.maxSectionWordCountTarget) {
      pushSourceLimitIssue(issues, {
        code: 'word_count_exceeded',
        fieldPath: `sections[${index}].wordCountTarget`,
        actual: section.wordCountTarget,
        limit: limits.maxSectionWordCountTarget,
      });
    }
    totalWordCountTarget += section.wordCountTarget;
  });
  if (totalWordCountTarget > limits.maxTotalWordCountTarget) {
    pushSourceLimitIssue(issues, {
      code: 'word_count_exceeded',
      fieldPath: 'sections.wordCountTarget',
      actual: totalWordCountTarget,
      limit: limits.maxTotalWordCountTarget,
    });
  }

  const cmsFieldMap = Object.entries(template.cmsFieldMap ?? {});
  cmsFieldMap.forEach(([key, value], index) => {
    addStringLimitIssue(
      issues,
      `cmsFieldMap[${index}].key`,
      key,
      limits.maxCmsFieldKeyBytes,
    );
    addStringLimitIssue(
      issues,
      `cmsFieldMap[${index}].value`,
      value,
      limits.maxCmsFieldValueBytes,
    );
  });

  schemaTypes.forEach((schemaType, index) => addStringLimitIssue(
    issues,
    `schemaTypes[${index}]`,
    schemaType,
    limits.maxSchemaTypeBytes,
  ));
  if (issues.length > 0) return issues;
  addSerializedLimitIssue(
    issues,
    'templateSource',
    {
      name: template.name,
      description: template.description,
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
    },
    limits.maxSerializedSourceBytes,
  );
  return issues;
}

export function assertContentTemplateGenerationSourceWithinLimits(
  template: ContentTemplate,
): void {
  const issues = contentTemplateGenerationSourceLimitIssues(template);
  if (issues.length > 0) throw new MatrixGenerationSourceLimitError('template', issues);
  if (template.schemaTypes) {
    assertNormalizedMatrixGenerationSchemaTypes(template.schemaTypes, 'schemaTypes');
  }
}

export function assertMatrixGenerationSerializedPayloadWithinLimit(
  sourceKind: Extract<
    MatrixGenerationSourceKind,
    'matrix_summary' | 'matrix_read_page' | 'matrix_resolve_response'
  >,
  fieldPath: string,
  value: unknown,
  limit: number,
): void {
  const issues: MatrixGenerationSourceLimitIssue[] = [];
  addSerializedLimitIssue(issues, fieldPath, value, limit);
  if (issues.length > 0) throw new MatrixGenerationSourceLimitError(sourceKind, issues);
}

export interface MatrixCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** M0 read projection upgrades the optional legacy revision to a required CAS token. */
export type ContentMatrixReadMetadata = Omit<ContentMatrix, 'cells' | 'revision'> & {
  revision: number;
  cellCount: number;
};

/** Paged matrix cells always expose the normalized durable cell revision. */
export type ContentMatrixReadCell = Omit<MatrixCell, 'revision'> & {
  revision: number;
};

export type ContentMatrixSummary = Omit<ContentMatrixReadMetadata, 'dimensions'> & {
  /** Bounded list projection; full dimension values are available only from get_content_matrix. */
  dimensionCount: number;
  templateRevision: number;
};

export interface ListContentMatricesRequest {
  workspaceId: string;
  templateId?: string;
  cursor?: string;
  limit?: number;
}

export type ListContentMatricesResult = MatrixCursorPage<ContentMatrixSummary>;

export interface GetContentMatrixRequest {
  workspaceId: string;
  matrixId: string;
  cursor?: string;
  limit?: number;
}

export interface GetContentMatrixResult {
  matrix: ContentMatrixReadMetadata;
  templateRevision: number;
  cells: MatrixCursorPage<ContentMatrixReadCell>;
}

export interface ResolveMatrixStructureSelection {
  cellId: string;
  expectedSourceRevision: MatrixSourceRevision;
}

export type ResolveMatrixStructureSelections = readonly [
  ResolveMatrixStructureSelection,
  ...ResolveMatrixStructureSelection[],
];

export interface ResolveMatrixStructuresRequest {
  workspaceId: string;
  matrixId: string;
  selections: ResolveMatrixStructureSelections;
}

export const MATRIX_GENERATION_RUN_STATUSES = GENERATION_RUN_STATUSES;
export type MatrixGenerationRunStatus = (typeof MATRIX_GENERATION_RUN_STATUSES)[number];

export const RESOLVED_PAGE_BLOCK_SOURCES = ['system', 'template'] as const;
export type ResolvedPageBlockSource = (typeof RESOLVED_PAGE_BLOCK_SOURCES)[number];

export const RESOLVED_PAGE_BLOCK_GENERATION_ROLES = [
  'introduction',
  ...TEMPLATE_SECTION_GENERATION_ROLES,
  'conclusion',
] as const;

export type ResolvedPageBlockGenerationRole =
  | 'introduction'
  | TemplateSectionGenerationRole
  | 'conclusion';

export const RESOLVED_SYSTEM_BLOCK_IDS = {
  introduction: 'system:introduction',
  conclusion: 'system:conclusion',
} as const;

export interface ResolvedPageBlockHeadingContract {
  level: 1 | 2 | 3 | 4 | 5 | 6 | null;
  renderedText: string | null;
  locked: boolean;
}

interface ResolvedPageBlockBase {
  order: number;
  heading: ResolvedPageBlockHeadingContract;
  guidance: string;
  wordCountTarget?: number;
  aeoContract: TemplateAeoContract;
  ctaContract: TemplateCtaContract;
}

export interface ResolvedSystemIntroductionBlock extends ResolvedPageBlockBase {
  id: typeof RESOLVED_SYSTEM_BLOCK_IDS.introduction;
  source: 'system';
  generationRole: 'introduction';
}

export interface ResolvedTemplatePageBlock extends ResolvedPageBlockBase {
  id: `template:${string}`;
  source: 'template';
  sourceSectionId: string;
  generationRole: TemplateSectionGenerationRole;
  optional?: boolean;
}

export interface ResolvedSystemConclusionBlock extends ResolvedPageBlockBase {
  id: typeof RESOLVED_SYSTEM_BLOCK_IDS.conclusion;
  source: 'system';
  generationRole: 'conclusion';
}

export type ResolvedPageBlock =
  | ResolvedSystemIntroductionBlock
  | ResolvedTemplatePageBlock
  | ResolvedSystemConclusionBlock;

export type ResolvedPageBlockSequence = [
  ResolvedSystemIntroductionBlock,
  ...ResolvedTemplatePageBlock[],
  ResolvedSystemConclusionBlock,
];

export interface ResolvedOptionalTemplateSectionOmission {
  sourceSectionId: string;
  name: string;
  generationRole: TemplateSectionGenerationRole;
  evidenceRequirementId: string;
  reason: 'missing_section_evidence';
}

/** Complete immutable block census, including stable system wrappers. */
export interface ResolvedPageBlockManifest {
  generationContractVersion: number;
  blocks: ResolvedPageBlockSequence;
  /** Present on manifests resolved after evidence-driven optional sections shipped. */
  omittedOptionalSections?: ResolvedOptionalTemplateSectionOmission[];
  totalWordCountTarget: number;
  fingerprint: string;
}

export interface ResolvedMatrixKeyword {
  value: string;
  source: 'target' | 'custom' | 'recommended';
  evidenceRefs: GenerationEvidenceSourceRef[];
  validation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
}

export interface ResolvedMatrixStructuralTarget {
  workspaceId: string;
  matrixId: string;
  templateId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  variableValues: Record<string, string>;
  slugSubstitutions: Record<string, string>;
  proseSubstitutions: Record<string, string>;
  targetKeyword: ResolvedMatrixKeyword;
  plannedUrl: string;
  title: string;
  metaDescription: string;
  renderedHeadings: string[];
  pageType: BriefPageType;
  schemaTypes: string[];
  blockManifest: ResolvedPageBlockManifest;
  generationContractVersion: number;
  structuralRequirements: GenerationEvidenceRequirement[];
  structuralBlockingRequirementIds: string[];
  structuralFingerprint: string;
}

export interface MatrixGenerationCostEstimate {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  maxConcurrency: number;
}

/** Caller-accepted ceilings frozen before any batch provider work starts. */
export interface MatrixGenerationBatchBudget {
  maxProviderCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedUsd: number;
  maxConcurrency: number;
}

export interface MatrixGenerationBudgetUsage {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export interface MatrixGenerationAcceptedBudget {
  estimate: MatrixGenerationCostEstimate;
  limits: MatrixGenerationBatchBudget;
  reserved: MatrixGenerationBudgetUsage;
}

export const MATRIX_GENERATION_BATCH_LIMITS = {
  maxItems: MATRIX_READ_LIMITS.maxResolveSelection,
  maxProviderCalls: 1_250,
  maxInputTokens: 25_000_000,
  maxOutputTokens: 1_000_000,
  maxEstimatedUsd: 150,
  maxConcurrency: 3,
} as const;

export const MATRIX_GENERATION_SET_FINDING_KINDS = [
  'structural',
  'prose',
  'provenance',
] as const;

export type MatrixGenerationSetFindingKind =
  (typeof MATRIX_GENERATION_SET_FINDING_KINDS)[number];

export interface MatrixGenerationSetAuditFinding {
  id: string;
  source: 'deterministic' | 'model';
  kind: MatrixGenerationSetFindingKind;
  code: string;
  severity: 'warning' | 'error';
  message: string;
  affectedItemIds: string[];
  affectedTargetIds: string[];
  requiresHumanReview: boolean;
}

export function isBlockingMatrixGenerationSetAuditFinding(
  finding: MatrixGenerationSetAuditFinding,
): boolean {
  return finding.severity === 'error' || !finding.requiresHumanReview;
}

export const MATRIX_GENERATION_SET_AUDIT_VERDICTS = [
  'passed',
  'needs_attention',
  'source_correction_required',
] as const;

export type MatrixGenerationSetAuditVerdict =
  (typeof MATRIX_GENERATION_SET_AUDIT_VERDICTS)[number];

export interface MatrixGenerationSetAuditReport {
  verdict: MatrixGenerationSetAuditVerdict;
  findings: MatrixGenerationSetAuditFinding[];
  /** One rerun is allowed after a prose-only item revision; never a second rewrite pass. */
  passCount: 1 | 2;
  modelProvenance: GenerationProvenance | null;
  auditedAt: string;
}

export interface MatrixPageApprovalEvidence {
  runId: string;
  itemId: string;
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  postId: string;
  postRevision: number;
  approvedBy: GenerationHumanReviewerAttribution;
  approvedAt: string;
}

export interface MatrixArtifactRevisionExpectations {
  brief: {
    artifactType: 'content_brief';
    artifactId: string | null;
    generationRevision: number;
  };
  post: {
    artifactType: 'generated_post';
    artifactId: string | null;
    generationRevision: number;
  };
}

/** M1-ready target; this is the first shape allowed to claim generation readiness. */
export interface MatrixGenerationPreviewTarget extends ResolvedMatrixStructuralTarget {
  voiceSnapshot: FinalizedVoiceSnapshotRef;
  identitySnapshot: ApprovedBrandDeliverableRef[];
  evidenceRequirements: GenerationEvidenceRequirement[];
  evidenceCapturedAt: string;
  evidenceFreshThrough: string;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  effectiveInputFingerprint: string;
  blockingRequirementIds: string[];
  estimatedPaidBudget: MatrixGenerationCostEstimate;
}

export interface PreviewMatrixGenerationSelection {
  cellId: string;
  expectedSourceRevision: MatrixSourceRevision;
}

export type PreviewMatrixGenerationSelections = readonly [
  PreviewMatrixGenerationSelection,
  ...PreviewMatrixGenerationSelection[],
];

export interface PreviewMatrixGenerationRequest {
  workspaceId: string;
  matrixId: string;
  selections: PreviewMatrixGenerationSelections;
}

interface MatrixGenerationPreviewIdentity {
  matrixId: string;
  templateId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
}

export type MatrixGenerationPreviewResult =
  | (MatrixGenerationPreviewIdentity & {
      status: 'ready';
      target: MatrixGenerationPreviewTarget;
    })
  | (MatrixGenerationPreviewIdentity & {
      status: 'upgrade_required';
      proposal: ContentTemplateGenerationUpgradeProposal;
    })
  | (MatrixGenerationPreviewIdentity & {
      status: 'blocked';
      omittedOptionalSections: ResolvedOptionalTemplateSectionOmission[];
      evidenceRequirements: GenerationEvidenceRequirement[];
      blockingRequirementIds: string[];
      expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
    });

export interface PreviewMatrixGenerationResult {
  results: MatrixGenerationPreviewResult[];
  /** Present only when every selected cell is ready for the paid batch. */
  estimatedBatchBudget: MatrixGenerationCostEstimate | null;
}

export interface ContentTemplateGenerationUpgradeProposal {
  templateId: string;
  expectedTemplateRevision: number;
  proposalFingerprint: string;
  generationContractVersion: number;
  blocks: ResolvedPageBlockSequence;
  blockers: GenerationEvidenceRequirement[];
}

interface MatrixStructuralResolutionIdentity {
  matrixId: string;
  templateId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
}

export type MatrixStructuralResolutionResult =
  | (MatrixStructuralResolutionIdentity & {
      status: 'resolved';
      target: ResolvedMatrixStructuralTarget;
    })
  | (MatrixStructuralResolutionIdentity & {
      status: 'upgrade_required';
      proposal: ContentTemplateGenerationUpgradeProposal;
    })
  | (MatrixStructuralResolutionIdentity & {
      status: 'blocked';
      blockers: GenerationEvidenceRequirement[];
    });

export interface ResolveMatrixStructuresResult {
  results: MatrixStructuralResolutionResult[];
}

export interface AcceptContentTemplateGenerationUpgradeRequest {
  workspaceId: string;
  templateId: string;
  expectedTemplateRevision: number;
  proposalFingerprint: string;
  decision: 'accept' | 'reject';
  idempotencyKey: string;
}

export type AcceptContentTemplateGenerationUpgradeResult =
  | {
      status: 'accepted';
      template: ContentTemplate;
      proposalFingerprint: string;
    }
  | {
      status: 'rejected';
      template: ContentTemplate;
      proposalFingerprint: string;
    };

export const MATRIX_GENERATION_ITEM_STATUSES = [
  'queued',
  'preflighting',
  'preflighted',
  'generating_brief',
  'generating_post',
  'auditing_deterministic',
  'auditing_model',
  'revising',
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
] as const;

export type MatrixGenerationItemStatus = (typeof MATRIX_GENERATION_ITEM_STATUSES)[number];

export const MATRIX_GENERATION_STAGES = [
  'preflight',
  'brief_generation',
  'post_generation',
  'deterministic_audit',
  'model_audit',
  'revision',
] as const;

export type MatrixGenerationStage = (typeof MATRIX_GENERATION_STAGES)[number];

export const MATRIX_GENERATION_ATTEMPT_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type MatrixGenerationAttemptStatus =
  (typeof MATRIX_GENERATION_ATTEMPT_STATUSES)[number];

export interface MatrixGenerationSelectionItem {
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  structuralFingerprint: string;
  previewFingerprint: string | null;
}

/** Pre-preview onboarding selection; null means preview has not been accepted yet. */
export type MatrixGenerationInputSelection = readonly [
  MatrixGenerationSelectionItem,
  ...MatrixGenerationSelectionItem[],
];

export type MatrixGenerationReadySelectionItem = Omit<
  MatrixGenerationSelectionItem,
  'previewFingerprint'
> & {
  previewFingerprint: string;
};

/** A paid generation start always addresses at least one previewed durable cell. */
export type MatrixGenerationSelection = readonly [
  MatrixGenerationReadySelectionItem,
  ...MatrixGenerationReadySelectionItem[],
];

export type MatrixGenerationEvidenceResolution = GenerationEvidenceResolution<
  MatrixSourceRevision,
  MatrixArtifactRevisionExpectations
> & {
  workspaceId: string;
  matrixId: string;
  cellId: string;
};

/** Cell-addressed mutation contract; it is valid before a generation run exists. */
export interface ResolveMatrixGenerationEvidenceRequest {
  workspaceId: string;
  matrixId: string;
  cellId: string;
  requirementId: string;
  value: GenerationEvidenceValue;
  sourceRef: GenerationEvidenceSourceRef;
  resolvedBy: GenerationResolverAttribution;
  expectedSourceRevision: MatrixSourceRevision;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  idempotencyKey: string;
}

export interface ResolveMatrixGenerationEvidenceResult {
  resolution: MatrixGenerationEvidenceResolution;
  currentSourceRevision: MatrixSourceRevision;
  created: boolean;
}

interface MatrixGenerationRunBase {
  id: string;
  workspaceId: string;
  matrixId: string;
  templateId: string;
  status: GenerationRunStatus;
  revision: number;
  selectionFingerprint: string;
  selections: MatrixGenerationSelection;
  jobId: string | null;
  acceptedBudget: MatrixGenerationAcceptedBudget | null;
  setAuditReport: MatrixGenerationSetAuditReport | null;
  counts: GenerationRunCounts;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface PublicIdentifiedMatrixGenerationCreator {
  actorId: string;
  actorLabel?: string;
}

/**
 * Public run attribution. MCP key and system identities are operational
 * credentials/implementation details, so their public branches carry only a
 * coarse actor type. Human identities remain available for review history.
 */
export type PublicMatrixGenerationCreatorAttribution =
  | (PublicIdentifiedMatrixGenerationCreator & { actorType: 'operator' })
  | (PublicIdentifiedMatrixGenerationCreator & { actorType: 'client' })
  | { actorType: 'mcp' }
  | { actorType: 'system' };

/** Public run projection safe for future HTTP and MCP read surfaces. */
export interface MatrixGenerationRun extends MatrixGenerationRunBase {
  createdBy: PublicMatrixGenerationCreatorAttribution;
}

/**
 * Internal persisted run shape. Full creator attribution and execution context
 * are operational evidence and must be projected before any public response.
 */
export interface PersistedMatrixGenerationRun extends MatrixGenerationRunBase {
  idempotencyKey: string;
  createdBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

/**
 * Repository input reserved by M0 for future M1/M3 paid starts. Structural
 * reads never create a run and must never fabricate preview fingerprints.
 */
export interface CreateMatrixGenerationRunRequest {
  workspaceId: string;
  matrixId: string;
  templateId: string;
  idempotencyKey: string;
  selectionFingerprint: string;
  selections: MatrixGenerationSelection;
  jobId?: string | null;
  acceptedBudget?: MatrixGenerationAcceptedBudget | null;
  createdBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

export interface MatrixGenerationItem {
  id: string;
  runId: string;
  workspaceId: string;
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  status: MatrixGenerationItemStatus;
  revision: number;
  /** Durable integrity identifier; safe to expose and never an authentication credential. */
  structuralFingerprint: string;
  /** Exact accepted preview identity used by retry/checkpoint decisions. */
  previewFingerprint: string;
  structuralTarget: ResolvedMatrixStructuralTarget | null;
  previewTarget: MatrixGenerationPreviewTarget | null;
  briefId: string | null;
  postId: string | null;
  auditReport: GenerationAuditReport | null;
  approvalEvidence: MatrixPageApprovalEvidence | null;
  attemptCount: number;
  automaticRevisionCount: GenerationAutomaticRevisionCount;
  error: GenerationSanitizedError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MatrixGenerationAttempt {
  id: string;
  itemId: string;
  attemptNumber: number;
  stage: MatrixGenerationStage;
  status: MatrixGenerationAttemptStatus;
  effectiveInputFingerprint: string;
  provenance: GenerationProvenance | null;
  error: GenerationSanitizedError | null;
  startedAt: string;
  completedAt: string | null;
}

export interface RetryMatrixGenerationItem {
  itemId: string;
  expectedItemRevision: number;
  sourceRevision: MatrixSourceRevision;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  reusableCheckpointFingerprint: string | null;
}

interface MatrixGenerationRetryRequestBase {
  runId: string;
  expectedRunRevision: number;
  items: [RetryMatrixGenerationItem, ...RetryMatrixGenerationItem[]];
  idempotencyKey: string;
}

export interface MatrixGenerationReplacementAuthorization {
  authorizedBy: GenerationOperatorAttribution;
  reason: string;
  authorizedAt: string;
}

export type RetryMatrixGenerationRequest =
  | (MatrixGenerationRetryRequestBase & {
      mode: 'resume';
      replacementAuthorization?: never;
    })
  | (MatrixGenerationRetryRequestBase & {
      mode: 'replace';
      replacementAuthorization: MatrixGenerationReplacementAuthorization;
    });

export interface StartMatrixGenerationSelection {
  cellId: string;
  expectedSourceRevision: MatrixSourceRevision;
  expectedPreviewFingerprint: string;
}

export type StartMatrixGenerationSelections = readonly [
  StartMatrixGenerationSelection,
  ...StartMatrixGenerationSelection[],
];

export interface StartMatrixGenerationRequest {
  workspaceId: string;
  matrixId: string;
  selections: StartMatrixGenerationSelections;
  acceptedBudget: MatrixGenerationBatchBudget;
  idempotencyKey: string;
  createdBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

export interface StartMatrixGenerationResult {
  run: MatrixGenerationRun;
  jobId: string;
  estimatedBudget: MatrixGenerationCostEstimate;
  existing: boolean;
}

export interface GetMatrixGenerationRequest {
  workspaceId: string;
  runId: string;
  cursor?: string;
  limit?: number;
}

export interface MatrixGenerationItemRead extends Omit<
  MatrixGenerationItem,
  'structuralTarget' | 'previewTarget'
> {
  target: {
    targetKeyword: string;
    plannedUrl: string;
    pageType: BriefPageType;
  } | null;
  setAuditFindings: MatrixGenerationSetAuditFinding[];
  currentArtifactRevisions: MatrixArtifactRevisionExpectations;
  reusableCheckpointFingerprint: string | null;
}

export interface GetMatrixGenerationResult {
  run: MatrixGenerationRun;
  items: MatrixCursorPage<MatrixGenerationItemRead>;
}

export type RetryMatrixGenerationCommandRequest = RetryMatrixGenerationRequest & {
  workspaceId: string;
  requestedBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
};

export interface MatrixGenerationRetryCommand {
  id: string;
  workspaceId: string;
  runId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: RetryMatrixGenerationCommandRequest;
  jobId: string;
  createdAt: string;
}

export interface RetryMatrixGenerationResult {
  run: MatrixGenerationRun;
  jobId: string;
  existing: boolean;
}

export interface ApproveMatrixPageForPublishReadinessRequest {
  workspaceId: string;
  runId: string;
  itemId: string;
  expectedRunRevision: number;
  expectedItemRevision: number;
  expectedPostRevision: number;
  approvedBy: GenerationHumanReviewerAttribution;
}

export interface ApproveMatrixPageForPublishReadinessResult {
  run: MatrixGenerationRun;
  item: MatrixGenerationItem;
  approvalEvidence: MatrixPageApprovalEvidence;
}
