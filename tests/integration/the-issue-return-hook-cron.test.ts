/**
 * The Issue (Client) P1c — weekly return-hook cron: flag gating, content gating, weekly idempotency.
 *
 * In-process (real DB, real assembler/computeROI). Only notifyClientReturnHook is mocked — so we can
 * assert the send + recipient without binding SMTP. Side-effects asserted directly: the weekly marker
 * (lastReturnHookSentWeekOf) and the operator activity (client_return_hook_sent).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Mock ONLY notifyClientReturnHook; pass every other email export through. Default returns true
// (enqueued) — the cron now stamps the week marker ONLY on a confirmed enqueue.
vi.mock('../../server/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return { ...actual, notifyClientReturnHook: vi.fn(() => true) };
});

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { updateWorkspace, getWorkspace } from '../../server/workspaces.js';
import { saveFormSubmission } from '../../server/form-submissions.js';
import { saveGa4Snapshot } from '../../server/ga4-snapshots.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { listActivityByType } from '../../server/activity-log.js';
import { createClientAction } from '../../server/client-actions.js';
import { notifyClientReturnHook } from '../../server/email.js';
import { runReturnHookForWorkspace } from '../../server/return-hook-cron.js';

const notifyMock = vi.mocked(notifyClientReturnHook);
const cleanups: Array<() => void> = [];
let leadSeq = 0;

function seedLeadThisWeek(wsId: string): void {
  const now = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  saveFormSubmission({
    workspaceId: wsId, formId: 'f1', submissionId: `sub-${leadSeq++}`, formName: 'Contact',
    leadName: 'Jane Doe', leadEmail: 'jane@example.com', leadMessage: null,
    eventName: 'form_submit', outcomeType: 'form_fill', submittedAt: now, capturedAt: now,
  });
}
function enableReturnHook(wsId: string): void {
  setWorkspaceFlagOverride('the-issue-client-return-hook', wsId, true);
  cleanups.push(() => setWorkspaceFlagOverride('the-issue-client-return-hook', wsId, null));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('runReturnHookForWorkspace', () => {
  it('flag OFF → skipped, no email queued, no marker stamped (byte-identical OFF)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    seedLeadThisWeek(s.workspaceId);
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('skipped');
    expect(notifyMock).not.toHaveBeenCalled();
    expect(getWorkspace(s.workspaceId)!.lastReturnHookSentWeekOf ?? null).toBeNull();
  });

  it('flag ON + clientEmail + a lead this week → sent, email queued, marker stamped, activity logged', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    enableReturnHook(s.workspaceId);
    seedLeadThisWeek(s.workspaceId);
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('sent');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ clientEmail: 'client@acme.test', leadCount: 1 });
    expect(getWorkspace(s.workspaceId)!.lastReturnHookSentWeekOf).toBe(r.weekOf);
    expect(listActivityByType(s.workspaceId, 'client_return_hook_sent').length).toBeGreaterThanOrEqual(1);
  });

  it('enqueue fails (SMTP unconfigured / no recipient) → skipped, marker NOT stamped, no activity (so it re-sends once deliverable)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    enableReturnHook(s.workspaceId);
    seedLeadThisWeek(s.workspaceId);
    notifyMock.mockReturnValueOnce(false); // notifyClientReturnHook reports it did NOT enqueue
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('email not configured');
    // Critical: the week marker must NOT be burned on a no-op enqueue, or the duplicate guard would
    // suppress the real send for the rest of the week.
    expect(getWorkspace(s.workspaceId)!.lastReturnHookSentWeekOf ?? null).toBeNull();
    expect(listActivityByType(s.workspaceId, 'client_return_hook_sent').length).toBe(0);
  });

  it('flag ON but NO content → skipped, no email, marker NOT stamped (re-runnable later this week)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    enableReturnHook(s.workspaceId);
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no content');
    expect(notifyMock).not.toHaveBeenCalled();
    expect(getWorkspace(s.workspaceId)!.lastReturnHookSentWeekOf ?? null).toBeNull();
  });

  it('decision still pending (no leads) → sends a decision-only digest', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    enableReturnHook(s.workspaceId);
    createClientAction({ workspaceId: s.workspaceId, sourceType: 'content_decay', title: 'Approve fix', summary: 'A page is decaying' });
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('sent');
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ pendingCount: 1 });
  });

  it('duplicate week → second run is a no-op (one email total)', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, { clientEmail: 'client@acme.test' });
    enableReturnHook(s.workspaceId);
    seedLeadThisWeek(s.workspaceId);
    const first = runReturnHookForWorkspace(s.workspaceId);
    expect(first.status).toBe('sent');
    const second = runReturnHookForWorkspace(s.workspaceId);
    expect(second.status).toBe('duplicate');
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('no clientEmail → skipped, no email', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    enableReturnHook(s.workspaceId);
    seedLeadThisWeek(s.workspaceId);
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no client email');
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('money section: measured verdict + value + this-week leads → moneyValue passed', () => {
    const s = seedWorkspace(); cleanups.push(s.cleanup);
    updateWorkspace(s.workspaceId, {
      clientEmail: 'client@acme.test',
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate', monthlyRetainer: 1500 },
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
      conversionTrackingConfirmedAt: new Date().toISOString(),
    });
    // computeROI returns null without page/keyword data — seed a page so the verdict hydrates.
    upsertPageKeywordsBatch(s.workspaceId, [{
      pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'dentist near me',
      secondaryKeywords: [], clicks: 100, impressions: 1000, cpc: 3.5,
    }]);
    setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, true);
    setWorkspaceFlagOverride('the-issue-client-measured-capture', s.workspaceId, true);
    enableReturnHook(s.workspaceId);
    cleanups.push(() => {
      setWorkspaceFlagOverride('the-issue-client-spine', s.workspaceId, null);
      setWorkspaceFlagOverride('the-issue-client-measured-capture', s.workspaceId, null);
    });
    saveGa4Snapshot({
      workspaceId: s.workspaceId, capturedAt: new Date().toISOString(),
      totalConversions: 14, totalUsers: 200,
      byEvent: [{ eventName: 'form_submit', conversions: 14, users: 200, rate: 7 }],
    });
    seedLeadThisWeek(s.workspaceId);
    const r = runReturnHookForWorkspace(s.workspaceId);
    expect(r.status).toBe('sent');
    expect(notifyMock.mock.calls[0][0].moneyValue).toBeGreaterThan(0);
  });
});
