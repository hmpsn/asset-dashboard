// tests/component/PostEditor-section-retry.test.tsx
//
// These tests exercise the REAL useAutoSave hook + REAL SectionEditor (unlike
// PostEditor.test.tsx, which fully mocks both). The goal is to actually run the
// section-save state machine so the "retry → Done exits edit mode" regression is
// covered end to end:
//
//   1. Section save failure → retry banner visible under the FAILED section.
//   2. Retry success → Done exits edit mode (the Critical's regression test).
//   3. Retry replays the originally-failed payload.
//   4. Switching sections after a failure does not lose the retry affordance.
//
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PostEditor } from '../../src/components/PostEditor';

// ── TipTap stub (RichTextEditor uses it indirectly; we stub RichTextEditor below) ─
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => null),
  EditorContent: ({ editor: _editor }: { editor: unknown }) => <div data-testid="editor-content" />,
}));
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));

// RichTextEditor → a controlled textarea so onChange fires real strings. This is the
// ONLY editor stub; SectionEditor and useAutoSave are intentionally left real.
vi.mock('../../src/components/post-editor/RichTextEditor', () => ({
  RichTextEditor: ({ initialValue, onChange }: { initialValue: string; onChange: (html: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      defaultValue={initialValue}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Sub-components we don't care about for these flows.
vi.mock('../../src/components/post-editor/PostPreview', () => ({
  PostPreview: () => <div data-testid="post-preview" />,
}));
vi.mock('../../src/components/post-editor/VersionHistory', () => ({
  VersionHistory: () => <div data-testid="version-history" />,
}));
vi.mock('../../src/components/post-editor/ReviewChecklist', () => ({
  ReviewChecklist: () => <div data-testid="review-checklist" />,
  CHECKLIST_ITEMS: [],
}));
vi.mock('../../src/components/post-editor/FixDiffModal', () => ({
  FixDiffModal: () => <div data-testid="fix-diff-modal" />,
}));

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
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
  contentBriefs: { getById: vi.fn() },
  useAdminPost: vi.fn(),
  useAdminPostVersions: vi.fn(),
  usePublishTarget: vi.fn(),
}));

vi.mock('../../src/api/content', () => ({
  contentPosts: mocks.contentPosts,
  contentBriefs: mocks.contentBriefs,
}));
vi.mock('../../src/api/client', () => ({
  getText: vi.fn(), get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(),
}));
vi.mock('../../src/hooks/admin', () => ({
  useAdminPost: (...args: unknown[]) => mocks.useAdminPost(...args),
  useAdminPostVersions: (...args: unknown[]) => mocks.useAdminPostVersions(...args),
  usePublishTarget: (...args: unknown[]) => mocks.usePublishTarget(...args),
}));

// ── Fixture ───────────────────────────────────────────────────────────────────
const POST = {
  id: 'post-1',
  workspaceId: 'ws-1',
  briefId: 'brief-1',
  targetKeyword: 'seo',
  title: 'Test Post',
  metaDescription: 'meta',
  seoTitle: 'SEO Title',
  seoMetaDescription: 'SEO meta',
  introduction: '<p>Intro</p>',
  sections: [
    { index: 0, heading: 'Section A', content: '<p>A content</p>', wordCount: 10, targetWordCount: 100, keywords: [], status: 'done' as const },
    { index: 1, heading: 'Section B', content: '<p>B content</p>', wordCount: 10, targetWordCount: 100, keywords: [], status: 'done' as const },
  ],
  conclusion: '<p>Conclusion</p>',
  totalWordCount: 100,
  targetWordCount: 200,
  status: 'draft' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.useAdminPost.mockReturnValue({ data: POST, isLoading: false, error: null });
  mocks.useAdminPostVersions.mockReturnValue({ data: [], isLoading: false });
  mocks.usePublishTarget.mockReturnValue({ data: false });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostEditor workspaceId="ws-1" postId="post-1" onClose={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Walk up from a heading text node to the SectionEditor's SectionCard root, then
// click the Edit button scoped INSIDE that card (so we don't pick up the
// Introduction/Conclusion "Edit" buttons, which share the same label).
function sectionCardFor(heading: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(heading);
  // The section card is the nearest ancestor that also contains an "Edit" button.
  while (el && el.parentElement) {
    el = el.parentElement;
    if (within(el).queryByRole('button', { name: /^edit$/i })) return el;
  }
  throw new Error(`Could not find section card for "${heading}"`);
}

async function openSectionEditor(heading: string): Promise<HTMLTextAreaElement> {
  const card = sectionCardFor(heading);
  fireEvent.click(within(card).getByRole('button', { name: /^edit$/i }));
  const textarea = await within(card).findByTestId('rich-text-editor');
  return textarea as HTMLTextAreaElement;
}

describe('PostEditor — section save retry (real useAutoSave + real SectionEditor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('section save failure shows a retry affordance under the failed section', async () => {
    mocks.contentPosts.update.mockRejectedValue(new Error('save failed'));
    renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>A edited</p>' } });

    // Advance past the 2000ms autosave debounce so doSave runs and fails.
    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save failed — retry/i })).toBeInTheDocument();
    });
    expect(mocks.contentPosts.update).toHaveBeenCalled();
  });

  it('retry success lets Done exit edit mode (Critical regression)', async () => {
    // First save (autosave) fails, retry save succeeds.
    mocks.contentPosts.update
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(POST);
    renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>A edited</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    const retryBtn = await screen.findByRole('button', { name: /save failed — retry/i });
    await act(async () => { fireEvent.click(retryBtn); });

    // After a successful retry the banner clears.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save failed — retry/i })).not.toBeInTheDocument();
    });

    // Done must now exit edit mode — the editor textarea disappears.
    const doneBtn = screen.getByRole('button', { name: /^done$/i });
    await act(async () => { fireEvent.click(doneBtn); });

    await waitFor(() => {
      expect(screen.queryAllByTestId('rich-text-editor').length).toBe(0);
    });
  });

  it('retry replays the originally-failed payload', async () => {
    mocks.contentPosts.update
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(POST);
    renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>FAILED PAYLOAD</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    const retryBtn = await screen.findByRole('button', { name: /save failed — retry/i });
    mocks.contentPosts.update.mockClear();
    await act(async () => { fireEvent.click(retryBtn); });

    await waitFor(() => expect(mocks.contentPosts.update).toHaveBeenCalled());
    // The retry call must carry the section content that originally failed. Find the
    // update call whose payload includes a `sections` array (the section save path);
    // other autosave paths (intro/conclusion) would send different keys.
    const sectionCall = mocks.contentPosts.update.mock.calls.find(
      (c) => Array.isArray((c[2] as { sections?: unknown[] })?.sections),
    )!;
    expect(sectionCall).toBeDefined();
    const payload = sectionCall[2] as { sections: Array<{ index: number; content: string }> };
    const sectionA = payload.sections.find(s => s.index === 0)!;
    expect(sectionA.content).toBe('<p>FAILED PAYLOAD</p>');
  });

  it('switching sections after a failure keeps the retry affordance for the failed section', async () => {
    // Section A autosave fails; the failure must remain visible after the user moves on.
    mocks.contentPosts.update.mockRejectedValue(new Error('save failed'));
    renderEditor();

    const textareaA = await openSectionEditor('Section A');
    fireEvent.change(textareaA, { target: { value: '<p>A edited</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    await screen.findByRole('button', { name: /save failed — retry/i });

    // Attempt to switch to Section B by clicking its Edit button. onStartEdit flushes
    // Section A's pending save first; since the flush fails, the switch is blocked and
    // the retry affordance for Section A remains.
    const cardB = sectionCardFor('Section B');
    await act(async () => { fireEvent.click(within(cardB).getByRole('button', { name: /^edit$/i })); });

    // The retry affordance for the failed section is still present (not lost on switch).
    expect(screen.getByRole('button', { name: /save failed — retry/i })).toBeInTheDocument();
  });
});
