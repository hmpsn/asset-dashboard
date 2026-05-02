import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Zap, FileText, Sparkles, Target, CheckCircle2,
  TrendingUp, TrendingDown, Minus, ChevronDown, Layers,
  MessageCircle, BarChart3, Eye, AlertTriangle,
  ThumbsUp, ThumbsDown, Undo2, Ban, Plus, X, Briefcase, Search,
} from 'lucide-react';
import { TierGate, EmptyState, type Tier, Icon, Button } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { useBetaMode } from './BetaContext';
import { PageKeywordMapContent } from './PageKeywordMapContent';
import { STUDIO_NAME } from '../../constants';
import { post, keywordFeedback as kwFeedbackApi, businessPriorities as bizPrioritiesApi, trackedKeywords as trackedKwApi } from '../../api';
import { kdFraming, kdTooltip } from '../../lib/kdFraming.js';
import { Modal } from '../ui/overlay/Modal';

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
  /** When true (external billing), hide price chips on request buttons. */
  hidePrices?: boolean;
}

const kdColor = (kd?: number) => !kd ? 'text-[var(--brand-text-muted)]' : kd <= 30 ? 'text-accent-success' : kd <= 60 ? 'text-accent-warning' : kd <= 80 ? 'text-accent-orange' : 'text-accent-danger';
const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
const normalizeKeyword = (keyword: string) => keyword.toLowerCase().trim();
const intentColor = (intent?: string) => {
  switch (intent) {
    case 'commercial': return 'text-accent-info bg-blue-500/10 border-blue-500/20';
    case 'informational': return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
    case 'transactional': return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
    case 'navigational': return 'text-accent-cyan bg-cyan-500/10 border-cyan-500/20';
    default: return 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/10 border-[var(--brand-border)]/20';
  }
};


export interface KeywordFeedback {
  keyword: string;
  status: 'approved' | 'declined' | 'requested';
  reason?: string;
  source?: string;
  created_at?: string;
}

type PriorityKeywordSource = 'strategy' | 'client' | 'requested';

interface PriorityKeywordItem {
  label: string;
  source: PriorityKeywordSource;
}

