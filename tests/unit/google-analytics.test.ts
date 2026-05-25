import { describe, expect, it } from 'vitest';

describe('google-analytics module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/google-analytics.js');
    expect(mod).toBeDefined();
  });
});
