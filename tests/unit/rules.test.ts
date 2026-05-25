import { describe, expect, it } from 'vitest';

describe('rules module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/keyword-intelligence/rules.js');
    expect(mod).toBeDefined();
  });
});
