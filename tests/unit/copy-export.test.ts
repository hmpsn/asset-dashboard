import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { exportCopyDeck, exportCsv } from '../../server/copy-export.js';
import type { SectionPlanItem } from '../../shared/types/page-strategy.js';

describe('copy-export service', () => {
  let workspaceId = '';
  let blueprintId = '';
  let firstEntryId = '';
  let secondEntryId = '';

  const sectionPlan: SectionPlanItem[] = [
    { id: 'sp_export_hero', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 60, order: 0 },
    { id: 'sp_export_body', sectionType: 'content-body', narrativeRole: 'guide', wordCountTarget: 180, order: 1 },
    { id: 'sp_export_cta', sectionType: 'cta', narrativeRole: 'call-to-action', wordCountTarget: 40, order: 2 },
  ];

  beforeEach(() => {
    const suffix = randomUUID().slice(0, 8);
    workspaceId = `ws_copy_export_${suffix}`;
    blueprintId = `bp_copy_export_${suffix}`;
    firstEntryId = `entry_export_a_${suffix}`;
    secondEntryId = `entry_export_b_${suffix}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO workspaces (id, name, folder, tier, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspaceId, 'Copy Export Test', `copy-export-${suffix}`, 'free', now);

    db.prepare(`
      INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'draft', ?, ?)
    `).run(blueprintId, workspaceId, 'Growth Pages', now, now);

    const insertEntry = db.prepare(`
      INSERT INTO blueprint_entries (
        id, blueprint_id, name, page_type, scope, sort_order, is_collection,
        primary_keyword, section_plan_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'included', ?, 0, ?, ?, ?, ?)
    `);
    insertEntry.run(firstEntryId, blueprintId, 'Emergency Plumbing', 'service', 0, 'emergency plumber', JSON.stringify(sectionPlan), now, now);
    insertEntry.run(secondEntryId, blueprintId, 'Drain Cleaning', 'service', 1, 'drain cleaning', JSON.stringify(sectionPlan), now, now);

    const insertSection = db.prepare(`
      INSERT INTO copy_sections (
        id, workspace_id, entry_id, section_plan_item_id, generated_copy,
        status, ai_annotation, ai_reasoning, steering_history, version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `);
    insertSection.run(`cs_hero_${suffix}`, workspaceId, firstEntryId, 'sp_export_hero', '=Call now', 'approved', 'Strong urgency.', 'Reasoning', 1, now, now);
    insertSection.run(`cs_body_${suffix}`, workspaceId, firstEntryId, 'sp_export_body', 'Line one, "quoted" line two', 'draft', null, null, 1, now, now);
    insertSection.run(`cs_cta_${suffix}`, workspaceId, firstEntryId, 'sp_export_cta', null, 'pending', null, null, 0, now, now);
    insertSection.run(`cs_second_${suffix}`, workspaceId, secondEntryId, 'sp_export_hero', 'Second entry hero', 'draft', null, null, 1, now, now);

    db.prepare(`
      INSERT INTO copy_metadata (
        id, workspace_id, entry_id, seo_title, meta_description, og_title, og_description,
        status, steering_history, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', '[]', ?, ?)
    `).run(
      `cm_${suffix}`,
      workspaceId,
      firstEntryId,
      'Emergency Plumbing | Test',
      'Fast help for urgent plumbing repairs.',
      'Emergency Plumbing',
      'Same-day plumbing support.',
      now,
      now,
    );
  });

  afterEach(() => {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  });

  it('exports selected entries only and escapes CSV-sensitive copy', () => {
    const { csv, filename } = exportCsv(workspaceId, blueprintId, [firstEntryId]);

    const rows = csv.split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('hero_headline');
    expect(rows[1]).toContain('Emergency Plumbing');
    expect(rows[1]).not.toContain('Drain Cleaning');
    expect(rows[1]).toContain("'=Call now");
    expect(rows[1]).toContain('"Line one, ""quoted"" line two"');
    expect(rows[1]).toContain('Emergency Plumbing | Test');
    expect(filename).toMatch(/^copy-export-bp_copy_export_.+-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('exports all entries when no entry filter is provided', () => {
    const { csv } = exportCsv(workspaceId, blueprintId);

    expect(csv).toContain('Emergency Plumbing');
    expect(csv).toContain('Drain Cleaning');
  });

  it('builds a copy deck with placeholders, annotations, and metadata', () => {
    const { markdown, filename } = exportCopyDeck(workspaceId, blueprintId, [firstEntryId]);

    expect(markdown).toContain('# Copy Deck');
    expect(markdown).toContain('## Emergency Plumbing (service)');
    expect(markdown).toContain('Primary Keyword:** emergency plumber');
    expect(markdown).toContain('=Call now');
    expect(markdown).toContain('> Strong urgency.');
    expect(markdown).toContain('_Not yet generated_');
    expect(markdown).toContain('[SEO Metadata]');
    expect(markdown).toContain('Emergency Plumbing | Test');
    expect(markdown).not.toContain('Drain Cleaning');
    expect(filename).toMatch(/^copy-deck-bp_copy_export_.+-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
