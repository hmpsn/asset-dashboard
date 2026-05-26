import { describe, expect, it } from 'vitest';

describe('internal-links-schemas module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schemas/internal-links-schemas.js');
    expect(mod).toBeDefined();
  });
});
