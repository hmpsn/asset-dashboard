import { describe, expect, it } from 'vitest';

describe('anthropic-helpers module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/anthropic-helpers.js');
    expect(mod).toBeDefined();
  });
});
