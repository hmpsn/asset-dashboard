import { describe, expect, it } from 'vitest';

describe('whole-site-graph-validator module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/whole-site-graph-validator.js');
    expect(mod).toBeDefined();
  });
});
