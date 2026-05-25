import { describe, expect, it } from 'vitest';

describe('seo-bulk-jobs module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schemas/seo-bulk-jobs.js');
    expect(mod).toBeDefined();
  });
});
