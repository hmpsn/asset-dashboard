import { describe, expect, it } from 'vitest';

describe('seo-context-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/seo-context-slice.js');
    expect(mod).toBeDefined();
  });
});
