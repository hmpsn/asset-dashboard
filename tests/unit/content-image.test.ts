import { describe, expect, it } from 'vitest';

describe('content-image module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/content-image.js');
    expect(mod).toBeDefined();
  });
});
