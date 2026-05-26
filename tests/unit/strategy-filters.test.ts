import { describe, expect, it } from 'vitest';

describe('strategy-filters module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/strategy-filters.js');
    expect(mod).toBeDefined();
  });
});
