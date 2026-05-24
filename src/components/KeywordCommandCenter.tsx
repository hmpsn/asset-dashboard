import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterDetail,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
} from '../hooks/admin/useKeywordCommandCenter';
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
  [KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY]: AlertTriangle,
};

function filterCountLabel(filterId: KeywordCommandCenterFilter, count: number): string {
  if (filterId === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES && count === 0) return '...';
  return compactNumber(count);
}

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

type VariantRow = NonNullable<KeywordCommandCenterRow['variants']>[number];

function VariantSubRow({ variant }: { variant: VariantRow }) {
  return (
    <div className="grid grid-cols-[minmax(220px,1.5fr)_120px_150px_100px_100px_minmax(180px,1fr)_130px] gap-3 items-center px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/15">
      <div className="min-w-0 pl-6 flex items-center gap-2">
        <ChevronRight className="h-3 w-3 text-[var(--brand-text-muted)] flex-shrink-0" aria-hidden="true" />
        <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{variant.query}</p>
      </div>
      <span className="t-caption-sm text-[var(--brand-text-muted)]">Variant</span>
      <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>
      <span className="t-caption-sm text-blue-400 tabular-nums">{compactNumber(variant.impressions)}</span>
      <span className="t-caption-sm text-[var(--brand-text)] tabular-nums">#{variant.position.toFixed(1)}</span>
      <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">Search Console variant</span>
      <span className="t-caption-sm text-blue-400 tabular-nums text-right">{compactNumber(variant.clicks)} clicks</span>
    </div>
  );
}

function KeywordRow({
  row,
  active,
  onSelect,
  variantsExpanded,
  onToggleVariants,
}: {
  row: KeywordCommandCenterRow;
  active: boolean;
  onSelect: () => void;
  variantsExpanded: boolean;
  onToggleVariants: () => void;
}) {
  const primarySource = row.sourceLabels[0];
  return (
    <div>
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
            {row.isLostVisibility && (
              <Badge
                label="Lost Visibility"
                tone="amber"
                variant="outline"
                shape="pill"
                ariaLabel="Lost visibility: this query has not appeared in GSC snapshots for 14 or more days."
              />
            )}
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
        <p className={cn(
          't-caption truncate',
          // Highlight unassigned in-strategy rows in amber so admins notice keywords that
          // are in the strategy but aren't yet mapped to a page. Audit on Swish found 3
          // such rows out of 227 in_strategy — small but worth surfacing.
          row.lifecycleStatus === 'in_strategy' && !row.assignment?.pageTitle && !row.assignment?.pagePath
            ? 'text-amber-400/90'
            : 'text-[var(--brand-text-muted)]',
        )}>
          {row.assignment?.pageTitle || row.assignment?.pagePath || row.explanation?.nextAction?.label || 'Not yet mapped to a page'}
        </p>
        <div className="flex items-center justify-end gap-1">
          {(row.variantCount ?? 0) > 0 && <Badge label={`${row.variantCount} variants`} tone="blue" variant="soft" />}
          {row.nextActions.slice(0, 2).map(action => (
            <Badge key={action.type} label={action.label} tone={action.tone === 'red' ? 'red' : action.tone === 'amber' ? 'amber' : action.tone === 'blue' ? 'blue' : 'teal'} variant="soft" />
          ))}
        </div>
      </ClickableRow>
      {(row.variantCount ?? 0) > 0 && (
        <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/10 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            icon={variantsExpanded ? ChevronDown : ChevronRight}
            onClick={onToggleVariants}
            className="text-[var(--brand-text-muted)] hover:bg-teal-500/10 hover:text-teal-300"
            aria-label={`${variantsExpanded ? 'Collapse' : 'Expand'} ${row.variantCount} variants for ${row.keyword}`}
            title={`${variantsExpanded ? 'Collapse' : 'Expand'} GSC variants`}
          >
            {variantsExpanded ? 'Hide variants' : 'Show variants'}
          </Button>
        </div>
      )}
      {variantsExpanded && (row.variants ?? []).map(variant => (
        <VariantSubRow key={variant.query} variant={variant} />
      ))}
    </div>
  );
}

