import { describe, expect, it } from 'vitest';

import { resolveContentMatrixEvidenceInputSchema } from '../../shared/types/mcp-matrix-schemas.js';
import { templateSectionStoredSchema } from '../../server/content-templates.js';
import { createTemplateSchema } from '../../server/routes/content-templates.js';

const baseSection = {
  id: 'comparison',
  name: 'Comparison',
  headingTemplate: 'Compare options',
  guidance: 'Compare the verified options.',
  wordCountTarget: 180,
  order: 0,
  generationRole: 'proof' as const,
  aeoContract: { modes: [] as [], required: false },
  ctaContract: { role: 'none' as const, required: false },
};

function evidenceInput() {
  return {
    workspace_id: 'ws-1',
    matrix_id: 'matrix-1',
    cell_id: 'cell-1',
    requirement_id: 'matrix-cell:cell-1:section:links',
    value: {
      kind: 'link_list',
      value: [{ href: '/services', anchor_text: 'See all services' }],
    },
    source_ref: {
      source_type: 'operator_submission',
      source_id: 'verified-link-set-1',
      captured_at: '2026-07-20T12:00:00.000Z',
    },
    expected_source_revision: {
      matrix_revision: 1,
      template_revision: 1,
      cell_revision: 1,
    },
    expected_artifact_revisions: {
      brief: { artifact_type: 'content_brief', artifact_id: null, generation_revision: 0 },
      post: { artifact_type: 'generated_post', artifact_id: null, generation_revision: 0 },
    },
    idempotency_key: 'links-1',
  };
}

describe('matrix output-quality contracts', () => {
  it('keeps legacy template sections valid while accepting explicit rendering and link contracts', () => {
    expect(templateSectionStoredSchema.safeParse(baseSection).success).toBe(true);
    expect(templateSectionStoredSchema.safeParse({
      ...baseSection,
      renderAs: 'table',
      internalLinkContract: { minimum: 2 },
    }).success).toBe(true);

    const template = createTemplateSchema.safeParse({
      name: 'Service comparison',
      pageType: 'service',
      variables: [],
      sections: [{
        ...baseSection,
        renderAs: 'table',
        internalLinkContract: { minimum: 1 },
      }],
      urlPattern: '/service',
      keywordPattern: 'service',
      generationContractVersion: 1,
    });
    expect(template.success).toBe(true);
  });

  it('bounds structured template contracts', () => {
    expect(templateSectionStoredSchema.safeParse({
      ...baseSection,
      renderAs: 'grid',
    }).success).toBe(false);
    expect(templateSectionStoredSchema.safeParse({
      ...baseSection,
      internalLinkContract: { minimum: 0 },
    }).success).toBe(false);
    expect(templateSectionStoredSchema.safeParse({
      ...baseSection,
      internalLinkContract: { minimum: 11 },
    }).success).toBe(false);
  });

  it('accepts bounded canonical internal-link evidence and rejects external destinations', () => {
    expect(resolveContentMatrixEvidenceInputSchema.safeParse(evidenceInput()).success).toBe(true);
    const external = evidenceInput();
    external.value.value[0] = {
      href: 'https://example.com/services',
      anchor_text: 'External services',
    };
    expect(resolveContentMatrixEvidenceInputSchema.safeParse(external).success).toBe(false);
  });
});
