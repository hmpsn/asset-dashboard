import { describe, expect, it } from 'vitest';

describe('social-profiles module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/social-profiles.js');
    expect(mod).toBeDefined();
  });
});
