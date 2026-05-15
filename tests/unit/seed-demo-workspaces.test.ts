import { afterEach, describe, expect, it } from 'vitest';
import { assertDemoSeedEnvironmentSafe } from '../../scripts/seed-demo-workspaces.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_OVERRIDE = process.env.ALLOW_NON_LOCAL_DEMO_SEED;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.ALLOW_NON_LOCAL_DEMO_SEED = ORIGINAL_OVERRIDE;
});

describe('seed demo workspaces safety', () => {
  it('throws in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('blocked in production');
  });

  it('allows local development by default', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });

  it('requires explicit override in non-local environments', () => {
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('restricted to local/test');

    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });
});
