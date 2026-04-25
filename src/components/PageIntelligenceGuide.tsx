/**
 * PageIntelligenceGuide — In-app guide for the Page Intelligence tool.
 * Rendered as a sub-tab inside the Page Intelligence tab.
 */
import {
  CheckCircle, BarChart3, ArrowRight, Target, Eye, TrendingUp,
  FileText, Layers, AlertTriangle, Pencil, Search, Network,
} from 'lucide-react';
import { Icon } from './ui';

const SECTIONS = [
  {
    title: 'How Page Analysis Works',
    icon: Search,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'Page Intelligence pulls from three data sources to build a complete picture of each page\'s SEO health.',
    items: [
      {
        label: 'Google Search Console',
        desc: 'Clicks, impressions, average position, and CTR — how Google actually sees and ranks each page right now.',
      },
      {
        label: 'SEMRush',
        desc: 'Keyword volume, difficulty scores, competitor keyword gaps, and monthly organic traffic estimates.',
      },
      {
        label: 'Internal Link Graph',
        desc: 'How pages link to each other — link depth from homepage, hub/spoke structure, and orphaned pages.',
      },
    ],
    tip: 'Analysis runs on demand per page, or in bulk across the full site. Data is cached until you re-analyze.',
  },
  {
    title: 'Reading Optimization Scores',
    icon: Target,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Each page gets a 0–100 optimization score. The score is a weighted composite of six factors.',
    items: [
      {
        label: 'Title tag (primary keyword)',
        desc: 'Does the primary keyword appear in the page title? Highest-weighted signal.',
      },
      {
        label: 'Meta description',
        desc: 'Is the keyword in the meta description, and is the description a reasonable length?',
      },
      {
        label: 'Headings (H1/H2)',
        desc: 'Does the keyword appear in at least one heading?',
      },
      {
        label: 'Content presence',
        desc: 'Does the keyword appear in the page body content?',
      },
      {
        label: 'URL slug',
        desc: 'Is the keyword reflected in the URL path?',
      },
      {
        label: 'Internal links',
        desc: 'How many other site pages link to this page? More inbound links = more crawl authority.',
      },
    ],
    tip: 'Scores reflect your on-page and structural signals — not Google\'s live ranking position. A page can rank well and still score low (GSC data may be ahead of the last analysis), or score high and rank poorly (off-page factors like backlinks aren\'t captured here).',
  },
  {
    title: 'The Pages Tab',
    icon: FileText,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
    description: 'The Pages tab lists every page fetched from Webflow — both static pages and CMS collection items.',
    items: [
      {
        label: 'Page URL and title',
        desc: 'The published path (e.g. /services/seo) and Webflow page title. CMS pages are tagged with a "CMS" badge.',
      },
      {
        label: 'Optimization score',
        desc: 'Color-coded: green (80+), amber (50–79), red (below 50). A dash means the page hasn\'t been analyzed yet.',
      },
      {
        label: 'GSC signals',
        desc: 'Clicks and impressions pulled from Google Search Console. Updates daily when GSC sync is active.',
      },
      {
        label: '"Crawled" vs "Not Crawled"',
        desc: '"Crawled" means GSC has data for this URL. "Not Crawled" means it hasn\'t been indexed yet or the path doesn\'t match.',
      },
      {
        label: 'Re-analysis',
        desc: 'Click the "Analyze" button on any row to re-run the AI analysis and refresh the score. Bulk analysis runs in the background.',
      },
    ],
    tip: 'Use the search bar to filter by URL or title. Sort by score (ascending) to find your lowest-scoring pages first.',
  },
  {
    title: 'The Architecture Tab',
    icon: Network,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'The Architecture tab visualizes the site\'s internal link structure as a hierarchy.',
    items: [
      {
        label: 'Link depth',
        desc: 'How many clicks from the homepage it takes to reach each page. Depth 1 = directly linked from home. Depth 4+ = buried.',
      },
      {
        label: 'Hub pages',
        desc: 'Pages with 2+ child pages linking from them. Good hub pages are a strong SEO signal — they create topic clusters.',
      },
      {
        label: 'Orphaned pages',
        desc: 'Pages with zero inbound links from the rest of the site. Search engines may not crawl them reliably.',
      },
      {
        label: 'Healthy architecture',
        desc: 'Most pages reachable within 3 clicks, hub pages for each service/topic cluster, homepage linking to key sections.',
      },
      {
        label: 'Unhealthy architecture',
        desc: 'Flat structure with all pages at depth 1 (no clusters), deep pages at depth 5+, or many orphaned pages.',
      },
    ],
    tip: 'Architecture issues often explain why a well-optimized page has low GSC impressions — it\'s not getting crawl budget or PageRank flow.',
  },
  {
    title: 'Taking Action',
    icon: Pencil,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    description: 'Every page row has direct action shortcuts. No need to manually navigate between tools.',
    items: [
      {
        label: 'Fix in SEO Editor',
        desc: 'Opens the SEO Editor pre-focused on that page. Directly edit title tag, meta description, and other on-page fields.',
      },
      {
        label: 'Create Brief',
        desc: 'Opens the Content Briefs tool with the page\'s keyword data pre-filled. Use this to draft or rewrite the page.',
      },
      {
        label: 'Add Schema',
        desc: 'Appears when the analysis detects missing structured data. Opens the Schema tool focused on that page.',
      },
      {
        label: 'Score updates',
        desc: 'After publishing changes in Webflow and syncing, re-analyze the page. Scores refresh immediately after the next analysis run — they don\'t update automatically on publish.',
      },
    ],
    tip: 'The fastest workflow: sort by score ascending → expand the lowest-scoring page → click "Fix in SEO Editor" → make changes → publish → re-analyze.',
  },
  {
    title: 'Page Intelligence vs. SEO Audit',
    icon: Eye,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'These two tools answer different questions and complement each other.',
    items: [
      {
        label: 'SEO Audit',
        desc: 'Site-wide technical issues: broken links, missing meta tags across all pages, crawl errors, redirect chains, Core Web Vitals flags. Use this first for a new site.',
      },
      {
        label: 'Page Intelligence',
        desc: 'Per-page keyword optimization: is each page targeting the right keyword, is it present in the right places, how does it compare to competitors? Use this for ongoing optimization.',
      },
      {
        label: 'Typical workflow',
        desc: 'Run the Audit first to fix technical blockers. Then use Page Intelligence to optimize each page for its target keyword.',
      },
      {
        label: 'Priority signal',
        desc: 'Page Intelligence surfaces "Issues & Recommendations" per page. If a recommendation overlaps with an Audit finding (e.g., "missing schema"), the Audit\'s detail view has more context.',
      },
    ],
    tip: 'Think of it this way: the Audit checks whether the site is technically sound; Page Intelligence checks whether each page is saying the right thing.',
  },
];

