import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals.js';
import type { ClientAction } from '../../shared/types/client-actions.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';
import type { SchemaPageSuggestion } from '../schema-suggester.js';
import type { SchemaSnapshot } from '../schema-store.js';
import type { Workspace } from '../workspaces.js';
import { computeEffectiveTier } from '../workspaces.js';

export interface PublicWorkspaceView {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  liveDomain?: string;
  eventConfig: unknown[];
  eventGroups: unknown[];
  requiresPassword: boolean;
  clientPortalEnabled: boolean;
  seoClientView: boolean;
  analyticsClientView: boolean;
  siteIntelligenceClientView: boolean;
  businessProfile: unknown;
  autoReports: boolean;
  brandLogoUrl: string;
  brandAccentColor: string;
  contentPricing: unknown;
  tier: string;
  baseTier: string;
  isTrial: boolean;
  trialDaysRemaining: number;
  trialEndsAt: string | null;
  stripeEnabled: boolean;
  billingMode: string;
  onboardingEnabled: boolean;
  onboardingCompleted: boolean;
  hasClientUsers: boolean;
  bookingUrl: string | null;
}

export function toPublicWorkspaceView(
  ws: Workspace,
  opts: {
    stripeEnabled: boolean;
    hasClientUsers: boolean;
    bookingUrl: string | null;
    nowMs?: number;
  },
): PublicWorkspaceView {
  const effectiveTier = computeEffectiveTier(ws);
  const nowMs = opts.nowMs ?? Date.now();
  return {
    id: ws.id,
    name: ws.name,
    webflowSiteId: ws.webflowSiteId,
    webflowSiteName: ws.webflowSiteName,
    gscPropertyUrl: ws.gscPropertyUrl,
    ga4PropertyId: ws.ga4PropertyId,
    liveDomain: ws.liveDomain,
    eventConfig: ws.eventConfig || [],
    eventGroups: ws.eventGroups || [],
    requiresPassword: !!ws.clientPassword,
    clientPortalEnabled: ws.clientPortalEnabled != null ? !!ws.clientPortalEnabled : true,
    seoClientView: !!ws.seoClientView,
    analyticsClientView: ws.analyticsClientView != null ? !!ws.analyticsClientView : true,
    siteIntelligenceClientView: ws.siteIntelligenceClientView != null ? !!ws.siteIntelligenceClientView : true,
    businessProfile: ws.businessProfile || null,
    autoReports: !!ws.autoReports,
    brandLogoUrl: ws.brandLogoUrl || '',
    brandAccentColor: ws.brandAccentColor || '',
    contentPricing: ws.contentPricing || null,
    tier: effectiveTier,
    baseTier: ws.tier || 'free',
    isTrial: effectiveTier === 'growth' && (ws.tier || 'free') === 'free',
    trialDaysRemaining: ws.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(ws.trialEndsAt).getTime() - nowMs) / (1000 * 60 * 60 * 24)))
      : 0,
    trialEndsAt: ws.trialEndsAt || null,
    stripeEnabled: opts.stripeEnabled,
    billingMode: ws.billingMode || 'platform',
    onboardingEnabled: ws.onboardingEnabled ?? false,
    onboardingCompleted: ws.onboardingCompleted ?? false,
    hasClientUsers: opts.hasClientUsers,
    bookingUrl: opts.bookingUrl ?? null,
  };
}

