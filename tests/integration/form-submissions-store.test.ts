import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  saveFormSubmission,
  loadFormSubmissions,
  countFormSubmissions,
  getFormCaptureStatus,
  reconcileFormCountVsGa4,
} from '../../server/form-submissions.js';

let wsId: string;
let cleanup: () => void;
beforeAll(() => {
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
});
afterAll(() => {
  cleanup();
});

describe('form_submissions store (P1a)', () => {
  it('round-trips a named lead and is idempotent on (workspaceId, submissionId)', () => {
    const base = {
      workspaceId: wsId, formId: 'form_abc', submissionId: 'wf_sub_1', formName: 'Contact',
      leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'Quote please',
      eventName: 'form_submit', outcomeType: 'form_fill' as const,
      submittedAt: '2026-06-19T12:00:00.000Z', capturedAt: '2026-06-19T12:00:01.000Z',
    };
    const r1 = saveFormSubmission(base);
    const r2 = saveFormSubmission(base); // duplicate webhook re-delivery
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);

    const rows = loadFormSubmissions(wsId);
    expect(rows).toHaveLength(1);
    expect(rows[0].leadName).toBe('Jane Doe');
    expect(rows[0].outcomeType).toBe('form_fill');

    expect(countFormSubmissions(wsId, { startDate: '2026-06-01', endDate: '2026-06-30' })).toBe(1);
  });

  it('getFormCaptureStatus reports count + last-submission freshness (no PII)', () => {
    const status = getFormCaptureStatus(wsId);
    expect(status.count).toBe(1);
    expect(status.lastSubmissionAt).toBe('2026-06-19T12:00:00.000Z');
    expect(Object.keys(status)).toEqual(['count', 'lastSubmissionAt']);
  });

  it('reconcileFormCountVsGa4 surfaces the discrepancy (counts only)', () => {
    const r = reconcileFormCountVsGa4(wsId, 5, { startDate: '2026-06-01', endDate: '2026-06-30' });
    expect(r).toEqual({ capturedCount: 1, ga4Count: 5, discrepancy: 4 });
  });
});
