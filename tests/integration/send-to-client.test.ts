import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  registerAdapter,
  __resetAdapterRegistryForTests,
  type DeliverableAdapter,
} from '../../server/domains/inbox/deliverable-adapters/types.js';
import { sendToClient, respondToDeliverable, remindDeliverable } from '../../server/domains/inbox/send-to-client.js';
import { getDeliverable, upsertDeliverable } from '../../server/client-deliverables.js';
import { InvalidTransitionError } from '../../server/state-machines.js';

const WS = 'send-to-client-test';

const emailState = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; html: string }>,
  approvalReady: [] as unknown[],
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    isEmailConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async (to: string, subject: string, html: string) => {
      emailState.sent.push({ to, subject, html });
      return true;
    }),
    notifyApprovalReady: vi.fn((payload: unknown) => {
      emailState.approvalReady.push(payload);
    }),
    notifyTeamActionApproved: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
  };
});

const wsBroadcast = vi.fn();
let reminderWorkspaceId = '';
const originalAppUrl = process.env.APP_URL;

beforeAll(() => {
  // The broadcast singleton is normally wired in index.ts after the WS server starts;
  // tests that exercise broadcasting paths init it with spies (established pattern).
  setBroadcast(vi.fn(), wsBroadcast);
  process.env.APP_URL = 'https://portal.test';
  const reminderWorkspace = createWorkspace('SendToClient Reminder Test');
  reminderWorkspaceId = reminderWorkspace.id;
  db.prepare('UPDATE workspaces SET client_email = ? WHERE id = ?').run(
    'reminder-client@example.com',
    reminderWorkspaceId,
  );
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(reminderWorkspaceId);
  db.prepare("DELETE FROM sent_reminders WHERE key LIKE 'deliverable:%'").run();
  db.prepare("DELETE FROM email_sends WHERE recipient = 'reminder-client@example.com'").run();
  if (reminderWorkspaceId) deleteWorkspace(reminderWorkspaceId);
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }
});

interface FakeInput {
  ready: boolean;
  title: string;
}

let applyCalls: string[] = [];

// A no-op-apply adapter (apply is opt-in; default off — D-apply).
function noopApplyAdapter(): DeliverableAdapter<FakeInput> {
  return {
    type: 'redirect',
    validateSendable: (input) => (input.ready ? { ok: true } : { ok: false, reason: 'not ready' }),
    buildPayload: (input) => ({ title: input.title, kind: 'decision', payload: { ready: input.ready } }),
    sourceRef: () => 'redirect:fake-site',
  };
}

// An opt-in-apply adapter (appliesOnApprove true).
function applyingAdapter(): DeliverableAdapter<FakeInput> {
  return {
    type: 'internal_link',
    validateSendable: () => ({ ok: true }),
    buildPayload: (input) => ({ title: input.title, kind: 'decision', payload: {} }),
    sourceRef: () => 'internal_link:fake-site',
    appliesOnApprove: true,
    applyDeliverable: async (d) => {
      applyCalls.push(d.id);
      return { applied: 1 };
    },
  };
}

beforeEach(() => {
  __resetAdapterRegistryForTests();
  applyCalls = [];
  emailState.sent = [];
  emailState.approvalReady = [];
  wsBroadcast.mockClear();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  if (reminderWorkspaceId) {
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(reminderWorkspaceId);
  }
  db.prepare("DELETE FROM sent_reminders WHERE key LIKE 'deliverable:%'").run();
  db.prepare("DELETE FROM email_sends WHERE recipient = 'reminder-client@example.com'").run();
});

describe('sendToClient', () => {
  it('rejects not-ready input via validateSendable before writing anything', async () => {
    registerAdapter(noopApplyAdapter());
    await expect(
      sendToClient(WS, 'redirect', { ready: false, title: 'Bad' }),
    ).rejects.toThrow(/not ready/i);
    const rows = db.prepare('SELECT COUNT(*) c FROM client_deliverable WHERE workspace_id = ?').get(WS) as {
      c: number;
    };
    expect(rows.c).toBe(0);
  });

  it('inserts a guarded awaiting_client row on a valid send', async () => {
    registerAdapter(noopApplyAdapter());
    const d = await sendToClient(WS, 'redirect', { ready: true, title: 'Redirect proposal' });
    expect(d.status).toBe('awaiting_client');
    expect(d.title).toBe('Redirect proposal');
    expect(d.sentAt).toBeTruthy();
    expect(d.sourceRef).toBe('redirect:fake-site');
    expect(wsBroadcast).toHaveBeenCalledWith(WS, WS_EVENTS.DELIVERABLE_SENT, expect.objectContaining({ deliverableId: d.id }));
  });

  it('resend onto a still-pending awaiting_client row supersedes (same dedup row, no throw)', async () => {
    registerAdapter(noopApplyAdapter());
    const first = await sendToClient(WS, 'redirect', { ready: true, title: 'First' });
    const second = await sendToClient(WS, 'redirect', { ready: true, title: 'Second' });
    // Dedup-on-resend: same (ws, type, sourceRef) → same row, refreshed.
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('awaiting_client');
    expect(second.title).toBe('Second');
  });

  it('resend onto a TERMINAL row throws and does NOT revert status / null decided_at', async () => {
    registerAdapter(noopApplyAdapter());
    const sent = await sendToClient(WS, 'redirect', { ready: true, title: 'Original' });
    // Force the deduped row to a terminal status with a decided_at, simulating an
    // approval that has already happened (the store is the only table writer).
    const decidedAtIso = '2026-01-01T00:00:00.000Z';
    const approved = upsertDeliverable({
      id: sent.id,
      workspaceId: WS,
      type: 'redirect',
      kind: 'decision',
      status: 'approved',
      title: sent.title,
      payload: {},
      sourceRef: 'redirect:fake-site',
      sentAt: sent.sentAt,
      decidedAt: decidedAtIso,
    });
    expect(approved.status).toBe('approved');

    // A second send with the same sourceRef must THROW (no silent revert via ON CONFLICT).
    await expect(
      sendToClient(WS, 'redirect', { ready: true, title: 'Sneaky resend' }),
    ).rejects.toThrow(InvalidTransitionError);

    // The terminal row is untouched: still approved, decided_at preserved, title unchanged.
    const after = getDeliverable(sent.id)!;
    expect(after.status).toBe('approved');
    expect(after.decidedAt).toBe(decidedAtIso);
    expect(after.title).toBe('Original');
  });
});

