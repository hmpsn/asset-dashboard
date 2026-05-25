import { describe, expect, it } from 'vitest';

describe('types module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/keyword-intelligence/types.js');
    expect(mod).toBeDefined();
  });
});
