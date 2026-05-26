import { describe, expect, it } from 'vitest';

describe('aeo-page-review module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/aeo-page-review.js');
    expect(mod).toBeDefined();
  });
});
