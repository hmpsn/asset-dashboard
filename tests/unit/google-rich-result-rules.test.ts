import { describe, expect, it } from 'vitest';

describe('google-rich-result-rules module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/google-rich-result-rules.js');
    expect(mod).toBeDefined();
  });
});
