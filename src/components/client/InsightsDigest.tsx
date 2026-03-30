import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Users, MousePointer, Shield, Zap,
  Target, FileText, Globe, Sparkles, CheckCircle2, Layers,
  ArrowRight, ChevronDown, Activity, type LucideIcon,
} from 'lucide-react';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';
import { useClientInsights } from '../../hooks/client/useClientInsights';
import type { ClientInsight } from '../../../shared/types/narrative.js';
import type { InsightType } from '../../../shared/types/analytics.js';
import type {
  SearchOverview, SearchQuery, AuditSummary, AuditDetail,
  GA4Overview, GA4ConversionSummary, GA4NewVsReturning, GA4OrganicOverview,
  SearchComparison, GA4Comparison, ClientKeywordStrategy, ClientTab,
} from './types';
import { fmtNum } from '../../utils/formatNumbers';

// ─── Types ───

interface DigestInsight {
  id: string;
  icon: LucideIcon;
  color: string;
  headline: string;
  body: string;
  detail?: string[];
  action?: { label: string; tab: ClientTab };
  priority: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'opportunity';
}

interface InsightsDigestProps {
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  ga4Overview: GA4Overview | null;
  ga4Comparison: GA4Comparison | null;
  ga4Organic: GA4OrganicOverview | null;
  ga4Conversions: GA4ConversionSummary[];
  ga4NewVsReturning: GA4NewVsReturning[];
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  strategyData: ClientKeywordStrategy | null;
  searchInsights: { lowHanging: SearchQuery[]; topPerformers: SearchQuery[] } | null;
  eventDisplayName: (name: string) => string;
  isEventPinned: (name: string) => boolean;
  workspaceId: string;
  contentPlanSummary?: { totalCells: number; publishedCells: number; reviewCells: number; approvedCells: number; inProgressCells: number; matrixCount: number } | null;
}

// ─── Helpers ───

