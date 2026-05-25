import { describe, expect, it } from 'vitest';
import { DEMO_WORKSPACES } from '../../scripts/seed-demo-workspaces.js';
import { DEMO_WORKSPACE_SCENARIOS } from '../../shared/demo-workspace-scenarios.js';
import { getDemoScenarioWorkspaceById } from '../fixtures/demo-scenario-seed';

describe('demo scenario parity', () => {
  it('keeps demo seed script aligned with shared scenario definitions', () => {
    expect(DEMO_WORKSPACES).toHaveLength(DEMO_WORKSPACE_SCENARIOS.length);
    for (const scenario of DEMO_WORKSPACE_SCENARIOS) {
      const seeded = DEMO_WORKSPACES.find(item => item.id === scenario.id);
      expect(seeded).toBeDefined();
      expect(seeded?.scenario).toBe(scenario.scenario);
      expect(seeded?.tier).toBe(scenario.tier);
      expect(seeded?.webflowSiteId).toBe(scenario.integrations.webflowSiteId);
      expect(seeded?.gscPropertyUrl).toBe(scenario.integrations.gscPropertyUrl);
      expect(seeded?.ga4PropertyId).toBe(scenario.integrations.ga4PropertyId);
    }
  });

  it('fixture helper resolves the same canonical scenario metadata', () => {
    const scenario = getDemoScenarioWorkspaceById('ws_demo_growth');
    expect(scenario?.scenario).toBe('growth-active');
    expect(scenario?.integrations.webflowSiteId).toBe('site_demo_growth');
  });
});
