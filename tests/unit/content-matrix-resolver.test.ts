import { describe, expect, it } from 'vitest';
import type {
  ContentMatrix,
  ContentTemplate,
  MatrixCell,
  TemplateSection,
} from '../../shared/types/content.js';
import { MATRIX_GENERATION_CONTRACT_VERSION } from '../../shared/types/matrix-generation.js';
import {
  resolveMatrixStructure,
  type ResolveMatrixStructureInput,
} from '../../server/domains/content/matrix-generation/resolver.js';
import {
  createContentTemplateGenerationUpgradeProposal,
  verifyContentTemplateGenerationUpgradeProposal,
} from '../../server/domains/content/matrix-generation/template-upgrade.js';

const NOW = '2026-07-13T12:00:00.000Z';

function section(overrides: Partial<TemplateSection> = {}): TemplateSection {
  return {
    id: 'section-body',
    name: 'Body',
    headingTemplate: '{service} in {city}',
    guidance: 'Explain the service using grounded evidence.',
    wordCountTarget: 500,
    order: 0,
    generationRole: 'body',
    aeoContract: { modes: [], required: false },
    ctaContract: { role: 'none', required: false },
    ...overrides,
  };
}

function template(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id: 'tpl-1',
    workspaceId: 'ws-1',
    name: 'Service location',
    pageType: 'service',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'city', label: 'City' },
    ],
    sections: [
      section(),
      section({
        id: 'section-faq',
        name: 'FAQ',
        headingTemplate: '{service} questions',
        order: 1,
        wordCountTarget: 250,
        generationRole: 'faq',
        aeoContract: { modes: ['faq', 'paa'], required: true },
      }),
      section({
        id: 'section-cta',
        name: 'CTA',
        headingTemplate: 'Book {service}',
        order: 2,
        wordCountTarget: 100,
        generationRole: 'cta',
        ctaContract: { role: 'primary', required: true },
      }),
    ],
    urlPattern: '/services/{city}/{service}',
    keywordPattern: '{service} in {city}',
    titlePattern: '{service} in {city}',
    metaDescPattern: 'Explore {service} in {city}.',
    schemaTypes: ['Service', 'FAQPage'],
    revision: 7,
    generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function cell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    id: 'cell-1',
    revision: 4,
    variableValues: { service: 'Dental Implants', city: 'San José' },
    targetKeyword: 'dental implants san jose',
    plannedUrl: '/services/san-jose/dental-implants',
    status: 'keyword_validated',
    keywordValidation: {
      volume: 480,
      difficulty: 32,
      cpc: 8.5,
      validatedAt: NOW,
    },
    ...overrides,
  };
}

