import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupOldChatSessions: vi.fn(),
  cleanupOldSnapshots: vi.fn(),
  cleanupOldLlmsTxt: vi.fn(),
  pruneAllDiscoveredQueries: vi.fn(),
}));

vi.mock('../../server/chat-memory.js', () => ({
  cleanupOldChatSessions: mocks.cleanupOldChatSessions,
}));
vi.mock('../../server/reports.js', () => ({
  cleanupOldSnapshots: mocks.cleanupOldSnapshots,
}));
vi.mock('../../server/llms-txt-generator.js', () => ({
  cleanupOldLlmsTxt: mocks.cleanupOldLlmsTxt,
}));
vi.mock('../../server/client-discovered-queries.js', () => ({
  pruneAllDiscoveredQueries: mocks.pruneAllDiscoveredQueries,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('data-retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.cleanupOldChatSessions.mockReturnValue(1);
    mocks.cleanupOldSnapshots.mockReturnValue(2);
    mocks.cleanupOldLlmsTxt.mockReturnValue(3);
    mocks.pruneAllDiscoveredQueries.mockReturnValue(4);
  });

  afterEach(async () => {
    const mod = await import('../../server/data-retention.js');
    mod.stopDataRetentionCrons();
    vi.useRealTimers();
  });

  it('runs startup retention once and executes all cleanup domains', async () => {
    const mod = await import('../../server/data-retention.js');
    mod.startDataRetentionCrons();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mocks.cleanupOldChatSessions).toHaveBeenCalledWith(180);
    expect(mocks.cleanupOldSnapshots).toHaveBeenCalledWith(365);
    expect(mocks.cleanupOldLlmsTxt).toHaveBeenCalledWith(90);
    expect(mocks.pruneAllDiscoveredQueries).toHaveBeenCalled();
  });

  it('does not run startup retention after stop is called before timeout', async () => {
    const mod = await import('../../server/data-retention.js');
    mod.startDataRetentionCrons();
    mod.stopDataRetentionCrons();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mocks.cleanupOldChatSessions).not.toHaveBeenCalled();
    expect(mocks.cleanupOldSnapshots).not.toHaveBeenCalled();
    expect(mocks.cleanupOldLlmsTxt).not.toHaveBeenCalled();
    expect(mocks.pruneAllDiscoveredQueries).not.toHaveBeenCalled();
  });

  it('is idempotent across duplicate start calls', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mod = await import('../../server/data-retention.js');

    mod.startDataRetentionCrons();
    mod.startDataRetentionCrons();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
  });
});
