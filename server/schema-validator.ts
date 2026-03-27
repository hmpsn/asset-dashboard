/**
 * Schema validation — Google-compliant rich results validator + entity consistency checker.
 *
 * Provides:
 * 1. Validation store (CRUD for schema_validations table)
 * 2. validateForGoogleRichResults() — rule-based pre-publish validator per Google's documented requirements
 * 3. validateEntityConsistency() — cross-page entity mismatch detection
 */
import db from './db/index.js';
import { randomUUID } from 'crypto';

// ── Types ──

interface ValidationError {
  type: string;
  field: string;
  message: string;
}

interface ValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: ValidationError[];
  warnings: ValidationError[];
}

interface EntityMismatch {
  field: string;
  expected: string;
  found: string;
  pageId: string;
}

interface ConsistencyResult {
  consistent: boolean;
  mismatches: EntityMismatch[];
}

// ── Validation Store (CRUD) ──

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO schema_validations (id, workspace_id, page_id, status, rich_results, errors, warnings, validated_at)
      VALUES (@id, @workspace_id, @page_id, @status, @rich_results, @errors, @warnings, datetime('now'))
      ON CONFLICT(workspace_id, page_id) DO UPDATE SET
        id = @id,
        status = @status,
        rich_results = @rich_results,
        errors = @errors,
        warnings = @warnings,
        validated_at = datetime('now')
    `);
  }
  return _upsert;
}

let _getOne: ReturnType<typeof db.prepare> | null = null;
function getOneStmt() {
  if (!_getOne) {
    _getOne = db.prepare(`SELECT * FROM schema_validations WHERE workspace_id = ? AND page_id = ?`);
  }
  return _getOne;
}

let _getAll: ReturnType<typeof db.prepare> | null = null;
function getAllStmt() {
  if (!_getAll) {
    _getAll = db.prepare(`SELECT * FROM schema_validations WHERE workspace_id = ?`);
  }
  return _getAll;
}

let _delete: ReturnType<typeof db.prepare> | null = null;
function deleteStmt() {
  if (!_delete) {
    _delete = db.prepare(`DELETE FROM schema_validations WHERE workspace_id = ? AND page_id = ?`);
  }
  return _delete;
}

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

function rowToValidation(row: ValidationRow) {
  return {
    id: row.id,
    pageId: row.page_id,
    status: row.status,
    richResults: JSON.parse(row.rich_results || '[]'),
    errors: JSON.parse(row.errors || '[]'),
    warnings: JSON.parse(row.warnings || '[]'),
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
  upsertStmt().run({
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
  const row = getOneStmt().get(workspaceId, pageId) as ValidationRow | undefined;
  if (!row) return null;
  return rowToValidation(row);
}

export function getValidations(workspaceId: string) {
  const rows = getAllStmt().all(workspaceId) as ValidationRow[];
  return rows.map(rowToValidation);
}

export function deleteValidation(workspaceId: string, pageId: string): boolean {
  const result = deleteStmt().run(workspaceId, pageId);
  return result.changes > 0;
}

// ── Google Rich Results Validator ──

// Per-type required and recommended fields, based on Google's structured data documentation.
const RICH_RESULT_RULES: Record<string, {
  required: string[];
  recommended: string[];
}> = {
  Article: {
    required: ['headline', 'datePublished', 'author', 'image'],
    recommended: ['dateModified', 'publisher', 'description'],
  },
  FAQPage: {
    required: ['mainEntity'],
    recommended: [],
  },
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHours', 'geo', 'url', 'image'],
  },
  Product: {
    required: ['name', 'offers'],
    recommended: ['image', 'description', 'brand', 'review', 'aggregateRating'],
  },
  JobPosting: {
    required: ['title', 'datePosted', 'description', 'hiringOrganization'],
    recommended: ['validThrough', 'employmentType', 'jobLocation', 'baseSalary'],
  },
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['endDate', 'description', 'image', 'offers', 'organizer'],
  },
  Recipe: {
    required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
    recommended: ['cookTime', 'prepTime', 'totalTime', 'nutrition', 'author'],
  },
  Course: {
    required: ['name', 'description', 'provider'],
    recommended: ['hasCourseInstance', 'offers'],
  },
  Review: {
    required: ['itemReviewed', 'reviewRating', 'author'],
    recommended: ['datePublished', 'reviewBody'],
  },
  BreadcrumbList: {
    required: ['itemListElement'],
    recommended: [],
  },
  WebPage: {
    required: [],
    recommended: ['name', 'description', 'dateModified'],
  },
  Organization: {
    required: ['name'],
    recommended: ['url', 'logo', 'sameAs', 'address', 'telephone'],
  },
  WebSite: {
    required: ['name', 'url'],
    recommended: ['potentialAction'],
  },
  Service: {
    required: ['name'],
    recommended: ['description', 'provider', 'areaServed', 'serviceType'],
  },
  ProfilePage: {
    required: ['mainEntity'],
    recommended: ['name', 'description'],
  },
  MedicalOrganization: {
    required: ['name', 'address'],
    recommended: ['telephone', 'medicalSpecialty', 'availableService', 'openingHours', 'image'],
  },
  FinancialService: {
    required: ['name', 'address'],
    recommended: ['telephone', 'areaServed', 'serviceType', 'openingHours', 'image'],
  },
};

// Types that qualify for Google Rich Results
const RICH_RESULT_TYPES = new Set([
  'Article', 'FAQPage', 'LocalBusiness', 'Product', 'JobPosting',
  'Event', 'Recipe', 'Course', 'Review', 'BreadcrumbList', 'Service',
  'ProfilePage', 'MedicalOrganization', 'FinancialService',
]);

function extractGraphNodes(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  const graph = schema['@graph'];
  if (Array.isArray(graph)) return graph as Array<Record<string, unknown>>;
  // Single node at top level
  if (schema['@type']) return [schema as Record<string, unknown>];
  return [];
}

function getNodeType(node: Record<string, unknown>): string {
  const t = node['@type'];
  if (typeof t === 'string') return t;
  if (Array.isArray(t) && typeof t[0] === 'string') return t[0];
  return '';
}

export function validateForGoogleRichResults(schema: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const richResults: string[] = [];

  const nodes = extractGraphNodes(schema);

  for (const node of nodes) {
    const type = getNodeType(node);
    if (!type) continue;

    const rules = RICH_RESULT_RULES[type];
    if (!rules) continue;

    // Check required fields
    for (const field of rules.required) {
      const val = node[field];
      if (val === undefined || val === null || val === '') {
        errors.push({ type, field, message: `Missing required property "${field}" for ${type}` });
      }
    }

    // Check recommended fields
    for (const field of rules.recommended) {
      const val = node[field];
      if (val === undefined || val === null || val === '') {
        warnings.push({ type, field, message: `Missing recommended property "${field}" for ${type}` });
      }
    }

    // Rich result eligibility
    if (RICH_RESULT_TYPES.has(type)) {
      const hasRequiredErrors = errors.some(e => e.type === type);
      if (!hasRequiredErrors) {
        richResults.push(type);
      }
    }
  }

  const status: 'valid' | 'warnings' | 'errors' =
    errors.length > 0 ? 'errors' :
    warnings.length > 0 ? 'warnings' :
    'valid';

  return { status, richResults, errors, warnings };
}

// ── Entity Consistency Checker ──

const CONSISTENCY_FIELDS = ['name', 'url', 'telephone', 'logo', 'address', 'sameAs'];

export function validateEntityConsistency(
  schemas: Array<{ pageId: string; schema: Record<string, unknown> }>
): ConsistencyResult {
  const mismatches: EntityMismatch[] = [];

  // Gather all Organization nodes across pages
  const orgEntries: Array<{ pageId: string; node: Record<string, unknown> }> = [];

  for (const { pageId, schema } of schemas) {
    const nodes = extractGraphNodes(schema);
    for (const node of nodes) {
      const type = getNodeType(node);
      if (type === 'Organization' || type === 'LocalBusiness' || type === 'MedicalOrganization' || type === 'FinancialService') {
        orgEntries.push({ pageId, node });
      }
    }
  }

  if (orgEntries.length <= 1) {
    return { consistent: true, mismatches: [] };
  }

  // Use first occurrence as canonical reference
  const canonical = orgEntries[0];

  for (let i = 1; i < orgEntries.length; i++) {
    const entry = orgEntries[i];
    for (const field of CONSISTENCY_FIELDS) {
      const expected = canonical.node[field];
      const found = entry.node[field];
      if (expected !== undefined && found !== undefined) {
        const expStr = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
        const fndStr = typeof found === 'object' ? JSON.stringify(found) : String(found);
        if (expStr !== fndStr) {
          mismatches.push({
            field,
            expected: expStr,
            found: fndStr,
            pageId: entry.pageId,
          });
        }
      }
    }
  }

  return {
    consistent: mismatches.length === 0,
    mismatches,
  };
}
