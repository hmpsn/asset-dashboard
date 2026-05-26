import { describe, expect, it } from 'vitest';

describe('authority-context module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/authority-context.js');
    expect(mod).toBeDefined();
  });
});
