// server/copy-export.ts
// Export service for CSV and copy deck generation (Phase 3 — Full Copy Pipeline)

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { ExportResult } from '../shared/types/copy-pipeline.js';
import type { SectionPlanItem, SectionType } from '../shared/types/page-strategy.js';
import type { CopySectionStatus } from '../shared/types/copy-pipeline.js';

const log = createLogger('copy-export');

// ── SQLite row shapes ──

interface BlueprintRow {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  blueprint_id: string;
  name: string;
  page_type: string;
  primary_keyword: string | null;
  section_plan_json: string;
}

interface CopySectionRow {
  id: string;
  workspace_id: string;
  entry_id: string;
  section_plan_item_id: string;
  generated_copy: string | null;
  status: string;
  ai_annotation: string | null;
}

interface CopyMetadataRow {
  id: string;
  workspace_id: string;
  entry_id: string;
  seo_title: string | null;
  meta_description: string | null;
  og_title: string | null;
  og_description: string | null;
  status: string;
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  getBlueprint: db.prepare(`
    SELECT * FROM site_blueprints WHERE id = ? AND workspace_id = ?
  `),
  getBlueprintEntries: db.prepare(`
    SELECT be.id, be.blueprint_id, be.name, be.page_type, be.primary_keyword, be.section_plan_json
    FROM blueprint_entries be
    JOIN site_blueprints sb ON sb.id = be.blueprint_id
    WHERE be.blueprint_id = ? AND sb.workspace_id = ?
    ORDER BY be.sort_order ASC
  `),
  getSectionsForEntry: db.prepare(`
    SELECT * FROM copy_sections WHERE entry_id = ? AND workspace_id = ? ORDER BY rowid ASC
  `),
  getMetadataForEntry: db.prepare(`
    SELECT * FROM copy_metadata WHERE entry_id = ? AND workspace_id = ?
  `),
}));

// ── CSV column definitions ──

// Headers matching Webflow CMS import format
const CSV_HEADERS = [
  'name',
  'page_type',
  'primary_keyword',
  'hero_headline',
  'hero_body',
  'problem_body',
  'solution_body',
  'features_benefits',
  'social_proof',
  'cta',
  'faq',
  'seo_meta',
  'content_body',
  'services_grid',
  'team_section',
  'contact_form',
  'homepage_hero',
  'about_hero',
  'location_hero',
  'provider_hero',
  'procedure_hero',
  'pricing_hero',
  'seo_title',
  'meta_description',
  'og_title',
  'og_description',
] as const;

// Map SectionType → CSV column name
const SECTION_TYPE_TO_CSV_COL: Partial<Record<SectionType, string>> = {
  'hero': 'hero_headline',
  'problem': 'problem_body',
  'solution': 'solution_body',
  'features-benefits': 'features_benefits',
  'social-proof': 'social_proof',
  'cta': 'cta',
  'faq': 'faq',
  'content-body': 'content_body',
  'contact-form': 'contact_form',
  'about-team': 'team_section',
};

// ── Helpers ──

