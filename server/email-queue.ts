/**
 * Batched email queue.
 * Groups events by recipient + type, waits BATCH_WINDOW_MS, then sends
 * a single digest email per group. Prevents inbox spam when many actions
 * happen in quick succession (e.g. bulk approval sends, rapid status changes).
 *
 * Persistence: queue is written to disk so events survive restarts.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { renderDigest, type EmailEvent, type EmailEventType } from './email-templates.js';
import {
  getThrottleCategory,
  canSend,
  recordSend,
  msUntilMorning,
  isOverdueForMorning,
} from './email-throttle.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';

const log = createLogger('email-queue');

// ── Config ──

const BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_DELAY_MS = 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const QUEUE_DIR = getDataDir('email-queue');
const QUEUE_FILE = path.join(QUEUE_DIR, 'pending.json');
const DEAD_LETTER_FILE = path.join(QUEUE_DIR, 'dead-letter.json');

// ── In-memory state ──

interface QueueBucket {
  key: string;              // recipient:type:workspaceId
  events: QueuedEmailEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

type QueuedEmailEvent = EmailEvent & {
  deliveryAttempts?: number;
  lastDeliveryError?: string;
};

export type DeadLetteredEmailEvent = QueuedEmailEvent & {
  deadLetteredAt: string;
};

const buckets = new Map<string, QueueBucket>();

// ── Send callback (injected to avoid circular deps with email.ts) ──

type SendFn = (to: string, subject: string, html: string) => Promise<boolean>;
let sendFn: SendFn | null = null;

export function registerSendFn(fn: SendFn) {
  sendFn = fn;
}

// ── Persistence ──

function persistQueue() {
  try {
    const data: QueuedEmailEvent[] = [];
    for (const bucket of buckets.values()) {
      data.push(...bucket.events);
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error({ err: err }, 'Failed to persist queue');
  }
}

function loadQueue(): QueuedEmailEvent[] {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      return JSON.parse(raw) as QueuedEmailEvent[];
    }
  } catch { /* fresh start — expected */ }
  return [];
}

function loadDeadLetters(): DeadLetteredEmailEvent[] {
  try {
    if (fs.existsSync(DEAD_LETTER_FILE)) {
      const raw = fs.readFileSync(DEAD_LETTER_FILE, 'utf-8');
      return JSON.parse(raw) as DeadLetteredEmailEvent[];
    }
  } catch (err) {
    log.warn({ err }, 'Failed to load email dead letters');
  }
  return [];
}

function persistDeadLetters(events: DeadLetteredEmailEvent[]) {
  try {
    fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(events, null, 2));
  } catch (err) {
    log.error({ err }, 'Failed to persist email dead letters');
  }
}

function appendDeadLetters(events: QueuedEmailEvent[], reason: string) {
  const now = new Date().toISOString();
  const deadLetters = loadDeadLetters();
  deadLetters.push(...events.map(event => ({
    ...event,
    deliveryAttempts: event.deliveryAttempts ?? MAX_DELIVERY_ATTEMPTS,
    lastDeliveryError: reason,
    deadLetteredAt: now,
  })));
  persistDeadLetters(deadLetters);
}

function clearPersistedQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'email-queue/clearPersistedQueue: programming error'); /* ignore */ }
}

// ── Core ──

function bucketKey(recipient: string, type: EmailEventType, workspaceId: string): string {
  return `${recipient}:${type}:${workspaceId}`;
}

function scheduleBucketFlush(bucket: QueueBucket, delay: number) {
  if (bucket.timer) clearTimeout(bucket.timer);
  bucket.timer = setTimeout(() => flushBucket(bucket.key), delay);
}

function requeueFailedEvents(key: string, events: QueuedEmailEvent[], reason: string) {
  const retriedEvents = events.map(event => ({
    ...event,
    deliveryAttempts: (event.deliveryAttempts ?? 0) + 1,
    lastDeliveryError: reason,
  }));
  const exhausted = retriedEvents.filter(event => (event.deliveryAttempts ?? 0) >= MAX_DELIVERY_ATTEMPTS);
  const retryable = retriedEvents.filter(event => (event.deliveryAttempts ?? 0) < MAX_DELIVERY_ATTEMPTS);

  if (exhausted.length > 0) {
    appendDeadLetters(exhausted, reason);
    log.error({ count: exhausted.length, reason }, 'Email events moved to dead letter queue');
  }

  if (retryable.length === 0) {
    persistQueue();
    return;
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { key, events: [], timer: null };
    buckets.set(key, bucket);
  }
  bucket.events.unshift(...retryable);
  const nextDelay = RETRY_DELAY_MS * Math.max(1, retryable[0].deliveryAttempts ?? 1);
  scheduleBucketFlush(bucket, nextDelay);
  persistQueue();
  log.warn({ count: retryable.length, nextDelayMs: nextDelay, reason }, 'Requeued failed email events');
}

