import { describe, expect, it } from 'vitest';

describe('site-context module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/site-context.js');
    expect(mod).toBeDefined();
  });
});
