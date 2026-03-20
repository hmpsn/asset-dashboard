import { useState } from 'react';
import {
  Zap, FileText, Sparkles, Target, Search, CheckCircle2,
  TrendingUp, ChevronDown, Shield, BookOpen, Layers,
} from 'lucide-react';
import { TierGate, EmptyState, type Tier } from '../ui';
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
  contentPlanKeywords?: Map<string, string>;
  onTabChange?: (tab: string) => void;
}

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['content-opportunities']));
  const [expandedCounts, setExpandedCounts] = useState<Record<string, number>>({
    'growth-opportunities': 5,
    'quick-wins': 3,
    'keyword-opportunities': 5,
    'competitor-gaps': 9,
    'page-keyword-map': 20,
  });
  const [mapSearch, setMapSearch] = useState('');
  const [mapSort, setMapSort] = useState<'default' | 'position' | 'impressions' | 'clicks'>('default');

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const showAll = (section: string, total: number) => {
    setExpandedCounts(prev => ({ ...prev, [section]: total }));
  };

  if (!strategyData) {
    return (
      <EmptyState icon={Target} title="SEO strategy is being prepared" description={`${STUDIO_NAME} is building a keyword strategy for your site. Check back soon!`} />
    );
  }

  // Calculate strategy health score
  const contentGapsFound = strategyData.contentGaps?.length || 0;
  const quickWinsAvailable = strategyData.quickWins?.length || 0;
  const pagesRanking = strategyData.pageMap.filter(p => p.currentPosition).length;
  const totalPages = strategyData.pageMap.length;
  const pagesWithGrowthOpps = strategyData.pageMap.filter(p => !p.currentPosition && (p.impressions || 0) > 0).length;
  
  // Score: content gaps (40) + quick wins (30) + coverage (30)
  const contentScore = Math.min(40, contentGapsFound * 4); // 10 gaps = max
  const quickWinScore = Math.min(30, quickWinsAvailable * 6); // 5 quick wins = max
  const coverageScore = Math.round((pagesRanking / Math.max(1, totalPages)) * 30);
  const healthScore = contentScore + quickWinScore + coverageScore;

  const sectionCount = [
    contentGapsFound > 0,
    quickWinsAvailable > 0,
    pagesWithGrowthOpps > 0,
    (strategyData.keywordGaps?.length || 0) > 0,
    strategyData.opportunities.length > 0
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Header + Strategy Health Score */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">SEO Keyword Strategy</h2>
          <p className="text-sm text-zinc-500 mt-1">Generated {new Date(strategyData.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>

      {/* Strategy Health Score Card */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <div className="flex items-center gap-4">
          <div className={`text-3xl font-bold ${healthScore >= 80 ? 'text-emerald-400' : healthScore >= 60 ? 'text-amber-400' : 'text-teal-400'}`}>
            {healthScore}/100
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-zinc-300">
              {healthScore >= 80 ? 'Strong strategy foundation' : healthScore >= 60 ? 'Good progress, room to grow' : 'Building your strategy'}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {contentGapsFound > 0 && <span className="text-teal-400">{contentGapsFound} content opportunities</span>}
              {contentGapsFound > 0 && quickWinsAvailable > 0 && <span className="text-zinc-600"> • </span>}
              {quickWinsAvailable > 0 && <span className="text-amber-400">{quickWinsAvailable} quick wins</span>}
              {(contentGapsFound > 0 || quickWinsAvailable > 0) && pagesWithGrowthOpps > 0 && <span className="text-zinc-600"> • </span>}
              {pagesWithGrowthOpps > 0 && <span className="text-blue-400">{pagesWithGrowthOpps} pages near ranking</span>}
            </div>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <div>{pagesRanking}/{totalPages} pages ranking</div>
            <div>{sectionCount} active sections</div>
          </div>
        </div>
        {/* Progress bars */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-800/50">
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
              <span>Content Gaps</span>
              <span>{contentScore}/40</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500/60 rounded-full" style={{ width: `${(contentScore / 40) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
              <span>Quick Wins</span>
              <span>{quickWinScore}/30</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${(quickWinScore / 30) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
              <span>Coverage</span>
              <span>{coverageScore}/30</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${(coverageScore / 30) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTENT OPPORTUNITIES (expanded by default) ── */}
      {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
        <TierGate tier={effectiveTier} required="growth" feature="Content Opportunities" teaser={`${strategyData.contentGaps.length} content topics identified — upgrade to unlock recommendations`}>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button 
            onClick={() => toggleSection('content-opportunities')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Content Opportunities</div>
                <div className="text-[11px] text-zinc-500">{strategyData.contentGaps.length} topics that could drive organic traffic</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">{strategyData.contentGaps.length}</span>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('content-opportunities') ? '' : '-rotate-90'}`} />
            </div>
          </button>
          
          {expandedSections.has('content-opportunities') && (
            <div className="px-4 pb-4 border-t border-zinc-800/50">
              <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                {betaMode
                  ? 'Based on your keyword strategy and competitor analysis, these topics represent untapped search traffic your site could capture.'
                  : <>Based on your keyword strategy and competitor analysis, these topics represent untapped search traffic. Click <strong className="text-teal-300">Request This Topic</strong> to have {STUDIO_NAME} create a full content brief.</>}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {strategyData.contentGaps.map((gap, i) => {
                  const matchingReq = contentRequests?.find(r => r.targetKeyword === gap.targetKeyword && r.status !== 'declined');
                  const alreadyRequested = matchingReq != null || requestedTopics.has(gap.targetKeyword);
                  const planStatus = contentPlanKeywords?.get(gap.targetKeyword.toLowerCase());
                  const pageType = gap.suggestedPageType || 'blog';
                  const pageTypeLabel = ({ blog: 'Blog Post', landing: 'Landing Page', service: 'Service Page', location: 'Location Page', product: 'Product Page', pillar: 'Pillar Page', resource: 'Resource Guide' } as Record<string, string>)[pageType] || 'Blog Post';
                  const keywordDiffers = gap.targetKeyword.toLowerCase().replace(/[^a-z0-9]/g, '') !== gap.topic.toLowerCase().replace(/[^a-z0-9]/g, '');
                  return (
                    <div key={i} className="px-3.5 py-2.5 rounded-lg bg-zinc-950/50 border border-zinc-800/80 hover:border-teal-500/30 transition-all group flex flex-col">
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
                        ) : planStatus ? (
                          <button
                            onClick={() => onTabChange?.('content-plan')}
                            className="flex items-center gap-1 text-[11px] text-violet-400 bg-violet-500/10 px-2.5 py-1.5 rounded-lg border border-violet-500/20 flex-shrink-0 hover:bg-violet-500/20 transition-colors"
                            title="View in Content Plan"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            {planStatus === 'published' ? 'Published' : planStatus === 'approved' ? 'Approved' : planStatus === 'in_progress' || planStatus === 'brief_generated' ? 'In Progress' : 'Planned'}
                          </button>
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
          )}
        </div>
        </TierGate>
      )}

      {/* ── GROWTH OPPORTUNITIES (collapsed by default) ── */}
      {(() => {
        const unranked = strategyData.pageMap
          .filter(p => !p.currentPosition)
          .map(p => {
            const reasons: string[] = [];
            const actions: { label: string; icon: typeof Shield; color: string }[] = [];
            const hasImpressions = (p.impressions || 0) > 0;
            const highKD = (p.difficulty || 0) > 60;
            const medKD = (p.difficulty || 0) > 30;

            if (hasImpressions) {
              reasons.push('Google is already crawling this page — close to breaking through');
              actions.push({ label: 'Near-ranking — optimize to break through', icon: BookOpen, color: 'text-teal-400' });
            } else if (highKD) {
              reasons.push(`Competitive keyword (${p.difficulty}% difficulty) — authority building will help`);
              actions.push({ label: 'Build authority with supporting content', icon: FileText, color: 'text-amber-400' });
            } else if (medKD) {
              reasons.push('Moderate competition — content depth can unlock this');
              actions.push({ label: 'Expand content & add internal links', icon: BookOpen, color: 'text-teal-400' });
            } else {
              reasons.push('Low competition — quick win with content improvements');
              actions.push({ label: 'Expand content to capture this opportunity', icon: Sparkles, color: 'text-teal-400' });
            }

            const intentScore = p.searchIntent === 'commercial' ? 3 : p.searchIntent === 'transactional' ? 3 : p.searchIntent === 'informational' ? 1 : 2;
            const priority = intentScore * 100 + (hasImpressions ? 50 : 0) + (100 - (p.difficulty || 50));

            return { ...p, reasons, actions, priority, hasImpressions };
          })
          .sort((a, b) => b.priority - a.priority);

        if (unranked.length === 0) return null;

        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button 
              onClick={() => toggleSection('growth-opportunities')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-zinc-200">Growth Opportunities</div>
                  <div className="text-[11px] text-zinc-500">{unranked.length} pages with untapped search potential</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">{unranked.length}</span>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('growth-opportunities') ? '' : '-rotate-90'}`} />
              </div>
            </button>

            {expandedSections.has('growth-opportunities') && (
              <div className="px-4 pb-4 space-y-2">
                {unranked.slice(0, expandedCounts['growth-opportunities']).map(page => (
                  <div key={page.pagePath} className="rounded-lg bg-zinc-950/50 border border-zinc-800/80 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">{page.pageTitle || page.pagePath}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate">{page.pagePath}</div>
                        {page.primaryKeyword && (
                          <div className="text-[10px] text-teal-400/80 mt-0.5">Target: &ldquo;{page.primaryKeyword}&rdquo;</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {page.hasImpressions && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">Almost there</span>}
                        {page.searchIntent && <span className="text-[10px] text-zinc-500 uppercase">{page.searchIntent}</span>}
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1.5 line-clamp-1">{page.reasons[0]}</div>
                    <div className="flex items-center gap-2 mt-2">
                      {page.actions.map((a, i) => (
                        <span key={i} className={`flex items-center gap-1 text-[10px] font-medium ${a.color}`}>
                          <a.icon className="w-3 h-3" /> {a.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {unranked.length > expandedCounts['growth-opportunities'] && (
                  <button 
                    onClick={() => showAll('growth-opportunities', unranked.length)}
                    className="w-full text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    View all {unranked.length} opportunities
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── QUICK WINS (collapsed by default) ── */}
      {strategyData.quickWins && strategyData.quickWins.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button 
            onClick={() => toggleSection('quick-wins')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Quick Wins</div>
                <div className="text-[11px] text-zinc-500">{strategyData.quickWins.length} low-effort improvements</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">{strategyData.quickWins.length}</span>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('quick-wins') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('quick-wins') && (
            <div className="px-4 pb-4 space-y-2">
              {strategyData.quickWins.slice(0, expandedCounts['quick-wins']).map((qw, i) => {
                const impactColor = qw.estimatedImpact === 'high' ? 'text-green-400 bg-green-500/15 border-green-500/30' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
                return (
                  <div key={i} className="px-3 py-2.5 rounded-lg bg-zinc-950/50 border border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-zinc-500">{qw.pagePath}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${impactColor}`}>{qw.estimatedImpact}</span>
                    </div>
                    <div className="text-[11px] text-zinc-200 mt-1 font-medium">{qw.action}</div>
                  </div>
                );
              })}
              {strategyData.quickWins && strategyData.quickWins.length > expandedCounts['quick-wins'] && (
                <button 
                  onClick={() => showAll('quick-wins', strategyData.quickWins!.length)}
                  className="w-full text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  View all {strategyData.quickWins!.length} quick wins
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── KEYWORD OPPORTUNITIES (collapsed by default, stacked not side-by-side) ── */}
      {strategyData.opportunities.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button 
            onClick={() => toggleSection('keyword-opportunities')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Keyword Opportunities</div>
                <div className="text-[11px] text-zinc-500">{strategyData.opportunities.length} strategic keyword targets</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('keyword-opportunities') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('keyword-opportunities') && (
            <div className="px-4 pb-4">
              <p className="text-[11px] text-zinc-500 mb-3">Additional keywords your existing pages could target to capture more search traffic.</p>
              <div className="space-y-1.5">
                {strategyData.opportunities.slice(0, expandedCounts['keyword-opportunities']).map((opp, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-zinc-300 px-3 py-2 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                    <span className="w-5 h-5 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] text-purple-400 font-bold">{i + 1}</span>
                    {opp}
                  </div>
                ))}
              </div>
              {strategyData.opportunities.length > expandedCounts['keyword-opportunities'] && (
                <button 
                  onClick={() => showAll('keyword-opportunities', strategyData.opportunities.length)}
                  className="w-full text-center py-2 mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  View all {strategyData.opportunities.length} opportunities
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TARGET KEYWORDS (reference section, collapsed by default) ── */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <button 
          onClick={() => toggleSection('target-keywords')}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-zinc-700/50 flex items-center justify-center">
              <Target className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="text-left">
              <div className="text-sm font-medium text-zinc-300">Target Keywords</div>
              <div className="text-[11px] text-zinc-500">{strategyData.siteKeywords.length} keywords we're tracking</div>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('target-keywords') ? '' : '-rotate-90'}`} />
        </button>

        {expandedSections.has('target-keywords') && (
          <div className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {strategyData.siteKeywords.slice(0, 15).map(kw => {
                const metrics = strategyData.siteKeywordMetrics?.find(m => m.keyword.toLowerCase() === kw.toLowerCase());
                return (
                  <span key={kw} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-400">
                    {kw}
                    {metrics && metrics.volume > 0 && (
                      <span className="text-[10px] text-zinc-500 font-mono">{metrics.volume.toLocaleString()}/mo</span>
                    )}
                  </span>
                );
              })}
              {strategyData.siteKeywords.length > 15 && (
                <span className="text-[11px] text-zinc-500 px-2 py-1">+{strategyData.siteKeywords.length - 15} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── COMPETITOR KEYWORD GAPS (collapsed by default) ── */}
      {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
        <TierGate tier={effectiveTier} required="premium" feature="Competitor Keyword Gaps" teaser={`${strategyData.keywordGaps.length} keyword gaps found — upgrade to Premium to see what competitors rank for`}>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button 
            onClick={() => toggleSection('competitor-gaps')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Target className="w-3.5 h-3.5 text-orange-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Competitor Keyword Gaps</div>
                <div className="text-[11px] text-zinc-500">{strategyData.keywordGaps.length} keywords competitors rank for</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('competitor-gaps') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('competitor-gaps') && (
            <div className="px-4 pb-4">
              <p className="text-[11px] text-zinc-500 mb-3">Keywords your competitors rank for that you don&apos;t — content gaps vs. your competition.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {strategyData.keywordGaps.slice(0, expandedCounts['competitor-gaps']).map((gap, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
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
              {strategyData.keywordGaps && strategyData.keywordGaps.length > expandedCounts['competitor-gaps'] && (
                <button 
                  onClick={() => showAll('competitor-gaps', strategyData.keywordGaps!.length)}
                  className="w-full text-center py-2 mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  View all {strategyData.keywordGaps!.length} gaps
                </button>
              )}
            </div>
          )}
        </div>
        </TierGate>
      )}

      {/* ── PAGE KEYWORD MAP (reference data, collapsed by default, at bottom) ── */}
      <TierGate tier={effectiveTier} required="growth" feature="Page Keyword Map" teaser={`${strategyData.pageMap.length} pages with keyword targets — upgrade to view detailed assignments`}>
      {(() => {
        let filtered = strategyData.pageMap.filter(p => {
          if (mapSearch) {
            const q = mapSearch.toLowerCase();
            if (!(p.pagePath.toLowerCase().includes(q) || (p.pageTitle || '').toLowerCase().includes(q) || p.primaryKeyword.toLowerCase().includes(q))) return false;
          }
          return true;
        });
        if (mapSort === 'position') filtered = [...filtered].sort((a, b) => (a.currentPosition || 999) - (b.currentPosition || 999));
        else if (mapSort === 'impressions') filtered = [...filtered].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
        else if (mapSort === 'clicks') filtered = [...filtered].sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button 
              onClick={() => toggleSection('page-keyword-map')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-zinc-700/50 flex items-center justify-center">
                  <Layers className="w-3.5 h-3.5 text-zinc-400" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-zinc-300">Page Keyword Map</div>
                  <div className="text-[11px] text-zinc-500">{filtered.length} pages with keyword assignments</div>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('page-keyword-map') ? '' : '-rotate-90'}`} />
            </button>

            {expandedSections.has('page-keyword-map') && (
              <div className="border-t border-zinc-800">
                <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2 flex-wrap bg-zinc-950/30">
                  <div className="relative">
                    <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search pages..."
                      value={mapSearch}
                      onChange={e => setMapSearch(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-zinc-300 w-40 focus:outline-none focus:border-zinc-600 placeholder-zinc-600"
                    />
                  </div>
                  <select value={mapSort} onChange={e => setMapSort(e.target.value as typeof mapSort)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-zinc-600 appearance-none cursor-pointer">
                    <option value="default">Default</option>
                    <option value="position">By position</option>
                    <option value="impressions">By impressions</option>
                  </select>
                </div>
                <div className="divide-y divide-zinc-800/50 max-h-[400px] overflow-y-auto">
                  {filtered.slice(0, expandedCounts['page-keyword-map']).map(page => (
                    <div key={page.pagePath} className="px-4 py-2.5 hover:bg-zinc-800/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-zinc-400 font-mono truncate">{page.pagePath}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          {page.currentPosition ? (
                            <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800 ${page.currentPosition <= 10 ? 'text-emerald-400' : 'text-amber-400'}`}>#{page.currentPosition.toFixed(0)}</span>
                          ) : (
                            <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">—</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-teal-400/80">{page.primaryKeyword}</span>
                        {page.secondaryKeywords && page.secondaryKeywords.length > 0 && (
                          <span className="text-[10px] text-zinc-600">+{page.secondaryKeywords.length} more</span>
                        )}
                        {page.impressions != null && page.impressions > 0 && <span className="text-[10px] text-zinc-500">{page.impressions.toLocaleString()} imp</span>}
                      </div>
                    </div>
                  ))}
                  {filtered.length > expandedCounts['page-keyword-map'] && (
                    <button 
                      onClick={() => showAll('page-keyword-map', filtered.length)}
                      className="w-full text-center py-3 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Show all {filtered.length} pages
                    </button>
                  )}
                  {filtered.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      </TierGate>
    </div>
  );
}
