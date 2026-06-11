// tests/component/PostEditor.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PostEditor } from '../../src/components/PostEditor';

// ── TipTap stub ──────────────────────────────────────────────────────────────
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => null),
  EditorContent: ({ editor: _editor }: { editor: unknown }) => (
    <div data-testid="editor-content" />
  ),
}));

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));

// ── Sub-component stubs ──────────────────────────────────────────────────────
vi.mock('../../src/components/post-editor/RichTextEditor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (html: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('../../src/components/post-editor/SectionEditor', () => ({
  SectionEditor: ({ section }: { section: { heading: string } }) => (
    <div data-testid={`section-editor-${section.heading}`}>{section.heading}</div>
  ),
}));

vi.mock('../../src/components/post-editor/PostPreview', () => ({
  PostPreview: ({ post }: { post: { title: string } }) => (
    <div data-testid="post-preview">Preview: {post.title}</div>
  ),
}));

vi.mock('../../src/components/post-editor/VersionHistory', () => ({
  VersionHistory: () => <div data-testid="version-history">Version History</div>,
}));

vi.mock('../../src/components/post-editor/ReviewChecklist', () => ({
  ReviewChecklist: () => <div data-testid="review-checklist">Review Checklist</div>,
  CHECKLIST_ITEMS: [
    { key: 'factual_accuracy', label: 'Factual accuracy verified' },
    { key: 'brand_voice', label: 'Brand voice match confirmed' },
  ],
}));

vi.mock('../../src/components/post-editor/FixDiffModal', () => ({
  FixDiffModal: () => <div data-testid="fix-diff-modal" />,
}));

// ── Hoisted mocks (referenced inside vi.mock factories) ──────────────────────
const mocks = vi.hoisted(() => ({
  contentPosts: {
    list: vi.fn(),
    getById: vi.fn(),
    versions: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    publishToWebflow: vi.fn(),
    regenerateSection: vi.fn(),
    revertVersion: vi.fn(),
    aiReview: vi.fn(),
    aifix: vi.fn(),
  },
  contentBriefs: {
    getById: vi.fn(),
  },
  useAdminPost: vi.fn(),
  useAdminPostVersions: vi.fn(),
  usePublishTarget: vi.fn(),
}));

// ── API stubs ────────────────────────────────────────────────────────────────
vi.mock('../../src/api/content', () => ({
  contentPosts: mocks.contentPosts,
  contentBriefs: mocks.contentBriefs,
}));

