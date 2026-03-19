/**
 * Schema Queue — pre-generates lightweight schema skeletons for planned pages.
 *
 * When a matrix cell transitions to `brief_generated` or `approved`, a skeleton
 * JSON-LD schema is generated (no AI — pure template logic) and stored in the
 * `pending_schemas` table. On publish, the schema is ready to apply.
 */
import db from './db/index.js';
import { getMatrix, getSchemaTypesForTemplate } from './content-matrices.js';
import { getWorkspace } from './workspaces.js';
import { createLogger } from './logger.js';
import type { MatrixCell, ContentTemplate } from '../shared/types/content.ts';

const log = createLogger('schema-queue');

// ── SQLite row shape ──

interface PendingSchemaRow {
  id: string;
  workspace_id: string;
  matrix_id: string;
  cell_id: string;
  schema_json: string;
  status: 'pending' | 'applied' | 'stale';
  created_at: string;
  updated_at: string;
}

// ── Prepared statements (lazy) ──

interface SchemaQueueStmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectByCellId: ReturnType<typeof db.prepare>;
  updateStatus: ReturnType<typeof db.prepare>;
  markStaleByCellId: ReturnType<typeof db.prepare>;
}

let _stmts: SchemaQueueStmts | null = null;
function stmts(): SchemaQueueStmts {
  if (!_stmts) {
    _stmts = {
      insert: db.prepare(
        `INSERT OR REPLACE INTO pending_schemas
           (id, workspace_id, matrix_id, cell_id, schema_json, status, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @matrix_id, @cell_id, @schema_json, @status, @created_at, @updated_at)`,
      ),
      selectByWorkspace: db.prepare(
        `SELECT * FROM pending_schemas WHERE workspace_id = ? ORDER BY created_at DESC`,
      ),
      selectByCellId: db.prepare(
        `SELECT * FROM pending_schemas WHERE cell_id = ? AND status = 'pending' LIMIT 1`,
      ),
      updateStatus: db.prepare(
        `UPDATE pending_schemas SET status = @status, updated_at = @updated_at WHERE id = @id`,
      ),
      markStaleByCellId: db.prepare(
        `UPDATE pending_schemas SET status = 'stale', updated_at = @updated_at WHERE cell_id = @cell_id AND status = 'pending'`,
      ),
    };
  }
  return _stmts;
}

// ── Template loader (lazy import to avoid circular deps) ──

let _getTemplate: ((workspaceId: string, templateId: string) => ContentTemplate | undefined) | null = null;
async function loadGetTemplate(): Promise<typeof _getTemplate> {
  if (!_getTemplate) {
    const mod = await import('./content-templates.js');
    _getTemplate = mod.getTemplate;
  }
  return _getTemplate;
}

// ── Skeleton generator ──

/**
 * Generate a lightweight JSON-LD schema skeleton from a matrix cell and template.
 * No AI call — pure template-based generation.
 */