function priorityFeedbackSource(source: PriorityKeywordSource): string {
  if (source === 'strategy') return 'topic_cluster';
  if (source === 'requested') return 'content_gap';
  // Client-added keywords are tracked-keyword records; this source is only used if they later need feedback parity.
  return 'page_map';
}

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested, hidePrices }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['new-content', 'optimize-existing']));

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
      setToast?.(status === 'approved' ? `"${keyword}" marked relevant - it can shape future recommendations` : `"${keyword}" marked not relevant - it won't appear in future strategies`);
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
      await kwFeedbackApi.remove(workspaceId, kw);
      setKeywordFeedback(prev => { const next = new Map(prev); next.delete(kw); return next; });
      setToast?.(`"${keyword}" restored - it can appear in future strategies`);
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
    if (!workspaceId || !suggestKeyword.trim() || suggestingKeyword) return;
    const kw = normalizeKeyword(suggestKeyword);
    if (keywordFeedback.get(kw) === 'requested') {
      setToast?.(`"${suggestKeyword.trim()}" has already been submitted for your next strategy`);
      return;
    }
    setSuggestingKeyword(true);
    try {
      await post(`/api/public/keyword-feedback/${workspaceId}`, { keyword: kw, status: 'requested', source: 'content_gap' });
      setKeywordFeedback(prev => { const next = new Map(prev); next.set(kw, 'requested'); return next; });
      setSuggestKeyword('');
      setToast?.(`"${suggestKeyword.trim()}" submitted - it will be considered in your next strategy`);
    } catch {
      setToast?.('Failed to submit keyword suggestion');
    } finally {
      setSuggestingKeyword(false);
    }
  }, [workspaceId, suggestKeyword, suggestingKeyword, keywordFeedback, setToast]);

  // ── Business Priorities State ──
  const [priorities, setPriorities] = useState<{ text: string; category: string }[]>([]);
  const [prioritiesLoaded, setPrioritiesLoaded] = useState(false);
  const [newPriority, setNewPriority] = useState('');
  const [newPriorityCategory, setNewPriorityCategory] = useState('growth');
  const [savingPriorities, setSavingPriorities] = useState(false);

  // ── Priority keyword state backed by tracked-keyword APIs ──
  const [trackedKeywords, setTrackedKeywords] = useState<{ query: string; pinned: boolean; addedAt: string }[]>([]);
  const [newTrackedKeyword, setNewTrackedKeyword] = useState('');
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const [confirmRemoveKeyword, setConfirmRemoveKeyword] = useState<string | null>(null);
  const [showAllPriorityKeywords, setShowAllPriorityKeywords] = useState(false);
  const [priorityKeywordSearch, setPriorityKeywordSearch] = useState('');
  const [trackedKeywordsError, setTrackedKeywordsError] = useState(false);
  const [discussingGrowthPage, setDiscussingGrowthPage] = useState<string | null>(null);

  const removePriorityKeyword = useCallback(async (item: PriorityKeywordItem) => {
    if (!workspaceId) return;
    const kw = normalizeKeyword(item.label);
    if (!kw || removingKeyword === kw) return;
    setRemovingKeyword(kw);
    try {
      if (item.source === 'client') {
        const data = await trackedKwApi.remove(workspaceId, item.label);
        setTrackedKeywords(data.keywords || []);
        setToast?.(`"${item.label}" removed from future tracking. Historical ranking data is preserved.`);
      } else if (item.source === 'requested') {
        await kwFeedbackApi.remove(workspaceId, kw);
        setKeywordFeedback(prev => {
          const next = new Map(prev);
          next.delete(kw);
          return next;
        });
        setToast?.(`"${item.label}" removed from requested priority keywords`);
      } else {
        await kwFeedbackApi.submit(workspaceId, {
          keyword: kw,
          status: 'declined',
          source: priorityFeedbackSource(item.source),
          reason: 'Removed from priority keywords',
        });
        setKeywordFeedback(prev => {
          const next = new Map(prev);
          next.set(kw, 'declined');
          return next;
        });
        setToast?.(`"${item.label}" removed from priority keywords - it won't be targeted in future strategies`);
      }
      setConfirmRemoveKeyword(null);
    } catch {
      setToast?.('Failed to remove keyword');
    } finally {
      setRemovingKeyword(null);
    }
  }, [workspaceId, removingKeyword, setToast]);

  // Load business priorities + priority keyword data on mount
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
      setToast?.('Business priorities saved - they will shape your next strategy');
    } catch {
      setToast?.('Failed to save priorities');
    } finally {
      setSavingPriorities(false);
    }
  }, [workspaceId, setToast]);


  // Refs for scroll-to-section
  const priorityKeywordsRef = useRef<HTMLDivElement>(null);
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
  const keywordGapCount = strategyData.keywordGaps?.length || 0;
  const newContentTopicCount = contentGapsFound + keywordGapCount;
  const pagesRanking = strategyData.pageMap.filter(p => p.currentPosition).length;
  const totalPages = strategyData.pageMap.length;
  const pagesWithGrowthOpps = strategyData.pageMap.filter(p => !p.currentPosition && (p.impressions || 0) > 0).length;
  
  // Score: content gaps (40) + quick wins (30) + coverage (30)
  const contentScore = Math.min(40, contentGapsFound * 4); // 10 gaps = max
  const quickWinScore = Math.min(30, quickWinsAvailable * 6); // 5 quick wins = max
  const coverageScore = Math.round((pagesRanking / Math.max(1, totalPages)) * 30);
  const healthScore = contentScore + quickWinScore + coverageScore;

  const totalPageImprovements = quickWinsAvailable + pagesWithGrowthOpps;
  const priorityKeywordMap = new Map<string, PriorityKeywordItem>();
  strategyData.siteKeywords.forEach(kw => {
    const normalized = normalizeKeyword(kw);
    if (normalized && keywordFeedback.get(normalized) !== 'declined') priorityKeywordMap.set(normalized, { label: kw, source: 'strategy' });
  });
  trackedKeywords.forEach(tk => {
    const normalized = normalizeKeyword(tk.query);
    if (normalized && keywordFeedback.get(normalized) !== 'declined' && !priorityKeywordMap.has(normalized)) {
      priorityKeywordMap.set(normalized, { label: tk.query, source: 'client' });
    }
  });
  requestedKeywords.forEach(kw => {
    const normalized = normalizeKeyword(kw);
    if (normalized && !priorityKeywordMap.has(normalized)) {
      priorityKeywordMap.set(normalized, { label: kw, source: 'requested' });
    }
  });
  const priorityKeywords = [...priorityKeywordMap.values()];
  const priorityKeywordSearchTerm = normalizeKeyword(priorityKeywordSearch);
  const filteredPriorityKeywords = priorityKeywordSearchTerm
    ? priorityKeywords.filter(item => normalizeKeyword(item.label).includes(priorityKeywordSearchTerm))
    : priorityKeywords;
  const hasPriorityKeywordSearch = priorityKeywordSearchTerm.length > 0;
  const visiblePriorityKeywords = (showAllPriorityKeywords || hasPriorityKeywordSearch)
    ? filteredPriorityKeywords
    : filteredPriorityKeywords.slice(0, 18);
  const hiddenPriorityKeywordCount = Math.max(0, filteredPriorityKeywords.length - visiblePriorityKeywords.length);
  const priorityKeywordGroups = [
    {
      source: 'client' as const,
      label: 'Client-added',
      helper: 'Can be removed from future tracking.',
      items: visiblePriorityKeywords.filter(item => item.source === 'client'),
    },
    {
      source: 'requested' as const,
      label: 'Requested',
      helper: 'Sent to the team for review.',
      items: visiblePriorityKeywords.filter(item => item.source === 'requested'),
    },
    {
      source: 'strategy' as const,
      label: 'Strategy keywords',
      helper: "Recommended based on your site's strategy.",
      items: visiblePriorityKeywords.filter(item => item.source === 'strategy'),
    },
  ].filter(group => group.items.length > 0);

  const priorityKeywordsPanel = (
    // pr-check-disable-next-line -- Brand signature radius intentional for top-level strategy surface
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center">
                <Icon as={Target} size="md" className="text-accent-brand" />
              </div>
              <div>
                <h3 className="t-h3 text-[var(--brand-text)]">Priority Keywords</h3>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">{priorityKeywords.length} keywords guiding tracking and future recommendations</p>
              </div>
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed max-w-3xl">
              These are the search themes we are watching or considering. Clients can add ideas or remove anything that should not guide the strategy; historical ranking data is preserved.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => scrollToSection('page-keyword-map', keywordMapRef)} className="self-start">
            View Page Map
          </Button>
        </div>
      </div>

      <div className="px-4 pb-4">
        {workspaceId && (
          <div className="mb-4">
            <div className="flex flex-col gap-1 mb-2 sm:flex-row sm:items-end sm:justify-between">
              <label htmlFor="priority-keyword-input" className="t-caption-sm font-medium text-[var(--brand-text)]">
                Add a priority keyword
              </label>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                Starts future rank tracking; strategy updates on the next refresh.
              </span>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const kw = newTrackedKeyword.trim();
                if (!kw || kw.length < 2 || addingKeyword) return;
                const normalized = normalizeKeyword(kw);
                const existingPriorityKeyword = priorityKeywordMap.get(normalized);
                if (existingPriorityKeyword && existingPriorityKeyword.source !== 'requested') {
                  setToast?.(`"${kw}" is already a priority keyword`);
                  return;
                }
                setAddingKeyword(true);
                try {
                  const res = await trackedKwApi.add(workspaceId, kw);
                  if (['declined', 'requested'].includes(keywordFeedback.get(normalized) || '')) {
                    await kwFeedbackApi.remove(workspaceId, normalized);
                    setKeywordFeedback(prev => { const next = new Map(prev); next.delete(normalized); return next; });
                  }
                  setTrackedKeywords(res.keywords || []);
                  setNewTrackedKeyword('');
                  setToast?.(`"${kw}" added as a priority keyword`);
                } catch {
                  setToast?.('Failed to add keyword');
                } finally {
                  setAddingKeyword(false);
                }
              }}
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input
                id="priority-keyword-input"
                type="text"
                value={newTrackedKeyword}
                onChange={e => setNewTrackedKeyword(e.target.value)}
                placeholder="Example: webflow agency austin"
                disabled={addingKeyword}
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
                maxLength={120}
              />
              <button
                type="submit"
                disabled={addingKeyword || newTrackedKeyword.trim().length < 2}
                className="px-3 py-2 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Icon as={Plus} size="sm" /> {addingKeyword ? 'Adding...' : 'Add keyword'}
              </button>
            </form>
          </div>
        )}

        <div className="flex flex-col gap-1 mb-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="t-caption-sm font-medium text-[var(--brand-text)]">Current priority keywords</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">Remove anything that should not guide the strategy.</span>
        </div>
        <div className="relative mb-3">
          <Icon as={Search} size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
          <input
            type="search"
            value={priorityKeywordSearch}
            onChange={e => {
              setPriorityKeywordSearch(e.target.value);
              setConfirmRemoveKeyword(null);
            }}
            aria-label="Search priority keywords"
            placeholder="Search priority keywords..."
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] pl-8 pr-9 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
          />
          {priorityKeywordSearch && (
            <button
              type="button"
              onClick={() => {
                setPriorityKeywordSearch('');
                setConfirmRemoveKeyword(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-2)] transition-colors"
              aria-label="Clear priority keyword search"
            >
              <Icon as={X} size="sm" />
            </button>
          )}
        </div>

        {priorityKeywordGroups.length > 0 ? (
          <div className="space-y-3 mb-3">
            {priorityKeywordGroups.map(group => (
              <div key={group.source}>
                <div className="flex flex-col gap-0.5 mb-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="t-caption-sm font-medium text-[var(--brand-text)]">{group.label}</h4>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{group.helper}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(item => {
                    const normalized = normalizeKeyword(item.label);
                    const confirming = confirmRemoveKeyword === normalized;
                    const removing = removingKeyword === normalized;
                    const removeLabel = item.source === 'client'
                      ? `Remove ${item.label} from future rank tracking`
                      : `Remove ${item.label} from priority keywords`;
                    const chipTone = item.source === 'client'
                      ? 'bg-teal-500/10 border-teal-500/20 text-accent-brand'
                      : item.source === 'requested'
                        ? 'bg-blue-500/10 border-blue-500/20 text-accent-info'
                        : 'bg-[var(--surface-3)] border-[var(--brand-border-strong)] text-[var(--brand-text-muted)]';
                    return (
                      <span key={`${item.source}-${normalized}`} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] border t-caption-sm ${chipTone}`}>
                        {item.label}
                        {item.source === 'requested' && <span className="text-[var(--brand-text-muted)]">pending</span>}
                        {confirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => removePriorityKeyword(item)}
                              disabled={removing}
                              className="text-accent-danger hover:text-accent-danger transition-colors disabled:opacity-50"
                            >
                              {removing ? 'Removing...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveKeyword(null)}
                              disabled={removing}
                              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveKeyword(normalized)}
                            className="text-[var(--brand-text-muted)] hover:text-accent-danger transition-colors"
                            title={removeLabel}
                            aria-label={removeLabel}
                          >
                            <Icon as={X} size="sm" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
            No priority keywords match that search.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {hiddenPriorityKeywordCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllPriorityKeywords(true)}
              className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-2 py-1 transition-colors"
            >
              View all priority keywords ({filteredPriorityKeywords.length})
            </button>
          )}
          {!hasPriorityKeywordSearch && showAllPriorityKeywords && filteredPriorityKeywords.length > 18 && (
            <button
              type="button"
              onClick={() => setShowAllPriorityKeywords(false)}
              className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-2 py-1 transition-colors"
            >
              Show fewer
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Header + Strategy Snapshot */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="t-h2 text-[var(--brand-text)]">SEO Strategy</h2>
          <p className="t-body text-[var(--brand-text-muted)] mt-1">
            A focused view of what to create, what to improve, and where your priority keywords fit.
          </p>
        </div>
      </div>

      {/* Unvalidated strategy note */}
      {!strategyData.pageMap.some(p => p.volume && p.volume > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-2.5" style={{ borderRadius: 'var(--radius-signature)' }}>
          <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
          <div className="t-caption text-accent-warning leading-relaxed">
            Keyword volume and difficulty metrics are currently unavailable for this strategy. The recommendations are based on AI analysis and site content.
          </div>
        </div>
      )}

      {/* Strategy Snapshot */}
      {/* pr-check-disable-next-line -- Brand signature radius intentional */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className={`t-stat-lg ${healthScore >= 80 ? 'text-accent-success' : healthScore >= 60 ? 'text-accent-warning' : 'text-accent-brand'}`}>
              {healthScore}<span className="t-caption-sm text-[var(--brand-text-muted)]">/100</span>
            </div>
            <div>
              <div className="t-caption-sm font-medium uppercase tracking-wider text-[var(--brand-text-muted)]">Strategy Snapshot</div>
              <div className="t-body font-medium text-[var(--brand-text)]">
                {healthScore >= 80 ? 'Strong action plan' : healthScore >= 60 ? 'Good opportunity mix' : 'Building your strategy'}
              </div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                Generated {new Date(strategyData.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[560px]">
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Create content</div>
              <div className="t-body font-semibold text-[var(--brand-text-bright)]">{contentGapsFound}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Improve pages</div>
              <div className="t-body font-semibold text-[var(--brand-text-bright)]">{totalPageImprovements}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Ranking coverage</div>
              <div className="t-body font-semibold text-[var(--brand-text-bright)]">{pagesRanking}/{totalPages}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Priority keywords</div>
              <div className="t-body font-semibold text-[var(--brand-text-bright)]">{priorityKeywords.length}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 mt-4 pt-4 border-t border-[var(--brand-border)]/50 md:grid-cols-3">
          <div>
            <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
              <span>Content readiness</span>
              <span>{contentScore}/40</span>
            </div>
            <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
              <div className="h-full bg-teal-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(contentScore / 40) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
              <span>Page improvements</span>
              <span>{quickWinScore}/30</span>
            </div>
            <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
              <div className="h-full bg-amber-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(quickWinScore / 30) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
              <span>Ranking coverage</span>
              <span>{coverageScore}/30</span>
            </div>
            <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
              <div className="h-full bg-emerald-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(coverageScore / 30) * 100}%` }} />
            </div>
          </div>
        </div>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3">
          This is a planning-readiness score, not a grade. It shows how much clear SEO work is ready to review or move into production.
        </p>
      </div>

      <div ref={priorityKeywordsRef}>
        <TierGate tier={effectiveTier} required="growth" feature="Priority Keywords" teaser={`${priorityKeywords.length} keywords`}>
          {priorityKeywordsPanel}
        </TierGate>
      </div>

      {/* ── RECOMMENDED NEXT STEPS ── */}
      <div className="space-y-3">
        <div>
          <h3 className="t-h3 text-[var(--brand-text)]">Recommended Next Steps</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Start here. These are the clearest places to review, request, or give direction.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 flex flex-col gap-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                <Icon as={FileText} size="lg" className="text-accent-brand" />
              </div>
              <div className="min-w-0">
                <div className="t-body font-medium text-[var(--brand-text)]">Review new content ideas</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{contentGapsFound} strongest content recommendations</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => scrollToSection('new-content', newContentRef)} className="self-start">
              Review Ideas
            </Button>
          </div>

        {(quickWinsAvailable > 0 || pagesWithGrowthOpps > 0) && (
          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 flex flex-col gap-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Icon as={Zap} size="lg" className="text-accent-warning" />
              </div>
              <div className="min-w-0">
                <div className="t-body font-medium text-[var(--brand-text)]">Improve existing pages</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{totalPageImprovements} page improvements to work through</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => scrollToSection('optimize-existing', optimizeExistingRef)} className="self-start">
              Review Pages
            </Button>
          </div>
        )}

          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 flex flex-col gap-3" style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Icon as={Target} size="lg" className="text-accent-info" />
              </div>
              <div className="min-w-0">
                <div className="t-body font-medium text-[var(--brand-text)]">Guide priority keywords</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{priorityKeywords.length} keywords shaping the strategy</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => priorityKeywordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="self-start">
              Manage Keywords
            </Button>
          </div>
        </div>
      </div>

      {/* ── LOAD ERRORS (surfaced at top so errors aren't hidden behind collapsed sections) ── */}
      {(feedbackLoadError || trackedKeywordsError) && (
        <div className="space-y-1">
          {feedbackLoadError && (
            <p className="t-caption-sm text-accent-danger">
              Couldn't load your previous keyword feedback - your relevant and not relevant choices may not reflect correctly.{' '}
              <button onClick={loadFeedback} className="underline hover:text-accent-danger">Retry</button>
            </p>
          )}
          {trackedKeywordsError && (
            <p className="t-caption-sm text-accent-danger">
              Couldn't load your priority keywords.{' '}
              <button onClick={loadTrackedKeywords} className="underline hover:text-accent-danger">Retry</button>
            </p>
          )}
        </div>
      )}

      {/* ── GUIDE THIS STRATEGY (client driver's seat) ── */}
      {workspaceId && prioritiesLoaded && ( // pr-check-disable-next-line -- Brand signature radius intentional
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <button
            onClick={() => toggleSection('business-priorities')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center">
                <Icon as={Briefcase} size="md" className="text-accent-brand" />
              </div>
              <div className="text-left">
                <div className="t-body font-medium text-[var(--brand-text)]">Guide This Strategy</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">
                  {priorities.length > 0
                    ? `${priorities.length} priorities and ${requestedKeywords.length} keyword ideas saved`
                    : 'Tell us what matters most'}
                </div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('business-priorities') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('business-priorities') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
                Share goals and priority keyword ideas in one place. These inputs shape future strategy recommendations, but they do not publish anything or regenerate the strategy immediately.
              </p>

              {/* Existing priorities */}
              {priorities.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {priorities.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50 group">
                      <span className={`t-micro font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] ${
                        p.category === 'growth' ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20' :
                        p.category === 'brand' ? 'bg-teal-500/10 text-accent-brand border border-teal-500/20' :
                        p.category === 'product' ? 'bg-blue-500/10 text-accent-info border border-blue-500/20' :
                        p.category === 'audience' ? 'bg-amber-500/10 text-accent-warning border border-amber-500/20' :
                        p.category === 'competitive' ? 'bg-red-500/10 text-accent-danger border border-red-500/20' :
                        'bg-[var(--surface-3)]/50 text-[var(--brand-text-muted)] border border-[var(--brand-border-strong)]/30'
                      }`}>{p.category}</span>
                      <span className="t-caption-sm text-[var(--brand-text)] flex-1">{p.text}</span>
                      <button
                        onClick={() => {
                          const next = priorities.filter((_, j) => j !== i);
                          savePriorities(next);
                        }}
                        disabled={savingPriorities}
                        className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-accent-danger transition-all disabled:opacity-50"
                      >
                        <Icon as={X} size="md" />
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
                  className="bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-2 py-1.5 t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500"
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
                  className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                />
                <button
                  onClick={() => {
                    if (newPriority.trim()) {
                      savePriorities([...priorities, { text: newPriority.trim(), category: newPriorityCategory }]);
                      setNewPriority('');
                    }
                  }}
                  disabled={!newPriority.trim() || savingPriorities || priorities.length >= 10}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/30 transition-colors flex items-center gap-1 disabled:opacity-40"
                >
                  <Icon as={Plus} size="sm" /> Add
                </button>
              </div>
              {priorities.length >= 10 && (
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">Maximum 10 priorities reached</p>
              )}

              <div className="mt-4 pt-4 border-t border-[var(--brand-border)]/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
                    <Icon as={Target} size="md" className="text-accent-info" />
                  </div>
                  <div>
                    <div className="t-body font-medium text-[var(--brand-text)]">Add a Priority Keyword</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">Ask us to consider a keyword in a future strategy.</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={suggestKeyword}
                    onChange={e => setSuggestKeyword(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitKeywordRequest();
                      }
                    }}
                    placeholder="e.g., webflow agency austin"
                    className="flex-1 px-3 py-2 t-caption bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500/50"
                  />
                  <Button
                    onClick={submitKeywordRequest}
                    disabled={!suggestKeyword.trim() || suggestingKeyword}
                    loading={suggestingKeyword}
                  >
                    {suggestingKeyword ? 'Submitting...' : 'Submit'}
                  </Button>
                </div>
                {requestedKeywords.length > 0 && (
                  <div className="mt-3">
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">Submitted keyword ideas</div>
                    <div className="flex flex-wrap gap-2">
                      {requestedKeywords.slice(0, 8).map(kw => (
                        <span key={kw} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] bg-blue-500/10 border border-blue-500/20 t-caption-sm text-accent-info">
                          {kw}
                        </span>
                      ))}
                      {requestedKeywords.length > 8 && (
                        <span className="t-caption-sm text-[var(--brand-text-muted)] px-2 py-1">+{requestedKeywords.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CREATE CONTENT (Strong recommendations + keyword ideas) ── */}
      <div ref={newContentRef}>
        <TierGate tier={effectiveTier} required="growth" feature="Create Content" teaser={`${newContentTopicCount} content ideas identified - upgrade to unlock recommendations`}>
        {/* pr-check-disable-next-line -- Brand signature radius intentional */}
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <button
            onClick={() => toggleSection('new-content')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center">
                <Icon as={FileText} size="md" className="text-accent-brand" />
              </div>
              <div className="text-left">
                <div className="t-body font-medium text-[var(--brand-text)]">Create Content</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{contentGapsFound} strong ideas · {keywordGapCount} review candidates</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="t-caption font-bold text-accent-brand bg-teal-500/10 px-2 py-0.5 rounded-[var(--radius-pill)] border border-teal-500/20">{newContentTopicCount}</span>
              <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('new-content') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('new-content') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
                Clear new-page recommendations come first. Noisier keyword ideas are separated below so they can be reviewed without feeling like automatic recommendations.
              </p>

              {/* Strong Recommendations sub-section */}
              {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
              <>
              <div className="flex items-center gap-2 mb-2">
                <Icon as={FileText} size="md" className="text-accent-brand" />
                <span className="t-caption font-medium text-[var(--brand-text)]">Strong Recommendations</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.contentGaps.length})</span>
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
                    <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)] hover:border-teal-500/20 transition-colors">
                      {/* Row 1: topic title + intent/page-type badges */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="t-caption font-semibold text-[var(--brand-text)]">{gap.topic}{gap.opportunityScore != null && (
                            <span className="ml-2 inline-flex items-center rounded-[var(--radius-pill)] bg-blue-500/10 px-2 py-0.5 t-caption font-medium text-accent-info">
                              {gap.opportunityScore}/100
                            </span>
                          )}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {gap.intent && (
                            <span className={`t-caption-sm uppercase px-1.5 py-0.5 rounded-[var(--radius-pill)] border font-medium ${intentColor(gap.intent)}`}>{gap.intent}</span>
                          )}
                          {pageType !== 'blog' && (
                            <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 text-accent-brand border border-teal-500/20 font-medium capitalize">{pageType}</span>
                          )}
                        </div>
                      </div>
                      {/* Row 2: priority keyword + metrics */}
                      <div className="flex items-center gap-3 flex-wrap mb-1.5">
                        <span className="t-caption-sm text-accent-brand">&ldquo;{gap.targetKeyword}&rdquo;</span>
                        {gap.volume != null && gap.volume > 0 && (
                          <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-0.5"><Icon as={BarChart3} size="sm" />{fmtNum(gap.volume)}/mo</span>
                        )}
                        {gap.difficulty != null && gap.difficulty > 0 && (
                          <>
                            <span className={`t-caption-sm font-medium ${kdColor(gap.difficulty)} cursor-help`} title={kdTooltip(gap.difficulty)}>Difficulty {gap.difficulty}</span>
                            {kdFraming(gap.difficulty) && (
                              <span className="t-caption-sm text-[var(--brand-text-muted)]">{kdFraming(gap.difficulty)}</span>
                            )}
                          </>
                        )}
                        {gap.impressions != null && gap.impressions > 0 && (
                          <span className="t-caption-sm text-accent-info flex items-center gap-0.5"><Icon as={Eye} size="sm" />{fmtNum(gap.impressions)} impressions</span>
                        )}
                        {isDataValidated && (
                          <span className="t-caption-sm text-accent-success">Data-backed</span>
                        )}
                      </div>
                      {/* Trend, search result features, and competitor badges */}
                      {hasTrendOrSerp && (
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          {gap.trendDirection === 'rising' && (
                            <span className="flex items-center gap-0.5 t-caption-sm text-accent-success font-medium"><Icon as={TrendingUp} size="sm" />Rising</span>
                          )}
                          {gap.trendDirection === 'declining' && (
                            <span className="flex items-center gap-0.5 t-caption-sm text-accent-danger font-medium"><Icon as={TrendingDown} size="sm" />Declining</span>
                          )}
                          {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
                            <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] font-medium"><Icon as={Minus} size="sm" />Stable</span>
                          )}
                          {Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0 && gap.serpFeatures.map(feat => {
                            const labels: Record<string, string> = {
                              featured_snippet: 'Featured snippet',
                              people_also_ask: 'People also ask',
                              video: 'Video results',
                              local_pack: 'Local results',
                            };
                            return (
                              <span key={feat} className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
                                {labels[feat] ?? feat}
                              </span>
                            );
                          })}
                          {gap.competitorProof && (
                            <span className="t-caption-sm text-accent-orange font-medium">{gap.competitorProof}</span>
                          )}
                        </div>
                      )}
                      {/* Rationale */}
                      <div className="t-caption-sm text-[var(--brand-text-muted)] leading-snug mb-2">{gap.rationale}</div>
                      {/* Footer: keyword feedback + action buttons */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Keyword feedback */}
                        {workspaceId && (() => {
                          const fbStatus = getFeedbackStatus(gap.targetKeyword);
                          const loading = isLoadingFeedback(gap.targetKeyword);
                          if (fbStatus === 'declined') return (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20">
                              <Icon as={Ban} size="sm" className="text-accent-danger flex-shrink-0" />
                              <span className="t-caption-sm text-accent-danger">Not relevant</span>
                              <button onClick={() => undoFeedback(gap.targetKeyword)} disabled={loading} className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex items-center gap-0.5 transition-colors disabled:opacity-50">
                                <Icon as={Undo2} size="sm" /> Undo
                              </button>
                            </div>
                          );
                          if (fbStatus === 'approved') return (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] bg-emerald-500/5 border border-emerald-500/20">
                              <Icon as={ThumbsUp} size="sm" className="text-accent-success" />
                              <span className="t-caption-sm text-accent-success">Relevant</span>
                            </div>
                          );
                          return (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => submitFeedback(gap.targetKeyword, 'approved', 'content_gap')}
                                disabled={loading}
                                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-success bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                              >
                                <Icon as={ThumbsUp} size="sm" /> Relevant
                              </button>
                              <button
                                onClick={() => { setDeclineReason({ keyword: gap.targetKeyword, source: 'content_gap' }); setDeclineReasonText(''); }}
                                disabled={loading}
                                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-danger bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                <Icon as={ThumbsDown} size="sm" /> Not relevant
                              </button>
                            </div>
                          );
                        })()}
                        {/* Action buttons */}
                        {!betaMode && (alreadyRequested ? (
                          (() => {
                            const s = matchingReq?.status;
                            if (s === 'published') return (
                              <span className="flex items-center gap-1 t-caption-sm text-accent-success bg-emerald-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-emerald-500/20 flex-shrink-0">
                                <Icon as={CheckCircle2} size="md" /> Published
                              </span>
                            );
                            if (s === 'delivered') return (
                              <span className="flex items-center gap-1 t-caption-sm text-accent-brand bg-teal-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-teal-500/20 flex-shrink-0">
                                <Icon as={CheckCircle2} size="md" /> In Production
                              </span>
                            );
                            if (s === 'approved' || s === 'in_progress') return (
                              <span className="flex items-center gap-1 t-caption-sm text-accent-brand bg-teal-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-teal-500/20 flex-shrink-0">
                                <Icon as={Sparkles} size="md" /> In Production
                              </span>
                            );
                            if (s === 'brief_generated' || s === 'client_review') return (
                              <span className="flex items-center gap-1 t-caption-sm text-accent-warning bg-amber-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-amber-500/20 flex-shrink-0">
                                <Icon as={FileText} size="md" /> Brief Requested
                              </span>
                            );
                            return (
                              <span className="flex items-center gap-1 t-caption-sm text-accent-warning bg-amber-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-amber-500/20 flex-shrink-0">
                                <Icon as={CheckCircle2} size="md" /> Brief Ordered
                              </span>
                            );
                          })()
                        ) : planStatus ? (
                          <button
                            onClick={() => onTabChange?.('content-plan')}
                            className="flex items-center gap-1 t-caption-sm text-accent-brand bg-teal-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-teal-500/20 flex-shrink-0 hover:bg-teal-500/20 transition-colors"
                            title="View in Content Plan"
                          >
                            <Icon as={Layers} size="md" />
                            {planStatus === 'published' ? 'Published' : planStatus === 'approved' ? 'Approved' : planStatus === 'in_progress' || planStatus === 'brief_generated' ? 'In Progress' : 'Planned'}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => setPricingModal({ serviceType: 'brief_only', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/40 transition-all"
                            >
                              <Icon as={FileText} size="sm" /> Get Brief
                              {!hidePrices && briefPrice != null && <span className="opacity-70 ml-0.5">{fmtPrice(briefPrice)}</span>}
                            </button>
                            {(hidePrices || fullPostPrice != null) && (
                              <Button
                                variant="primary"
                                size="sm"
                                icon={Sparkles}
                                onClick={() => setPricingModal({ serviceType: 'full_post', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
                              >
                                Full Post
                                {!hidePrices && fullPostPrice != null && <span className="opacity-70 ml-0.5">{fmtPrice(fullPostPrice)}</span>}
                              </Button>
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
                  className="w-full mt-3 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors border border-dashed border-[var(--brand-border)] rounded-[var(--radius-lg)] hover:border-[var(--brand-border-strong)]"
                >
                  {expandedSections.has('new-content-gaps-all') ? 'Show fewer' : `View all ${strategyData.contentGaps.length} opportunities`}
                </button>
              )}
              </>
              )}

              {/* Review Keyword Ideas sub-section */}
              {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={Target} size="md" className="text-accent-orange" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Review Keyword Ideas</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.keywordGaps.length})</span>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
                    Search terms seen in competitor or market data. These are review candidates, not automatic recommendations.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {strategyData.keywordGaps.slice(0, expandedSections.has('competitor-gaps-all') ? undefined : 6).map((gap, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50">
                        <span className="t-caption-sm text-[var(--brand-text)] font-medium truncate mr-2">{gap.keyword}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gap.volume != null && gap.volume > 0 && <span className="t-caption-sm text-[var(--brand-text-muted)]">{gap.volume.toLocaleString()}</span>}
                          {gap.difficulty != null && gap.difficulty > 0 && (
                            <span className={`t-caption-sm font-medium ${kdColor(gap.difficulty)}`}>
                              Difficulty {gap.difficulty}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {strategyData.keywordGaps.length > 6 && (
                    <button
                      onClick={() => toggleSection('competitor-gaps-all')}
                      className="w-full mt-2 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                    >
                      {expandedSections.has('competitor-gaps-all') ? 'Show fewer' : `View all ${strategyData.keywordGaps.length}`}
                    </button>
                  )}
                </div>
              )}

              {/* Additional Page Ideas sub-section */}
              {strategyData.opportunities.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={Sparkles} size="md" className="text-accent-brand" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Additional Page Ideas</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.opportunities.length})</span>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Additional keywords your existing pages could target.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {strategyData.opportunities.slice(0, 10).map((opp, i) => (
                      <span key={i} className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50 px-2 py-1 rounded-[var(--radius-sm)]">{opp}</span>
                    ))}
                    {strategyData.opportunities.length > 10 && (
                      <span className="t-caption-sm text-[var(--brand-text-muted)] px-1 py-1">+{strategyData.opportunities.length - 10} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </TierGate>
      </div>

      {/* ── IMPROVE PAGES (Quick Wins + Growth Opportunities merged) ── */}
      {(quickWinsAvailable > 0 || pagesWithGrowthOpps > 0) && (
      <div ref={optimizeExistingRef}>
        {/* pr-check-disable-next-line -- Brand signature radius intentional */}
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <button
            onClick={() => toggleSection('optimize-existing')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center">
                <Icon as={Zap} size="md" className="text-accent-warning" />
              </div>
              <div className="text-left">
                <div className="t-body font-medium text-[var(--brand-text)]">Improve Pages</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{quickWinsAvailable + pagesWithGrowthOpps} improvements across your site</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="t-caption font-bold text-accent-warning bg-amber-500/10 px-2 py-0.5 rounded-[var(--radius-pill)] border border-amber-500/20">{quickWinsAvailable + pagesWithGrowthOpps}</span>
              <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('optimize-existing') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('optimize-existing') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
                These are improvements to pages you already have, sorted by estimated impact. Quick wins are lower-effort fixes; growth opportunities are pages with untapped potential.
              </p>

              {/* Quick Wins sub-section */}
              {strategyData.quickWins && strategyData.quickWins.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={Zap} size="md" className="text-accent-warning" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Quick Wins</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.quickWins.length})</span>
                  </div>
                  <div className="space-y-2">
                    {strategyData.quickWins.slice(0, expandedSections.has('quick-wins-all') ? undefined : 3).map((qw, i) => {
                      const impactColor = qw.estimatedImpact === 'high' ? 'text-accent-success bg-emerald-500/15 border-emerald-500/30' : qw.estimatedImpact === 'medium' ? 'text-accent-warning bg-amber-500/15 border-amber-500/30' : 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 border-[var(--brand-border-strong)]/20';
                      return (
                        <div key={i} className="px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/80">
                          <div className="flex items-center justify-between">
                            <span className="t-caption-sm font-mono text-[var(--brand-text-muted)]">{qw.pagePath}</span>
                            <span className={`t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${impactColor}`}>{qw.estimatedImpact}</span>
                          </div>
                          <div className="t-caption-sm text-[var(--brand-text)] mt-1 font-medium">{qw.action}</div>
                        </div>
                      );
                    })}
                    {strategyData.quickWins.length > 3 && (
                      <button
                        onClick={() => toggleSection('quick-wins-all')}
                        className="w-full text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
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
                      <Icon as={TrendingUp} size="md" className="text-accent-info" />
                      <span className="t-caption font-medium text-[var(--brand-text)]">Pages to Review</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">({unranked.length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {unranked.slice(0, expandedSections.has('growth-opportunities-all') ? undefined : 3).map(page => (
                        <div key={page.pagePath} className="rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/80 p-3 flex flex-col hover:border-blue-500/30 transition-all">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="t-caption-sm font-medium text-[var(--brand-text)] truncate">{page.pageTitle || page.pagePath}</div>
                              <div className="t-caption-sm text-[var(--brand-text-muted)] font-mono truncate">{page.pagePath}</div>
                            </div>
                            {page.hasImpressions && <span className="t-caption-sm text-accent-info bg-blue-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-blue-500/20 flex-shrink-0 ml-2">Almost there</span>}
                          </div>
                          {page.primaryKeyword && (
                            <div className="t-caption-sm text-accent-brand mb-2">Keyword: &ldquo;{page.primaryKeyword}&rdquo;</div>
                          )}
                          <div className="t-caption-sm text-[var(--brand-text-muted)] leading-snug flex-1">{page.reasons[0]}</div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--brand-border)]/50">
                            <div className="flex items-center gap-1.5">
                              {page.searchIntent && <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase">{page.searchIntent}</span>}
                              {page.difficulty != null && page.difficulty > 0 && (
                                <span className={`t-caption-sm ${kdColor(page.difficulty)}`}>
                                  Difficulty {page.difficulty}
                                </span>
                              )}
                            </div>
                            {workspaceId && (
                              <button
                                onClick={async () => {
                                  if (discussingGrowthPage === page.pagePath) return;
                                  const topic = `Discuss optimization for ${page.pageTitle || page.pagePath}`;
                                  const targetKeyword = page.primaryKeyword || page.pageTitle || page.pagePath;
                                  setDiscussingGrowthPage(page.pagePath);
                                  try {
                                    await post(`/api/public/content-request/${workspaceId}`, {
                                      topic,
                                      targetKeyword,
                                      rationale: `Growth opportunity on ${page.pagePath}: ${page.reasons[0]}`,
                                      priority: page.hasImpressions ? 'high' : 'medium'
                                    });
                                    setToast?.('Optimization request created');
                                    onContentRequested?.();
                                  } catch {
                                    setToast?.('Failed to create optimization request');
                                  } finally {
                                    setDiscussingGrowthPage(null);
                                  }
                                }}
                                disabled={discussingGrowthPage === page.pagePath}
                                className="px-2.5 py-1 rounded-[var(--radius-sm)] t-caption-sm font-medium text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] transition-colors flex items-center gap-1 disabled:opacity-50"
                              >
                                <Icon as={MessageCircle} size="sm" />
                                {discussingGrowthPage === page.pagePath ? 'Requesting...' : 'Request Review'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {unranked.length > 3 && (
                      <button
                        onClick={() => toggleSection('growth-opportunities-all')}
                        className="w-full mt-3 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors border border-dashed border-[var(--brand-border)] rounded-[var(--radius-lg)] hover:border-[var(--brand-border-strong)]"
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

      {/* ── PAGE KEYWORD MAP (advanced page detail) ── */}
      <div ref={keywordMapRef}>
      <TierGate tier={effectiveTier} required="growth" feature="Keyword Map" teaser={`${strategyData.pageMap.length} pages tracked`}>
        {/* pr-check-disable-next-line -- Brand signature radius intentional */}
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <button
            onClick={() => toggleSection('page-keyword-map')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
                <Icon as={Layers} size="md" className="text-accent-info" />
              </div>
              <div className="text-left">
                <div className="t-body font-medium text-[var(--brand-text)]">Page Keyword Map</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{strategyData.pageMap.length} pages mapped · advanced page-to-keyword detail</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('page-keyword-map') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('page-keyword-map') && (
            <>
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
        return ( // pr-check-disable-next-line -- Brand signature radius intentional
          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
            <button
              onClick={() => toggleSection('declined-keywords')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-red-500/20 flex items-center justify-center">
                  <Icon as={Ban} size="md" className="text-accent-danger" />
                </div>
                <div className="text-left">
                  <div className="t-body font-medium text-[var(--brand-text)]">Not Relevant Keywords</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{declined.length} keywords excluded from future strategies</div>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('declined-keywords') ? '' : '-rotate-90'}`} />
            </button>

            {expandedSections.has('declined-keywords') && (
              <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3">These keywords won't appear in future strategy recommendations. Click restore to bring them back.</p>
                <div className="flex flex-wrap gap-2">
                  {declined.map(([kw]) => (
                    <div key={kw} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20">
                      <span className="t-caption-sm text-accent-danger">{kw}</span>
                      <button
                        onClick={() => undoFeedback(kw)}
                        disabled={isLoadingFeedback(kw)}
                        className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors flex items-center gap-0.5 disabled:opacity-50"
                      >
                        <Icon as={Undo2} size="sm" /> Restore
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
        <Modal open onClose={() => setDeclineReason(null)} size="sm">
          <Modal.Header title="Decline keyword" onClose={() => setDeclineReason(null)} />
          <Modal.Body>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
              <span className="text-accent-danger font-medium">&ldquo;{declineReason.keyword}&rdquo;</span> will be excluded from future strategy recommendations.
            </p>
            <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Why isn't this keyword relevant? <span className="text-[var(--brand-text-muted)]">(optional)</span></label>
            <textarea
              value={declineReasonText}
              onChange={e => setDeclineReasonText(e.target.value)}
              placeholder="e.g., We don't offer this service, too competitive, not our target audience..."
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-body text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none h-20"
              autoFocus
            />
          </Modal.Body>
          <Modal.Footer>
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                onClick={() => setDeclineReason(null)}
                className="px-3 py-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  submitFeedback(declineReason.keyword, 'declined', declineReason.source, declineReasonText || undefined);
                  setDeclineReason(null);
                  setDeclineReasonText('');
                }}
                className="px-4 py-1.5 rounded-[var(--radius-lg)] bg-red-600/20 border border-red-500/30 t-caption-sm text-accent-danger font-medium hover:bg-red-600/30 transition-colors flex items-center gap-1"
              >
                <Icon as={ThumbsDown} size="sm" /> Decline Keyword
              </button>
            </div>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
