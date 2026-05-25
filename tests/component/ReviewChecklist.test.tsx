import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReviewChecklist } from '../../src/components/post-editor/ReviewChecklist';
import type { AIReviewResponse } from '../../shared/types/content';

const emptyChecklist = {
  factual_accuracy: false,
  brand_voice: false,
  internal_links: false,
  no_hallucinations: false,
  meta_optimized: false,
  word_count_target: false,
};

function makeReviewResponse(): AIReviewResponse {
  return {
    review: {
      factual_accuracy: {
        pass: false,
        reason: 'Human source review required.',
        humanReviewRequired: true,
        claimsToVerify: ['Revenue grew 42% in 2026 for top-performing SaaS companies.'],
        claimEvidence: [{
          claim: 'Revenue grew 42% in 2026 for top-performing SaaS companies.',
          sourceCandidates: [{
            kind: 'serp_top_result',
            label: 'SaaS Revenue Benchmarks for 2026',
            url: 'https://www.example.com/reports/saas-revenue-benchmarks-2026',
            matchReason: 'Shares the same numeric/statistical signal as the claim.',
          }],
        }],
      },
      brand_voice: { pass: true, reason: 'Good voice match.' },
      internal_links: { pass: true, reason: 'Internal links are present.' },
      no_hallucinations: {
        pass: false,
        reason: 'Human review required.',
        humanReviewRequired: true,
        claimsToVerify: ['This quote came from a named industry analyst.'],
        claimEvidence: [{
          claim: 'This quote came from a named industry analyst.',
          sourceCandidates: [{
            kind: 'manual_unknown',
            label: 'No likely source found in saved evidence',
          }],
        }],
      },
      meta_optimized: { pass: true, reason: 'Metadata is in range.' },
      word_count_target: { pass: true, reason: 'Word count is in range.' },
    },
    evidence: {
      referenceUrls: ['https://www.example.com/reports/revenue-benchmarks'],
      peopleAlsoAsk: ['How fast can SaaS revenue grow year over year?'],
      topResults: [{
        position: 1,
        title: 'SaaS Revenue Benchmarks for 2026',
        url: 'https://www.example.com/reports/saas-revenue-benchmarks-2026',
      }],
      note: 'Reviewer support only.',
    },
  };
}

describe('ReviewChecklist', () => {
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

  it('renders saved evidence as reviewer support without automated fact-checking language', () => {
    render(
      <ReviewChecklist
        postStatus="draft"
        reviewChecklist={emptyChecklist}
        showChecklist
        onToggleShowChecklist={vi.fn()}
        onToggleItem={vi.fn()}
        onChangeStatus={vi.fn()}
        evidence={{
          referenceUrls: ['https://example.com/pricing'],
          peopleAlsoAsk: ['How much does dental SEO cost?'],
          topResults: [{ position: 1, title: 'Dental SEO pricing guide', url: 'https://example.com/pricing-guide' }],
          note: 'SERP evidence used for grounding support. Verify important factual claims against the original sources before checking provenance-sensitive items.',
        }}
      />,
    );

    expect(screen.getByText('Saved Evidence')).toBeInTheDocument();
    expect(screen.getByText('Reviewer support')).toBeInTheDocument();
    expect(screen.getByText('Reference URLs')).toBeInTheDocument();
    expect(screen.getByText('How much does dental SEO cost?')).toBeInTheDocument();
    expect(screen.getByText('Dental SEO pricing guide')).toBeInTheDocument();
    expect(screen.queryByText(/automated fact-check/i)).not.toBeInTheDocument();
  });

  it('degrades safely when cached evidence uses the older shape without reference URLs', () => {
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
          topResults: [{ position: 1, title: 'Dental SEO pricing guide', url: 'https://example.com/pricing-guide' }],
          note: 'Reviewer support only.',
        } as AIReviewResponse['evidence']}
      />,
    );

    expect(screen.getByText('Saved Evidence')).toBeInTheDocument();
    expect(screen.queryByText('Reference URLs')).not.toBeInTheDocument();
    expect(screen.getByText('Dental SEO pricing guide')).toBeInTheDocument();
  });

  it('renders claim-level evidence and explicit no-source posture after AI review', async () => {
    const onRunAIReview = vi.fn(async () => makeReviewResponse());

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

    await waitFor(() => {
      expect(screen.getAllByText('SaaS Revenue Benchmarks for 2026').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Reference URLs')).toBeInTheDocument();
    expect(screen.getByText('Revenue grew 42% in 2026 for top-performing SaaS companies.')).toBeInTheDocument();
    expect(screen.getByText(/No likely source found in the saved evidence/i)).toBeInTheDocument();
  });

  it('falls back to flat claims when claimEvidence is absent', async () => {
    const onRunAIReview = vi.fn(async () => ({
      review: {
        factual_accuracy: {
          pass: false,
          reason: 'Human source review required.',
          humanReviewRequired: true,
          claimsToVerify: ['Revenue grew 42% in 2026 for top-performing SaaS companies.'],
        },
        brand_voice: { pass: true, reason: 'Good voice match.' },
        internal_links: { pass: true, reason: 'Internal links are present.' },
        no_hallucinations: {
          pass: false,
          reason: 'Human review required.',
          humanReviewRequired: true,
          claimsToVerify: ['This quote came from a named industry analyst.'],
        },
        meta_optimized: { pass: true, reason: 'Metadata is in range.' },
        word_count_target: { pass: true, reason: 'Word count is in range.' },
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

    expect(await screen.findByText('Revenue grew 42% in 2026 for top-performing SaaS companies.')).toBeInTheDocument();
    expect(screen.queryByText(/No likely source found in the saved evidence/i)).not.toBeInTheDocument();
  });
});
