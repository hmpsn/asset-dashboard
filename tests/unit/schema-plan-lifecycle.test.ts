import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const mockAddActivity = vi.fn();
const mockBroadcastToWorkspace = vi.fn();
const mockWarn = vi.fn();
const mockGetSchemaPlan = vi.fn();
const mockUpdateSchemaPlanStatus = vi.fn();
const mockBroadcastSchemaPlanUpdated = vi.fn();
const mockHasActiveJob = vi.fn();
const mockInvalidateIntelligenceCache = vi.fn();

vi.mock('../../server/activity-log.js', () => ({
  addActivity: mockAddActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: mockWarn,
  })),
}));

vi.mock('../../server/schema-store.js', () => ({
  getSchemaPlan: mockGetSchemaPlan,
  updateSchemaPlanStatus: mockUpdateSchemaPlanStatus,
}));

vi.mock('../../server/schema-plan-generation-job.js', () => ({
  broadcastSchemaPlanUpdated: mockBroadcastSchemaPlanUpdated,
}));

vi.mock('../../server/jobs.js', () => ({
  hasActiveJob: mockHasActiveJob,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: mockInvalidateIntelligenceCache,
}));

function makePlan(overrides: Partial<SchemaSitePlan> = {}): SchemaSitePlan {
  return {
    id: 'plan_1',
    siteId: 'site_1',
    workspaceId: 'ws_1',
    siteUrl: 'https://example.test',
    canonicalEntities: [],
    pageRoles: [],
    status: 'sent_to_client',
    generatedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

async function loadModule() {
  return import('../../server/domains/schema/schema-plan-feedback.js');
}

describe('schema-plan-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasActiveJob.mockReturnValue(null);
  });

  it('respondToSchemaPlanFeedback updates plan status, logs activity, invalidates intelligence, and broadcasts', async () => {
    const existing = makePlan();
    const approved = makePlan({ status: 'client_approved' });
    mockGetSchemaPlan.mockReturnValue(existing);
    mockUpdateSchemaPlanStatus.mockReturnValue(approved);

    const { respondToSchemaPlanFeedback } = await loadModule();
    const result = respondToSchemaPlanFeedback('ws_1', 'site_1', 'approve', 'Looks good');

    expect(result).toEqual({ plan: approved, status: 'client_approved' });
    expect(mockUpdateSchemaPlanStatus).toHaveBeenCalledWith('site_1', 'client_approved');
    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_1',
      'changes_requested',
      'Client approved schema plan',
      'Looks good',
    );
    expect(mockInvalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
    expect(mockBroadcastSchemaPlanUpdated).toHaveBeenCalledWith('ws_1', {
      siteId: 'site_1',
      action: 'client_feedback',
      status: 'client_approved',
    });
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_1', WS_EVENTS.SCHEMA_PLAN_SENT, {
      siteId: 'site_1',
      action: 'schema_plan_feedback',
      status: 'client_approved',
    });
  });

  it('assertSchemaPlanFeedbackAllowed throws a 409 conflict when generation is active', async () => {
    mockHasActiveJob.mockReturnValue({ id: 'job_123' });

    const { assertSchemaPlanFeedbackAllowed, SchemaPlanFeedbackConflictError } = await loadModule();

    expect(() => assertSchemaPlanFeedbackAllowed('ws_1')).toThrow(SchemaPlanFeedbackConflictError);
    expect(() => assertSchemaPlanFeedbackAllowed('ws_1')).toThrow(
      'Schema plan generation is in progress. Wait for it to finish before responding to this plan.',
    );
  });
});
