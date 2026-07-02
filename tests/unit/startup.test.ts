import { describe, expect, it, vi } from 'vitest';

// startup.ts delegates all recurring-scheduler start calls to the cron
// registry's single execution surface (server/cron-registry.ts,
// startAllRegisteredCrons) instead of hand-listing 19+ scheduler imports.
// This test therefore only needs to mock the 3 modules startup.ts actually
// imports: email.js (initEmailQueue), stripe.js (clearTestModeCustomerIds),
// and cron-registry.js (startAllRegisteredCrons). Mocking cron-registry.js
// here is also what keeps this test from starting any real timers — the 19
// scheduler modules cron-registry.ts imports are never touched by this test
// at all, so there's no risk of a partially-mocked module list (the exact
// hazard the pre-registry version of this test had: 15 of 20 startX mocks).
const mocks = vi.hoisted(() => ({
  initEmailQueue: vi.fn(),
  clearTestModeCustomerIds: vi.fn(),
  startAllRegisteredCrons: vi.fn(),
}));

vi.mock('../../server/email.js', () => ({ initEmailQueue: mocks.initEmailQueue }));
vi.mock('../../server/stripe.js', () => ({ clearTestModeCustomerIds: mocks.clearTestModeCustomerIds }));
vi.mock('../../server/cron-registry.js', () => ({ startAllRegisteredCrons: mocks.startAllRegisteredCrons }));

describe('startup.startSchedulers', () => {
  it('starts all scheduler subsystems exactly once even if called twice', async () => {
    vi.resetModules();
    const { startSchedulers } = await import('../../server/startup.js');

    startSchedulers();
    startSchedulers();

    expect(mocks.initEmailQueue).toHaveBeenCalledTimes(1);
    expect(mocks.clearTestModeCustomerIds).toHaveBeenCalledTimes(1);
    expect(mocks.startAllRegisteredCrons).toHaveBeenCalledTimes(1);
  });
});
