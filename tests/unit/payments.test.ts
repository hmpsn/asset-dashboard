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
    update: { run: vi.fn(() => ({ changes: 1 })) },
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
      workspaceId: 'ws_data',
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

    const record = createPayment('ws_ignored', input);

    expect(record.id).toMatch(/^pay_\d+_[a-z0-9]{4}$/);
    expect(record.createdAt).toBe('2026-05-25T12:00:00.000Z');
    expect(record.workspaceId).toBe('ws_data');

    expect(mocks.mockStmts.insert.run).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws_data',
      metadata: JSON.stringify({ campaign: 'spring' }),
      paid_at: null,
    }));
  });

  it('updatePayment keeps immutable identity fields even when malformed partial payload tries to override them (regression)', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(makeRow());

    const updated = updatePayment('ws_1', 'pay_1', {
      workspaceId: 'ws_other',
      createdAt: '2000-01-01T00:00:00.000Z',
      status: 'paid',
      paidAt: '2026-05-02T10:00:00.000Z',
    } as Partial<PaymentRecord>);

    expect(mocks.mockStmts.update.run).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pay_1',
      workspace_id: 'ws_1',
      created_at: '2026-05-01T00:00:00.000Z',
      status: 'paid',
      paid_at: '2026-05-02T10:00:00.000Z',
    }));

    expect(updated).toMatchObject({
      id: 'pay_1',
      workspaceId: 'ws_1',
      createdAt: '2026-05-01T00:00:00.000Z',
      status: 'paid',
      paidAt: '2026-05-02T10:00:00.000Z',
    });
  });

  it('updatePayment nulls optional stripe/content ids when partial payload omits them', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(makeRow());

    const updated = updatePayment('ws_1', 'pay_1', {
      stripePaymentIntentId: undefined,
      contentRequestId: undefined,
      metadata: { source: 'updated' },
    });

    expect(mocks.mockStmts.update.run).toHaveBeenCalledWith(expect.objectContaining({
      stripe_payment_intent_id: null,
      content_request_id: null,
      metadata: JSON.stringify({ source: 'updated' }),
    }));
    expect(updated).toMatchObject({
      stripePaymentIntentId: undefined,
      contentRequestId: undefined,
      metadata: { source: 'updated' },
    });
  });

  it('updatePayment returns null when id is not found in workspace', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(undefined);

    const updated = updatePayment('ws_missing', 'pay_missing', { status: 'failed' });

    expect(updated).toBeNull();
    expect(mocks.mockStmts.update.run).not.toHaveBeenCalled();
  });

  it('getPayment applies metadata fallback parsing for malformed JSON blobs', () => {
    mocks.mockStmts.selectById.get.mockReturnValue(
      makeRow({
        stripe_payment_intent_id: null,
        content_request_id: null,
        metadata: '__INVALID_JSON__',
        paid_at: null,
      }),
    );

    const payment = getPayment('ws_1', 'pay_1');

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

  it('listPayments and listAllPayments map rows correctly', () => {
    mocks.mockStmts.selectByWorkspace.all.mockReturnValue([
      makeRow({ id: 'pay_a', workspace_id: 'ws_scope' }),
      makeRow({ id: 'pay_b', workspace_id: 'ws_scope' }),
    ]);
    mocks.listAllStmt.all.mockReturnValue([
      makeRow({ id: 'pay_all_1', workspace_id: 'ws_a' }),
      makeRow({ id: 'pay_all_2', workspace_id: 'ws_b' }),
    ]);

    const scoped = listPayments('ws_scope');
    const all = listAllPayments();

    expect(scoped.map((p) => p.id)).toEqual(['pay_a', 'pay_b']);
    expect(scoped.every((p) => p.workspaceId === 'ws_scope')).toBe(true);
    expect(all.map((p) => p.workspaceId)).toEqual(['ws_a', 'ws_b']);
  });

  it('deletePayment reflects delete result and remains idempotent across repeated calls', () => {
    mocks.mockStmts.selectByIdGlobal.get
      .mockReturnValueOnce(makeRow({ workspace_id: 'ws_del' }))
      .mockReturnValueOnce(undefined);
    mocks.mockStmts.deleteById.run.mockReturnValue({ changes: 1 });

    const firstDelete = deletePayment('pay_1');
    const secondDelete = deletePayment('pay_1');

    expect(firstDelete).toBe(true);
    expect(secondDelete).toBe(false);
    expect(mocks.mockStmts.deleteById.run).toHaveBeenCalledWith('pay_1', 'ws_del');
  });

  it('deleteAllPayments returns number of deleted rows', () => {
    mocks.mockStmts.deleteAll.run.mockReturnValue({ changes: 7 });

    const deletedCount = deleteAllPayments();

    expect(mocks.mockStmts.deleteAll.run).toHaveBeenCalledTimes(1);
    expect(deletedCount).toBe(7);
  });

  it('session and payment-intent helpers stay workspace-scoped', () => {
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