describe('respondToDeliverable', () => {
  it('approve transitions to approved, sets decided_at, and does NOT apply for a no-op adapter', async () => {
    registerAdapter(noopApplyAdapter());
    const d = await sendToClient(WS, 'redirect', { ready: true, title: 'R' });
    const updated = await respondToDeliverable(WS, d.id, { decision: 'approved' });
    expect(updated.status).toBe('approved');
    expect(updated.decidedAt).toBeTruthy();
    expect(applyCalls).toHaveLength(0);
    expect(wsBroadcast).toHaveBeenCalledWith(
      WS,
      WS_EVENTS.DELIVERABLE_UPDATED,
      expect.objectContaining({ deliverableId: d.id, status: 'approved' }),
    );
  });

  it('changes_requested persists the client response note and stays guarded', async () => {
    registerAdapter(noopApplyAdapter());
    const d = await sendToClient(WS, 'redirect', { ready: true, title: 'R' });
    const updated = await respondToDeliverable(WS, d.id, {
      decision: 'changes_requested',
      note: 'please tweak /a',
    });
    expect(updated.status).toBe('changes_requested');
    expect(updated.clientResponseNote).toBe('please tweak /a');
  });

  it('approve DOES apply when the adapter opted in (appliesOnApprove)', async () => {
    registerAdapter(applyingAdapter());
    const d = await sendToClient(WS, 'internal_link', { ready: true, title: 'IL' });
    const updated = await respondToDeliverable(WS, d.id, { decision: 'approved' });
    expect(updated.status).toBe('applied');
    expect(updated.appliedAt).toBeTruthy();
    expect(applyCalls).toEqual([d.id]);
  });

  it('rejects an illegal transition (declined deliverable cannot be approved)', async () => {
    registerAdapter(noopApplyAdapter());
    const d = await sendToClient(WS, 'redirect', { ready: true, title: 'R' });
    await respondToDeliverable(WS, d.id, { decision: 'declined' });
    await expect(respondToDeliverable(WS, d.id, { decision: 'approved' })).rejects.toThrow();
    expect(getDeliverable(d.id)!.status).toBe('declined');
  });

  it('rejects a whole-bundle brand response before mutating the mirror', async () => {
    const d = upsertDeliverable({
      workspaceId: WS,
      type: 'brand_generation',
      kind: 'review',
      status: 'awaiting_client',
      title: 'Brand system review',
      payload: { family: 'brand_generation' },
      sourceRef: 'brand_generation:brand_suite:run-1',
    });

    await expect(respondToDeliverable(WS, d.id, { decision: 'approved' }))
      .rejects.toMatchObject({ status: 409 });
    expect(getDeliverable(d.id)!.status).toBe('awaiting_client');
  });
});

describe('remindDeliverable', () => {
  function seedReminderTarget(title = 'Reminder target') {
    return upsertDeliverable({
      workspaceId: reminderWorkspaceId,
      type: 'redirect',
      kind: 'decision',
      status: 'awaiting_client',
      title,
      payload: {},
      sentAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    });
  }

  it('sends reminder copy and records a deliverable reminder key', async () => {
    const d = seedReminderTarget('Redirect reminder target');

    const reminded = await remindDeliverable(reminderWorkspaceId, d.id);

    expect(reminded.id).toBe(d.id);
    expect(emailState.sent).toHaveLength(1);
    expect(emailState.sent[0].to).toBe('reminder-client@example.com');
    expect(emailState.sent[0].subject).toContain('Reminder:');
    expect(emailState.sent[0].html).toContain('Approval Reminder');
    expect(emailState.sent[0].html).toContain(`https://portal.test/client/${reminderWorkspaceId}`);
    const row = db.prepare('SELECT sent_at FROM sent_reminders WHERE key = ?').get(`deliverable:${d.id}`);
    expect(row).toBeTruthy();
  });

  it('does not send a duplicate reminder within the three-day reminder window', async () => {
    const d = seedReminderTarget();

    await remindDeliverable(reminderWorkspaceId, d.id);
    await remindDeliverable(reminderWorkspaceId, d.id);

    expect(emailState.sent).toHaveLength(1);
    const rows = db.prepare('SELECT COUNT(*) AS count FROM sent_reminders WHERE key = ?').get(`deliverable:${d.id}`) as { count: number };
    expect(rows.count).toBe(1);
  });
});
