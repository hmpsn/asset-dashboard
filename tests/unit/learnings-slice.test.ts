import { describe, expect, it } from 'vitest';

describe('learnings-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/learnings-slice.js');
    expect(mod).toBeDefined();
  });
});
