import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Target,
  AlertTriangle,
} from 'lucide-react';
import { TierGate, TabBar, EmptyState, type Tier, Icon, Button } from '../ui';
import type { ClientKeywordStrategy, ClientContentRequest } from './types';
import { calculateStrategyHealth } from '../../lib/strategy-health-score';
import { resolveTabSearchParam, clearTabSearchParam } from '../../lib/tab-search-param';
import { StrategyClientOrientHeader } from './strategy/StrategyClientOrientHeader';
import { CompetitorGapsSection } from './CompetitorGapsSection';
import { useBetaMode } from './BetaContext';
import { useClientIntelligence } from '../../hooks/client';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { STUDIO_NAME } from '../../constants';
import { StrategyBusinessPrioritiesSection } from './strategy/StrategyBusinessPrioritiesSection';
import { StrategyContentOpportunitiesSection } from './strategy/StrategyContentOpportunitiesSection';
import { StrategyDeclinedKeywordsSection } from './strategy/StrategyDeclinedKeywordsSection';
import { StrategyDeclineKeywordModal } from './strategy/StrategyDeclineKeywordModal';
import { StrategyKeywordFeedbackSummaryCard } from './strategy/StrategyKeywordFeedbackSummaryCard';
import { StrategyKeywordDrawer } from './strategy/StrategyKeywordDrawer';
import { StrategyKeywordsSection } from './strategy/StrategyKeywordsSection';
import { StrategyNextStepsSection } from './strategy/StrategyNextStepsSection';
import { StrategyPageKeywordMapSection } from './strategy/StrategyPageKeywordMapSection';
import { StrategyRequestedKeywordTrendSection } from './strategy/StrategyRequestedKeywordTrendSection';
import { StrategyPageImprovementsSection } from './strategy/StrategyPageImprovementsSection';
import { StrategyRefreshSummarySection } from './strategy/StrategyRefreshSummarySection';
import { StrategySnapshotSection } from './strategy/StrategySnapshotSection';
import { useStrategyBusinessPriorities } from './strategy/useStrategyBusinessPriorities';
import { useStrategyKeywordFeedback } from './strategy/useStrategyKeywordFeedback';
import { useStrategyTrackedKeywords } from './strategy/useStrategyTrackedKeywords';
import { keywordIdentityKeyV2 } from '../../../shared/keyword-normalization';
import {
  type PriorityKeywordItem,
  type PriorityKeywordStatus,
  type StrategyKeywordRole,
  type StrategyKeywordTableRow,
  normalizeKeyword,
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
  contentPlanKeywords?: Map<string, string>;
  onTabChange?: (tab: string) => void;
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
}

// Strategy v2 client interior tabs (command-center layout). Mirrors the admin IA. The literal ids
// appear here so the ?tab= deep-link contract test recognizes this receiver.
type ClientStrategyTab = 'overview' | 'content' | 'rankings' | 'competitive';
const CLIENT_STRATEGY_TABS: { id: ClientStrategyTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'competitive', label: 'Competitive' },
];

// Bridge the legacy section-scroll ?tab= values (STRATEGY_TAB_SECTION_MAP — still used by senders like
// InsightsBriefingPage's `strategy?tab=content-gaps` deep-link) onto v2 interior tabs, so an incoming
// legacy deep-link lands on the tab that hosts that section instead of silently falling back to Overview.
const LEGACY_TAB_ALIASES: Partial<Record<string, ClientStrategyTab>> = {
  'content-gaps': 'content',
  'quick-wins': 'content',
  'page-keyword-map': 'rankings',
  'business-priorities': 'overview',
};

const FOCUSABLE_SELECTOR = [
  'a[href]', 'area[href]', 'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');
const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );

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

