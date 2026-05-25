import { describe, expect, it } from 'vitest';

describe('webflow-assets module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/webflow-assets.js');
    expect(mod).toBeDefined();
  });
});
