// tests/unit/data-retention-pure.test.ts
// Pure unit tests for server/data-retention.ts
//
// The module only exposes two lifecycle functions: startDataRetentionCrons and
// stopDataRetentionCrons.  All heavy lifting is delegated to three cleanup
// helpers imported from other modules.  We verify:
//   • crons can be started and stopped without throwing
//   • starting a second time is a no-op (idempotent)
//   • stopping when nothing is running is safe
//   • the three cleanup functions are called during a retention cycle

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { mockCleanupChatSessions, mockCleanupSnapshots, mockCleanupLlmsTxt } = vi.hoisted(() => ({
  mockCleanupChatSessions: vi.fn().mockReturnValue(0),
  mockCleanupSnapshots: vi.fn().mockReturnValue(0),
  mockCleanupLlmsTxt: vi.fn().mockReturnValue(0),
}));

vi.mock('../../server/chat-memory.js', () => ({
  cleanupOldChatSessions: mockCleanupChatSessions,
}));

vi.mock('../../server/reports.js', () => ({
  cleanupOldSnapshots: mockCleanupSnapshots,
}));

vi.mock('../../server/llms-txt-generator.js', () => ({
  cleanupOldLlmsTxt: mockCleanupLlmsTxt,
}));

import {
  startDataRetentionCrons,
  stopDataRetentionCrons,
} from '../../server/data-retention.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Ensure crons are stopped before each test so module-level state is clean
  stopDataRetentionCrons();
});

afterEach(() => {
  stopDataRetentionCrons();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------
describe('startDataRetentionCrons', () => {
  it('starts without throwing', () => {
    expect(() => startDataRetentionCrons()).not.toThrow();
  });

  it('is idempotent — calling start twice does not throw', () => {
    startDataRetentionCrons();
    expect(() => startDataRetentionCrons()).not.toThrow();
  });
});

describe('stopDataRetentionCrons', () => {
  it('stops without throwing when crons were running', () => {
    startDataRetentionCrons();
    expect(() => stopDataRetentionCrons()).not.toThrow();
  });

  it('is safe to call when no crons are running', () => {
    // Nothing started — should not throw
    expect(() => stopDataRetentionCrons()).not.toThrow();
  });

  it('can be called multiple times in a row', () => {
    startDataRetentionCrons();
    stopDataRetentionCrons();
    expect(() => stopDataRetentionCrons()).not.toThrow();
  });
});

// The startup delay is 2 minutes (120 000 ms).
const STARTUP_DELAY_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Retention cycle — cleanup helpers are called
// ---------------------------------------------------------------------------
describe('retention cycle (triggered by startup timer)', () => {
  it('calls all three cleanup helpers after the startup delay', async () => {
    startDataRetentionCrons();

    // Advance exactly past the 2-minute startup delay (but not far enough to
    // trigger the daily setInterval) and let the microtask queue flush.
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    expect(mockCleanupChatSessions).toHaveBeenCalledWith(180);
    expect(mockCleanupSnapshots).toHaveBeenCalledWith(365);
    expect(mockCleanupLlmsTxt).toHaveBeenCalledWith(90);
  });

  it('passes the correct retention-day values to each helper', async () => {
    startDataRetentionCrons();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    // chat sessions: 180 days
    expect(mockCleanupChatSessions.mock.calls[0][0]).toBe(180);
    // snapshots: 365 days (1 year)
    expect(mockCleanupSnapshots.mock.calls[0][0]).toBe(365);
    // llms.txt files: 90 days
    expect(mockCleanupLlmsTxt.mock.calls[0][0]).toBe(90);
  });

  it('does not call cleanup helpers before the startup delay elapses', async () => {
    startDataRetentionCrons();

    // Advance only 1 minute — not enough to trigger the 2-minute startup delay
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(mockCleanupChatSessions).not.toHaveBeenCalled();
    expect(mockCleanupSnapshots).not.toHaveBeenCalled();
    expect(mockCleanupLlmsTxt).not.toHaveBeenCalled();
  });

  it('does not call cleanup helpers after stop is called before the delay fires', async () => {
    startDataRetentionCrons();
    stopDataRetentionCrons();

    // Fast-forward past the 2-minute startup delay
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + 1000);

    expect(mockCleanupChatSessions).not.toHaveBeenCalled();
    expect(mockCleanupSnapshots).not.toHaveBeenCalled();
    expect(mockCleanupLlmsTxt).not.toHaveBeenCalled();
  });

  it('handles errors from cleanup helpers gracefully (no throw)', async () => {
    mockCleanupChatSessions.mockImplementation(() => { throw new Error('DB error'); });

    startDataRetentionCrons();
    // Advance past the startup delay — error is caught inside runRetention, should not propagate
    await expect(vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// start + stop + restart cycle
// ---------------------------------------------------------------------------
describe('cron lifecycle restartability', () => {
  it('can be stopped and restarted without errors', async () => {
    startDataRetentionCrons();
    stopDataRetentionCrons();

    // Reset only call history (clearAllMocks strips implementations — restore them)
    mockCleanupChatSessions.mockReset().mockReturnValue(0);
    mockCleanupSnapshots.mockReset().mockReturnValue(0);
    mockCleanupLlmsTxt.mockReset().mockReturnValue(0);

    startDataRetentionCrons();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    // After restart, cleanup helpers should be called again
    expect(mockCleanupChatSessions).toHaveBeenCalled();
    expect(mockCleanupSnapshots).toHaveBeenCalled();
    expect(mockCleanupLlmsTxt).toHaveBeenCalled();
  });
});
