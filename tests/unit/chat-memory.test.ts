import { describe, expect, it } from 'vitest';

describe('chat-memory module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/chat-memory.js');
    expect(mod).toBeDefined();
  });
});
