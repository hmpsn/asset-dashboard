import { useState, useEffect, useMemo } from 'react';
import { Sparkles, ShoppingCart, Image, FileText, Code2, ArrowRightLeft, Wrench, Crown, MessageSquare, TrendingUp, Eye, MousePointerClick, ChevronDown, Lightbulb, CheckCircle2, Zap, Shield } from 'lucide-react';
import { useCart } from './useCart';
import type { AuditDetail } from './types';
import type { ProductType } from '../../../server/payments';

const fmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(usd);

const num = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

interface TrafficMap {
  [path: string]: { clicks: number; impressions: number; sessions: number; pageviews: number };
}

interface ServerRecommendation {
  id: string;
  priority: 'fix_now' | 'fix_soon' | 'fix_later' | 'ongoing';
  type: 'technical' | 'content' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy';
  title: string;
  description: string;
  insight: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  impactScore: number;
  source: string;
  affectedPages: string[];
  trafficAtRisk: number;
  impressionsAtRisk: number;
  estimatedGain: string;
  actionType: 'automated' | 'manual' | 'content_creation' | 'purchase';
  productType?: string;
  productPrice?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  assignedTo?: 'team' | 'client';
}

interface FixRecommendationsProps {
  auditDetail: AuditDetail;
  tier?: 'free' | 'growth' | 'premium';
  workspaceId?: string;
}

interface AffectedPage {
  name: string;
  slug: string;
  clicks: number;
  impressions: number;
  pageviews: number;
  issueCount: number;
  topIssue: string;
}

interface FixCategory {
  id: string;
  icon: typeof FileText;
  label: string;
  pages: AffectedPage[];
  totalPages: number;
  highTrafficPages: number;
  totalClicks: number;
  totalImpressions: number;
  insight: string;
  whyItMatters: string;
  options: Array<{
    productType: string;
    displayName: string;
    priceUsd: number;
    buttonLabel: string;
    isFlat?: boolean;
    quantity?: number;
    isSuggested?: boolean;
    tier?: 'starter' | 'full';
  }>;
  isManual?: boolean;
}

