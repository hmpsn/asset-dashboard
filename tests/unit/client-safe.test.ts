import { describe, expect, it } from 'vitest';

describe('client-safe module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/serializers/client-safe.js');
    expect(mod).toBeDefined();
  });
});
