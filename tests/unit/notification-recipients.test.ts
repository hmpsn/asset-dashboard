import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeClientUser } from '../../shared/types/users.js';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listClientUsers: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/client-users.js', () => ({
  listClientUsers: mocks.listClientUsers,
}));

import {
  getClientNotificationRecipientPolicy,
  listClientNotificationRecipients,
} from '../../server/notification-recipients.js';

function user(email: string): SafeClientUser {
  return {
    id: `cu_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    email,
    name: 'Client User',
    role: 'client_member',
    workspaceId: 'ws_recipients',
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

beforeEach(() => {
  mocks.getWorkspace.mockReset();
  mocks.listClientUsers.mockReset();
});

describe('client notification recipients', () => {
  it('resolves workspace-primary events from workspace.clientEmail', () => {
    mocks.getWorkspace.mockReturnValue({
      id: 'ws_recipients',
      name: 'Recipient Workspace',
      clientEmail: '  primary@example.com  ',
    });

    expect(listClientNotificationRecipients('ws_recipients', 'approval_ready')).toEqual([
      { email: 'primary@example.com', source: 'workspace.clientEmail' },
    ]);
    expect(mocks.listClientUsers).not.toHaveBeenCalled();
  });

  it('returns no workspace-primary recipients when the workspace has no client email', () => {
    mocks.getWorkspace.mockReturnValue({
      id: 'ws_recipients',
      name: 'Recipient Workspace',
      clientEmail: '',
    });

    expect(listClientNotificationRecipients('ws_recipients', 'audit_complete')).toEqual([]);
  });

  it('resolves work-order events from deduped client-user emails', () => {
    mocks.listClientUsers.mockReturnValue([
      user('owner@example.com'),
      user('OWNER@example.com'),
      user(' teammate@example.com '),
    ]);

    expect(listClientNotificationRecipients('ws_recipients', 'work_order_comment_client')).toEqual([
      { email: 'owner@example.com', source: 'client_users.email' },
      { email: 'teammate@example.com', source: 'client_users.email' },
    ]);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });

  it('documents caller-owned explicit-recipient events', () => {
    expect(getClientNotificationRecipientPolicy('password_reset')).toMatchObject({
      authority: 'explicit_recipient',
      source: 'caller',
    });
    expect(getClientNotificationRecipientPolicy('client_welcome')).toMatchObject({
      authority: 'explicit_recipient',
      source: 'caller',
    });
  });
});
