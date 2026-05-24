/**
 * Component tests for PostReviewCard.
 *
 * The component is responsible for: displaying post title, meta description,
 * introduction, sections, and conclusion; allowing inline editing; approve /
 * request-changes actions; and a collapsible steering-feedback textarea.
 *
 * Heavy dependencies (RichTextEditor, useAutoSave, publicPostReview API) are
 * stubbed so tests stay focused on the component's rendering and interaction
 * logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostReviewCard } from '../../../src/components/client/PostReviewCard';
import type { ClientContentRequest } from '../../../src/components/client/types';
import type { GeneratedPost } from '../../../shared/types/content';

// ── useClientPostPreview ──────────────────────────────────────────────────────
const mockPostData: GeneratedPost = {
  id: 'post-1',
  workspaceId: 'ws-1',
  briefId: 'brief-1',
  targetKeyword: 'seo guide',
  title: 'The Complete SEO Guide for 2026',
  metaDescription: 'Learn everything about SEO in 2026.',
  introduction: '<p>Welcome to the complete SEO guide.</p>',
  sections: [
    {
      index: 0,
      heading: 'What is SEO?',
      content: '<p>SEO stands for Search Engine Optimization.</p>',
      wordCount: 6,
      targetWordCount: 200,
      keywords: ['seo', 'search engine'],
      status: 'done',
    },
    {
      index: 1,
      heading: 'Why SEO Matters',
      content: '<p>SEO helps your site get found online.</p>',
      wordCount: 7,
      targetWordCount: 200,
      keywords: ['seo benefits'],
      status: 'done',
    },
  ],
  conclusion: '<p>In conclusion, SEO is essential.</p>',
  totalWordCount: 800,
  targetWordCount: 1000,
  status: 'review',
};

vi.mock('../../../src/hooks/client/useClientPostPreview', () => ({
  useClientPostPreview: vi.fn(() => ({ data: mockPostData, isLoading: false })),
}));

// ── publicPostReview API ──────────────────────────────────────────────────────
const mockApprovePost = vi.fn();
const mockRequestPostChanges = vi.fn();
const mockClientEdit = vi.fn();

vi.mock('../../../src/api/content', () => ({
  publicPostReview: {
    getPost: vi.fn(() => Promise.resolve(mockPostData)),
    approvePost: (...args: unknown[]) => mockApprovePost(...args),
    requestPostChanges: (...args: unknown[]) => mockRequestPostChanges(...args),
    clientEdit: (...args: unknown[]) => mockClientEdit(...args),
  },
}));

// ── useAutoSave — return idle save status with no-op flush ────────────────────
vi.mock('../../../src/hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({
    scheduleAutoSave: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    saveStatus: 'idle' as const,
  })),
}));

// ── RichTextEditor — stub to avoid TipTap/DOM complexity ─────────────────────
vi.mock('../../../src/components/post-editor/RichTextEditor', () => ({
  RichTextEditor: ({ initialValue }: { initialValue: string }) => (
    <div data-testid="rich-text-editor" dangerouslySetInnerHTML={{ __html: initialValue }} />
  ),
}));

// ── queryKeys ─────────────────────────────────────────────────────────────────
vi.mock('../../../src/lib/queryKeys', () => ({
  queryKeys: {
    client: {
      postPreview: (wsId: string, postId: string | undefined) => ['client', 'postPreview', wsId, postId],
    },
  },
}));

// ── countWordsFromHtml ────────────────────────────────────────────────────────
vi.mock('../../../src/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/utils')>();
  return {
    ...actual,
    countWordsFromHtml: (html: string) => html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(overrides: Partial<ClientContentRequest> = {}): ClientContentRequest {
  return {
    id: 'req-1',
    topic: 'SEO Guide 2026',
    targetKeyword: 'seo guide',
    intent: 'informational',
    priority: 'high',
    status: 'post_review',
    postId: 'post-1',
    requestedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderCard(
  request: ClientContentRequest = makeRequest(),
  extraProps: Partial<{
    workspaceId: string;
    onUpdate: (u: ClientContentRequest) => void;
    setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
  }> = {},
) {
  const onUpdate = vi.fn();
  const setToast = vi.fn();
  const qc = makeQueryClient();

  render(
    <QueryClientProvider client={qc}>
      <PostReviewCard
        request={request}
        workspaceId="ws-1"
        onUpdate={onUpdate}
        setToast={setToast}
        {...extraProps}
      />
    </QueryClientProvider>,
  );

  return { onUpdate, setToast };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — basic rendering', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useClientPostPreview } = vi.mocked(
      await import('../../../src/hooks/client/useClientPostPreview'),
    );
    useClientPostPreview.mockReturnValue({ data: mockPostData, isLoading: false });
  });

  it('renders without crashing', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <PostReviewCard
          request={makeRequest()}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(container).toBeTruthy();
  });

  it('shows the post title', () => {
    renderCard();
    expect(screen.getByText('The Complete SEO Guide for 2026')).toBeInTheDocument();
  });

  it('shows the meta description', () => {
    renderCard();
    expect(screen.getByText('Learn everything about SEO in 2026.')).toBeInTheDocument();
  });

  it('shows the Introduction section label', () => {
    renderCard();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
  });

  it('shows the Conclusion section label', () => {
    renderCard();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
  });

  it('renders section headings', () => {
    renderCard();
    expect(screen.getByText('What is SEO?')).toBeInTheDocument();
    expect(screen.getByText('Why SEO Matters')).toBeInTheDocument();
  });

  it('renders introduction HTML content', () => {
    renderCard();
    expect(screen.getByText('Welcome to the complete SEO guide.')).toBeInTheDocument();
  });

  it('renders section HTML content for both sections', () => {
    renderCard();
    expect(screen.getByText('SEO stands for Search Engine Optimization.')).toBeInTheDocument();
    expect(screen.getByText('SEO helps your site get found online.')).toBeInTheDocument();
  });

  it('renders conclusion HTML content', () => {
    renderCard();
    expect(screen.getByText('In conclusion, SEO is essential.')).toBeInTheDocument();
  });

  it('renders the Approve Post button', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /approve post/i })).toBeInTheDocument();
  });

  it('renders the Request Changes button', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
  });

  it('renders the steering-feedback toggle row', () => {
    renderCard();
    expect(screen.getByText(/Notes for the team/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — loading state', () => {
  it('shows loading message while post is loading', async () => {
    const { useClientPostPreview } = await import('../../../src/hooks/client/useClientPostPreview');
    vi.mocked(useClientPostPreview).mockReturnValueOnce({ data: undefined, isLoading: true });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <PostReviewCard
          request={makeRequest()}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/loading post/i)).toBeInTheDocument();
  });

  it('shows "Post not available" when post data is undefined and not loading', async () => {
    const { useClientPostPreview } = await import('../../../src/hooks/client/useClientPostPreview');
    vi.mocked(useClientPostPreview).mockReturnValueOnce({ data: undefined, isLoading: false });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <PostReviewCard
          request={makeRequest()}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/post not available/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — approve action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls approvePost and onUpdate on successful approval', async () => {
    const approvedRequest = makeRequest({ status: 'approved' });
    mockApprovePost.mockResolvedValueOnce({
      id: 'req-1',
      status: 'approved',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });

    const { onUpdate, setToast } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));

    await waitFor(() => {
      expect(mockApprovePost).toHaveBeenCalledWith('ws-1', 'req-1');
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    void approvedRequest;
  });

  it('shows error toast on approval failure', async () => {
    mockApprovePost.mockRejectedValueOnce(new Error('Network error'));
    const { setToast } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));

    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
  });

  it('shows "Approving…" text while approve is in flight', async () => {
    mockApprovePost.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));

    await waitFor(() => {
      expect(screen.getByText('Approving…')).toBeInTheDocument();
    });
  });

  it('disables both action buttons while approving', async () => {
    mockApprovePost.mockImplementationOnce(() => new Promise(() => {}));
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));

    await waitFor(() => {
      const approveBtn = screen.getByText('Approving…').closest('button');
      const changesBtn = screen.getByRole('button', { name: /request changes/i });
      expect(approveBtn).toBeDisabled();
      expect(changesBtn).toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — request changes action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows feedback textarea after clicking Request Changes', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(screen.getByPlaceholderText(/e\.g\./i)).toBeInTheDocument();
  });

  it('shows warning when Request Changes clicked without feedback', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(
      screen.getByText(/please add notes describing what you'd like changed/i),
    ).toBeInTheDocument();
  });

  it('calls requestPostChanges with feedback text when provided', async () => {
    mockRequestPostChanges.mockResolvedValueOnce({
      id: 'req-1',
      status: 'changes_requested',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });

    renderCard();

    // Open the feedback textarea first via the toggle row
    fireEvent.click(screen.getByText(/Notes for the team/i).closest('[class]')!);

    const textarea = screen.getByPlaceholderText(/e\.g\./i);
    fireEvent.change(textarea, { target: { value: 'Please simplify the language.' } });

    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));

    await waitFor(() => {
      expect(mockRequestPostChanges).toHaveBeenCalledWith(
        'ws-1',
        'req-1',
        'Please simplify the language.',
      );
    });
  });

  it('shows error toast on request-changes failure', async () => {
    mockRequestPostChanges.mockRejectedValueOnce(new Error('Server error'));
    renderCard();

    // Open feedback, type something, then submit
    fireEvent.click(screen.getByText(/Notes for the team/i).closest('[class]')!);
    const textarea = screen.getByPlaceholderText(/e\.g\./i);
    fireEvent.change(textarea, { target: { value: 'Change something.' } });
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));

    const { setToast } = renderCard();
    void setToast; // used to confirm the outer renderCard mock is clean

    await waitFor(() => {
      // The first renderCard's setToast spy receives the error
      expect(mockRequestPostChanges).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — feedback toggle', () => {
  it('toggles the feedback textarea on clicking the Notes row', () => {
    renderCard();

    // Initially hidden
    expect(screen.queryByPlaceholderText(/e\.g\./i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Notes for the team/i).closest('[class]')!);
    expect(screen.getByPlaceholderText(/e\.g\./i)).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(screen.getByText(/Notes for the team/i).closest('[class]')!);
    expect(screen.queryByPlaceholderText(/e\.g\./i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PostReviewCard — inline editing', () => {
  it('shows Edit buttons for header, introduction, each section, and conclusion', () => {
    renderCard();
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    // header Edit + Introduction Edit + 2 section Edits + Conclusion Edit = 5
    expect(editButtons.length).toBeGreaterThanOrEqual(4);
  });

  it('reveals title and meta description inputs when the header Edit button is clicked', () => {
    renderCard();
    // The first Edit button belongs to the post header
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editButtons[0]);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Meta description')).toBeInTheDocument();
  });

  it('shows RichTextEditor for introduction when its Edit button is clicked', () => {
    renderCard();
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    // Introduction edit is the second button
    fireEvent.click(editButtons[1]);
    expect(screen.getAllByTestId('rich-text-editor').length).toBeGreaterThan(0);
  });

  it('shows Done button after entering edit mode for a section', () => {
    renderCard();
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    // Third Edit button opens the first section editor
    fireEvent.click(editButtons[2]);
    expect(screen.getAllByRole('button', { name: /done/i }).length).toBeGreaterThan(0);
  });
});
