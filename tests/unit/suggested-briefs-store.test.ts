import { describe, expect, it } from 'vitest';

describe('suggested-briefs-store module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/suggested-briefs-store.js');
    expect(mod).toBeDefined();
  });
});
