/**
 * SchemaWorkflowGuide — In-app guide for the schema system workflow.
 * Rendered as a sub-tab inside the Schema tab.
 */
import {
  Sparkles, CheckCircle, BarChart3, Globe, Users, Layers,
  ArrowRight, Target, Eye, Zap, TrendingUp, FileText,
} from 'lucide-react';

const STEPS = [
  {
    number: 1,
    title: 'Generate the Schema Plan',
    icon: Sparkles,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'AI analyzes all your published pages + keyword strategy to assign page roles and identify canonical entities.',
    actions: [
      'Click "Generate Schema Plan" in the Plan panel at the top',
      'Review page roles — fix any misassigned ones with the dropdown',
      'Check canonical entities (Organization, Products, Services)',
      'Save → Send to Client for approval → Activate when approved',
    ],
    tip: 'Once activated, ALL future schema generation uses this plan as context for consistent, site-wide markup.',
  },
  {
    number: 2,
    title: 'Check Coverage',
    icon: Eye,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
    description: 'See which pages have schema markup and which don\'t — coverage percentage by page role.',
    actions: [
      'Review the coverage dashboard to understand your starting point',
      'Identify page roles with low coverage (e.g., "Services: 3/10 covered")',
    ],
    tip: 'If a site already has some manual schema, you\'ll see it reflected here before you generate anything new.',
  },
  {
    number: 3,
    title: 'Prioritize What to Generate',
    icon: Target,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Pages without schema, ranked by internal link health. Higher-traffic, better-linked pages should get schema first.',
    actions: [
      'Check the priority queue for critical/high priority pages',
      'Start with these — they\'ll have the most SEO impact',
    ],
    tip: 'For sites with 100+ pages, batch your work. Do critical/high first, then medium/low in follow-up rounds.',
  },
  {
    number: 4,
    title: 'Generate Schema',
    icon: Zap,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'Generate JSON-LD for individual pages or bulk-generate for the entire site.',
    actions: [
      'Single page: Select a page → click "Generate" → review the JSON-LD',
      'Bulk: Click "Generate All Pages" to process the entire site as a background job',
      'Set page types before generating for more accurate schemas',
      'Review and edit generated JSON-LD as needed → "Save to Snapshot"',
    ],
    tip: 'The AI uses your schema plan, page type mappings, site architecture (for breadcrumbs), and linked content briefs to generate optimized markup.',
  },
  {
    number: 5,
    title: 'Review & Publish to CMS',
    icon: Globe,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
    description: 'Push generated JSON-LD to Webflow via the Custom Code API.',
    actions: [
      'Review the generated JSON-LD per page',
      'Click "Publish to Webflow" to inject into the page\'s <head>',
      'For bulk: "Publish All" pushes all generated schemas at once',
      'Or use "CMS Templates" for collection-based schema',
    ],
    tip: 'Only schema scripts are managed — your existing custom code is never touched.',
  },
  {
    number: 6,
    title: 'Check Competitors',
    icon: Users,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10 border-rose-500/20',
    description: 'Crawl competitor sites to see what schema types they use. Identify gaps in your coverage.',
    actions: [
      'Run competitor schema analysis from the Competitors tab',
      'Compare: what schema types do they have that you don\'t?',
      'Use findings in client conversations to justify schema work',
    ],
    tip: '"Your top competitor has Product schema on every service page — we should match that."',
  },
  {
    number: 7,
    title: 'Monitor Impact',
    icon: TrendingUp,
    color: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
    description: 'Track GSC metrics before vs after each schema deployment. See clicks, impressions, CTR, and position deltas.',
    actions: [
      'Check the Schema Impact panel (collapsible, below the main view)',
      'Wait 2-4 weeks after deployment for meaningful data',
      'Use per-deployment breakdown to see which pages improved most',
    ],
    tip: 'Perfect for ROI conversations: "After deploying schema to 15 service pages, avg impressions +23%."',
  },
];

const AUTO_FEATURES = [
  { label: 'Architecture-Aware Breadcrumbs', desc: 'BreadcrumbList from real site tree' },
  { label: 'Hub Page Detection', desc: 'CollectionPage + ItemList for pages with 2+ children' },
  { label: 'SiteNavigationElement', desc: 'Homepage gets auto-generated nav schema' },
  { label: 'Sibling/Parent Relationships', desc: 'relatedLink, isPartOf, hasPart from site tree' },
  { label: 'E-E-A-T Author Enrichment', desc: 'Person schema from content brief author data' },
  { label: 'Content Verification', desc: 'Cross-checks emails, phones, addresses against page HTML' },
  { label: 'AI Auto-Fix', desc: 'GPT-4.1-mini corrects validation errors automatically' },
  { label: 'Plan Validation', desc: 'Strips schema types that conflict with the active plan' },
];

export function SchemaWorkflowGuide() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-200">Schema Workflow Guide</h2>
        <p className="text-sm text-zinc-400">
          Step-by-step process for deploying structured data across a client site — from plan through measurement.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map(step => {
          const Icon = step.icon;
          return (
            <div key={step.number} className={`border p-5 ${step.bg}`} style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-start gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900/60 flex-shrink-0 ${step.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Step {step.number}</span>
                    <h3 className="text-sm font-medium text-zinc-200">{step.title}</h3>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">{step.description}</p>
                  <ul className="space-y-1">
                    {step.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <ArrowRight className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-1.5 mt-1 pt-1.5 border-t border-zinc-800/30">
                    <CheckCircle className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-zinc-500 italic">{step.tip}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* What happens automatically */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-medium text-zinc-200">What Happens Automatically</h3>
        </div>
        <p className="text-xs text-zinc-400">
          Every time schema is generated, the post-processing pipeline runs 8 steps automatically:
        </p>
        <div className="grid grid-cols-2 gap-2">
          {AUTO_FEATURES.map(f => (
            <div key={f.label} className="flex items-start gap-2 px-3 py-2 bg-zinc-800/40 rounded-lg">
              <CheckCircle className="w-3 h-3 text-teal-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-[11px] font-medium text-zinc-300">{f.label}</div>
                <div className="text-[10px] text-zinc-500">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content Pipeline integration */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-medium text-zinc-200">Content Pipeline Integration</h3>
        </div>
        <div className="space-y-2 text-xs text-zinc-400">
          <p>If you're using Content Matrices, schema integrates automatically:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">1.</span>
              <span><strong className="text-zinc-300">Templates carry schema types</strong> — A "service" template auto-inherits Service + Offer + BreadcrumbList.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">2.</span>
              <span><strong className="text-zinc-300">Matrix cells inherit</strong> — Each cell shows expected schema type badges from the template.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">3.</span>
              <span><strong className="text-zinc-300">Auto pre-generation</strong> — When a cell reaches "brief generated" or "approved", a schema skeleton is queued automatically.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">4.</span>
              <span><strong className="text-zinc-300">Ready on publish</strong> — Pre-generated schema is ready to apply when the page goes live in Webflow.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Typical engagement */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-medium text-zinc-200">Typical Client Engagement</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            'Discovery → Generate Plan + Competitor Analysis',
            'Strategy → Review roles, send to client',
            'Prioritize → Coverage dashboard + Priority queue',
            'Execute → Bulk generate → Review → Publish',
            'Expand → Generate remaining pages in batches',
            'Measure → Check Impact panel after 2-4 weeks',
            'Report → Share GSC deltas with client',
            'Maintain → Re-run coverage periodically',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800/50 rounded-lg text-[11px] text-zinc-400">
              <span className="text-purple-400 font-bold">{i + 1}.</span>
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
