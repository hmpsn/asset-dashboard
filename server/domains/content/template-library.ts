import { z } from 'zod';
import type {
  ContentTemplate,
  ContentTemplateLibraryItem,
  ContentTemplateLibrarySummary,
} from '../../../shared/types/content.js';
import { MATRIX_GENERATION_CONTRACT_VERSION } from '../../../shared/types/matrix-generation.js';
import db from '../../db/index.js';
import { parseJsonSafe } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import {
  contentPageTypeStoredSchema,
  copyTemplateIntoWorkspace,
  getTemplate,
  stringRecordStoredSchema,
  templateSectionStoredSchema,
  templateVariableStoredSchema,
} from '../../content-templates.js';

const VERTICAL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const librarySnapshotSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pageType: contentPageTypeStoredSchema,
  variables: z.array(templateVariableStoredSchema),
  sections: z.array(templateSectionStoredSchema),
  urlPattern: z.string(),
  keywordPattern: z.string(),
  titlePattern: z.string().optional(),
  metaDescPattern: z.string().optional(),
  cmsFieldMap: stringRecordStoredSchema.optional(),
  toneAndStyle: z.string().optional(),
  schemaTypes: z.array(z.string().min(1)).optional(),
  generationContractVersion: z.number().int().positive(),
});

type LibrarySnapshot = z.infer<typeof librarySnapshotSchema>;

interface LibraryRow {
  id: string;
  vertical: string;
  name: string;
  page_type: string;
  snapshot: string;
  source_workspace_id: string;
  source_template_id: string;
  source_template_revision: number;
  created_at: string;
}

export interface ContentTemplateLibraryCursor {
  createdAt: string;
  id: string;
}

export type ContentTemplateLibraryErrorCode =
  | 'not_found'
  | 'conflict'
  | 'precondition_failed';

export class ContentTemplateLibraryError extends Error {
  readonly code: ContentTemplateLibraryErrorCode;
  readonly fieldPath: string;
  readonly constraint: string;
  readonly actualRevision?: number;

  constructor(
    code: ContentTemplateLibraryErrorCode,
    message: string,
    fieldPath: string,
    constraint: string,
    actualRevision?: number,
  ) {
    super(message);
    this.name = 'ContentTemplateLibraryError';
    this.code = code;
    this.fieldPath = fieldPath;
    this.constraint = constraint;
    this.actualRevision = actualRevision;
  }
}

