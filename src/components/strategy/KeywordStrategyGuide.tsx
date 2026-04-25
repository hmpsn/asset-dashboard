/**
 * KeywordStrategyGuide — In-app guide for the keyword strategy tool.
 * Rendered as a sub-tab inside the Keyword Strategy tab.
 */
import { Icon, SectionCard } from '../ui';
import {
  ArrowRight, CheckCircle, Settings2, Briefcase, Sparkles,
  BarChart3, Zap, ArrowUpRight, FileText,
} from 'lucide-react';

const STEPS = [
  {
    number: 1,
    title: 'Configure SEMRush Mode',
    icon: Settings2,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'Choose how much keyword intelligence to pull in. The mode determines the depth of data used during strategy generation.',
    actions: [
      'Off — uses AI + Google Search Console only (no SEMRush credits)',
      'Quick (~500 credits) — adds real search volume + keyword difficulty per page keyword',
      'Full (~7,500 credits) — adds competitive gap analysis, domain-level keywords, and related terms',
      'Use "Quick" for most clients; "Full" for competitive markets or quarterly deep-dives',
    ],
    tip: 'For a specific page analysis, use Quick. For a full domain competitive audit, use Full. Keyword-only (Off) is free but lacks volume data.',
  },
  {
    number: 2,
    title: 'Set Business Context',
    icon: Briefcase,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Business context guides the AI toward keywords that match your client\'s goals, location, and audience — not just what\'s technically present on the site.',
    actions: [
      'Add location, services, and target audience to Business Context',
      'Include your client\'s differentiators ("same-day service", "woman-owned", "family-run since 1987")',
      'List up to 5 competitor domains for comparative analysis',
      'Context is saved with the strategy and re-used on every regeneration',
    ],
    tip: 'Keyword difficulty (KD%) tells you how hard it is to rank. CPC (cost-per-click) tells you commercial intent — high CPC = advertisers are paying for that term = revenue signal.',
  },
  {
    number: 3,
    title: 'Generate the Strategy',
    icon: Sparkles,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
    description: 'The AI crawls every mapped page, pulls Search Console data, enriches with SEMRush if enabled, and produces a keyword map + opportunity analysis.',
    actions: [
      'Click "Generate Strategy" — expect 2–15 min depending on site size + mode',
      'Output includes: target keywords per page, search intent labels, position data, and CPC',
      'Quick Wins, Content Gaps, and Keyword Gaps are calculated automatically',
      'Use "Update changed pages" to cheaply re-process only recently modified pages',
    ],
    tip: 'For a 500-page site with SEMRush Quick mode, expect ~5–7 minutes. The progress bar shows which phase is running (pages → Search Console → SEMRush → AI).',
  },
  {
    number: 4,
    title: 'Interpret Rankings',
    icon: BarChart3,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'The rank distribution chart breaks down pages by position tier. Understanding this spread tells you where to focus effort first.',
    actions: [
      'Top 3 (emerald) — hold these positions; monitor for drops',
      'Positions 4–10 (green) — high-value targets; small improvements move from page 1 rank #8 to #3',
      'Positions 11–20 (amber) — near-opportunity pages; content improvements can crack page 1',
      'Beyond 20 (red) — high competition or misaligned keyword targeting; investigate intent',
      'Not ranking (gray) — no position data; check if pages are indexed and have GSC coverage',
    ],
    tip: 'Search intent mix (informational / commercial / transactional) appears below the chart. A site skewed heavily informational may need more transactional pages to drive conversions.',
  },
  {
    number: 5,
    title: 'Quick Wins',
    icon: Zap,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'Quick wins are pages with low keyword difficulty, existing GSC impressions, and positions in the 4–20 range — meaning Google already sees them as relevant, just not quite page-1 quality.',
    actions: [
      'Sort by impressions to find the highest-traffic near-miss pages',
      'The core fix: improve on-page relevance for the target keyword (title, H1, body copy)',
      'Create a content brief directly from a quick win to get AI-generated copy improvements',
      'Re-run the strategy after publishing updates to see position changes',
    ],
    tip: 'A page ranking #11 with 2,000 impressions/month but no clicks is a classic quick win. Moving it to #8 could yield 100–200 clicks/month with minimal effort.',
  },
  {
    number: 6,
    title: 'Next Steps',
    icon: ArrowUpRight,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'The keyword strategy feeds directly into the content pipeline. Use it to create briefs, map content gaps to new pages, and validate results over time.',
    actions: [
      'Content Gaps → create a new page brief targeting the gap keyword',
      'Quick Wins + Low-Hanging Fruit → create briefs to improve existing pages',
      'Track priority keywords in Rank Tracker using the (+) button on any keyword chip',
      'Re-run the strategy monthly or after publishing major content to see ranking shifts',
      'Use Page Intelligence to deep-dive individual pages and hand-tune keyword assignments',
    ],
    tip: 'New content takes 4–12 weeks to see ranking impact. Re-run the strategy after that window and compare against the Strategy Diff panel to measure movement.',
  },
];

