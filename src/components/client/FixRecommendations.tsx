import { useMemo } from 'react';
import { Sparkles, ShoppingCart, Image, FileText, Code2, ArrowRightLeft, Wrench, Crown, MessageSquare } from 'lucide-react';
import { useCart } from './useCart';
import type { AuditDetail } from './types';
import type { ProductType } from '../../../server/payments';

const fmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(usd);

interface FixRecommendationsProps {
  auditDetail: AuditDetail;
  tier?: 'free' | 'growth' | 'premium';
}

interface FixOption {
  id: string;
  icon: typeof FileText;
  label: string;
  description: string;
  count: number;
  unit: string;
  /** Available purchase options for this fix */
  options: Array<{
    productType: string;
    displayName: string;
    priceUsd: number;
    buttonLabel: string;
    isFlat?: boolean;
    quantity?: number;
    isSuggested?: boolean;
  }>;
  /** If true, this fix is manual and requires a quote */
  isManual?: boolean;
}

/** Map audit issue checks to fix categories */
function categorizeIssues(audit: AuditDetail) {
  const counts = { missingMeta: 0, missingAlt: 0, missingSchema: 0, redirectIssues: 0, manualIssues: 0 };
  const metaPages = new Set<string>();
  const altPages = new Set<string>();
  const schemaPages = new Set<string>();

  for (const page of audit.audit.pages) {
    for (const issue of page.issues) {
      const chk = issue.check?.toLowerCase() || '';
      const msg = issue.message?.toLowerCase() || '';
      const cat = issue.category?.toLowerCase() || '';

      // Meta description / title issues
      if (chk.includes('meta') || chk.includes('title') || msg.includes('meta description') || msg.includes('title tag')) {
        if (!metaPages.has(page.pageId)) {
          counts.missingMeta++;
          metaPages.add(page.pageId);
        }
      }
      // Alt text issues
      else if (chk.includes('alt') || msg.includes('alt text') || msg.includes('alt attribute')) {
        if (!altPages.has(page.pageId)) {
          counts.missingAlt++;
          altPages.add(page.pageId);
        }
      }
      // Schema issues
      else if (chk.includes('schema') || msg.includes('schema') || msg.includes('structured data')) {
        if (!schemaPages.has(page.pageId)) {
          counts.missingSchema++;
          schemaPages.add(page.pageId);
        }
      }
      // Redirect issues
      else if (chk.includes('redirect') || msg.includes('redirect') || msg.includes('301') || msg.includes('302')) {
        counts.redirectIssues++;
      }
      // Heading, link, layout — manual
      else if (cat === 'content' || chk.includes('heading') || chk.includes('h1') || chk.includes('link') || chk.includes('performance')) {
        counts.manualIssues++;
      }
    }
  }

  // Also check site-wide issues
  for (const issue of audit.audit.siteWideIssues) {
    const chk = issue.check?.toLowerCase() || '';
    const msg = issue.message?.toLowerCase() || '';
    if (chk.includes('schema') || msg.includes('schema')) counts.missingSchema++;
    else if (chk.includes('redirect') || msg.includes('redirect')) counts.redirectIssues++;
  }

  return counts;
}