function matrix(targetCell = cell(), overrides: Partial<ContentMatrix> = {}): ContentMatrix {
  return {
    id: 'matrix-1',
    workspaceId: 'ws-1',
    revision: 3,
    name: 'Service grid',
    templateId: 'tpl-1',
    dimensions: [
      { variableName: 'service', values: ['Dental Implants'] },
      { variableName: 'city', values: ['San José'] },
    ],
    urlPattern: '/services/{city}/{service}',
    keywordPattern: '{service} in {city}',
    cells: [targetCell],
    stats: { total: 1, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function input(overrides: Partial<ResolveMatrixStructureInput> = {}): ResolveMatrixStructureInput {
  const targetCell = overrides.cell ?? cell();
  const targetMatrix = overrides.matrix ?? matrix(targetCell);
  return {
    workspaceId: 'ws-1',
    matrix: targetMatrix,
    template: template(),
    cell: targetCell,
    expectedSourceRevision: { matrixRevision: 3, templateRevision: 7, cellRevision: 4 },
    matrixPlannedUrls: [
      { cellId: targetCell.id, plannedUrl: targetCell.plannedUrl },
    ],
    knownWorkspacePagePaths: ['/about'],
    ...overrides,
  };
}

function blockerIds(result: ReturnType<typeof resolveMatrixStructure>): string[] {
  return result.status === 'blocked' ? result.blockers.map(item => item.id) : [];
}

describe('resolveMatrixStructure', () => {
  it('resolves an explicit durable cell into a complete deterministic manifest', () => {
    const first = resolveMatrixStructure(input());
    const second = resolveMatrixStructure(input());

    expect(first).toEqual(second);
    expect(first.status).toBe('resolved');
    if (first.status !== 'resolved') return;

    expect(first.target).toMatchObject({
      workspaceId: 'ws-1',
      matrixId: 'matrix-1',
      templateId: 'tpl-1',
      cellId: 'cell-1',
      variableValues: { service: 'Dental Implants', city: 'San José' },
      slugSubstitutions: { service: 'dental-implants', city: 'san-jose' },
      proseSubstitutions: { service: 'Dental Implants', city: 'San José' },
      plannedUrl: '/services/san-jose/dental-implants',
      title: 'Dental Implants in San José',
      metaDescription: 'Explore Dental Implants in San José.',
      renderedHeadings: [
        'Dental Implants in San José',
        'Dental Implants questions',
        'Book Dental Implants',
      ],
      pageType: 'service',
      schemaTypes: ['Service', 'FAQPage'],
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      structuralBlockingRequirementIds: [],
    });
    expect(first.target.targetKeyword).toMatchObject({
      value: 'dental implants san jose',
      source: 'target',
      validation: { volume: 480, difficulty: 32, cpc: 8.5, validatedAt: NOW },
    });
    expect(first.target.targetKeyword.evidenceRefs.map(item => item.sourceType)).toEqual([
      'content_matrix_cell',
      'seo_provider',
    ]);
    expect(first.target.blockManifest.blocks.map(item => item.id)).toEqual([
      'system:introduction',
      'template:section-body',
      'template:section-faq',
      'template:section-cta',
      'system:conclusion',
    ]);
    expect(first.target.blockManifest.blocks[0]).toMatchObject({
      source: 'system',
      generationRole: 'introduction',
    });
    expect(first.target.blockManifest.blocks.at(-1)).toMatchObject({
      source: 'system',
      generationRole: 'conclusion',
      ctaContract: { role: 'none', required: false },
    });
    expect(first.target.blockManifest.blocks.filter(block => (
      block.ctaContract.required && block.ctaContract.role === 'primary'
    ))).toHaveLength(1);
    expect(first.target.blockManifest.totalWordCountTarget).toBe(850);
    expect(first.target.blockManifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.target.structuralFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses non-empty custom, then target, then recommended keyword precedence', () => {
    const custom = resolveMatrixStructure(input({
      cell: cell({ customKeyword: '  custom implants san jose  ', recommendedKeyword: 'recommended' }),
    }));
    expect(custom.status === 'resolved' && custom.target.targetKeyword).toMatchObject({
      value: 'custom implants san jose',
      source: 'custom',
    });
    if (custom.status === 'resolved') {
      expect(custom.target.targetKeyword.validation).toBeUndefined();
      expect(custom.target.targetKeyword.evidenceRefs.map(item => item.sourceType)).toEqual([
        'content_matrix_cell',
      ]);
    }

    const target = resolveMatrixStructure(input({
      cell: cell({ customKeyword: ' ', targetKeyword: 'target keyword', recommendedKeyword: 'recommended' }),
    }));
    expect(target.status === 'resolved' && target.target.targetKeyword).toMatchObject({
      value: 'target keyword',
      source: 'target',
    });

    const recommended = resolveMatrixStructure(input({
      cell: cell({ customKeyword: '', targetKeyword: ' ', recommendedKeyword: 'recommended keyword' }),
    }));
    expect(recommended.status === 'resolved' && recommended.target.targetKeyword).toMatchObject({
      value: 'recommended keyword',
      source: 'recommended',
    });
  });

  it('blocks stale matrix, template, and cell revisions independently', () => {
    expect(blockerIds(resolveMatrixStructure(input({
      expectedSourceRevision: { matrixRevision: 2, templateRevision: 7, cellRevision: 4 },
    })))).toContain('stale_matrix_revision');
    expect(blockerIds(resolveMatrixStructure(input({
      expectedSourceRevision: { matrixRevision: 3, templateRevision: 6, cellRevision: 4 },
    })))).toContain('stale_template_revision');
    expect(blockerIds(resolveMatrixStructure(input({
      expectedSourceRevision: { matrixRevision: 3, templateRevision: 7, cellRevision: 3 },
    })))).toContain('stale_cell_revision');
  });

  it('treats absent legacy revisions as zero', () => {
    const targetCell = cell({ revision: undefined });
    const result = resolveMatrixStructure(input({
      cell: targetCell,
      matrix: matrix(targetCell, { revision: undefined }),
      template: template({ revision: undefined }),
      expectedSourceRevision: { matrixRevision: 0, templateRevision: 0, cellRevision: 0 },
    }));
    expect(result.status).toBe('resolved');
  });

  it('blocks duplicate URLs from another matrix cell or a known workspace page', () => {
    const selected = cell();
    const collidingSibling = cell({ id: 'cell-2' });
    const otherCellCollision = resolveMatrixStructure(input({
      cell: selected,
      matrix: matrix(selected, { cells: [selected, collidingSibling] }),
      matrixPlannedUrls: [
        { cellId: 'cell-1', plannedUrl: '/services/san-jose/dental-implants' },
        { cellId: 'cell-2', plannedUrl: '/services/san-jose/dental-implants' },
      ],
    }));
    expect(blockerIds(otherCellCollision)).toContain('planned_url_collision');

    const knownPageCollision = resolveMatrixStructure(input({
      knownWorkspacePagePaths: ['/SERVICES/SAN-JOSE/DENTAL-IMPLANTS/'],
    }));
    expect(blockerIds(knownPageCollision)).toContain('workspace_url_collision');
  });

  it('compares published content by exact canonical path, not only its final slug', () => {
    const distinctPrefix = resolveMatrixStructure(input({
      knownWorkspacePublishedSlugs: ['/blog/dental-implants'],
    }));
    expect(distinctPrefix.status).toBe('resolved');

    const exactCollision = resolveMatrixStructure(input({
      knownWorkspacePublishedSlugs: ['/services/san-jose/dental-implants/'],
    }));
    expect(blockerIds(exactCollision)).toContain('workspace_url_collision');
  });

  it('derives collision checks from authoritative matrix cells when the supplied census omits a sibling', () => {
    const selected = cell();
    const collidingSibling = cell({ id: 'cell-2' });
    const result = resolveMatrixStructure(input({
      cell: selected,
      matrix: matrix(selected, { cells: [selected, collidingSibling] }),
      matrixPlannedUrls: [{ cellId: selected.id, plannedUrl: selected.plannedUrl }],
    }));
    expect(blockerIds(result)).toEqual(expect.arrayContaining([
      'malformed_matrix_url_census',
      'planned_url_collision',
    ]));
  });

  it('permits uniquely addressed workspace-matrix census extras and checks them for collisions', () => {
    const nonColliding = resolveMatrixStructure(input({
      matrixPlannedUrls: [
        { cellId: 'cell-1', plannedUrl: '/services/san-jose/dental-implants' },
        { cellId: 'other-matrix-cell', plannedUrl: '/services/austin/dental-implants' },
      ],
    }));
    expect(nonColliding.status).toBe('resolved');

    const colliding = resolveMatrixStructure(input({
      matrixPlannedUrls: [
        { cellId: 'cell-1', plannedUrl: '/services/san-jose/dental-implants' },
        { cellId: 'other-matrix-cell', plannedUrl: '/Services/San-Jose/Dental-Implants/' },
      ],
    }));
    expect(blockerIds(colliding)).toContain('planned_url_collision');
    expect(blockerIds(colliding)).not.toContain('malformed_matrix_url_census');
  });

  it('does not count the selected cell own planned URL as a collision', () => {
    expect(resolveMatrixStructure(input({
      matrixPlannedUrls: [
        { cellId: 'cell-1', plannedUrl: '/services/san-jose/dental-implants' },
      ],
    })).status).toBe('resolved');
  });

  it('uses revision-owned template schema types before a legacy cell snapshot', () => {
    const targetCell = cell({ expectedSchemaTypes: ['LegacySchema'] });
    const result = resolveMatrixStructure(input({
      cell: targetCell,
      matrix: matrix(targetCell),
      template: template({ schemaTypes: ['Service', 'FAQPage'] }),
    }));
    expect(result.status === 'resolved' && result.target.schemaTypes).toEqual(['Service', 'FAQPage']);
  });

  it('falls back to the cell schema snapshot when the template has no schema types', () => {
    const targetCell = cell({ expectedSchemaTypes: ['Service', 'BreadcrumbList'] });
    const result = resolveMatrixStructure(input({
      cell: targetCell,
      matrix: matrix(targetCell),
      template: template({ schemaTypes: undefined }),
    }));
    expect(result.status === 'resolved' && result.target.schemaTypes)
      .toEqual(['Service', 'BreadcrumbList']);
  });

  it('blocks contract-v1 sections whose explicit AEO or CTA contract conflicts with its role', () => {
    const invalidAeo = resolveMatrixStructure(input({
      template: template({
        sections: [section({
          generationRole: 'faq',
          aeoContract: { modes: [], required: false },
        })],
      }),
    }));
    expect(blockerIds(invalidAeo)).toContain('invalid_template_block:section-body:invalid_aeo_contract');

    const invalidCta = resolveMatrixStructure(input({
      template: template({
        sections: [section({
          generationRole: 'cta',
          ctaContract: { role: 'none', required: false },
        })],
      }),
    }));
    expect(blockerIds(invalidCta)).toContain('invalid_template_block:section-body:invalid_cta_contract');

    const impossibleAeo = resolveMatrixStructure(input({
      template: template({
        sections: [section({
          generationRole: 'body',
          aeoContract: { modes: [], required: true },
        })],
      }),
    }));
    expect(blockerIds(impossibleAeo)).toContain('invalid_template_block:section-body:invalid_aeo_contract');

    const impossibleCta = resolveMatrixStructure(input({
      template: template({
        sections: [section({
          generationRole: 'body',
          ctaContract: { role: 'none', required: true },
        })],
      }),
    }));
    expect(blockerIds(impossibleCta)).toContain('invalid_template_block:section-body:invalid_cta_contract');

    const optionalPrimary = resolveMatrixStructure(input({
      template: template({
        sections: [section({
          generationRole: 'body',
          ctaContract: { role: 'primary', required: false },
        })],
      }),
    }));
    expect(blockerIds(optionalPrimary)).toContain(
      'invalid_template_block:section-body:invalid_cta_contract',
    );
  });

  it('owns exactly one primary CTA across template blocks and the system conclusion', () => {
    const systemFallback = resolveMatrixStructure(input({
      template: template({ sections: [section()] }),
    }));
    expect(systemFallback.status).toBe('resolved');
    if (systemFallback.status === 'resolved') {
      expect(systemFallback.target.blockManifest.blocks.at(-1)?.ctaContract).toEqual({
        role: 'primary',
        required: true,
      });
    }

    const duplicateTemplatePrimaries = resolveMatrixStructure(input({
      template: template({
        sections: [
          section({
            id: 'cta-primary-1',
            name: 'Primary CTA one',
            generationRole: 'cta',
            ctaContract: { role: 'primary', required: true },
          }),
          section({
            id: 'cta-primary-2',
            name: 'Primary CTA two',
            order: 1,
            generationRole: 'cta',
            ctaContract: { role: 'primary', required: true },
          }),
        ],
      }),
    }));
    expect(blockerIds(duplicateTemplatePrimaries)).toContain(
      'invalid_template_block:unknown:multiple_primary_cta_contracts',
    );
  });

  it('requires exact template-variable and matrix-dimension coverage with selected values present', () => {
    expect(blockerIds(resolveMatrixStructure(input({
      matrix: matrix(cell(), {
        dimensions: [{ variableName: 'service', values: ['Dental Implants'] }],
      }),
    })))).toContain('missing_matrix_dimension:city');

    expect(blockerIds(resolveMatrixStructure(input({
      matrix: matrix(cell(), {
        dimensions: [
          { variableName: 'service', values: ['Dental Implants', ' dental implants '] },
          { variableName: 'city', values: ['San José', '  '] },
        ],
      }),
    })))).toEqual(expect.arrayContaining([
      'duplicate_matrix_dimension_value:service',
      'blank_matrix_dimension_value:city',
    ]));

    const outOfCensusCell = cell({
      variableValues: { service: 'Dental Implants', city: 'Austin' },
      plannedUrl: '/services/austin/dental-implants',
    });
    expect(blockerIds(resolveMatrixStructure(input({
      cell: outOfCensusCell,
      matrix: matrix(outOfCensusCell),
      matrixPlannedUrls: [{ cellId: outOfCensusCell.id, plannedUrl: outOfCensusCell.plannedUrl }],
    })))).toContain('cell_value_outside_dimension:city');
  });

  it('uses prototype-safe slug and prose maps during full resolution', () => {
    const values = Object.create(null) as Record<string, string>;
    values.__proto__ = 'Clinic';
    const targetCell = cell({
      variableValues: values,
      targetKeyword: 'clinic',
      plannedUrl: '/clinic',
    });
    const sourceMatrix = matrix(targetCell, {
      dimensions: [{ variableName: '__proto__', values: ['Clinic'] }],
      urlPattern: '/{__proto__}',
      keywordPattern: '{__proto__}',
    });
    const sourceTemplate = template({
      variables: [{ name: '__proto__', label: 'Prototype-safe variable' }],
      sections: [section({ headingTemplate: '{__proto__}' })],
      titlePattern: '{__proto__}',
      metaDescPattern: 'Choose {__proto__}.',
    });
    const result = resolveMatrixStructure(input({
      cell: targetCell,
      matrix: sourceMatrix,
      template: sourceTemplate,
      matrixPlannedUrls: [{ cellId: targetCell.id, plannedUrl: targetCell.plannedUrl }],
    }));
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(Object.getPrototypeOf(result.target.slugSubstitutions)).toBeNull();
    expect(Object.getPrototypeOf(result.target.proseSubstitutions)).toBeNull();
    expect(result.target.slugSubstitutions.__proto__).toBe('clinic');
    expect(result.target.proseSubstitutions.__proto__).toBe('Clinic');
  });

  it('blocks malformed identity, variables, patterns, paths, and page types without throwing', () => {
    expect(blockerIds(resolveMatrixStructure(input({ workspaceId: 'ws-other' })))).toContain('workspace_mismatch');
    expect(blockerIds(resolveMatrixStructure(input({ template: template({ pageType: 'custom' }) })))).toContain('unsupported_page_type');
    expect(blockerIds(resolveMatrixStructure(input({ template: template({ titlePattern: undefined }) })))).toContain('missing_title_pattern');
    expect(blockerIds(resolveMatrixStructure(input({ template: template({ metaDescPattern: undefined }) })))).toContain('missing_meta_description_pattern');
    expect(blockerIds(resolveMatrixStructure(input({
      cell: cell({ variableValues: { service: 'Implants', city: 'Austin', invented: 'not declared' } }),
    })))).toContain('unknown_cell_variable');
    expect(blockerIds(resolveMatrixStructure(input({
      cell: cell({ variableValues: { service: 'Implants' } }),
    })))).toContain('missing_cell_variable');
    expect(blockerIds(resolveMatrixStructure(input({
      matrix: matrix(cell(), { urlPattern: 'https://other.test/{city}' }),
    })))).toContain('invalid_planned_url');
    expect(blockerIds(resolveMatrixStructure(input({
      template: template({ titlePattern: '{invented} in {city}' }),
    })))).toContain('invalid_title_pattern');
  });

  it('blocks a passed cell that is not the durable matrix cell', () => {
    expect(blockerIds(resolveMatrixStructure(input({
      cell: cell({ id: 'cell-elsewhere' }),
      matrix: matrix(cell()),
    })))).toContain('matrix_cell_mismatch');
  });
});

describe('legacy template generation upgrades', () => {
  it('produces an exact deterministic proposal only for unambiguous legacy roles', () => {
    const legacy = template({
      revision: 9,
      generationContractVersion: undefined,
      sections: [
        section({ id: 'hero', name: 'Hero', generationRole: undefined, aeoContract: undefined, ctaContract: undefined }),
        section({ id: 'questions', name: 'FAQ', order: 1, generationRole: undefined, aeoContract: undefined, ctaContract: undefined }),
        section({ id: 'close', name: 'CTA', order: 2, generationRole: undefined, aeoContract: undefined, ctaContract: undefined }),
      ],
    });

    const first = createContentTemplateGenerationUpgradeProposal(legacy);
    const second = createContentTemplateGenerationUpgradeProposal(legacy);
    expect(first).toEqual(second);
    expect(first.status).toBe('proposal');
    if (first.status !== 'proposal') return;

    expect(first.proposal.expectedTemplateRevision).toBe(9);
    expect(first.proposal.proposalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.proposal.blocks.map(block => block.generationRole)).toEqual([
      'introduction',
      'body',
      'faq',
      'cta',
      'conclusion',
    ]);
    expect(first.upgradedSections.map(item => ({
      role: item.generationRole,
      aeo: item.aeoContract,
      cta: item.ctaContract,
    }))).toEqual([
      { role: 'body', aeo: { modes: [], required: false }, cta: { role: 'none', required: false } },
      { role: 'faq', aeo: { modes: ['faq', 'paa'], required: true }, cta: { role: 'none', required: false } },
      { role: 'cta', aeo: { modes: [], required: false }, cta: { role: 'primary', required: true } },
    ]);
  });

  it('returns upgrade_required during cell resolution and never silently applies it', () => {
    const legacy = template({
      generationContractVersion: undefined,
      sections: [section({ name: 'Body', generationRole: undefined, aeoContract: undefined, ctaContract: undefined })],
    });
    const result = resolveMatrixStructure(input({ template: legacy }));
    expect(result.status).toBe('upgrade_required');
    if (result.status === 'upgrade_required') {
      expect(result.proposal.templateId).toBe('tpl-1');
    }
  });

  it('blocks ambiguous role signals and multiple primary CTA mappings', () => {
    const conflictingSignals = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [section({
        name: 'FAQ',
        narrativeRole: 'call-to-action',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(conflictingSignals.status).toBe('blocked');
    if (conflictingSignals.status === 'blocked') {
      expect(conflictingSignals.blockers.map(item => item.id)).toContain('ambiguous_template_section_role:section-body');
    }

    const multipleCtas = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [
        section({ id: 'cta-1', name: 'CTA', generationRole: undefined, aeoContract: undefined, ctaContract: undefined }),
        section({ id: 'cta-2', name: 'Call to action', order: 1, generationRole: undefined, aeoContract: undefined, ctaContract: undefined }),
      ],
    }));
    expect(multipleCtas.status).toBe('blocked');
    if (multipleCtas.status === 'blocked') {
      expect(multipleCtas.blockers.map(item => item.id)).toContain('ambiguous_primary_cta');
    }

    const optionalPrimary = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [section({
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'primary', required: false },
      })],
    }));
    expect(optionalPrimary.status).toBe('blocked');
    if (optionalPrimary.status === 'blocked') {
      expect(optionalPrimary.blockers.map(item => item.id)).toContain(
        'ambiguous_cta_contract:section-body',
      );
    }
  });

  it('blocks an empty legacy template instead of proposing a system-only page', () => {
    const result = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [],
    }));
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map(item => item.id)).toContain(
        'invalid_template_block:unknown:empty_template_sections',
      );
    }
  });

  it('blocks unknown or malformed legacy heading placeholders before acceptance', () => {
    const unknown = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [section({
        name: 'Body',
        headingTemplate: '{unknown}',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(unknown.status).toBe('blocked');

    const malformed = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      sections: [section({
        name: 'Body',
        headingTemplate: '{city',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(malformed.status).toBe('blocked');
  });

  it('blocks direct legacy proposals for unsupported page types', () => {
    const result = createContentTemplateGenerationUpgradeProposal(template({
      pageType: 'custom',
      generationContractVersion: undefined,
      sections: [section({
        name: 'Body',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map(item => item.id)).toContain('unsupported_page_type');
    }
  });

  it('requires operator-authored title and meta patterns before a legacy upgrade', () => {
    const missing = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      titlePattern: undefined,
      metaDescPattern: ' ',
      sections: [section({
        name: 'Body',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(missing.status).toBe('blocked');
    if (missing.status === 'blocked') {
      expect(missing.blockers.map(item => item.id)).toEqual(expect.arrayContaining([
        'missing_title_pattern',
        'missing_meta_description_pattern',
      ]));
    }

    const invalid = createContentTemplateGenerationUpgradeProposal(template({
      generationContractVersion: undefined,
      titlePattern: '{invented}',
      sections: [section({
        name: 'Body',
        generationRole: undefined,
        aeoContract: undefined,
        ctaContract: undefined,
      })],
    }));
    expect(invalid.status).toBe('blocked');
    if (invalid.status === 'blocked') {
      expect(invalid.blockers.map(item => item.id)).toContain('invalid_title_pattern');
    }
  });

  it('verifies both expected revision and the exact canonical proposal fingerprint', () => {
    const legacy = template({
      revision: 9,
      generationContractVersion: undefined,
      sections: [section({ name: 'Body', generationRole: undefined, aeoContract: undefined, ctaContract: undefined })],
    });
    const result = createContentTemplateGenerationUpgradeProposal(legacy);
    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') return;

    expect(verifyContentTemplateGenerationUpgradeProposal(legacy, {
      expectedTemplateRevision: 9,
      proposalFingerprint: result.proposal.proposalFingerprint,
    })).toMatchObject({ status: 'valid' });
    expect(verifyContentTemplateGenerationUpgradeProposal(legacy, {
      expectedTemplateRevision: 8,
      proposalFingerprint: result.proposal.proposalFingerprint,
    })).toEqual({ status: 'stale_revision', actualTemplateRevision: 9 });
    expect(verifyContentTemplateGenerationUpgradeProposal(legacy, {
      expectedTemplateRevision: 9,
      proposalFingerprint: '0'.repeat(64),
    })).toMatchObject({ status: 'stale_fingerprint' });
  });
});