function pct(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`;
}

// ─── Insight Generator ───

function generateInsights(props: InsightsDigestProps): DigestInsight[] {
  const {
    overview, searchComparison, ga4Overview, ga4Comparison, ga4Organic,
    ga4Conversions, ga4NewVsReturning, audit, auditDetail, strategyData,
    searchInsights, eventDisplayName, isEventPinned,
  } = props;

  const cards: DigestInsight[] = [];

  // 1. Traffic trend (GA4 comparison)
  if (ga4Comparison) {
    const { changePercent } = ga4Comparison;
    const up = changePercent.users > 0;
    const magnitude = Math.abs(changePercent.users);
    cards.push({
      id: 'traffic-trend',
      icon: up ? TrendingUp : TrendingDown,
      color: up ? 'teal' : 'red',
      headline: `Website traffic is ${up ? 'up' : 'down'} ${magnitude}%`,
      body: `You had ${fmtNum(ga4Comparison.current.totalUsers)} visitors this period vs ${fmtNum(ga4Comparison.previous.totalUsers)} last period.${
        ga4Organic ? ` Organic search drives ${ga4Organic.shareOfTotalUsers}% of your total traffic.` : ''
      }`,
      action: { label: 'View analytics', tab: 'performance' },
      priority: 1,
      sentiment: up ? 'positive' : 'negative',
    });
  } else if (ga4Overview) {
    cards.push({
      id: 'traffic-overview',
      icon: Users,
      color: 'teal',
      headline: `${fmtNum(ga4Overview.totalUsers)} visitors this period`,
      body: `${fmtNum(ga4Overview.totalSessions)} sessions with ${fmtNum(ga4Overview.totalPageviews)} page views. Avg session: ${Math.round(ga4Overview.avgSessionDuration)}s.${
        ga4Organic ? ` Organic search drives ${ga4Organic.shareOfTotalUsers}% of total traffic.` : ''
      }`,
      action: { label: 'View analytics', tab: 'performance' },
      priority: 2,
      sentiment: 'neutral',
    });
  }

  // 2. Search performance (GSC comparison)
  if (searchComparison) {
    const { changePercent, change } = searchComparison;
    const clicksUp = changePercent.clicks > 0;
    const posImproved = change.position < 0;
    let body = `Clicks ${clicksUp ? 'increased' : 'decreased'} ${pct(changePercent.clicks)}, impressions ${changePercent.impressions > 0 ? 'up' : 'down'} ${pct(changePercent.impressions)}.`;
    if (change.position !== 0) {
      body += ` Average position ${posImproved ? 'improved' : 'dropped'} by ${Math.abs(change.position).toFixed(1)} spots.`;
    }
    cards.push({
      id: 'search-trend',
      icon: clicksUp ? MousePointer : TrendingDown,
      color: clicksUp ? 'blue' : 'red',
      headline: `Search clicks ${clicksUp ? 'up' : 'down'} ${Math.abs(changePercent.clicks)}% vs last period`,
      body,
      action: { label: 'View search data', tab: 'performance' },
      priority: 1,
      sentiment: clicksUp ? 'positive' : 'negative',
    });
  } else if (overview) {
    cards.push({
      id: 'search-overview',
      icon: Globe,
      color: 'blue',
      headline: `${fmtNum(overview.totalClicks)} search clicks this period`,
      body: `Appearing in ${fmtNum(overview.totalImpressions)} Google searches with ${overview.avgCtr}% click-through rate. Average position: #${overview.avgPosition}.`,
      action: { label: 'View search data', tab: 'performance' },
      priority: 3,
      sentiment: 'neutral',
    });
  }

  // 3. Rankings wins
  if (searchInsights && searchInsights.topPerformers.length > 0) {
    const top = searchInsights.topPerformers;
    const topNames = top.slice(0, 3).map(q => `"${q.query}"`).join(', ');
    cards.push({
      id: 'rankings-wins',
      icon: CheckCircle2,
      color: 'green',
      headline: `${top.length} keyword${top.length !== 1 ? 's' : ''} ranking in the top 3`,
      body: `Your strongest positions: ${topNames}. These are driving real clicks — keep building on them.`,
      detail: top.slice(0, 5).map(q => `${q.query} → #${q.position} (${q.clicks} clicks)`),
      action: { label: 'View rankings', tab: 'performance' },
      priority: 3,
      sentiment: 'positive',
    });
  }

  // 4. Low-hanging fruit
  if (searchInsights && searchInsights.lowHanging.length > 0) {
    const lh = searchInsights.lowHanging;
    const closest = lh.sort((a, b) => a.position - b.position).slice(0, 3);
    cards.push({
      id: 'low-hanging',
      icon: Target,
      color: 'amber',
      headline: `${lh.length} keyword${lh.length !== 1 ? 's' : ''} almost on page 1`,
      body: `Small ranking improvements here could mean significant traffic gains. Closest: "${closest[0].query}" at #${closest[0].position}.`,
      detail: closest.map(q => `${q.query} → #${q.position} (${fmtNum(q.impressions)} impressions)`),
      action: { label: 'View opportunities', tab: 'performance' },
      priority: 2,
      sentiment: 'opportunity',
    });
  }

  // 5. Site health
  if (audit) {
    const healthy = audit.siteScore >= 80;
    const errors = auditDetail?.audit.errors || 0;
    const improved = audit.previousScore != null && audit.siteScore > audit.previousScore;
    const declined = audit.previousScore != null && audit.siteScore < audit.previousScore;
    const body = healthy
      ? `Your site health looks great across ${audit.totalPages} pages.${improved ? ` Score improved from ${audit.previousScore}.` : ''}`
      : `${errors} issue${errors !== 1 ? 's' : ''} found across ${audit.totalPages} pages.${declined ? ` Score dropped from ${audit.previousScore}.` : ' Fixing these could improve your search rankings.'}`;
    cards.push({
      id: 'site-health',
      icon: Shield,
      color: healthy ? 'green' : audit.siteScore >= 60 ? 'amber' : 'red',
      headline: `Site health: ${audit.siteScore}/100${healthy ? ' — looking good' : errors > 0 ? ` — ${errors} issues need attention` : ''}`,
      body,
      action: { label: 'View site health', tab: 'health' },
      priority: healthy ? 4 : 2,
      sentiment: healthy ? 'positive' : 'negative',
    });
  }

  // 5b. Core Web Vitals
  const cwv = auditDetail?.audit.cwvSummary;
  if (cwv && (cwv.mobile || cwv.desktop)) {
    const mob = cwv.mobile;
    const desk = cwv.desktop;
    const assessLabel = (a: string) => a === 'good' ? 'Passed' : a === 'needs-improvement' ? 'Needs Work' : a === 'poor' ? 'Poor' : 'No Data';
    const parts: string[] = [];
    if (mob) parts.push(`Mobile: ${assessLabel(mob.assessment)}`);
    if (desk) parts.push(`Desktop: ${assessLabel(desk.assessment)}`);
    const anyBad = (mob?.assessment === 'poor' || mob?.assessment === 'needs-improvement') ||
                   (desk?.assessment === 'poor' || desk?.assessment === 'needs-improvement');
    const allGood = (mob?.assessment === 'good' || !mob) && (desk?.assessment === 'good' || !desk);
    cards.push({
      id: 'cwv',
      icon: Globe,
      color: allGood ? 'green' : anyBad ? 'amber' : 'blue',
      headline: `Page speed: ${parts.join(' · ')}`,
      body: allGood
        ? 'Your Core Web Vitals are passing — page speed is not holding back your rankings.'
        : 'Some Core Web Vitals metrics need attention. Improving page speed can boost both rankings and user experience.',
      action: { label: 'View speed details', tab: 'health' },
      priority: allGood ? 5 : 3,
      sentiment: allGood ? 'positive' : 'opportunity',
    });
  }

  // 6. Key conversion events (pinned events only)
  const pinnedConversions = ga4Conversions.filter(c => isEventPinned(c.eventName));
  if (pinnedConversions.length > 0) {
    const top = pinnedConversions.sort((a, b) => b.conversions - a.conversions)[0];
    const totalConv = pinnedConversions.reduce((s, c) => s + c.conversions, 0);
    cards.push({
      id: 'conversions',
      icon: Zap,
      color: 'teal',
      headline: `${fmtNum(totalConv)} key event${totalConv !== 1 ? 's' : ''} this period`,
      body: `Top: ${eventDisplayName(top.eventName)} with ${fmtNum(top.conversions)} events (${top.rate}% rate).${
        pinnedConversions.length > 1 ? ` ${pinnedConversions.length} tracked event types total.` : ''
      }`,
      detail: pinnedConversions.slice(0, 4).map(c => `${eventDisplayName(c.eventName)}: ${fmtNum(c.conversions)} (${c.rate}%)`),
      action: { label: 'View events', tab: 'performance' },
      priority: 2,
      sentiment: 'positive',
    });
  }

  // 7. Quick wins from strategy
  if (strategyData?.quickWins && strategyData.quickWins.length > 0) {
    const wins = strategyData.quickWins;
    cards.push({
      id: 'quick-wins',
      icon: Sparkles,
      color: 'amber',
      headline: `${wins.length} quick win${wins.length !== 1 ? 's' : ''} identified`,
      body: `Small changes to existing pages that could boost your rankings. Top recommendation: ${wins[0].action}`,
      detail: wins.slice(0, 3).map(w => `${w.pagePath}: ${w.action}`),
      action: { label: 'View strategy', tab: 'strategy' },
      priority: 2,
      sentiment: 'opportunity',
    });
  }

  // 8. Content gaps from strategy
  if (strategyData?.contentGaps && strategyData.contentGaps.length > 0) {
    const gaps = strategyData.contentGaps;
    const highPri = gaps.filter(g => g.priority === 'high');
    cards.push({
      id: 'content-gaps',
      icon: FileText,
      color: 'teal',
      headline: `${gaps.length} content ${gaps.length === 1 ? 'opportunity' : 'opportunities'} for new traffic`,
      body: `Topics your site should cover but doesn't yet.${highPri.length > 0 ? ` ${highPri.length} are high priority.` : ''} Top idea: "${gaps[0].topic}"`,
      detail: gaps.slice(0, 3).map(g => `${g.topic} (${g.intent}, ${g.priority} priority)`),
      action: { label: 'View content gaps', tab: 'strategy' },
      priority: 3,
      sentiment: 'opportunity',
    });
  }

  // 9. New vs returning visitors
  if (ga4NewVsReturning.length > 0) {
    const newSeg = ga4NewVsReturning.find(s => s.segment === 'new');
    const retSeg = ga4NewVsReturning.find(s => s.segment === 'returning');
    if (newSeg && retSeg) {
      const highNew = newSeg.percentage > 70;
      const highRet = retSeg.percentage > 40;
      cards.push({
        id: 'new-vs-returning',
        icon: Users,
        color: 'blue',
        headline: `${Math.round(newSeg.percentage)}% of visitors are new`,
        body: highNew
          ? `You're attracting lots of fresh visitors — great for growth. Consider adding calls-to-action to convert them into returning visitors.`
          : highRet
          ? `Strong returning visitor base (${Math.round(retSeg.percentage)}%) shows good engagement. Your content keeps people coming back.`
          : `Healthy mix of new (${Math.round(newSeg.percentage)}%) and returning (${Math.round(retSeg.percentage)}%) visitors.`,
        action: { label: 'View visitor breakdown', tab: 'performance' },
        priority: 5,
        sentiment: 'neutral',
      });
    }
  }

  // 10. Organic search share
  if (ga4Organic && !ga4Comparison) {
    // Only show if we didn't already mention it in the traffic trend card
    if (ga4Organic.shareOfTotalUsers > 40) {
      cards.push({
        id: 'organic-share',
        icon: Globe,
        color: 'green',
        headline: `Organic search drives ${ga4Organic.shareOfTotalUsers}% of your traffic`,
        body: `${fmtNum(ga4Organic.organicUsers)} organic visitors with ${ga4Organic.engagementRate}% engagement rate. SEO is working — keep investing in content.`,
        action: { label: 'View organic data', tab: 'performance' },
        priority: 4,
        sentiment: 'positive',
      });
    }
  }

  // 11. Content plan progress
  if (props.contentPlanSummary && props.contentPlanSummary.totalCells > 0) {
    const cp = props.contentPlanSummary;
    const completionPct = Math.round((cp.publishedCells / cp.totalCells) * 100);
    if (cp.reviewCells > 0) {
      cards.push({
        id: 'content-plan-review',
        icon: Layers,
        color: 'blue',
        headline: `${cp.reviewCells} content plan page${cp.reviewCells > 1 ? 's' : ''} need your review`,
        body: `Your content plan has ${cp.totalCells} planned pages. ${cp.publishedCells} published, ${cp.approvedCells} approved, ${cp.inProgressCells} in progress. Review flagged items to keep the pipeline moving.`,
        action: { label: 'Review content plan', tab: 'content-plan' },
        priority: 1,
        sentiment: 'opportunity',
      });
    } else if (completionPct < 100) {
      cards.push({
        id: 'content-plan-progress',
        icon: Layers,
        color: completionPct >= 80 ? 'green' : completionPct >= 40 ? 'teal' : 'blue',
        headline: `Content plan is ${completionPct}% complete`,
        body: `${cp.publishedCells} of ${cp.totalCells} pages published across ${cp.matrixCount} plan${cp.matrixCount !== 1 ? 's' : ''}.${cp.inProgressCells > 0 ? ` ${cp.inProgressCells} currently in progress.` : ''}${cp.approvedCells > 0 ? ` ${cp.approvedCells} approved and queued.` : ''}`,
        action: { label: 'View content plan', tab: 'content-plan' },
        priority: 3,
        sentiment: completionPct >= 80 ? 'positive' : 'neutral',
      });
    } else {
      cards.push({
        id: 'content-plan-complete',
        icon: Layers,
        color: 'green',
        headline: 'Content plan fully published',
        body: `All ${cp.totalCells} planned pages are live across ${cp.matrixCount} plan${cp.matrixCount !== 1 ? 's' : ''}. Great work!`,
        action: { label: 'View content plan', tab: 'content-plan' },
        priority: 5,
        sentiment: 'positive',
      });
    }
  }

  // 12. Position improvement alert
  if (searchComparison && searchComparison.change.position < -2) {
    // Big position improvement — call it out
    cards.push({
      id: 'position-jump',
      icon: TrendingUp,
      color: 'green',
      headline: `Average position improved by ${Math.abs(searchComparison.change.position).toFixed(1)} spots`,
      body: `Your rankings are climbing. This should translate to more clicks and traffic over the coming weeks.`,
      action: { label: 'View search trends', tab: 'performance' },
      priority: 1,
      sentiment: 'positive',
    });
  }

  // Sort by priority, then by sentiment weight
  const sentimentWeight = { negative: 0, opportunity: 1, positive: 2, neutral: 3 };
  cards.sort((a, b) => a.priority - b.priority || sentimentWeight[a.sentiment] - sentimentWeight[b.sentiment]);

  return cards;
}

