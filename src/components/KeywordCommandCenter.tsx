import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Eye,
  FileText,
  Gauge,
  History,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { adminPath } from '../routes';
import {
  Badge,
  Button,
  ClickableRow,
  ConfirmDialog,
  EmptyState,
  FormInput,
  Icon,
  PageHeader,
  SectionCard,
  Stat,
  TableSkeleton,
  cn,
} from './ui';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterActionType,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterStatus,
} from '../../shared/types/keyword-command-center';
import { LOCAL_SEO_VISIBILITY_POSTURE } from '../../shared/types/local-seo';
import { TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking';
import { keywordComparisonKey } from '../../shared/keyword-normalization';
import { useKeywordCommandCenter, useKeywordCommandCenterAction } from '../hooks/admin/useKeywordCommandCenter';
import { useLocalSeoRefresh } from '../hooks/admin/useLocalSeo';
import { LocalSeoVisibilityBadge, LocalSeoVisibilityPanel } from './local-seo/LocalSeoVisibilityPanel';

interface KeywordCommandCenterProps {
  workspaceId: string;
}

const STATUS_TONE: Record<KeywordCommandCenterStatus, 'teal' | 'blue' | 'amber' | 'red' | 'zinc'> = {
  [KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY]: 'teal',
  [KEYWORD_COMMAND_CENTER_STATUS.TRACKED]: 'blue',
  [KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW]: 'amber',
  [KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE]: 'zinc',
  [KEYWORD_COMMAND_CENTER_STATUS.DECLINED]: 'red',
  [KEYWORD_COMMAND_CENTER_STATUS.RETIRED]: 'zinc',
};

const FILTER_ICONS: Record<KeywordCommandCenterFilter, typeof Search> = {
  [KEYWORD_COMMAND_CENTER_FILTERS.ALL]: SlidersHorizontal,
  [KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY]: Target,
  [KEYWORD_COMMAND_CENTER_FILTERS.TRACKED]: TrendingUp,
  [KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW]: Eye,
  [KEYWORD_COMMAND_CENTER_FILTERS.CONTENT]: FileText,
  [KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED]: Gauge,
  [KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE]: Sparkles,
  [KEYWORD_COMMAND_CENTER_FILTERS.LOCAL]: MapPin,
  [KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES]: MapPin,
  [KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY]: CheckCircle2,
  [KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH]: Eye,
  [KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE]: XCircle,
  [KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED]: RefreshCw,
  [KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED]: AlertTriangle,
  [KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED]: ShieldCheck,
  [KEYWORD_COMMAND_CENTER_FILTERS.DECLINED]: XCircle,
  [KEYWORD_COMMAND_CENTER_FILTERS.RETIRED]: Archive,
};

function compactNumber(value: number | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function percent(value: number | undefined): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function localPriorityTone(priority: NonNullable<KeywordCommandCenterRow['localSeoState']>['priority']): 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'zinc' {
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY) return 'teal';
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND) return 'emerald';
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE || priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP) return 'amber';
  return 'zinc';
}

function localLifecycleTone(lifecycle: NonNullable<KeywordCommandCenterRow['localSeoState']>['lifecycle']): 'teal' | 'blue' | 'amber' | 'zinc' {
  if (lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED) return 'teal';
  if (lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED) return 'blue';
  if (lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE || lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.NOT_CHECKED) return 'amber';
  return 'zinc';
}

function LocalSeoStateBadge({ row }: { row: KeywordCommandCenterRow }) {
  if (!row.localSeoState) return <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
  if (row.localSeo) return <LocalSeoVisibilityBadge visibility={row.localSeo} subtle />;
  return (
    <Badge
      label={row.localSeoState.lifecycleLabel}
      tone={localLifecycleTone(row.localSeoState.lifecycle)}
      variant="soft"
      shape="pill"
    />
  );
}

