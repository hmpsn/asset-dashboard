import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStripeSecretKey: vi.fn(),
  updateWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: mocks.getStripeSecretKey,
  getStripeWebhookSecret: vi.fn(() => ''),
  getStripePriceId: vi.fn((_type: string, _envKey: string) => 'price_test_123'),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
  updateWorkspace: mocks.updateWorkspace,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('stripe clearTestModeCustomerIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.getWorkspace.mockReturnValue(null);
  });

  it('does not clear customer ids on live-key startup', async () => {
    mocks.getStripeSecretKey.mockReturnValue('sk_live_abc123');

    const { clearTestModeCustomerIds } = await import('../../server/stripe.js');
    const cleared = clearTestModeCustomerIds();

    expect(cleared).toBe(0);
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  });

  it('returns 0 when stripe key is missing or non-live', async () => {
    mocks.getStripeSecretKey.mockReturnValue(undefined);
    let mod = await import('../../server/stripe.js');
    expect(mod.clearTestModeCustomerIds()).toBe(0);

    vi.resetModules();
    mocks.getStripeSecretKey.mockReturnValue('sk_test_abc123');
    mod = await import('../../server/stripe.js');
    expect(mod.clearTestModeCustomerIds()).toBe(0);
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  });
});
