import type { ContentMatrix, ContentTemplate } from '../../../../shared/types/content.js';
import db from '../../../db/index.js';
import { parseJsonFallback } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';

export interface StoredArrayCensus {
  isArray: boolean;
  itemCount: number;
  fingerprint: string | null;
}

export interface StoredObjectCensus {
  state: 'absent' | 'object' | 'invalid';
  fingerprint: string | null;
}

export interface TemplateGenerationSourceCensus {
  variables: StoredArrayCensus;
  sections: StoredArrayCensus;
  schemaTypes: StoredArrayCensus | null;
  cmsFieldMap: StoredObjectCensus;
}

export interface MatrixGenerationSourceCensus {
  matrix: {
    dimensions: StoredArrayCensus;
    cells: StoredArrayCensus;
  };
  template: TemplateGenerationSourceCensus | null;
}

interface MatrixGenerationSourceRow {
  matrix_dimensions: string;
  matrix_cells: string;
  template_exists: number;
  template_variables: string | null;
  template_sections: string | null;
  template_schema_types: string | null;
  template_cms_field_map: string | null;
}

interface TemplateGenerationSourceRow {
  variables: string;
  sections: string;
  schema_types: string | null;
  cms_field_map: string | null;
}

const stmts = createStmtCache(() => ({
  matrixSource: db.prepare(`
    SELECT
      matrix.dimensions AS matrix_dimensions,
      matrix.cells AS matrix_cells,
      CASE WHEN template.id IS NULL THEN 0 ELSE 1 END AS template_exists,
      template.variables AS template_variables,
      template.sections AS template_sections,
      template.schema_types AS template_schema_types,
      template.cms_field_map AS template_cms_field_map
    FROM content_matrices matrix
    LEFT JOIN content_templates template
      ON template.id = matrix.template_id
     AND template.workspace_id = matrix.workspace_id
    WHERE matrix.workspace_id = ?
      AND matrix.id = ?
  `),
  templateSource: db.prepare(`
    SELECT variables, sections, schema_types, cms_field_map
      FROM content_templates
     WHERE workspace_id = ?
       AND id = ?
  `),
}));

const INVALID_STORED_JSON = Symbol('invalid-stored-json');

function storedArrayCensus(raw: string | null): StoredArrayCensus {
  const parsed = parseJsonFallback<unknown>(raw, INVALID_STORED_JSON);
  return Array.isArray(parsed)
    ? {
        isArray: true,
        itemCount: parsed.length,
        fingerprint: canonicalGenerationFingerprint(parsed),
      }
    : { isArray: false, itemCount: 0, fingerprint: null };
}

function storedMatrixCellArrayCensus(raw: string | null): StoredArrayCensus {
  const parsed = parseJsonFallback<unknown>(raw, INVALID_STORED_JSON);
  if (!Array.isArray(parsed)) {
    return { isArray: false, itemCount: 0, fingerprint: null };
  }
  const normalized = parsed.map((item) => {
    if (
      typeof item !== 'object'
      || item === null
      || Array.isArray(item)
      || Object.prototype.hasOwnProperty.call(item, 'revision')
    ) {
      return item;
    }
    return { ...item, revision: 0 };
  });
  return {
    isArray: true,
    itemCount: parsed.length,
    fingerprint: canonicalGenerationFingerprint(normalized),
  };
}

function optionalStoredArrayCensus(raw: string | null): StoredArrayCensus | null {
  return raw === null ? null : storedArrayCensus(raw);
}

function storedObjectCensus(raw: string | null): StoredObjectCensus {
  if (raw === null) return { state: 'absent', fingerprint: null };
  const parsed = parseJsonFallback<unknown>(raw, INVALID_STORED_JSON);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'invalid', fingerprint: null };
  }
  return { state: 'object', fingerprint: canonicalGenerationFingerprint(parsed) };
}

function templateCensus(row: TemplateGenerationSourceRow): TemplateGenerationSourceCensus {
  return {
    variables: storedArrayCensus(row.variables),
    sections: storedArrayCensus(row.sections),
    schemaTypes: optionalStoredArrayCensus(row.schema_types),
    cmsFieldMap: storedObjectCensus(row.cms_field_map),
  };
}

export function getMatrixGenerationSourceCensus(
  workspaceId: string,
  matrixId: string,
): MatrixGenerationSourceCensus | null {
  const row = stmts().matrixSource.get(
    workspaceId,
    matrixId,
  ) as MatrixGenerationSourceRow | undefined;
  if (!row) return null;
  return {
    matrix: {
      dimensions: storedArrayCensus(row.matrix_dimensions),
      cells: storedMatrixCellArrayCensus(row.matrix_cells),
    },
    template: row.template_exists === 1
      ? templateCensus({
          variables: row.template_variables ?? '',
          sections: row.template_sections ?? '',
          schema_types: row.template_schema_types,
          cms_field_map: row.template_cms_field_map,
        })
      : null,
  };
}

export function getTemplateGenerationSourceCensus(
  workspaceId: string,
  templateId: string,
): TemplateGenerationSourceCensus | null {
  const row = stmts().templateSource.get(
    workspaceId,
    templateId,
  ) as TemplateGenerationSourceRow | undefined;
  return row ? templateCensus(row) : null;
}

function arrayMatches(
  census: StoredArrayCensus,
  hydrated: readonly unknown[],
  compareFingerprint = true,
): boolean {
  return census.isArray
    && census.itemCount === hydrated.length
    && (!compareFingerprint
      || census.fingerprint === canonicalGenerationFingerprint(hydrated));
}

export function templateGenerationSourceIsComplete(
  census: TemplateGenerationSourceCensus | null,
  template: ContentTemplate,
): boolean {
  if (!census) return false;
  const schemaTypes = template.schemaTypes ?? [];
  const schemaTypesComplete = census.schemaTypes === null
    ? schemaTypes.length === 0
    : arrayMatches(census.schemaTypes, schemaTypes);
  const cmsFieldMapComplete = census.cmsFieldMap.state === 'absent'
    ? template.cmsFieldMap === undefined
    : census.cmsFieldMap.state === 'object'
      && census.cmsFieldMap.fingerprint
        === canonicalGenerationFingerprint(template.cmsFieldMap ?? null);
  return arrayMatches(census.variables, template.variables)
    && arrayMatches(census.sections, template.sections)
    && schemaTypesComplete
    && cmsFieldMapComplete;
}

export function matrixGenerationSourceIsComplete(
  census: MatrixGenerationSourceCensus | null,
  matrix: ContentMatrix,
  template: ContentTemplate | null,
): { matrixComplete: boolean; templateComplete: boolean } {
  const matrixComplete = census !== null
    && arrayMatches(census.matrix.dimensions, matrix.dimensions)
    // The raw census normalizes only the supported legacy omission
    // (missing revision → revision=0), so every other field must survive hydration.
    && arrayMatches(census.matrix.cells, matrix.cells);
  const templateComplete = template === null
    ? census?.template === null
    : templateGenerationSourceIsComplete(census?.template ?? null, template);
  return { matrixComplete, templateComplete };
}
