import { describe, expect, it } from 'vitest';

describe('keyword-strategy-pages module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/keyword-strategy-pages.js');
    expect(mod).toBeDefined();
  });
});
