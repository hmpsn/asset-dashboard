import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  createTemplate,
  getTemplate,
  updateTemplate,
} from '../../server/content-templates.js';
import {
  ContentTemplateLibraryError,
  getLibraryTemplate,
  instantiateLibraryTemplate,
  listLibraryTemplates,
  promoteTemplateToLibrary,
} from '../../server/domains/content/template-library.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { MATRIX_GENERATION_CONTRACT_VERSION } from '../../shared/types/matrix-generation.js';

let sourceWorkspaceId: string;
let targetWorkspaceA: string;
let targetWorkspaceB: string;

function createGenerationTemplate(name = 'Dental Treatment Page') {
  return createTemplate(sourceWorkspaceId, {
    name,
    pageType: 'service',
    variables: [{ name: 'service', label: 'Service' }],
    sections: [{
      id: 'source-hero',
      name: 'Hero',
      headingTemplate: '{service}',
      guidance: 'Lead with the patient outcome.',
      wordCountTarget: 150,
      order: 0,
      generationRole: 'answer_first',
      aeoContract: { modes: ['answer_first'], required: true },
      ctaContract: { role: 'none', required: false },
      renderAs: 'table',
      internalLinkContract: { minimum: 1 },
    }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service}',
    titlePattern: '{service}',
    metaDescPattern: 'Learn about {service}.',
    generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
  });
}

beforeEach(() => {
  sourceWorkspaceId = createWorkspace(`Template Library Source ${Date.now()}`).id;
  targetWorkspaceA = createWorkspace(`Template Library A ${Date.now()}`).id;
  targetWorkspaceB = createWorkspace(`Template Library B ${Date.now()}`).id;
});

afterEach(() => {
  db.prepare('DELETE FROM content_template_library WHERE source_workspace_id = ?')
    .run(sourceWorkspaceId);
  deleteWorkspace(sourceWorkspaceId);
  deleteWorkspace(targetWorkspaceA);
  deleteWorkspace(targetWorkspaceB);
});

describe('content template studio library', () => {
  it('promotes one exact revision and lists it by vertical', () => {
    const source = createGenerationTemplate();
    const promoted = promoteTemplateToLibrary({
      sourceWorkspaceId,
      templateId: source.id,
      expectedTemplateRevision: source.revision ?? 0,
      vertical: 'dental',
    });

    expect(promoted.replayed).toBe(false);
    expect(promoted.template).toMatchObject({
      vertical: 'dental',
      name: source.name,
      source: {
        workspaceId: sourceWorkspaceId,
        templateId: source.id,
        templateRevision: source.revision,
      },
    });
    expect(listLibraryTemplates({ vertical: 'dental', limit: 10 }).items)
      .toEqual([expect.objectContaining({ id: promoted.template.id, sectionCount: 1 })]);
    expect(listLibraryTemplates({ vertical: 'saas', limit: 10 }).items).toEqual([]);

    const replay = promoteTemplateToLibrary({
      sourceWorkspaceId,
      templateId: source.id,
      expectedTemplateRevision: source.revision ?? 0,
      vertical: 'dental',
    });
    expect(replay).toMatchObject({ replayed: true, template: { id: promoted.template.id } });
  });

  it('instantiates independent workspace copies with fresh section IDs', () => {
    const source = createGenerationTemplate();
    const library = promoteTemplateToLibrary({
      sourceWorkspaceId,
      templateId: source.id,
      expectedTemplateRevision: source.revision ?? 0,
      vertical: 'dental',
    }).template;

    const copyA = instantiateLibraryTemplate({
      targetWorkspaceId: targetWorkspaceA,
      libraryTemplateId: library.id,
      name: 'Client A Treatment Page',
    });
    const copyB = instantiateLibraryTemplate({
      targetWorkspaceId: targetWorkspaceB,
      libraryTemplateId: library.id,
    });

    expect(copyA.workspaceId).toBe(targetWorkspaceA);
    expect(copyB.workspaceId).toBe(targetWorkspaceB);
    expect(copyA.sections[0]?.id).not.toBe(source.sections[0]?.id);
    expect(copyB.sections[0]?.id).not.toBe(source.sections[0]?.id);
    expect(copyA.sections[0]?.id).not.toBe(copyB.sections[0]?.id);
    expect(copyA.sections[0]).toMatchObject({
      renderAs: 'table',
      internalLinkContract: { minimum: 1 },
    });

    const edited = updateTemplate(targetWorkspaceA, copyA.id, {
      sections: copyA.sections.map(section => ({ ...section, guidance: 'Client A edit.' })),
    }, { expectedTemplateRevision: copyA.revision });
    expect(edited?.sections[0]?.guidance).toBe('Client A edit.');
    expect(getTemplate(targetWorkspaceB, copyB.id)?.sections[0]?.guidance)
      .toBe('Lead with the patient outcome.');
    expect(getLibraryTemplate(library.id)?.sections[0]?.guidance)
      .toBe('Lead with the patient outcome.');
  });

  it('fails stale, legacy, and invalid-target operations with field-specific errors', () => {
    const source = createGenerationTemplate();
    expect(() => promoteTemplateToLibrary({
      sourceWorkspaceId,
      templateId: source.id,
      expectedTemplateRevision: (source.revision ?? 0) - 1,
      vertical: 'dental',
    })).toThrow(expect.objectContaining<Partial<ContentTemplateLibraryError>>({
      code: 'conflict',
      fieldPath: 'expected_template_revision',
    }));

    const legacy = createTemplate(sourceWorkspaceId, { name: 'Legacy' });
    expect(() => promoteTemplateToLibrary({
      sourceWorkspaceId,
      templateId: legacy.id,
      expectedTemplateRevision: legacy.revision ?? 0,
      vertical: 'dental',
    })).toThrow(expect.objectContaining<Partial<ContentTemplateLibraryError>>({
      code: 'precondition_failed',
      fieldPath: 'template_id',
    }));

    expect(() => instantiateLibraryTemplate({
      targetWorkspaceId: 'ws_missing',
      libraryTemplateId: 'libtpl_missing',
    })).toThrow(expect.objectContaining<Partial<ContentTemplateLibraryError>>({
      code: 'not_found',
      fieldPath: 'target_workspace_id',
    }));
  });
});
