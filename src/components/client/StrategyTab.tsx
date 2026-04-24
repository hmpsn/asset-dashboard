import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Zap, FileText, Sparkles, Target, CheckCircle2,
  TrendingUp, TrendingDown, Minus, ChevronDown, Layers,
  MessageCircle, BarChart3, Eye, AlertTriangle,
  ThumbsUp, ThumbsDown, Undo2, Ban, Plus, X, Briefcase,
} from 'lucide-react';
import { TierGate, EmptyState, type Tier } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { useBetaMode } from './BetaContext';
import { PageKeywordMapContent } from './PageKeywordMapContent';
import { STUDIO_NAME } from '../../constants';
import { post, keywordFeedback as kwFeedbackApi, businessPriorities as bizPrioritiesApi, trackedKeywords as trackedKwApi } from '../../api';
import { kdFraming, kdTooltip } from '../../lib/kdFraming.js';

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

const kdColor = (kd?: number) => !kd ? 'text-zinc-500' : kd <= 30 ? 'text-emerald-400' : kd <= 60 ? 'text-amber-400' : kd <= 80 ? 'text-orange-400' : 'text-red-400';
const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
const intentColor = (intent?: string) => {
  switch (intent) {
    case 'commercial': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'informational': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'transactional': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'navigational': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
    default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
  }
};


