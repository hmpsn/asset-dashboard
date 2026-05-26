import { describe, expect, it } from 'vitest';

describe('howto-ai-fallback module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/extractors/page-elements/howto-ai-fallback.js');
    expect(mod).toBeDefined();
  });
});
