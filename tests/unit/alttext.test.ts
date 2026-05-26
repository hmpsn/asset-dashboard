import { describe, expect, it } from 'vitest';

describe('alttext module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/alttext.js');
    expect(mod).toBeDefined();
  });
});
