import { describe, expect, it } from 'vitest';

describe('monthly-digest module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/monthly-digest.js');
    expect(mod).toBeDefined();
  });
});
