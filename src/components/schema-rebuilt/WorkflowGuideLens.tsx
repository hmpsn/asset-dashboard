// @ds-rebuilt
import { CheckCircle, Layers } from 'lucide-react';
import { Badge, GroupBlock, Icon, SectionCard } from '../ui';

const GUIDE_STEPS = [
  {
    number: 1,
    label: 'Scan',
    title: 'Scan the site',
    description: 'Crawl the site, read the active schema plan, and detect which pages need structured data.',
    actions: ['Generate the site plan first', 'Confirm canonical entities', 'Start from pages missing schema'],
  },
  {
    number: 2,
    label: 'Review',
    title: 'Review generated page roles',
    description: 'Check page types, existing JSON-LD, profile gaps, and recommendations before publishing anything.',
    actions: ['Review existing-schema badges', 'Open profile-completeness gaps', 'Confirm page type hints'],
  },
  {
    number: 3,
    label: 'Edit',
    title: 'Edit the JSON-LD workspace',
    description: 'Fine-tune generated schema, compare current markup, and save safe templates when needed.',
    actions: ['Regenerate single pages as needed', 'Compare existing and suggested schema', 'Save homepage schema as a template'],
  },
  {
    number: 4,
    label: 'Publish',
    title: 'Publish or send for approval',
    description: 'Publish to Webflow or CMS fields only after graph safety and client-review needs are clear.',
    actions: ['Fix graph errors before bulk publish', 'Publish CMS pages through mapped fields', 'Send to client when approval is needed'],
  },
  {
    number: 5,
    label: 'Validate',
    title: 'Validate and measure impact',
    description: 'Validate the final graph, keep rollback available, and read Search Console impact after the measurement window.',
    actions: ['Run whole-site graph validation', 'Use version history and rollback', 'Review measured deltas in reporting'],
  },
] as const;

const AUTOMATION = [
  'Architecture-aware BreadcrumbList output',
  'Active schema-plan role authority',
  'CMS field evidence for location and service pages',
  'Content verification against page HTML',
  'Whole-site graph validation before bulk publish',
  'Version history and rollback after publish',
  'Client approval batches with reviewed schema snapshots',
  'Automation actions use the same reviewed schema workflow',
] as const;

export function WorkflowGuideLens() {
  return (
    <div className="flex flex-col gap-[14px]">
      <section aria-label="Schema guide workflow">
        <SectionCard
          noPadding
          variant="subtle"
        >
          <div className="px-6 py-[22px]">
            {/* stat-primitive-ok -- prototype guide heading uses the 18px display role; this is not a metric shell. */}
            <h2 className="t-stat-sm font-bold text-[var(--brand-text-bright)]">The structured-data workflow</h2>
            <p className="mt-1.5 max-w-[64ch] t-ui leading-[1.55] text-[var(--brand-text)]">
              Structured data is how a page tells Google and AI engines exactly what it is. Five steps take a page from invisible to rich-result-ready.
            </p>
          </div>
          <div data-testid="schema-guide-card" className="pb-[22px]">
            {GUIDE_STEPS.map((step) => (
              <div
                key={step.number}
                data-testid="schema-guide-step"
                className="mx-6 flex gap-[14px] border-t border-[var(--brand-border)] py-[15px]"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-mint-dim)] t-caption font-bold text-[var(--teal)]">
                  {step.number}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-1 t-ui font-semibold text-[var(--brand-text-bright)]">
                    <span>{step.label}</span>
                    <span className="font-normal text-[var(--brand-text-muted)]">· {step.title}</span>
                  </div>
                  <p className="mt-1 t-ui text-[var(--brand-text)]">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <GroupBlock
        icon={Layers}
        iconColor="var(--teal)"
        title="Production safeguards"
        meta="Automation, approval, grounding, rollback, and measurement details."
        stats={[
          { label: 'Client review handoff', value: 'Inbox' },
          { label: 'Checks', value: AUTOMATION.length },
        ]}
        collapsible
        defaultOpen={false}
      >
        <div className="flex flex-col gap-3 p-2">
          <p className="px-3 pt-1 t-body text-[var(--brand-text)]">The page shows these safeguards when generation, validation, publishing, and client review run.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {AUTOMATION.map((item) => (
              <div key={item} className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
                <Icon as={CheckCircle} size="sm" style={{ color: 'var(--emerald)' }} />
                <span className="t-ui text-[var(--brand-text)]">{item}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--brand-border)] px-3 pt-3">
            <p className="t-body text-[var(--brand-text)]">Schema plans and page-level reviews stay in Inbox &gt; Reviews. Deployments remain measurable after the Search Console comparison window.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge label="Page schema review" tone="zinc" variant="outline" size="sm" />
              <Badge label="Schema plan approval" tone="zinc" variant="outline" size="sm" />
              <Badge label="Entity grounding protected" tone="teal" variant="outline" size="sm" />
              <Badge label="Version history and rollback" tone="amber" variant="outline" size="sm" />
            </div>
          </div>
        </div>
      </GroupBlock>
    </div>
  );
}
