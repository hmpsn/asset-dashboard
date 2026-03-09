import { useState } from 'react';
import {
  Zap, FileText, Sparkles, Target, Search, CheckCircle2,
} from 'lucide-react';
import { TierGate, type Tier } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { useBetaMode } from './BetaContext';
import { STUDIO_NAME } from '../../constants';

export interface PricingModalState {
  serviceType: 'brief_only' | 'full_post';
  topic: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  notes?: string;
  source: 'strategy' | 'client' | 'upgrade';
  upgradeReqId?: string;
  pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
}

interface StrategyTabProps {
  strategyData: ClientKeywordStrategy | null;
  requestedTopics: Set<string>;
  contentRequests?: ClientContentRequest[];
  effectiveTier: Tier;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setPricingModal: (modal: PricingModalState | null) => void;
}

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [mapSearch, setMapSearch] = useState('');
  const [mapSort, setMapSort] = useState<'default' | 'position' | 'impressions' | 'clicks'>('default');
  const [mapIntent, setMapIntent] = useState<string>('all');

  if (!strategyData) {
    return (
      <div className="text-center py-16">
        <Target className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
        <p className="text-sm text-zinc-500">SEO strategy is being prepared</p>
        <p className="text-xs text-zinc-500 mt-1">{STUDIO_NAME} is building a keyword strategy for your site. Check back soon!</p>
      </div>
    );
  }

  return (<>
    <div className="space-y-5">
      {/* Header + Generated date */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">SEO Keyword Strategy</h2>
          <p className="text-sm text-zinc-500 mt-1">Generated {new Date(strategyData.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>

      {/* Summary Cards — strategy-specific metrics */}
      {(() => {
        const keywordsTracked = strategyData.siteKeywords.length;
        const contentGapsFound = strategyData.contentGaps?.length || 0;
        const quickWinsAvailable = strategyData.quickWins?.length || 0;
        const pagesWithoutRankings = strategyData.pageMap.filter(p => !p.currentPosition).length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Keywords Tracked</div>
              <div className="text-xl font-bold text-zinc-100">{keywordsTracked}</div>
              <div className="text-[11px] text-zinc-500">{strategyData.pageMap.length} pages mapped</div>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Content Gaps</div>
              <div className={`text-xl font-bold ${contentGapsFound > 0 ? 'text-teal-400' : 'text-zinc-500'}`}>{contentGapsFound}</div>
              <div className="text-[11px] text-zinc-500">{contentGapsFound > 0 ? 'topics identified' : 'none found yet'}</div>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Quick Wins</div>
              <div className={`text-xl font-bold ${quickWinsAvailable > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{quickWinsAvailable}</div>
              <div className="text-[11px] text-zinc-500">{quickWinsAvailable > 0 ? 'low-effort improvements' : 'none right now'}</div>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Search className="w-3 h-3" /> Not Yet Ranking</div>
              <div className={`text-xl font-bold ${pagesWithoutRankings > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{pagesWithoutRankings}</div>
              <div className="text-[11px] text-zinc-500">{pagesWithoutRankings > 0 ? 'pages need attention' : 'all pages ranking'}</div>
            </div>
          </div>
        );
      })()}

      {/* ── CONTENT OPPORTUNITIES (revenue moment — show gaps first) ── */}
      {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
        <TierGate tier={effectiveTier} required="growth" feature="Content Opportunities" teaser={`${strategyData.contentGaps.length} content topics identified — upgrade to unlock recommendations`}>
        <div className="bg-gradient-to-br from-teal-950/40 to-zinc-900 rounded-xl border border-teal-500/30 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-teal-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-teal-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-teal-200">Content Opportunities</div>
                  <div className="text-[11px] text-teal-400/60">New pages that could drive significant organic traffic</div>
                </div>
              </div>
              <span className="text-[11px] text-zinc-500">{strategyData.contentGaps.length} topics identified</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2 mb-4 leading-relaxed">
              {betaMode
                ? 'Based on your keyword strategy and competitor analysis, these topics represent untapped search traffic your site could capture.'
                : <>Based on your keyword strategy and competitor analysis, these topics represent untapped search traffic. Click <strong className="text-teal-300">Request This Topic</strong> to have {STUDIO_NAME} create a full content brief.</>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {strategyData.contentGaps.map((gap, i) => {
                const matchingReq = contentRequests?.find(r => r.targetKeyword === gap.targetKeyword && r.status !== 'declined');
                const alreadyRequested = matchingReq != null || requestedTopics.has(gap.targetKeyword);
                const pageType = gap.suggestedPageType || 'blog';
                const pageTypeLabel = ({ blog: 'Blog Post', landing: 'Landing Page', service: 'Service Page', location: 'Location Page', product: 'Product Page', pillar: 'Pillar Page', resource: 'Resource Guide' } as Record<string, string>)[pageType] || 'Blog Post';
                const keywordDiffers = gap.targetKeyword.toLowerCase().replace(/[^a-z0-9]/g, '') !== gap.topic.toLowerCase().replace(/[^a-z0-9]/g, '');
                return (
                  <div key={i} className="px-3.5 py-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-teal-500/30 transition-all group flex flex-col">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-zinc-100 flex-1 min-w-0 mr-2 truncate">{gap.topic}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium">{pageTypeLabel}</span>
                        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{gap.intent}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-zinc-500 leading-snug mb-2 line-clamp-2">{gap.rationale}</div>
                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {keywordDiffers && <span className="text-[10px] text-teal-400/70 truncate max-w-[140px]">&ldquo;{gap.targetKeyword}&rdquo;</span>}
                      </div>
                      {!betaMode && (alreadyRequested ? (
                        (() => {
                          const s = matchingReq?.status;
                          if (s === 'delivered' || s === 'published') return <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> {s === 'published' ? 'Published' : 'Delivered'} ✓</span>;
                          if (s === 'approved' || s === 'in_progress') return <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20 flex-shrink-0"><Sparkles className="w-3.5 h-3.5" /> In Progress</span>;
                          if (s === 'brief_generated' || s === 'client_review') return <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0"><FileText className="w-3.5 h-3.5" /> In Review</span>;
                          return <span className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-lg border border-blue-500/20 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> Brief Ordered</span>;
                        })()
                      ) : (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => setPricingModal({ serviceType: 'brief_only', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                          >
                            <FileText className="w-3 h-3" /> Get a Brief
                            {briefPrice != null && <span className="opacity-70 ml-0.5">{fmtPrice(briefPrice)}</span>}
                          </button>
                          {fullPostPrice != null && (
                            <button
                              onClick={() => setPricingModal({ serviceType: 'full_post', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600/30 to-emerald-600/30 border border-teal-500/40 text-[11px] text-teal-200 font-medium hover:from-teal-600/50 hover:to-emerald-600/50 transition-all"
                            >
                              <Sparkles className="w-3 h-3" /> Full Post
                              <span className="opacity-70 ml-0.5">{fmtPrice(fullPostPrice)}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </TierGate>
      )}

      {/* ── QUICK WINS (value proof — we're already working on it) ── */}
      {strategyData.quickWins && strategyData.quickWins.length > 0 && (
        <div className="bg-gradient-to-br from-amber-950/30 to-zinc-900 rounded-xl border border-amber-500/30 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-amber-200">Quick Wins</div>
                <div className="text-[11px] text-amber-400/60">Low-effort changes that can improve rankings fast</div>
              </div>
            </div>
            <div className="space-y-2 mt-3">
              {strategyData.quickWins.map((qw, i) => {
                const impactColor = qw.estimatedImpact === 'high' ? 'text-green-400 bg-green-500/15 border-green-500/30' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
                return (
                  <div key={i} className="px-3.5 py-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-amber-500/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-zinc-500">{qw.pagePath}</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${impactColor}`}>{qw.estimatedImpact} impact</span>
                    </div>
                    <div className="text-[11px] text-zinc-200 mt-1.5 font-medium">{qw.action}</div>
                    <div className="text-[11px] text-zinc-500 mt-1">{qw.rationale}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── KEYWORD OPPORTUNITIES + TARGET KEYWORDS (side by side) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {strategyData.opportunities.length > 0 && (
          <div className="bg-gradient-to-br from-teal-950/30 to-zinc-900 rounded-xl border border-teal-500/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-xs font-semibold text-teal-200">Keyword Opportunities</div>
            </div>
            <div className="space-y-2">
              {strategyData.opportunities.map((opp, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[11px] text-zinc-300 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
                  <span className="w-5 h-5 rounded-full bg-teal-500/15 border border-teal-500/25 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] text-teal-400 font-bold">{i + 1}</span>
                  {opp}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <Target className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <div className="text-xs font-semibold text-zinc-200">Target Keywords</div>
            <span className="text-[11px] text-zinc-500 ml-auto">{strategyData.siteKeywords.length} keywords</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {strategyData.siteKeywords.map(kw => {
              const metrics = strategyData.siteKeywordMetrics?.find(m => m.keyword.toLowerCase() === kw.toLowerCase());
              return (
                <span key={kw} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-[11px] text-teal-300">
                  {kw}
                  {metrics && metrics.volume > 0 && (
                    <span className="text-[11px] text-zinc-500 font-mono">{metrics.volume.toLocaleString()}/mo</span>
                  )}
                  {metrics && metrics.difficulty > 0 && (
                    <span className={`text-[11px] font-mono ${metrics.difficulty <= 30 ? 'text-green-400' : metrics.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>KD {metrics.difficulty}%</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── COMPETITOR KEYWORD GAPS ── */}
      {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
        <TierGate tier={effectiveTier} required="premium" feature="Competitor Keyword Gaps" teaser={`${strategyData.keywordGaps.length} keyword gaps found — upgrade to Premium to see what competitors rank for`}>
        <div className="bg-gradient-to-br from-orange-950/20 to-zinc-900 rounded-xl border border-orange-500/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Target className="w-3.5 h-3.5 text-orange-400" />
            </div>
            <div className="text-xs font-semibold text-orange-200">Competitor Keyword Gaps</div>
            <span className="text-[11px] text-zinc-500">Keywords your competitors rank for that you don't</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {strategyData.keywordGaps.map((gap, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
                <span className="text-[11px] text-zinc-300 font-medium truncate mr-2">{gap.keyword}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {gap.volume != null && gap.volume > 0 && <span className="text-[11px] text-zinc-500">{gap.volume.toLocaleString()}</span>}
                  {gap.difficulty != null && gap.difficulty > 0 && (
                    <span className={`text-[11px] font-medium ${gap.difficulty <= 30 ? 'text-green-400' : gap.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                      KD {gap.difficulty}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        </TierGate>
      )}

      {/* ── PAGE KEYWORD MAP (detailed reference with search/sort/filter) ── */}
      <TierGate tier={effectiveTier} required="growth" feature="Page Keyword Map" teaser={`${strategyData.pageMap.length} pages with keyword targets — upgrade to view detailed assignments`}>
      {(() => {
        const intents = Array.from(new Set(strategyData.pageMap.map(p => p.searchIntent).filter(Boolean)));
        let filtered = strategyData.pageMap.filter(p => {
          if (mapSearch) {
            const q = mapSearch.toLowerCase();
            if (!(p.pagePath.toLowerCase().includes(q) || (p.pageTitle || '').toLowerCase().includes(q) || p.primaryKeyword.toLowerCase().includes(q))) return false;
          }
          if (mapIntent !== 'all' && p.searchIntent !== mapIntent) return false;
          return true;
        });
        if (mapSort === 'position') filtered = [...filtered].sort((a, b) => (a.currentPosition || 999) - (b.currentPosition || 999));
        else if (mapSort === 'impressions') filtered = [...filtered].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
        else if (mapSort === 'clicks') filtered = [...filtered].sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-medium text-zinc-300">Page Keyword Map</span>
              <span className="text-[11px] text-zinc-500">{filtered.length} of {strategyData.pageMap.length} pages</span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <div className="relative">
                  <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search pages or keywords..."
                    value={mapSearch}
                    onChange={e => setMapSearch(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-zinc-300 w-48 focus:outline-none focus:border-teal-500/50 placeholder-zinc-600"
                  />
                </div>
                <select value={mapSort} onChange={e => setMapSort(e.target.value as typeof mapSort)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500/50 appearance-none cursor-pointer">
                  <option value="default">Default order</option>
                  <option value="position">By position</option>
                  <option value="impressions">By impressions</option>
                  <option value="clicks">By clicks</option>
                </select>
                {intents.length > 1 && (
                  <select value={mapIntent} onChange={e => setMapIntent(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500/50 appearance-none cursor-pointer">
                    <option value="all">All intents</option>
                    {intents.map(intent => <option key={intent} value={intent}>{intent}</option>)}
                  </select>
                )}
              </div>
            </div>
            <div className="divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto">
              {filtered.map(page => (
                <div key={page.pagePath} className="px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      {page.pageTitle && <div className="text-xs text-zinc-300 truncate">{page.pageTitle}</div>}
                      <div className="text-[11px] text-zinc-500 font-mono truncate">{page.pagePath}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {page.searchIntent && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${
                          page.searchIntent === 'commercial' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                          page.searchIntent === 'transactional' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                          page.searchIntent === 'informational' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                          'text-zinc-400 bg-zinc-700/30 border-zinc-600/20'
                        }`}>{page.searchIntent}</span>
                      )}
                      {page.currentPosition ? (
                        <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800 ${page.currentPosition <= 3 ? 'text-emerald-400' : page.currentPosition <= 10 ? 'text-green-400' : page.currentPosition <= 20 ? 'text-amber-400' : 'text-red-400'}`}>#{page.currentPosition.toFixed(0)}</span>
                      ) : (
                        <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">—</span>
                      )}
                      {page.impressions != null && page.impressions > 0 && (
                        <span className="text-[11px] text-zinc-500 font-mono">{page.impressions.toLocaleString()} imp</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">{page.primaryKeyword}</span>
                    {page.volume != null && page.volume > 0 && <span className="text-[11px] text-zinc-500 font-mono">{page.volume.toLocaleString()}/mo</span>}
                    {page.difficulty != null && page.difficulty > 0 && (
                      <span className={`text-[11px] font-mono ${page.difficulty <= 30 ? 'text-green-400' : page.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>KD {page.difficulty}%</span>
                    )}
                    {page.secondaryKeywords && page.secondaryKeywords.length > 0 && (
                      <span className="text-[11px] text-zinc-500">+{page.secondaryKeywords.length} secondary</span>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-5 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>
              )}
            </div>
          </div>
        );
      })()}
      </TierGate>
    </div>
  </>);
}
