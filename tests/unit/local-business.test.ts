import { describe, expect, it } from 'vitest';

describe('local-business module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/local-business.js');
    expect(mod).toBeDefined();
  });
});
