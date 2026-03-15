export type Page =
  | 'home'
  | 'media'
  | 'seo-audit' | 'seo-editor'
  | 'links'
  | 'seo-strategy' | 'seo-schema' | 'seo-briefs' | 'seo-ranks'
  | 'content' | 'calendar' | 'brand' | 'subscriptions'
  | 'search' | 'analytics' | 'annotations'
  | 'performance'
  | 'content-perf'
  | 'workspace-settings'
  | 'prospect'
  | 'roadmap'
  | 'ai-usage'
  | 'requests'
  | 'settings'
  | 'revenue';

export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi';

/** Global tabs that don't belong to a specific workspace */
const GLOBAL_TABS = new Set<string>(['settings', 'roadmap', 'prospect', 'ai-usage', 'revenue']);

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
  return `${prefix}/${workspaceId}/${tab}`;
}
