/**
 * The Issue (Client) P1a — Webflow form-submission POLLER (replaces the HMAC webhook receiver).
 *
 * runWebflowFormPoll() walks every workspace with the measured-capture flag ON + ≥1 tracked form
 * (webflowFormSources), lists that form's submissions via the Webflow Data API, dedup-ingests each via
 * saveFormSubmission, and on a genuinely-new insert broadcasts FORM_SUBMISSION_CAPTURED + logs the
 * PII-FREE form_submission_captured activity. Daily cadence. Per-workspace try/catch (FM-2): a Webflow
 * API error degrades that workspace only, never throws the pass.
 *
 * Mocks the whole dependency surface (workspaces, webflow-forms, store, broadcast, activity, flags) so
 * this is a fast deterministic logic test — the live API + DB are exercised in the integration suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<Record<string, unknown>>,
  flagEnabled: true,
  listSubmissions: vi.fn(),
  saveFormSubmission: vi.fn(),
  updateWorkspace: vi.fn(),
  broadcast: vi.fn(),
  addActivity: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: () => state.workspaces,
  getTokenForSite: () => 'tok_test',
  updateWorkspace: (...a: unknown[]) => state.updateWorkspace(...a),
}));

vi.mock('../../server/webflow-forms.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/webflow-forms.js')>('../../server/webflow-forms.js');
  return {
    ...actual, // keep the REAL mapWebflowSubmission + resolveOutcomeType (deterministic mapping under test)
    listWebflowFormSubmissions: (...a: unknown[]) => state.listSubmissions(...a),
  };
});

vi.mock('../../server/form-submissions.js', () => ({
  saveFormSubmission: (...a: unknown[]) => state.saveFormSubmission(...a),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: (...a: unknown[]) => state.broadcast(...a),
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: (...a: unknown[]) => state.addActivity(...a),
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: () => state.flagEnabled,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { runWebflowFormPoll } from '../../server/webflow-form-poller.js';
import { WS_EVENTS } from '../../server/ws-events.js';

const SUB = {
  id: 'wf_sub_1', formId: 'form_abc', displayName: 'Contact',
  dateSubmitted: '2026-06-19T12:00:00.000Z',
  formResponse: { Name: 'Jane Doe', Email: 'jane@example.com', Message: 'Quote please' },
};

beforeEach(() => {
  vi.clearAllMocks();
  state.flagEnabled = true;
  state.workspaces = [{
    id: 'ws-1', webflowSiteId: 'site-1',
    webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' }],
  }];
  state.listSubmissions.mockResolvedValue([SUB]);
  state.saveFormSubmission.mockReturnValue({ inserted: true, id: 'row-1' });
});

describe('runWebflowFormPoll', () => {
  it('ingests a new submission and broadcasts + logs PII-free on insert', async () => {
    await runWebflowFormPoll();
    // Mapped via the REAL mapper → PII captured in the stored row.
    expect(state.saveFormSubmission).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1', submissionId: 'wf_sub_1', outcomeType: 'form_fill',
      leadName: 'Jane Doe', leadEmail: 'jane@example.com',
    }));
    expect(state.broadcast).toHaveBeenCalledWith('ws-1', WS_EVENTS.FORM_SUBMISSION_CAPTURED, {
      workspaceId: 'ws-1', outcomeType: 'form_fill',
    });
    // Activity metadata must be PII-FREE (formId + outcomeType only, no name/email/message).
    expect(state.addActivity).toHaveBeenCalledTimes(1);
    const meta = state.addActivity.mock.calls[0][4];
    expect(meta).toEqual({ formId: 'form_abc', outcomeType: 'form_fill' });
    expect(JSON.stringify(state.addActivity.mock.calls[0])).not.toMatch(/jane@example\.com|Jane Doe|Quote please/);
  });

  it('flips conversionTrackingConfirmedAt on the first captured lead (D6 provenance flip)', async () => {
    await runWebflowFormPoll();
    expect(state.updateWorkspace).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      conversionTrackingConfirmedAt: expect.any(String),
    }));
  });

  it('does NOT broadcast/log/flip a duplicate (idempotent — saveFormSubmission inserted:false)', async () => {
    state.saveFormSubmission.mockReturnValue({ inserted: false, id: 'row-1' });
    await runWebflowFormPoll();
    expect(state.broadcast).not.toHaveBeenCalled();
    expect(state.addActivity).not.toHaveBeenCalled();
    expect(state.updateWorkspace).not.toHaveBeenCalled();
  });

  it('no-ops when the flag is OFF for a workspace (never lists/ingests)', async () => {
    state.flagEnabled = false;
    await runWebflowFormPoll();
    expect(state.listSubmissions).not.toHaveBeenCalled();
    expect(state.saveFormSubmission).not.toHaveBeenCalled();
    expect(state.broadcast).not.toHaveBeenCalled();
  });

  it('no-ops a workspace with no tracked forms (empty webflowFormSources)', async () => {
    state.workspaces = [{ id: 'ws-2', webflowSiteId: 'site-2', webflowFormSources: [] }];
    await runWebflowFormPoll();
    expect(state.listSubmissions).not.toHaveBeenCalled();
  });

  it('FM-2: a Webflow API error degrades that workspace only, never throws the pass', async () => {
    state.workspaces = [
      { id: 'ws-bad', webflowSiteId: 'site-b', webflowFormSources: [{ formId: 'f', formName: 'F', outcomeType: 'form_fill' }] },
      { id: 'ws-ok', webflowSiteId: 'site-o', webflowFormSources: [{ formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' }] },
    ];
    state.listSubmissions
      .mockRejectedValueOnce(new Error('Webflow 500'))
      .mockResolvedValueOnce([SUB]);
    // Must NOT throw — the bad workspace is swallowed, the good one still ingests.
    await expect(runWebflowFormPoll()).resolves.toBeUndefined();
    expect(state.saveFormSubmission).toHaveBeenCalledTimes(1);
    expect(state.broadcast).toHaveBeenCalledWith('ws-ok', WS_EVENTS.FORM_SUBMISSION_CAPTURED, expect.anything());
  });
});
