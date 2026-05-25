import { describe, expect, it } from 'vitest';

describe('rich-results module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/rich-results.js');
    expect(mod).toBeDefined();
  });
});
