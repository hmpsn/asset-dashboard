// @ds-rebuilt
import { BarChart3, CheckCircle, Eye, FileText, Globe, Gauge, Layers, Sparkles, Target, Zap } from 'lucide-react';
import { Badge, GroupBlock, Icon, WorkflowStepper } from '../ui';

const GUIDE_STEPS = [
  {
    number: 1,
    label: 'Plan',
    title: 'Generate the schema plan',
    icon: Sparkles,
    accent: 'var(--teal)',
    description: 'Analyze the site to assign page roles and canonical entities before generating page JSON-LD.',
    actions: ['Generate Site Plan', 'Review roles and canonical entities', 'Send to client', 'Activate after approval'],
  },
  {
    number: 2,
    label: 'Coverage',
    title: 'Check coverage and profile gaps',
    icon: Eye,
    accent: 'var(--blue)',
    description: 'Use snapshot results and validation findings to understand what exists and what still needs structured data.',
    actions: ['Review existing-schema badges', 'Open profile-completeness gaps', 'Keep missing-schema counts absent until server-owned'],
  },
  {
    number: 3,
    label: 'Prioritize',
    title: 'Pick pages intentionally',
    icon: Target,
    accent: 'var(--amber)',
    description: 'Start with pages where schema clarifies services, locations, products, or high-value content.',
    actions: ['Set page type hints', 'Generate single pages as needed', 'Batch remaining pages after review'],
  },
  {
    number: 4,
    label: 'Generate',
    title: 'Generate structured data',
    icon: Zap,
    accent: 'var(--emerald)',
    description: 'Run the cancellable background scan or generate individual pages from the inventory picker.',
    actions: ['Use active plan context', 'Preserve saved page type hints', 'Clear stale manual edits after regeneration'],
  },
  {
    number: 5,
    label: 'Publish',
    title: 'Validate and publish safely',
    icon: Globe,
    accent: 'var(--teal)',
    description: 'Use the whole-site graph gate, page validation badges, CMS mapping, manual fallback, and history rollback before publishing.',
    actions: ['Fix graph errors before bulk publish', 'Publish CMS pages through mapped fields', 'Copy JSON-LD when manual delivery is required'],
  },
  {
    number: 6,
    label: 'Measure',
    title: 'Monitor impact',
    icon: Gauge,
    accent: 'var(--emerald)',
    description: 'Read the Search Console before/after deployment panel once a meaningful window exists.',
    actions: ['Wait for the measurement window', 'Review pending deployments', 'Use measured deltas in reporting'],
  },
] as const;

const AUTOMATION = [
  'Architecture-aware BreadcrumbList output',
  'Active schema-plan role authority',
  'CMS field evidence for location and service pages',
  'Content verification against page HTML',
  'Whole-site graph validation before bulk publish',
  'Version history and rollback after publish',
  'Client approval batches using frozen schema deliverables',
  'MCP parity through shared schema domain services',
] as const;

export function WorkflowGuideLens() {
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <WorkflowStepper
        compact
        steps={GUIDE_STEPS.slice(0, 5).map((step, index) => ({
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
            meta={step.description}
            flag={{ label: `Step ${step.number}`, color: step.accent }}
            headingLevel="h2"
          >
            <div className="flex flex-col gap-2 p-2">
              {step.actions.map((action) => (
                <div key={action} className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
                  <Icon as={CheckCircle} size="sm" style={{ color: step.accent }} />
                  <span className="t-caption text-[var(--brand-text)]">{action}</span>
                </div>
              ))}
            </div>
          </GroupBlock>
        ))}
      </div>

      <GroupBlock
        icon={Layers}
        iconColor="var(--teal)"
        title="What the pipeline applies automatically"
        meta="These behaviors stay server-side or in shared domain services; the rebuilt client reads their results."
        stats={[{ label: 'Contracts', value: AUTOMATION.length }]}
      >
        <div className="grid gap-2 p-2 md:grid-cols-2">
          {AUTOMATION.map((item) => (
            <div key={item} className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2">
              <Icon as={CheckCircle} size="sm" style={{ color: 'var(--emerald)' }} />
              <span className="t-caption text-[var(--brand-text)]">{item}</span>
            </div>
          ))}
        </div>
      </GroupBlock>

      <GroupBlock
        icon={FileText}
        iconColor="var(--amber)"
        title="Client delivery boundary"
        meta="Admin rebuild only. Client schema review stays in Inbox > Reviews, and deliverable shapes remain frozen."
      >
        <div className="flex flex-wrap gap-2 p-2">
          <Badge label="schema_item unchanged" tone="zinc" variant="outline" size="sm" />
          <Badge label="schema_plan unchanged" tone="zinc" variant="outline" size="sm" />
          <Badge label="Entity resolution server-side" tone="teal" variant="outline" size="sm" />
          <Badge label="No schema-review page" tone="amber" variant="outline" size="sm" />
        </div>
      </GroupBlock>

      <GroupBlock
        icon={BarChart3}
        iconColor="var(--blue)"
        title="Measurement sequence"
        meta="Deploy, wait for Search Console data, then use the measured impact panel."
      />
    </div>
  );
}
