import { describe, expect, it } from 'vitest';

describe('trial-reminders module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/trial-reminders.js');
    expect(mod).toBeDefined();
  });
});
