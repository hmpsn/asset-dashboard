/**
 * SeoAuditGuide — In-app guide for the SEO audit tool.
 * Rendered as a "Guide" sub-tab inside the SEO Audit tab.
 */
import {
  AlertTriangle, CheckCircle, ArrowRight, Filter, ListChecks,
  Sparkles, TrendingDown, Layers, Info,
} from 'lucide-react';

const SECTIONS = [
  {
    title: 'Understanding Issues',
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Every audit result is tagged with a severity level. The site score is the average score across all indexed pages — noindex pages are excluded because they don\'t affect search rankings.',
    actions: [
      'Critical — structural issues that directly harm rankings (missing titles, duplicate H1s, broken canonical tags)',
      'Error — important fixes with a meaningful SEO impact (missing meta descriptions, Open Graph issues)',
      'Warning — best-practice violations that aren\'t urgent but should be addressed',
      'Info — informational notes with no score impact; useful context only',
    ],
    tip: 'A page score of 100 means zero critical/error/warning issues. Every unfixed severity level reduces the score proportionally.',
  },
  {
    title: 'How to Prioritize',
    icon: ListChecks,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'Work through issues in severity order. Use the filter and sort controls at the top of the audit view to focus on what matters most.',
    actions: [
      'Fix critical issues first — these have the highest score and ranking impact',
      'Move to errors — often quick metadata fixes with good ROI',
      'Batch warnings — use filters to find clusters (e.g. all missing OG images across service pages)',
      'Sort by traffic — fix high-traffic pages before low-traffic ones for faster impact',
      'Use "Sort by Issues" to find the most broken pages and tackle them as a batch',
    ],
    tip: 'Quick wins: missing meta descriptions across a whole page type can often be templated and fixed in one Webflow batch update.',
  },
  {
    title: 'Fix Options',
    icon: CheckCircle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'Each issue in the audit has three action options in its action menu. Use them to keep the audit clean and actionable.',
    actions: [
      'Accept — marks the issue as a known won\'t-fix. It stays in the audit but no longer affects the score.',
      'Create Task — sends the issue directly to the client\'s task list so they can see it and take action',
      'Suppress — hides recurring false positives for that specific check + page combination. Use sparingly for intentional patterns.',
    ],
    tip: '"Accept" is for intentional decisions (e.g. a page without a meta description by design). "Suppress" is for noisy false positives like a branded 301 that isn\'t actually broken.',
  },
  {
    title: 'AEO Review Tab',
    icon: Sparkles,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
    description: 'AI Search Ready checks your site\'s readiness for AI-driven answer engines (Google AI Overviews, Perplexity, ChatGPT search). It\'s a different signal from traditional SEO.',
    actions: [
      'AEO score measures how well your content is structured for AI citation — entity clarity, question-answer density, structured data coverage',
      'High AEO score = more likely to be cited in AI answers, which drives zero-click brand exposure',
      'Review the per-page AEO breakdown to find pages with weak entity clarity or missing FAQ structure',
      'Use AEO recommendations to guide content briefs — they surface opportunities traditional audits miss',
    ],
    tip: 'AEO and traditional SEO are complementary. A page can rank well in organic search but score poorly on AEO if it doesn\'t answer questions directly.',
  },
  {
    title: 'Content Decay Tab',
    icon: TrendingDown,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Content decay tracks pages that are losing organic traffic or impressions over time — an early signal that content needs a refresh before rankings drop further.',
    actions: [
      'Critical decay — pages losing traffic fast; should be prioritized for refresh or consolidation immediately',
      'Warning decay — early signals of decline; monitor and schedule a refresh within the next sprint',
      'Check the decay reason — algorithm update vs. seasonal vs. competitor movement all require different responses',
      'Use "Create Brief" on a decaying page to immediately queue a refresh brief in the Content Pipeline',
      'Consolidation candidates are pages with overlapping content — merging them can recover combined ranking signals',
    ],
    tip: 'Content decay often starts months before a major traffic drop is visible. Catching it early with the Health tab prevents the emergency "why did our traffic fall?" conversation.',
  },
];

export function SeoAuditGuide() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-200">SEO Audit Guide</h2>
        <p className="text-sm text-zinc-400">
          How to read audit results, prioritize fixes, and use each sub-tool to maintain site health.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {SECTIONS.map((section, idx) => {
          const Icon = section.icon;
          return (
            <div key={idx} className={`border p-5 ${section.bg}`} style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-start gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900/60 flex-shrink-0 ${section.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h3 className="text-sm font-medium text-zinc-200">{section.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{section.description}</p>
                  <ul className="space-y-1">
                    {section.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <ArrowRight className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-1.5 mt-1 pt-1.5 border-t border-zinc-800/30">
                    <CheckCircle className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-zinc-500 italic">{section.tip}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Score reference panel */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-medium text-zinc-200">Filter and Sort Controls</h3>
        </div>
        <p className="text-xs text-zinc-400">
          Use the toolbar above the results table to narrow focus:
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Severity filter', desc: 'Show only critical, error, warning, or info' },
            { label: 'Category filter', desc: 'Focus on a specific check category (meta, headings, links…)' },
            { label: 'Search', desc: 'Filter by page URL or issue description' },
            { label: 'Sort by Issues', desc: 'Rank pages by number of open issues' },
            { label: 'Sort by Traffic', desc: 'Rank pages by organic traffic — fix high-traffic pages first' },
            { label: 'Batch actions', desc: 'Accept or suppress multiple issues at once after filtering' },
          ].map(f => (
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

      {/* Scheduling note */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-medium text-zinc-200">Audit History and Scheduling</h3>
        </div>
        <div className="space-y-2 text-xs text-zinc-400">
          <p>Use the History tab to compare audit snapshots over time and track score trends.</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">1.</span>
              <span><strong className="text-zinc-300">Snapshots are saved automatically</strong> — each run creates a timestamped snapshot you can revisit later.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">2.</span>
              <span><strong className="text-zinc-300">Score trends</strong> — the History tab shows score change over time so you can demonstrate progress to clients.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">3.</span>
              <span><strong className="text-zinc-300">Scheduled audits</strong> — configure an automatic run cadence from the audit settings so you never miss a regression.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">4.</span>
              <span><strong className="text-zinc-300">Export reports</strong> — generate a PDF or CSV snapshot to share with clients from the Share button.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Quick workflow */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-zinc-200">Typical Monthly Workflow</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            'Run audit → review site score',
            'Filter by Critical → fix or accept',
            'Filter by Error → batch fix metadata',
            'Check Content Health for decay signals',
            'Check AI Search Ready for AEO gaps',
            'Create tasks for client-side fixes',
            'Save snapshot → share report',
            'Schedule next run in 30 days',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800/50 rounded-lg text-[11px] text-zinc-400">
              <span className="text-teal-400 font-bold">{i + 1}.</span>
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
