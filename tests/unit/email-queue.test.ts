import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailEvent, EmailEventType } from '../../server/email-templates.js';

const BATCH_WINDOW_MS = 5 * 60 * 1000;
const STATUS_MORNING_DELAY_MS = 6 * 60 * 60 * 1000;

const fsMock = {
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, data: string) => void>(),
  unlinkSync: vi.fn<(path: string) => void>(),
};

const throttleMock = {
  getThrottleCategory: vi.fn<(type: EmailEventType) => 'status' | 'action'>(),
  canSend: vi.fn<(recipient: string, category: string) => { allowed: boolean; reason?: string }>(),
  recordSend: vi.fn<(recipient: string, category: string, emailType: string, workspaceId: string, eventCount?: number) => void>(),
  msUntilMorning: vi.fn<() => number>(),
  isOverdueForMorning: vi.fn<(createdAt: string) => boolean>(),
};

const renderDigestMock = vi.fn<
  (type: EmailEventType, events: EmailEvent[]) => { subject: string; html: string }
>();

vi.mock('fs', () => ({
  default: fsMock,
}));

vi.mock('../../server/data-dir.js', () => ({
  getDataDir: vi.fn(() => '/mock/email-queue'),
}));

vi.mock('../../server/email-throttle.js', () => ({
  getThrottleCategory: (...args: [EmailEventType]) => throttleMock.getThrottleCategory(...args),
  canSend: (...args: [string, string]) => throttleMock.canSend(...args),
  recordSend: (...args: [string, string, string, string, number?]) => throttleMock.recordSend(...args),
  msUntilMorning: () => throttleMock.msUntilMorning(),
  isOverdueForMorning: (...args: [string]) => throttleMock.isOverdueForMorning(...args),
}));

