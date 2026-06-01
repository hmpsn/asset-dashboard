import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import {
  registerAdapter,
  __resetAdapterRegistryForTests,
  type DeliverableAdapter,
} from '../../server/domains/inbox/deliverable-adapters/types.js';
import { sendToClient, respondToDeliverable } from '../../server/domains/inbox/send-to-client.js';
import { getDeliverable } from '../../server/client-deliverables.js';

const WS = 'send-to-client-test';

const wsBroadcast = vi.fn();
beforeAll(() => {
  // The broadcast singleton is normally wired in index.ts after the WS server starts;
  // tests that exercise broadcasting paths init it with spies (established pattern).
  setBroadcast(vi.fn(), wsBroadcast);
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
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
  wsBroadcast.mockClear();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
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
});
