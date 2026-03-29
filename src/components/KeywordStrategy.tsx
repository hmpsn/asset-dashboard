import { useState, useEffect } from 'react';
import {
  Loader2, Target, ChevronDown, ChevronRight, RefreshCw,
  AlertCircle, Sparkles, Briefcase,
  BarChart3, Users, Search, FileText,
  Eye, MousePointerClick, Trophy, AlertTriangle, Plus, Check,
} from 'lucide-react';
import { StatCard, AIContextIndicator } from './ui';
import { useKeywordStrategy } from '../hooks/admin';
import { useQueryClient } from '@tanstack/react-query';
import { BacklinkProfile } from './strategy/BacklinkProfile';
import { CompetitiveIntel } from './strategy/CompetitiveIntel';
import { ContentGaps } from './strategy/ContentGaps';
import { QuickWins } from './strategy/QuickWins';
import { KeywordGaps } from './strategy/KeywordGaps';
import { LowHangingFruit } from './strategy/LowHangingFruit';
import { TopicClusters } from './strategy/TopicClusters';
import { CannibalizationAlert } from './strategy/CannibalizationAlert';
import { StrategyDiff } from './strategy/StrategyDiff';
import { IntelligenceSignals } from './strategy/IntelligenceSignals';
import { keywords, rankTracking } from '../api/seo';
import { workspaces } from '../api';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../lib/wsEvents';
import { queryKeys } from '../lib/queryKeys';

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: 'exact' | 'partial_match' | 'ai_estimate';
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

interface Props {
  workspaceId: string;
  siteId?: string;
}

