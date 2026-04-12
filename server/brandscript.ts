import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { callOpenAI } from './openai-helpers.js';
import { callCreativeAI } from './content-posts-ai.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import type { Brandscript, BrandscriptSection, BrandscriptTemplate } from '../shared/types/brand-engine.js';

const log = createLogger('brandscript');

// ── Row types
interface BrandscriptRow {
  id: string; workspace_id: string; name: string; framework_type: string;
  created_at: string; updated_at: string;
}
interface SectionRow {
  id: string; brandscript_id: string; title: string; purpose: string | null;
  content: string | null; sort_order: number; created_at: string;
}
interface TemplateRow {
  id: string; name: string; description: string | null;
  sections_json: string; created_at: string;
}

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare(`SELECT * FROM brandscripts WHERE workspace_id = ? ORDER BY updated_at DESC`),
  getById: db.prepare(`SELECT * FROM brandscripts WHERE id = ? AND workspace_id = ?`),
  insert: db.prepare(`INSERT INTO brandscripts (id, workspace_id, name, framework_type, created_at, updated_at) VALUES (@id, @workspace_id, @name, @framework_type, @created_at, @updated_at)`),
  update: db.prepare(`UPDATE brandscripts SET name = @name, framework_type = @framework_type, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`),
  deleteById: db.prepare(`DELETE FROM brandscripts WHERE id = ? AND workspace_id = ?`),
  listSections: db.prepare(`SELECT * FROM brandscript_sections WHERE brandscript_id = ? ORDER BY sort_order`),
  insertSection: db.prepare(`INSERT INTO brandscript_sections (id, brandscript_id, title, purpose, content, sort_order, created_at) VALUES (@id, @brandscript_id, @title, @purpose, @content, @sort_order, @created_at)`),
  // Section updates are intentionally implemented as delete-all + re-insert inside
  // `updateBrandscriptSections` (simpler than per-field upserts for a batch UI).
  // No single-section update/delete statement is needed.
  deleteSectionsByBrandscript: db.prepare(`DELETE FROM brandscript_sections WHERE brandscript_id = ?`),
  listTemplates: db.prepare(`SELECT * FROM brandscript_templates ORDER BY name`),
  getTemplate: db.prepare(`SELECT * FROM brandscript_templates WHERE id = ?`),
  insertTemplate: db.prepare(`INSERT INTO brandscript_templates (id, name, description, sections_json, created_at) VALUES (@id, @name, @description, @sections_json, @created_at)`),
}));

