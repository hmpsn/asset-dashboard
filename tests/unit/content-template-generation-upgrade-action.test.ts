import { afterEach, describe, expect, it } from 'vitest';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  updateTemplate,
} from '../../server/content-templates.js';
import {
  acceptTemplateGenerationUpgrade,
  TemplateGenerationUpgradeError,
} from '../../server/domains/content/matrix-generation/upgrade-action.js';
import { createContentTemplateGenerationUpgradeProposal } from '../../server/domains/content/matrix-generation/template-upgrade.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const cleanupTasks: Array<() => void> = [];

afterEach(() => {
  while (cleanupTasks.length > 0) cleanupTasks.pop()?.();
});

function createLegacyTemplate(sectionName = 'hero') {
  const workspace = createWorkspace(`Template upgrade ${Date.now()}`);
  const template = createTemplate(workspace.id, {
    name: 'Legacy service template',
    pageType: 'service',
    variables: [{ name: 'service', label: 'Service' }],
    sections: [{
      id: 'section-1',
      name: sectionName,
      headingTemplate: '{service}',
      guidance: 'Explain the service.',
      wordCountTarget: 250,
      order: 0,
    }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service}',
    titlePattern: '{service}',
    metaDescPattern: 'Learn about {service}.',
  });
  cleanupTasks.push(() => {
    deleteTemplate(workspace.id, template.id);
    deleteWorkspace(workspace.id);
  });
  return { workspace, template };
}

function proposalFor(template: ReturnType<typeof createTemplate>) {
  const result = createContentTemplateGenerationUpgradeProposal(template);
  expect(result.status).toBe('proposal');
  if (result.status !== 'proposal') throw new Error('Expected deterministic proposal fixture');
  return result.proposal;
}

const generationSourceMutations: Array<{
  label: string;
  sql: string;
  value: (template: ReturnType<typeof createTemplate>) => string;
}> = [
  {
    label: 'title pattern',
    sql: 'UPDATE content_templates SET title_pattern = ? WHERE id = ? AND workspace_id = ?',
    value: () => '{service} specialists',
  },
  {
    label: 'meta description pattern',
    sql: 'UPDATE content_templates SET meta_desc_pattern = ? WHERE id = ? AND workspace_id = ?',
    value: () => 'Explore trusted {service} options.',
  },
  {
    label: 'URL pattern',
    sql: 'UPDATE content_templates SET url_pattern = ? WHERE id = ? AND workspace_id = ?',
    value: () => '/treatments/{service}',
  },
  {
    label: 'keyword pattern',
    sql: 'UPDATE content_templates SET keyword_pattern = ? WHERE id = ? AND workspace_id = ?',
    value: () => '{service} treatment',
  },
  {
    label: 'supported page type',
    sql: 'UPDATE content_templates SET page_type = ? WHERE id = ? AND workspace_id = ?',
    value: () => 'location',
  },
  {
    label: 'tone and style',
    sql: 'UPDATE content_templates SET tone_and_style = ? WHERE id = ? AND workspace_id = ?',
    value: () => 'Warm, plainspoken, and concise.',
  },
  {
    label: 'CMS field map',
    sql: 'UPDATE content_templates SET cms_field_map = ? WHERE id = ? AND workspace_id = ?',
    value: () => JSON.stringify({ heroHeading: 'hero_heading' }),
  },
  {
    label: 'schema types',
    sql: 'UPDATE content_templates SET schema_types = ? WHERE id = ? AND workspace_id = ?',
    value: () => JSON.stringify(['Service', 'FAQPage']),
  },
  {
    label: 'variable metadata',
    sql: 'UPDATE content_templates SET variables = ? WHERE id = ? AND workspace_id = ?',
    value: template => JSON.stringify(template.variables.map(variable => ({
      ...variable,
      label: `${variable.label} (updated)`,
    }))),
  },
  {
    label: 'section notes',
    sql: 'UPDATE content_templates SET sections = ? WHERE id = ? AND workspace_id = ?',
    value: template => JSON.stringify(template.sections.map(section => ({
      ...section,
      brandNote: 'Lead with reassurance before technical detail.',
      seoNote: 'Answer the primary intent in the opening block.',
    }))),
  },
];

