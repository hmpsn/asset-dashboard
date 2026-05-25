import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockStmts = {
    insert: { run: vi.fn() },
    selectById: { get: vi.fn(() => undefined) },
    selectByIdGlobal: { get: vi.fn(() => undefined) },
    selectBySession: { get: vi.fn(() => undefined) },
    selectAllBySession: { all: vi.fn(() => []) },
    selectByPaymentIntent: { get: vi.fn(() => undefined) },
    selectByWorkspace: { all: vi.fn(() => []) },
    update: { run: vi.fn() },
    deleteById: { run: vi.fn(() => ({ changes: 0 })) },
    deleteAll: { run: vi.fn(() => ({ changes: 0 })) },
  };

  const listAllStmt = {
    all: vi.fn(() => []),
  };

  return {
    mockStmts,
    listAllStmt,
    dbPrepare: vi.fn(() => listAllStmt),
    parseJsonFallback: vi.fn((raw: string | null, fallback: unknown) => {
      if (raw === '__INVALID_JSON__') return fallback;
      try {
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    }),
  };
});

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mocks.dbPrepare,
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => {
    void factory;
    return () => mocks.mockStmts;
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: mocks.parseJsonFallback,
}));

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

import type { PaymentRecord } from '../../shared/types/payments.ts';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pay_1',
    workspace_id: 'ws_1',
    stripe_session_id: 'cs_1',
    stripe_payment_intent_id: 'pi_1',
    product_type: 'brief_blog',
    amount: 12500,
    currency: 'usd',
    status: 'pending',
    content_request_id: 'cr_1',
    metadata: JSON.stringify({ source: 'unit' }),
    created_at: '2026-05-01T00:00:00.000Z',
    paid_at: null,
    ...overrides,
  };
}

