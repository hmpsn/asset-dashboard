import { describe, expect, it } from 'vitest';

describe('external-fetch module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/external-fetch.js');
    expect(mod).toBeDefined();
  });
});
