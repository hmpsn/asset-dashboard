/**
 * Unit/integration tests for server/payments.ts
 *
 * Uses the real SQLite DB with a unique workspace ID for test isolation.
 * All test data is cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  createPayment,
  updatePayment,
  getPayment,
  listPayments,
  listAllPayments,
  deletePayment,
  deleteAllPayments,
  getPaymentBySession,
  listPaymentsBySession,
  getPaymentByPaymentIntent,
} from '../../server/payments.js';
import type { PaymentRecord } from '../../shared/types/payments.js';

// Use a timestamp-suffixed ID to avoid collisions with other test runs.
const testWsId = 'ws_test_payments_' + Date.now();
const otherWsId = 'ws_test_payments_other_' + Date.now();

// Minimal valid payment data (no id / createdAt — those are auto-generated).
function makePaymentData(
  overrides: Partial<Omit<PaymentRecord, 'id' | 'createdAt'>> = {},
): Omit<PaymentRecord, 'id' | 'createdAt'> {
  return {
    workspaceId: testWsId,
    stripeSessionId: 'cs_test_' + Math.random().toString(36).slice(2),
    productType: 'strategy',
    amount: 4900, // 49.00 in cents
    currency: 'usd',
    status: 'pending',
    ...overrides,
  };
}

beforeAll(() => {
  db.prepare(
    'INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)',
  ).run(testWsId, 'Test Payments WS', testWsId, new Date().toISOString());

  db.prepare(
    'INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)',
  ).run(otherWsId, 'Test Payments Other WS', otherWsId, new Date().toISOString());
});

afterAll(() => {
  db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(otherWsId);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(testWsId);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(otherWsId);
});

// ── createPayment ──────────────────────────────────────────────────────────

describe('createPayment', () => {
  it('returns a PaymentRecord with generated id and createdAt', () => {
    const record = createPayment(testWsId, makePaymentData());

    expect(record.id).toMatch(/^pay_/);
    expect(record.createdAt).toBeTruthy();
    expect(new Date(record.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('stores all provided fields correctly', () => {
    const sessionId = 'cs_test_fields_' + Date.now();
    const intentId = 'pi_test_' + Date.now();
    const record = createPayment(
      testWsId,
      makePaymentData({
        stripeSessionId: sessionId,
        stripePaymentIntentId: intentId,
        productType: 'brief_blog',
        amount: 9900,
        currency: 'usd',
        status: 'paid',
        paidAt: new Date().toISOString(),
      }),
    );

    expect(record.workspaceId).toBe(testWsId);
    expect(record.stripeSessionId).toBe(sessionId);
    expect(record.stripePaymentIntentId).toBe(intentId);
    expect(record.productType).toBe('brief_blog');
    expect(record.amount).toBe(9900);
    expect(record.currency).toBe('usd');
    expect(record.status).toBe('paid');
    expect(record.paidAt).toBeTruthy();
  });

  it('stores metadata as an object (round-trips through JSON)', () => {
    const record = createPayment(
      testWsId,
      makePaymentData({
        metadata: { invoiceId: 'inv_001', source: 'checkout' },
      }),
    );

    expect(record.metadata).toEqual({ invoiceId: 'inv_001', source: 'checkout' });
  });

  it('stores amount as an integer — no float drift', () => {
    const record = createPayment(testWsId, makePaymentData({ amount: 12345 }));
    // Re-read from DB to confirm the stored value.
    const fetched = getPayment(testWsId, record.id);
    expect(fetched!.amount).toBe(12345);
    expect(Number.isInteger(fetched!.amount)).toBe(true);
  });

  it('uses workspaceId from the data object, not the first argument', () => {
    // The first arg to createPayment is a legacy _workspaceId; the actual
    // workspace is taken from data.workspaceId. Pass distinct values to verify.
    const record = createPayment('ignored_ws_id', makePaymentData({ workspaceId: testWsId }));
    expect(record.workspaceId).toBe(testWsId);
  });
});

// ── getPayment ─────────────────────────────────────────────────────────────

describe('getPayment', () => {
  it('returns the payment by workspace + id', () => {
    const created = createPayment(testWsId, makePaymentData());
    const fetched = getPayment(testWsId, created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.workspaceId).toBe(testWsId);
  });

  it('returns undefined for a non-existent id', () => {
    expect(getPayment(testWsId, 'pay_nonexistent_999')).toBeUndefined();
  });

  it('returns undefined when looking up a payment from a different workspace', () => {
    const created = createPayment(testWsId, makePaymentData());
    // Query using the wrong workspace — must not return the record.
    expect(getPayment(otherWsId, created.id)).toBeUndefined();
  });
});

// ── listPayments ───────────────────────────────────────────────────────────

describe('listPayments', () => {
  it('returns only payments for the given workspace', () => {
    // Create one in testWsId and one in otherWsId.
    const ours = createPayment(testWsId, makePaymentData());
    createPayment(otherWsId, makePaymentData({ workspaceId: otherWsId }));

    const results = listPayments(testWsId);
    expect(results.some(p => p.id === ours.id)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(p => p.workspaceId === testWsId)).toBe(true); // every-ok
  });

  it('returns an empty array for a workspace with no payments', () => {
    const emptyWsId = 'ws_test_empty_pmts_' + Date.now();
    db.prepare(
      'INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)',
    ).run(emptyWsId, 'Empty WS', emptyWsId, new Date().toISOString());

    try {
      expect(listPayments(emptyWsId)).toEqual([]);
    } finally {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(emptyWsId);
    }
  });

  it('returns payments in descending created_at order', () => {
    // Create two more payments — timestamps will be naturally ordered.
    createPayment(testWsId, makePaymentData());
    createPayment(testWsId, makePaymentData());

    const results = listPayments(testWsId);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].createdAt >= results[i].createdAt).toBe(true);
    }
  });
});

// ── listAllPayments ────────────────────────────────────────────────────────

describe('listAllPayments', () => {
  it('includes payments from multiple workspaces', () => {
    const p1 = createPayment(testWsId, makePaymentData());
    const p2 = createPayment(otherWsId, makePaymentData({ workspaceId: otherWsId }));

    const all = listAllPayments();
    const ids = all.map(p => p.id);
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
  });
});

// ── updatePayment ──────────────────────────────────────────────────────────

describe('updatePayment', () => {
  it('updates mutable fields and returns the merged record', () => {
    const created = createPayment(testWsId, makePaymentData({ status: 'pending' }));
    const now = new Date().toISOString();
    const updated = updatePayment(testWsId, created.id, { status: 'paid', paidAt: now });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('paid');
    expect(updated!.paidAt).toBe(now);
    // Immutable fields preserved.
    expect(updated!.id).toBe(created.id);
    expect(updated!.workspaceId).toBe(testWsId);
  });

  it('persists the update — subsequent getPayment reflects the change', () => {
    const created = createPayment(testWsId, makePaymentData({ status: 'pending' }));
    updatePayment(testWsId, created.id, { status: 'failed' });

    const refetched = getPayment(testWsId, created.id);
    expect(refetched!.status).toBe('failed');
  });

  it('returns null for a non-existent id', () => {
    expect(updatePayment(testWsId, 'pay_nonexistent_999', { status: 'paid' })).toBeNull();
  });

  it('returns null when the workspace does not match', () => {
    const created = createPayment(testWsId, makePaymentData());
    expect(updatePayment(otherWsId, created.id, { status: 'paid' })).toBeNull();
  });
});

// ── deletePayment ──────────────────────────────────────────────────────────

describe('deletePayment', () => {
  it('removes the payment and returns true', () => {
    const created = createPayment(testWsId, makePaymentData());
    const result = deletePayment(created.id);

    expect(result).toBe(true);
    expect(getPayment(testWsId, created.id)).toBeUndefined();
  });

  it('returns false for a non-existent id (does not throw)', () => {
    expect(deletePayment('pay_nonexistent_999')).toBe(false);
  });
});

// ── deleteAllPayments ──────────────────────────────────────────────────────

describe('deleteAllPayments', () => {
  it('removes all payments and returns the count', () => {
    // Seed 2 payments so we can assert they are gone after the purge.
    const p1 = createPayment(testWsId, makePaymentData());
    const p2 = createPayment(testWsId, makePaymentData());

    // deleteAllPayments is a global admin purge — it wipes the entire table.
    // We only verify the payments we control are gone, not listAllPayments().length === 0,
    // because parallel test workers may have payments in the same DB at this moment.
    const deleted = deleteAllPayments();
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(getPayment(testWsId, p1.id)).toBeUndefined();
    expect(getPayment(testWsId, p2.id)).toBeUndefined();
  });
});

// ── getPaymentBySession ────────────────────────────────────────────────────

describe('getPaymentBySession', () => {
  it('returns the payment matching the session id', () => {
    const sessionId = 'cs_test_lookup_' + Date.now();
    const created = createPayment(testWsId, makePaymentData({ stripeSessionId: sessionId }));

    const found = getPaymentBySession(testWsId, sessionId);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  it('returns undefined for an unknown session id', () => {
    expect(getPaymentBySession(testWsId, 'cs_test_unknown_9999')).toBeUndefined();
  });

  it('returns undefined for a session belonging to a different workspace', () => {
    const sessionId = 'cs_test_ws_mismatch_' + Date.now();
    createPayment(otherWsId, makePaymentData({ workspaceId: otherWsId, stripeSessionId: sessionId }));

    // Should not be visible from testWsId.
    expect(getPaymentBySession(testWsId, sessionId)).toBeUndefined();
  });
});

// ── listPaymentsBySession ──────────────────────────────────────────────────

describe('listPaymentsBySession', () => {
  it('returns all payments for a session in ascending created_at order', () => {
    const sessionId = 'cs_test_multi_' + Date.now();
    const p1 = createPayment(testWsId, makePaymentData({ stripeSessionId: sessionId, productType: 'brief_blog' }));
    const p2 = createPayment(testWsId, makePaymentData({ stripeSessionId: sessionId, productType: 'brief_landing' }));

    const list = listPaymentsBySession(testWsId, sessionId);
    expect(list.length).toBe(2);
    expect(list.map(p => p.id)).toContain(p1.id);
    expect(list.map(p => p.id)).toContain(p2.id);
    // Ascending order.
    expect(list[0].createdAt <= list[1].createdAt).toBe(true);
  });

  it('returns empty array when no payments match the session', () => {
    expect(listPaymentsBySession(testWsId, 'cs_test_no_match_9999')).toEqual([]);
  });
});

// ── getPaymentByPaymentIntent ──────────────────────────────────────────────

describe('getPaymentByPaymentIntent', () => {
  it('returns the payment matching the payment intent id', () => {
    const intentId = 'pi_test_intent_' + Date.now();
    const created = createPayment(
      testWsId,
      makePaymentData({ stripePaymentIntentId: intentId }),
    );

    const found = getPaymentByPaymentIntent(testWsId, intentId);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.stripePaymentIntentId).toBe(intentId);
  });

  it('returns undefined for an unknown payment intent id', () => {
    expect(getPaymentByPaymentIntent(testWsId, 'pi_unknown_9999')).toBeUndefined();
  });

  it('returns undefined for a payment intent belonging to a different workspace', () => {
    const intentId = 'pi_test_ws_mismatch_' + Date.now();
    createPayment(
      otherWsId,
      makePaymentData({ workspaceId: otherWsId, stripePaymentIntentId: intentId }),
    );

    expect(getPaymentByPaymentIntent(testWsId, intentId)).toBeUndefined();
  });
});

// ── Status semantics ───────────────────────────────────────────────────────

describe('payment status lifecycle', () => {
  it('can create a pending payment and transition to paid', () => {
    const created = createPayment(testWsId, makePaymentData({ status: 'pending' }));
    expect(created.status).toBe('pending');

    const paidAt = new Date().toISOString();
    const updated = updatePayment(testWsId, created.id, { status: 'paid', paidAt });
    expect(updated!.status).toBe('paid');
    expect(updated!.paidAt).toBe(paidAt);
  });

  it('can create a failed payment', () => {
    const record = createPayment(testWsId, makePaymentData({ status: 'failed' }));
    const fetched = getPayment(testWsId, record.id);
    expect(fetched!.status).toBe('failed');
  });

  it('can create a refunded payment', () => {
    const record = createPayment(testWsId, makePaymentData({ status: 'refunded' }));
    const fetched = getPayment(testWsId, record.id);
    expect(fetched!.status).toBe('refunded');
  });
});
