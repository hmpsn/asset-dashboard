import { useCallback, useState, useEffect } from 'react';
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
}

export function useStrategySettings(
  keywordData: KeywordDataShape | undefined,
  strategy: StrategyShape | null,
  workspaceId: string,
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
  const [settingsOpen, setSettingsOpen] = useState(true);

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

  // Sync business context + competitors from loaded strategy
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally reacts to strategy object identity; checking individual fields would cause stale-closure issues with businessContext set-once guard
  useEffect(() => {
    if (strategy?.businessContext && !businessContext) {
      setBusinessContext(strategy.businessContext);
    }
    const savedSeoDataMode = strategy?.seoDataMode;
    if (savedSeoDataMode && savedSeoDataMode !== 'none') {
      setSeoDataMode(savedSeoDataMode);
    }
  }, [strategy]);

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
