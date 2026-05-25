import { describe, expect, it } from 'vitest';

describe('schema-suggester module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema-suggester.js');
    expect(mod).toBeDefined();
  });
});
