export type DemoScenario =
  | 'empty-new'
  | 'free-client'
  | 'growth-active'
  | 'premium-history'
  | 'broken-integrations'
  | 'rich-cms';

export interface DemoWorkspaceScenario {
  id: string;
  name: string;
  folder: string;
  tier: 'free' | 'growth' | 'premium';
  scenario: DemoScenario;
  domain: string;
  integrations: {
    webflowSiteId: string | null;
    webflowSiteName: string | null;
    gscPropertyUrl: string | null;
    ga4PropertyId: string | null;
    seoDataProvider: 'dataforseo' | 'semrush';
  };
}

export const DEMO_WORKSPACE_SCENARIOS: DemoWorkspaceScenario[] = [
  {
    id: 'ws_demo_empty',
    name: 'Demo Empty Workspace',
    folder: 'demo-empty-workspace',
    tier: 'free',
    scenario: 'empty-new',
    domain: 'empty-demo.local',
    integrations: {
      webflowSiteId: 'site_demo_empty',
      webflowSiteName: 'Demo Empty Site',
      gscPropertyUrl: 'sc-domain:empty-demo.local',
      ga4PropertyId: 'properties/100000',
      seoDataProvider: 'dataforseo',
    },
  },
  {
    id: 'ws_demo_free',
    name: 'Demo Free Client Workspace',
    folder: 'demo-free-workspace',
    tier: 'free',
    scenario: 'free-client',
    domain: 'free-demo.local',
    integrations: {
      webflowSiteId: 'site_demo_free',
      webflowSiteName: 'Demo Free Site',
      gscPropertyUrl: 'sc-domain:free-demo.local',
      ga4PropertyId: 'properties/100003',
      seoDataProvider: 'dataforseo',
    },
  },
  {
    id: 'ws_demo_growth',
    name: 'Demo Growth Active Workspace',
    folder: 'demo-growth-workspace',
    tier: 'growth',
    scenario: 'growth-active',
    domain: 'growth-demo.local',
    integrations: {
      webflowSiteId: 'site_demo_growth',
      webflowSiteName: 'Demo Growth Site',
      gscPropertyUrl: 'sc-domain:growth-demo.local',
      ga4PropertyId: 'properties/100001',
      seoDataProvider: 'dataforseo',
    },
  },
  {
    id: 'ws_demo_premium',
    name: 'Demo Premium History Workspace',
    folder: 'demo-premium-workspace',
    tier: 'premium',
    scenario: 'premium-history',
    domain: 'premium-demo.local',
    integrations: {
      webflowSiteId: 'site_demo_premium',
      webflowSiteName: 'Demo Premium Site',
      gscPropertyUrl: 'sc-domain:premium-demo.local',
      ga4PropertyId: 'properties/100002',
      seoDataProvider: 'dataforseo',
    },
  },
  {
    id: 'ws_demo_broken_integrations',
    name: 'Demo Broken Integrations Workspace',
    folder: 'demo-broken-integrations-workspace',
    tier: 'growth',
    scenario: 'broken-integrations',
    domain: 'broken-demo.local',
    integrations: {
      webflowSiteId: null,
      webflowSiteName: null,
      gscPropertyUrl: null,
      ga4PropertyId: null,
      seoDataProvider: 'semrush',
    },
  },
  {
    id: 'ws_demo_rich_cms',
    name: 'Demo Rich CMS Workspace',
    folder: 'demo-rich-cms-workspace',
    tier: 'premium',
    scenario: 'rich-cms',
    domain: 'cms-demo.local',
    integrations: {
      webflowSiteId: 'site_demo_rich_cms',
      webflowSiteName: 'Demo Rich CMS Site',
      gscPropertyUrl: 'sc-domain:cms-demo.local',
      ga4PropertyId: 'properties/100004',
      seoDataProvider: 'dataforseo',
    },
  },
];

export function getDemoScenarioById(id: string): DemoWorkspaceScenario | undefined {
  return DEMO_WORKSPACE_SCENARIOS.find((scenario) => scenario.id === id);
}
