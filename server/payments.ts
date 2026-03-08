import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';

// --- Types ---

export type ProductType =
  | 'brief_blog' | 'brief_landing' | 'brief_service' | 'brief_location'
  | 'brief_product' | 'brief_pillar' | 'brief_resource'
  | 'post_draft' | 'post_polished' | 'post_premium'
  | 'schema_page' | 'schema_site'
  | 'strategy' | 'strategy_refresh'
  | 'plan_growth' | 'plan_premium';

export interface PaymentRecord {
  id: string;
  workspaceId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  productType: ProductType;
  amount: number;           // cents
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  contentRequestId?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  paidAt?: string;
}

// --- Storage ---

function paymentsDir(): string {
  return getDataDir('payments');
}

function filePath(workspaceId: string): string {
  return path.join(paymentsDir(), `${workspaceId}.json`);
}

function readPayments(workspaceId: string): PaymentRecord[] {
  const fp = filePath(workspaceId);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return [];
  }
}

function writePayments(workspaceId: string, records: PaymentRecord[]): void {
  fs.writeFileSync(filePath(workspaceId), JSON.stringify(records, null, 2));
}

// --- CRUD ---

export function createPayment(
  workspaceId: string,
  data: Omit<PaymentRecord, 'id' | 'createdAt'>
): PaymentRecord {
  const records = readPayments(workspaceId);
  const record: PaymentRecord = {
    ...data,
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  records.push(record);
  writePayments(workspaceId, records);
  return record;
}

export function updatePayment(
  workspaceId: string,
  id: string,
  updates: Partial<PaymentRecord>
): PaymentRecord | null {
  const records = readPayments(workspaceId);
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...updates };
  writePayments(workspaceId, records);
  return records[idx];
}

export function getPayment(workspaceId: string, id: string): PaymentRecord | undefined {
  return readPayments(workspaceId).find(r => r.id === id);
}

export function listPayments(workspaceId: string): PaymentRecord[] {
  return readPayments(workspaceId);
}

export function getPaymentBySession(
  workspaceId: string,
  stripeSessionId: string
): PaymentRecord | undefined {
  return readPayments(workspaceId).find(r => r.stripeSessionId === stripeSessionId);
}