async function flushBucket(key: string) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.events.length === 0) {
    buckets.delete(key);
    persistQueue();
    return;
  }

  const events = [...bucket.events];
  const recipient = events[0].recipient;
  const type = events[0].type;
  const category = getThrottleCategory(type);

  // ── Throttle check ──
  const throttle = canSend(recipient, category);
  if (!throttle.allowed) {
    log.info(`Throttled ${type} to ${recipient}: ${throttle.reason} (${events.length} event${events.length !== 1 ? 's' : ''} dropped)`);
    buckets.delete(key);
    persistQueue();
    return;
  }

  // Clear bucket before sending (so new events during send get a fresh batch)
  buckets.delete(key);
  persistQueue();

  if (!sendFn) {
    log.warn({ count: events.length }, 'No send function registered, requeueing email events');
    requeueFailedEvents(key, events, 'No send function registered');
    return;
  }

  try {
    const { subject, html } = renderDigest(type, events);
    if (!html) {
      log.warn({ detail: type }, 'Empty template for type');
      appendDeadLetters(events, `Empty template for ${type}`);
      return;
    }
    const ok = await sendFn(recipient, subject, html);
    if (ok) {
      // Record send for throttle tracking
      recordSend(recipient, category, type, events[0].workspaceId, events.length);
      log.info(`Sent batched ${type} email to ${recipient} (${events.length} event${events.length !== 1 ? 's' : ''})`);
    } else {
      log.error(`Failed to send ${type} email to ${recipient}`);
      requeueFailedEvents(key, events, 'Send function returned false');
    }
  } catch (err) {
    log.error({ err: err }, 'Error sending digest');
    requeueFailedEvents(key, events, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Push an event into the queue. It will be batched with other events of
 * the same type + recipient + workspace and sent after BATCH_WINDOW_MS.
 */
export function queueEmail(event: EmailEvent) {
  const key = bucketKey(event.recipient, event.type, event.workspaceId);
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { key, events: [], timer: null };
    buckets.set(key, bucket);
  }

  bucket.events.push(event);
  persistQueue();

  // Reset the batch timer on each new event (sliding window)
  // Status events use a longer window — held until next morning digest
  const category = getThrottleCategory(event.type);
  const delay = category === 'status' ? msUntilMorning() : BATCH_WINDOW_MS;

  scheduleBucketFlush(bucket, delay);

  const delayLabel = delay > 60 * 60 * 1000
    ? `${Math.round(delay / (60 * 60 * 1000))}h (morning digest)`
    : `${Math.round(delay / 1000)}s`;
  log.info(`Queued ${event.type} for ${event.recipient} (${bucket.events.length} in batch, flushing in ${delayLabel})`);
}

/**
 * Force-flush all pending batches immediately. Useful for graceful shutdown.
 */
export async function flushAll() {
  const keys = [...buckets.keys()];
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (bucket?.timer) clearTimeout(bucket.timer);
    await flushBucket(key);
  }
  if (buckets.size === 0) clearPersistedQueue();
  else persistQueue();
}

/**
 * Restore any persisted events from a previous run and re-queue them.
 * Call once at startup after registerSendFn().
 */
export function restoreQueue() {
  const events = loadQueue();
  if (events.length === 0) return;

  log.info(`Restoring ${events.length} persisted event(s)`);
  for (const event of events) {
    // Status events that missed their morning window get sent soon instead of waiting another day
    const cat = getThrottleCategory(event.type);
    if (cat === 'status' && event.createdAt && isOverdueForMorning(event.createdAt)) {
      const key = bucketKey(event.recipient, event.type, event.workspaceId);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, events: [], timer: null };
        buckets.set(key, bucket);
      }
      bucket.events.push(event);
      if (bucket.timer) clearTimeout(bucket.timer);
      bucket.timer = setTimeout(() => flushBucket(key), BATCH_WINDOW_MS);
      log.info(`Restored overdue status event for ${event.recipient} (sending in ${BATCH_WINDOW_MS / 1000}s)`);
    } else {
      queueEmail(event);
    }
  }
  persistQueue();
}

/**
 * Get current queue stats (for diagnostics).
 */
export function getQueueStats(): { buckets: number; totalEvents: number } {
  let totalEvents = 0;
  for (const bucket of buckets.values()) {
    totalEvents += bucket.events.length;
  }
  return { buckets: buckets.size, totalEvents };
}

export function getDeadLetterEvents(): DeadLetteredEmailEvent[] {
  return loadDeadLetters();
}

export function clearDeadLetterEvents() {
  try {
    if (fs.existsSync(DEAD_LETTER_FILE)) fs.unlinkSync(DEAD_LETTER_FILE);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'email-queue/clearDeadLetterEvents: programming error');
  }
}
