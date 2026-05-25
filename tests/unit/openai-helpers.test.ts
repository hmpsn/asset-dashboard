import { describe, expect, it } from 'vitest';

describe('openai-helpers module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/openai-helpers.js');
    expect(mod).toBeDefined();
  });
});
