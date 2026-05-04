import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Zap, FileText, Sparkles, Target, CheckCircle2,
  TrendingUp, TrendingDown, Minus, ChevronDown, Layers,
  MessageCircle, BarChart3, Eye, AlertTriangle,
  ThumbsUp, ThumbsDown, Undo2, Ban, Plus, X, Trash2, Briefcase,
} from 'lucide-react';
import { TierGate, EmptyState, Skeleton, type Tier, Icon, Button } from '../ui';
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

const FOCUSABLE_SELECTOR = [
  'a[href]', 'area[href]', 'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');
const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );

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

type PriorityKeywordStatus = 'client' | 'strategy' | 'suggested';
type StrategyKeywordRole = 'strategy' | 'page' | 'content' | 'idea';
type OpportunityTone = 'emerald' | 'amber' | 'blue' | 'zinc';

interface PriorityKeywordItem {
  label: string;
  normalized: string;
  isTracked: boolean;
  isStrategy: boolean;
  isRequested: boolean;
  status: PriorityKeywordStatus;
}

interface StrategyKeywordTableRow extends PriorityKeywordItem {
  role: StrategyKeywordRole;
  roleLabel: 'Strategy Keyword' | 'Page Opportunity' | 'Content Opportunity' | 'Keyword Idea';
  roleDetail: string;
  opportunityLabel: string;
  opportunityDetail: string;
  opportunityTone: OpportunityTone;
  opportunityScore?: number;
  nextMoveLabel: string;
  nextMoveDetail: string;
  volume?: number;
  difficulty?: number;
  currentPosition?: number;
  pagePath?: string;
  pageTitle?: string;
  searchIntent?: string;
  impressions?: number;
  clicks?: number;
  metricsSource?: string;
  contextSources: string[];
  rationale?: string;                                      // AI rationale from contentGaps, if available
  trendDirection?: 'rising' | 'declining' | 'stable';    // from contentGaps, if available
  enrichmentStatus: 'enriched' | 'partial' | 'unenriched';
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

  const requestedKeywords = [...keywordFeedback.entries()].filter(([, s]) => s === 'requested').map(([k]) => k);

  // ── Business Priorities State ──
  const [priorities, setPriorities] = useState<{ text: string; category: string }[]>([]);
  const [prioritiesLoaded, setPrioritiesLoaded] = useState(false);
  const [newPriority, setNewPriority] = useState('');
  const [newPriorityCategory, setNewPriorityCategory] = useState('growth');
  const [savingPriorities, setSavingPriorities] = useState(false);

