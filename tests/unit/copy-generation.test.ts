import { describe, expect, it } from 'vitest';

describe('copy-generation module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/copy-generation.js');
    expect(mod).toBeDefined();
  });
});
