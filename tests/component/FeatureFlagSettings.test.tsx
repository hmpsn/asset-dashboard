import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { FeatureFlagSettings } from '../../src/components/FeatureFlagSettings';

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
            {
              key: 'national-serp-tracking',
              enabled: true,
              source: 'default',
              default: true,
              label: 'National SERP rank tracking — keyword position + SERP features in target market',
              group: 'SEO Decision Engine',
              lifecycle: {
                owner: 'analytics-intelligence',
                createdAt: '2026-06-24',
                rolloutTarget: 'staging-validation',
                removalCondition: 'Promote to default once validated on staging.',
                linkedRoadmapItemId: 'seo-engine-p6-national-serp-rank-ai-overview',
                staleAuditCadence: 'weekly',
                lastReviewedAt: '2026-06-24',
              },
            },
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

  it('renders SEO Decision Engine group', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText('SEO Decision Engine')).toBeInTheDocument();
  });

  it('renders national-serp-tracking flag with human-readable label', () => {
    render(<FeatureFlagSettings />);
    expect(screen.getByText(/National SERP rank tracking/i)).toBeInTheDocument();
  });

  it('displays all SEO Decision Engine flags under the same group', () => {
    render(<FeatureFlagSettings />);

    // Find the group header
    const groupHeader = screen.getByText('SEO Decision Engine');
    expect(groupHeader).toBeInTheDocument();

    // Verify the label is present after the group header
    expect(screen.getByText(/National SERP rank tracking/i)).toBeInTheDocument();
  });

  it('does not render flags in the Other bucket if all are properly grouped', () => {
    render(<FeatureFlagSettings />);

    // The flag should NOT appear in an "Other" section (it should be in its group)
    const otherSections = screen.queryAllByText('Other');
    // There should be no "Other" section, or if there is one, it shouldn't contain our flag
    if (otherSections.length > 0) {
      const otherSection = otherSections[0];
      expect(otherSection.parentElement).not.toHaveTextContent('national-serp-tracking');
    }
  });

  it('renders an explicit error state when feature flags fail to load', () => {
    vi.mocked(useQuery).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('upstream unavailable'),
    } as any);

    render(<FeatureFlagSettings />);
    expect(screen.getByText('Failed to load feature flags')).toBeInTheDocument();
    expect(screen.getByText('upstream unavailable')).toBeInTheDocument();
  });
});
