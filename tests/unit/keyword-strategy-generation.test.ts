import { describe, expect, it } from 'vitest';

describe('keyword-strategy-generation module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/keyword-strategy-generation.js');
    expect(mod).toBeDefined();
  });
});
