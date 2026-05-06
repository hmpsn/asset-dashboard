import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageIntelligencePagesHeader } from '../../src/components/page-intelligence/PageIntelligencePagesHeader';

type HeaderProps = ComponentProps<typeof PageIntelligencePagesHeader>;

const baseProps: HeaderProps = {
  pageCount: 4,
  cmsCount: 1,
  withStrategy: 2,
  analyzedCount: 0,
  analyzingCount: 0,
  bulkProgress: null,
  cancellableBulkJobId: null,
  analysisError: null,
  showNextSteps: false,
  fixQueue: [],
  search: '',
  sortBy: 'priority',
  sortDir: 'desc',
  onAnalyzeRemaining: vi.fn(),
  onAnalyzeAll: vi.fn(),
  onCancelBulkJob: vi.fn(),
  onDismissError: vi.fn(),
  onDismissNextSteps: vi.fn(),
  onGoToSeoEditor: vi.fn(),
  onToggleFixQueuePage: vi.fn(),
  onSearchChange: vi.fn(),
  onSortChange: vi.fn(),
};

describe('PageIntelligencePagesHeader rendering', () => {
  it('renders idle analysis controls and wires search/sort callbacks', () => {
    const onAnalyzeRemaining = vi.fn();
    const onAnalyzeAll = vi.fn();
    const onSearchChange = vi.fn();
    const onSortChange = vi.fn();

    render(
      <PageIntelligencePagesHeader
        {...baseProps}
        analyzedCount={2}
        onAnalyzeRemaining={onAnalyzeRemaining}
        onAnalyzeAll={onAnalyzeAll}
        onSearchChange={onSearchChange}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Analyze Remaining \(2\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Re-analyze All/i }));
    fireEvent.change(screen.getByPlaceholderText('Search pages, keywords...'), { target: { value: 'pricing' } });
    fireEvent.click(screen.getByRole('button', { name: /Score/i }));

    expect(onAnalyzeRemaining).toHaveBeenCalledOnce();
    expect(onAnalyzeAll).toHaveBeenCalledOnce();
    expect(onSearchChange).toHaveBeenCalledWith('pricing');
    expect(onSortChange).toHaveBeenCalledWith('score');
  });

  it('renders running progress and routes cancel with the active job id', () => {
    const onCancelBulkJob = vi.fn();

    render(
      <PageIntelligencePagesHeader
        {...baseProps}
        bulkProgress={{ done: 2, total: 5 }}
        cancellableBulkJobId="job-page-analysis"
        onCancelBulkJob={onCancelBulkJob}
      />,
    );

    expect(screen.getAllByText('Analyzing 2/5...').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Cancel/i })[0]);
    expect(onCancelBulkJob).toHaveBeenCalledWith('job-page-analysis');
  });

  it('renders error, next step, and fix queue branches', () => {
    const onDismissError = vi.fn();
    const onGoToSeoEditor = vi.fn();
    const onToggleFixQueuePage = vi.fn();

    render(
      <PageIntelligencePagesHeader
        {...baseProps}
        analysisError="Provider timed out"
        showNextSteps
        fixQueue={[
          {
            page: {
              id: 'page-pricing',
              title: 'Pricing Page',
              path: '/pricing',
              source: 'static',
              analyzed: true,
            },
            score: 42,
            impressions: 1200,
            impact: 696,
          },
        ]}
        onDismissError={onDismissError}
        onGoToSeoEditor={onGoToSeoEditor}
        onToggleFixQueuePage={onToggleFixQueuePage}
      />,
    );

    expect(screen.getByText('Page Analysis Failed')).toBeTruthy();
    expect(screen.getByText('Analysis complete')).toBeTruthy();
    expect(screen.getByText('Fix These First')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Dismiss/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Go to SEO Editor/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pricing Page/i }));

    expect(onDismissError).toHaveBeenCalledOnce();
    expect(onGoToSeoEditor).toHaveBeenCalledOnce();
    expect(onToggleFixQueuePage).toHaveBeenCalledWith('page-pricing');
  });
});
