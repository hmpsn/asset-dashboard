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
import { evaluateGoogleSchema, publishValidationFromEvaluation } from './schema/schema-validation-core.js';

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

export function validateForGoogleRichResults(schema: Record<string, unknown>): ValidationResult {
  const publish = publishValidationFromEvaluation(evaluateGoogleSchema(schema));
  return {
    status: publish.status,
    richResults: publish.richResults,
    errors: publish.errors as ValidationError[],
    warnings: publish.warnings as ValidationError[],
  };
}
