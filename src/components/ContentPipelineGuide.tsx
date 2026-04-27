import { useState } from 'react';
import {
  Layers, FileText, Grid3X3, Download,
  Clipboard, RefreshCw, ChevronDown, ChevronRight,
  Sparkles, Flag, Eye, Send, ArrowRight,
} from 'lucide-react';
import { SectionCard, Icon } from './ui';

interface GuideSection {
  id: string;
  icon: typeof Layers;
  title: string;
  subtitle: string;
  steps: { label: string; detail: string }[];
  tip?: string;
}

const SECTIONS: GuideSection[] = [
  {
    id: 'planner',
    icon: Layers,
    title: 'Content Planner',
    subtitle: 'Create templates and build content matrices at scale',
    steps: [
      {
        label: 'Create a Template',
        detail: 'Templates define the structure for a type of page (blog, service, location, etc.). Set a name, page type, variables like {city} or {service}, sections with word count targets, and URL/keyword patterns.',
      },
      {
        label: 'Build a Matrix',
        detail: 'A matrix multiplies one template across variable values. Enter your cities, services, topics — the system generates every page combination with auto-derived keywords and URLs.',
      },
      {
        label: 'Manage the Grid',
        detail: 'Click any matrix to open the grid view. Filter by status, sort by volume/difficulty, select cells for bulk actions (optimize keywords, generate briefs, send for review, export).',
      },
      {
        label: 'Send for Client Review',
        detail: 'Three review tiers: send the template structure for approval, send sample cells as previews, or batch-approve all remaining cells after feedback.',
      },
    ],
    tip: 'Start with one template and a small matrix (e.g. 5 cities × 3 services = 15 pages) to test the workflow before scaling up.',
  },
  {
    id: 'briefs',
    icon: Clipboard,
    title: 'Content Briefs',
    subtitle: 'AI-generated content strategies for individual pages',
    steps: [
      {
        label: 'Generate a Brief',
        detail: 'Enter a target keyword and optional page URL. The AI produces a full brief: executive summary, outline, E-E-A-T guidance, SERP analysis, schema recommendations, and internal link suggestions.',
      },
      {
        label: 'Validate Keywords',
        detail: 'Each brief can have its keyword validated against SEMRush data — see volume, difficulty, and CPC before committing to a topic.',
      },
      {
        label: 'Review & Refine',
        detail: 'Expand any brief to see the full detail. Use "Regenerate" with feedback to refine. Briefs can be sent to clients for approval or used to generate full posts.',
      },
    ],
  },
  {
    id: 'posts',
    icon: FileText,
    title: 'Content Posts',
    subtitle: 'AI-written articles from briefs, with review and publishing',
    steps: [
      {
        label: 'Generate from Brief',
        detail: 'Select a completed brief and generate a full article. The AI follows the brief\'s outline, keyword targets, and brand voice.',
      },
      {
        label: 'Review & Edit',
        detail: 'Run AI Review to check quality. Regenerate individual sections with feedback. Track version history.',
      },
      {
        label: 'Publish to Webflow',
        detail: 'One-click publish pushes the post to your Webflow CMS. The system handles slug generation, SEO meta, and optional AI cover images.',
      },
    ],
  },
  {
    id: 'subscriptions',
    icon: RefreshCw,
    title: 'Content Subscriptions',
    subtitle: 'Recurring content delivery packages for clients',
    steps: [
      {
        label: 'Set Up Plans',
        detail: 'Configure subscription tiers in Settings (e.g. 4 posts/month, 8 posts/month). Each plan has a Stripe price, post count, and description.',
      },
      {
        label: 'Track Delivery',
        detail: 'Monitor which clients have active subscriptions, how many posts have been delivered this period, and upcoming renewals.',
      },
    ],
  },
  {
    id: 'export',
    icon: Download,
    title: 'Data Export',
    subtitle: 'Download your content pipeline data anytime',
    steps: [
      {
        label: 'Use the Export Button',
        detail: 'Click "Export" in the tab bar (top-right). Choose CSV or JSON for any dataset: briefs, requests, matrices, templates, or keyword strategy.',
      },
      {
        label: 'Use Cases',
        detail: 'CSV exports work great for client reports in spreadsheets. JSON exports are useful for backups, migrations, or feeding data into other tools.',
      },
    ],
  },
];

export function ContentPipelineGuide() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['planner']));

  const toggle = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="space-y-1.5 mb-6">
        <h2 className="text-lg font-bold text-[var(--brand-text-bright)] flex items-center gap-2">
          <Icon as={Sparkles} size="lg" className="text-teal-400" />
          Content Pipeline Guide
        </h2>
        <p className="text-xs text-[var(--brand-text-muted)] leading-relaxed max-w-xl">
          Quick walkthrough of every tool in the Content Pipeline. Click any section to expand.
        </p>
      </div>

      {/* Workflow overview */}
      <div className="flex items-center gap-2 px-4 py-3 bg-teal-500/5 border border-teal-500/15 overflow-x-auto" style={{ borderRadius: '10px 24px 10px 24px' }}>
        {[
          { icon: Layers, label: 'Template' },
          { icon: Grid3X3, label: 'Matrix' },
          { icon: Clipboard, label: 'Brief' },
          { icon: FileText, label: 'Post' },
          { icon: Send, label: 'Review' },
          { icon: Eye, label: 'Publish' },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-2 flex-shrink-0">
            {i > 0 && <Icon as={ArrowRight} size="sm" className="text-teal-500/40" />}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-teal-500/10">
              <Icon as={step.icon} size="sm" className="text-teal-400" />
              <span className="t-caption-sm font-medium text-teal-300">{step.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Sections */}
      {SECTIONS.map(section => {
        const expanded = expandedSections.has(section.id);
        const SectionIcon = section.icon;
        return (
          <SectionCard key={section.id} noPadding>
            <button
              onClick={() => toggle(section.id)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--surface-3)]/30 transition-colors rounded-[var(--radius-xl)]"
            >
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                <Icon as={SectionIcon} size="md" className="text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-[var(--brand-text-bright)] block">{section.title}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{section.subtitle}</span>
              </div>
              <Icon as={expanded ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
            </button>

            {expanded && (
              <div className="px-4 pb-4 space-y-3">
                {/* Steps */}
                <div className="space-y-2.5 ml-1">
                  {section.steps.map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-5 h-5 rounded-full bg-teal-500/15 flex items-center justify-center">
                          <span className="t-caption-sm font-bold text-teal-400">{i + 1}</span>
                        </div>
                        {i < section.steps.length - 1 && (
                          <div className="w-px flex-1 bg-[var(--brand-border)] mt-1" />
                        )}
                      </div>
                      <div className="pb-3">
                        <span className="text-xs font-semibold text-[var(--brand-text-bright)] block mb-0.5">{step.label}</span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">{step.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tip */}
                {section.tip && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <Icon as={Flag} size="sm" className="text-amber-400/80 flex-shrink-0 mt-0.5" />
                    <span className="t-caption-sm text-amber-300/80 leading-relaxed">{section.tip}</span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