function escapeCSV(val: string | null | undefined): string {
  if (val == null) return '';
  // Quote fields that contain comma, double-quote, or newline
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateYMD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function statusBadge(status: CopySectionStatus | string): string {
  switch (status) {
    case 'approved': return '✓';
    case 'draft': return '⟳';
    case 'revision_requested': return '⚠';
    default: return '○';
  }
}

// ── Entry fetch helpers ──

function fetchBlueprintRows(wsId: string, blueprintId: string): EntryRow[] {
  return stmts().getBlueprintEntries.all(blueprintId, wsId) as EntryRow[];
}

function filterEntryRows(rows: EntryRow[], entryIds?: string[]): EntryRow[] {
  if (!entryIds || entryIds.length === 0) return rows;
  const idSet = new Set(entryIds);
  return rows.filter(r => idSet.has(r.id));
}

// ── exportCsv ──

export function exportCsv(
  wsId: string,
  blueprintId: string,
  entryIds?: string[],
): { csv: string; filename: string } {
  log.info({ wsId, blueprintId, entryIds }, 'exportCsv called');

  const blueprint = stmts().getBlueprint.get(blueprintId, wsId) as BlueprintRow | undefined;
  if (!blueprint) {
    log.warn({ wsId, blueprintId }, 'Blueprint not found for CSV export');
  }

  const allEntries = fetchBlueprintRows(wsId, blueprintId);
  const entries = filterEntryRows(allEntries, entryIds);

  const rows: string[] = [];

  // Header row
  rows.push(CSV_HEADERS.join(','));

  for (const entry of entries) {
    const sectionPlan = parseJsonFallback<SectionPlanItem[]>(entry.section_plan_json, []);
    const sections = stmts().getSectionsForEntry.all(entry.id, wsId) as CopySectionRow[];
    const metadata = stmts().getMetadataForEntry.get(entry.id, wsId) as CopyMetadataRow | undefined;

    // Build a map: sectionPlanItemId → copy text
    const sectionMap = new Map<string, string | null>();
    for (const s of sections) {
      sectionMap.set(s.section_plan_item_id, s.generated_copy ?? null);
    }

    // Build column map initialized to empty
    const colValues: Record<string, string> = {};
    for (const h of CSV_HEADERS) {
      colValues[h] = '';
    }

    colValues['name'] = entry.name;
    colValues['page_type'] = entry.page_type;
    colValues['primary_keyword'] = entry.primary_keyword ?? '';

    // Map section plan items to CSV columns
    // We try the section_type mapping first; fall back to positional assignment
    // for section types not in the map (e.g. 'custom', 'hero' second occurrence)
    const usedCols = new Set<string>();

    for (const planItem of sectionPlan) {
      const csvCol = SECTION_TYPE_TO_CSV_COL[planItem.sectionType as SectionType];
      const copy = sectionMap.get(planItem.id) ?? '';

      if (csvCol && !usedCols.has(csvCol)) {
        colValues[csvCol] = copy;
        usedCols.add(csvCol);
      } else {
        // Second occurrence of same type, or unmapped type — try 'seo_meta' or 'hero_body'
        // for hero second occurrence (hero_headline → hero_body)
        if (planItem.sectionType === 'hero' && !usedCols.has('hero_body')) {
          colValues['hero_body'] = copy;
          usedCols.add('hero_body');
        } else if (!usedCols.has('seo_meta')) {
          colValues['seo_meta'] = copy;
          usedCols.add('seo_meta');
        }
        // Otherwise silently skip — no suitable unmapped column available
      }
    }

    // SEO metadata columns
    if (metadata) {
      colValues['seo_title'] = metadata.seo_title ?? '';
      colValues['meta_description'] = metadata.meta_description ?? '';
      colValues['og_title'] = metadata.og_title ?? '';
      colValues['og_description'] = metadata.og_description ?? '';
    }

    const csvRow = CSV_HEADERS.map(h => escapeCSV(colValues[h])).join(',');
    rows.push(csvRow);
  }

  const csv = rows.join('\n');
  const date = formatDateYMD(new Date());
  const filename = `copy-export-${blueprintId}-${date}.csv`;

  log.info({ wsId, blueprintId, entryCount: entries.length }, 'CSV export complete');

  return { csv, filename };
}

// ── exportCopyDeck ──

export function exportCopyDeck(
  wsId: string,
  blueprintId: string,
  entryIds?: string[],
): { markdown: string; filename: string } {
  log.info({ wsId, blueprintId, entryIds }, 'exportCopyDeck called');

  const blueprint = stmts().getBlueprint.get(blueprintId, wsId) as BlueprintRow | undefined;
  const blueprintName = blueprint?.name ?? blueprintId;

  const allEntries = fetchBlueprintRows(wsId, blueprintId);
  const entries = filterEntryRows(allEntries, entryIds);

  const date = formatDateYMD(new Date());
  const lines: string[] = [];

  lines.push(`# Copy Deck — ${blueprintName}`);
  lines.push(`Generated: ${date}`);
  lines.push('');

  for (const entry of entries) {
    const sectionPlan = parseJsonFallback<SectionPlanItem[]>(entry.section_plan_json, []);
    const sections = stmts().getSectionsForEntry.all(entry.id, wsId) as CopySectionRow[];
    const metadata = stmts().getMetadataForEntry.get(entry.id, wsId) as CopyMetadataRow | undefined;

    // Build lookup map: sectionPlanItemId → section row
    const sectionMap = new Map<string, CopySectionRow>();
    for (const s of sections) {
      sectionMap.set(s.section_plan_item_id, s);
    }

    lines.push('---');
    lines.push('');
    lines.push(`## ${entry.name} (${entry.page_type})`);
    if (entry.primary_keyword) {
      lines.push(`**Primary Keyword:** ${entry.primary_keyword}`);
    }
    lines.push('');

    for (const planItem of sectionPlan) {
      const section = sectionMap.get(planItem.id);
      const status = (section?.status ?? 'pending') as CopySectionStatus;
      const badge = statusBadge(status);
      const copyText = section?.generated_copy ?? '_Not yet generated_';
      const annotation = section?.ai_annotation;
      const role = planItem.narrativeRole ?? planItem.sectionType;

      lines.push(`### ${planItem.sectionType}`);
      lines.push(`**Narrative Role:** ${role}`);
      lines.push('');
      lines.push(`${badge}: ${copyText}`);
      if (annotation) {
        lines.push('');
        lines.push(`> ${annotation}`);
      }
      lines.push('');
    }

    if (metadata) {
      lines.push('[SEO Metadata]');
      if (metadata.seo_title) lines.push(`**Title:** ${metadata.seo_title}`);
      if (metadata.meta_description) lines.push(`**Meta Description:** ${metadata.meta_description}`);
      if (metadata.og_title) lines.push(`**OG Title:** ${metadata.og_title}`);
      if (metadata.og_description) lines.push(`**OG Description:** ${metadata.og_description}`);
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  const filename = `copy-deck-${blueprintId}-${date}.md`;

  log.info({ wsId, blueprintId, entryCount: entries.length }, 'Copy deck export complete');

  return { markdown, filename };
}

// ── exportToWebflow (stub) ──

export async function exportToWebflow(
  wsId: string,
  blueprintId: string,
  entryIds?: string[],
  webflowSiteId?: string,
): Promise<ExportResult> {
  log.info({ wsId, blueprintId, entryIds, webflowSiteId }, 'exportToWebflow stub called');

  return {
    success: false,
    format: 'webflow_cms',
    error:
      'Webflow CMS export requires a Webflow connection. Connect Webflow in Settings to enable this feature.',
  };
}
