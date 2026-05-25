import { describe, expect, it } from 'vitest';

describe('image-ai-classifier module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/image-ai-classifier.js');
    expect(mod).toBeDefined();
  });
});
