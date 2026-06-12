/**
 * OvDivergencePanel — admin-only diagnostic for the Opportunity Value (OV)
 * shadow-log.
 *
 * "Opportunity Value" is a grounded recommendation scorer running in SHADOW mode.
 * On every recommendation generation the system records how the LEGACY ranking
 * diverges from the OV ranking into the `ov_divergence` table. This panel is the
 * decision instrument for flipping OV on: it surfaces (a) how often OV agrees with
 * legacy, and (b) when they disagree, whether OV's pick looks better
 * (higher confidence / EMV / grounding) or shows red flags.
 *
 * Admin-only — NO client exposure. No feature flag (read-only diagnostic on
 * always-collected shadow data). Per-workspace, faithful to the existing endpoint;
 * a cross-workspace rollup is out of scope (would need a new endpoint).
 */

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRightLeft, ChevronDown, ChevronUp, ShieldOff } from 'lucide-react';
import { useOvDivergence } from '../../hooks/admin/useOvDivergence';
import { SectionCard } from '../ui/SectionCard';
import { CompactStatBar } from '../ui/StatCard';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ClickableRow } from '../ui/ClickableRow';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { ErrorState } from '../ui/ErrorState';
import type { OvDivergence, Top3Entry } from '../../../server/ov-divergence.js';

interface Props {
  workspaceId: string;
  /** Render collapsed by default (it's a diagnostic — unobtrusive). */
  defaultCollapsed?: boolean;
}

/** Agree-rate thresholds for the health-read coloring (Four Laws: emerald/amber/red). */
const AGREE_RATE_HIGH = 80; // ≥ → emerald (healthy convergence)
const AGREE_RATE_LOW = 50; // ≥ → amber, < → red

function agreeRateColorClass(ratePct: number): string {
  if (ratePct >= AGREE_RATE_HIGH) return 'text-emerald-400';
  if (ratePct >= AGREE_RATE_LOW) return 'text-amber-400';
  return 'text-red-400';
}

/** Find the Top3Entry whose id matches the recorded top-rec id (legacy or OV). */
function findTopEntry(top3: Top3Entry[], topRecId: string | null): Top3Entry | undefined {
  if (!topRecId) return undefined;
  return top3.find((e) => e.id === topRecId);
}

function pickTitle(entry: Top3Entry | undefined, fallbackId: string | null): string {
  if (entry) return entry.title;
  if (fallbackId) return fallbackId;
  return 'No pick';
}

