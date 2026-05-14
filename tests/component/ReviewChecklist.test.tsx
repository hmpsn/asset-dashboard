import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReviewChecklist } from '../../src/components/post-editor/ReviewChecklist';

const emptyChecklist = {
  factual_accuracy: false,
  brand_voice: false,
  internal_links: false,
  no_hallucinations: false,
  meta_optimized: false,
  word_count_target: false,
};

describe('ReviewChecklist AI pre-check', () => {
  it('does not auto-check provenance-sensitive items', async () => {
    const onToggleItem = vi.fn();
    const onRunAIReview = vi.fn(async () => ({
      review: {
        factual_accuracy: { pass: true, reason: 'Looks fine', humanReviewRequired: true },
        brand_voice: { pass: true, reason: 'Matches voice' },
        internal_links: { pass: true, reason: 'Links present' },
        no_hallucinations: { pass: true, reason: 'No issue found', humanReviewRequired: true },
        meta_optimized: { pass: true, reason: 'Metadata is good' },
        word_count_target: { pass: true, reason: 'In range' },
      },
    }));

    render(
      <ReviewChecklist
        postStatus="draft"
        reviewChecklist={emptyChecklist}
        showChecklist
        onToggleShowChecklist={vi.fn()}
        onToggleItem={onToggleItem}
        onChangeStatus={vi.fn()}
        onRunAIReview={onRunAIReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /AI Pre-Check/i }));

    await waitFor(() => {
      expect(onToggleItem).toHaveBeenCalledWith('brand_voice');
      expect(onToggleItem).toHaveBeenCalledWith('internal_links');
      expect(onToggleItem).toHaveBeenCalledWith('meta_optimized');
      expect(onToggleItem).toHaveBeenCalledWith('word_count_target');
    });
    expect(onToggleItem).not.toHaveBeenCalledWith('factual_accuracy');
    expect(onToggleItem).not.toHaveBeenCalledWith('no_hallucinations');
    expect(await screen.findAllByText('Human review')).toHaveLength(2);
  });

  it('uses SERP evidence returned by the AI review response', async () => {
    const onRunAIReview = vi.fn(async () => ({
      review: {
        factual_accuracy: { pass: false, reason: 'Needs source review', humanReviewRequired: true },
        brand_voice: { pass: true, reason: 'Matches voice' },
        internal_links: { pass: true, reason: 'Links present' },
        no_hallucinations: { pass: false, reason: 'Needs source review', humanReviewRequired: true },
        meta_optimized: { pass: true, reason: 'Metadata is good' },
        word_count_target: { pass: true, reason: 'In range' },
      },
      evidence: {
        peopleAlsoAsk: ['Which local SEO statistics matter?'],
        topResults: [{ position: 2, title: 'Local SEO data', url: 'https://example.com/local-seo' }],
        note: 'Reviewer support only.',
      },
    }));

    render(
      <ReviewChecklist
        postStatus="draft"
        reviewChecklist={emptyChecklist}
        showChecklist
        onToggleShowChecklist={vi.fn()}
        onToggleItem={vi.fn()}
        onChangeStatus={vi.fn()}
        onRunAIReview={onRunAIReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /AI Pre-Check/i }));

    expect(await screen.findByText('Which local SEO statistics matter?')).toBeInTheDocument();
    expect(screen.getByText('Local SEO data')).toBeInTheDocument();
  });

  it('renders SERP evidence as reviewer support without auto-fact-checking language', () => {
    render(
      <ReviewChecklist
        postStatus="draft"
        reviewChecklist={emptyChecklist}
        showChecklist
        onToggleShowChecklist={vi.fn()}
        onToggleItem={vi.fn()}
        onChangeStatus={vi.fn()}
        evidence={{
          peopleAlsoAsk: ['How much does dental SEO cost?'],
          topResults: [{ position: 1, title: 'Dental SEO pricing guide', url: 'https://example.com/pricing' }],
          note: 'SERP evidence used for grounding support. Verify important factual claims against the original sources before checking provenance-sensitive items.',
        }}
      />,
    );

    expect(screen.getByText('SERP Evidence')).toBeInTheDocument();
    expect(screen.getByText('Reviewer support')).toBeInTheDocument();
    expect(screen.getByText('How much does dental SEO cost?')).toBeInTheDocument();
    expect(screen.getByText('Dental SEO pricing guide')).toBeInTheDocument();
    expect(screen.queryByText(/automated fact-check/i)).not.toBeInTheDocument();
  });
});