vi.mock('../../src/api/client', () => ({
  getText: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

// ── Hook stubs ───────────────────────────────────────────────────────────────
vi.mock('../../src/hooks/admin', () => ({
  useAdminPost: (...args: unknown[]) => mocks.useAdminPost(...args),
  useAdminPostVersions: (...args: unknown[]) => mocks.useAdminPostVersions(...args),
  usePublishTarget: (...args: unknown[]) => mocks.usePublishTarget(...args),
}));

vi.mock('../../src/hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({
    scheduleAutoSave: vi.fn(),
    flush: vi.fn().mockResolvedValue({ ok: true }),
    saveStatus: 'idle' as const,
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const DRAFT_POST = {
  id: 'post-1',
  workspaceId: 'ws-1',
  briefId: 'brief-1',
  targetKeyword: 'seo best practices',
  title: 'The Complete Guide to SEO Best Practices',
  metaDescription: 'Learn the best SEO practices for 2024.',
  seoTitle: 'SEO Best Practices Guide | hmpsn.studio',
  seoMetaDescription: 'A comprehensive guide to SEO best practices for modern websites.',
  introduction: '<p>SEO is essential for modern websites.</p>',
  sections: [
    {
      index: 0,
      heading: 'Why SEO Matters',
      content: '<p>SEO drives organic traffic.</p>',
      wordCount: 42,
      targetWordCount: 250,
      keywords: ['seo', 'organic traffic'],
      status: 'done' as const,
    },
    {
      index: 1,
      heading: 'On-Page Techniques',
      content: '<p>Use keywords wisely.</p>',
      wordCount: 38,
      targetWordCount: 300,
      keywords: ['on-page seo'],
      status: 'done' as const,
    },
  ],
  conclusion: '<p>Implement these tips today.</p>',
  totalWordCount: 850,
  targetWordCount: 1200,
  status: 'draft' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const onClose = vi.fn();
const onDelete = vi.fn();

function renderEditor(
  postOverrides?: Partial<typeof DRAFT_POST>,
  isLoading = false,
  hasPublishTarget = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const post = postOverrides
    ? { ...DRAFT_POST, ...postOverrides }
    : DRAFT_POST;

  mocks.useAdminPost.mockReturnValue({
    data: isLoading ? undefined : post,
    isLoading,
    error: null,
  });

  mocks.useAdminPostVersions.mockReturnValue({
    data: [],
    isLoading: false,
  });

  mocks.usePublishTarget.mockReturnValue({ data: hasPublishTarget });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostEditor
          workspaceId="ws-1"
          postId="post-1"
          onClose={onClose}
          onDelete={onDelete}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PostEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders without crash with mocked post data
  it('renders without crash with mocked post data', () => {
    renderEditor();
    expect(screen.getByText('The Complete Guide to SEO Best Practices')).toBeInTheDocument();
  });

  // 2. Shows loading state when post is loading
  it('shows loading spinner when post is loading', () => {
    renderEditor(undefined, true);
    // A spinner icon should be present (animate-spin class)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
    expect(screen.queryByText('The Complete Guide to SEO Best Practices')).not.toBeInTheDocument();
  });

  // 3. Renders title field with post title
  it('renders post title in the header', () => {
    renderEditor();
    expect(screen.getByText('The Complete Guide to SEO Best Practices')).toBeInTheDocument();
  });

  // 4. Renders content area (sections via SectionEditor stubs)
  it('renders body sections for the post', () => {
    renderEditor();
    expect(screen.getByTestId('section-editor-Why SEO Matters')).toBeInTheDocument();
    expect(screen.getByTestId('section-editor-On-Page Techniques')).toBeInTheDocument();
  });

  // 5. Copy button is present and clickable
  it('renders Copy button and handles click without throwing', () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderEditor();
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  // 6a. Shows "Publish to Webflow" button when hasPublishTarget is true and post is approved
  it('shows Publish to Webflow button when workspace has a publish target and post is approved', () => {
    renderEditor({ status: 'approved' }, false, true);
    expect(screen.getByRole('button', { name: /publish to webflow/i })).toBeInTheDocument();
  });

  // 6b. Does NOT show publish button when hasPublishTarget is false
  it('does not show Publish to Webflow when no publish target configured', () => {
    renderEditor({ status: 'approved' }, false, false);
    expect(screen.queryByRole('button', { name: /publish to webflow/i })).not.toBeInTheDocument();
  });

  // 6c. Shows "Published" badge when post is already published
  it('shows Published badge when post has publishedAt', () => {
    renderEditor({ status: 'approved', publishedAt: '2026-05-10T00:00:00.000Z' }, false, true);
    expect(screen.getByText(/published/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish to webflow/i })).not.toBeInTheDocument();
  });

  // 7. Close button fires onClose callback
  it('calls onClose when the close icon button is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Close editor'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 8. Error state when post fails to load
  it('renders error state when post query has an error', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mocks.useAdminPost.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    });
    mocks.useAdminPostVersions.mockReturnValue({ data: [], isLoading: false });
    mocks.usePublishTarget.mockReturnValue({ data: false });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PostEditor workspaceId="ws-1" postId="post-1" onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  // 8b. "Post not found" when data is null and no error
  it('renders "Post not found" when data is null and not loading', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mocks.useAdminPost.mockReturnValue({ data: null, isLoading: false, error: null });
    mocks.useAdminPostVersions.mockReturnValue({ data: [], isLoading: false });
    mocks.usePublishTarget.mockReturnValue({ data: false });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PostEditor workspaceId="ws-1" postId="post-1" onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Post not found')).toBeInTheDocument();
  });

  // 9. Title inline editing — pencil button opens title edit field
  it('clicking the edit title pencil switches to title edit mode', () => {
    renderEditor();
    // Pencil button is opacity-0 on group hover; we can still find it by aria-label
    const editTitleBtn = screen.getByLabelText('Edit title');
    fireEvent.click(editTitleBtn);
    expect(screen.getByDisplayValue('The Complete Guide to SEO Best Practices')).toBeInTheDocument();
  });

  // 9b. Changing title input value and saving
  it('saves updated title when save button is clicked after editing', async () => {
    mocks.contentPosts.update.mockResolvedValue({
      ...DRAFT_POST,
      title: 'Updated SEO Guide',
    });
    renderEditor();
    fireEvent.click(screen.getByLabelText('Edit title'));
    const input = screen.getByDisplayValue('The Complete Guide to SEO Best Practices');
    fireEvent.change(input, { target: { value: 'Updated SEO Guide' } });
    fireEvent.click(screen.getByLabelText('Save title'));
    await waitFor(() => {
      expect(mocks.contentPosts.update).toHaveBeenCalledWith(
        'ws-1',
        'post-1',
        expect.objectContaining({ title: 'Updated SEO Guide' }),
      );
    });
  });

  // 9c. Cancel title edit restores original title without calling update
  it('cancel title edit closes edit mode without saving', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Edit title'));
    const input = screen.getByDisplayValue('The Complete Guide to SEO Best Practices');
    fireEvent.change(input, { target: { value: 'Discarded Edit' } });
    fireEvent.click(screen.getByLabelText('Cancel title edit'));
    expect(screen.getByText('The Complete Guide to SEO Best Practices')).toBeInTheDocument();
    expect(mocks.contentPosts.update).not.toHaveBeenCalled();
  });

  // 10. Unsaved changes indicator — delete confirmation appears when trash is clicked
  it('shows delete confirmation modal when trash button is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Delete post'));
    expect(screen.getByText('Delete Post?')).toBeInTheDocument();
  });

  // 10b. Cancelling delete confirmation hides the modal
  it('hides delete modal when Cancel is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Delete post'));
    expect(screen.getByText('Delete Post?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText('Delete Post?')).not.toBeInTheDocument();
  });

  // 10c. Confirming delete calls remove and then onClose/onDelete
  it('calls remove and onClose/onDelete when delete is confirmed', async () => {
    mocks.contentPosts.remove.mockResolvedValue(undefined);
    renderEditor();
    fireEvent.click(screen.getByLabelText('Delete post'));
    const confirmDeleteBtn = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(confirmDeleteBtn);
    await waitFor(() => {
      expect(mocks.contentPosts.remove).toHaveBeenCalledWith('ws-1', 'post-1');
      expect(onDelete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // Status badge rendering
  it('renders Draft status badge for a draft post', () => {
    renderEditor({ status: 'draft' });
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders In Review status badge for a review post', () => {
    renderEditor({ status: 'review' });
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('renders Approved status badge for an approved post', () => {
    renderEditor({ status: 'approved' });
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  // Preview toggle
  it('clicking Preview button shows the PostPreview component', () => {
    renderEditor();
    expect(screen.queryByTestId('post-preview')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    expect(screen.getByTestId('post-preview')).toBeInTheDocument();
  });

  it('clicking Preview again hides the PostPreview component', () => {
    renderEditor();
    const previewBtn = screen.getByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    expect(screen.getByTestId('post-preview')).toBeInTheDocument();
    fireEvent.click(previewBtn);
    expect(screen.queryByTestId('post-preview')).not.toBeInTheDocument();
  });

  // Version history panel
  it('clicking History button shows the VersionHistory panel', () => {
    renderEditor();
    expect(screen.queryByTestId('version-history')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByTestId('version-history')).toBeInTheDocument();
  });

  // Generating state shows progress bar, not edit controls
  it('shows generation progress bar when post is generating', () => {
    renderEditor({
      status: 'generating',
      sections: [
        { ...DRAFT_POST.sections[0], status: 'done' },
        { ...DRAFT_POST.sections[1], status: 'pending' },
      ],
    });
    expect(screen.getByText(/generating post/i)).toBeInTheDocument();
    // Export/preview buttons should be hidden
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });

  // Error status shows error banner
  it('shows generation failed banner when post has error status', () => {
    renderEditor({ status: 'error' });
    expect(screen.getByText(/generation failed/i)).toBeInTheDocument();
  });

  // SEO metadata section
  it('renders SEO metadata section with title and meta description', () => {
    renderEditor();
    expect(screen.getByText('SEO Best Practices Guide | hmpsn.studio')).toBeInTheDocument();
    expect(screen.getByText('A comprehensive guide to SEO best practices for modern websites.')).toBeInTheDocument();
  });

  it('opens feedback modal from full post and requests AI preview in feedback mode', async () => {
    mocks.contentPosts.aifix.mockResolvedValue({
      field: 'post',
      originalText: JSON.stringify({
        introduction: '<p>SEO is essential for modern websites.</p>',
        sections: [{ index: 0, content: '<p>SEO drives organic traffic.</p>' }],
        conclusion: '<p>Implement these tips today.</p>',
      }),
      suggestedText: JSON.stringify({
        introduction: '<p>Rewritten introduction.</p>',
        sections: [{ index: 0, content: '<p>Rewritten section.</p>' }],
        conclusion: '<p>Rewritten conclusion.</p>',
      }),
      explanation: 'AI revised the post.',
    });

    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /generate full post with feedback/i }));
    expect(screen.getByText(/generate with feedback: full post/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/examples: make this more direct/i), {
      target: { value: 'Please tighten the full post and improve flow.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      expect(mocks.contentPosts.aifix).toHaveBeenCalledWith(
        'ws-1',
        'post-1',
        {
          mode: 'feedback',
          target: 'post',
          feedback: 'Please tighten the full post and improve flow.',
        },
      );
    });
  });

  it('opens feedback modal from SEO block and requests AI preview in meta feedback mode', async () => {
    mocks.contentPosts.aifix.mockResolvedValue({
      field: 'meta',
      originalText: JSON.stringify({
        seoTitle: 'SEO Best Practices Guide | hmpsn.studio',
        seoMetaDescription: 'A comprehensive guide to SEO best practices for modern websites.',
      }),
      suggestedText: JSON.stringify({
        seoTitle: 'Better SEO Title',
        seoMetaDescription: 'Better SEO description for the post.',
      }),
      explanation: 'AI revised metadata.',
    });

    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /generate seo with feedback/i }));
    expect(screen.getByText(/generate with feedback: seo title \+ meta description/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/examples: make this more direct/i), {
      target: { value: 'Make this metadata more compelling and benefit-led.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));

    await waitFor(() => {
      expect(mocks.contentPosts.aifix).toHaveBeenCalledWith(
        'ws-1',
        'post-1',
        {
          mode: 'feedback',
          target: 'meta',
          feedback: 'Make this metadata more compelling and benefit-led.',
        },
      );
    });
  });

  // Target keyword and word count
  it('renders target keyword and word count in the header metadata', () => {
    renderEditor();
    expect(screen.getByText('seo best practices')).toBeInTheDocument();
    expect(screen.getByText(/850/)).toBeInTheDocument();
  });

  // ReviewChecklist renders for non-approved, non-error, non-generating posts
  it('renders ReviewChecklist for draft posts', () => {
    renderEditor({ status: 'draft' });
    expect(screen.getByTestId('review-checklist')).toBeInTheDocument();
  });

  it('does NOT render ReviewChecklist for approved posts', () => {
    renderEditor({ status: 'approved' });
    expect(screen.queryByTestId('review-checklist')).not.toBeInTheDocument();
  });

  // Publish confirmation flow
  it('shows publish confirmation panel when Publish to Webflow is clicked', () => {
    renderEditor({ status: 'draft' }, false, true);
    fireEvent.click(screen.getByRole('button', { name: /publish to webflow/i }));
    // Confirmation panel heading (h3) should be visible
    expect(screen.getAllByText('Publish to Webflow').length).toBeGreaterThan(0);
    // Confirmation panel has a plain Publish button (not the header button)
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument();
  });

  it('cancels publish confirmation panel when Cancel is clicked', () => {
    renderEditor({ status: 'draft' }, false, true);
    fireEvent.click(screen.getByRole('button', { name: /publish to webflow/i }));
    // In the confirmation dialog, click Cancel
    const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtns[cancelBtns.length - 1]);
    // The confirmation panel should be gone
    expect(screen.queryByRole('button', { name: /^publish$/i })).not.toBeInTheDocument();
  });

  it('calls publishToWebflow when confirmed and shows no error on success', async () => {
    mocks.contentPosts.publishToWebflow.mockResolvedValue({ success: true });
    renderEditor({ status: 'draft' }, false, true);
    fireEvent.click(screen.getByRole('button', { name: /publish to webflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => {
      expect(mocks.contentPosts.publishToWebflow).toHaveBeenCalledWith(
        'ws-1', 'post-1', { generateImage: false },
      );
    });
  });

  it('shows publish error when publishToWebflow returns an error', async () => {
    mocks.contentPosts.publishToWebflow.mockResolvedValue({
      success: false,
      error: 'Webflow API rate limited',
    });
    renderEditor({ status: 'draft' }, false, true);
    fireEvent.click(screen.getByRole('button', { name: /publish to webflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => {
      expect(screen.getByText('Webflow API rate limited')).toBeInTheDocument();
    });
  });

  // Four Laws: no purple classes
  it('contains no purple color classes (Four Laws compliance)', () => {
    const { container } = renderEditor();
    expect(container.innerHTML).not.toMatch(/purple-/);
  });
});
