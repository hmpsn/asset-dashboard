import { describe, expect, it } from 'vitest';

describe('search-console module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/search-console.js');
    expect(mod).toBeDefined();
  });
});