const METRIC_GLOSSARY = [
  { term: 'KD %', def: 'Keyword Difficulty — 0–100 scale of how hard it is to rank for this term. Under 30 = low competition.' },
  { term: 'CPC', def: 'Cost-Per-Click — what advertisers pay per ad click. High CPC signals commercial intent and potential revenue.' },
  { term: 'Volume', def: 'Estimated monthly searches. Treat as a directional signal, not a precise number.' },
  { term: 'Position', def: 'Average ranking position from Google Search Console. Position 1–3 = strong; 4–10 = page 1; 11–20 = page 2.' },
  { term: 'Impressions', def: 'How many times your page appeared in search results. High impressions + no clicks = CTR/ranking problem.' },
  { term: 'CTR', def: 'Click-through rate. Industry average ~2–5% for positions 1–3; drops sharply beyond position 5.' },
];

export function KeywordStrategyGuide() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="t-h2 text-[var(--brand-text-bright)]">Keyword Strategy Guide</h2>
        <p className="t-body text-[var(--brand-text)]">
          How to configure, generate, and act on an AI-powered keyword strategy — from setup through content execution.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map(step => {
          const StepIcon = step.icon;
          return (
            <div key={step.number} className={`border p-5 ${step.bg} rounded-[var(--radius-signature)]`}>
              <div className="flex items-start gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-2)]/60 flex-shrink-0 ${step.color}`}>
                  <Icon as={StepIcon} size="sm" className={step.color} />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="t-micro font-bold text-[var(--brand-text-muted)] uppercase tracking-wider">Step {step.number}</span>
                    <h3 className="t-ui font-medium text-[var(--brand-text-bright)]">{step.title}</h3>
                  </div>
                  <p className="t-caption text-[var(--brand-text)] leading-relaxed">{step.description}</p>
                  <ul className="space-y-1">
                    {step.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 t-caption text-[var(--zinc-300)]">
                        <Icon as={ArrowRight} size="xs" className="text-[var(--brand-text-dim)] mt-0.5 flex-shrink-0" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-1.5 mt-1 pt-1.5 border-t border-[var(--brand-border)]/30">
                    <Icon as={CheckCircle} size="xs" className="text-[var(--brand-text-dim)] mt-0.5 flex-shrink-0" />
                    <span className="t-caption-sm text-[var(--brand-text-muted)] italic">{step.tip}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Metric Glossary */}
      <SectionCard
        title="Metric Glossary"
        titleIcon={<Icon as={BarChart3} size="sm" className="text-sky-400" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {METRIC_GLOSSARY.map(m => (
            <div key={m.term} className="flex items-start gap-2 px-3 py-2 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)]">
              <span className="t-caption-sm font-bold text-sky-400 flex-shrink-0 w-14">{m.term}</span>
              <span className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{m.def}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Content Pipeline integration */}
      <SectionCard
        title="Strategy → Content Pipeline"
        titleIcon={<Icon as={FileText} size="sm" className="text-amber-400" />}
      >
        <div className="space-y-2 t-caption text-[var(--brand-text)]">
          <p>The keyword strategy is the upstream source for all content work. Here's how it connects:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">1.</span>
              <span><strong className="text-[var(--zinc-300)]">Content Gaps → new page briefs</strong> — gaps represent keywords you don't rank for. Each gap can become a new page in the content pipeline.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">2.</span>
              <span><strong className="text-[var(--zinc-300)]">Quick Wins → improve existing pages</strong> — Quick Win pages already exist; the brief optimizes titles, H1s, and meta descriptions around the target keyword.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">3.</span>
              <span><strong className="text-[var(--zinc-300)]">Site keywords auto-populate briefs</strong> — when you create a brief for a page, the mapped primary keyword pre-fills the brief's keyword field.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 font-bold">4.</span>
              <span><strong className="text-[var(--zinc-300)]">Re-run after publishing</strong> — once new content goes live, re-run the strategy to see if rankings moved and update the keyword map.</span>
            </li>
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}
