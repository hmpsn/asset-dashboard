/**
 * Content Templates — CRUD operations for reusable page structures.
 *
 * Templates define sections, variable patterns, and CMS field mappings
 * used by content matrices for scalable page generation.
 */
import db from './db/index.js';
import type {
  ContentTemplate,
  ContentPageType,
  TemplateVariable,
  TemplateSection,
} from '../shared/types/content.ts';
import { createLogger } from './logger.js';
import { getSchemaTypesForTemplate } from './content-matrices.js';

const log = createLogger('content-templates');

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
  created_at: string;
  updated_at: string;
}

// ── Lazy prepared statements ──

interface TemplateStmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
}

let _stmts: TemplateStmts | null = null;
function stmts(): TemplateStmts {
  if (!_stmts) {
    _stmts = {
      insert: db.prepare(
        `INSERT INTO content_templates
           (id, workspace_id, name, description, page_type, variables, sections,
            url_pattern, keyword_pattern, title_pattern, meta_desc_pattern,
            cms_field_map, tone_and_style, schema_types, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @name, @description, @page_type, @variables, @sections,
            @url_pattern, @keyword_pattern, @title_pattern, @meta_desc_pattern,
            @cms_field_map, @tone_and_style, @schema_types, @created_at, @updated_at)`,
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
           schema_types = @schema_types, updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id`,
      ),
      deleteById: db.prepare(
        `DELETE FROM content_templates WHERE id = ? AND workspace_id = ?`,
      ),
    };
  }
  return _stmts;
}

// ── Row ↔ Interface conversion ──

function rowToTemplate(row: TemplateRow): ContentTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? undefined,
    pageType: row.page_type as ContentPageType,
    variables: JSON.parse(row.variables) as TemplateVariable[],
    sections: JSON.parse(row.sections) as TemplateSection[],
    urlPattern: row.url_pattern,
    keywordPattern: row.keyword_pattern,
    titlePattern: row.title_pattern ?? undefined,
    metaDescPattern: row.meta_desc_pattern ?? undefined,
    cmsFieldMap: row.cms_field_map ? JSON.parse(row.cms_field_map) as Record<string, string> : undefined,
    toneAndStyle: row.tone_and_style ?? undefined,
    schemaTypes: row.schema_types ? JSON.parse(row.schema_types) as string[] : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  },
): ContentTemplate {
  const now = new Date().toISOString();
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Auto-populate schemaTypes from pageType if not explicitly provided
  const resolvedPageType = data.pageType || 'service';
  const schemaTypes = data.schemaTypes ?? getSchemaTypesForTemplate(resolvedPageType);

  const template: ContentTemplate = {
    id,
    workspaceId,
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
    createdAt: now,
    updatedAt: now,
  };

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
): ContentTemplate | null {
  const existing = getTemplate(workspaceId, templateId);
  if (!existing) return null;

  // Re-derive schemaTypes from new pageType if pageType changed and schemaTypes not explicitly set
  const effectiveUpdates = { ...updates };
  if (effectiveUpdates.pageType && effectiveUpdates.pageType !== existing.pageType && !effectiveUpdates.schemaTypes) {
    const derived = getSchemaTypesForTemplate(effectiveUpdates.pageType);
    effectiveUpdates.schemaTypes = derived.length > 0 ? derived : undefined;
  }

  const merged: ContentTemplate = {
    ...existing,
    ...effectiveUpdates,
    updatedAt: new Date().toISOString(),
  };

  stmts().update.run({
    id: templateId,
    workspace_id: workspaceId,
    name: merged.name,
    description: merged.description ?? null,
    page_type: merged.pageType,
    variables: JSON.stringify(merged.variables),
    sections: JSON.stringify(merged.sections),
    url_pattern: merged.urlPattern,
    keyword_pattern: merged.keywordPattern,
    title_pattern: merged.titlePattern ?? null,
    meta_desc_pattern: merged.metaDescPattern ?? null,
    cms_field_map: merged.cmsFieldMap ? JSON.stringify(merged.cmsFieldMap) : null,
    tone_and_style: merged.toneAndStyle ?? null,
    schema_types: merged.schemaTypes ? JSON.stringify(merged.schemaTypes) : null,
    updated_at: merged.updatedAt,
  });

  log.info({ templateId, workspaceId }, 'Template updated');
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
  });
}
