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

// ── Config ──

const BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const QUEUE_DIR = getDataDir('email-queue');
const QUEUE_FILE = path.join(QUEUE_DIR, 'pending.json');

// ── In-memory state ──

interface QueueBucket {
  key: string;              // recipient:type:workspaceId
  events: EmailEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

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
    const data: EmailEvent[] = [];
    for (const bucket of buckets.values()) {
      data.push(...bucket.events);
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[email-queue] Failed to persist queue:', err);
  }
}

function loadQueue(): EmailEvent[] {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      return JSON.parse(raw) as EmailEvent[];
    }
  } catch { /* fresh start */ }
  return [];
}

function clearPersistedQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
  } catch { /* ignore */ }
}

// ── Core ──

function bucketKey(recipient: string, type: EmailEventType, workspaceId: string): string {
  return `${recipient}:${type}:${workspaceId}`;
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

  // Clear bucket before sending (so new events during send get a fresh batch)
  buckets.delete(key);
  persistQueue();

  if (!sendFn) {
    console.warn('[email-queue] No send function registered, dropping', events.length, 'events');
    return;
  }

  try {
    const { subject, html } = renderDigest(type, events);
    if (!html) {
      console.warn('[email-queue] Empty template for type:', type);
      return;
    }
    const ok = await sendFn(recipient, subject, html);
    if (ok) {
      console.log(`[email-queue] Sent batched ${type} email to ${recipient} (${events.length} event${events.length !== 1 ? 's' : ''})`);
    } else {
      console.error(`[email-queue] Failed to send ${type} email to ${recipient}`);
    }
  } catch (err) {
    console.error('[email-queue] Error sending digest:', err);
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
  if (bucket.timer) clearTimeout(bucket.timer);
  bucket.timer = setTimeout(() => flushBucket(key), BATCH_WINDOW_MS);

  console.log(`[email-queue] Queued ${event.type} for ${event.recipient} (${bucket.events.length} in batch, flushing in ${BATCH_WINDOW_MS / 1000}s)`);
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
  clearPersistedQueue();
}

/**
 * Restore any persisted events from a previous run and re-queue them.
 * Call once at startup after registerSendFn().
 */
export function restoreQueue() {
  const events = loadQueue();
  if (events.length === 0) return;

  console.log(`[email-queue] Restoring ${events.length} persisted event(s)`);
  for (const event of events) {
    queueEmail(event);
  }
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
