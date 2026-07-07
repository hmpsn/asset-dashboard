// @ds-rebuilt
import { ArrowDownRight, BarChart3, FileText, Gauge, Layers, Shield } from 'lucide-react';
import type { WorkQueueClassification } from '../../../shared/types/work-queue';
import {
  Button,
  ClickableRow,
  ClientSwitcherRow,
  ClientThreadRow,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  Meter,
  MetricTile,
  Segmented,
} from '../ui';
import { SeoChangeImpact } from '../workspace-home';
import type { CockpitEvidenceView } from './useCockpitSurfaceState';
import type { CockpitKpiModel, CockpitRankRow, CockpitRequestRow } from '../../hooks/admin/useCockpitRebuilt';
import { formatCompactNumber, formatPercent } from './cockpitFormatters';

interface CockpitEvidenceRailProps {
  workspaceId: string;
  workspaceName: string;
  workspaceInitials: string;
  hasGsc: boolean;
  healthTone: 'ok' | 'risk' | 'new';
  workQueue: WorkQueueClassification;
  requests: CockpitRequestRow[];
  ranks: CockpitRankRow[];
  kpis: CockpitKpiModel;
  view: CockpitEvidenceView;
  onViewChange: (view: CockpitEvidenceView) => void;
  onOpenRoute: (route: string) => void;
  route: {
    analytics: string;
    contentHealth: string;
    contentBriefs: string;
    contentPublished: string;
    keywords: string;
    siteAudit: string;
    strategy: string;
    outcomes: string;
    requests: string;
  };
}

function EmptyRankIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function rowForRank(rank: CockpitRankRow): Record<string, unknown> {
  const change = rank.change == null ? '—' : rank.change > 0 ? `+${rank.change}` : String(rank.change);
  return {
    id: rank.id,
    query: rank.query,
    position: rank.position ?? '—',
    previous: rank.previousPosition ?? '—',
    change,
    raw: rank,
  };
}

