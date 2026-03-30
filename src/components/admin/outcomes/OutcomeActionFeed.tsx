import { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, ExternalLink, Filter } from 'lucide-react';
import { SectionCard, Badge, EmptyState, Skeleton } from '../../ui';
import { useOutcomeActions } from '../../../hooks/admin/useOutcomes';
import type { ActionType, TrackedAction } from '../../../../shared/types/outcome-tracking';
import { ACTION_TYPE_LABELS, formatOutcomeDate } from './outcomeConstants';

interface Props {
  workspaceId: string;
}

const ACTION_TYPE_OPTIONS: Array<{ value: ActionType | ''; label: string }> = [
  { value: '', label: 'All Types' },
  { value: 'insight_acted_on', label: 'Insight' },
  { value: 'content_published', label: 'Content Published' },
  { value: 'brief_created', label: 'Brief Created' },
  { value: 'strategy_keyword_added', label: 'Strategy Update' },
  { value: 'schema_deployed', label: 'Schema Deployed' },
  { value: 'audit_fix_applied', label: 'Audit Fix' },
  { value: 'content_refreshed', label: 'Content Refresh' },
  { value: 'internal_link_added', label: 'Internal Link' },
  { value: 'meta_updated', label: 'Meta Update' },
  { value: 'voice_calibrated', label: 'Voice Calibration' },
];

const SCORE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Scores' },
  { value: 'strong_win', label: 'Strong Win' },
  { value: 'win', label: 'Win' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'loss', label: 'Loss' },
  { value: 'insufficient_data', label: 'Insufficient Data' },
  { value: 'inconclusive', label: 'Inconclusive' },
];

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 32 ? u.pathname.slice(0, 32) + '…' : u.pathname;
    return u.hostname + path;
  } catch {
    return url.length > 48 ? url.slice(0, 48) + '…' : url;
  }
}

interface ActionRowProps {
  action: TrackedAction;
}

function ActionRow({ action }: ActionRowProps) {
  const [expanded, setExpanded] = useState(false);

  const baseline = action.baselineSnapshot;
  const history = action.trailingHistory;
  const lastPoint = history.dataPoints.length > 0
    ? history.dataPoints[history.dataPoints.length - 1]
    : null;

  // Match baseline field to the metric actually tracked in trailingHistory
  const baselineForMetric = history.metric === 'position' ? baseline.position
    : history.metric === 'clicks' ? baseline.clicks
    : history.metric === 'impressions' ? baseline.impressions
    : history.metric === 'ctr' ? baseline.ctr
    : history.metric === 'sessions' ? baseline.sessions
    : undefined;
  const delta = lastPoint != null && baselineForMetric != null
    ? lastPoint.value - baselineForMetric
    : null;
  const hasDelta = delta !== null && !Number.isNaN(delta);

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Type badge */}
        <Badge
          label={ACTION_TYPE_LABELS[action.actionType] ?? action.actionType}
          color="blue"
        />

        {/* Page + keyword */}
        <div className="flex-1 min-w-0">
          {action.pageUrl && (
            <p className="text-xs text-zinc-300 font-medium truncate">
              {truncateUrl(action.pageUrl)}
            </p>
          )}
          {action.targetKeyword && (
            <p className="text-[11px] text-zinc-500 truncate">{action.targetKeyword}</p>
          )}
        </div>

        {/* Date */}
        <span className="text-[11px] text-zinc-500 shrink-0">{formatOutcomeDate(action.createdAt)}</span>

        {/* Delta */}
        {hasDelta && (
          <span className={`text-xs font-medium shrink-0 ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        )}

        {/* Score badge */}
        <div className="shrink-0">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3 bg-zinc-900/50">
          {/* Detail grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Attribution</p>
              <p className="text-xs text-zinc-300">{action.attribution.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Window</p>
              <p className="text-xs text-zinc-300">{action.measurementWindow}d</p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Status</p>
              <p className="text-xs text-zinc-300">{action.measurementComplete ? 'Complete' : 'In progress'}</p>
            </div>
          </div>

          {/* Baseline snapshot */}
          {(baseline.position !== undefined || baseline.clicks !== undefined) && (
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Baseline Snapshot</p>
              <div className="flex flex-wrap gap-3">
                {baseline.position !== undefined && (
                  <span className="text-xs text-zinc-400">Pos: <span className="text-blue-400 font-medium">{baseline.position.toFixed(1)}</span></span>
                )}
                {baseline.clicks !== undefined && (
                  <span className="text-xs text-zinc-400">Clicks: <span className="text-blue-400 font-medium">{baseline.clicks}</span></span>
                )}
                {baseline.impressions !== undefined && (
                  <span className="text-xs text-zinc-400">Impressions: <span className="text-blue-400 font-medium">{baseline.impressions}</span></span>
                )}
                {baseline.ctr !== undefined && (
                  <span className="text-xs text-zinc-400">CTR: <span className="text-blue-400 font-medium">{baseline.ctr}%</span></span>
                )}
              </div>
            </div>
          )}

          {/* Page link */}
          {action.pageUrl && (
            <a
              href={action.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View page
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function OutcomeActionFeed({ workspaceId }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [scoreFilter, setScoreFilter] = useState<string>('');

  const { data: actions, isLoading } = useOutcomeActions(
    workspaceId,
    typeFilter || undefined,
    scoreFilter || undefined,
  );

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-600 transition-colors"
          aria-label="Filter by action type"
        >
          {ACTION_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-600 transition-colors"
          aria-label="Filter by score"
        >
          {SCORE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(typeFilter || scoreFilter) && (
          <button
            onClick={() => { setTypeFilter(''); setScoreFilter(''); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !actions || actions.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No actions tracked yet"
          description="Actions are logged automatically when you act on insights, publish content, or apply SEO fixes. Check back after applying your next insight or SEO fix."
        />
      ) : (
        <SectionCard
          title={`${actions.length} action${actions.length !== 1 ? 's' : ''}`}
          titleIcon={<Activity className="w-4 h-4 text-blue-400" />}
          noPadding
        >
          <div className="p-4 space-y-2">
            {actions.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

