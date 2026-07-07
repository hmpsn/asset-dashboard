// @ds-rebuilt
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutcomeOverview } from '../../hooks/admin/useOutcomes';
import { useWorkspaceOverviewData } from '../../hooks/admin/useWorkspaceOverview';
import { adminPath } from '../../routes';
import type { WorkspaceOutcomeOverview } from '../../../shared/types/outcome-tracking';
import {
  Badge,
  DataTable,
  Icon,
  InlineBanner,
  MetricTile,
  PageContainer,
  PageHeader,
  SectionCard,
} from '../ui';
import { formatMoney, formatNumber, percent } from './globalOpsFormatters';

function winRateLabel(rate: unknown): string {
  return typeof rate === 'number' ? percent(rate * 100) : '—';
}

export function OutcomesBookLens() {
  const navigate = useNavigate();
  const overview = useWorkspaceOverviewData();
  const outcomeOverview = useOutcomeOverview();
  const workspaces = overview.data?.workspaces ?? [];

  const outcomeByWorkspace = useMemo(() => {
    const map = new Map<string, WorkspaceOutcomeOverview>();
    for (const item of outcomeOverview.data ?? []) {
      map.set(item.workspaceId, item);
    }
    return map;
  }, [outcomeOverview.data]);

  const totals = useMemo(() => {
    return workspaces.reduce((acc, workspace) => {
      const value = workspace.outcomeValue;
      acc.valuePerMonth += value?.valuePerMonth ?? 0;
      acc.wins += value?.wins ?? 0;
      acc.external += value?.externallyExecuted ?? 0;
      acc.platform += value?.platformExecuted ?? 0;
      acc.clicks += workspace.gscRollup?.clicks ?? 0;
      acc.issues += workspace.siteHealthIssueMatrix?.totalIssues ?? 0;
      return acc;
    }, { valuePerMonth: 0, wins: 0, external: 0, platform: 0, clicks: 0, issues: 0 });
  }, [workspaces]);

  const rows = workspaces.map((workspace) => {
    const outcome = outcomeByWorkspace.get(workspace.id);
    const value = workspace.outcomeValue;
    return {
      id: workspace.id,
      workspace: workspace.name,
      value: value?.valuePerMonth ?? 0,
      wins: value?.wins ?? 0,
      attribution: `${value?.platformExecuted ?? 0} platform · ${value?.externallyExecuted ?? 0} client-side`,
      clicks: workspace.gscRollup?.clicks ?? 0,
      avgPosition: workspace.gscRollup?.avgPosition ?? null,
      issues: workspace.siteHealthIssueMatrix?.totalIssues ?? 0,
      winRate: outcome?.winRate,
      activeActions: outcome?.activeActions ?? 0,
      scoredLast30d: outcome?.scoredLast30d ?? 0,
      coverage: value && value.wins > 0 ? `${Math.round((value.withValue / value.wins) * 100)}%` : '—',
      attention: outcome?.attentionNeeded ? 'Needs attention' : 'OK',
    };
  });

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="outcomes-book-rebuilt" className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Outcomes Book"
          subtitle="Cross-workspace outcome value, search rollups, issue matrix, and coverage attention."
        />

        <InlineBanner
          tone="info"
          title="Attribution-honest value"
          message="Value columns come from the workspace-overview rollup: not-acted-on proposals are excluded, client-side work is labeled separately, and only platform-executed rows claim agency execution."
        />

        <div className="grid gap-3 md:grid-cols-5">
          <MetricTile label="Value / mo" value={formatMoney(totals.valuePerMonth)} accent="var(--amber)" />
          <MetricTile label="Wins counted" value={formatNumber(totals.wins)} accent="var(--emerald)" />
          <MetricTile label="Client-side called" value={formatNumber(totals.external)} accent="var(--blue)" />
          <MetricTile label="GSC clicks" value={formatNumber(totals.clicks)} accent="var(--blue)" />
          <MetricTile label="Open issues" value={formatNumber(totals.issues)} accent="var(--red)" />
        </div>

        <DataTable
          columns={[
            { key: 'workspace', label: 'Workspace', sortable: true, width: '1.3fr' },
            { key: 'value', label: 'Value / mo', sortable: true, align: 'right', width: '130px', render: (value) => formatMoney(value as number) },
            { key: 'wins', label: 'Wins', sortable: true, align: 'right', width: '84px' },
            { key: 'attribution', label: 'Attribution', width: '180px' },
            { key: 'clicks', label: 'Clicks', sortable: true, align: 'right', width: '100px', render: (value) => formatNumber(value as number) },
            { key: 'avgPosition', label: 'Avg pos', sortable: true, align: 'right', width: '92px', render: (value) => typeof value === 'number' ? value.toFixed(1) : '—' },
            { key: 'issues', label: 'Issues', sortable: true, align: 'right', width: '92px' },
            { key: 'winRate', label: 'Win rate', sortable: true, align: 'right', width: '100px', render: winRateLabel },
            { key: 'activeActions', label: 'Active', sortable: true, align: 'right', width: '92px' },
            { key: 'scoredLast30d', label: 'Scored 30d', sortable: true, align: 'right', width: '112px' },
            { key: 'coverage', label: 'Coverage', sortable: true, width: '120px' },
            {
              key: 'attention',
              label: 'Attention',
              sortable: true,
              width: '140px',
              render: (value) => <Badge label={String(value)} tone={value === 'OK' ? 'emerald' : 'amber'} variant="soft" />,
            },
          ]}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          loading={overview.isLoading || outcomeOverview.isLoading}
          empty="No workspace outcome rollups yet"
          onRowClick={(row) => navigate(adminPath(String(row.id), 'outcomes'))}
        />

        <SectionCard title="Read-only site-health issue matrix" titleIcon={<Icon name="gauge" size="md" className="text-[var(--blue)]" />}>
          <div className="grid gap-3 md:grid-cols-3">
            {workspaces.slice(0, 6).map((workspace) => (
              <div key={workspace.id} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="t-caption font-semibold text-[var(--brand-text-bright)]">{workspace.name}</div>
                <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
                  {formatNumber(workspace.siteHealthIssueMatrix?.totalIssues ?? 0)} open issues
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
