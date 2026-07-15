// @ds-rebuilt
import { Fragment } from 'react';
import type { WorkQueueClassification } from '../../../shared/types/work-queue';
import { Button, ClickableRow, ClientThreadRow, Icon, SectionCard } from '../ui';
import type { IconName } from '../ui/iconNames';
import type { CockpitKpiModel, CockpitRankRow, CockpitRequestRow } from '../../hooks/admin/useCockpitRebuilt';
import { formatPercent } from './cockpitFormatters';

interface CockpitEvidenceRailProps {
  workspaceName: string;
  workspaceInitials: string;
  workQueue: WorkQueueClassification;
  requests: CockpitRequestRow[];
  ranks: CockpitRankRow[];
  kpis: CockpitKpiModel;
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

type Severity = 'high' | 'med' | 'low';

const SEVERITY: Record<Severity, { label: string; color: string }> = {
  high: { label: 'High', color: 'var(--red)' },
  med: { label: 'Med', color: 'var(--amber)' },
  low: { label: 'Low', color: 'var(--blue)' },
};

/** Right-aligned "Keyword →" style link-out for a rail card header. */
function LinkOut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      {label}
      <Icon name="arrowRight" size="sm" />
    </Button>
  );
}

/** Compact technical hand-off row: icon chip + title/meta + severity pill + Fix. (`.ck-trow`) */
function TechRow({
  iconName,
  color,
  title,
  meta,
  severity,
  onFix,
}: {
  iconName: IconName;
  color: string;
  title: string;
  meta: string;
  severity: Severity;
  onFix: () => void;
}) {
  const sev = SEVERITY[severity];
  return (
    <div className="flex items-center gap-[11px] border-t border-[var(--brand-border)] px-4 py-2.5 first:border-t-0">
      <span
        className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[var(--radius-md)]"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
      >
        <Icon name={iconName} size="sm" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{title}</div>
        <div className="truncate t-caption-sm text-[var(--brand-text-muted)]">{meta}</div>
      </div>
      <span
        className="flex-none rounded-[var(--radius-pill)] px-[7px] py-0.5 t-caption-sm font-bold uppercase tracking-[0.04em]"
        style={{ color: sev.color, background: `color-mix(in srgb, ${sev.color} 12%, transparent)` }}
      >
        {sev.label}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={onFix}
        className="flex-none rounded-[var(--radius-md)] border-[var(--brand-border)] bg-[var(--surface-3)] px-[11px] py-1.5 font-semibold text-[var(--blue)] hover:border-[var(--brand-border-hover)]"
      >
        Fix
      </Button>
    </div>
  );
}

/** Compact keyword-position row: query + #position + Δ. (`.ck-krow`) */
function KeywordRow({ rank }: { rank: CockpitRankRow }) {
  const change = rank.change ?? null;
  const moveColor = change == null || change === 0
    ? 'var(--brand-text-dim)'
    : change > 0
      ? 'var(--emerald)'
      : 'var(--red)';
  const moveLabel = change == null || change === 0
    ? '—'
    : change > 0
      ? `+${change}`
      : String(change);
  return (
    <div className="flex items-center gap-[11px] border-t border-[var(--brand-border)] px-4 py-2 first:border-t-0">
      <span className="min-w-0 flex-1 truncate t-ui text-[var(--brand-text-bright)]">{rank.query}</span>
      <span className="flex-none t-body font-bold text-[var(--brand-text-bright)] tabular-nums">
        {rank.position == null ? '—' : `#${rank.position}`}
      </span>
      <span className="flex-none w-10 text-right t-caption-sm font-semibold tabular-nums" style={{ color: moveColor }}>
        {moveLabel}
      </span>
    </div>
  );
}

/** One stage of the content-in-flight funnel: dot + count + label. (`.co-mstage`) */
function FunnelStage({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className="flex-1 text-center">
      <span className="mx-auto mb-1 block h-1.5 w-1.5 rounded-[var(--radius-pill)]" style={{ background: color }} aria-hidden="true" />
      <div className="t-stat-sm font-extrabold leading-none text-[var(--brand-text-bright)] tabular-nums">{count}</div> {/* stat-primitive-ok: compact content-funnel stage count inside the Cockpit evidence rail, not a labeled StatCard/CompactStatBar metric grid */}
      <div className="mt-0.5 t-label text-[var(--brand-text-dim)]">{label}</div>
    </div>
  );
}

