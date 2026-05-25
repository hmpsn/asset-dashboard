import { describe, expect, it } from 'vitest';

describe('client-actions-mutations module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/domains/inbox/client-actions-mutations.js');
    expect(mod).toBeDefined();
  });
});