// ─── Server Insight Mapping ───

const INSIGHT_TYPE_ICONS: Record<InsightType, LucideIcon> = {
  ranking_mover: TrendingUp,
  ctr_opportunity: MousePointer,
  content_decay: TrendingDown,
  page_health: Activity,
  ranking_opportunity: Target,
  cannibalization: Layers,
  keyword_cluster: Sparkles,
  competitor_gap: Users,
  conversion_attribution: Zap,
  serp_opportunity: Globe,
  strategy_alignment: FileText,
  anomaly_digest: Shield,
};

const SEVERITY_TO_SENTIMENT: Record<string, DigestInsight['sentiment']> = {
  positive: 'positive',
  opportunity: 'opportunity',
  warning: 'negative',
  critical: 'negative',
};

const SEVERITY_TO_COLOR: Record<string, string> = {
  positive: 'green',
  opportunity: 'amber',
  warning: 'amber',
  critical: 'red',
};

const INSIGHT_TYPE_ACTIONS: Partial<Record<InsightType, { label: string; tab: ClientTab }>> = {
  ranking_mover: { label: 'View search data', tab: 'performance' },
  ctr_opportunity: { label: 'View search data', tab: 'performance' },
  ranking_opportunity: { label: 'View opportunities', tab: 'performance' },
  content_decay: { label: 'View search data', tab: 'performance' },
  page_health: { label: 'View site health', tab: 'health' },
  cannibalization: { label: 'View strategy', tab: 'strategy' },
  keyword_cluster: { label: 'View strategy', tab: 'strategy' },
  competitor_gap: { label: 'View strategy', tab: 'strategy' },
  conversion_attribution: { label: 'View analytics', tab: 'performance' },
  serp_opportunity: { label: 'View site health', tab: 'health' },
  anomaly_digest: { label: 'View analytics', tab: 'performance' },
  strategy_alignment: { label: 'View strategy', tab: 'strategy' },
};

