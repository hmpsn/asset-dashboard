import { describe, expect, it } from 'vitest';

describe('insights-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/insights-slice.js');
    expect(mod).toBeDefined();
  });
});