export function FixRecommendations({ auditDetail, tier }: FixRecommendationsProps) {
  const cart = useCart();

  const counts = useMemo(() => categorizeIssues(auditDetail), [auditDetail]);

  const fixes = useMemo<FixOption[]>(() => {
    const result: FixOption[] = [];

    if (counts.missingAlt > 0) {
      result.push({
        id: 'alt',
        icon: Image,
        label: 'Alt Text Optimization',
        description: `${counts.missingAlt} page${counts.missingAlt !== 1 ? 's' : ''} with images missing alt text`,
        count: counts.missingAlt,
        unit: 'pages',
        options: [{
          productType: 'fix_alt',
          displayName: 'Alt Text — Full Site',
          priceUsd: 50,
          buttonLabel: 'Fix All — $50',
          isFlat: true,
          isSuggested: true,
        }],
      });
    }

    if (counts.missingMeta > 0) {
      const opts: FixOption['options'] = [];
      if (counts.missingMeta <= 9) {
        opts.push({
          productType: 'fix_meta',
          displayName: 'Metadata Optimization',
          priceUsd: 20,
          buttonLabel: `Fix ${counts.missingMeta} page${counts.missingMeta !== 1 ? 's' : ''} — ${fmt(counts.missingMeta * 20)}`,
          quantity: counts.missingMeta,
          isSuggested: true,
        });
      } else {
        // Suggest packs
        const packs = Math.ceil(counts.missingMeta / 10);
        const remainder = counts.missingMeta % 10;
        const packPrice = packs * 179 + (remainder > 0 ? 0 : 0); // packs cover all when rounded up
        const individualPrice = counts.missingMeta * 20;
        opts.push({
          productType: 'fix_meta_10',
          displayName: 'Metadata Pack (10pg)',
          priceUsd: 179,
          buttonLabel: `${packs} pack${packs !== 1 ? 's' : ''} — ${fmt(packPrice)} (save ${fmt(individualPrice - packPrice)})`,
          quantity: packs,
          isSuggested: true,
        });
        if (remainder > 0 && remainder <= 5) {
          // Also offer individual for the remainder
          opts.push({
            productType: 'fix_meta',
            displayName: 'Metadata Optimization',
            priceUsd: 20,
            buttonLabel: `Or ${counts.missingMeta} individual — ${fmt(individualPrice)}`,
            quantity: counts.missingMeta,
          });
        }
      }
      result.push({
        id: 'meta',
        icon: FileText,
        label: 'Metadata Optimization',
        description: `${counts.missingMeta} page${counts.missingMeta !== 1 ? 's' : ''} with missing or poor meta descriptions`,
        count: counts.missingMeta,
        unit: 'pages',
        options: opts,
      });
    }

    if (counts.missingSchema > 0) {
      const opts: FixOption['options'] = [];
      if (counts.missingSchema <= 9) {
        opts.push({
          productType: 'schema_page',
          displayName: 'Schema — Per Page',
          priceUsd: 39,
          buttonLabel: `Add to ${counts.missingSchema} page${counts.missingSchema !== 1 ? 's' : ''} — ${fmt(counts.missingSchema * 39)}`,
          quantity: counts.missingSchema,
          isSuggested: true,
        });
      } else {
        const packs = Math.ceil(counts.missingSchema / 10);
        const packPrice = packs * 299;
        const individualPrice = counts.missingSchema * 39;
        opts.push({
          productType: 'schema_10',
          displayName: 'Schema Pack (10pg)',
          priceUsd: 299,
          buttonLabel: `${packs} pack${packs !== 1 ? 's' : ''} — ${fmt(packPrice)} (save ${fmt(individualPrice - packPrice)})`,
          quantity: packs,
          isSuggested: true,
        });
      }
      result.push({
        id: 'schema',
        icon: Code2,
        label: 'Schema Markup',
        description: `${counts.missingSchema} page${counts.missingSchema !== 1 ? 's' : ''} without structured data`,
        count: counts.missingSchema,
        unit: 'pages',
        options: opts,
      });
    }

    if (counts.redirectIssues > 0) {
      result.push({
        id: 'redirect',
        icon: ArrowRightLeft,
        label: 'Redirect Fixes',
        description: `${counts.redirectIssues} redirect issue${counts.redirectIssues !== 1 ? 's' : ''} detected`,
        count: counts.redirectIssues,
        unit: 'redirects',
        options: [{
          productType: 'fix_redirect',
          displayName: 'Redirect Fix',
          priceUsd: 19,
          buttonLabel: `Fix ${counts.redirectIssues} — ${fmt(counts.redirectIssues * 19)}`,
          quantity: counts.redirectIssues,
          isSuggested: true,
        }],
      });
    }

    if (counts.manualIssues > 0) {
      result.push({
        id: 'manual',
        icon: Wrench,
        label: 'Heading, Link & Layout Fixes',
        description: `${counts.manualIssues} issue${counts.manualIssues !== 1 ? 's' : ''} requiring manual implementation`,
        count: counts.manualIssues,
        unit: 'issues',
        options: [],
        isManual: true,
      });
    }

    return result;
  }, [counts]);

  const totalAutoFixes = fixes.filter(f => !f.isManual).length;
  const estimatedTotal = fixes.filter(f => !f.isManual).reduce((sum, f) => {
    const suggested = f.options.find(o => o.isSuggested);
    if (!suggested) return sum;
    return sum + suggested.priceUsd * (suggested.quantity || 1);
  }, 0);

  if (fixes.length === 0) return null;

  const isPremium = tier === 'premium';

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-teal-400" />
        <span className="text-xs font-semibold text-zinc-200">Recommended Fixes</span>
        {totalAutoFixes > 0 && !isPremium && (
          <span className="text-[11px] text-zinc-500 ml-auto">
            Est. total: <span className="text-teal-400 font-medium">{fmt(estimatedTotal)}</span>
          </span>
        )}
      </div>

      <div className="divide-y divide-zinc-800/50">
        {fixes.map(fix => {
          const Icon = fix.icon;
          const inCart = cart.items.some(i => fix.options.some(o => o.productType === i.productType));

          return (
            <div key={fix.id} className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200">{fix.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{fix.description}</div>

                  {isPremium ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Crown className="w-3 h-3 text-amber-400" />
                      <span className="text-[11px] text-amber-400">Included in your Premium plan</span>
                    </div>
                  ) : fix.isManual ? (
                    <button className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
                      <MessageSquare className="w-3 h-3" />
                      Request a Quote
                    </button>
                  ) : inCart ? (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      <ShoppingCart className="w-3 h-3" />
                      In cart
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {fix.options.map((opt, idx) => (
                        <button
                          key={idx}
                          onClick={() => cart.addItem({
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
          );
        })}
      </div>

      {/* Fix everything CTA */}
      {!isPremium && totalAutoFixes > 1 && (
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-800/30">
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
                fixes.filter(f => !f.isManual).forEach(fix => {
                  const suggested = fix.options.find(o => o.isSuggested);
                  if (suggested) {
                    cart.addItem({
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
