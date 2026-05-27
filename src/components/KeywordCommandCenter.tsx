import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowUpRight,
  Eye,
  MapPin,
  Search,
  Target,
  TrendingUp,
} from 'lucide-react';

import { adminPath } from '../routes';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  FormInput,
  PageHeader,
  SectionCard,
  TableSkeleton,
} from './ui';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterFeedbackState,
  type KeywordCommandCenterBulkActionResult,
  type KeywordCommandCenterBulkActionType,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRow,
} from '../../shared/types/keyword-command-center';
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterBulkAction,
  useKeywordCommandCenterDetail,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
} from '../hooks/admin/useKeywordCommandCenter';
import { useLocalSeoRefresh } from '../hooks/admin/useLocalSeo';
import { LocalSeoVisibilityPanel } from './local-seo/LocalSeoVisibilityPanel';
import { KeywordBulkActionBar } from './keyword-command-center/KeywordBulkActionBar';
import { KeywordBulkConfirmDialog } from './keyword-command-center/KeywordBulkConfirmDialog';
import { KeywordDetailDrawer } from './keyword-command-center/KeywordDetailDrawer';
import { KeywordRow } from './keyword-command-center/KeywordRow';
import { SummaryMetric } from './keyword-command-center/SummaryMetric';
import { KEYWORD_ROW_GRID } from './keyword-command-center/VariantSubRow';
import {
  FILTER_ICONS,
  filterCountLabel,
  isServerAction,
  requiresProtectedConfirmation,
} from './keyword-command-center/kccDisplayHelpers';
import {
  summarizeBulkAction,
  type KeywordBulkActionSummary,
} from './keyword-command-center/kccActionHelpers';

interface KeywordCommandCenterProps {
  workspaceId: string;
}

function feedbackStatus(feedback: KeywordCommandCenterFeedbackState | undefined): string | undefined {
  return feedback?.status;
}

function placeholderRowMatchesFilter(row: KeywordCommandCenterRow, filterId: KeywordCommandCenterFilter): boolean {
  switch (filterId) {
    case KEYWORD_COMMAND_CENTER_FILTERS.ALL:
      return true;
    case KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY:
      return row.lifecycleStatus === 'in_strategy';
    case KEYWORD_COMMAND_CENTER_FILTERS.TRACKED:
      return row.tracking.status === 'active';
    case KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW:
      return row.lifecycleStatus === 'needs_review';
    case KEYWORD_COMMAND_CENTER_FILTERS.CONTENT:
      return row.assignment?.role === 'content_gap';
    case KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED:
      return row.assignment?.role === 'page_keyword';
    case KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE:
      return row.lifecycleStatus === 'raw_evidence';
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL:
      return Boolean(row.localSeo || row.localSeoState);
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES:
      return row.localSeoState?.lifecycle === 'candidate';
    case KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY:
      return row.localSeo?.posture === 'visible';
    case KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH:
      return row.localSeo?.posture === 'possible_match';
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE:
      return row.localSeo?.posture === 'not_visible' || row.localSeo?.posture === 'local_pack_present';
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED:
      return row.localSeoState?.lifecycle === 'not_checked';
    case KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED:
      return row.localSeo?.posture === 'provider_degraded';
    case KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED:
      return feedbackStatus(row.feedback) === 'requested';
    case KEYWORD_COMMAND_CENTER_FILTERS.DECLINED:
      return row.lifecycleStatus === 'declined' || feedbackStatus(row.feedback) === 'declined';
    case KEYWORD_COMMAND_CENTER_FILTERS.RETIRED:
      return row.lifecycleStatus === 'retired';
    case KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY:
      return Boolean(row.isLostVisibility);
  }
}