describe('server/payments.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockStmts.selectById.get.mockReturnValue(undefined);
    mocks.mockStmts.selectByIdGlobal.get.mockReturnValue(undefined);
    mocks.mockStmts.selectBySession.get.mockReturnValue(undefined);
    mocks.mockStmts.selectAllBySession.all.mockReturnValue([]);
    mocks.mockStmts.selectByPaymentIntent.get.mockReturnValue(undefined);
    mocks.mockStmts.selectByWorkspace.all.mockReturnValue([]);
    mocks.mockStmts.deleteById.run.mockReturnValue({ changes: 0 });
    mocks.mockStmts.deleteAll.run.mockReturnValue({ changes: 0 });
    mocks.listAllStmt.all.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('createPayment inserts deterministic values and serializes metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const input: Omit<PaymentRecord, 'id' | 'createdAt'> = {
      workspaceId: 'ws_payload',
      stripeSessionId: 'cs_test',
      stripePaymentIntentId: 'pi_test',
      productType: 'brief_blog',
      amount: 9900,
      currency: 'usd',
      status: 'pending',
      contentRequestId: 'cr_test',
      metadata: { campaign: 'spring' },
      paidAt: undefined,
    };

    const record = createPayment('ws_authoritative', input);

    expect(record.id).toMatch(/^pay_\d+_[a-z0-9]{4}$/);
    expect(record.createdAt).toBe('2026-05-25T12:00:00.000Z');
    expect(record.workspaceId).toBe('ws_authoritative');

    expect(mocks.mockStmts.insert.run).toHaveBeenCalledTimes(1);
    expect(mocks.mockStmts.insert.run).toHaveBeenCalledWith({
      id: record.id,
      workspace_id: 'ws_authoritative',
      stripe_session_id: 'cs_test',
      stripe_payment_intent_id: 'pi_test',
      product_type: 'brief_blog',
      amount: 9900,
      currency: 'usd',
      status: 'pending',
      content_request_id: 'cr_test',
      metadata: JSON.stringify({ campaign: 'spring' }),
      created_at: '2026-05-25T12:00:00.000Z',
      paid_at: null,
    });
  });

  it('updatePayment merges updates and scopes lookup by workspace', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(makeRow());

    const updated = updatePayment('ws_1', 'pay_1', {
      status: 'paid',
      metadata: { source: 'updated' },
      stripePaymentIntentId: undefined,
      paidAt: '2026-05-02T10:00:00.000Z',
    });

    expect(mocks.mockStmts.selectById.get).toHaveBeenCalledWith('pay_1', 'ws_1');
    expect(mocks.mockStmts.update.run).toHaveBeenCalledWith({
      id: 'pay_1',
      workspace_id: 'ws_1',
      stripe_session_id: 'cs_1',
      stripe_payment_intent_id: null,
      product_type: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'paid',
      content_request_id: 'cr_1',
      metadata: JSON.stringify({ source: 'updated' }),
      created_at: '2026-05-01T00:00:00.000Z',
      paid_at: '2026-05-02T10:00:00.000Z',
    });
    expect(updated).toMatchObject({
      id: 'pay_1',
      workspaceId: 'ws_1',
      status: 'paid',
      stripePaymentIntentId: undefined,
      paidAt: '2026-05-02T10:00:00.000Z',
      metadata: { source: 'updated' },
    });
  });

  it('updatePayment returns null when id is not found in workspace', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(undefined);

    const updated = updatePayment('ws_missing', 'pay_missing', { status: 'failed' });

    expect(updated).toBeNull();
    expect(mocks.mockStmts.selectById.get).toHaveBeenCalledWith('pay_missing', 'ws_missing');
    expect(mocks.mockStmts.update.run).not.toHaveBeenCalled();
  });

  it('updatePayment should keep identity fields immutable even when overrides are supplied', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(makeRow({
      id: 'pay_locked',
      workspace_id: 'ws_locked',
    }));

    updatePayment('ws_locked', 'pay_locked', {
      id: 'pay_tampered',
      workspaceId: 'ws_other',
      status: 'paid',
    });

    expect(mocks.mockStmts.update.run).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pay_locked',
      workspace_id: 'ws_locked',
      status: 'paid',
    }));
  });

  it('getPayment maps row fields and applies metadata fallback parsing', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(
      makeRow({
        stripe_payment_intent_id: null,
        content_request_id: null,
        metadata: '__INVALID_JSON__',
        paid_at: null,
      }),
    );

    const payment = getPayment('ws_1', 'pay_1');

    expect(mocks.mockStmts.selectById.get).toHaveBeenCalledWith('pay_1', 'ws_1');
    expect(mocks.parseJsonFallback).toHaveBeenCalledWith('__INVALID_JSON__', undefined);
    expect(payment).toEqual({
      id: 'pay_1',
      workspaceId: 'ws_1',
      stripeSessionId: 'cs_1',
      stripePaymentIntentId: undefined,
      productType: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'pending',
      contentRequestId: undefined,
      metadata: undefined,
      createdAt: '2026-05-01T00:00:00.000Z',
      paidAt: undefined,
    });
  });

  it('listPayments returns workspace-scoped mapped records', () => {
    mocks.mockStmts.selectByWorkspace.all.mockReturnValue([
      makeRow({ id: 'pay_a', workspace_id: 'ws_scope', stripe_session_id: 'cs_scope_1' }),
      makeRow({ id: 'pay_b', workspace_id: 'ws_scope', stripe_session_id: 'cs_scope_2' }),
    ]);

    const payments = listPayments('ws_scope');

    expect(mocks.mockStmts.selectByWorkspace.all).toHaveBeenCalledWith('ws_scope');
    expect(payments.map((p) => p.id)).toEqual(['pay_a', 'pay_b']);
    expect(payments.map((p) => p.workspaceId)).toEqual(['ws_scope', 'ws_scope']);
  });

  it('listAllPayments queries global table and maps records', () => {
    mocks.listAllStmt.all.mockReturnValue([
      makeRow({ id: 'pay_all_1', workspace_id: 'ws_a' }),
      makeRow({ id: 'pay_all_2', workspace_id: 'ws_b' }),
    ]);

    const payments = listAllPayments();

    expect(mocks.dbPrepare).toHaveBeenCalledWith('SELECT * FROM payments ORDER BY created_at DESC');
    expect(mocks.listAllStmt.all).toHaveBeenCalledTimes(1);
    expect(payments.map((p) => p.workspaceId)).toEqual(['ws_a', 'ws_b']);
  });

  it('deletePayment returns true when global lookup finds row and scoped delete changes rows', () => {
    mocks.mockStmts.selectByIdGlobal.get.mockReturnValue(makeRow({ workspace_id: 'ws_del' }));
    mocks.mockStmts.deleteById.run.mockReturnValue({ changes: 1 });

    const deleted = deletePayment('pay_1');

    expect(mocks.mockStmts.selectByIdGlobal.get).toHaveBeenCalledWith('pay_1');
    expect(mocks.mockStmts.deleteById.run).toHaveBeenCalledWith('pay_1', 'ws_del');
    expect(deleted).toBe(true);
  });

  it('deletePayment returns false when global lookup misses id', () => {
    mocks.mockStmts.selectByIdGlobal.get.mockReturnValue(undefined);

    const deleted = deletePayment('pay_missing');

    expect(deleted).toBe(false);
    expect(mocks.mockStmts.deleteById.run).not.toHaveBeenCalled();
  });

  it('deleteAllPayments returns number of deleted rows', () => {
    mocks.mockStmts.deleteAll.run.mockReturnValue({ changes: 7 });

    const deletedCount = deleteAllPayments();

    expect(mocks.mockStmts.deleteAll.run).toHaveBeenCalledTimes(1);
    expect(deletedCount).toBe(7);
  });

  it('session/payment-intent helpers use workspace-scoped selectors', () => {
    mocks.mockStmts.selectBySession.get.mockReturnValue(
      makeRow({ id: 'pay_session', workspace_id: 'ws_scope', stripe_session_id: 'cs_scope' }),
    );
    mocks.mockStmts.selectAllBySession.all.mockReturnValue([
      makeRow({ id: 'pay_s1', workspace_id: 'ws_scope', stripe_session_id: 'cs_scope' }),
      makeRow({ id: 'pay_s2', workspace_id: 'ws_scope', stripe_session_id: 'cs_scope' }),
    ]);
    mocks.mockStmts.selectByPaymentIntent.get.mockReturnValue(
      makeRow({ id: 'pay_intent', workspace_id: 'ws_scope', stripe_payment_intent_id: 'pi_scope' }),
    );

    const bySession = getPaymentBySession('ws_scope', 'cs_scope');
    const listBySession = listPaymentsBySession('ws_scope', 'cs_scope');
    const byIntent = getPaymentByPaymentIntent('ws_scope', 'pi_scope');

    expect(mocks.mockStmts.selectBySession.get).toHaveBeenCalledWith('ws_scope', 'cs_scope');
    expect(mocks.mockStmts.selectAllBySession.all).toHaveBeenCalledWith('ws_scope', 'cs_scope');
    expect(mocks.mockStmts.selectByPaymentIntent.get).toHaveBeenCalledWith('ws_scope', 'pi_scope');
    expect(bySession?.id).toBe('pay_session');
    expect(listBySession.map((p) => p.id)).toEqual(['pay_s1', 'pay_s2']);
    expect(byIntent?.id).toBe('pay_intent');
  });
});
