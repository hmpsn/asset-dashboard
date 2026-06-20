import { describe, it, expect } from 'vitest';
import type { FormSubmission, WebflowFormMapping } from '../../shared/types/form-submission.js';
import type { OutcomeType } from '../../shared/types/the-issue.js';

describe('Webflow named-lead contracts (P1a)', () => {
  it('FormSubmission carries the named-lead PII fields + an outcomeType', () => {
    const fs: FormSubmission = {
      id: 'fs_1', workspaceId: 'ws_1', formId: 'form_abc', submissionId: 'wf_sub_123',
      formName: 'Contact', leadName: 'Jane Doe', leadEmail: 'jane@example.com',
      leadMessage: 'Need a quote', eventName: 'form_submit', outcomeType: 'form_fill',
      submittedAt: '2026-06-19T12:00:00.000Z', capturedAt: '2026-06-19T12:00:01.000Z',
    };
    expect(fs.outcomeType).toBe('form_fill');
    expect(fs.submissionId).toBe('wf_sub_123');
  });
  it('WebflowFormMapping maps a Webflow form to an OutcomeType', () => {
    const m: WebflowFormMapping = { formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' as OutcomeType };
    expect(m.outcomeType).toBe('form_fill');
  });
});