function rowToBrandscript(row: BrandscriptRow): Omit<Brandscript, 'sections'> {
  return {
    id: row.id, workspaceId: row.workspace_id, name: row.name,
    frameworkType: row.framework_type, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSection(row: SectionRow): BrandscriptSection {
  return {
    id: row.id, brandscriptId: row.brandscript_id, title: row.title,
    purpose: row.purpose ?? undefined, content: row.content ?? undefined,
    sortOrder: row.sort_order, createdAt: row.created_at,
  };
}

function rowToTemplate(row: TemplateRow): BrandscriptTemplate {
  return {
    id: row.id, name: row.name, description: row.description ?? undefined,
    sections: parseJsonFallback<{ title: string; purpose: string }[]>(row.sections_json, []),
    createdAt: row.created_at,
  };
}

export function listBrandscripts(workspaceId: string): Brandscript[] {
  const rows = stmts().listByWorkspace.all(workspaceId) as BrandscriptRow[];
  return rows.map(row => {
    const base = rowToBrandscript(row);
    const sectionRows = stmts().listSections.all(row.id) as SectionRow[];
    return { ...base, sections: sectionRows.map(rowToSection) };
  });
}

export function getBrandscript(workspaceId: string, id: string): Brandscript | null {
  const row = stmts().getById.get(id, workspaceId) as BrandscriptRow | undefined;
  if (!row) return null;
  const base = rowToBrandscript(row);
  const sectionRows = stmts().listSections.all(row.id) as SectionRow[];
  return { ...base, sections: sectionRows.map(rowToSection) };
}

export function createBrandscript(
  workspaceId: string,
  name: string,
  frameworkType: string,
  sections: { title: string; purpose?: string; content?: string }[],
): Brandscript {
  const now = new Date().toISOString();
  const id = `bs_${randomUUID().slice(0, 8)}`;

  // When no sections are provided, fall back to the seeded template for the framework type.
  // The migration seeds 'tmpl_storybrand' — any registered framework uses tmpl_{frameworkType}.
  let effectiveSections = sections;
  if (effectiveSections.length === 0) {
    const templateRow = stmts().getTemplate.get(`tmpl_${frameworkType}`) as TemplateRow | undefined;
    if (templateRow) {
      const tmpl = rowToTemplate(templateRow);
      effectiveSections = tmpl.sections; // { title, purpose }[] — content will be filled by AI or user
    }
  }

  const doCreate = db.transaction((): BrandscriptSection[] => {
    stmts().insert.run({ id, workspace_id: workspaceId, name, framework_type: frameworkType, created_at: now, updated_at: now });
    return effectiveSections.map((sec, i) => {
      const secId = `bss_${randomUUID().slice(0, 8)}`;
      stmts().insertSection.run({
        id: secId, brandscript_id: id, title: sec.title,
        purpose: sec.purpose ?? null, content: sec.content ?? null,
        sort_order: i, created_at: now,
      });
      return { id: secId, brandscriptId: id, title: sec.title, purpose: sec.purpose, content: sec.content, sortOrder: i, createdAt: now };
    });
  });

  const sectionObjs = doCreate();
  log.info({ workspaceId, brandscriptId: id, frameworkType }, 'created brandscript');
  return { id, workspaceId, name, frameworkType, sections: sectionObjs, createdAt: now, updatedAt: now };
}

export function updateBrandscriptSections(
  workspaceId: string,
  brandscriptId: string,
  sections: { id?: string; title: string; purpose?: string; content?: string }[],
): Brandscript | null {
  const existing = getBrandscript(workspaceId, brandscriptId);
  if (!existing) return null;

  const now = new Date().toISOString();

  // Preserve original createdAt for sections that already exist — the batch
  // update uses a delete-and-reinsert pattern internally, so without this the
  // stored createdAt would be clobbered on every section edit even when the
  // content is unchanged. Match on section id; new sections get `now`.
  const existingCreatedAt = new Map(existing.sections.map(s => [s.id, s.createdAt]));

  const doUpdate = db.transaction((): BrandscriptSection[] => {
    stmts().deleteSectionsByBrandscript.run(brandscriptId);
    const inserted = sections.map((sec, i) => {
      const secId = sec.id || `bss_${randomUUID().slice(0, 8)}`;
      const createdAt = (sec.id && existingCreatedAt.get(sec.id)) || now;
      stmts().insertSection.run({
        id: secId, brandscript_id: brandscriptId, title: sec.title,
        purpose: sec.purpose ?? null, content: sec.content ?? null,
        sort_order: i, created_at: createdAt,
      });
      return { id: secId, brandscriptId, title: sec.title, purpose: sec.purpose, content: sec.content, sortOrder: i, createdAt };
    });
    stmts().update.run({ id: brandscriptId, workspace_id: workspaceId, name: existing.name, framework_type: existing.frameworkType, updated_at: now });
    return inserted;
  });

  const sectionObjs = doUpdate();
  return { ...existing, sections: sectionObjs, updatedAt: now };
}

export function deleteBrandscript(workspaceId: string, id: string): boolean {
  const result = stmts().deleteById.run(id, workspaceId);
  log.info({ workspaceId, brandscriptId: id }, 'deleted brandscript');
  return result.changes > 0;
}

export function listTemplates(): BrandscriptTemplate[] {
  return (stmts().listTemplates.all() as TemplateRow[]).map(rowToTemplate);
}

export function createTemplate(name: string, description: string, sections: { title: string; purpose: string }[]): BrandscriptTemplate {
  const id = `tmpl_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  stmts().insertTemplate.run({ id, name, description, sections_json: JSON.stringify(sections), created_at: now });
  return { id, name, description, sections, createdAt: now };
}

export async function importBrandscript(
  workspaceId: string,
  name: string,
  rawText: string,
): Promise<Brandscript> {
  const prompt = `You are a brand strategist. Parse the following brand document into structured sections.

For each section you identify, return:
- title: The section name (e.g., "Hook", "Character", "Problem", "Guide", "Plan", "Call to Action", "Failure", "Success")
- purpose: A one-sentence description of what this section captures
- content: The full text content of that section

If this follows the StoryBrand framework, use those section names. If it follows a different framework, use whatever section names fit the content.

Return valid JSON: { "frameworkType": "storybrand" | "custom", "sections": [{ "title": "...", "purpose": "...", "content": "..." }] }

DOCUMENT TO PARSE:
${rawText}`;

  log.info({ workspaceId }, 'importing brandscript from text');
  const result = await callOpenAI({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    feature: 'brandscript-import',
    workspaceId,
  });

  const parsed = parseJsonFallback<{ frameworkType: string; sections: { title: string; purpose: string; content: string }[] }>(result.text, { frameworkType: 'custom', sections: [] });
  return createBrandscript(workspaceId, name, parsed.frameworkType || 'custom', parsed.sections || []);
}

export async function completeBrandscript(
  workspaceId: string,
  brandscriptId: string,
): Promise<Brandscript | null> {
  const bs = getBrandscript(workspaceId, brandscriptId);
  if (!bs) return null;

  const fullContext = await buildIntelPrompt(workspaceId, ['seoContext']);
  const filledSections = bs.sections.filter(sec => sec.content?.trim());
  const emptySections = bs.sections.filter(sec => !sec.content?.trim());

  if (emptySections.length === 0) return bs;

  const filledContext = filledSections.map(sec =>
    `## ${sec.title}\n${sec.purpose ? `Purpose: ${sec.purpose}\n` : ''}${sec.content}`
  ).join('\n\n');

  const userPrompt = `Complete the following brandscript by drafting the empty sections. Be consistent with the filled sections and specific to this business — not generic.

EXISTING SECTIONS:
${filledContext}

BUSINESS CONTEXT:
${fullContext}

SECTIONS TO COMPLETE:
${emptySections.map(sec => `- "${sec.title}" (purpose: ${sec.purpose || 'not specified'})`).join('\n')}

Return valid JSON: { "sections": [{ "title": "exact title from above", "content": "your draft content" }] }`;

  const system = buildSystemPrompt(workspaceId, 'You are a brand strategist completing a brandscript. Write in a natural, compelling voice. Return only valid JSON as instructed.');

  log.info({ workspaceId, brandscriptId, emptySections: emptySections.length }, 'completing brandscript with AI');
  const text = await callCreativeAI({
    systemPrompt: system,
    userPrompt,
    maxTokens: 4000,
    temperature: 0.6,
    feature: 'brandscript-complete',
    workspaceId,
    json: true,
  });

  const parsed = parseJsonFallback<{ sections: { title: string; content: string }[] }>(text, { sections: [] });
  const updatedSections = bs.sections.map(sec => {
    if (sec.content?.trim()) return sec;
    const drafted = parsed.sections.find(d => d.title === sec.title);
    return { ...sec, content: drafted?.content || sec.content };
  });

  return updateBrandscriptSections(workspaceId, brandscriptId, updatedSections);
}
