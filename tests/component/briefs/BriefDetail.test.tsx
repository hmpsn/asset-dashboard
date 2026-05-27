import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BriefDetail } from '../../../src/components/briefs/BriefDetail';
import type { ContentBrief } from '../../../shared/types/content';

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: 'brief-1',
    workspaceId: 'ws-1',
    targetKeyword: 'dental financing sarasota',
    secondaryKeywords: [],
    suggestedTitle: 'Dental Financing in Sarasota',
    suggestedMetaDesc: 'Clear dental financing options in Sarasota.',
    outline: [
      { heading: 'Quick Answers', notes: 'Overview', wordCount: 200 },
    ],
    wordCountTarget: 900,
    intent: 'commercial',
    audience: 'Sarasota dental patients',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    generationStyle: 'standard',
    ...overrides,
  };
}

describe('BriefDetail', () => {
  it('passes the selected writing style when generating a full post', () => {
    const onGeneratePost = vi.fn();

    render(
      <BriefDetail
        brief={makeBrief()}
        editingBrief={null}
        generatingPostFor={null}
        regeneratingBrief={null}
        sendingToClient={null}
        onSaveBriefField={vi.fn()}
        onSetEditingBrief={vi.fn()}
        onGeneratePost={onGeneratePost}
        onRegenerate={vi.fn()}
        onCopyAsMarkdown={vi.fn()}
        onExportClientHTML={vi.fn()}
        onConfirmDelete={vi.fn()}
        onSendToClient={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Post writing style'), {
      target: { value: 'hybrid' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate full post/i }));

    expect(onGeneratePost).toHaveBeenCalledWith('brief-1', 'hybrid');
  });
});
