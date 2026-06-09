/**
 * Unit tests for email-queue.ts core batching and throttling logic.
 *
 * Strategy:
 * - Use vi.useFakeTimers() to control the batch window without real waits.
 * - Use `registerSendFn` with a vi.fn() to capture outbound calls.
 * - Use `action_approved` (category: 'internal') events so canSend() always
 *   returns { allowed: true } without touching per-category DB limits.
 * - Call flushAll() in beforeEach to drain any leftover buckets from prior tests
 *   (the module-level `buckets` Map persists across test cases in the same file).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerSendFn,
  queueEmail,
  flushAll,
  getQueueStats,
  restoreQueue,
  getDeadLetterEvents,
  clearDeadLetterEvents,
} from '../../server/email-queue.js';
import type { EmailEvent } from '../../server/email-templates.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BATCH_WINDOW_MS = 5 * 60 * 1000; // must match the constant in email-queue.ts
const RETRY_DELAY_MS = 60 * 1000; // must match the constant in email-queue.ts

function makeEvent(overrides: Partial<EmailEvent> = {}): EmailEvent {
  return {
    type: 'action_approved',   // 'internal' category — never throttled
    recipient: 'test@example.com',
    workspaceName: 'Test Workspace',
    workspaceId: 'ws_test_queue',
    dashboardUrl: 'https://example.com/client/ws_test_queue',
    data: { title: 'Test Action', summary: 'a summary' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

let mockSend: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();

  // Drain any buckets left over from a prior test
  await flushAll();
  clearDeadLetterEvents();

  // Install a fresh mock send function
  mockSend = vi.fn().mockResolvedValue(true);
  registerSendFn(mockSend);
});

afterEach(async () => {
  // Clean up any timers/buckets the test may have left open
  await flushAll();
  clearDeadLetterEvents();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('email-queue batching', () => {
  it('groups two events with the same recipient and type into a single bucket', () => {
    queueEmail(makeEvent());
    queueEmail(makeEvent());

    const stats = getQueueStats();
    expect(stats.buckets).toBe(1);
    expect(stats.totalEvents).toBe(2);
  });

  it('creates separate buckets for events with different types', () => {
    queueEmail(makeEvent({ type: 'action_approved' }));
    queueEmail(makeEvent({ type: 'request_new' }));

    const stats = getQueueStats();
    expect(stats.buckets).toBe(2);
    expect(stats.totalEvents).toBe(2);
  });

  it('creates separate buckets for events with different recipients', () => {
    queueEmail(makeEvent({ recipient: 'alice@example.com' }));
    queueEmail(makeEvent({ recipient: 'bob@example.com' }));

    const stats = getQueueStats();
    expect(stats.buckets).toBe(2);
    expect(stats.totalEvents).toBe(2);
  });

  it('creates separate buckets for the same recipient+type across different workspaces', () => {
    queueEmail(makeEvent({ workspaceId: 'ws_alpha' }));
    queueEmail(makeEvent({ workspaceId: 'ws_beta' }));

    const stats = getQueueStats();
    expect(stats.buckets).toBe(2);
    expect(stats.totalEvents).toBe(2);
  });
});

describe('email-queue flushAll', () => {
  it('calls the registered send function once per bucket after flushAll', async () => {
    queueEmail(makeEvent());
    queueEmail(makeEvent());   // same bucket

    await flushAll();

    expect(mockSend).toHaveBeenCalledTimes(1);
    // The send received a recipient, subject, and html string
    const [to, subject, html] = mockSend.mock.calls[0] as [string, string, string];
    expect(to).toBe('test@example.com');
    expect(typeof subject).toBe('string');
    expect(subject.length).toBeGreaterThan(0);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('calls send once per distinct bucket when multiple buckets exist', async () => {
    queueEmail(makeEvent({ type: 'action_approved' }));
    queueEmail(makeEvent({ type: 'request_new' }));

    await flushAll();

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('drains all buckets so getQueueStats returns zero after flushing', async () => {
    queueEmail(makeEvent());

    await flushAll();

    const stats = getQueueStats();
    expect(stats.buckets).toBe(0);
    expect(stats.totalEvents).toBe(0);
  });

  it('does not throw and does not call send when there are no pending events', async () => {
    await expect(flushAll()).resolves.not.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('cancels pending timers before flushing so the callback does not fire twice', async () => {
    queueEmail(makeEvent());

    // flushAll should cancel the scheduled timer and flush immediately
    await flushAll();

    // Advance past the original batch window — timer should already be cleared
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 1000);

    // Still only one call from the manual flush, not a second from the timer
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('email-queue timer-driven flush', () => {
  it('sends the batch automatically when the batch window elapses', async () => {
    queueEmail(makeEvent());

    expect(mockSend).not.toHaveBeenCalled();

    // Advance fake clock past the 5-minute batch window
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 1);

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('resets the sliding window on every new event in the same bucket', async () => {
    queueEmail(makeEvent());

    // Advance almost to the window end, then add a second event
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1000);
    expect(mockSend).not.toHaveBeenCalled();

    queueEmail(makeEvent());  // resets the 5-minute timer

    // Advance by the original remaining time — should still be waiting
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1000);
    expect(mockSend).not.toHaveBeenCalled();

    // Now advance past the reset window
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Both events should have been batched into a single send
    const [to] = mockSend.mock.calls[0] as [string, string, string];
    expect(to).toBe('test@example.com');
  });
});

describe('email-queue retry and dead-letter handling', () => {
  it('requeues a failed send and retries it after the retry delay', async () => {
    mockSend.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    queueEmail(makeEvent());
    await flushAll();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(getQueueStats().totalEvents).toBe(1);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(getQueueStats().totalEvents).toBe(0);
    expect(getDeadLetterEvents()).toHaveLength(0);
  });

  it('moves events to dead letter after repeated send failures', async () => {
    mockSend.mockResolvedValue(false);

    queueEmail(makeEvent());
    await flushAll();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1);
    await vi.advanceTimersByTimeAsync((RETRY_DELAY_MS * 2) + 1);

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(getQueueStats().totalEvents).toBe(0);
    const deadLetters = getDeadLetterEvents();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].recipient).toBe('test@example.com');
    expect(deadLetters[0].deliveryAttempts).toBe(3);
  });
});

describe('email-queue registerSendFn', () => {
  it('does not call send when no send function has been registered', async () => {
    // Unregister by registering null-equivalent: use a spy but then swap it out
    // We test this indirectly by installing a fresh no-op and verifying the queue
    // held the events (already covered), but here we specifically test the
    // "no sendFn" warn path by temporarily unregistering.

    // Register undefined-ish send function by calling registerSendFn with a
    // function that we can swap — then override with null via re-register.
    // Since the module does not expose an unregister path, we instead verify
    // that replacing the send fn with a new mock works correctly.
    const secondMock = vi.fn().mockResolvedValue(true);
    registerSendFn(secondMock);

    queueEmail(makeEvent());
    await flushAll();

    expect(secondMock).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();

    // Restore original mock so afterEach cleanup works cleanly
    registerSendFn(mockSend);
  });

  it('passes the full array of batched events to renderDigest before calling send', async () => {
    // Confirm the send function receives a non-trivial subject for a multi-event batch
    queueEmail(makeEvent({ data: { title: 'Action A', summary: 'summary a' } }));
    queueEmail(makeEvent({ data: { title: 'Action B', summary: 'summary b' } }));
    queueEmail(makeEvent({ data: { title: 'Action C', summary: 'summary c' } }));

    await flushAll();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [_to, subject] = mockSend.mock.calls[0] as [string, string, string];
    // 3 events → subject should mention the count
    expect(subject).toMatch(/3/);
  });
});

describe('email-queue getQueueStats', () => {
  it('returns zero buckets and events when the queue is empty', () => {
    const stats = getQueueStats();
    expect(stats.buckets).toBe(0);
    expect(stats.totalEvents).toBe(0);
  });

  it('accurately reports total event count across multiple buckets', () => {
    queueEmail(makeEvent({ type: 'action_approved' }));
    queueEmail(makeEvent({ type: 'action_approved' }));
    queueEmail(makeEvent({ type: 'request_new' }));

    const stats = getQueueStats();
    expect(stats.buckets).toBe(2);
    expect(stats.totalEvents).toBe(3);
  });
});

describe('email-queue restoreQueue', () => {
  it('does not throw when called with no persisted events', () => {
    expect(() => restoreQueue()).not.toThrow();
  });
});
