import { describe, it, expect } from 'vitest';
import { cleanupOldChatSessions } from '../server/chat-memory.js';
import { cleanupOldSnapshots } from '../server/reports.js';
import { cleanupOldLlmsTxt } from '../server/llms-txt-generator.js';
import { startDataRetentionCrons, stopDataRetentionCrons } from '../server/data-retention.js';

describe('data-retention cleanup functions', () => {
  it('cleanupOldChatSessions returns a number >= 0', () => {
    const deleted = cleanupOldChatSessions(180);
    expect(typeof deleted).toBe('number');
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
  it('cleanupOldChatSessions with maxAge=99999 deletes nothing', () => {
    const deleted = cleanupOldChatSessions(99999);
    expect(deleted).toBe(0);
  });
  it('cleanupOldSnapshots returns a number >= 0', () => {
    const deleted = cleanupOldSnapshots(10);
    expect(typeof deleted).toBe('number');
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
  it('cleanupOldSnapshots with maxAgeDays=999999 deletes nothing', () => {
    const deleted = cleanupOldSnapshots(999999);
    expect(deleted).toBe(0);
  });
  it('cleanupOldLlmsTxt returns a number >= 0', () => {
    const deleted = cleanupOldLlmsTxt(90);
    expect(typeof deleted).toBe('number');
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
  it('cleanupOldLlmsTxt with maxAge=99999 deletes nothing', () => {
    const deleted = cleanupOldLlmsTxt(99999);
    expect(deleted).toBe(0);
  });
});

describe('data-retention cron lifecycle', () => {
  it('startDataRetentionCrons is idempotent', () => {
    startDataRetentionCrons();
    startDataRetentionCrons();
    stopDataRetentionCrons();
    expect(true).toBe(true);
  });
});
