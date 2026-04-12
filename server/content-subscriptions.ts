/**
 * Content Subscriptions — recurring monthly content packages.
 *
 * Manages subscription CRUD, period tracking, and auto-generation
 * of content requests when a new billing period starts.
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import type { ContentSubscription, ContentSubPlan } from '../shared/types/content.js';

const log = createLogger('content-subscriptions');

// ── SQLite row shape ──

interface SubRow {
  id: string;
  workspace_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: string;
  posts_per_month: number;
  price_usd: number;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  posts_delivered_this_period: number;
  topic_source: string;
  preferred_page_types: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Prepared statements (lazy init) ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_subscriptions
           (id, workspace_id, stripe_subscription_id, stripe_price_id, plan,
            posts_per_month, price_usd, status, current_period_start, current_period_end,
            posts_delivered_this_period, topic_source, preferred_page_types, notes,
            created_at, updated_at)
         VALUES
           (@id, @workspace_id, @stripe_subscription_id, @stripe_price_id, @plan,
            @posts_per_month, @price_usd, @status, @current_period_start, @current_period_end,
            @posts_delivered_this_period, @topic_source, @preferred_page_types, @notes,
            @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    'SELECT * FROM content_subscriptions WHERE workspace_id = ? ORDER BY created_at DESC',
  ),
  selectById: db.prepare(
    'SELECT * FROM content_subscriptions WHERE id = ?',
  ),
  selectByStripeSubId: db.prepare(
    'SELECT * FROM content_subscriptions WHERE stripe_subscription_id = ?',
  ),
  selectActive: db.prepare(
    "SELECT * FROM content_subscriptions WHERE status IN ('active', 'past_due') ORDER BY created_at DESC",
  ),
  deleteById: db.prepare(
    'DELETE FROM content_subscriptions WHERE id = ? AND workspace_id = ?',
  ),
}));

function rowToSub(row: SubRow): ContentSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    stripePriceId: row.stripe_price_id ?? undefined,
    plan: row.plan as ContentSubPlan,
    postsPerMonth: row.posts_per_month,
    priceUsd: row.price_usd,
    status: row.status as ContentSubscription['status'],
    currentPeriodStart: row.current_period_start ?? undefined,
    currentPeriodEnd: row.current_period_end ?? undefined,
    postsDeliveredThisPeriod: row.posts_delivered_this_period,
    topicSource: row.topic_source as ContentSubscription['topicSource'],
    preferredPageTypes: parseJsonFallback<string[] | undefined>(row.preferred_page_types, undefined),
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──

export function createContentSubscription(
  workspaceId: string,
  data: {
    plan: ContentSubPlan;
    postsPerMonth: number;
    priceUsd: number;
    topicSource?: ContentSubscription['topicSource'];
    preferredPageTypes?: string[];
    notes?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    status?: ContentSubscription['status'];
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
  },
): ContentSubscription {
  const now = new Date().toISOString();
  const id = `csub-${randomUUID().slice(0, 8)}`;
  const row = {
    id,
    workspace_id: workspaceId,
    stripe_subscription_id: data.stripeSubscriptionId ?? null,
    stripe_price_id: data.stripePriceId ?? null,
    plan: data.plan,
    posts_per_month: data.postsPerMonth,
    price_usd: data.priceUsd,
    status: data.status ?? 'pending',
    current_period_start: data.currentPeriodStart ?? null,
    current_period_end: data.currentPeriodEnd ?? null,
    posts_delivered_this_period: 0,
    topic_source: data.topicSource ?? 'strategy_gaps',
    preferred_page_types: data.preferredPageTypes ? JSON.stringify(data.preferredPageTypes) : null,
    notes: data.notes ?? null,
    created_at: now,
    updated_at: now,
  };
  stmts().insert.run(row);
  log.info(`Created content subscription: workspace=${workspaceId} plan=${data.plan} id=${id}`);
  addActivity(workspaceId, 'content_subscription', `Content subscription created: ${data.plan}`, '', { subscriptionId: id });
  return rowToSub(row as SubRow);
}

export function getContentSubscription(id: string): ContentSubscription | null {
  const row = stmts().selectById.get(id) as SubRow | undefined;
  return row ? rowToSub(row) : null;
}

export function getContentSubscriptionByStripeId(stripeSubId: string): ContentSubscription | null {
  const row = stmts().selectByStripeSubId.get(stripeSubId) as SubRow | undefined;
  return row ? rowToSub(row) : null;
}

export function listContentSubscriptions(workspaceId: string): ContentSubscription[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as SubRow[];
  return rows.map(rowToSub);
}

export function listActiveContentSubscriptions(): ContentSubscription[] {
  const rows = stmts().selectActive.all() as SubRow[];
  return rows.map(rowToSub);
}

export function updateContentSubscription(
  workspaceId: string,
  id: string,
  updates: Partial<Pick<ContentSubscription,
    'status' | 'stripeSubscriptionId' | 'stripePriceId' | 'plan' | 'postsPerMonth' |
    'priceUsd' | 'currentPeriodStart' | 'currentPeriodEnd' | 'postsDeliveredThisPeriod' |
    'topicSource' | 'preferredPageTypes' | 'notes'
  >>,
): ContentSubscription | null {
  const fieldMap: Record<string, string> = {
    status: 'status',
    stripeSubscriptionId: 'stripe_subscription_id',
    stripePriceId: 'stripe_price_id',
    plan: 'plan',
    postsPerMonth: 'posts_per_month',
    priceUsd: 'price_usd',
    currentPeriodStart: 'current_period_start',
    currentPeriodEnd: 'current_period_end',
    postsDeliveredThisPeriod: 'posts_delivered_this_period',
    topicSource: 'topic_source',
    preferredPageTypes: 'preferred_page_types',
    notes: 'notes',
  };

  const sets: string[] = [];
  const values: Record<string, unknown> = { id, workspace_id: workspaceId };

  for (const [key, val] of Object.entries(updates)) {
    const col = fieldMap[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    if (key === 'preferredPageTypes') {
      values[key] = val ? JSON.stringify(val) : null;
    } else {
      values[key] = val ?? null;
    }
  }

  if (sets.length === 0) return getContentSubscription(id);

  sets.push("updated_at = @now");
  values.now = new Date().toISOString();

  const sql = `UPDATE content_subscriptions SET ${sets.join(', ')} WHERE id = @id AND workspace_id = @workspace_id`;
  db.prepare(sql).run(values);
  return getContentSubscription(id);
}

export function deleteContentSubscription(workspaceId: string, id: string): boolean {
  const result = stmts().deleteById.run(id, workspaceId);
  return result.changes > 0;
}

// ── Period management ──

export function incrementDeliveredPosts(workspaceId: string, id: string, count = 1): void {
  db.prepare(
    `UPDATE content_subscriptions
     SET posts_delivered_this_period = posts_delivered_this_period + ?,
         updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(count, new Date().toISOString(), id, workspaceId);
}

export function resetPeriod(workspaceId: string, id: string, periodStart: string, periodEnd: string): void {
  db.prepare(
    `UPDATE content_subscriptions
     SET posts_delivered_this_period = 0,
         current_period_start = ?,
         current_period_end = ?,
         updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(periodStart, periodEnd, new Date().toISOString(), id, workspaceId);
  log.info(`Reset period for subscription ${id}: ${periodStart} → ${periodEnd}`);
}
