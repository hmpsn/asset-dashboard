import { describe, expect, it } from 'vitest';

describe('rich-roles module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/rich-roles.js');
    expect(mod).toBeDefined();
  });
});