export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested }: StrategyTabProps) {
  const betaMode = useBetaMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: clientIntelligence } = useClientIntelligence(workspaceId ?? '');
  const keywordFeedbackSummary =
    effectiveTier !== 'free' && clientIntelligence?.tier !== 'free'
      ? clientIntelligence?.keywordFeedbackSummary
      : null;
  const initialDeepLinkTab = searchParams.get('tab');
  const [expandedSections, toggleSection, setExpandedSections] = useToggleSet<string>(() => {
    const initial = new Set(['new-content', 'optimize-existing']);
    if (isStrategyDeepLinkTab(initialDeepLinkTab)) {
      initial.add(STRATEGY_TAB_SECTION_MAP[initialDeepLinkTab]);
    }
    return initial;
  }, UNBOUNDED_TOGGLE_SET_OPTIONS);

  // Strategy interior tab (?tab= deep-link, two-halves contract — mirrors the admin StrategyTab).
  // The command-center layout is the baseline, so this tab state is always consumed.
  const [interiorTab, setInteriorTab] = useState<ClientStrategyTab>(() =>
    resolveTabSearchParam<ClientStrategyTab>(searchParams.get('tab'), {
      validValues: CLIENT_STRATEGY_TABS.map((t) => t.id),
      fallback: 'overview',
      legacyAliases: LEGACY_TAB_ALIASES,
    }),
  );
  useEffect(() => {
    const param = searchParams.get('tab');
    if (!param) return;
    const resolved = resolveTabSearchParam<ClientStrategyTab>(param, {
      validValues: CLIENT_STRATEGY_TABS.map((t) => t.id),
      fallback: interiorTab, // unmappable param → keep the current tab (don't reset to Overview)
      legacyAliases: LEGACY_TAB_ALIASES,
    });
    if (resolved !== interiorTab) setInteriorTab(resolved);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- sync interior tab to external ?tab= changes only
  const handleInteriorTabChange = (id: string) => {
    setInteriorTab(id as ClientStrategyTab);
    const next = clearTabSearchParam(searchParams);
    if (next) setSearchParams(next, { replace: true });
  };

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
    declinedKeywords,
  } = useStrategyKeywordFeedback({ workspaceId, setToast });

  const {
    priorities,
    prioritiesLoaded,
    prioritiesError,
    reloadPriorities,
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
    const kw = item.actionKeyword;
    const identityKey = item.identityKey;
    if (!kw || removingKeyword === identityKey) return;
    setRemovingKeyword(identityKey);
    try {
      let removedTracked = false;
      if (item.isTracked) {
        await removeTrackedKeyword(kw);
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
  const businessPrioritiesRef = useRef<HTMLDivElement>(null);

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
      'business-priorities': businessPrioritiesRef,
    };
    window.setTimeout(() => {
      refs[tab].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [searchParams]);

  // Refs for keyword drawer focus management
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerPreviousFocusRef = useRef<HTMLElement | null>(null);

  if (!strategyData) {
    const action = onTabChange ? (
      <Button size="sm" onClick={() => onTabChange('inbox')}>
        Open Inbox
      </Button>
    ) : undefined;
    return (
      <EmptyState
        icon={Target}
        title="SEO strategy is being prepared"
        description={`${STUDIO_NAME} is building a keyword strategy for your site. Check back soon, or open Inbox to send your team a request.`}
        action={action}
      />
    );
  }

  const {
    contentGapsFound,
    quickWinsAvailable,
    keywordGapCount,
    newContentTopicCount,
    pagesRanking,
    totalPages,
    pagesWithGrowthOpps,
    contentScore,
    quickWinScore,
    coverageScore,
    healthScore,
  } = calculateStrategyHealth(strategyData);

  const totalPageImprovements = quickWinsAvailable + pagesWithGrowthOpps;
  const priorityKeywordMap = new Map<string, PriorityKeywordItem>();
  strategyData.siteKeywords.forEach(kw => {
    const normalized = normalizeKeyword(kw);
    const identityKey = keywordIdentityKeyV2(kw);
    if (identityKey && keywordFeedback.get(identityKey) !== 'declined') {
      priorityKeywordMap.set(identityKey, {
        label: kw,
        identityKey,
        actionKeyword: kw,
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
    const identityKey = keywordIdentityKeyV2(tk.query);
    if (identityKey && keywordFeedback.get(identityKey) !== 'declined') {
      const existing = priorityKeywordMap.get(identityKey);
      priorityKeywordMap.set(identityKey, {
        label: existing?.label || tk.query,
        identityKey,
        actionKeyword: existing?.actionKeyword || tk.query,
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
    const identityKey = keywordIdentityKeyV2(kw);
    if (identityKey && keywordFeedback.get(identityKey) !== 'declined') {
      const existing = priorityKeywordMap.get(identityKey);
      const isTracked = existing?.isTracked || false;
      const isStrategy = existing?.isStrategy || false;
      priorityKeywordMap.set(identityKey, {
        label: existing?.label || kw,
        identityKey,
        // Feedback owns the requested raw spelling, so it is the exact mutation input.
        actionKeyword: kw,
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
  const explanationMap = new Map((strategyData.strategyUx?.explanations || []).map(explanation => [explanation.normalizedKeyword, explanation]));

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
    const explanation = explanationMap.get(item.normalized);
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
      cpc: page?.cpc, // Task 3.2: realized-$ input joined from page_keywords
      metricsSource,
      contextSources,
      rationale: contentGap?.rationale,
      trendDirection: contentGap?.trendDirection,
      enrichmentStatus,
      explanation,
      // Task 2.3: server-computed value reasons from the explanation (flag-gated, never re-derived).
      valueReasons: explanation?.valueReasons,
      // Task 3.3: server-computed realized $ (one keywordDollarValue definition). Never re-derived client-side.
      currentMonthly: explanation?.currentMonthly,
      upsideMonthly: explanation?.upsideMonthly,
    };
  };

  const strategyKeywordRows = strategyKeywords.map(buildKeywordRow);
  const keywordIdeaRows = keywordIdeas.map(buildKeywordRow);

  const addStrategyKeyword = async (keyword: string, options?: { clearInput?: boolean }) => {
    if (!workspaceId) return;
    const kw = keyword.trim();
    if (!kw || kw.length < 2 || addingKeyword) return;
    const identityKey = keywordIdentityKeyV2(kw);
    const existingPriorityKeyword = priorityKeywordMap.get(identityKey);
    if (existingPriorityKeyword?.isTracked) {
      setToast?.(`"${kw}" is already a strategy keyword`);
      if (options?.clearInput) setNewTrackedKeyword('');
      return;
    }
    setAddingKeyword(true);
    try {
      await addTrackedKeyword(kw);
      if (['declined', 'requested'].includes(keywordFeedback.get(keywordIdentityKeyV2(kw)) || '')) {
        try {
          await removeFeedback(kw, { toast: false, clearOnError: true });
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

  // ── Section elements — defined once, arranged flat (legacy) or into interior tabs (v2) ──
  const unvalidatedNoteEl = !strategyData.pageMap.some(p => p.volume && p.volume > 0) ? (
    <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-2.5" style={{ borderRadius: 'var(--radius-signature)' }}>
      <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
      <div className="t-caption text-accent-warning leading-relaxed">
        Keyword volume and difficulty metrics are currently unavailable for this strategy. The recommendations are based on AI analysis and site content.
      </div>
    </div>
  ) : null;

  const snapshotEl = (
    <StrategySnapshotSection
      healthScore={healthScore}
      generatedAt={strategyData.generatedAt}
      contentGapsFound={contentGapsFound}
      totalPageImprovements={totalPageImprovements}
      pagesRanking={pagesRanking}
      totalPages={totalPages}
      strategyKeywordCount={strategyKeywords.length}
      contentScore={contentScore}
      quickWinScore={quickWinScore}
      coverageScore={coverageScore}
    />
  );

  const refreshSummaryEl = strategyData.strategyUx?.refreshSummary ? (
    <StrategyRefreshSummarySection summary={strategyData.strategyUx.refreshSummary} />
  ) : null;

  const nextStepsEl = (
    <StrategyNextStepsSection
      contentGapsFound={contentGapsFound}
      totalPageImprovements={totalPageImprovements}
      strategyKeywordCount={strategyKeywords.length}
      showPageImprovements={quickWinsAvailable > 0 || pagesWithGrowthOpps > 0}
      onReviewIdeas={() => handleInteriorTabChange('content')}
      onReviewPages={() => handleInteriorTabChange('content')}
      onManageKeywords={() => handleInteriorTabChange('rankings')}
    />
  );

  const keywordFeedbackSummaryEl = keywordFeedbackSummary ? (
    <StrategyKeywordFeedbackSummaryCard summary={keywordFeedbackSummary} />
  ) : null;

  const loadErrorsEl = (feedbackLoadError || trackedKeywordsError) ? (
    <div className="space-y-1">
      {feedbackLoadError && (
        <p className="t-caption-sm text-accent-danger">
          Couldn't load your previous keyword feedback - your relevant and not relevant choices may not reflect correctly.{' '}
          <Button variant="link" className="text-accent-danger hover:text-accent-danger" onClick={loadFeedback}>Retry</Button>
        </p>
      )}
      {trackedKeywordsError && (
        <p className="t-caption-sm text-accent-danger">
          Couldn't load your strategy keywords.{' '}
          <Button variant="link" className="text-accent-danger hover:text-accent-danger" onClick={loadTrackedKeywords}>Retry</Button>
        </p>
      )}
    </div>
  ) : null;

  const businessPrioritiesEl = (
    <StrategyBusinessPrioritiesSection
      businessPrioritiesRef={businessPrioritiesRef}
      workspaceId={workspaceId}
      prioritiesLoaded={prioritiesLoaded}
      prioritiesError={prioritiesError}
      reloadPriorities={() => { void reloadPriorities(); }}
      priorities={priorities}
      newPriority={newPriority}
      setNewPriority={setNewPriority}
      newPriorityCategory={newPriorityCategory}
      setNewPriorityCategory={setNewPriorityCategory}
      savingPriorities={savingPriorities}
      savePriorities={savePriorities}
      expandedSections={expandedSections}
      toggleSection={toggleSection}
    />
  );

  const contentOppsEl = (
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
      onTabChange={onTabChange}
    />
  );

  const pageImprovementsEl = (
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
  );

  const keywordsSectionEl = (
    <div ref={priorityKeywordsRef}>
      <TierGate tier={effectiveTier} required="growth" feature="Strategy Keywords" teaser={`${strategyKeywords.length} keywords`}>
        <StrategyKeywordsSection
          strategyKeywordRows={strategyKeywordRows}
          keywordIdeaRows={keywordIdeaRows}
          newTrackedKeyword={newTrackedKeyword}
          setNewTrackedKeyword={setNewTrackedKeyword}
          addingKeyword={addingKeyword}
          removingKeyword={removingKeyword}
          trackedKeywordsLoading={trackedKeywordsLoading}
          workspaceId={workspaceId}
          openKeywordDrawer={openKeywordDrawer}
          closeDrawer={closeDrawer}
          openOrSwapDrawer={openOrSwapDrawer}
          addStrategyKeyword={addStrategyKeyword}
          removePriorityKeyword={removePriorityKeyword}
          submitFeedback={submitFeedback}
          isLoadingFeedback={isLoadingFeedback}
        />
      </TierGate>
    </div>
  );

  const requestedTrendEl = (
    <StrategyRequestedKeywordTrendSection
      workspaceId={workspaceId}
      trackedKeywords={trackedKeywords}
      effectiveTier={effectiveTier}
    />
  );

  const pageKeywordMapEl = (
    <StrategyPageKeywordMapSection
      effectiveTier={effectiveTier}
      pageMap={strategyData.pageMap}
      strategyUx={strategyData.strategyUx}
      expandedSections={expandedSections}
      toggleSection={toggleSection}
      workspaceId={workspaceId}
      setToast={setToast}
      onContentRequested={onContentRequested}
      keywordFeedback={keywordFeedback}
      submitFeedback={submitFeedback}
      onDeclineKeyword={(keyword, source) => { setDeclineReason({ keyword, source }); setDeclineReasonText(''); }}
      undoFeedback={undoFeedback}
      isLoadingFeedback={isLoadingFeedback}
    />
  );

  const declinedKeywordsEl = (
    <StrategyDeclinedKeywordsSection
      declinedKeywords={declinedKeywords}
      expandedSections={expandedSections}
      toggleSection={toggleSection}
      undoFeedback={undoFeedback}
      isLoadingFeedback={isLoadingFeedback}
    />
  );

  const modalsEl = (
    <>
      {/* Keyword detail drawer */}
      {(openKeywordDrawer || drawerClosing) && (() => {
        const allRows: StrategyKeywordTableRow[] = [...strategyKeywordRows, ...keywordIdeaRows];
        const liveRow = allRows.find(r => r.identityKey === openKeywordDrawer);
        if (liveRow) drawerSnapshotRef.current = liveRow;
        const drawerRow = liveRow ?? drawerSnapshotRef.current;
        if (!drawerRow) return null;
        return (
          <StrategyKeywordDrawer
            drawerRow={drawerRow}
            drawerClosing={drawerClosing}
            drawerRef={drawerRef}
            effectiveTier={effectiveTier}
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
        <StrategyDeclineKeywordModal
          keyword={declineReason.keyword}
          declineReasonText={declineReasonText}
          setDeclineReasonText={setDeclineReasonText}
          onClose={() => setDeclineReason(null)}
          onConfirm={() => {
            submitFeedback(declineReason.keyword, 'declined', declineReason.source, declineReasonText || undefined);
            setDeclineReason(null);
            setDeclineReasonText('');
          }}
        />
      )}
    </>
  );

  // ── Strategy command-center layout (the v2-cutover baseline): Orient header + interior tabs ──
  return (
    <div className="space-y-8">
      {unvalidatedNoteEl}
      {loadErrorsEl}
      <StrategyClientOrientHeader orient={strategyData.strategyUx?.orient} />
      <TabBar tabs={CLIENT_STRATEGY_TABS} active={interiorTab} onChange={handleInteriorTabChange} />
      {interiorTab === 'overview' && (
        <div className="space-y-8">
          {snapshotEl}
          {refreshSummaryEl}
          {nextStepsEl}
          {keywordFeedbackSummaryEl}
          {businessPrioritiesEl}
        </div>
      )}
      {interiorTab === 'content' && (
        <div className="space-y-8">
          {contentOppsEl}
          {pageImprovementsEl}
        </div>
      )}
      {interiorTab === 'rankings' && (
        <div className="space-y-8">
          {pageKeywordMapEl}
          {requestedTrendEl}
          {keywordsSectionEl}
          {declinedKeywordsEl}
        </div>
      )}
      {interiorTab === 'competitive' && (
        <CompetitorGapsSection workspaceId={workspaceId ?? ''} tier={effectiveTier} />
      )}
      {modalsEl}
    </div>
  );
}
