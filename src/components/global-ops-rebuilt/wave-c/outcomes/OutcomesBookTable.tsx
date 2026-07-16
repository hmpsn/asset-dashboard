// @ds-rebuilt
import { useMemo } from 'react';
import type { WorkspaceOutcomeOverview } from '../../../../../shared/types/outcome-tracking';
import type { WorkspaceOverviewItem } from '../../../../../shared/types/workspace-overview';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../../../hooks/useToggleSet';
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  Icon,
  InlineBanner,
  Meter,
  SectionCard,
  Skeleton,
} from '../../../ui';
import type { IconName } from '../../../ui';
import { formatMoney, formatNumber, percent } from '../../globalOpsFormatters';

export interface OutcomeBookEntry {
  workspace: WorkspaceOverviewItem;
  outcome?: WorkspaceOutcomeOverview;
}

interface OutcomesBookTableProps {
  entries: OutcomeBookEntry[];
  loading: boolean;
  onOpenWorkspace: (workspaceId: string) => void;
}

const GRID_TEMPLATE = 'minmax(180px, 1.3fr) minmax(210px, 1.35fr) 72px 58px 100px 90px';

function TrophyIcon({ className }: { className?: string }) {
  return <Icon name="trophy" className={className} />;
}

function trendPresentation(trend: WorkspaceOutcomeOverview['trend'] | undefined): { label: string; icon: IconName; className: string } {
  if (trend === 'improving') {
    return { label: 'Improving', icon: 'arrowUp', className: 'text-[var(--emerald)]' };
  }
  if (trend === 'declining') {
    return { label: 'Declining', icon: 'arrowDown', className: 'text-[var(--amber)]' };
  }
  if (trend === 'stable') {
    return { label: 'Stable', icon: 'arrowRight', className: 'text-[var(--brand-text-muted)]' };
  }
  return { label: 'Pending', icon: 'clock', className: 'text-[var(--brand-text-dim)]' };
}

function reconciledCoverageLabel(outcome: WorkspaceOutcomeOverview | undefined): string | null {
  const coverage = outcome?.coverage;
  return coverage && coverage.tracked > 0
    ? `${coverage.reconciled} / ${coverage.tracked}`
    : null;
}

function attentionBadge(outcome: WorkspaceOutcomeOverview | undefined) {
  if (!outcome) return <Badge label="Awaiting data" tone="zinc" variant="outline" />;
  return outcome.attentionNeeded
    ? <Badge label="Needs attention" tone="amber" variant="soft" />
    : <Badge label="On track" tone="emerald" variant="soft" />;
}

