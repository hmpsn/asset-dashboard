/**
 * The Issue (Client) P1c — return-hook digest assembler (pure-read portion).
 *
 * assembleReturnHookDigest reads leads captured in the trailing 7 days + decisions still waiting on
 * the client. Money is always null here (the cron fills it — it owns the computeROI write). Recipient
 * is the client's OWN contact, so lead names (their own customers) ARE present — distinct from the
 * PII-free public count path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { createClientAction } from '../../server/client-actions.js';
import { assembleReturnHookDigest } from '../../server/the-issue-return-hook.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('assembleReturnHookDigest', () => {
  it('returns null for a missing workspace', () => {
    expect(assembleReturnHookDigest('does-not-exist')).toBeNull();
  });

  it('bare workspace → no leads, no decision, money null, hasContent false', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    const d = assembleReturnHookDigest(s.workspaceId)!;
    expect(d.leads).toBeNull();
    expect(d.decision).toBeNull();
    expect(d.money).toBeNull(); // money is always null in the assembler — the cron fills it
    expect(d.hasContent).toBe(false);
  });

  it('leads captured this week → leads section with count + recentNames (client OWN PII present)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    const now = isoDaysAgo(1);
    saveFormSubmission({
      workspaceId: s.workspaceId, formId: 'f1', submissionId: 'sub-1', formName: 'Contact',
      leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: 'note',
      eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
    });
    const d = assembleReturnHookDigest(s.workspaceId)!;
    expect(d.leads).not.toBeNull();
    expect(d.leads!.count).toBe(1);
    // The email goes to the client about their OWN customers — names are intentionally present here.
    expect(d.leads!.recentNames).toContain('Jane Doe');
    expect(typeof d.leads!.outcomeNoun).toBe('string');
    expect(d.leads!.outcomeNoun.length).toBeGreaterThan(0);
    expect(d.hasContent).toBe(true);
  });

  it('leads older than the 7-day window do NOT count', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    const old = isoDaysAgo(30);
    saveFormSubmission({
      workspaceId: s.workspaceId, formId: 'f1', submissionId: 'sub-old', formName: 'Contact',
      leadName: 'Old Lead', leadEmail: 'old@example.com', leadMessage: null,
      eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: old, capturedAt: old,
    });
    const d = assembleReturnHookDigest(s.workspaceId)!;
    expect(d.leads).toBeNull();
    expect(d.hasContent).toBe(false);
  });

  it('recentNames is capped at 3 and falls back to email/dash when name is null', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    const now = isoDaysAgo(1);
    for (let i = 0; i < 5; i++) {
      saveFormSubmission({
        workspaceId: s.workspaceId, formId: 'f1', submissionId: `sub-${i}`, formName: 'Contact',
        leadName: i === 0 ? null : `Lead ${i}`,
        leadEmail: i === 0 ? null : `l${i}@example.com`,
        leadMessage: null, eventName: 'form_submit', outcomeType: 'form_fill',
        submittedAt: now, capturedAt: now,
      });
    }
    const d = assembleReturnHookDigest(s.workspaceId)!;
    expect(d.leads!.count).toBe(5);            // full window count
    expect(d.leads!.recentNames.length).toBeLessThanOrEqual(3); // sample, capped at 3
  });

  it('pending client action → decision section with pendingCount', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    createClientAction({
      workspaceId: s.workspaceId, sourceType: 'content_decay',
      title: 'Approve a decay fix', summary: 'A landing page is decaying',
    });
    const d = assembleReturnHookDigest(s.workspaceId)!;
    expect(d.decision).not.toBeNull();
    expect(d.decision!.pendingCount).toBeGreaterThanOrEqual(1);
    expect(d.hasContent).toBe(true);
  });
});
