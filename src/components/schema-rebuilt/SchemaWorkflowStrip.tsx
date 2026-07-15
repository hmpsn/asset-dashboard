// @ds-rebuilt
import { Icon, SectionCard } from '../ui';

interface SchemaWorkflowStripProps {
  loading?: boolean;
}

const STEPS = ['Scan', 'Review', 'Edit', 'Publish', 'Validate'] as const;

export function SchemaWorkflowStrip({ loading = false }: SchemaWorkflowStripProps) {
  return (
    <SectionCard
      noPadding
      variant="subtle"
      className="min-h-[50px]"
    >
      <nav
        aria-label="Schema workflow steps"
        className="overflow-x-auto px-[18px] py-3"
        data-testid="schema-workflow-strip"
      >
        <ol className="flex min-w-[610px] items-center" role="list">
          {STEPS.map((label, index) => {
            const completed = !loading && index === 0;
            const current = loading ? index === 0 : index === 1;
            return (
              <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
                <div
                  className="flex flex-none items-center gap-2"
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Step ${index + 1}: ${label}${completed ? ' (completed)' : current ? ' (current)' : ''}`}
                >
                  <span
                    className={[
                      'flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-pill)] border t-caption-sm font-bold',
                      completed
                        ? 'border-[var(--emerald)] bg-[color-mix(in_srgb,var(--emerald)_10%,transparent)] text-[var(--emerald)]'
                        : current
                          ? 'border-[var(--teal)] bg-[var(--brand-mint-dim)] text-[var(--teal)]'
                          : 'border-[var(--brand-border-strong)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]',
                    ].join(' ')}
                  >
                    {completed ? <Icon name="check" size="sm" /> : index + 1}
                  </span>
                  <span className={`t-caption font-semibold ${completed || current ? 'text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)]'}`}>
                    {label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <span
                    className={`mx-3 h-px min-w-3 flex-1 ${completed ? 'bg-[var(--emerald)]' : 'bg-[var(--brand-border-strong)]'}`}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </SectionCard>
  );
}