  // ── Strategy keyword state backed by tracked-keyword APIs ──
  const [trackedKeywords, setTrackedKeywords] = useState<{ query: string; pinned: boolean; addedAt: string }[]>([]);
  const [newTrackedKeyword, setNewTrackedKeyword] = useState('');
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const [trackedKeywordsLoading, setTrackedKeywordsLoading] = useState(false);
  const [trackedKeywordsError, setTrackedKeywordsError] = useState(false);
  const [discussingGrowthPage, setDiscussingGrowthPage] = useState<string | null>(null);
  const [openKeywordDrawer, setOpenKeywordDrawer] = useState<string | null>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [drawerEvidenceOpen, setDrawerEvidenceOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerSnapshotRef = useRef<StrategyKeywordTableRow | null>(null);

  const closeDrawer = useCallback(() => {
    if (closeTimerRef.current || !openKeywordDrawer) return;
    setDrawerClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setOpenKeywordDrawer(null);
      setDrawerClosing(false);
      closeTimerRef.current = null;
    }, 200);
  }, [openKeywordDrawer]);

  const openOrSwapDrawer = useCallback((keyword: string) => {
    setDrawerEvidenceOpen(false);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setDrawerClosing(false);
    }
    setOpenKeywordDrawer(keyword);
  }, []);

  useEffect(() => {
    return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  }, []);

  const removePriorityKeyword = useCallback(async (item: PriorityKeywordItem) => {
    if (!workspaceId) return;
    const kw = item.normalized;
    if (!kw || removingKeyword === kw) return;
    setRemovingKeyword(kw);
    try {
      let removedTracked = false;
      if (item.isTracked) {
        const data = await trackedKwApi.remove(workspaceId, item.label);
        setTrackedKeywords(data.keywords || []);
        removedTracked = true;
      }

      if (item.isStrategy) {
        await kwFeedbackApi.submit(workspaceId, {
          keyword: kw,
          status: 'declined',
          source: 'topic_cluster',
          reason: 'Removed from strategy keywords',
        });
        setKeywordFeedback(prev => {
          const next = new Map(prev);
          next.set(kw, 'declined');
          return next;
        });
        setToast?.(`"${item.label}" removed from strategy keywords - it won't guide future recommendations`);
      } else if (item.isRequested) {
        try {
          await kwFeedbackApi.remove(workspaceId, kw);
        } catch {
          if (!removedTracked) throw new Error('Failed to remove keyword feedback');
        }
        setKeywordFeedback(prev => {
          const next = new Map(prev);
          next.delete(kw);
          return next;
        });
        setToast?.(removedTracked
          ? `"${item.label}" removed from strategy keywords. Historical ranking data is preserved.`
          : `"${item.label}" removed from keyword ideas`);
      } else if (removedTracked) {
        setToast?.(`"${item.label}" removed from strategy keywords. Historical ranking data is preserved.`);
      }
    } catch {
      setToast?.('Failed to remove keyword');
    } finally {
      setRemovingKeyword(null);
    }
  }, [workspaceId, removingKeyword, setToast]);

  // Load business priorities + strategy keyword data on mount
  const loadTrackedKeywords = useCallback(() => {
    if (!workspaceId) return;
    setTrackedKeywordsError(false);
    setTrackedKeywordsLoading(true);
    trackedKwApi.get(workspaceId)
      .then((data) => {
        setTrackedKeywords(data.keywords || []);
      })
      .catch(() => { setTrackedKeywordsError(true); })
      .finally(() => setTrackedKeywordsLoading(false));
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

  // Capture previously focused element when drawer opens (open: null → string).
  // Separate effect with [openKeywordDrawer] only so it doesn't re-run on
  // unrelated state changes and overwrite the captured target.
  useEffect(() => {
    if (!openKeywordDrawer) return;
    drawerPreviousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [openKeywordDrawer]);

  // Escape + Tab trap while drawer is open.
  useEffect(() => {
    if (!openKeywordDrawer) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler); // keydown-ok — drawer dialog intentionally traps Escape + Tab
    return () => document.removeEventListener('keydown', handler);
  }, [openKeywordDrawer, closeDrawer]);

  // Move focus to first focusable in drawer on open (deferred one frame for mount).
  useEffect(() => {
    if (!openKeywordDrawer) return;
    const raf = requestAnimationFrame(() => {
      const root = drawerRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length > 0) focusables[0].focus();
      else root.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [openKeywordDrawer]);

  // Restore focus to the previously focused element when drawer closes.
  useEffect(() => {
    if (openKeywordDrawer) return;
    const prev = drawerPreviousFocusRef.current;
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
  }, [openKeywordDrawer]);

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

  // Refs for keyword drawer focus management
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerPreviousFocusRef = useRef<HTMLElement | null>(null);

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
    if (normalized && keywordFeedback.get(normalized) !== 'declined') {
      priorityKeywordMap.set(normalized, {
        label: kw,
        normalized,
        isTracked: false,
        isStrategy: true,
        isRequested: false,
        status: 'strategy',
      });
    }
  });
  trackedKeywords.forEach(tk => {
    const normalized = normalizeKeyword(tk.query);
    if (normalized && keywordFeedback.get(normalized) !== 'declined') {
      const existing = priorityKeywordMap.get(normalized);
      priorityKeywordMap.set(normalized, {
        label: existing?.label || tk.query,
        normalized,
        isTracked: true,
        isStrategy: existing?.isStrategy || false,
        isRequested: existing?.isRequested || false,
        status: 'client',
      });
    }
  });
  requestedKeywords.forEach(kw => {
    const normalized = normalizeKeyword(kw);
    if (normalized && keywordFeedback.get(normalized) !== 'declined') {
      const existing = priorityKeywordMap.get(normalized);
      const isTracked = existing?.isTracked || false;
      const isStrategy = existing?.isStrategy || false;
      priorityKeywordMap.set(normalized, {
        label: existing?.label || kw,
        normalized,
        isTracked,
        isStrategy,
        isRequested: true,
        status: isTracked ? 'client' : isStrategy ? 'strategy' : 'suggested',
      });
    }
  });
  const priorityKeywords = [...priorityKeywordMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  const strategyKeywords = priorityKeywords.filter(item => item.status === 'client' || item.status === 'strategy');
  const keywordIdeas = priorityKeywords.filter(item => item.status === 'suggested');
  const siteMetricMap = new Map((strategyData.siteKeywordMetrics || []).map(metric => [normalizeKeyword(metric.keyword), metric]));
  const contentGapMap = new Map((strategyData.contentGaps || []).map(gap => [normalizeKeyword(gap.targetKeyword), gap]));
  const keywordGapMap = new Map((strategyData.keywordGaps || []).map(gap => [normalizeKeyword(gap.keyword), gap]));

  const findKeywordPage = (normalized: string) => {
    let secondaryMatch: (typeof strategyData.pageMap)[number] | undefined;
    for (const page of strategyData.pageMap) {
      if (normalizeKeyword(page.primaryKeyword || '') === normalized) return page;
      if (!secondaryMatch && (page.secondaryKeywords || []).some(kw => normalizeKeyword(kw) === normalized)) {
        secondaryMatch = page;
      }
    }
    return secondaryMatch;
  };

  const getKeywordRole = (
    item: PriorityKeywordItem,
    page: ReturnType<typeof findKeywordPage>,
    contentGap: ReturnType<typeof contentGapMap.get>,
  ): Pick<StrategyKeywordTableRow, 'role' | 'roleLabel' | 'roleDetail'> => {
    if (item.status === 'suggested') {
      return {
        role: 'idea',
        roleLabel: 'Keyword Idea',
        roleDetail: 'Available to review. It will not guide future recommendations unless it is added to strategy.',
      };
    }
    if (contentGap) {
      return {
        role: 'content',
        roleLabel: 'Content Opportunity',
        roleDetail: 'This keyword has enough context to support a future content recommendation.',
      };
    }
    if (page) {
      return {
        role: 'page',
        roleLabel: 'Page Opportunity',
        roleDetail: 'This keyword is connected to a page and can guide page-level recommendations.',
      };
    }
    return {
      role: 'strategy',
      roleLabel: 'Strategy Keyword',
      roleDetail: 'This keyword is part of the active strategy input set for future tracking and recommendations.',
    };
  };

  const getOpportunitySignal = (row: {
    status: PriorityKeywordStatus;
    opportunityScore?: number;
    volume?: number;
    difficulty?: number;
    currentPosition?: number;
    pagePath?: string;
    impressions?: number;
  }): Pick<StrategyKeywordTableRow, 'opportunityLabel' | 'opportunityDetail' | 'opportunityTone'> => {
    if (row.status === 'suggested') {
      return {
        opportunityLabel: 'Review idea',
        opportunityDetail: 'This keyword may be useful, but it is not yet part of the active strategy.',
        opportunityTone: 'amber',
      };
    }
    if (row.opportunityScore != null) {
      if (row.opportunityScore >= 70) {
        return {
          opportunityLabel: 'Strong opportunity',
          opportunityDetail: `Opportunity score ${row.opportunityScore}/100 based on available demand, difficulty, and signal data.`,
          opportunityTone: 'emerald',
        };
      }
      if (row.opportunityScore >= 40) {
        return {
          opportunityLabel: 'Needs review',
          opportunityDetail: `Opportunity score ${row.opportunityScore}/100. Useful, but the fit should be reviewed before acting.`,
          opportunityTone: 'amber',
        };
      }
      return {
        opportunityLabel: 'Lower priority',
        opportunityDetail: `Opportunity score ${row.opportunityScore}/100. Keep it visible, but review higher-signal opportunities first.`,
        opportunityTone: 'zinc',
      };
    }
    if (row.currentPosition != null && row.currentPosition > 3 && row.currentPosition <= 20) {
      return {
        opportunityLabel: 'Within reach',
        opportunityDetail: `Currently ranking around position ${Math.round(row.currentPosition)}, so improvement work may move it higher.`,
        opportunityTone: 'emerald',
      };
    }
    if (!row.pagePath) {
      return {
        opportunityLabel: 'Needs page fit',
        opportunityDetail: 'No mapped page is attached yet. Review where this keyword should live before acting.',
        opportunityTone: 'amber',
      };
    }
    if (row.volume != null && row.volume > 0 && row.difficulty != null && row.difficulty <= 45) {
      return {
        opportunityLabel: 'Clear demand',
        opportunityDetail: 'Search demand is available and the difficulty looks reachable.',
        opportunityTone: 'emerald',
      };
    }
    if (row.difficulty != null && row.difficulty >= 70) {
      return {
        opportunityLabel: 'Competitive',
        opportunityDetail: 'Difficulty is high, so this may require more authority, content depth, or time.',
        opportunityTone: 'amber',
      };
    }
    if (row.impressions != null && row.impressions > 0) {
      return {
        opportunityLabel: 'Has search signal',
        opportunityDetail: 'Search Console is already showing impressions for this keyword or mapped page.',
        opportunityTone: 'blue',
      };
    }
    return {
      opportunityLabel: 'Needs data',
      opportunityDetail: 'Volume, difficulty, and rank data are not available yet.',
      opportunityTone: 'zinc',
    };
  };

  const getNextMove = (row: {
    status: PriorityKeywordStatus;
    role: StrategyKeywordRole;
    pagePath?: string;
    currentPosition?: number;
  }): Pick<StrategyKeywordTableRow, 'nextMoveLabel' | 'nextMoveDetail'> => {
    if (row.status === 'suggested') {
      return {
        nextMoveLabel: 'Add to strategy',
        nextMoveDetail: 'Add this idea when it should guide future tracking, page recommendations, and content ideas.',
      };
    }
    if (row.role === 'content') {
      return {
        nextMoveLabel: 'Consider content',
        nextMoveDetail: 'Use this as an input when reviewing future content briefs or full-post recommendations.',
      };
    }
    if (!row.pagePath) {
      return {
        nextMoveLabel: 'Map a page',
        nextMoveDetail: 'Choose or create the page this keyword should support before making page-level changes.',
      };
    }
    if (row.currentPosition != null && row.currentPosition > 3 && row.currentPosition <= 20) {
      return {
        nextMoveLabel: 'Improve page',
        nextMoveDetail: 'Review the mapped page for optimization work that could improve current rankings.',
      };
    }
    return {
      nextMoveLabel: 'Keep watching',
      nextMoveDetail: 'Keep this keyword in the strategy set and use it as future recommendations are refreshed.',
    };
  };

  const buildKeywordRow = (item: PriorityKeywordItem): StrategyKeywordTableRow => {
    const page = findKeywordPage(item.normalized);
    const siteMetric = siteMetricMap.get(item.normalized);
    const contentGap = contentGapMap.get(item.normalized);
    const keywordGap = keywordGapMap.get(item.normalized);
    const volume = page?.volume ?? siteMetric?.volume ?? contentGap?.volume ?? keywordGap?.volume;
    const difficulty = page?.difficulty ?? siteMetric?.difficulty ?? contentGap?.difficulty ?? keywordGap?.difficulty;
    const currentPosition = page?.currentPosition;
    const pagePath = page?.pagePath;
    const impressions = page?.impressions ?? contentGap?.impressions;
    const metricsSource = page?.metricsSource
      || (siteMetric ? 'strategy metrics' : undefined)
      || (contentGap ? 'content recommendation' : undefined)
      || (keywordGap ? 'competitor gap' : undefined);
    const contextSources = [
      item.isStrategy ? 'Generated strategy' : null,
      item.isTracked ? 'Rank tracking' : null,
      item.isRequested ? 'Client request' : null,
      page ? 'Page map' : null,
      contentGap ? 'Content recommendation' : null,
      keywordGap ? 'Competitor gap' : null,
    ].filter(Boolean) as string[];
    const role = getKeywordRole(item, page, contentGap);
    const opportunityScore = contentGap?.opportunityScore;
    const opportunity = getOpportunitySignal({
      status: item.status,
      opportunityScore,
      volume,
      difficulty,
      currentPosition,
      pagePath,
      impressions,
    });
    const nextMove = getNextMove({
      status: item.status,
      role: role.role,
      pagePath,
      currentPosition,
    });

    const enrichmentStatus: 'enriched' | 'partial' | 'unenriched' = (() => {
      if (volume != null && difficulty != null) return 'enriched';
      if (volume != null || difficulty != null || impressions != null || currentPosition != null) return 'partial';
      return 'unenriched';
    })();

    return {
      ...item,
      ...role,
      ...opportunity,
      ...nextMove,
      opportunityScore,
      volume,
      difficulty,
      currentPosition,
      pagePath,
      pageTitle: page?.pageTitle,
      searchIntent: page?.searchIntent ?? contentGap?.intent,
      impressions,
      clicks: page?.clicks,
      metricsSource,
      contextSources,
      rationale: contentGap?.rationale,
      trendDirection: contentGap?.trendDirection,
      enrichmentStatus,
    };
  };

  const strategyKeywordRows = strategyKeywords.map(buildKeywordRow);
  const keywordIdeaRows = keywordIdeas.map(buildKeywordRow);

  const addStrategyKeyword = async (keyword: string, options?: { clearInput?: boolean }) => {
    if (!workspaceId) return;
    const kw = keyword.trim();
    if (!kw || kw.length < 2 || addingKeyword) return;
    const normalized = normalizeKeyword(kw);
    const existingPriorityKeyword = priorityKeywordMap.get(normalized);
    if (existingPriorityKeyword?.isTracked) {
      setToast?.(`"${kw}" is already a strategy keyword`);
      if (options?.clearInput) setNewTrackedKeyword('');
      return;
    }
    setAddingKeyword(true);
    try {
      const res = await trackedKwApi.add(workspaceId, kw);
      if (['declined', 'requested'].includes(keywordFeedback.get(normalized) || '')) {
        try {
          await kwFeedbackApi.remove(workspaceId, normalized);
        } catch {
          // The keyword was added successfully; keep this view aligned with that action.
        }
        setKeywordFeedback(prev => { const next = new Map(prev); next.delete(normalized); return next; });
      }
      setTrackedKeywords(res.keywords || []);
      if (options?.clearInput) setNewTrackedKeyword('');
      setToast?.('Added to Strategy Keywords. This will guide future recommendations, but it will not rewrite the current strategy instantly.');
    } catch {
      setToast?.('Failed to add keyword');
    } finally {
      setAddingKeyword(false);
    }
  };

  const roleSubLabel = (row: StrategyKeywordTableRow): string => {
    const labelMap: Record<StrategyKeywordRole, string> = {
      content: 'content opportunity',
      page: 'page opportunity',
      strategy: 'strategy keyword',
      idea: 'keyword idea',
    };
    const label = labelMap[row.role];
    const hasMetrics = (row.volume != null && row.volume > 0) || (row.difficulty != null && row.difficulty > 0);
    if (!hasMetrics) return `${label} · no data yet`;
    const parts: string[] = [label];
    if (row.volume != null && row.volume > 0) {
      parts.push(row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`);
    }
    if (row.difficulty != null && row.difficulty > 0) parts.push(`KD ${row.difficulty}`);
    return parts.join(' · ');
  };

  const roleBadgeClass = (role: StrategyKeywordRole): string => {
    switch (role) {
      case 'content':  return 'border-emerald-500/20 bg-emerald-500/10 text-accent-success';
      case 'page':     return 'border-blue-500/20 bg-blue-500/10 text-accent-info';
      case 'strategy': return 'border-teal-500/20 bg-teal-500/10 text-accent-brand';
      case 'idea':     return 'border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]';
    }
  };

  const fmtAudience = (volume?: number): string => {
    if (volume == null) return 'Gathering…';
    if (volume === 0) return 'Very niche or emerging term';
    if (volume < 100) return 'Small, focused audience';
    return `~${fmtNum(volume)} searches/month`;
  };

  const fmtCompetition = (difficulty?: number): string => {
    if (difficulty == null) return 'Gathering…';
    if (difficulty < 30) return 'Approachable — good entry point';
    if (difficulty < 50) return 'Moderate competition';
    if (difficulty < 75) return 'Competitive';
    return 'Highly competitive';
  };

  const fmtMomentum = (direction?: 'rising' | 'declining' | 'stable'): string => {
    if (!direction) return 'Gathering…';
    if (direction === 'rising') return 'Interest growing';
    if (direction === 'stable') return 'Steady demand';
    return 'Declining — worth reviewing timing';
  };

  const confidenceStatement = (row: StrategyKeywordTableRow): string => {
    if (row.enrichmentStatus === 'unenriched') return 'Gathering data';
    if (row.enrichmentStatus === 'partial') return 'Partial signal';
    if ((row.opportunityScore ?? 0) >= 60) return 'Strong opportunity';
    if ((row.opportunityScore ?? 0) >= 30) return 'Moderate opportunity';
    return 'In your strategy';
  };

  const confidenceColor = (row: StrategyKeywordTableRow): string => {
    if (row.enrichmentStatus === 'unenriched') return 'text-[var(--brand-text-muted)]';
    if (row.enrichmentStatus === 'partial') return 'text-amber-400';
    if ((row.opportunityScore ?? 0) >= 60) return 'text-emerald-400';
    if ((row.opportunityScore ?? 0) >= 30) return 'text-teal-400';
    return 'text-[var(--brand-text-muted)]';
  };

  const signalLabel: Record<string, string> = {
    'Generated strategy': 'Identified in your strategy',
    'Rank tracking': 'You\'re actively tracking this',
    'Client request': 'You added this keyword',
    'Page map': 'Linked to a page on your site',
    'Content recommendation': 'AI-recommended content topic',
    'Competitor gap': 'Competitors rank here — you don\'t yet',
  };

  const sortedConfirmed = [...strategyKeywordRows].sort(
    (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
  );

  const priorityKeywordsPanel = (
    // pr-check-disable-next-line -- Brand signature radius intentional for top-level strategy surface
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--brand-border)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center flex-shrink-0">
            <Icon as={Target} size="md" className="text-accent-brand" />
          </div>
          <div className="min-w-0">
            <h3 className="t-h3 text-[var(--brand-text)]">Strategy Keywords</h3>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              {strategyKeywords.length} keyword{strategyKeywords.length === 1 ? '' : 's'} guiding tracking and recommendations
            </p>
          </div>
        </div>
      </div>

      {/* Add keyword form */}
      {workspaceId && (
        <div className="px-4 py-3 border-b border-[var(--brand-border)]">
          <form
            onSubmit={async e => {
              e.preventDefault();
              await addStrategyKeyword(newTrackedKeyword, { clearInput: true });
            }}
            className="flex gap-2"
          >
            <label htmlFor="strategy-keyword-input" className="sr-only">Add a strategy keyword</label>
            <input
              id="strategy-keyword-input"
              type="text"
              value={newTrackedKeyword}
              onChange={e => setNewTrackedKeyword(e.target.value)}
              placeholder="Search or add a keyword..."
              disabled={addingKeyword}
              className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
              maxLength={120}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={addingKeyword}
              disabled={addingKeyword || newTrackedKeyword.trim().length < 2}
            >
              Add
            </Button>
          </form>
        </div>
      )}

      <div className="relative px-4 py-3 flex flex-col gap-4">

        {/* Confirmed zone */}
        <div>
          <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-2">
            In strategy · {sortedConfirmed.length}
          </div>
          {trackedKeywordsLoading && sortedConfirmed.length === 0 ? (
            <div className="flex flex-col gap-1">
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
              <Skeleton className="h-[52px] rounded-[var(--radius-lg)]" />
            </div>
          ) : sortedConfirmed.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No keywords in strategy yet"
              description="Add your first keyword above to start tracking and shaping recommendations."
            />
          ) : (
            <div className="flex flex-col gap-1">
              {sortedConfirmed.map(row => {
                const isOpen = openKeywordDrawer === row.normalized;
                const isRemoving = removingKeyword === row.normalized;
                return (
                  <div
                    key={row.normalized}
                    role="button"
                    tabIndex={0}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] cursor-pointer transition-colors ${
                      isOpen
                        ? 'bg-[var(--surface-3)] border border-teal-500/40 ring-1 ring-teal-500/10'
                        : 'bg-[var(--surface-3)] border border-transparent hover:border-[var(--brand-border)]'
                    }`}
                    onClick={() => { if (isOpen) closeDrawer(); else openOrSwapDrawer(row.normalized); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isOpen) closeDrawer(); else openOrSwapDrawer(row.normalized);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                      <div className="t-caption text-[var(--brand-text-muted)] truncate">{roleSubLabel(row)}</div>
                    </div>
                    {isOpen ? (
                      <span className="text-teal-400 t-caption flex-shrink-0 select-none">→</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${row.label} from strategy`}
                        title="Remove from strategy"
                        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40"
                        disabled={isRemoving}
                        onClick={e => {
                          e.stopPropagation();
                          void removePriorityKeyword(row);
                        }}
                      >
                        <Icon as={Trash2} size="xs" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Suggestions zone */}
        <div>
          <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-2">
            Suggestions · {keywordIdeaRows.length}
          </div>
          {keywordIdeaRows.length === 0 ? (
            <p className="t-caption text-[var(--brand-text-muted)]">
              No suggestions right now — check back after your next data sync.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {keywordIdeaRows.map(row => (
                <div
                  key={row.normalized}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/20 cursor-pointer hover:border-blue-500/30 transition-colors"
                  onClick={() => { if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized);
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                    {((row.volume != null && row.volume > 0) || (row.difficulty != null && row.difficulty > 0)) && (
                      <div className="t-caption text-[var(--brand-text-muted)] truncate">
                        {[
                          (row.volume != null && row.volume > 0) && (row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`),
                          (row.difficulty != null && row.difficulty > 0) && `KD ${row.difficulty}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      aria-label={`Add ${row.label} to strategy`}
                      className="t-caption text-teal-400 hover:text-teal-300 transition-colors whitespace-nowrap disabled:opacity-40"
                      disabled={addingKeyword}
                      onClick={e => {
                        e.stopPropagation();
                        void addStrategyKeyword(row.label);
                      }}
                    >
                      Add to strategy
                    </button>
                    <button
                      type="button"
                      aria-label={`Dismiss ${row.label}`}
                      className="w-6 h-6 flex items-center justify-center text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors disabled:opacity-40"
                      disabled={isLoadingFeedback(row.label)}
                      onClick={e => {
                        e.stopPropagation();
                        void submitFeedback(row.label, 'declined', 'suggestion');
                      }}
                    >
                      <Icon as={X} size="xs" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
            A focused view of what to create, what to improve, and which keywords guide the strategy.
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
              {/* score-color-deviation-ok: planning readiness, not a health grade - teal avoids false alarm */}
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
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Strategy keywords</div>
              <div className="t-body font-semibold text-[var(--brand-text-bright)]">{strategyKeywords.length}</div>
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
        <TierGate tier={effectiveTier} required="growth" feature="Strategy Keywords" teaser={`${strategyKeywords.length} keywords`}>
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
                <div className="t-body font-medium text-[var(--brand-text)]">Guide strategy keywords</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{strategyKeywords.length} keywords shaping the strategy</div>
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
              <button type="button" onClick={loadFeedback} className="underline hover:text-accent-danger">Retry</button>
            </p>
          )}
          {trackedKeywordsError && (
            <p className="t-caption-sm text-accent-danger">
              Couldn't load your strategy keywords.{' '}
              <button type="button" onClick={loadTrackedKeywords} className="underline hover:text-accent-danger">Retry</button>
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
                    ? `${priorities.length} business ${priorities.length === 1 ? 'priority' : 'priorities'} saved`
                    : 'Tell us what matters most'}
                </div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('business-priorities') ? '' : '-rotate-90'}`} />
          </button>

          {expandedSections.has('business-priorities') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
                Share business goals and priorities that should shape future strategy recommendations. Keywords are managed in the Strategy Keywords section.
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
                      {/* Row 2: strategy keyword + metrics */}
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
      <div>
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

      {/* Keyword detail drawer */}
      {(openKeywordDrawer || drawerClosing) && (() => {
        const allRows: StrategyKeywordTableRow[] = [...sortedConfirmed, ...keywordIdeaRows];
        const liveRow = allRows.find(r => r.normalized === openKeywordDrawer);
        if (liveRow) drawerSnapshotRef.current = liveRow;
        const drawerRow = liveRow ?? drawerSnapshotRef.current;
        if (!drawerRow) return null;
        const isConfirmed = drawerRow.status === 'client' || drawerRow.status === 'strategy';
        const isRemoving = removingKeyword === drawerRow.normalized;
        const unenriched = drawerRow.enrichmentStatus === 'unenriched';
        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[var(--z-modal-backdrop)]" // fixed-inset-ok — keyword detail drawer backdrop
              onClick={closeDrawer}
              aria-hidden="true"
            />

            {/* Drawer panel */}
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Keyword details: ${drawerRow.label}`}
              tabIndex={-1}
              className={`fixed inset-x-0 bottom-0 h-[70vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-sm bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal)] flex flex-col overflow-hidden duration-200 rounded-t-[var(--radius-signature-lg)] sm:rounded-none outline-none ${drawerClosing ? 'animate-out slide-out-to-right fill-mode-forwards' : 'animate-in slide-in-from-right'}`} // pr-check-disable-next-line -- Brand signature radius intentional for bottom-sheet drawer top corners on mobile
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-[var(--brand-border)] flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug break-words mb-1.5">
                    {drawerRow.label}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] border t-caption-sm font-medium ${roleBadgeClass(drawerRow.role)}`}>
                      {({ content: 'Content to write', page: 'Page to optimize', strategy: 'Strategy keyword', idea: 'Keyword idea' } as Record<string, string>)[drawerRow.role] ?? drawerRow.roleLabel}
                    </span>
                    <span className={`t-caption-sm font-medium ${confidenceColor(drawerRow)}`}>
                      {confidenceStatement(drawerRow)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close keyword detail"
                  className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
                  onClick={closeDrawer}
                >
                  <Icon as={X} size="sm" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-5 px-4 py-4">

                {/* Opportunity section — plain English */}
                {unenriched ? (
                  <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] px-3 py-3 flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-text-muted)] mt-1.5 animate-pulse flex-shrink-0" />
                    <p className="t-caption text-[var(--brand-text-muted)] leading-relaxed">
                      We're collecting search data for this keyword. Volume and competition metrics will appear within 24 hours.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">Opportunity</div>
                    <div className="grid grid-cols-1 gap-1">
                      <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                        <span className="t-caption text-[var(--brand-text-muted)]">Audience</span>
                        <span className="t-caption font-medium text-[var(--brand-text)]">{fmtAudience(drawerRow.volume)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-[var(--brand-border)]/40">
                        <span className="t-caption text-[var(--brand-text-muted)]">Competition</span>
                        <span className="t-caption font-medium text-[var(--brand-text)]">{fmtCompetition(drawerRow.difficulty)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="t-caption text-[var(--brand-text-muted)]">Momentum</span>
                        <span className={`t-caption font-medium ${
                          drawerRow.trendDirection === 'rising' ? 'text-emerald-400' :
                          drawerRow.trendDirection === 'declining' ? 'text-red-400' :
                          'text-[var(--brand-text)]'
                        }`}>{fmtMomentum(drawerRow.trendDirection)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Your position — only if rank or GSC data present */}
                {(drawerRow.currentPosition != null || (drawerRow.impressions != null && drawerRow.impressions > 0)) && (
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Your position</div>
                    <div className="grid grid-cols-2 gap-3">
                      {drawerRow.currentPosition != null && (
                        <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current rank</div>
                          <div className={`t-stat-sm font-semibold ${
                            drawerRow.currentPosition <= 10 ? 'text-emerald-400' :
                            drawerRow.currentPosition <= 30 ? 'text-amber-400' :
                            'text-[var(--brand-text)]'
                          }`}>#{drawerRow.currentPosition}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                            {drawerRow.currentPosition <= 10 ? 'On page 1' :
                             drawerRow.currentPosition <= 20 ? 'Top of page 2' : 'Page 2+'}
                          </div>
                        </div>
                      )}
                      {drawerRow.impressions != null && drawerRow.impressions > 0 && (
                        <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2.5">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Monthly impressions</div>
                          <div className="t-stat-sm font-semibold text-blue-400">
                            {drawerRow.impressions >= 1000 ? `${(drawerRow.impressions / 1000).toFixed(1)}k` : drawerRow.impressions}
                          </div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">via Google Search</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Why it's in the strategy */}
                {(drawerRow.rationale ?? drawerRow.opportunityDetail) && (
                  <div>
                    <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Why it's in the strategy</div>
                    <p className="t-body text-[var(--brand-text-muted)] leading-relaxed">
                      {drawerRow.rationale ?? drawerRow.opportunityDetail}
                    </p>
                  </div>
                )}

                {/* Next move */}
                <div className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-3">
                  <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Next move</div>
                  <p className="t-body text-[var(--brand-text)] leading-relaxed mb-3">
                    {drawerRow.nextMoveDetail}
                  </p>
                  {drawerRow.role === 'content' && (
                    <Button variant="primary" size="sm" onClick={() => { onTabChange?.('content'); closeDrawer(); }}>
                      Request content
                    </Button>
                  )}
                  {(drawerRow.role === 'page' || drawerRow.role === 'strategy') && drawerRow.pagePath && (
                    <Button variant="secondary" size="sm" onClick={() => { onTabChange?.('health'); closeDrawer(); }}>
                      Go to page
                    </Button>
                  )}
                </div>

                {/* Foldable: See the numbers */}
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
                    onClick={() => setDrawerEvidenceOpen(v => !v)}
                    aria-expanded={drawerEvidenceOpen}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${drawerEvidenceOpen ? '' : '-rotate-90'}`} />
                    See the numbers
                  </button>
                  {drawerEvidenceOpen && (
                    <div className="mt-2 flex flex-col gap-2.5">
                      {/* Raw metrics */}
                      {!unenriched && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {drawerRow.volume != null && (
                            <span className="t-caption text-[var(--brand-text-muted)]">
                              Volume: <span className="text-[var(--brand-text)]">{drawerRow.volume ? `${fmtNum(drawerRow.volume)}/mo` : '—'}</span>
                            </span>
                          )}
                          {drawerRow.difficulty != null && (
                            <span className="t-caption text-[var(--brand-text-muted)]">
                              KD: <span className="text-[var(--brand-text)]">{drawerRow.difficulty}</span>
                            </span>
                          )}
                        </div>
                      )}
                      {/* Signals — client-friendly labels */}
                      {drawerRow.contextSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {drawerRow.searchIntent && (
                            <span className={`px-2 py-0.5 rounded-[var(--radius-sm)] border t-caption capitalize ${intentColor(drawerRow.searchIntent)}`}>
                              {drawerRow.searchIntent} intent
                            </span>
                          )}
                          {drawerRow.contextSources.map(src => (
                            <span
                              key={src}
                              className="px-2 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption text-[var(--brand-text-muted)]"
                            >
                              {signalLabel[src] ?? src}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-[var(--brand-border)] flex-shrink-0">
                {isConfirmed ? (
                  <button
                    type="button"
                    className="t-caption text-[var(--brand-text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
                    disabled={isRemoving}
                    onClick={async () => {
                      await removePriorityKeyword(drawerRow);
                      closeDrawer();
                    }}
                  >
                    {isRemoving ? 'Removing…' : 'Remove from strategy'}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={addingKeyword}
                      disabled={addingKeyword}
                      onClick={async () => { await addStrategyKeyword(drawerRow.label); closeDrawer(); }}
                    >
                      Add to strategy
                    </Button>
                    <button
                      type="button"
                      className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors disabled:opacity-40"
                      disabled={isLoadingFeedback(drawerRow.label)}
                      onClick={async () => { await submitFeedback(drawerRow.label, 'declined', 'suggestion'); closeDrawer(); }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>

            </div>
          </>
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
