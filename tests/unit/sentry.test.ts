import { describe, expect, it } from 'vitest';

describe('sentry module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/sentry.js');
    expect(mod).toBeDefined();
  });
});
