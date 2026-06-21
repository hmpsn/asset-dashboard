/**
 * ConversionTrackingReadout — The Issue (Client) P1a admin verification readout (REUSABLE).
 *
 * ⬛ ADMIN-REFRAME ALIGNMENT #1 (highest-leverage): this is a SELF-CONTAINED, reusable component, NOT
 * inline JSX welded to the Settings tab. The later (deferred) admin reframe's cockpit "integrity strip"
 * and the portfolio setup-column will consume THIS SAME component, so the reframe is a re-mount, not a
 * rewrite. Everything it needs arrives via props — it reads no workspace context directly.
 *
 * Renders the integrity surface: value/basis · segment · pinned+typed events · forms-connected ·
 * last-lead freshness · resolved provenance. Plus (ALIGNMENT #2) an OnboardingStep-shaped setup
 * checklist whose ordering + completion model is drop-in compatible with the OnboardingChecklist
 * primitive (the future cockpit can pass these same steps into that modal).
 *
 * Color (Four Laws): teal = connected/active pill; amber = not-connected warning; blue = read-only
 * count metrics; emerald = the measured-provenance affirmation. No purple (admin AI only, not here).
 */
import { CheckCircle, Circle, ArrowRight } from 'lucide-react';
import { SectionCard, ClickableRow } from '../ui';
import { timeAgo } from '../../lib/timeAgo';
import type { OutcomeProvenance } from '../../../shared/types/outcome-tracking';

/** OnboardingStep-shaped (ALIGNMENT #2) — drop-in for the OnboardingChecklist primitive later. */
export interface ConversionSetupStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  /**
   * P1b (Lane B): optional one-click deep-link to the gap-fix surface. When present, an incomplete
   * step renders as an actionable button (label hover-steps + trailing arrow). ADDITIVE — when
   * absent the step renders as today's static row (byte-identical for the P1a Settings consumer).
   * Converges ConversionSetupStep toward OnboardingStep (which already has onClick, ALIGNMENT #2).
   */
  onClick?: () => void;
}