vi.mock('../../server/email-templates.js', () => ({
  renderDigest: (...args: [EmailEventType, EmailEvent[]]) => renderDigestMock(...args),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

async function loadEmailQueueModule() {
  vi.resetModules();
  return import('../../server/email-queue.js');
}

function makeEvent(overrides: Partial<EmailEvent> = {}): EmailEvent {
  return {
    type: 'approval_ready',
    recipient: 'client@example.com',
    workspaceName: 'Acme Co',
    workspaceId: 'ws-1',
    dashboardUrl: 'https://app.example.com/ws/ws-1',
    data: { itemId: 'item-1' },
    createdAt: '2026-05-25T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  fsMock.existsSync.mockReturnValue(false);
  fsMock.readFileSync.mockReturnValue('[]');

  throttleMock.getThrottleCategory.mockImplementation((type) => (
    type === 'request_status' || type === 'request_response' ? 'status' : 'action'
  ));
  throttleMock.canSend.mockReturnValue({ allowed: true });
  throttleMock.msUntilMorning.mockReturnValue(STATUS_MORNING_DELAY_MS);
  throttleMock.isOverdueForMorning.mockReturnValue(false);

  renderDigestMock.mockImplementation((type, events) => ({
    subject: `${type} digest (${events.length})`,
    html: `<p>${events.length} events</p>`,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('email-queue behavior', () => {
  it('batches queueEmail by recipient+type+workspace and flushes each bucket separately', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    emailQueue.queueEmail(makeEvent({ data: { itemId: 'a' } }));
    emailQueue.queueEmail(makeEvent({ data: { itemId: 'b' } }));
    emailQueue.queueEmail(makeEvent({ workspaceId: 'ws-2', data: { itemId: 'c' } }));
    emailQueue.queueEmail(makeEvent({ type: 'content_post_ready', data: { itemId: 'd' } }));

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 3, totalEvents: 4 });

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(send).toHaveBeenCalledTimes(3);
    expect(renderDigestMock).toHaveBeenCalledTimes(3);

    const batchSizes = renderDigestMock.mock.calls.map(([, events]) => events.length).sort((a, b) => a - b);
    expect(batchSizes).toEqual([1, 1, 2]);

    const twoEventBatch = renderDigestMock.mock.calls.find(([, events]) => events.length === 2);
    expect(twoEventBatch).toBeDefined();
    expect(twoEventBatch?.[0]).toBe('approval_ready');
    const twoEventBatchEvents = twoEventBatch?.[1] ?? [];
    expect(twoEventBatchEvents).toHaveLength(2);
    expect(twoEventBatchEvents.map((event) => `${event.workspaceId}:${event.recipient}`)).toEqual([
      'ws-1:client@example.com',
      'ws-1:client@example.com',
    ]);

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('flushAll sends pending buckets immediately and clears persisted queue file', async () => {
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    fsMock.existsSync.mockReturnValue(true);

    emailQueue.queueEmail(makeEvent({ data: { itemId: 'one' } }));
    emailQueue.queueEmail(makeEvent({ workspaceId: 'ws-2', data: { itemId: 'two' } }));

    await emailQueue.flushAll();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'client@example.com', 'approval_ready digest (1)', '<p>1 events</p>');
    expect(send).toHaveBeenNthCalledWith(2, 'client@example.com', 'approval_ready digest (1)', '<p>1 events</p>');
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(1);
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('restoreQueue requeues persisted events into in-memory buckets', async () => {
    const emailQueue = await loadEmailQueueModule();

    const persisted = [
      makeEvent({ data: { itemId: 'r1' } }),
      makeEvent({ data: { itemId: 'r2' } }),
      makeEvent({ workspaceId: 'ws-2', data: { itemId: 'r3' } }),
    ];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(persisted));

    emailQueue.restoreQueue();

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 2, totalEvents: 3 });
    expect(fsMock.readFileSync).toHaveBeenCalledWith('/mock/email-queue/pending.json', 'utf-8');
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });

  it('restoreQueue uses overdue status fast-path and sends after batch window', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    const statusEvent = makeEvent({
      type: 'request_status',
      createdAt: '2026-05-24T08:00:00.000Z',
      data: { requestId: 'req-1' },
    });

    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify([statusEvent]));
    throttleMock.isOverdueForMorning.mockReturnValue(true);

    emailQueue.restoreQueue();

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 1, totalEvents: 1 });

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('client@example.com', 'request_status digest (1)', '<p>1 events</p>');
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('drops events when timer flush runs without a registered send function', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();

    emailQueue.queueEmail(makeEvent());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(renderDigestMock).not.toHaveBeenCalled();
    expect(throttleMock.recordSend).not.toHaveBeenCalled();
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('drops throttle-blocked events without rendering or sending', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    throttleMock.canSend.mockReturnValue({ allowed: false, reason: 'action: 3/3 in last 1d' });

    emailQueue.queueEmail(makeEvent());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(send).not.toHaveBeenCalled();
    expect(renderDigestMock).not.toHaveBeenCalled();
    expect(throttleMock.recordSend).not.toHaveBeenCalled();
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('drops bucket when digest renderer returns empty html', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    renderDigestMock.mockReturnValueOnce({ subject: 'empty', html: '' });

    emailQueue.queueEmail(makeEvent());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(send).not.toHaveBeenCalled();
    expect(throttleMock.recordSend).not.toHaveBeenCalled();
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('does not record throttle send when outbound sendFn returns false', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(false);
    emailQueue.registerSendFn(send);

    emailQueue.queueEmail(makeEvent());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(throttleMock.recordSend).not.toHaveBeenCalled();
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('restoreQueue safely ignores invalid persisted JSON', async () => {
    const emailQueue = await loadEmailQueueModule();

    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue('{invalid-json');

    expect(() => emailQueue.restoreQueue()).not.toThrow();
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('status events use morning-delay timer window', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    throttleMock.msUntilMorning.mockReturnValue(2 * 60 * 60 * 1000);

    emailQueue.queueEmail(makeEvent({ type: 'request_status' }));

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - BATCH_WINDOW_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('client@example.com', 'request_status digest (1)', '<p>1 events</p>');
  });

  it('getQueueStats reflects queued and flushed state transitions', async () => {
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });

    emailQueue.queueEmail(makeEvent({ data: { itemId: 's1' } }));
    emailQueue.queueEmail(makeEvent({ data: { itemId: 's2' } }));
    emailQueue.queueEmail(makeEvent({ workspaceId: 'ws-2', data: { itemId: 's3' } }));

    expect(emailQueue.getQueueStats()).toEqual({ buckets: 2, totalEvents: 3 });

    await emailQueue.flushAll();

    expect(send).toHaveBeenCalledTimes(2);
    expect(emailQueue.getQueueStats()).toEqual({ buckets: 0, totalEvents: 0 });
  });

  it('resets batch timer on repeated events and flushes on sliding-window boundary', async () => {
    vi.useFakeTimers();
    const emailQueue = await loadEmailQueueModule();
    const send = vi.fn().mockResolvedValue(true);
    emailQueue.registerSendFn(send);

    emailQueue.queueEmail(makeEvent({ data: { itemId: 'sw-1' } }));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1_000);
    expect(send).not.toHaveBeenCalled();

    emailQueue.queueEmail(makeEvent({ data: { itemId: 'sw-2' } }));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1_001);
    expect(send).toHaveBeenCalledTimes(1);
    expect(renderDigestMock).toHaveBeenCalledWith('approval_ready', expect.arrayContaining([
      expect.objectContaining({ data: { itemId: 'sw-1' } }),
      expect.objectContaining({ data: { itemId: 'sw-2' } }),
    ]));
  });
});
