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
      factual_accuracy: { pass: true, reason: 'Looks fine', humanReviewRequired: true },
      brand_voice: { pass: true, reason: 'Matches voice' },
      internal_links: { pass: true, reason: 'Links present' },
      no_hallucinations: { pass: true, reason: 'No issue found', humanReviewRequired: true },
      meta_optimized: { pass: true, reason: 'Metadata is good' },
      word_count_target: { pass: true, reason: 'In range' },
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
});
