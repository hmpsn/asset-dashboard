import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FeatureFlagSettings } from '../../src/components/FeatureFlagSettings';
import type { UseQueryResult } from '@tanstack/react-query';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
  put: vi.fn(),
}));

// Mock React Query hooks
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey, queryFn }: any) => {
      // Return mock flag data for the feature flags query
      if (queryKey[0] === 'admin-feature-flags') {
        return {
          data: [
            { key: 'smart-placeholders', enabled: true, source: 'default', default: true },
            { key: 'client-brand-section', enabled: false, source: 'default', default: false },
            { key: 'seo-editor-unified', enabled: true, source: 'default', default: true },
            { key: 'outcome-tracking', enabled: true, source: 'default', default: true },
          ],
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return { data: undefined, isLoading: false, isError: false, error: null };
    }),
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
  };
});

// Mock the Toast hook
vi.mock('../../src/components/Toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

describe('FeatureFlagSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the feature flags header', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText('Feature Flags')).toBeInTheDocument();
  });

  it('renders Platform Intelligence Enhancements group', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText('Platform Intelligence Enhancements')).toBeInTheDocument();
  });

  it('renders smart-placeholders flag with human-readable label', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/Smart placeholders/i)).toBeInTheDocument();
  });

  it('renders client-brand-section flag with human-readable label', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/Brand tab/i)).toBeInTheDocument();
  });

  it('renders seo-editor-unified flag with human-readable label', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/SEO editor/i)).toBeInTheDocument();
  });

  it('displays all three new flags under the same group', () => {
    render(<FeatureFlagSettings />);

    // Find the group header
    const groupHeader = screen.getByText('Platform Intelligence Enhancements');
    expect(groupHeader).toBeInTheDocument();

    // Verify all three labels are present after the group header
    expect(screen.getByText(/Smart placeholders/i)).toBeInTheDocument();
    expect(screen.getByText(/Brand tab/i)).toBeInTheDocument();
    expect(screen.getByText(/SEO editor/i)).toBeInTheDocument();
  });

  it('does not render flags in the Other bucket if all are properly grouped', () => {
    render(<FeatureFlagSettings />);

    // The three new flags should NOT appear in an "Other" section
    // (they should be in their group)
    const otherSections = screen.queryAllByText('Other');
    // There should be no "Other" section, or if there is one, it shouldn't contain our flags
    if (otherSections.length > 0) {
      const otherSection = otherSections[0];
      expect(otherSection.parentElement).not.toHaveTextContent('smart-placeholders');
      expect(otherSection.parentElement).not.toHaveTextContent('client-brand-section');
      expect(otherSection.parentElement).not.toHaveTextContent('seo-editor-unified');
    }
  });
});
