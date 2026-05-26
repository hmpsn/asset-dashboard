import { describe, expect, it, vi } from 'vitest';
import { createStmtCache } from '../../server/db/stmt-cache.js';

describe('createStmtCache', () => {
  it('builds lazily on first access and caches thereafter', () => {
    const build = vi.fn(() => ({ stmt: 'prepared' }));
    const get = createStmtCache(build);

    expect(build).not.toHaveBeenCalled();
    const first = get();
    const second = get();

    expect(build).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toEqual({ stmt: 'prepared' });
  });

  it('does not cache failed initialization and retries on next call', () => {
    const build = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => ({ ok: true }));
    const get = createStmtCache(build);

    expect(() => get()).toThrow('boom');
    const next = get();

    expect(build).toHaveBeenCalledTimes(2);
    expect(next).toEqual({ ok: true });
  });
});
