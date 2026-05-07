import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../../server/content-templates.js';

const WS_ID = `ws_content_templates_${Date.now()}`;
const OTHER_WS_ID = `ws_content_templates_other_${Date.now()}`;

function cleanup(workspaceId: string): void {
  db.prepare('DELETE FROM content_templates WHERE workspace_id = ?').run(workspaceId);
}

function createServiceTemplate(overrides: Partial<Parameters<typeof createTemplate>[1]> = {}) {
  return createTemplate(WS_ID, {
    name: 'Service Location Template',
    description: 'Reusable local service page',
    pageType: 'service',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'city', label: 'City' },
    ],
    sections: [
      {
        id: 'section-hero',
        name: 'Hero',
        headingTemplate: '{service} in {city}',
        guidance: 'Open with the local outcome.',
        wordCountTarget: 120,
        order: 0,
        cmsFieldSlug: 'hero',
      },
    ],
    urlPattern: '/services/{city}/{service}',
    keywordPattern: '{service} in {city}',
    titlePattern: '{service} in {city}',
    metaDescPattern: 'Book {service} in {city}.',
    cmsFieldMap: { hero: 'main_heading' },
    toneAndStyle: 'Clear and consultative',
    ...overrides,
  });
}

beforeEach(() => {
  cleanup(WS_ID);
  cleanup(OTHER_WS_ID);
});

describe('content-templates store', () => {
  it('creates, retrieves, lists, and deletes templates scoped to a workspace', () => {
    expect(listTemplates(WS_ID)).toEqual([]);

    const template = createServiceTemplate();

    expect(template.id).toMatch(/^tpl_/);
    expect(template.workspaceId).toBe(WS_ID);
    expect(template.schemaTypes).toContain('Service');
    expect(template.cmsFieldMap).toEqual({ hero: 'main_heading' });
    expect(getTemplate(WS_ID, template.id)?.name).toBe('Service Location Template');
    expect(getTemplate(OTHER_WS_ID, template.id)).toBeNull();
    expect(listTemplates(WS_ID).map(item => item.id)).toEqual([template.id]);

    expect(deleteTemplate(OTHER_WS_ID, template.id)).toBe(false);
    expect(deleteTemplate(WS_ID, template.id)).toBe(true);
    expect(getTemplate(WS_ID, template.id)).toBeNull();
  });

  it('updates only provided fields and re-derives schema types when page type changes', () => {
    const template = createServiceTemplate();

    const updated = updateTemplate(WS_ID, template.id, {
      name: 'Blog Template',
      pageType: 'blog',
      description: undefined,
      variables: [{ name: 'topic', label: 'Topic' }],
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Blog Template');
    expect(updated!.description).toBeUndefined();
    expect(updated!.pageType).toBe('blog');
    expect(updated!.schemaTypes).toContain('BlogPosting');
    expect(updated!.sections).toEqual(template.sections);
    expect(updated!.urlPattern).toBe('/services/{city}/{service}');
    expect(updated!.updatedAt >= template.updatedAt).toBe(true);
  });

  it('preserves explicit schema types when the page type changes', () => {
    const template = createServiceTemplate({ schemaTypes: ['CustomSchema'] });

    const updated = updateTemplate(WS_ID, template.id, {
      pageType: 'landing',
      schemaTypes: ['LandingPage', 'FAQPage'],
    });

    expect(updated?.schemaTypes).toEqual(['LandingPage', 'FAQPage']);
  });

  it('duplicates a template with copied fields and fresh section ids', () => {
    const template = createServiceTemplate();

    const copy = duplicateTemplate(WS_ID, template.id, 'Service Location Copy');

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(template.id);
    expect(copy!.name).toBe('Service Location Copy');
    expect(copy!.variables).toEqual(template.variables);
    expect(copy!.sections).toHaveLength(1);
    expect(copy!.sections[0]).toMatchObject({
      name: 'Hero',
      headingTemplate: '{service} in {city}',
      cmsFieldSlug: 'hero',
    });
    expect(copy!.sections[0].id).not.toBe(template.sections[0].id);
    expect(duplicateTemplate(WS_ID, 'missing-template')).toBeNull();
  });

  it('falls back safely when stored JSON fields are malformed', () => {
    db.prepare(`
      INSERT INTO content_templates
        (id, workspace_id, name, description, page_type, variables, sections,
         url_pattern, keyword_pattern, title_pattern, meta_desc_pattern,
         cms_field_map, tone_and_style, schema_types, created_at, updated_at)
      VALUES
        ('tpl_malformed_json', ?, 'Malformed', null, 'service', '{bad json', '{bad json',
         '', '', null, null, '{bad json', null, '{bad json', ?, ?)
    `).run(WS_ID, '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z');

    const template = getTemplate(WS_ID, 'tpl_malformed_json');

    expect(template?.variables).toEqual([]);
    expect(template?.sections).toEqual([]);
    expect(template?.cmsFieldMap).toBeUndefined();
    expect(template?.schemaTypes).toBeUndefined();
  });
});
