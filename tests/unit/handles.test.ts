import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetHandleStoreForTests,
  consumeHandle,
  consumeHandleAtomically,
  HandleExpiredError,
  HandleKindMismatchError,
  HandleNotFoundError,
  HandleWorkspaceMismatchError,
  issueHandle,
  readHandleForAtomicConsumption,
} from '../../server/mcp/handles.js';

beforeEach(() => {
  __resetHandleStoreForTests();
  vi.useRealTimers();
});

describe('mcp handle lifecycle', () => {
  it('issues and consumes a handle exactly once', () => {
    const id = issueHandle('keyword-research', 'ws_1', { keyword: 'acme' });
    const payload = consumeHandle<{ keyword: string }>(id, 'keyword-research', 'ws_1');

    expect(id.startsWith('keyword-research_')).toBe(true);
    expect(payload).toEqual({ keyword: 'acme' });
    expect(() => consumeHandle(id, 'keyword-research', 'ws_1')).toThrow(HandleNotFoundError);
  });

  it('rejects workspace and kind mismatches without consuming the record', () => {
    const id = issueHandle('brief-request', 'ws_alpha', { id: 'b1' });

    expect(() => consumeHandle(id, 'brief-request', 'ws_beta')).toThrow(HandleWorkspaceMismatchError);
    expect(() => consumeHandle(id, 'post-request', 'ws_alpha')).toThrow(HandleKindMismatchError);

    // Correct consume still succeeds after mismatch checks
    expect(consumeHandle(id, 'brief-request', 'ws_alpha')).toEqual({ id: 'b1' });
  });

  it('expires handles by TTL and removes them when consumed after expiry check', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));

    const id = issueHandle('post', 'ws_1', { postId: 'p1' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);

    expect(() => consumeHandle(id, 'post', 'ws_1')).toThrow(HandleExpiredError);
    expect(() => consumeHandle(id, 'post', 'ws_1')).toThrow(HandleNotFoundError);
  });

  it('expires a handle exactly at its TTL boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));

    const id = issueHandle('post', 'ws_1', { postId: 'p1' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1000);

    expect(() => readHandleForAtomicConsumption(id, 'post', 'ws_1'))
      .toThrow(HandleExpiredError);
    expect(() => consumeHandle(id, 'post', 'ws_1')).toThrow(HandleNotFoundError);
  });

  it('rolls the consume back when the authorized durable mutation fails', () => {
    const id = issueHandle('post-request', 'ws_1', { postId: 'p1' });

    expect(() => consumeHandleAtomically(
      id,
      'post-request',
      'ws_1',
      () => {
        throw new Error('durable commit failed');
      },
    )).toThrow('durable commit failed');

    expect(consumeHandleAtomically<{ postId: string }, string>(
      id,
      'post-request',
      'ws_1',
      payload => payload.postId,
    )).toBe('p1');
    expect(() => consumeHandle(id, 'post-request', 'ws_1')).toThrow(HandleNotFoundError);
  });

  it('reads authority without consuming it so the domain transaction can commit it later', () => {
    const id = issueHandle('brief', 'ws_1', { briefId: 'brief_1', generationRevision: 4 });

    expect(readHandleForAtomicConsumption(id, 'brief', 'ws_1')).toEqual({
      briefId: 'brief_1',
      generationRevision: 4,
    });
    expect(consumeHandle(id, 'brief', 'ws_1')).toEqual({
      briefId: 'brief_1',
      generationRevision: 4,
    });
    expect(() => readHandleForAtomicConsumption(id, 'brief', 'ws_1'))
      .toThrow(HandleNotFoundError);
  });
});
