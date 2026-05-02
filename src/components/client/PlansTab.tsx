import { CheckCircle2, FileText, MessageSquare, Sparkles, X, Zap, DollarSign, TrendingUp, CreditCard, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { STUDIO_NAME } from '../../constants';
import { SectionCard, type Tier, Icon, Button } from '../ui';
import type { WorkspaceInfo } from './types';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';
import { post } from '../../api/client';
import { contentSubscriptions } from '../../api/misc';
import type { ContentSubscription, ContentSubscriptionPlanConfig } from '../../../shared/types/content';
import type { PricingData } from '../../hooks/usePayments';

interface PlansTabProps {
  workspaceId: string;
  ws: WorkspaceInfo;
  effectiveTier: Tier;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onOpenChat: () => void;
  pricingData?: PricingData | null;
}

export function PlansTab({ workspaceId, ws, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setToast, onOpenChat, pricingData }: PlansTabProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const tier = effectiveTier;
  const isTrial = ws.isTrial && ws.trialDaysRemaining != null && ws.trialDaysRemaining > 0;
  const [billingLoading, setBillingLoading] = useState(false);

  // Content subscription state
  const [subData, setSubData] = useState<{ subscription: ContentSubscription | null; plans: ContentSubscriptionPlanConfig[] } | null>(null);
  const [subLoading, setSubLoading] = useState(false);

  useEffect(() => {
    contentSubscriptions.clientStatus(workspaceId).then(data => {
      if (data) setSubData(data);
    });
  }, [workspaceId]);

  const handleSubscribe = async (plan: string) => {
    setSubLoading(true);
    try {
      const data = await contentSubscriptions.subscribe(workspaceId, plan);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to start checkout', type: 'error' });
    } finally { setSubLoading(false); }
  };

  const openBillingPortal = async () => {
    setBillingLoading(true);
    try {
      const data = await post<{ url?: string }>(`/api/public/billing-portal/${workspaceId}`);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Could not open billing portal', type: 'error' });
    } finally { setBillingLoading(false); }
  };
  type FeatureGroup = { category: string; features: { label: string; included: boolean }[] };
  const plans: { id: Tier; name: string; price: string; tagline: string; color: string; borderColor: string; bgColor: string; featureGroups: FeatureGroup[] }[] = [
    {
      id: 'free', name: 'Starter', price: 'Free', tagline: 'Your site at a glance',
      color: 'text-[var(--brand-text)]', borderColor: 'border-[var(--brand-border-strong)]', bgColor: 'bg-[var(--surface-2)]',
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
      id: 'growth', name: 'Growth', price: pricingData?.products?.plan_growth ? `$${pricingData.products.plan_growth.price}` : '$249', tagline: 'AI-powered SEO engine',
      color: 'text-accent-brand', borderColor: 'border-teal-500/30', bgColor: 'bg-teal-500/5',
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
      id: 'premium', name: 'Premium', price: pricingData?.products?.plan_premium ? `$${pricingData.products.plan_premium.price}` : '$999', tagline: 'Managed SEO partnership',
      color: 'text-accent-brand', borderColor: 'border-teal-400/30', bgColor: 'bg-teal-500/5',
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
        <h2 className="text-2xl font-bold text-[var(--brand-text)]">Plans & Pricing</h2>
        <p className="t-body text-[var(--brand-text-muted)] mt-2 max-w-md mx-auto">Choose the right plan for your business. All plans include your dedicated client dashboard.</p>
        {isTrial && (
          <div className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Icon as={Zap} size="md" className="text-accent-warning" />
            <span className="t-caption text-accent-warning font-medium">You&apos;re trialing {plans.find(p => p.id === tier)?.name} — {ws.trialDaysRemaining} day{ws.trialDaysRemaining !== 1 ? 's' : ''} remaining</span>
          </div>
        )}
      </div>

      {/* Tier comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(plan => {
          const isCurrent = plan.id === tier;
          const isUpgrade = (plan.id === 'growth' && tier === 'free') || (plan.id === 'premium' && tier !== 'premium');
          return (
            <div key={plan.id} className={`relative rounded-[var(--radius-xl)] border p-5 transition-all ${isCurrent ? `${plan.bgColor} ${plan.borderColor} ring-1 ring-offset-0 ${plan.id !== 'free' ? 'ring-teal-500/20' : 'ring-zinc-700'}` : `bg-[var(--surface-2)]/50 border-[var(--brand-border)] hover:border-[var(--brand-border-strong)]`}`}>
              {isCurrent && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full t-caption-sm uppercase tracking-wider font-semibold border ${plan.id !== 'free' ? 'bg-teal-500/20 border-teal-500/30 text-accent-brand' : 'bg-[var(--surface-3)] border-[var(--brand-border-strong)] text-[var(--brand-text-muted)]'}`}>
                  {isTrial ? 'Current Trial' : 'Current Plan'}
                </div>
              )}
              <div className="pt-2">
                <h3 className={`text-lg font-bold ${plan.color}`}>{plan.name}</h3>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className={`text-2xl font-bold ${plan.color}`}>{plan.price}</span>
                  {plan.price !== 'Free' && <span className="t-caption text-[var(--brand-text-muted)]">/month</span>}
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5 mb-4">{plan.tagline}</p>
                <div className="space-y-3">
                  {plan.featureGroups.map((group, gi) => (
                    <div key={gi}>
                      <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1.5">{group.category}</div>
                      {group.features.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2 py-0.5">
                          {f.included ? (
                            <Icon as={CheckCircle2} size="md" className="flex-shrink-0 text-accent-brand" />
                          ) : (
                            <Icon as={X} size="md" className="flex-shrink-0 text-[var(--brand-text-faint)]" />
                          )}
                          <span className={`t-caption ${f.included ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-faint)]'}`}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  {isCurrent ? (
                    <div className="space-y-2">
                      <div className={`w-full py-2 rounded-[var(--radius-lg)] t-caption font-medium text-center border ${plan.id !== 'free' ? 'bg-teal-500/10 border-teal-500/20 text-accent-brand' : 'bg-[var(--surface-3)] border-[var(--brand-border-strong)] text-[var(--brand-text-muted)]'}`}>
                        {isTrial ? 'Trialing Now' : 'Your Plan'}
                      </div>
                      {plan.id !== 'free' && !isTrial && (
                        <Button
                          variant="secondary"
                          onClick={openBillingPortal}
                          disabled={billingLoading}
                          loading={billingLoading}
                          icon={billingLoading ? undefined : CreditCard}
                          className="w-full"
                        >
                          Manage Billing
                        </Button>
                      )}
                    </div>
                  ) : isUpgrade ? (
                    <Button onClick={async () => {
                      try {
                        const data = await post<{ url?: string }>(`/api/public/upgrade-checkout/${workspaceId}`, { planId: plan.id });
                        if (data.url) window.location.href = data.url;
                      } catch (err) {
                        setToast({ message: err instanceof Error ? err.message : 'Upgrade failed. Please try again.', type: 'error' });
                      }
                    }}
                      className="w-full">
                      Upgrade to {plan.name}
                    </Button>
                  ) : (
                    <div className="w-full py-2 rounded-[var(--radius-lg)] t-caption font-medium text-center bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-faint)]">
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
        <SectionCard title="Content Services" titleIcon={<Icon as={FileText} size="lg" className="text-accent-brand" />}>
          <p className="t-caption text-[var(--brand-text-muted)] mb-5">Professional content created by {STUDIO_NAME}, tailored to your SEO strategy.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {briefPrice != null && (
              <div className="px-5 py-4 rounded-[var(--radius-xl)] bg-teal-500/5 border border-teal-500/20 hover:border-teal-500/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon as={FileText} size="md" className="text-accent-brand" />
                    <span className="t-body font-semibold text-[var(--brand-text)]">Content Brief</span>
                  </div>
                  <span className="text-lg font-bold text-accent-brand">{fmtPrice(briefPrice)}</span>
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">Detailed content strategy document with keyword targets, outline, competitor analysis, and SEO recommendations.</p>
              </div>
            )}
            {fullPostPrice != null && (
              <div className="px-5 py-4 rounded-[var(--radius-xl)] bg-teal-500/5 border border-teal-500/20 hover:border-teal-500/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon as={Sparkles} size="md" className="text-accent-brand" />
                    <span className="t-body font-semibold text-[var(--brand-text)]">Full Blog Post</span>
                  </div>
                  <span className="text-lg font-bold text-accent-brand">{fmtPrice(fullPostPrice)}</span>
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">Complete brief + professionally written article, ready to publish with SEO optimization built in.</p>
              </div>
            )}
          </div>

          {tier !== 'free' && (
            <div className="mt-5 text-center">
              <Button onClick={() => navigate(clientPath(workspaceId, 'content', betaMode))} icon={FileText}>
                Browse Content Opportunities
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Content subscription packages */}
      {subData && subData.plans.length > 0 && (
        <SectionCard title="Monthly Content Packages" titleIcon={<Icon as={RefreshCw} size="lg" className="text-accent-brand" />}>
          <p className="t-caption text-[var(--brand-text-muted)] mb-5">Recurring SEO-optimized content delivered every month, powered by your keyword strategy.</p>

          {/* Active subscription banner */}
          {subData.subscription && (
            <div className="mb-5 p-4 rounded-[var(--radius-xl)] bg-teal-500/5 border border-teal-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon as={CheckCircle2} size="md" className="text-accent-brand" />
                    <span className="t-body font-medium text-[var(--brand-text)]">
                      {subData.plans.find(p => p.plan === subData.subscription?.plan)?.displayName || subData.subscription.plan}
                    </span>
                    <span className={`t-caption-sm px-1.5 py-0.5 rounded font-medium ${
                      subData.subscription.status === 'active' ? 'bg-emerald-500/10 text-accent-success' :
                      subData.subscription.status === 'past_due' ? 'bg-red-500/10 text-accent-danger' :
                      'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'
                    }`}>
                      {subData.subscription.status === 'active' ? 'Active' : subData.subscription.status === 'past_due' ? 'Past Due' : subData.subscription.status}
                    </span>
                  </div>
                  <p className="t-caption text-[var(--brand-text-muted)] mt-1">
                    {subData.subscription.postsDeliveredThisPeriod} of {subData.subscription.postsPerMonth} posts delivered this period
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-accent-brand">${subData.subscription.priceUsd}<span className="t-caption text-[var(--brand-text-muted)]">/mo</span></div>
                </div>
              </div>
              {/* Progress */}
              <div className="mt-3">
                <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (subData.subscription.postsDeliveredThisPeriod / subData.subscription.postsPerMonth) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Plan cards (only show if no active subscription) */}
          {!subData.subscription && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {subData.plans.map(plan => (
                <div key={plan.plan} className="p-4 rounded-[var(--radius-xl)] bg-[var(--surface-3)]/50 border border-[var(--brand-border-strong)] hover:border-[var(--brand-border-hover)] transition-colors">
                  <h4 className="t-body font-semibold text-[var(--brand-text)]">{plan.displayName}</h4>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{plan.description}</p>
                  <div className="flex items-baseline gap-1 mt-3">
                    <span className="text-xl font-bold text-accent-brand">${plan.priceUsd}</span>
                    <span className="t-caption text-[var(--brand-text-muted)]">/mo</span>
                  </div>
                  <Button
                    onClick={() => handleSubscribe(plan.plan)}
                    disabled={subLoading}
                    loading={subLoading}
                    className="mt-3 w-full"
                  >
                    {!subLoading && <Icon as={RefreshCw} size="sm" />}
                    Subscribe
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ROI teaser for free-tier users */}
      {tier === 'free' && (
        <div className="bg-gradient-to-r from-emerald-500/8 via-[var(--surface-2)] to-blue-500/8 rounded-[var(--radius-xl)] border border-emerald-500/20 p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-[var(--radius-xl)] bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Icon as={DollarSign} size="lg" className="text-accent-success" />
            </div>
            <div className="flex-1">
              <h3 className="t-body font-semibold text-[var(--brand-text)] mb-1">See the dollar value of your organic traffic</h3>
              <p className="t-caption text-[var(--brand-text-muted)] leading-relaxed mb-3">
                The ROI Dashboard shows what your organic search traffic would cost if you bought it through Google Ads. Growth plan clients see their traffic value, page-by-page breakdown, and content investment returns.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-2.5 text-center">
                  <Icon as={TrendingUp} size="md" className="text-accent-success mx-auto mb-1" />
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Traffic Value</div>
                </div>
                <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-2.5 text-center">
                  <Icon as={DollarSign} size="md" className="text-accent-info mx-auto mb-1" />
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Ad Spend Saved</div>
                </div>
                <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-2.5 text-center">
                  <Icon as={Sparkles} size="md" className="text-accent-brand mx-auto mb-1" />
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Content ROI</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact CTA */}
      {/* pr-check-disable-next-line -- Contact CTA strip; no section header, pure styled row */}
      <div className="text-center py-6 bg-[var(--surface-2)]/50 rounded-[var(--radius-xl)] border border-[var(--brand-border)]">
        <p className="t-body text-[var(--brand-text-muted)] mb-3">Have questions about which plan is right for you?</p>
        <Button variant="secondary" size="lg" icon={MessageSquare} onClick={onOpenChat}>
          Ask Your AI Advisor
        </Button>
      </div>
    </div>
  </>);
}
