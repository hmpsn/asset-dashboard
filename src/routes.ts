export type Page =
  | 'home'
  | 'media'
  | 'seo-audit' | 'seo-editor'
  | 'links'
  | 'seo-strategy' | 'seo-keywords' | 'page-intelligence' | 'local-seo' | 'seo-schema' | 'seo-briefs' | 'competitors'
  | 'content' | 'calendar' | 'brand' | 'subscriptions' | 'content-pipeline'
  | 'analytics-hub'
  | 'ai-visibility'
  | 'performance'
  | 'content-perf'
  | 'rewrite'
  | 'workspace-settings'
  | 'prospect'
  | 'roadmap'
  | 'ai-usage'
  | 'requests'
  | 'settings'
  | 'revenue'
  | 'features'
  | 'outcomes'
  | 'outcomes-overview'
  | 'diagnostics';

export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'plans' | 'roi' | 'content-plan' | 'brand' | 'deep-dive' | 'results' | 'settings';
export type ClientInboxFilter = 'decisions' | 'reviews' | 'conversations';
export type ClientInboxRouteAlias = 'approvals' | 'requests' | 'content' | 'schema-review';

const CLIENT_INBOX_ROUTE_ALIASES: Record<ClientInboxRouteAlias, ClientInboxFilter> = {
  approvals: 'decisions',
  requests: 'conversations',
  content: 'reviews',
  'schema-review': 'reviews',
};

/** Global tabs that don't belong to a specific workspace */
export const GLOBAL_TABS = new Set<string>(['settings', 'roadmap', 'prospect', 'ai-usage', 'revenue', 'features', 'outcomes-overview']);

/** Build an admin dashboard path */
export function adminPath(workspaceId: string, tab: Page = 'home'): string {
  if (GLOBAL_TABS.has(tab)) return `/${tab}`;
  if (tab === 'home') return `/ws/${workspaceId}`;
  return `/ws/${workspaceId}/${tab}`;
}

/** Build a client dashboard path */
export function clientPath(workspaceId: string, tab?: string, betaMode?: boolean): string {
  const prefix = betaMode ? '/client/beta' : '/client';
  if (!tab || tab === 'overview') return `${prefix}/${workspaceId}`;
  const inboxFilter = resolveClientInboxRouteAlias(tab);
  if (inboxFilter) return `${prefix}/${workspaceId}/inbox?tab=${inboxFilter}`;
  return `${prefix}/${workspaceId}/${tab}`;
}

export function resolveClientInboxRouteAlias(tab: string | undefined | null): ClientInboxFilter | null {
  if (!tab) return null;
  return CLIENT_INBOX_ROUTE_ALIASES[tab as ClientInboxRouteAlias] ?? null;
}
