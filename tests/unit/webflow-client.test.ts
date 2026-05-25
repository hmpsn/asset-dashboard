import { describe, expect, it } from 'vitest';

describe('webflow-client module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/webflow-client.js');
    expect(mod).toBeDefined();
  });
});
