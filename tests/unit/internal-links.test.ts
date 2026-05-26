import { describe, expect, it } from 'vitest';

describe('internal-links module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/internal-links.js');
    expect(mod).toBeDefined();
  });
});