function fmtConfidence(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function fmtEmv(v: number | null): string {
  return v == null ? '—' : `$${Math.round(v).toLocaleString()}/wk`;
}

/** Short label for a priority tier (compact divergence display). */
const TIER_LABEL: Record<NonNullable<Top3Entry['priority']>, string> = {
  fix_now: 'Fix now',
  fix_soon: 'Fix soon',
  fix_later: 'Fix later',
  ongoing: 'Ongoing',
};

function fmtTier(p: Top3Entry['priority']): string {
  return p ? TIER_LABEL[p] : '—';
}

function Top3Column({ label, entries }: { label: string; entries: Top3Entry[] }) {
  return (
    <div className="min-w-0">
      <p className="t-label text-[var(--brand-text-muted)] mb-1.5">{label}</p>
      {entries.length === 0 ? (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">No active recommendations</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((e, i) => (
            <li key={e.id} className="flex items-baseline gap-1.5 t-caption-sm">
              <span className="text-[var(--brand-text-muted)] tabular-nums w-3.5 flex-shrink-0">{i + 1}</span>
              <span className="text-[var(--brand-text)] truncate" title={e.title}>{e.title}</span>
              {/* P4 (G1): the tier this entry carries in the ranked clone — blue = data (read-only). */}
              {e.priority && (
                <Badge tone="blue" variant="soft" shape="sm" label={fmtTier(e.priority)} />
              )}
              <span className="text-[var(--brand-text-muted)] tabular-nums flex-shrink-0 ml-auto">
                {Math.round(e.impactScore)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DisagreementRow({ row }: { row: OvDivergence }) {
  const [open, setOpen] = useState(false);

  const legacyPick = findTopEntry(row.legacyTop3, row.legacyTopRecId);
  const ovPick = findTopEntry(row.ovTop3, row.ovTopRecId);
  const legacyTitle = pickTitle(legacyPick, row.legacyTopRecId);
  const ovTitle = pickTitle(ovPick, row.ovTopRecId);

  return (
    <div className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden">
      <ClickableRow active={open} onClick={() => setOpen((v) => !v)} className="p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="t-caption-sm text-[var(--brand-text-muted)]">Legacy #1</span>
              <span className="t-ui text-[var(--brand-text)] truncate" title={legacyTitle}>{legacyTitle}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">→ OV #1</span>
              <span className="t-ui text-[var(--brand-text-bright)] truncate" title={ovTitle}>{ovTitle}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* P4 (G1): cross-tier reorder badge — surfaces when OV moves the #1 to a
                  different priority tier than legacy (the divergence the panel exists to catch). */}
              {legacyPick?.priority && ovPick?.priority && legacyPick.priority !== ovPick.priority && (
                <Badge
                  tone="amber"
                  variant="soft"
                  shape="sm"
                  icon={ArrowRightLeft}
                  label={`tier ${fmtTier(legacyPick.priority)} → ${fmtTier(ovPick.priority)}`}
                />
              )}
              {/* OV pick quality signals — blue = data (read-only). */}
              <Badge tone="blue" variant="soft" shape="sm" label={`conf ${fmtConfidence(row.ovTopConfidence)}`} />
              <Badge tone="blue" variant="soft" shape="sm" label={`EMV ${fmtEmv(row.ovTopEmv)}`} />
              {row.ovTopGroundedSpine && (
                <Badge tone="blue" variant="soft" shape="sm" label={`spine: ${row.ovTopGroundedSpine}`} />
              )}
              {row.ovTopRecId == null && (
                <Badge tone="red" variant="soft" shape="sm" icon={ShieldOff} label="OV no pick" />
              )}
              {row.invariantHeld ? (
                <Badge tone="emerald" variant="soft" shape="sm" label="invariant held" />
              ) : (
                <Badge tone="red" variant="soft" shape="sm" icon={AlertTriangle} label="invariant broken" />
              )}
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </ClickableRow>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--brand-border)] bg-[var(--surface-2)]/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <Top3Column label="Legacy top 3" entries={row.legacyTop3} />
            <Top3Column label="OV top 3" entries={row.ovTop3} />
          </div>
          {row.perRecDelta.length > 0 && (
            <div>
              <p className="t-label text-[var(--brand-text-muted)] mb-1.5">Per-rec score: legacy → OV</p>
              <ul className="space-y-0.5">
                {row.perRecDelta.map((d) => (
                  <li key={d.id} className="flex items-baseline gap-2 t-caption-sm">
                    <span className="text-[var(--brand-text)] truncate flex-1 min-w-0" title={d.id}>{d.id}</span>
                    <span className="text-[var(--brand-text-muted)] tabular-nums flex-shrink-0">
                      {Math.round(d.legacy)} → {d.ov == null ? '—' : Math.round(d.ov)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OvDivergencePanel({ workspaceId, defaultCollapsed = true }: Props) {
  const { data, isLoading, isError, refetch } = useOvDivergence(workspaceId);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const stats = useMemo(() => {
    const total = rows.length;
    const agreeCount = rows.filter((r) => r.agree).length;
    const agreeRatePct = total > 0 ? Math.round((agreeCount / total) * 100) : 0;
    const invariantBroken = rows.filter((r) => !r.invariantHeld).length;
    const ovNoPick = rows.filter((r) => r.ovTopRecId == null).length;
    const disagreements = rows.filter((r) => !r.agree);
    return { total, agreeCount, agreeRatePct, invariantBroken, ovNoPick, disagreements };
  }, [rows]);

  return (
    <SectionCard
      title="OV Divergence (historical shadow)"
      titleIcon={<Activity className="w-4 h-4 text-blue-400" aria-hidden="true" />}
      titleExtra={
        stats.total > 0 ? (
          <Badge tone="zinc" variant="soft" shape="sm" label={`${stats.total} recent`} />
        ) : undefined
      }
      action={
        <Button
          variant="ghost"
          size="sm"
          icon={collapsed ? ChevronDown : ChevronUp}
          iconPosition="right"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        >
          {collapsed ? 'Show' : 'Hide'}
        </Button>
      }
    >
      {collapsed ? (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Shadow-mode diagnostic comparing the legacy recommendation ranking with the Opportunity Value
          ranking. Expand to review the agree rate and disagreements before flipping OV on.
        </p>
      ) : isLoading ? (
        <LoadingState message="Loading OV divergence shadow log…" />
      ) : isError ? (
        <ErrorState
          type="data"
          title="Couldn't load OV divergence"
          message="Something went wrong loading the shadow log. Try again."
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : stats.total === 0 ? (
        <EmptyState
          icon={Activity}
          title="No divergence recorded yet"
          description="The OV shadow log fills in as recommendations are generated for this workspace. Check back after the next generation."
        />
      ) : (
        <div className="space-y-4">
          {/* ── Headline: agree rate + red-flag counts ── */}
          <CompactStatBar
            items={[
              {
                label: 'Agree rate',
                value: `${stats.agreeRatePct}%`,
                valueColor: agreeRateColorClass(stats.agreeRatePct),
                sub: `${stats.agreeCount} / ${stats.total}`,
              },
              {
                label: 'Invariant broken',
                value: stats.invariantBroken,
                valueColor: stats.invariantBroken > 0 ? 'text-red-400' : 'text-[var(--brand-text-bright)]',
              },
              {
                label: 'OV no pick',
                value: stats.ovNoPick,
                valueColor: stats.ovNoPick > 0 ? 'text-red-400' : 'text-[var(--brand-text-bright)]',
              },
            ]}
          />
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            OV agrees with legacy in {stats.agreeCount} of {stats.total} recent generations ({stats.agreeRatePct}%).
            {stats.invariantBroken > 0 && ` ${stats.invariantBroken} invariant-broken (red flag).`}
            {stats.ovNoPick > 0 && ` ${stats.ovNoPick} with no OV pick (red flag).`}
          </p>

          {/* ── Disagreement list ── */}
          <div>
            <p className="t-label text-[var(--brand-text-muted)] mb-2">
              Disagreements ({stats.disagreements.length})
            </p>
            {stats.disagreements.length === 0 ? (
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                OV agreed with legacy on every recent generation. No disagreements to review.
              </p>
            ) : (
              <div className="space-y-2">
                {stats.disagreements.map((row) => (
                  <DisagreementRow key={row.id} row={row} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
