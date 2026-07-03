// tests/unit/smart-placeholder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

// Mock intelligence API
vi.mock('../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { intelligenceApi } from '../../src/api/intelligence';
import { useSmartPlaceholder } from '../../src/hooks/useSmartPlaceholder';

const mockGetIntelligence = vi.mocked(intelligenceApi.getIntelligence);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const richIntel = {
  version: 1 as const,
  workspaceId: 'ws1',
  assembledAt: new Date().toISOString(),
  seoContext: {
    strategy: undefined,
    brandVoice: 'Clear, professional, and approachable tone for SMB owners.',
    effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nClear, professional, and approachable tone for SMB owners.',
    businessContext: 'Digital marketing agency serving Austin TX businesses',
    personas: [{ name: 'SMB Owner', description: 'Small business owner 35-55' }],
    knowledgeBase: '',
  },
};

describe('useSmartPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIntelligence.mockResolvedValue(richIntel as never);
  });

  it('client context → no API call and no suggestions (isAdminContext gates the query; no caller passes false today)', () => {
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: createWrapper() }
    );
    // Query is gated on isAdminContext — never fires for client
    expect(mockGetIntelligence).not.toHaveBeenCalled();
    expect(result.current.suggestions).toBeUndefined();
    expect(result.current.placeholder).toBe('Ask a question about your site...');
  });

  it('admin context + rich intel → suggestions array and contextual placeholder', async () => {
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.suggestions).toBeDefined();
    });
    expect(result.current.suggestions!.length).toBeGreaterThan(0);
    expect(result.current.suggestions!.length).toBeLessThanOrEqual(3);
    expect(result.current.placeholder).toContain('Ask about');
  });

  it('suggestions include brand voice chip when brandVoice is present', async () => {
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.suggestions).toBeDefined();
    });
    expect(result.current.suggestions!.some(s => /brand voice/i.test(s))).toBe(true);
  });

  it('does NOT call getIntelligence when workspaceId is empty', () => {
    renderHook(
      () => useSmartPlaceholder({ workspaceId: '', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('placeholder is always a non-empty string', async () => {
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.suggestions).toBeDefined();
    });
    expect(typeof result.current.placeholder).toBe('string');
    expect(result.current.placeholder.length).toBeGreaterThan(0);
  });
});
