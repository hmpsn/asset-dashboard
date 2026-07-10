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
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('staged implant keyword')).toBeInTheDocument();
    expect(screen.queryByText('unstaged cosmetic topic')).not.toBeInTheDocument();
  });

  it('shows only staged content work orders when an inclusion set is provided', () => {
    render(
      <MemoryRouter>
        <ContentWorkOrderLens
          workspaceId="ws-engine"
          theIssueEnabled
          embedded
          includedRecIds={new Set(['content-staged'])}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Staged implant page')).toBeInTheDocument();
    expect(screen.queryByText('Unstaged cosmetic page')).not.toBeInTheDocument();
  });
});
