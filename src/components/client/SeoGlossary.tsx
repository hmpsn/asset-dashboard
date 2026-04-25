import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface GlossaryEntry {
  term: string;
  definition: string;
  whyItMatters: string;
  goodBad?: string;
}

const GLOSSARY: Record<string, GlossaryEntry> = {
  ctr: {
    term: 'Click-Through Rate (CTR)',
    definition: 'The percentage of people who click on your link after seeing it in search results.',
    whyItMatters: 'Higher CTR means your titles and descriptions are compelling enough to earn the click.',
    goodBad: '2-5% is typical. Above 5% is strong. Below 1% means your listing needs improvement.',
  },
  impressions: {
    term: 'Impressions',
    definition: 'How many times your pages appeared in Google search results — even if nobody clicked.',
    whyItMatters: 'Think of impressions as people walking past your storefront. More impressions means more visibility.',
    goodBad: 'More is better, but only if they lead to clicks. High impressions + low clicks = opportunity.',
  },
  clicks: {
    term: 'Clicks',
    definition: 'The number of times someone clicked on your site from Google search results.',
    whyItMatters: 'Clicks are actual visitors. This is the most direct measure of search traffic.',
  },
  position: {
    term: 'Average Position',
    definition: 'Your average ranking in Google search results across all your keywords.',
    whyItMatters: 'Position 1-3 gets ~60% of all clicks. Position 10+ (page 2) gets almost none.',
    goodBad: '1-3 is excellent. 4-10 is good. 11+ means you\'re on page 2 or beyond.',
  },
  'bounce-rate': {
    term: 'Bounce Rate',
    definition: 'The percentage of visitors who leave your site after viewing just one page.',
    whyItMatters: 'A high bounce rate may mean visitors aren\'t finding what they expected.',
    goodBad: '26-40% is excellent. 41-55% is average. 56-70% is higher than desired. 70%+ needs attention.',
  },
  'engagement-rate': {
    term: 'Engagement Rate',
    definition: 'The percentage of visits where users interacted meaningfully — scrolled, clicked, or stayed 10+ seconds.',
    whyItMatters: 'Unlike bounce rate, this tells you if people are actually engaging with your content.',
    goodBad: 'Above 60% is good. Below 40% suggests content isn\'t resonating.',
  },
  'site-health': {
    term: 'Site Health Score',
    definition: 'A 0-100 score measuring technical SEO issues like broken links, missing meta tags, and slow pages.',
    whyItMatters: 'Technical issues can prevent Google from properly indexing and ranking your pages.',
    goodBad: '80+ is strong. 60-79 has room for improvement. Below 60 needs immediate attention.',
  },
  'meta-title': {
    term: 'Meta Title',
    definition: 'The clickable headline that appears in Google search results for your page.',
    whyItMatters: 'This is the first thing searchers see. A compelling title dramatically improves CTR.',
    goodBad: 'Keep it under 60 characters. Include your main keyword naturally.',
  },
  'meta-description': {
    term: 'Meta Description',
    definition: 'The short summary text shown below your title in search results.',
    whyItMatters: 'A good description convinces searchers to click instead of scrolling past.',
    goodBad: 'Keep it 120-160 characters. Include a call to action and your key value proposition.',
  },
  'keyword-difficulty': {
    term: 'Keyword Difficulty',
    definition: 'An estimate of how hard it is to rank on page 1 for a given search term.',
    whyItMatters: 'Targeting keywords that are too competitive wastes effort. Lower difficulty = easier wins.',
    goodBad: '0-30 is easy. 30-60 is moderate. 60+ is very competitive.',
  },
  'search-volume': {
    term: 'Search Volume',
    definition: 'The estimated number of times a keyword is searched per month.',
    whyItMatters: 'Helps you prioritize keywords that will drive meaningful traffic if you rank for them.',
    goodBad: 'Depends on your niche. Even 50-100 monthly searches can be valuable for commercial terms.',
  },
  'organic-traffic': {
    term: 'Organic Traffic',
    definition: 'Visitors who find your site through unpaid search results (not ads).',
    whyItMatters: 'Organic traffic is free, compounding, and usually has higher intent than paid traffic.',
  },
  backlinks: {
    term: 'Backlinks',
    definition: 'Links from other websites that point to your site.',
    whyItMatters: 'Google treats backlinks as votes of confidence. More quality backlinks = higher rankings.',
    goodBad: 'Quality matters more than quantity. One link from a trusted site beats 100 from spam.',
  },
  indexing: {
    term: 'Indexing',
    definition: 'The process of Google adding your pages to its searchable database.',
    whyItMatters: 'If a page isn\'t indexed, it literally cannot appear in search results.',
  },
  schema: {
    term: 'Schema / Structured Data',
    definition: 'Code that helps search engines understand your content (business info, reviews, events, etc.).',
    whyItMatters: 'Can earn rich snippets in search results — star ratings, prices, FAQs — which boost CTR.',
  },
  canonical: {
    term: 'Canonical URL',
    definition: 'Tells Google which version of a page is the "official" one when duplicates exist.',
    whyItMatters: 'Prevents duplicate content issues that can dilute your rankings.',
  },
  redirect: {
    term: '301 Redirect',
    definition: 'A permanent forwarding rule that sends visitors (and search engines) from an old URL to a new one.',
    whyItMatters: 'Preserves your SEO value when you move or rename pages.',
  },
  crawling: {
    term: 'Crawling',
    definition: 'When Google\'s bot visits your website to discover and read your pages.',
    whyItMatters: 'If Google can\'t crawl your site efficiently, new content won\'t get indexed quickly.',
  },
  'content-gap': {
    term: 'Content Gap',
    definition: 'A keyword or topic your competitors rank for that you don\'t have content about.',
    whyItMatters: 'Content gaps represent missed traffic. Creating content for these topics captures new visitors.',
  },
  'quick-win': {
    term: 'Quick Win',
    definition: 'A page already ranking on page 1-2 that could move higher with small improvements.',
    whyItMatters: 'The easiest way to grow traffic — small tweaks to pages that are almost there.',
  },
  roi: {
    term: 'SEO ROI',
    definition: 'The return on investment from SEO — the value of organic traffic compared to what it would cost in ads.',
    whyItMatters: 'Proves that SEO is delivering real business value, not just vanity metrics.',
  },
  sessions: {
    term: 'Sessions',
    definition: 'A single visit to your website, which may include multiple page views.',
    whyItMatters: 'Sessions tell you how many times people are visiting, not just how many unique visitors.',
  },
  pageviews: {
    term: 'Pageviews',
    definition: 'The total number of pages viewed across all visits.',
    whyItMatters: 'More pageviews per session means visitors are exploring your site — a sign of good content.',
  },
  conversions: {
    term: 'Conversions',
    definition: 'When a visitor completes a desired action — filling out a form, making a purchase, calling you.',
    whyItMatters: 'This is the ultimate goal of SEO. Traffic without conversions isn\'t delivering business value.',
  },
};

export function Explainer({ term }: { term: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const entry = GLOSSARY[term];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!entry) return null;

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="ml-0.5 text-zinc-500 hover:text-teal-400 transition-colors focus:outline-none"
        aria-label={`Learn about ${entry.term}`}
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      {open && (
        // pr-check-disable-next-line -- Glossary term tooltip/popover; absolutely positioned floating element, not a content card
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 text-left animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="text-[11px] font-semibold text-teal-400 mb-1">{entry.term}</div>
          <p className="text-[11px] text-zinc-300 leading-relaxed mb-2">{entry.definition}</p>
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            <span className="font-medium text-zinc-300">Why it matters: </span>{entry.whyItMatters}
          </p>
          {entry.goodBad && (
            <p className="text-[10px] text-zinc-500 leading-relaxed mt-1.5 pt-1.5 border-t border-zinc-800">
              <span className="font-medium text-zinc-400">Benchmarks: </span>{entry.goodBad}
            </p>
          )}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45" />
        </div>
      )}
    </span>
  );
}

export { GLOSSARY };
