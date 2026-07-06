// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { rankTrackingHistoryPath } from '../../lib/keywordTracking';
import { queryKeys } from '../../lib/queryKeys';
import { adminPath } from '../../routes';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterActionType,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterNextActionType,
} from '../../../shared/types/keyword-command-center';
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterDetail,
  useKeywordHardDelete,
  useNationalSerpRefresh,
  useRankTrackingTogglePin,
} from '../../hooks/admin/useKeywordCommandCenter';
import { useLocalSeoRefresh } from '../../hooks/admin/useLocalSeo';
import { canHardDelete } from '../keyword-command-center/KeywordActionMenu';
import {
  Badge,
  Button,
  ConfirmDialog,
  DefinitionList,
  Drawer,
  InlineBanner,
  MetricTile,
  OutcomeReadbackChip,
  Skeleton,
  Sparkline,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../ui';

interface KeywordDrawerProps {
  workspaceId: string;
  keyword: string | null;
  onClose: () => void;
}

type HistoryPoint = { date: string; positions: Record<string, number> };

const SERVER_ACTIONS = new Set<KeywordCommandCenterNextActionType>([
  KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
  KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE,
  KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
  KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
  KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
  KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
  KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
]);

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function isServerAction(type: KeywordCommandCenterNextActionType): type is KeywordCommandCenterActionType {
  return SERVER_ACTIONS.has(type);
}

function money(value: number | undefined): string {
  return typeof value === 'number' ? `${MONEY_FORMAT.format(value)}/mo` : 'No CPC';
}

function numberOrEmpty(value: number | undefined, prefix = ''): string {
  return typeof value === 'number' ? `${prefix}${value}` : 'No data';
}

function labelize(value: string | undefined): string {
  return value?.replace(/_/g, ' ') ?? 'No data';
}

function detailItems(row: KeywordCommandCenterRow) {
  const items = [
    { label: 'Tracking', value: labelize(row.tracking.status) },
    { label: 'Source', value: labelize(row.tracking.source) },
    { label: 'Page', value: row.assignment?.pageTitle ?? row.assignment?.pagePath ?? 'No page assigned' },
    { label: 'Topic cluster', value: row.assignment?.topicCluster ?? 'No cluster' },
  ];
  if (row.localSeoState) {
    items.push(
      { label: 'Local market', value: row.localSeoState.marketLabel ?? 'Market not set' },
      { label: 'Local state', value: row.localSeoState.lifecycleLabel },
      { label: 'Local priority', value: row.localSeoState.priorityLabel },
    );
  }
  if (row.tracking.replacedBy) {
    items.push({ label: 'Replaced by', value: row.tracking.replacedBy });
  }
  if (row.feedback?.status) {
    items.push({ label: 'Feedback', value: row.feedback.reason ? `${labelize(row.feedback.status)}: ${row.feedback.reason}` : labelize(row.feedback.status) });
  }
  return items;
}

export function KeywordDrawer({ workspaceId, keyword, onClose }: KeywordDrawerProps) {
  const navigate = useNavigate();
  const open = keyword != null;
  const detail = useKeywordCommandCenterDetail(workspaceId, keyword);
  const row = detail.data?.row ?? null;
  const actionMutation = useKeywordCommandCenterAction(workspaceId);
  const hardDelete = useKeywordHardDelete(workspaceId);
  const togglePin = useRankTrackingTogglePin(workspaceId);
  const nationalRefresh = useNationalSerpRefresh(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const [pendingForceAction, setPendingForceAction] = useState<KeywordCommandCenterNextAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const historyKeyword = row?.keyword ?? keyword ?? '';
  const rankHistory = useQuery({
    queryKey: queryKeys.admin.rankTrackingHistoryQueries(workspaceId, [historyKeyword]),
    queryFn: () => get<HistoryPoint[]>(rankTrackingHistoryPath(workspaceId, [historyKeyword])),
    enabled: open && !!row && row.tracking.status !== 'not_tracked',
    staleTime: 60_000,
  });

  const sparklineData = useMemo(() => {
    if (!row) return [];
    return (rankHistory.data ?? [])
      .map((point) => point.positions[row.keyword])
      .filter((position): position is number => typeof position === 'number')
      .map((position) => -position);
  }, [rankHistory.data, row]);

  const runAction = (action: KeywordCommandCenterNextAction, force = false) => {
    if (!row) return;
    if (action.type === 'view_rankings') return;
    if (action.type === 'review_page') {
      navigate(adminPath(workspaceId, 'seo-editor'), {
        state: {
          fixContext: {
            targetRoute: 'seo-editor',
            pageSlug: action.pagePath ?? row.assignment?.pagePath,
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
    if (action.disabledReason && !force) {
      setPendingForceAction(action);
      return;
    }
    actionMutation.mutate({
      action: action.type,
      keyword: row.keyword,
      pagePath: action.pagePath,
      force: force || undefined,
    });
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={row?.keyword ?? keyword ?? 'Keyword details'}
        subtitle={row?.assignment?.pageTitle ?? row?.assignment?.pagePath ?? 'Keyword command center'}
        eyebrow="Keyword detail"
        width={520}
        footer={row && (
          <Toolbar label="Keyword detail actions" className="w-full">
            {row.nextActions.slice(0, 4).map((action) => (
              <Button
                key={action.type}
                size="sm"
                variant={action.type === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE ? 'ghost' : 'secondary'}
                disabled={actionMutation.isPending || action.disabled}
                onClick={() => runAction(action)}
              >
                {action.label}
              </Button>
            ))}
            <ToolbarSpacer />
            {canHardDelete(row) && (
              <Button size="sm" variant="danger" disabled={hardDelete.isPending} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </Toolbar>
        )}
      >
        {detail.isLoading && !row ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[92px] w-full" />
            <Skeleton className="h-[160px] w-full" />
            <Skeleton className="h-[120px] w-full" />
          </div>
        ) : !row ? (
          <InlineBanner tone="info" title="Select a keyword">
            Pick a row to inspect source evidence, rank movement, revenue potential, and safe next actions.
          </InlineBanner>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={row.lifecycleStatus} domain="keyword-command-center" variant="soft" shape="pill" />
              {row.isProtected && <Badge label="Protected" tone="amber" variant="soft" shape="pill" />}
              {row.isLostVisibility && <Badge label="Lost visibility" tone="amber" variant="outline" shape="pill" />}
              {row.tracking.pinned && <Badge label="Pinned" tone="teal" variant="soft" shape="pill" />}
            </div>

            {row.protectionReason && (
              <InlineBanner tone="warning" size="sm" title="Protected keyword" icon={false}>
                {row.protectionReason}
              </InlineBanner>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <MetricTile label="Rank" value={numberOrEmpty(row.metrics.currentPosition, '#')} accent="var(--blue)" />
              <MetricTile label="Opportunity" value={numberOrEmpty(row.opportunityScore)} accent="var(--teal)" />
              <MetricTile label="Difficulty" value={numberOrEmpty(row.metrics.difficulty)} accent="var(--amber)" />
            </div>

            {detail.data?.outcome && <OutcomeReadbackChip outcome={detail.data.outcome} />}

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricTile label="Value Today" value={money(row.currentMonthly)} sub="Server-computed" accent="var(--emerald)" />
              <MetricTile label="Upside" value={money(row.upsideMonthly)} sub="Server-computed" accent="var(--emerald)" />
            </div>

            <DefinitionList items={detailItems(row)} />

            {row.valueReasons && row.valueReasons.length > 0 && (
              <div>
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Why this score</h3>
                <div className="mt-2 flex flex-col gap-2">
                  {row.valueReasons.map((reason) => (
                    <InlineBanner key={reason} tone="info" size="sm" icon={false}>
                      {reason}
                    </InlineBanner>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Where it came from</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.sourceLabels.map((source) => (
                  <Badge
                    key={`${source.kind}-${source.label}-${source.detail ?? ''}`}
                    label={source.detail ? `${source.label}: ${source.detail}` : source.label}
                    tone={source.kind === 'rank_data' || source.kind === 'local_visibility' ? 'blue' : 'teal'}
                    variant="outline"
                  />
                ))}
                {row.sourceLabels.length === 0 && <Badge label="No source labels" tone="zinc" variant="outline" />}
              </div>
            </div>

            <div>
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Rank history</h3>
              <div className="mt-2 flex items-center gap-3">
                <Sparkline data={sparklineData} width={180} height={44} area label={`${row.keyword} rank history`} />
                <div className="min-w-0">
                  <p className="t-caption text-[var(--brand-text-muted)]">
                    {rankHistory.isLoading ? 'Loading snapshots...' : sparklineData.length > 1 ? `${sparklineData.length} snapshots` : 'Not enough snapshots yet'}
                  </p>
                  {row.metrics.nationalPosition != null && (
                    <p className="t-caption-sm text-[var(--blue)]">Live SERP #{row.metrics.nationalPosition}</p>
                  )}
                  {row.metrics.matchedUrl && (
                    <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{row.metrics.matchedUrl}</p>
                  )}
                </div>
              </div>
              {row.metrics.serpFeatures && row.metrics.serpFeatures.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.metrics.serpFeatures.map((feature) => (
                    <Badge key={feature} label={labelize(feature)} tone="blue" variant="outline" />
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Controls</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.tracking.status !== 'not_tracked' && (
                  <Button
                    size="sm"
                    variant={row.tracking.pinned ? 'secondary' : 'ghost'}
                    disabled={togglePin.isPending}
                    aria-pressed={row.tracking.pinned === true}
                    onClick={() => togglePin.mutate(row.keyword)}
                  >
                    {row.tracking.pinned ? 'Pinned' : 'Pin'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={nationalRefresh.isPending} onClick={() => nationalRefresh.mutate()}>
                  Refresh national ranks
                </Button>
                <Button size="sm" variant="ghost" disabled={localRefresh.isPending} onClick={() => localRefresh.mutate({ keywords: [row.keyword] })}>
                  Refresh local visibility
                </Button>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!pendingForceAction}
        title="Override keyword protection?"
        message={pendingForceAction?.disabledReason ?? ''}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onCancel={() => setPendingForceAction(null)}
        onConfirm={() => {
          if (pendingForceAction) runAction(pendingForceAction, true);
          setPendingForceAction(null);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        variant="destructive"
        title="Delete keyword permanently?"
        message={row ? `This permanently deletes "${row.keyword}" and its rank history. This cannot be undone.` : ''}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (row) {
            hardDelete.mutate({ keyword: row.keyword }, { onSuccess: onClose });
          }
          setConfirmDelete(false);
        }}
      />
    </>
  );
}