function matchesFilter(row: KeywordCommandCenterRow, filter: KeywordCommandCenterFilter): boolean {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return true;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return row.assignment?.role === 'content_gap';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return row.assignment?.role === 'page_keyword';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return Boolean(row.localSeoState);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    return row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) return Boolean(row.localSeoState && !row.localSeoState.checked);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return row.feedback?.status === 'requested';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) return row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE;
  return row.lifecycleStatus === filter;
}

function actionVariant(action: KeywordCommandCenterNextAction): 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' {
  if (action.tone === 'red') return 'danger';
  if (action.tone === 'teal') return 'primary';
  if (action.tone === 'blue') return 'secondary';
  return 'ghost';
}

function isServerAction(type: KeywordCommandCenterNextAction['type']): type is KeywordCommandCenterActionType {
  return Object.values(KEYWORD_COMMAND_CENTER_ACTIONS).includes(type as KeywordCommandCenterActionType);
}

function requiresProtectedConfirmation(row: KeywordCommandCenterRow, action: KeywordCommandCenterNextAction): boolean {
  return row.isProtected && (
    action.type === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING
    || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE
    || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
  );
}

function SummaryMetric({
  label,
  value,
  icon: MetricIcon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Search;
  tone: 'teal' | 'blue' | 'amber' | 'zinc';
}) {
  const toneClass = {
    teal: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400/80 bg-amber-500/10 border-amber-500/20',
    zinc: 'text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-[var(--brand-border)]',
  }[tone];
  return (
    <SectionCard className="min-w-0" noPadding variant="subtle">
      <div className="p-3 flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-[var(--radius-lg)] border flex items-center justify-center', toneClass)}>
          <Icon as={MetricIcon} size="md" />
        </div>
        <div className="min-w-0">
          <Stat size="sm" className="text-[var(--brand-text-bright)] tabular-nums">{value}</Stat>
          <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{label}</p>
        </div>
      </div>
    </SectionCard>
  );
}

