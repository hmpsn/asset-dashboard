// tests/unit/playbooks-outcome-tracking.test.ts
//
// Reconcile R8-PR1 (Task B13) — attribution seam coverage for server/playbooks.ts.
//
// enqueuePlaybook() fires the content_decay playbook fire-and-forget (no await), so these
// tests await a settle tick before asserting. The playbook's brief-creation half
// (generateBrief succeeding) previously recorded NO tracked action — only the client-action
// completion half did (via applyClientActionFeedbackLoop, mocked away here so this suite
// isolates the brief-creation seam). This suite pins:
//   1. success: generateBrief resolving records exactly one `brief_created` tracked action
//      with attribution 'platform_executed' and a source snapshot (brief title).
//   2. failure (FM-2): generateBrief rejecting records NO tracked action and the background
//      job status is 'error'.
//   3. idempotency: a pre-existing tracked action for the same brief is not duplicated.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientAction } from '../../shared/types/client-actions.js';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  updateJob: vi.fn(),
  generateBrief: vi.fn(),
  updateClientAction: vi.fn(),
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
  applyClientActionFeedbackLoop: vi.fn(),
  getActionByWorkspaceAndSource: vi.fn(),
  recordAction: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/jobs.js', () => ({
  createJob: mocks.createJob,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/content-brief.js', () => ({
  generateBrief: mocks.generateBrief,
}));
vi.mock('../../server/client-actions.js', () => ({
  updateClientAction: mocks.updateClientAction,
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: mocks.addActivity,
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mocks.broadcastToWorkspace,
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    CONTENT_UPDATED: 'content:updated',
    CLIENT_ACTION_UPDATE: 'client-action:update',
  },
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: mocks.invalidateIntelligenceCache,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/domains/inbox/client-action-feedback-loop.js', () => ({
  applyClientActionFeedbackLoop: mocks.applyClientActionFeedbackLoop,
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionByWorkspaceAndSource: mocks.getActionByWorkspaceAndSource,
  recordAction: mocks.recordAction,
}));

const { enqueuePlaybook } = await import('../../server/playbooks.js');

const baseAction: ClientAction = {
  id: 'action_1',
  workspaceId: 'ws_1',
  sourceType: 'content_decay',
  title: 'Refresh: best running shoes',
  summary: 'Content has decayed and needs a refresh.',
  payload: { targetKeyword: 'best running shoes', pageUrl: '/blog/best-running-shoes' } as unknown as ClientAction['payload'],
  status: 'approved',
  priority: 'medium',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function settle() {
  // enqueuePlaybook fires the playbook fire-and-forget; flush the microtask/promise queue.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('playbooks.ts — brief-creation attribution seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createJob.mockReturnValue({ id: 'job_1' });
    mocks.getActionByWorkspaceAndSource.mockReturnValue(null);
    mocks.updateClientAction.mockReturnValue({
      id: 'action_1',
      workspaceId: 'ws_1',
      sourceType: 'content_decay',
      title: 'Refresh: best running shoes',
      summary: 'Content has decayed and needs a refresh.',
      status: 'completed',
    });
  });

  it('records exactly one brief_created tracked action with platform_executed attribution + source snapshot on success', async () => {
    mocks.generateBrief.mockResolvedValue({
      id: 'brief_1',
      workspaceId: 'ws_1',
      targetKeyword: 'best running shoes',
      suggestedTitle: 'The Best Running Shoes for Every Runner',
    });

    enqueuePlaybook('ws_1', baseAction);
    await settle();

    expect(mocks.generateBrief).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      actionType: 'brief_created',
      sourceType: 'brief',
      sourceId: 'brief_1',
      targetKeyword: 'best running shoes',
      attribution: 'platform_executed',
      source: {
        label: 'The Best Running Shoes for Every Runner',
        snapshot: { title: 'The Best Running Shoes for Every Runner', type: 'brief' },
      },
    }));
    // Job completes successfully.
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'done' }));
  });

  it('records NO tracked action and the job status is failed when generateBrief rejects (FM-2)', async () => {
    mocks.generateBrief.mockRejectedValue(new Error('OpenAI request failed'));

    enqueuePlaybook('ws_1', baseAction);
    await settle();

    expect(mocks.generateBrief).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({
      status: 'error',
      message: 'Brief generation failed',
    }));
    // The client action must not be marked completed on a failed brief.
    expect(mocks.updateClientAction).not.toHaveBeenCalled();
  });

  it('does not duplicate the tracked action when one already exists for the brief (idempotency)', async () => {
    mocks.generateBrief.mockResolvedValue({
      id: 'brief_1',
      workspaceId: 'ws_1',
      targetKeyword: 'best running shoes',
      suggestedTitle: 'The Best Running Shoes for Every Runner',
    });
    mocks.getActionByWorkspaceAndSource.mockReturnValue({ id: 'existing_action' });

    enqueuePlaybook('ws_1', baseAction);
    await settle();

    expect(mocks.getActionByWorkspaceAndSource).toHaveBeenCalledWith('ws_1', 'brief', 'brief_1');
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it('omits the source snapshot when the brief has no suggestedTitle', async () => {
    mocks.generateBrief.mockResolvedValue({
      id: 'brief_2',
      workspaceId: 'ws_1',
      targetKeyword: 'best running shoes',
      suggestedTitle: '',
    });

    enqueuePlaybook('ws_1', baseAction);
    await settle();

    expect(mocks.recordAction).toHaveBeenCalledWith(expect.not.objectContaining({ source: expect.anything() }));
  });

  it('a tracking failure inside recordAction does not abort the playbook', async () => {
    mocks.generateBrief.mockResolvedValue({
      id: 'brief_1',
      workspaceId: 'ws_1',
      targetKeyword: 'best running shoes',
      suggestedTitle: 'The Best Running Shoes for Every Runner',
    });
    mocks.recordAction.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    enqueuePlaybook('ws_1', baseAction);
    await settle();

    // The playbook still completes successfully despite the tracking failure.
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'done' }));
    expect(mocks.updateClientAction).toHaveBeenCalledWith('ws_1', 'action_1', { status: 'completed' });
  });
});
