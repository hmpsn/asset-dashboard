import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageIntelligencePageList } from '../../src/components/page-intelligence/PageIntelligencePageList';
import type { KeywordData } from '../../src/components/page-intelligence/pageIntelligenceTypes';
import type { UnifiedPage } from '../../shared/types/page-join';

type PageListProps = ComponentProps<typeof PageIntelligencePageList>;

const page: UnifiedPage = {
  id: 'page-pricing',
  title: 'Pricing',
  path: '/pricing',
  slug: 'pricing',
  source: 'static',
  analyzed: true,
  strategy: {
    pagePath: '/pricing',
    pageTitle: 'Pricing',
    primaryKeyword: 'pricing keyword',
    secondaryKeywords: ['pricing seo'],
    searchIntent: 'commercial',
    optimizationScore: 55,
    optimizationIssues: ['Missing schema markup'],
    recommendations: ['Improve the title'],
    contentGaps: ['Add pricing FAQs'],
    volume: 900,
    difficulty: 38,
  },
};

const analysis: KeywordData = {
  primaryKeyword: 'pricing keyword',
  primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
  secondaryKeywords: ['pricing seo'],
  longTailKeywords: ['seo pricing packages'],
  searchIntent: 'commercial',
  searchIntentConfidence: 0.84,
  contentGaps: ['Add pricing FAQs'],
  competitorKeywords: ['seo cost'],
  optimizationScore: 52,
  optimizationIssues: ['Missing schema markup'],
  recommendations: ['Improve the title'],
  estimatedDifficulty: 'medium',
  keywordDifficulty: 38,
  monthlyVolume: 900,
  topicCluster: 'pricing',
};

const baseProps: PageListProps = {
  pages: [page],
  search: '',
  expandedPageId: null,
  analyzingPageIds: new Set(),
  analyses: {},
  contentScores: {},
  editingPageId: null,
  editDraft: { primary: '', secondary: '' },
  saving: false,
  seoCopyResults: new Map(),
  generatingCopy: null,
  copiedField: null,
  trackedKeywords: new Set(),
  onToggleExpanded: vi.fn(),
  onTrackKeyword: vi.fn(),
  onStartEdit: vi.fn(),
  onEditDraftChange: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onAnalyzePage: vi.fn(),
  onGenerateSeoCopy: vi.fn(),
  onCopyText: vi.fn(),
  onOpenSeoEditor: vi.fn(),
  onCreateBrief: vi.fn(),
  onAddSchema: vi.fn(),
  onViewFullAnalysis: vi.fn(),
};

describe('PageIntelligencePageList rendering', () => {
  it('renders collapsed page rows and delegates expansion/tracking callbacks', () => {
    const onToggleExpanded = vi.fn();
    const onTrackKeyword = vi.fn();

    render(
      <PageIntelligencePageList
        {...baseProps}
        onToggleExpanded={onToggleExpanded}
        onTrackKeyword={onTrackKeyword}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Pricing/i }));
    fireEvent.click(screen.getByTitle('Track in Rank Tracker'));

    expect(onToggleExpanded).toHaveBeenCalledWith('page-pricing');
    expect(onTrackKeyword).toHaveBeenCalledWith('pricing keyword');
  });

  it('renders expanded analysis actions and delegates navigation callbacks', () => {
    const onOpenSeoEditor = vi.fn();
    const onCreateBrief = vi.fn();
    const onAddSchema = vi.fn();
    const onAnalyzePage = vi.fn();

    render(
      <PageIntelligencePageList
        {...baseProps}
        expandedPageId="page-pricing"
        analyses={{ 'page-pricing': analysis }}
        onOpenSeoEditor={onOpenSeoEditor}
        onCreateBrief={onCreateBrief}
        onAddSchema={onAddSchema}
        onAnalyzePage={onAnalyzePage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Re-analyze/i }));
    fireEvent.click(screen.getByRole('button', { name: /Fix in SEO Editor/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Brief/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add Schema/i }));

    expect(screen.getByText('AI Analysis')).toBeTruthy();
    expect(onAnalyzePage).toHaveBeenCalledWith(page);
    expect(onOpenSeoEditor).toHaveBeenCalledWith(page);
    expect(onCreateBrief).toHaveBeenCalledWith(page, analysis);
    expect(onAddSchema).toHaveBeenCalledWith(page);
  });

  it('delegates SEO copy generation and copy actions through the list boundary', () => {
    const onGenerateSeoCopy = vi.fn();
    const onCopyText = vi.fn();
    const seoCopyResults = new Map([
      ['/pricing', {
        seoTitle: 'Better SEO Pricing',
        metaDescription: 'Clear SEO pricing for growing teams.',
        h1: 'SEO Pricing',
        introParagraph: 'Choose the right SEO package for your growth goals.',
      }],
    ]);

    const { rerender } = render(
      <PageIntelligencePageList
        {...baseProps}
        expandedPageId="page-pricing"
        onGenerateSeoCopy={onGenerateSeoCopy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Generate SEO Copy/i }));
    expect(onGenerateSeoCopy).toHaveBeenCalledWith(page);

    rerender(
      <PageIntelligencePageList
        {...baseProps}
        expandedPageId="page-pricing"
        seoCopyResults={seoCopyResults}
        onCopyText={onCopyText}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /Copy/i })[0]);
    expect(onCopyText).toHaveBeenCalledWith('Better SEO Pricing', 'seoTitle');
  });

  it('renders keyword edit controls and empty state branches', () => {
    const onEditDraftChange = vi.fn();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    const { rerender } = render(
      <PageIntelligencePageList
        {...baseProps}
        expandedPageId="page-pricing"
        editingPageId="page-pricing"
        editDraft={{ primary: 'old keyword', secondary: 'old secondary' }}
        onEditDraftChange={onEditDraftChange}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('old keyword'), { target: { value: 'new keyword' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onEditDraftChange).toHaveBeenCalledWith({ primary: 'new keyword', secondary: 'old secondary' });
    expect(onSaveEdit).toHaveBeenCalledWith(page);
    expect(onCancelEdit).toHaveBeenCalledOnce();

    rerender(<PageIntelligencePageList {...baseProps} pages={[]} search="missing" />);
    expect(screen.getByText('No pages match your search.')).toBeTruthy();
  });
});
