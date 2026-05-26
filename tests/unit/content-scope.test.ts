import { describe, expect, it } from 'vitest';

describe('content-scope module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/content-scope.js');
    expect(mod).toBeDefined();
  });
});