export function KeywordStrategyPanel({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // React Query hook replaces manual data fetching
  const { data: keywordData, isLoading: loading } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;
  const semrushAvailableFromHook = keywordData?.semrushAvailable || false;
  const [businessContext, setBusinessContext] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [semrushAvailable, setSemrushAvailable] = useState(semrushAvailableFromHook);
  const [semrushMode, setSemrushMode] = useState<'none' | 'quick' | 'full'>('none');
  const [maxPages, setMaxPages] = useState<number>(500);
  const [competitors, setCompetitors] = useState('');
  const [discoveringCompetitors, setDiscoveringCompetitors] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());
  const [providerList, setProviderList] = useState<{ name: string; configured: boolean }[]>([]);
  const [activeProvider, setActiveProvider] = useState<string | undefined>(undefined);

  // Invalidate intelligence signals cache on WebSocket event
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceSignals(workspaceId) });
    },
  });

  // Seed trackedKeywords from server on mount so buttons reflect actual state
  useEffect(() => {
    rankTracking.keywords(workspaceId)
      .then(kws => setTrackedKeywords(new Set((kws || []).map(k => k.query))))
      .catch(() => {});
  }, [workspaceId]);

  // Load provider status + workspace preference
  useEffect(() => {
    keywords.providerStatus()
      .then(data => { if (data?.providers) setProviderList(data.providers); })
      .catch(() => {});
    workspaces.getById(workspaceId)
      .then((ws: Record<string, unknown>) => { if (ws?.seoDataProvider) setActiveProvider(ws.seoDataProvider as string); })
      .catch(() => {});
  }, [workspaceId]);

  const stepLabels: Record<string, string> = {
    discovery: 'Discovering pages',
    content: 'Fetching page content',
    search_data: 'Search Console data',
    semrush: 'Keyword intelligence',
    ai: 'AI analysis',
    enrichment: 'Enriching data',
    complete: 'Complete',
  };

  
  // Initialize SEMRush availability from React Query hook
  useEffect(() => {
    if (semrushAvailableFromHook) {
      setSemrushAvailable(true);
      // Default to quick mode when SEMRush is available
      setSemrushMode(prev => prev === 'none' ? 'quick' : prev);
    }
  }, [semrushAvailableFromHook]);

  // Load saved competitor domains from React Query hook data
  useEffect(() => {
    if (keywordData?.workspaceData?.competitorDomains?.length && !competitors) {
      setCompetitors(keywordData.workspaceData.competitorDomains.join(', '));
    }
  }, [keywordData?.workspaceData?.competitorDomains, competitors]);

  // Sync business context + competitors from loaded strategy
  useEffect(() => {
    if (strategy?.businessContext && !businessContext) {
      setBusinessContext(strategy.businessContext);
    }
    if (strategy?.semrushMode && strategy.semrushMode !== 'none') {
      setSemrushMode(strategy.semrushMode);
    }
  }, [strategy]);

  const generateStrategy = async () => {
    setGenerating(true);
    setError(null);
    setProgressStep('');
    setProgressDetail('');
    setProgressPct(0);
    try {
      const compList = competitors.trim() ? competitors.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) : undefined;
      const res = await fetch(`/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          businessContext: businessContext.trim() || undefined,
          semrushMode: semrushAvailable ? semrushMode : 'none',
          competitorDomains: compList,
          maxPages: maxPages || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        // Non-streaming error response (429, 400, 500, etc.) or no streaming support
        const data = await res.json();
        if (!res.ok || data.error) { setError(data.message || data.error || 'Request failed'); } else { queryClient.invalidateQueries({ queryKey: ['keyword-strategy', workspaceId] }); }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.error) { setError(evt.error); break; }
            if (evt.done && evt.strategy) { queryClient.invalidateQueries({ queryKey: ['keyword-strategy', workspaceId] }); break; }
            if (evt.step) { setProgressStep(evt.step); setProgressDetail(evt.detail || ''); setProgressPct(evt.progress || 0); }
          } catch (err) { console.error('KeywordStrategy operation failed:', err); }
        }
      }
    } catch (err) {
      console.error('KeywordStrategy operation failed:', err);
      setError('Failed to generate strategy');
    } finally {
      setGenerating(false);
      setProgressStep('');
    }
  };

  const trackKeyword = async (kw: string) => {
    if (trackedKeywords.has(kw)) return;
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      setTrackedKeywords(prev => new Set(prev).add(kw));
    } catch {
      // silently ignore duplicates — server deduplicates
    }
  };

  const positionColor = (pos?: number) => {
    if (!pos) return 'text-zinc-500';
    if (pos <= 3) return 'text-emerald-400';
    if (pos <= 10) return 'text-green-400';
    if (pos <= 20) return 'text-amber-400';
    return 'text-red-400';
  };

  const difficultyColor = (kd?: number) => {
    if (kd === undefined) return 'text-zinc-500';
    if (kd <= 30) return 'text-emerald-400';
    if (kd <= 50) return 'text-amber-400';
    if (kd <= 70) return 'text-orange-400';
    return 'text-red-400';
  };

  const intentColor = (intent?: string) => {
    switch (intent) {
      case 'commercial': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'informational': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'transactional': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'navigational': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  // Computed metrics
  const pageMap: PageKeywordMap[] = strategy?.pageMap || [];
  const ranked = pageMap.filter((p: PageKeywordMap) => p.currentPosition);
  const avgPos = ranked.length > 0 ? ranked.reduce((s: number, p: PageKeywordMap) => s + (p.currentPosition || 0), 0) / ranked.length : 0;
  const totalImpressions = pageMap.reduce((s: number, p: PageKeywordMap) => s + (p.impressions || 0), 0);
  const totalClicks = pageMap.reduce((s: number, p: PageKeywordMap) => s + (p.clicks || 0), 0);
  const top3 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 3);
  const top10 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 10 && (p.currentPosition || 0) > 3);
  const top20 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 20 && (p.currentPosition || 0) > 10);
  const beyond20 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 0) > 20);
  const notRankingCount = pageMap.length - ranked.length;

  const lowHangingFruit = ranked
    .filter((p: PageKeywordMap) => (p.currentPosition || 0) >= 4 && (p.currentPosition || 0) <= 20 && (p.impressions || 0) > 20)
    .sort((a: PageKeywordMap, b: PageKeywordMap) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 6);

  const intentCounts = pageMap.reduce((acc: Record<string, number>, p: PageKeywordMap) => {
    const intent = p.searchIntent || 'unknown';
    acc[intent] = (acc[intent] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="ml-3 text-sm text-zinc-400">Loading keyword strategy...</span>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No workspace selected. Link a workspace to generate a keyword strategy.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Keyword Strategy</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {strategy
              ? `Generated ${new Date(strategy.generatedAt).toLocaleDateString()} · ${strategy.pageMap.length} pages mapped`
              : 'AI-powered keyword mapping for your entire site'}
          </p>
        </div>
        <button
          onClick={generateStrategy}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {generating ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
          ) : strategy ? (
            <><RefreshCw className="w-3 h-3" /> Regenerate</>
          ) : (
            <><Sparkles className="w-3 h-3" /> Generate Strategy</>
          )}
        </button>
      </div>

      {!strategy && !generating && (
        <AIContextIndicator workspaceId={workspaceId} feature="strategy" />
      )}

      <IntelligenceSignals workspaceId={workspaceId} />

      {/* Progress Indicator */}
      {generating && progressStep && (
        <div className="bg-zinc-900 rounded-xl border border-teal-500/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
              <span className="text-xs font-medium text-zinc-200">{stepLabels[progressStep] || progressStep}</span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">{Math.round(progressPct * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.round(progressPct * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-500">{progressDetail}</p>
        </div>
      )}

      {/* Settings Panel */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-zinc-300">Strategy Settings</span>
            {!settingsOpen && (
              <span className="text-[11px] text-zinc-500">
                {semrushMode !== 'none' ? `SEMRush: ${semrushMode}` : ''}
                {maxPages > 0 ? `${semrushMode !== 'none' ? ' · ' : ''}${maxPages} pages max` : `${semrushMode !== 'none' ? ' · ' : ''}All pages`}
                {businessContext ? ` · Context set` : ''}
                {competitors.trim() ? ` · ${competitors.split(/[,\n]+/).filter(Boolean).length} competitors` : ''}
              </span>
            )}
          </div>
          {settingsOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        </button>
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* SEO Data Provider */}
            {providerList.filter(p => p.configured).length > 1 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="w-3.5 h-3.5 text-teal-400" />
                  <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">SEO Data Provider</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {providerList.filter(p => p.configured).map(p => (
                    <button
                      key={p.name}
                      onClick={() => {
                        setActiveProvider(p.name);
                        workspaces.update(workspaceId, { seoDataProvider: p.name }).catch(() => {});
                      }}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        (activeProvider || 'semrush') === p.name
                          ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <div className="font-semibold capitalize">{p.name === 'dataforseo' ? 'DataForSEO' : 'SEMRush'}</div>
                      <div className="text-[10px] mt-0.5 opacity-70">
                        {p.name === 'dataforseo' ? 'Pay-as-you-go' : 'Subscription'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  {(activeProvider || 'semrush') === 'dataforseo'
                    ? 'DataForSEO: pay-per-call pricing (~$0.01-0.08/call). Uses same cache layer.'
                    : 'SEMRush: subscription-based. Traditional keyword intelligence provider.'}
                </p>
              </div>
            )}

            {/* SEMRush Mode */}
            {semrushAvailable && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">SEMRush Data Mode</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['none', 'quick', 'full'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setSemrushMode(mode)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        semrushMode === mode
                          ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <div className="font-semibold capitalize">{mode === 'none' ? 'Off' : mode}</div>
                      <div className="text-[11px] mt-0.5 opacity-70">
                        {mode === 'none' && 'AI + GSC only'}
                        {mode === 'quick' && '~500 credits'}
                        {mode === 'full' && '~7,500 credits'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  {semrushMode === 'quick' && 'Enriches keywords with real search volume + difficulty scores from SEMRush.'}
                  {semrushMode === 'full' && 'Full competitive analysis: domain keywords, competitor gaps, related keywords, volume + difficulty.'}
                  {semrushMode === 'none' && 'Uses AI + Google Search Console data only. No SEMRush API credits used.'}
                </p>
              </div>
            )}

            {/* Competitor Domains */}
            {semrushAvailable && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Competitor Domains</span>
                  </div>
                  <button
                    onClick={async () => {
                      setDiscoveringCompetitors(true);
                      try {
                        const result = await keywords.discoverCompetitors(workspaceId);
                        if (result?.competitors?.length) {
                          const domains = result.competitors.slice(0, 5).map(c => c.domain);
                          setCompetitors(domains.join(', '));
                          await keywords.saveCompetitors(workspaceId, domains);
                        }
                      } catch { /* ignore */ }
                      setDiscoveringCompetitors(false);
                    }}
                    disabled={discoveringCompetitors}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-400 font-medium hover:bg-orange-500/20 transition-all disabled:opacity-50"
                  >
                    {discoveringCompetitors ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    {discoveringCompetitors ? 'Discovering...' : 'Auto-Discover'}
                  </button>
                </div>
                <input
                  type="text"
                  value={competitors}
                  onChange={e => setCompetitors(e.target.value)}
                  placeholder="e.g. competitor1.com, competitor2.com"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[11px] text-zinc-500 mt-1">Comma-separated (max 5). Auto-discover uses SEMRush to find your organic competitors. These persist between strategy runs.</p>
              </div>
            )}

            {/* Page Limit */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Page Limit</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([200, 500, 1000, 0] as const).map(cap => (
                  <button
                    key={cap}
                    onClick={() => setMaxPages(cap)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                      maxPages === cap
                        ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <div className="font-semibold">{cap === 0 ? 'All' : cap}</div>
                    <div className="text-[11px] mt-0.5 opacity-70">
                      {cap === 200 && '~2-3 min'}
                      {cap === 500 && '~5-7 min'}
                      {cap === 1000 && '~10-15 min'}
                      {cap === 0 && 'No limit'}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1.5">
                {maxPages === 0
                  ? 'Processes every page on the site. May be slow for 500+ page sites.'
                  : `Prioritizes the top ${maxPages} pages by importance (homepage, key service pages, pages with metadata). Skips utility pages.`}
              </p>
            </div>

            {/* Business Context */}
            <div>
              <button
                onClick={() => setContextOpen(!contextOpen)}
                className="flex items-center gap-1.5 mb-1"
              >
                <Briefcase className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Business Context</span>
                {contextOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
              </button>
              {contextOpen && (
                <div className="space-y-1.5">
                  <textarea
                    value={businessContext}
                    onChange={e => setBusinessContext(e.target.value)}
                    placeholder={`Example: We are a dental practice in Austin, TX. We offer general, cosmetic, and pediatric dentistry. Target audience: families 25-55. Competitors: Aspen Dental, local practices.`}
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-teal-500 resize-y"
                  />
                  <p className="text-[11px] text-zinc-500">Saved with your strategy. Include: locations, services, audience, differentiators.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {!strategy && !generating && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-6 py-12 text-center">
          <Target className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">No keyword strategy yet</p>
          <p className="text-[11px] text-zinc-500 max-w-md mx-auto">
            Generate an AI-powered keyword strategy based on your site's pages and Google Search Console data.
            This will map target keywords to each page and guide all future AI rewrites.
          </p>
        </div>
      )}

      {strategy && (
        <>
          {/* ── Unvalidated Strategy Warning ── */}
          {!strategy.pageMap.some((p: PageKeywordMap) => p.volume && p.volume > 0) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300/90 leading-relaxed">
                <strong className="text-amber-300">This strategy was generated without keyword volume validation.</strong>{' '}
                Keywords, volume, and difficulty data may not reflect real search demand. Enable SEMRush integration for validated keyword recommendations.
              </div>
            </div>
          )}

          {/* ── Summary Dashboard ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard size="hero" label="Pages Mapped" value={strategy.pageMap.length} />
            <StatCard size="hero" label="Impressions" value={totalImpressions.toLocaleString()} icon={Eye} sub="last 90 days" />
            <StatCard size="hero" label="Clicks" value={totalClicks.toLocaleString()} icon={MousePointerClick} sub={totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}% CTR` : undefined} />
            <StatCard size="hero" label="Avg Position" value={ranked.length > 0 ? `#${avgPos.toFixed(1)}` : '—'} icon={Trophy} valueColor={positionColor(avgPos)} sub={`${ranked.length} pages ranking`} />
          </div>

          {/* ── Performance Tiers Bar ── */}
          {ranked.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-zinc-300">Ranking Distribution</h4>
                <span className="text-[11px] text-zinc-500">{ranked.length} of {strategy.pageMap.length} pages with ranking data</span>
              </div>
              <div className="flex h-4 rounded-full overflow-hidden bg-zinc-800">
                {top3.length > 0 && <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(top3.length / strategy.pageMap.length) * 100}%` }} />}
                {top10.length > 0 && <div className="bg-green-500 h-full transition-all" style={{ width: `${(top10.length / strategy.pageMap.length) * 100}%` }} />}
                {top20.length > 0 && <div className="bg-amber-500 h-full transition-all" style={{ width: `${(top20.length / strategy.pageMap.length) * 100}%` }} />}
                {beyond20.length > 0 && <div className="bg-red-500/60 h-full transition-all" style={{ width: `${(beyond20.length / strategy.pageMap.length) * 100}%` }} />}
                {notRankingCount > 0 && <div className="bg-zinc-700 h-full transition-all" style={{ width: `${(notRankingCount / strategy.pageMap.length) * 100}%` }} />}
              </div>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> <span className="text-emerald-400 font-medium">{top3.length}</span> <span className="text-zinc-500">Top 3</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> <span className="text-green-400 font-medium">{top10.length}</span> <span className="text-zinc-500">4–10</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> <span className="text-amber-400 font-medium">{top20.length}</span> <span className="text-zinc-500">11–20</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block" /> <span className="text-red-400 font-medium">{beyond20.length}</span> <span className="text-zinc-500">20+</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-full bg-zinc-700 inline-block" /> <span className="text-zinc-500 font-medium">{notRankingCount}</span> <span className="text-zinc-500">Not ranking</span></span>
              </div>
              {Object.keys(intentCounts).length > 1 && (
                <div className="mt-3 pt-3 border-t border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Search Intent Mix</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                      <span key={intent} className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${intentColor(intent)}`}>
                        {intent} ({count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── What Changed (Strategy Diff) ── */}
          <StrategyDiff workspaceId={workspaceId} />

          {/* ── Low-Hanging Fruit ── */}
          <LowHangingFruit pages={lowHangingFruit} positionColor={positionColor} />

          {/* ── Quick Wins ── */}
          <QuickWins quickWins={strategy.quickWins || []} />

          {/* ── Content Gaps ── */}
          <ContentGaps contentGaps={strategy.contentGaps || []} workspaceId={workspaceId} intentColor={intentColor} />

          {/* ── Site Keywords ── */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-teal-400" /> Site Target Keywords
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {strategy.siteKeywords.map((kw: string, i: number) => {
                const metrics = strategy.siteKeywordMetrics?.find((m: { keyword: string; volume: number; difficulty: number }) => m.keyword.toLowerCase() === kw.toLowerCase());
                const tracked = trackedKeywords.has(kw);
                return (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-500/10 border border-teal-500/20 rounded text-[11px] text-teal-300">
                    {kw}
                    {metrics && (metrics.volume > 0 || metrics.difficulty > 0) && (
                      <>
                        {metrics.volume > 0 && <span className="text-[11px] text-zinc-500 font-mono">{metrics.volume.toLocaleString()}/mo</span>}
                        {metrics.difficulty > 0 && <span className={`text-[11px] font-mono ${difficultyColor(metrics.difficulty)}`}>KD {metrics.difficulty}%</span>}
                      </>
                    )}
                    <button
                      onClick={() => trackKeyword(kw)}
                      title={tracked ? 'Tracking' : 'Track in Rank Tracker'}
                      className={`ml-0.5 transition-colors ${tracked ? 'text-emerald-400' : 'text-zinc-500 hover:text-teal-400'}`}
                    >
                      {tracked ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Opportunities ── */}
          {strategy.opportunities.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" /> Keyword Opportunities
              </h4>
              <p className="text-zinc-500 text-[10px] mb-2">
                These opportunities are AI-generated suggestions based on your site's content and competitive landscape. Validate with keyword research before acting.
              </p>
              <div className="space-y-1.5">
                {strategy.opportunities.map((opp: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-zinc-400">
                    <span className="w-4 h-4 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] text-teal-400 font-bold">{i + 1}</span>
                    {opp}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Cannibalization Alert ── */}
          {strategy.cannibalization && strategy.cannibalization.length > 0 && (
            <CannibalizationAlert items={strategy.cannibalization} />
          )}

          {/* ── Topical Authority ── */}
          {strategy.topicClusters && strategy.topicClusters.length > 0 && (
            <TopicClusters clusters={strategy.topicClusters} />
          )}

          {/* Keyword Gaps */}
          <KeywordGaps keywordGaps={strategy.keywordGaps || []} difficultyColor={difficultyColor} />

          {/* Backlink Profile */}
          <BacklinkProfile workspaceId={workspaceId} />

          {/* Competitive Intelligence Hub */}
          <CompetitiveIntel
            workspaceId={workspaceId}
            competitors={competitors.split(/[,\n]+/).map(c => c.trim()).filter(Boolean)}
            semrushAvailable={semrushAvailable}
          />

          {/* How it works */}
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-zinc-500">
                <strong className="text-zinc-400">How it works:</strong> This strategy is automatically used when you generate AI rewrites
                in the Edit SEO and CMS SEO tabs. The AI will incorporate your target keywords naturally into titles and descriptions.
                Use <strong className="text-teal-400">Page Intelligence</strong> to analyze individual pages, edit keywords, and generate SEO copy.
                {strategy.semrushMode && strategy.semrushMode !== 'none' && (
                  <span className="block mt-1 text-orange-400/80">
                    SEMRush data: Keywords enriched with real search volume and difficulty. Cached for 7 days.
                  </span>
                )}
                {!strategy.pageMap.some((p: PageKeywordMap) => p.currentPosition) && (
                  <span className="block mt-1 text-amber-400/80">
                    Tip: Connect Google Search Console to see ranking positions and get data-driven keyword suggestions.
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
