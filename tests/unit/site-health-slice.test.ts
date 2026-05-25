import { describe, expect, it } from 'vitest';

describe('site-health-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/site-health-slice.js');
    expect(mod).toBeDefined();
  });
});
