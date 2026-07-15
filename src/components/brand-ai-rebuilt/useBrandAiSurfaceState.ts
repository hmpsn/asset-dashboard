// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const BRAND_AI_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'context', label: 'Context' },
  { id: 'brandscript', label: 'Brandscript' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'voice', label: 'Voice' },
  { id: 'identity', label: 'Identity' },
  { id: 'business-footprint', label: 'Business Footprint' },
  { id: 'eeat-assets', label: 'E-E-A-T Assets' },
  { id: 'intelligence-profile', label: 'Intelligence Profile' },
] as const;

export type BrandAiTab = typeof BRAND_AI_TABS[number]['id'];
export type BrandAiLegacyTab = 'business-profile' | 'locations';
export type BusinessFootprintFocus = BrandAiLegacyTab | null;

const BRAND_AI_TAB_VALUES = new Set<string>(BRAND_AI_TABS.map((tab) => tab.id));

export const BRAND_AI_TAB_ALIASES: Record<BrandAiLegacyTab, BrandAiTab> = {
  'business-profile': 'business-footprint',
  locations: 'business-footprint',
};

const TAB_PARAM = 'tab';
const FOCUS_PARAM = 'focus';
const DEFAULT_TAB: BrandAiTab = 'overview';

function isBrandAiTab(value: string | null | undefined): value is BrandAiTab {
  return typeof value === 'string' && BRAND_AI_TAB_VALUES.has(value);
}

function isBrandAiLegacyTab(value: string | null | undefined): value is BrandAiLegacyTab {
  return value === 'business-profile' || value === 'locations';
}

export function resolveBrandAiTab(value: string | null | undefined): BrandAiTab {
  if (isBrandAiTab(value)) return value;
  if (isBrandAiLegacyTab(value)) return BRAND_AI_TAB_ALIASES[value];
  return DEFAULT_TAB;
}

export interface UseBrandAiSurfaceStateReturn {
  tab: BrandAiTab;
  rawTab: string | null;
  focus: string | null;
  legacyBusinessFootprintSection: BusinessFootprintFocus;
  setTab: (tab: BrandAiTab, focus?: string | null) => void;
  setFocus: (focus: string | null) => void;
}

type ParamValue = string | null | undefined;

export function useBrandAiSurfaceState(): UseBrandAiSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get(TAB_PARAM);
  const tab = resolveBrandAiTab(rawTab);
  const focus = searchParams.get(FOCUS_PARAM);
  const legacyBusinessFootprintSection = isBrandAiLegacyTab(rawTab) ? rawTab : null;

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setTab = useCallback((nextTab: BrandAiTab, nextFocus: string | null = null) => {
    updateParams({
      [TAB_PARAM]: nextTab === DEFAULT_TAB ? null : nextTab,
      [FOCUS_PARAM]: nextFocus,
    });
  }, [updateParams]);

  const setFocus = useCallback((nextFocus: string | null) => {
    updateParams({ [FOCUS_PARAM]: nextFocus });
  }, [updateParams]);

  return {
    tab,
    rawTab,
    focus,
    legacyBusinessFootprintSection,
    setTab,
    setFocus,
  };
}
