/**
 * Component tests for W3.1: AiSuggested → ContentBriefs prefill handoff.
 *
 * Covers:
 *   1. suggested_brief signal renders "Create Brief" and calls onCreateBrief
 *      with keyword + pageUrl (not discarded).
 *   2. refresh_suggestion signal renders "Refresh brief" button and calls
 *      onCreateBrief with pageUrl (keyword too if present).
 *   3. ContentPipeline.handleCreateBrief builds a synthetic fixContext and
 *      passes it to ContentBriefs so the keyword + page are pre-filled
 *      (static analysis — avoids spinning up the full pipeline render tree).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PipelineSignal } from '../../shared/types/insights';

// ---------------------------------------------------------------------------
// Hoisted mock — must be at module top level
// ---------------------------------------------------------------------------

const { hookReturnValue } = vi.hoisted(() => ({
  hookReturnValue: { current: { data: { signals: [] as PipelineSignal[] }, isLoading: false } },
}));

vi.mock('../../src/hooks/admin/useAiSuggestedBriefs', () => ({
  useAiSuggestedBriefs: () => hookReturnValue.current,
}));

// ---------------------------------------------------------------------------
// Signal fixtures
// ---------------------------------------------------------------------------

const suggestedBriefSignal: PipelineSignal = {
  insightId: 'ins-1',
  type: 'suggested_brief',
  keyword: 'dental implants sarasota',
  pageUrl: '/services/implants',
  pageTitle: 'Implants page',
  detail: 'High volume keyword with no matching page.',
  impactScore: 80,
};

const refreshSignal: PipelineSignal = {
  insightId: 'ins-2',
  type: 'refresh_suggestion',
  keyword: 'teeth whitening',
  pageUrl: '/blog/whitening-guide',
  pageTitle: 'Whitening guide',
  detail: 'Page traffic dropped 60% — consider a brief refresh.',
  impactScore: 70,
};

const refreshSignalNoKeyword: PipelineSignal = {
  insightId: 'ins-3',
  type: 'refresh_suggestion',
  pageUrl: '/blog/old-post',
  detail: 'Page is decaying.',
  impactScore: 55,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderAiSuggested(
  signals: PipelineSignal[],
  onCreateBrief?: (kw: string, pageUrl?: string) => void,
) {
  hookReturnValue.current = { data: { signals }, isLoading: false };
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
// Test 1: suggested_brief — "Create Brief" passes keyword + pageUrl
// ---------------------------------------------------------------------------

describe('AiSuggested: suggested_brief signal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Create Brief" button for suggested_brief signals', async () => {
    await renderAiSuggested([suggestedBriefSignal], vi.fn());
    expect(screen.getByRole('button', { name: /create brief/i })).toBeInTheDocument();
  });

  it('clicking "Create Brief" calls onCreateBrief with the signal keyword and pageUrl', async () => {
    const onCreateBrief = vi.fn();
    await renderAiSuggested([suggestedBriefSignal], onCreateBrief);
    fireEvent.click(screen.getByRole('button', { name: /create brief/i }));
    expect(onCreateBrief).toHaveBeenCalledOnce();
    expect(onCreateBrief).toHaveBeenCalledWith('dental implants sarasota', '/services/implants');
  });

  it('does NOT render "Create Brief" when onCreateBrief is not provided', async () => {
    await renderAiSuggested([suggestedBriefSignal]);
    expect(screen.queryByRole('button', { name: /create brief/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: refresh_suggestion — "Refresh brief" present + carries pageUrl
// ---------------------------------------------------------------------------

describe('AiSuggested: refresh_suggestion signal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Refresh brief" button for refresh_suggestion signals', async () => {
    await renderAiSuggested([refreshSignal], vi.fn());
    expect(screen.getByRole('button', { name: /refresh brief/i })).toBeInTheDocument();
  });

  it('does NOT render "Create Brief" for a refresh_suggestion signal', async () => {
    await renderAiSuggested([refreshSignal], vi.fn());
    expect(screen.queryByRole('button', { name: /create brief/i })).toBeNull();
  });

  it('clicking "Refresh brief" calls onCreateBrief with keyword + pageUrl', async () => {
    const onCreateBrief = vi.fn();
    await renderAiSuggested([refreshSignal], onCreateBrief);
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(onCreateBrief).toHaveBeenCalledOnce();
    expect(onCreateBrief).toHaveBeenCalledWith('teeth whitening', '/blog/whitening-guide');
  });

  it('clicking "Refresh brief" on a no-keyword signal still passes pageUrl', async () => {
    const onCreateBrief = vi.fn();
    await renderAiSuggested([refreshSignalNoKeyword], onCreateBrief);
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(onCreateBrief).toHaveBeenCalledOnce();
    const [kw, page] = onCreateBrief.mock.calls[0] as [string, string | undefined];
    // keyword falls back to '' when absent; pageUrl is still passed
    expect(kw).toBe('');
    expect(page).toBe('/blog/old-post');
  });

  it('does NOT render a "Refresh brief" button when onCreateBrief is not provided', async () => {
    await renderAiSuggested([refreshSignal]);
    expect(screen.queryByRole('button', { name: /refresh brief/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 3: ContentPipeline — handleCreateBrief builds synthetic fixContext
//         (static analysis — no need to spin up the full pipeline tree)
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

  it('handleCreateBrief calls setPipelinePrefill and setActiveTab("briefs")', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of handler

    expect(src).toMatch(/setPipelinePrefill\s*\(/);
    expect(src).toMatch(/setActiveTab\s*\(\s*['"]briefs['"]\s*\)/);
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
