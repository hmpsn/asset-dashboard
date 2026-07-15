import { describe, expect, it } from 'vitest';

import { buildSiteAuditApprovalPayload } from '../../src/components/site-audit-rebuilt/siteAuditApproval';

const page = {
  pageId: 'page-1',
  page: 'Services',
  slug: '/services',
};

describe('Site Audit approval payload', () => {
  it('sends title variants to the title field and preserves the client note', () => {
    expect(buildSiteAuditApprovalPayload({
      siteId: 'site-1',
      page,
      issue: {
        check: 'missing_title',
        message: 'Missing page title',
        recommendation: 'Add a descriptive title.',
        suggestedFix: 'SEO Services | Acme',
      },
      note: 'Please confirm the positioning.',
    })).toEqual({
      siteId: 'site-1',
      name: '[Review] Missing page title',
      note: 'Please confirm the positioning.',
      items: [{
        pageId: 'page-1',
        pageTitle: 'Services',
        pageSlug: '/services',
        field: 'seoTitle',
        currentValue: '',
        proposedValue: 'SEO Services | Acme',
        reason: 'Add a descriptive title.',
      }],
    });
  });

  it('never disguises a structural issue as a meta-description edit', () => {
    const payload = buildSiteAuditApprovalPayload({
      siteId: 'site-1',
      page,
      issue: {
        check: 'heading-hierarchy',
        message: 'Heading order skips a level',
        recommendation: 'Restore a logical H1-H2 hierarchy.',
      },
    });

    expect(payload.items[0]).toMatchObject({
      field: 'audit-heading-hierarchy',
      proposedValue: 'Restore a logical H1-H2 hierarchy.',
    });
    expect(payload).not.toHaveProperty('note');
  });

  it('prefers an operator-edited suggestion without dropping the note', () => {
    const payload = buildSiteAuditApprovalPayload({
      siteId: 'site-1',
      page,
      issue: {
        check: 'meta-description',
        message: 'Meta description is too long',
        recommendation: 'Shorten the description.',
        suggestedFix: 'Original suggestion',
      },
      editedSuggestion: 'Edited suggestion',
      note: 'Use this after legal review.',
    });

    expect(payload.note).toBe('Use this after legal review.');
    expect(payload.items[0]).toMatchObject({
      field: 'seoDescription',
      proposedValue: 'Edited suggestion',
    });
  });
});
