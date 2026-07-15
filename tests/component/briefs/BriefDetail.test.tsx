import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BriefDetail } from '../../../src/components/briefs/BriefDetail';
import { RequestList } from '../../../src/components/briefs/RequestList';
import type { ContentBrief, ContentTopicRequest } from '../../../shared/types/content';

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
    generationRevision: 3,
    ...overrides,
  };
}

function detailProps(brief: ContentBrief, overrides: Partial<React.ComponentProps<typeof BriefDetail>> = {}) {
  return {
    brief,
    editingBrief: null,
    generatingPostFor: null,
    regeneratingBrief: null,
    sendingToClient: null,
    onSaveBriefField: vi.fn(),
    onSetEditingBrief: vi.fn(),
    onGeneratePost: vi.fn(),
    onRegenerate: vi.fn(),
    onRegenerateOutline: vi.fn(),
    onCopyAsMarkdown: vi.fn(),
    onExportClientHTML: vi.fn(),
    onConfirmDelete: vi.fn(),
    onSendToClient: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof BriefDetail>;
}

function makeRequest(overrides: Partial<ContentTopicRequest> = {}): ContentTopicRequest {
  return {
    id: 'request-1',
    workspaceId: 'ws-1',
    topic: 'Dental financing options',
    targetKeyword: 'dental financing sarasota',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High-intent service query.',
    status: 'brief_generated',
    briefId: 'brief-1',
    requestedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function requestListProps(
  brief: ContentBrief,
  overrides: Partial<React.ComponentProps<typeof RequestList>> = {},
) {
  return {
    clientRequests: [makeRequest()],
    expandedRequest: null,
    generatingBriefFor: null,
    loadingBrief: null,
    briefError: null,
    deliveringReqId: null,
    deliveryUrl: '',
    deliveryNotes: '',
    getBriefById: (briefId: string) => briefId === brief.id ? brief : undefined,
    onToggleRequestBrief: vi.fn(),
    onGenerateBriefForRequest: vi.fn(),
    generationStyle: 'standard' as const,
    onGenerationStyleChange: vi.fn(),
    onUpdateRequestStatus: vi.fn(),
    onConfirmDeleteRequest: vi.fn(),
    onSetDeliveringReqId: vi.fn(),
    onSetDeliveryUrl: vi.fn(),
    onSetDeliveryNotes: vi.fn(),
    onSetBriefError: vi.fn(),
    onSetExpandedRequest: vi.fn(),
    onCopyAsMarkdown: vi.fn(),
    onExportClientHTML: vi.fn(),
    editingBrief: null,
    onSetEditingBrief: vi.fn(),
    onSaveBriefField: vi.fn(),
    regeneratingBrief: null,
    onRegenerateBrief: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof RequestList>;
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

    expect(onGeneratePost).toHaveBeenCalledWith('brief-1', 'hybrid', 3);
  });

  it('blocks paid post generation when the selected style belongs to an older brief revision', () => {
    const onGeneratePost = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 60 }), { onGeneratePost });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    fireEvent.change(screen.getByLabelText('Post writing style'), {
      target: { value: 'hybrid' },
    });
    rerender(<BriefDetail {...initialProps} brief={makeBrief({ generationRevision: 61 })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('changed after the writing style was selected');
    const generate = screen.getByRole('button', { name: /generate full post/i });
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(onGeneratePost).not.toHaveBeenCalled();
  });

  it('uses the rendered revision when selecting a title variant after a same-id refetch', () => {
    const onSaveBriefField = vi.fn();
    const initialProps = detailProps(makeBrief({
      suggestedTitle: 'Original title',
      titleVariants: ['Alternative title'],
      generationRevision: 70,
    }), { onSaveBriefField });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    rerender(<BriefDetail {...initialProps} brief={makeBrief({
      suggestedTitle: 'Externally refreshed title',
      titleVariants: ['Alternative title'],
      generationRevision: 71,
    })} />);
    fireEvent.click(screen.getByText('Alternative title'));

    expect(onSaveBriefField).toHaveBeenCalledWith(
      'brief-1',
      {
        suggestedTitle: 'Alternative title',
        titleVariants: ['Externally refreshed title'],
      },
      71,
    );
  });

  it('uses the rendered revision when changing a brief select after a same-id refetch', () => {
    const onSaveBriefField = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 80 }), {
      editingBrief: 'brief-1',
      onSaveBriefField,
    });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    rerender(<BriefDetail {...initialProps} brief={makeBrief({ generationRevision: 81 })} />);
    fireEvent.change(screen.getByLabelText('Brief generation style'), {
      target: { value: 'hybrid' },
    });

    expect(onSaveBriefField).toHaveBeenCalledWith(
      'brief-1',
      { generationStyle: 'hybrid' },
      81,
    );
  });

  it('preserves a focused title draft and refuses to rebase it after a same-id refetch', () => {
    const onSaveBriefField = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 20 }), {
      editingBrief: 'brief-1',
      onSaveBriefField,
    });
    const { rerender } = render(<BriefDetail {...initialProps} />);
    const title = screen.getByDisplayValue('Dental Financing in Sarasota');

    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'My live title draft' } });
    rerender(<BriefDetail
      {...initialProps}
      brief={makeBrief({ suggestedTitle: 'Externally refreshed title', generationRevision: 21 })}
    />);

    expect(title).toHaveValue('My live title draft');
    expect(screen.getByText(/This brief changed while you were editing/)).toBeInTheDocument();
    fireEvent.blur(title);
    expect(title).toHaveValue('My live title draft');
    expect(onSaveBriefField).not.toHaveBeenCalled();
  });

  it('preserves a focused summary draft and refuses to rebase it after a same-id refetch', () => {
    const onSaveBriefField = vi.fn();
    const initialProps = detailProps(makeBrief({ executiveSummary: 'Original summary', generationRevision: 30 }), {
      editingBrief: 'brief-1',
      onSaveBriefField,
    });
    const { rerender } = render(<BriefDetail {...initialProps} />);
    const summary = screen.getByDisplayValue('Original summary');

    fireEvent.focus(summary);
    fireEvent.change(summary, { target: { value: 'My live summary draft' } });
    rerender(<BriefDetail
      {...initialProps}
      brief={makeBrief({ executiveSummary: 'Externally refreshed summary', generationRevision: 31 })}
    />);

    expect(summary).toHaveValue('My live summary draft');
    expect(screen.getByText(/This brief changed while you were editing/)).toBeInTheDocument();
    fireEvent.blur(summary);
    expect(onSaveBriefField).not.toHaveBeenCalled();
  });

  it('preserves a focused outline draft and refuses to rebuild it over a newer outline revision', () => {
    const onSaveBriefField = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 40 }), {
      editingBrief: 'brief-1',
      onSaveBriefField,
    });
    const { rerender } = render(<BriefDetail {...initialProps} />);
    const heading = screen.getByDisplayValue('Quick Answers');

    fireEvent.focus(heading);
    fireEvent.change(heading, { target: { value: 'My live outline heading' } });
    rerender(<BriefDetail
      {...initialProps}
      brief={makeBrief({
        outline: [{ heading: 'Externally refreshed heading', notes: 'New notes', wordCount: 250 }],
        generationRevision: 41,
      })}
    />);

    expect(heading).toHaveValue('My live outline heading');
    expect(screen.getByText(/This brief changed while you were editing/)).toBeInTheDocument();
    fireEvent.blur(heading);
    expect(onSaveBriefField).not.toHaveBeenCalled();
  });

  it('pins a successful inline field commit to the revision observed at focus', async () => {
    const onSaveBriefField = vi.fn().mockResolvedValue(true);
    render(<BriefDetail {...detailProps(makeBrief({ generationRevision: 50 }), {
      editingBrief: 'brief-1',
      onSaveBriefField,
    })} />);
    const title = screen.getByDisplayValue('Dental Financing in Sarasota');

    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Pinned title save' } });
    fireEvent.blur(title);

    await waitFor(() => {
      expect(onSaveBriefField).toHaveBeenCalledWith(
        'brief-1',
        { suggestedTitle: 'Pinned title save' },
        50,
      );
    });
  });

  it('blocks buffered paid brief regeneration when the same brief refetches at a newer revision', () => {
    const onRegenerate = vi.fn();
    const initialBrief = makeBrief({ generationRevision: 3 });
    const initialProps = detailProps(initialBrief, { onRegenerate });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.change(screen.getByPlaceholderText(/Make it more commercial/i), {
      target: { value: 'Make the outline more decisive.' },
    });

    rerender(<BriefDetail {...initialProps} brief={makeBrief({ generationRevision: 4 })} />);

    expect(screen.getByText(/This brief changed while the form was open/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Regenerate Brief' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it('blocks buffered paid outline regeneration when the same brief refetches at a newer revision', () => {
    const onRegenerateOutline = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 5 }), { onRegenerateOutline });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Outline' }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: 'Add a comparison section.' },
    });

    rerender(<BriefDetail {...initialProps} brief={makeBrief({ generationRevision: 6 })} />);

    expect(screen.getByText(/This brief changed while the form was open/)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Regenerate' }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onRegenerateOutline).not.toHaveBeenCalled();
  });

  it('blocks a standalone send-note confirmation when the same brief refetches at a newer revision', () => {
    const onSendToClient = vi.fn();
    const initialProps = detailProps(makeBrief({ generationRevision: 7 }), { onSendToClient });
    const { rerender } = render(<BriefDetail {...initialProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send brief to client' }));
    fireEvent.change(screen.getByLabelText('Optional note for the client'), {
      target: { value: 'Please review this version.' },
    });

    rerender(<BriefDetail {...initialProps} brief={makeBrief({ generationRevision: 8 })} />);

    expect(screen.getByText(/This brief changed while the form was open/)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Send brief to client' })[1]!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSendToClient).not.toHaveBeenCalled();
  });

  it('submits each buffered brief action with the revision captured when its form opened', () => {
    const onRegenerate = vi.fn();
    const onRegenerateOutline = vi.fn();
    const onSendToClient = vi.fn();
    render(<BriefDetail {...detailProps(makeBrief({ generationRevision: 9 }), {
      onRegenerate,
      onRegenerateOutline,
      onSendToClient,
    })} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate' }).at(-1)!);
    fireEvent.change(screen.getByPlaceholderText(/Make it more commercial/i), {
      target: { value: 'Sharpen the positioning.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Brief' }));
    expect(onRegenerate).toHaveBeenCalledWith('brief-1', 'Sharpen the positioning.', 9);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Outline' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate' }).at(-1)!);
    expect(onRegenerateOutline).toHaveBeenCalledWith('brief-1', undefined, 9);

    fireEvent.click(screen.getByRole('button', { name: 'Send brief to client' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Send brief to client' })[1]!);
    expect(onSendToClient).toHaveBeenCalledWith(expect.objectContaining({ id: 'brief-1' }), undefined, 9);
  });

  it('blocks a request send-note confirmation when its linked brief refetches at a newer revision', () => {
    const onUpdateRequestStatus = vi.fn();
    const initialBrief = makeBrief({ generationRevision: 10 });
    const initialProps = requestListProps(initialBrief, { onUpdateRequestStatus });
    const { rerender } = render(<RequestList {...initialProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send to client' }));
    fireEvent.change(screen.getByLabelText('Optional note for the client'), {
      target: { value: 'Please review this brief.' },
    });

    const newerBrief = makeBrief({ generationRevision: 11 });
    rerender(<RequestList {...initialProps} getBriefById={(briefId) => briefId === newerBrief.id ? newerBrief : undefined} />);

    expect(screen.getByText(/This brief changed while the form was open/)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Send to client' })[0]!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onUpdateRequestStatus).not.toHaveBeenCalled();
  });

  it('sends a request brief using the revision captured when the note form opened', () => {
    const onUpdateRequestStatus = vi.fn();
    render(<RequestList {...requestListProps(makeBrief({ generationRevision: 12 }), { onUpdateRequestStatus })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send to client' }));
    fireEvent.change(screen.getByLabelText('Optional note for the client'), {
      target: { value: 'Please review this brief.' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to client' })[0]!);

    expect(onUpdateRequestStatus).toHaveBeenCalledWith('request-1', 'client_review', {
      clientNote: 'Please review this brief.',
      expectedBriefRevision: 12,
    });
  });
});