function toClientInboxApprovalItem(item: ApprovalItem): ApprovalItem {
  return {
    id: item.id,
    pageId: item.pageId,
    pageSlug: item.pageSlug,
    publishedPath: item.publishedPath,
    pageTitle: item.pageTitle,
    field: item.field,
    currentValue: item.currentValue,
    proposedValue: item.proposedValue,
    status: item.status,
    clientValue: item.clientValue,
    clientNote: item.clientNote,
    collectionId: item.collectionId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toClientInboxApprovalBatch(batch: ApprovalBatch): ApprovalBatch {
  return {
    id: batch.id,
    workspaceId: batch.workspaceId,
    siteId: batch.siteId,
    name: batch.name,
    status: batch.status,
    note: batch.note,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    items: batch.items.map(toClientInboxApprovalItem),
  };
}

export function toClientInboxApprovalBatches(batches: ApprovalBatch[]): ApprovalBatch[] {
  return batches.map(toClientInboxApprovalBatch);
}

export function toClientInboxItem(action: ClientAction): ClientAction {
  return {
    id: action.id,
    workspaceId: action.workspaceId,
    sourceType: action.sourceType,
    sourceId: action.sourceId,
    title: action.title,
    summary: action.summary,
    payload: action.payload,
    status: action.status,
    priority: action.priority,
    clientNote: action.clientNote,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

export function toClientInboxItems(actions: ClientAction[]): ClientAction[] {
  return actions.map(toClientInboxItem);
}

export interface AdminSchemaPageSuggestionView extends SchemaPageSuggestion {
  lastPublishedAt: string | null;
}

export interface AdminSchemaSnapshotView {
  id: string;
  siteId: string;
  workspaceId: string;
  createdAt: string;
  pageCount: number;
  results: AdminSchemaPageSuggestionView[];
}

function toAdminSchemaPageSuggestionView(
  result: SchemaPageSuggestion,
  publishDate: string | null,
): AdminSchemaPageSuggestionView {
  return {
    pageId: result.pageId,
    pageTitle: result.pageTitle,
    slug: result.slug,
    publishedPath: result.publishedPath,
    url: result.url,
    existingSchemas: result.existingSchemas || [],
    existingSchemaJson: result.existingSchemaJson,
    suggestedSchemas: (result.suggestedSchemas || []).map((suggestion) => ({
      type: suggestion.type,
      reason: suggestion.reason,
      priority: suggestion.priority,
      template: suggestion.template,
    })),
    validationErrors: result.validationErrors,
    validationFindings: result.validationFindings,
    richResultsEligibility: result.richResultsEligibility,
    generationDiagnostics: result.generationDiagnostics,
    collectionIdentity: result.collectionIdentity,
    cmsDeliveryStatus: result.cmsDeliveryStatus,
    savedPageType: result.savedPageType,
    lastPublishedAt: publishDate,
  };
}

export function toAdminSchemaSnapshotView(
  snapshot: SchemaSnapshot,
  publishDates: Record<string, string>,
): AdminSchemaSnapshotView {
  return {
    id: snapshot.id,
    siteId: snapshot.siteId,
    workspaceId: snapshot.workspaceId,
    createdAt: snapshot.createdAt,
    pageCount: snapshot.pageCount,
    results: snapshot.results.map((result) =>
      toAdminSchemaPageSuggestionView(result, publishDates[result.pageId] || null),
    ),
  };
}

export interface ClientSchemaSnapshotPageView {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  schemaTypes: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface ClientSchemaSnapshotView {
  pages: ClientSchemaSnapshotPageView[];
  pageCount: number;
  createdAt: string;
}

export function toClientSchemaSnapshotView(snapshot: SchemaSnapshot): ClientSchemaSnapshotView {
  return {
    pages: snapshot.results.map((result) => ({
      pageId: result.pageId,
      pageTitle: result.pageTitle,
      slug: result.slug,
      url: result.url,
      existingSchemas: result.existingSchemas || [],
      schemaTypes: (result.suggestedSchemas?.[0]?.template?.['@graph'] as Array<{ '@type'?: string }> || [])
        .map((node) => node['@type'])
        .filter((t): t is string => typeof t === 'string' && t.length > 0),
      priority: result.suggestedSchemas?.[0]?.priority || 'medium',
    })),
    pageCount: snapshot.pageCount,
    createdAt: snapshot.createdAt,
  };
}

export function toClientSchemaView(plan: SchemaSitePlan): SchemaSitePlan {
  return {
    id: plan.id,
    siteId: plan.siteId,
    workspaceId: plan.workspaceId,
    siteUrl: plan.siteUrl,
    canonicalEntities: plan.canonicalEntities.map((entity) => ({
      type: entity.type,
      name: entity.name,
      canonicalUrl: entity.canonicalUrl,
      id: entity.id,
      description: entity.description,
    })),
    pageRoles: plan.pageRoles.map((role) => ({
      pagePath: role.pagePath,
      pageTitle: role.pageTitle,
      role: role.role,
      primaryType: role.primaryType,
      entityRefs: [...role.entityRefs],
      notes: role.notes,
      industrySubtype: role.industrySubtype,
    })),
    status: plan.status,
    clientPreviewBatchId: plan.clientPreviewBatchId,
    generatedAt: plan.generatedAt,
    updatedAt: plan.updatedAt,
  };
}

export function toAdminSchemaView(plan: SchemaSitePlan): SchemaSitePlan {
  return toClientSchemaView(plan);
}
