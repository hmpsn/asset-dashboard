import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClientChatWidget } from '../../../src/components/client/ClientChatWidget';
import { useChat, type ChatState, type ChatActions, type ChatDeps } from '../../../src/hooks/useChat';
import type { ChatUsageResponse } from '../../../shared/types/usage';

vi.mock('../../../src/hooks/useChat', () => ({
  useChat: vi.fn(),
}));

const mockUseChat = vi.mocked(useChat);
const noop = vi.fn();

function makeChatDeps(): ChatDeps {
  return {
    ws: { id: 'ws-1' },
    overview: {
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
      totalClicks: 10,
      totalImpressions: 100,
      avgCtr: 0.1,
      avgPosition: 4,
      topQueries: [],
      topPages: [],
    },
    trend: [],
    ga4Overview: null,
    ga4Pages: [],
    ga4Sources: [],
    ga4Devices: [],
    ga4Countries: [],
    ga4Events: [],
    ga4Conversions: [],
    searchComparison: null,
    ga4Comparison: null,
    ga4NewVsReturning: [],
    ga4Organic: null,
    audit: null,
    auditDetail: null,
    strategyData: null,
    latestRanks: [],
    activityLog: [],
    annotations: [],
    approvalBatches: [],
    requests: [],
    anomalies: [],
    days: 28,
    betaMode: false,
    effectiveTier: 'growth',
  };
}

function mockChat(overrides: Partial<ChatState & ChatActions> = {}) {
  mockUseChat.mockReturnValue({
    chatOpen: true,
    setChatOpen: noop,
    chatExpanded: false,
    setChatExpanded: noop,
    chatMessages: [],
    setChatMessages: noop,
    chatInput: '',
    setChatInput: noop,
    chatLoading: false,
    setChatLoading: noop,
    chatEndRef: createRef<HTMLDivElement>(),
    chatSessionId: 'cs-1',
    setChatSessionId: noop,
    chatHasServerBackedSession: false,
    setChatHasServerBackedSession: noop,
    chatSessions: [],
    setChatSessions: noop,
    showChatHistory: false,
    setShowChatHistory: noop,
    chatUsage: null,
    setChatUsage: noop,
    roiValue: null,
    lastIntent: null,
    clearIntent: noop,
    askAi: vi.fn(),
    ...overrides,
  });
}

function renderWidget(chatUsage: ChatUsageResponse | null, overrides: Partial<ChatState & ChatActions> = {}) {
  mockChat({ chatUsage, ...overrides });
  render(
    <MemoryRouter>
      <ClientChatWidget
        chatDeps={makeChatDeps()}
        betaMode={false}
        workspaceId="ws-1"
        ws={{ id: 'ws-1', name: 'Test Workspace' } as never}
      />
    </MemoryRouter>,
  );
}

describe('ClientChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a growth usage counter and premium upgrade lock when Growth is exhausted', () => {
    renderWidget({ allowed: false, used: 50, limit: 50, remaining: 0, tier: 'growth' });

    expect(screen.getByText('0/50 left')).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Premium for more chat access/i)).toBeInTheDocument();
  });

  it('does not show a usage counter for premium unlimited chat', () => {
    renderWidget({ allowed: true, used: 75, limit: null, remaining: null, tier: 'premium' });

    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to/i)).not.toBeInTheDocument();
  });

  it('allows follow-up input for an existing exhausted Growth conversation', () => {
    renderWidget(
      { allowed: false, used: 50, limit: 50, remaining: 0, tier: 'growth' },
      {
        chatHasServerBackedSession: true,
        chatMessages: [{ role: 'assistant', content: 'Welcome back.' }],
      },
    );

    expect(screen.getByPlaceholderText('Ask about your site data...')).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to Premium for more chat access/i)).not.toBeInTheDocument();
  });

  it('keeps exhausted local-only conversations blocked after a 429 response', () => {
    renderWidget(
      { allowed: false, used: 50, limit: 50, remaining: 0, tier: 'growth' },
      {
        chatHasServerBackedSession: false,
        chatMessages: [
          { role: 'user', content: 'Can I start anyway?' },
          { role: 'assistant', content: 'Upgrade to Premium for more chat access.' },
        ],
      },
    );

    expect(screen.queryByPlaceholderText('Ask about your site data...')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Upgrade to Premium for more chat access/i).length).toBeGreaterThan(0);
  });

  it('disables quick questions when exhausted and no server-backed conversation exists', () => {
    const askAi = vi.fn();
    renderWidget(
      { allowed: false, used: 50, limit: 50, remaining: 0, tier: 'growth' },
      { askAi },
    );

    const quickQuestion = screen.getByRole('button', { name: /What are my biggest opportunities right now/i });
    expect(quickQuestion).toBeDisabled();
    fireEvent.click(quickQuestion);
    expect(askAi).not.toHaveBeenCalled();
  });
});
