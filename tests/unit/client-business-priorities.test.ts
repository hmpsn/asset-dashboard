import { describe, expect, it } from 'vitest';

describe('client-business-priorities module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schemas/client-business-priorities.js');
    expect(mod).toBeDefined();
  });
});
