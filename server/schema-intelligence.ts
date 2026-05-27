import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { listWorkspaces } from './workspaces.js';
import { resolveBaseUrl } from './url-helpers.js';
import type {
  IntelligenceSlice,
  SeoContextSlice,
  WorkspaceIntelligence,
} from '../shared/types/intelligence.js';
import type { SiteInventorySlice } from '../shared/types/site-inventory.js';
import type { PageElementCatalog } from '../shared/types/page-elements.js';
import type { EntityResolutionSlice } from '../shared/types/entity-resolution.js';

type SchemaWorkspace = ReturnType<typeof listWorkspaces>[number];

export interface SchemaIntelligenceOptions {
  siteId: string;
  siteBaseUrl?: string | null;
  pagePath?: string;
  tokenOverride?: string;
  includeSiteInventory?: boolean;
  includePageElements?: boolean;
  includeBacklinks?: boolean;
  includeEntityResolution?: boolean;
}

export interface SchemaIntelligenceResult {
  workspace: SchemaWorkspace | undefined;
  workspaceId: string | undefined;
  baseUrl: string | undefined;
  intelligence: WorkspaceIntelligence | null;
  seoContext: SeoContextSlice | undefined;
  siteInventory: SiteInventorySlice | undefined;
  pageKeywords: { primary: string; secondary: string[] } | undefined;
  pageElements: PageElementCatalog | undefined;
  entityResolution: EntityResolutionSlice | undefined;
}

function pageKeywordsFromSeoContext(
  seoContext: SeoContextSlice | undefined,
): { primary: string; secondary: string[] } | undefined {
  if (!seoContext?.pageKeywords) return undefined;
  return {
    primary: seoContext.pageKeywords.primaryKeyword || '',
    secondary: seoContext.pageKeywords.secondaryKeywords || [],
  };
}

export async function buildSchemaIntelligence(
  opts: SchemaIntelligenceOptions,
): Promise<SchemaIntelligenceResult> {
  const workspace = listWorkspaces().find(w => w.webflowSiteId === opts.siteId);
  const token = opts.tokenOverride ?? workspace?.webflowToken ?? undefined;
  const resolvedBaseUrl = opts.siteBaseUrl
    ?? await resolveBaseUrl({ liveDomain: workspace?.liveDomain, webflowSiteId: opts.siteId }, token);
  const baseUrl = resolvedBaseUrl?.replace(/\/+$/, '') || undefined;

  if (!workspace) {
    return {
      workspace,
      workspaceId: undefined,
      baseUrl,
      intelligence: null,
      seoContext: undefined,
      siteInventory: undefined,
      pageKeywords: undefined,
      pageElements: undefined,
      entityResolution: undefined,
    };
  }

  const slices: IntelligenceSlice[] = ['seoContext'];
  if (opts.includeSiteInventory && baseUrl) slices.push('siteInventory');
  if (opts.includePageElements && opts.pagePath) slices.push('pageElements');
  if (opts.includeEntityResolution) slices.push('entityResolution');

  const intelligence = await buildWorkspaceIntelligence(workspace.id, {
    slices,
    pagePath: opts.pagePath,
    siteId: opts.siteId,
    siteBaseUrl: baseUrl,
    webflowToken: token,
    enrichWithBacklinks: opts.includeBacklinks,
    resolveEntityReferences: opts.includeEntityResolution,
  });

  return {
    workspace,
    workspaceId: workspace.id,
    baseUrl,
    intelligence,
    seoContext: intelligence.seoContext,
    siteInventory: intelligence.siteInventory,
    pageKeywords: pageKeywordsFromSeoContext(intelligence.seoContext),
    pageElements: intelligence.pageElements?.catalog,
    entityResolution: intelligence.entityResolution,
  };
}
