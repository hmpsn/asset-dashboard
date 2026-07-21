import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  ContentTemplateGenerationContractError,
  ContentTemplateRevisionConflictError,
  ContentTemplateRevisionRequiredError,
  ContentTemplateSourceIntegrityError,
} from '../../server/content-templates.js';
import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  MATRIX_GENERATION_SOURCE_LIMITS,
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
} from '../../shared/types/matrix-generation.js';

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
  it('bounds nested sources without echoing attacker-controlled CMS keys', () => {
    expect(() => createServiceTemplate({
      variables: [{
        name: 'service',
        label: 'Service',
        description: 'x'.repeat(
          MATRIX_GENERATION_SOURCE_LIMITS.template.maxVariableDescriptionBytes + 1,
        ),
      }],
    })).toThrow(MatrixGenerationSourceLimitError);

    const secretKey = `secret-api-key-${'z'.repeat(
      MATRIX_GENERATION_SOURCE_LIMITS.template.maxCmsFieldKeyBytes,
    )}`;
    try {
      createServiceTemplate({ cmsFieldMap: { [secretKey]: 'body' } });
      throw new Error('Expected CMS key source limit failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MatrixGenerationSourceLimitError);
      expect((error as Error).message).not.toContain(secretKey);
      expect((error as MatrixGenerationSourceLimitError).issues[0]?.fieldPath)
        .toBe('cmsFieldMap[0].key');
    }
  });

  it('normalizes schema identifiers and rejects duplicate normalized values', () => {
    const created = createServiceTemplate({
      schemaTypes: [' Service ', 'FAQPage'],
    });
    expect(created.schemaTypes).toEqual(['Service', 'FAQPage']);

    expect(() => createServiceTemplate({
      schemaTypes: ['Service', ' Service '],
    })).toThrow(MatrixGenerationSchemaTypeContractError);
  });

  it('allows an oversized legacy template to be read, repaired, and deleted', () => {
    const template = createServiceTemplate();
    const oversized = 'x'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.template.maxDescriptionBytes + 1);
    db.prepare(`
      UPDATE content_templates SET description = ? WHERE id = ? AND workspace_id = ?
    `).run(oversized, template.id, WS_ID);

    expect(getTemplate(WS_ID, template.id)?.description).toBe(oversized);
    const repaired = updateTemplate(WS_ID, template.id, { description: 'Repaired' });
    expect(repaired?.description).toBe('Repaired');

    db.prepare(`
      UPDATE content_templates SET description = ? WHERE id = ? AND workspace_id = ?
    `).run(oversized, template.id, WS_ID);
    expect(deleteTemplate(WS_ID, template.id)).toBe(true);
  });

  it('persists v1 templates only when every section has a valid explicit contract', () => {
    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    })).toThrow(ContentTemplateGenerationContractError);

    const template = createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [{
        id: 'section-body',
        name: 'Body',
        headingTemplate: '{service} in {city}',
        guidance: 'Explain the service.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      }],
    });

    expect(template.generationContractVersion).toBe(MATRIX_GENERATION_CONTRACT_VERSION);
    expect(getTemplate(WS_ID, template.id)?.sections[0]).toMatchObject({
      generationRole: 'body',
      aeoContract: { modes: [], required: false },
      ctaContract: { role: 'none', required: false },
    });

    const withOptionalProof = createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [
        template.sections[0],
        {
          ...template.sections[0],
          id: 'section-proof',
          name: 'Proof',
          order: 1,
          generationRole: 'proof',
          optional: true,
        },
      ],
    });
    expect(getTemplate(WS_ID, withOptionalProof.id)?.sections[1]?.optional).toBe(true);

    const withOutputContracts = createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [{
        ...template.sections[0],
        renderAs: 'table',
        internalLinkContract: { minimum: 2 },
      }],
    });
    expect(getTemplate(WS_ID, withOutputContracts.id)?.sections[0]).toMatchObject({
      renderAs: 'table',
      internalLinkContract: { minimum: 2 },
    });

    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [{ ...template.sections[0], optional: true }],
    })).toThrow(ContentTemplateGenerationContractError);
    expect(() => createServiceTemplate({
      sections: [{ ...template.sections[0], optional: true }],
    })).toThrow(ContentTemplateGenerationContractError);

    expect(() => createServiceTemplate({
      pageType: 'provider-profile',
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: template.sections,
    })).toThrow(ContentTemplateGenerationContractError);

    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      titlePattern: '',
      metaDescPattern: '',
      sections: template.sections,
    })).toThrow(ContentTemplateGenerationContractError);

    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      titlePattern: '{invented}',
      sections: template.sections,
    })).toThrow(ContentTemplateGenerationContractError);

    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [{
        ...template.sections[0],
        ctaContract: { role: 'primary', required: false },
      }],
    })).toThrow(ContentTemplateGenerationContractError);
  });

  it('validates every direct-v1 pattern with exact service field paths', () => {
    const sections = [{
      id: 'section-body',
      name: 'Body',
      headingTemplate: '{service} in {city}',
      guidance: 'Explain the service.',
      wordCountTarget: 300,
      order: 0,
      generationRole: 'body' as const,
      aeoContract: { modes: [] as [], required: false },
      ctaContract: { role: 'none' as const, required: false },
    }];
    const cases = [
      { fieldPath: 'urlPattern', overrides: { urlPattern: 'https://example.com/{service}' } },
      { fieldPath: 'keywordPattern', overrides: { keywordPattern: '{unknown}' } },
      { fieldPath: 'titlePattern', overrides: { titlePattern: '{service' } },
      { fieldPath: 'metaDescPattern', overrides: { metaDescPattern: '{{service}}' } },
    ] as const;

    for (const testCase of cases) {
      try {
        createServiceTemplate({
          generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
          sections,
          ...testCase.overrides,
        });
        throw new Error(`Expected ${testCase.fieldPath} to fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentTemplateGenerationContractError);
        expect((error as ContentTemplateGenerationContractError).issues[0]?.fieldPath)
          .toBe(testCase.fieldPath);
        expect((error as Error).message).toContain(`${testCase.fieldPath}:`);
      }
    }

    expect(() => createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections,
      keywordPattern: '',
    })).toThrow(ContentTemplateGenerationContractError);
  });

  it('keeps v1 additions valid and rejects contractless or contradictory updates', () => {
    const bodySection = {
      id: 'section-body',
      name: 'Body',
      headingTemplate: '{service} in {city}',
      guidance: 'Explain the service.',
      wordCountTarget: 300,
      order: 0,
      generationRole: 'body' as const,
      aeoContract: { modes: [] as [], required: false },
      ctaContract: { role: 'none' as const, required: false },
    };
    const template = createServiceTemplate({
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      sections: [bodySection],
    });

    const withAddedSection = updateTemplate(WS_ID, template.id, {
      sections: [
        bodySection,
        {
          ...bodySection,
          id: 'section-proof',
          name: 'Proof',
          order: 1,
          generationRole: 'proof',
        },
      ],
    }, { expectedTemplateRevision: template.revision });
    expect(withAddedSection?.sections).toHaveLength(2);

    expect(() => updateTemplate(WS_ID, template.id, {
      sections: [{
        id: 'section-contractless',
        name: 'Contractless',
        headingTemplate: 'Contractless',
        guidance: 'This must not persist.',
        wordCountTarget: 100,
        order: 0,
      }],
    }, { expectedTemplateRevision: withAddedSection?.revision })).toThrow(
      ContentTemplateGenerationContractError,
    );

    expect(() => updateTemplate(WS_ID, template.id, {
      sections: [{
        ...bodySection,
        generationRole: 'faq',
        aeoContract: { modes: [], required: false },
      }],
    }, { expectedTemplateRevision: withAddedSection?.revision })).toThrow(
      ContentTemplateGenerationContractError,
    );
    expect(() => updateTemplate(WS_ID, template.id, {
      sections: [{
        ...bodySection,
        ctaContract: { role: 'primary', required: false },
      }],
    }, { expectedTemplateRevision: withAddedSection?.revision })).toThrow(
      ContentTemplateGenerationContractError,
    );
    expect(getTemplate(WS_ID, template.id)?.sections).toHaveLength(2);
  });

  it('creates, retrieves, lists, and deletes templates scoped to a workspace', () => {
    expect(listTemplates(WS_ID)).toEqual([]);

    const template = createServiceTemplate();

    expect(template.id).toMatch(/^tpl_/);
    expect(template.workspaceId).toBe(WS_ID);
    expect(template.revision).toBe(1);
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
    }, { expectedTemplateRevision: template.revision });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Blog Template');
    expect(updated!.description).toBeUndefined();
    expect(updated!.pageType).toBe('blog');
    expect(updated!.schemaTypes).toContain('BlogPosting');
    expect(updated!.revision).toBe(2);
    expect(updated!.sections).toEqual(template.sections);
    expect(updated!.urlPattern).toBe('/services/{city}/{service}');
    expect(updated!.updatedAt >= template.updatedAt).toBe(true);
  });

  it('preserves explicit schema types when the page type changes', () => {
    const template = createServiceTemplate({ schemaTypes: ['CustomSchema'] });

    const updated = updateTemplate(WS_ID, template.id, {
      pageType: 'landing',
      schemaTypes: ['LandingPage', 'FAQPage'],
    }, { expectedTemplateRevision: template.revision });

    expect(updated?.schemaTypes).toEqual(['LandingPage', 'FAQPage']);
  });

  it('canonicalizes an explicit empty schema list so an identical retry is revision-stable', () => {
    const template = createServiceTemplate();

    const cleared = updateTemplate(WS_ID, template.id, {
      schemaTypes: [],
    }, { expectedTemplateRevision: template.revision });
    expect(cleared).toMatchObject({ revision: 2, schemaTypes: undefined });
    expect(getTemplate(WS_ID, template.id)).toMatchObject({
      revision: 2,
      schemaTypes: undefined,
    });

    const replay = updateTemplate(WS_ID, template.id, {
      schemaTypes: [],
    }, { expectedTemplateRevision: cleared!.revision });
    expect(replay).toMatchObject({ revision: 2, schemaTypes: undefined });
  });

  it('keeps the template revision stable when only map insertion order changes', () => {
    const template = createServiceTemplate({
      cmsFieldMap: { hero: 'main_heading', body: 'main_body' },
    });

    const reordered = updateTemplate(WS_ID, template.id, {
      cmsFieldMap: { body: 'main_body', hero: 'main_heading' },
    }, { expectedTemplateRevision: template.revision });

    expect(reordered?.revision).toBe(template.revision);
    expect(getTemplate(WS_ID, template.id)?.revision).toBe(template.revision);
  });

  it('does not stale generation for display-only edits', () => {
    const template = createServiceTemplate();

    const renamed = updateTemplate(WS_ID, template.id, {
      name: 'Renamed for operators',
      description: 'Display-only description',
    });

    expect(renamed?.revision).toBe(template.revision);
  });

  it('preserves an unknown future page type during unrelated edits', () => {
    const template = createServiceTemplate();
    db.prepare(`
      UPDATE content_templates
         SET page_type = 'future_service', generation_contract_version = 2
       WHERE id = ? AND workspace_id = ?
    `).run(template.id, WS_ID);

    const projected = getTemplate(WS_ID, template.id)!;
    const renamed = updateTemplate(WS_ID, template.id, {
      name: 'Forward-compatible display rename',
      description: projected.description,
      pageType: projected.pageType,
      variables: projected.variables,
      sections: projected.sections,
      urlPattern: projected.urlPattern,
      keywordPattern: projected.keywordPattern,
      titlePattern: projected.titlePattern,
      metaDescPattern: projected.metaDescPattern,
      cmsFieldMap: projected.cmsFieldMap,
      toneAndStyle: projected.toneAndStyle,
      schemaTypes: projected.schemaTypes,
    }, { expectedTemplateRevision: projected.revision });

    expect(renamed).toMatchObject({
      name: 'Forward-compatible display rename',
      pageType: 'custom',
      revision: template.revision,
      generationContractVersion: 2,
    });
    const stored = db.prepare(`
      SELECT page_type, generation_contract_version, revision
        FROM content_templates
       WHERE id = ? AND workspace_id = ?
    `).get(template.id, WS_ID) as {
      page_type: string;
      generation_contract_version: number;
      revision: number;
    };
    expect(stored).toEqual({
      page_type: 'future_service',
      generation_contract_version: 2,
      revision: template.revision,
    });

    const replaced = updateTemplate(WS_ID, template.id, {
      pageType: 'service',
    }, { expectedTemplateRevision: template.revision });
    expect(replaced).toMatchObject({ pageType: 'service', revision: template.revision + 1 });
    expect((db.prepare(`
      SELECT page_type FROM content_templates WHERE id = ? AND workspace_id = ?
    `).get(template.id, WS_ID) as { page_type: string }).page_type).toBe('service');
  });

  it('requires and enforces the expected revision for generation-effective edits', () => {
    const template = createServiceTemplate();

    expect(() => updateTemplate(WS_ID, template.id, {
      titlePattern: 'Changed {service}',
    })).toThrow(ContentTemplateRevisionRequiredError);

    const updated = updateTemplate(WS_ID, template.id, {
      titlePattern: 'Changed {service}',
    }, { expectedTemplateRevision: template.revision });
    expect(updated?.revision).toBe(2);

    expect(() => updateTemplate(WS_ID, template.id, {
      metaDescPattern: 'Stale write',
    }, { expectedTemplateRevision: template.revision })).toThrow(
      ContentTemplateRevisionConflictError,
    );
    expect(getTemplate(WS_ID, template.id)?.metaDescPattern).toBe(template.metaDescPattern);
  });

  it('duplicates a template with copied fields and fresh section ids', () => {
    const template = createServiceTemplate();

    const copy = duplicateTemplate(WS_ID, template.id, 'Service Location Copy');

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(template.id);
    expect(copy!.revision).toBe(1);
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
    expect(template?.revision).toBe(0);
  });

  it('refuses an unrelated update when a malformed stored section would be dropped', () => {
    const template = createServiceTemplate();
    const corruptedSections = JSON.stringify([
      template.sections[0],
      { id: 'corrupt-sibling', name: 'Missing required stored fields' },
    ]);
    db.prepare(`
      UPDATE content_templates
      SET sections = ?
      WHERE id = ? AND workspace_id = ?
    `).run(corruptedSections, template.id, WS_ID);

    expect(() => updateTemplate(WS_ID, template.id, {
      name: 'Display-only rename',
    })).toThrow(ContentTemplateSourceIntegrityError);

    const stored = db.prepare(`
      SELECT name, sections FROM content_templates WHERE id = ? AND workspace_id = ?
    `).get(template.id, WS_ID) as { name: string; sections: string };
    expect(stored.name).toBe(template.name);
    expect(stored.sections).toBe(corruptedSections);
  });
});
