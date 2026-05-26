import { describe, expect, it } from 'vitest';

describe('static module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/static.js');
    expect(mod).toBeDefined();
  });
});