function KeywordRow({
  row,
  active,
  onSelect,
}: {
  row: KeywordCommandCenterRow;
  active: boolean;
  onSelect: () => void;
}) {
  const primarySource = row.sourceLabels[0];
  return (
    <ClickableRow
      active={active}
      onClick={onSelect}
      className={cn(
        'grid grid-cols-[minmax(220px,1.5fr)_120px_150px_100px_100px_minmax(180px,1fr)_130px] gap-3 items-center px-4 py-3 border-b border-[var(--brand-border)] last:border-b-0',
        'hover:bg-teal-500/5',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{row.keyword}</p>
          {row.isProtected && <Badge label="Protected" tone="amber" variant="soft" shape="pill" />}
          <LocalSeoVisibilityBadge visibility={row.localSeo} subtle />
        </div>
        <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">
          {primarySource ? `${primarySource.label}${primarySource.detail ? ` · ${primarySource.detail}` : ''}` : 'Keyword universe'}
        </p>
      </div>
      <Badge label={row.statusLabel} tone={STATUS_TONE[row.lifecycleStatus]} variant="outline" shape="pill" />
      <div className="min-w-0">
        <LocalSeoStateBadge row={row} />
      </div>
      <p className="t-caption text-blue-400 tabular-nums">{compactNumber(row.metrics.volume ?? row.metrics.impressions)}</p>
      <p className="t-caption text-[var(--brand-text)] tabular-nums">
        {row.metrics.currentPosition ? `#${row.metrics.currentPosition.toFixed(1)}` : row.metrics.difficulty != null ? `${row.metrics.difficulty}/100` : '—'}
      </p>
      <p className="t-caption text-[var(--brand-text-muted)] truncate">
        {row.assignment?.pageTitle || row.assignment?.pagePath || row.explanation?.nextAction?.label || 'No assignment yet'}
      </p>
      <div className="flex items-center justify-end gap-1">
        {row.nextActions.slice(0, 2).map(action => (
          <Badge key={action.type} label={action.label} tone={action.tone === 'red' ? 'red' : action.tone === 'amber' ? 'amber' : action.tone === 'blue' ? 'blue' : 'teal'} variant="soft" />
        ))}
      </div>
    </ClickableRow>
  );
}

function KeywordDrawer({
  row,
  workspaceId,
  loadingAction,
  onAction,
}: {
  row: KeywordCommandCenterRow | null;
  workspaceId: string;
  loadingAction?: string;
  onAction: (action: KeywordCommandCenterNextAction) => void;
}) {
  const navigate = useNavigate();
  if (!row) {
    return (
      <SectionCard title="Keyword Detail" variant="subtle">
        <EmptyState
          icon={Search}
          title="Select a keyword"
          description="Pick a row to see evidence, tracking state, feedback, and safe next actions."
        />
      </SectionCard>
    );
  }

  const trackingLabel = row.tracking.status === 'not_tracked'
    ? 'Not tracked'
    : row.tracking.status.replace(/_/g, ' ');

  return (
    <SectionCard
      title={row.keyword}
      titleExtra={<Badge label={row.statusLabel} tone={STATUS_TONE[row.lifecycleStatus]} variant="outline" shape="pill" />}
      variant="subtle"
      className="sticky top-4"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">Volume</p>
            <p className="t-caption font-semibold text-blue-400 tabular-nums">{compactNumber(row.metrics.volume)}</p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">Rank</p>
            <p className="t-caption font-semibold text-[var(--brand-text-bright)] tabular-nums">
              {row.metrics.currentPosition ? `#${row.metrics.currentPosition.toFixed(1)}` : '—'}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">CTR</p>
            <p className="t-caption font-semibold text-blue-400 tabular-nums">{percent(row.metrics.ctr)}</p>
          </div>
        </div>

        <div>
          <p className="t-label text-[var(--brand-text-muted)] mb-2">Where It Came From</p>
          <div className="flex flex-wrap gap-1.5">
            {row.sourceLabels.map(source => (
              <Badge
                key={`${source.kind}-${source.label}-${source.detail ?? ''}`}
                label={source.detail ? `${source.label}: ${source.detail}` : source.label}
                tone={source.kind === 'raw_evidence' ? 'zinc' : source.kind === 'rank_data' || source.kind === 'local_visibility' ? 'blue' : source.kind === 'local_candidate' ? 'amber' : 'teal'}
                variant="outline"
              />
            ))}
          </div>
        </div>

        {row.explanation && (
          <div>
            <p className="t-label text-[var(--brand-text-muted)] mb-2">Why It Matters</p>
            <div className="space-y-2">
              {row.explanation.reasons.map(reason => (
                <div key={reason} className="flex gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)] px-3 py-2">
                  <Icon as={CheckCircle2} size="sm" className="text-teal-400 mt-0.5 flex-shrink-0" />
                  <p className="t-caption-sm text-[var(--brand-text)]">{reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="t-label text-[var(--brand-text-muted)] mb-2">Tracking State</p>
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="t-caption font-medium text-[var(--brand-text-bright)] capitalize">{trackingLabel}</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  {row.tracking.source ? row.tracking.source.replace(/_/g, ' ') : 'No source yet'}
                </p>
              </div>
              {row.tracking.status !== 'not_tracked' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={History}
                  onClick={() => navigate(adminPath(workspaceId, 'seo-ranks'))}
                >
                  Rank Tracker
                </Button>
              )}
            </div>
            {row.protectionReason && (
              <p className="t-caption-sm text-amber-400/80 mt-2">{row.protectionReason} is protected from accidental retirement.</p>
            )}
          </div>
        </div>

        {row.feedback?.status && (
          <div>
            <p className="t-label text-[var(--brand-text-muted)] mb-2">Feedback</p>
            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
              <Badge label={row.feedback.status} tone={row.feedback.status === 'declined' ? 'red' : row.feedback.status === 'requested' ? 'amber' : 'emerald'} variant="outline" />
              {row.feedback.reason && <p className="t-caption-sm text-[var(--brand-text)] mt-2">{row.feedback.reason}</p>}
            </div>
          </div>
        )}

        {row.localSeoState && (
          <div>
            <p className="t-label text-[var(--brand-text-muted)] mb-2">Local Visibility</p>
            <div className="rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/8 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="t-caption font-medium text-[var(--brand-text-bright)]">
                    {row.localSeoState.marketLabel ?? row.localSeoState.lifecycleLabel}
                  </p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">{row.localSeoState.detail}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge label={row.localSeoState.priorityLabel} tone={localPriorityTone(row.localSeoState.priority)} variant="outline" shape="pill" />
                  {row.localSeo ? (
                    <LocalSeoVisibilityBadge visibility={row.localSeo} />
                  ) : (
                    <Badge label={row.localSeoState.lifecycleLabel} tone={localLifecycleTone(row.localSeoState.lifecycle)} variant="soft" shape="pill" />
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {row.localSeoState.sourceLabels.map(source => (
                  <Badge key={source} label={source} tone="blue" variant="soft" />
                ))}
                {row.localSeoState.localPackPresent != null && (
                  <Badge
                    label={row.localSeoState.localPackPresent ? 'Local pack present' : 'No local pack'}
                    tone={row.localSeoState.localPackPresent ? 'blue' : 'zinc'}
                    variant="outline"
                  />
                )}
                {row.localSeoState.businessMatchConfidence && (
                  <Badge label={row.localSeoState.businessMatchConfidence.replace(/_/g, ' ')} tone="amber" variant="outline" />
                )}
              </div>
              {row.localSeo?.topCompetitors && row.localSeo.topCompetitors.length > 0 && (
                <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 p-3">
                  <p className="t-caption-sm font-semibold text-[var(--brand-text-bright)] mb-2">Top local result evidence</p>
                  <div className="space-y-1.5">
                    {row.localSeo.topCompetitors.slice(0, 3).map(result => (
                      <div key={`${result.rank ?? 'rank'}-${result.title}`} className="flex items-center justify-between gap-3">
                        <p className="t-caption-sm text-[var(--brand-text)] truncate">
                          {result.rank ? `#${result.rank} ` : ''}{result.title}
                        </p>
                        {result.domain && <span className="t-caption-sm text-blue-400 truncate">{result.domain}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
                Local SEO is market-specific local-pack visibility. Rank Tracker remains Search Console measurement.
              </p>
            </div>
          </div>
        )}

        <div>
          <p className="t-label text-[var(--brand-text-muted)] mb-2">Safe Next Actions</p>
          <div className="flex flex-wrap gap-2">
            {row.nextActions.map(action => (
              <Button
                key={`${action.type}-${action.label}`}
                size="sm"
                variant={actionVariant(action)}
                disabled={action.disabled}
                loading={loadingAction === action.type}
                title={action.disabledReason || action.detail}
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3">
            These actions change keyword lifecycle state or navigate to a planning surface. They do not publish content or write live metadata.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

export function KeywordCommandCenter({ workspaceId }: KeywordCommandCenterProps) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useKeywordCommandCenter(workspaceId);
  const actionMutation = useKeywordCommandCenterAction(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const [filter, setFilter] = useState<KeywordCommandCenterFilter>(KEYWORD_COMMAND_CENTER_FILTERS.ALL);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    row: KeywordCommandCenterRow;
    action: KeywordCommandCenterNextAction;
  } | null>(null);

  const rows = data?.rows ?? [];
  const filteredRows = useMemo(() => {
    const query = keywordComparisonKey(searchTerm);
    return rows.filter(row => {
      const matchesSearch = !query
        || row.normalizedKeyword.includes(query)
        || row.assignment?.pagePath?.toLowerCase().includes(query)
        || row.assignment?.pageTitle?.toLowerCase().includes(query);
      return matchesSearch && matchesFilter(row, filter);
    });
  }, [filter, rows, searchTerm]);
  const actionErrorMessage = actionMutation.error instanceof Error
    ? actionMutation.error.message
    : actionMutation.error
      ? 'Keyword action failed. Try again or refresh the page.'
      : localRefresh.error instanceof Error
        ? localRefresh.error.message
        : localRefresh.error
          ? 'Local visibility refresh could not start. Try again or refresh the page.'
          : null;

  const selectedRow = useMemo(() => {
    if (selectedKey) {
      const selected = rows.find(row => row.normalizedKeyword === selectedKey);
      if (selected) return selected;
    }
    return filteredRows[0] ?? null;
  }, [filteredRows, rows, selectedKey]);

  const runServerAction = (row: KeywordCommandCenterRow, action: KeywordCommandCenterNextAction, force = false) => {
    if (!isServerAction(action.type)) return;
    actionMutation.mutate({
      action: action.type,
      keyword: row.keyword,
      pagePath: action.pagePath,
      force: force || undefined,
    });
  };

  const handleAction = (row: KeywordCommandCenterRow | null, action: KeywordCommandCenterNextAction) => {
    if (!row) return;
    if (action.type === 'view_rankings') {
      navigate(adminPath(workspaceId, 'seo-ranks'));
      return;
    }
    if (action.type === 'review_page') {
      navigate(adminPath(workspaceId, 'page-intelligence'), {
        state: {
          fixContext: {
            targetRoute: 'page-intelligence',
            pageSlug: action.pagePath,
            pageName: row.assignment?.pageTitle,
            primaryKeyword: row.keyword,
          },
        },
      });
      return;
    }
    if (action.type === 'generate_brief') {
      navigate(adminPath(workspaceId, 'content-pipeline'), {
        state: {
          fixContext: {
            targetRoute: 'content-pipeline',
            primaryKeyword: row.keyword,
            pageType: row.assignment?.role === 'content_gap' ? 'blog' : undefined,
          },
        },
      });
      return;
    }
    if (action.type === 'check_local_visibility') {
      localRefresh.mutate({ keywords: [row.keyword] });
      return;
    }
    if (!isServerAction(action.type)) return;
    if (requiresProtectedConfirmation(row, action)) {
      setPendingProtectedAction({ row, action });
      return;
    }
    runServerAction(row, action);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Keywords" subtitle="Building the keyword operating layer..." />
        <SectionCard>
          <TableSkeleton rows={8} columns={6} />
        </SectionCard>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={Search}
        title="Keyword Command Center could not load"
        description={error instanceof Error ? error.message : 'Try refreshing the page. Your keyword data was not changed.'}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Keywords"
        subtitle="The operating layer for strategy terms, evidence, tracking, feedback, retired keywords, and safe handoffs."
        actions={
          <Button variant="secondary" size="sm" icon={ArrowUpRight} onClick={() => navigate(adminPath(workspaceId, 'seo-strategy'))}>
            Open Strategy
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryMetric label="In Strategy" value={data?.counts.inStrategy ?? 0} icon={Target} tone="teal" />
        <SummaryMetric label="Tracked" value={data?.counts.tracked ?? 0} icon={TrendingUp} tone="blue" />
        <SummaryMetric label="Local" value={data?.counts.local ?? 0} icon={MapPin} tone="blue" />
        <SummaryMetric label="Needs Review" value={data?.counts.needsReview ?? 0} icon={Eye} tone="amber" />
        <SummaryMetric label="Retired" value={data?.counts.retired ?? 0} icon={Archive} tone="zinc" />
      </div>

      <LocalSeoVisibilityPanel
        workspaceId={workspaceId}
        onOpenKeywords={() => {
          setFilter(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL);
          document.getElementById('keyword-universe')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      {actionErrorMessage && (
        <div
          role="alert"
          className="rounded-[var(--radius-xl)] border border-red-500/25 bg-red-500/8 px-4 py-3 text-red-400 t-caption"
        >
          {actionErrorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-4 items-start">
        <SectionCard
          id="keyword-universe"
          title="Keyword Universe"
          titleExtra={<Badge label={`${filteredRows.length} visible`} tone="blue" variant="soft" shape="pill" />}
          action={
            <div className="w-[260px]">
              <FormInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search keywords, pages..."
                aria-label="Search keywords"
              />
            </div>
          }
          noPadding
          variant="subtle"
        >
          <div className="px-3 py-3 border-b border-[var(--brand-border)] flex flex-wrap gap-2">
            {(data?.filters ?? []).map(item => {
              const IconComponent = FILTER_ICONS[item.id];
              return (
                <Button
                  key={item.id}
                  variant={filter === item.id ? 'primary' : 'ghost'}
                  size="sm"
                  icon={IconComponent}
                  onClick={() => setFilter(item.id)}
                  className={filter === item.id ? '' : 'text-[var(--brand-text-muted)]'}
                >
                  {item.label}
                  <span className="tabular-nums opacity-75">{item.count}</span>
                </Button>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1020px]">
              <div className="hidden md:grid grid-cols-[minmax(220px,1.5fr)_120px_150px_100px_100px_minmax(180px,1fr)_130px] gap-3 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/30">
                <p className="t-label text-[var(--brand-text-muted)]">Keyword</p>
                <p className="t-label text-[var(--brand-text-muted)]">Status</p>
                <p className="t-label text-[var(--brand-text-muted)]">Local</p>
                <p className="t-label text-[var(--brand-text-muted)]">Demand</p>
                <p className="t-label text-[var(--brand-text-muted)]">Rank/KD</p>
                <p className="t-label text-[var(--brand-text-muted)]">Assignment</p>
                <p className="t-label text-[var(--brand-text-muted)] text-right">Next</p>
              </div>

              {filteredRows.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No keywords match this view"
                  description="Try a different filter or search term. Raw provider evidence is capped so the operating list stays useful."
                />
              ) : (
                <div className="max-h-[680px] overflow-y-auto">
                  {filteredRows.map(row => (
                    <KeywordRow
                      key={row.normalizedKeyword}
                      row={row}
                      active={selectedRow?.normalizedKeyword === row.normalizedKeyword}
                      onSelect={() => setSelectedKey(row.normalizedKeyword)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {data && data.rawEvidenceTotal > data.rawEvidenceReturned && (
            <div className="px-4 py-3 border-t border-[var(--brand-border)] bg-[var(--surface-3)]/20">
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Showing {data.rawEvidenceReturned} of {data.rawEvidenceTotal} raw-evidence-only terms. Selected strategy, feedback, and tracked terms are never capped.
              </p>
            </div>
          )}
        </SectionCard>

        <KeywordDrawer
          row={selectedRow}
          workspaceId={workspaceId}
          loadingAction={localRefresh.isPending ? 'check_local_visibility' : actionMutation.isPending ? actionMutation.variables?.action : undefined}
          onAction={(action) => handleAction(selectedRow, action)}
        />
      </div>

      <ConfirmDialog
        open={!!pendingProtectedAction}
        title="Confirm protected keyword action"
        message={
          pendingProtectedAction
            ? `${pendingProtectedAction.row.protectionReason ?? 'This keyword'} is protected. Confirm "${pendingProtectedAction.action.label}" for "${pendingProtectedAction.row.keyword}"? Rank history will be preserved.`
            : ''
        }
        confirmLabel={pendingProtectedAction?.action.label ?? 'Confirm'}
        variant={pendingProtectedAction?.action.tone === 'red' ? 'destructive' : 'default'}
        onConfirm={() => {
          if (pendingProtectedAction) runServerAction(pendingProtectedAction.row, pendingProtectedAction.action, true);
          setPendingProtectedAction(null);
        }}
        onCancel={() => setPendingProtectedAction(null)}
      />
    </div>
  );
}
