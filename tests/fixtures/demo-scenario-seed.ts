import db from '../../server/db/index.js';
import {
  DEMO_WORKSPACE_SCENARIOS,
  getDemoScenarioById,
  type DemoScenario,
} from '../../shared/demo-workspace-scenarios.js';

const NOW = '2026-05-16T00:00:00.000Z';
const PASSWORD = 'demo-client';

function tokenFor(siteId: string | null): string | null {
  if (!siteId) return null;
  const suffix = siteId.replace(/^site_demo_/, '').replace(/_/g, '-');
  return `demo-webflow-token-${suffix}`;
}

export interface SeededDemoScenario {
  workspaceId: string;
  scenario: DemoScenario;
  cleanup: () => void;
}

export function seedDemoScenarioWorkspace(scenario: DemoScenario): SeededDemoScenario {
  const match = DEMO_WORKSPACE_SCENARIOS.find((item) => item.scenario === scenario);
  if (!match) throw new Error(`Unknown demo scenario: ${scenario}`);

  db.prepare(`
    INSERT OR REPLACE INTO workspaces (
      id, name, folder, webflow_site_id, webflow_site_name, webflow_token,
      gsc_property_url, ga4_property_id, client_password, live_domain,
      tier, seo_data_provider, client_portal_enabled, seo_client_view,
      analytics_client_view, site_intelligence_client_view, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?)
  `).run(
    match.id,
    match.name,
    match.folder,
    match.integrations.webflowSiteId,
    match.integrations.webflowSiteName,
    tokenFor(match.integrations.webflowSiteId),
    match.integrations.gscPropertyUrl,
    match.integrations.ga4PropertyId,
    PASSWORD,
    match.domain,
    match.tier,
    match.integrations.seoDataProvider,
    NOW,
  );

  return {
    workspaceId: match.id,
    scenario: match.scenario,
    cleanup: () => {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(match.id);
    },
  };
}

export function getDemoScenarioWorkspaceById(workspaceId: string) {
  return getDemoScenarioById(workspaceId);
}
