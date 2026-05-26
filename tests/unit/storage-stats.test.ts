import { describe, expect, it } from 'vitest';

describe('storage-stats module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/storage-stats.js');
    expect(mod).toBeDefined();
  });
});
