/**
 * Schema validation — Google-compliant rich results validator.
 *
 * Provides:
 * 1. Validation store (CRUD for schema_validations table)
 * 2. validateForGoogleRichResults() — rule-based pre-publish validator per Google's documented requirements
 */
import db from './db/index.js';
import { randomUUID } from 'crypto';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { GOOGLE_RICH_RESULT_RULES, GOOGLE_RICH_RESULT_TYPES } from './schema/google-rich-result-rules.js';

// ── Types ──

interface ValidationError {
  type: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: ValidationError[];
  warnings: ValidationError[];
}

// ── Validation Store (CRUD) ──

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
    VALUES (@id, @workspace_id, @page_id, @status, @rich_results, @errors, @warnings, datetime('now'))
    ON CONFLICT(workspace_id, page_id) DO UPDATE SET
      id = @id,
      status = @status,
      rich_results = @rich_results,
      errors = @errors,
      warnings = @warnings,
      validated_at = datetime('now')
  `),
  getOne: db.prepare<[workspaceId: string, pageId: string]>(
    `SELECT * FROM schema_validations WHERE workspace_id = ? AND page_id = ?`,
  ),
  getAll: db.prepare<[workspaceId: string]>(
    `SELECT * FROM schema_validations WHERE workspace_id = ?`,
  ),
  delete: db.prepare<[workspaceId: string, pageId: string]>(
    `DELETE FROM schema_validations WHERE workspace_id = ? AND page_id = ?`,
  ),
}));

interface ValidationRow {
  id: string;
  workspace_id: string;
  page_id: string;
  status: string;
  rich_results: string;
  errors: string;
  warnings: string;
  validated_at: string;
}

export interface SchemaValidation {
  id: string;
  pageId: string;
  status: string;
  richResults: unknown[];
  errors: unknown[];
  warnings: unknown[];
  validatedAt: string;
}

function rowToValidation(row: ValidationRow): SchemaValidation {
  return {
    id: row.id,
    pageId: row.page_id,
    status: row.status,
    richResults: parseJsonFallback(row.rich_results, []),
    errors: parseJsonFallback(row.errors, []),
    warnings: parseJsonFallback(row.warnings, []),
    validatedAt: row.validated_at,
  };
}

export function upsertValidation(opts: {
  workspaceId: string;
  pageId: string;
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
}) {
  const id = randomUUID();
  stmts().upsert.run({
    id,
    workspace_id: opts.workspaceId,
    page_id: opts.pageId,
    status: opts.status,
    rich_results: JSON.stringify(opts.richResults),
    errors: JSON.stringify(opts.errors),
    warnings: JSON.stringify(opts.warnings),
  });
  return { id };
}

export function getValidation(workspaceId: string, pageId: string) {
  const row = stmts().getOne.get(workspaceId, pageId) as ValidationRow | undefined;
  if (!row) return null;
  return rowToValidation(row);
}

export function getValidations(workspaceId: string) {
  const rows = stmts().getAll.all(workspaceId) as ValidationRow[];
  return rows.map(rowToValidation);
}

export function deleteValidation(workspaceId: string, pageId: string): boolean {
  const result = stmts().delete.run(workspaceId, pageId);
  return result.changes > 0;
}

// ── Google Rich Results Validator ──

// Per-type required and recommended fields, based on Google's structured data documentation.
const RICH_RESULT_RULES = GOOGLE_RICH_RESULT_RULES;
const RICH_RESULT_TYPES = GOOGLE_RICH_RESULT_TYPES;

function extractGraphNodes(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  const graph = schema['@graph'];
  if (Array.isArray(graph)) return graph as Array<Record<string, unknown>>;
  // Single node at top level
  if (schema['@type']) return [schema as Record<string, unknown>];
  return [];
}

function getNodeTypes(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((v): v is string => typeof v === 'string');
  return [];
}

function hasCompletePostalAddress(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const address = value as Record<string, unknown>;
  if (address['@type'] !== 'PostalAddress') return false;
  return ['streetAddress', 'addressLocality', 'addressRegion'].every(field =>
    typeof address[field] === 'string' && address[field].trim().length > 0);
}

function hasSchemaField(node: Record<string, unknown>, field: string): boolean {
  const value = field === 'openingHours'
    ? node.openingHours ?? node.openingHoursSpecification
    : node[field];
  if (field === 'address') return hasCompletePostalAddress(value);
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function validateForGoogleRichResults(schema: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const richResults: string[] = [];

  const nodes = extractGraphNodes(schema);

  for (const node of nodes) {
    const types = getNodeTypes(node);
    if (types.length === 0) continue;

    // Track errors/warnings per node across all its types to avoid duplicates
    const seenErrorFields = new Set<string>();
    const seenWarningFields = new Set<string>();
    const nodeErrors: ValidationError[] = [];

    for (const type of types) {
      const rules = RICH_RESULT_RULES[type];
      if (!rules) continue;

      // Check required fields
      for (const field of rules.required) {
        if (seenErrorFields.has(field)) continue;
        if (!hasSchemaField(node, field)) {
          seenErrorFields.add(field);
          nodeErrors.push({ type, field, message: `Missing required property "${field}" for ${type}` });
        }
      }

      // Check recommended fields
      for (const field of rules.recommended) {
        if (seenWarningFields.has(field)) continue;
        if (!hasSchemaField(node, field)) {
          seenWarningFields.add(field);
          warnings.push({ type, field, message: `Missing recommended property "${field}" for ${type}` });
        }
      }

      // Rich result eligibility: type is eligible if ALL its required fields are present
      const typeRules = RICH_RESULT_RULES[type];
      const typeMissingRequired = typeRules ? typeRules.required.some(field => {
        return !hasSchemaField(node, field);
      }) : false;
      if (RICH_RESULT_TYPES.has(type) && !typeMissingRequired) {
        richResults.push(type);
      }
    }

    errors.push(...nodeErrors);
  }

  const status: 'valid' | 'warnings' | 'errors' =
    errors.length > 0 ? 'errors' :
    warnings.length > 0 ? 'warnings' :
    'valid';

  return { status, richResults, errors, warnings };
}
