import { describe, expect, it } from 'vitest';

describe('testimonials module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/testimonials.js');
    expect(mod).toBeDefined();
  });
});