export function KeywordCommandCenter({ workspaceId }: KeywordCommandCenterProps) {
  const navigate = useNavigate();
  const actionMutation = useKeywordCommandCenterAction(workspaceId);
  const bulkActionMutation = useKeywordCommandCenterBulkAction(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const [filter, setFilter] = useState<KeywordCommandCenterFilter>(KEYWORD_COMMAND_CENTER_FILTERS.ALL);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedBulkKeys, setSelectedBulkKeys] = useState<Set<string>>(new Set());
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    row: KeywordCommandCenterRow;
    action: KeywordCommandCenterNextAction;
  } | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<KeywordBulkActionSummary | null>(null);
  const [bulkActionResult, setBulkActionResult] = useState<KeywordCommandCenterBulkActionResult | null>(null);
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [summaryEnabled, setSummaryEnabled] = useState(false);
  const [localPanelEnabled, setLocalPanelEnabled] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
    setSelectedKey(null);
    setSelectedBulkKeys(new Set());
  }, [debouncedSearchTerm, filter]);

  useEffect(() => {
    setSelectedBulkKeys(new Set());
  }, [page]);

  const rowsQuery = useMemo(() => ({
    filter,
    search: debouncedSearchTerm.trim() || undefined,
    page,
    pageSize: 50,
  }), [debouncedSearchTerm, filter, page]);

  const summary = useKeywordCommandCenterSummary(workspaceId, { enabled: summaryEnabled });
  const rowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery);
  const detail = useKeywordCommandCenterDetail(workspaceId, selectedKey);
  const rows = rowsResult.data?.rows ?? [];
  const summaryData = summary.data;
  const summaryErrorMessage = summary.error instanceof Error
    ? summary.error.message
    : summary.error
      ? 'Keyword summary metrics could not load. Row data remains available.'
      : null;
  const placeholderFilters = useMemo(() => {
    const placeholderCount = (id: KeywordCommandCenterFilter) => {
      if (id === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return rowsResult.data?.pageInfo.totalRows ?? rows.length;
      return rows.filter(row => placeholderRowMatchesFilter(row, id)).length;
    };
    return [
      { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.ALL) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.DECLINED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.RETIRED) },
      { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility', count: placeholderCount(KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY) },
    ];
  }, [rows, rowsResult.data?.pageInfo.totalRows]);

  useEffect(() => {
    setSummaryEnabled(false);
    setLocalPanelEnabled(false);
  }, [workspaceId]);

  useEffect(() => {
    if (summaryEnabled) return;
    const timer = window.setTimeout(() => setSummaryEnabled(true), 150);
    return () => window.clearTimeout(timer);
  }, [summaryEnabled]);

  useEffect(() => {
    if (!rowsResult.data) return;
    setSummaryEnabled(true);
    if (localPanelEnabled) return;
    const idle = 'requestIdleCallback' in window
      ? (window as Window & {
        requestIdleCallback: (callback: IdleRequestCallback, opts?: IdleRequestOptions) => number;
        cancelIdleCallback: (id: number) => void;
      })
      : null;
    if (idle) {
      const id = idle.requestIdleCallback(() => setLocalPanelEnabled(true), { timeout: 400 });
      return () => idle.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => setLocalPanelEnabled(true), 0);
    return () => window.clearTimeout(timer);
  }, [localPanelEnabled, rowsResult.data]);

  const selectedBulkRows = useMemo(
    () => rows.filter(row => selectedBulkKeys.has(row.normalizedKeyword)),
    [rows, selectedBulkKeys],
  );
  const allVisibleSelected = rows.length > 0 && rows.every(row => selectedBulkKeys.has(row.normalizedKeyword));
  const someVisibleSelected = rows.some(row => selectedBulkKeys.has(row.normalizedKeyword));
  const actionErrorMessage = actionMutation.error instanceof Error
    ? actionMutation.error.message
    : actionMutation.error
      ? 'Keyword action failed. Try again or refresh the page.'
      : bulkActionMutation.error instanceof Error
        ? bulkActionMutation.error.message
        : bulkActionMutation.error
          ? 'Bulk keyword action failed. Try again or refresh the page.'
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

  const toggleBulkKey = (row: KeywordCommandCenterRow, checked: boolean) => {
    setSelectedBulkKeys(previous => {
      const next = new Set(previous);
      if (checked) next.add(row.normalizedKeyword);
      else next.delete(row.normalizedKeyword);
      return next;
    });
  };

  const toggleVisibleRows = (checked: boolean) => {
    setSelectedBulkKeys(previous => {
      const next = new Set(previous);
      for (const row of rows) {
        if (checked) next.add(row.normalizedKeyword);
        else next.delete(row.normalizedKeyword);
      }
      return next;
    });
  };

  const runBulkAction = (bulkSummary: KeywordBulkActionSummary, force: boolean) => {
    setBulkActionResult(null);
    bulkActionMutation.mutate({
      action: bulkSummary.action,
      keywords: bulkSummary.keywords,
      force: force || undefined,
    }, {
      onSuccess: (result) => {
        setBulkActionResult(result);
        setSelectedBulkKeys(new Set());
        setPendingBulkAction(null);
      },
    });
  };

  const handleBulkAction = (action: KeywordCommandCenterBulkActionType) => {
    const bulkSummary = summarizeBulkAction(selectedBulkRows, action);
    if (bulkSummary.total === 0) return;
    if (bulkSummary.requiresConfirmation) {
      setPendingBulkAction(bulkSummary);
      return;
    }
    runBulkAction(bulkSummary, false);
  };

  if (rowsResult.isLoading && !rowsResult.data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Keywords" subtitle="Building the keyword operating layer..." />
        <SectionCard title="Keyword Universe">
          <TableSkeleton rows={8} columns={6} />
        </SectionCard>
      </div>
    );
  }

  if (rowsResult.error) {
    return (
      <EmptyState
        icon={Search}
        title="Keyword Command Center could not load"
        description={rowsResult.error instanceof Error ? rowsResult.error.message : 'Try refreshing the page. Your keyword data was not changed.'}
      />
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title="Keywords"
        subtitle="The operating layer for strategy terms, evidence, tracking, feedback, retired keywords, and safe handoffs."
        actions={
          <Button variant="secondary" size="sm" icon={ArrowUpRight} onClick={() => navigate(adminPath(workspaceId, 'seo-strategy'))}>
            Open Strategy
          </Button>
        }
      />

      {summaryData ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryMetric label="In Strategy" value={summaryData.counts.inStrategy ?? 0} icon={Target} tone="teal" />
          <SummaryMetric label="Tracked" value={summaryData.counts.tracked ?? 0} icon={TrendingUp} tone="blue" />
          <SummaryMetric label="Local" value={summaryData.counts.local ?? 0} icon={MapPin} tone="blue" />
          <SummaryMetric label="Needs Review" value={summaryData.counts.needsReview ?? 0} icon={Eye} tone="amber" />
          <SummaryMetric label="Retired" value={summaryData.counts.retired ?? 0} icon={Archive} tone="zinc" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-[88px] rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 animate-pulse" />
          ))}
        </div>
      )}

      {localPanelEnabled ? (
        <LocalSeoVisibilityPanel
          workspaceId={workspaceId}
          mode="keywords"
          onOpenKeywords={() => {
            setFilter(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL);
            setPage(1);
            document.getElementById('keyword-universe')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      ) : (
        <SectionCard title="Local Keyword Visibility" variant="subtle">
          <div className="flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
            <span className="inline-block h-2 w-2 rounded-[var(--radius-sm)] bg-blue-400 animate-pulse" />
            Local visibility summary will load after the keyword rows are ready.
          </div>
        </SectionCard>
      )}

      {actionErrorMessage && (
        <div
          role="alert"
          className="rounded-[var(--radius-xl)] border border-red-500/25 bg-red-500/8 px-4 py-3 text-red-400 t-caption"
        >
          {actionErrorMessage}
        </div>
      )}

      {summaryErrorMessage && (
        <div
          role="status"
          className="rounded-[var(--radius-xl)] border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-amber-300 t-caption"
        >
          {summaryErrorMessage}
        </div>
      )}

      {bulkActionResult && (
        <div
          role="status"
          className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 px-4 py-3"
        >
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{bulkActionResult.message}</p>
          {(bulkActionResult.skipped > 0 || bulkActionResult.failed > 0) && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
              {bulkActionResult.skipped > 0 ? `${bulkActionResult.skipped} skipped by protection or tracking state. ` : ''}
              {bulkActionResult.failed > 0 ? `${bulkActionResult.failed} failed. Review the selected keywords and try again.` : ''}
            </p>
          )}
        </div>
      )}

      <SectionCard
        id="keyword-universe"
        title="Keyword Universe"
        titleExtra={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge label={`${rowsResult.data?.pageInfo.totalRows ?? rows.length} visible`} tone="blue" variant="soft" shape="pill" />
            {summaryData?.counts.missingVolume != null
              && summaryData.counts.missingVolume > 0
              && summaryData.counts.total > 0
              && summaryData.counts.missingVolume / summaryData.counts.total > 0.05 && (
              <Badge
                label={`${summaryData.counts.missingVolume} missing demand`}
                tone="amber"
                variant="soft"
                shape="pill"
              />
            )}
            {summaryData?.counts.lostVisibility != null && summaryData.counts.lostVisibility > 0 && (
              <Badge
                label={`${summaryData.counts.lostVisibility} lost visibility`}
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
          {(summaryData?.filters ?? placeholderFilters).map(item => {
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
          <div className="min-w-[1080px]">
            <div className={`hidden md:grid ${KEYWORD_ROW_GRID} gap-3 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/30`}>
              <Checkbox
                checked={allVisibleSelected}
                onChange={toggleVisibleRows}
                label={someVisibleSelected && !allVisibleSelected ? 'Select all visible keywords' : 'Select visible keywords'}
                srOnlyLabel
              />
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">Keyword</p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">Status</p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">Local</p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">
                <span>Demand</span>
                {summaryData?.geoLabel && (
                  <span className="ml-1 normal-case t-caption-sm text-[var(--brand-text-muted)]">
                    - {summaryData.geoLabel}
                  </span>
                )}
              </p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">Rank/KD</p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)]">Assignment</p>
              <p className="t-label uppercase tracking-wider text-[var(--brand-text-muted)] text-right">Next</p>
            </div>

            {rowsResult.isFetching ? (
              <TableSkeleton rows={8} columns={7} />
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
                    selected={selectedBulkKeys.has(row.normalizedKeyword)}
                    onSelect={() => setSelectedKey(row.normalizedKeyword)}
                    onToggleSelected={checked => toggleBulkKey(row, checked)}
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

        {summaryData && summaryData.rawEvidenceTotal > summaryData.rawEvidenceReturned && (
          <div className="px-4 py-3 border-t border-[var(--brand-border)] bg-[var(--surface-3)]/20">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Showing {summaryData.rawEvidenceReturned} of {summaryData.rawEvidenceTotal} raw-evidence-only terms. Selected strategy, feedback, and tracked terms are never capped.
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

      <KeywordDetailDrawer
        open={!!selectedKey}
        row={selectedRow}
        workspaceId={workspaceId}
        isLoading={detail.isFetching && !!selectedKey && !detail.data}
        loadingAction={localRefresh.isPending ? 'check_local_visibility' : actionMutation.isPending ? actionMutation.variables?.action : undefined}
        onAction={(action) => handleAction(selectedRow, action)}
        onClose={() => setSelectedKey(null)}
      />

      <KeywordBulkActionBar
        selectedCount={selectedBulkRows.length}
        isPending={bulkActionMutation.isPending}
        onAction={handleBulkAction}
        onClear={() => setSelectedBulkKeys(new Set())}
      />

      <KeywordBulkConfirmDialog
        summary={pendingBulkAction}
        isPending={bulkActionMutation.isPending}
        onConfirm={(force) => {
          if (pendingBulkAction) runBulkAction(pendingBulkAction, force);
        }}
        onCancel={() => setPendingBulkAction(null)}
      />

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
