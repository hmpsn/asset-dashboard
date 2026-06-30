import { useCallback, useState, useEffect, useRef } from 'react';
import { keywords } from '../../../api/seo';

type SeoProviderOption = { name: string; configured: boolean };

function defaultSeoDataProvider(providers: SeoProviderOption[]): string | undefined {
  const configured = providers.filter(provider => provider.configured);
  return configured.find(provider => provider.name === 'dataforseo')?.name
    ?? configured[0]?.name;
}

interface KeywordDataShape {
  seoDataAvailable?: boolean;
  workspaceData?: {
    competitorDomains?: string[];
    seoDataProvider?: string;
  } | null;
  providers?: SeoProviderOption[];
  strategy?: {
    businessContext?: string;
    seoDataMode?: 'none' | 'quick' | 'full';
  } | null;
}

interface StrategyShape {
  businessContext?: string;
  seoDataMode?: 'none' | 'quick' | 'full';
  maxPages?: number;
}

export function useStrategySettings(
  keywordData: KeywordDataShape | undefined,
  strategy: StrategyShape | null,
  workspaceId: string,
  /**
   * Collapse the Settings panel initially. Defaults to false (open) to preserve legacy
   * byte-identical behavior; pass true to start Settings collapsed on initial render.
   */
  collapsedByDefault = false,
) {
  const seoDataAvailableFromHook = keywordData?.seoDataAvailable || false;
  const savedSeoDataProvider = keywordData?.workspaceData?.seoDataProvider;

  const [businessContext, setBusinessContext] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [seoDataAvailable, setSeoDataAvailable] = useState(seoDataAvailableFromHook);
  const [seoDataMode, setSeoDataMode] = useState<'none' | 'quick' | 'full'>('none');
  const [maxPages, setMaxPages] = useState<number>(500);
  const [competitors, setCompetitors] = useState('');
  const [discoveringCompetitors, setDiscoveringCompetitors] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(collapsedByDefault ? false : true);

  // Derive providerList before selectedSeoDataProvider so the computed value has access to it
  const providerList = keywordData?.providers ?? [];
  const selectedSeoDataProvider = savedSeoDataProvider
    ?? defaultSeoDataProvider(providerList)
    ?? 'dataforseo';

  // Initialize SEO provider availability from React Query hook
  useEffect(() => {
    setSeoDataAvailable(seoDataAvailableFromHook);
    if (seoDataAvailableFromHook) {
      // Default to quick mode when an SEO data provider is available
      setSeoDataMode(prev => prev === 'none' ? 'quick' : prev);
    } else {
      setSeoDataMode('none');
    }
  }, [seoDataAvailableFromHook]);

  // Load saved competitor domains from React Query hook data
  useEffect(() => {
    if (keywordData?.workspaceData?.competitorDomains?.length && !competitors) {
      setCompetitors(keywordData.workspaceData.competitorDomains.join(', '));
    }
  }, [keywordData?.workspaceData?.competitorDomains, competitors]);

  // Track whether each strategy-derived setting has been hydrated once, so a
  // background refetch (new strategy object identity) never clobbers an in-session user edit.
  const maxPagesHydratedRef = useRef(false);
  const seoDataModeHydratedRef = useRef(false);
  // settingsOpen is initialized once from collapsedByDefault, but the value may arrive async
  // (React Query): on a cold cache it's `false` on first render, so the panel would mount EXPANDED.
  // Force-collapse ONCE when collapsedByDefault resolves to true; never re-collapse after, so a
  // manual toggle sticks. When collapsedByDefault stays false this ref never fires → parity.
  const collapsedAppliedRef = useRef(false);

  // Sync business context + competitors from loaded strategy
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally reacts to strategy object identity; checking individual fields would cause stale-closure issues with businessContext set-once guard
  useEffect(() => {
    if (strategy?.businessContext && !businessContext) {
      setBusinessContext(strategy.businessContext);
    }
    const savedSeoDataMode = strategy?.seoDataMode;
    if (savedSeoDataMode && savedSeoDataMode !== 'none' && !seoDataModeHydratedRef.current) {
      setSeoDataMode(savedSeoDataMode);
      seoDataModeHydratedRef.current = true;
    }
    if (strategy?.maxPages != null && !maxPagesHydratedRef.current) {
      setMaxPages(strategy.maxPages);
      maxPagesHydratedRef.current = true;
    }
  }, [strategy]);

  // Collapse the settings panel once the bands flag resolves on (see collapsedAppliedRef above).
  useEffect(() => {
    if (collapsedByDefault && !collapsedAppliedRef.current) {
      setSettingsOpen(false);
      collapsedAppliedRef.current = true;
    }
  }, [collapsedByDefault]);

  const buildStrategyGenerationParams = useCallback(() => {
    const compList = competitors.trim()
      ? competitors.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
      : undefined;
    return {
      businessContext: businessContext.trim() || undefined,
      seoDataMode: seoDataAvailable ? seoDataMode : 'none',
      seoDataProvider: selectedSeoDataProvider,
      competitorDomains: compList,
      maxPages,
    };
  }, [businessContext, competitors, maxPages, selectedSeoDataProvider, seoDataAvailable, seoDataMode]);

  const discoverCompetitors = async () => {
    setDiscoveringCompetitors(true);
    setDiscoverError(null);
    try {
      const result = await keywords.discoverCompetitors(workspaceId);
      if (result?.competitors?.length) {
        const domains = result.competitors.slice(0, 5).map((c: { domain: string }) => c.domain);
        setCompetitors(domains.join(', '));
        await keywords.saveCompetitors(workspaceId, domains);
      } else {
        setDiscoverError('No organic competitors were found for this domain.');
      }
    } catch (err: any) {
      setDiscoverError(err?.message || 'Failed to discover competitors. Check that your domain is set and DataForSEO is configured.');
    } finally {
      setDiscoveringCompetitors(false);
    }
  };

  return {
    businessContext,
    setBusinessContext,
    contextOpen,
    setContextOpen,
    seoDataAvailable,
    seoDataMode,
    setSeoDataMode,
    maxPages,
    setMaxPages,
    competitors,
    setCompetitors,
    settingsOpen,
    setSettingsOpen,
    discoveringCompetitors,
    discoverError,
    discoverCompetitors,
    selectedSeoDataProvider,
    buildStrategyGenerationParams,
  };
}