/** Categorize pages by fix type, enriched with traffic */
function buildFixCategories(audit: AuditDetail, traffic: TrafficMap): FixCategory[] {
  const metaPages: Map<string, AffectedPage> = new Map();
  const altPages: Map<string, AffectedPage> = new Map();
  const schemaPages: Map<string, AffectedPage> = new Map();
  let redirectIssues = 0;
  let manualIssues = 0;

  for (const page of audit.audit.pages) {
    const slug = `/${page.slug}`;
    const t = traffic[slug] || { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };

    for (const issue of page.issues) {
      const chk = issue.check?.toLowerCase() || '';
      const msg = issue.message?.toLowerCase() || '';
      const cat = issue.category?.toLowerCase() || '';

      if (chk.includes('meta') || chk.includes('title') || msg.includes('meta description') || msg.includes('title tag')) {
        if (!metaPages.has(page.pageId)) {
          metaPages.set(page.pageId, { name: page.page, slug, clicks: t.clicks, impressions: t.impressions, pageviews: t.pageviews, issueCount: 1, topIssue: issue.message });
        } else {
          metaPages.get(page.pageId)!.issueCount++;
        }
      } else if (chk.includes('alt') || msg.includes('alt text') || msg.includes('alt attribute')) {
        if (!altPages.has(page.pageId)) {
          altPages.set(page.pageId, { name: page.page, slug, clicks: t.clicks, impressions: t.impressions, pageviews: t.pageviews, issueCount: 1, topIssue: issue.message });
        } else {
          altPages.get(page.pageId)!.issueCount++;
        }
      } else if (chk.includes('schema') || msg.includes('schema') || msg.includes('structured data')) {
        if (!schemaPages.has(page.pageId)) {
          schemaPages.set(page.pageId, { name: page.page, slug, clicks: t.clicks, impressions: t.impressions, pageviews: t.pageviews, issueCount: 1, topIssue: issue.message });
        } else {
          schemaPages.get(page.pageId)!.issueCount++;
        }
      } else if (chk.includes('redirect') || msg.includes('redirect') || msg.includes('301') || msg.includes('302')) {
        redirectIssues++;
      } else if (cat === 'content' || chk.includes('heading') || chk.includes('h1') || chk.includes('link') || chk.includes('performance')) {
        manualIssues++;
      }
    }
  }

  // Also check site-wide issues
  for (const issue of audit.audit.siteWideIssues) {
    const chk = issue.check?.toLowerCase() || '';
    const msg = issue.message?.toLowerCase() || '';
    if (chk.includes('redirect') || msg.includes('redirect')) redirectIssues++;
  }

  const sortByTraffic = (pages: AffectedPage[]) =>
    [...pages].sort((a, b) => (b.clicks + b.pageviews) - (a.clicks + a.pageviews));

  const categories: FixCategory[] = [];

  // --- Metadata ---
  if (metaPages.size > 0) {
    const pages = sortByTraffic([...metaPages.values()]);
    const count = pages.length;
    const highTraffic = pages.filter(p => p.clicks > 0 || p.pageviews > 0).length;
    const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
    const totalImpressions = pages.reduce((s, p) => s + p.impressions, 0);

    const hasTraffic = totalClicks > 0 || totalImpressions > 0;
    const insight = hasTraffic
      ? `${highTraffic} of these ${count} pages are receiving organic traffic — ${num(totalClicks)} clicks and ${num(totalImpressions)} impressions in the last 28 days. Optimizing metadata on these pages will directly improve click-through rates from search results.`
      : `${count} pages have missing or suboptimal meta titles and descriptions. Proper metadata is the single biggest factor in whether someone clicks your result in Google — it's your first impression.`;

    const opts: FixCategory['options'] = [];
    if (count <= 9) {
      opts.push({ productType: 'fix_meta', displayName: 'Metadata Optimization', priceUsd: 20, buttonLabel: `Optimize ${count} page${count !== 1 ? 's' : ''} — ${fmt(count * 20)}`, quantity: count, isSuggested: true, tier: 'full' });
    } else {
      // Offer "Start with top 10" + "Fix all"
      opts.push({ productType: 'fix_meta_10', displayName: 'Metadata Pack (10pg)', priceUsd: 179, buttonLabel: `Start with top 10 pages — $179`, quantity: 1, isSuggested: true, tier: 'starter' });
      const packs = Math.ceil(count / 10);
      const packPrice = packs * 179;
      const individualPrice = count * 20;
      opts.push({ productType: 'fix_meta_10', displayName: 'Metadata Pack (10pg)', priceUsd: 179, buttonLabel: `Optimize all ${count} pages — ${fmt(packPrice)} (save ${fmt(individualPrice - packPrice)})`, quantity: packs, tier: 'full' });
    }

    categories.push({
      id: 'meta', icon: FileText, label: 'Metadata Optimization', pages, totalPages: count,
      highTrafficPages: highTraffic, totalClicks, totalImpressions,
      insight, whyItMatters: 'Meta titles and descriptions control how your site appears in Google search results. Missing or generic metadata means lower click-through rates — even if you rank well.',
      options: opts,
    });
  }

  // --- Schema ---
  if (schemaPages.size > 0) {
    const pages = sortByTraffic([...schemaPages.values()]);
    const count = pages.length;
    const highTraffic = pages.filter(p => p.clicks > 0 || p.pageviews > 0).length;
    const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
    const totalImpressions = pages.reduce((s, p) => s + p.impressions, 0);

    const hasTraffic = totalClicks > 0;
    const insight = hasTraffic
      ? `${highTraffic} of these ${count} pages already receive search traffic (${num(totalClicks)} clicks/mo). Adding structured data can unlock rich snippets — star ratings, FAQs, breadcrumbs — which typically increase CTR by 20-30%.`
      : `${count} pages are missing structured data markup. Schema markup helps Google understand your content and can unlock rich snippets in search results — the enhanced listings that stand out and get more clicks.`;

    const opts: FixCategory['options'] = [];
    if (count <= 9) {
      opts.push({ productType: 'schema_page', displayName: 'Schema — Per Page', priceUsd: 39, buttonLabel: `Add schema to ${count} page${count !== 1 ? 's' : ''} — ${fmt(count * 39)}`, quantity: count, isSuggested: true, tier: 'full' });
    } else {
      opts.push({ productType: 'schema_10', displayName: 'Schema Pack (10pg)', priceUsd: 299, buttonLabel: `Start with top 10 pages — $299`, quantity: 1, isSuggested: true, tier: 'starter' });
      const packs = Math.ceil(count / 10);
      const packPrice = packs * 299;
      const individualPrice = count * 39;
      opts.push({ productType: 'schema_10', displayName: 'Schema Pack (10pg)', priceUsd: 299, buttonLabel: `All ${count} pages — ${fmt(packPrice)} (save ${fmt(individualPrice - packPrice)})`, quantity: packs, tier: 'full' });
    }

    categories.push({
      id: 'schema', icon: Code2, label: 'Schema Markup', pages, totalPages: count,
      highTrafficPages: highTraffic, totalClicks, totalImpressions,
      insight, whyItMatters: 'Structured data helps search engines understand your content and can unlock rich snippets — enhanced listings with stars, FAQs, and breadcrumbs that significantly increase click-through rates.',
      options: opts,
    });
  }

  // --- Alt Text ---
  if (altPages.size > 0) {
    const pages = sortByTraffic([...altPages.values()]);
    const count = pages.length;
    const highTraffic = pages.filter(p => p.clicks > 0 || p.pageviews > 0).length;
    const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
    const totalImpressions = pages.reduce((s, p) => s + p.impressions, 0);

    const hasTraffic = totalClicks > 0;
    const insight = hasTraffic
      ? `${count} pages have images without alt text — including ${highTraffic} pages that drive ${num(totalClicks)} organic clicks/mo. Alt text improves image search visibility and accessibility compliance.`
      : `${count} pages have images missing alt text. This is both an SEO and accessibility issue — Google Image Search drives significant traffic for visual content, and missing alt text hurts accessibility compliance.`;

    categories.push({
      id: 'alt', icon: Image, label: 'Alt Text Optimization', pages, totalPages: count,
      highTrafficPages: highTraffic, totalClicks, totalImpressions,
      insight, whyItMatters: 'Alt text helps Google understand your images (driving Image Search traffic) and is required for web accessibility compliance. A full-site optimization covers every image across all pages.',
      options: [{ productType: 'fix_alt', displayName: 'Alt Text — Full Site', priceUsd: 50, buttonLabel: 'Optimize full site — $50', isFlat: true, isSuggested: true, tier: 'full' }],
    });
  }

  // --- Redirects ---
  if (redirectIssues > 0) {
    categories.push({
      id: 'redirect', icon: ArrowRightLeft, label: 'Redirect Fixes', pages: [], totalPages: redirectIssues,
      highTrafficPages: 0, totalClicks: 0, totalImpressions: 0,
      insight: `${redirectIssues} redirect chain${redirectIssues !== 1 ? 's' : ''} detected. Redirect chains slow down page loads and dilute link equity — each hop loses ~10-15% of the SEO value being passed.`,
      whyItMatters: 'Redirect chains (301 → 301 → final page) waste crawl budget and dilute the SEO value of inbound links. Cleaning them up is a quick technical win.',
      options: [{ productType: 'fix_redirect', displayName: 'Redirect Fix', priceUsd: 19, buttonLabel: `Fix ${redirectIssues} redirect${redirectIssues !== 1 ? 's' : ''} — ${fmt(redirectIssues * 19)}`, quantity: redirectIssues, isSuggested: true, tier: 'full' }],
    });
  }

  // --- Manual ---
  if (manualIssues > 0) {
    categories.push({
      id: 'manual', icon: Wrench, label: 'Heading, Link & Layout Fixes', pages: [], totalPages: manualIssues,
      highTrafficPages: 0, totalClicks: 0, totalImpressions: 0,
      insight: `${manualIssues} issue${manualIssues !== 1 ? 's' : ''} require manual review — heading structure, broken internal links, and layout optimizations that need human judgment to implement correctly.`,
      whyItMatters: 'These issues affect content structure and user experience. Proper heading hierarchy, working internal links, and clean layouts all contribute to better rankings and lower bounce rates.',
      options: [], isManual: true,
    });
  }

  return categories;
}

