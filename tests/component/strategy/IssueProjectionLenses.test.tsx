import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KeywordTargetsLens } from '../../../src/components/strategy/issue/KeywordTargetsLens';
import { ContentWorkOrderLens } from '../../../src/components/strategy/issue/ContentWorkOrderLens';

vi.mock('../../../src/hooks/admin/useIssueLenses', () => ({
  useIssueLenses: () => ({
    keywordTargets: [
      {
        recId: 'keyword-staged',
        type: 'keyword_gap',
        label: 'staged implant keyword',
        deepLinkKeyword: 'implant keyword',
        clientStatus: 'system',
        priority: 'fix_now',
        sent: false,
      },
      {
        recId: 'keyword-unstaged',
        type: 'topic_cluster',
        label: 'unstaged cosmetic topic',
        deepLinkKeyword: 'cosmetic topic',
        clientStatus: 'system',
        priority: 'fix_soon',
        sent: false,
      },
    ],
    contentWorkOrders: [
      {
        recId: 'content-staged',
        type: 'content',
        title: 'Staged implant page',
        clientStatus: 'system',
        priority: 'fix_now',
        sent: false,
        requestId: null,
        stage: 'not_started',
        hasBrief: false,
        hasPost: false,
      },
      {
        recId: 'content-unstaged',
        type: 'content_refresh',
        title: 'Unstaged cosmetic page',
        clientStatus: 'system',
        priority: 'fix_soon',
        sent: false,
        requestId: null,
        stage: 'not_started',
        hasBrief: false,
        hasPost: false,
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

describe('Engine staged-move projection lenses', () => {
  it('shows only staged keyword targets when an inclusion set is provided', () => {
    render(
      <MemoryRouter>
        <KeywordTargetsLens
          workspaceId="ws-engine"
          theIssueEnabled
          embedded
          includedRecIds={new Set(['keyword-staged'])}
          presentation="engine-spine"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('staged implant keyword')).toBeInTheDocument();
    expect(screen.queryByText('unstaged cosmetic topic')).not.toBeInTheDocument();
    expect(screen.getByTestId('keyword-targets-embedded')).toHaveClass('px-2', 'py-1.5');
    expect(screen.getByTestId('keyword-target-row')).toHaveClass('py-2');
    expect(screen.queryByText(/Staged keyword & topic targets/i)).not.toBeInTheDocument();
  });

  it('shows only staged content work orders when an inclusion set is provided', () => {
    render(
      <MemoryRouter>
        <ContentWorkOrderLens
          workspaceId="ws-engine"
          theIssueEnabled
          embedded
          includedRecIds={new Set(['content-staged'])}
          presentation="engine-spine"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Staged implant page')).toBeInTheDocument();
    expect(screen.queryByText('Unstaged cosmetic page')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-work-orders-embedded')).toHaveClass('px-2', 'py-1.5');
    expect(screen.getByTestId('content-work-order-row')).toHaveClass('py-2');
    expect(screen.queryByText(/Staged content moves and where each stands/i)).not.toBeInTheDocument();
  });

  it('keeps the explanatory copy and legacy embedded padding by default', () => {
    render(
      <MemoryRouter>
        <KeywordTargetsLens
          workspaceId="ws-engine"
          theIssueEnabled
          embedded
          includedRecIds={new Set(['keyword-staged'])}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Staged keyword & topic targets/i)).toBeInTheDocument();
    expect(screen.getByTestId('keyword-targets-embedded')).toHaveClass('px-4', 'py-3');
    expect(screen.getByTestId('keyword-target-row')).toHaveClass('py-3');
  });

  it('uses a compact empty state in the Engine projection instead of a full-card placeholder', () => {
    render(
      <MemoryRouter>
        <KeywordTargetsLens
          workspaceId="ws-engine"
          theIssueEnabled
          embedded
          includedRecIds={new Set()}
          presentation="engine-spine"
        />
      </MemoryRouter>,
    );

    const emptyTitle = screen.getByText('No keyword targets yet');
    expect(emptyTitle.parentElement).toHaveClass('!py-6');
    expect(emptyTitle.parentElement).toHaveClass(
      '[&>div:first-child]:h-10',
      '[&>div:first-child]:w-10',
    );
  });
});
