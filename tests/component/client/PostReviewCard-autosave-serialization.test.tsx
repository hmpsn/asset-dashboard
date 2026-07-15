import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicContentPost } from '../../../shared/types/content';
import type { ClientContentRequest } from '../../../src/components/client/types';
import { PostReviewCard } from '../../../src/components/client/PostReviewCard';

const mocks = vi.hoisted(() => ({
  approvePost: vi.fn(),
  clientEdit: vi.fn(),
  requestPostChanges: vi.fn(),
  useClientPostPreview: vi.fn(),
}));

vi.mock('../../../src/hooks/client/useClientPostPreview', () => ({
  useClientPostPreview: (...args: unknown[]) => mocks.useClientPostPreview(...args),
}));

vi.mock('../../../src/api/content', () => ({
  publicPostReview: {
    approvePost: (...args: unknown[]) => mocks.approvePost(...args),
    requestPostChanges: (...args: unknown[]) => mocks.requestPostChanges(...args),
    clientEdit: (...args: unknown[]) => mocks.clientEdit(...args),
  },
}));

vi.mock('../../../src/components/post-editor/RichTextEditor', () => ({
  RichTextEditor: ({ initialValue, onChange }: { initialValue: string; onChange: (html: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      defaultValue={initialValue}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const INITIAL_POST: PublicContentPost = {
  id: 'post-1',
  workspaceId: 'ws-1',
  briefId: 'brief-1',
  targetKeyword: 'seo guide',
  title: 'Original title',
  metaDescription: 'Original meta',
  introduction: '<p>Original intro</p>',
  sections: [{
    index: 0,
    heading: 'Section one',
    content: '<p>Original section</p>',
    wordCount: 2,
    targetWordCount: 100,
    keywords: [],
    status: 'done',
  }],
  conclusion: '<p>Original conclusion</p>',
  totalWordCount: 10,
  targetWordCount: 100,
  status: 'review',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const REQUEST: ClientContentRequest = {
  id: 'request-1',
  topic: 'SEO guide',
  targetKeyword: 'seo guide',
  intent: 'informational',
  priority: 'high',
  status: 'post_review',
  postId: 'post-1',
  requestedAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const UNSAVED_EDIT_MESSAGE = 'Some edits could not be saved. Refresh before approving or sending feedback.';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PostReviewCard autosave serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.useClientPostPreview.mockReturnValue({ data: INITIAL_POST, isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes sibling field saves, advances updatedAt, and preserves the later local buffer', async () => {
    const titleSave = deferred<PublicContentPost>();
    const metaSave = deferred<PublicContentPost>();
    mocks.clientEdit
      .mockImplementationOnce(() => titleSave.promise)
      .mockImplementationOnce(() => metaSave.promise);
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: 'Updated title' } });
    fireEvent.change(screen.getByDisplayValue('Original meta'), { target: { value: 'Latest local meta' } });
    await act(async () => { vi.advanceTimersByTime(1200); });

    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);
    expect(mocks.clientEdit).toHaveBeenNthCalledWith(
      1,
      'ws-1',
      'post-1',
      INITIAL_POST.updatedAt,
      { title: 'Updated title' },
    );

    await act(async () => {
      titleSave.resolve({
        ...INITIAL_POST,
        title: 'Updated title',
        updatedAt: '2026-05-01T00:00:01.000Z',
      });
      await titleSave.promise;
    });

    await waitFor(() => expect(mocks.clientEdit).toHaveBeenCalledTimes(2));
    expect(mocks.clientEdit).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      'post-1',
      '2026-05-01T00:00:01.000Z',
      { metaDescription: 'Latest local meta' },
    );
    expect(screen.getByDisplayValue('Latest local meta')).toBeInTheDocument();

    await act(async () => {
      metaSave.resolve({
        ...INITIAL_POST,
        title: 'Updated title',
        metaDescription: 'Latest local meta',
        updatedAt: '2026-05-01T00:00:02.000Z',
      });
      await metaSave.promise;
    });

    expect(setToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('surfaces a conditional-write conflict without retrying it', async () => {
    const conflict = new Error('This post changed since you opened it. Refresh before saving again.');
    mocks.clientEdit.mockRejectedValue(conflict);
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: 'Conflicting title' } });
    await act(async () => { vi.advanceTimersByTime(1200); });

    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({ message: conflict.message, type: 'error' });
    });

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(screen.getByDisplayValue('Conflicting title')).toBeInTheDocument();
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));
    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({ message: UNSAVED_EDIT_MESSAGE, type: 'error' });
    });
    expect(mocks.approvePost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/notes for the team/i).closest('[class]')!);
    fireEvent.change(screen.getByPlaceholderText(/please make the tone less formal/i), {
      target: { value: 'Please revise this.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({ message: UNSAVED_EDIT_MESSAGE, type: 'error' });
    });
    expect(mocks.requestPostChanges).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);
  });

  it('rejects a debounced edit authored before a newer canonical post arrives', async () => {
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue('Original title'), {
      target: { value: 'Stale local title' },
    });

    mocks.useClientPostPreview.mockReturnValue({
      data: {
        ...INITIAL_POST,
        title: 'External title',
        updatedAt: '2026-05-01T00:00:01.000Z',
      },
      isLoading: false,
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));

    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({
        message: expect.stringContaining('changed while you were editing'),
        type: 'error',
      });
    });
    expect(mocks.clientEdit).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Stale local title')).toBeInTheDocument();
  });

  it('refreshes the closed editor before a refetch-first edit is authored', async () => {
    const refreshedPost: PublicContentPost = {
      ...INITIAL_POST,
      title: 'Canonical refetched title',
      updatedAt: '2026-05-01T00:00:01.000Z',
    };
    mocks.clientEdit.mockResolvedValue({
      ...refreshedPost,
      title: 'Edit based on the refetched title',
      updatedAt: '2026-05-01T00:00:02.000Z',
    });
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>
    );
    const view = render(tree());

    mocks.useClientPostPreview.mockReturnValue({ data: refreshedPost, isLoading: false });
    view.rerender(tree());

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    expect(screen.getByDisplayValue('Canonical refetched title')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Canonical refetched title'), {
      target: { value: 'Edit based on the refetched title' },
    });
    await act(async () => { vi.advanceTimersByTime(1200); });

    await waitFor(() => {
      expect(mocks.clientEdit).toHaveBeenCalledWith(
        'ws-1',
        'post-1',
        refreshedPost.updatedAt,
        { title: 'Edit based on the refetched title' },
      );
    });
    expect(setToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('blocks text authored after an already-open editor observes a refetch', async () => {
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>
    );
    const view = render(tree());

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    mocks.useClientPostPreview.mockReturnValue({
      data: {
        ...INITIAL_POST,
        title: 'External title',
        updatedAt: '2026-05-01T00:00:01.000Z',
      },
      isLoading: false,
    });
    view.rerender(tree());
    fireEvent.change(screen.getByDisplayValue('Original title'), {
      target: { value: 'Stale open-editor title' },
    });
    await act(async () => { vi.advanceTimersByTime(1200); });

    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({
        message: expect.stringContaining('changed while you were editing'),
        type: 'error',
      });
    });
    expect(mocks.clientEdit).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Stale open-editor title')).toBeInTheDocument();
  });

  it('does not retry or approve when an in-flight autosave fails during Approve', async () => {
    const save = deferred<PublicContentPost>();
    const conflict = new Error('This post changed while your edit was saving. Refresh before trying again.');
    mocks.clientEdit.mockReturnValue(save.promise);
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: 'In-flight title' } });
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /approve post/i }));
    await act(async () => { save.reject(conflict); });

    await waitFor(() => {
      expect(setToast).toHaveBeenCalledWith({ message: UNSAVED_EDIT_MESSAGE, type: 'error' });
    });
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);
    expect(mocks.approvePost).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('In-flight title')).toBeInTheDocument();
  });

  it('queues a second open-editor save when updatedAt catch-up renders before the first response', async () => {
    const firstSave = deferred<PublicContentPost>();
    const secondSave = deferred<PublicContentPost>();
    mocks.clientEdit
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const setToast = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={setToast}
        />
      </QueryClientProvider>
    );
    const view = render(tree());

    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue('Original title'), {
      target: { value: 'First client edit' },
    });
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);

    mocks.useClientPostPreview.mockReturnValue({
      data: {
        ...INITIAL_POST,
        title: 'First client edit',
        updatedAt: '2026-05-01T00:00:01.000Z',
      },
      isLoading: false,
    });
    view.rerender(tree());
    fireEvent.change(screen.getByDisplayValue('First client edit'), {
      target: { value: 'Second client edit after catch-up' },
    });
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(mocks.clientEdit).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve({
        ...INITIAL_POST,
        title: 'First client edit',
        updatedAt: '2026-05-01T00:00:01.000Z',
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(mocks.clientEdit).toHaveBeenCalledTimes(2));
    expect(mocks.clientEdit).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      'post-1',
      '2026-05-01T00:00:01.000Z',
      { title: 'Second client edit after catch-up' },
    );

    await act(async () => {
      secondSave.resolve({
        ...INITIAL_POST,
        title: 'Second client edit after catch-up',
        updatedAt: '2026-05-01T00:00:02.000Z',
      });
      await secondSave.promise;
    });
    expect(setToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('coalesces section heading and content into one latest debounced snapshot', async () => {
    mocks.clientEdit.mockResolvedValue({
      ...INITIAL_POST,
      sections: [{
        ...INITIAL_POST.sections[0],
        heading: 'Updated heading',
        content: '<p>Updated section content</p>',
        wordCount: 3,
      }],
      updatedAt: '2026-05-01T00:00:01.000Z',
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PostReviewCard
          request={REQUEST}
          workspaceId="ws-1"
          onUpdate={vi.fn()}
          setToast={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const sectionHeading = screen.getByText('Section one');
    const sectionCard = sectionHeading.closest('.rounded-\\[var\\(--radius-lg\\)\\]') as HTMLElement;
    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[2]);
    const editor = await screen.findByTestId('rich-text-editor');
    expect(sectionCard).toContainElement(editor);

    fireEvent.change(editor, { target: { value: '<p>Updated section content</p>' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    fireEvent.change(screen.getByDisplayValue('Section one'), {
      target: { value: 'Updated heading' },
    });

    // Rich-text editor mounting can advance the shared fake clock during a
    // broad affected-test run. The contract here is one coalesced save with the
    // latest heading + content snapshot, not the timer's exact 1,999 ms edge.
    await act(async () => { vi.advanceTimersByTime(2000); });

    await waitFor(() => expect(mocks.clientEdit).toHaveBeenCalledTimes(1));
    expect(mocks.clientEdit).toHaveBeenCalledWith(
      'ws-1',
      'post-1',
      INITIAL_POST.updatedAt,
      {
        sections: [{
          index: 0,
          heading: 'Updated heading',
          content: '<p>Updated section content</p>',
          wordCount: 3,
        }],
      },
    );
  });
});
