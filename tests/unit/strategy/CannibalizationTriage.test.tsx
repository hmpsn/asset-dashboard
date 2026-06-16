import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('CannibalizationTriage', () => {
  beforeEach(() => { vi.clearAllMocks(); outcomeState.resolved = []; });

  it('renders null when there are no entries', () => {
    const { container } = render(<MemoryRouter><CannibalizationTriage entries={[]} workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the best-position page as keeper and routes Fix-in-editor for the duplicate', () => {
    render(<MemoryRouter><CannibalizationTriage entries={[item()]} workspaceId="ws1" /></MemoryRouter>);
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

  it('treats canonicalPath as the keeper regardless of position', () => {
    render(
      <MemoryRouter>
        <CannibalizationTriage
          entries={[item({ canonicalPath: '/blog/crm-guide' })]}
          workspaceId="ws1"
        />
      </MemoryRouter>,
    );
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
    const { container } = render(<MemoryRouter><CannibalizationTriage entries={[item()]} workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('does NOT hide for a cannibalization_resolved action from a different source type (recommendation)', () => {
    outcomeState.resolved = [{ sourceType: 'recommendation', sourceId: 'best crm' }];
    render(<MemoryRouter><CannibalizationTriage entries={[item()]} workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('“best crm”')).toBeInTheDocument();
  });

  it('records a cannibalization_resolved outcome when Mark resolved is clicked', () => {
    render(<MemoryRouter><CannibalizationTriage entries={[item()]} workspaceId="ws1" /></MemoryRouter>);
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
});
