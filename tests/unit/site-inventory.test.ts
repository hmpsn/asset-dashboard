import { describe, expect, it } from 'vitest';

describe('site-inventory module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/site-inventory.js');
    expect(mod).toBeDefined();
  });
});
