import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Zap, FileText, Target,
  ChevronDown, Layers,
  AlertTriangle,
  ThumbsDown, Undo2, Ban, Plus, X, Trash2, Briefcase,
} from 'lucide-react';
import { TierGate, EmptyState, Skeleton, type Tier, Icon, Button, PageHeader, SectionCard } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { useBetaMode } from './BetaContext';
import { PageKeywordMapContent } from './PageKeywordMapContent';
import { STUDIO_NAME } from '../../constants';
import { Modal } from '../ui/overlay/Modal';
import { StrategyContentOpportunitiesSection } from './strategy/StrategyContentOpportunitiesSection';
import { StrategyKeywordDrawer } from './strategy/StrategyKeywordDrawer';
import { StrategyPageImprovementsSection } from './strategy/StrategyPageImprovementsSection';
import { useStrategyBusinessPriorities } from './strategy/useStrategyBusinessPriorities';
import { useStrategyKeywordFeedback } from './strategy/useStrategyKeywordFeedback';
import { useStrategyTrackedKeywords } from './strategy/useStrategyTrackedKeywords';
import {
  ROLE_DISPLAY_LABELS,
  type PriorityKeywordItem,
  type PriorityKeywordStatus,
  type StrategyKeywordRole,
  type StrategyKeywordTableRow,
} from './strategy/strategyKeywordDisplay';

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

const normalizeKeyword = (keyword: string) => keyword.toLowerCase().trim();

const STRATEGY_TAB_SECTION_MAP = {
  'content-gaps': 'new-content',
  'quick-wins': 'optimize-existing',
  'page-keyword-map': 'page-keyword-map',
  'business-priorities': 'business-priorities',
} as const;

type StrategyDeepLinkTab = keyof typeof STRATEGY_TAB_SECTION_MAP;

