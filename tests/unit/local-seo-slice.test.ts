import { describe, expect, it } from 'vitest';

describe('local-seo-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/local-seo-slice.js');
    expect(mod).toBeDefined();
  });
});
