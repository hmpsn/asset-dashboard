import { describe, expect, it } from 'vitest';

describe('seo-context-source module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/seo-context-source.js');
    expect(mod).toBeDefined();
  });
});
