import { useState, useRef } from 'react';
import {
  Zap, FileText, Sparkles, Target, CheckCircle2,
  TrendingUp, TrendingDown, Minus, ChevronDown, Shield, BookOpen, Layers,
  MessageCircle, BarChart3, Eye, AlertTriangle, Award, MessageCircleQuestion,
} from 'lucide-react';
import { TierGate, EmptyState, type Tier } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { useBetaMode } from './BetaContext';
import { PageKeywordMapContent } from './PageKeywordMapContent';
import { STUDIO_NAME } from '../../constants';
import { post } from '../../api';

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
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
}

const kdColor = (kd?: number) => !kd ? 'text-zinc-500' : kd <= 30 ? 'text-green-400' : kd <= 60 ? 'text-amber-400' : 'text-red-400';
const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['content-opportunities', 'quick-wins', 'growth-opportunities', 'keyword-opportunities', 'target-keywords']));

  // Refs for scroll-to-section
  const contentOpportunitiesRef = useRef<HTMLDivElement>(null);
  const quickWinsRef = useRef<HTMLDivElement>(null);
  const growthOpportunitiesRef = useRef<HTMLDivElement>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const scrollToSection = (section: string, ref: React.RefObject<HTMLDivElement | null>) => {
    // Ensure section is expanded before scrolling
    setExpandedSections(prev => {
      if (prev.has(section)) return prev;
      const next = new Set(prev);
      next.add(section);
      return next;
    });
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
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

      {/* Unvalidated strategy note */}
      {!strategyData.pageMap.some(p => p.volume && p.volume > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/90 leading-relaxed">
            Keyword volume and difficulty metrics are currently unavailable for this strategy. The recommendations are based on AI analysis and site content.
          </div>
        </div>
      )}

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

      {/* ── TOP SUMMARY BAR ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Content Gaps Summary Card */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200">Content Gaps</div>
            <div className="text-[11px] text-zinc-500">{strategyData.contentGaps?.length || 0} topics to create</div>
          </div>
          <button 
            onClick={() => scrollToSection('content-opportunities', contentOpportunitiesRef)}
            className="px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/30 transition-colors flex-shrink-0"
          >
            Explore
          </button>
        </div>

        {/* Quick Wins Summary Card */}
        {strategyData.quickWins && strategyData.quickWins.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-200">Quick Wins</div>
              <div className="text-[11px] text-zinc-500">{strategyData.quickWins.length} easy improvements</div>
            </div>
            <button 
              onClick={() => scrollToSection('quick-wins', quickWinsRef)}
              className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-[11px] text-amber-300 font-medium hover:bg-amber-600/30 transition-colors flex-shrink-0"
            >
              View
            </button>
          </div>
        )}

        {/* Growth Opportunities Summary Card */}
        {(() => {
          const unranked = strategyData.pageMap.filter(p => !p.currentPosition);
          if (unranked.length === 0) return null;
          return (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">Growth Opportunities</div>
                <div className="text-[11px] text-zinc-500">{unranked.length} pages to optimize</div>
              </div>
              <button 
                onClick={() => scrollToSection('growth-opportunities', growthOpportunitiesRef)}
                className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[11px] text-blue-300 font-medium hover:bg-blue-600/30 transition-colors flex-shrink-0"
              >
                Review
              </button>
            </div>
          );
        })()}
      </div>

      {/* ── CONTENT OPPORTUNITIES (always expanded - primary action area) ── */}
      {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
      <div ref={contentOpportunitiesRef}>
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
                {strategyData.contentGaps.slice(0, expandedSections.has('content-opportunities-all') ? undefined : 4).map((gap, i) => {
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
                      {((gap.volume != null && gap.volume > 0) || (gap.difficulty != null && gap.difficulty > 0) || (gap.impressions != null && gap.impressions > 0)) && (
                        <div className="flex items-center gap-3 mb-1.5">
                          {gap.volume != null && gap.volume > 0 && <span className="text-[10px] text-zinc-400 flex items-center gap-0.5"><BarChart3 className="w-3 h-3" />{fmtNum(gap.volume)}/mo</span>}
                          {gap.difficulty != null && gap.difficulty > 0 && <span className={`text-[10px] font-medium ${kdColor(gap.difficulty)}`}>KD {gap.difficulty}</span>}
                          {gap.impressions != null && gap.impressions > 0 && <span className="text-[10px] text-blue-400 flex items-center gap-0.5"><Eye className="w-3 h-3" />{fmtNum(gap.impressions)} existing impr</span>}
                        </div>
                      )}
                      {/* Trend + SERP + Competitor badges */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {gap.trendDirection === 'rising' && (
                          <span className="flex items-center gap-0.5 text-[10px] text-green-400 font-medium"><TrendingUp className="w-3 h-3" />Rising</span>
                        )}
                        {gap.trendDirection === 'declining' && (
                          <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-medium"><TrendingDown className="w-3 h-3" />Declining</span>
                        )}
                        {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-zinc-400 font-medium"><Minus className="w-3 h-3" />Stable</span>
                        )}
                        {gap.serpFeatures?.includes('featured_snippet') && (
                          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-medium"><Award className="w-3 h-3" />Featured Snippet</span>
                        )}
                        {gap.serpFeatures?.includes('people_also_ask') && (
                          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium"><MessageCircleQuestion className="w-3 h-3" />PAA</span>
                        )}
                        {gap.competitorProof && (
                          <span className="text-[10px] text-orange-400 font-medium">{gap.competitorProof}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 leading-snug mb-2">{gap.rationale}</div>
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
                              <FileText className="w-3 h-3" /> Get Brief
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
              {strategyData.contentGaps.length > 4 && (
                <button 
                  onClick={() => toggleSection('content-opportunities-all')}
                  className="w-full mt-3 text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
                >
                  {expandedSections.has('content-opportunities-all') ? 'Show fewer' : `View all ${strategyData.contentGaps.length} opportunities`}
                </button>
              )}
            </div>
          )}
        </div>
        </TierGate>
      </div>
      )}

      {/* ── QUICK WINS ── */}
      {strategyData.quickWins && strategyData.quickWins.length > 0 && (
      <div ref={quickWinsRef}>
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
            <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50">
              {strategyData.quickWins.slice(0, expandedSections.has('quick-wins-all') ? undefined : 3).map((qw, i) => {
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
              {strategyData.quickWins.length > 3 && (
                <button 
                  onClick={() => toggleSection('quick-wins-all')}
                  className="w-full text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {expandedSections.has('quick-wins-all') ? 'Show fewer' : `View all ${strategyData.quickWins.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── GROWTH OPPORTUNITIES ── */}
      <div ref={growthOpportunitiesRef}>
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
              <div className="px-4 pb-4">
                <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                  Pages that aren't ranking yet but show potential. These opportunities are prioritized by search intent and competition level.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {unranked.slice(0, expandedSections.has('growth-opportunities-all') ? undefined : 3).map(page => (
                      <div key={page.pagePath} className="rounded-lg bg-zinc-950/50 border border-zinc-800/80 p-3 flex flex-col hover:border-blue-500/30 transition-all">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium text-zinc-200 truncate">{page.pageTitle || page.pagePath}</div>
                            <div className="text-[10px] text-zinc-500 font-mono truncate">{page.pagePath}</div>
                          </div>
                          {page.hasImpressions && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 flex-shrink-0 ml-2">Almost there</span>}
                        </div>
                        {page.primaryKeyword && (
                          <div className="text-[10px] text-teal-400/80 mb-2">Target: &ldquo;{page.primaryKeyword}&rdquo;</div>
                        )}
                        <div className="text-[10px] text-zinc-400 leading-snug flex-1">{page.reasons[0]}</div>
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800/50">
                          <div className="flex items-center gap-1.5">
                            {page.searchIntent && <span className="text-[10px] text-zinc-500 uppercase">{page.searchIntent}</span>}
                            {page.difficulty != null && page.difficulty > 0 && (
                              <span className={`text-[10px] ${page.difficulty <= 30 ? 'text-green-400' : page.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                                KD {page.difficulty}
                              </span>
                            )}
                          </div>
                          {workspaceId && (
                            <button
                              onClick={() => {
                                // Flag for discussion in next meeting
                                post(`/api/public/content-request/${workspaceId}`, {
                                  type: 'meeting_discussion',
                                  targetPage: page.pagePath,
                                  targetKeyword: page.primaryKeyword,
                                  notes: `Growth opportunity: ${page.reasons[0]}`,
                                  priority: page.hasImpressions ? 'high' : 'medium'
                                }).then(() => {
                                  setToast?.('Added to meeting agenda');
                                  onContentRequested?.();
                                }).catch(() => setToast?.('Failed to add to agenda'));
                              }}
                              className="px-2.5 py-1 rounded text-[10px] font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors flex items-center gap-1"
                            >
                              <MessageCircle className="w-3 h-3" />
                              Discuss
                            </button>
                          )}
                        </div>
                      </div>
                  ))}
                </div>
                {unranked.length > 3 && (
                  <button 
                    onClick={() => toggleSection('growth-opportunities-all')}
                    className="w-full mt-3 text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
                  >
                    {expandedSections.has('growth-opportunities-all') ? 'Show fewer' : `View all ${unranked.length} opportunities`}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}
      </div>

      {/* ── KEYWORD OPPS + TARGET KEYWORDS (2-col grid) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="flex flex-wrap gap-1.5">
                {strategyData.opportunities.slice(0, 10).map((opp, i) => (
                  <span key={i} className="text-[11px] text-zinc-400 bg-zinc-950/50 border border-zinc-800/50 px-2 py-1 rounded">{opp}</span>
                ))}
                {strategyData.opportunities.length > 10 && (
                  <span className="text-[11px] text-zinc-500 px-1 py-1">+{strategyData.opportunities.length - 10} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
              {strategyData.siteKeywords.slice(0, 15).map(kw => (
                <span key={kw} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-400">
                  {kw}
                </span>
              ))}
              {strategyData.siteKeywords.length > 15 && (
                <span className="text-[11px] text-zinc-500 px-2 py-1">+{strategyData.siteKeywords.length - 15} more</span>
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      {/* ── COMPETITOR KEYWORD GAPS ── */}
      {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
        <TierGate tier={effectiveTier} required="premium" feature="Competitor Keyword Gaps" teaser={`${strategyData.keywordGaps.length} keyword gaps found — upgrade to Premium`}>
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
                <p className="text-[11px] text-zinc-500 mb-3">Keywords your competitors rank for that you don't — content gaps vs. your competition.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {strategyData.keywordGaps.slice(0, 6).map((gap, i) => (
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
              </div>
            )}
          </div>
        </TierGate>
      )}

      {/* ── PAGE KEYWORD MAP (redesigned with hierarchy & filters) ── */}
      <TierGate tier={effectiveTier} required="growth" feature="Page Performance Map" teaser={`${strategyData.pageMap.length} pages tracked`}>
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
                <div className="text-sm font-medium text-zinc-300">Page Performance Map</div>
                <div className="text-[11px] text-zinc-500">{strategyData.pageMap.length} pages with rankings & opportunities</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('page-keyword-map') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('page-keyword-map') && (
            <PageKeywordMapContent 
              pageMap={strategyData.pageMap} 
              workspaceId={workspaceId}
              setToast={setToast}
              onContentRequested={onContentRequested}
            />
          )}
        </div>
      </TierGate>
    </div>
  );
}