function FunnelArrow() {
  return (
    <span className="flex flex-none items-center px-0.5 text-[var(--brand-text-dim)]" aria-hidden="true">
      <Icon name="arrowRight" size="sm" />
    </span>
  );
}

export function CockpitEvidenceRail({
  workspaceName,
  workspaceInitials,
  workQueue,
  requests,
  ranks,
  kpis,
  onOpenRoute,
  route,
}: CockpitEvidenceRailProps) {
  const workspaceFirstName = workspaceName.trim().split(/\s+/)[0] || workspaceName;
  // Exclude terminal admin request states. NB: the admin RequestStatus union has no 'resolved'
  // ('resolved' is a client-projection value) — the terminal "done" state is 'completed'.
  const openRequests = requests.filter((r) => r.status !== 'closed' && r.status !== 'completed').slice(0, 4);
  const rankRows = ranks.slice(0, 5);

  // Technical hand-offs synthesised from KPI slices → compact severity rows.
  const techRows: Array<{ key: string; iconName: IconName; color: string; title: string; meta: string; severity: Severity; route: string }> = [];
  if (kpis.siteHealth.errors > 0 || kpis.siteHealth.warnings > 0 || kpis.siteHealth.score != null) {
    techRows.push({
      key: 'audit',
      iconName: 'gauge',
      color: 'var(--red)',
      title: `${kpis.siteHealth.errors} error${kpis.siteHealth.errors === 1 ? '' : 's'} in site audit`,
      meta: `${kpis.siteHealth.warnings} warnings · score ${kpis.siteHealth.score ?? '—'}`,
      severity: kpis.siteHealth.errors > 0 ? 'high' : kpis.siteHealth.warnings > 0 ? 'med' : 'low',
      route: route.siteAudit,
    });
  }
  if (kpis.contentDecay.total > 0) {
    techRows.push({
      key: 'decay',
      iconName: 'file',
      color: 'var(--amber)',
      title: `${kpis.contentDecay.total} decaying page${kpis.contentDecay.total === 1 ? '' : 's'}`,
      meta: `${kpis.contentDecay.critical} critical · ${formatPercent(kpis.contentDecay.avgDeclinePct, { alreadyPercent: true })} avg decline`,
      severity: kpis.contentDecay.critical > 0 ? 'high' : 'med',
      route: route.contentHealth,
    });
  }
  if (kpis.coverageGaps > 0) {
    techRows.push({
      key: 'coverage',
      iconName: 'target',
      color: 'var(--blue)',
      title: `${kpis.coverageGaps} coverage gap${kpis.coverageGaps === 1 ? '' : 's'}`,
      meta: 'Strategy hand-off to the Engine',
      severity: 'low',
      route: route.strategy,
    });
  }

  const pipeline = kpis.contentPipeline;
  const funnel: Array<{ count: number; label: string; color: string }> = [
    { count: pipeline.inProgress, label: 'Drafting', color: 'var(--blue)' },
    { count: pipeline.review, label: 'Your review', color: 'var(--amber)' },
    { count: pipeline.approved, label: 'Ready', color: 'var(--teal)' },
    { count: pipeline.published, label: 'Published', color: 'var(--emerald)' },
  ];
  const needsReview = pipeline.review > 0;

  return (
    <div className="flex flex-col gap-[14px]" data-testid="cockpit-evidence-rail">
      {/* 1 — From client (leads the rail) */}
      <SectionCard
        title={`From ${workspaceFirstName}`}
        titleIcon={<Icon name="message" size="sm" className="text-[var(--blue)]" />}
        iconChip
        subtitle="Replies from their portal — a human is waiting"
        action={<LinkOut label="Inbox" onClick={() => onOpenRoute(route.requests)} />}
        noPadding
      >
        {openRequests.length > 0 ? (
          <div className="flex flex-col">
            {openRequests.map((request) => (
              <ClientThreadRow
                key={request.id}
                author={workspaceName}
                initials={workspaceInitials}
                kind="request"
                message={request.title}
                when={request.createdAt ? new Date(request.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 t-caption text-[var(--brand-text-muted)]">
            Nothing waiting from {workspaceFirstName} right now.
          </div>
        )}
      </SectionCard>

      {/* 2 — Technicals & optimization */}
      <SectionCard
        title="Technicals & optimization"
        titleIcon={<Icon name="gauge" size="sm" className="text-[var(--blue)]" />}
        iconChip
        subtitle="Site health — the invisible plumbing"
        action={(
          <span className="rounded-[var(--radius-pill)] border border-[color-mix(in_srgb,var(--blue)_25%,transparent)] bg-[color-mix(in_srgb,var(--blue)_10%,transparent)] px-2 py-0.5 t-caption-sm text-[var(--blue)]">
            stays here
          </span>
        )}
        noPadding
      >
        {techRows.length > 0 ? (
          <div className="flex flex-col">
            {techRows.map((row) => (
              <TechRow
                key={row.key}
                iconName={row.iconName}
                color={row.color}
                title={row.title}
                meta={row.meta}
                severity={row.severity}
                onFix={() => onOpenRoute(row.route)}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 t-caption text-[var(--brand-text-muted)]">No technical issues flagged right now.</div>
        )}
        <div className="flex items-start gap-2 border-t border-dashed border-[var(--brand-border)] bg-[color-mix(in_srgb,var(--amber)_3%,transparent)] px-4 py-3 t-caption-sm leading-relaxed text-[var(--brand-text-muted)]">
          <Icon name="star" size="sm" className="mt-0.5 flex-none text-[var(--amber)]" aria-hidden="true" />
          <span>
            Technical fixes <strong className="font-semibold text-[var(--amber)]">stay in the Cockpit</strong> — they move into the Insights Engine only when they become a measured proof point.
          </span>
        </div>
      </SectionCard>

      {/* 3 — Keyword position */}
      <SectionCard
        title="Keyword position"
        titleIcon={<Icon name="key" size="sm" className="text-[var(--blue)]" />}
        iconChip
        subtitle="Tracked terms · this client"
        action={<LinkOut label="Keywords" onClick={() => onOpenRoute(route.keywords)} />}
        noPadding
      >
        {rankRows.length > 0 ? (
          <div className="flex flex-col">
            {rankRows.map((rank) => (
              <KeywordRow key={rank.id} rank={rank} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 t-caption text-[var(--brand-text-muted)]">No tracked rankings yet.</div>
        )}
      </SectionCard>

      {/* 4 — Content in flight (funnel) */}
      <SectionCard
        title="Content in flight"
        titleIcon={<Icon name="clipboard" size="sm" className="text-[var(--teal)]" />}
        iconChip
        subtitle="Recommendation → published"
        action={<LinkOut label="Pipeline" onClick={() => onOpenRoute(route.contentBriefs)} />}
        noPadding
      >
        <div className="flex items-stretch gap-[5px] px-4 pb-1 pt-[13px]">
          {funnel.map((stage, index) => (
            <Fragment key={stage.label}>
              <FunnelStage count={stage.count} label={stage.label} color={stage.color} />
              {index < funnel.length - 1 && <FunnelArrow />}
            </Fragment>
          ))}
        </div>
        <ClickableRow
          onClick={() => onOpenRoute(needsReview ? route.contentBriefs : route.contentPublished)}
          className="flex w-full items-center gap-2 border-t border-[var(--brand-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--surface-3)]"
        >
          <Icon name="clipboard" size="sm" className="flex-none text-[var(--teal)]" />
          <span className="min-w-0 flex-1 truncate t-ui text-[var(--brand-text)]">
            {needsReview
              ? `${pipeline.review} draft${pipeline.review === 1 ? '' : 's'} ready for your review`
              : `${pipeline.published}/${pipeline.total} cells published`}
          </span>
          <Icon name="arrowRight" size="sm" className="flex-none text-[var(--brand-text-dim)]" />
        </ClickableRow>
      </SectionCard>

      <span className="sr-only" data-testid="cockpit-rail-queue-count">{workQueue.items.length}</span>
    </div>
  );
}
