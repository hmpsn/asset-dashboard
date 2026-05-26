import { describe, expect, it } from 'vitest';

describe('tables module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/tables.js');
    expect(mod).toBeDefined();
  });
});