export function CockpitEvidenceRail({
  workspaceId,
  workspaceName,
  workspaceInitials,
  hasGsc,
  healthTone,
  workQueue,
  requests,
  ranks,
  kpis,
  view,
  onViewChange,
  onOpenRoute,
  route,
}: CockpitEvidenceRailProps) {
  const rankRows = ranks.map(rowForRank);
  const requestRows = requests.filter((request) => request.status !== 'closed' && request.status !== 'resolved').slice(0, 4);
  const issueCount = workQueue.items.filter((item) => item.direction === 'negative').length;
  const pipeline = kpis.contentPipeline;
  const pipelinePercent = pipeline.percent ?? 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="cockpit-evidence-rail">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={[
              { value: 'rankings', label: 'Rankings' },
              { value: 'technicals', label: 'Technicals' },
            ]}
            value={view}
            onChange={(value) => onViewChange(value as CockpitEvidenceView)}
          />
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            Evidence stays read-only here; destination surfaces own the workshops.
          </span>
        </div>

        {view === 'rankings' ? (
          <div data-testid="cockpit-rankings-view">
            <DataTable
              columns={[
                { key: 'query', label: 'Keyword', width: 'minmax(180px,1.4fr)', sortable: true },
                { key: 'position', label: 'Position', width: '92px', align: 'right', sortable: true },
                { key: 'previous', label: 'Previous', width: '92px', align: 'right' },
                {
                  key: 'change',
                  label: 'Change',
                  width: '88px',
                  align: 'right',
                  render: (value) => (
                    <span className="tabular-nums text-[var(--brand-text-bright)]">{String(value)}</span>
                  ),
                },
              ]}
              rows={rankRows}
              getRowKey={(row) => String(row.id)}
              onRowClick={() => onOpenRoute(route.keywords)}
              empty={
                <EmptyState
                  icon={EmptyRankIcon}
                  title="No tracked rankings yet"
                  description="Add tracked keywords from Keyword Hub before the Cockpit can show rank movement."
                  action={<Button variant="secondary" size="sm" onClick={() => onOpenRoute(route.keywords)}>Open Keyword Hub</Button>}
                />
              }
            />
          </div>
        ) : (
          <div className="grid gap-3" data-testid="cockpit-technicals-view">
            <GroupBlock
              title="Content and technical hand-offs"
              meta="Destination surfaces own edits, scans, and approvals."
              icon={Gauge}
              iconColor="var(--blue)"
              stats={[
                { label: 'issues', value: issueCount, color: issueCount > 0 ? 'var(--amber)' : 'var(--emerald)' },
                { label: 'coverage', value: kpis.coverageGaps, color: 'var(--blue)' },
              ]}
            >
              <div className="grid gap-2">
                <ClickableRow
                  className="rounded-[var(--radius-md)] border border-[var(--brand-border)] px-3 py-3"
                  onClick={() => onOpenRoute(route.siteAudit)}
                >
                  <div className="flex items-center gap-3">
                    <Icon name="gauge" size="md" className="text-[var(--blue)]" />
                    <div className="min-w-0 flex-1">
                      <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Site Audit</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">
                        {kpis.siteHealth.errors} errors · {kpis.siteHealth.warnings} warnings · score {kpis.siteHealth.score ?? '—'}
                      </div>
                    </div>
                  </div>
                </ClickableRow>
                <ClickableRow
                  className="rounded-[var(--radius-md)] border border-[var(--brand-border)] px-3 py-3"
                  onClick={() => onOpenRoute(route.contentHealth)}
                >
                  <div className="flex items-center gap-3">
                    <Icon name="file" size="md" className="text-[var(--amber)]" />
                    <div className="min-w-0 flex-1">
                      <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Content Health</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">
                        {kpis.contentDecay.total} decaying pages · {formatPercent(kpis.contentDecay.avgDeclinePct, { alreadyPercent: true })} average decline
                      </div>
                    </div>
                  </div>
                </ClickableRow>
                <ClickableRow
                  className="rounded-[var(--radius-md)] border border-[var(--brand-border)] px-3 py-3"
                  onClick={() => onOpenRoute(route.strategy)}
                >
                  <div className="flex items-center gap-3">
                    <Icon name="target" size="md" className="text-[var(--blue)]" />
                    <div className="min-w-0 flex-1">
                      <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Coverage Gaps</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">
                        {kpis.coverageGaps} strategy gap{kpis.coverageGaps === 1 ? '' : 's'} need an Engine hand-off.
                      </div>
                    </div>
                  </div>
                </ClickableRow>
              </div>
              <div className="mt-3 border-t border-[var(--brand-border)] pt-3">
                <SeoChangeImpact workspaceId={workspaceId} hasGsc={hasGsc} embedded />
              </div>
            </GroupBlock>
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        <GroupBlock
          title="From client"
          meta="Requests and replies route to the inbox owner."
          icon={Shield}
          iconColor="var(--teal)"
          stats={[{ label: 'open', value: requestRows.length, color: requestRows.length > 0 ? 'var(--amber)' : 'var(--emerald)' }]}
        >
          <ClientSwitcherRow
            name={workspaceName}
            initials={workspaceInitials}
            meta={`${formatCompactNumber(workQueue.items.length)} queue items`}
            health={healthTone}
            active
          />
          {requestRows.length > 0 ? (
            requestRows.map((request) => (
              <ClientThreadRow
                key={request.id}
                author={workspaceName}
                initials={workspaceInitials}
                kind="request"
                message={request.title}
                when={request.createdAt ? new Date(request.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
              />
            ))
          ) : (
            <div className="px-4 py-3 t-caption-sm text-[var(--brand-text-muted)]">
              No open client requests in this workspace.
            </div>
          )}
          <div className="border-t border-[var(--brand-border)] px-4 py-3">
            <Button variant="secondary" size="sm" onClick={() => onOpenRoute(route.requests)}>
              Open requests
            </Button>
          </div>
        </GroupBlock>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <MetricTile
            label="Pipeline"
            value={pipeline.percent == null ? '—' : `${pipeline.percent}%`}
            sub={`${pipeline.published}/${pipeline.total} published · ${pipeline.review} review`}
            accent="var(--teal)"
            icon={Layers}
            onClick={() => onOpenRoute(route.contentBriefs)}
          />
          <GroupBlock
            title="Pipeline meter"
            meta={`${pipeline.total} planned cells`}
            icon={Layers}
            iconColor="var(--teal)"
          >
            <Meter
              label="Content pipeline"
              value={pipelinePercent}
              max={100}
              gradient
              showValue
              ariaLabel="Content pipeline published percentage"
            />
            <div className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">
              {pipeline.approved} approved · {pipeline.inProgress} in progress.
            </div>
          </GroupBlock>
          <MetricTile
            label="Content Velocity"
            value={kpis.contentVelocity.trailingThreeMonthAvg == null ? '—' : `${kpis.contentVelocity.trailingThreeMonthAvg}/mo`}
            delta={kpis.contentVelocity.trendPct ?? undefined}
            deltaLabel="%"
            sub={`${kpis.contentVelocity.currentMonthPublished ?? 0} this month`}
            accent="var(--blue)"
            icon={FileText}
            onClick={() => onOpenRoute(route.contentPublished)}
          />
          <MetricTile
            label="Users"
            value={formatCompactNumber(kpis.ga4.users)}
            delta={kpis.ga4.usersDelta ?? undefined}
            deltaLabel="%"
            sub={`${formatCompactNumber(kpis.ga4.sessions)} sessions`}
            accent="var(--blue)"
            icon={BarChart3}
            onClick={() => onOpenRoute(route.analytics)}
          />
          <MetricTile
            label="Content Decay"
            value={kpis.contentDecay.total || '—'}
            sub={`${kpis.contentDecay.critical} critical · ${kpis.contentDecay.warning} warning`}
            accent={kpis.contentDecay.critical > 0 ? 'var(--red)' : 'var(--amber)'}
            icon={ArrowDownRight}
            onClick={() => onOpenRoute(route.contentHealth)}
          />
        </div>
      </aside>
    </div>
  );
}
