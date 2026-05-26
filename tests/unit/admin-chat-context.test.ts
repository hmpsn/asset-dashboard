import { describe, expect, it } from 'vitest';

describe('admin-chat-context module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/admin-chat-context.js');
    expect(mod).toBeDefined();
  });
});
