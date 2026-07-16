/**
 * Content Templates — CRUD operations for reusable page structures.
 *
 * Templates define sections, variable patterns, and CMS field mappings
 * used by content matrices for scalable page generation.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { z } from './middleware/validate.js';
import {
  BRIEF_PAGE_TYPES,
  type ContentTemplate,
  type ContentPageType,
  type TemplateVariable,
  type TemplateSection,
} from '../shared/types/content.ts';
import { createLogger } from './logger.js';
import { getSchemaTypesForTemplate } from './schema/template-schema-types.js';
import { buildResolvedBlockSequence } from './domains/content/matrix-generation/block-manifest.js';
import { canonicalGenerationFingerprint } from './domains/content/matrix-generation/fingerprint.js';
import {
  getTemplateGenerationSourceCensus,
  templateGenerationSourceIsComplete,
} from './domains/content/matrix-generation/source-integrity.js';
import { renderMatrixPattern } from './domains/content/matrix-generation/renderer.js';
import {
  assertContentTemplateGenerationSourceWithinLimits,
  MATRIX_GENERATION_CONTRACT_VERSION,
  normalizeMatrixGenerationSchemaTypes,
} from '../shared/types/matrix-generation.js';

const log = createLogger('content-templates');
const generationPageTypeSet = new Set<string>(BRIEF_PAGE_TYPES);

const contentPageTypeSchema = z.enum([
  'blog', 'landing', 'service', 'location', 'product',
  'pillar', 'resource', 'provider-profile', 'procedure-guide', 'pricing-page',
  'homepage', 'about', 'contact', 'faq', 'testimonials', 'custom',
]);

const templateVariableStoredSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const templateSectionStoredSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  headingTemplate: z.string(),
  guidance: z.string(),
  wordCountTarget: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  cmsFieldSlug: z.string().optional(),
  narrativeRole: z.string().optional(),
  brandNote: z.string().optional(),
  seoNote: z.string().optional(),
  generationRole: z.enum([
    'body', 'answer_first', 'definition', 'proof', 'process', 'faq', 'cta',
  ]).optional(),
  aeoContract: z.object({
    modes: z.array(z.enum(['answer_first', 'definition', 'faq', 'paa'])),
    required: z.boolean(),
  }).optional(),
  ctaContract: z.object({
    role: z.enum(['none', 'primary', 'secondary']),
    required: z.boolean(),
  }).optional(),
  optional: z.boolean().optional(),
});

const stringRecordSchema = z.record(z.string());

// ── SQLite row shape ──

interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  page_type: string;
  variables: string;       // JSON
  sections: string;        // JSON
  url_pattern: string;
  keyword_pattern: string;
  title_pattern: string | null;
  meta_desc_pattern: string | null;
  cms_field_map: string | null;   // JSON
  tone_and_style: string | null;
  schema_types: string | null;    // JSON — auto-populated from pageType via PAGE_TYPE_SCHEMA_MAP
  revision?: number | null;
  generation_contract_version?: number | null;
  created_at: string;
  updated_at: string;
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_templates
           (id, workspace_id, name, description, page_type, variables, sections,
            url_pattern, keyword_pattern, title_pattern, meta_desc_pattern,
            cms_field_map, tone_and_style, schema_types, revision,
            generation_contract_version, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @name, @description, @page_type, @variables, @sections,
            @url_pattern, @keyword_pattern, @title_pattern, @meta_desc_pattern,
            @cms_field_map, @tone_and_style, @schema_types, @revision,
            @generation_contract_version, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_templates WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_templates WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE content_templates SET
           name = @name, description = @description, page_type = @page_type,
           variables = @variables, sections = @sections,
           url_pattern = @url_pattern, keyword_pattern = @keyword_pattern,
           title_pattern = @title_pattern, meta_desc_pattern = @meta_desc_pattern,
           cms_field_map = @cms_field_map, tone_and_style = @tone_and_style,
           schema_types = @schema_types, revision = @revision,
           generation_contract_version = @generation_contract_version,
           updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id
           AND revision = @expected_revision`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_templates WHERE id = ? AND workspace_id = ?`,
  ),
}));

// ── Row ↔ Interface conversion ──

function rowToTemplate(row: TemplateRow): ContentTemplate {
  const context = { workspaceId: row.workspace_id, table: 'content_templates' };
  const parsedPageType = contentPageTypeSchema.safeParse(row.page_type);
  const schemaTypes = parseJsonSafeArray(
    row.schema_types,
    z.string().refine(value => value.trim().length > 0, 'Schema type cannot be blank'),
    {
    ...context,
    field: 'schema_types',
    },
  );
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    revision: row.revision ?? 0,
    name: row.name,
    description: row.description ?? undefined,
    pageType: parsedPageType.success ? parsedPageType.data : 'custom',
    variables: parseJsonSafeArray(row.variables, templateVariableStoredSchema, {
      ...context,
      field: 'variables',
    }) as TemplateVariable[],
    sections: parseJsonSafeArray(row.sections, templateSectionStoredSchema, {
      ...context,
      field: 'sections',
    }) as TemplateSection[],
    urlPattern: row.url_pattern,
    keywordPattern: row.keyword_pattern,
    titlePattern: row.title_pattern ?? undefined,
    metaDescPattern: row.meta_desc_pattern ?? undefined,
    cmsFieldMap: parseJsonSafe(row.cms_field_map, stringRecordSchema, null, {
      ...context,
      field: 'cms_field_map',
    }) ?? undefined,
    toneAndStyle: row.tone_and_style ?? undefined,
    schemaTypes: schemaTypes.length > 0 ? schemaTypes : undefined,
    generationContractVersion: row.generation_contract_version ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ContentTemplateRevisionConflictError extends Error {
  readonly templateId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(templateId: string, expectedRevision: number, actualRevision: number) {
    super('Content template changed since it was read');
    this.name = 'ContentTemplateRevisionConflictError';
    this.templateId = templateId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ContentTemplateRevisionRequiredError extends Error {
  constructor() {
    super('expectedTemplateRevision is required for generation-effective template changes');
    this.name = 'ContentTemplateRevisionRequiredError';
  }
}

export class ContentTemplateGenerationContractError extends Error {
  readonly issueCodes: string[];

  constructor(issueCodes: string[]) {
    const detail = issueCodes.length > 0 ? `: ${issueCodes.join(', ')}` : '';
    super(`Content template generation contract is invalid${detail}`);
    this.name = 'ContentTemplateGenerationContractError';
    this.issueCodes = issueCodes;
  }
}

export class ContentTemplateSourceIntegrityError extends Error {
  constructor() {
    super('Content template source fields are malformed; refusing to rewrite stored data');
    this.name = 'ContentTemplateSourceIntegrityError';
  }
}

function assertTemplateGenerationContract(template: ContentTemplate): void {
  if (template.sections.length > 0 && template.sections.every(section => section.optional === true)) {
    throw new ContentTemplateGenerationContractError(['all_sections_optional']);
  }
  if (template.generationContractVersion !== MATRIX_GENERATION_CONTRACT_VERSION) return;

  const issueCodes: string[] = [];
  if (!generationPageTypeSet.has(template.pageType)) {
    issueCodes.push(`unsupported_page_type:${template.pageType}`);
  }
  if (typeof template.titlePattern !== 'string' || template.titlePattern.trim().length === 0) {
    issueCodes.push('missing_title_pattern');
  }
  if (typeof template.metaDescPattern !== 'string' || template.metaDescPattern.trim().length === 0) {
    issueCodes.push('missing_meta_description_pattern');
  }
  const variableNames = template.variables.map(variable => variable.name);
  const patternValues = Object.create(null) as Record<string, string>;
  for (const variableName of variableNames) patternValues[variableName] = variableName;
  if (typeof template.titlePattern === 'string' && template.titlePattern.trim().length > 0) {
    const renderedTitle = renderMatrixPattern(
      template.titlePattern,
      patternValues,
      'prose',
      variableNames,
    );
    if (renderedTitle.status === 'blocked') issueCodes.push('invalid_title_pattern');
  }
  if (typeof template.metaDescPattern === 'string' && template.metaDescPattern.trim().length > 0) {
    const renderedMetaDescription = renderMatrixPattern(
      template.metaDescPattern,
      patternValues,
      'prose',
      variableNames,
    );
    if (renderedMetaDescription.status === 'blocked') {
      issueCodes.push('invalid_meta_description_pattern');
    }
  }
  for (const section of template.sections) {
    if (section.ctaContract?.role === 'primary' && section.ctaContract.required !== true) {
      issueCodes.push(`primary_cta_must_be_required:${section.id}`);
    }
  }
  const result = buildResolvedBlockSequence(template.sections, {
    allowedVariableNames: variableNames,
    preserveHeadingTemplates: true,
  });
  if (result.status === 'blocked') {
    issueCodes.push(...result.issues.map(issue => (
      issue.sectionId ? `${issue.code}:${issue.sectionId}` : issue.code
    )));
  }
  if (issueCodes.length > 0) {
    throw new ContentTemplateGenerationContractError(issueCodes);
  }
}

const TEMPLATE_GENERATION_FIELDS = [
  'pageType',
  'variables',
  'sections',
  'urlPattern',
  'keywordPattern',
  'titlePattern',
  'metaDescPattern',
  'cmsFieldMap',
  'toneAndStyle',
  'schemaTypes',
  'generationContractVersion',
] as const satisfies ReadonlyArray<keyof ContentTemplate>;

function templateGenerationFieldsChanged(
  before: ContentTemplate,
  after: ContentTemplate,
): boolean {
  const projection = (template: ContentTemplate) => Object.fromEntries(
    TEMPLATE_GENERATION_FIELDS.map(field => [field, template[field]]),
  );
  return canonicalGenerationFingerprint(projection(before))
    !== canonicalGenerationFingerprint(projection(after));
}

// ── Public API ──

export function listTemplates(workspaceId: string): ContentTemplate[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function getTemplate(workspaceId: string, templateId: string): ContentTemplate | null {
  const row = stmts().selectById.get(templateId, workspaceId) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function createTemplate(
  workspaceId: string,
  data: {
    name: string;
    description?: string;
    pageType?: ContentPageType;
    variables?: TemplateVariable[];
    sections?: TemplateSection[];
    urlPattern?: string;
    keywordPattern?: string;
    titlePattern?: string;
    metaDescPattern?: string;
    cmsFieldMap?: Record<string, string>;
    toneAndStyle?: string;
    schemaTypes?: string[];
    generationContractVersion?: number;
  },
): ContentTemplate {
  const now = new Date().toISOString();
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Auto-populate schemaTypes from pageType if not explicitly provided
  const resolvedPageType = data.pageType || 'service';
  const schemaTypes = normalizeMatrixGenerationSchemaTypes(
    data.schemaTypes ?? getSchemaTypesForTemplate(resolvedPageType),
  );

  const template: ContentTemplate = {
    id,
    workspaceId,
    revision: 1,
    name: data.name,
    description: data.description,
    pageType: resolvedPageType,
    variables: data.variables || [],
    sections: data.sections || [],
    urlPattern: data.urlPattern || '',
    keywordPattern: data.keywordPattern || '',
    titlePattern: data.titlePattern,
    metaDescPattern: data.metaDescPattern,
    cmsFieldMap: data.cmsFieldMap,
    toneAndStyle: data.toneAndStyle,
    schemaTypes: schemaTypes.length > 0 ? schemaTypes : undefined,
    generationContractVersion: data.generationContractVersion,
    createdAt: now,
    updatedAt: now,
  };

  // Legacy/unversioned rows remain readable and writable until their explicit
  // upgrade is accepted. A caller claiming the v1 contract must satisfy it in
  // full before any row is persisted.
  assertContentTemplateGenerationSourceWithinLimits(template);
  assertTemplateGenerationContract(template);

  stmts().insert.run({
    id: template.id,
    workspace_id: workspaceId,
    name: template.name,
    description: template.description ?? null,
    page_type: template.pageType,
    variables: JSON.stringify(template.variables),
    sections: JSON.stringify(template.sections),
    url_pattern: template.urlPattern,
    keyword_pattern: template.keywordPattern,
    title_pattern: template.titlePattern ?? null,
    meta_desc_pattern: template.metaDescPattern ?? null,
    cms_field_map: template.cmsFieldMap ? JSON.stringify(template.cmsFieldMap) : null,
    tone_and_style: template.toneAndStyle ?? null,
    schema_types: template.schemaTypes ? JSON.stringify(template.schemaTypes) : null,
    revision: template.revision,
    generation_contract_version: template.generationContractVersion ?? null,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  });

  log.info({ templateId: id, workspaceId, name: template.name }, 'Template created');
  return template;
}

export function updateTemplate(
  workspaceId: string,
  templateId: string,
  updates: Partial<Omit<ContentTemplate, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
  options: { expectedTemplateRevision?: number } = {},
): ContentTemplate | null {
  const write = db.transaction((): ContentTemplate | null => {
    const existingRow = stmts().selectById.get(
      templateId,
      workspaceId,
    ) as TemplateRow | undefined;
    if (!existingRow) return null;
    const existing = rowToTemplate(existingRow);
    if (!templateGenerationSourceIsComplete(
      getTemplateGenerationSourceCensus(workspaceId, templateId),
      existing,
    )) {
      throw new ContentTemplateSourceIntegrityError();
    }
    const currentRevision = existing.revision ?? 0;

    // Re-derive schemaTypes from new pageType if pageType changed and schemaTypes not explicitly set
    const effectiveUpdates = { ...updates };
    const storedPageTypeIsKnown = contentPageTypeSchema.safeParse(existingRow.page_type).success;
    if (!storedPageTypeIsKnown && effectiveUpdates.pageType === 'custom') {
      // `rowToTemplate` intentionally projects an unknown future page type as
      // `custom`. The current editor submits its full read DTO, so that fallback
      // is not authoritative and must not overwrite the raw forward-compatible
      // value. A supported explicit replacement remains authoritative below.
      delete effectiveUpdates.pageType;
    }
    const schemaTypesExplicitlyProvided = updates.schemaTypes !== undefined;
    if (schemaTypesExplicitlyProvided && effectiveUpdates.schemaTypes?.length === 0) {
      effectiveUpdates.schemaTypes = undefined;
    } else if (effectiveUpdates.schemaTypes) {
      effectiveUpdates.schemaTypes = normalizeMatrixGenerationSchemaTypes(
        effectiveUpdates.schemaTypes,
      );
    }
    if (effectiveUpdates.pageType
      && effectiveUpdates.pageType !== existing.pageType
      && !schemaTypesExplicitlyProvided) {
      const derived = getSchemaTypesForTemplate(effectiveUpdates.pageType);
      effectiveUpdates.schemaTypes = derived.length > 0
        ? normalizeMatrixGenerationSchemaTypes(derived)
        : undefined;
    }

    const candidate: ContentTemplate = {
      ...existing,
      ...effectiveUpdates,
      updatedAt: new Date().toISOString(),
    };
    assertContentTemplateGenerationSourceWithinLimits(candidate);
    const generationChanged = templateGenerationFieldsChanged(existing, candidate);
    if (generationChanged && options.expectedTemplateRevision === undefined) {
      throw new ContentTemplateRevisionRequiredError();
    }
    const expectedRevision = options.expectedTemplateRevision ?? currentRevision;
    if (expectedRevision !== currentRevision) {
      throw new ContentTemplateRevisionConflictError(templateId, expectedRevision, currentRevision);
    }
    if (
      existing.generationContractVersion === MATRIX_GENERATION_CONTRACT_VERSION
      && candidate.generationContractVersion !== MATRIX_GENERATION_CONTRACT_VERSION
    ) {
      throw new ContentTemplateGenerationContractError(['generation_contract_version_downgrade']);
    }
    assertTemplateGenerationContract(candidate);
    const merged: ContentTemplate = {
      ...candidate,
      revision: generationChanged ? currentRevision + 1 : currentRevision,
    };

    const result = stmts().update.run({
      id: templateId,
      workspace_id: workspaceId,
      name: merged.name,
      description: merged.description ?? null,
      // Preserve a future page type this binary can only project as `custom`
      // unless the operator explicitly replaces it. Unrelated edits must not
      // launder forward-compatible stored data through the fallback mapper.
      page_type: effectiveUpdates.pageType === undefined
        ? existingRow.page_type
        : merged.pageType,
      variables: JSON.stringify(merged.variables),
      sections: JSON.stringify(merged.sections),
      url_pattern: merged.urlPattern,
      keyword_pattern: merged.keywordPattern,
      title_pattern: merged.titlePattern ?? null,
      meta_desc_pattern: merged.metaDescPattern ?? null,
      cms_field_map: merged.cmsFieldMap ? JSON.stringify(merged.cmsFieldMap) : null,
      tone_and_style: merged.toneAndStyle ?? null,
      schema_types: merged.schemaTypes ? JSON.stringify(merged.schemaTypes) : null,
      revision: merged.revision,
      generation_contract_version: merged.generationContractVersion ?? null,
      updated_at: merged.updatedAt,
      expected_revision: expectedRevision,
    });
    if (result.changes !== 1) {
      const actualRevision = getTemplate(workspaceId, templateId)?.revision ?? currentRevision;
      throw new ContentTemplateRevisionConflictError(templateId, expectedRevision, actualRevision);
    }

    return merged;
  });
  const merged = write.immediate();
  if (merged) log.info({ templateId, workspaceId }, 'Template updated');
  return merged;
}

export function deleteTemplate(workspaceId: string, templateId: string): boolean {
  const result = stmts().deleteById.run(templateId, workspaceId);
  if (result.changes > 0) {
    log.info({ templateId, workspaceId }, 'Template deleted');
    return true;
  }
  return false;
}

export function duplicateTemplate(workspaceId: string, templateId: string, newName?: string): ContentTemplate | null {
  const existing = getTemplate(workspaceId, templateId);
  if (!existing) return null;

  return createTemplate(workspaceId, {
    name: newName || `${existing.name} (copy)`,
    description: existing.description,
    pageType: existing.pageType,
    variables: existing.variables,
    sections: existing.sections.map(s => ({ ...s, id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` })),
    urlPattern: existing.urlPattern,
    keywordPattern: existing.keywordPattern,
    titlePattern: existing.titlePattern,
    metaDescPattern: existing.metaDescPattern,
    cmsFieldMap: existing.cmsFieldMap,
    toneAndStyle: existing.toneAndStyle,
    schemaTypes: existing.schemaTypes,
    generationContractVersion: existing.generationContractVersion,
  });
}
