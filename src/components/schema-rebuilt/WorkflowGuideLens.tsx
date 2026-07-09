// @ds-rebuilt
import { BarChart3, CheckCircle, Eye, FileText, Globe, Gauge, Layers, Sparkles, Target } from 'lucide-react';
import { Badge, GroupBlock, Icon, WorkflowStepper } from '../ui';

const GUIDE_STEPS = [
  {
    number: 1,
    label: 'Scan',
    title: 'Scan the site',
    icon: Sparkles,
    accent: 'var(--teal)',
    description: 'Crawl the site, read the active schema plan, and detect which pages need structured data.',
    actions: ['Generate the site plan first', 'Confirm canonical entities', 'Start from pages missing schema'],
  },
  {
    number: 2,
    label: 'Review',
    title: 'Review generated page roles',
    icon: Eye,
    accent: 'var(--blue)',
    description: 'Check page types, existing JSON-LD, profile gaps, and recommendations before publishing anything.',
    actions: ['Review existing-schema badges', 'Open profile-completeness gaps', 'Confirm page type hints'],
  },
  {
    number: 3,
    label: 'Edit',
    title: 'Edit the JSON-LD workspace',
    icon: Target,
    accent: 'var(--amber)',
    description: 'Fine-tune generated schema, compare current markup, and save safe templates when needed.',
    actions: ['Regenerate single pages as needed', 'Compare existing and suggested schema', 'Save homepage schema as a template'],
  },
  {
    number: 4,
    label: 'Publish',
    title: 'Publish or send for approval',
    icon: Globe,
    accent: 'var(--teal)',
    description: 'Publish to Webflow or CMS fields only after graph safety and client-review needs are clear.',
    actions: ['Fix graph errors before bulk publish', 'Publish CMS pages through mapped fields', 'Send to client when approval is needed'],
  },
  {
    number: 5,
    label: 'Validate',
    title: 'Validate and measure impact',
    icon: Gauge,
    accent: 'var(--emerald)',
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
    <div className="flex max-w-5xl flex-col gap-5">
      <section aria-label="Schema guide workflow" className="flex flex-col gap-5">
        <WorkflowStepper
          compact
          steps={GUIDE_STEPS.map((step, index) => ({
            number: index + 1,
            label: step.label,
            completed: index < 1,
            current: index === 1,
          }))}
        />

        <div className="grid gap-3 xl:grid-cols-2">
          {GUIDE_STEPS.map((step) => (
            <GroupBlock
              key={step.number}
              icon={step.icon}
              iconColor={step.accent}
              title={step.title}
              flag={{ label: `Step ${step.number}`, color: step.accent }}
              headingLevel="h2"
            >
              <div className="flex flex-col gap-3 p-2">
                <p className="px-3 pt-1 t-body text-[var(--brand-text)]">{step.description}</p>
                {step.actions.map((action) => (
                  <div key={action} className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
                    <Icon as={CheckCircle} size="sm" style={{ color: step.accent }} />
                    <span className="t-ui text-[var(--brand-text)]">{action}</span>
                  </div>
                ))}
              </div>
            </GroupBlock>
          ))}
        </div>
      </section>

      <GroupBlock
        icon={Layers}
        iconColor="var(--teal)"
        title="What the pipeline applies automatically"
        stats={[{ label: 'Contracts', value: AUTOMATION.length }]}
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
        </div>
      </GroupBlock>

      <GroupBlock
        icon={FileText}
        iconColor="var(--amber)"
        title="Client review handoff"
      >
        <div className="flex flex-col gap-3 p-2">
          <p className="px-3 pt-1 t-body text-[var(--brand-text)]">Schema plans and page-level schema reviews stay in Inbox &gt; Reviews, so clients see the same approval path as other deliverables.</p>
          <div className="flex flex-wrap gap-2">
            <Badge label="Page schema review" tone="zinc" variant="outline" size="sm" />
            <Badge label="Schema plan approval" tone="zinc" variant="outline" size="sm" />
            <Badge label="Entity grounding protected" tone="teal" variant="outline" size="sm" />
            <Badge label="Inbox Reviews" tone="amber" variant="outline" size="sm" />
          </div>
        </div>
      </GroupBlock>

      <GroupBlock
        icon={BarChart3}
        iconColor="var(--blue)"
        title="Measurement sequence"
      >
        <p className="p-2 px-3 t-body text-[var(--brand-text)]">Deploy, wait for Search Console data, then use the measured impact panel.</p>
      </GroupBlock>
    </div>
  );
}
