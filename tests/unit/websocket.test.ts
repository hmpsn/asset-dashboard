import { describe, expect, it } from 'vitest';

describe('websocket module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/websocket.js');
    expect(mod).toBeDefined();
  });
});
