import { describe, expect, it } from 'vitest';

describe('keyword-feedback module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/keyword-feedback.js');
    expect(mod).toBeDefined();
  });
});
