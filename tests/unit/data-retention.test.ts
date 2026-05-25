import { describe, expect, it } from 'vitest';

describe('data-retention module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/data-retention.js');
    expect(mod).toBeDefined();
  });
});