export interface ConversionTrackingReadoutProps {
  /** Outcome value + basis line (value/basis), or null when no outcome value is set. */
  outcomeValue: { valuePerOutcome: number; unitLabel: string; currency: string; basisLabel: string } | null;
  /** Resolved client segment (human-readable, e.g. "b2b saas"). */
  segmentLabel: string;
  /** Pinned event count. */
  pinnedCount: number;
  /** Pinned events that also carry an outcomeType (typed). */
  typedCount: number;
  /** True only when setup is confirmed AND a signing secret exists. */
  formCaptureConnected: boolean;
  /** ISO timestamp of the most recent captured lead, or null. */
  lastSubmissionAt: string | null;
  /** Total captured leads. */
  submissionCount: number;
  /** The provenance the client number will resolve to (the ABSOLUTE flip — ALIGNMENT #4). */
  resolvedProvenance: OutcomeProvenance;
  /** Ordered setup steps (ALIGNMENT #2). */
  steps: ConversionSetupStep[];
  /** Whether the status query is still loading (shows a contextual message, not a spinner). */
  loading?: boolean;
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: 'blue' | 'emerald' | 'muted' }) {
  const valueColor = tone === 'emerald' ? 'text-emerald-400' : tone === 'blue' ? 'text-blue-400' : 'text-[var(--brand-text)]';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">{label}</span>
      <span className={`t-caption font-semibold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

export function ConversionTrackingReadout({
  outcomeValue,
  segmentLabel,
  pinnedCount,
  typedCount,
  formCaptureConnected,
  lastSubmissionAt,
  submissionCount,
  resolvedProvenance,
  steps,
  loading = false,
}: ConversionTrackingReadoutProps) {
  const isMeasured = resolvedProvenance === 'measured_action' || resolvedProvenance === 'actual_reconciled';

  return (
    <SectionCard noPadding>
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Conversion tracking</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">
            What earns the client a <span className="font-medium text-[var(--brand-text)]">measured</span> number instead of an estimate.
          </p>
        </div>
        {/* Resolved provenance pill — teal when measured (active/earned), zinc when still estimate. */}
        <span
          data-provenance={resolvedProvenance}
          className={`t-caption-sm font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border ${
            isMeasured
              ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
              : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]'
          }`}
        >
          {isMeasured ? 'Measured' : 'Estimate'}
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {loading ? (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Checking your conversion setup…</p>
        ) : (
          <>
            {/* Integrity rows */}
            <div className="divide-y divide-[var(--brand-border)]">
              <StatLine
                label="Outcome value"
                value={outcomeValue ? `${outcomeValue.currency} ${outcomeValue.valuePerOutcome.toLocaleString()} / ${outcomeValue.unitLabel} · ${outcomeValue.basisLabel}` : 'Not set'}
                tone="muted"
              />
              <StatLine label="Client segment" value={segmentLabel} tone="muted" />
              <StatLine label="Events pinned" value={`${pinnedCount} pinned · ${typedCount} typed`} tone="blue" />
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="t-caption-sm text-[var(--brand-text-muted)]">Webflow forms</span>
                <span
                  className={`t-caption-sm font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border ${
                    formCaptureConnected
                      ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}
                >
                  {formCaptureConnected ? 'Webflow forms connected' : 'Not connected'}
                </span>
              </div>
              <StatLine
                label="Last lead"
                value={lastSubmissionAt ? `${timeAgo(lastSubmissionAt)} · ${submissionCount} total` : 'None yet'}
                tone={lastSubmissionAt ? 'blue' : 'muted'}
              />
            </div>

            {/* Setup checklist (ALIGNMENT #2 — OnboardingStep-shaped, drop-in for the modal later) */}
            {steps.length > 0 && (
              <div className="pt-2 border-t border-[var(--brand-border)] space-y-1">
                {steps.map((step) => {
                  // P1b: an incomplete step WITH an onClick deep-links to its gap-fix surface (button);
                  // otherwise (or once completed) it stays today's static row — byte-identical for the
                  // existing P1a Settings consumer that passes no onClick.
                  const actionable = !step.completed && !!step.onClick;
                  const StepIcon = step.completed ? (
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-teal-400" />
                  ) : (
                    <Circle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--brand-text-disabled)]" />
                  );
                  // muted-tier-ok — a COMPLETED step label is tertiary done-state (dim + line-through),
                  // matching the OnboardingChecklist primitive's completed-step pattern.
                  const labelClass = `t-caption font-medium ${step.completed ? 'text-[var(--brand-text-dim)] line-through' : 'text-[var(--brand-text-bright)]'}`;
                  const body = (
                    <>
                      <div className={labelClass}>{step.label}</div>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">{step.description}</p>
                    </>
                  );
                  if (actionable) {
                    return (
                      <ClickableRow
                        key={step.id}
                        data-step-id={step.id}
                        onClick={step.onClick}
                        aria-label={`Fix: ${step.label}`}
                        className="group flex items-start gap-2.5 py-1.5 px-1 rounded-[var(--radius-sm)]"
                      >
                        {StepIcon}
                        <div className="min-w-0 flex-1">
                          {/* Hover MUST step one tier (--brand-text-bright is already the brightest). */}
                          <div className="t-caption font-medium text-[var(--brand-text)] group-hover:text-[var(--brand-text-bright)] flex items-center gap-1.5">
                            {step.label}
                            <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text)] transition-colors" />
                          </div>
                          <p className="t-caption-sm text-[var(--brand-text-muted)]">{step.description}</p>
                        </div>
                      </ClickableRow>
                    );
                  }
                  return (
                    <div key={step.id} data-step-id={step.id} className="flex items-start gap-2.5 py-1.5">
                      {StepIcon}
                      <div className="min-w-0">{body}</div>
                    </div>
                  );
                })}
                <p className="t-caption-sm leading-relaxed text-[var(--brand-text-muted)] pt-1">
                  Once a conversion is pinned, typed, and capturing real website actions, your client's number becomes{' '}
                  <span className="font-medium text-emerald-400">measured</span>, not estimated.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
