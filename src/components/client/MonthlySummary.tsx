import {
  TrendingUp, TrendingDown, Shield, MousePointerClick, Users,
  FileText, CheckCircle2, MessageSquare, Activity, Calendar,
  Eye, Minus,
} from 'lucide-react';
import type {
  SearchOverview, SearchComparison, GA4Overview, GA4Comparison,
  AuditSummary, ClientContentRequest, ClientRequest, ApprovalBatch,
} from './types';

interface MonthlySummaryProps {
  overview: SearchOverview | null;
  searchComparison: SearchComparison | null;
  ga4Overview: GA4Overview | null;
  ga4Comparison: GA4Comparison | null;
  audit: AuditSummary | null;
  contentRequests: ClientContentRequest[];
  requests: ClientRequest[];
  approvalBatches: ApprovalBatch[];
  activityCount: number;
}

function DeltaBadge({ value, suffix = '%' }: { value: number | undefined | null; suffix?: string }) {
  if (value == null) return null;
  const isUp = value > 0;
  const isFlat = value === 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const color = isFlat ? 'text-zinc-500' : isUp ? 'text-emerald-400' : 'text-red-400';
  const bg = isFlat ? 'bg-zinc-800/50' : isUp ? 'bg-emerald-500/10' : 'bg-red-500/10';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${color} ${bg}`}>
      <Icon className="w-2.5 h-2.5" />
      {isFlat ? '0' : `${isUp ? '+' : ''}${value.toFixed(1)}`}{suffix}
    </span>
  );
}

export function MonthlySummary({
  overview, searchComparison, ga4Overview, ga4Comparison,
  audit, contentRequests, requests, approvalBatches, activityCount,
}: MonthlySummaryProps) {
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Content metrics this month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const contentThisMonth = contentRequests.filter(r => r.requestedAt >= thisMonthStart);
  const briefsDelivered = contentThisMonth.filter(r => ['client_review', 'approved', 'in_progress', 'delivered'].includes(r.status)).length;
  const requestsCompleted = requests.filter(r => r.status === 'completed' && r.updatedAt >= thisMonthStart).length;
  const approvalsApplied = approvalBatches.filter(b => b.status === 'applied').length;

  // Build highlight cards
  const highlights: { icon: typeof Users; label: string; value: string; delta?: number; color: string }[] = [];

  if (ga4Overview) {
    highlights.push({
      icon: Users, label: 'Visitors', value: ga4Overview.totalUsers.toLocaleString(),
      delta: ga4Comparison?.changePercent.users, color: '#2dd4bf',
    });
  }
  if (overview) {
    highlights.push({
      icon: MousePointerClick, label: 'Search Clicks', value: overview.totalClicks.toLocaleString(),
      delta: searchComparison?.changePercent.clicks, color: '#60a5fa',
    });
    highlights.push({
      icon: Eye, label: 'Impressions', value: overview.totalImpressions.toLocaleString(),
      delta: searchComparison?.changePercent.impressions, color: '#a78bfa',
    });
  }
  if (audit) {
    highlights.push({
      icon: Shield, label: 'Site Health', value: `${audit.siteScore}/100`,
      delta: audit.previousScore != null ? audit.siteScore - audit.previousScore : undefined,
      color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171',
    });
  }

  // Build activity summary items
  const activities: { icon: typeof FileText; label: string; value: string; color: string }[] = [];
  if (contentThisMonth.length > 0) activities.push({ icon: FileText, label: 'Content requests', value: `${contentThisMonth.length} submitted`, color: 'text-teal-400' });
  if (briefsDelivered > 0) activities.push({ icon: CheckCircle2, label: 'Briefs delivered', value: `${briefsDelivered}`, color: 'text-emerald-400' });
  if (requestsCompleted > 0) activities.push({ icon: MessageSquare, label: 'Requests completed', value: `${requestsCompleted}`, color: 'text-blue-400' });
  if (approvalsApplied > 0) activities.push({ icon: CheckCircle2, label: 'SEO batches applied', value: `${approvalsApplied}`, color: 'text-purple-400' });
  if (activityCount > 0) activities.push({ icon: Activity, label: 'Total activities', value: `${activityCount}`, color: 'text-zinc-400' });

  // Don't render if we have nothing to show
  if (highlights.length === 0 && activities.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-teal-950/20 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <Calendar className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-200">What happened this month</div>
            <div className="text-[10px] text-zinc-500">{monthName}</div>
          </div>
        </div>
      </div>

      {/* Metric highlights */}
      {highlights.length > 0 && (
        <div className={`px-5 pb-3 grid gap-2 ${highlights.length <= 2 ? 'grid-cols-2' : highlights.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {highlights.map((h, i) => (
            <div key={i} className="bg-zinc-800/40 rounded-lg px-3 py-2.5 border border-zinc-800/60">
              <div className="flex items-center gap-1.5 mb-1">
                <h.icon className="w-3 h-3" style={{ color: h.color }} />
                <span className="text-[10px] text-zinc-500 font-medium">{h.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-100">{h.value}</span>
                <DeltaBadge value={h.delta} suffix={h.label === 'Site Health' ? ' pts' : '%'} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity summary */}
      {activities.length > 0 && (
        <div className="px-5 pb-4">
          <div className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider mb-2">Activity</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {activities.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <a.icon className={`w-3 h-3 ${a.color}`} />
                <span className="text-[11px] text-zinc-400">{a.label}</span>
                <span className="text-[11px] font-semibold text-zinc-300">{a.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
