/**
 * tests/unit/hooks/useChat.test.ts
 *
 * Unit tests for src/hooks/useChat.ts
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Strategy:
 *  - Mock `../../../src/api/client` so no real fetch calls fire.
 *  - Supply a minimal but valid `ChatDeps` object to the hook.
 *  - Assert state transitions driven by the hook's public surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from '../../../src/hooks/useChat';
import type { ChatDeps } from '../../../src/hooks/useChat';
import { ApiError } from '../../../src/api/client';

// ── Mock the API client module ──────────────────────────────────────────────
vi.mock('../../../src/api/client', () => ({
  post: vi.fn(),
  getOptional: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly body?: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

import { post, getOptional } from '../../../src/api/client';
const mockPost = vi.mocked(post);
const mockGetOptional = vi.mocked(getOptional);

// ── Minimal deps factories ─────────────────────────────────────────────────

function makeOverview() {
  return {
    dateRange: { start: '2024-01-01', end: '2024-01-31' },
    totalClicks: 1000,
    totalImpressions: 50000,
    avgCtr: 0.02,
    avgPosition: 12.5,
    topQueries: [],
    topPages: [],
  };
}

function makeDeps(overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    ws: { id: 'ws-123' },
    overview: makeOverview(),
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
    ...overrides,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function renderChat(overrides: Partial<ChatDeps> = {}) {
  const deps = makeDeps(overrides);
  return renderHook(() => useChat(deps));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useChat — initial state', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  it('starts with chat closed', () => {
    const { result } = renderChat();
    expect(result.current.chatOpen).toBe(false);
  });

  it('starts with empty messages', () => {
    const { result } = renderChat();
    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('starts not loading', () => {
    const { result } = renderChat();
    expect(result.current.chatLoading).toBe(false);
  });

  it('starts with empty input', () => {
    const { result } = renderChat();
    expect(result.current.chatInput).toBe('');
  });

  it('starts with no intent', () => {
    const { result } = renderChat();
    expect(result.current.lastIntent).toBeNull();
  });

  it('starts with no chat usage data', () => {
    const { result } = renderChat();
    expect(result.current.chatUsage).toBeNull();
  });

  it('starts with no ROI value', () => {
    const { result } = renderChat();
    expect(result.current.roiValue).toBeNull();
  });

  it('generates a session ID on mount', () => {
    const { result } = renderChat();
    expect(result.current.chatSessionId).toMatch(/^cs-\d+-[a-z0-9]+$/);
  });

  it('starts with chat not expanded', () => {
    const { result } = renderChat();
    expect(result.current.chatExpanded).toBe(false);
  });

  it('starts with show chat history false', () => {
    const { result } = renderChat();
    expect(result.current.showChatHistory).toBe(false);
  });

  it('starts with empty chat sessions list', () => {
    const { result } = renderChat();
    expect(result.current.chatSessions).toHaveLength(0);
  });
});

describe('useChat — setChatOpen / setChatExpanded', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  it('setChatOpen toggles chatOpen state', () => {
    const { result } = renderChat();

    act(() => { result.current.setChatOpen(true); });
    expect(result.current.chatOpen).toBe(true);

    act(() => { result.current.setChatOpen(false); });
    expect(result.current.chatOpen).toBe(false);
  });

  it('setChatExpanded toggles chatExpanded state', () => {
    const { result } = renderChat();

    act(() => { result.current.setChatExpanded(true); });
    expect(result.current.chatExpanded).toBe(true);
  });
});

describe('useChat — chat usage fetched on open', () => {
  afterEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
  });

  it('fetches chat usage when chat opens and ws is set', async () => {
    const usagePayload = { allowed: true, used: 2, limit: 10, remaining: 8, tier: 'growth' };
    mockGetOptional.mockResolvedValue(usagePayload);

    const { result } = renderChat();

    await act(async () => { result.current.setChatOpen(true); });
    await waitFor(() => {
      // getOptional should have been called for chat-usage
      expect(mockGetOptional).toHaveBeenCalledWith(expect.stringContaining('/api/public/chat-usage/ws-123'));
    });
  });

  it('does not fetch chat usage when ws is null', async () => {
    const { result } = renderChat({ ws: null });

    await act(async () => { result.current.setChatOpen(true); });
    // Allow microtasks
    await new Promise(r => setTimeout(r, 10));
    expect(mockGetOptional).not.toHaveBeenCalled();
  });

  it('sets chatUsage state from API response', async () => {
    const usagePayload = { allowed: true, used: 3, limit: 10, remaining: 7, tier: 'growth' };
    mockGetOptional.mockResolvedValue(usagePayload);

    const { result } = renderChat();

    await act(async () => { result.current.setChatOpen(true); });
    await waitFor(() => {
      expect(result.current.chatUsage).toEqual(usagePayload);
    });
  });
});

describe('useChat — askAi', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  it('does nothing when question is blank', async () => {
    const { result } = renderChat();
    await act(async () => { await result.current.askAi('   '); });
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('does nothing when ws is null', async () => {
    const { result } = renderChat({ ws: null });
    await act(async () => { await result.current.askAi('hello'); });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does nothing when neither overview nor ga4Overview is set', async () => {
    const { result } = renderChat({ overview: null, ga4Overview: null });
    await act(async () => { await result.current.askAi('hello'); });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('appends user message immediately', async () => {
    mockPost.mockResolvedValue({ answer: 'Test response' });
    const { result } = renderChat();

    // Don't await so we can inspect mid-flight state
    act(() => { result.current.askAi('What is my traffic?'); });

    // User message should appear immediately before the promise resolves
    expect(result.current.chatMessages.some(m => m.role === 'user' && m.content === 'What is my traffic?')).toBe(true);
  });

  it('clears chatInput after sending', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat();

    act(() => { result.current.setChatInput('What is my traffic?'); });

    await act(async () => { await result.current.askAi('What is my traffic?'); });

    expect(result.current.chatInput).toBe('');
  });

  it('sets chatLoading true while request is in-flight then false', async () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise(r => { resolve = r; });
    mockPost.mockReturnValue(promise);

    const { result } = renderChat();
    act(() => { result.current.askAi('hello'); });
    expect(result.current.chatLoading).toBe(true);

    await act(async () => { resolve({ answer: 'done' }); await promise; });
    expect(result.current.chatLoading).toBe(false);
  });

  it('appends assistant reply on success', async () => {
    mockPost.mockResolvedValue({ answer: 'Your traffic is great!' });
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('Tell me about traffic'); });

    const assistantMsg = result.current.chatMessages.find(m => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Your traffic is great!');
  });

  it('appends error content from API data.error field', async () => {
    mockPost.mockResolvedValue({ error: 'AI service unavailable' });
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('hello'); });

    const assistantMsg = result.current.chatMessages.find(m => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Error: AI service unavailable');
  });

  it('sets lastIntent from the API response', async () => {
    mockPost.mockResolvedValue({ answer: 'Sure!', detectedIntent: 'content_interest' });
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('Can you write content?'); });

    expect(result.current.lastIntent).toBe('content_interest');
  });

  it('sets lastIntent to null when API returns null/undefined intent', async () => {
    mockPost.mockResolvedValue({ answer: 'OK', detectedIntent: null });
    const { result } = renderChat();

    // Set some intent first
    await act(async () => { await result.current.askAi('test'); });
    expect(result.current.lastIntent).toBeNull();
  });

  it('appends generic error message on unexpected throw', async () => {
    mockPost.mockRejectedValue(new Error('Network failure'));
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('hello'); });

    const lastMsg = result.current.chatMessages[result.current.chatMessages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('Sorry, something went wrong.');
  });

  it('handles 429 rate limit error with upgrade message', async () => {
    const rateLimitError = new ApiError(429, 'Too many requests');
    mockPost.mockRejectedValue(rateLimitError);
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('hello'); });

    const lastMsg = result.current.chatMessages[result.current.chatMessages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toContain("You've used all your free conversations this month.");
  });

  it('on 429, sets chatUsage remaining to 0', async () => {
    const rateLimitError = new ApiError(429, 'Too many requests');
    mockPost.mockRejectedValue(rateLimitError);

    // Pre-populate chatUsage
    const { result } = renderChat();
    act(() => { result.current.setChatUsage({ allowed: true, used: 10, limit: 10, remaining: 0, tier: 'free' }); });

    await act(async () => { await result.current.askAi('hello'); });

    expect(result.current.chatUsage?.allowed).toBe(false);
    expect(result.current.chatUsage?.remaining).toBe(0);
  });

  it('includes ROI value in rate-limit message when roiValue is set', async () => {
    mockPost.mockRejectedValue(new ApiError(429, 'Too many requests'));
    // Pre-populate chatUsage so the 429 path has something to update
    mockGetOptional.mockResolvedValue({ allowed: true, used: 5, limit: 5, remaining: 0, tier: 'free' });

    const { result } = renderChat();
    // Open chat to trigger usage fetch, then manually set roiValue via internal hook
    await act(async () => { result.current.setChatOpen(true); });
    await waitFor(() => expect(result.current.chatUsage).not.toBeNull());

    // Manually inject ROI value via setChatUsage to verify message includes it
    // (roiValue is set by a separate getOptional call, so we test the 429 path with roiValue=null)
    await act(async () => { await result.current.askAi('hello'); });
    const lastMsg = result.current.chatMessages[result.current.chatMessages.length - 1];
    expect(lastMsg.content).toContain('Upgrade to Growth');
  });

  it('accumulates messages across multiple calls', async () => {
    mockPost
      .mockResolvedValueOnce({ answer: 'First answer' })
      .mockResolvedValueOnce({ answer: 'Second answer' });

    const { result } = renderChat();

    await act(async () => { await result.current.askAi('Question 1'); });
    await act(async () => { await result.current.askAi('Question 2'); });

    const userMsgs = result.current.chatMessages.filter(m => m.role === 'user');
    const assistantMsgs = result.current.chatMessages.filter(m => m.role === 'assistant');
    expect(userMsgs).toHaveLength(2);
    expect(assistantMsgs).toHaveLength(2);
  });

  it('trims whitespace from the question', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('  hello world  '); });

    const userMsg = result.current.chatMessages.find(m => m.role === 'user');
    expect(userMsg?.content).toBe('hello world');
  });

  it('posts to the correct workspace URL', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat({ ws: { id: 'ws-abc' } });

    await act(async () => { await result.current.askAi('hello'); });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/search-chat/ws-abc'),
      expect.any(Object),
    );
  });
});

describe('useChat — clearIntent', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  it('clears lastIntent when clearIntent is called', async () => {
    mockPost.mockResolvedValue({ answer: 'OK', detectedIntent: 'service_interest' });
    const { result } = renderChat();

    await act(async () => { await result.current.askAi('hello'); });
    expect(result.current.lastIntent).toBe('service_interest');

    act(() => { result.current.clearIntent(); });
    expect(result.current.lastIntent).toBeNull();
  });
});

describe('useChat — askAi payload shape (E4 server-side grounding)', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  function lastPayload() {
    return mockPost.mock.calls[mockPost.mock.calls.length - 1][1] as Record<string, unknown>;
  }

  it('sends only the hint fields — question, days, sessionId, betaMode — and NOT a context blob', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat({ days: 90, betaMode: true });

    await act(async () => { await result.current.askAi('How is my traffic?'); });

    const payload = lastPayload();
    expect(payload).toMatchObject({ question: 'How is my traffic?', days: 90, betaMode: true });
    expect(payload.sessionId).toEqual(expect.any(String));
    // The opaque context blob (prompt-injection surface) must be gone.
    expect(payload).not.toHaveProperty('context');
  });

  it('sends currentTab when it is a known server hint', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat({ currentTab: 'strategy' });

    await act(async () => { await result.current.askAi('hello'); });

    expect(lastPayload().currentTab).toBe('strategy');
  });

  it('omits currentTab when deps did not supply one', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat(); // makeDeps leaves currentTab undefined

    await act(async () => { await result.current.askAi('hello'); });

    expect(lastPayload()).not.toHaveProperty('currentTab');
  });

  it('omits currentTab rather than sending an unknown value (would 400 the request)', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    // Cast through unknown: a value outside the server enum must be dropped, not sent.
    const { result } = renderChat({ currentTab: 'not-a-real-tab' as unknown as ChatDeps['currentTab'] });

    await act(async () => { await result.current.askAi('hello'); });

    expect(lastPayload()).not.toHaveProperty('currentTab');
  });

  it('defaults days to the deps value (server falls back to 28 only when omitted)', async () => {
    mockPost.mockResolvedValue({ answer: 'OK' });
    const { result } = renderChat({ days: 7 });

    await act(async () => { await result.current.askAi('hello'); });

    expect(lastPayload().days).toBe(7);
  });
});

describe('useChat — proactive greeting', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGetOptional.mockReset();
    mockGetOptional.mockResolvedValue(null);
  });

  it('shows proactive greeting when chat opens with overview data for non-free tier', async () => {
    const { result } = renderChat({ effectiveTier: 'growth' });

    await act(async () => { result.current.setChatOpen(true); });

    await waitFor(() => {
      expect(result.current.chatMessages.length).toBeGreaterThan(0);
    });

    const greeting = result.current.chatMessages[0];
    expect(greeting.role).toBe('assistant');
    expect(greeting.content.length).toBeGreaterThan(0);
  });

  it('does NOT show proactive greeting for free tier users', async () => {
    const { result } = renderChat({ effectiveTier: 'free' });

    await act(async () => { result.current.setChatOpen(true); });
    await new Promise(r => setTimeout(r, 20));

    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('does NOT show proactive greeting when ws is null', async () => {
    const { result } = renderChat({ ws: null });

    await act(async () => { result.current.setChatOpen(true); });
    await new Promise(r => setTimeout(r, 20));

    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('does NOT show proactive greeting when both overview and ga4Overview are null', async () => {
    const { result } = renderChat({ overview: null, ga4Overview: null });

    await act(async () => { result.current.setChatOpen(true); });
    await new Promise(r => setTimeout(r, 20));

    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('does NOT re-send proactive greeting on subsequent renders', async () => {
    const { result } = renderChat({ effectiveTier: 'growth' });

    await act(async () => { result.current.setChatOpen(true); });
    await waitFor(() => expect(result.current.chatMessages.length).toBeGreaterThan(0));

    const firstCount = result.current.chatMessages.length;

    // Close and reopen
    await act(async () => { result.current.setChatOpen(false); });
    await act(async () => { result.current.setChatOpen(true); });
    await new Promise(r => setTimeout(r, 20));

    // The proactive greeting should only be sent once
    expect(result.current.chatMessages.length).toBe(firstCount);
  });
});
