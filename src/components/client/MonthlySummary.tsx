import {
  FileText, CheckCircle2, MessageSquare, Activity, Calendar,
} from 'lucide-react';
import type {
  ClientContentRequest, ClientRequest, ApprovalBatch,
} from './types';
import { useBetaMode } from './BetaContext';

interface MonthlySummaryProps {
  contentRequests: ClientContentRequest[];
  requests: ClientRequest[];
  approvalBatches: ApprovalBatch[];
  activityCount: number;
}

export function MonthlySummary({
  contentRequests, requests, approvalBatches, activityCount,
}: MonthlySummaryProps) {
  const betaMode = useBetaMode();
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Content metrics this month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const contentThisMonth = contentRequests.filter(r => r.requestedAt >= thisMonthStart);
  const briefsDelivered = contentThisMonth.filter(r => ['client_review', 'approved', 'in_progress', 'delivered'].includes(r.status)).length;
  const requestsCompleted = requests.filter(r => r.status === 'completed' && r.updatedAt >= thisMonthStart).length;
  const approvalsApplied = approvalBatches.filter(b => b.status === 'applied').length;

  // Build activity summary items
  const activities: { icon: typeof FileText; label: string; value: string; color: string }[] = [];
  if (!betaMode && contentThisMonth.length > 0) activities.push({ icon: FileText, label: 'Content requests', value: `${contentThisMonth.length} submitted`, color: 'text-teal-400' });
  if (!betaMode && briefsDelivered > 0) activities.push({ icon: CheckCircle2, label: 'Briefs delivered', value: `${briefsDelivered}`, color: 'text-emerald-400' });
  if (requestsCompleted > 0) activities.push({ icon: MessageSquare, label: 'Requests completed', value: `${requestsCompleted}`, color: 'text-blue-400' });
  if (approvalsApplied > 0) activities.push({ icon: CheckCircle2, label: 'SEO batches applied', value: `${approvalsApplied}`, color: 'text-purple-400' });
  if (activityCount > 0) activities.push({ icon: Activity, label: 'Total activities', value: `${activityCount}`, color: 'text-zinc-400' });

  // Don't render if we have nothing to show
  if (activities.length === 0) return null;

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
