import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebflowSignature, parseWebflowFormPayload, resolveOutcomeType } from '../../server/webflow-form-webhook.js';

const SECRET = 'whsec_test_123';
const sign = (b: string) => crypto.createHmac('sha256', SECRET).update(b).digest('hex');

describe('webflow form webhook helpers (P1a)', () => {
  it('verifies a valid HMAC-SHA256 signature, rejects a bad one (timing-safe)', () => {
    const body = JSON.stringify({ triggerType: 'form_submission', payload: { id: 'x' } });
    expect(verifyWebflowSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebflowSignature(body, 'deadbeef', SECRET)).toBe(false);
  });
  it('rejects a wrong-length / empty signature without throwing', () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyWebflowSignature(body, '', SECRET)).toBe(false);
    expect(verifyWebflowSignature(body, 'short', SECRET)).toBe(false);
  });
  it('parses a form_submission payload, tolerant of field casing; returns null on non-form trigger', () => {
    const ok = parseWebflowFormPayload({ triggerType: 'form_submission', payload: {
      formId: 'form_abc', name: 'Contact', id: 'wf_sub_99', submittedAt: '2026-06-19T12:00:00.000Z',
      data: { Name: 'Jane Doe', Email: 'jane@example.com', Message: 'Quote please' } } });
    expect(ok?.leadName).toBe('Jane Doe');
    expect(ok?.leadEmail).toBe('jane@example.com');
    expect(ok?.leadMessage).toBe('Quote please');
    expect(ok?.submissionId).toBe('wf_sub_99');
    expect(ok?.formName).toBe('Contact');
    expect(parseWebflowFormPayload({ triggerType: 'site_publish', payload: {} })).toBeNull();
  });
  it('returns null on a malformed body (missing submission id)', () => {
    expect(parseWebflowFormPayload({ triggerType: 'form_submission', payload: { formId: 'f' } })).toBeNull();
    expect(parseWebflowFormPayload(null)).toBeNull();
    expect(parseWebflowFormPayload('not an object')).toBeNull();
  });
  it('resolves outcome type from the workspace mapping; defaults to form_fill for an unmapped form', () => {
    const ws = { webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'booking' as const }] };
    expect(resolveOutcomeType(ws, 'form_abc', 'Contact')).toBe('booking');
    expect(resolveOutcomeType(ws, 'form_zzz', 'Other')).toBe('form_fill');
    expect(resolveOutcomeType({}, 'form_abc', 'Contact')).toBe('form_fill');
  });
});
