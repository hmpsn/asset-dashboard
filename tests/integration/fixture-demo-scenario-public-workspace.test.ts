import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext } from './helpers.js';
import { seedDemoScenarioWorkspace, type SeededDemoScenario } from '../fixtures/demo-scenario-seed.js';
import { getDemoScenarioById } from '../../shared/demo-workspace-scenarios.js';

const ctx = createTestContext(13712, { autoPublicAuth: true });
const { api } = ctx;

const seeded: SeededDemoScenario[] = [];

function expectEmptyIntegrationField(
  body: Record<string, unknown>,
  field: 'webflowSiteId' | 'webflowSiteName' | 'gscPropertyUrl' | 'ga4PropertyId',
): void {
  expect(field in body ? body[field] : undefined).toSatisfy(
    (value: unknown) => value == null || value === '',
  );
}

beforeAll(async () => {
  await ctx.startServer();
  seeded.push(seedDemoScenarioWorkspace('growth-active'));
  seeded.push(seedDemoScenarioWorkspace('broken-integrations'));
}, 25_000);

afterAll(async () => {
  for (const workspace of seeded) {
    workspace.cleanup();
  }
  await ctx.stopServer();
});

describe('demo scenario fixture coverage — GET /api/public/workspace/:id', () => {
  it('returns 200 with scenario-consistent public fields for growth-active', async () => {
    const growth = seeded.find((item) => item.scenario === 'growth-active');
    expect(growth).toBeDefined();
    if (!growth) return;

    const scenario = getDemoScenarioById(growth.workspaceId);
    expect(scenario).toBeDefined();
    if (!scenario) return;

    const res = await api(`/api/public/workspace/${growth.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.id).toBe(scenario.id);
    expect(body.name).toBe(scenario.name);
    expect(body.tier).toBe(scenario.tier);
    expect(body.baseTier).toBe(scenario.tier);
    expect(body.liveDomain).toBe(scenario.domain);
    expect(body.requiresPassword).toBe(true);
    expect(body.clientPortalEnabled).toBe(true);

    expect(body.webflowSiteId).toBe(scenario.integrations.webflowSiteId);
    expect(body.webflowSiteName).toBe(scenario.integrations.webflowSiteName);
    expect(body.gscPropertyUrl).toBe(scenario.integrations.gscPropertyUrl);
    expect(body.ga4PropertyId).toBe(scenario.integrations.ga4PropertyId);

    expect(body.webflowToken).toBeUndefined();
  });

  it('returns 200 with broken integration fields null/empty for broken-integrations', async () => {
    const broken = seeded.find((item) => item.scenario === 'broken-integrations');
    expect(broken).toBeDefined();
    if (!broken) return;

    const scenario = getDemoScenarioById(broken.workspaceId);
    expect(scenario).toBeDefined();
    if (!scenario) return;

    const res = await api(`/api/public/workspace/${broken.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.id).toBe(scenario.id);
    expect(body.name).toBe(scenario.name);
    expect(body.tier).toBe(scenario.tier);
    expect(body.baseTier).toBe(scenario.tier);
    expect(body.liveDomain).toBe(scenario.domain);
    expect(body.requiresPassword).toBe(true);

    expectEmptyIntegrationField(body, 'webflowSiteId');
    expectEmptyIntegrationField(body, 'webflowSiteName');
    expectEmptyIntegrationField(body, 'gscPropertyUrl');
    expectEmptyIntegrationField(body, 'ga4PropertyId');

    expect(body.webflowToken).toBeUndefined();
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/workspace/ws_demo_scenario_missing');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});
