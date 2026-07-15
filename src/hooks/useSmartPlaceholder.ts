// src/hooks/useSmartPlaceholder.ts
// Smart placeholder hook for admin chat inputs.
// Generates suggestion chips from seoContext (brand voice, personas, businessContext).
// CRITICAL: Reads from cached seoContext intelligence slice. NO independent AI calls.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { intelligenceApi } from '../api/intelligence';
import { queryKeys } from '../lib/queryKeys';

export interface SmartPlaceholderResult {
  /** The ghost-text placeholder string for the input */
  placeholder: string;
  /**
   * 2-3 suggestion chip strings. Only populated when seoContext is available.
   */
  suggestions?: string[];
}

interface UseSmartPlaceholderOptions {
  workspaceId: string;
  isAdminContext: boolean;
  /** Allows closed or otherwise hidden consumers to defer the intelligence read. */
  enabled?: boolean;
}

/** Generic fallback when seoContext is unavailable */
function genericPlaceholder(isAdmin: boolean): SmartPlaceholderResult {
  return {
    placeholder: isAdmin
      ? 'Ask about this workspace...'
      : 'Ask a question about your site...',
  };
}

/** Industry-based placeholder when workspace has industry but thin seoContext */
function industryPlaceholder(industry: string, isAdmin: boolean): SmartPlaceholderResult {
  const industryMap: Record<string, string> = {
    'ecommerce': isAdmin ? 'Ask about product page performance...' : 'Ask about your store performance...',
    'saas': isAdmin ? 'Ask about trial conversion...' : 'Ask about your product traffic...',
    'agency': isAdmin ? 'Ask about client site performance...' : 'Ask about your service pages...',
    'legal': isAdmin ? 'Ask about practice area rankings...' : 'Ask about your practice areas...',
    'healthcare': isAdmin ? 'Ask about local search performance...' : 'Ask about your services...',
    'real-estate': isAdmin ? 'Ask about local listing performance...' : 'Ask about your listings...',
  };
  const lc = industry.toLowerCase();
  const match = Object.entries(industryMap).find(([k]) => lc.includes(k));
  return { placeholder: match ? match[1] : genericPlaceholder(isAdmin).placeholder };
}

/** Generate 2-3 suggestion chips from seoContext for admin use */
function buildAdminSuggestions(
  brandVoice: string,
  personasCount: number,
  businessContext: string,
): string[] {
  const chips: string[] = [];

  if (brandVoice && brandVoice.length > 20) {
    chips.push('What does our brand voice say about tone?');
  }
  if (personasCount > 0) {
    chips.push('Summarize our target audience');
  }
  if (businessContext && businessContext.length > 10) {
    chips.push('What services should we highlight?');
  }

  // Always include a universal chip as fallback
  if (chips.length === 0) {
    chips.push('What should I prioritize this week?');
  }

  return chips.slice(0, 3);
}

export function useSmartPlaceholder(
  { workspaceId, isAdminContext, enabled = true }: UseSmartPlaceholderOptions,
): SmartPlaceholderResult {
  // Fetch seoContext slice — reads from 5-min TTL cache on server
  // Only fetch when we have a workspaceId
  const { data: intel } = useQuery({
    queryKey: queryKeys.admin.intelligence(workspaceId, ['seoContext']),
    queryFn: ({ signal }) => intelligenceApi.getIntelligence(workspaceId, ['seoContext'], undefined, undefined, signal),
    enabled: enabled && !!workspaceId && isAdminContext,
    staleTime: 5 * 60 * 1000, // match server cache TTL
  });

  return useMemo(() => {
    const seoCtx = intel?.seoContext;

    // Thin workspace — try industry-based placeholder
    if (!seoCtx || (!seoCtx.brandVoice && !seoCtx.businessContext && (!seoCtx.personas || seoCtx.personas.length === 0))) {
      const industry = seoCtx?.businessProfile?.industry;
      if (industry) return industryPlaceholder(industry, isAdminContext);
      return genericPlaceholder(isAdminContext);
    }

    // Contextual placeholder + suggestion chips
    const placeholder = seoCtx.businessContext
      ? `Ask about ${seoCtx.businessContext.trim().slice(0, 40)}...`
      : 'Ask about this workspace...';

    const suggestions = buildAdminSuggestions(
      seoCtx.brandVoice,
      seoCtx.personas?.length ?? 0,
      seoCtx.businessContext,
    );

    return { placeholder, suggestions };
  }, [intel, isAdminContext]);
}
