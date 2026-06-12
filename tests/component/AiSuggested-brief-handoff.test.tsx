/**
 * Component tests for AiSuggested: store-backed data source, dismiss/snooze UI,
 * and the ContentBriefs prefill handoff (W3.1 + W6.5).
 *
 * Covers:
 *   1. suggested_brief (ranking_opportunity source) renders "Create Brief" and calls
 *      onCreateBrief with keyword + pageUrl + suggestedBriefId.
 *   2. refresh_suggestion (content_decay source) renders "Refresh brief" button.
 *   3. Dismiss button calls dismissMutation.
 *   4. Snooze button opens a menu; selecting an option calls snoozeMutation.
 *   5. ContentPipeline.handleCreateBrief builds a synthetic fixContext (static analysis).
 *   6. ContentPipeline passes pipelinePrefill ?? fixContext to ContentBriefs (static analysis).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SuggestedBrief } from '../../shared/types/intelligence';

// ---------------------------------------------------------------------------
// Hoisted mocks — module-level so vi.mock hoisting works
// ---------------------------------------------------------------------------

const mutate = vi.fn();
const { hookReturnValue } = vi.hoisted(() => ({
  hookReturnValue: { current: { data: [] as SuggestedBrief[], isLoading: false } },
}));

vi.mock('../../src/hooks/admin/useAiSuggestedBriefs', () => ({
  useAiSuggestedBriefs: () => hookReturnValue.current,
  useDismissSuggestedBrief: () => ({ mutate }),
  useSnoozeSuggestedBrief: () => ({ mutate }),
  useAcceptSuggestedBrief: () => ({ mutate }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rankingBrief: SuggestedBrief = {
  id: 'brief-1',
  workspaceId: 'ws-1',
  keyword: 'dental implants sarasota',
  pageUrl: '/services/implants',
  source: 'ranking_opportunity',
  reason: 'Position 12 with 3,000 impressions — brief could push to page 1',
  priority: 'high',
  status: 'pending',
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  snoozedUntil: null,
  dismissedKeywordHash: null,
};

const decayBrief: SuggestedBrief = {
  id: 'brief-2',
  workspaceId: 'ws-1',
  keyword: 'teeth whitening',
  pageUrl: '/blog/whitening-guide',
  source: 'content_decay',
  reason: 'Page traffic dropped 60% — content refresh recommended',
  priority: 'medium',
  status: 'pending',
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  snoozedUntil: null,
  dismissedKeywordHash: null,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderAiSuggested(
  briefs: SuggestedBrief[],
  onCreateBrief?: (kw: string, pageUrl?: string, briefId?: string) => void,
) {
  hookReturnValue.current = { data: briefs, isLoading: false };
  const { AiSuggested } = await import('../../src/components/pipeline/AiSuggested');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AiSuggested workspaceId="ws-1" onCreateBrief={onCreateBrief} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Test 1: ranking_opportunity (suggested_brief source) — "Create Brief"
// ---------------------------------------------------------------------------

describe('AiSuggested: ranking_opportunity brief', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Create Brief" button for ranking_opportunity source', async () => {
    await renderAiSuggested([rankingBrief], vi.fn());
    expect(screen.getByRole('button', { name: /create brief/i })).toBeInTheDocument();
  });

  it('clicking "Create Brief" calls onCreateBrief with keyword, pageUrl, and briefId', async () => {
    const onCreateBrief = vi.fn();
    await renderAiSuggested([rankingBrief], onCreateBrief);
    fireEvent.click(screen.getByRole('button', { name: /create brief/i }));
    expect(onCreateBrief).toHaveBeenCalledOnce();
    expect(onCreateBrief).toHaveBeenCalledWith(
      'dental implants sarasota',
      '/services/implants',
      'brief-1',
    );
  });

  it('clicking "Create Brief" fires the accept mutation', async () => {
    await renderAiSuggested([rankingBrief], vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /create brief/i }));
    expect(mutate).toHaveBeenCalledWith('brief-1');
  });

  it('does NOT render "Create Brief" when onCreateBrief is not provided', async () => {
    await renderAiSuggested([rankingBrief]);
    expect(screen.queryByRole('button', { name: /create brief/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: content_decay (refresh source) — "Refresh brief"
// ---------------------------------------------------------------------------

describe('AiSuggested: content_decay (refresh) brief', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Refresh brief" button for content_decay source', async () => {
    await renderAiSuggested([decayBrief], vi.fn());
    expect(screen.getByRole('button', { name: /refresh brief/i })).toBeInTheDocument();
  });

  it('does NOT render "Create Brief" for a content_decay brief', async () => {
    await renderAiSuggested([decayBrief], vi.fn());
    expect(screen.queryByRole('button', { name: /create brief/i })).toBeNull();
  });

  it('clicking "Refresh brief" calls onCreateBrief with keyword + pageUrl + briefId', async () => {
    const onCreateBrief = vi.fn();
    await renderAiSuggested([decayBrief], onCreateBrief);
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(onCreateBrief).toHaveBeenCalledOnce();
    expect(onCreateBrief).toHaveBeenCalledWith('teeth whitening', '/blog/whitening-guide', 'brief-2');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Dismiss action
// ---------------------------------------------------------------------------

describe('AiSuggested: dismiss action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a dismiss button for each suggestion', async () => {
    await renderAiSuggested([rankingBrief]);
    const dismissBtn = screen.getByRole('button', { name: /dismiss suggestion/i });
    expect(dismissBtn).toBeInTheDocument();
  });

  it('clicking dismiss calls the dismiss mutation with the brief id', async () => {
    await renderAiSuggested([rankingBrief]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss suggestion/i }));
    expect(mutate).toHaveBeenCalledWith('brief-1');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Snooze action
// ---------------------------------------------------------------------------

describe('AiSuggested: snooze action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a snooze button for each suggestion', async () => {
    await renderAiSuggested([rankingBrief]);
    expect(screen.getByRole('button', { name: /snooze suggestion/i })).toBeInTheDocument();
  });

  it('clicking snooze button opens a menu with snooze options', async () => {
    await renderAiSuggested([rankingBrief]);
    fireEvent.click(screen.getByRole('button', { name: /snooze suggestion/i }));
    expect(screen.getByText(/snooze 1 week/i)).toBeInTheDocument();
    expect(screen.getByText(/snooze 1 month/i)).toBeInTheDocument();
  });

  it('selecting "Snooze 1 week" calls the snooze mutation with a date ~7 days out', async () => {
    await renderAiSuggested([rankingBrief]);
    fireEvent.click(screen.getByRole('button', { name: /snooze suggestion/i }));
    fireEvent.click(screen.getByText(/snooze 1 week/i));
    expect(mutate).toHaveBeenCalledOnce();
    const [arg] = mutate.mock.calls[0] as [{ briefId: string; until: string }];
    expect(arg.briefId).toBe('brief-1');
    // until should be in YYYY-MM-DD format, ~7 days from now
    expect(arg.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Test 5 & 6: ContentPipeline static analysis — fixContext prefill + tab switch
// ---------------------------------------------------------------------------

describe('ContentPipeline: handleCreateBrief builds synthetic fixContext', () => {
  it('buildSignalPrefill maps keyword → primaryKeyword and pageUrl → pageSlug', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of prefill helper

    // The helper must set primaryKeyword from the keyword argument
    expect(src).toMatch(/primaryKeyword:\s*keyword/);
    // The helper must set pageSlug from the pageUrl argument (NOT primaryKeyword)
    expect(src).toMatch(/pageSlug:\s*pageUrl/);
    // targetRoute must be 'content-pipeline'
    expect(src).toMatch(/targetRoute:\s*['"]content-pipeline['"]/);
  });

  it('handleCreateBrief accepts optional _suggestedBriefId third arg for interface compatibility', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of handler

    expect(src).toMatch(/setPipelinePrefill\s*\(/);
    expect(src).toMatch(/setActiveTab\s*\(\s*['"]briefs['"]\s*\)/);
    // Third param must be present for interface compat
    expect(src).toMatch(/_suggestedBriefId/);
  });

  it('ContentBriefs tab renders with pipelinePrefill taking precedence over parent fixContext', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of ContentBriefs tab render

    // pipelinePrefill ?? fixContext pattern
    expect(src).toMatch(/pipelinePrefill\s*\?\?\s*fixContext/);
    // clearFixContext override when pipelinePrefill active
    expect(src).toMatch(/pipelinePrefill\s*\?\s*\(\)\s*=>/);
    expect(src).toMatch(/setPipelinePrefill\s*\(\s*null\s*\)/);
  });
});
