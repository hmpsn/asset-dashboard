import { describe, expect, it } from 'vitest';

describe('image-fetch module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/image-fetch.js');
    expect(mod).toBeDefined();
  });
});
