// tests/component/AdminChat.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AdminChat } from '../../src/components/AdminChat';

// jsdom doesn't implement scrollIntoView — needed by ChatPanel
Element.prototype.scrollIntoView = vi.fn();

// ── Mock API ─────────────────────────────────────────────────────────────────
const mockChatApi = {
  adminAsk: vi.fn(),
  sessions: vi.fn(),
  session: vi.fn(),
};

vi.mock('../../src/api/misc', () => ({
  chat: {
    adminAsk: (...args: unknown[]) => mockChatApi.adminAsk(...args),
    sessions: (...args: unknown[]) => mockChatApi.sessions(...args),
    session: (...args: unknown[]) => mockChatApi.session(...args),
  },
}));

// Mock useSmartPlaceholder to avoid intelligence API calls
vi.mock('../../src/hooks/useSmartPlaceholder', () => ({
  useSmartPlaceholder: () => ({
    placeholder: 'Ask anything...',
    suggestions: ['How is site performing?', 'Top pages?'],
  }),
}));

// Mock ServiceInterestCTA (pulled in via ChatPanel)
vi.mock('../../src/components/client/ServiceInterestCTA', () => ({
  ServiceInterestCTA: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function deferred<T>() {
  let settle: (value: T) => void = () => {
    throw new Error('Deferred promise resolved before initialization');
  };
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

function chatElement(queryClient: QueryClient, workspaceId: string, workspaceName: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminChat workspaceId={workspaceId} workspaceName={workspaceName} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderChat(
  workspaceId = 'ws-test',
  workspaceName = 'Test Workspace',
  queryClient?: QueryClient,
) {
  const qc = queryClient ?? makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminChat workspaceId={workspaceId} workspaceName={workspaceName} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Open the chat panel by clicking the floating button
async function openChat() {
  fireEvent.click(screen.getByRole('button', { name: /admin insights/i }));
  await screen.findByText('Admin Insights', { selector: 'span' });
  await screen.findByPlaceholderText('Ask anything...');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockChatApi.adminAsk.mockResolvedValue({ answer: 'AI response here', mode: 'analyst' });
    mockChatApi.sessions.mockResolvedValue([]);
    mockChatApi.session.mockResolvedValue({ messages: [] });
  });

  // ── Floating trigger button ───────────────────────────────────────────────

  it('renders the floating Admin Insights trigger button when closed', () => {
    renderChat();
    expect(screen.getByRole('button', { name: /admin insights/i })).toBeInTheDocument();
  });

  it('does not show the chat panel before trigger is clicked', () => {
    renderChat();
    expect(screen.queryByText('Admin Insights', { selector: 'span' })).not.toBeInTheDocument();
  });

  // ── Panel open/close ──────────────────────────────────────────────────────

  it('opens the chat panel when the floating button is clicked', async () => {
    renderChat();
    await openChat();
    // Header title is now visible as a span
    expect(screen.getByText('Admin Insights', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows workspace name in the panel header', async () => {
    renderChat('ws-test', 'Acme Corp');
    await openChat();
    // The workspace name appears as a badge in the header and in emptyExtra — at least one instance
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
  });

  it('closes the panel when the X button is clicked', async () => {
    renderChat();
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: /close chat/i }));

    await waitFor(() => {
      expect(screen.queryByText('Admin Insights', { selector: 'span' })).not.toBeInTheDocument();
    });
  });

  // ── Input field ───────────────────────────────────────────────────────────

  it('renders the chat input field when panel is open', async () => {
    renderChat();
    await openChat();
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('allows typing into the input field', async () => {
    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'How is my site doing?' } });
    expect(input.value).toBe('How is my site doing?');
  });

  // ── Sending messages ──────────────────────────────────────────────────────

  it('sends a message and calls chat.adminAsk with correct args', async () => {
    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'What are the top pages?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockChatApi.adminAsk).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-test',
          question: 'What are the top pages?',
        }),
      );
    });
  });

  it('displays the user message in the chat after sending', async () => {
    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Show me the analytics' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Show me the analytics');
  });

  it('displays AI response after the API resolves', async () => {
    mockChatApi.adminAsk.mockResolvedValue({ answer: 'Your traffic is up 10%.', mode: 'analyst' });

    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'How is traffic?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Your traffic is up 10%.');
  });

  it('clears the input after sending', async () => {
    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Status report' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('shows a fallback error message when API call fails', async () => {
    mockChatApi.adminAsk.mockRejectedValue(new Error('Network error'));

    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Sorry, something went wrong.');
  });

  // ── Quick questions ───────────────────────────────────────────────────────

  it('shows quick question cards in empty state', async () => {
    renderChat();
    await openChat();

    // Quick questions appear before any message is sent
    expect(screen.getByText('Give me a full status report on this site')).toBeInTheDocument();
  });

  it('clicking a quick question sends it to the AI', async () => {
    renderChat();
    await openChat();

    fireEvent.click(screen.getByText('Give me a full status report on this site'));

    await waitFor(() => {
      expect(mockChatApi.adminAsk).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Give me a full status report on this site',
        }),
      );
    });
  });

  // ── New session button ────────────────────────────────────────────────────

  it('shows the New conversation button after messages exist', async () => {
    mockChatApi.adminAsk.mockResolvedValue({ answer: 'Reply', mode: 'analyst' });

    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Reply');
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeInTheDocument();
  });

  it('clicking New conversation clears messages and resets session', async () => {
    mockChatApi.adminAsk.mockResolvedValue({ answer: 'AI says hello.', mode: 'analyst' });

    renderChat();
    await openChat();

    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Initial question' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Initial question');
    await screen.findByText('AI says hello.');

    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));

    await waitFor(() => {
      expect(screen.queryByText('Initial question')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('AI says hello.')).not.toBeInTheDocument();
  });

  // ── History panel ─────────────────────────────────────────────────────────

  it('clicking chat history button fetches sessions', async () => {
    mockChatApi.sessions.mockResolvedValue([
      { id: 'sess-1', title: 'Site audit chat', messageCount: 4, updatedAt: '2026-01-15T10:00:00.000Z' },
    ]);

    renderChat();
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));

    await waitFor(() => {
      expect(mockChatApi.sessions).toHaveBeenCalledWith('ws-test', 'admin');
    });
  });

  it('shows previous conversations section and session entries', async () => {
    mockChatApi.sessions.mockResolvedValue([
      { id: 'sess-1', title: 'Site audit chat', messageCount: 4, updatedAt: '2026-01-15T10:00:00.000Z' },
    ]);

    renderChat();
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));

    await screen.findByText('Previous conversations');
    expect(screen.getByText('Site audit chat')).toBeInTheDocument();
  });

  it('shows "No past conversations yet" when history is empty', async () => {
    mockChatApi.sessions.mockResolvedValue([]);

    renderChat();
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));

    await screen.findByText('No past conversations yet.');
  });

  // ── Dock/float toggle ─────────────────────────────────────────────────────

  it('renders Dock to side button in header', async () => {
    renderChat();
    await openChat();

    expect(screen.getByRole('button', { name: /dock to side/i })).toBeInTheDocument();
  });

  it('clicking dock button changes label to Float panel', async () => {
    renderChat();
    await openChat();

    fireEvent.click(screen.getByRole('button', { name: /dock to side/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /float panel/i })).toBeInTheDocument();
    });
  });

  // ── Design system compliance ──────────────────────────────────────────────

  it('contains no violet or indigo color classes', async () => {
    const { container } = renderChat();
    await openChat();
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bviolet-/);
    expect(html).not.toMatch(/\bindigo-/);
  });

  it('workspace name resets chat state when workspaceId changes', async () => {
    const { rerender } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <AdminChat workspaceId="ws-a" workspaceName="Workspace A" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Open and send a message on ws-a
    fireEvent.click(screen.getByRole('button', { name: /admin insights/i }));
    await screen.findByText('Admin Insights', { selector: 'span' });
    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Question A' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Question A');

    // Re-render with a different workspaceId
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <AdminChat workspaceId="ws-b" workspaceName="Workspace B" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Messages should be cleared after workspace change
    await waitFor(() => {
      expect(screen.queryByText('Question A')).not.toBeInTheDocument();
    });
  });

  it('does not append a late answer from the previous workspace', async () => {
    const pendingAnswer = deferred<{ answer: string; mode: string }>();
    mockChatApi.adminAsk.mockReturnValueOnce(pendingAnswer.promise);
    const queryClient = makeQueryClient();
    const { rerender } = render(chatElement(queryClient, 'ws-a', 'Workspace A'));

    await openChat();
    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'Question from A' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockChatApi.adminAsk).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-a' })));

    rerender(chatElement(queryClient, 'ws-b', 'Workspace B'));
    await waitFor(() => expect(screen.queryByText('Question from A')).not.toBeInTheDocument());

    await act(async () => {
      pendingAnswer.resolve({ answer: 'Private answer from A', mode: 'analyst' });
    });

    expect(screen.queryByText('Private answer from A')).not.toBeInTheDocument();
    expect(screen.getAllByText('Workspace B').length).toBeGreaterThan(0);
  });

  it('does not expose a late history list from the previous workspace', async () => {
    const pendingHistoryA = deferred<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>();
    const pendingHistoryB = deferred<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>();
    mockChatApi.sessions
      .mockReturnValueOnce(pendingHistoryA.promise)
      .mockReturnValueOnce(pendingHistoryB.promise);
    const queryClient = makeQueryClient();
    const { rerender } = render(chatElement(queryClient, 'ws-a', 'Workspace A'));

    await openChat();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    await waitFor(() => expect(mockChatApi.sessions).toHaveBeenCalledWith('ws-a', 'admin'));

    rerender(chatElement(queryClient, 'ws-b', 'Workspace B'));
    await waitFor(() => expect(screen.getByText('Give me a full status report on this site')).toBeInTheDocument());
    await act(async () => {
      pendingHistoryA.resolve([{ id: 'a-session', title: 'Workspace A private history', messageCount: 2, updatedAt: '2026-01-01T00:00:00.000Z' }]);
    });

    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.queryByText('Workspace A private history')).not.toBeInTheDocument();

    await act(async () => {
      pendingHistoryB.resolve([]);
    });
  });

  it('does not append a late loaded session from the previous workspace', async () => {
    const pendingSession = deferred<{ messages: Array<{ role: string; content: string }> }>();
    mockChatApi.sessions.mockResolvedValueOnce([
      { id: 'a-session', title: 'Workspace A history', messageCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    mockChatApi.session.mockReturnValueOnce(pendingSession.promise);
    const queryClient = makeQueryClient();
    const { rerender } = render(chatElement(queryClient, 'ws-a', 'Workspace A'));

    await openChat();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    fireEvent.click(await screen.findByText('Workspace A history'));
    await waitFor(() => expect(mockChatApi.session).toHaveBeenCalledWith('ws-a', 'a-session'));

    rerender(chatElement(queryClient, 'ws-b', 'Workspace B'));
    await act(async () => {
      pendingSession.resolve({ messages: [{ role: 'assistant', content: 'Private session content from A' }] });
    });

    expect(screen.queryByText('Private session content from A')).not.toBeInTheDocument();
    expect(screen.getAllByText('Workspace B').length).toBeGreaterThan(0);
  });
});
