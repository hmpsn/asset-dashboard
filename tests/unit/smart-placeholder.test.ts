// tests/unit/smart-placeholder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

// Mock feature flags
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(),
}));

// Mock intelligence API
vi.mock('../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { useFeatureFlag } from '../../src/hooks/useFeatureFlag';
import { intelligenceApi } from '../../src/api/intelligence';
import { useSmartPlaceholder } from '../../src/hooks/useSmartPlaceholder';

const mockUseFeatureFlag = vi.mocked(useFeatureFlag);
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

  it('flag off → returns generic placeholder, no suggestions', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(result.current.placeholder).toBe('Ask about this workspace...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('flag off + client context → generic client placeholder', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: createWrapper() }
    );
    expect(result.current.placeholder).toBe('Ask a question about your site...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('flag on + client context → no suggestions (always)', () => {
    mockUseFeatureFlag.mockReturnValue(true);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: createWrapper() }
    );
    // Client context must never expose suggestion chips
    expect(result.current.suggestions).toBeUndefined();
  });

  it('does NOT call getIntelligence when flag is off', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('does NOT call getIntelligence when workspaceId is empty', () => {
    mockUseFeatureFlag.mockReturnValue(true);
    renderHook(
      () => useSmartPlaceholder('field', { workspaceId: '', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('placeholder is always a non-empty string', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    const { result } = renderHook(
      () => useSmartPlaceholder('field', { workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: createWrapper() }
    );
    expect(typeof result.current.placeholder).toBe('string');
    expect(result.current.placeholder.length).toBeGreaterThan(0);
  });
});
