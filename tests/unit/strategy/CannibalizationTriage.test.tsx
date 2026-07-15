import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CannibalizationTriage } from '../../../src/components/strategy/CannibalizationTriage';
import type { CannibalizationItem } from '../../../shared/types/workspace';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const outcomeState = vi.hoisted(() => ({ resolved: [] as Array<{ sourceType: string; sourceId: string | null }> }));
const mutateMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/hooks/admin/useOutcomes', () => ({
  useOutcomeActions: () => ({ data: outcomeState.resolved }),
  useRecordOutcomeAction: () => ({ mutate: mutateMock, isPending: false }),
}));

const createMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/clientActions', () => ({
  clientActions: { create: createMock },
}));

const item = (over: Partial<CannibalizationItem> = {}): CannibalizationItem => ({
  keyword: 'best crm',
  pages: [
    { path: '/crm', position: 3, impressions: 900, source: 'gsc' },
    { path: '/blog/crm-guide', position: 11, impressions: 200, source: 'gsc' },
  ],
  severity: 'high',
  recommendation: 'Consolidate to the primary page.',
  ...over,
});

function renderTriage(entries: CannibalizationItem[], workspaceId = 'ws1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CannibalizationTriage entries={entries} workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CannibalizationTriage', () => {
  beforeEach(() => { vi.clearAllMocks(); outcomeState.resolved = []; createMock.mockResolvedValue({ id: 'ca_x' }); });

  it('renders null when there are no entries', () => {
    const { container } = renderTriage([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the best-position page as keeper and routes Fix-in-editor for the duplicate', () => {
    renderTriage([item()]);
    expect(screen.getByText('“best crm”')).toBeInTheDocument();
    expect(screen.getByText('Consolidate to the primary page.')).toBeInTheDocument();
    // Best position (#3 /crm) is the keeper → exactly one Fix button (for the #11 duplicate).
    const fixButtons = screen.getAllByRole('button', { name: /fix in editor/i });
    expect(fixButtons).toHaveLength(1);
    fireEvent.click(fixButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('seo-editor'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'seo-editor', pageSlug: '/blog/crm-guide' }) },
      }),
    );
  });

  it('stacks issue actions and page actions without widening a narrow parent', () => {
    renderTriage([item()]);

    const sendButton = screen.getByRole('button', { name: /send to client/i });
    const actionCluster = sendButton.parentElement;
    expect(actionCluster).toHaveClass('w-full', 'flex-wrap', 'sm:w-auto', 'sm:flex-shrink-0');
    expect(actionCluster?.parentElement).toHaveClass('flex-col', 'items-stretch', 'sm:flex-row', 'sm:items-center');

    const fixButton = screen.getByRole('button', { name: /fix in editor/i });
    expect(fixButton.parentElement).toHaveClass('flex-col', 'items-stretch', 'sm:flex-row', 'sm:items-center');
  });

  it('treats canonicalPath as the keeper regardless of position', () => {
    renderTriage([item({ canonicalPath: '/blog/crm-guide' })]);
    // canonicalPath /blog/crm-guide is the keeper → the OTHER page (/crm) is the only duplicate.
    const fixButtons = screen.getAllByRole('button', { name: /fix in editor/i });
    expect(fixButtons).toHaveLength(1);
    fireEvent.click(fixButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('seo-editor'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ pageSlug: '/crm' }) },
      }),
    );
  });

  it('hides an issue that has a resolved cannibalization tracked action', () => {
    outcomeState.resolved = [{ sourceType: 'cannibalization', sourceId: 'best crm' }];
    const { container } = renderTriage([item()]);
    expect(container).toBeEmptyDOMElement();
  });

  it('does NOT hide for a cannibalization_resolved action from a different source type (recommendation)', () => {
    outcomeState.resolved = [{ sourceType: 'recommendation', sourceId: 'best crm' }];
    renderTriage([item()]);
    expect(screen.getByText('“best crm”')).toBeInTheDocument();
  });

  it('records a cannibalization_resolved outcome when Mark resolved is clicked', () => {
    renderTriage([item()]);
    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'cannibalization_resolved',
        sourceType: 'cannibalization',
        sourceId: 'best crm',
        targetKeyword: 'best crm',
      }),
    );
  });

  it('sends a dedicated cannibalization client action when Send to client is clicked', async () => {
    renderTriage([item()]);
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith('ws1', expect.objectContaining({
        sourceType: 'cannibalization',
        sourceId: 'best crm',
        payload: expect.objectContaining({ keyword: 'best crm', recommendation: 'Consolidate to the primary page.' }),
      })),
    );
    // On success the button flips to a "Sent" affordance.
    await waitFor(() => expect(screen.getByText('Sent')).toBeInTheDocument());
  });
});