export interface KeywordFeedback {
  keyword: string;
  status: 'approved' | 'declined' | 'requested';
  reason?: string;
  source?: string;
  created_at?: string;
}

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['optimize-existing', 'new-content', 'page-keyword-map']));

  // ── Keyword Feedback State ──
  const [keywordFeedback, setKeywordFeedback] = useState<Map<string, 'approved' | 'declined' | 'requested'>>(new Map());
  const [feedbackLoading, setFeedbackLoading] = useState<Set<string>>(new Set());
  const [declineReason, setDeclineReason] = useState<{ keyword: string; source: string } | null>(null);
  const [declineReasonText, setDeclineReasonText] = useState('');
  const [feedbackLoadError, setFeedbackLoadError] = useState(false);

  // Load existing feedback on mount
  const loadFeedback = useCallback(() => {
    if (!workspaceId) return;
    setFeedbackLoadError(false);
    kwFeedbackApi.get(workspaceId)
      .then((items) => {
        const map = new Map<string, 'approved' | 'declined' | 'requested'>();
        for (const item of items as KeywordFeedback[]) map.set(item.keyword, item.status);
        setKeywordFeedback(map);
      })
      .catch(() => { setFeedbackLoadError(true); });
  }, [workspaceId]);
  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const submitFeedback = useCallback(async (keyword: string, status: 'approved' | 'declined', source: string, reason?: string) => {
    if (!workspaceId) return;
    const kw = keyword.toLowerCase().trim();
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await post(`/api/public/keyword-feedback/${workspaceId}`, { keyword: kw, status, source, reason });
      setKeywordFeedback(prev => {
        const next = new Map(prev);
        next.set(kw, status);
        return next;
      });
      setToast?.(status === 'approved' ? `"${keyword}" marked relevant — we'll prioritize this keyword` : `"${keyword}" declined — it won't appear in future strategies`);
    } catch {
      setToast?.('Failed to save feedback');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast]);

  const undoFeedback = useCallback(async (keyword: string) => {
    if (!workspaceId) return;
    const kw = keyword.toLowerCase().trim();
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.submit(workspaceId, { keyword: kw, status: 'approved' });
      setKeywordFeedback(prev => { const next = new Map(prev); next.delete(kw); return next; });
      setToast?.(`"${keyword}" restored — it will appear in future strategies`);
    } catch {
      setToast?.('Failed to undo');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast]);

  const getFeedbackStatus = (keyword: string) => keywordFeedback.get(keyword.toLowerCase().trim());
  const isLoadingFeedback = (keyword: string) => feedbackLoading.has(keyword.toLowerCase().trim());

  // ── Keyword Request State ──
  const [suggestKeyword, setSuggestKeyword] = useState('');
  const [suggestingKeyword, setSuggestingKeyword] = useState(false);
  const requestedKeywords = [...keywordFeedback.entries()].filter(([, s]) => s === 'requested').map(([k]) => k);

  const submitKeywordRequest = useCallback(async () => {
    if (!workspaceId || !suggestKeyword.trim()) return;
    const kw = suggestKeyword.trim().toLowerCase();
    setSuggestingKeyword(true);
    try {
      await post(`/api/public/keyword-feedback/${workspaceId}`, { keyword: kw, status: 'requested', source: 'content_gap' });
      setKeywordFeedback(prev => { const next = new Map(prev); next.set(kw, 'requested'); return next; });
      setSuggestKeyword('');
      setToast?.(`"${suggestKeyword.trim()}" submitted — it will be prioritized in your next strategy`);
    } catch {
      setToast?.('Failed to submit keyword suggestion');
    } finally {
      setSuggestingKeyword(false);
    }
  }, [workspaceId, suggestKeyword, setToast]);

  // ── Business Priorities State ──
  const [priorities, setPriorities] = useState<{ text: string; category: string }[]>([]);
  const [prioritiesLoaded, setPrioritiesLoaded] = useState(false);
  const [newPriority, setNewPriority] = useState('');
  const [newPriorityCategory, setNewPriorityCategory] = useState('growth');
  const [savingPriorities, setSavingPriorities] = useState(false);

  // ── Tracked Keywords State ──
  const [trackedKeywords, setTrackedKeywords] = useState<{ query: string; pinned: boolean; addedAt: string }[]>([]);
  const [newTrackedKeyword, setNewTrackedKeyword] = useState('');
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [trackedKeywordsError, setTrackedKeywordsError] = useState(false);

  // Load business priorities + tracked keywords on mount
  const loadTrackedKeywords = useCallback(() => {
    if (!workspaceId) return;
    setTrackedKeywordsError(false);
    trackedKwApi.get(workspaceId)
      .then((data) => {
        setTrackedKeywords(data.keywords || []);
      })
      .catch(() => { setTrackedKeywordsError(true); });
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    bizPrioritiesApi.get(workspaceId)
      .then((data) => {
        setPriorities(data.priorities || []);
        setPrioritiesLoaded(true);
      })
      .catch(() => setPrioritiesLoaded(true));
    loadTrackedKeywords();
  }, [workspaceId, loadTrackedKeywords]);

  const savePriorities = useCallback(async (newList: { text: string; category: string }[]) => {
    if (!workspaceId) return;
    setSavingPriorities(true);
    try {
      await post(`/api/public/business-priorities/${workspaceId}`, { priorities: newList });
      setPriorities(newList);
      setToast?.('Business priorities saved — they\'ll shape your next strategy');
    } catch {
      setToast?.('Failed to save priorities');
    } finally {
      setSavingPriorities(false);
    }
  }, [workspaceId, setToast]);


  // Refs for scroll-to-section
  const optimizeExistingRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);
  const keywordMapRef = useRef<HTMLDivElement>(null);

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
    <div className="space-y-8">
      {/* Header + Strategy Health Score */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">SEO Keyword Strategy</h2>
          <p className="text-sm text-zinc-500 mt-1">Generated {new Date(strategyData.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>

      {/* Unvalidated strategy note */}
      {!strategyData.pageMap.some(p => p.volume && p.volume > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-2.5" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/90 leading-relaxed">
            Keyword volume and difficulty metrics are currently unavailable for this strategy. The recommendations are based on AI analysis and site content.
          </div>
        </div>
      )}

      {/* Strategy Health Score Card */}
      <div className="bg-zinc-900 border border-zinc-800 p-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-zinc-800/50">
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

      {/* ── TOP SUMMARY BAR (3 consolidated sections) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Optimize Existing Pages */}
        {(quickWinsAvailable > 0 || pagesWithGrowthOpps > 0) && (
          <div className="bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-200">Optimize Existing Pages</div>
              <div className="text-[11px] text-zinc-500">{quickWinsAvailable + pagesWithGrowthOpps} improvements found</div>
            </div>
            <button
              onClick={() => scrollToSection('optimize-existing', optimizeExistingRef)}
              className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-[11px] text-amber-300 font-medium hover:bg-amber-600/30 transition-colors flex-shrink-0"
            >
              View
            </button>
          </div>
        )}

        {/* New Content to Create */}
        <div className="bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200">New Content to Create</div>
            <div className="text-[11px] text-zinc-500">{contentGapsFound + (strategyData.keywordGaps?.length || 0)} topics identified</div>
          </div>
          <button
            onClick={() => scrollToSection('new-content', newContentRef)}
            className="px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/30 transition-colors flex-shrink-0"
          >
            Explore
          </button>
        </div>

        {/* Your Keyword Map */}
        <div className="bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Layers className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200">Your Keyword Map</div>
            <div className="text-[11px] text-zinc-500">{totalPages} pages mapped</div>
          </div>
          <button
            onClick={() => scrollToSection('page-keyword-map', keywordMapRef)}
            className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[11px] text-blue-300 font-medium hover:bg-blue-600/30 transition-colors flex-shrink-0"
          >
            View
          </button>
        </div>
      </div>

      {/* ── LOAD ERRORS (surfaced at top so errors aren't hidden behind collapsed sections) ── */}
      {(feedbackLoadError || trackedKeywordsError) && (
        <div className="space-y-1">
          {feedbackLoadError && (
            <p className="text-[11px] text-red-400/80">
              Couldn't load your previous keyword feedback — your approvals and declines may not reflect correctly.{' '}
              <button onClick={loadFeedback} className="underline hover:text-red-400">Retry</button>
            </p>
          )}
          {trackedKeywordsError && (
            <p className="text-[11px] text-red-400/80">
              Couldn't load your tracked keywords.{' '}
              <button onClick={loadTrackedKeywords} className="underline hover:text-red-400">Retry</button>
            </p>
          )}
        </div>
      )}

      {/* ── BUSINESS PRIORITIES (client driver's seat) ── */}
      {workspaceId && prioritiesLoaded && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleSection('business-priorities')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <Briefcase className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Your Business Priorities</div>
                <div className="text-[11px] text-zinc-500">
                  {priorities.length > 0
                    ? `${priorities.length} priorities shaping your strategy`
                    : 'Tell us what matters most to your business'}
                </div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('business-priorities') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('business-priorities') && (
            <div className="px-4 pb-4 border-t border-zinc-800/50">
              <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                Share your business goals and priorities. These will be factored into your next strategy generation so recommendations align with what matters most to you.
              </p>

              {/* Existing priorities */}
              {priorities.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {priorities.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950/50 border border-zinc-800/50 group">
                      <span className={`text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        p.category === 'growth' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        p.category === 'brand' ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' :
                        p.category === 'product' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        p.category === 'audience' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        p.category === 'competitive' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-zinc-700/50 text-zinc-400 border border-zinc-600/30'
                      }`}>{p.category}</span>
                      <span className="text-[11px] text-zinc-300 flex-1">{p.text}</span>
                      <button
                        onClick={() => {
                          const next = priorities.filter((_, j) => j !== i);
                          savePriorities(next);
                        }}
                        disabled={savingPriorities}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new priority */}
              <div className="flex items-center gap-2">
                <select
                  value={newPriorityCategory}
                  onChange={e => setNewPriorityCategory(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500"
                >
                  <option value="growth">Growth</option>
                  <option value="brand">Brand</option>
                  <option value="product">Product</option>
                  <option value="audience">Audience</option>
                  <option value="competitive">Competitive</option>
                  <option value="other">Other</option>
                </select>
                <input
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newPriority.trim()) {
                      savePriorities([...priorities, { text: newPriority.trim(), category: newPriorityCategory }]);
                      setNewPriority('');
                    }
                  }}
                  placeholder="e.g., We're launching a new product line in Q3..."
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500"
                />
                <button
                  onClick={() => {
                    if (newPriority.trim()) {
                      savePriorities([...priorities, { text: newPriority.trim(), category: newPriorityCategory }]);
                      setNewPriority('');
                    }
                  }}
                  disabled={!newPriority.trim() || savingPriorities || priorities.length >= 10}
                  className="px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/30 transition-colors flex items-center gap-1 disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {priorities.length >= 10 && (
                <p className="text-[10px] text-zinc-600 mt-1.5">Maximum 10 priorities reached</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SUGGEST A KEYWORD ── */}
      {workspaceId && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleSection('suggest-keyword')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Suggest a Keyword</div>
                <div className="text-[11px] text-zinc-500">
                  {requestedKeywords.length > 0
                    ? `${requestedKeywords.length} keyword${requestedKeywords.length > 1 ? 's' : ''} submitted`
                    : 'Submit keyword ideas for your next strategy'}
                </div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('suggest-keyword') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('suggest-keyword') && (
            <div className="px-4 pb-4 border-t border-zinc-800/50">
              <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                Have a keyword idea? Submit it here and it will be given high priority in your next strategy generation.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={suggestKeyword}
                  onChange={e => setSuggestKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitKeywordRequest()}
                  placeholder="e.g., best project management tools"
                  className="flex-1 px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
                />
                <button
                  onClick={submitKeywordRequest}
                  disabled={!suggestKeyword.trim() || suggestingKeyword}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 transition-colors disabled:opacity-50"
                >
                  {suggestingKeyword ? 'Submitting...' : 'Submit'}
                </button>
              </div>
              {requestedKeywords.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] text-zinc-600 tracking-wider font-medium">Your Suggestions</div>
                  {requestedKeywords.map(kw => (
                    <div key={kw} className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/40 rounded-lg border border-zinc-800">
                      <span className="text-[11px] text-zinc-300">{kw}</span>
                      <span className="text-[10px] text-teal-400/60 font-medium">Pending</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── NEW CONTENT TO CREATE (Content Gaps + Keyword Opps + Competitor Gaps) ── */}
      <div ref={newContentRef}>
        <TierGate tier={effectiveTier} required="growth" feature="New Content to Create" teaser={`${(strategyData.contentGaps?.length || 0) + (strategyData.keywordGaps?.length || 0)} content topics identified — upgrade to unlock recommendations`}>
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleSection('new-content')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">New Content to Create</div>
                <div className="text-[11px] text-zinc-500">{(strategyData.contentGaps?.length || 0) + (strategyData.keywordGaps?.length || 0) + strategyData.opportunities.length} topics & keywords identified</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">{(strategyData.contentGaps?.length || 0) + (strategyData.keywordGaps?.length || 0)}</span>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('new-content') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('new-content') && (
            <div className="px-4 pb-4 border-t border-zinc-800/50">
              <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                Topics, keywords, and competitor gaps that represent new content opportunities for your site.
              </p>

              {/* Content Gaps sub-section */}
              {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
              <>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs font-medium text-zinc-300">Content Gaps</span>
                <span className="text-[10px] text-zinc-600">({strategyData.contentGaps.length})</span>
              </div>
              <div className="space-y-2">
                {[...strategyData.contentGaps]
                  // Sort by opportunity score descending (server-computed composite signal)
                  .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
                  .slice(0, expandedSections.has('new-content-gaps-all') ? undefined : 6).map((gap, i) => {
                  const matchingReq = contentRequests?.find(r => r.targetKeyword === gap.targetKeyword && r.status !== 'declined');
                  const alreadyRequested = matchingReq != null || requestedTopics.has(gap.targetKeyword);
                  const planStatus = contentPlanKeywords?.get(gap.targetKeyword.toLowerCase());
                  const pageType = gap.suggestedPageType || 'blog';
                  const isDataValidated = (gap.volume != null && gap.volume > 0) || (gap.impressions != null && gap.impressions > 0);
                  const hasTrendOrSerp = gap.trendDirection || (Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0) || gap.competitorProof;
                  return (
                    <div key={i} className="px-3 py-2.5 bg-zinc-800/40 rounded-lg border border-zinc-800 hover:border-teal-500/20 transition-colors">
                      {/* Row 1: topic title + intent/page-type badges */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-zinc-100">{gap.topic}{gap.opportunityScore != null && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                              {gap.opportunityScore}/100
                            </span>
                          )}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {gap.intent && (
                            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-full border font-medium ${intentColor(gap.intent)}`}>{gap.intent}</span>
                          )}
                          {pageType !== 'blog' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium capitalize">{pageType}</span>
                          )}
                        </div>
                      </div>
                      {/* Row 2: target keyword + metrics */}
                      <div className="flex items-center gap-3 flex-wrap mb-1.5">
                        <span className="text-[11px] text-teal-400">&ldquo;{gap.targetKeyword}&rdquo;</span>
                        {gap.volume != null && gap.volume > 0 && (
                          <span className="text-[10px] text-zinc-400 flex items-center gap-0.5"><BarChart3 className="w-3 h-3" />{fmtNum(gap.volume)}/mo</span>
                        )}
                        {gap.difficulty != null && gap.difficulty > 0 && (
                          <>
                            <span className={`text-[10px] font-medium ${kdColor(gap.difficulty)} cursor-help`} title={kdTooltip(gap.difficulty)}>KD {gap.difficulty}</span>
                            {kdFraming(gap.difficulty) && (
                              <span className="text-[10px] text-zinc-500">{kdFraming(gap.difficulty)}</span>
                            )}
                          </>
                        )}
                        {gap.impressions != null && gap.impressions > 0 && (
                          <span className="text-[10px] text-blue-400 flex items-center gap-0.5"><Eye className="w-3 h-3" />{fmtNum(gap.impressions)} impr</span>
                        )}
                        {isDataValidated && (
                          <span className="text-[10px] text-emerald-400/70">✓ data-backed</span>
                        )}
                      </div>
                      {/* Trend + SERP + Competitor badges */}
                      {hasTrendOrSerp && (
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          {gap.trendDirection === 'rising' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium"><TrendingUp className="w-3 h-3" />Rising</span>
                          )}
                          {gap.trendDirection === 'declining' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-medium"><TrendingDown className="w-3 h-3" />Declining</span>
                          )}
                          {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-zinc-400 font-medium"><Minus className="w-3 h-3" />Stable</span>
                          )}
                          {Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0 && gap.serpFeatures.map(feat => {
                            const labels: Record<string, string> = {
                              featured_snippet: '⬜ Snippet',
                              people_also_ask: '❓ PAA',
                              video: '▶ Video',
                              local_pack: '📍 Local',
                            };
                            return (
                              <span key={feat} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {labels[feat] ?? feat}
                              </span>
                            );
                          })}
                          {gap.competitorProof && (
                            <span className="text-[10px] text-orange-400 font-medium">{gap.competitorProof}</span>
                          )}
                        </div>
                      )}
                      {/* Rationale */}
                      <div className="text-[11px] text-zinc-500 leading-snug mb-2">{gap.rationale}</div>
                      {/* Footer: keyword feedback + action buttons */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Keyword feedback */}
                        {workspaceId && (() => {
                          const fbStatus = getFeedbackStatus(gap.targetKeyword);
                          const loading = isLoadingFeedback(gap.targetKeyword);
                          if (fbStatus === 'declined') return (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-red-500/5 border border-red-500/20">
                              <Ban className="w-3 h-3 text-red-400 flex-shrink-0" />
                              <span className="text-[10px] text-red-400">Declined</span>
                              <button onClick={() => undoFeedback(gap.targetKeyword)} disabled={loading} className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-0.5 transition-colors disabled:opacity-50">
                                <Undo2 className="w-3 h-3" /> Undo
                              </button>
                            </div>
                          );
                          if (fbStatus === 'approved') return (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                              <ThumbsUp className="w-3 h-3 text-emerald-400" />
                              <span className="text-[10px] text-emerald-400">Approved</span>
                            </div>
                          );
                          return (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => submitFeedback(gap.targetKeyword, 'approved', 'content_gap')}
                                disabled={loading}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                              >
                                <ThumbsUp className="w-3 h-3" /> Relevant
                              </button>
                              <button
                                onClick={() => { setDeclineReason({ keyword: gap.targetKeyword, source: 'content_gap' }); setDeclineReasonText(''); }}
                                disabled={loading}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                <ThumbsDown className="w-3 h-3" /> Not relevant
                              </button>
                            </div>
                          );
                        })()}
                        {/* Action buttons */}
                        {!betaMode && (alreadyRequested ? (
                          (() => {
                            const s = matchingReq?.status;
                            if (s === 'published') return (
                              <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 flex-shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Published
                              </span>
                            );
                            if (s === 'delivered') return (
                              <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" /> In Production
                              </span>
                            );
                            if (s === 'approved' || s === 'in_progress') return (
                              <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0">
                                <Sparkles className="w-3.5 h-3.5" /> In Production
                              </span>
                            );
                            if (s === 'brief_generated' || s === 'client_review') return (
                              <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0">
                                <FileText className="w-3.5 h-3.5" /> Brief Requested
                              </span>
                            );
                            return (
                              <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20 flex-shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Brief Ordered
                              </span>
                            );
                          })()
                        ) : planStatus ? (
                          <button
                            onClick={() => onTabChange?.('content-plan')}
                            className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 flex-shrink-0 hover:bg-teal-500/20 transition-colors"
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
              {strategyData.contentGaps.length > 6 && (
                <button
                  onClick={() => toggleSection('new-content-gaps-all')}
                  className="w-full mt-3 text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
                >
                  {expandedSections.has('new-content-gaps-all') ? 'Show fewer' : `View all ${strategyData.contentGaps.length} opportunities`}
                </button>
              )}
              </>
              )}

              {/* Competitor Keyword Gaps sub-section */}
              {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-xs font-medium text-zinc-300">Competitor Keyword Gaps</span>
                    <span className="text-[10px] text-zinc-600">({strategyData.keywordGaps.length})</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mb-2">Keywords your competitors rank for that you don't.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {strategyData.keywordGaps.slice(0, expandedSections.has('competitor-gaps-all') ? undefined : 6).map((gap, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                        <span className="text-[11px] text-zinc-300 font-medium truncate mr-2">{gap.keyword}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gap.volume != null && gap.volume > 0 && <span className="text-[11px] text-zinc-500">{gap.volume.toLocaleString()}</span>}
                          {gap.difficulty != null && gap.difficulty > 0 && (
                            <span className={`text-[11px] font-medium ${kdColor(gap.difficulty)}`}>
                              KD {gap.difficulty}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {strategyData.keywordGaps.length > 6 && (
                    <button
                      onClick={() => toggleSection('competitor-gaps-all')}
                      className="w-full mt-2 text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {expandedSections.has('competitor-gaps-all') ? 'Show fewer' : `View all ${strategyData.keywordGaps.length}`}
                    </button>
                  )}
                </div>
              )}

              {/* Keyword Opportunities sub-section */}
              {strategyData.opportunities.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                    <span className="text-xs font-medium text-zinc-300">Keyword Opportunities</span>
                    <span className="text-[10px] text-zinc-600">({strategyData.opportunities.length})</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mb-2">Additional keywords your existing pages could target.</p>
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
        </div>
        </TierGate>
      </div>

      {/* ── OPTIMIZE EXISTING PAGES (Quick Wins + Growth Opportunities merged) ── */}
      {(quickWinsAvailable > 0 || pagesWithGrowthOpps > 0) && (
      <div ref={optimizeExistingRef}>
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleSection('optimize-existing')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Optimize Existing Pages</div>
                <div className="text-[11px] text-zinc-500">{quickWinsAvailable + pagesWithGrowthOpps} improvements across your site</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">{quickWinsAvailable + pagesWithGrowthOpps}</span>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('optimize-existing') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('optimize-existing') && (
            <div className="px-4 pb-4 border-t border-zinc-800/50">
              <p className="text-[11px] text-zinc-400 mt-3 mb-3 leading-relaxed">
                These are improvements to pages you already have — sorted by estimated impact. Quick wins are low-effort fixes; growth opportunities are pages with untapped potential.
              </p>

              {/* Quick Wins sub-section */}
              {strategyData.quickWins && strategyData.quickWins.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-zinc-300">Quick Wins</span>
                    <span className="text-[10px] text-zinc-600">({strategyData.quickWins.length})</span>
                  </div>
                  <div className="space-y-2">
                    {strategyData.quickWins.slice(0, expandedSections.has('quick-wins-all') ? undefined : 3).map((qw, i) => {
                      const impactColor = qw.estimatedImpact === 'high' ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
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
                </div>
              )}

              {/* Growth Opportunities sub-section */}
              {(() => {
                const unranked = strategyData.pageMap
                  .filter(p => !p.currentPosition)
                  .map(p => {
                    const reasons: string[] = [];
                    const hasImpressions = (p.impressions || 0) > 0;
                    const highKD = (p.difficulty || 0) > 60;
                    const medKD = (p.difficulty || 0) > 30;

                    if (hasImpressions) {
                      reasons.push('Google is already crawling this page — close to breaking through');
                    } else if (highKD) {
                      reasons.push(`Competitive keyword (${p.difficulty}% difficulty) — authority building will help`);
                    } else if (medKD) {
                      reasons.push('Moderate competition — content depth can unlock this');
                    } else {
                      reasons.push('Low competition — quick win with content improvements');
                    }

                    const intentScore = p.searchIntent === 'commercial' ? 3 : p.searchIntent === 'transactional' ? 3 : p.searchIntent === 'informational' ? 1 : 2;
                    const priority = intentScore * 100 + (hasImpressions ? 50 : 0) + (100 - (p.difficulty || 50));
                    return { ...p, reasons, priority, hasImpressions };
                  })
                  .sort((a, b) => {
                    if (a.hasImpressions !== b.hasImpressions) return a.hasImpressions ? -1 : 1;
                    return b.priority - a.priority;
                  });

                if (unranked.length === 0) return null;
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium text-zinc-300">Growth Opportunities</span>
                      <span className="text-[10px] text-zinc-600">({unranked.length})</span>
                    </div>
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
                                <span className={`text-[10px] ${kdColor(page.difficulty)}`}>
                                  KD {page.difficulty}
                                </span>
                              )}
                            </div>
                            {workspaceId && (
                              <button
                                onClick={() => {
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
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── YOUR KEYWORD MAP (Page Map + Target Keywords + Tracked Keywords) ── */}
      <div ref={keywordMapRef}>
      <TierGate tier={effectiveTier} required="growth" feature="Your Keyword Map" teaser={`${strategyData.pageMap.length} pages tracked`}>
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleSection('page-keyword-map')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">Your Keyword Map</div>
                <div className="text-[11px] text-zinc-500">{strategyData.pageMap.length} pages mapped · {strategyData.siteKeywords.length} keywords tracked</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('page-keyword-map') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('page-keyword-map') && (
            <>
            {/* Target Keywords sub-section */}
            <div className="px-4 pt-3 pb-3 border-t border-zinc-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs font-medium text-zinc-300">Target Keywords</span>
                <span className="text-[10px] text-zinc-600">({strategyData.siteKeywords.length})</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {strategyData.siteKeywords.slice(0, 15).map(kw => (
                  <span key={kw} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-400">
                    {kw}
                  </span>
                ))}
                {strategyData.siteKeywords.length > 15 && (
                  <span className="text-[11px] text-zinc-500 px-2 py-1">+{strategyData.siteKeywords.length - 15} more</span>
                )}
              </div>
              {/* Client-added keywords */}
              {(() => {
                const strategySet = new Set(strategyData.siteKeywords.map(k => k.toLowerCase().trim()));
                const clientAdded = trackedKeywords.filter(tk => !strategySet.has(tk.query.toLowerCase().trim()));
                return clientAdded.length > 0 ? (
                  <div className="mb-3">
                    <div className="text-[10px] text-zinc-500 tracking-wider mb-1.5">Your keywords</div>
                    <div className="flex flex-wrap gap-2">
                      {clientAdded.map(tk => (
                        <span key={tk.query} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-teal-500/10 border border-teal-500/20 text-[11px] text-teal-400">
                          {tk.query}
                          <button
                            onClick={async () => {
                              try {
                                const data = await trackedKwApi.remove(workspaceId!, tk.query);
                                setTrackedKeywords(data.keywords || []);
                                setToast?.(`"${tk.query}" removed from tracking`);
                              } catch { setToast?.('Failed to remove keyword'); }
                            }}
                            className="text-zinc-500 hover:text-red-400 transition-colors"
                            title="Remove keyword"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}
              {/* Add keyword input */}
              {workspaceId && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const kw = newTrackedKeyword.trim();
                    if (!kw || kw.length < 2 || addingKeyword) return;
                    setAddingKeyword(true);
                    try {
                      const res = await post(`/api/public/tracked-keywords/${workspaceId}`, { keyword: kw });
                      setTrackedKeywords((res as { keywords: typeof trackedKeywords }).keywords || []);
                      setNewTrackedKeyword('');
                      setToast?.(`"${kw}" added to keyword tracking`);
                    } catch {
                      setToast?.('Failed to add keyword');
                    } finally {
                      setAddingKeyword(false);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={newTrackedKeyword}
                    onChange={e => setNewTrackedKeyword(e.target.value)}
                    placeholder="Add a keyword to track..."
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-colors"
                    maxLength={120}
                  />
                  <button
                    type="submit"
                    disabled={addingKeyword || newTrackedKeyword.trim().length < 2}
                    className="px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/30 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Track
                  </button>
                </form>
              )}
            </div>

            {/* Page Performance Map */}
            <PageKeywordMapContent
              pageMap={strategyData.pageMap}
              workspaceId={workspaceId}
              setToast={setToast}
              onContentRequested={onContentRequested}
              keywordFeedback={keywordFeedback}
              onApproveKeyword={(kw, source) => submitFeedback(kw, 'approved', source)}
              onDeclineKeyword={(kw, source) => { setDeclineReason({ keyword: kw, source }); setDeclineReasonText(''); }}
              onUndoFeedback={undoFeedback}
              isLoadingFeedback={isLoadingFeedback}
            />
            </>
          )}
        </div>
      </TierGate>
      </div>

      {/* ── DECLINED KEYWORDS SUMMARY ── */}
      {(() => {
        const declined = [...keywordFeedback.entries()].filter(([, s]) => s === 'declined');
        if (declined.length === 0) return null;
        return (
          <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
            <button
              onClick={() => toggleSection('declined-keywords')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-zinc-300">Declined Keywords</div>
                  <div className="text-[11px] text-zinc-500">{declined.length} keywords excluded from future strategies</div>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('declined-keywords') ? '' : '-rotate-90'}`} />
            </button>

            {expandedSections.has('declined-keywords') && (
              <div className="px-4 pb-4 border-t border-zinc-800/50">
                <p className="text-[11px] text-zinc-500 mt-3 mb-3">These keywords won't appear in future strategy recommendations. Click restore to bring them back.</p>
                <div className="flex flex-wrap gap-2">
                  {declined.map(([kw]) => (
                    <div key={kw} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20">
                      <span className="text-[11px] text-red-300">{kw}</span>
                      <button
                        onClick={() => undoFeedback(kw)}
                        disabled={isLoadingFeedback(kw)}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-0.5 disabled:opacity-50"
                      >
                        <Undo2 className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Decline Reason Modal ── */}
      {declineReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeclineReason(null)}>
          {/* pr-check-disable-next-line -- Decline Reason modal dialog; floated over fullscreen overlay, not a content card */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">Decline keyword</h3>
            <p className="text-[11px] text-zinc-500 mb-3">
              <span className="text-red-400 font-medium">&ldquo;{declineReason.keyword}&rdquo;</span> will be excluded from future strategy recommendations.
            </p>
            <label className="block text-[11px] text-zinc-400 mb-1">Why isn't this keyword relevant? <span className="text-zinc-600">(optional)</span></label>
            <textarea
              value={declineReasonText}
              onChange={e => setDeclineReasonText(e.target.value)}
              placeholder="e.g., We don't offer this service, too competitive, not our target audience..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none h-20"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => setDeclineReason(null)}
                className="px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  submitFeedback(declineReason.keyword, 'declined', declineReason.source, declineReasonText || undefined);
                  setDeclineReason(null);
                  setDeclineReasonText('');
                }}
                className="px-4 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-[11px] text-red-300 font-medium hover:bg-red-600/30 transition-colors flex items-center gap-1"
              >
                <ThumbsDown className="w-3 h-3" /> Decline Keyword
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