function isStrategyDeepLinkTab(value: string | null): value is StrategyDeepLinkTab {
  return value != null && Object.prototype.hasOwnProperty.call(STRATEGY_TAB_SECTION_MAP, value);
}

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested, hidePrices }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [searchParams] = useSearchParams();
  const initialDeepLinkTab = searchParams.get('tab');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set(['new-content', 'optimize-existing']);
    if (isStrategyDeepLinkTab(initialDeepLinkTab)) {
      initial.add(STRATEGY_TAB_SECTION_MAP[initialDeepLinkTab]);
    }
    return initial;
  });

  const {
    keywordFeedback,
    feedbackLoadError,
    loadFeedback,
    submitFeedback,
    removeFeedback,
    undoFeedback,
    getFeedbackStatus,
    isLoadingFeedback,
    requestedKeywords,
  } = useStrategyKeywordFeedback({ workspaceId, setToast });

  const {
    priorities,
    prioritiesLoaded,
    newPriority,
    setNewPriority,
    newPriorityCategory,
    setNewPriorityCategory,
    savingPriorities,
    savePriorities,
  } = useStrategyBusinessPriorities({ workspaceId, setToast });

  const {
    trackedKeywords,
    newTrackedKeyword,
    setNewTrackedKeyword,
    addingKeyword,
    setAddingKeyword,
    removingKeyword,
    setRemovingKeyword,
    trackedKeywordsLoading,
    trackedKeywordsError,
    loadTrackedKeywords,
    addTrackedKeyword,
    removeTrackedKeyword,
  } = useStrategyTrackedKeywords({ workspaceId });

  const [declineReason, setDeclineReason] = useState<{ keyword: string; source: string } | null>(null);
  const [declineReasonText, setDeclineReasonText] = useState('');
  const [openKeywordDrawer, setOpenKeywordDrawer] = useState<string | null>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [drawerEvidenceOpen, setDrawerEvidenceOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerSnapshotRef = useRef<StrategyKeywordTableRow | null>(null);

  const closeDrawer = useCallback(() => {
    if (closeTimerRef.current || !openKeywordDrawer) return;
    setDrawerClosing(true);
    setDrawerEvidenceOpen(false);
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
        await removeTrackedKeyword(item.label);
        removedTracked = true;
      }

      if (item.isStrategy) {
        await submitFeedback(kw, 'declined', 'topic_cluster', 'Removed from strategy keywords', { toast: false, rethrow: true });
        setToast?.(`"${item.label}" removed from strategy keywords - it won't guide future recommendations`);
      } else if (item.isRequested) {
        try {
          await removeFeedback(kw, { toast: false, rethrow: true, clearOnError: removedTracked });
        } catch {
          if (!removedTracked) throw new Error('Failed to remove keyword feedback');
        }
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
  }, [workspaceId, removingKeyword, setToast, removeTrackedKeyword, submitFeedback, removeFeedback]);

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

  // Refs for scroll-to-section
  const priorityKeywordsRef = useRef<HTMLDivElement>(null);
  const optimizeExistingRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);

  const kwListScrollRef = useRef<HTMLDivElement>(null);
  const [kwListOverflows, setKwListOverflows] = useState(false);
  // effect-layout-ok — overflow measurement depends on rendered DOM dimensions.
  useEffect(() => {
    const el = kwListScrollRef.current;
    if (!el) return;
    setKwListOverflows(el.scrollHeight > el.clientHeight);
  });

  // effect-layout-ok — section expansion is initialized synchronously; this handles same-page URL changes and post-mount scrolling.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (!isStrategyDeepLinkTab(tab)) return;

    const section = STRATEGY_TAB_SECTION_MAP[tab];
    setExpandedSections(prev => {
      if (prev.has(section)) return prev;
      const next = new Set(prev);
      next.add(section);
      return next;
    });

    const refs: Record<StrategyDeepLinkTab, React.RefObject<HTMLDivElement | null>> = {
      'content-gaps': newContentRef,
      'quick-wins': optimizeExistingRef,
      'page-keyword-map': priorityKeywordsRef,
      'business-priorities': priorityKeywordsRef,
    };
    window.setTimeout(() => {
      refs[tab].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [searchParams]);

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
      await addTrackedKeyword(kw);
      if (['declined', 'requested'].includes(keywordFeedback.get(normalized) || '')) {
        try {
          await removeFeedback(normalized, { toast: false, clearOnError: true });
        } catch {
          // The keyword was added successfully; keep this view aligned with that action.
        }
      }
      if (options?.clearInput) setNewTrackedKeyword('');
      setToast?.('Added to Strategy Keywords. This will guide future recommendations, but it will not rewrite the current strategy instantly.');
    } catch {
      setToast?.('Failed to add keyword');
    } finally {
      setAddingKeyword(false);
    }
  };

  const roleSubLabel = (row: StrategyKeywordTableRow): string => {
    const label = ROLE_DISPLAY_LABELS[row.role] ?? row.roleLabel;
    const hasMetrics = (row.volume != null && row.volume > 0) || (row.difficulty != null && row.difficulty > 0);
    if (!hasMetrics) return label;
    const parts: string[] = [label];
    if (row.volume != null && row.volume > 0) {
      parts.push(row.volume >= 1000 ? `${(row.volume / 1000).toFixed(1)}k/mo` : `${row.volume}/mo`);
    }
    if (row.difficulty != null && row.difficulty > 0) parts.push(`KD ${row.difficulty}`);
    return parts.join(' · ');
  };

  const sortedConfirmed = [...strategyKeywordRows].sort(
    (a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
  );

  const priorityKeywordsPanel = (
    <SectionCard
      title="Strategy Keywords"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
      titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">{strategyKeywords.length} keyword{strategyKeywords.length === 1 ? '' : 's'} guiding tracking and recommendations</span>}
      noPadding
    >
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
          <div className="t-label text-[var(--brand-text-muted)] mb-2">
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
            <div className="relative">
              <div ref={kwListScrollRef} className="max-h-[420px] overflow-y-auto flex flex-col gap-1">
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
                    {/* Role indicator dot */}
                    <div
                      aria-hidden="true"
                      className={`w-1.5 h-1.5 rounded-[var(--radius-pill)] flex-shrink-0 mt-0.5 ${
                        row.role === 'content' ? 'bg-emerald-400' :
                        row.role === 'page' ? 'bg-blue-400' :
                        row.role === 'strategy' ? 'bg-teal-400' :
                        'bg-[var(--brand-text-muted)]'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
                      <div className="t-caption text-[var(--brand-text-muted)] truncate">
                        {roleSubLabel(row)}{row.enrichmentStatus === 'unenriched' ? ' · data pending' : ''}
                      </div>
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
              {kwListOverflows && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--surface-2)] to-transparent" />
              )}
            </div>
          )}
        </div>

        {/* Suggestions zone */}
        <div>
          <div className="t-label text-[var(--brand-text-muted)] mb-2">
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
                  className="relative overflow-hidden flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/20 cursor-pointer hover:border-blue-500/30 transition-colors"
                  onClick={() => { if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (openKeywordDrawer === row.normalized) closeDrawer(); else openOrSwapDrawer(row.normalized);
                    }
                  }}
                >
                  {/* Opportunity strength accent */}
                  <div
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-400 rounded-l-[var(--radius-lg)]"
                    style={{ opacity: Math.max(0.2, Math.min(1, (row.opportunityScore ?? 0) / 100)) }}
                  />
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
    </SectionCard>
  );


  return (
    <div className="space-y-8">
      {/* Header + Strategy Snapshot */}
      <PageHeader
        title="SEO Strategy"
        subtitle="A focused view of what to create, what to improve, and which keywords guide the strategy."
      />

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
      <SectionCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className={`t-stat-lg ${healthScore >= 80 ? 'text-accent-success' : healthScore >= 60 ? 'text-accent-warning' : 'text-accent-brand'}`}>
              {/* score-color-deviation-ok: planning readiness, not a health grade - teal avoids false alarm */}
              {healthScore}<span className="t-caption-sm text-[var(--brand-text-muted)]">/100</span>
            </div>
            <div>
              <div className="t-label text-[var(--brand-text-muted)]">Strategy Snapshot</div>
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
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{contentGapsFound}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Improve pages</div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{totalPageImprovements}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Ranking coverage</div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{pagesRanking}/{totalPages}</div>
            </div>
            <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Strategy keywords</div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{strategyKeywords.length}</div>
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
      </SectionCard>

      {/* ── RECOMMENDED NEXT STEPS ── */}
      <div className="space-y-3">
        <div>
          <h3 className="t-page font-semibold text-[var(--brand-text-bright)]">Recommended Next Steps</h3>
          <p className="t-body text-[var(--brand-text-muted)] mt-1">Start here. These are the clearest places to review, request, or give direction.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SectionCard variant="subtle">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon as={FileText} size="lg" className="text-accent-brand" />
                </div>
                <div className="min-w-0">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)]">Review new content ideas</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{contentGapsFound} strongest content recommendations</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => scrollToSection('new-content', newContentRef)} className="self-start">
                Review Ideas
              </Button>
            </div>
          </SectionCard>

        {(quickWinsAvailable > 0 || pagesWithGrowthOpps > 0) && (
          <SectionCard variant="subtle">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon as={Zap} size="lg" className="text-accent-warning" />
                </div>
                <div className="min-w-0">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)]">Improve existing pages</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{totalPageImprovements} page improvements to work through</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => scrollToSection('optimize-existing', optimizeExistingRef)} className="self-start">
                Review Pages
              </Button>
            </div>
          </SectionCard>
        )}

          <SectionCard variant="subtle">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon as={Target} size="lg" className="text-accent-info" />
                </div>
                <div className="min-w-0">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)]">Guide strategy keywords</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{strategyKeywords.length} keywords shaping the strategy</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => priorityKeywordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="self-start">
                Manage Keywords
              </Button>
            </div>
          </SectionCard>
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
      {workspaceId && prioritiesLoaded && (
        <SectionCard noPadding>
          <button
            onClick={() => toggleSection('business-priorities')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center">
                <Icon as={Briefcase} size="md" className="text-accent-brand" />
              </div>
              <div className="text-left">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Guide This Strategy</div>
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
              <p className="t-body text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
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
        </SectionCard>
      )}

      <StrategyContentOpportunitiesSection
        newContentRef={newContentRef}
        effectiveTier={effectiveTier}
        newContentTopicCount={newContentTopicCount}
        contentGapsFound={contentGapsFound}
        keywordGapCount={keywordGapCount}
        strategyData={strategyData}
        expandedSections={expandedSections}
        toggleSection={toggleSection}
        contentRequests={contentRequests}
        requestedTopics={requestedTopics}
        contentPlanKeywords={contentPlanKeywords}
        workspaceId={workspaceId}
        getFeedbackStatus={getFeedbackStatus}
        isLoadingFeedback={isLoadingFeedback}
        undoFeedback={undoFeedback}
        submitFeedback={submitFeedback}
        onDeclineKeyword={(keyword, source) => { setDeclineReason({ keyword, source }); setDeclineReasonText(''); }}
        betaMode={betaMode}
        setPricingModal={setPricingModal}
        briefPrice={briefPrice}
        fullPostPrice={fullPostPrice}
        fmtPrice={fmtPrice}
        hidePrices={hidePrices}
        onTabChange={onTabChange}
      />

      <StrategyPageImprovementsSection
        optimizeExistingRef={optimizeExistingRef}
        strategyData={strategyData}
        quickWinsAvailable={quickWinsAvailable}
        pagesWithGrowthOpps={pagesWithGrowthOpps}
        expandedSections={expandedSections}
        toggleSection={toggleSection}
        workspaceId={workspaceId}
        setToast={setToast}
        onContentRequested={onContentRequested}
      />

      {/* ── STRATEGY KEYWORDS ── */}
      <div ref={priorityKeywordsRef}>
        <TierGate tier={effectiveTier} required="growth" feature="Strategy Keywords" teaser={`${strategyKeywords.length} keywords`}>
          {priorityKeywordsPanel}
        </TierGate>
      </div>

      {/* ── PAGE KEYWORD MAP (advanced page detail) ── */}
      <div>
      <TierGate tier={effectiveTier} required="growth" feature="Keyword Map" teaser={`${strategyData.pageMap.length} pages tracked`}>
        <SectionCard noPadding>
          <button
            onClick={() => toggleSection('page-keyword-map')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
                <Icon as={Layers} size="md" className="text-accent-info" />
              </div>
              <div className="text-left">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Page Keyword Map</div>
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
        </SectionCard>
      </TierGate>
      </div>

      {/* ── DECLINED KEYWORDS SUMMARY ── */}
      {(() => {
        const declined = [...keywordFeedback.entries()].filter(([, s]) => s === 'declined');
        if (declined.length === 0) return null;
        return (
          <SectionCard noPadding>
            <button
              onClick={() => toggleSection('declined-keywords')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-red-500/20 flex items-center justify-center">
                  <Icon as={Ban} size="md" className="text-accent-danger" />
                </div>
                <div className="text-left">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)]">Not Relevant Keywords</div>
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
          </SectionCard>
        );
      })()}

      {/* Keyword detail drawer */}
      {(openKeywordDrawer || drawerClosing) && (() => {
        const allRows: StrategyKeywordTableRow[] = [...sortedConfirmed, ...keywordIdeaRows];
        const liveRow = allRows.find(r => r.normalized === openKeywordDrawer);
        if (liveRow) drawerSnapshotRef.current = liveRow;
        const drawerRow = liveRow ?? drawerSnapshotRef.current;
        if (!drawerRow) return null;
        return (
          <StrategyKeywordDrawer
            drawerRow={drawerRow}
            drawerClosing={drawerClosing}
            drawerRef={drawerRef}
            drawerEvidenceOpen={drawerEvidenceOpen}
            setDrawerEvidenceOpen={setDrawerEvidenceOpen}
            removingKeyword={removingKeyword}
            addingKeyword={addingKeyword}
            closeDrawer={closeDrawer}
            onTabChange={onTabChange}
            removePriorityKeyword={removePriorityKeyword}
            addStrategyKeyword={addStrategyKeyword}
            submitFeedback={submitFeedback}
            isLoadingFeedback={isLoadingFeedback}
          />
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
