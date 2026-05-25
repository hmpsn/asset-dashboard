import { describe, expect, it } from 'vitest';

describe('page-keywords module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/page-keywords.js');
    expect(mod).toBeDefined();
  });
});
