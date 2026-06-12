// tests/unit/schema-cms-delivery-ui.test.tsx
//
// W3.2 — CMS-field schema delivery UI fixes:
//   1. SchemaPageCard: CMS page with cmsDeliveryStatus.status === 'ready' shows Publish
//      and fires onConfirmPublish (not gated by blanket cms- check).
//   2. SchemaPageCard: CMS page without ready status shows an honest "not mapped" notice.
//   3. useSchemaSuggesterPublishingWorkflow: unpublishedCount + publishAllToWebflow
//      include CMS pages with ready status and exclude non-ready CMS pages.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { SchemaPageCard } from '../../src/components/schema/SchemaPageCard';
import { useSchemaSuggesterPublishingWorkflow } from '../../src/components/schema/useSchemaSuggesterPublishingWorkflow';
import type { SchemaPageSuggestion } from '../../src/components/schema/schemaSuggesterTypes';

vi.mock('../../src/api/client', () => ({
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  getSafe: vi.fn().mockResolvedValue({ history: [] }),
  getOptional: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/api/schema', () => ({
  schema: { retract: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: () => ({
    getState: vi.fn().mockReturnValue(undefined),
    refresh: vi.fn(),
    summary: { total: 0, draft: 0, live: 0 },
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCmsPage(overrides?: Partial<SchemaPageSuggestion>): SchemaPageSuggestion {
  return {
    pageId: 'cms-blog-example',
    pageTitle: 'Example Blog Post',
    slug: 'blog/example',
    url: 'https://example.com/blog/example',
    existingSchemas: [],
    suggestedSchemas: [{ type: 'WebPage', reason: 'r', priority: 'high', template: { '@type': 'WebPage' } }],
    ...overrides,
  };
}

function makeStaticPage(overrides?: Partial<SchemaPageSuggestion>): SchemaPageSuggestion {
  return {
    pageId: 'page-home',
    pageTitle: 'Home',
    slug: '/',
    url: 'https://example.com/',
    existingSchemas: [],
    suggestedSchemas: [{ type: 'WebPage', reason: 'r', priority: 'high', template: { '@type': 'WebPage' } }],
    ...overrides,
  };
}

const BASE_CARD_PROPS = {
  isOpen: true,
  isRegenLoading: false,
  editState: undefined,
  copiedId: null,
  published: false,
  publishing: false,
  publishError: undefined,
  manualDelivery: undefined,
  confirmPublish: false,
  sentPage: false,
  sendingPage: false,
  editingSchema: false,
  editedSchemaJson: undefined,
  schemaParseError: undefined,
  showDiff: false,
  schemaRecs: [],
  workspaceId: 'ws-1',
  pageType: 'blog',
  isHomepage: false,
  savingTemplate: false,
  templateSaved: false,
  retracting: false,
  retracted: false,
  siteId: 'site-1',
  onPageTypeChange: vi.fn(),
  onToggleExpand: vi.fn(),
  onRegenerate: vi.fn(),
  onToggleDiff: vi.fn(),
  onToggleSchemaEdit: vi.fn(),
  onSchemaJsonChange: vi.fn(),
  onCopyTemplate: vi.fn(),
  onCopyJsonLd: vi.fn(),
  onPublish: vi.fn(),
  onConfirmPublish: vi.fn(),
  onSendToClient: vi.fn(),
  onSaveAsTemplate: vi.fn(),
  onRetract: vi.fn(),
  getEffectiveSchema: (_pid: string, orig: Record<string, unknown>) => orig,
  onRestore: vi.fn(),
} as const;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

// ── 1. CMS page with ready status shows Publish ───────────────────────────────

describe('SchemaPageCard — CMS page with ready delivery status', () => {
  it('shows a Publish button and fires onConfirmPublish when clicked', async () => {
    const page = makeCmsPage({
      cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'schema-json', message: 'Ready.' },
    });
    const onConfirmPublish = vi.fn();
    render(
      createElement(SchemaPageCard, {
        ...BASE_CARD_PROPS,
        page,
        onConfirmPublish,
      }),
      { wrapper },
    );

    const publishBtn = screen.getByRole('button', { name: /publish to cms field/i });
    expect(publishBtn).toBeInTheDocument();

    await userEvent.click(publishBtn);
    expect(onConfirmPublish).toHaveBeenCalledWith(page.pageId);
  });

  it('does NOT show Retract for a published CMS page (no server-side clear support)', () => {
    const page = makeCmsPage({
      cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'schema-json', message: 'Ready.' },
    });
    render(
      createElement(SchemaPageCard, {
        ...BASE_CARD_PROPS,
        page,
        published: true,
      }),
      { wrapper },
    );

    expect(screen.queryByRole('button', { name: /retract/i })).not.toBeInTheDocument();
    // Instead, a guidance notice should be visible
    expect(screen.getByText(/clear via webflow cms/i)).toBeInTheDocument();
  });
});

// ── 2. CMS page without mapped field shows honest "not mapped" notice ─────────

describe('SchemaPageCard — CMS page with missing/blocked delivery status', () => {
  it('shows "CMS fields not mapped" when cmsDeliveryStatus is absent', () => {
    const page = makeCmsPage(); // no cmsDeliveryStatus
    render(
      createElement(SchemaPageCard, { ...BASE_CARD_PROPS, page }),
      { wrapper },
    );

    expect(screen.getByText(/cms fields not mapped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('shows "CMS publish unavailable" when cmsDeliveryStatus is blocked', () => {
    const page = makeCmsPage({
      cmsDeliveryStatus: { mode: 'cms-field', status: 'blocked', fieldSlug: undefined, message: 'No mapped field.' },
    });
    render(
      createElement(SchemaPageCard, { ...BASE_CARD_PROPS, page }),
      { wrapper },
    );

    expect(screen.getByText(/cms publish unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });
});

// ── 3. Static pages are unaffected ────────────────────────────────────────────

describe('SchemaPageCard — static page (not CMS)', () => {
  it('shows Publish to Webflow for a static page regardless of cmsDeliveryStatus', () => {
    const page = makeStaticPage();
    render(
      createElement(SchemaPageCard, { ...BASE_CARD_PROPS, page }),
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /publish to webflow/i })).toBeInTheDocument();
  });

  it('shows Retract for a published static page', () => {
    const page = makeStaticPage();
    render(
      createElement(SchemaPageCard, { ...BASE_CARD_PROPS, page, published: true }),
      { wrapper },
    );

    expect(screen.getByRole('button', { name: /retract/i })).toBeInTheDocument();
  });
});

// ── 4. Publishing workflow hook: unpublishedCount respects CMS readiness ──────

describe('useSchemaSuggesterPublishingWorkflow — CMS page readiness in counts', () => {
  it('counts a CMS-ready page in unpublishedCount', async () => {
    const data: SchemaPageSuggestion[] = [
      makeCmsPage({
        cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'f', message: 'Ready.' },
      }),
    ];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.unpublishedCount).toBe(1));
  });

  it('does NOT count a CMS page without ready status in unpublishedCount', async () => {
    const data: SchemaPageSuggestion[] = [
      makeCmsPage(), // no cmsDeliveryStatus
    ];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.unpublishedCount).toBe(0));
  });

  it('counts static pages always in unpublishedCount', async () => {
    const data: SchemaPageSuggestion[] = [makeStaticPage()];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.unpublishedCount).toBe(1));
  });

  it('mixed: static + cms-ready both count; cms-not-ready does not', async () => {
    const data: SchemaPageSuggestion[] = [
      makeStaticPage({ pageId: 'page-about', slug: '/about' }),
      makeCmsPage({
        pageId: 'cms-post-a',
        cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'f', message: 'Ready.' },
      }),
      makeCmsPage({
        pageId: 'cms-post-b', slug: 'blog/b',
        // no cmsDeliveryStatus
      }),
    ];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    // Only static + cms-ready = 2
    await waitFor(() => expect(result.current.unpublishedCount).toBe(2));
  });
});