function mapServerInsights(insights: ClientInsight[]): DigestInsight[] {
  return insights.map(i => {
    let body = i.narrative;
    if (i.impact) body += ` ${i.impact}`;

    const detail: string[] = [];
    if (i.actionTaken) detail.push(`Action taken: ${i.actionTaken}`);

    return {
      id: `server-${i.id}`,
      icon: INSIGHT_TYPE_ICONS[i.type] ?? Sparkles,
      color: SEVERITY_TO_COLOR[i.severity] ?? 'amber',
      headline: i.headline,
      body,
      detail: detail.length > 0 ? detail : undefined,
      action: INSIGHT_TYPE_ACTIONS[i.type],
      priority: Math.max(1, 6 - Math.ceil(i.impactScore / 20)),
      sentiment: SEVERITY_TO_SENTIMENT[i.severity] ?? 'neutral',
    };
  });
}

function mergeInsights(local: DigestInsight[], server: DigestInsight[]): DigestInsight[] {
  // Server insights first, then local — deduplicate by id
  const seen = new Set<string>();
  const merged: DigestInsight[] = [];
  for (const item of [...server, ...local]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  // Re-sort by priority, then sentiment weight
  const sentimentWeight = { negative: 0, opportunity: 1, positive: 2, neutral: 3 };
  merged.sort((a, b) => a.priority - b.priority || sentimentWeight[a.sentiment] - sentimentWeight[b.sentiment]);
  return merged;
}

// ─── Color Maps ───

const COLORS: Record<string, { text: string; badge: string }> = {
  teal:  { text: 'text-teal-400',    badge: 'bg-teal-500/10 text-teal-400' },
  blue:  { text: 'text-blue-400',    badge: 'bg-blue-500/10 text-blue-400' },
  green: { text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400' },
  amber: { text: 'text-amber-400',   badge: 'bg-amber-500/10 text-amber-400' },
  red:   { text: 'text-red-400',     badge: 'bg-red-500/10 text-red-400' },
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: 'Win',
  negative: 'Needs attention',
  opportunity: 'Opportunity',
  neutral: 'Info',
};

// ─── Component ───

export function InsightsDigest(props: InsightsDigestProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const { data: serverData } = useClientInsights(props.workspaceId);
  const [expanded, setExpanded] = useState(false);

  const localInsights = generateInsights(props);
  const serverInsights = mapServerInsights(serverData?.insights ?? []);
  const insights = mergeInsights(localInsights, serverInsights);

  if (insights.length === 0) return null;

  const INITIAL_COUNT = 4;
  const all = insights.slice(0, 10);
  const visible = expanded ? all : all.slice(0, INITIAL_COUNT);
  const hasMore = all.length > INITIAL_COUNT;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-teal-500/15 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-teal-400" />
        </div>
        <span className="text-sm font-semibold text-zinc-200">Insights</span>
        <span className="text-xs text-zinc-500">{all.length} things to know</span>
      </div>

      <div className="space-y-3">
        {visible.map(insight => {
          const c = COLORS[insight.color] || COLORS.teal;
          const Icon = insight.icon;
          return (
            <button
              key={insight.id}
              onClick={() => insight.action && navigate(clientPath(props.workspaceId, insight.action.tab, betaMode))}
              className="w-full bg-zinc-900 border border-zinc-800 p-5 text-left hover:border-zinc-700 transition-colors cursor-pointer group"
              style={{ borderRadius: '10px 24px 10px 24px' }}
            >
              {/* Header */}
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className={`w-4 h-4 ${c.text}`} />
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${c.badge}`}>
                  {SENTIMENT_LABELS[insight.sentiment]}
                </span>
              </div>
              <h3 className="text-sm font-medium text-zinc-200 leading-snug mb-1.5">{insight.headline}</h3>

              {/* Body */}
              <p className="text-[11px] text-zinc-500 leading-relaxed mb-2">
                {insight.body}
              </p>

              {/* Detail items */}
              {insight.detail && insight.detail.length > 0 && (
                <div className="space-y-1 mb-2">
                  {insight.detail.map((item, i) => (
                    <div key={i} className="text-[11px] py-1 px-2 rounded bg-zinc-800/30 text-zinc-400 truncate">
                      {item}
                    </div>
                  ))}
                </div>
              )}

              {/* Destination hint */}
              {insight.action && (
                <span className="text-[11px] text-teal-400 group-hover:text-teal-300 flex items-center gap-1 transition-colors">
                  {insight.action.label} <ArrowRight className="w-3 h-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          Show {all.length - INITIAL_COUNT} more insight{all.length - INITIAL_COUNT > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}

// ─── Compact Performance Pulse ───

interface PulseMetric {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  color: string;
}

interface PerformancePulseProps {
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  ga4Overview: GA4Overview | null;
  ga4Comparison: GA4Comparison | null;
  audit: AuditSummary | null;
  strategyData: ClientKeywordStrategy | null;
}

export function PerformancePulse({ overview, searchComparison, ga4Overview, ga4Comparison, audit, strategyData }: PerformancePulseProps) {
  const metrics: PulseMetric[] = [];

  if (ga4Overview) {
    metrics.push({
      label: 'Visitors',
      value: fmtNum(ga4Overview.totalUsers),
      change: ga4Comparison?.changePercent.users,
      color: 'text-teal-400',
    });
  }
  if (overview) {
    metrics.push({
      label: 'Search Clicks',
      value: fmtNum(overview.totalClicks),
      change: searchComparison?.changePercent.clicks,
      color: 'text-blue-400',
    });
    metrics.push({
      label: 'Impressions',
      value: fmtNum(overview.totalImpressions),
      change: searchComparison?.changePercent.impressions,
      color: 'text-blue-400',
    });
  } else if (ga4Overview) {
    metrics.push({
      label: 'Sessions',
      value: fmtNum(ga4Overview.totalSessions),
      change: ga4Comparison?.changePercent.sessions,
      color: 'text-blue-400',
    });
  }
  if (audit) {
    metrics.push({
      label: 'Site Health',
      value: `${audit.siteScore}/100`,
      changeLabel: audit.previousScore != null ? `${audit.siteScore > audit.previousScore ? '+' : ''}${audit.siteScore - audit.previousScore}` : undefined,
      change: audit.previousScore != null ? audit.siteScore - audit.previousScore : undefined,
      color: audit.siteScore >= 80 ? 'text-emerald-400' : audit.siteScore >= 60 ? 'text-amber-400' : 'text-red-400',
    });
  }
  if (strategyData) {
    const ranked = strategyData.pageMap.filter(p => p.currentPosition);
    if (ranked.length > 0) {
      const avgP = ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length;
      metrics.push({
        label: 'Avg Position',
        value: `#${avgP.toFixed(1)}`,
        color: avgP <= 10 ? 'text-emerald-400' : avgP <= 20 ? 'text-amber-400' : 'text-blue-400',
      });
    }
  }

  if (metrics.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {metrics.map((m, i) => (
        <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.label}</div>
            <span className={`text-sm font-bold ${m.color}`}>{m.value}</span>
          </div>
          {m.change != null && m.change !== 0 && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
              m.change > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {m.changeLabel || pct(m.change)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
