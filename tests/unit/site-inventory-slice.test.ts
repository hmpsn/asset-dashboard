import { describe, expect, it } from 'vitest';

describe('site-inventory-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/site-inventory-slice.js');
    expect(mod).toBeDefined();
  });
});
