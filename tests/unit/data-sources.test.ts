import { describe, expect, it } from 'vitest';

describe('data-sources module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/data-sources.js');
    expect(mod).toBeDefined();
  });
});
