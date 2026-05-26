import { describe, expect, it } from 'vitest';

describe('content-gaps module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/content-gaps.js');
    expect(mod).toBeDefined();
  });
});
