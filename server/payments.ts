import db from './db/index.js';

// --- Types ---

export type { ProductType, PaymentRecord } from '../shared/types/payments.ts';
import type { ProductType, PaymentRecord } from '../shared/types/payments.ts';

// --- SQLite row shape ---

interface PaymentRow {
  id: string;
  workspace_id: string;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  product_type: string;
  amount: number;
  currency: string;
  status: string;
  content_request_id: string | null;
  metadata: string | null;
  created_at: string;
  paid_at: string | null;
}

/** Convert a database row to the public PaymentRecord shape. */
function rowToRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    productType: row.product_type as ProductType,
    amount: row.amount,
    currency: row.currency,
    status: row.status as PaymentRecord['status'],
    contentRequestId: row.content_request_id ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

interface Stmts {
  insert: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  selectBySession: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;

function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      insert: db.prepare(`
        INSERT INTO payments (id, workspace_id, stripe_session_id, stripe_payment_intent_id,
          product_type, amount, currency, status, content_request_id, metadata, created_at, paid_at)
        VALUES (@id, @workspace_id, @stripe_session_id, @stripe_payment_intent_id,
          @product_type, @amount, @currency, @status, @content_request_id, @metadata, @created_at, @paid_at)
      `),
      selectById: db.prepare(
        'SELECT * FROM payments WHERE id = ? AND workspace_id = ?',
      ),
      selectBySession: db.prepare(
        'SELECT * FROM payments WHERE workspace_id = ? AND stripe_session_id = ?',
      ),
      selectByWorkspace: db.prepare(
        'SELECT * FROM payments WHERE workspace_id = ? ORDER BY created_at DESC',
      ),
      update: db.prepare(`
        UPDATE payments SET
          stripe_session_id = @stripe_session_id,
          stripe_payment_intent_id = @stripe_payment_intent_id,
          product_type = @product_type,
          amount = @amount,
          currency = @currency,
          status = @status,
          content_request_id = @content_request_id,
          metadata = @metadata,
          created_at = @created_at,
          paid_at = @paid_at
        WHERE id = @id AND workspace_id = @workspace_id
      `),
    };
  }
  return _stmts;
}

// --- CRUD ---

export function createPayment(
  _workspaceId: string,
  data: Omit<PaymentRecord, 'id' | 'createdAt'>
): PaymentRecord {
  const record: PaymentRecord = {
    ...data,
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };

  stmts().insert.run({
    id: record.id,
    workspace_id: record.workspaceId,
    stripe_session_id: record.stripeSessionId,
    stripe_payment_intent_id: record.stripePaymentIntentId ?? null,
    product_type: record.productType,
    amount: record.amount,
    currency: record.currency,
    status: record.status,
    content_request_id: record.contentRequestId ?? null,
    metadata: record.metadata ? JSON.stringify(record.metadata) : null,
    created_at: record.createdAt,
    paid_at: record.paidAt ?? null,
  });

  return record;
}

export function updatePayment(
  workspaceId: string,
  id: string,
  updates: Partial<PaymentRecord>
): PaymentRecord | null {
  const row = stmts().selectById.get(id, workspaceId) as PaymentRow | undefined;
  if (!row) return null;

  const current = rowToRecord(row);
  const merged = { ...current, ...updates };

  stmts().update.run({
    id: merged.id,
    workspace_id: merged.workspaceId,
    stripe_session_id: merged.stripeSessionId,
    stripe_payment_intent_id: merged.stripePaymentIntentId ?? null,
    product_type: merged.productType,
    amount: merged.amount,
    currency: merged.currency,
    status: merged.status,
    content_request_id: merged.contentRequestId ?? null,
    metadata: merged.metadata ? JSON.stringify(merged.metadata) : null,
    created_at: merged.createdAt,
    paid_at: merged.paidAt ?? null,
  });

  return merged;
}

export function getPayment(workspaceId: string, id: string): PaymentRecord | undefined {
  const row = stmts().selectById.get(id, workspaceId) as PaymentRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listPayments(workspaceId: string): PaymentRecord[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as PaymentRow[];
  return rows.map(rowToRecord);
}

export function listAllPayments(): PaymentRecord[] {
  const rows = db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all() as PaymentRow[];
  return rows.map(rowToRecord);
}

export function getPaymentBySession(
  workspaceId: string,
  stripeSessionId: string
): PaymentRecord | undefined {
  const row = stmts().selectBySession.get(workspaceId, stripeSessionId) as PaymentRow | undefined;
  return row ? rowToRecord(row) : undefined;
}
