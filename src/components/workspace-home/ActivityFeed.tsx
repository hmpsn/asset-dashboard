import {
  Activity, Globe, FileText, ClipboardCheck, MessageSquare,
  Pencil, Code2, CornerDownRight, Target, TrendingUp, TrendingDown, AlertTriangle,
} from 'lucide-react';
import { SectionCard, EmptyState } from '../ui';

interface ActivityEntry {
  id: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

const ICON_MAP: Record<string, typeof Activity> = {
  audit_completed: Globe,
  content_requested: FileText,
  brief_generated: ClipboardCheck,
  request_resolved: MessageSquare,
  approval_applied: ClipboardCheck,
  seo_updated: Pencil,
  schema_generated: Code2,
  schema_published: Code2,
  redirects_scanned: CornerDownRight,
  strategy_generated: Target,
  rank_snapshot: TrendingUp,
  anomaly_detected: AlertTriangle,
  anomaly_positive: TrendingDown,
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface ActivityFeedProps {
  activity: ActivityEntry[];
  className?: string;
}

export function ActivityFeed({ activity, className }: ActivityFeedProps) {
  return (
    <SectionCard
      title="Recent Activity"
      titleIcon={<Activity className="w-4 h-4 text-zinc-500" />}
      className={className}
      noPadding
    >
      {activity.length > 0 ? (
        <div className="divide-y divide-zinc-800/50">
          {activity.map(entry => {
            const Icon = ICON_MAP[entry.type] || Activity;
            return (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-teal-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-200">{entry.title}</div>
                  {entry.description && <div className="text-[11px] text-zinc-500 mt-0.5">{entry.description}</div>}
                </div>
                <span className="text-[11px] text-zinc-500 flex-shrink-0">{timeAgo(entry.createdAt)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Activity} title="No activity recorded yet" className="py-8" />
      )}
    </SectionCard>
  );
}