export function generateSchemaSkeleton(
  cell: MatrixCell,
  template: ContentTemplate,
  siteUrl: string,
): Record<string, unknown> {
  const schemaTypes = cell.expectedSchemaTypes?.length
    ? cell.expectedSchemaTypes
    : getSchemaTypesForTemplate(template.pageType);

  const pageUrl = cell.plannedUrl.startsWith('http')
    ? cell.plannedUrl
    : `${siteUrl}/${cell.plannedUrl.replace(/^\//, '')}`;

  const graph: Record<string, unknown>[] = [];

  // WebPage node
  graph.push({
    '@type': 'WebPage',
    '@id': `${pageUrl}/#webpage`,
    'url': pageUrl,
    'name': cell.targetKeyword,
    'isPartOf': { '@id': `${siteUrl}/#website` },
  });

  // BreadcrumbList placeholder (will be replaced by C1's deterministic logic on publish)
  graph.push({
    '@type': 'BreadcrumbList',
    '@id': `${pageUrl}/#breadcrumb`,
    'itemListElement': [
      {
        '@type': 'ListItem',
        'position': 1,
        'name': 'Home',
        'item': siteUrl,
      },
      {
        '@type': 'ListItem',
        'position': 2,
        'name': cell.targetKeyword,
        'item': pageUrl,
      },
    ],
  });

  // Organization reference
  graph.push({
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    'url': siteUrl,
  });

  // Primary type node based on schema types
  const primaryType = schemaTypes.find(t =>
    t !== 'WebPage' && t !== 'BreadcrumbList' && t !== 'Organization' && t !== 'WebSite',
  );

  if (primaryType) {
    const primaryNode: Record<string, unknown> = {
      '@type': primaryType,
      '@id': `${pageUrl}/#${primaryType.toLowerCase()}`,
      'url': pageUrl,
    };

    // Add type-specific fields
    if (['Article', 'BlogPosting', 'NewsArticle'].includes(primaryType)) {
      primaryNode['headline'] = cell.targetKeyword;
      primaryNode['publisher'] = { '@id': `${siteUrl}/#organization` };
    } else if (primaryType === 'Service') {
      primaryNode['name'] = cell.targetKeyword;
      primaryNode['provider'] = { '@id': `${siteUrl}/#organization` };
    } else if (primaryType === 'Product') {
      primaryNode['name'] = cell.targetKeyword;
    } else if (primaryType === 'FAQPage') {
      primaryNode['name'] = cell.targetKeyword;
    } else if (primaryType === 'CollectionPage' || primaryType === 'ItemList') {
      primaryNode['name'] = cell.targetKeyword;
    } else {
      primaryNode['name'] = cell.targetKeyword;
    }

    graph.push(primaryNode);

    // Link WebPage.mainEntity to primary type
    const webPage = graph[0];
    webPage['mainEntity'] = { '@id': primaryNode['@id'] };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

// ── Queue + CRUD operations ──

/**
 * Queue schema pre-generation for a matrix cell.
 * Loads the template, generates a skeleton, and stores it as pending.
 */
export async function queueSchemaPreGeneration(
  workspaceId: string,
  matrixId: string,
  cellId: string,
): Promise<void> {
  try {
    const matrix = getMatrix(workspaceId, matrixId);
    if (!matrix) {
      log.warn({ workspaceId, matrixId }, 'Cannot pre-generate schema — matrix not found');
      return;
    }

    const cell = matrix.cells.find(c => c.id === cellId);
    if (!cell) {
      log.warn({ matrixId, cellId }, 'Cannot pre-generate schema — cell not found');
      return;
    }

    const getTemplateFn = await loadGetTemplate();
    if (!getTemplateFn) {
      log.warn('Cannot pre-generate schema — template loader not available');
      return;
    }

    const template = getTemplateFn(workspaceId, matrix.templateId);
    if (!template) {
      log.warn({ templateId: matrix.templateId }, 'Cannot pre-generate schema — template not found');
      return;
    }

    // Use liveDomain from workspace config if available, fallback to placeholder
    const ws = getWorkspace(workspaceId);
    const siteUrl = ws?.liveDomain ? `https://${ws.liveDomain}` : 'https://example.com';

    const skeleton = generateSchemaSkeleton(cell, template, siteUrl);
    const now = new Date().toISOString();
    const id = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Mark any existing pending schemas for this cell as stale before inserting new one
    stmts().markStaleByCellId.run({
      cell_id: cellId,
      updated_at: now,
    });

    stmts().insert.run({
      id,
      workspace_id: workspaceId,
      matrix_id: matrixId,
      cell_id: cellId,
      schema_json: JSON.stringify(skeleton),
      status: 'pending',
      created_at: now,
      updated_at: now,
    });

    log.info({ id, cellId, matrixId, workspaceId }, 'Pre-generated schema skeleton for matrix cell');
  } catch (err) {
    log.error({ err, workspaceId, matrixId, cellId }, 'Failed to pre-generate schema');
  }
}

/**
 * List all pending schemas for a workspace.
 */
export function listPendingSchemas(workspaceId: string): {
  cellId: string;
  plannedUrl: string;
  schemaTypes: string[];
  status: string;
  createdAt: string;
}[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as PendingSchemaRow[];
  return rows.map(row => {
    const schema = JSON.parse(row.schema_json) as Record<string, unknown>;
    const graph = (schema['@graph'] as Record<string, unknown>[]) || [];
    const types = graph.map(n => String(n['@type'] || '')).filter(Boolean);
    const webPage = graph.find(n => n['@type'] === 'WebPage');
    const plannedUrl = (webPage?.['url'] as string) || '';
    return {
      cellId: row.cell_id,
      plannedUrl,
      schemaTypes: types,
      status: row.status,
      createdAt: row.created_at,
    };
  });
}

/**
 * Mark a pending schema as applied (called when schema is published to a page).
 */
export function markSchemaApplied(cellId: string): void {
  const row = stmts().selectByCellId.get(cellId) as PendingSchemaRow | undefined;
  if (row) {
    stmts().updateStatus.run({
      id: row.id,
      status: 'applied',
      updated_at: new Date().toISOString(),
    });
    log.info({ id: row.id, cellId }, 'Marked pending schema as applied');
  }
}

/**
 * Mark pending schemas for a cell as stale (called when keyword/URL changes).
 */
export function markSchemaStale(cellId: string): void {
  stmts().markStaleByCellId.run({
    cell_id: cellId,
    updated_at: new Date().toISOString(),
  });
  log.info({ cellId }, 'Marked pending schemas as stale for cell');
}
