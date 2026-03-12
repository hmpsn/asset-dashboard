import type { ReactNode } from 'react';
import { Lock, Sparkles, ArrowRight } from 'lucide-react';

export type Tier = 'free' | 'growth' | 'premium';

const TIER_LEVEL: Record<Tier, number> = { free: 0, growth: 1, premium: 2 };

const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  growth: 'Growth',
  premium: 'Premium',
};

const TIER_COLORS: Record<Tier, { bg: string; border: string; text: string; badge: string }> = {
  free: { bg: 'bg-zinc-500/5', border: 'border-zinc-500/20', text: 'text-zinc-400', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
  growth: { bg: 'bg-teal-500/5', border: 'border-teal-500/20', text: 'text-teal-400', badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
  premium: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
};

interface TierGateProps {
  tier: Tier;
  required: Tier;
  feature: string;
  teaser?: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  roiValue?: number | null;
}

export function TierGate({ tier, required, feature, teaser, children, className, compact, roiValue }: TierGateProps) {
  const hasAccess = TIER_LEVEL[tier] >= TIER_LEVEL[required];

  if (hasAccess) return <>{children}</>;

  const colors = TIER_COLORS[required];

  if (compact) {
    return (
      <div className={`relative rounded-xl border ${colors.border} ${colors.bg} p-3 ${className ?? ''}`}>
        <div className="flex items-center gap-2">
          <Lock className={`w-3.5 h-3.5 ${colors.text} flex-shrink-0`} />
          <span className="text-xs text-zinc-400">
            <span className={`font-medium ${colors.text}`}>{feature}</span>
            {' '}requires the{' '}
            <span className={`font-semibold ${colors.text}`}>{TIER_LABELS[required]}</span> plan
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* Blurred preview of children */}
      <div className="select-none pointer-events-none" aria-hidden="true">
        <div className="blur-[6px] opacity-40 saturate-50">
          {children}
        </div>
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className={`flex flex-col items-center gap-3 max-w-xs text-center px-6 py-5 rounded-2xl border backdrop-blur-sm ${colors.bg} ${colors.border}`}>
          {/* Icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors.bg} ring-1 ${colors.border}`}>
            <Sparkles className={`w-5 h-5 ${colors.text}`} />
          </div>

          {/* Copy */}
          <div>
            <div className="text-sm font-semibold text-zinc-100 mb-1">{feature}</div>
            <div className="text-[11px] text-zinc-500 leading-relaxed">
              {teaser || `Upgrade to ${TIER_LABELS[required]} to unlock this feature`}
            </div>
            {roiValue && roiValue > 0 && (
              <div className="text-[10px] text-emerald-400/80 mt-1 font-medium">
                Your site generates ${Math.round(roiValue).toLocaleString()}/mo in organic value
              </div>
            )}
          </div>

          {/* Badge */}
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors.badge}`}>
            <Lock className="w-2.5 h-2.5" />
            {TIER_LABELS[required]} Plan
          </span>

          {/* CTA */}
          <button
            onClick={() => {
              // Dispatch a custom event so the parent can handle upgrade navigation
              window.dispatchEvent(new CustomEvent('tier-upgrade', { detail: { required, feature } }));
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              required === 'premium'
                ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/25'
                : 'bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 border border-teal-500/25'
            }`}
          >
            Learn More <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  const colors = TIER_COLORS[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors.badge}`}>
      {tier === 'premium' && <Sparkles className="w-2.5 h-2.5" />}
      {TIER_LABELS[tier]}
    </span>
  );
}