const SCORE_THRESHOLDS = [
  { label: 'Needs work', range: '0–49', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  { label: 'Improving', range: '50–79', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  { label: 'Optimized', range: '80–100', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
];

export function PageIntelligenceGuide() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[var(--brand-text-bright)]">Page Intelligence Guide</h2>
        <p className="text-sm text-[var(--brand-text)]">
          How to read scores, understand page analysis, and take action on every page in the site.
        </p>
      </div>

      {/* Score thresholds quick-reference */}
      <div className="flex gap-3">
        {SCORE_THRESHOLDS.map(t => (
          <div key={t.label} className={`flex-1 border px-3 py-2.5 rounded-[var(--radius-signature)] ${t.bg}`}>
            <div className={`text-sm font-bold ${t.color}`}>{t.range}</div>
            <div className="text-[11px] text-[var(--brand-text)] mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Main sections */}
      <div className="space-y-3">
        {SECTIONS.map(section => {
          const SectionIcon = section.icon;
          return (
            <div key={section.title} className={`border p-5 rounded-[var(--radius-signature)] ${section.bg}`}>
              <div className="flex items-start gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-2)]/60 flex-shrink-0 ${section.color}`}>
                  <Icon as={SectionIcon} size="md" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">{section.title}</h3>
                  <p className="text-xs text-[var(--brand-text)] leading-relaxed">{section.description}</p>
                  <ul className="space-y-1.5">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-dim)] mt-0.5 flex-shrink-0" />
                        <span>
                          <strong className="text-[var(--brand-text-bright)]">{item.label}</strong>
                          {' — '}
                          <span className="text-[var(--brand-text)]">{item.desc}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-1.5 mt-1 pt-1.5 border-t border-[var(--brand-border)]/30">
                    <Icon as={CheckCircle} size="sm" className="text-[var(--brand-text-dim)] mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-[var(--brand-text-muted)] italic">{section.tip}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Data sources summary */}
      {/* pr-check-disable-next-line -- brand asymmetric signature on guide section card; intentional non-SectionCard chrome */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3 rounded-[var(--radius-signature-lg)]">
        <div className="flex items-center gap-2">
          <Icon as={Layers} size="md" className="text-teal-400" />
          <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">What Gets Analyzed Automatically</h3>
        </div>
        <p className="text-xs text-[var(--brand-text)]">
          Each analysis run checks the following and factors them into the optimization score:
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Primary keyword in title', desc: 'Checks exact + partial match' },
            { label: 'Primary keyword in meta', desc: 'Meta description presence' },
            { label: 'Primary keyword in H1/H2', desc: 'Heading tag scan' },
            { label: 'Primary keyword in URL', desc: 'Slug match' },
            { label: 'Secondary keyword coverage', desc: 'Breadth of topic signals' },
            { label: 'Content gap detection', desc: 'Topics competitors cover you don\'t' },
            { label: 'Internal link count', desc: 'Inbound links from site pages' },
            { label: 'GSC performance signals', desc: 'Clicks + impressions weighting' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-2 px-3 py-2 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)]">
              <Icon as={CheckCircle} size="sm" className="text-teal-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-[11px] font-medium text-[var(--brand-text-bright)]">{f.label}</div>
                <div className="text-[10px] text-[var(--brand-text-muted)]">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended workflow */}
      {/* pr-check-disable-next-line -- brand asymmetric signature on guide section card; intentional non-SectionCard chrome */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3 rounded-[var(--radius-signature-lg)]">
        <div className="flex items-center gap-2">
          <Icon as={TrendingUp} size="md" className="text-amber-400" />
          <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">Recommended Optimization Workflow</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            'Run SEO Audit → fix technical blockers first',
            'Bulk analyze all pages in Page Intelligence',
            'Sort by score ascending → identify red pages',
            'Expand lowest-scoring page → review issues',
            'Fix in SEO Editor → publish in Webflow',
            'Re-analyze page → verify score improvement',
            'Move to next priority page',
            'Check Architecture tab for orphaned pages',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] text-[11px] text-[var(--brand-text)]">
              <span className="text-amber-400 font-bold">{i + 1}.</span>
              {step}
            </div>
          ))}
        </div>
      </div>

      {/* Score interpretation callout */}
      {/* pr-check-disable-next-line -- brand asymmetric signature on guide section card; intentional non-SectionCard chrome */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3 rounded-[var(--radius-signature-lg)]">
        <div className="flex items-center gap-2">
          <Icon as={AlertTriangle} size="md" className="text-sky-400" />
          <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">Score Limitations to Know</h3>
        </div>
        <div className="space-y-2 text-xs text-[var(--brand-text)]">
          <ul className="space-y-1.5">
            {[
              {
                label: 'Scores are not Google rankings',
                desc: 'A score of 90 doesn\'t mean you rank #1. It means your on-page signals are well-configured. Off-page factors (backlinks, domain authority) also affect rankings.',
              },
              {
                label: 'Scores don\'t update on publish',
                desc: 'After publishing changes in Webflow, click "Analyze" on the page to see the updated score. Scores only refresh on-demand.',
              },
              {
                label: 'GSC data has a lag',
                desc: 'Google Search Console data is typically 2–3 days behind. Impressions and clicks shown here reflect the most recent sync.',
              },
              {
                label: 'CMS pages analyze individually',
                desc: 'CMS collection pages are analyzed per URL, not per template. If 20 collection pages share a template, each page gets its own score.',
              },
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <Icon as={BarChart3} size="sm" className="text-sky-400 mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-[var(--brand-text-bright)]">{item.label}</strong>
                  {' — '}
                  {item.desc}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
