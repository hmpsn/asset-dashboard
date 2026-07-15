// tests/component/PostEditor-section-retry.test.tsx
//
// These tests exercise the REAL useAutoSave hook + REAL SectionEditor (unlike
// PostEditor.test.tsx, which fully mocks both). The goal is to actually run the
// section-save state machine so the "retry → Done exits edit mode" regression is
// covered end to end:
//
//   1. Section save failure → retry banner visible under the FAILED section.
//   2. Retry success → Done exits edit mode (the Critical's regression test).
//   3. Retry replays the originally-failed payload against its original authority.
//   4. A newer canonical revision blocks stale retry without a PATCH.
//   5. Switching sections after a failure does not lose the retry affordance.
//
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
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
  generationRevision: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.useAdminPost.mockReturnValue({ data: POST, isLoading: false, error: null });
  mocks.useAdminPostVersions.mockReturnValue({ data: [], isLoading: false });
  mocks.usePublishTarget.mockReturnValue({ data: false });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostEditor workspaceId="ws-1" postId="post-1" onClose={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(tree());
  return {
    ...rendered,
    rerenderPost: (post: typeof POST) => {
      mocks.useAdminPost.mockReturnValue({ data: post, isLoading: false, error: null });
      rendered.rerender(tree());
    },
  };
}

// Walk up from a heading text node to the SectionEditor's SectionCard root, then
// click the Edit button scoped INSIDE that card (so we don't pick up the
// Introduction/Conclusion "Edit" buttons, which share the same label).
function sectionCardFor(heading: string): HTMLElement {
  for (const candidate of screen.getAllByText(heading)) {
    let el: HTMLElement | null = candidate;
    // The section card is the nearest ancestor that also contains an "Edit" button.
    while (el && el.parentElement) {
      el = el.parentElement;
      if (within(el).queryByRole('button', { name: /^edit$/i })) return el;
    }
  }
  throw new Error(`Could not find section card for "${heading}"`);
}

async function openSectionEditor(heading: string): Promise<HTMLTextAreaElement> {
  const card = sectionCardFor(heading);
  fireEvent.click(within(card).getByRole('button', { name: /^edit$/i }));
  // Introduction/conclusion put the Edit button in a header sibling of the
  // editor body, while body sections nest both under one card. Only one editor
  // can be active, so the global query is the stable contract for all three.
  const textarea = await screen.findByTestId('rich-text-editor');
  return textarea as HTMLTextAreaElement;
}