/** Map server rec type to icon + label */
const typeConfig: Record<string, { icon: typeof FileText; label: string }> = {
  metadata: { icon: FileText, label: 'Metadata Optimization' },
  schema: { icon: Code2, label: 'Schema Markup' },
  technical: { icon: Wrench, label: 'Technical Fixes' },
  content: { icon: FileText, label: 'Content Improvements' },
  performance: { icon: Zap, label: 'Performance' },
  accessibility: { icon: Shield, label: 'Accessibility' },
  strategy: { icon: Sparkles, label: 'Strategy Opportunities' },
};

/** Build FixCategories from server recommendation data */
function buildCategoriesFromServer(recs: ServerRecommendation[]): FixCategory[] {
  // Group by type
  const groups = new Map<string, ServerRecommendation[]>();
  for (const rec of recs) {
    const list = groups.get(rec.type) || [];
    list.push(rec);
    groups.set(rec.type, list);
  }

  const categories: FixCategory[] = [];
  for (const [type, typeRecs] of groups) {
    // Sort by impactScore descending within group
    typeRecs.sort((a, b) => b.impactScore - a.impactScore);
    const topRec = typeRecs[0];
    const config = typeConfig[type] || typeConfig.technical;

    // Aggregate affected pages (deduplicated)
    const pageSet = new Set<string>();
    let totalTraffic = 0;
    let totalImpressions = 0;
    for (const r of typeRecs) {
      for (const p of r.affectedPages) pageSet.add(p);
      totalTraffic += r.trafficAtRisk;
      totalImpressions += r.impressionsAtRisk;
    }

    const pages: AffectedPage[] = [...pageSet].map(slug => ({
      name: slug.replace(/^\//, '') || 'Home',
      slug: slug.startsWith('/') ? slug : `/${slug}`,
      clicks: 0, impressions: 0, pageviews: 0, issueCount: 1, topIssue: '',
    }));

    // Build purchase options from recs that have productType
    const purchasableRecs = typeRecs.filter(r => r.productType && r.productPrice);
    const options: FixCategory['options'] = [];
    const isManual = typeRecs.every(r => r.actionType === 'manual');

    if (purchasableRecs.length > 0) {
      // Deduplicate by productType
      const seen = new Set<string>();
      for (const r of purchasableRecs) {
        if (seen.has(r.productType!)) continue;
        seen.add(r.productType!);
        const count = pageSet.size;
        options.push({
          productType: r.productType!,
          displayName: r.title,
          priceUsd: r.productPrice!,
          buttonLabel: count > 1 ? `Fix ${count} pages — ${fmt(count * r.productPrice!)}` : `Fix — ${fmt(r.productPrice!)}`,
          quantity: count > 1 ? count : 1,
          isSuggested: true,
          tier: 'full',
        });
      }
    }

    // Build insight from top rec + aggregated traffic
    const insight = topRec.insight + (totalTraffic > 0 ? ` ${num(totalTraffic)} clicks and ${num(totalImpressions)} impressions at risk across ${pageSet.size} pages.` : '');

    // Determine how many recs are already addressed
    const pendingCount = typeRecs.filter(r => r.status === 'pending' || r.status === 'in_progress').length;
    const completedCount = typeRecs.filter(r => r.status === 'completed' || r.status === 'dismissed').length;

    categories.push({
      id: type,
      icon: config.icon,
      label: config.label,
      pages,
      totalPages: pageSet.size,
      highTrafficPages: totalTraffic > 0 ? pages.length : 0,
      totalClicks: totalTraffic,
      totalImpressions: totalImpressions,
      insight,
      whyItMatters: topRec.description,
      options,
      isManual,
      // Attach server metadata for status display
      _pendingCount: pendingCount,
      _completedCount: completedCount,
      _serverRecs: typeRecs,
    } as FixCategory & { _pendingCount: number; _completedCount: number; _serverRecs: ServerRecommendation[] });
  }

  // Sort: fix_now types first, then by total traffic
  const priorityOrder: Record<string, number> = { fix_now: 0, fix_soon: 1, fix_later: 2, ongoing: 3 };
  categories.sort((a, b) => {
    const aRecs = (a as FixCategory & { _serverRecs: ServerRecommendation[] })._serverRecs;
    const bRecs = (b as FixCategory & { _serverRecs: ServerRecommendation[] })._serverRecs;
    const aPri = Math.min(...aRecs.map(r => priorityOrder[r.priority] ?? 3));
    const bPri = Math.min(...bRecs.map(r => priorityOrder[r.priority] ?? 3));
    if (aPri !== bPri) return aPri - bPri;
    return b.totalClicks - a.totalClicks;
  });

  return categories;
}

export function FixRecommendations({ auditDetail, tier, workspaceId }: FixRecommendationsProps) {
  const cart = useCart();
  const [traffic, setTraffic] = useState<TrafficMap>({});
  const [trafficLoaded, setTrafficLoaded] = useState(!workspaceId);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [serverRecs, setServerRecs] = useState<ServerRecommendation[] | null>(null);

  // Fetch server recommendations
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch(`/api/public/recommendations/${workspaceId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.recommendations && Array.isArray(data.recommendations)) {
          setServerRecs(data.recommendations);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Fetch traffic data (fallback for local audit-based categories)
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/public/audit-traffic/${workspaceId}`)
      .then(r => r.ok ? r.json() : {})
      .then((m: TrafficMap) => { if (m && typeof m === 'object') setTraffic(m); setTrafficLoaded(true); })
      .catch(() => setTrafficLoaded(true));
  }, [workspaceId]);

  // Prefer server recommendations when available, fall back to local audit-based categories
  const categories = useMemo(() => {
    if (serverRecs && serverRecs.length > 0) return buildCategoriesFromServer(serverRecs);
    return buildFixCategories(auditDetail, traffic);
  }, [serverRecs, auditDetail, traffic]);

  const toggleCategory = (id: string) =>
    setExpandedCategories(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const autoCategories = categories.filter(c => !c.isManual);
  const estimatedTotal = autoCategories.reduce((sum, c) => {
    const suggested = c.options.find(o => o.isSuggested);
    if (!suggested) return sum;
    return sum + suggested.priceUsd * (suggested.quantity || 1);
  }, 0);

  if (categories.length === 0) return null;
  if (!trafficLoaded) return null;

  const isPremium = tier === 'premium';
  const hasTrafficData = Object.keys(traffic).length > 0;
  const totalHighTraffic = categories.reduce((s, c) => s + c.highTrafficPages, 0);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-zinc-200">Recommended Fixes</span>
          {autoCategories.length > 0 && !isPremium && (
            <span className="text-[11px] text-zinc-500 ml-auto">
              Est. total: <span className="text-teal-400 font-medium">{fmt(estimatedTotal)}</span>
            </span>
          )}
        </div>
        {hasTrafficData && totalHighTraffic > 0 && (
          <p className="text-[12px] text-zinc-400 mt-1.5 leading-relaxed">
            Based on your traffic data, we've identified <span className="text-teal-400 font-medium">{totalHighTraffic} high-traffic pages</span> with fixable SEO issues. Prioritizing these will have the biggest impact on your organic performance.
          </p>
        )}
      </div>

      {/* Categories */}
      <div className="divide-y divide-zinc-800/50">
        {categories.map(cat => {
          const Icon = cat.icon;
          const inCart = cart?.items.some(i => cat.options.some(o => o.productType === i.productType));
          const isExpanded = expandedCategories.has(cat.id);
          const topPages = cat.pages.slice(0, 5);
          const hasPages = topPages.length > 0 && (topPages[0].clicks > 0 || topPages[0].pageviews > 0);
          const completedCount = (cat as FixCategory & { _completedCount?: number })._completedCount || 0;
          const pendingCount = (cat as FixCategory & { _pendingCount?: number })._pendingCount || 0;
          const allDone = completedCount > 0 && pendingCount === 0;

          return (
            <div key={cat.id} className={`px-5 py-4 ${allDone ? 'opacity-50' : ''}`}>
              {/* Category header */}
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{cat.label}</span>
                    <span className="text-[11px] text-zinc-500">{cat.totalPages} {cat.id === 'redirect' ? 'issue' : 'page'}{cat.totalPages !== 1 ? 's' : ''}</span>
                    {cat.highTrafficPages > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {cat.highTrafficPages} with traffic
                      </span>
                    )}
                    {allDone && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Addressed
                      </span>
                    )}
                    {completedCount > 0 && pendingCount > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
                        {completedCount} done · {pendingCount} remaining
                      </span>
                    )}
                  </div>

                  {/* Insight text */}
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <Lightbulb className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[12px] text-zinc-400 leading-relaxed">{cat.insight}</p>
                  </div>

                  {/* Top affected pages (traffic-sorted) */}
                  {hasPages && !cat.isManual && (
                    <div className="mt-3">
                      <button onClick={() => toggleCategory(cat.id)} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors mb-1.5">
                        <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        Top pages that would benefit most
                      </button>
                      {isExpanded && (
                        <div className="rounded-lg bg-zinc-800/40 border border-zinc-800 overflow-hidden">
                          <div className="grid grid-cols-[1fr,auto,auto] gap-x-4 px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                            <span>Page</span>
                            <span className="text-right">Clicks</span>
                            <span className="text-right">Impressions</span>
                          </div>
                          {topPages.filter(p => p.clicks > 0 || p.impressions > 0).slice(0, 5).map((p, i) => (
                            <div key={i} className="grid grid-cols-[1fr,auto,auto] gap-x-4 px-3 py-2 text-[11px] border-b border-zinc-800/50 last:border-b-0">
                              <div className="truncate">
                                <span className="text-zinc-300">{p.name}</span>
                                <span className="text-zinc-600 ml-1.5">{p.slug}</span>
                              </div>
                              <span className="text-right tabular-nums flex items-center gap-1 text-zinc-400">
                                <MousePointerClick className="w-3 h-3 text-teal-400" />
                                {num(p.clicks)}
                              </span>
                              <span className="text-right tabular-nums flex items-center gap-1 text-zinc-500">
                                <Eye className="w-3 h-3" />
                                {num(p.impressions)}
                              </span>
                            </div>
                          ))}
                          {topPages.filter(p => p.clicks > 0 || p.impressions > 0).length > 5 && (
                            <div className="px-3 py-1.5 text-[10px] text-zinc-500 text-center">
                              + {topPages.filter(p => p.clicks > 0 || p.impressions > 0).length - 5} more pages with traffic
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Purchase options */}
                  <div className="mt-3">
                    {isPremium ? (
                      <div className="flex items-center gap-1.5">
                        <Crown className="w-3 h-3 text-amber-400" />
                        <span className="text-[11px] text-amber-400">Included in your Premium plan</span>
                      </div>
                    ) : cat.isManual ? (
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
                        <MessageSquare className="w-3 h-3" />
                        Request a Quote
                      </button>
                    ) : inCart ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                        <ShoppingCart className="w-3 h-3" />
                        In cart
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {cat.options.map((opt, idx) => (
                          <button
                            key={idx}
                            onClick={() => cart?.addItem({
                              productType: opt.productType as ProductType,
                              displayName: opt.displayName,
                              priceUsd: opt.priceUsd,
                              quantity: opt.quantity || 1,
                              isFlat: opt.isFlat,
                            })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                              opt.isSuggested
                                ? 'bg-teal-600 hover:bg-teal-500 text-white'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                            }`}
                          >
                            <ShoppingCart className="w-3 h-3" />
                            {opt.buttonLabel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fix everything CTA */}
      {!isPremium && autoCategories.length > 1 && (
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-800/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium text-zinc-300">
                Fix everything above for <span className="text-teal-400">{fmt(estimatedTotal)}</span>
              </div>
              {estimatedTotal >= 500 && (
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Premium includes all this for $999/mo
                </div>
              )}
            </div>
            <button
              onClick={() => {
                autoCategories.forEach(cat => {
                  const suggested = cat.options.find(o => o.isSuggested);
                  if (suggested) {
                    cart?.addItem({
                      productType: suggested.productType as ProductType,
                      displayName: suggested.displayName,
                      priceUsd: suggested.priceUsd,
                      quantity: suggested.quantity || 1,
                      isFlat: suggested.isFlat,
                    });
                  }
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              <ShoppingCart className="w-3 h-3" />
              Add All to Cart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
