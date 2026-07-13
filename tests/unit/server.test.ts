import { describe, expect, it } from 'vitest';

describe('server module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/mcp/server.js');
    expect(mod).toBeDefined();
  }, 30_000);
});
