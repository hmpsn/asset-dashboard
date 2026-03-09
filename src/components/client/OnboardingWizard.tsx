import { useState } from 'react';
import {
  Sparkles, Target, Shield, LineChart, FileText,
  Zap, ChevronRight, ChevronLeft, Check, BarChart3, Trophy,
  MousePointerClick, ArrowRight,
} from 'lucide-react';
import { useBetaMode } from './BetaContext';
import { STUDIO_NAME } from '../../constants';

interface OnboardingWizardProps {
  workspaceName: string;
  tier: 'free' | 'growth' | 'premium';
  isTrial: boolean;
  trialDaysRemaining?: number;
  hasGSC: boolean;
  hasGA4: boolean;
  hasStrategy: boolean;
  hasAudit: boolean;
  onDismiss: () => void;
  onNavigate: (tab: string) => void;
}

const STEPS = ['welcome', 'tour', 'actions'] as const;
type Step = typeof STEPS[number];

export function OnboardingWizard({
  workspaceName, tier, isTrial, trialDaysRemaining,
  hasGSC, hasStrategy, hasAudit,
  onDismiss, onNavigate,
}: OnboardingWizardProps) {
  const betaMode = useBetaMode();
  const [step, setStep] = useState<Step>('welcome');
  const stepIdx = STEPS.indexOf(step);
  const tierLabel = tier === 'premium' ? 'Premium' : tier === 'growth' ? 'Growth' : 'Starter';
  const tierBg = tier !== 'free' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300' : 'bg-zinc-800 border-zinc-700 text-zinc-300';

  const features = [
    { icon: Shield, label: 'Site Health', desc: 'Automated SEO audits with actionable fixes', available: true, tab: 'health' },
    { icon: LineChart, label: 'Performance', desc: 'GA4 + Search Console data in one place', available: true, tab: 'performance' },
    { icon: Sparkles, label: 'AI Advisor', desc: 'Ask questions about your traffic and strategy', available: true, tab: 'overview' },
    { icon: Target, label: 'SEO Strategy', desc: 'Keyword mapping, content gaps, and quick wins', available: tier !== 'free', tab: 'strategy' },
    ...(!betaMode ? [{ icon: FileText, label: 'Content Engine', desc: 'AI-generated briefs and content purchasing', available: tier !== 'free', tab: 'content' }] : []),
    { icon: Trophy, label: 'ROI Dashboard', desc: 'Track the value of your organic traffic', available: tier !== 'free', tab: 'roi' },
  ];

  const suggestedActions = [
    hasAudit && { icon: Shield, label: 'Check your site health score', desc: 'See how your website stacks up technically', tab: 'health', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
    hasGSC && { icon: MousePointerClick, label: 'Explore search performance', desc: 'See which keywords are driving traffic', tab: 'performance', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
    hasStrategy && tier !== 'free' && { icon: Target, label: 'Review your SEO strategy', desc: 'Keyword assignments, content gaps, and opportunities', tab: 'strategy', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
    { icon: Sparkles, label: 'Ask your AI advisor a question', desc: 'Try: "What should I focus on this month?"', tab: 'overview', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', action: 'chat' },
  ].filter(Boolean) as { icon: typeof Shield; label: string; desc: string; tab: string; color: string; bg: string; action?: string }[];

  const next = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]); };
  const prev = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]); };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={onDismiss}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 pt-5 pb-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-all ${i <= stepIdx ? 'bg-teal-400 scale-110' : 'bg-zinc-700'}`} />
              {i < STEPS.length - 1 && <div className={`w-6 h-px ${i < stepIdx ? 'bg-teal-500/40' : 'bg-zinc-800'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Welcome */}
        {step === 'welcome' && (
          <>
            <div className="relative px-6 pt-4 pb-6 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(45,212,191,0.08), transparent)' }}>
              <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full blur-3xl opacity-15 bg-gradient-to-br from-teal-500 to-emerald-500" />
              <div className="relative text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500/20 to-emerald-500/20 ring-1 ring-teal-500/20 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-7 h-7 text-teal-400" />
                </div>
                <h2 className="text-xl font-bold text-zinc-100 mb-1">Welcome to your dashboard</h2>
                <p className="text-sm text-zinc-400">{workspaceName}</p>
                {!betaMode && <div className="flex items-center justify-center gap-2 mt-3">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${tierBg}`}>{tierLabel} Plan</span>
                  {isTrial && trialDaysRemaining != null && (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
                      {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} left in trial
                    </span>
                  )}
                </div>}
              </div>
            </div>

            <div className="px-6 pb-2">
              <p className="text-[13px] text-zinc-400 text-center leading-relaxed">
                {STUDIO_NAME} has set up a personalized insights dashboard for you.
                Let&apos;s take a quick tour of what&apos;s available.
              </p>
            </div>

            {!betaMode && isTrial && (
              <div className="mx-6 mb-4 px-3.5 py-3 rounded-xl bg-gradient-to-r from-blue-500/5 to-teal-500/5 border border-blue-500/15">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-zinc-200">You&apos;re on a free trial</div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">Explore all {tierLabel} features for {trialDaysRemaining} more day{trialDaysRemaining !== 1 ? 's' : ''}. No credit card required.</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Step 2: Feature Tour */}
        {step === 'tour' && (
          <>
            <div className="px-6 pt-4 pb-2 text-center">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20 flex items-center justify-center mx-auto mb-3">
                <BarChart3 className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-100 mb-1">What&apos;s included</h2>
              <p className="text-[13px] text-zinc-500">Everything your dashboard can do</p>
            </div>

            <div className="px-6 py-4">
              <div className="grid grid-cols-2 gap-2">
                {features.map((f, i) => (
                  <div key={i} className={`px-3 py-2.5 rounded-lg border transition-colors ${f.available ? 'bg-zinc-800/50 border-zinc-800 hover:border-zinc-700' : 'bg-zinc-900/50 border-zinc-800/50 opacity-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <f.icon className={`w-3.5 h-3.5 ${f.available ? 'text-teal-400' : 'text-zinc-600'}`} />
                      <span className={`text-[11px] font-semibold ${f.available ? 'text-zinc-200' : 'text-zinc-500'}`}>{f.label}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 leading-relaxed">{f.desc}</div>
                    {!betaMode && !f.available && <div className="text-[10px] text-zinc-600 mt-1 italic">Upgrade to unlock</div>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Step 3: Suggested Actions */}
        {step === 'actions' && (
          <>
            <div className="px-6 pt-4 pb-2 text-center">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <Trophy className="w-5 h-5 text-emerald-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-100 mb-1">Get started</h2>
              <p className="text-[13px] text-zinc-500">Here are some things you can do right now</p>
            </div>

            <div className="px-6 py-4 space-y-2">
              {suggestedActions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => { onDismiss(); onNavigate(a.tab); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border ${a.bg} hover:scale-[1.01] transition-all text-left group`}
                >
                  <div className={`w-8 h-8 rounded-lg bg-zinc-900/50 flex items-center justify-center flex-shrink-0`}>
                    <a.icon className={`w-4 h-4 ${a.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-zinc-200">{a.label}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{a.desc}</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Navigation */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          {stepIdx > 0 ? (
            <button onClick={prev} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : (
            <button onClick={onDismiss} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
              Skip for now
            </button>
          )}

          {stepIdx < STEPS.length - 1 ? (
            <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-sm text-white font-semibold hover:from-teal-500 hover:to-emerald-500 transition-all">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => { onDismiss(); onNavigate('overview'); }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-sm text-white font-semibold hover:from-teal-500 hover:to-emerald-500 transition-all"
            >
              <Check className="w-3.5 h-3.5" /> Explore Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
