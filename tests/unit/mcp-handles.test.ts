import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  issueHandle,
  consumeHandle,
  HandleExpiredError,
  HandleNotFoundError,
  HandleKindMismatchError,
  HandleWorkspaceMismatchError,
  __resetHandleStoreForTests,
} from '../../server/mcp/handles.js';

describe('mcp handles', () => {
  beforeEach(() => {
    __resetHandleStoreForTests();
  });

  it('issues a handle and consumes it with matching kind + workspace', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(id).toMatch(/^keyword-research_[0-9a-f-]{36}$/);
    const payload = consumeHandle<{ term: string }>(id, 'keyword-research', 'ws-1');
    expect(payload).toEqual({ term: 'test' });
  });

  it('consume is single-use - handle deleted after consumption', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    consumeHandle(id, 'keyword-research', 'ws-1');
    expect(() => consumeHandle(id, 'keyword-research', 'ws-1')).toThrow(HandleNotFoundError);
  });

  it('rejects wrong workspace with HandleWorkspaceMismatchError', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(() => consumeHandle(id, 'keyword-research', 'ws-2')).toThrow(HandleWorkspaceMismatchError);
  });

  it('rejects wrong kind with HandleKindMismatchError', () => {
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    expect(() => consumeHandle(id, 'brief-request', 'ws-1')).toThrow(HandleKindMismatchError);
  });

  it('rejects unknown id with HandleNotFoundError', () => {
    expect(() => consumeHandle('keyword-research_does-not-exist', 'keyword-research', 'ws-1')).toThrow(HandleNotFoundError);
  });

  it('rejects expired handle with HandleExpiredError', () => {
    vi.useFakeTimers();
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1500);
    expect(() => consumeHandle(id, 'keyword-research', 'ws-1')).toThrow(HandleExpiredError);
    vi.useRealTimers();
  });

  it('default TTL is 15 minutes', () => {
    vi.useFakeTimers();
    const id = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(consumeHandle(id, 'keyword-research', 'ws-1')).toBeDefined();

    const id2 = issueHandle('keyword-research', 'ws-1', { term: 'test' });
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(() => consumeHandle(id2, 'keyword-research', 'ws-1')).toThrow(HandleExpiredError);
    vi.useRealTimers();
  });

  it('supports all six handle kinds', () => {
    const kinds = [
      'keyword-research',
      'keyword-research-bulk',
      'brief-request',
      'brief',
      'post-request',
      'post',
    ] as const;
    for (const kind of kinds) {
      const id = issueHandle(kind, 'ws-1', { sample: kind });
      expect(consumeHandle(id, kind, 'ws-1')).toEqual({ sample: kind });
    }
  });
});
