/**
 * R2-B — "What we're working on" section for the client Overview tab.
 *
 * Three stacked zones per spec §1:
 *  1. Live now — running client-visible jobs with progress bars (blue = data).
 *  2. Recent work — last 14 days of client-visible activity, grouped by day.
 *  3. This month in numbers — actions taken, pages touched, briefs produced.
 *
 * All tiers including free. Mounted behind the `client-work-feed` feature flag.
 */
import { useMemo } from 'react';
import { Briefcase, CheckCircle2, FileText, Zap } from 'lucide-react';
import { SectionCard, EmptyState, Icon } from '../ui';
import { getBackgroundJobLabel } from '../../../shared/types/background-jobs.js';
import { getAgencyActivityLabel } from '../../../shared/types/agency-activity.js';
import { useClientActivityFeed, useClientJobs } from '../../hooks/client/useClientWorkFeed.js';
import type { ClientActivityEntry, ClientJobEntry } from '../../api/analytics.js';

interface AgencyWorkFeedProps {
  workspaceId: string;
}

// Only surface active jobs (pending + running) in the live-now section.
function isActiveJob(job: ClientJobEntry): boolean {
  return job.status === 'pending' || job.status === 'running';
}

// Group activity entries by calendar date label (e.g. "Jun 12").
function groupByDay(
  entries: ClientActivityEntry[],
): Array<{ label: string; items: ClientActivityEntry[] }> {
  const map = new Map<string, ClientActivityEntry[]>();
  for (const entry of entries) {
    const label = new Date(entry.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const existing = map.get(label);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(label, [entry]);
    }
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

// Filter to the last 14 days.
function last14Days(entries: ClientActivityEntry[]): ClientActivityEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  return entries.filter((e) => new Date(e.createdAt) >= cutoff);
}

// Derive "this month in numbers" stats from activity entries.
function deriveMonthStats(entries: ClientActivityEntry[]): {
  actionsTaken: number;
  pagesLikelyTouched: number;
  briefsProduced: number;
} {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const thisMonth = entries.filter((e) => new Date(e.createdAt) >= startOfMonth);

  const PAGE_TOUCH_TYPES = new Set([
    'seo_updated', 'images_optimized', 'links_fixed', 'content_updated',
    'approval_applied', 'fix_completed', 'content_published',
  ]);
  const BRIEF_TYPES = new Set(['brief_generated', 'brief_approved', 'brief_sent_for_review']);

  return {
    actionsTaken: thisMonth.length,
    pagesLikelyTouched: thisMonth.filter((e) => PAGE_TOUCH_TYPES.has(e.type)).length,
    briefsProduced: thisMonth.filter((e) => BRIEF_TYPES.has(e.type)).length,
  };
}

export function AgencyWorkFeed({ workspaceId }: AgencyWorkFeedProps) {
  const { data: jobs = [], isLoading: jobsLoading } = useClientJobs(workspaceId);
  const { data: allActivity = [], isLoading: activityLoading } = useClientActivityFeed(workspaceId, 60);

  const activeJobs = useMemo(() => jobs.filter(isActiveJob), [jobs]);
  const recentActivity = useMemo(() => last14Days(allActivity), [allActivity]);
  const groupedDays = useMemo(() => groupByDay(recentActivity), [recentActivity]);
  const monthStats = useMemo(() => deriveMonthStats(allActivity), [allActivity]);

  const isLoading = jobsLoading || activityLoading;
  const hasAnything = activeJobs.length > 0 || recentActivity.length > 0;

  return (
    <SectionCard
      title="What we're working on"
      titleIcon={<Icon as={Briefcase} size="md" className="text-accent-brand" />}
    >
      {/* ── 1. Live now ─────────────────────────────────────────── */}
      {activeJobs.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-1">
            Live now
          </p>
          {activeJobs.map((job) => {
            const label = getBackgroundJobLabel(job.type);
            const pct =
              job.progress != null && job.total != null && job.total > 0
                ? Math.round((job.progress / job.total) * 100)
                : null;
            return (
              <div
                key={job.id}
                className="px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/60"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    {/* Pulsing teal dot — live indicator */}
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-[var(--radius-pill)] bg-teal-400 opacity-75" />
                      <span className="relative inline-flex rounded-[var(--radius-pill)] h-2 w-2 bg-teal-500" />
                    </span>
                    <span className="t-caption font-medium text-[var(--brand-text-bright)]">{label}</span>
                  </div>
                  {pct != null && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{pct}%</span>
                  )}
                </div>
                {/* Blue progress bar — data per the Four Laws */}
                {pct != null && (
                  <div className="w-full h-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-[var(--radius-pill)] bg-blue-500 transition-all duration-500"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                )}
                {job.message && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 line-clamp-1">{job.message}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 2. Recent work (last 14 days) ───────────────────────── */}
      {recentActivity.length > 0 ? (
        <div className="space-y-4">
          {groupedDays.map(({ label: dayLabel, items }) => (
            <div key={dayLabel}>
              <p className="t-caption-sm font-semibold text-[var(--brand-text-faint)] uppercase tracking-wider mb-1.5">
                {dayLabel}
              </p>
              <div className="space-y-1.5">
                {items.slice(0, 5).map((entry) => {
                  const { tag, narrative } = getAgencyActivityLabel(entry.type);
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2.5 py-1"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <Icon
                          as={CheckCircle2}
                          size="sm"
                          className="text-emerald-400"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span /* badge-span-ok: inline count chip flows with caption text; Badge's fixed footprint breaks line rhythm */ className="t-caption-sm font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 text-accent-brand mr-1.5">
                          {tag}
                        </span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)]">
                          {narrative}
                          {entry.title && entry.title !== narrative ? ` — ${entry.title}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : !isLoading && !hasAnything ? (
        <EmptyState
          icon={Briefcase}
          title="Work starts soon"
          description="Once your first audit runs or changes are applied, you'll see your agency's work here."
        />
      ) : null}

      {/* ── 3. This month in numbers ────────────────────────────── */}
      {monthStats.actionsTaken > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--brand-border)]/50">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-2">
            This month
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5">
              <Icon as={Zap} size="sm" className="text-blue-400 flex-shrink-0" />
              <span className="t-caption font-semibold text-[var(--brand-text-bright)]">
                {monthStats.actionsTaken}
              </span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">actions</span>
            </div>
            {monthStats.pagesLikelyTouched > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon as={CheckCircle2} size="sm" className="text-emerald-400 flex-shrink-0" />
                <span className="t-caption font-semibold text-[var(--brand-text-bright)]">
                  {monthStats.pagesLikelyTouched}
                </span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">pages touched</span>
              </div>
            )}
            {monthStats.briefsProduced > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon as={FileText} size="sm" className="text-teal-400 flex-shrink-0" />
                <span className="t-caption font-semibold text-[var(--brand-text-bright)]">
                  {monthStats.briefsProduced}
                </span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">briefs</span>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
