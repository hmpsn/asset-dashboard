import { describe, expect, it } from 'vitest';

import { signAdminToken } from '../../server/middleware.js';
import { resolveJobDelivery, resolveSocketAuth } from '../../server/websocket.js';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobRecord,
} from '../../shared/types/background-jobs.js';

function makeJob(overrides: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
  return {
    id: 'job-1',
    type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
    status: 'done',
    message: 'Done',
    result: { generatedAt: '2026-06-08T12:00:00.000Z', count: 4 },
    error: 'sensitive error',
    createdAt: '2026-06-08T12:00:00.000Z',
    updatedAt: '2026-06-08T12:01:00.000Z',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

describe('resolveJobDelivery', () => {
  it('sends full workspace job payloads to authenticated admins with workspace access', () => {
    const job = makeJob();

    const delivery = resolveJobDelivery({
      job,
      auth: {
        userId: 'user-1',
        email: 'admin@test.local',
        role: 'member',
        workspaceIds: ['ws-1'],
      },
    });

    expect(delivery).toEqual({
      data: job,
      workspaceId: 'ws-1',
    });
  });

  it('sends full global job payloads only to owners', () => {
    const job = makeJob({
      workspaceId: undefined,
      type: 'sales-report',
    });

    expect(resolveJobDelivery({
      job,
      auth: {
        userId: 'owner-1',
        email: 'owner@test.local',
        role: 'owner',
      },
    })).toEqual({ data: job });

    expect(resolveJobDelivery({
      job,
      auth: {
        userId: 'member-1',
        email: 'member@test.local',
        role: 'member',
        workspaceIds: ['ws-1'],
      },
    })).toBeNull();
  });

  it('scrubs client-visible workspace jobs for unauthenticated subscribed clients', () => {
    const job = makeJob();

    const delivery = resolveJobDelivery({
      job,
      subscribedWorkspaces: new Set(['ws-1']),
    });

    expect(delivery).toEqual({
      data: {
        id: 'job-1',
        type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
        status: 'done',
        message: 'Done',
        error: 'sensitive error',
        createdAt: '2026-06-08T12:00:00.000Z',
        updatedAt: '2026-06-08T12:01:00.000Z',
        workspaceId: 'ws-1',
      },
      workspaceId: 'ws-1',
    });
    expect(delivery?.data).not.toHaveProperty('result');
  });

  it('does not send non-client-visible workspace jobs to unauthenticated subscribed clients', () => {
    const job = makeJob({
      type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS,
    });

    expect(resolveJobDelivery({
      job,
      subscribedWorkspaces: new Set(['ws-1']),
    })).toBeNull();
  });

  it('does not send workspace jobs to authenticated admins outside their workspace scope', () => {
    const job = makeJob();

    expect(resolveJobDelivery({
      job,
      auth: {
        userId: 'member-1',
        email: 'member@test.local',
        role: 'member',
        workspaceIds: ['ws-2'],
      },
    })).toBeNull();
  });
});

describe('resolveSocketAuth', () => {
  it('accepts admin HMAC tokens as owner-authenticated websocket sessions', () => {
    const auth = resolveSocketAuth(signAdminToken());

    expect(auth).toEqual({
      userId: 'admin-hmac',
      email: 'admin@local',
      role: 'owner',
    });
  });

  it('rejects invalid websocket auth tokens', () => {
    expect(resolveSocketAuth('definitely-not-valid')).toBeNull();
  });
});
