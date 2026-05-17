import { afterEach, describe, expect, it } from 'vitest';
import { assertDemoSeedEnvironmentSafe, DEMO_WORKSPACES } from '../../scripts/seed-demo-workspaces.ts';

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

  it('defines deterministic scenario coverage for QA/demo workspaces', () => {
    const ids = DEMO_WORKSPACES.map(workspace => workspace.id);
    const scenarios = DEMO_WORKSPACES.map(workspace => workspace.scenario);
    const uniqueIds = new Set(ids);
    const uniqueScenarios = new Set(scenarios);

    expect(DEMO_WORKSPACES).toHaveLength(6);
    expect(uniqueIds.size).toBe(ids.length);
    expect(uniqueScenarios).toEqual(new Set([
      'empty-new',
      'free-client',
      'growth-active',
      'premium-history',
      'broken-integrations',
      'rich-cms',
    ]));
  });

  it('keeps broken-integration fixture deterministic and intentionally disconnected', () => {
    const broken = DEMO_WORKSPACES.find(workspace => workspace.scenario === 'broken-integrations');
    expect(broken).toBeDefined();
    expect(broken?.webflowSiteId).toBeNull();
    expect(broken?.webflowToken).toBeNull();
    expect(broken?.gscPropertyUrl).toBeNull();
    expect(broken?.ga4PropertyId).toBeNull();
    expect(broken?.seoDataProvider).toBe('semrush');
  });
});