describe('content template generation upgrade action', () => {
  it('accepts once, stores the explicit contract, and safely replays the exact mutation', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);
    const request = {
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept' as const,
      idempotencyKey: 'upgrade-accept-1',
    };

    const accepted = acceptTemplateGenerationUpgrade(request);
    expect(accepted.status).toBe('accepted');
    expect(accepted.replayed).toBe(false);
    expect(accepted.template.revision).toBe((template.revision ?? 0) + 1);
    expect(accepted.template.generationContractVersion).toBe(1);
    expect(accepted.template.sections[0]).toMatchObject({
      generationRole: 'body',
      aeoContract: { required: false },
      ctaContract: { role: 'none', required: false },
    });

    const replayed = acceptTemplateGenerationUpgrade(request);
    expect(replayed.status).toBe('accepted');
    expect(replayed.replayed).toBe(true);
    expect(replayed.template.revision).toBe(accepted.template.revision);

    expect(() => acceptTemplateGenerationUpgrade({
      ...request,
      proposalFingerprint: 'b'.repeat(64),
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'conflict',
    }));
  });

  it('fails closed when raw legacy sections change without a revision bump', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);
    db.prepare(`
      UPDATE content_templates
      SET sections = json_insert(sections, '$[#]', json(?))
      WHERE id = ? AND workspace_id = ?
    `).run(
      JSON.stringify({ id: 'raw-invalid', name: 'Body' }),
      template.id,
      workspace.id,
    );
    const corruptRow = db.prepare(`
      SELECT sections, revision, generation_contract_version
      FROM content_templates
      WHERE id = ? AND workspace_id = ?
    `).get(template.id, workspace.id) as {
      sections: string;
      revision: number;
      generation_contract_version: number | null;
    };

    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept',
      idempotencyKey: 'raw-section-drift',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'precondition_failed',
    }));

    const after = db.prepare(`
      SELECT sections, revision, generation_contract_version
      FROM content_templates
      WHERE id = ? AND workspace_id = ?
    `).get(template.id, workspace.id) as typeof corruptRow;
    expect(after).toEqual(corruptRow);
    expect(after).toMatchObject({
      revision: template.revision,
      generation_contract_version: null,
    });
  });

  it.each(generationSourceMutations)(
    'rejects a stale proposal when valid $label source changes without a revision bump',
    ({ sql, value }) => {
      const { workspace, template } = createLegacyTemplate();
      const proposal = proposalFor(template);
      db.prepare(sql).run(value(template), template.id, workspace.id);

      const edited = getTemplate(workspace.id, template.id);
      expect(edited).not.toBeNull();
      if (!edited) return;
      expect(edited.revision).toBe(template.revision);
      const refreshed = createContentTemplateGenerationUpgradeProposal(edited);
      expect(refreshed.status).toBe('proposal');
      if (refreshed.status !== 'proposal') return;
      expect(refreshed.proposal.proposalFingerprint).not.toBe(
        proposal.proposalFingerprint,
      );

      expect(() => acceptTemplateGenerationUpgrade({
        workspaceId: workspace.id,
        templateId: template.id,
        expectedTemplateRevision: proposal.expectedTemplateRevision,
        proposalFingerprint: proposal.proposalFingerprint,
        decision: 'accept',
        idempotencyKey: `stale-source-${sql.match(/SET\s+(\w+)/i)?.[1] ?? 'field'}`,
      })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
        code: 'conflict',
      }));
      expect(getTemplate(workspace.id, template.id)).toMatchObject({
        revision: template.revision,
        generationContractVersion: undefined,
      });
    },
  );

  it('keeps explicit legacy version 0 eligible for a deterministic upgrade', () => {
    const { template } = createLegacyTemplate();

    expect(createContentTemplateGenerationUpgradeProposal({
      ...template,
      generationContractVersion: 0,
    }).status).toBe('proposal');
  });

  it.each([1, 2])(
    'blocks proposals and direct acceptance for generation contract version %i',
    generationContractVersion => {
      const { workspace, template } = createLegacyTemplate();
      // Model a malformed/historical assigned-version row directly. Supported
      // mutation paths now reject stamping v1 onto contractless sections.
      db.prepare(`
        UPDATE content_templates
        SET generation_contract_version = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ?
      `).run(generationContractVersion, template.id, workspace.id);
      const versioned = getTemplate(workspace.id, template.id);
      expect(versioned).not.toBeNull();
      if (!versioned) return;

      const proposal = createContentTemplateGenerationUpgradeProposal(versioned);
      expect(proposal.status).toBe('blocked');
      if (proposal.status === 'blocked') {
        expect(proposal.blockers.map(blocker => blocker.id)).toContain(
          'generation_contract_upgrade_not_applicable',
        );
      }

      expect(() => acceptTemplateGenerationUpgrade({
        workspaceId: workspace.id,
        templateId: template.id,
        expectedTemplateRevision: versioned.revision ?? 0,
        proposalFingerprint: 'a'.repeat(64),
        decision: 'accept',
        idempotencyKey: `forged-version-${generationContractVersion}`,
      })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
        code: 'precondition_failed',
      }));
      expect(getTemplate(workspace.id, template.id)).toMatchObject({
        revision: versioned.revision,
        generationContractVersion,
      });
    },
  );

  it('does not misreport a replay after a later generation-effective edit', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);
    const request = {
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept' as const,
      idempotencyKey: 'upgrade-then-edit',
    };
    const accepted = acceptTemplateGenerationUpgrade(request);
    updateTemplate(
      workspace.id,
      template.id,
      { toneAndStyle: 'A later generation-effective operator edit.' },
      { expectedTemplateRevision: accepted.template.revision ?? 0 },
    );

    expect(() => acceptTemplateGenerationUpgrade(request)).toThrowError(
      expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({ code: 'conflict' }),
    );
  });

  it('fails closed on malformed direct domain requests before reading or writing', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);

    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: -1,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept',
      idempotencyKey: 'invalid-revision',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'precondition_failed',
    }));
    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: 'NOT-A-FINGERPRINT',
      decision: 'accept',
      idempotencyKey: 'invalid-fingerprint',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'precondition_failed',
    }));
  });

  it('rejects the exact proposal without mutating the template', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);

    const rejected = acceptTemplateGenerationUpgrade({
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'reject',
      idempotencyKey: 'upgrade-reject-1',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.replayed).toBe(false);
    expect(getTemplate(workspace.id, template.id)).toMatchObject({
      revision: template.revision,
      generationContractVersion: undefined,
    });
  });

  it('fails closed for stale, ambiguous, and cross-workspace proposals', () => {
    const { workspace, template } = createLegacyTemplate();
    const proposal = proposalFor(template);
    updateTemplate(
      workspace.id,
      template.id,
      { toneAndStyle: 'Direct and concise.' },
      { expectedTemplateRevision: template.revision ?? 0 },
    );

    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: workspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept',
      idempotencyKey: 'stale-upgrade',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'conflict',
    }));

    const ambiguous = createLegacyTemplate('bespoke section');
    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: ambiguous.workspace.id,
      templateId: ambiguous.template.id,
      expectedTemplateRevision: ambiguous.template.revision ?? 0,
      proposalFingerprint: 'a'.repeat(64),
      decision: 'accept',
      idempotencyKey: 'ambiguous-upgrade',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'precondition_failed',
    }));

    const otherWorkspace = createWorkspace(`Other workspace ${Date.now()}`);
    cleanupTasks.push(() => deleteWorkspace(otherWorkspace.id));
    expect(() => acceptTemplateGenerationUpgrade({
      workspaceId: otherWorkspace.id,
      templateId: template.id,
      expectedTemplateRevision: proposal.expectedTemplateRevision,
      proposalFingerprint: proposal.proposalFingerprint,
      decision: 'accept',
      idempotencyKey: 'cross-workspace-upgrade',
    })).toThrowError(expect.objectContaining<Partial<TemplateGenerationUpgradeError>>({
      code: 'not_found',
    }));
  });
});
