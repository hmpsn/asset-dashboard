/**
 * The Issue (Client) P1a — Webflow Forms Data-API PURE helpers (no network).
 *
 * Replaces the retired HMAC-webhook helper test. Covers the two pure functions in webflow-forms.ts:
 *   - resolveOutcomeType: maps a Webflow form → typed outcome via the workspace mapping (form_fill default)
 *   - mapWebflowSubmission: maps a raw Webflow Data-API submission → the FormSubmission shape, extracting
 *     name/email/message PII case-insensitively from the dynamic formResponse map. submissionId = the
 *     Webflow submission id (idempotency key).
 *
 * The network methods (listWebflowForms / listWebflowFormSubmissions) are exercised against the live
 * boundary in the integration suite; here we lock the deterministic mapping logic.
 */
import { describe, it, expect } from 'vitest';
import { resolveOutcomeType, mapWebflowSubmission } from '../../server/webflow-forms.js';

describe('webflow-forms pure helpers (P1a polling)', () => {
  it('resolves outcome type from the workspace mapping; defaults to form_fill for an unmapped form', () => {
    const ws = { webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'booking' as const }] };
    expect(resolveOutcomeType(ws, 'form_abc', 'Contact')).toBe('booking');
    expect(resolveOutcomeType(ws, 'form_zzz', 'Other')).toBe('form_fill');
    expect(resolveOutcomeType({}, 'form_abc', 'Contact')).toBe('form_fill');
  });

  it('resolves by formName when the id does not match (forms can re-id across publishes)', () => {
    const ws = { webflowFormSources: [{ formId: 'old_id', formName: 'Contact', outcomeType: 'call' as const }] };
    expect(resolveOutcomeType(ws, 'new_id', 'Contact')).toBe('call');
  });

  it('maps a Webflow Data-API submission → FormSubmission, extracting PII case-insensitively', () => {
    const ws = { id: 'ws-1', webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' as const }] };
    const mapped = mapWebflowSubmission(ws, {
      id: 'wf_sub_99',
      formId: 'form_abc',
      displayName: 'Contact',
      dateSubmitted: '2026-06-19T12:00:00.000Z',
      formResponse: { Name: 'Jane Doe', Email: 'jane@example.com', Message: 'Quote please' },
    });
    expect(mapped.workspaceId).toBe('ws-1');
    expect(mapped.submissionId).toBe('wf_sub_99');
    expect(mapped.formId).toBe('form_abc');
    expect(mapped.formName).toBe('Contact');
    expect(mapped.leadName).toBe('Jane Doe');
    expect(mapped.leadEmail).toBe('jane@example.com');
    expect(mapped.leadMessage).toBe('Quote please');
    expect(mapped.outcomeType).toBe('form_fill');
    expect(mapped.eventName).toBe('form_submit');
    expect(mapped.submittedAt).toBe('2026-06-19T12:00:00.000Z');
    expect(typeof mapped.capturedAt).toBe('string');
  });

  it('tolerates alternate field casings / synonyms and a missing formResponse', () => {
    const ws = { id: 'ws-1', webflowFormSources: [] };
    const mapped = mapWebflowSubmission(ws, {
      id: 'wf_sub_a',
      formId: 'f',
      displayName: 'Lead',
      dateSubmitted: '2026-06-19T12:00:00.000Z',
      formResponse: { 'Full Name': 'John Roe', 'Email Address': 'john@example.com', Comments: 'Hi' },
    });
    expect(mapped.leadName).toBe('John Roe');
    expect(mapped.leadEmail).toBe('john@example.com');
    expect(mapped.leadMessage).toBe('Hi');
    expect(mapped.outcomeType).toBe('form_fill'); // unmapped → default

    const empty = mapWebflowSubmission(ws, {
      id: 'wf_sub_b', formId: 'f', displayName: 'Lead', dateSubmitted: '2026-06-19T12:00:00.000Z',
    });
    expect(empty.leadName).toBeNull();
    expect(empty.leadEmail).toBeNull();
    expect(empty.leadMessage).toBeNull();
  });
});
