import { describe, expect, it } from 'vitest';

describe('client-signals-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/client-signals-slice.js');
    expect(mod).toBeDefined();
  });
});
