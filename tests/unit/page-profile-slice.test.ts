import { describe, expect, it } from 'vitest';

describe('page-profile-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/page-profile-slice.js');
    expect(mod).toBeDefined();
  });
});