function KeywordDrawer({
  row,
  workspaceId,
  isLoading,
  loadingAction,
  onAction,
}: {
  row: KeywordCommandCenterRow | null;
  workspaceId: string;
  isLoading?: boolean;
  loadingAction?: string;
  onAction: (action: KeywordCommandCenterNextAction) => void;
}) {
  const navigate = useNavigate();
  if (isLoading) {
    return (
      <SectionCard title="Keyword Detail" variant="subtle" className="sticky top-4">
        <TableSkeleton rows={5} columns={1} />
      </SectionCard>
    );
  }
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

  const isAwaitingSignal = row.tracking.status === 'active' && row.tracking.hasSignal === false;
  const trackingLabel = row.tracking.status === 'not_tracked'
    ? 'Not tracked'
    : isAwaitingSignal
      ? 'Active · Awaiting data'
      : row.tracking.status.replace(/_/g, ' ');

  // Source rendering: PR E's read-time inference upgrades legacy UNKNOWN sources
  // where it can, but residual UNKNOWN values still reach the UI for keywords that
  // don't match any inference hint. Show a friendly label rather than the literal
  // "unknown" enum value.
  const trackingSourceLabel = row.tracking.source && row.tracking.source !== 'unknown'
    ? row.tracking.source.replace(/_/g, ' ')
    : row.tracking.status === 'not_tracked'
      ? null
      : 'Source not recorded';

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

        {row.lifecycleStatus === 'in_strategy' && !row.assignment?.pageTitle && !row.assignment?.pagePath && (
          <div className="rounded-[var(--radius-lg)] border border-amber-400/30 bg-amber-400/5 px-3 py-2">
            <p className="t-caption-sm text-amber-400/90">
              <span className="font-semibold">Not yet mapped to a page.</span> This keyword is in your
              strategy but isn’t assigned to a page. Add it to a page in Page Intelligence so it can be
              tracked, optimized, and reported on.
            </p>
          </div>
        )}

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
                {trackingSourceLabel && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">{trackingSourceLabel}</p>
                )}
                {isAwaitingSignal && (
                  <p className="t-caption-sm text-amber-400/80 mt-1">
                    No GSC clicks, impressions, or rank position recorded yet for this keyword.
                  </p>
                )}
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
  const actionMutation = useKeywordCommandCenterAction(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const [filter, setFilter] = useState<KeywordCommandCenterFilter>(KEYWORD_COMMAND_CENTER_FILTERS.ALL);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    row: KeywordCommandCenterRow;
    action: KeywordCommandCenterNextAction;
  } | null>(null);
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
    setSelectedKey(null);
  }, [debouncedSearchTerm, filter]);

  const rowsQuery = useMemo(() => ({
    filter,
    search: debouncedSearchTerm.trim() || undefined,
    page,
    pageSize: 50,
  }), [debouncedSearchTerm, filter, page]);

  const summary = useKeywordCommandCenterSummary(workspaceId);
  const rowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery);
  const detail = useKeywordCommandCenterDetail(workspaceId, selectedKey);
  const rows = rowsResult.data?.rows ?? [];
  const actionErrorMessage = actionMutation.error instanceof Error
    ? actionMutation.error.message
    : actionMutation.error
      ? 'Keyword action failed. Try again or refresh the page.'
      : localRefresh.error instanceof Error
        ? localRefresh.error.message
        : localRefresh.error
          ? 'Local visibility refresh could not start. Try again or refresh the page.'
          : null;

  const selectedPreviewRow = useMemo(() => {
    if (!selectedKey) return null;
    return rows.find(row => row.normalizedKeyword === selectedKey) ?? null;
  }, [rows, selectedKey]);
  const selectedRow = detail.data?.row ?? selectedPreviewRow;

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

  if (summary.isLoading || (!summary.data && rowsResult.isLoading)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Keywords" subtitle="Building the keyword operating layer..." />
        <SectionCard>
          <TableSkeleton rows={8} columns={6} />
        </SectionCard>
      </div>
    );
  }

  const loadError = summary.error ?? rowsResult.error;
  if (loadError) {
    return (
      <EmptyState
        icon={Search}
        title="Keyword Command Center could not load"
        description={loadError instanceof Error ? loadError.message : 'Try refreshing the page. Your keyword data was not changed.'}
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
        <SummaryMetric label="In Strategy" value={summary.data?.counts.inStrategy ?? 0} icon={Target} tone="teal" />
        <SummaryMetric label="Tracked" value={summary.data?.counts.tracked ?? 0} icon={TrendingUp} tone="blue" />
        <SummaryMetric label="Local" value={summary.data?.counts.local ?? 0} icon={MapPin} tone="blue" />
        <SummaryMetric label="Needs Review" value={summary.data?.counts.needsReview ?? 0} icon={Eye} tone="amber" />
        <SummaryMetric label="Retired" value={summary.data?.counts.retired ?? 0} icon={Archive} tone="zinc" />
      </div>

      <LocalSeoVisibilityPanel
          workspaceId={workspaceId}
          onOpenKeywords={() => {
            setFilter(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL);
            setPage(1);
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
          titleExtra={
            <div className="flex items-center gap-2">
              <Badge label={`${rowsResult.data?.pageInfo.totalRows ?? rows.length} visible`} tone="blue" variant="soft" shape="pill" />
              {/* Volume-null diagnostic: surface when missingVolume is non-trivial (>5% of universe) so admins can decide whether to refresh providers */}
              {summary.data?.counts.missingVolume != null
                && summary.data.counts.missingVolume > 0
                && summary.data.counts.total > 0
                && summary.data.counts.missingVolume / summary.data.counts.total > 0.05 && (
                <Badge
                  label={`${summary.data.counts.missingVolume} missing demand`}
                  tone="amber"
                  variant="soft"
                  shape="pill"
                />
              )}
              {summary.data?.counts.lostVisibility != null && summary.data.counts.lostVisibility > 0 && (
                <Badge
                  label={`${summary.data.counts.lostVisibility} lost visibility`}
                  tone="amber"
                  variant="outline"
                  shape="pill"
                />
              )}
            </div>
          }
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
            {(summary.data?.filters ?? []).map(item => {
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
                  <span className="tabular-nums opacity-75">{filterCountLabel(item.id, item.count)}</span>
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
                <p className="t-label text-[var(--brand-text-muted)]">
                  <span>Demand</span>
                  {summary.data?.geoLabel && (
                    <span className="ml-1 normal-case t-caption-sm text-[var(--brand-text-muted)]">
                      · {summary.data.geoLabel}
                    </span>
                  )}
                </p>
                <p className="t-label text-[var(--brand-text-muted)]">Rank/KD</p>
                <p className="t-label text-[var(--brand-text-muted)]">Assignment</p>
                <p className="t-label text-[var(--brand-text-muted)] text-right">Next</p>
              </div>

              {rowsResult.isFetching ? (
                <TableSkeleton rows={8} columns={6} />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No keywords match this view"
                  description="Try a different filter or search term. Raw provider evidence is capped so the operating list stays useful."
                />
              ) : (
                <div className="max-h-[680px] overflow-y-auto">
                  {rows.map(row => (
                    <KeywordRow
                      key={row.normalizedKeyword}
                      row={row}
                      active={selectedRow?.normalizedKeyword === row.normalizedKeyword}
                      onSelect={() => setSelectedKey(row.normalizedKeyword)}
                      variantsExpanded={expandedVariants.has(row.normalizedKeyword)}
                      onToggleVariants={() => {
                        setExpandedVariants(previous => {
                          const next = new Set(previous);
                          if (next.has(row.normalizedKeyword)) {
                            next.delete(row.normalizedKeyword);
                          } else {
                            next.add(row.normalizedKeyword);
                          }
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {summary.data && summary.data.rawEvidenceTotal > summary.data.rawEvidenceReturned && (
            <div className="px-4 py-3 border-t border-[var(--brand-border)] bg-[var(--surface-3)]/20">
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Showing {summary.data.rawEvidenceReturned} of {summary.data.rawEvidenceTotal} raw-evidence-only terms. Selected strategy, feedback, and tracked terms are never capped.
              </p>
            </div>
          )}

          {rowsResult.data && rowsResult.data.pageInfo.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-[var(--brand-border)] bg-[var(--surface-3)]/20 flex items-center justify-between gap-3">
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Page {rowsResult.data.pageInfo.page} of {rowsResult.data.pageInfo.totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rowsResult.data.pageInfo.hasPreviousPage || rowsResult.isFetching}
                  onClick={() => setPage(current => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!rowsResult.data.pageInfo.hasNextPage || rowsResult.isFetching}
                  onClick={() => setPage(current => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </SectionCard>

        <KeywordDrawer
          row={selectedRow}
          workspaceId={workspaceId}
          isLoading={detail.isFetching && !!selectedKey && !detail.data}
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
