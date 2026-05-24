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

  const summary = useKeywordCommandCenterSummary(workspaceId);
  const rowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery);
  const detail = useKeywordCommandCenterDetail(workspaceId, selectedKey);
  const rows = rowsResult.data?.rows ?? [];
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
                {summary.data?.geoLabel && (
                  <span className="ml-1 normal-case t-caption-sm text-[var(--brand-text-muted)]">
                    - {summary.data.geoLabel}
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
