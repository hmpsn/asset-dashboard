import { describe, expect, it } from 'vitest';

describe('clients module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/mcp/tools/clients.js');
    expect(mod).toBeDefined();
  });
});
