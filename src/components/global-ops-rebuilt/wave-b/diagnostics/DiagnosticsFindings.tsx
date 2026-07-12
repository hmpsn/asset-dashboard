// @ds-rebuilt
import type { RemediationAction, RootCause } from '../../../../../shared/types/diagnostics';
import { Badge, Icon, SectionCard } from '../../../ui';

const CONFIDENCE_TONE = {
  high: 'red',
  medium: 'amber',
  low: 'zinc',
} as const;

const PRIORITY_TONE = {
  P0: 'red',
  P1: 'amber',
  P2: 'blue',
  P3: 'zinc',
} as const;

const EFFORT_LABEL = {
  low: 'Low effort',
  medium: 'Med effort',
  high: 'High effort',
} as const;

const IMPACT_LABEL = {
  high: 'High impact',
  medium: 'Med impact',
  low: 'Low impact',
} as const;

function RootCauseRow({ cause }: { cause: RootCause }) {
  return (
    <SectionCard className="!rounded-[var(--radius-lg)]" noPadding>
      <div className="flex items-start gap-[14px] px-[18px] py-[15px]">
        <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] t-caption font-bold tabular-nums text-[var(--brand-text-bright)]">
          {cause.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <h3 className="min-w-0 flex-1 t-caption font-semibold text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>{cause.title}</h3>
            <Badge
              label={`${cause.confidence} confidence`}
              tone={CONFIDENCE_TONE[cause.confidence]}
              shape="pill"
              className="!uppercase !tracking-[0.04em]"
            />
          </div>
          <p className="mt-1.5 t-caption leading-[1.55] text-[var(--brand-text)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>{cause.explanation}</p>
          {cause.evidence.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 t-caption-sm font-medium text-[var(--blue)] hover:text-[var(--teal)]">
                <Icon name="chevronDown" size="sm" className="transition-transform group-open:rotate-180" style={{ transitionDuration: 'var(--dur-fast)' }} aria-hidden="true" />
                {cause.evidence.length} evidence point{cause.evidence.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-1.5 border-l border-[var(--brand-border)] pl-3">
                {cause.evidence.map((evidence, index) => (
                  <li key={`${cause.rank}-${index}`} className="t-caption-sm leading-relaxed text-[var(--brand-text-muted)]">{evidence}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function DiagnosticsRootCauses({ causes }: { causes: RootCause[] }) {
  if (causes.length === 0) return null;

  return (
    <section aria-labelledby="diagnostics-root-causes-heading">
      <h2 id="diagnostics-root-causes-heading" className="mb-3 t-micro font-semibold uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">
        Root causes
      </h2>
      <div className="space-y-2.5">{causes.map((cause) => <RootCauseRow key={cause.rank} cause={cause} />)}</div>
    </section>
  );
}

export function DiagnosticsRemediationPlan({ actions }: { actions: RemediationAction[] }) {
  if (actions.length === 0) return null;

  const sorted = [...actions].sort((left, right) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
    return order[left.priority] - order[right.priority];
  });

  return (
    <section aria-labelledby="diagnostics-remediation-heading">
      <h2 id="diagnostics-remediation-heading" className="mb-3 t-micro font-semibold uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">
        Remediation plan
      </h2>
      <SectionCard noPadding className="overflow-hidden !rounded-[var(--radius-lg)]">
        {sorted.map((action, index) => (
          <div key={`${action.priority}-${action.title}`} className="flex flex-col gap-3 border-t border-[var(--brand-border)] px-[18px] py-[13px] first:border-t-0 sm:flex-row sm:items-center">
            <span className="inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[var(--radius-pill)] border border-[var(--brand-border-hover)] t-caption-sm font-bold tabular-nums text-[var(--brand-text)]">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="t-caption font-semibold text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>{action.title}</h3>
              <p className="mt-0.5 t-caption-sm leading-relaxed text-[var(--brand-text-muted)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>{action.description}</p>
              {action.pageUrls && action.pageUrls.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {action.pageUrls.map((url) => <span key={url} className="max-w-full truncate rounded-[var(--radius-sm)] bg-[var(--surface-1)] px-1.5 py-0.5 t-caption-sm font-mono text-[var(--blue)]">{url}</span>)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:max-w-[260px] sm:justify-end">
              <Badge label={action.priority} tone={PRIORITY_TONE[action.priority]} />
              <Badge label={EFFORT_LABEL[action.effort]} tone="zinc" />
              <Badge label={IMPACT_LABEL[action.impact]} tone={action.impact === 'high' ? 'emerald' : action.impact === 'medium' ? 'blue' : 'zinc'} />
              <Badge label={action.owner.toUpperCase()} tone="zinc" />
            </div>
          </div>
        ))}
      </SectionCard>
    </section>
  );
}
