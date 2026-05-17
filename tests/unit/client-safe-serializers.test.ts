import { describe, expect, it } from 'vitest';

import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { ClientAction } from '../../shared/types/client-actions.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';
import type { SchemaSnapshot } from '../../server/schema-store.js';
import type { Workspace } from '../../shared/types/workspace.js';
import {
  toAdminSchemaSnapshotView,
  toAdminSchemaView,
  toClientInboxApprovalBatch,
  toClientInboxItem,
  toClientSchemaSnapshotView,
  toClientSchemaView,
  toPublicWorkspaceView,
} from '../../server/serializers/client-safe.js';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_serializer',
    name: 'Serializer Workspace',
    folder: 'serializer-workspace',
    createdAt: '2026-05-14T00:00:00.000Z',
    tier: 'free',
    trialEndsAt: '2026-05-20T00:00:00.000Z',
    clientPortalEnabled: true,
    ...overrides,
  };
}

function makeSchemaSuggestion(overrides: Partial<SchemaPageSuggestion> = {}): SchemaPageSuggestion {
  return {
    pageId: 'page-home',
    pageTitle: 'Home',
    slug: '/',
    url: 'https://example.test',
    existingSchemas: ['Organization'],
    suggestedSchemas: [{
      type: 'Article',
      reason: 'Fixture',
      priority: 'high',
      template: {
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'Article', markerSecret: 'schema-template-secret-token' }],
      },
    }],
    ...overrides,
  };
}

describe('client-safe serializers', () => {
  it('builds public workspace view with tier/trial fields and no admin secrets', () => {
    const ws = makeWorkspace({
      webflowToken: 'wf-secret-token',
      clientPassword: 'hashed-password',
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
      webflowSiteId: 'site_123',
      webflowSiteName: 'Site 123',
      gscPropertyUrl: 'https://gsc.test',
      ga4PropertyId: 'properties/123',
      liveDomain: 'example.test',
      contentPricing: { briefPrice: 100, fullPostPrice: 300, currency: 'USD' },
      eventConfig: [{ eventName: 'lead' }],
      eventGroups: [{ id: 'growth' }],
    });

    const view = toPublicWorkspaceView(ws, {
      stripeEnabled: true,
      hasClientUsers: true,
      bookingUrl: 'https://hmpsn.studio/book',
      nowMs: new Date('2026-05-14T00:00:00.000Z').getTime(),
    });

    expect(view).toMatchObject({
      id: 'ws_serializer',
      name: 'Serializer Workspace',
      requiresPassword: true,
      stripeEnabled: true,
      hasClientUsers: true,
      tier: 'growth',
      baseTier: 'free',
      isTrial: true,
      trialDaysRemaining: 6,
      bookingUrl: 'https://hmpsn.studio/book',
    });
    expect('webflowToken' in (view as Record<string, unknown>)).toBe(false);
    expect('clientPassword' in (view as Record<string, unknown>)).toBe(false);
    expect('stripeCustomerId' in (view as Record<string, unknown>)).toBe(false);
    expect('stripeSubscriptionId' in (view as Record<string, unknown>)).toBe(false);
  });

  it('serializes client inbox actions and approval batches with stable fields', () => {
    const action: ClientAction = {
      id: 'ca_1',
      workspaceId: 'ws_serializer',
      sourceType: 'content_decay',
      sourceId: 'src_1',
      title: 'Refresh page',
      summary: 'Traffic dropped',
      payload: { targetKeyword: 'keyword' },
      status: 'pending',
      priority: 'high',
      clientNote: 'Looks good',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    const batch: ApprovalBatch = {
      id: 'ab_1',
      workspaceId: 'ws_serializer',
      siteId: 'site_123',
      name: 'SEO Changes',
      status: 'pending',
      items: [{
        id: 'ai_1',
        pageId: 'page-home',
        pageTitle: 'Home',
        pageSlug: '/',
        field: 'seoTitle',
        currentValue: 'Old',
        proposedValue: 'New',
        status: 'pending',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      }],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    expect(toClientInboxItem(action)).toEqual(action);
    expect(toClientInboxApprovalBatch(batch)).toEqual(batch);
  });

  it('serializes schema snapshot views for admin and client contracts', () => {
    const snapshot: SchemaSnapshot = {
      id: 'schema_snapshot_1',
      siteId: 'site_123',
      workspaceId: 'ws_serializer',
      createdAt: '2026-05-14T00:00:00.000Z',
      pageCount: 1,
      results: [makeSchemaSuggestion()],
    };

    const clientView = toClientSchemaSnapshotView(snapshot);
    expect(clientView).toMatchObject({
      pageCount: 1,
      pages: [{
        pageId: 'page-home',
        pageTitle: 'Home',
        slug: '/',
        url: 'https://example.test',
        existingSchemas: ['Organization'],
        schemaTypes: ['Article'],
        priority: 'high',
      }],
    });
    expect(JSON.stringify(clientView)).not.toContain('schema-template-secret-token');

    const adminView = toAdminSchemaSnapshotView(snapshot, { 'page-home': '2026-05-15T00:00:00.000Z' });
    expect(adminView.results[0]?.lastPublishedAt).toBe('2026-05-15T00:00:00.000Z');
    expect(JSON.stringify(adminView)).toContain('schema-template-secret-token');
  });

  it('serializes schema plans consistently for client and admin reads', () => {
    const plan: SchemaSitePlan = {
      id: 'schema_plan_1',
      siteId: 'site_123',
      workspaceId: 'ws_serializer',
      siteUrl: 'https://example.test',
      canonicalEntities: [{
        type: 'Organization',
        name: 'Example',
        canonicalUrl: 'https://example.test',
        id: 'https://example.test/#organization',
      }],
      pageRoles: [{
        pagePath: '/',
        pageTitle: 'Home',
        role: 'homepage',
        primaryType: 'WebPage',
        entityRefs: ['https://example.test/#organization'],
      }],
      status: 'sent_to_client',
      generatedAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };

    expect(toClientSchemaView(plan)).toEqual(plan);
    expect(toAdminSchemaView(plan)).toEqual(plan);
  });
});
