import { CheckCircle2, FileText, MessageSquare, Sparkles, X, Zap, DollarSign, TrendingUp, CreditCard, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STUDIO_NAME } from '../../constants';
import type { Tier } from '../ui';
import type { WorkspaceInfo, ClientTab } from './types';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';

interface PlansTabProps {
  workspaceId: string;
  ws: WorkspaceInfo;
  effectiveTier: Tier;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onOpenChat: () => void;
}

export function PlansTab({ workspaceId, ws, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setToast, onOpenChat }: PlansTabProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const tier = effectiveTier;
  const isTrial = ws.isTrial && ws.trialDaysRemaining != null && ws.trialDaysRemaining > 0;
  const [billingLoading, setBillingLoading] = useState(false);

  const openBillingPortal = async () => {
    setBillingLoading(true);
    try {
      const res = await fetch(`/api/public/billing-portal/${workspaceId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Could not open billing portal', type: 'error' });
    } finally { setBillingLoading(false); }
  };
  type FeatureGroup = { category: string; features: { label: string; included: boolean }[] };
  const plans: { id: Tier; name: string; price: string; tagline: string; color: string; borderColor: string; bgColor: string; featureGroups: FeatureGroup[] }[] = [
    {
      id: 'free', name: 'Starter', price: 'Free', tagline: 'Your site at a glance',
      color: 'text-zinc-300', borderColor: 'border-zinc-700', bgColor: 'bg-zinc-900',
      featureGroups: [
        { category: 'Insights & Data', features: [
          { label: 'AI-powered site insights', included: true },
          { label: 'Site health audits', included: true },
          { label: 'Google Analytics overview', included: true },
          { label: 'Search Console data', included: true },
        ]},
        { category: 'AI & Tools', features: [
          { label: 'AI chat advisor (3/mo)', included: true },
          { label: 'Monthly summary digest', included: true },
          { label: 'Custom date ranges', included: false },
        ]},
        { category: 'Strategy & Content', features: [
          { label: 'SEO keyword strategy', included: false },
          { label: 'Content briefs & posts', included: false },
          { label: 'ROI tracking', included: false },
          { label: 'Competitor analysis', included: false },
        ]},
      ],
    },
    {
      id: 'growth', name: 'Growth', price: '$249', tagline: 'AI-powered SEO engine',
      color: 'text-teal-300', borderColor: 'border-teal-500/30', bgColor: 'bg-teal-500/5',
      featureGroups: [
        { category: 'Everything in Starter, plus:', features: [] },
        { category: 'Strategy & SEO', features: [
          { label: 'SEO keyword strategy', included: true },
          { label: 'Content gaps & quick wins', included: true },
          { label: 'Page keyword mapping', included: true },
        ]},
        { category: 'Content & ROI', features: [
          { label: 'Content briefs & posts', included: true },
          { label: 'ROI dashboard', included: true },
          { label: 'Custom date ranges', included: true },
          { label: 'Unlimited AI chat', included: true },
        ]},
        { category: 'Premium Only', features: [
          { label: 'Competitor analysis', included: false },
          { label: '3 strategy & implementation hrs', included: false },
          { label: 'Dedicated strategist', included: false },
        ]},
      ],
    },
    {
      id: 'premium', name: 'Premium', price: '$999', tagline: 'Managed SEO partnership',
      color: 'text-teal-200', borderColor: 'border-teal-400/30', bgColor: 'bg-teal-500/5',
      featureGroups: [
        { category: 'Everything in Growth, plus:', features: [] },
        { category: 'Competitor Intelligence', features: [
          { label: 'Competitor keyword analysis', included: true },
          { label: 'Advanced competitor intel', included: true },
        ]},
        { category: 'Managed SEO', features: [
          { label: 'Dedicated strategist', included: true },
          { label: '3 strategy & implementation hrs/mo', included: true },
          { label: 'Monthly strategy reviews', included: true },
          { label: 'SEO change approvals', included: true },
        ]},
        { category: 'Technical & Content', features: [
          { label: 'Content calendar planning', included: true },
          { label: 'Technical SEO implementation', included: true },
          { label: 'Schema markup', included: true },
          { label: 'Priority support', included: true },
        ]},
      ],
    },
  ];
  return (<>
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-zinc-100">Plans & Pricing</h2>
        <p className="text-sm text-zinc-500 mt-2 max-w-md mx-auto">Choose the right plan for your business. All plans include your dedicated client dashboard.</p>
        {isTrial && (
          <div className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-amber-300 font-medium">You&apos;re trialing {plans.find(p => p.id === tier)?.name} — {ws.trialDaysRemaining} day{ws.trialDaysRemaining !== 1 ? 's' : ''} remaining</span>
          </div>
        )}
      </div>

      {/* Tier comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(plan => {
          const isCurrent = plan.id === tier;
          const isUpgrade = (plan.id === 'growth' && tier === 'free') || (plan.id === 'premium' && tier !== 'premium');
          return (
            <div key={plan.id} className={`relative rounded-xl border p-5 transition-all ${isCurrent ? `${plan.bgColor} ${plan.borderColor} ring-1 ring-offset-0 ${plan.id !== 'free' ? 'ring-teal-500/20' : 'ring-zinc-700'}` : `bg-zinc-900/50 border-zinc-800 hover:border-zinc-700`}`}>
              {isCurrent && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${plan.id !== 'free' ? 'bg-teal-500/20 border-teal-500/30 text-teal-300' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  {isTrial ? 'Current Trial' : 'Current Plan'}
                </div>
              )}
              <div className="pt-2">
                <h3 className={`text-lg font-bold ${plan.color}`}>{plan.name}</h3>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className={`text-2xl font-bold ${plan.color}`}>{plan.price}</span>
                  {plan.price !== 'Free' && <span className="text-xs text-zinc-500">/month</span>}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5 mb-4">{plan.tagline}</p>
                <div className="space-y-3">
                  {plan.featureGroups.map((group, gi) => (
                    <div key={gi}>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">{group.category}</div>
                      {group.features.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2 py-0.5">
                          {f.included ? (
                            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-teal-400" />
                          ) : (
                            <X className="w-3.5 h-3.5 flex-shrink-0 text-zinc-700" />
                          )}
                          <span className={`text-xs ${f.included ? 'text-zinc-300' : 'text-zinc-600'}`}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  {isCurrent ? (
                    <div className="space-y-2">
                      <div className={`w-full py-2 rounded-lg text-xs font-medium text-center border ${plan.id !== 'free' ? 'bg-teal-500/10 border-teal-500/20 text-teal-300' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                        {isTrial ? 'Trialing Now' : 'Your Plan'}
                      </div>
                      {plan.id !== 'free' && !isTrial && (
                        <button
                          onClick={openBillingPortal}
                          disabled={billingLoading}
                          className="w-full py-2 rounded-lg text-[11px] font-medium text-center border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-300 transition-colors flex items-center justify-center gap-1.5"
                        >
                          {billingLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                          Manage Billing
                        </button>
                      )}
                    </div>
                  ) : isUpgrade ? (
                    <button onClick={async () => {
                      try {
                        const res = await fetch(`/api/public/upgrade-checkout/${workspaceId}`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ planId: plan.id }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
                        if (data.url) window.location.href = data.url;
                      } catch (err) {
                        setToast({ message: err instanceof Error ? err.message : 'Upgrade failed. Please try again.', type: 'error' });
                      }
                    }}
                      className="block w-full py-2.5 rounded-lg text-xs font-semibold text-center transition-all bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white cursor-pointer">
                      Upgrade to {plan.name}
                    </button>
                  ) : (
                    <div className="w-full py-2 rounded-lg text-xs font-medium text-center bg-zinc-800/50 border border-zinc-800 text-zinc-600">
                      Included
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content pricing section */}
      {(briefPrice != null || fullPostPrice != null) && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-5 h-5 text-teal-400" />
            <h3 className="text-lg font-semibold text-zinc-100">Content Services</h3>
          </div>
          <p className="text-xs text-zinc-500 mb-5">Professional content created by {STUDIO_NAME}, tailored to your SEO strategy.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {briefPrice != null && (
              <div className="px-5 py-4 rounded-xl bg-teal-500/5 border border-teal-500/20 hover:border-teal-500/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-teal-400" />
                    <span className="text-sm font-semibold text-zinc-200">Content Brief</span>
                  </div>
                  <span className="text-lg font-bold text-teal-300">{fmtPrice(briefPrice)}</span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">Detailed content strategy document with keyword targets, outline, competitor analysis, and SEO recommendations.</p>
              </div>
            )}
            {fullPostPrice != null && (
              <div className="px-5 py-4 rounded-xl bg-teal-500/5 border border-teal-500/20 hover:border-teal-500/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-teal-400" />
                    <span className="text-sm font-semibold text-zinc-200">Full Blog Post</span>
                  </div>
                  <span className="text-lg font-bold text-teal-300">{fmtPrice(fullPostPrice)}</span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">Complete brief + professionally written article, ready to publish with SEO optimization built in.</p>
              </div>
            )}
          </div>

          {tier !== 'free' && (
            <div className="mt-5 text-center">
              <button onClick={() => navigate(clientPath(workspaceId, 'content', betaMode))} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-xs text-white font-medium transition-colors">
                <FileText className="w-3.5 h-3.5" /> Browse Content Opportunities
              </button>
            </div>
          )}
        </div>
      )}

      {/* ROI teaser for free-tier users */}
      {tier === 'free' && (
        <div className="bg-gradient-to-r from-emerald-500/8 via-zinc-900 to-blue-500/8 rounded-xl border border-emerald-500/20 p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-zinc-100 mb-1">See the dollar value of your organic traffic</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-3">
                The ROI Dashboard shows what your organic search traffic would cost if you bought it through Google Ads. Growth plan clients see their traffic value, page-by-page breakdown, and content investment returns.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="bg-zinc-900/60 rounded-lg border border-zinc-800 p-2.5 text-center">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                  <div className="text-[10px] text-zinc-500">Traffic Value</div>
                </div>
                <div className="bg-zinc-900/60 rounded-lg border border-zinc-800 p-2.5 text-center">
                  <DollarSign className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                  <div className="text-[10px] text-zinc-500">Ad Spend Saved</div>
                </div>
                <div className="bg-zinc-900/60 rounded-lg border border-zinc-800 p-2.5 text-center">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400 mx-auto mb-1" />
                  <div className="text-[10px] text-zinc-500">Content ROI</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact CTA */}
      <div className="text-center py-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <p className="text-sm text-zinc-400 mb-3">Have questions about which plan is right for you?</p>
        <button onClick={onOpenChat}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 font-medium transition-colors">
          <MessageSquare className="w-4 h-4" /> Ask Your AI Advisor
        </button>
      </div>
    </div>
  </>);
}
