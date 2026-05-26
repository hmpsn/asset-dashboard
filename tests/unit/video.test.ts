import { describe, expect, it } from 'vitest';

describe('video module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/video.js');
    expect(mod).toBeDefined();
  });
});