describe('PostEditor — section save retry (real useAutoSave + real SectionEditor)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.contentBriefs.getById.mockResolvedValue({
      id: 'brief-1',
      generationRevision: 11,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(async () => {
    cleanup();
    await Promise.resolve();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('pins the loaded source-brief revision when regenerating a section', async () => {
    mocks.contentPosts.regenerateSection.mockResolvedValue({
      ...POST,
      generationRevision: 3,
    });
    renderEditor();
    await waitFor(() => expect(mocks.contentBriefs.getById).toHaveBeenCalledWith('ws-1', 'brief-1'));

    const card = sectionCardFor('Section A');
    fireEvent.click(within(card).getByRole('button', { name: /^regenerate$/i }));

    await waitFor(() => {
      expect(mocks.contentPosts.regenerateSection).toHaveBeenCalledWith(
        'ws-1',
        'post-1',
        2,
        11,
        0,
      );
    });
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
      (c) => Array.isArray((c[3] as { sections?: unknown[] })?.sections),
    )!;
    expect(sectionCall).toBeDefined();
    expect(sectionCall[2]).toBe(2);
    const payload = sectionCall[3] as { sections: Array<{ index: number; content: string }> };
    const sectionA = payload.sections.find(s => s.index === 0)!;
    expect(sectionA.content).toBe('<p>FAILED PAYLOAD</p>');
  });

  it('does not rebase a failed section payload onto a newer canonical revision', async () => {
    mocks.contentPosts.update.mockRejectedValueOnce(new Error('save failed'));
    const rendered = renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>STALE LOCAL PAYLOAD</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    const retryBtn = await screen.findByRole('button', { name: /save failed — retry/i });
    mocks.contentPosts.update.mockClear();

    rendered.rerenderPost({
      ...POST,
      generationRevision: 3,
      updatedAt: '2026-05-01T00:00:01.000Z',
      sections: POST.sections.map(section => section.index === 0
        ? { ...section, content: '<p>NEWER EXTERNAL EDIT</p>' }
        : section),
    });
    await act(async () => { fireEvent.click(retryBtn); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save failed — retry/i })).toBeInTheDocument();
    });
    expect(mocks.contentPosts.update).not.toHaveBeenCalled();
  });

  it('starts a fresh same-authority request when introduction retry is explicit', async () => {
    mocks.contentPosts.update
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({
        ...POST,
        generationRevision: 3,
        introduction: '<p>Recovered intro</p>',
      });
    renderEditor();

    const textarea = await openSectionEditor('Introduction');
    fireEvent.change(textarea, { target: { value: '<p>Recovered intro</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    const retryBtn = await screen.findByRole('button', { name: /save failed — retry/i });

    await act(async () => { fireEvent.click(retryBtn); });
    await waitFor(() => expect(mocks.contentPosts.update).toHaveBeenCalledTimes(2));
    expect(mocks.contentPosts.update).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      'post-1',
      2,
      { introduction: '<p>Recovered intro</p>' },
    );
  });

  it('does not rebase an open title buffer onto a refetched post revision', async () => {
    const rendered = renderEditor();

    fireEvent.click(screen.getByLabelText('Edit title'));
    fireEvent.change(screen.getByDisplayValue('Test Post'), {
      target: { value: 'Operator title opened at revision two' },
    });

    rendered.rerenderPost({
      ...POST,
      title: 'External title at revision three',
      generationRevision: 3,
      updatedAt: '2026-05-01T00:00:01.000Z',
    });
    fireEvent.click(screen.getByLabelText('Save title'));
    await act(async () => { await Promise.resolve(); });

    expect(mocks.contentPosts.update).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Operator title opened at revision two')).toBeInTheDocument();
    expect(screen.getByLabelText('Save title')).toBeEnabled();
  });

  it.each([
    ['Introduction', '<p>Stale introduction buffer</p>'],
    ['Section A', '<p>Stale section buffer</p>'],
    ['Conclusion', '<p>Stale conclusion buffer</p>'],
  ])('does not rebase an open %s editor onto a refetched post revision', async (editorLabel, staleHtml) => {
    const rendered = renderEditor();
    const textarea = await openSectionEditor(editorLabel);

    rendered.rerenderPost({
      ...POST,
      introduction: '<p>External introduction</p>',
      sections: POST.sections.map(section => section.index === 0
        ? { ...section, content: '<p>External section</p>' }
        : section),
      conclusion: '<p>External conclusion</p>',
      generationRevision: 3,
      updatedAt: '2026-05-01T00:00:01.000Z',
    });
    fireEvent.change(textarea, { target: { value: staleHtml } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save failed — retry/i })).toBeInTheDocument();
    });
    expect(mocks.contentPosts.update).not.toHaveBeenCalled();
    expect(textarea).toHaveValue(staleHtml);
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

  it('serializes a newer autosave behind the in-flight save and advances its revision', async () => {
    const firstSave = deferred<typeof POST>();
    const secondSave = deferred<typeof POST>();
    mocks.contentPosts.update
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>First edit</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(mocks.contentPosts.update).toHaveBeenCalledTimes(1);
    expect(mocks.contentPosts.update).toHaveBeenNthCalledWith(
      1,
      'ws-1',
      'post-1',
      2,
      expect.any(Object),
    );

    fireEvent.change(textarea, { target: { value: '<p>Latest edit</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    // A slow first PATCH must not let the second debounce tick issue another
    // request with the same revision.
    expect(mocks.contentPosts.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve({
        ...POST,
        generationRevision: 3,
        updatedAt: '2026-05-01T00:00:01.000Z',
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(mocks.contentPosts.update).toHaveBeenCalledTimes(2));
    expect(mocks.contentPosts.update).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      'post-1',
      3,
      expect.objectContaining({
        sections: expect.arrayContaining([
          expect.objectContaining({ index: 0, content: '<p>Latest edit</p>' }),
        ]),
      }),
    );

    await act(async () => {
      secondSave.resolve({
        ...POST,
        generationRevision: 4,
        updatedAt: '2026-05-01T00:00:02.000Z',
      });
      await secondSave.promise;
    });
  });

  it('queues a second open-editor save when revision catch-up renders before the first response', async () => {
    const firstSave = deferred<typeof POST>();
    const secondSave = deferred<typeof POST>();
    mocks.contentPosts.update
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const rendered = renderEditor();

    const textarea = await openSectionEditor('Section A');
    fireEvent.change(textarea, { target: { value: '<p>First edit</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(mocks.contentPosts.update).toHaveBeenCalledTimes(1);

    rendered.rerenderPost({
      ...POST,
      generationRevision: 3,
      updatedAt: '2026-05-01T00:00:01.000Z',
      sections: POST.sections.map(section => section.index === 0
        ? { ...section, content: '<p>First edit</p>' }
        : section),
    });
    fireEvent.change(textarea, { target: { value: '<p>Second edit after catch-up</p>' } });
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(mocks.contentPosts.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstSave.resolve({
        ...POST,
        generationRevision: 3,
        updatedAt: '2026-05-01T00:00:01.000Z',
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(mocks.contentPosts.update).toHaveBeenCalledTimes(2));
    expect(mocks.contentPosts.update).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      'post-1',
      3,
      expect.objectContaining({
        sections: expect.arrayContaining([
          expect.objectContaining({ index: 0, content: '<p>Second edit after catch-up</p>' }),
        ]),
      }),
    );

    await act(async () => {
      secondSave.resolve({
        ...POST,
        generationRevision: 4,
        updatedAt: '2026-05-01T00:00:02.000Z',
      });
      await secondSave.promise;
    });
  });
});