export function OutcomesBookTable({ entries, loading, onOpenWorkspace }: OutcomesBookTableProps) {
  const [expandedIds, toggleEvidence] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const maxValue = useMemo(
    () => Math.max(1, ...entries.map(({ workspace }) => workspace.outcomeValue?.valuePerMonth ?? 0)),
    [entries],
  );

  return (
    <SectionCard
      title="By workspace"
      subtitle="Ranked by delivered value, with search evidence and outcome coverage one step deeper"
      titleIcon={<Icon name="trophy" size="md" className="text-[var(--emerald)]" aria-hidden="true" />}
      iconChip
      action={<span className="hidden t-caption-sm text-[var(--brand-text-muted)] sm:inline">All-time value · 28-day clicks</span>}
      noPadding
    >
      <div
        role="grid"
        aria-label="Outcomes by workspace"
        className="overflow-auto md:max-h-[390px]"
      >
        <div className="min-w-[820px]">
          <div
            role="row"
            className="sticky top-0 z-[var(--z-sticky)] grid items-center gap-2.5 border-b border-[var(--brand-border)] bg-[var(--surface-1)] px-[18px] py-[11px]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            {['Workspace', 'Value delivered / mo (all-time)', 'Clicks (28d)', 'Wins (all-time)', 'Trend', 'Open workspace'].map((label, index) => (
              <span
                key={`${label}-${index}`}
                role="columnheader"
                className={`${index === 5 ? 'text-right' : ''} t-mono uppercase text-[var(--brand-text-dim)]`}
              >
                {index === 5 ? <span className="sr-only">{label}</span> : label}
              </span>
            ))}
          </div>

          {loading && Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              role="row"
              className="grid items-center gap-2.5 border-t border-[var(--brand-border)] px-[18px] py-3 first:border-t-0"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {Array.from({ length: 6 }).map((__, cell) => (
                <div key={cell} role="gridcell"><Skeleton className="h-7 w-full" /></div>
              ))}
            </div>
          ))}

          {!loading && entries.length === 0 && (
            <div role="row">
              <div role="gridcell" aria-colspan={6}>
                <EmptyState
                  icon={TrophyIcon}
                  title="No workspace outcome evidence yet"
                  description="Workspace results will appear after tracked work reaches a measurement checkpoint."
                />
              </div>
            </div>
          )}

          {!loading && entries.map(({ workspace, outcome }) => {
            const expanded = expandedIds.has(workspace.id);
            const hasValueEvidence = Boolean(workspace.outcomeValue);
            const value = workspace.outcomeValue?.valuePerMonth ?? 0;
            const wins = workspace.outcomeValue?.wins;
            const trend = trendPresentation(outcome?.trend);
            const issues = workspace.siteHealthIssueMatrix?.issues ?? [];
            const siteLabel = workspace.webflowSiteName || (workspace.hasGsc ? 'Search Console connected' : 'Outcome tracking workspace');
            const reconciledCoverage = reconciledCoverageLabel(outcome);

            return (
              <div key={workspace.id} className="border-t border-[var(--brand-border)] first:border-t-0">
                <div
                  role="row"
                  className="grid items-center gap-2.5 px-[18px] py-3 transition-colors hover:bg-[var(--surface-3)]/40"
                  style={{ gridTemplateColumns: GRID_TEMPLATE, transitionDuration: 'var(--dur-fast)' }}
                >
                  <div role="gridcell" className="min-w-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      aria-controls={`outcome-evidence-${workspace.id}`}
                      aria-label={`View ${workspace.name} outcome evidence`}
                      onClick={() => toggleEvidence(workspace.id)}
                      className="!w-full !justify-start !gap-2.5 !p-0 !text-left hover:!bg-transparent"
                    >
                      <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)] t-ui font-bold text-[var(--emerald)]">
                        {workspace.name.charAt(0).toUpperCase() || 'W'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{workspace.name}</span>
                        <span className="flex min-w-0 items-center gap-1.5 truncate t-caption-sm text-[var(--brand-text-muted)]">
                          <span className="truncate">{siteLabel}</span>
                          {reconciledCoverage && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="whitespace-nowrap">Coverage <span className="text-[var(--brand-text-muted)]">{reconciledCoverage}</span></span>
                            </>
                          )}
                        </span>
                      </span>
                      <Icon
                        name={expanded ? 'chevronUp' : 'chevronDown'}
                        size="sm"
                        className="flex-none text-[var(--brand-text-dim)]"
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                  <div role="gridcell" className="flex min-w-0 items-center gap-2.5">
                    <Meter
                      value={value}
                      max={maxValue}
                      color="var(--emerald)"
                      height={7}
                      ariaLabel={hasValueEvidence
                        ? `${workspace.name} delivered value relative to the highest workspace`
                        : `${workspace.name} has no delivered value rollup yet`}
                      className="flex-1"
                    />
                    <span className="min-w-[54px] text-right t-body tabular-nums font-bold text-[var(--emerald)]">
                      {formatMoney(hasValueEvidence ? value : null)}
                    </span>
                  </div>
                  <div role="gridcell" className="t-body tabular-nums font-semibold text-[var(--brand-text-bright)]">
                    {formatNumber(workspace.gscRollup?.dataAvailable ? workspace.gscRollup.clicks : null)}
                  </div>
                  <div role="gridcell" className="t-body tabular-nums font-semibold text-[var(--brand-text-bright)]">{wins ?? '—'}</div>
                  <div role="gridcell" className={`flex items-center gap-1.5 t-caption font-semibold ${trend.className}`}>
                    <Icon name={trend.icon} size="sm" aria-hidden="true" />
                    {trend.label}
                  </div>
                  <div role="gridcell" className="flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => onOpenWorkspace(workspace.id)}>
                      Open <Icon name="arrowRight" size="sm" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {expanded && (
                  <div role="row">
                    <div
                      id={`outcome-evidence-${workspace.id}`}
                      role="gridcell"
                      aria-colspan={6}
                      className="border-t border-[var(--brand-border)] bg-[var(--surface-1)] px-[18px] py-4"
                    >
                      <div className="grid gap-x-8 md:grid-cols-2">
                        <DefinitionList items={[
                          {
                            label: 'Attribution',
                            value: workspace.outcomeValue
                              ? `${workspace.outcomeValue.platformExecuted} platform · ${workspace.outcomeValue.externallyExecuted} client-side`
                              : '—',
                          },
                          { label: 'Average search position', value: workspace.gscRollup?.dataAvailable ? workspace.gscRollup.avgPosition.toFixed(1) : '—' },
                          { label: 'Open site issues', value: formatNumber(workspace.siteHealthIssueMatrix?.totalIssues) },
                          { label: 'Win rate (all-time)', value: outcome && outcome.scoredLast30d > 0 ? percent(outcome.winRate * 100) : '—' },
                        ]} />
                        <DefinitionList items={[
                          { label: 'Active actions', value: formatNumber(outcome?.activeActions) },
                          { label: 'Scored in 30 days', value: formatNumber(outcome?.scoredLast30d) },
                          {
                            label: 'Measured coverage',
                            value: outcome?.coverage && outcome.coverage.tracked > 0
                              ? `${outcome.coverage.measured} / ${outcome.coverage.tracked}`
                              : '—',
                          },
                          { label: 'Attention', value: attentionBadge(outcome) },
                        ]} />
                      </div>

                      {issues.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--brand-border)] pt-3">
                          <span className="mr-1 t-caption-sm font-semibold text-[var(--brand-text-muted)]">Issue matrix</span>
                          {issues.map((issue) => (
                            <Badge
                              key={`${issue.issueType}-${issue.severity}`}
                              label={`${issue.label}: ${issue.count}`}
                              tone={issue.severity === 'error' ? 'red' : issue.severity === 'warning' ? 'amber' : 'blue'}
                              variant="soft"
                            />
                          ))}
                        </div>
                      )}

                      {outcome?.attentionReason && (
                        <InlineBanner
                          tone="warning"
                          size="sm"
                          className="mt-3"
                          title="Why this workspace needs attention"
                          message={outcome.attentionReason}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
