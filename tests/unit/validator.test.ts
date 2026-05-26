import { describe, expect, it } from 'vitest';

describe('validator module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/validator.js');
    expect(mod).toBeDefined();
  });
});