const stmts = createStmtCache(() => ({
  selectById: db.prepare('SELECT * FROM content_template_library WHERE id = ?'),
  selectBySource: db.prepare(`
    SELECT * FROM content_template_library
    WHERE source_workspace_id = ? AND source_template_id = ? AND source_template_revision = ?
  `),
  insert: db.prepare(`
    INSERT INTO content_template_library (
      id, vertical, name, page_type, snapshot,
      source_workspace_id, source_template_id, source_template_revision, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listAll: db.prepare(`
    SELECT * FROM content_template_library
    WHERE created_at < ? OR (created_at = ? AND id > ?)
    ORDER BY created_at DESC, id ASC
    LIMIT ?
  `),
  listByVertical: db.prepare(`
    SELECT * FROM content_template_library
    WHERE vertical = ? AND (created_at < ? OR (created_at = ? AND id > ?))
    ORDER BY created_at DESC, id ASC
    LIMIT ?
  `),
  workspaceExists: db.prepare('SELECT 1 FROM workspaces WHERE id = ?'),
}));

function assertVertical(vertical: string): void {
  if (vertical.length > 64 || !VERTICAL_PATTERN.test(vertical)) {
    throw new ContentTemplateLibraryError(
      'precondition_failed',
      'Template library vertical must be a lowercase slug.',
      'vertical',
      'must be 1-64 lowercase letters, numbers, or single hyphens',
    );
  }
}

function snapshotFromTemplate(template: ContentTemplate): LibrarySnapshot {
  return {
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
    generationContractVersion: template.generationContractVersion
      ?? MATRIX_GENERATION_CONTRACT_VERSION,
  };
}

function rowToLibraryItem(row: LibraryRow): ContentTemplateLibraryItem {
  const snapshot = parseJsonSafe(row.snapshot, librarySnapshotSchema, null, {
    workspaceId: row.source_workspace_id,
    table: 'content_template_library',
    field: 'snapshot',
  });
  if (!snapshot) {
    throw new ContentTemplateLibraryError(
      'precondition_failed',
      'The stored library template snapshot is invalid.',
      'library_template_id',
      'must identify a readable immutable template snapshot',
    );
  }
  return {
    id: row.id,
    vertical: row.vertical,
    ...snapshot,
    source: {
      workspaceId: row.source_workspace_id,
      templateId: row.source_template_id,
      templateRevision: row.source_template_revision,
    },
    createdAt: row.created_at,
  };
}

function summarize(item: ContentTemplateLibraryItem): ContentTemplateLibrarySummary {
  return {
    id: item.id,
    vertical: item.vertical,
    name: item.name,
    description: item.description,
    pageType: item.pageType,
    variableCount: item.variables.length,
    sectionCount: item.sections.length,
    source: item.source,
    createdAt: item.createdAt,
  };
}

export function getLibraryTemplate(libraryTemplateId: string): ContentTemplateLibraryItem | null {
  const row = stmts().selectById.get(libraryTemplateId) as LibraryRow | undefined;
  return row ? rowToLibraryItem(row) : null;
}

export function listLibraryTemplates(input: {
  vertical?: string;
  cursor?: ContentTemplateLibraryCursor;
  limit: number;
}): { items: ContentTemplateLibrarySummary[]; hasMore: boolean } {
  if (input.vertical) assertVertical(input.vertical);
  const createdAt = input.cursor?.createdAt ?? '9999-12-31T23:59:59.999Z';
  const id = input.cursor?.id ?? '';
  const rows = input.vertical
    ? stmts().listByVertical.all(input.vertical, createdAt, createdAt, id, input.limit + 1)
    : stmts().listAll.all(createdAt, createdAt, id, input.limit + 1);
  const typedRows = rows as LibraryRow[];
  return {
    items: typedRows.slice(0, input.limit).map(rowToLibraryItem).map(summarize),
    hasMore: typedRows.length > input.limit,
  };
}

export function promoteTemplateToLibrary(input: {
  sourceWorkspaceId: string;
  templateId: string;
  expectedTemplateRevision: number;
  vertical: string;
}): { template: ContentTemplateLibraryItem; replayed: boolean } {
  assertVertical(input.vertical);
  const existingRow = stmts().selectBySource.get(
    input.sourceWorkspaceId,
    input.templateId,
    input.expectedTemplateRevision,
  ) as LibraryRow | undefined;
  if (existingRow) {
    const existing = rowToLibraryItem(existingRow);
    if (existing.vertical !== input.vertical) {
      throw new ContentTemplateLibraryError(
        'conflict',
        'This exact template revision is already promoted under another vertical.',
        'vertical',
        `must equal the existing vertical ${existing.vertical}`,
      );
    }
    return { template: existing, replayed: true };
  }

  const source = getTemplate(input.sourceWorkspaceId, input.templateId);
  if (!source) {
    throw new ContentTemplateLibraryError(
      'not_found',
      'The source content template was not found in the selected workspace.',
      'template_id',
      'must identify an existing content template in source_workspace_id',
    );
  }
  const actualRevision = source.revision ?? 0;
  if (actualRevision !== input.expectedTemplateRevision) {
    throw new ContentTemplateLibraryError(
      'conflict',
      'The source content template changed since it was read.',
      'expected_template_revision',
      'must equal the current source template revision',
      actualRevision,
    );
  }
  if (source.generationContractVersion !== MATRIX_GENERATION_CONTRACT_VERSION) {
    throw new ContentTemplateLibraryError(
      'precondition_failed',
      'Only generation-ready content templates can be promoted to the studio library.',
      'template_id',
      `must use generation contract version ${MATRIX_GENERATION_CONTRACT_VERSION}`,
    );
  }

  const id = `libtpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const snapshot = snapshotFromTemplate(source);
  const serializedSnapshot = JSON.stringify(snapshot);
  try {
    stmts().insert.run(
      id,
      input.vertical,
      snapshot.name,
      snapshot.pageType,
      serializedSnapshot,
      input.sourceWorkspaceId,
      input.templateId,
      actualRevision,
      createdAt,
    );
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
    if (code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    const concurrentRow = stmts().selectBySource.get(
      input.sourceWorkspaceId,
      input.templateId,
      actualRevision,
    ) as LibraryRow | undefined;
    if (!concurrentRow) throw error;
    const concurrent = rowToLibraryItem(concurrentRow);
    if (concurrent.vertical !== input.vertical) {
      throw new ContentTemplateLibraryError(
        'conflict',
        'This exact template revision is already promoted under another vertical.',
        'vertical',
        `must equal the existing vertical ${concurrent.vertical}`,
      );
    }
    return { template: concurrent, replayed: true };
  }
  return {
    template: rowToLibraryItem({
      id,
      vertical: input.vertical,
      name: snapshot.name,
      page_type: snapshot.pageType,
      snapshot: serializedSnapshot,
      source_workspace_id: input.sourceWorkspaceId,
      source_template_id: input.templateId,
      source_template_revision: actualRevision,
      created_at: createdAt,
    }),
    replayed: false,
  };
}

export function instantiateLibraryTemplate(input: {
  targetWorkspaceId: string;
  libraryTemplateId: string;
  name?: string;
}): ContentTemplate {
  const workspace = stmts().workspaceExists.get(input.targetWorkspaceId);
  if (!workspace) {
    throw new ContentTemplateLibraryError(
      'not_found',
      'The target workspace was not found.',
      'target_workspace_id',
      'must identify an existing workspace',
    );
  }
  const source = getLibraryTemplate(input.libraryTemplateId);
  if (!source) {
    throw new ContentTemplateLibraryError(
      'not_found',
      'The requested library template was not found.',
      'library_template_id',
      'must identify an existing studio library template',
    );
  }
  return copyTemplateIntoWorkspace(
    input.targetWorkspaceId,
    source,
    input.name ?? source.name,
  );
}
