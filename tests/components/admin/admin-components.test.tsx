/**
 * Smoke tests for admin components:
 *   - WorkspaceHealthBadge
 *   - ActionQueue
 *   - BriefingReviewQueue
 *   - CannibalizationAlert
 *   - ClientActionsTab
 *   - AdminInbox
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { WorkspaceHealthBadge } from '../../../src/components/admin/WorkspaceHealthBadge';
import { ActionQueue } from '../../../src/components/admin/ActionQueue';
import { BriefingReviewQueue } from '../../../src/components/admin/BriefingReviewQueue';
import { CannibalizationAlert } from '../../../src/components/admin/CannibalizationAlert';
import { ClientActionsTab } from '../../../src/components/admin/ClientActionsTab';
import { AdminInbox } from '../../../src/components/admin/AdminInbox';

import type { AnalyticsInsight } from '../../../shared/types/analytics';
import type { CannibalizationWarning } from '../../../shared/types/intelligence';
import type { ClientAction } from '../../../shared/types/client-actions';
import type { ClientSignal } from '../../../shared/types/client-signals';
import type { BriefingDraft } from '../../../shared/types/briefing';

// ── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue([]),
  getOptional: vi.fn().mockResolvedValue(null),
  getSafe: vi.fn().mockResolvedValue({ items: [] }),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/api/briefing', () => ({
  briefingApi: {
    listDrafts: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({}),
    skip: vi.fn().mockResolvedValue({}),
    generateNow: vi.fn().mockResolvedValue({ accepted: true }),
    updateStories: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../src/api/clientActions', () => ({
  clientActions: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));

// ── Toast mock (avoid context errors) ────────────────────────────────────────
vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Shared wrapper ───────────────────────────────────────────────────────────
function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithWrapper(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

const makeInsight = (overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight => ({
  id: 'insight-1',
  workspaceId: 'ws-1',
  pageId: 'page-1',
  insightType: 'title_missing',
  data: {} as AnalyticsInsight['data'],
  severity: 'critical',
  computedAt: '2026-05-01T00:00:00Z',
  pageTitle: 'Home Page',
  impactScore: 85,
  domain: 'content',
  ...overrides,
});

const makeClientAction = (overrides: Partial<ClientAction> = {}): ClientAction => ({
  id: 'action-1',
  workspaceId: 'ws-1',
  sourceType: 'aeo_change',
  title: 'Update AEO Schema',
  summary: 'Schema changes required to improve AEO performance.',
  payload: {},
  status: 'pending',
  priority: 'high',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  ...overrides,
});

const makeSignal = (overrides: Partial<ClientSignal> = {}): ClientSignal => ({
  id: 'signal-1',
  workspaceId: 'ws-1',
  workspaceName: 'Test Workspace',
  type: 'content_interest',
  status: 'new',
  chatContext: [],
  triggerMessage: 'Can you write a blog post about SEO?',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  ...overrides,
});

const makeWarning = (overrides: Partial<CannibalizationWarning> = {}): CannibalizationWarning => ({
  keyword: 'seo tips',
  pages: ['/blog/seo-tips', '/blog/seo-guide'],
  severity: 'high',
  ...overrides,
});

const makeBriefingDraft = (overrides: Partial<BriefingDraft> = {}): BriefingDraft => ({
  id: 'draft-1',
  workspaceId: 'ws-1',
  weekOf: '2026-05-19',
  status: 'draft',
  stories: [
    {
      id: 'story-1',
      category: 'win',
      headline: 'Organic traffic up 15% this week',
      narrative: 'Your site saw significant growth in organic search visits.',
      isHeadline: true,
      metrics: [],
    },
  ],
  adminNote: undefined,
  createdAt: '2026-05-19T14:00:00Z',
  updatedAt: '2026-05-19T14:00:00Z',
  ...overrides,
});

// ════════════════════════════════════════════════════════════════════════════
// WorkspaceHealthBadge
// ════════════════════════════════════════════════════════════════════════════

describe('WorkspaceHealthBadge', () => {
  it('renders without crashing for a high score', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={85} />);
    expect(screen.getAllByText('85').length).toBeGreaterThan(0);
  });

  it('renders without crashing for a medium score', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={65} />);
    expect(screen.getAllByText('65').length).toBeGreaterThan(0);
  });

  it('renders without crashing for a low score', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={45} />);
    expect(screen.getAllByText('45').length).toBeGreaterThan(0);
  });

  it('rounds fractional scores', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={84.7} />);
    expect(screen.getAllByText('85').length).toBeGreaterThan(0);
  });

  it('renders nothing when score is null', () => {
    const { container } = renderWithWrapper(<WorkspaceHealthBadge score={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when score is undefined', () => {
    const { container } = renderWithWrapper(<WorkspaceHealthBadge score={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('accepts a custom size prop', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={72} size={48} />);
    expect(screen.getAllByText('72').length).toBeGreaterThan(0);
  });

  it('applies score color class for emerald on high scores', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={90} />);
    // The span has the class; getAllByText returns both svg text and span
    const spans = screen.getAllByText('90');
    const span = spans.find(el => el.tagName === 'SPAN');
    expect(span?.className).toContain('emerald');
  });

  it('applies score color class for amber on medium scores', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={70} />);
    const spans = screen.getAllByText('70');
    const span = spans.find(el => el.tagName === 'SPAN');
    expect(span?.className).toContain('amber');
  });

  it('applies score color class for red on low scores', () => {
    renderWithWrapper(<WorkspaceHealthBadge score={40} />);
    const spans = screen.getAllByText('40');
    const span = spans.find(el => el.tagName === 'SPAN');
    expect(span?.className).toContain('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ActionQueue
// ════════════════════════════════════════════════════════════════════════════

describe('ActionQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section card title', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({ items: [] });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    // Title appears (could be "Action Queue" or include count)
    await waitFor(() => {
      expect(screen.getByText(/Action Queue/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no items', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({ items: [] });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('All caught up')).toBeInTheDocument();
    });
  });

  it('shows items when data is returned', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [makeInsight({ id: 'i1', pageTitle: 'Home Page' })],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Home Page')).toBeInTheDocument();
    });
  });

  it('shows impact score for items', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [makeInsight({ impactScore: 92 })],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('92')).toBeInTheDocument();
    });
  });

  it('renders multiple items', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [
        makeInsight({ id: 'i1', pageTitle: 'Home' }),
        makeInsight({ id: 'i2', pageTitle: 'About' }),
      ],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  it('expands an item row when clicked', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [makeInsight({ id: 'i1', pageTitle: 'Home', insightType: 'title_missing' })],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());

    const row = screen.getByText('Home');
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText(/title_missing/)).toBeInTheDocument();
    });
  });

  it('shows resolution buttons when expanded', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [makeInsight({ id: 'i1', pageTitle: 'Home' })],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Home'));

    await waitFor(() => {
      expect(screen.getByText('Mark Resolved')).toBeInTheDocument();
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });
  });

  it('shows item count in title when items exist', async () => {
    const { getSafe } = await import('../../../src/api/client');
    vi.mocked(getSafe).mockResolvedValue({
      items: [makeInsight({ id: 'i1' }), makeInsight({ id: 'i2' })],
    });
    renderWithWrapper(<ActionQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Action Queue \(2\)/)).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BriefingReviewQueue
// ════════════════════════════════════════════════════════════════════════════

describe('BriefingReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Weekly Briefings section card', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Weekly Briefings')).toBeInTheDocument();
    });
  });

  it('shows empty state when no drafts', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('No briefings yet')).toBeInTheDocument();
    });
  });

  it('shows generate now button', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Generate now')).toBeInTheDocument();
    });
  });

  it('renders draft rows when drafts exist', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('2026-05-19')).toBeInTheDocument();
    });
  });

  it('shows draft status badge', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('draft')).toBeInTheDocument();
    });
  });

  it('shows story count for each draft', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('1 story')).toBeInTheDocument();
    });
  });

  it('expands a draft row to reveal stories', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('2026-05-19')).toBeInTheDocument());

    fireEvent.click(screen.getByText('2026-05-19'));

    await waitFor(() => {
      expect(screen.getByText('Organic traffic up 15% this week')).toBeInTheDocument();
    });
  });

  it('shows approve and publish buttons when expanded on a draft', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('2026-05-19')).toBeInTheDocument());

    fireEvent.click(screen.getByText('2026-05-19'));

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Publish')).toBeInTheDocument();
    });
  });

  it('shows skip button when expanded on a draft', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([makeBriefingDraft()]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('2026-05-19')).toBeInTheDocument());

    fireEvent.click(screen.getByText('2026-05-19'));

    await waitFor(() => {
      expect(screen.getByText('Skip')).toBeInTheDocument();
    });
  });

  it('shows no action buttons for a published draft', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([
      makeBriefingDraft({ status: 'published' }),
    ]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('2026-05-19')).toBeInTheDocument());

    fireEvent.click(screen.getByText('2026-05-19'));

    await waitFor(() => {
      expect(screen.queryByText('Approve')).not.toBeInTheDocument();
      expect(screen.queryByText('Publish')).not.toBeInTheDocument();
    });
  });

  it('shows multiple drafts', async () => {
    const { briefingApi } = await import('../../../src/api/briefing');
    vi.mocked(briefingApi.listDrafts).mockResolvedValue([
      makeBriefingDraft({ id: 'd1', weekOf: '2026-05-19' }),
      makeBriefingDraft({ id: 'd2', weekOf: '2026-05-12' }),
    ]);
    renderWithWrapper(<BriefingReviewQueue workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('2026-05-19')).toBeInTheDocument();
      expect(screen.getByText('2026-05-12')).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CannibalizationAlert
// ════════════════════════════════════════════════════════════════════════════

describe('CannibalizationAlert', () => {
  it('renders nothing when warnings is empty', () => {
    const { container } = renderWithWrapper(
      <CannibalizationAlert warnings={[]} tier="growth" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when warnings is null', () => {
    const { container } = renderWithWrapper(
      <CannibalizationAlert warnings={null} tier="growth" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when warnings is undefined', () => {
    const { container } = renderWithWrapper(
      <CannibalizationAlert warnings={undefined} tier="growth" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders section card title when warnings exist', () => {
    renderWithWrapper(
      <CannibalizationAlert warnings={[makeWarning()]} tier="growth" />,
    );
    expect(screen.getByText('Keyword Cannibalization Detected')).toBeInTheDocument();
  });

  it('renders the keyword name', () => {
    renderWithWrapper(
      <CannibalizationAlert warnings={[makeWarning({ keyword: 'content marketing' })]} tier="growth" />,
    );
    // Text is broken across elements (quotes + text nodes), use container query
    expect(screen.getByText(/content marketing/)).toBeInTheDocument();
  });

  it('renders page paths for high severity', () => {
    renderWithWrapper(
      <CannibalizationAlert
        warnings={[makeWarning({ pages: ['/blog/seo-tips', '/blog/seo-guide'] })]}
        tier="growth"
      />,
    );
    expect(screen.getByText('/blog/seo-tips')).toBeInTheDocument();
    expect(screen.getByText('/blog/seo-guide')).toBeInTheDocument();
  });

  it('strips protocol and domain from page URLs', () => {
    renderWithWrapper(
      <CannibalizationAlert
        warnings={[makeWarning({ pages: ['https://example.com/blog/post'] })]}
        tier="growth"
      />,
    );
    expect(screen.getByText('/blog/post')).toBeInTheDocument();
  });

  it('renders multiple warnings', () => {
    renderWithWrapper(
      <CannibalizationAlert
        warnings={[
          makeWarning({ keyword: 'seo tips', severity: 'high' }),
          makeWarning({ keyword: 'link building', severity: 'medium' }),
        ]}
        tier="growth"
      />,
    );
    // Text is broken across elements; match keyword text directly
    expect(screen.getByText(/seo tips/)).toBeInTheDocument();
    expect(screen.getByText(/link building/)).toBeInTheDocument();
  });

  it('renders TierGate (no lock icon for growth tier)', () => {
    const { container } = renderWithWrapper(
      <CannibalizationAlert warnings={[makeWarning()]} tier="growth" />,
    );
    // TierGate should show content (not gate) for growth tier
    expect(screen.getByText('Keyword Cannibalization Detected')).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('renders with medium severity warning', () => {
    renderWithWrapper(
      <CannibalizationAlert
        warnings={[makeWarning({ severity: 'medium' })]}
        tier="premium"
      />,
    );
    expect(screen.getByText('Keyword Cannibalization Detected')).toBeInTheDocument();
  });

  it('renders with low severity warning', () => {
    renderWithWrapper(
      <CannibalizationAlert
        warnings={[makeWarning({ severity: 'low' })]}
        tier="premium"
      />,
    );
    expect(screen.getByText('Keyword Cannibalization Detected')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ClientActionsTab
// ════════════════════════════════════════════════════════════════════════════

describe('ClientActionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Client Actions section card', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Client Actions')).toBeInTheDocument();
    });
  });

  it('shows empty state when no actions', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('No client actions')).toBeInTheDocument();
    });
  });

  it('renders an action card when data exists', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([makeClientAction()]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Update AEO Schema')).toBeInTheDocument();
    });
  });

  it('shows action summary text', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([makeClientAction()]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Schema changes required to improve AEO performance.')).toBeInTheDocument();
    });
  });

  it('shows status badge for pending action', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([makeClientAction({ status: 'pending' })]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  it('shows status badge for completed action', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ status: 'completed' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
  });

  it('shows Mark complete button for non-content_decay approved action', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ status: 'approved', sourceType: 'aeo_change' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Mark complete')).toBeInTheDocument();
    });
  });

  it('shows auto-brief badge for approved content_decay action', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ status: 'approved', sourceType: 'content_decay' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Brief generating automatically')).toBeInTheDocument();
    });
  });

  it('shows awaiting badge in header when approved actions exist', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ status: 'approved', sourceType: 'internal_link' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('1 awaiting')).toBeInTheDocument();
    });
  });

  it('shows action count in title when items exist', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ id: 'a1' }),
      makeClientAction({ id: 'a2' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Client Actions (2)')).toBeInTheDocument();
    });
  });

  it('shows source type label', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ sourceType: 'internal_link' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Internal Link/)).toBeInTheDocument();
    });
  });

  it('shows client note when present', async () => {
    const { clientActions } = await import('../../../src/api/clientActions');
    vi.mocked(clientActions.list).mockResolvedValue([
      makeClientAction({ clientNote: 'Please prioritize this one.' }),
    ]);
    renderWithWrapper(<ClientActionsTab workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Please prioritize this one\./)).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AdminInbox
// ════════════════════════════════════════════════════════════════════════════

describe('AdminInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Client Signals section card', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Client Signals')).toBeInTheDocument();
    });
  });

  it('shows empty state when no new signals', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('No new signals')).toBeInTheDocument();
    });
  });

  it('shows tab bar with New and All tabs', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText(/New \(0\)/)).toBeInTheDocument();
      expect(screen.getByText(/All \(0\)/)).toBeInTheDocument();
    });
  });

  it('renders signal cards when signals exist', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal()]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Content Interest')).toBeInTheDocument();
    });
  });

  it('shows trigger message in signal card', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal()]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Can you write a blog post about SEO?')).toBeInTheDocument();
    });
  });

  it('shows new badge count when new signals exist', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal({ status: 'new' })]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('1 new')).toBeInTheDocument();
    });
  });

  it('shows signal status badge (new)', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal({ status: 'new' })]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    });
  });

  it('switches to All tab to show reviewed signals', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal({ status: 'reviewed' })]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    // Reviewed signals don't appear in "new" tab — switch to all
    await waitFor(() => expect(screen.getByText(/All \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/All \(1\)/));

    await waitFor(() => {
      expect(screen.getByText('Content Interest')).toBeInTheDocument();
    });
  });

  it('expands a signal card to reveal chat context section', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal({ status: 'new' })]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('Content Interest')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Content Interest'));

    await waitFor(() => {
      expect(screen.getByText('No conversation context available.')).toBeInTheDocument();
    });
  });

  it('shows chat context messages when present', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([
      makeSignal({
        status: 'new',
        chatContext: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      }),
    ]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('Content Interest')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Content Interest'));

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });
  });

  it('shows mark-as action buttons when expanded', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([makeSignal({ status: 'new' })]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText('Content Interest')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Content Interest'));

    await waitFor(() => {
      expect(screen.getByText('Reviewed')).toBeInTheDocument();
      expect(screen.getByText('Actioned')).toBeInTheDocument();
    });
  });

  it('shows empty state when All tab has no signals', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText(/All \(0\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/All \(0\)/));

    await waitFor(() => {
      expect(screen.getByText('No signals yet')).toBeInTheDocument();
    });
  });

  it('renders service_interest signal type label', async () => {
    const { get } = await import('../../../src/api/client');
    vi.mocked(get).mockResolvedValue([
      makeSignal({ type: 'service_interest', status: 'new' }),
    ]);
    renderWithWrapper(<AdminInbox workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Service Interest')).toBeInTheDocument();
    });
  });
});
